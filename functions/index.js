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
  const moderationUpdate = {
    moderationStatus: flagged ? 'flagged' : 'ok',
    contentWarning: flagged ? 'nudity' : null,
    moderation: {
      adult: safe.adult || 'UNKNOWN',
      racy: safe.racy || 'UNKNOWN',
      medical: safe.medical || 'UNKNOWN',
      spoof: safe.spoof || 'UNKNOWN',
      violence: safe.violence || 'UNKNOWN',
    },
    moderationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

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
