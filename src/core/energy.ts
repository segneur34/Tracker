import { classifyGrade, type GradeZoneKey } from './grade';
import { segmentDistanceM } from './sessionStats';
import type { GradeProfile } from './sportProfiles';
import type { TrackPoint } from './types';

/**
 * Intégration de la dépense d'énergie le long d'une trace, commune à la course
 * (par kilo) et au vélo (absolue) : seul change le coût d'un pas, donné par
 * l'appelant. Les unités sont celles du coût (J/kg ou J).
 */

/** Coût d'un segment en mouvement : énergie nette de l'organisme et travail mécanique. */
export interface EnergyStep {
  net: number;
  mechanical: number;
}

/**
 * Coût du segment `i - 1 → i`, de longueur `distanceM` (`segmentDistanceM`),
 * à la pente `grade` (`NaN` si elle manque).
 */
export type EnergyStepCost = (i: number, distanceM: number, grade: number) => EnergyStep;

/** Sommes d'une zone de pente, sur les seuls segments en mouvement. */
export interface EnergyZoneSums {
  net: number;
  mechanical: number;
  distanceM: number;
  /** Temps en mouvement dans la zone, en s. */
  timeS: number;
}

export interface EnergyIntegration {
  /** Puissance mécanique en chaque point (segment qui y mène) ; `NaN` à l'arrêt et au premier point. */
  mechanicalPower: number[];
  /** Énergie totale (effort et repos) dépensée depuis le départ. */
  cumulativeTotal: number[];
  /** Travail mécanique, somme des pas. */
  mechanical: number;
  /** Énergie nette de l'effort. */
  net: number;
  /** Repos sur toute la durée, pauses comprises. */
  rest: number;
  movingTimeS: number;
  movingDistanceM: number;
  /** Sommes par zone de pente ; une pente manquante range son segment au plat. */
  byZone: Record<GradeZoneKey, EnergyZoneSums>;
}

const emptyZone = (): EnergyZoneSums => ({ net: 0, mechanical: 0, distanceM: 0, timeS: 0 });

/**
 * Énergie dépensée le long de la trace. Chaque segment en mouvement
 * (`activityMask[i]`) coûte `stepCost` ; le repos (`restRate`, par seconde)
 * court sur toute la durée. Un pas de temps nul ou négatif ne coûte rien.
 */
export const integrateEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  restRate: number,
  stepCost: EnergyStepCost,
  zones: GradeProfile
): EnergyIntegration => {
  const n = track.length;
  const mechanicalPower = new Array<number>(n).fill(NaN);
  const cumulativeTotal = new Array<number>(n).fill(0);
  const byZone: Record<GradeZoneKey, EnergyZoneSums> = {
    steepDown: emptyZone(),
    down: emptyZone(),
    flat: emptyZone(),
    up: emptyZone(),
    steepUp: emptyZone(),
  };
  let mechanical = 0;
  let net = 0;
  let rest = 0;
  let movingTimeS = 0;
  let movingDistanceM = 0;

  for (let i = 1; i < n; i++) {
    const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (dt <= 0) {
      cumulativeTotal[i] = cumulativeTotal[i - 1];
      continue;
    }
    const restStep = restRate * dt;
    rest += restStep;
    let netStep = 0;
    if (activityMask[i]) {
      const d = segmentDistanceM(track, i);
      const grade = grades[i] ?? NaN;
      const step = stepCost(i, d, grade);
      netStep = step.net;
      mechanicalPower[i] = step.mechanical / dt;
      mechanical += step.mechanical;
      net += netStep;
      movingTimeS += dt;
      movingDistanceM += d;
      const zone = byZone[classifyGrade(grade, zones) ?? 'flat'];
      zone.mechanical += step.mechanical;
      zone.net += netStep;
      zone.distanceM += d;
      zone.timeS += dt;
    }
    cumulativeTotal[i] = cumulativeTotal[i - 1] + restStep + netStep;
  }

  return { mechanicalPower, cumulativeTotal, mechanical, net, rest, movingTimeS, movingDistanceM, byZone };
};
