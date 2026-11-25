import { finiteOr, parseJson } from '../core/basics';
import { BASE_COLOR, baseActivity, findActivity, type Activity } from '../core/activities';
import { readSessionMark, sortMarks, type SessionMark } from '../core/sessionMarks';
import type { SportType } from '../core/types';
import { beltEntry, isBelt } from '../platform/beltList';
import type { HeartRateBelt } from '../platform/heartRate';
import type { LocationFix } from '../platform/location';
import type { MotionSetup } from '../platform/motion';
import { readSessionTest, type SessionTest } from './fitnessTest';
import { readIntervalRun, type IntervalRun } from './intervalTimer';
import { isJumpPlacement } from './jumpSettings';
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
  /**
   * Muscu partie sans la ceinture (lot 210) : des points d'heure seule, un par
   * seconde, que la reprise relance. Absent : avec la ceinture (les journaux
   * d'avant compris).
   */
  withoutBelt?: true;
  /**
   * Ceinture cardio demandée au départ d'une session à positions, `null` si le
   * départ s'est fait sans : après une coupure, c'est elle qui est redemandée,
   * quel que soit le réglage de l'activité. Absente des journaux d'avant, qui
   * ne la gardaient pas.
   */
  belt?: HeartRateBelt | null;
  /**
   * Réglages de la capture des capteurs demandée au départ, `null` si le départ
   * s'est fait sans : après une coupure, c'est elle qui est relancée, en
   * complétant son fichier. Absents des journaux d'avant.
   */
  motion?: MotionSetup | null;
}

/** Ce que l'en-tête garde du départ, en plus du calcul et de l'activité ; une entrée `undefined` n'est pas écrite. */
export interface JournalHeaderExtras {
  /** Muscu partie sans la ceinture (lot 210). */
  withoutBelt?: boolean;
  /** Ceinture demandée au départ, `null` sans ceinture. */
  belt?: HeartRateBelt | null;
  /** Réglages de la capture des capteurs, `null` sans capture. */
  motion?: MotionSetup | null;
}

export const journalHeaderLine = (
  sport: SportType, startedAtMs: number, activity?: { id: string; name: string }, extras: JournalHeaderExtras = {}
): string => {
  const header: JournalHeader = { format: 'tracker-journal', version: 1, sport, startedAtMs };
  if (activity) header.activity = { id: activity.id, name: activity.name };
  if (extras.withoutBelt) header.withoutBelt = true;
  if (extras.belt !== undefined) header.belt = extras.belt && beltEntry(extras.belt);
  if (extras.motion !== undefined) header.motion = extras.motion && copyMotion(extras.motion);
  return `${JSON.stringify(header)}\n`;
};

/** Les réglages de la capture réduits à ce que le journal en garde : les quatre de `MotionSetup`. */
const copyMotion = (motion: MotionSetup): MotionSetup => ({
  placement: motion.placement, foil: motion.foil, jumps: motion.jumps, cadence: motion.cadence,
});

/** Ceinture lue dans un en-tête : `null` si c'est écrit, `undefined` si elle manque ou est abîmée. */
const toBelt = (value: unknown): HeartRateBelt | null | undefined => {
  if (value === null) return null;
  return isBelt(value) && value.address !== '' ? beltEntry(value) : undefined;
};

/** Réglages de la capture lus dans un en-tête : `null` si c'est écrit, `undefined` s'ils manquent ou sont abîmés. */
const toMotion = (value: unknown): MotionSetup | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const { placement, foil, jumps, cadence } = value as Record<string, unknown>;
  if (!isJumpPlacement(placement) || typeof foil !== 'boolean' || typeof jumps !== 'boolean' || typeof cadence !== 'boolean') return undefined;
  return { placement, foil, jumps, cadence };
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

/**
 * Pause manuelle à l'heure de l'horloge `atMs`, écrite tout de suite : une reprise après une chute du moteur
 * (`recording/resume.ts`) en recompte la durée. `autoPartMs` : ce qui en a été passé en pause automatique avant
 * l'appui, et qui reste compté ; absent si rien. Marquée par `'pause'` en tête, ignorée des anciennes versions.
 */
export const journalPauseLine = (atMs: number, autoPartMs = 0): string =>
  `${JSON.stringify(autoPartMs > 0 ? ['pause', atMs, autoPartMs] : ['pause', atMs])}\n`;

