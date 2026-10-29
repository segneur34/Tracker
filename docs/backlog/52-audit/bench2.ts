// Prototypes jetables : médiane glissante sans recopie, tops sans tri ; comparaison exacte avec le code actuel.
import { computeKinematics } from 'C:/Users/segne/tracker/src/core/kinematics';
import { medianFilterByTime } from 'C:/Users/segne/tracker/src/core/speedFilter';
import { buildCumulativeTrack } from 'C:/Users/segne/tracker/src/core/sessionStats';
import { computeTopSegments } from 'C:/Users/segne/tracker/src/core/topSegments';
import { SAILING_TOP_TARGETS, CYCLING_TOP_TARGETS } from 'C:/Users/segne/tracker/src/core/sportProfiles';
import type { RawTrackPoint, TrackPoint, CumulativeTrack, TopTarget } from 'C:/Users/segne/tracker/src/core/types';

const N = 54000, HZ = 5;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const t0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const pts: RawTrackPoint[] = [];
let lat = 43.4, lon = 3.7, heading = 0;
for (let i = 0; i < N; i++) {
  const t = i / HZ;
  heading += Math.sin(t / 60) * 0.5;
  const v = 8 + 3 * Math.sin(t / 300) + (rnd() - 0.5) * 2;
  lat += (v / HZ) * Math.cos(heading * Math.PI / 180) / 111320;
  lon += (v / HZ) * Math.sin(heading * Math.PI / 180) / (111320 * Math.cos(lat * Math.PI / 180));
  // quelques trous de 2 s et des dates tronquées
  const ms = t0 + Math.floor(i * 1000 / HZ) + (i % 997 === 0 ? 2000 : 0);
  pts.push({ lat: lat + (rnd() - 0.5) * 3e-5, lon, time: new Date(ms + Math.floor(i / 997) * 2000).toISOString() });
}
const track = computeKinematics(pts, { maxGapS: 10 });
const times = track.map((p) => p.timeMs);
const speeds = track.map((p) => p.speedMs);

// Médiane glissante : fenêtre triée tenue à jour par insertion et retrait dichotomiques.
const lowerBound = (a: number[], v: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; };
const slidingMedian = (values: number[], timesMs: number[], windowSeconds: number): number[] => {
  const half = (windowSeconds * 1000) / 2;
  const out = new Array<number>(values.length);
  const win: number[] = [];
  let start = 0, end = -1;
  for (let i = 0; i < values.length; i++) {
    while (end + 1 < values.length && (end + 1 <= i || timesMs[end + 1] - timesMs[i] <= half)) { end++; win.splice(lowerBound(win, values[end]), 0, values[end]); }
    while (start < i && timesMs[i] - timesMs[start] > half) { win.splice(lowerBound(win, values[start]), 1); start++; }
    const m = win.length >> 1;
    out[i] = win.length % 2 === 0 ? (win[m - 1] + win[m]) / 2 : win[m];
  }
  return out;
};

// Tops : meilleure fenêtre par balayage répété, sans tableau d'objets ni tri.
const topsByScan = (track: TrackPoint[], cum: CumulativeTrack, target: TopTarget, count: number): number[] => {
  const { cumDist, cumTime } = cum;
  const isD = target.kind === 'distance';
  const ref = isD ? cumDist : cumTime;
  const n = track.length;
  const gap = new Int32Array(n);
  for (let k = 1; k < n; k++) gap[k] = gap[k - 1] + (track[k].gapDistanceM !== undefined ? 1 : 0);
  const end = new Int32Array(n).fill(-1);
  const val = new Float64Array(n).fill(-Infinity);
  let j = 1;
  for (let i = 0; i < n - 1; i++) {
    const th = ref[i] + target.value;
    if (j <= i) j = i + 1;
    while (j < n && ref[j] < th) j++;
    if (j >= n) break;
    if (gap[j] > gap[i]) continue;
    let d: number, dur: number;
    const span = ref[j] - ref[j - 1];
    if (isD) { const e = span <= 0 ? cumTime[j] : cumTime[j - 1] + ((th - ref[j - 1]) / span) * (cumTime[j] - cumTime[j - 1]); d = target.value; dur = e - cumTime[i]; }
    else { const e = span <= 0 ? cumDist[j] : cumDist[j - 1] + ((th - ref[j - 1]) / span) * (cumDist[j] - cumDist[j - 1]); d = e - cumDist[i]; dur = target.value; }
    if (dur > 0 && d > 0) { end[i] = j; val[i] = d / dur; }
  }
  const picked: [number, number][] = [];
  const res: number[] = [];
  while (res.length < count) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (end[i] < 0 || (best >= 0 && !(val[i] > val[best]))) continue;
      if (picked.some(([s, e]) => Math.max(i, s) <= Math.min(end[i], e))) continue;
      best = i;
    }
    if (best < 0) break;
    picked.push([best, end[best]]);
    res.push(val[best]);
  }
  return res;
};

const time = (label: string, f: () => unknown, reps = 3) => {
  f(); const s = performance.now(); for (let k = 0; k < reps; k++) f();
  console.log(`${label.padEnd(40)} ${((performance.now() - s) / reps).toFixed(1)} ms`);
};

for (const w of [3, 5]) {
  const a = medianFilterByTime(speeds, times, w);
  const b = slidingMedian(speeds, times, w);
  const diff = a.reduce((n, x, i) => n + (Object.is(x, b[i]) ? 0 : 1), 0);
  console.log(`médiane ${w} s : ${diff} écarts sur ${a.length}`);
  time(`  actuelle ${w} s`, () => medianFilterByTime(speeds, times, w));
  time(`  glissante ${w} s`, () => slidingMedian(speeds, times, w));
}
const cum = buildCumulativeTrack(track);
let diffs = 0;
for (const target of [...SAILING_TOP_TARGETS, ...CYCLING_TOP_TARGETS]) {
  const a = computeTopSegments(track, cum, target, (x) => x, { decimals: 6 }).map((t) => t.speed);
  const b = topsByScan(track, cum, target, 3);
  if (a.some((x, i) => x !== (b[i] ?? null))) { diffs++; console.log('écart', target.key, a, b); }
}
console.log(`tops : ${diffs} cibles différentes`);
time('tops actuels voile (7)', () => SAILING_TOP_TARGETS.map((t) => computeTopSegments(track, cum, t, (x) => x)));
time('tops balayage voile (7)', () => SAILING_TOP_TARGETS.map((t) => topsByScan(track, cum, t, 3)));
