import { accumulateElevation } from '../core/elevation';
import { cumulativeDistancesM } from '../core/geo';
import { partitionPoint } from '../core/search';
import { routeProfileRows, type ProfileRow } from '../planning/route';
import type { FollowedTrace } from './followedTrace';

/**
 * Profil d'altitude de la trace suivie, pour son graphe pendant l'enregistrement.
 * Mêmes distances que le suivi (`cumulativeDistancesM`, `followedTraceLengthM`) :
 * un avancement (`FollowProgress.progressM`) se lit tel quel sur le profil.
 *
 * Tout est pur. Unités SI (règle 1) : mètres.
 */

export interface FollowedProfile {
  /** Lignes du profil, à pas régulier (`routeProfileRows`). */
  rows: ProfileRow[];
  /** Distance le long de la trace de chacun de ses points. */
  cumM: number[];
}

/** Il faut deux points à la suite avec une altitude pour tracer quelque chose : une ligne droite n'en a pas, une ancienne trace non plus. */
export const hasFollowedElevation = (trace: FollowedTrace): boolean => {
  const { points } = trace;
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].eleM !== undefined && points[i].eleM !== undefined) return true;
  }
  return false;
};

/** Profils déjà calculés : la trace ne change pas pendant un enregistrement. */
const profileCache = new WeakMap<FollowedTrace, FollowedProfile>();

/** Profil de la trace, calculé une fois par trace. */
export const followedProfile = (trace: FollowedTrace): FollowedProfile => {
  let profile = profileCache.get(trace);
  if (!profile) {
    profile = { rows: routeProfileRows(trace.points), cumM: cumulativeDistancesM(trace.points) };
    profileCache.set(trace, profile);
  }
  return profile;
};

/** Rang de la ligne du profil la plus proche de `alongM` ; 0 sans ligne. */
export const followedRowIndex = (rows: ReadonlyArray<ProfileRow>, alongM: number): number => {
  const next = partitionPoint(rows.length, (i) => rows[i].distM < alongM);
  if (next === 0) return 0;
  if (next === rows.length) return rows.length - 1;
  return alongM - rows[next - 1].distM < rows[next].distM - alongM ? next - 1 : next;
};

/** Altitude à `alongM` mètres le long de la trace, interpolée entre deux points ; `null` si l'un des deux n'en a pas. */
export const followedAltitudeAt = (trace: FollowedTrace, alongM: number): number | null => {
  const { points } = trace;
  const { cumM } = followedProfile(trace);
  const last = points.length - 1;
  if (alongM <= 0) return points[0].eleM ?? null;
  if (alongM >= cumM[last]) return points[last].eleM ?? null;
  const i = partitionPoint(last, (k) => cumM[k + 1] < alongM);
  const { eleM: from } = points[i];
  const { eleM: to } = points[i + 1];
  if (from === undefined || to === undefined) return null;
  const span = cumM[i + 1] - cumM[i];
  return span > 0 ? from + ((to - from) * (alongM - cumM[i])) / span : from;
};

/**
 * Montée restante au-delà de `progressM` : l'altitude à cet endroit puis celle
 * des points suivants, cumulées comme tout dénivelé (`accumulateElevation`).
 * `minGainM` : écart qui confirme une montée, passé par l'appelant (règle 3).
 */
export const remainingGainM = (trace: FollowedTrace, progressM: number, minGainM: number): number => {
  const { cumM } = followedProfile(trace);
  const after = partitionPoint(cumM.length, (i) => cumM[i] <= progressM);
  const altitudes = [followedAltitudeAt(trace, progressM) ?? NaN, ...trace.points.slice(after).map((p) => p.eleM ?? NaN)];
  return accumulateElevation(altitudes, minGainM).gainM;
};
