const admin = require('firebase-admin');
const functions = require('firebase-functions');
const vision = require('@google-cloud/vision');

admin.initializeApp();

const db = admin.firestore();
const visionClient = new vision.ImageAnnotatorClient();
const NUDITY_LEVELS = new Set(['POSSIBLE', 'LIKELY', 'VERY_LIKELY']);

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
