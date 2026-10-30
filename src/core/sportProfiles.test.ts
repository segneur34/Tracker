import { describe, expect, it } from 'vitest';
import { isSportType } from './sportProfiles';

describe('isSportType', () => {
  it('ne reconnaît que les supports du profil', () => {
    expect(isSportType('wingfoil')).toBe(true);
    expect(isSportType('running')).toBe(true);
    expect(isSportType('toString')).toBe(false);
    expect(isSportType(42)).toBe(false);
  });
});
