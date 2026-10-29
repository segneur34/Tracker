// Banc jetable : coût des étapes du noyau sur une trace synthétique de 3 h à 5 Hz (54 000 points).
import { computeKinematics, detectTrackDeviceSpeedUnit, pointTimeMs } from 'C:/Users/segne/tracker/src/core/kinematics';
import { referenceSpeedMs, samplingIntervalS } from 'C:/Users/segne/tracker/src/core/sessionSpeed';
import { buildCumulativeTrack, thresholdActivityMask, buildBaseSessionStats } from 'C:/Users/segne/tracker/src/core/sessionStats';
import { computeAllTopSegments } from 'C:/Users/segne/tracker/src/core/topSegments';
import { computeElevationStats } from 'C:/Users/segne/tracker/src/core/elevation';
import { trackColorSegments } from 'C:/Users/segne/tracker/src/core/trackColor';
import { SPORT_PROFILES, SAILING_TOP_TARGETS, CYCLING_TOP_TARGETS, ELEVATION_PRESETS } from 'C:/Users/segne/tracker/src/core/sportProfiles';
import { medianFilterByTime, linearSmoothByTime } from 'C:/Users/segne/tracker/src/core/speedFilter';
import type { RawTrackPoint } from 'C:/Users/segne/tracker/src/core/types';

const N = Number(process.argv[2] ?? 54000);
const HZ = Number(process.argv[3] ?? 5);
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const t0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const pts: RawTrackPoint[] = [];
let lat = 43.4, lon = 3.7, heading = 0, ele = 50;
for (let i = 0; i < N; i++) {
  const t = i / HZ;
  heading += Math.sin(t / 60) * 0.5;
  const v = 8 + 3 * Math.sin(t / 300) + (rnd() - 0.5);
  lat += (v / HZ) * Math.cos(heading * Math.PI / 180) / 111320;
  lon += (v / HZ) * Math.sin(heading * Math.PI / 180) / (111320 * Math.cos(lat * Math.PI / 180));
  ele += (rnd() - 0.5) * 0.5;
  pts.push({ lat: lat + (rnd() - 0.5) * 2e-5, lon, time: new Date(t0 + i * 1000 / HZ).toISOString(), ele });
}

const time = (label: string, f: () => unknown, reps = 3) => {
  f();
  const s = performance.now();
  for (let k = 0; k < reps; k++) f();
  console.log(`${label.padEnd(44)} ${((performance.now() - s) / reps).toFixed(1)} ms`);
};
import { detourSpikes, spreadEqualTimes, haversineDistance } from 'C:/Users/segne/tracker/src/core/kinematics';
import { trackToPointData } from 'C:/Users/segne/tracker/src/utils/kinematics';
const times0 = pts.map((p) => pointTimeMs(p.time));
time('spreadEqualTimes', () => spreadEqualTimes(pts, times0));
time('detourSpikes (3 haversines/point)', () => detourSpikes(pts, times0));
time('haversine ×N (cordes)', () => { let s = 0; for (let i = 1; i < pts.length; i++) s += haversineDistance(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon); return s; });
const tr = computeKinematics(pts, { maxGapS: 10 });
time('trackToPointData', () => trackToPointData(tr));
