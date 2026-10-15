import { describe, expect, it } from 'vitest';
import { ARROW_EVERY_S, arrowIndices, trackBounds } from './displayConfig';

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

describe('arrowIndices', () => {
  const T0 = 1_791_000_000_000;
  /** Instants d'une trace régulière de `durationS` secondes à `rateHz`. */
  const regular = (durationS: number, rateHz: number) =>
    Array.from({ length: durationS * rateHz + 1 }, (_, i) => ({ timeMs: T0 + (i * 1000) / rateHz }));

  it('à 1 Hz, les mêmes points que « un point sur 40 »', () => {
    const track = regular(600, 1);
    const byCount = track.map((_, i) => i).filter((i) => i % 40 === 0 && i !== 0);
    expect(arrowIndices(track, ARROW_EVERY_S)).toEqual(byCount);
  });

  it('à 1 Hz et à 5 Hz, les flèches aux mêmes instants', () => {
    const at = (rateHz: number) => {
      const track = regular(600, rateHz);
      return arrowIndices(track, ARROW_EVERY_S).map((i) => track[i].timeMs);
    };
    expect(at(5)).toEqual(at(1));
    expect(at(1)).toHaveLength(15);
  });

  it('une seule flèche après un trou plus long que l’écart', () => {
    const track = [0, 10, 20, 150, 155, 190].map((s) => ({ timeMs: T0 + s * 1000 }));
    expect(arrowIndices(track, 40)).toEqual([3, 5]);
  });

  it('aucune flèche sans trace ou sans écart', () => {
    expect(arrowIndices([], 40)).toEqual([]);
    expect(arrowIndices(regular(100, 1), 0)).toEqual([]);
  });
});
