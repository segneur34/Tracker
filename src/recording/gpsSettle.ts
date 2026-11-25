import type { RecordingProfile } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';

/**
 * Calage du GPS au départ d'un enregistrement (lot 232, d'après Gtracker 417). Les premières positions d'un GPS qui
 * vient de s'allumer peuvent être loin de la vraie, de quelques dizaines de mètres, et s'en rapprocher en quelques
 * secondes : sans vitesse donnée par le GPS, la vitesse tirée de ces positions part d'un pic, qui fausse la vitesse
 * maximale et la distance, et la trace commence par un trait droit. Tant que le GPS se cale, la trace ne commence
 * pas : la position reçue ne sert qu'à la carte. Elle démarre à la première position jugée calée, sur son incertitude
 * et sur le temps écoulé, jamais sur un nombre de positions (la cadence varie : une seule position peut couvrir tout
 * le délai). Le calage ne vaut qu'au départ : une fois une position gardée, il ne joue plus.
 */

/** Seuils du calage, dans le profil d'enregistrement (`RecordingProfile`). */
export type GpsSettleSettings = Pick<RecordingProfile, 'settleAccuracyM' | 'settleMaxWaitS'>;

/** Verdict sur une position reçue pendant le calage : calée ou non, et l'heure de la première position vue, à garder. */
export interface SettleVerdict {
  settled: boolean;
  /** Heure de la première position vue pendant ce calage, en millisecondes : à rendre au jugement suivant. */
  firstSeenMs: number;
}

/**
 * Juge une position reçue tant qu'aucune n'est gardée. `firstSeenMs` : l'heure de la première position vue pendant ce
 * calage, `null` pour la première. Calée si son incertitude est d'au plus `settleAccuracyM`, si elle n'en porte aucune
 * (rejeu d'un fichier : rien ne permet d'en juger, elle est gardée comme avant), ou si `settleMaxWaitS` secondes se
 * sont écoulées depuis la première, à l'heure des positions (`settleMaxWaitS` à 0 : aucun calage).
 */
export const judgeSettle = (
  firstSeenMs: number | null,
  fix: Pick<LocationFix, 'timeMs' | 'accuracyM'>,
  settings: GpsSettleSettings
): SettleVerdict => {
  const first = firstSeenMs ?? fix.timeMs;
  const settled = fix.accuracyM === undefined
    || fix.accuracyM <= settings.settleAccuracyM
    || fix.timeMs - first >= settings.settleMaxWaitS * 1000;
  return { settled, firstSeenMs: first };
};

/**
 * Positions d'un départ, celles d'avant le calage retirées : la trace commence à la première position jugée calée,
 * et toutes les suivantes sont gardées, quelle que soit leur incertitude. Le même juge que l'enregistreur, sur une
 * suite entière.
 */
export const fromSettledStart = <F extends Pick<LocationFix, 'timeMs' | 'accuracyM'>>(
  fixes: ReadonlyArray<F>,
  settings: GpsSettleSettings
): F[] => {
  let firstSeenMs: number | null = null;
  for (let i = 0; i < fixes.length; i++) {
    const verdict = judgeSettle(firstSeenMs, fixes[i], settings);
    if (verdict.settled) return fixes.slice(i);
    firstSeenMs = verdict.firstSeenMs;
  }
  return [];
};
