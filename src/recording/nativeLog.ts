import { finiteOr, parseJson } from '../core/basics';
import type { RecordingProfile, SportProfile } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import {
  journalBreakLine, journalFixLine, journalPauseLine, journalResumeLine, journalStopLine, type JournalPause, type ParsedJournal,
} from './journal';
import { judgeSettle } from './gpsSettle';
import { resumedPhase } from './resume';
import { evaluateAutoPause, isNewerFix, roundFix } from './session';

/**
 * Journal des positions tenu par le service du téléphone, et son raccord au journal de la page (lot 232, d'après
 * Gtracker 403 et 417).
 *
 * La page écrit son journal (`recording/journal.ts`) : c'est le registre des décisions (pauses, segments, activité,
 * notes, séances du compteur, test). Mais elle peut manquer des positions : balayée hors des applications récentes,
 * moteur de rendu tombé, messages calés écran éteint, ou simplement la queue de son journal, pas encore écrite
 * (`journalFlushS`). Le service, lui, écrit chaque position reçue, brute, dans son propre fichier. Au retour de la
 * page, `catchUpFromNativeLog` rejoue les positions qui manquent, avec les règles mêmes de la réception en direct
 * (`receiveFix` de `hooks/useRecorder.ts`), et rend les lignes à ajouter au journal de la page. Aucune horloge n'est
 * lue ici : tout se décide sur l'heure des lignes.
 *
 * Seules les sessions à positions ont ce journal : la muscu et la FC de nuit, à la ceinture seule, gardent leur
 * service à elles (`HeartRateService`), sans rattrapage.
 *
 * ## Format du fichier (version 1)
 *
 * Texte UTF-8, une ligne JSON par événement, finie par `\n`, en ajout seul : rien n'est jamais récrit. Chaque ligne
 * est écrite aussitôt, en une fois. Les nombres sont écrits tels que le téléphone les donne, sans arrondi (l'arrondi
 * se fait à la relecture, `roundFix`), jamais `NaN` ni `Infinity` : une valeur absente ou non finie s'écrit `null`.
 *
 * 1. En-tête, première ligne, à la création du fichier :
 *    `{"format":"tracker-positions","version":1,"session":1794819600000}`
 *    `session` : l'identifiant de la session, le `startedAtMs` de l'en-tête du journal de la page, que la page donne
 *    au service au départ. Un fichier laissé par une autre session est remplacé, jamais complété.
 * 2. Position, une ligne par position reçue du téléphone, pause comprise, sans tri ni filtre :
 *    `[heure, latitude, longitude, précision, altitude, vitesse, cap]`
 *    heure de la position en millisecondes depuis 1970 (celle de la position, pas celle de sa réception), latitude et
 *    longitude en degrés, précision et altitude en mètres, vitesse en m/s, cap en degrés. Les trois premiers sont
 *    obligatoires, les quatre autres valent `null` quand le téléphone ne les donne pas. Pas de fréquence cardiaque.
 * 3. Pause manuelle ouverte : `["pause", heure]` ; fermée : `["resume", heure]`. Une ligne à chaque ordre reçu de la
 *    page, même répété. L'heure est celle que la page donne avec l'ordre, la même que celle de sa propre ligne
 *    `pause` ou `resume` : c'est ce qui fait reconnaître un ordre déjà connu de son journal. À défaut, l'horloge du
 *    téléphone.
 * 4. Service relancé sur le fichier de la même session : une ligne vide (`\n` seul, qui isole une dernière ligne
 *    tronquée), puis `["start", heure]`, horloge du téléphone. Ce qui suit ne continue pas ce qui précède.
 * 5. Arrêt par la garde : `["stop", heure, raison]`, horloge du téléphone ; raison `"still"` (resté sur place) ou
 *    `"timeout"` (durée maximale après la fermeture). Dernière ligne du fichier : rien ne s'écrit après.
 *
 * Relecture tolérante : une ligne vide, tronquée (processus tué en pleine écriture), illisible ou inconnue est
 * ignorée, le reste est gardé ; sans en-tête lisible, ou d'une autre version, le fichier entier est écarté. Le
 * lecteur peut ne donner que l'en-tête suivi de la fin du fichier, pourvu qu'elle commence au plus tard à la dernière
 * position qui n'est pas postérieure à la dernière du journal de la page : c'est elle qui prouve que le service a
 * tourné sans interruption jusqu'aux suivantes.
 */

