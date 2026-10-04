import { createHmac } from 'node:crypto';
import { env } from '../config/env';
import { safeEqual } from './crypto';

const mac = (purpose: string, id: string) =>
  createHmac('sha256', env.TOKEN_SECRET).update(`${purpose}:${id}`).digest();

/**
 * Cancel-link token for an appointment: 128 bits derived from the server secret, so reminders can
 * include the link again without storing it. Only its SHA-256 is kept in the database.
 */
export const cancelTokenFor = (appointmentId: string) =>
  mac('cancel', appointmentId).subarray(0, 16).toString('base64url');

const uuidToBytes = (uuid: string) => Buffer.from(uuid.replace(/-/g, ''), 'hex');
const bytesToUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Opt-out token: the patient id plus a 64-bit signature (32 characters). */
export function optOutTokenFor(patientId: string): string {
  return Buffer.concat([uuidToBytes(patientId), mac('optout', patientId).subarray(0, 8)]).toString(
    'base64url',
  );
}

/** The patient id in a valid opt-out token, or null. */
export function patientFromOptOutToken(token: string): string | null {
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== 24) return null;
  const patientId = bytesToUuid(raw.subarray(0, 16));
  const expected = mac('optout', patientId).subarray(0, 8).toString('base64url');
  return safeEqual(raw.subarray(16).toString('base64url'), expected) ? patientId : null;
}
