import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions';

describe('permissions', () => {
  it('keeps clinical data away from secretaries', () => {
    expect(hasPermission(['secretary'], 'clinical:read')).toBe(false);
    expect(hasPermission(['secretary'], 'prescriptions:read')).toBe(false);
    expect(hasPermission(['secretary'], 'vitals:write')).toBe(true);
  });

  it('unions permissions across roles', () => {
    expect(hasPermission(['doctor', 'admin'], 'staff:manage')).toBe(true);
    expect(hasPermission(['doctor', 'admin'], 'prescriptions:write')).toBe(true);
  });
});
