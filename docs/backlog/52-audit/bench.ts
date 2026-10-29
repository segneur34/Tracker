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

console.log(`N=${N} à ${HZ} Hz`);
time('pointTimeMs (Date) ×N', () => pts.map((p) => pointTimeMs(p.time)));
time('referenceSpeedMs', () => referenceSpeedMs(pts));
time('samplingIntervalS', () => samplingIntervalS(pts));
time('detectTrackDeviceSpeedUnit (sans Doppler)', () => detectTrackDeviceSpeedUnit(pts));
const withSpeed = pts.map((p, i) => ({ ...p, speedMs: 8 + Math.sin(i / 100) }));
time('detectTrackDeviceSpeedUnit (Doppler)', () => detectTrackDeviceSpeedUnit(withSpeed));
time('computeKinematics', () => computeKinematics(pts, { maxGapS: 10 }));
time('computeKinematics (Doppler)', () => computeKinematics(withSpeed, { maxGapS: 10 }));
const track = computeKinematics(pts, { maxGapS: 10 });
const times = track.map((p) => p.timeMs);
const speeds = track.map((p) => p.speedMs);
time('medianFilterByTime 3 s', () => medianFilterByTime(speeds, times, 3));
time('medianFilterByTime 5 s', () => medianFilterByTime(speeds, times, 5));
time('linearSmoothByTime 20 s (altitude)', () => linearSmoothByTime(track.map((p) => p.ele ?? 0), times, 20));
time('buildCumulativeTrack', () => buildCumulativeTrack(track));
const cum = buildCumulativeTrack(track);
time('thresholdActivityMask', () => thresholdActivityMask(track, SPORT_PROFILES.wingfoil, 8));
time('computeElevationStats route', () => computeElevationStats(track, ELEVATION_PRESETS.route));
time('buildBaseSessionStats (tout recalculé)', () => buildBaseSessionStats(track, { enterThresholdMs: 4, exitThresholdMs: 3 }));
time('computeAllTopSegments voile (7 cibles)', () => computeAllTopSegments(track, cum, SAILING_TOP_TARGETS, (x) => x));
time('computeAllTopSegments vélo (9 cibles)', () => computeAllTopSegments(track, cum, CYCLING_TOP_TARGETS, (x) => x));
time('trackColorSegments course (15 s)', () => trackColorSegments(track, 'course', { minMs: 1, maxMs: 10 }));
