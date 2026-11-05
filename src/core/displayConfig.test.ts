import { describe, expect, it } from 'vitest';
import { ARROW_MAX, ARROW_SPACING_PX, arrowIndicesBySpacing, metersPerPixel, trackBounds } from './displayConfig';

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

describe('metersPerPixel', () => {
  it('au zoom 0, l’équateur sur 256 px ; moitié moins par cran', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543.03, 1);
    expect(metersPerPixel(15, 43.6)).toBeCloseTo(3.46, 2);
    expect(metersPerPixel(15, 0)).toBeCloseTo(metersPerPixel(14, 0) / 2, 6);
    expect(metersPerPixel(10, 60)).toBeCloseTo(metersPerPixel(10, 0) / 2, 6);
  });
});

describe('arrowIndicesBySpacing', () => {
  const T0 = 1_791_000_000_000;
  const LAT = 43.6;
  const M_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);
  /** Ligne droite vers l'est à `speedMs`, `durationS` secondes à `rateHz`. */
  const line = (durationS: number, rateHz: number, speedMs = 5) =>
    Array.from({ length: durationS * rateHz + 1 }, (_, i) => ({
      lat: LAT, lon: 3.8 + (speedMs * (i / rateHz)) / M_PER_DEG_LON, timeMs: T0 + (i * 1000) / rateHz,
    }));

  it('ligne droite : une flèche tous les `spacingM` mètres, sans dérive', () => {
    // 600 s à 5 m/s : 3 000 m ; une flèche au premier point passé 99,5 m, 199 m… (pas de 5 m).
    const track = line(600, 1);
    const indices = arrowIndicesBySpacing(track, 99.5, ARROW_MAX);
    expect(indices).toHaveLength(30);
    expect(indices.slice(0, 3)).toEqual([20, 40, 60]);
    expect(indices[29]).toBeGreaterThanOrEqual(597);
    expect(indices[29]).toBeLessThanOrEqual(598);
  });

  it('à 1 Hz et à 5 Hz, les mêmes flèches, à un pas près', () => {
    const at = (rateHz: number) => {
      const track = line(600, rateHz);
      return arrowIndicesBySpacing(track, 99.5, ARROW_MAX).map((i) => track[i].timeMs);
    };
    const one = at(1);
    const five = at(5);
    expect(one).toHaveLength(30);
    expect(five).toHaveLength(one.length);
    five.forEach((ms, k) => expect(Math.abs(ms - one[k])).toBeLessThanOrEqual(1000));
  });

  it('plus de flèches en zoomant, moins en dézoomant', () => {
    const track = line(600, 1);
    const count = (zoom: number) => arrowIndicesBySpacing(track, ARROW_SPACING_PX * metersPerPixel(zoom, LAT), ARROW_MAX).length;
    expect(count(16)).toBeGreaterThan(count(15));
    expect(count(15)).toBeGreaterThan(count(14));
  });

  it('une reprise de pause repart de son point, sans flèche sur le pas qui l’enjambe', () => {
    const track: { lat: number; lon: number; segmentStart?: true }[] = line(30, 1).map(({ lat, lon }) => ({ lat, lon }));
    // Reprise à 10 s, 1 km plus loin : sans elle, une flèche s'y poserait.
    const jump = 1000 / M_PER_DEG_LON;
    for (let i = 10; i < track.length; i++) track[i] = { ...track[i], lon: track[i].lon + jump };
    track[10] = { ...track[10], segmentStart: true };
    expect(arrowIndicesBySpacing(track, 93, ARROW_MAX)).toEqual([29]);
  });

  it('plafond : des flèches également réparties, pas plus de `maxCount`', () => {
    const track = line(600, 1);
    // Une flèche tous les 9,5 m, plus de 300 en tout : 100 gardées, jusqu'au bout de la trace.
    const indices = arrowIndicesBySpacing(track, 9.5, 100);
    expect(indices).toHaveLength(100);
    expect(indices[indices.length - 1]).toBeGreaterThan(580);
  });

  it('aucune flèche sans trace, sans écart ou sans plafond', () => {
    expect(arrowIndicesBySpacing([], 100, ARROW_MAX)).toEqual([]);
    expect(arrowIndicesBySpacing(line(10, 1).slice(0, 1), 100, ARROW_MAX)).toEqual([]);
    expect(arrowIndicesBySpacing(line(100, 1), 0, ARROW_MAX)).toEqual([]);
    expect(arrowIndicesBySpacing(line(100, 1), 100, 0)).toEqual([]);
  });
});
