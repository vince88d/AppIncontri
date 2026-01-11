const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { AccessToken } = require('livekit-server-sdk');
const vision = require('@google-cloud/vision');

admin.initializeApp();

const db = admin.firestore();
const visionClient = new vision.ImageAnnotatorClient();
const NUDITY_LEVELS = new Set(['POSSIBLE', 'LIKELY', 'VERY_LIKELY']);
const PRESENCE_ACTIVE_MS = 2 * 60 * 1000;

const normalizeConfigValue = (value) =>
  typeof value === 'string' ? value.trim() : '';

const maskValue = (value) => {
  if (!value) return '';
  const visible = 4;
  if (value.length <= visible * 2) return `${value.slice(0, 1)}...`;
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
};

const decodeJwtPart = (part) => {
  if (!part) return null;
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
};

const describeJwt = (jwt) => {
  const segments = typeof jwt === 'string' ? jwt.split('.') : [];
  return {
    length: typeof jwt === 'string' ? jwt.length : 0,
    segments: segments.length,
    headerPrefix: segments[0] ? segments[0].slice(0, 12) : '',
    payloadLength: segments[1] ? segments[1].length : 0,
    signatureLength: segments[2] ? segments[2].length : 0,
  };
};

const getLivekitConfig = () => {
  const cfg = functions.config().livekit || {};
  const apiKey = normalizeConfigValue(cfg.api_key || cfg.key || cfg.apikey || '');
  const apiSecret = normalizeConfigValue(
    cfg.api_secret || cfg.secret || cfg.apisecret || ''
  );
  const url = normalizeConfigValue(cfg.url || cfg.ws_url || cfg.wsurl || '');
  return { apiKey, apiSecret, url };
};

const assertLivekitConfig = () => {
  const config = getLivekitConfig();
  if (!config.apiKey || !config.apiSecret || !config.url) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'livekit-config-missing'
    );
  }
  return config;
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
};

const isPresenceActiveAt = (activeAt) => {
  if (!activeAt) return false;
  return Date.now() - toMillis(activeAt) <= PRESENCE_ACTIVE_MS;
};

const getActiveLiveHosts = async (groupRef, excludeUserId) => {
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - PRESENCE_ACTIVE_MS)
  );
  const snap = await groupRef
    .collection('livePresence')
    .where('activeAt', '>', cutoff)
    .get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((item) => (item.role || 'host') === 'host')
    .filter((item) => (!excludeUserId ? true : item.id !== excludeUserId));
};

const hasActiveLiveHostPresence = async (groupId, userId) => {
  const presenceSnap = await db
    .doc(`groupRooms/${groupId}/livePresence/${userId}`)
    .get();
  if (!presenceSnap.exists) return false;
  const data = presenceSnap.data() || {};
  if ((data.role || 'host') !== 'host') return false;
  return isPresenceActiveAt(data.activeAt);
};

const hasActivePresence = async (groupId, userId) => {
  const presenceSnap = await db
    .doc(`groupRooms/${groupId}/presence/${userId}`)
    .get();
  if (!presenceSnap.exists) return false;
  const activeAt = presenceSnap.data()?.activeAt;
  return isPresenceActiveAt(activeAt);
};

const getProfileSnapshot = async (userId) => {
  const profileSnap = await db.doc(`profiles/${userId}`).get();
  if (!profileSnap.exists) return {};
  const data = profileSnap.data() || {};
  return {
    name: typeof data.name === 'string' ? data.name : '',
    photo: typeof data.photo === 'string' ? data.photo : '',
  };
};

const isNudity = (safeSearch) => {
  if (!safeSearch) return false;
  return (
    NUDITY_LEVELS.has(safeSearch.adult) ||
    NUDITY_LEVELS.has(safeSearch.racy)
  );
};

const parseDataUrl = (dataUrl) => {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], content: match[2] };
};

