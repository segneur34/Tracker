import { describe, expect, it } from 'vitest';
import { TRACK_COLOR_SMOOTHING_S, coloredSegments, trackColorSegments, trackColorSpeedsMs } from './trackColor';
import type { TrackPoint } from './types';

/** Trace vers l'est, `hz` points par seconde, à la vitesse de chaque phase (`[durée en s, vitesse en m/s]`). */
const buildTrack = (phases: [number, number][], hz = 1): TrackPoint[] => {
  const startMs = Date.parse('2026-01-01T10:00:00Z');
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
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
