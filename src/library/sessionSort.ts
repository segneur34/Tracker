import { hasPositions } from '../core/sportProfiles';
import type { LibrarySession } from './record';

/**
 * Tri de la liste des sessions réalisées d'une bibliothèque (lot 109) : toujours
 * du plus grand au plus petit. La valeur vient du résumé de la fiche. Une
 * session sans la valeur (muscu sans distance ni vitesse, résumé inutilisable)
 * passe en fin de liste, rangée par date ; à valeur égale, la plus récente
 * d'abord.
 */

export type SessionSort = 'recent' | 'distance' | 'duration' | 'maxSpeed';

export const SESSION_SORTS: { key: SessionSort; label: string }[] = [
  { key: 'recent', label: 'récentes' },
  { key: 'distance', label: 'distance' },
  { key: 'duration', label: 'durée' },
  { key: 'maxSpeed', label: 'v. max' },
];

export const SESSION_SORT_DEFAULT: SessionSort = 'recent';

export const isSessionSort = (value: unknown): value is SessionSort =>
  SESSION_SORTS.some((s) => s.key === value);

type Sortable = Pick<LibrarySession, 'record'>;

/** Valeur de tri d'une session, `null` si elle n'en a pas pour ce tri. */
const sortValue = (session: Sortable, sort: SessionSort): number | null => {
  const { summary, sport } = session.record;
  let value: number;
  if (sort === 'recent') value = summary.startMs;
  else if (sort === 'duration') value = summary.endMs - summary.startMs;
  else {
    // Sans trace (muscu), ni distance ni vitesse.
    if (sport !== null && !hasPositions(sport)) return null;
    value = sort === 'distance' ? summary.distanceM : summary.maxSpeedMs;
  }
  return Number.isFinite(value) ? value : null;
};

const startOf = (session: Sortable): number => session.record.summary.startMs;

/** Copie de `sessions` rangée selon `sort` ; l'ordre reçu est laissé tel quel pour « récentes » seulement par la date. */
export const sortSessions = <T extends Sortable>(sessions: readonly T[], sort: SessionSort): T[] =>
  sessions
    .map((session) => ({ session, value: sortValue(session, sort) }))
    .sort((a, b) => {
      if (a.value !== null && b.value === null) return -1;
      if (a.value === null && b.value !== null) return 1;
      if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
      return startOf(b.session) - startOf(a.session);
    })
    .map((entry) => entry.session);
