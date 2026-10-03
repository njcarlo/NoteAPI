import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Short, unambiguous booking reference like "K7Q-M2XP". */
export function referenceCode(): string {
  const chars = Array.from({ length: 7 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`;
}
