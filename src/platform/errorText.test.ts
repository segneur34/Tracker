import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DENIED_TEXT, LOCATION_DENIED_TEXT, UNKNOWN_ERROR_TEXT, fileErrorCode, plainError } from './errorText';
import { locationErrorText } from './location';

const withCode = (message: string, code: string): Error => Object.assign(new Error(message), { code });
const domException = (name: string): Error => Object.assign(new Error('x'), { name });

describe('plainError (lot 158)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('traduit les codes des greffons', () => {
    expect(plainError(withCode('boom', 'NOT_AUTHORIZED'))).toBe(DENIED_TEXT);
    expect(plainError(withCode('boom', 'PERMISSION'))).toBe(DENIED_TEXT);
    expect(plainError(withCode('boom', 'NOT_FOUND'))).toMatch(/introuvable/);
    expect(plainError(withCode('boom', 'NO_SPACE'))).toMatch(/place/);
    expect(plainError(withCode('boom', 'TOO_LARGE'))).toMatch(/volumineux/);
  });

  it('traduit les noms de DOMException', () => {
    expect(plainError(domException('QuotaExceededError'))).toMatch(/place/);
    expect(plainError(domException('NotAllowedError'))).toBe(DENIED_TEXT);
  });

  it('reconnaît les messages techniques d’Android', () => {
    expect(plainError(new Error('Missing file for primary:Documents/Tracker'))).toMatch(/introuvable/);
    expect(plainError(new Error('write failed: ENOSPC (No space left on device)'))).toMatch(/place/);
    expect(plainError(new Error('Failed to fetch'))).toMatch(/Réseau/);
  });

  it('garde une phrase française de l’application telle quelle', () => {
    expect(plainError(new Error('Écriture impossible : disque plein'))).toBe('Écriture impossible : disque plein');
  });

  it('ne recolle pas un texte technique inconnu : préfixe français, sinon repli, détail en console', () => {
    const warn = vi.spyOn(console, 'warn');
    expect(plainError(new Error('Lecture impossible : java.lang.IllegalStateException: boom'), 'repli')).toBe('Lecture impossible.');
    expect(plainError(new Error('Unexpected token < in JSON'), 'repli')).toBe('repli');
    expect(plainError(new Error('Unexpected token < in JSON'))).toBe(UNKNOWN_ERROR_TEXT);
    expect(warn).toHaveBeenCalled();
  });

  it('prend le repli pour ce qui n’est pas une erreur', () => {
    expect(plainError('texte', 'repli')).toBe('repli');
    expect(fileErrorCode('texte')).toBe('UNKNOWN');
  });
});

describe('locationErrorText', () => {
  it('dit où réactiver la localisation au premier refus', () => {
    expect(locationErrorText({ message: 'User denied location permission', code: 'NOT_AUTHORIZED' })).toBe(LOCATION_DENIED_TEXT);
    expect(locationErrorText({ message: 'User denied location permission' })).toBe(LOCATION_DENIED_TEXT);
  });
});
