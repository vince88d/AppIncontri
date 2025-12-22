import * as FileSystem from 'expo-file-system/legacy';
import { getDownloadURL, ref, uploadBytes, uploadString } from 'firebase/storage';
import { Platform } from 'react-native';

import { storage } from '@/lib/firebase';

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
    // Firebase web SDK cannot create blobs from ArrayBuffer in React Native.
    const { uri: uploadUri, cleanup } = isDataUrl
      ? await writeDataUrlToCache(uri, mime)
      : { uri, cleanup: false };
    const response = await fetch(uploadUri);
    const blob = await response.blob();
    const contentType =
      mime ?? (blob as any).type ?? inferMimeFromUri(uploadUri) ?? 'image/jpeg';
    await uploadBytes(storageRef, blob, {
      contentType,
      customMetadata: metadata,
    });
    if (cleanup) {
      await FileSystem.deleteAsync(uploadUri, { idempotent: true });
    }
  }

  const url = await getDownloadURL(storageRef);
  return { url, path };
}
