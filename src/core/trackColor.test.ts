import { describe, expect, it } from 'vitest';
import { TRACK_COLOR_SMOOTHING_S, coloredSegments, effectiveSpeedRange, pathsByColor, trackColorSegments, trackColorSpeedsMs } from './trackColor';
import type { TrackPoint } from './types';
import { mPerDegLon } from '../test/geo.fixture';

/** Trace vers l'est, `hz` points par seconde, à la vitesse de chaque phase (`[durée en s, vitesse en m/s]`). */
const buildTrack = (phases: [number, number][], hz = 1): TrackPoint[] => {
  const startMs = Date.parse('2026-01-01T10:00:00Z');
  const lat = 43.6;
  const metersPerDegLon = mPerDegLon(lat);
  const points: TrackPoint[] = [];
  let meters = 0;
  let t = 0;
  const push = (speedMs: number) => {
    const timeMs = startMs + Math.round(t * 1000);
    points.push({
      lat, lon: 3.8 + meters / metersPerDegLon, time: new Date(timeMs).toISOString(), timeMs,
      speedMs, smoothedSpeedMs: speedMs, bearing: 90, speedSource: 'derived',
    });
  };
  push(phases[0][1]);
  for (const [durationS, speedMs] of phases) {
    for (let i = 0; i < Math.round(durationS * hz); i++) {
      meters += speedMs / hz;
      t += 1 / hz;
      push(speedMs);
    }
  }
  return points;
};

/** Vitesse de couleur au point le plus proche de l'instant `s`, en secondes depuis le départ. */
const colorAt = (track: TrackPoint[], speeds: number[], s: number): number => {
  const target = track[0].timeMs + s * 1000;
  let best = 0;
  for (let i = 1; i < track.length; i++) if (Math.abs(track[i].timeMs - target) < Math.abs(track[best].timeMs - target)) best = i;
  return speeds[best];
};

describe('trackColorSpeedsMs', () => {
  it('garde en voile la vitesse lissée du noyau, sans moyenne de plus', () => {
    const track = buildTrack([[30, 2], [3, 10], [30, 2]]);
    expect(TRACK_COLOR_SMOOTHING_S.voile).toBe(0);
    expect(trackColorSpeedsMs(track, 'voile')).toEqual(track.map((p) => p.smoothedSpeedMs));
  });

  it('lisse à pied et à vélo sur 15 s : une pointe de 3 s s\'efface', () => {
    const track = buildTrack([[30, 2], [3, 10], [30, 2]]);
    for (const treatment of ['course', 'velo'] as const) {
      const speeds = trackColorSpeedsMs(track, treatment);
      const peak = colorAt(track, speeds, 31.5);
      expect(peak).toBeLessThan(5);
      expect(peak).toBeGreaterThan(2);
      // Loin de la pointe, la vitesse reste celle de la phase.
      expect(colorAt(track, speeds, 10)).toBeCloseTo(2, 6);
    }
  });

  it('donne la même couleur à 1 Hz et à 5 Hz (fenêtre en secondes)', () => {
    const phases: [number, number][] = [[60, 2], [20, 6], [60, 3]];
    const slow = buildTrack(phases, 1);
    const fast = buildTrack(phases, 5);
    const slowSpeeds = trackColorSpeedsMs(slow, 'course');
    const fastSpeeds = trackColorSpeedsMs(fast, 'course');
    for (const s of [5, 55, 62, 70, 85, 120]) {
      expect(colorAt(fast, fastSpeeds, s)).toBeCloseTo(colorAt(slow, slowSpeeds, s), 0);
    }
  });
});

describe('trackColorSegments', () => {
  it('trace un trait par paire de points, à la couleur du point d\'arrivée', () => {
    const track = buildTrack([[10, 2], [10, 8]]);
    const range = { minMs: 1, maxMs: 9 };
    const segments = trackColorSegments(track, 'voile', range);
    expect(segments).toHaveLength(track.length - 1);
    expect(segments[0].positions).toEqual([[track[0].lat, track[0].lon], [track[1].lat, track[1].lon]]);
    // Même résultat que les traits faits à la main depuis les vitesses de couleur.
    const speeds = trackColorSpeedsMs(track, 'voile');
    expect(segments).toEqual(coloredSegments(track.map((p, i) => ({ lat: p.lat, lon: p.lon, colorMs: speeds[i] })), range));
    expect(segments[0].color).not.toBe(segments[segments.length - 1].color);
  });

  it('ne trace rien sous deux points', () => {
    expect(trackColorSegments(buildTrack([[0, 2]]), 'course', { minMs: 1, maxMs: 4 })).toEqual([]);
  });
});

