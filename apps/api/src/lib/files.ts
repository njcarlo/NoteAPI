import { LAB_RESULT_MAX_BYTES, type LabResultUpload } from '@clinic/shared';
import { badRequest } from './errors';

const SIGNATURES: Record<LabResultUpload['contentType'], number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};
export const RESULT_EXT: Record<LabResultUpload['contentType'], string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** Decodes a result upload and checks the bytes really are the declared type. */
export function decodeLabResult(upload: LabResultUpload): Buffer {
  const data = Buffer.from(upload.data, 'base64');
  if (data.length === 0 || data.length > LAB_RESULT_MAX_BYTES)
    throw badRequest('The file must be 5 MB or smaller');
  if (!SIGNATURES[upload.contentType].every((byte, i) => data[i] === byte))
    throw badRequest('The file is not a valid PDF, PNG or JPEG');
  return data;
}

/** A file name safe for a Content-Disposition header (the original is kept in the database). */
export const safeFileName = (name: string) =>
  name.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'result';
