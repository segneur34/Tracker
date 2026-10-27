import { describe, expect, it } from 'vitest';
import type { PointData } from '../utils/kinematics';
import type { ManeuverLocation, ManeuverStats, WindReference } from './maneuvers';
import { calculateVmgStats, calculateWindStats, type VmgStats } from './sailingAnalytics';
import { angleDiff } from './wind';

const START_MS = Date.parse('2026-01-01T10:00:00Z');

/** Trace synthétique aux instants donnés (en secondes), cap et vitesse imposés. */
const buildTrackAt = (
  timesS: number[],
  bearingAt: (t: number) => number,
  speedAt: (t: number, bearing: number) => number,
  segmentStartAtS: number[] = []
): PointData[] =>
  timesS.map((t) => {
    const timeMs = START_MS + Math.round(t * 1000);
    const bearing = ((bearingAt(t) % 360) + 360) % 360;
    const speed = speedAt(t, bearing);
    return {
      lat: 43.6,
      lon: 3.8 + t * 0.0001,
      time: new Date(timeMs).toISOString(),
      timeMs,
      speed,
      smoothedSpeed: speed,
      bearing,
      ...(segmentStartAtS.includes(t) ? { segmentStart: true as const } : {}),
    };
  });

const regularTimes = (durationS: number, stepS: number): number[] => {
  const out: number[] = [];
  for (let t = 0; t <= durationS + 1e-9; t += stepS) out.push(Math.round(t * 1000) / 1000);
  return out;
};

/** Vitesse d'un wingfoil selon l'angle au vent : lent dans le cône, rapide au largue. */
const polar = (twa: number): number => {
  if (twa < 35) return 3;
  if (twa < 60) return 12;
  if (twa < 110) return 18;
  if (twa < 150) return 15;
  return 10;
};

/**
 * Session par bords, vent du nord : près tribord (315°), près bâbord (45°),
 * portant bâbord (135°), portant tribord (225°), chaque bord de `legS`
 * secondes avec des transitions de 6 s par l'arc court.
 */
const LEGS = [315, 45, 135, 225];
const legSession = (legS = 90, transitionS = 6) => {
  const bearingAt = (t: number): number => {
    const k = Math.min(LEGS.length - 1, Math.floor(t / legS));
    const from = LEGS[k];
    if (k === LEGS.length - 1) return from;
    const to = LEGS[k + 1];
    const into = t - k * legS;
    const start = legS - transitionS;
    if (into < start) return from;
    return from + angleDiff(to, from) * ((into - start) / transitionS);
  };
  // La vitesse ondule de ±1,5 nœud sur 20 s, pour que la pondération ait une prise.
  const speedAt = (t: number, bearing: number): number => polar(Math.abs(angleDiff(bearing, 0))) + 1.5 * Math.sin((2 * Math.PI * t) / 20);
  return { bearingAt, speedAt, durationS: LEGS.length * legS };
};

/**
 * Version d'avant le 27/10, moyennes par point : la référence que la version
 * en sommes cumulées doit retrouver sur une trace régulière.
 */