describe('pathsByColor', () => {
  const a: [number, number] = [43.6, 3.8];
  const b: [number, number] = [43.6, 3.81];
  const c: [number, number] = [43.61, 3.81];
  const d: [number, number] = [43.61, 3.82];

  it('regroupe les traits par couleur exacte, dans l\'ordre de première apparition', () => {
    const groups = pathsByColor([
      { positions: [a, b], color: '#ff0000' },
      { positions: [b, c], color: '#00ff00' },
      // Teinte voisine, pas arrondie vers la précédente.
      { positions: [c, d], color: '#ff0001' },
      { positions: [d, a], color: '#ff0000' },
    ]);
    expect(groups).toEqual([
      { color: '#ff0000', segments: [0, 3] },
      { color: '#00ff00', segments: [1] },
      { color: '#ff0001', segments: [2] },
    ]);
  });

  it('garde les traits de plusieurs points et écarte ceux de moins de deux points', () => {
    const groups = pathsByColor([
      { positions: [a, b, c], color: '#123456' },
      { positions: [d], color: '#123456' },
      { positions: [], color: '#abcdef' },
    ]);
    expect(groups).toEqual([{ color: '#123456', segments: [0] }]);
  });

  it('regroupe tranche par tranche, tranches dans l\'ordre de la trace', () => {
    const segments = ['#ff0000', '#00ff00', '#ff0000', '#00ff00', '#ff0000'].map((color) => ({ positions: [a, b], color }));
    // Trois tranches (deux, deux et un traits), puis deux (trois et deux).
    expect(pathsByColor(segments, 3)).toEqual([
      { color: '#ff0000', segments: [0] },
      { color: '#00ff00', segments: [1] },
      { color: '#ff0000', segments: [2] },
      { color: '#00ff00', segments: [3] },
      { color: '#ff0000', segments: [4] },
    ]);
    expect(pathsByColor(segments, 2)).toEqual([
      { color: '#ff0000', segments: [0, 2] },
      { color: '#00ff00', segments: [1] },
      { color: '#00ff00', segments: [3] },
      { color: '#ff0000', segments: [4] },
    ]);
  });

  it('ne perd aucun trait d\'une trace, à 1 Hz comme à 5 Hz', () => {
    const range = { minMs: 1, maxMs: 9 };
    for (const hz of [1, 5]) {
      const segments = trackColorSegments(buildTrack([[60, 2], [20, 6], [60, 8]], hz), 'course', range);
      for (const tranches of [1, 8]) {
        const groups = pathsByColor(segments, tranches);
        const chunk = Math.ceil(segments.length / tranches);
        const all = groups.flatMap((g) => g.segments);
        expect([...all].sort((x, y) => x - y)).toEqual(segments.map((_, i) => i));
        // Chaque trait dans le groupe de sa couleur, une tranche après l'autre.
        for (const g of groups) for (const i of g.segments) expect(segments[i].color).toBe(g.color);
        const order = groups.map((g) => Math.floor(g.segments[0] / chunk));
        expect(order).toEqual([...order].sort((x, y) => x - y));
      }
    }
  });
});

describe('effectiveSpeedRange : ordre des bornes de couleur (décision transverse)', () => {
  const session = { minMs: 1, maxMs: 2 };
  const activity = { minMs: 3, maxMs: 4 };
  const suggested = { minMs: 5, maxMs: 6 };
  const fallback = { minMs: 7, maxMs: 8 };

  it('celles de la trace priment sur tout', () => {
    expect(effectiveSpeedRange({ sessionRange: session, activityRange: activity, suggested, fallback })).toBe(session);
  });

  it("puis celles de l'activité, réglées ou pré-réglées, avant la suggestion de la voile", () => {
    expect(effectiveSpeedRange({ sessionRange: null, activityRange: activity, suggested, fallback })).toBe(activity);
  });

  it("en voile, la suggestion tirée de l'allure avant le défaut", () => {
    expect(effectiveSpeedRange({ sessionRange: null, activityRange: null, suggested, fallback })).toBe(suggested);
  });

  it("à pied, à vélo et en surf (pas de suggestion), le défaut de l'activité ou du calcul", () => {
    expect(effectiveSpeedRange({ sessionRange: null, activityRange: null, suggested: null, fallback })).toBe(fallback);
  });
});
