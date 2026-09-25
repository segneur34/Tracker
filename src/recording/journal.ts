import type { SportType } from '../core/types';
import type { LocationFix } from '../platform/location';
import { isSportType } from './session';

/**
 * Journal d'un enregistrement en cours : une ligne JSON par position, ajoutée
 * par paquets. Il ne sert qu'à survivre à un arrêt brutal ; à l'arrêt normal,
 * le GPX est écrit et le journal effacé.
 *
 * Écrit pour être relu même abîmé : l'application peut être tuée au milieu
 * d'une écriture, la dernière ligne est alors tronquée et simplement ignorée.
 * Une position est un tableau court plutôt qu'un objet, pour tenir deux
 * heures à 1 Hz en quelques centaines de kilo-octets.
 */

export interface JournalHeader {
  format: 'tracker-journal';
  version: 1;
  sport: SportType;
  /** Instant du démarrage, en millisecondes. */
  startedAtMs: number;
  /**
   * Activité choisie, avec son nom : une session reconstruite après une
   * suppression de l'activité garde le nom sous lequel elle a été enregistrée.
   * Absente des journaux d'avant les activités.
   */
  activity?: { id: string; name: string };
}

export const journalHeaderLine = (sport: SportType, startedAtMs: number, activity?: { id: string; name: string }): string => {
  const header: JournalHeader = { format: 'tracker-journal', version: 1, sport, startedAtMs };
  if (activity) header.activity = { id: activity.id, name: activity.name };
  return `${JSON.stringify(header)}\n`;
};

/** `[heure, lat, lon, précision, altitude, vitesse, cap]`, `null` pour une valeur absente. */
export const journalFixLine = (fix: LocationFix): string =>
  `${JSON.stringify([
    fix.timeMs,
    fix.lat,
    fix.lon,
    fix.accuracyM ?? null,
    fix.altitudeM ?? null,
    fix.speedMs ?? null,
    fix.bearingDeg ?? null,
  ])}\n`;

/**
 * Frontière de segment : une pause, manuelle ou automatique, a repris à cet
 * horodatage. Tableau à deux éléments, marqué par `'break'` en tête : ne
 * collisionne ni avec l'en-tête (un objet), ni avec une position (`toFix`
 * exige au moins trois éléments).
 */
export const journalBreakLine = (timeMs: number): string => `${JSON.stringify(['break', timeMs])}\n`;

export interface ParsedJournal {
  /** En-tête, ou `null` s'il manque ou est illisible : les positions restent récupérables. */
  header: JournalHeader | null;
  fixes: LocationFix[];
  /** Indices, dans `fixes`, où reprend un nouveau segment (voir `splitIntoSegments`). */
  breaks: number[];
}

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && isFinite(value) ? value : undefined;

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

const toHeader = (value: unknown): JournalHeader | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<JournalHeader>;
  if (v.format !== 'tracker-journal' || !isSportType(v.sport) || typeof v.startedAtMs !== 'number') return null;
  const header: JournalHeader = { format: 'tracker-journal', version: 1, sport: v.sport, startedAtMs: v.startedAtMs };
  const a = v.activity;
  if (typeof a === 'object' && a !== null && typeof a.id === 'string' && a.id !== '' && typeof a.name === 'string') {
    header.activity = { id: a.id, name: a.name };
  }
  return header;
};

const toBreakMarker = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && value[0] === 'break' && typeof value[1] === 'number' && isFinite(value[1]);

const toFix = (value: unknown): LocationFix | null => {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [timeMs, lat, lon, accuracyM, altitudeM, speedMs, bearingDeg] = value;
  if (optionalNumber(timeMs) === undefined || optionalNumber(lat) === undefined || optionalNumber(lon) === undefined) {
    return null;
  }
  return {
    timeMs,
    lat,
    lon,
    accuracyM: optionalNumber(accuracyM),
    altitudeM: optionalNumber(altitudeM),
    speedMs: optionalNumber(speedMs),
    bearingDeg: optionalNumber(bearingDeg),
  };
};

/**
 * Relit un journal. Les lignes illisibles sont ignorées, de même qu'une
 * position qui n'est pas plus récente que la précédente, comme à
 * l'enregistrement.
 */
export const parseJournal = (text: string): ParsedJournal => {
  let header: JournalHeader | null = null;
  const fixes: LocationFix[] = [];
  const breaks: number[] = [];

  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const value = parseLine(line);
    if (i === 0) {
      header = toHeader(value);
      if (header) return;
    }
    if (toBreakMarker(value)) {
      if (fixes.length > 0) breaks.push(fixes.length);
      return;
    }
    const fix = toFix(value);
    if (fix && (fixes.length === 0 || fix.timeMs > fixes[fixes.length - 1].timeMs)) fixes.push(fix);
  });

  return { header, fixes, breaks };
};