/** Fin d'une pause manuelle : sans elle, une reprise juste après croirait la session encore en pause. */
export const journalResumeLine = (atMs: number): string => `${JSON.stringify(['resume', atMs])}\n`;

/** « Arrêter » : la session attend sa décision, jamais de reprise ni d'offre de continuer. */
export const journalStopLine = (atMs: number): string => `${JSON.stringify(['stop', atMs])}\n`;

/**
 * Ceinture de la session : `'stopped'` quand l'utilisateur cesse de la chercher en route (une reprise seule ne la
 * redemande pas) ; `'asked'` quand « Continuer l'enregistrement » ou « Reprendre la ceinture » la redemande. Les
 * autres ne servent qu'à comprendre une panne après coup (lot 232) : `'retry'`, un appui sur « Réessayer », puis son
 * résultat, `'found'` (vue par la recherche), `'missed'` (pas vue) ou `'failed'` (refusé : Bluetooth éteint,
 * permission). Marquée par `'belt'` en tête, ignorée des anciennes versions.
 */
export type JournalBeltEvent = 'stopped' | 'asked' | 'retry' | 'found' | 'missed' | 'failed';

/**
 * GPS de la session, pour comprendre une panne après coup (lot 232) : `'retry'`, un appui sur « Réessayer », puis son
 * résultat, `'assisted'` (le téléphone a pris la demande de recharger ses données d'aide) ou `'unassisted'` (rien
 * envoyé : navigateur, téléphone qui refuse) ; `'settings'`, un appui sur « Activer la localisation ». Rien n'en
 * dépend à la relecture. Marquée par `'gps'` en tête, ignorée des anciennes versions.
 */
export type JournalGpsEvent = 'retry' | 'assisted' | 'unassisted' | 'settings';

export const journalGpsLine = (atMs: number, what: JournalGpsEvent): string => `${JSON.stringify(['gps', atMs, what])}\n`;

export const journalBeltLine = (atMs: number, what: JournalBeltEvent): string => `${JSON.stringify(['belt', atMs, what])}\n`;

/** Pause manuelle d'un journal relu : son instant, et sa part déjà passée en pause automatique (qui reste comptée). */
export interface JournalPause {
  atMs: number;
  autoPartMs: number;
}

/** Frontière de segment qui clôt une pause manuelle : l'indice du point dans chaque liste, et la part à garder. */
export interface ManualBreak {
  fixIndex: number;
  heartIndex: number;
  autoPartMs: number;
}

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
  /** Frontières qui closent une pause manuelle : leur écart n'est pas de la durée. */
  manualBreaks: ManualBreak[];
  /** Pause manuelle encore en cours à la fin du journal, `null` sinon. */
  openPause: JournalPause | null;
  /** Pause manuelle levée sans point gardé depuis : le suivant la clôt. `null` sinon. */
  resumedPause: JournalPause | null;
  /** Instant de « Arrêter », `null` si la session n'a pas été arrêtée. */
  stoppedAtMs: number | null;
  /** Vrai si l'utilisateur a cessé de chercher la ceinture en route, et que rien ne l'a redemandée depuis. */
  beltStopped: boolean;
  /** Heure de la dernière ligne lisible qui en porte une ; `null` sans aucune. */
  lastLineMs: number | null;
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
  if (v.withoutBelt === true) header.withoutBelt = true;
  const belt = toBelt(v.belt);
  if (belt !== undefined) header.belt = belt;
  const motion = toMotion(v.motion);
  if (motion !== undefined) header.motion = motion;
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