const buildModerationUpdate = (safeSearch, flagged) => ({
  moderationStatus: flagged ? 'flagged' : 'ok',
  contentWarning: flagged ? 'nudity' : null,
  moderation: {
    adult: safeSearch?.adult || 'UNKNOWN',
    racy: safeSearch?.racy || 'UNKNOWN',
    medical: safeSearch?.medical || 'UNKNOWN',
    spoof: safeSearch?.spoof || 'UNKNOWN',
    violence: safeSearch?.violence || 'UNKNOWN',
  },
  moderationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
});

const buildModerationResponse = (safeSearch, flagged) => ({
  moderationStatus: flagged ? 'flagged' : 'ok',
  contentWarning: flagged ? 'nudity' : null,
  moderation: {
    adult: safeSearch?.adult || 'UNKNOWN',
    racy: safeSearch?.racy || 'UNKNOWN',
    medical: safeSearch?.medical || 'UNKNOWN',
    spoof: safeSearch?.spoof || 'UNKNOWN',
    violence: safeSearch?.violence || 'UNKNOWN',
  },
});

exports.moderateImageDataUrl = functions.https.onCall(async (data) => {
  const dataUrl = data?.dataUrl;
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Missing dataUrl.');
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid dataUrl.');
  }

  const [result] = await visionClient.safeSearchDetection({
    image: { content: parsed.content },
  });
  const safe = result.safeSearchAnnotation || {};
  const flagged = isNudity(safe);
  return buildModerationResponse(safe, flagged);
});

exports.moderateImage = functions.storage.object().onFinalize(async (object) => {
  const filePath = object.name;
  if (!filePath) return null;

  const metadata = object.metadata || {};
  const kind = metadata.kind;
  if (kind !== 'chat' && kind !== 'profile') {
    return null;
  }

  const [result] = await visionClient.safeSearchDetection(
    `gs://${object.bucket}/${filePath}`
  );
  const safe = result.safeSearchAnnotation || {};
  const flagged = isNudity(safe);
  const moderationUpdate = buildModerationUpdate(safe, flagged);

  if (kind === 'chat') {
    const chatId = metadata.chatId;
    const messageId = metadata.messageId;
    if (!chatId || !messageId) return null;
    await db
      .doc(`chats/${chatId}/messages/${messageId}`)
      .set(moderationUpdate, { merge: true });
    return null;
  }

  if (kind === 'profile') {
    const profileId = metadata.profileId;
    const photoIndex = Number(metadata.photoIndex);
    if (!profileId || Number.isNaN(photoIndex)) return null;

    const profileRef = db.doc(`profiles/${profileId}`);
    const snap = await profileRef.get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const photoMeta = Array.isArray(data.photoMeta) ? data.photoMeta : [];
    while (photoMeta.length <= photoIndex) {
      photoMeta.push({});
    }
    photoMeta[photoIndex] = {
      ...(photoMeta[photoIndex] || {}),
      path: filePath,
      moderationStatus: moderationUpdate.moderationStatus,
      contentWarning: moderationUpdate.contentWarning,
      moderation: moderationUpdate.moderation,
    };

    await profileRef.set(
      {
        photoMeta,
        moderationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return null;
});

exports.moderateChatImageDataUrl = functions.firestore
  .document('chats/{chatId}/messages/{messageId}')
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const image = data.image;
    if (!image || typeof image !== 'string') return null;
    if (!image.startsWith('data:')) return null;
    if (data.moderationStatus && data.moderationStatus !== 'pending') return null;

    const parsed = parseDataUrl(image);
    if (!parsed) {
      await snap.ref.set(buildModerationUpdate({}, true), { merge: true });
      return null;
    }

    try {
      const [result] = await visionClient.safeSearchDetection({
        image: { content: parsed.content },
      });
      const safe = result.safeSearchAnnotation || {};
      const flagged = isNudity(safe);
      await snap.ref.set(buildModerationUpdate(safe, flagged), { merge: true });
    } catch (e) {
      console.error('moderateChatImageDataUrl error', e);
      await snap.ref.set(buildModerationUpdate({}, true), { merge: true });
    }
    return null;
  });

exports.cleanupChatImageOnDelete = functions.firestore
  .document('chats/{chatId}/messages/{messageId}')
  .onDelete(async (snap) => {
    const data = snap.data() || {};
    const imagePath = data.imagePath;
    if (!imagePath) return null;
    try {
      await admin.storage().bucket().file(imagePath).delete();
    } catch (e) {
      return null;
    }
    return null;
  });

exports.cleanupInactiveGroups = functions.pubsub
  .schedule('every day 01:05')
  .timeZone('Europe/Rome')
  .onRun(async () => {
    const cutoff = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 60 * 60 * 1000)
    );
    const presenceCutoff = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 10 * 60 * 1000)
    );
    const groupsSnap = await db
      .collection('groupRooms')
      .where('updatedAt', '<', cutoff)
      .get();

    if (groupsSnap.empty) return null;

    const writer = db.bulkWriter();

    for (const groupDoc of groupsSnap.docs) {
      const groupRef = groupDoc.ref;

      const presenceSnap = await groupRef
        .collection('presence')
        .where('activeAt', '>', presenceCutoff)
        .limit(1)
        .get();
      if (!presenceSnap.empty) {
        continue;
      }

      const messagesSnap = await groupRef.collection('messages').get();
      messagesSnap.forEach((msg) => writer.delete(msg.ref));

      const liveMessagesSnap = await groupRef.collection('liveMessages').get();
      liveMessagesSnap.forEach((msg) => writer.delete(msg.ref));

      const threadsSnap = await groupRef.collection('privateThreads').get();
      for (const threadDoc of threadsSnap.docs) {
        const threadRef = threadDoc.ref;
        const threadMessagesSnap = await threadRef.collection('messages').get();
        threadMessagesSnap.forEach((msg) => writer.delete(msg.ref));
        writer.delete(threadRef);
      }

      const presenceDocsSnap = await groupRef.collection('presence').get();
      presenceDocsSnap.forEach((presenceDoc) => writer.delete(presenceDoc.ref));

      const livePresenceSnap = await groupRef.collection('livePresence').get();
      livePresenceSnap.forEach((presenceDoc) => writer.delete(presenceDoc.ref));

      writer.delete(groupRef);
    }

    await writer.close();
    return null;
  });

