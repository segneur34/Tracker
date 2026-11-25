import { describe, expect, it } from 'vitest';
import { heartRateStats, smoothHeartRate } from '../core/heartRate';
import { resumeKinematics, type KinematicsRun } from '../core/kinematics';
import {
  buildCumulativeTrack, computeActiveDistanceM, computeActiveTimeMs, computeActivityMask, segmentDistanceM, thresholdMaskOptions,
} from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { bestWindowSpeedMs } from '../core/topSegments';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import type { LocationFix } from '../platform/location';
import { sameData } from '../test/sameData';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import { splitLiveLegs } from './liveLegs';
import { computeSegmentParts, type SegmentMemory, type SegmentSettings } from './liveSegment';

const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);
const wing = SPORT_PROFILES.wingfoil;

/** Segment de voile à `hz` : virements toutes les 90 s, passages lents sous le seuil, trou de 25 s, FC par moments. */
const segment = (hz: number, seconds: number): LocationFix[] => {
  const fixes: LocationFix[] = [];
  let lat = 43.5;
  let lon = 3.9;
  const lonM = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  for (let k = 0; k <= seconds * hz; k++) {
    const t = k / hz;
    const heading = Math.floor(t / 90) % 2 === 0 ? 40 : 320;
    const speed = Math.floor(t / 200) % 3 === 2 ? 1.5 + Math.sin(t / 5) : 7 + Math.sin(t / 9);
    if (k > 0) {
      lat += (speed / hz) * Math.cos((heading * Math.PI) / 180) / M_PER_DEG_LAT;
      lon += (speed / hz) * Math.sin((heading * Math.PI) / 180) / lonM;
    }
    if (t >= 250 && t < 275) continue;
    fixes.push({ timeMs: T0 + t * 1000, lat, lon, speedMs: speed, ...(t % 300 < 200 ? { heartRateBpm: 120 + Math.round(t % 17) } : {}) });
  }
  return fixes;
};

const rawOf = (fix: LocationFix): RawTrackPoint => {
  const time = new Date(fix.timeMs);
  return { lat: fix.lat, lon: fix.lon, time, rawTimeMs: time.getTime(), speedMs: fix.speedMs };
};

/** L'apport d'un segment refait à partir des calculs entiers, sans rien garder. */
const fromScratch = (fixes: LocationFix[], track: TrackPoint[], settings: SegmentSettings) => {
  let distanceM = 0;
  for (let i = 1; i < track.length; i++) distanceM += segmentDistanceM(track, i);
  const mask = settings.mask ? computeActivityMask(track, settings.mask) : null;
  const points = fixes.map((f) => ({ timeMs: f.timeMs, hr: f.heartRateBpm }));
  const stats = heartRateStats(points, smoothHeartRate(points, settings.heartRate.smoothS, settings.heartRate.gapS), settings.heartRate.gapS);
  return {
    cum: buildCumulativeTrack(track),
    distanceM,
    movingTimeMs: track[track.length - 1].timeMs - track[0].timeMs,
    active: mask ? { distanceM: computeActiveDistanceM(track, mask), timeMs: computeActiveTimeMs(track, mask) } : null,
    heart: stats === null ? null : { sum: stats.avgBpm * stats.coveredS, coveredS: stats.coveredS },
    maxSpeedMs: bestWindowSpeedMs(track, buildCumulativeTrack(track), settings.maxDurationS),
    legs: settings.sailing ? splitLiveLegs(track) : null,
  };
};