/** Nom du format, écrit dans l'en-tête du fichier : le même que celui du Java qui l'écrit (`FixLog.java`). */
export const NATIVE_LOG_FORMAT = 'tracker-positions';

export const NATIVE_LOG_VERSION = 1;

/** Ce qui a fait arrêter la garde : `still`, resté sur place ; `timeout`, durée maximale après la fermeture. */
export type NativeStopReason = 'still' | 'timeout';

/** Une ligne lisible du journal du service, dans l'ordre du fichier. */
export type NativeLogEntry =
  | { kind: 'fix'; fix: LocationFix }
  | { kind: 'pause'; atMs: number }
  | { kind: 'resume'; atMs: number }
  | { kind: 'start'; atMs: number }
  | { kind: 'stop'; atMs: number; reason: NativeStopReason | null };

export interface NativeLog {
  /** Identifiant de la session : le `startedAtMs` de l'en-tête du journal de la page. */
  session: number;
  entries: NativeLogEntry[];
}

const toSession = (value: unknown): number | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { format, version, session } = value as Record<string, unknown>;
  return format === NATIVE_LOG_FORMAT && version === NATIVE_LOG_VERSION ? finiteOr(session, null) : null;
};

const toEntry = (value: unknown): NativeLogEntry | null => {
  if (!Array.isArray(value)) return null;
  const [head, second, third] = value as unknown[];
  if (typeof head === 'string') {
    const atMs = finiteOr(second, null);
    if (atMs === null) return null;
    if (head === 'pause' || head === 'resume' || head === 'start') return { kind: head, atMs };
    if (head === 'stop') return { kind: 'stop', atMs, reason: third === 'still' || third === 'timeout' ? third : null };
    return null;
  }
  const [, , , accuracyM, altitudeM, speedMs, bearingDeg] = value as unknown[];
  const timeMs = finiteOr(head, null);
  const lat = finiteOr(second, null);
  const lon = finiteOr(third, null);
  if (timeMs === null || lat === null || lon === null) return null;
  return {
    kind: 'fix',
    fix: {
      timeMs, lat, lon,
      accuracyM: finiteOr(accuracyM, undefined),
      altitudeM: finiteOr(altitudeM, undefined),
      speedMs: finiteOr(speedMs, undefined),
      bearingDeg: finiteOr(bearingDeg, undefined),
    },
  };
};

/**
 * Relit le journal du service. `null` sans en-tête lisible en première ligne (fichier absent, vide, abîmé ou d'une
 * autre version) ; sinon toutes les lignes lisibles, dans l'ordre du fichier, les autres ignorées.
 */
export const parseNativeLog = (text: string | null): NativeLog | null => {
  if (text === null) return null;
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;
  const session = toSession(parseJson(lines[0]));
  if (session === null) return null;
  const entries: NativeLogEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const entry = toEntry(parseJson(lines[i]));
    if (entry) entries.push(entry);
  }
  return { session, entries };
};

/** Ce que le rattrapage lit du journal de la page, relu par `parseJournal`. */
export type CatchUpJournal = Pick<ParsedJournal, 'header' | 'fixes' | 'breaks' | 'openPause' | 'resumedPause' | 'stoppedAtMs' | 'lastLineMs'>;

/**
 * Réglages du rattrapage : pause automatique et calage du GPS de l'activité en cours (`RecordingProfile`, celui que la
 * réception en direct lit, `effectiveRecordingProfile`), et trou de la trace de son calcul (`SportProfile.maxGapS`).
 */
export type CatchUpSettings = Pick<RecordingProfile, 'autoPauseSpeedMs' | 'autoPauseDelayS' | 'settleAccuracyM' | 'settleMaxWaitS'>
  & Pick<SportProfile, 'maxGapS'>;

