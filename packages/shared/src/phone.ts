const PH_MOBILE = /^(?:\+?63|0)(9\d{9})$/;

/** Normalizes a Philippine mobile number to E.164 (+639XXXXXXXXX), or returns null if invalid. */
export function normalizePhMobile(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, '');
  const match = PH_MOBILE.exec(compact);
  return match ? `+63${match[1]}` : null;
}

/** Formats +639171234567 as 0917 123 4567 for display. */
export function formatPhMobile(e164: string): string {
  const match = /^\+63(9\d{2})(\d{3})(\d{4})$/.exec(e164);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : e164;
}
