import * as FileSystem from 'expo-file-system/legacy';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';

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
  return match?.[1];
};

const buildDataUrl = async (uri: string, mime?: string) => {
  if (uri.startsWith('data:')) {
    return { dataUrl: uri, mime: mime ?? inferMimeFromDataUrl(uri) ?? 'image/jpeg' };
  }

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: base64Encoding });
  const safeMime = mime ?? 'image/jpeg';
  return { dataUrl: `data:${safeMime};base64,${base64}`, mime: safeMime };
};

export async function uploadImageToStorage(options: UploadOptions): Promise<UploadResult> {
  const { uri, path, mime, metadata } = options;
  const { dataUrl, mime: resolvedMime } = await buildDataUrl(uri, mime);
  const storageRef = ref(storage, path);

  await uploadString(storageRef, dataUrl, 'data_url', {
    contentType: resolvedMime,
    customMetadata: metadata,
  });

  const url = await getDownloadURL(storageRef);
  return { url, path };
}