/** Ligne `[marque, heure, ...]` : son heure si `value` en est une et qu'elle est lisible. */
const timedMarker = (value: unknown, marker: string): number | null =>
  Array.isArray(value) && value[0] === marker && typeof value[1] === 'number' && isFinite(value[1]) ? value[1] : null;

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
  const markTimes = new Set<number>();
  const breakTimes = new Set<number>();
  let test: SessionTest | null = null;
  const manualBreaks: ManualBreak[] = [];
  let openPause: JournalPause | null = null;
  let resumedPause: JournalPause | null = null;
  let stoppedAtMs: number | null = null;
  let beltStopped = false;
  let lastLineMs: number | null = null;

  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const value = parseJson(line);
    if (i === 0) {
      const read = toHeader(value);
      header = read;
      if (read) {
        lastLineMs = read.startedAtMs;
        return;
      }
    }
    const breakAt = toBreakMarker(value) ? timedMarker(value, 'break') : null;
    if (breakAt !== null) {
      lastLineMs = breakAt;
      // Une coupure porte l'heure du point qui ouvre son segment : deux à la même heure, c'est un bloc réécrit après
      // une écriture qui n'a pas abouti (`flushJournal`), dont le point a déjà été écarté ; la reprendre poserait la
      // coupure plus loin.
      const replayed = breakTimes.has(breakAt);
      breakTimes.add(breakAt);
      const pause: JournalPause | null = resumedPause ?? openPause;
      if (pause && !replayed) manualBreaks.push({ fixIndex: fixes.length, heartIndex: heartFixes.length, autoPartMs: pause.autoPartMs });
      resumedPause = null;
      openPause = null;
      if (fixes.length > 0 && !replayed) breaks.push(fixes.length);
      if (heartFixes.length > 0 && !replayed) heartBreaks.push(heartFixes.length);
      return;
    }
    const pauseAt = timedMarker(value, 'pause');
    if (pauseAt !== null) {
      lastLineMs = pauseAt;
      openPause = { atMs: pauseAt, autoPartMs: Math.max(0, finiteOr((value as unknown[])[2], 0)) };
      resumedPause = null;
      return;
    }
    const resumeAt = timedMarker(value, 'resume');
    if (resumeAt !== null) {
      lastLineMs = resumeAt;
      resumedPause = openPause ?? resumedPause;
      openPause = null;
      return;
    }
    const stopAt = timedMarker(value, 'stop');
    if (stopAt !== null) {
      lastLineMs = stopAt;
      stoppedAtMs = stopAt;
      return;
    }
    const beltAt = timedMarker(value, 'belt');
    if (beltAt !== null) {
      lastLineMs = beltAt;
      const what = (value as unknown[])[2];
      if (what === 'stopped' || what === 'asked') beltStopped = what === 'stopped';
      return;
    }
    const gpsAt = timedMarker(value, 'gps');
    if (gpsAt !== null) {
      lastLineMs = gpsAt;
      return;
    }
    const heart = toHeartMarker(value);
    if (heart.marker) {
      const last = heartFixes[heartFixes.length - 1];
      if (heart.fix && (!last || heart.fix.timeMs > last.timeMs)) {
        heartFixes.push(heart.fix);
        lastLineMs = heart.fix.timeMs;
        // Un point gardé prouve la fin de la pause, même si sa ligne s'est perdue.
        openPause = null;
        resumedPause = null;
      }
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
      if (note.mark) {
        // Un seul repère par instant : le même, relu deux fois, vient d'un bloc réécrit.
        if (!markTimes.has(note.mark.timeMs)) marks.push(note.mark);
        markTimes.add(note.mark.timeMs);
        lastLineMs = note.mark.timeMs;
      }
      return;
    }
    const tested = toTestMarker(value);
    if (tested.marker) {
      if (tested.test) test = tested.test;
      return;
    }
    const fix = toFix(value);
    if (fix && (fixes.length === 0 || fix.timeMs > fixes[fixes.length - 1].timeMs)) {
      fixes.push(fix);
      lastLineMs = fix.timeMs;
      openPause = null;
      resumedPause = null;
    }
  });

  const intervalRuns = [...runs.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  return {
    header, fixes, breaks, heartFixes, heartBreaks, activityChange, intervalRuns, marks: sortMarks(marks), test,
    manualBreaks, openPause, resumedPause, stoppedAtMs, beltStopped, lastLineMs,
  };
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

/**
 * Activité de la session d'un journal relu (`journalActivity`) : une activité choisie en cours de route prime sur
 * celle du départ ; `null` sans calcul lisible, la session sera rangée « à classer ».
 */
export const journalSessionActivity = (parsed: Pick<ParsedJournal, 'header' | 'activityChange'>, activities: Activity[]): Activity | null => {
  const sport = parsed.activityChange?.sport ?? parsed.header?.sport ?? null;
  return sport === null ? null : journalActivity(sport, parsed.activityChange?.activity ?? parsed.header?.activity, activities);
};
