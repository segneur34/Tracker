import { describe, expect, it } from 'vitest';
import { clamp, isFiniteNumber, isObject, plural } from './basics';

describe('basics', () => {
  it('borne une valeur', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('reconnaît un objet simple', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('a')).toBe(false);
  });

  it('reconnaît un nombre fini', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber('1')).toBe(false);
  });

  it('accorde le pluriel', () => {
    expect(plural(0, 'fichier')).toBe('0 fichier');
    expect(plural(1, 'fichier')).toBe('1 fichier');
    expect(plural(2, 'fichier')).toBe('2 fichiers');
  });
});
