import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

describe('base64', () => {
  it("fait l'aller et retour, au-delà d'une tranche", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31 + 7) % 256);
    const text = bytesToBase64(bytes);
    expect(text.slice(0, 8)).toBe('ByZFZIOi');
    expect(base64ToBytes(text)).toEqual(bytes);
  });

  it('rend un tableau vide pour un texte vide', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('').length).toBe(0);
  });
});
