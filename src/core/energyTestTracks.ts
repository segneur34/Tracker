import { computeGrades } from './grade';
import { buildCumulativeTrack } from './sessionStats';
import { GRADE_ANALYSIS } from './sportProfiles';
import type { TrackPoint } from './types';

/**
 * Traces synthétiques des tests de neutralité de l'énergie (copies gelées de
 * `computeEnergy` et `computeCyclingEnergy`) : cadence 1 Hz ou 5 Hz, côte et
 * descente, dates répétées ou reculées, trou de trace, pause, pente manquante.
 * Réservé aux tests.
 */

export interface EnergyCase {
  name: string;
  track: TrackPoint[];
  grades: number[];
  mask: boolean[];
}

const START = Date.parse('2026-01-01T10:00:00Z');

const build = (stepS: number, durationS: number): TrackPoint[] => {
  const track: TrackPoint[] = [];
  let meters = 0;
  for (let k = 0; k * stepS <= durationS + 1e-9; k++) {
    const tS = k * stepS;
    const speedMs = 2.5 + 1.5 * Math.sin(tS / 37) + (k % 7) * 0.13;
    if (k > 0) meters += speedMs * stepS;
    const timeMs = START + Math.round(tS * 1000);
    track.push({
      lat: 43.6,
      lon: 3.8 + meters / 80000,
      time: new Date(timeMs).toISOString(),
      timeMs,
      ele: 100 + 40 * Math.sin(meters / 400) + 0.3 * Math.cos(meters / 7),
      speedMs,
      smoothedSpeedMs: speedMs,
      bearing: 90,
      speedSource: 'derived',
    });
  }
  return track;
};

const gradesOf = (track: TrackPoint[]) =>
  computeGrades(track.map((p) => p.ele ?? NaN), buildCumulativeTrack(track), GRADE_ANALYSIS.halfWindowM, track);

const pauseMask = (track: TrackPoint[], fromS: number, toS: number) =>
  track.map((p) => {
    const tS = (p.timeMs - START) / 1000;
    return !(tS > fromS && tS <= toS);
  });

/** Les cas comparés, à 1 Hz et à 5 Hz. */
export const energyCases = (): EnergyCase[] => {
  const cases: EnergyCase[] = [];
  for (const stepS of [1, 0.2]) {
    const hz = `${Math.round(1 / stepS)} Hz`;
    const plain = build(stepS, 900);
    cases.push({ name: `${hz} continue`, track: plain, grades: gradesOf(plain), mask: plain.map(() => true) });

    // Dates répétées et reculées (dates tronquées à la seconde).
    const truncated = build(stepS, 600).map((p) => {
      const timeMs = Math.floor(p.timeMs / 1000) * 1000;
      return { ...p, timeMs, time: new Date(timeMs).toISOString() };
    });
    truncated[40] = { ...truncated[40], timeMs: truncated[39].timeMs - 500 };
    cases.push({ name: `${hz} dates tronquées`, track: truncated, grades: gradesOf(truncated), mask: truncated.map(() => true) });

    // Trou de trace : 8 s sans point, distance bornée posée par le noyau.
    const gap = build(stepS, 600);
    const cut = Math.round(200 / stepS);
    const skip = Math.round(8 / stepS);
    const holed = [...gap.slice(0, cut), { ...gap[cut + skip], gapDistanceM: 21.5 }, ...gap.slice(cut + skip + 1)];
    cases.push({ name: `${hz} trou`, track: holed, grades: gradesOf(holed), mask: holed.map(() => true) });

    // Pause : hors mouvement entre 300 et 420 s, reprise marquée.
    const paused = build(stepS, 900);
    const resume = Math.round(420 / stepS) + 1;
    paused[resume] = { ...paused[resume], segmentStart: true };
    cases.push({ name: `${hz} pause`, track: paused, grades: gradesOf(paused), mask: pauseMask(paused, 300, 420) });

    // Pente manquante : altitude absente au début, tableau de pentes trop court.
    const noEle = build(stepS, 600).map((p, k) => (k < 100 ? { ...p, ele: undefined } : p));
    const shortGrades = gradesOf(noEle).slice(0, Math.round(500 / stepS));
    cases.push({ name: `${hz} pente manquante`, track: noEle, grades: shortGrades, mask: noEle.map(() => true) });
  }
  return cases;
};