const legacyVmgStats = (trackData: PointData[], wind: WindReference, minSpeedKn: number, windowSeconds = 10): VmgStats => {
  const resolveWind = (w: WindReference, timeMs: number): number => (typeof w === 'function' ? w(timeMs) : w);
  const windowMs = windowSeconds * 1000;
  let maxUpStbd = 0, maxUpPort = 0, maxDownStbd = 0, maxDownPort = 0;
  let sumUpStbd = 0, sumUpPort = 0, sumDownStbd = 0, sumDownPort = 0;
  let cUpStbd = 0, cUpPort = 0, cDownStbd = 0, cDownPort = 0;
  const evaluateWindow = (i: number, j: number) => {
    let sumVmg = 0, sumSpeed = 0, portCount = 0, stbdCount = 0, allAboveMin = true;
    for (let k = i; k <= j; k++) {
      const p = trackData[k];
      if (p.smoothedSpeed < minSpeedKn) allAboveMin = false;
      sumSpeed += p.smoothedSpeed;
      const diff = angleDiff(p.bearing, resolveWind(wind, p.timeMs));
      sumVmg += p.smoothedSpeed * Math.cos(diff * (Math.PI / 180));
      if (diff < 0) stbdCount++; else portCount++;
    }
    const n = j - i + 1;
    return { avgSpeed: sumSpeed / n, avgVmg: sumVmg / n, isStarboard: stbdCount > portCount, allAboveMin };
  };
  const windows: { start: number; end: number; avgVmg: number; allAboveMin: boolean }[] = [];
  let j = 0;
  for (let i = 0; i < trackData.length; i++) {
    if (j < i) j = i;
    while (j + 1 < trackData.length && trackData[j + 1].timeMs - trackData[i].timeMs <= windowMs) j++;
    if (trackData[j].timeMs - trackData[i].timeMs < windowMs * 0.8) {
      if (j === trackData.length - 1) break;
      continue;
    }
    const w = evaluateWindow(i, j);
    windows.push({ start: i, end: j, avgVmg: w.avgVmg, allAboveMin: w.allAboveMin });
    if (w.avgSpeed >= minSpeedKn) {
      if (w.avgVmg > 0) {
        if (w.isStarboard) { if (w.avgVmg > maxUpStbd) maxUpStbd = w.avgVmg; sumUpStbd += w.avgVmg; cUpStbd++; }
        else { if (w.avgVmg > maxUpPort) maxUpPort = w.avgVmg; sumUpPort += w.avgVmg; cUpPort++; }
      } else {
        const absVmg = -w.avgVmg;
        if (w.isStarboard) { if (absVmg > maxDownStbd) maxDownStbd = absVmg; sumDownStbd += absVmg; cDownStbd++; }
        else { if (absVmg > maxDownPort) maxDownPort = absVmg; sumDownPort += absVmg; cDownPort++; }
      }
    }
  }
  const getTopVmg = (isUpwind: boolean) => {
    const candidates = windows
      .filter((w) => w.allAboveMin && (isUpwind ? w.avgVmg > 0 : w.avgVmg < 0))
      .map((w) => ({ start: w.start, end: w.end, val: Math.abs(w.avgVmg) }))
      .sort((a, b) => b.val - a.val);
    const tops: { val: string; path: [number, number][] }[] = [];
    const selected: { start: number; end: number }[] = [];
    for (const w of candidates) {
      if (tops.length >= 3) break;
      if (!selected.some((s) => Math.max(w.start, s.start) <= Math.min(w.end, s.end))) {
        tops.push({ val: w.val.toFixed(1), path: trackData.slice(w.start, w.end + 1).map((p) => [p.lat, p.lon] as [number, number]) });
        selected.push({ start: w.start, end: w.end });
      }
    }
    while (tops.length < 3) tops.push({ val: '-', path: [] });
    return tops;
  };
  return {
    upStbd: { max: maxUpStbd.toFixed(1), avg: cUpStbd > 0 ? (sumUpStbd / cUpStbd).toFixed(1) : '0.0' },
    upPort: { max: maxUpPort.toFixed(1), avg: cUpPort > 0 ? (sumUpPort / cUpPort).toFixed(1) : '0.0' },
    downStbd: { max: maxDownStbd.toFixed(1), avg: cDownStbd > 0 ? (sumDownStbd / cDownStbd).toFixed(1) : '0.0' },
    downPort: { max: maxDownPort.toFixed(1), avg: cDownPort > 0 ? (sumDownPort / cDownPort).toFixed(1) : '0.0' },
    topsUpwind: getTopVmg(true),
    topsDownwind: getTopVmg(false),
  };
};

const MIN_KN = 5;
const cells = (v: VmgStats): number[] =>
  [v.upStbd, v.upPort, v.downStbd, v.downPort].flatMap((c) => [parseFloat(c.max), parseFloat(c.avg)]);
const topVals = (v: VmgStats): number[] => [...v.topsUpwind, ...v.topsDownwind].map((t) => parseFloat(t.val));

const expectClose = (a: number[], b: number[], tolerance: number) => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => expect(Math.abs(x - b[i]), `valeur ${i} : ${x} contre ${b[i]}`).toBeLessThanOrEqual(tolerance));
};