/** Où en est l'enregistrement après le rattrapage : ce que la page aurait en mémoire si elle avait tout reçu en direct. */
export interface CatchUpPhase {
  /** Pause manuelle encore ouverte : rien n'est gardé jusqu'à sa levée ; `null` sinon. */
  manualPause: JournalPause | null;
  /** Pause automatique en cours : l'heure de la position qui l'a déclenchée ; `null` sinon. */
  autoPausedSinceMs: number | null;
  /** Ancre de la pause automatique (`evaluateAutoPause`), à rendre à la position suivante. */
  belowSinceMs: number | null;
  /** La prochaine position gardée ouvre un segment. */
  pendingBreak: boolean;
  /** La prochaine position gardée clôt une pause manuelle déjà levée : la part à garder de son écart ; `null` sinon. */
  manualBreakAutoPartMs: number | null;
  /** Heure de la dernière position connue, gardée ou non : une position reçue ensuite doit lui être postérieure. */
  lastReceivedMs: number | null;
  /**
   * Le GPS se calait encore à la dernière position rejouée (`judgeSettle`) : l'heure de la première position vue, à
   * reprendre par la réception en direct ; `null` dès qu'une position est gardée, ou sans position jugée.
   */
  settleFirstMs: number | null;
}

export interface NativeCatchUp {
  /** Faux si le journal du service manque, est illisible ou vient d'une autre session : rien n'est rattrapé. */
  matched: boolean;
  /** Lignes à ajouter au journal de la page, dans l'ordre, chacune finie par son saut de ligne. */
  lines: string[];
  /** Nombre de positions gardées parmi ces lignes. */
  keptCount: number;
  /** Heure de la dernière position du service rejouée, gardée ou non ; `null` si aucune ne l'a été. */
  caughtUpToMs: number | null;
  /** Arrêt par la garde lu dans le journal du service, que sa ligne `stop` soit ajoutée ici ou déjà au journal ; `null` sinon. */
  guardStop: { atMs: number; reason: NativeStopReason | null } | null;
  phase: CatchUpPhase;
}

const lastFixMs = (journal: CatchUpJournal): number | null =>
  journal.fixes.length > 0 ? journal.fixes[journal.fixes.length - 1].timeMs : null;

/** Sans journal du service : la coupure est une frontière de segment, et rien n'est su de la pause automatique. */
const withoutNativeLog = (journal: CatchUpJournal): NativeCatchUp => {
  const phase = resumedPhase(journal);
  return {
    matched: false, lines: [], keptCount: 0, caughtUpToMs: null, guardStop: null,
    phase: {
      manualPause: journal.openPause,
      autoPausedSinceMs: null,
      belowSinceMs: null,
      pendingBreak: phase.pendingBreak,
      manualBreakAutoPartMs: phase.manualBreakAutoPartMs,
      lastReceivedMs: lastFixMs(journal),
      settleFirstMs: null,
    },
  };
};

/**
 * Ancre de la pause automatique à la dernière position du journal. Elle était gardée, donc hors pause, et toute
 * position jugée hors pause depuis le début de son segment l'a été aussi : rejouer ce segment redonne l'ancre. Une
 * frontière écrite sans sa position (dernière ligne perdue) n'ouvre encore aucun segment.
 */
const belowSinceAtEnd = (journal: CatchUpJournal, auto: { speedMs: number; delayS: number }): number | null => {
  const { fixes, breaks } = journal;
  let from = 0;
  for (const index of breaks) if (index < fixes.length && index > from) from = index;
  let belowSinceMs: number | null = null;
  for (let i = from; i < fixes.length; i++) belowSinceMs = evaluateAutoPause(false, belowSinceMs, fixes[i], auto).belowSinceMs;
  return belowSinceMs;
};

/**
 * Première ligne du journal du service à rejouer. Tout ce qui précède la dernière position déjà au journal de la page
 * est connu d'elle. De même ce qui précède le dernier ordre de pause que son journal porte déjà : après une ligne
 * `pause` ou `resume` sans position gardée depuis, l'heure de sa dernière ligne est une heure d'horloge, et un ordre
 * du service qui ne lui est pas postérieur est le sien. Une levée qui vient en premier après une pause déjà levée au
 * journal est celle du journal, même à quelques millisecondes d'écart.
 */
