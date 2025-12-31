import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getDownloadURL, ref, uploadBytes, uploadString } from 'firebase/storage';
import { Platform } from 'react-native';

import { auth, storage } from '@/lib/firebase';

const base64Encoding = (FileSystem as any).EncodingType?.Base64 || 'base64';

type UploadMetadata = Record<string, string>;

type UploadOptions = {
  uri: string;
  path: string;
  mime?: string;
  metadata?: UploadMetadata;
};

type UploadResult = {
  url: string;
  path: string;
};

const inferMimeFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,/i);
  const mime = match?.[1];
  if (!mime || mime === 'image') return 'image/jpeg';
  return mime;
};

const inferMimeFromUri = (uri: string) => {
  const clean = uri.split('?')[0]?.toLowerCase();
  if (!clean) return undefined;
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.heic') || clean.endsWith('.heif')) return 'image/heic';
  return undefined;
};

const buildDataUrl = async (uri: string, mime?: string) => {
  if (uri.startsWith('data:')) {
    const resolvedMime = mime ?? inferMimeFromDataUrl(uri) ?? 'image/jpeg';
    return { dataUrl: uri, mime: resolvedMime };
  }

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: base64Encoding });
  const safeMime = mime ?? inferMimeFromUri(uri) ?? 'image/jpeg';
  return { dataUrl: `data:${safeMime};base64,${base64}`, mime: safeMime };
};

const writeDataUrlToCache = async (dataUrl: string, mime?: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/i);
  if (!match) {
    return { uri: dataUrl, cleanup: false };
  }
  const resolvedMime = mime ?? match[1] ?? 'image/jpeg';
  const base64Payload = match[2];
  const extension = resolvedMime.split('/')[1] || 'jpg';
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error('No cache directory available for image upload.');
  }
  const tempUri = `${baseDir}upload-${Date.now()}.${extension}`;
  await FileSystem.writeAsStringAsync(tempUri, base64Payload, { encoding: base64Encoding });
  return { uri: tempUri, cleanup: true };
};

const writeImageToCache = async (uri: string, mime?: string) => {
  if (uri.startsWith('file://')) {
    return { uri, cleanup: false };
  }
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) {
    return { uri, cleanup: false };
  }
  if (uri.startsWith('ph://') || uri.startsWith('assets-library://')) {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [],
      { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
    );
    return { uri: result.uri, cleanup: true };
  }
  if (uri.startsWith('content://')) {
    const extension = (mime ?? inferMimeFromUri(uri) ?? 'image/jpeg').split('/')[1] || 'jpg';
    const tempUri = `${baseDir}upload-${Date.now()}.${extension}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: tempUri });
      return { uri: tempUri, cleanup: true };
    } catch (e) {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      return { uri: result.uri, cleanup: true };
    }
  }
  return { uri, cleanup: false };
};

export async function uploadImageToStorage(options: UploadOptions): Promise<UploadResult> {
  const { uri, path, mime, metadata } = options;
  const storageRef = ref(storage, path);
  const isDataUrl = uri.startsWith('data:');

  if (Platform.OS === 'web') {
    if (isDataUrl) {
      const { dataUrl, mime: resolvedMime } = await buildDataUrl(uri, mime);
      await uploadString(storageRef, dataUrl, 'data_url', {
        contentType: resolvedMime,
        customMetadata: metadata,
      });
    } else {
      const response = await fetch(uri);
      const blob = await response.blob();
      const contentType =
        mime ?? (blob as any).type ?? inferMimeFromUri(uri) ?? 'image/jpeg';
      await uploadBytes(storageRef, blob, {
        contentType,
        customMetadata: metadata,
      });
    }
  } else {
    const { uri: uploadUri, cleanup } = isDataUrl
      ? await writeDataUrlToCache(uri, mime)
      : await writeImageToCache(uri, mime);
    const contentType = mime ?? inferMimeFromUri(uploadUri) ?? 'image/jpeg';
    const bucketFromConfig = storage.app.options.storageBucket;
    const projectId = storage.app.options.projectId;
    const candidates = [
      bucketFromConfig,
      projectId ? `${projectId}.appspot.com` : null,
      projectId ? `${projectId}.firebasestorage.app` : null,
    ].filter(Boolean) as string[];
    const bucketSet = new Set<string>(candidates);
    const bucketList = Array.from(bucketSet);
    if (!bucketList.length) {
      throw new Error('Storage bucket not configured.');
    }
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      throw new Error('User not authenticated for storage upload.');
    }

    const uploadType =
      (FileSystem as any).FileSystemUploadType?.BINARY_CONTENT ??
      (FileSystem as any).UploadType?.BINARY_CONTENT;

    let lastError: Error | null = null;
    for (const bucket of bucketList) {
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(path)}`;
      const result = await FileSystem.uploadAsync(uploadUrl, uploadUri, {
        httpMethod: 'POST',
        headers: {
          'Content-Type': contentType,
          Authorization: `Bearer ${token}`,
        },
        uploadType,
      });
      if (result.status >= 200 && result.status < 300) {
        if (cleanup) {
          await FileSystem.deleteAsync(uploadUri, { idempotent: true });
        }
        try {
          const payload = JSON.parse(result.body ?? '{}') as {
            name?: string;
            bucket?: string;
            downloadTokens?: string;
            metadata?: { firebaseStorageDownloadTokens?: string };
          };
          const objectName = payload.name ?? path;
          const tokenValue =
            payload.downloadTokens ??
            payload.metadata?.firebaseStorageDownloadTokens ??
            '';
          const downloadToken = tokenValue ? tokenValue.split(',')[0] : '';
          const encodedName = encodeURIComponent(objectName);
          const baseUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedName}?alt=media`;
          const url = downloadToken ? `${baseUrl}&token=${downloadToken}` : baseUrl;
          return { url, path: objectName };
        } catch (e) {
          const url = await getDownloadURL(ref(storage, `gs://${bucket}/${path}`));
          return { url, path };
        }
      }
      const err = new Error(`Storage upload failed (${result.status}): ${result.body}`);
      (err as any).status = result.status;
      lastError = err;
      if (result.status !== 404) break;
    }
    if (cleanup) {
      await FileSystem.deleteAsync(uploadUri, { idempotent: true });
    }
    throw lastError ?? new Error('Storage upload failed.');
  }

  const url = await getDownloadURL(storageRef);
  return { url, path };
}
