import { IMAGE_MAX_BYTES, type ImageUpload } from '@clinic/shared';
import { badRequest } from './errors';

const SIGNATURES: Record<ImageUpload['contentType'], number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};
export const IMAGE_EXT: Record<ImageUpload['contentType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** Decodes an upload and checks the bytes really are the declared image type. */
export function decodeImage(upload: ImageUpload): Buffer {
  const data = Buffer.from(upload.data, 'base64');
  if (data.length === 0 || data.length > IMAGE_MAX_BYTES)
    throw badRequest('The image must be 512 KB or smaller');
  if (!SIGNATURES[upload.contentType].every((byte, i) => data[i] === byte)) {
    throw badRequest('The file is not a valid PNG or JPEG image');
  }
  return data;
}

export const contentTypeForKey = (key: string) =>
  key.endsWith('.png') ? 'image/png' : 'image/jpeg';
