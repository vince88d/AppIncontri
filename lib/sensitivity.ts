import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';

type SensitivityResult = {
  sensitive: boolean;
  score: number;
};

const SAMPLE_SIZE = 64;
const SKIN_RATIO_THRESHOLD = 0.35;
const MIN_SAMPLED_PIXELS = 120;

const buildDataUrl = (base64: string, mime: string) => `data:${mime};base64,${base64}`;

const isSkinTone = (r: number, g: number, b: number) => {
  if (r < 60 || g < 40 || b < 20) return false;
  if (r <= g || r <= b) return false;
  const cb = 128 - 0.168736 * r - 0.331364 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
};

const analyzePixels = (data: Uint8Array | Uint8ClampedArray) => {
  let skinPixels = 0;
  let sampledPixels = 0;

  for (let i = 0; i < data.length; i += 8) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 20) continue;
    sampledPixels += 1;
    if (isSkinTone(r, g, b)) {
      skinPixels += 1;
    }
  }

  const ratio = sampledPixels ? skinPixels / sampledPixels : 0;
  return { ratio, sampledPixels };
};

const analyzeNativeImage = async (uri: string): Promise<SensitivityResult> => {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: SAMPLE_SIZE } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  if (!result.base64) {
    return { sensitive: false, score: 0 };
  }
  const decoded = jpeg.decode(Buffer.from(result.base64, 'base64'), { useTArray: true });
  if (!decoded?.data) {
    return { sensitive: false, score: 0 };
  }
  const { ratio, sampledPixels } = analyzePixels(decoded.data);
  const sensitive = sampledPixels >= MIN_SAMPLED_PIXELS && ratio >= SKIN_RATIO_THRESHOLD;
  return { sensitive, score: ratio };
};

const analyzeWebImage = async (dataUrl: string): Promise<SensitivityResult> =>
  new Promise((resolve) => {
    const doc = (globalThis as any)?.document;
    const ImageCtor = (globalThis as any)?.Image;
    if (!doc || !ImageCtor) {
      resolve({ sensitive: false, score: 0 });
      return;
    }
    const img = new ImageCtor();
    img.onload = () => {
      const canvas = doc.createElement('canvas');
      const scale = SAMPLE_SIZE / Math.max(img.width, img.height);
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ sensitive: false, score: 0 });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const { ratio, sampledPixels } = analyzePixels(data);
      const sensitive = sampledPixels >= MIN_SAMPLED_PIXELS && ratio >= SKIN_RATIO_THRESHOLD;
      resolve({ sensitive, score: ratio });
    };
    img.onerror = () => resolve({ sensitive: false, score: 0 });
    img.src = dataUrl;
  });

export const analyzeImageSensitivity = async (params: {
  uri: string;
  base64?: string;
  mime?: string;
}): Promise<SensitivityResult> => {
  try {
    if (Platform.OS === 'web') {
      const dataUrl = params.base64
        ? buildDataUrl(params.base64, params.mime ?? 'image/jpeg')
        : params.uri;
      if (
        !dataUrl.startsWith('data:') &&
        !dataUrl.startsWith('http') &&
        !dataUrl.startsWith('blob:')
      ) {
        return { sensitive: false, score: 0 };
      }
      return await analyzeWebImage(dataUrl);
    }
    if (!params.uri) {
      return { sensitive: false, score: 0 };
    }
    return await analyzeNativeImage(params.uri);
  } catch (e) {
    return { sensitive: false, score: 0 };
  }
};