const replayStart = (journal: CatchUpJournal, entries: NativeLogEntry[], lastMs: number | null): { from: number; anchored: boolean } => {
  let firstNew = entries.length;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.kind === 'fix' && (lastMs === null || entry.fix.timeMs > lastMs)) {
      firstNew = i;
      break;
    }
  }
  let lastOld = -1;
  for (let i = firstNew - 1; i >= 0 && lastOld < 0; i--) if (entries[i].kind === 'fix') lastOld = i;
  let from = lastOld + 1;
  const knownUntilMs = journal.openPause || journal.resumedPause ? journal.lastLineMs : null;
  if (knownUntilMs !== null) {
    for (let i = entries.length - 1; i >= from; i--) {
      const entry = entries[i];
      if ((entry.kind === 'pause' || entry.kind === 'resume') && entry.atMs <= knownUntilMs) {
        from = i + 1;
        break;
      }
    }
  }
  if (journal.resumedPause) {
    const start = from;
    const next = entries.findIndex((entry, i) => i >= start && (entry.kind === 'pause' || entry.kind === 'resume'));
    if (next >= 0 && entries[next].kind === 'resume') from = next + 1;
  }
  return { from, anchored: lastOld >= 0 };
};

/**
 * Rattrape, depuis le journal du service, les positions que le journal de la page n'a pas : celles strictement
 * postérieures à sa dernière. Elles sont rejouées dans l'ordre du fichier comme la page les aurait reçues : arrondies
 * (`roundFix`), sans fréquence cardiaque (la ceinture ne mesure pas application fermée), rien de gardé pendant une
 * pause manuelle, calage du GPS au départ tant que le journal de la page n'a aucune position (`judgeSettle`), pause
 * automatique jugée sur l'heure des positions, frontière de segment à la reprise d'une pause. Les ordres de pause que
 * le journal de la page a perdus y sont écrits, avec leur heure ; l'arrêt par la garde y devient sa ligne `stop`, et
 * rien n'est gardé après lui.
 *
 * Aucune frontière au raccord quand le service a tourné sans interruption : son journal porte encore une position
 * déjà connue de la page, et un silence du GPS reste un trou de la trace, comme en direct. Faute de cette preuve, un
 * écart de plus de `maxGapS` ouvre un segment ; un service relancé (`start`) aussi. Journal du service absent ou d'une
 * autre session : rien n'est ajouté, et la coupure reste une frontière de segment (`resumedPhase`).
 *
 * Rejoué sur le journal ainsi complété, il ne rend plus aucune ligne, et la même `phase`.
 */
