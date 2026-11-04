import { getSportProfile } from '../core/sportProfiles';
import { isFiniteNumber, isObject } from '../core/basics';
import type { Activity } from '../core/activities';
import type { SportType } from '../core/types';
import type { LibrarySession, SummaryActivitySettings } from './record';
import type { ActivitySummarySettings } from './summaryOptions';

/**
 * Gestes dans Réglages qui changent les résumés (Q57, lot 148) : une session garde le seuil et le foil
 * avec lesquels elle a été calculée (`SummaryActivitySettings`), mêmes chiffres sur tous les appareils, et
 * seul un changement fait sur cet appareil (saisi, repris d'un autre fichier, pré-réglage mis à jour) réécrit
 * les sessions de l'activité. Pur : l'état, rangé par appareil (`tracker.summaryGestures`, ne voyage pas), est
 * lu et écrit par `useSessionLibrary`, qui le compare aux réglages à chaque écriture et à chaque ouverture.
 */

/** Réglages de chaque activité qui changent les résumés, par identifiant. */
export type ActivityValues = Readonly<Record<string, SummaryActivitySettings>>;

export interface SummaryGestures {
  /** Réglages à la dernière comparaison. */
  baseline: ActivityValues;
  /** Par activité, ce que le geste a changé, à appliquer à ses sessions : le recalcul reprend si l'application est fermée avant sa fin. */
  pending: ActivityValues;
}

const NO_VALUES: ActivityValues = {};

/**
 * Réglages qui changent les résumés, pour chaque activité, lus dans Réglages par l'appelant (`read`) : le seuil
 * réglé ou pré-réglé (`undefined` sans l'un ni l'autre) ; le foil en surf seulement, seul calcul dont le résumé en
 * dépend : un foil coché en wing ne réécrit rien.
 */
export const activityValues = (
  activities: readonly Activity[],
  read: (activity: Activity) => ActivitySummarySettings
): ActivityValues =>
  Object.fromEntries(activities.map((activity): [string, SummaryActivitySettings] => {
    const { thresholdOverride, foil } = read(activity);
    return [activity.id, { threshold: thresholdOverride ?? null, ...(getSportProfile(activity.base).surf ? { foil } : {}) }];
  }));

const readValues = (raw: unknown): ActivityValues => {
  if (!isObject(raw)) return NO_VALUES;
  const values: Record<string, SummaryActivitySettings> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry)) continue;
    const { threshold, foil } = entry;
    values[id] = {
      ...(threshold === null || (isFiniteNumber(threshold) && threshold >= 0) ? { threshold } : {}),
      ...(foil === null || typeof foil === 'boolean' ? { foil } : {}),
    };
  }
  return values;
};

/** État rangé relu, `null` s'il manque ou est mal formé : la comparaison repart alors sans geste. */
export const readSummaryGestures = (raw: unknown): SummaryGestures | null => {
  if (!isObject(raw) || !isObject(raw.baseline)) return null;
  return { baseline: readValues(raw.baseline), pending: readValues(raw.pending) };
};

/**
 * Compare les réglages à la dernière comparaison. Sans comparaison passée, ou après des réglages repris d'eux-mêmes
 * (`adopted`, appareil neuf), ils deviennent la référence, sans rien à refaire. Sinon, ce qui a changé pour une
 * activité connue s'ajoute à ce qui attendait ; une activité supprimée sort des deux : ses sessions gardent ce qu'elles portent.
 */
export const noteGestures = (previous: SummaryGestures | null, current: ActivityValues, adopted = false): SummaryGestures => {
  if (!previous) return { baseline: current, pending: NO_VALUES };
  const pending: Record<string, SummaryActivitySettings> = {};
  for (const [id, values] of Object.entries(current)) {
    const before = previous.baseline[id];
    const waiting = previous.pending[id] ?? {};
    const changed: SummaryActivitySettings = { ...waiting };
    if (before && !adopted) {
      if (before.threshold !== values.threshold) changed.threshold = values.threshold;
      if (before.foil !== values.foil && values.foil !== undefined) changed.foil = values.foil;
    }
    if (Object.keys(changed).length > 0) pending[id] = changed;
  }
  return { baseline: current, pending };
};

/** Gestes dont toutes les sessions ont été refaites retirés (`stillWaiting` : l'activité a encore à faire). */
export const settleGestures = (gestures: SummaryGestures, stillWaiting: (activityId: string) => boolean): SummaryGestures => ({
  ...gestures,
  pending: Object.fromEntries(Object.entries(gestures.pending).filter(([id]) => stillWaiting(id))),
});

/**
 * Activités dont un geste attend encore des sessions (lot 113, sorti de la bibliothèque) : celles de chaque session
 * `waiting` (résumé à refaire, ou en échec), sauf en lecture seule ou sans calcul ; `gestureActivity` dit
 * l'activité dont le geste s'applique à une session, `null` si elle n'en suit plus aucun.
 */
export const waitingGestureActivities = (
  sessions: readonly LibrarySession[],
  waiting: (session: LibrarySession) => boolean,
  gestureActivity: (sport: SportType, activityId: string | null | undefined) => string | null
): Set<string> => {
  const ids = new Set<string>();
  for (const session of sessions) {
    const { sport } = session.record;
    if (session.readOnly || sport === null || !waiting(session)) continue;
    const id = gestureActivity(sport, session.record.activityId);
    if (id !== null) ids.add(id);
  }
  return ids;
};
