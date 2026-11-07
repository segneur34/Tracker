/**
 * Onglet « niveau » des statistiques (lot 146) : les meilleurs efforts de la période (résumé des fiches,
 * `SummaryBests`) situés par rapport à des références publiées, d'après l'âge, le sexe et le poids du pratiquant.
 * À pied : la référence de l'âge sur 5 et 10 km (`running/ageGrade.ts`) et la VO2max estimée (`running/vdot.ts`)
 * parmi la population de son âge (`running/vo2maxNorms.ts`) ; à vélo : la puissance au seuil rapportée au poids
 * (`cycling/powerLevels.ts`). Pur : les sessions et le profil sont donnés.
 */

import { powerLevel, thresholdWkg } from '../cycling/powerLevels';
import { ageGradeClass, ageGradePercent } from '../running/ageGrade';
import { AGE_GRADE_DISTANCES_M, type AgeGradeSex } from '../running/ageGradeTables';
import { runnerAge, type RunnerProfile } from './athleteProfile';
import { vdotFromRace } from '../running/vdot';
import { vo2maxPercentile, type Vo2maxStanding } from '../running/vo2maxNorms';
import type { StatSession } from './stats';

/** Ce que l'onglet lit du pratiquant ; `null` sans sexe ni année de naissance (`levelProfileOf`). */
export interface LevelProfile {
  sex: AgeGradeSex;
  birthYear: number;
  weightKg: number | null;
}

/** Profil de l'onglet, `null` s'il manque le sexe ou l'année de naissance. */
export const levelProfileOf = (runner: Pick<RunnerProfile, 'sex' | 'birthYear' | 'weightKg'>): LevelProfile | null =>
  runner.sex === null || runner.birthYear === null
    ? null
    : { sex: runner.sex === 'f' ? 'f' : 'h', birthYear: runner.birthYear, weightKg: runner.weightKg };

/** Âge du pratiquant l'année d'une session. */
const ageAt = (profile: LevelProfile, startMs: number): number =>
  runnerAge({ birthYear: profile.birthYear } as RunnerProfile, startMs)!;

type BestField = 'd5kmS' | 'd10kmS' | 'p20minW';

/** Session de la meilleure valeur d'un champ des meilleurs efforts : le temps le plus court, la puissance la plus haute ; à égalité, la plus ancienne. */
export const bestOf = (sessions: readonly StatSession[], field: BestField): { session: StatSession; value: number } | null => {
  let best: { session: StatSession; value: number } | null = null;
  const better = (a: number, b: number) => (field === 'p20minW' ? a > b : a < b);
  for (const session of sessions) {
    const value = session.bests?.[field];
    if (value === undefined || !Number.isFinite(value) || value <= 0) continue;
    if (!best || better(value, best.value) || (value === best.value && session.startMs < best.session.startMs)) best = { session, value };
  }
  return best;
};

/** Un meilleur temps et sa place par rapport à la référence de l'âge, l'année de la session. */
export interface RaceLevel {
  session: StatSession;
  timeS: number;
  /** Pourcentage de la référence de l'âge. */
  percent: number;
  /** Classe des calculateurs WMA et USATF (« niveau régional »). */
  classLabel: string;
}

/** VO2max estimée d'après le meilleur 5 km ou 10 km, la plus haute des deux, et sa place parmi la population. */
export interface Vo2Level {
  vo2: number;
  /** Course d'où vient l'estimation. */
  from: 'd5kmS' | 'd10kmS';
  session: StatSession;
  standing: Vo2maxStanding;
}

export interface RunningLevel {
  d5km: RaceLevel | null;
  d10km: RaceLevel | null;
  vo2: Vo2Level | null;
}

const DISTANCE_OF: Record<'d5kmS' | 'd10kmS', number> = { d5kmS: AGE_GRADE_DISTANCES_M.d5km, d10kmS: AGE_GRADE_DISTANCES_M.d10km };

const raceLevel = (sessions: readonly StatSession[], field: 'd5kmS' | 'd10kmS', profile: LevelProfile): RaceLevel | null => {
  const best = bestOf(sessions, field);
  if (!best) return null;
  const percent = ageGradePercent(profile.sex, ageAt(profile, best.session.startMs), DISTANCE_OF[field], best.value);
  return percent === null ? null : { session: best.session, timeS: best.value, percent, classLabel: ageGradeClass(percent).label };
};

/** Niveau à pied sur les sessions données (course : la marche est écartée par l'appelant). */
export const runningLevel = (sessions: readonly StatSession[], profile: LevelProfile): RunningLevel => {
  const d5km = raceLevel(sessions, 'd5kmS', profile);
  const d10km = raceLevel(sessions, 'd10kmS', profile);
  let vo2: Vo2Level | null = null;
  for (const [from, race] of [['d5kmS', d5km], ['d10kmS', d10km]] as const) {
    if (!race) continue;
    const value = vdotFromRace(DISTANCE_OF[from], race.timeS);
    if (value !== null && (vo2 === null || value > vo2.vo2)) {
      vo2 = { vo2: value, from, session: race.session, standing: vo2maxPercentile(profile.sex, ageAt(profile, race.session.startMs), value) };
    }
  }
  return { d5km, d10km, vo2 };
};

export interface CyclingLevel {
  /** Meilleure puissance estimée sur 20 min de la période, `null` sans elle. */
  best: { session: StatSession; watts: number } | null;
  /** Puissance au seuil rapportée au poids avec lequel elle a été estimée (celui du moment à défaut), `null` sans poids. */
  wkg: number | null;
  /** Niveau du barème, `null` sans W/kg. */
  levelLabel: string | null;
}

/** Niveau à vélo sur les sessions données. */
export const cyclingLevel = (sessions: readonly StatSession[], profile: LevelProfile): CyclingLevel => {
  const found = bestOf(sessions, 'p20minW');
  const best = found ? { session: found.session, watts: found.value } : null;
  const wkg = best ? thresholdWkg(best.watts, best.session.bests?.powerRiderKg ?? profile.weightKg) : null;
  return { best, wkg, levelLabel: wkg === null ? null : powerLevel(profile.sex, wkg) };
};
