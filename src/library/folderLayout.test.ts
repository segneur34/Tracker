import { describe, expect, it } from 'vitest';
import { MEMORY_FORMAT, MEMORY_VERSION, markerText, readMarkerVersion } from './folderLayout';

describe('readMarkerVersion (lot 148, C5-9)', () => {
  it('relit le marqueur écrit', () => {
    expect(readMarkerVersion(markerText())).toBe(MEMORY_VERSION);
  });

  it('rend une version plus récente telle quelle', () => {
    expect(readMarkerVersion(JSON.stringify({ format: MEMORY_FORMAT, version: 7, futur: true }))).toBe(7);
  });

  it('absent, illisible, vide ou d\'un autre format : version 1', () => {
    for (const text of [null, '', '{ cassé', '[]', '3', JSON.stringify({ format: 'autre', version: 7 }), JSON.stringify({ format: MEMORY_FORMAT, version: '7' }), JSON.stringify({ format: MEMORY_FORMAT })]) {
      expect(readMarkerVersion(text)).toBe(1);
    }
  });
});