export const catchUpFromNativeLog = (journal: CatchUpJournal, log: NativeLog | null, settings: CatchUpSettings): NativeCatchUp => {
  if (log === null || journal.header === null || journal.header.startedAtMs !== log.session) return withoutNativeLog(journal);

  const auto = { speedMs: settings.autoPauseSpeedMs, delayS: settings.autoPauseDelayS };
  const { entries } = log;
  const lastMs = lastFixMs(journal);
  const { from, anchored } = replayStart(journal, entries, lastMs);

  const lines: string[] = [];
  let keptCount = 0;
  let caughtUpToMs: number | null = null;
  let guardStop: NativeCatchUp['guardStop'] = null;
  let manualPause = journal.openPause;
  let autoPausedSinceMs: number | null = null;
  let belowSinceMs = manualPause || journal.resumedPause ? null : belowSinceAtEnd(journal, auto);
  let pendingBreak = journal.resumedPause !== null;
  let manualBreakAutoPartMs = journal.resumedPause?.autoPartMs ?? null;
  let lastReceivedMs = lastMs;
  // Rien ne prouve encore que le service tournait à la dernière position du journal : l'écart jusqu'à la suivante en jugera.
  let unprovenFromMs = anchored ? null : lastMs;
  // Calage du GPS au départ, comme en direct, tant que le journal de la page n'a aucune position : ancré sur la
  // première position du service jugée, il ne joue plus après la première calée.
  let settling = lastMs === null;
  let settleFirstMs: number | null = null;

  for (let i = from; i < entries.length && guardStop === null; i++) {
    const entry = entries[i];
    if (entry.kind === 'stop') {
      guardStop = { atMs: entry.atMs, reason: entry.reason };
      if (journal.stoppedAtMs === null) lines.push(journalStopLine(entry.atMs));
    } else if (entry.kind === 'start') {
      // Service relancé : la suite ne continue pas la trace, et la pause automatique repart de rien.
      if (lastReceivedMs !== null) pendingBreak = true;
      autoPausedSinceMs = null;
      belowSinceMs = null;
      unprovenFromMs = null;
    } else if (entry.kind === 'pause') {
      if (manualPause) continue;
      // Depuis une pause automatique, celle-ci reste comptée dans la durée.
      manualPause = { atMs: entry.atMs, autoPartMs: Math.max(0, entry.atMs - (autoPausedSinceMs ?? entry.atMs)) };
      autoPausedSinceMs = null;
      belowSinceMs = null;
      lines.push(journalPauseLine(manualPause.atMs, manualPause.autoPartMs));
    } else if (entry.kind === 'resume') {
      if (!manualPause) continue;
      lines.push(journalResumeLine(entry.atMs));
      pendingBreak = true;
      manualBreakAutoPartMs = manualPause.autoPartMs;
      manualPause = null;
      belowSinceMs = null;
    } else {
      const fix = roundFix(entry.fix);
      if (!isNewerFix(lastReceivedMs, fix)) continue;
      if (unprovenFromMs !== null && fix.timeMs - unprovenFromMs > settings.maxGapS * 1000) pendingBreak = true;
      unprovenFromMs = null;
      lastReceivedMs = fix.timeMs;
      caughtUpToMs = fix.timeMs;
      // « Arrêter » déjà au journal : ce que le service a encore reçu ensuite n'est pas de la session.
      if (journal.stoppedAtMs !== null && fix.timeMs > journal.stoppedAtMs) continue;
      if (manualPause) continue;
      if (settling) {
        const verdict = judgeSettle(settleFirstMs, fix, settings);
        settleFirstMs = verdict.settled ? null : verdict.firstSeenMs;
        if (!verdict.settled) continue;
        settling = false;
      }
      const judged = evaluateAutoPause(autoPausedSinceMs !== null, belowSinceMs, fix, auto);
      belowSinceMs = judged.belowSinceMs;
      if (judged.event === 'pause') {
        autoPausedSinceMs = fix.timeMs;
        continue;
      }
      if (judged.event === 'resume') {
        pendingBreak = true;
        autoPausedSinceMs = null;
      }
      if (autoPausedSinceMs !== null) continue;
      if (pendingBreak) {
        lines.push(journalBreakLine(fix.timeMs));
        pendingBreak = false;
      }
      lines.push(journalFixLine(fix));
      manualBreakAutoPartMs = null;
      keptCount++;
    }
  }
  // Aucune position après la dernière du journal, et rien qui prouve que le service tournait : la suivante ouvre un segment.
  if (unprovenFromMs !== null && manualPause === null) pendingBreak = true;

  return {
    matched: true, lines, keptCount, caughtUpToMs, guardStop,
    phase: { manualPause, autoPausedSinceMs, belowSinceMs, pendingBreak, manualBreakAutoPartMs, lastReceivedMs, settleFirstMs },
  };
};

/**
 * Texte du journal de la page complété des lignes rattrapées, tel qu'il sera relu. Un saut de ligne d'abord quand le
 * texte n'en finit pas : il isole une dernière ligne tronquée par la coupure.
 */
export const withCaughtUpLines = (journalText: string, lines: ReadonlyArray<string>): string =>
  lines.length === 0 ? journalText : `${journalText}${journalText === '' || journalText.endsWith('\n') ? '' : '\n'}${lines.join('')}`;