describe('calculateVmgStats', () => {
  const session = legSession();

  it('retrouve l\'ancienne version à 1 Hz et à 5 Hz, à 0,2 nœud près', () => {
    for (const stepS of [1, 0.2]) {
      const track = buildTrackAt(regularTimes(session.durationS, stepS), session.bearingAt, session.speedAt);
      const next = calculateVmgStats(track, 0, MIN_KN)!;
      const legacy = legacyVmgStats(track, 0, MIN_KN);
      expectClose(cells(next), cells(legacy), 0.2);
      expectClose(topVals(next), topVals(legacy), 0.2);
    }
  });

  it('donne le même résultat à 1 Hz et à 5 Hz', () => {
    const at1Hz = calculateVmgStats(buildTrackAt(regularTimes(session.durationS, 1), session.bearingAt, session.speedAt), 0, MIN_KN)!;
    const at5Hz = calculateVmgStats(buildTrackAt(regularTimes(session.durationS, 0.2), session.bearingAt, session.speedAt), 0, MIN_KN)!;
    expectClose(cells(at1Hz), cells(at5Hz), 0.15);
    expectClose(topVals(at1Hz), topVals(at5Hz), 0.15);
  });

  it('ne dépend pas de la répartition des points : un enregistreur au pas de 10 m donne la même VMG qu\'à 1 Hz', () => {
    // Un point tous les 10 m : la partie rapide d'une fenêtre a plus de points que la partie lente.
    const economic: number[] = [0];
    while (economic[economic.length - 1] < session.durationS) {
      const t = economic[economic.length - 1];
      const speedMs = session.speedAt(t, session.bearingAt(t)) * 0.514444;
      economic.push(Math.round((t + 10 / speedMs) * 1000) / 1000);
    }
    const regular = calculateVmgStats(buildTrackAt(regularTimes(session.durationS, 1), session.bearingAt, session.speedAt), 0, MIN_KN)!;
    const sparse = calculateVmgStats(buildTrackAt(economic, session.bearingAt, session.speedAt), 0, MIN_KN)!;
    cells(regular).forEach((x, i) => {
      const y = cells(sparse)[i];
      expect(Math.abs(x - y) / Math.max(x, 0.1), `case ${i} : ${x} contre ${y}`).toBeLessThanOrEqual(0.02);
    });
  });

  it('compte tribord quand le cap est à gauche du vent, près positif et portant négatif', () => {
    const track = buildTrackAt(regularTimes(session.durationS, 1), session.bearingAt, session.speedAt);
    const v = calculateVmgStats(track, 0, MIN_KN)!;
    // 315° au près : tribord ; 45° : bâbord ; 135° portant bâbord ; 225° portant tribord.
    // La vitesse ondule de ±1,5 nœud : la moyenne des fenêtres retombe sur la polaire, le max un peu au-dessus.
    const up = 12 * Math.cos(Math.PI / 4);
    const down = 15 * Math.cos(Math.PI / 4);
    expect(Math.abs(parseFloat(v.upStbd.avg) - up)).toBeLessThan(0.5);
    expect(Math.abs(parseFloat(v.upPort.avg) - up)).toBeLessThan(0.5);
    expect(Math.abs(parseFloat(v.downPort.avg) - down)).toBeLessThan(0.5);
    expect(Math.abs(parseFloat(v.downStbd.avg) - down)).toBeLessThan(0.5);
    expect(parseFloat(v.upStbd.max)).toBeGreaterThan(up);
    expect(parseFloat(v.upStbd.max)).toBeLessThan(up + 1.2);
    expect(parseFloat(v.downPort.max)).toBeGreaterThan(down);
    expect(parseFloat(v.downPort.max)).toBeLessThan(down + 1.2);
    expect(v.topsUpwind[0].path.length).toBeGreaterThan(1);
    expect(v.topsDownwind[0].path.length).toBeGreaterThan(1);
  });

  it('accepte un vent fonction du temps, égal au vent fixe quand il ne tourne pas', () => {
    const track = buildTrackAt(regularTimes(session.durationS, 1), session.bearingAt, session.speedAt);
    const fixed = calculateVmgStats(track, 90, MIN_KN)!;
    const timed = calculateVmgStats(track, () => 90, MIN_KN)!;
    expect(cells(timed)).toEqual(cells(fixed));
    expect(topVals(timed)).toEqual(topVals(fixed));
  });

  it('ne compte rien sur le pas de reprise d\'une pause, ni les fenêtres trop courtes', () => {
    // Un bord au près à 12 nœuds, coupé par une pause de 8 s : le pas de reprise pèse zéro.
    const times = [...regularTimes(30, 1), ...regularTimes(30, 1).map((t) => t + 38)];
    const track = buildTrackAt(times, () => 315, () => 12, [38]);
    const v = calculateVmgStats(track, 0, MIN_KN)!;
    expect(parseFloat(v.upStbd.max)).toBeCloseTo(12 * Math.cos(Math.PI / 4), 1);
    expect(parseFloat(v.upStbd.avg)).toBeCloseTo(12 * Math.cos(Math.PI / 4), 1);
  });

  it('rend null sans trace ou sans vent', () => {
    expect(calculateVmgStats([], 0, MIN_KN)).toBeNull();
    const track = buildTrackAt(regularTimes(30, 1), () => 315, () => 12);
    expect(calculateVmgStats(track, null, MIN_KN)).toBeNull();
  });
});

const fakeManeuver = (localWind: number, timeMs: number): ManeuverLocation => ({
  lat: 43.6, lon: 3.8, type: 'tack', success: true, vmin: 6, localWind, timeMs, trackIndex: 0, stableHeadings: true,
  windCriteria: { conservation: 0.5, success: true }, entrySpeed: 12, conservation: 0.5, relaunchS: 4, headingChange: 90,
  distanceM: 40, windwardGainM: 10, apexIndex: 0, entryIndex: 0, exitIndex: 0, entryHeading: 315, exitHeading: 45, path: [],
});

describe('calculateWindStats', () => {
  it('affiche 0° et non 360° pour un vent moyen à 359,8°', () => {
    const track = buildTrackAt(regularTimes(600, 1), () => 315, () => 12);
    const stats: ManeuverStats = {
      tackSuccess: 3, tackFail: 0, jibeSuccess: 0, jibeFail: 0,
      rejected: { slowEntry: 0, incoherent: 0, unclassified: 0, tooShort: 0 },
      locations: [fakeManeuver(359.7, START_MS + 60_000), fakeManeuver(359.9, START_MS + 180_000), fakeManeuver(359.8, START_MS + 300_000)],
    };
    const wind = calculateWindStats(track, stats, 0)!;
    expect(wind.avgWind).toBe(0);
    expect(wind.minWind).toBe(0);
    expect(wind.maxWind).toBe(0);
  });
});