exports.syncGroupPresenceCount = functions.firestore
  .document('groupRooms/{groupId}/presence/{userId}')
  .onWrite(async (change, context) => {
    const groupRef = db.doc(`groupRooms/${context.params.groupId}`);
    const cutoff = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - PRESENCE_ACTIVE_MS)
    );
    try {
      const presenceSnap = await groupRef
        .collection('presence')
        .where('activeAt', '>', cutoff)
        .get();
      await groupRef.set(
        {
          membersCount: presenceSnap.size,
          membersUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error('syncGroupPresenceCount error', e);
    }
    return null;
  });

exports.startGroupLive = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'auth-required');
  }
  const groupId = data?.groupId;
  if (!groupId || typeof groupId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'missing-group-id');
  }

  const userId = context.auth.uid;
  const allowed = await hasActivePresence(groupId, userId);
  if (!allowed) {
    throw new functions.https.HttpsError('permission-denied', 'not-in-group');
  }

  const profile = await getProfileSnapshot(userId);
  const hostName =
    profile.name ||
    (typeof context.auth.token?.name === 'string' ? context.auth.token.name : '') ||
    'Utente';
  const hostPhoto =
    profile.photo ||
    (typeof context.auth.token?.picture === 'string'
      ? context.auth.token.picture
      : '');

  const groupRef = db.doc(`groupRooms/${groupId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'group-not-found');
    }
    const live = snap.data()?.live || {};
    const liveUpdate = {
      active: true,
      hostId: userId,
      hostName,
      hostPhoto,
    };
    if (!live.active || !live.startedAt) {
      liveUpdate.startedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.set(
      groupRef,
      {
        live: liveUpdate,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { ok: true };
});

exports.stopGroupLive = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'auth-required');
  }
  const groupId = data?.groupId;
  if (!groupId || typeof groupId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'missing-group-id');
  }
  const userId = context.auth.uid;

  const groupRef = db.doc(`groupRooms/${groupId}`);
  const snap = await groupRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'group-not-found');
  }
  const live = snap.data()?.live;
  if (!live?.active) {
    throw new functions.https.HttpsError('failed-precondition', 'live-not-active');
  }

  const isHost = await hasActiveLiveHostPresence(groupId, userId);
  if (!isHost) {
    throw new functions.https.HttpsError('permission-denied', 'not-live-host');
  }

  const otherHosts = await getActiveLiveHosts(groupRef, userId);
  if (otherHosts.length > 0) {
    return { ok: true };
  }

  await groupRef.set(
    {
      live: {
        active: false,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
});

exports.getGroupLiveToken = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'auth-required');
  }
  const groupId = data?.groupId;
  const role = data?.role === 'host' ? 'host' : 'viewer';
  if (!groupId || typeof groupId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'missing-group-id');
  }

  const userId = context.auth.uid;
  const allowed = await hasActivePresence(groupId, userId);
  if (!allowed) {
    throw new functions.https.HttpsError('permission-denied', 'not-in-group');
  }

  const groupRef = db.doc(`groupRooms/${groupId}`);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'group-not-found');
  }
  const live = groupSnap.data()?.live;
  if (!live?.active) {
    throw new functions.https.HttpsError('failed-precondition', 'live-not-active');
  }
  if (role === 'viewer') {
    const activeHosts = await getActiveLiveHosts(groupRef);
    if (activeHosts.length === 0) {
      await db
        .doc(`groupRooms/${groupId}`)
        .set(
          {
            live: {
              active: false,
              endedAt: admin.firestore.FieldValue.serverTimestamp(),
              endedReason: 'stale',
            },
          },
          { merge: true }
        );
      throw new functions.https.HttpsError('failed-precondition', 'live-not-active');
    }
  }

  const profile = await getProfileSnapshot(userId);
  const identityName =
    profile.name ||
    (typeof context.auth.token?.name === 'string' ? context.auth.token.name : '') ||
    userId;

  const { apiKey, apiSecret, url } = assertLivekitConfig();
  console.log('livekit-config', {
    url,
    apiKey: maskValue(apiKey),
    hasSecret: !!apiSecret,
    groupId,
    role,
    userId,
  });
  const token = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    name: identityName,
  });
  token.addGrant({
    roomJoin: true,
    room: groupId,
    canPublish: role === 'host',
    canSubscribe: true,
  });

  const jwt = await token.toJwt();
  try {
    const [headerRaw, payloadRaw] = jwt.split('.');
    const header = decodeJwtPart(headerRaw);
    const payload = decodeJwtPart(payloadRaw);
    console.log('livekit-token', {
      alg: header?.alg,
      typ: header?.typ,
      iss: payload?.iss,
      sub: payload?.sub,
      name: payload?.name,
      room: payload?.video?.room,
      grants: payload?.video,
    });
  } catch (e) {
    console.log('livekit-token-parse-failed', {
      error: e?.message || String(e),
      meta: describeJwt(jwt),
    });
  }

  return { token: jwt, url };
});

exports.cleanupStaleLives = functions.pubsub
  .schedule('every 10 minutes')
  .timeZone('Europe/Rome')
  .onRun(async () => {
    const liveSnap = await db
      .collection('groupRooms')
      .where('live.active', '==', true)
      .get();
    if (liveSnap.empty) return null;

    const updates = [];
    for (const docSnap of liveSnap.docs) {
      const data = docSnap.data() || {};
      const live = data.live || {};
      if (!live.active) continue;
      const activeHosts = await getActiveLiveHosts(docSnap.ref);
      if (activeHosts.length === 0) {
        updates.push(
          docSnap.ref.set(
            {
              live: {
                active: false,
                endedAt: admin.firestore.FieldValue.serverTimestamp(),
                endedReason: 'stale',
              },
            },
            { merge: true }
          )
        );
      }
    }

    await Promise.all(updates);
    return null;
  });
