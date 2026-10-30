import { finiteOr, parseJson } from '../core/basics';
import { BASE_COLOR, baseActivity, findActivity, type Activity } from '../core/activities';
import { readSessionMark, sortMarks, type SessionMark } from '../core/sessionMarks';
import type { SportType } from '../core/types';
import type { LocationFix } from '../platform/location';
import { readSessionTest, type SessionTest } from './fitnessTest';
import { readIntervalRun, type IntervalRun } from './intervalTimer';
import { isSportType } from '../core/sportProfiles';
import type { HeartRateFix } from './session';

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

/**
 * `[heure, lat, lon, précision, altitude, vitesse, cap]`, `null` pour une
 * valeur absente, et la fréquence cardiaque en huitième place quand la
 * ceinture en donne une (les journaux d'avant s'arrêtent au cap).
 */
export const journalFixLine = (fix: LocationFix): string => {
  const line: (number | null)[] = [
    fix.timeMs,
    fix.lat,
    fix.lon,
    fix.accuracyM ?? null,
    fix.altitudeM ?? null,
    fix.speedMs ?? null,
    fix.bearingDeg ?? null,
  ];
  if (fix.heartRateBpm !== undefined) line.push(fix.heartRateBpm);
  return `${JSON.stringify(line)}\n`;
};

/**
 * Mesure de la ceinture d'une session sans position (muscu, lot I du 25/10) :
 * `['hr', heure, FC]`, la FC à `null` pour le point de l'arrêt. Marquée par
 * `'hr'` en tête : ignorée des versions qui ne la connaissent pas (`toFix`
 * exige un nombre en tête).
 */
export const journalHeartRateLine = (fix: HeartRateFix): string =>
  `${JSON.stringify(['hr', fix.timeMs, fix.heartRateBpm ?? null])}\n`;

/**
 * Frontière de segment : une pause, manuelle ou automatique, a repris à cet
 * horodatage. Tableau à deux éléments, marqué par `'break'` en tête : ne
 * collisionne ni avec l'en-tête (un objet), ni avec une position (`toFix`
 * exige au moins trois éléments).
 */
export const journalBreakLine = (timeMs: number): string => `${JSON.stringify(['break', timeMs])}\n`;

/** Activité prise en cours d'enregistrement, avec son calcul. */
export interface JournalActivity {
  sport: SportType;
  activity: { id: string; name: string };
}

/**
 * Changement d'activité pendant l'enregistrement : la session prend cette
 * activité, et son calcul, pour tout son GPX. Tableau à deux éléments, marqué
 * par `'activity'` en tête : ne collisionne ni avec l'en-tête (un objet), ni
 * avec une position (un nombre en tête), ni avec une frontière de segment.
 */
export const journalActivityLine = (sport: SportType, activity: { id: string; name: string }): string =>
  `${JSON.stringify(['activity', { sport, id: activity.id, name: activity.name }])}\n`;

/**
 * Séance du compteur (`intervalTimer.ts`) telle qu'elle est à cet instant,
 * réécrite à chaque commande : pour une même séance (même `startedAtMs`), la
 * dernière ligne l'emporte. Tableau à deux éléments, marqué par
 * `'intervals'` en tête, ignoré par les versions qui ne le connaissent pas.
 */
export const journalIntervalsLine = (run: IntervalRun): string => `${JSON.stringify(['intervals', run])}\n`;

/**
 * Repère posé par le bouton « Note ». Tableau à deux éléments, marqué par
 * `'note'` en tête, ignoré par les versions qui ne le connaissent pas.
 */
export const journalNoteLine = (mark: SessionMark): string => `${JSON.stringify(['note', mark])}\n`;

/**
 * Test guidé (`fitnessTest.ts`) tel qu'il est à cet instant, réécrit à chaque
 * changement de phase et à chaque palier : la dernière ligne l'emporte.
 * Tableau à deux éléments, marqué par `'test'` en tête, ignoré par les
 * versions qui ne le connaissent pas.
 */
export const journalTestLine = (test: SessionTest): string => `${JSON.stringify(['test', test])}\n`;

export interface ParsedJournal {
  /** En-tête, ou `null` s'il manque ou est illisible : les positions restent récupérables. */
  header: JournalHeader | null;
  fixes: LocationFix[];
  /** Indices, dans `fixes`, où reprend un nouveau segment (voir `splitIntoSegments`). */
  breaks: number[];
  /** Mesures de la ceinture d'une session sans position (muscu), dans l'ordre du temps. */
  heartFixes: HeartRateFix[];
  /** Indices, dans `heartFixes`, où reprend un nouveau segment. */
  heartBreaks: number[];
  /** Dernier changement d'activité, qui prime sur l'en-tête ; `null` s'il n'y en a pas eu. */
  activityChange: JournalActivity | null;
  /** Séances du compteur, chacune dans son dernier état, dans l'ordre de leur lancement. */
  intervalRuns: IntervalRun[];
  /** Repères du bouton « Note », dans l'ordre du temps. */
  marks: SessionMark[];
  /** Test guidé, dans son dernier état lisible ; `null` sans test. */
  test: SessionTest | null;
}

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

/** Ligne de changement d'activité : `true` si c'en est une (même abîmée), et l'activité si elle est lisible. */
const toActivityMarker = (value: unknown): { marker: boolean; change: JournalActivity | null } => {
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== 'activity') return { marker: false, change: null };
  const a: unknown = value[1];
  if (typeof a !== 'object' || a === null) return { marker: true, change: null };
  const { sport, id, name } = a as Record<string, unknown>;
  if (!isSportType(sport) || typeof id !== 'string' || id === '' || typeof name !== 'string') return { marker: true, change: null };
  return { marker: true, change: { sport, activity: { id, name } } };
};

