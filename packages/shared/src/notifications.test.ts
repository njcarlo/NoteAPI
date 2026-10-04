import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  smsSegments,
  unknownVariables,
  usedVariables,
} from './notifications';

describe('notification templates', () => {
  it('renders known placeholders and blanks missing ones', () => {
    expect(
      renderTemplate('Hi {{firstName}}, ref {{ referenceCode }}{{rxLink}}', {
        firstName: 'Ana',
        referenceCode: 'ABC-1234',
      }),
    ).toBe('Hi Ana, ref ABC-1234');
  });

  it('rejects placeholders that could leak clinical details', () => {
    expect(unknownVariables('Hi {{firstName}}, about your {{reason}} and {{diagnosis}}')).toEqual([
      'reason',
      'diagnosis',
    ]);
  });

  it('ships defaults that only use allowed variables', () => {
    for (const channels of Object.values(DEFAULT_TEMPLATES)) {
      for (const { subject, body } of Object.values(channels)) {
        expect(unknownVariables(`${subject ?? ''} ${body}`)).toEqual([]);
      }
    }
    expect(usedVariables(DEFAULT_TEMPLATES['visit.finished'].sms.body)).toContain('rxLink');
  });

  it('counts SMS segments', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('ñ'.repeat(100))).toBe(1);
    expect(smsSegments('₱'.repeat(71))).toBe(2);
  });
});