describe('computeSegmentParts', () => {
  for (const hz of [1, 5]) {
    it(`repris d'un appel à l'autre, donne les calculs entiers, à ${hz} Hz`, () => {
      const fixes = segment(hz, 900);
      const raw = fixes.map(rawOf);
      const settings: SegmentSettings = { mask: thresholdMaskOptions(wing, 8), maxDurationS: 2, heartRate: wing.heartRate, sailing: true };
      const kinematicsOptions = { medianWindowSeconds: wing.medianWindowSeconds, maxSpeedMs: wing.maxPlausibleSpeedMs, maxGapS: wing.maxGapS };
      let run: KinematicsRun | null = null;
      let memory: SegmentMemory | null = null;
      let kept = 0;
      let calls = 0;
      // Appels tous les 1 à 7 points, comme un direct dont la cadence varie.
      for (let n = 2; n <= fixes.length; n += 1 + ((n * 13) % 7)) {
        run = resumeKinematics(raw.slice(0, n), kinematicsOptions, run)!;
        const { parts, memory: next } = computeSegmentParts(fixes.slice(0, n), run.track, run.frozenUpTo, settings, memory);
        if (memory?.track && next.track?.legs && next.track.frozen > 0 && memory.track.frozen > 0) kept++;
        memory = next;
        calls++;
        if (n % 5 !== 0 && n !== fixes.length) continue;
        const { track, ordered, ...rest } = parts;
        expect(track).toBe(run.track);
        expect(ordered).toBe(true);
        const whole = fromScratch(fixes.slice(0, n), run.track, settings);
        if (!sameData(rest, whole)) expect(rest).toEqual(whole);
      }
      // Les cumuls ont bien été gardés d'un appel à l'autre, presque toujours.
      expect(kept).toBeGreaterThan(calls * 0.9);
    });
  }

  for (const hz of [1, 5]) {
    it(`départ à l'arrêt puis seuil franchi dans les premiers points : rien n'est repris tant que rien n'est figé, à ${hz} Hz`, () => {
      // Confirmation de 3 s : l'état de départ de l'automate, lu sur le premier point, pèse sur les premières secondes.
      const settings: SegmentSettings = {
        mask: thresholdMaskOptions({ ...wing, minStateDurationS: 3 }, 8), maxDurationS: 2, heartRate: wing.heartRate, sailing: true,
      };
      const enter = settings.mask!.enterThresholdMs;
      const kinematicsOptions = { medianWindowSeconds: wing.medianWindowSeconds, maxSpeedMs: wing.maxPlausibleSpeedMs, maxGapS: wing.maxGapS };
      let startFlipped = 0;
      for (const stillS of [0.4, 1, 2]) {
        const fixes = segment(hz, 120).map((f) => {
          const t = (f.timeMs - T0) / 1000;
          return { ...f, speedMs: t < stillS ? 0.3 : 7 + Math.sin(t / 9) };
        });
        const raw = fixes.map(rawOf);
        for (const every of [1, 2, 5]) {
          let run: KinematicsRun | null = null;
          let memory: SegmentMemory | null = null;
          let firstStart: boolean | null = null;
          for (let n = 2; n <= Math.min(fixes.length, 40 * hz); n += every) {
            run = resumeKinematics(raw.slice(0, n), kinematicsOptions, run)!;
            const started = run.track[0].smoothedSpeedMs >= enter;
            if (firstStart === null) firstStart = started;
            else if (!firstStart && started) startFlipped++;
            const { parts, memory: next } = computeSegmentParts(fixes.slice(0, n), run.track, run.frozenUpTo, settings, memory);
            memory = next;
            const { track: _track, ordered: _ordered, ...rest } = parts;
            const whole = fromScratch(fixes.slice(0, n), run.track, settings);
            if (!sameData(rest, whole)) expect(rest).toEqual(whole);
          }
        }
      }
      // Le cas voulu est bien là : le premier point, sous le seuil au premier appel, le passe à un appel suivant. À 1 Hz,
      // la médiane de 3 s du premier point est close dès le deuxième point : il ne bouge plus, l'égalité seule est vérifiée.
      if (hz === 5) expect(startFlipped).toBeGreaterThan(0);
    });
  }

  it('sous deux points : rien que la FC', () => {
    const fixes = segment(1, 3).slice(0, 1).map((f) => ({ ...f, heartRateBpm: 130 }));
    const settings: SegmentSettings = { mask: null, maxDurationS: 2, heartRate: wing.heartRate, sailing: false };
    const { parts, memory } = computeSegmentParts(fixes, [], 0, settings, null);
    expect(parts).toEqual({ track: [], cum: { cumDist: [0], cumTime: [0] }, distanceM: 0, movingTimeMs: 0, active: null, heart: null, maxSpeedMs: null, legs: null, ordered: true });
    expect(memory.track).toBeNull();
  });
});