/** Ligne de séance du compteur : `true` si c'en est une (même abîmée), et la séance si elle est lisible. */
const toIntervalsMarker = (value: unknown): { marker: boolean; run: IntervalRun | null } =>
  Array.isArray(value) && value.length === 2 && value[0] === 'intervals'
    ? { marker: true, run: readIntervalRun(value[1]) }
    : { marker: false, run: null };

/** Ligne de repère : `true` si c'en est une (même abîmée), et le repère s'il est lisible. */
const toNoteMarker = (value: unknown): { marker: boolean; mark: SessionMark | null } =>
  Array.isArray(value) && value.length === 2 && value[0] === 'note'
    ? { marker: true, mark: readSessionMark(value[1]) }
    : { marker: false, mark: null };

/** Ligne de test : `true` si c'en est une (même abîmée), et le test s'il est lisible. */
const toTestMarker = (value: unknown): { marker: boolean; test: SessionTest | null } =>
  Array.isArray(value) && value.length === 2 && value[0] === 'test'
    ? { marker: true, test: readSessionTest(value[1]) }
    : { marker: false, test: null };

/** Ligne de mesure de la ceinture : `true` si c'en est une (même abîmée), et la mesure si elle est lisible. */
const toHeartMarker = (value: unknown): { marker: boolean; fix: HeartRateFix | null } => {
  if (!Array.isArray(value) || value[0] !== 'hr') return { marker: false, fix: null };
  const timeMs = finiteOr(value[1], undefined);
  if (value.length !== 3 || timeMs === undefined) return { marker: true, fix: null };
  const heartRateBpm = finiteOr(value[2], undefined);
  return { marker: true, fix: heartRateBpm === undefined ? { timeMs } : { timeMs, heartRateBpm } };
};

const toFix = (value: unknown): LocationFix | null => {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [timeMs, lat, lon, accuracyM, altitudeM, speedMs, bearingDeg, heartRateBpm] = value;
  if (finiteOr(timeMs, undefined) === undefined || finiteOr(lat, undefined) === undefined || finiteOr(lon, undefined) === undefined) {
    return null;
  }
  return {
    timeMs,
    lat,
    lon,
    accuracyM: finiteOr(accuracyM, undefined),
    altitudeM: finiteOr(altitudeM, undefined),
    speedMs: finiteOr(speedMs, undefined),
    bearingDeg: finiteOr(bearingDeg, undefined),
    heartRateBpm: finiteOr(heartRateBpm, undefined),
  };
};

/**
 * Relit un journal. Les lignes illisibles sont ignorées, de même qu'une
 * position qui n'est pas plus récente que la précédente, comme à
 * l'enregistrement. Le dernier changement d'activité lisible l'emporte, de
 * même que le dernier état de chaque séance du compteur et du test.
 */
export const parseJournal = (text: string): ParsedJournal => {
  let header: JournalHeader | null = null;
  const fixes: LocationFix[] = [];
  const breaks: number[] = [];
  const heartFixes: HeartRateFix[] = [];
  const heartBreaks: number[] = [];
  let activityChange: JournalActivity | null = null;
  const runs = new Map<number, IntervalRun>();
  const marks: SessionMark[] = [];
  let test: SessionTest | null = null;

  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const value = parseJson(line);
    if (i === 0) {
      header = toHeader(value);
      if (header) return;
    }
    if (toBreakMarker(value)) {
      if (fixes.length > 0) breaks.push(fixes.length);
      if (heartFixes.length > 0) heartBreaks.push(heartFixes.length);
      return;
    }
    const heart = toHeartMarker(value);
    if (heart.marker) {
      const last = heartFixes[heartFixes.length - 1];
      if (heart.fix && (!last || heart.fix.timeMs > last.timeMs)) heartFixes.push(heart.fix);
      return;
    }
    const { marker, change } = toActivityMarker(value);
    if (marker) {
      if (change) activityChange = change;
      return;
    }
    const intervals = toIntervalsMarker(value);
    if (intervals.marker) {
      if (intervals.run) runs.set(intervals.run.startedAtMs, intervals.run);
      return;
    }
    const note = toNoteMarker(value);
    if (note.marker) {
      if (note.mark) marks.push(note.mark);
      return;
    }
    const tested = toTestMarker(value);
    if (tested.marker) {
      if (tested.test) test = tested.test;
      return;
    }
    const fix = toFix(value);
    if (fix && (fixes.length === 0 || fix.timeMs > fixes[fixes.length - 1].timeMs)) fixes.push(fix);
  });

  const intervalRuns = [...runs.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  return { header, fixes, breaks, heartFixes, heartBreaks, activityChange, intervalRuns, marks: sortMarks(marks), test };
};

/**
 * Activité d'un journal relu : celle de la liste si elle existe encore, sinon
 * reconstruite sous le nom gardé dans l'en-tête (la fiche la rangera sous son
 * calcul), sinon l'activité de base du calcul.
 */
export const journalActivity = (sport: SportType, saved: { id: string; name: string } | undefined, activities: Activity[]): Activity => {
  if (!saved) return baseActivity(sport);
  const found = findActivity(activities, saved.id);
  return found && found.base === sport ? found : { id: saved.id, name: saved.name, base: sport, color: BASE_COLOR[sport] };
};
