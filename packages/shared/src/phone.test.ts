import { describe, expect, it } from 'vitest';
import { formatPhMobile, normalizePhMobile } from './phone';

describe('normalizePhMobile', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['+639171234567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['0917 123 4567', '+639171234567'],
    ['0917-123-4567', '+639171234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhMobile(input)).toBe(expected);
  });

  it.each(['0817123456', '9171234567', '+6309171234567', '021234567', 'abc'])(
    'rejects %s',
    (input) => {
      expect(normalizePhMobile(input)).toBeNull();
    },
  );

  it('formats for display', () => {
    expect(formatPhMobile('+639171234567')).toBe('0917 123 4567');
  });
});
