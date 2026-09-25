import { describe, expect, it } from 'vitest';
import { trackBounds } from './displayConfig';

describe('trackBounds', () => {
  it('englobe tous les points', () => {
    const bounds = trackBounds([
      { lat: 43.6, lon: 3.9 },
      { lat: 43.5, lon: 3.95 },
      { lat: 43.62, lon: 3.8 },
    ]);
    expect(bounds).toEqual([[43.5, 3.8], [43.62, 3.95]]);
  });

  it('rend null sans point exploitable', () => {
    expect(trackBounds([])).toBeNull();
    expect(trackBounds([{ lat: NaN, lon: 3 }])).toBeNull();
  });

  it('ignore les coordonnées non finies', () => {
    expect(trackBounds([{ lat: 43, lon: 3 }, { lat: Infinity, lon: 4 }])).toEqual([[43, 3], [43, 3]]);
  });
});
