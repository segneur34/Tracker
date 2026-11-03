import { useRef, useSyncExternalStore } from 'react';
import { baseActivity, sessionActivity, type Activity } from '../core/activities';
import { parseGpx } from '../core/gpxParser';
import { decodeImuHeader } from '../core/imuFile';
import { pruneImuFile } from '../core/imuPrune';
import { JUMPS_CALC_VERSION } from '../core/jumps';
import { keepsWholeCaptureForPumping } from '../core/pumping';
import { pruneSurfImu } from '../surfing/imuPrune';
import type { SessionMark } from '../core/sessionMarks';
import { getSportProfile, sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import {
  MARKER_FILE,
  README_FILE,
  SESSIONS_DIR,
  SETTINGS_DIR,
  SETTINGS_FILE,
  markerText,
  readmeText,
  sessionPath,
  settingsPath,
} from '../library/folderLayout';
import { uniqueSessionFileName } from '../library/naming';
import { describeImport, type ImportReport } from '../library/importReport';
import {
  RECORD_FORMAT,
  RECORD_LIGHT_FIELDS_KEY,
  RECORD_VERSION,
  applyRecordPatch,
  carryRecordEdits,
  completeRecord,
  dedupeSessions,
  findLegacyNotes,
  imuFileName,
  isBlankGpxText,
  isGpxFileName,
  isWritableRecord,
  lightRecord,
  mergeLightRecord,
  parseRecordWithRaw,
  readAnalysis,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type ParsedRecord,
  type RecordPatch,
  type RecordUnreadable,
  type RecordWithoutSummary,
  type SessionAnalysis,
  type SessionRecord,
  type SessionSource,
  type SessionSummary,
} from '../library/record';
import { indexByRecordName, lowerRecordExtension, planReconcile, type LibraryCache } from '../library/reconcile';
import { unbundleSessionGpx } from '../library/sessionBundle';
import { isCompleteGpxText, planPendingTemps } from '../library/pendingTemps';
import {
  TRAVELLING_KEYS,
  adoptedValues,
  buildSettingsFile,
  checkedValues,
  chooseSettings,
  cleanDeviceName,
  deviceFileName,
  freeDeviceName,
  importedSettingsFileName,
  newestSettingsEntry,
  ownSettingsEntry,
  parseSettingsFile,
  serializeSettingsFile,
  settingsActivityCount,
  settingsEntryKey,
  settingsEntryName,
  settingsSignature,
  unseenSettingsEntries,
  type SettingsEntry,
} from '../library/settingsFile';
import { surfRides } from '../library/summary';
import {
  analyzeGpx, isSummaryOutdated, outdatedRefreshFiles, summaryOptions, withSummary, type ActivitySummarySettings, type AnalyzedGpx,
} from '../library/summaryOptions';
import { readPickedBytes, readPickedFile } from '../platform/files';
import {
  FolderRefusedError,
  canChooseFolder,
  chooseMemoryFolder,
  forgetChosenFolder,
  openMemoryFolder,
  pendingFolder,
  pickFolderToImport,
  reconnectMemoryFolder,
  type FolderEntry,
  type ImportEntry,
  type MemoryFolder,
  type MemoryKind,
} from '../platform/memoryFolder';
import { isNativeApp } from '../platform/runtime';
import { jsonStore, storageStartupFailure } from '../platform/storage';
import type { IntervalSeries } from '../recording/intervalTimer';
import type { SessionTest } from '../recording/fitnessTest';
import { sessionFileName } from '../recording/session';
import { effectiveFoil, effectivePumping, effectiveThresholdOverride, readStoredActivities, subscribeStoredSettings } from './useSportSettings';
import { createListeners } from './createStore';
import { errorMessage, finiteOr, newId, plural } from '../core/basics';

/**
 * Bibliothèque des sessions : la mémoire de l'application, tenue dans un
 * dossier qu'on copie pour la sauvegarder ou la déplacer
 * (`docs/ETAT_DU_PROJET.md` §6). Elle vit hors des composants, comme
 * l'enregistreur : les pages la lisent par `useSessionLibrary` et la pilotent
 * par les fonctions exportées.
 *
 * Au lancement (`openLibrary`) :
 * 1. le dossier mémoire est ouvert, et reçoit son marqueur et son
 *    `LISEZMOI.txt` s'ils manquent ;
 * 2. les réglages sont rapprochés de `reglages.json`, le plus récent
 *    l'emporte ;
 * 3. `sessions/` est lu en une fois et rapproché du cache des fiches :
 *    seules les fiches qui ont changé sont relues, et la liste s'affiche. Le
 *    cache ne garde que des fiches allégées (`lightRecord`) : une session qui
 *    en vient est `partial`, et sa fiche est relue en entier avant d'être
 *    écrite ou ouverte dans une analyse (`hydrateSession`) ;
 * 4. en tâche de fond, chaque GPX sans fiche en reçoit une, et chaque fiche
 *    dont le résumé est périmé est recalculée, notes intactes.
 *
 * « Mettre à jour » (`refreshLibrary`) refait les étapes 2 à 4 sans refermer
 * le dossier : sessions et itinéraires copiés depuis un autre appareil
 * pendant que l'application est ouverte.
 *
 * Les écritures d'une fiche (notes surtout, saisies lettre à lettre) sont
 * regroupées et différées, puis vidées dès que l'application passe en
 * arrière-plan.
 */

export type LibraryStatus = 'opening' | 'ready' | 'needs-permission' | 'unavailable';

/** Un fichier de réglages du dossier, tel que Réglages › Mémoire le montre. */
export interface SettingsFileInfo {
  fileName: string;
  /** Nom de l'appareil qui l'a écrit, sinon celui du fichier. */
  name: string;
  /** Instant du dernier changement de ses réglages. */
  savedAt: number;
  activityCount: number;
  /** Fichier de cet appareil. */
  own: boolean;
}

export interface LibraryState {
  status: LibraryStatus;
  folderKind: MemoryKind | null;
  /** Où se trouve la mémoire, en clair. */
  folderLabel: string | null;
  /** Pourquoi aucune mémoire n'est accessible, en clair. */
  reason: string | null;
  /** Sessions, une par identité, de la plus récente à la plus ancienne. */
  sessions: LibrarySession[];
  /**
   * Fiches en cours de création ou de recalcul ; `creating` : parmi elles, les GPX sans fiche
   * (fiches à créer), seuls dits « Lecture des traces sans fiche ».
   */
  scanning: { done: number; total: number; creating: { done: number; total: number } } | null;
  /** Sessions dont le résumé reste à refaire dans le passage en cours (version du calcul ou réglages changés). */
  toUpdate: number;
  /** Fichiers d'une session déjà présente sous un autre nom, ignorés. */
  duplicates: string[];
  /** GPX qu'on n'a pas su lire. */
  unreadable: string[];
  /** Sessions enregistrées qui attendent un dossier mémoire (téléphone). */
  pendingCount: number;
  /** Nom de cet appareil, celui de son fichier de réglages. */
  deviceName: string;
  /** Fichiers de réglages du dossier (`reglages/`), celui de l'appareil en tête. */
  settingsFiles: SettingsFileInfo[];
  /** Fichier de réglages d'un autre appareil apparu dans le dossier, jamais vu par celui-ci : proposé une fois. */
  settingsOffer: SettingsFileInfo | null;
  /** Relecture du dossier en cours (« Mettre à jour »). */
  refreshing: boolean;
  /** Import en cours (GPX ou dossier), d'où qu'il parte. */
  importing: boolean;
  /** Incrémenté à chaque relecture du dossier : les listes tenues ailleurs (itinéraires) se relisent. */
  revision: number;
  /** Compte rendu de la dernière action (import, copie, relecture). */
  message: string | null;
  error: string | null;
}

const INITIAL_STATE: LibraryState = {
  status: 'opening',
  folderKind: null,
  folderLabel: null,
  reason: null,
  sessions: [],
  scanning: null,
  toUpdate: 0,
  duplicates: [],
  unreadable: [],
  pendingCount: 0,
  deviceName: '',
  settingsFiles: [],
  settingsOffer: null,
  refreshing: false,
  importing: false,
  revision: 0,
  message: null,
  error: null,
};

let state = INITIAL_STATE;
const listeners = createListeners();

const setState = (patch: Partial<LibraryState>): void => {
  state = { ...state, ...patch };
  listeners.notify();
};

const subscribe = listeners.subscribe;


/** Phrase terminée par un point, pour en mettre plusieurs à la suite. */
const sentence = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * Ajoute une erreur à celles déjà affichées, sans la répéter : plusieurs
 * peuvent survenir à l'ouverture d'un dossier sans que l'une cache l'autre.
 */
const reportError = (text: string): void => {
  const message = sentence(text);
  if (state.error?.includes(message)) return;
  setState({ error: state.error ? `${sentence(state.error)} ${message}` : message });
};

/** Erreur du démarrage de l'application (hors de la mémoire), dite dans le même bandeau. */
export const reportStartupError = (text: string): void => reportError(text);

/** Laisse l'interface respirer entre deux traces lourdes. */
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// --- Mémoire ouverte ---

/** Dossier mémoire en service, `null` s'il n'y en a aucun d'accessible. */
let folder: MemoryFolder | null = null;
/** Toutes les sessions lues, doublons compris. */
let all: LibrarySession[] = [];
/** Noms des fichiers de `sessions/` : un nouveau nom ne doit en écraser aucun, même illisible. */
let knownNames = new Set<string>();
/** Incrémenté à chaque changement de dossier : un calcul en cours pour l'ancien s'arrête. */
let generation = 0;
/** Ouverture en cours : les écritures l'attendent. */
let opening: Promise<void> = Promise.resolve();

/**
 * Vrai si `all` a changé depuis la dernière publication de la liste. Un
 * balayage ne publie pas chaque fiche créée ou recalculée (`replaceSession`
 * discret) : la liste part au rythme de son compteur, et à sa fin ; toute
 * autre publication emporte ce qui attendait.
 */
let publishPending = false;

/** Liste publiée : une session par identité, et les doublons écartés. */
const publishedFields = (): Pick<LibraryState, 'sessions' | 'duplicates'> => {
  const { kept, duplicates } = dedupeSessions(all);
  publishPending = false;
  return { sessions: kept, duplicates: duplicates.map((s) => s.file) };
};

const publish = (): void => setState(publishedFields());

/** Index d'une liste de sessions par une clé, la première de chaque clé gardée (comme `find`). */
type SessionIndex<K> = WeakMap<readonly LibrarySession[], Map<K, LibrarySession>>;

/**
 * Index de `list`, tenu tant que la liste garde son identité : `all` et la
 * liste publiée sont toujours remplacées, jamais modifiées en place.
 */
const indexed = <K>(index: SessionIndex<K>, list: readonly LibrarySession[], key: (s: LibrarySession) => K): Map<K, LibrarySession> => {
  let map = index.get(list);
  if (!map) {
    map = new Map();
    for (const session of list) {
      const k = key(session);
      if (!map.has(k)) map.set(k, session);
    }
    index.set(list, map);
  }
  return map;
};

const byFile: SessionIndex<string> = new WeakMap();
const byStart: SessionIndex<number> = new WeakMap();

const sessionOfFile = (list: readonly LibrarySession[], file: string): LibrarySession | undefined =>
  indexed(byFile, list, (s) => s.file).get(file);

const findSession = (file: string): LibrarySession | undefined => sessionOfFile(all, file);

/** Première session de `all` partie à `startMs` : la même trace, sous quelque nom que ce soit. */
const findSessionAt = (startMs: number): LibrarySession | undefined =>
  indexed(byStart, all, (s) => s.record.summary.startMs).get(startMs);

/**
 * Fichiers en cours de suppression (`removeSession`) : un recalcul ou une
 * relecture qui finit pendant ce temps ne les remet pas dans la liste et
 * n'en réécrit pas la fiche.
 */
const removing = new Set<string>();

/**
 * Fiches dont la dernière écriture a échoué : le fichier du disque n'est pas
 * la fiche en mémoire, qui n'entre donc pas dans le cache (E-B10). Retentées à
 * chaque `flushWrites` (arrière-plan, « Mettre à jour », changement de
 * dossier), gardées en mémoire par une relecture (`keptInMemory`, `scan`),
 * retirées à la première écriture réussie ; au changement de dossier, leurs
 * saisies passent au nouveau (`carryUnwritten`).
 */
const unwritten = new Set<string>();

/** Sessions `unwritten` du dossier en service, telles qu'en mémoire (fiches d'une version plus récente exceptées). */
const unwrittenSessions = (): LibrarySession[] =>
  [...unwritten].map((file) => findSession(file)).filter((s): s is LibrarySession => s !== undefined && !s.readOnly);

/**
 * Sessions dont la fiche n'était pas écrite quand la mémoire a quitté leur dossier (`attach`,
 * `detach`, y compris en passant à « needs-permission ») : leurs saisies attendent le prochain
 * dossier désigné (`takeUnwritten`, `carryUnwritten`).
 */
let heldUnwritten: LibrarySession[] = [];

/** Avant de quitter le dossier (`all` encore plein) : les sessions `unwritten` sont mises de côté. */
const holdUnwritten = (): void => {
  heldUnwritten = [...heldUnwritten, ...unwrittenSessions()];
  unwritten.clear();
};

/** Sessions à reporter dans le dossier qu'on désigne : celles mises de côté, puis les `unwritten` du dossier quitté. */
const takeUnwritten = (): LibrarySession[] => {
  const taken = [...heldUnwritten, ...unwrittenSessions()];
  heldUnwritten = [];
  unwritten.clear();
  return taken;
};

/**
 * Champs illisibles de chaque fiche à sa dernière lecture (`parseRecordWithRaw`), par dossier puis
 * par GPX : réécrits tels quels tant qu'ils n'ont pas changé (`serializeRecord`). Gardés hors de la
 * fiche, que le cache allégé recopie champ à champ.
 */
const unreadableByFolder = new WeakMap<MemoryFolder, Map<string, RecordUnreadable>>();

const unreadableOf = (f: MemoryFolder, file: string): RecordUnreadable | undefined => unreadableByFolder.get(f)?.get(file);

const rememberUnreadable = (f: MemoryFolder, file: string, unreadable: RecordUnreadable | undefined): void => {
  let byFile = unreadableByFolder.get(f);
  if (!unreadable || Object.keys(unreadable).length === 0) {
    byFile?.delete(file);
    return;
  }
  if (!byFile) {
    byFile = new Map();
    unreadableByFolder.set(f, byFile);
  }
  byFile.set(file, unreadable);
};

/** Fiche de 0 octet (création interrompue, fichier créé vide avant d'être écrit) : tenue pour absente. */
const isBlankRecordText = (text: string | null): boolean => text !== null && text.trim() === '';

/**
 * Met la session à jour dans `all`, tout de suite, et la publie. `quiet`
 * (balayage de fond) : la publication attend le prochain compteur du balayage
 * ou une autre publication (`publishPending`).
 */
const replaceSession = (session: LibrarySession, quiet = false): void => {
  if (removing.has(session.file)) return;
  all = [...all.filter((s) => s.file !== session.file), session];
  cacheDirty.add(session.file);
  if (quiet) publishPending = true;
  else publish();
};

// --- Cache des fiches, hors du dossier ---

const CACHE_KEY = 'tracker.libraryCache';

interface StoredCache {
  folder: string;
  /**
   * Fiches allégées (`lightRecord`) : sans altitude du terrain, voies ni
   * sauts, relus sur le disque quand on en a besoin. Absent d'un cache d'avant,
   * dont les fiches sont entières.
   */
  light?: boolean;
  /**
   * Champs gardés par les fiches allégées (`RECORD_LIGHT_FIELDS_KEY`). Un cache fait sous une autre
   * liste, ou d'avant cette empreinte, est ignoré : toutes les fiches sont relues, puis il est refait.
   */
  fields?: string;
  entries: LibraryCache;
}

const folderId = (f: MemoryFolder): string => `${f.kind}:${f.label}`;

const readCache = (f: MemoryFolder): { entries: LibraryCache; light: boolean } => {
  const cache = jsonStore.read<StoredCache>(CACHE_KEY);
  return cache && cache.folder === folderId(f) && cache.entries && cache.fields === RECORD_LIGHT_FIELDS_KEY
    ? { entries: cache.entries, light: cache.light === true }
    : { entries: {}, light: false };
};

/**
 * GPX dont l'entrée du cache n'est peut-être plus juste : importés, supprimés,
 * créés, recalculés ou saisis, écrits ou en échec d'écriture, et ceux écartés
 * au dernier passage parce que leur fiche attendait d'être écrite. Une mise à
 * jour du cache (`updateCache`) ne refait que leurs entrées.
 */
const cacheDirty = new Set<string>();

/** Après un import ou une suppression, le cache est mis à jour une fois, ce délai écoulé depuis le dernier. */
const CACHE_UPDATE_DELAY_MS = 1000;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
/** Mise à jour du cache en attente : le dossier et sa génération. */
let cachePending: { f: MemoryFolder; gen: number } | null = null;

/**
 * Cache d'après le contenu réel de `sessions/` et les fiches connues,
 * allégées. `whole` : refait en entier (fin de balayage) ; sinon, seules les
 * entrées de `cacheDirty` sont refaites, les autres recopiées du cache rangé
 * (refait en entier s'il est d'un autre dossier ou d'avant l'allègement).
 */
const updateCache = async (f: MemoryFolder, gen: number, whole: boolean): Promise<void> => {
  const entries = await f.list(SESSIONS_DIR);
  if (gen !== generation) return;
  const byName = indexByRecordName(entries);
  const kept = whole ? null : readCache(f);
  const next: LibraryCache = kept?.light ? { ...kept.entries } : {};
  const sessions = kept?.light ? [...cacheDirty].map((file) => findSession(file) ?? file) : all;
  cacheDirty.clear();
  for (const item of sessions) {
    const file = typeof item === 'string' ? item : item.file;
    const name = recordFileName(file);
    const entry = byName.get(name);
    delete next[name];
    if (entry) delete next[entry.name];
    if (typeof item === 'string' || item.readOnly) continue;
    // Une fiche en attente ou en cours d'écriture diffère encore du fichier : elle sera relue au prochain lancement.
    if (recordTimers.has(file) || writing.has(file) || unwritten.has(file)) {
      cacheDirty.add(file);
      continue;
    }
    if (entry) next[entry.name] = { size: entry.size, mtimeMs: entry.mtimeMs, record: lightRecord(item.record) };
  }
  jsonStore.write(CACHE_KEY, { folder: folderId(f), light: true, fields: RECORD_LIGHT_FIELDS_KEY, entries: next } satisfies StoredCache);
};

/** Cache refait en entier, d'après tout `all` (fin de balayage). */
const rebuildCache = (f: MemoryFolder, gen: number): Promise<void> => updateCache(f, gen, true);

/** Met à jour le cache dans `CACHE_UPDATE_DELAY_MS`, une fois pour toutes les demandes faites d'ici là. */
const scheduleCacheUpdate = (f: MemoryFolder): void => {
  if (cacheTimer !== null) clearTimeout(cacheTimer);
  cachePending = { f, gen: generation };
  cacheTimer = setTimeout(() => void flushCacheUpdate(), CACHE_UPDATE_DELAY_MS);
};

/** Fait tout de suite la mise à jour du cache en attente, s'il y en a une. */
const flushCacheUpdate = async (): Promise<void> => {
  if (cacheTimer !== null) clearTimeout(cacheTimer);
  cacheTimer = null;
  const pending = cachePending;
  cachePending = null;
  if (pending) await updateCache(pending.f, pending.gen, false).catch(() => undefined);
};

/** Changement de dossier ou relecture : la mise à jour en attente n'a plus lieu d'être, le balayage refera tout le cache. */
const cancelCacheUpdate = (): void => {
  if (cacheTimer !== null) clearTimeout(cacheTimer);
  cacheTimer = null;
  cachePending = null;
  cacheDirty.clear();
};

const FUTURE_RECORD_WARNING = 'Fiche écrite par une version plus récente de Tracker : lue sans être modifiée.';
const UNREADABLE_RECORD_WARNING = 'Fiche illisible, laissée telle quelle : le résumé affiché est recalculé.';
const DAMAGED_RECORD_WARNING = 'Fiche devenue illisible, laissée telle quelle : les changements ne sont plus enregistrés.';
const NOT_READ_RECORD_WARNING = 'Fiche non lue (accès refusé) : laissée telle quelle, relue à « Mettre à jour ».';

/** Relectures en cours, une seule par session. */
const hydrating = new Map<string, Promise<void>>();

/**
 * Relit en entier la fiche d'une session tirée du cache allégé (`partial`),
 * et la fond dans la session telle qu'elle est après la lecture : une saisie
 * faite pendant ce temps est gardée (`mergeLightRecord`). Une fiche absente
 * laisse la mémoire telle quelle, qui est alors tout ce qu'on a ; une fiche
 * illisible ou d'une version future met la session en lecture seule. Une
 * erreur de lecture remonte, et la session reste partielle : rien ne doit
 * alors être écrit. `quiet` : relecture du balayage de fond, publiée avec
 * lui (`replaceSession`) ; une autre relecture qui la rejoint la publie.
 */
const hydrateSession = (f: MemoryFolder, file: string, quiet = false): Promise<void> => {
  if (!findSession(file)?.partial) return Promise.resolve();
  const running = hydrating.get(file);
  if (running) {
    return quiet ? running : running.then(() => {
      if (publishPending) publish();
    });
  }
  const pending = (async () => {
    const read = await f.readText(sessionPath(recordFileName(file)));
    const current = findSession(file);
    if (!current?.partial || folder !== f) return;
    const text = isBlankRecordText(read) ? null : read;
    const parsed = text === null ? null : parseRecordWithRaw(text);
    const parts = parsed?.parts ?? null;
    // Résumé du disque illisible (écriture interrompue) : celui de la mémoire, refait depuis le GPX, le remplace (E-B10).
    const disk = parts ? { ...parts, summary: parts.summary ?? current.record.summary } : null;
    if (text !== null && !disk) {
      replaceSession({ ...current, partial: false, readOnly: true, warning: DAMAGED_RECORD_WARNING }, quiet);
    } else if (disk && !isWritableRecord(disk)) {
      replaceSession({ ...current, record: { ...disk, gpx: file }, partial: false, readOnly: true, warning: FUTURE_RECORD_WARNING }, quiet);
    } else {
      rememberUnreadable(f, file, parsed?.unreadable);
      replaceSession({ ...current, record: disk ? mergeLightRecord(disk, current.record) : current.record, partial: false }, quiet);
    }
  })().finally(() => hydrating.delete(file));
  hydrating.set(file, pending);
  return pending;
};

// --- Résumés ---

/** Activité d'une session : la sienne, sinon la première de son calcul, sinon le calcul lui-même. */
const activityOfSession = (sport: SportType, activityId: string | null | undefined): Activity =>
  sessionActivity(readStoredActivities(), activityId, sport) ?? baseActivity(sport);

/**
 * Réglages de l'activité d'une session qui changent son résumé (seuil, foil),
 * lus dans Réglages pour le calcul retenu (`analyzeGpx`, `summaryOptions`).
 */
const activitySummarySettings = (activityId: string | null | undefined) => (sport: SportType): ActivitySummarySettings => {
  const activity = activityOfSession(sport, activityId);
  return { thresholdOverride: effectiveThresholdOverride(activity), foil: effectiveFoil(activity) };
};

/**
 * Résumé d'un GPX hors de la mémoire (image de partage d'une session en
 * attente), avec les réglages de son activité, comme la fiche le calculerait.
 * `null` si la trace a moins de deux points ; lève si le XML est illisible.
 */
export const summarizeGpxText = (text: string, sport: SportType, activityId: string | null): SessionSummary | null =>
  analyzeGpx(text, sport, null, activitySummarySettings(activityId))?.summary ?? null;

/**
 * Test « résumé à refaire » (`isSummaryOutdated`) pour tout un passage sur la liste : les réglages
 * de chaque activité ne sont lus qu'une fois. À reprendre à chaque passage, les réglages ayant pu changer.
 */
const summaryOutdatedTest = (): ((record: SessionRecord) => boolean) => {
  const read = new Map<string, ActivitySummarySettings>();
  return (record) => isSummaryOutdated(record, (sport) => {
    const key = `${record.activityId ?? ''}|${sport}`;
    let settings = read.get(key);
    if (!settings) {
      settings = activitySummarySettings(record.activityId)(sport);
      read.set(key, settings);
    }
    return settings;
  });
};

/**
 * Traces dont le résumé n'a pas pu être refait depuis l'ouverture de la mémoire (GPX illisible,
 * fiche non relue) : elles ne sont pas retentées par le recalcul qui suit un réglage changé, mais
 * le sont à la prochaine ouverture ou à « Mettre à jour ».
 */
const refreshFailed = new Set<string>();

const LEGACY_NOTES_KEY = 'tracker.sailingNotes';

const newRecord = (gpx: string, analyzed: AnalyzedGpx, source: SessionSource, activityId: string | null = null): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx,
  sport: analyzed.sport,
  activityId,
  source,
  addedAt: new Date().toISOString(),
  title: analyzed.title,
  name: null,
  summary: analyzed.summary,
  // Notes saisies avant l'existence du dossier, pour la même trace.
  notes: findLegacyNotes(jsonStore.read<Record<string, unknown>>(LEGACY_NOTES_KEY), analyzed.summary.startMs),
  analysis: null,
});

// --- Écritures différées des fiches ---

const RECORD_WRITE_DELAY_MS = 800;
const recordTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Écritures en cours, par fiche. */
const writing = new Map<string, number>();

/**
 * Saisies, numérotées dans l'ordre : `lastEdit` garde le numéro de la
 * dernière de chaque fiche. Une relecture du dossier (« Mettre à jour ») garde
 * la version en mémoire d'une fiche saisie pendant qu'elle lisait le disque.
 */
let editCount = 0;
const lastEdit = new Map<string, number>();

/**
 * Écrit la fiche telle qu'elle est en mémoire. Une fiche allégée est d'abord
 * relue en entier : on n'écrit jamais une fiche privée de son altitude, de
 * ses voies ou de ses sauts. Rend vrai si la fiche est écrite ; un échec est
 * dit en clair.
 */
const writeRecordNow = async (file: string): Promise<boolean> => {
  recordTimers.delete(file);
  const f = folder;
  if (!f || removing.has(file)) return false;
  if (!findSession(file)) {
    // Plus de session à écrire : rien à retenter.
    unwritten.delete(file);
    return false;
  }
  writing.set(file, (writing.get(file) ?? 0) + 1);
  let session: LibrarySession | undefined;
  try {
    await hydrateSession(f, file);
    session = findSession(file);
    if (folder !== f) return false;
    if (!session || session.readOnly) {
      // Fiche devenue impossible à écrire (version plus récente, illisible) : l'avertissement de la session le dit.
      unwritten.delete(file);
      return false;
    }
    if (removing.has(file) || session.partial) return false;
    await f.writeText(sessionPath(recordFileName(file)), serializeRecord(session.record, unreadableOf(f, file)));
    if (folder === f) unwritten.delete(file);
    return true;
  } catch (err) {
    // Écriture d'un dossier quitté entre-temps (son nom n'y désigne plus la même fiche) : rien n'est retenté
    // dans le nouveau, mais les saisies y sont reportées (`carryUnwritten`).
    if (folder !== f) {
      if (session && !session.readOnly) void carryUnwritten([session]);
      return false;
    }
    unwritten.add(file);
    reportError(`Fiche de ${file} non enregistrée : ${errorMessage(err, 'erreur inconnue')}`);
    return false;
  } finally {
    const left = (writing.get(file) ?? 1) - 1;
    if (left > 0) writing.set(file, left);
    else writing.delete(file);
    // Fichier récrit, ou fiche qui n'entre plus dans le cache : son entrée est à refaire.
    cacheDirty.add(file);
  }
};

const scheduleRecordWrite = (file: string): void => {
  const timer = recordTimers.get(file);
  if (timer !== undefined) clearTimeout(timer);
  recordTimers.set(file, setTimeout(() => void writeRecordNow(file), RECORD_WRITE_DELAY_MS));
};

const cancelRecordWrite = (file: string): void => {
  const timer = recordTimers.get(file);
  if (timer !== undefined) clearTimeout(timer);
  recordTimers.delete(file);
};

/**
 * Écrit tout de suite les fiches et les réglages en attente d'écriture, puis le cache des fiches s'il
 * attendait. Les fiches dont la dernière écriture a échoué (`unwritten`) sont retentées : leur erreur
 * reste dite tant qu'elles ne sont pas écrites.
 */
const flushWrites = async (): Promise<void> => {
  const files = [...new Set([...recordTimers.keys(), ...unwritten])];
  files.forEach(cancelRecordWrite);
  await Promise.all([
    ...files.map((file) => writeRecordNow(file)),
    ...(settingsTimer !== null ? [flushSettings()] : []),
  ]);
  await flushCacheUpdate();
};

// --- Réglages, un fichier par appareil (§10, point 90) ---

/** Instant du dernier changement des réglages de l'appareil. */
const SETTINGS_SAVED_AT_KEY = 'tracker.settingsSavedAt';
/** Identifiant et nom de l'appareil : propres à lui, ils ne voyagent pas. */
const DEVICE_ID_KEY = 'tracker.deviceId';
const DEVICE_NAME_KEY = 'tracker.deviceName';
/** Fichiers de réglages déjà vus par l'appareil (`settingsEntryKey`) : un nouveau n'est proposé qu'une fois. */
const SEEN_SETTINGS_KEY = 'tracker.seenSettingsFiles';
const SETTINGS_WRITE_DELAY_MS = 2000;
/** Après un réglage changé, les résumés périmés sont refaits ce délai écoulé depuis la dernière écriture. */
const SETTINGS_REFRESH_DELAY_MS = 1500;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
/** Vrai pendant qu'on applique des réglages repris : ce ne sont pas des changements de l'utilisateur. */
let applyingSettings = false;

const readLocalSavedAt = (): number | null => {
  const value = jsonStore.read<number>(SETTINGS_SAVED_AT_KEY);
  return finiteOr(value, null);
};

const localTravellingValues = (): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const key of TRAVELLING_KEYS) {
    const value = jsonStore.read<unknown>(key);
    if (value !== null) values[key] = value;
  }
  return values;
};

/** Empreinte au dernier rapprochement ou au dernier vrai changement. */
let lastSignature: string | null = null;

/** Identifiant de l'appareil, tiré au hasard la première fois. */
const deviceId = (): string => {
  const stored = jsonStore.read<string>(DEVICE_ID_KEY);
  if (typeof stored === 'string' && stored !== '') return stored;
  const id = newId();
  jsonStore.write(DEVICE_ID_KEY, id);
  return id;
};

/** Nom de l'appareil : celui qu'on lui a donné, sinon « Téléphone » sur Android, « PC » dans le navigateur. */
const deviceName = (): string => {
  const stored = jsonStore.read<string>(DEVICE_NAME_KEY);
  const name = typeof stored === 'string' ? cleanDeviceName(stored) : '';
  return name !== '' ? name : isNativeApp() ? 'Téléphone' : 'PC';
};

/** Dernière lecture de `reglages/`, tenue à jour par les écritures de l'appareil. */
let settingsEntries: SettingsEntry[] = [];
/** Fichiers de `reglages/` qui ne se lisent pas, à la dernière lecture : jamais écrits par-dessus. */
let unreadableSettings: string[] = [];

/**
 * Fichiers de `reglages/` : les lisibles, et les noms de ceux qui ne se
 * lisent pas (abîmés, ou d'un autre format). Ceux-ci ne sont ni proposés ni
 * repris, mais leur nom reste pris : on ne sait pas de quel appareil ils
 * sont, et l'appareil n'écrit jamais par-dessus (lot 143).
 */
const readSettingsListing = async (f: MemoryFolder): Promise<{ entries: SettingsEntry[]; unreadable: string[] }> => {
  const entries: SettingsEntry[] = [];
  const unreadable: string[] = [];
  for (const entry of await f.list(SETTINGS_DIR)) {
    if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) continue;
    const file = parseSettingsFile(await f.readText(settingsPath(entry.name)));
    if (file) entries.push({ fileName: entry.name, file });
    else unreadable.push(entry.name);
  }
  return { entries, unreadable };
};

/** Relit `reglages/` dans `settingsEntries` et `unreadableSettings`, et rend les lisibles. */
const readSettingsEntries = async (f: MemoryFolder): Promise<SettingsEntry[]> => {
  const listing = await readSettingsListing(f);
  settingsEntries = listing.entries;
  unreadableSettings = listing.unreadable;
  return listing.entries;
};

const settingsFileInfo = (e: SettingsEntry, id: string): SettingsFileInfo => ({
  fileName: e.fileName,
  name: settingsEntryName(e),
  savedAt: e.file.savedAt,
  activityCount: settingsActivityCount(e.file),
  own: e.file.device?.id === id,
});

/** Liste de Réglages › Mémoire : le fichier de l'appareil en tête, puis les autres du plus récent au plus ancien. */
const publishSettingsFiles = (): void => {
  const id = deviceId();
  const settingsFiles = settingsEntries
    .map((e) => settingsFileInfo(e, id))
    .sort((a, b) => Number(b.own) - Number(a.own) || b.savedAt - a.savedAt);
  setState({ settingsFiles, deviceName: deviceName() });
};

/**
 * Écrit le fichier de l'appareil, sous son nom. Le fichier d'un autre
 * appareil qui porte déjà ce nom n'est jamais écrasé, ni un fichier qui ne se
 * lit pas, fût-il le sien : l'appareil prend un nom libre (« Téléphone 2 »)
 * et l'annonce. Son fichier précédent, sous un autre nom, est retiré.
 */
const writeOwnSettings = async (f: MemoryFolder, savedAt: number): Promise<void> => {
  // Stockage illisible au démarrage : les réglages en mémoire ne sont pas ceux de l'appareil, son fichier reste tel quel.
  if (storageStartupFailure()) {
    publishSettingsFiles();
    return;
  }
  const id = deviceId();
  const own = ownSettingsEntry(settingsEntries, id);
  const unreadable = new Set(unreadableSettings.map((n) => n.toLowerCase()));
  const othersFiles = new Set([...settingsEntries.filter((e) => e !== own).map((e) => e.fileName.toLowerCase()), ...unreadable]);
  const wanted = deviceName();
  const name = freeDeviceName(wanted, othersFiles);
  if (name !== wanted) {
    jsonStore.write(DEVICE_NAME_KEY, name);
    const blocked = deviceFileName(wanted);
    setState({
      message: unreadable.has(blocked) && !settingsEntries.some((e) => e !== own && e.fileName.toLowerCase() === blocked)
        ? `Cet appareil s'appelle désormais « ${name} » : le fichier de réglages ${blocked} du dossier ne se lit pas, il est gardé tel quel.`
        : `Cet appareil s'appelle désormais « ${name} » : un autre appareil du dossier s'appelle déjà « ${wanted} ».`,
    });
  }
  const fileName = deviceFileName(name);
  const file = buildSettingsFile(localTravellingValues(), savedAt, own?.file ?? null, { id, name });
  await f.writeText(settingsPath(fileName), serializeSettingsFile(file));
  if (own && own.fileName !== fileName) await f.remove(settingsPath(own.fileName));
  settingsEntries = [...settingsEntries.filter((e) => e !== own && e.fileName !== fileName), { fileName, file }];
  publishSettingsFiles();
};

const flushSettings = async (): Promise<void> => {
  if (settingsTimer !== null) clearTimeout(settingsTimer);
  settingsTimer = null;
  const f = folder;
  const savedAt = readLocalSavedAt();
  if (!f || savedAt === null) return;
  try {
    await readSettingsEntries(f);
    await writeOwnSettings(f, savedAt);
  } catch (err) {
    setState({ error: `Réglages non recopiés dans le dossier : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * Après la mise à jour des activités au démarrage (`upgradeStoredActivities`),
 * qui n'est pas un changement de l'utilisateur : le fichier de l'appareil est
 * récrit à la même date, et l'empreinte recalée, pour que le premier choix
 * retenu écrit ensuite ne date pas les réglages.
 */
export const settingsUpgraded = async (): Promise<void> => {
  await opening;
  lastSignature = settingsSignature(localTravellingValues());
  await flushSettings();
};

/** Fichiers de réglages déjà vus (`settingsEntryKey`) ; `null` avant le premier rapprochement qui les retient. */
const readSeenSettings = (): Set<string> | null => {
  const raw = jsonStore.read<unknown>(SEEN_SETTINGS_KEY);
  return Array.isArray(raw) ? new Set(raw.filter((key): key is string => typeof key === 'string')) : null;
};

const markSettingsSeen = (entries: readonly SettingsEntry[]): void => {
  jsonStore.write(SEEN_SETTINGS_KEY, [...new Set([...(readSeenSettings() ?? []), ...entries.map(settingsEntryKey)])]);
};

/**
 * Propose, une fois, le plus récent des fichiers d'autres appareils que
 * celui-ci n'a jamais vus (« Nouveau fichier de réglages »), puis les tient
 * tous pour vus. Rien quand l'appareil vient de reprendre tout seul le plus
 * récent. Une proposition encore affichée reste tant que son fichier est là.
 */
const offerNewSettings = (autoAdopted: boolean): void => {
  const id = deviceId();
  const seen = readSeenSettings();
  const fresh = autoAdopted ? [] : unseenSettingsEntries(settingsEntries, seen, id);
  markSettingsSeen(settingsEntries);
  const previous = state.settingsOffer;
  const offer = fresh[0] ?? (previous ? settingsEntries.find((e) => e.fileName === previous.fileName) : undefined);
  setState({ settingsOffer: offer ? settingsFileInfo(offer, id) : null });
};

/** Remplace les réglages de l'appareil par `values`, clé par clé ; rend vrai si l'un d'eux a changé. */
const applySettingsValues = (values: Record<string, unknown>): boolean => {
  let changed = false;
  applyingSettings = true;
  try {
    for (const key of TRAVELLING_KEYS) {
      if (!(key in values)) continue;
      if (JSON.stringify(jsonStore.read<unknown>(key)) === JSON.stringify(values[key])) continue;
      jsonStore.write(key, values[key]);
      changed = true;
    }
  } finally {
    applyingSettings = false;
  }
  return changed;
};

/**
 * Rapproche les réglages de l'appareil et le dossier, à l'ouverture et à
 * « Mettre à jour ». Rend vrai si des réglages du dossier ont remplacé ceux de
 * l'appareil : les pages déjà affichées ne les voient qu'après un
 * rechargement.
 * - Appareil neuf, sans réglage daté : il reprend le fichier le plus récent
 *   du dossier (l'ancien `reglages.json` à défaut), et le dit.
 * - Appareil sans fichier à lui, avec un ancien `reglages.json` : la règle
 *   d'avant le point 90 joue une dernière fois (le plus récent l'emporte).
 * - Sinon, les réglages de l'appareil sont les siens, quoi que contiennent
 *   les autres fichiers.
 * L'appareil écrit ensuite son fichier s'il manque ou diffère, et l'ancien
 * `reglages.json` est retiré. Le fichier d'un autre appareil qu'il n'avait
 * jamais vu lui est proposé (`offerNewSettings`).
 */
const syncSettings = async (f: MemoryFolder): Promise<boolean> => {
  const id = deviceId();
  await readSettingsEntries(f);
  const own = ownSettingsEntry(settingsEntries, id);
  const legacy = parseSettingsFile(await f.readText(SETTINGS_FILE));
  let savedAt = readLocalSavedAt();
  let changed = false;
  let autoAdopted = false;
  // Stockage illisible au démarrage : l'appareil peut se croire neuf sans l'être, rien n'est repris de lui-même.
  const startupFailed = storageStartupFailure() !== null;
  if (savedAt === null && !startupFailed) {
    const newest = own ?? newestSettingsEntry(settingsEntries);
    const source = newest?.file ?? legacy;
    if (source) {
      autoAdopted = true;
      changed = applySettingsValues(adoptedValues(source.values, localTravellingValues()));
      savedAt = source.savedAt;
      if (newest && newest !== own) setState({ message: `Réglages repris de « ${settingsEntryName(newest)} », le fichier le plus récent du dossier.` });
    }
  } else if (!own && legacy && chooseSettings(savedAt, legacy) === 'folder') {
    changed = applySettingsValues(checkedValues(legacy.values));
    savedAt = legacy.savedAt;
  }
  if (savedAt === null) savedAt = Date.now();
  jsonStore.write(SETTINGS_SAVED_AT_KEY, savedAt);
  lastSignature = settingsSignature(localTravellingValues());
  const upToDate = own !== null && own.file.savedAt === savedAt && own.fileName === deviceFileName(deviceName())
    && settingsSignature(own.file.values) === lastSignature;
  if (upToDate) publishSettingsFiles();
  else await writeOwnSettings(f, savedAt);
  if (legacy && !startupFailed) await f.remove(SETTINGS_FILE);
  offerNewSettings(autoAdopted);
  return changed;
};

/** `syncSettings`, dont l'échec est dit sans empêcher d'ouvrir ni de relire le dossier. */
const syncSettingsSafely = async (f: MemoryFolder): Promise<boolean> => {
  try {
    return await syncSettings(f);
  } catch (err) {
    reportError(`Réglages du dossier non relus : ${errorMessage(err, 'erreur inconnue')}`);
    return false;
  }
};

/**
 * Reprend le fichier de réglages d'un autre appareil (Réglages › Mémoire) :
 * ses activités et leurs réglages, profil, séances du compteur et barre du
 * bas remplacent ceux de cet appareil, dont seuls les choix retenus restent
 * (`adoptedValues`). Le fichier de l'appareil est récrit, puis la page se
 * recharge, sauf pendant un enregistrement.
 */
export const adoptSettingsFile = async (fileName: string): Promise<void> => {
  await opening;
  const f = folder;
  if (!f) return;
  try {
    const file = parseSettingsFile(await f.readText(settingsPath(fileName)));
    if (!file) {
      setState({ error: `Fichier de réglages illisible : ${fileName}.` });
      return;
    }
    if (settingsTimer !== null) clearTimeout(settingsTimer);
    settingsTimer = null;
    applySettingsValues(adoptedValues(file.values, localTravellingValues()));
    const now = Date.now();
    jsonStore.write(SETTINGS_SAVED_AT_KEY, now);
    lastSignature = settingsSignature(localTravellingValues());
    await readSettingsEntries(f);
    await writeOwnSettings(f, now);
    setState({ message: `Réglages repris de « ${settingsEntryName({ fileName, file })} ».`, settingsOffer: null });
    await applySettingsChange(true);
  } catch (err) {
    setState({ error: `Reprise des réglages impossible : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * Renomme l'appareil, et son fichier de réglages avec lui. Rend la raison
 * d'un refus (nom vide, ou déjà porté par le fichier d'un autre appareil),
 * sinon `null`.
 */
export const renameDevice = async (raw: string): Promise<string | null> => {
  const name = cleanDeviceName(raw);
  if (name === '') return 'Donnez un nom à cet appareil.';
  if (name === deviceName()) return null;
  await opening;
  const f = folder;
  try {
    const { entries, unreadable } = f ? await readSettingsListing(f) : { entries: [], unreadable: [] };
    const own = ownSettingsEntry(entries, deviceId());
    const clash = entries.find((e) => e !== own && e.fileName.toLowerCase() === deviceFileName(name));
    if (clash) return `Le fichier ${clash.fileName} est déjà celui de « ${settingsEntryName(clash)} » : choisissez un autre nom.`;
    const unreadableClash = unreadable.find((n) => n.toLowerCase() === deviceFileName(name));
    if (unreadableClash) return `Le fichier ${unreadableClash} du dossier ne se lit pas et porte déjà ce nom : choisissez un autre nom.`;
    jsonStore.write(DEVICE_NAME_KEY, name);
    if (!f) {
      setState({ deviceName: name });
      return null;
    }
    settingsEntries = entries;
    unreadableSettings = unreadable;
    await writeOwnSettings(f, readLocalSavedAt() ?? Date.now());
    return null;
  } catch (err) {
    return `Renommage impossible : ${errorMessage(err, 'erreur inconnue')}`;
  }
};

/**
 * « Importer un fichier de réglages » (Réglages › Mémoire) : le fichier
 * choisi est rangé tel quel dans `reglages/`, comme s'il y avait été déposé,
 * et tenu pour vu (le bandeau ne le propose pas). Il sert là où l'on ne peut
 * rien déposer à la main : la mémoire du navigateur (Firefox). Rend le
 * fichier rangé, ou la raison d'un refus.
 */
export const importSettingsFile = async (picked: File): Promise<{ file: SettingsFileInfo } | { refusal: string }> => {
  await opening;
  const f = folder;
  if (!f) return { refusal: 'Aucune mémoire ouverte.' };
  try {
    const text = await readPickedFile(picked);
    const file = parseSettingsFile(text);
    if (!file) return { refusal: `${picked.name} n'est pas un fichier de réglages de Tracker.` };
    const id = deviceId();
    if (file.device?.id === id) return { refusal: `${picked.name} est le fichier de réglages de cet appareil.` };
    await readSettingsEntries(f);
    const taken = new Set((await f.list(SETTINGS_DIR)).map((e) => e.name.toLowerCase()));
    const fileName = importedSettingsFileName(file, picked.name, settingsEntries, taken);
    await f.writeText(settingsPath(fileName), text);
    const entry: SettingsEntry = { fileName, file };
    settingsEntries = [...settingsEntries.filter((e) => e.fileName !== fileName), entry];
    markSettingsSeen([entry]);
    publishSettingsFiles();
    return { file: settingsFileInfo(entry, id) };
  } catch (err) {
    return { refusal: `Import impossible : ${errorMessage(err, 'erreur inconnue')}` };
  }
};

// --- Ouverture d'un dossier ---

/** Marqueur écrit s'il manque ; mode d'emploi récrit s'il manque ou a changé. */
const ensureLayout = async (f: MemoryFolder): Promise<void> => {
  if ((await f.readText(MARKER_FILE)) === null) await f.writeText(MARKER_FILE, markerText());
  if ((await f.readText(README_FILE)) !== readmeText()) await f.writeText(README_FILE, readmeText());
};

interface SummaryJob {
  file: string;
  /**
   * `create` : fiche à créer ; `refresh` : fiche existante dont seul le résumé
   * est à refaire, d'après la session telle qu'elle est au moment du calcul.
   */
  kind: 'create' | 'refresh';
  /** Vrai si la fiche existante ne doit pas être réécrite. */
  readOnly: boolean;
  warning: string | null;
  /** `create` d'une fiche lue dont seul le résumé est illisible : elle garde le reste. */
  base?: RecordWithoutSummary;
}

/**
 * Version en mémoire d'une session relue, quand elle doit l'emporter sur celle
 * du disque ou du cache : saisie pendant la relecture (après `editsBefore`),
 * ou déjà relue en entier alors que le cache n'en donne que la fiche allégée
 * d'un fichier inchangé. Sans cela, « Mettre à jour » perdrait une saisie, ou
 * rendrait partielle la session d'une analyse ouverte. Une fiche pas encore écrite (`unwritten`) garde
 * toujours sa version en mémoire : le disque n'a pas ses derniers changements.
 */
const keptInMemory = (read: LibrarySession, editsBefore: number): LibrarySession | undefined => {
  const current = findSession(read.file);
  if (!current) return undefined;
  if (unwritten.has(read.file) || (lastEdit.get(read.file) ?? 0) > editsBefore) return current;
  return read.partial && !current.partial ? current : undefined;
};

/**
 * Une fiche `X.JSON` (extension en majuscules) à côté de `X.gpx` est renommée `X.json` : toute la
 * suite relit et réécrit la fiche par `recordFileName(gpx)`, et sans cela une seconde fiche serait
 * créée à côté. Sur un système qui ignore la casse, l'écriture retombe sur le même fichier : on ne
 * supprime l'ancien nom que s'il figure encore, à côté du nouveau, dans la liste relue.
 */
const normalizeRecordExtensions = async (f: MemoryFolder, entries: FolderEntry[]): Promise<FolderEntry[]> => {
  const names = new Set(entries.map((e) => e.name));
  const gpxRecordNames = new Set(entries.filter((e) => e.kind === 'file' && isGpxFileName(e.name)).map((e) => recordFileName(e.name)));
  const odd = entries.filter(
    (e) => e.kind === 'file' && /\.json$/i.test(e.name) && !e.name.endsWith('.json') && gpxRecordNames.has(lowerRecordExtension(e.name)) && !names.has(lowerRecordExtension(e.name))
  );
  if (odd.length === 0) return entries;
  for (const entry of odd) {
    try {
      const text = await f.readText(sessionPath(entry.name));
      if (text === null) continue;
      const target = lowerRecordExtension(entry.name);
      await f.writeText(sessionPath(target), text);
      const after = await f.list(SESSIONS_DIR);
      if (after.some((e) => e.name === target) && after.some((e) => e.name === entry.name)) await f.remove(sessionPath(entry.name));
    } catch (err) {
      reportError(`${entry.name} n'a pas pu être renommée en .json : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }
  return f.list(SESSIONS_DIR);
};

/**
 * Lit `sessions/` et publie la liste. Rend les fiches à créer ou à
 * recalculer, que `completeScan` traite ensuite en tâche de fond.
 * `editsBefore` : numéro de la dernière saisie avant la relecture.
 */
const scan = async (f: MemoryFolder, gen: number, editsBefore = editCount): Promise<SummaryJob[]> => {
  let entries = await f.list(SESSIONS_DIR);
  entries = await normalizeRecordExtensions(f, entries);
  const rootEntries = await f.list('');
  const cache = readCache(f);
  let plan = planReconcile(entries, rootEntries, cache.entries);

  // Un GPX posé à la racine du dossier est rangé dans `sessions/`, avec la fiche posée à côté de lui.
  if (plan.rootGpx.length > 0) {
    const taken = new Set(entries.map((e) => e.name));
    for (const name of plan.rootGpx) {
      try {
        const text = await f.readText(name);
        if (text === null) continue;
        const target = uniqueSessionFileName(name, taken);
        const recordName = plan.rootRecords[name];
        const recordText = recordName ? await f.readText(recordName) : null;
        const motion = rootEntries.some((e) => e.name === imuFileName(name)) ? await f.readBytes(imuFileName(name)) : null;
        await f.writeText(sessionPath(target), text);
        taken.add(target);
        if (recordName && recordText !== null) {
          await f.writeText(sessionPath(recordFileName(target)), recordText);
          await f.remove(recordName);
        }
        if (motion) {
          await f.writeBytes(sessionPath(imuFileName(target)), motion);
          await f.remove(imuFileName(name));
        }
        await f.remove(name);
      } catch (err) {
        reportError(`${name} n'a pas pu être rangé dans sessions/ : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    entries = await f.list(SESSIONS_DIR);
    plan = planReconcile(entries, [], cache.entries);
  }
  if (gen !== generation) return [];

  knownNames = new Set(entries.map((e) => e.name));
  const jobs: SummaryJob[] = [];
  const found: LibrarySession[] = [];
  let publishedCount = 0;
  // Résumé à refaire : version du calcul dépassée, ou réglages changés depuis (empreinte, lot 37).
  const isOutdated = summaryOutdatedTest();
  const keep = (file: string, record: SessionRecord, partial: boolean) => {
    const readOnly = !isWritableRecord(record);
    found.push({
      file,
      record: { ...record, gpx: file },
      readOnly,
      warning: readOnly ? FUTURE_RECORD_WARNING : null,
      ...(partial ? { partial: true } : {}),
    });
    if (!readOnly && isOutdated(record)) jobs.push({ file, kind: 'refresh', readOnly: false, warning: null });
  };
  // Fiche pas encore écrite (`unwritten`) : la session en mémoire l'emporte sur le disque, qu'il porte une
  // fiche plus ancienne, vide ou illisible, ou aucune (fiche créée dont l'écriture a échoué).
  const held = (file: string): boolean => {
    const current = unwritten.has(file) ? findSession(file) : undefined;
    if (!current) return false;
    found.push(current);
    if (!current.readOnly && isOutdated(current.record)) jobs.push({ file, kind: 'refresh', readOnly: false, warning: null });
    return true;
  };

  for (const [file, record] of Object.entries(plan.reuse)) if (!held(file)) keep(file, record, cache.light);
  // Fiches à relire, par paquets lus ensemble. Mémoire encore vide (ouverture sans cache, téléphone
  // neuf) : la liste s'affiche par lots au fil de la lecture, au lieu d'attendre la dernière (E-O5).
  const progressive = all.length === 0;
  const toRead = plan.read.filter((file) => !held(file));
  for (let from = 0; from < toRead.length; from += RECORD_READ_BATCH) {
    const batch = toRead.slice(from, from + RECORD_READ_BATCH);
    // Une fiche dont la lecture lève (accès refusé sur le téléphone) n'empêche pas d'ouvrir les autres.
    const texts = await Promise.all(batch.map((file) => f.readText(sessionPath(recordFileName(file))).catch((): typeof READ_FAILED => READ_FAILED)));
    batch.forEach((file, i) => {
      const text = texts[i];
      // Fiche non lue : laissée telle quelle, la session en lecture seule sur un résumé refait depuis le GPX ;
      // ses champs illisibles connus restent pour la prochaine lecture.
      if (text === READ_FAILED) {
        jobs.push({ file, kind: 'create', readOnly: true, warning: NOT_READ_RECORD_WARNING });
        return;
      }
      // Fiche vide : tenue pour absente, elle est refaite depuis le GPX.
      if (isBlankRecordText(text)) {
        rememberUnreadable(f, file, undefined);
        jobs.push({ file, kind: 'create', readOnly: false, warning: null });
        return;
      }
      const parsed = text === null ? null : parseRecordWithRaw(text);
      const parts = parsed?.parts ?? null;
      rememberUnreadable(f, file, parsed?.unreadable);
      if (parts?.summary) keep(file, { ...parts, summary: parts.summary }, false);
      // Résumé seul illisible : il se refait depuis le GPX, la fiche garde nom, notes et réglages.
      else if (parts && isWritableRecord(parts)) jobs.push({ file, kind: 'create', readOnly: false, warning: null, base: parts });
      else jobs.push({ file, kind: 'create', readOnly: true, warning: UNREADABLE_RECORD_WARNING });
    });
    if (gen !== generation) return [];
    if (progressive && found.length - publishedCount >= PROGRESSIVE_PUBLISH_COUNT) {
      all = [...found];
      publishedCount = found.length;
      publish();
    }
  }
  for (const file of plan.summarize) if (!held(file)) jobs.push({ file, kind: 'create', readOnly: false, warning: null });
  if (gen !== generation) return [];

  all = found.map((read) => keptInMemory(read, editsBefore) ?? read);
  publish();
  return jobs;
};

/** Fiches lues ensemble à l'ouverture : moins d'allers-retours avec le dossier. */
const RECORD_READ_BATCH = 8;
/** Lecture d'une fiche qui a levé, distincte d'une fiche absente (`null`). */
const READ_FAILED = Symbol('fiche non lue');
/** À l'ouverture d'une mémoire encore vide, la liste est publiée tous les tant de sessions lues. */
const PROGRESSIVE_PUBLISH_COUNT = 25;

/** `stopped` : le dossier a changé, le balayage s'arrête ; `blank` : GPX vide, qui n'est pas une session (ignoré, pas effacé). */
type JobOutcome = 'done' | 'unreadable' | 'blank' | 'stopped';

/**
 * Crée une fiche, ou refait le résumé d'une fiche existante. Pour celle-ci,
 * la session est prise au moment du calcul, pas au début du balayage : une
 * saisie faite entre-temps (nom, notes, activité) est gardée, et l'analyse,
 * synchrone, n'en laisse passer aucune avant que le résumé soit posé. Seul un
 * GPX qu'on n'a pas su lire est « illisible » ; un échec d'écriture est dit
 * en clair.
 */
const runJob = async (f: MemoryFolder, gen: number, job: SummaryJob): Promise<JobOutcome> => {
  // Résumé refait entre-temps, ou réglage remis comme avant : la trace n'est pas relue.
  if (job.kind === 'refresh') {
    const listed = findSession(job.file);
    if (!listed || listed.readOnly || !isSummaryOutdated(listed.record, activitySummarySettings(listed.record.activityId))) return 'done';
  }
  let text: string | null;
  try {
    text = await f.readText(sessionPath(job.file));
  } catch {
    return 'unreadable';
  }
  // GPX vide ou blanc sans fiche (écriture interrompue) : ni session ni « illisible », laissé en place.
  // Avec une fiche, même illisible ou d'une version plus récente, il reste dit « illisible ».
  if (job.kind === 'create' && !job.base && !job.readOnly && text !== null && isBlankGpxText(text)) return 'blank';
  if (job.kind === 'refresh') {
    try {
      await hydrateSession(f, job.file, true);
    } catch (err) {
      reportError(`Fiche de ${job.file} non relue : ${errorMessage(err, 'erreur inconnue')}`);
      refreshFailed.add(job.file);
      return 'done';
    }
  }
  if (gen !== generation) return 'stopped';
  const current = job.kind === 'refresh' ? findSession(job.file) : undefined;
  if (job.kind === 'refresh' && (!current || current.readOnly || current.partial)) {
    if (current?.partial) refreshFailed.add(job.file);
    return 'done';
  }
  const from = current?.record ?? job.base;
  let analyzed: AnalyzedGpx | null;
  try {
    analyzed = text === null ? null : analyzeGpx(text, from ? from.sport : undefined, from?.analysis, activitySummarySettings(from?.activityId), from);
  } catch {
    return 'unreadable';
  }
  if (!analyzed) return 'unreadable';
  // Supprimée pendant le calcul : ni remise dans la liste, ni fiche réécrite.
  if (removing.has(job.file)) return 'done';

  if (current) {
    replaceSession({ ...current, record: withSummary(current.record, analyzed.summary) }, true);
    cancelRecordWrite(job.file);
    await writeRecordNow(job.file);
    return 'done';
  }
  const record = job.base ? withSummary({ ...job.base, gpx: job.file }, analyzed.summary) : newRecord(job.file, analyzed, 'import');
  if (!job.readOnly) {
    try {
      if (!job.base) rememberUnreadable(f, job.file, undefined);
      await f.writeText(sessionPath(recordFileName(job.file)), serializeRecord(record, unreadableOf(f, job.file)));
      knownNames.add(recordFileName(job.file));
      if (folder === f) unwritten.delete(job.file);
    } catch (err) {
      // Dossier quitté pendant l'écriture : le balayage s'arrête juste après, rien à retenter ici.
      if (folder === f) {
        unwritten.add(job.file);
        reportError(`Fiche de ${job.file} non enregistrée : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
  }
  if (gen !== generation) return 'stopped';
  replaceSession({ file: job.file, record, readOnly: job.readOnly, warning: job.warning }, true);
  return 'done';
};

/** Le compteur du balayage est publié au plus à ce rythme : chaque publication redessine les pages qui le lisent. */
const SCAN_PROGRESS_INTERVAL_MS = 250;

/**
 * Lecture en cours des GPX sans fiche (`completeScan`), levée à sa fin ou à son arrêt (changement de
 * `generation` compris). `addGpx` l'attend avant de créer une session : celles qu'elle n'a pas encore
 * publiées ne sont pas dans `all`, et un enregistrement ou un import de la même session ferait un doublon.
 */
let scanCompletion: Promise<void> | null = null;

/**
 * Passage en cours, quel qu'il soit (création de fiches ou résumés à refaire) : le recalcul qui
 * suit un réglage changé (`queueOutdatedRefresh`) l'attend, pour ne jamais en lancer deux à la fois.
 */
let scanPass: Promise<void> | null = null;

/**
 * Crée ou recalcule les fiches, une trace à la fois, en laissant l'interface répondre. Un passage
 * qui ne fait que refaire des résumés n'est pas attendu par `addGpx` : il ne crée aucune session.
 * `keepUnreadable` : les GPX illisibles déjà signalés le restent (passage partiel).
 */
const completeScan = (f: MemoryFolder, gen: number, jobs: SummaryJob[], keepUnreadable = false): Promise<void> => {
  const run = runCompleteScan(f, gen, jobs, keepUnreadable).finally(() => {
    if (scanCompletion === run) scanCompletion = null;
    if (scanPass === run) scanPass = null;
  });
  scanPass = run;
  if (jobs.some((job) => job.kind === 'create')) scanCompletion = run;
  return run;
};

/**
 * Les fiches créées ou recalculées entrent dans `all` tout de suite, mais ne
 * sont publiées qu'avec le compteur (au plus toutes les
 * `SCAN_PROGRESS_INTERVAL_MS`), puis une fois à la fin : chaque publication
 * redessine les pages qui lisent la liste. Un arrêt sur erreur publie ce qui
 * attendait.
 */
const runCompleteScan = async (f: MemoryFolder, gen: number, jobs: SummaryJob[], keepUnreadable: boolean): Promise<void> => {
  const unreadable: string[] = keepUnreadable ? [...state.unreadable] : [];
  const createTotal = jobs.filter((job) => job.kind === 'create').length;
  let created = 0;
  let toUpdate = jobs.length - createTotal;
  let shownAt = -Infinity;
  try {
    for (let i = 0; i < jobs.length; i++) {
      if (gen !== generation) return;
      if (Date.now() - shownAt >= SCAN_PROGRESS_INTERVAL_MS) {
        shownAt = Date.now();
        setState({
          scanning: { done: i, total: jobs.length, creating: { done: created, total: createTotal } },
          toUpdate,
          ...(publishPending ? publishedFields() : {}),
        });
      }
      const job = jobs[i];
      const outcome = await runJob(f, gen, job);
      if (outcome === 'stopped') return;
      if (outcome === 'unreadable') {
        if (!unreadable.includes(job.file)) unreadable.push(job.file);
        // Un résumé qu'on n'a pas su refaire n'est retenté qu'à la prochaine ouverture ou à « Mettre à jour ».
        if (job.kind === 'refresh') refreshFailed.add(job.file);
      }
      if (job.kind === 'create') created += 1;
      else toUpdate -= 1;
      await pause();
    }
    if (gen !== generation) return;
    setState({ scanning: null, toUpdate: 0, unreadable, ...(publishPending ? publishedFields() : {}) });
  } finally {
    if (publishPending && gen === generation) publish();
  }
  await rebuildCache(f, gen);
};

/**
 * GPX dont l'écriture dans le dossier en attente est en cours (`addGpx`) : la reprise des
 * temporaires (`planPendingTemps`) ne touche pas aux leurs.
 */
const pendingWriting = new Set<string>();

/** Capteurs temporaires lus, s'ils commencent par un en-tête lisible ; `null` sinon. */
const readPendingImuTemp = async (pending: MemoryFolder, name: string | null): Promise<Uint8Array | null> => {
  if (!name) return null;
  const bytes = await pending.readBytes(name);
  return bytes && decodeImuHeader(bytes) ? bytes : null;
};

/** Fiche d'une session en attente, lue à côté de son GPX pour être rangée avec lui. */
interface PendingRecord {
  /** Son nom dans le dossier en attente, `null` si la session n'en a pas (attente d'avant le lot 116). */
  name: string | null;
  /** Ce qu'elle apporte à `addGpx` : rien si elle est illisible. */
  options: Pick<AddOptions, 'record' | 'unreadable'>;
  /** Fiche là mais illisible : la session est rangée sans elle, et c'est dit. */
  unreadable: boolean;
}

/**
 * Fiche d'une session en attente (`name`, `null` sans fiche). `null` si elle est là mais que sa
 * lecture échoue : la session reste alors en attente, avec elle, plutôt que d'être rangée sans.
 */
const readPendingRecord = async (pending: MemoryFolder, name: string | null): Promise<PendingRecord | null> => {
  if (name === null) return { name: null, options: {}, unreadable: false };
  const text = await pending.readText(name);
  if (text === null) return null;
  const parsed = isBlankRecordText(text) ? null : parseRecordWithRaw(text);
  return parsed && isWritableRecord(parsed.parts)
    ? { name, options: { record: parsed.parts, unreadable: parsed.unreadable }, unreadable: false }
    : { name, options: {}, unreadable: true };
};

/** Fiche d'une session en attente rangée sans elle, illisible. */
const reportPendingRecordUnreadable = (gpx: string): void =>
  reportError(`Fiche de la session en attente ${gpx} illisible : session rangée sans son activité, ses repères, ses séances ni son test`);

/**
 * Session en attente déjà dans la mémoire, dont la fiche n'a pas pu être complétée (non relue, ou en
 * lecture seule) : laissée en attente avec sa propre fiche, retentée au prochain rangement.
 */
const reportPendingNotCompleted = (gpx: string, result: AddResult): void =>
  reportError(result.recordReadOnly
    ? `Session en attente ${gpx} déjà dans la mémoire, mais sa fiche y est en lecture seule (non lue, illisible ou plus récente) : laissée en attente`
    : `Session en attente ${gpx} déjà dans la mémoire, mais sa fiche n'a pas pu être relue pour la compléter : laissée en attente`);

/** Vrai si la session était déjà là et que sa fiche n'a pas reçu celle apportée (non relue, lecture seule). */
const notCompleted = (result: AddResult): boolean => result.recordNotRead === true || result.recordReadOnly === true;

/**
 * Sessions enregistrées sur le téléphone faute de dossier, rangées dès qu'il
 * y en a un, avec la fiche écrite à côté de chacune (activité, foil, séances,
 * repères, test). Une session qu'on ne peut ranger reste en attente, sans
 * retenir les autres, et l'échec est dit ; une fiche illisible ne la retient
 * pas : elle est rangée sans, et c'est dit. Les temporaires d'une écriture
 * interrompue par un plantage (`planPendingTemps`) : un GPX complet est rangé
 * comme les autres, puis effacé ; un temporaire tronqué ou illisible est
 * effacé, et dit ; celui dont la cible est là, effacé sans rien dire, comme
 * une fiche restée sans GPX.
 */
const flushPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  let names: string[];
  try {
    names = (await pending.list('')).filter((e) => e.kind === 'file').map((e) => e.name);
  } catch (err) {
    reportError(`Sessions en attente illisibles : ${errorMessage(err, 'erreur inconnue')}`);
    return;
  }
  const temps = planPendingTemps(names, pendingWriting);
  for (const name of temps.stale) await pending.remove(name).catch(() => undefined);
  for (const name of temps.orphanRecords) await pending.remove(name).catch(() => undefined);
  for (const name of temps.orphanImuTemps) {
    await pending.remove(name).catch(() => undefined);
    reportError(`Capteurs en attente ${name} sans leur trace (écriture interrompue), effacés`);
  }
  const listed = new Set(names);
  let ranged = false;
  for (const name of names.filter(isGpxFileName)) {
    try {
      const text = await pending.readText(name);
      if (text === null) continue;
      const record = await readPendingRecord(pending, listed.has(recordFileName(name)) ? recordFileName(name) : null);
      if (!record) {
        reportError(`Session en attente ${name} laissée en attente : sa fiche n'a pas pu être lue`);
        continue;
      }
      const imuTemp = temps.imuTemps[name] ?? null;
      const imu = await pending.readBytes(imuFileName(name));
      const fromTemp = imu ? null : await readPendingImuTemp(pending, imuTemp);
      const motion = imu ?? fromTemp;
      const result = await addGpx(text, 'enregistrement', { motion: motion ?? undefined, ...record.options });
      if (notCompleted(result)) {
        reportPendingNotCompleted(name, result);
      } else if (result.status === 'added' || result.status === 'duplicate') {
        ranged = true;
        // Le GPX d'abord : une coupure ensuite laisse une fiche seule, effacée au prochain passage.
        await pending.remove(name);
        if (record.name) await pending.remove(record.name);
        // Seuls les capteurs lus et rangés avec la session sont effacés.
        if (imu) await pending.remove(imuFileName(name));
        if (fromTemp && imuTemp) await pending.remove(imuTemp);
        if (record.unreadable) reportPendingRecordUnreadable(name);
      } else if (result.status === 'invalid') {
        reportError(`Session en attente ${name} illisible, laissée en attente : ${result.message ?? 'GPX illisible'}`);
      }
    } catch (err) {
      reportError(`Session en attente ${name} non rangée : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }

  for (const session of temps.sessions) {
    const drop = async (why: string) => {
      await pending.remove(session.temp);
      if (session.imuTemp) await pending.remove(session.imuTemp);
      if (session.record) await pending.remove(session.record);
      reportError(`Session en attente ${session.gpx} ${why}, effacée`);
    };
    try {
      const text = await pending.readText(session.temp);
      // Lecture en échec : rien n'est effacé, le temporaire sera repris au prochain dossier ouvert.
      if (text === null) continue;
      if (isBlankGpxText(text)) {
        await drop('vide (écriture interrompue)');
        continue;
      }
      if (!isCompleteGpxText(text)) {
        await drop('incomplète (écriture interrompue)');
        continue;
      }
      const record = await readPendingRecord(pending, session.record);
      // Fiche là mais non lue : rien n'est effacé, le temporaire sera repris au prochain dossier ouvert.
      if (!record) {
        reportError(`Session en attente ${session.gpx} laissée en attente : sa fiche n'a pas pu être lue`);
        continue;
      }
      const imu = session.imu ? await pending.readBytes(session.imu) : null;
      const fromTemp = imu ? null : await readPendingImuTemp(pending, session.imuTemp);
      const motion = imu ?? fromTemp;
      const result = await addGpx(text, 'enregistrement', { motion: motion ?? undefined, ...record.options });
      if (notCompleted(result)) {
        reportPendingNotCompleted(session.gpx, result);
      } else if (result.status === 'added' || result.status === 'duplicate') {
        ranged = true;
        await pending.remove(session.temp);
        if (record.name) await pending.remove(record.name);
        // Seuls les capteurs lus et rangés avec la session sont effacés : une lecture en échec les laisse.
        if (imu && session.imu) await pending.remove(session.imu);
        if (fromTemp && session.imuTemp) await pending.remove(session.imuTemp);
        if (record.unreadable) reportPendingRecordUnreadable(session.gpx);
      } else if (result.status === 'pending') {
        // Plus de dossier entre-temps : la session est de nouveau en attente, sous son nom cette fois.
        await pending.remove(session.temp);
        if (fromTemp && session.imuTemp) await pending.remove(session.imuTemp);
      } else if (result.status === 'invalid') {
        await drop(`illisible (${result.message ?? 'GPX illisible'})`);
      }
    } catch (err) {
      reportError(`Session en attente ${session.gpx} non rangée : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }
  // Rangées après le balayage, qui a déjà refait le cache des fiches : leurs entrées y sont ajoutées.
  if (ranged && folder) scheduleCacheUpdate(folder);
  await countPending();
};

const countPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  try {
    const files = await pending.list('');
    setState({ pendingCount: files.filter((e) => e.kind === 'file' && isGpxFileName(e.name)).length });
  } catch {
    // Dossier privé illisible : le compte précédent reste affiché.
  }
};

/**
 * Met un dossier en service. Rend vrai si des réglages du dossier ont
 * remplacé ceux de l'appareil. Seule la lecture de `sessions/` est
 * indispensable : marqueur, réglages et sessions en attente, s'ils échouent,
 * sont dits, et l'ouverture continue ; une fiche qu'on ne peut lire laisse
 * sa session en lecture seule (`NOT_READ_RECORD_WARNING`).
 */
const attach = async (f: MemoryFolder): Promise<boolean> => {
  generation += 1;
  cancelCacheUpdate();
  const gen = generation;
  // Fiches pas écrites de l'ancien dossier : mises de côté, pour le report dans un dossier désigné (`carryUnwritten`).
  holdUnwritten();
  folder = f;
  all = [];
  publishPending = false;
  knownNames = new Set();
  refreshFailed.clear();
  setState({
    status: 'opening',
    folderKind: f.kind,
    folderLabel: f.label,
    reason: null,
    sessions: [],
    duplicates: [],
    unreadable: [],
    scanning: null,
    toUpdate: 0,
    error: null,
  });
  try {
    await ensureLayout(f);
  } catch (err) {
    reportError(`Marqueur du dossier non écrit : ${errorMessage(err, 'erreur inconnue')}`);
  }
  const settingsChanged = await syncSettingsSafely(f);
  const jobs = await scan(f, gen);
  if (gen !== generation) return settingsChanged;
  setState({ status: 'ready' });
  // Le balayage d'abord : une session en attente déjà rangée, mais coupée avant sa fiche, est retrouvée
  // (`scanCompletion`, attendu par `addGpx`) au lieu d'être rangée une seconde fois sous un autre nom.
  void completeScan(f, gen, jobs).catch((err) =>
    setState({ scanning: null, toUpdate: 0, error: `Lecture du dossier interrompue : ${errorMessage(err, 'erreur inconnue')}` })
  );
  await flushPending();
  return settingsChanged;
};

const detach = (status: 'needs-permission' | 'unavailable', label: string | null, reason: string | null): void => {
  generation += 1;
  cancelCacheUpdate();
  // Accès perdu (« needs-permission ») ou dossier inutilisable : les fiches pas écrites attendent le dossier désigné ensuite.
  holdUnwritten();
  folder = null;
  all = [];
  publishPending = false;
  knownNames = new Set();
  settingsEntries = [];
  unreadableSettings = [];
  refreshFailed.clear();
  setState({
    status,
    folderKind: null,
    folderLabel: label,
    reason,
    sessions: [],
    duplicates: [],
    unreadable: [],
    scanning: null,
    toUpdate: 0,
    settingsFiles: [],
    settingsOffer: null,
  });
};

// --- Rechargement après reprise des réglages ---

let uiStarted = false;
let canReload: () => boolean = () => true;

/**
 * Les pages lisent les réglages à leur premier affichage : des réglages repris
 * du dossier après le démarrage ne s'appliquent qu'en rechargeant. Jamais
 * pendant un enregistrement.
 */
const applySettingsChange = async (changed: boolean): Promise<void> => {
  if (!changed || !uiStarted) return;
  if (canReload()) {
    // Fiches et réglages en attente d'écriture d'abord : le rechargement les perdrait (E-B7).
    await flushWrites();
    window.location.reload();
  } else {
    setState({ message: 'Réglages repris du dossier : ils s\'appliqueront au prochain lancement.' });
  }
};

/**
 * Stockage de l'appareil illisible au démarrage (`storageStartupFailure`) : les réglages touchés valent par
 * défaut, en mémoire seulement. Dit dès l'interface affichée, et redit après l'ouverture de la mémoire, qui
 * efface les erreurs précédentes.
 */
const reportStorageStartupFailure = (): void => {
  const failure = storageStartupFailure();
  if (!failure) return;
  reportError(failure.all
    ? "Réglages de l'appareil illisibles au démarrage : les réglages par défaut valent jusqu'à la fermeture, et les changements faits d'ici là ne seront pas gardés. Relancez l'application"
    : "Une partie des réglages de l'appareil n'a pas pu être lue au démarrage : elle vaut par défaut jusqu'à la fermeture, et ses changements ne seront pas gardés. Relancez l'application");
};

// --- API ---

/**
 * Ouvre la mémoire : le dossier choisi s'il est accessible, sinon celle du
 * navigateur. À lancer au démarrage, avant le premier rendu si possible : les
 * réglages repris du dossier sont alors en place pour les pages.
 */
export const openLibrary = (): Promise<void> => {
  opening = (async () => {
    setState({ status: 'opening' });
    const access = await openMemoryFolder();
    if (access.state === 'ready') {
      const settingsChanged = await attach(access.folder);
      if (access.notice) reportError(access.notice);
      if (uiStarted) reportStorageStartupFailure();
      await applySettingsChange(settingsChanged);
      return;
    }
    detach(
      access.state,
      access.state === 'needs-permission' ? access.label : null,
      access.state === 'unavailable' ? access.reason : null
    );
    await countPending();
  })().catch((err) => {
    detach('unavailable', null, errorMessage(err, 'Ouverture de la mémoire impossible.'));
  });
  return opening;
};

/**
 * À appeler une fois l'interface affichée. `isBusy` dit si un rechargement
 * interromprait quelque chose (un enregistrement).
 */
export const startLibraryUi = (isBusy: () => boolean): void => {
  uiStarted = true;
  canReload = () => !isBusy();
  jsonStore.subscribe((key) => {
    if (applyingSettings || !(TRAVELLING_KEYS as readonly string[]).includes(key)) return;
    const signature = settingsSignature(localTravellingValues());
    if (signature === lastSignature) return;
    lastSignature = signature;
    jsonStore.write(SETTINGS_SAVED_AT_KEY, Date.now());
    if (settingsTimer !== null) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => void flushSettings(), SETTINGS_WRITE_DELAY_MS);
  });
  // Réglage d'activité changé (seuil, foil, activité supprimée…) : les résumés qu'il rend périmés sont
  // refaits, une fois la saisie posée (elle écrit à chaque touche). Pas pour des réglages repris du
  // dossier : la page se recharge, ou ils valent au prochain lancement, qui refait ce qu'il faut.
  let settingsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  subscribeStoredSettings(() => {
    if (applyingSettings) return;
    if (settingsRefreshTimer !== null) clearTimeout(settingsRefreshTimer);
    settingsRefreshTimer = setTimeout(() => {
      settingsRefreshTimer = null;
      void queueOutdatedRefresh();
    }, SETTINGS_REFRESH_DELAY_MS);
  });
  reportStorageStartupFailure();
  // Un réglage que l'appareil refuse de garder vaut jusqu'à la fermeture : dit une fois par lancement.
  let storageFailureShown = false;
  jsonStore.subscribeFailure(() => {
    if (storageFailureShown) return;
    storageFailureShown = true;
    reportError('Stockage de l\'appareil plein ou bloqué : les derniers changements de réglages valent jusqu\'à la fermeture de l\'application, sans être gardés');
  });
  // Écritures différées vidées dès que l'application passe en arrière-plan.
  const flushAll = () => void flushWrites();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
};

export type AddStatus = 'added' | 'duplicate' | 'pending' | 'unsaved' | 'invalid';

export interface AddResult {
  status: AddStatus;
  /** Nom du GPX dans la mémoire : la session ajoutée, ou celle qui existait déjà. */
  file: string | null;
  message?: string;
  /** Session déjà présente, qui n'avait pas ses capteurs : ceux apportés lui ont été ajoutés. */
  motionAdded?: boolean;
  /** Session déjà présente dont la fiche a reçu ce qui lui manquait (`completeRecord`). */
  recordCompleted?: boolean;
  /** Session déjà présente, à compléter, dont la fiche du disque n'a pas pu être relue : rien n'y est ajouté. */
  recordNotRead?: boolean;
  /**
   * Session déjà présente en lecture seule (fiche non lue, illisible, d'une version plus récente), à qui
   * la fiche apportée donnerait quelque chose : rien n'y est ajouté.
   */
  recordReadOnly?: boolean;
}

interface AddOptions {
  /** Support imposé ; absent : celui de la fiche importée, sinon deviné ; `null` : aucun (session à classer). */
  sport?: SportType | null;
  /** Activité choisie à l'enregistrement. */
  activityId?: string;
  /** Fiche qui accompagne le GPX, lors de l'import d'un dossier ; son résumé est refait. */
  record?: RecordWithoutSummary | null;
  /** Champs illisibles de cette fiche à sa lecture, réécrits tels quels (`parseRecordWithRaw`). */
  unreadable?: RecordUnreadable;
  /** Séances du compteur faites pendant l'enregistrement, rangées dans la fiche. */
  intervals?: IntervalSeries[];
  /** Repères du bouton « Note », rangés dans la fiche. */
  marks?: SessionMark[];
  /** Test guidé fait pendant l'enregistrement, rangé dans la fiche. */
  test?: SessionTest;
  /** Capteurs de l'enregistrement (`.imu`), rangés à côté du GPX. */
  motion?: Uint8Array;
  /** Foil de l'activité à l'enregistrement, rangé dans les réglages de la session. */
  foil?: boolean;
  /**
   * Fiche qui accompagne le GPX mais qu'on ne sait pas réécrire (version plus récente, illisible) :
   * rangée telle quelle, au caractère près, la session en lecture seule avec `warning` ; `parts` : ce
   * qu'on en a lu (version plus récente), sinon `null`. Elle ne complète pas une session déjà là.
   */
  keepRecordText?: KeptRecordText;
}

interface KeptRecordText {
  text: string;
  warning: string;
  parts: RecordWithoutSummary | null;
}

/** Fiche à ranger telle quelle (`KeptRecordText`) : d'une version plus récente, ou illisible ; `undefined` si on sait la réécrire. */
const recordToKeep = (text: string, parsed: ParsedRecord | null): KeptRecordText | undefined => {
  if (!parsed) return { text, warning: UNREADABLE_RECORD_WARNING, parts: null };
  return isWritableRecord(parsed.parts) ? undefined : { text, warning: FUTURE_RECORD_WARNING, parts: parsed.parts };
};

/**
 * Capteurs d'un enregistrement à leur entrée dans la mémoire : élagués autour
 * des vols si le calcul de la session mesure les sauts, autour des glisses en
 * surf (vols sur foil, vagues sinon, au seuil de la fiche ou de l'activité)
 * si son profil le demande (`pump.pruneCapture`), sinon gardés entiers. En
 * voile sur foil, Pumping coché (fiche, sinon activité), gardés entiers aussi :
 * le pumping se mesure sur tout le vol (décision du 28/10).
 * Une capture qui mesurait la cadence (déjà écrite dans le GPX) est gardée
 * entière tant que la mesure se règle (`cadence.keepCapture`) ; ensuite, sans
 * sauts mesurés, elle n'est pas rangée (`null`).
 * En cas d'échec, la capture complète : on ne perd jamais de mesure par erreur.
 */
const prunedMotion = async (
  motion: Uint8Array, sport: SportType | null, text: string, analysis?: SessionAnalysis | null, activityId?: string | null
): Promise<Uint8Array | null> => {
  if (!sport) return motion;
  const profile = getSportProfile(sport);
  try {
    const setup = decodeImuHeader(motion)?.setup;
    if (setup?.cadence && profile.cadence) {
      if (profile.cadence.keepCapture) return motion;
      if (setup.jumps === false) return null;
    }
    if (profile.surf) {
      if (!profile.pump?.pruneCapture) return motion;
      const rides = surfRides(parseGpx(text).rawPoints, sport, summaryOptions(sport, analysis, activitySummarySettings(activityId)(sport)));
      return rides ? await pruneSurfImu(motion, rides, profile.pump.pruneMarginS) : motion;
    }
    if (sportTreatment(sport) === 'voile') {
      const activity = activityOfSession(sport, activityId);
      const foil = analysis?.foil ?? setup?.foil ?? false;
      const pumping = analysis?.pumping ?? effectivePumping(activity) ?? false;
      if (keepsWholeCaptureForPumping(profile.pump, foil, pumping)) return motion;
    }
    const detection = profile.jumps?.detection;
    return detection ? await pruneImuFile(motion, detection) : motion;
  } catch {
    return motion;
  }
};

/**
 * Fiche d'une session qui entre dans la mémoire sous le nom `gpx` : celle qui l'accompagne (import d'un
 * dossier, session en attente), son résumé refait, sinon une neuve, à l'activité et au foil choisis à
 * l'enregistrement ; avec les séances du compteur, les repères et le test guidé de l'enregistrement.
 */
const recordFor = (gpx: string, analyzed: AnalyzedGpx, source: SessionSource, options: AddOptions): SessionRecord => {
  const made = options.record
    ? withSummary({ ...options.record, gpx, sport: analyzed.sport }, analyzed.summary)
    : {
      ...newRecord(gpx, analyzed, source, options.activityId ?? null),
      ...(options.foil !== undefined ? { analysis: readAnalysis({ foil: options.foil, savedAt: Date.now() }) } : {}),
    };
  // Capture de la seule cadence : la fiche dit tout de suite qu'il n'y a pas de sauts à chercher.
  const jumpsUnmeasured = options.motion && decodeImuHeader(options.motion)?.setup.jumps === false;
  return {
    ...made,
    ...(options.intervals && options.intervals.length > 0 ? { intervals: options.intervals } : {}),
    ...(options.marks && options.marks.length > 0 ? { marks: options.marks } : {}),
    ...(options.test ? { test: options.test } : {}),
    ...(jumpsUnmeasured && !made.jumps
      ? { jumps: { version: JUMPS_CALC_VERSION, computedAt: new Date().toISOString(), jumps: [], measured: false as const } }
      : {}),
  };
};

/** Range un GPX dans la mémoire, avec sa fiche. */
const addGpx = async (text: string, source: SessionSource, options: AddOptions): Promise<AddResult> => {
  const kept = options.keepRecordText;
  // Fiche qui dit le calcul, les réglages et l'activité du résumé : celle qui accompagne le GPX, même gardée telle quelle.
  const from = options.record ?? kept?.parts ?? null;
  let analyzed: AnalyzedGpx | null;
  try {
    const sport = options.sport !== undefined ? options.sport : from?.sport ?? undefined;
    const fields = options.test ? { ...from, test: options.test } : from;
    analyzed = analyzeGpx(text, sport, from?.analysis, activitySummarySettings(options.activityId ?? from?.activityId), fields);
  } catch (err) {
    return { status: 'invalid', file: null, message: errorMessage(err, 'GPX illisible.') };
  }
  if (!analyzed) return { status: 'invalid', file: null, message: 'Pas assez de points horodatés.' };

  const startMs = analyzed.summary.startMs;
  let existing = findSessionAt(startMs);
  // Première lecture du dossier en cours : sa session n'est peut-être pas encore publiée, on l'attend (aucune attente sinon).
  if (!existing && scanCompletion) {
    await scanCompletion.then(() => undefined, () => undefined);
    existing = findSessionAt(startMs);
  }
  // Fiche qui accompagne la session, à défaut celle de l'enregistrement (activité, foil, séances, repères,
  // test) : une session déjà là en reçoit ce qui lui manque. Application tuée entre le GPX et sa fiche : le
  // balayage a donné à la session une fiche neuve, que l'enregistrement repris (journal, attente) complète.
  // Une fiche gardée telle quelle (`keepRecordText`) ne complète rien.
  const incoming = !existing || kept
    ? null
    : options.record ?? (source === 'enregistrement' ? recordFor(existing.file, analyzed, source, options) : null);
  // Fiche du cache allégé : relue en entier, pour ne pas croire absents ses sauts, ses voies ou son altitude.
  if (existing?.partial && incoming && folder) {
    await hydrateSession(folder, existing.file).catch(() => undefined);
    existing = findSession(existing.file) ?? existing;
  }
  if (existing) {
    // Fiche du disque toujours pas relue : rien n'est complété, et c'est dit (`recordNotRead`).
    const recordNotRead = incoming !== null && existing.partial === true;
    // Session en lecture seule (fiche non lue, illisible, d'une version plus récente) à qui la fiche apportée
    // donnerait quelque chose : rien n'y est ajouté, et c'est dit (`recordReadOnly`).
    const recordReadOnly = incoming !== null && existing.readOnly && !existing.partial
      && completeRecord(existing.record, incoming).record !== existing.record;
    // Session entrée sans sa fiche complète (GPX importé seul) : celle de la copie lui donne ce qui
    // lui manque, sans rien écraser ; de même ses capteurs, s'ils ne sont pas encore là.
    let recordCompleted = false;
    if (incoming && !existing.readOnly && !existing.partial) {
      const { record, resummarize: stale } = completeRecord(existing.record, incoming);
      if (record !== existing.record) {
        replaceSession({ ...existing, record });
        scheduleRecordWrite(existing.file);
        recordCompleted = true;
        if (stale) void resummarize(existing.file);
      }
    }
    const duplicate: AddResult = {
      status: 'duplicate', file: existing.file, recordCompleted, ...(recordNotRead ? { recordNotRead } : {}), ...(recordReadOnly ? { recordReadOnly } : {}),
    };
    const f = folder;
    if (!options.motion || !f || hasSessionMotion(existing.file)) return duplicate;
    const motion = source === 'enregistrement'
      ? await prunedMotion(options.motion, analyzed.sport, text, existing.record.analysis, existing.record.activityId)
      : options.motion;
    if (!motion) return duplicate;
    await f.writeBytes(sessionPath(imuFileName(existing.file)), motion);
    knownNames.add(imuFileName(existing.file));
    // Publiée de nouveau : une analyse ouverte sur elle relit `hasSessionMotion` (onglets « sauts » et « pumping »).
    const withMotion = findSession(existing.file);
    if (withMotion) replaceSession({ ...withMotion });
    return { ...duplicate, motionAdded: true };
  }

  const f = folder;
  const name = sessionFileName(startMs, analyzed.sport);
  if (!f) {
    // Seul un enregistrement attend un dossier ; un import sans dossier est refusé (décision du 27/10).
    const pending = source === 'enregistrement' ? pendingFolder() : null;
    if (!pending) return { status: 'unsaved', file: null };
    // Les capteurs, puis la fiche, avant le GPX : un GPX en attente a toujours les siens complets à côté de lui.
    // La fiche garde ce que le GPX ne dit pas (activité, foil, séances, repères, test), repris au rangement.
    pendingWriting.add(name);
    try {
      if (options.motion) await pending.writeBytes(imuFileName(name), options.motion);
      await pending.writeText(recordFileName(name), serializeRecord(recordFor(name, analyzed, source, options), options.record ? options.unreadable : undefined));
      await pending.writeText(name, text);
    } finally {
      pendingWriting.delete(name);
    }
    await countPending();
    return { status: 'pending', file: null };
  }

  const gpx = uniqueSessionFileName(name, knownNames);
  // Fiche gardée telle quelle : la session la montre lue (version plus récente) ou sur une fiche neuve (illisible).
  const record = kept
    ? kept.parts ? withSummary({ ...kept.parts, gpx, sport: analyzed.sport }, analyzed.summary) : newRecord(gpx, analyzed, source)
    : recordFor(gpx, analyzed, source, options);
  // Un enregistrement est élagué en entrant ; un dossier importé est rangé tel quel.
  const motion = options.motion && source === 'enregistrement'
    ? await prunedMotion(options.motion, analyzed.sport, text, from?.analysis, options.activityId ?? from?.activityId)
    : options.motion;
  const written = [sessionPath(gpx), sessionPath(recordFileName(gpx)), ...(motion ? [sessionPath(imuFileName(gpx))] : [])];
  try {
    await f.writeText(sessionPath(gpx), text);
    await f.writeText(sessionPath(recordFileName(gpx)), kept ? kept.text : serializeRecord(record, options.record ? options.unreadable : undefined));
    if (motion) await f.writeBytes(sessionPath(imuFileName(gpx)), motion);
  } catch (err) {
    // Rangée à moitié, la session reparaîtrait sans sa fiche ou ses capteurs, et un nouvel essai ferait un doublon :
    // ce qui a été écrit est retiré, et l'appelant garde de quoi recommencer (journal de l'enregistreur, fichiers choisis).
    for (const path of written) await f.remove(path).catch(() => undefined);
    throw err;
  }
  knownNames.add(gpx);
  knownNames.add(recordFileName(gpx));
  if (motion) knownNames.add(imuFileName(gpx));
  rememberUnreadable(f, gpx, options.record && !kept ? options.unreadable : undefined);
  replaceSession({ file: gpx, record, readOnly: kept !== undefined, warning: kept?.warning ?? null });
  return { status: 'added', file: gpx };
};

/**
 * Range une session qui vient d'être enregistrée, avec les séances du
 * compteur faites pendant elle, ses repères (`marks`), ses capteurs (`motion`, le contenu du
 * `.imu`), le foil de son activité (`foil`, `null` hors voile et surf) et son test guidé (`test`). Rend son nom dans la mémoire et, en clair, l'endroit où elle se
 * trouve. Ne lève d'erreur que si l'écriture échoue : l'enregistreur garde
 * alors son journal. Une session mise en attente faute de dossier y attend
 * avec ses capteurs et sa fiche (activité, foil, séances, repères, test),
 * rangées avec elle dès qu'un dossier est là (`flushPending`). Une session
 * déjà dans la mémoire (fiche coupée par un arrêt de l'application) reçoit
 * de l'enregistrement ce qui manque à sa fiche (`completeRecord`).
 */
export const saveRecordedSession = async (
  text: string,
  sport: SportType | null,
  activityId: string | null,
  intervals: IntervalSeries[] = [],
  motion: Uint8Array | null = null,
  marks: SessionMark[] = [],
  foil: boolean | null = null,
  test: SessionTest | null = null
): Promise<{ file: string | null; location: string }> => {
  await opening;
  const result = await addGpx(text, 'enregistrement', {
    // Calcul inconnu (journal sans en-tête) : rien de deviné, la session est rangée « à classer ».
    sport, activityId: activityId ?? undefined, intervals, marks, motion: motion ?? undefined, foil: foil ?? undefined, test: test ?? undefined,
  });
  switch (result.status) {
    case 'added':
      return { file: result.file, location: state.folderLabel ?? 'mémoire' };
    case 'duplicate':
      // Fiche de la session déjà rangée non relue ou en lecture seule : rien n'y est ajouté, l'enregistreur garde son journal.
      if (result.recordNotRead) throw new Error('session déjà dans la mémoire, mais sa fiche n\'a pas pu être relue pour la compléter');
      if (result.recordReadOnly) throw new Error('session déjà dans la mémoire, mais sa fiche y est en lecture seule (non lue, illisible ou plus récente)');
      return { file: result.file, location: 'déjà dans la mémoire' };
    case 'pending':
      return { file: null, location: 'en attente d\'un dossier mémoire (dossier privé de l\'application)' };
    case 'unsaved':
      return { file: null, location: 'non rangée, aucune mémoire accessible : à télécharger' };
    default:
      throw new Error(result.message ?? 'session illisible');
  }
};

/** Fichier choisi dans le navigateur, lu seulement au moment de le ranger. */
const pickedEntry = (file: File): ImportEntry => ({
  name: file.name,
  key: (file.webkitRelativePath || file.name).replace(/\.(gpx|json|imu)$/i, '').toLowerCase(),
  readText: () => readPickedFile(file),
  readBytes: () => readPickedBytes(file),
});

/**
 * Importe des fichiers : des GPX, ou un dossier mémoire entier, dont chaque
 * fiche accompagne son GPX (notes et support compris). Chaque session est lue
 * juste avant d'être rangée, GPX, fiche et capteurs, puis relâchée : un
 * dossier entier n'est jamais chargé d'un coup (E-B1). Une session déjà
 * présente n'est pas dupliquée ; si elle n'avait pas ses capteurs, elle reçoit
 * ceux du dossier (`.imu`). Un fichier qu'on ne peut lire ou ranger n'arrête
 * pas les autres : il est nommé, avec la raison, dans une erreur. Sans
 * dossier mémoire, rien n'est rangé ni mis en attente (décision du 27/10).
 */
export const importEntries = async (entries: ImportEntry[]): Promise<ImportReport> => {
  setState({ importing: true });
  const report: ImportReport = {
    added: [], existing: [], duplicates: 0, invalid: [], ignored: [], unsaved: 0, failed: [], motionAdded: 0, recordCompleted: 0, recordNotRead: 0,
  };
  try {
    await opening;
    const records = new Map<string, ImportEntry>();
    const motions = new Map<string, ImportEntry>();
    for (const entry of entries) {
      if (/\.json$/i.test(entry.name)) records.set(entry.key, entry);
      else if (/\.imu$/i.test(entry.name)) motions.set(entry.key, entry);
    }

    for (const entry of entries) {
      if (!isGpxFileName(entry.name)) continue;
      try {
        const text = await entry.readText();
        if (text === null) {
          report.failed.push(`${entry.name} : illisible`);
          continue;
        }
        // GPX vide : pas une session, ni illisible.
        if (isBlankGpxText(text)) {
          report.ignored.push(entry.name);
          continue;
        }
        // GPX complet (`library/sessionBundle.ts`) : la fiche et les capteurs qu'il porte servent
        // à défaut de fichiers posés à côté ; la mémoire range le GPX sans eux.
        const bundle = unbundleSessionGpx(text);
        const recordText = await records.get(entry.key)?.readText();
        const hasSidecar = typeof recordText === 'string' && !isBlankRecordText(recordText);
        const sidecar = hasSidecar ? parseRecordWithRaw(recordText) : null;
        // Fiche posée à côté qu'on ne sait pas réécrire (version plus récente, illisible) : rangée telle quelle.
        const keepRecordText = hasSidecar ? recordToKeep(recordText, sidecar) : undefined;
        const fromSidecar = sidecar !== null && isWritableRecord(sidecar.parts);
        const record = fromSidecar ? sidecar.parts : keepRecordText ? null : bundle.record;
        const motion = (await motions.get(entry.key)?.readBytes()) ?? bundle.motion ?? undefined;
        const result = await addGpx(bundle.gpx, 'import', {
          record, motion, unreadable: fromSidecar ? sidecar.unreadable : keepRecordText ? undefined : bundle.unreadable, keepRecordText,
        });
        if (result.status === 'added' && result.file) report.added.push(result.file);
        else if (result.status === 'duplicate') {
          report.duplicates += 1;
          if (result.file) report.existing.push(result.file);
          if (result.motionAdded) report.motionAdded += 1;
          if (result.recordCompleted) report.recordCompleted += 1;
          if (result.recordNotRead) report.recordNotRead += 1;
        }
        else if (result.status === 'invalid') report.invalid.push(entry.name);
        else report.unsaved += 1;
      } catch (err) {
        report.failed.push(`${entry.name} : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    if (folder) scheduleCacheUpdate(folder);
    if (report.failed.length === 0) {
      setState({ message: describeImport(report) });
    } else {
      // Le compte rendu va avec l'échec : le bandeau d'erreur cacherait sinon le message.
      const n = report.failed.length;
      reportError(`${describeImport(report)} ${n} fichier${n > 1 ? 's' : ''} non rangé${n > 1 ? 's' : ''} (${report.failed.join(' ; ')})`);
    }
  } catch (err) {
    reportError(`Import interrompu : ${errorMessage(err, 'erreur inconnue')}`);
  } finally {
    setState({ importing: false });
  }
  return report;
};

/** Importe des fichiers choisis dans le navigateur (`importEntries`). */
export const importFiles = (files: File[]): Promise<ImportReport> => importEntries(files.map(pickedEntry));

/**
 * Sur le téléphone, ajoute les sessions d'un dossier que l'utilisateur désigne
 * (un dossier Tracker copié depuis le PC) : `importEntries` sur ses GPX, ses
 * fiches et ses capteurs, lus un par un. L'import est annoncé dès le
 * sélecteur, boutons grisés. `null` si l'utilisateur renonce.
 */
export const importFromFolder = async (): Promise<ImportReport | null> => {
  setState({ importing: true });
  let entries: ImportEntry[] | null;
  try {
    entries = await pickFolderToImport();
  } catch (err) {
    setState({ importing: false, message: `Lecture du dossier impossible : ${errorMessage(err, String(err))}` });
    return null;
  }
  if (!entries) {
    setState({ importing: false });
    return null;
  }
  return importEntries(entries);
};

/**
 * Peut-on importer : seulement dans une mémoire ouverte. Sans dossier, un
 * import est refusé plutôt que mis en attente (décision du 27/10) : seuls les
 * enregistrements attendent un dossier.
 */
export const canImportSessions = (s: Pick<LibraryState, 'status'>): boolean => s.status === 'ready';

/** Contenu du GPX d'une session, `null` s'il n'est pas lisible. */
export const readSessionGpx = async (file: string): Promise<string | null> => {
  await opening;
  return folder ? folder.readText(sessionPath(file)) : null;
};

/**
 * Relit en entier la fiche d'une session tirée du cache allégé : altitude du
 * terrain, voies et sauts rangés. Sans effet sur une fiche déjà entière ; un
 * échec est dit, et la session reste partielle.
 */
export const loadFullSession = async (file: string): Promise<void> => {
  await opening;
  const f = folder;
  if (!f) return;
  try {
    await hydrateSession(f, file);
    // Déjà relue par le balayage de fond, pas encore publiée : l'analyse la voit entière tout de suite.
    if (publishPending) publish();
  } catch (err) {
    reportError(`Fiche de ${file} non relue : ${errorMessage(err, 'erreur inconnue')}`);
  }
};

/**
 * GPX d'une session à ouvrir dans une analyse, `null` s'il n'est pas
 * lisible. Sa fiche est d'abord relue en entier (`loadFullSession`) : la trace
 * n'existe qu'une fois l'altitude, les voies et les sauts rangés connus, et
 * l'analyse ne les redemande pas.
 */
export const loadSessionGpx = async (file: string): Promise<string | null> => {
  await loadFullSession(file);
  return readSessionGpx(file);
};

/**
 * GPX complet d'une session, pour « Télécharger la session » : le GPX tel que
 * rangé, sa fiche entière, avec ses champs illisibles à la lecture, et ses
 * capteurs (`library/sessionBundle.ts`).
 * `null` si le GPX n'est pas lisible.
 */
export const readSessionExport = async (
  file: string
): Promise<{ gpx: string; record: SessionRecord; unreadable: RecordUnreadable | undefined; motion: Uint8Array | null } | null> => {
  await opening;
  const f = folder;
  const session = findSession(file);
  if (!f || !session) return null;
  const gpx = await f.readText(sessionPath(file));
  if (gpx === null) return null;
  const { record, unreadable } = await fullRecordIn(f, session);
  return { gpx, record, unreadable, motion: await readSessionMotion(file) };
};

/** Vrai si la session a ses capteurs (`.imu`) dans la mémoire. */
export const hasSessionMotion = (file: string): boolean => knownNames.has(imuFileName(file));

/** Capteurs d'une session (`.imu`), `null` si elle n'en a pas ou hors de la mémoire. */
export const readSessionMotion = async (file: string): Promise<Uint8Array | null> => {
  await opening;
  return folder && hasSessionMotion(file) ? folder.readBytes(sessionPath(imuFileName(file))) : null;
};

/**
 * Modifie la fiche d'une session (`applyRecordPatch`) : support, activité,
 * nom, notes, réglages d'analyse, nombre de manœuvres. La liste suit tout de
 * suite ; le fichier est écrit un instant plus tard, et le résumé recalculé
 * si le changement le demande.
 */
export const updateSessionRecord = (file: string, patch: RecordPatch): void => {
  const session = findSession(file);
  if (!session || session.readOnly) return;
  const { record, resummarize: stale } = applyRecordPatch(session.record, patch);
  if (record === session.record) return;
  editCount += 1;
  lastEdit.set(file, editCount);
  replaceSession({ ...session, record });
  scheduleRecordWrite(file);
  if (stale) void resummarize(file);
};

/**
 * Résumé recalculé avec les réglages de la fiche, pris après la lecture du
 * GPX : un second changement fait pendant ce temps n'est pas recouvert par un
 * résumé calculé avant lui. La fiche est relue en entier d'abord : l'altitude
 * du terrain entre dans le dénivelé.
 */
const resummarize = async (file: string): Promise<void> => {
  const f = folder;
  if (!f || !findSession(file)) return;
  try {
    const text = await f.readText(sessionPath(file));
    await hydrateSession(f, file);
    const session = findSession(file);
    if (text === null || !session || session.readOnly || session.partial || folder !== f) return;
    const analyzed = analyzeGpx(text, session.record.sport, session.record.analysis, activitySummarySettings(session.record.activityId), session.record);
    if (!analyzed) return;
    replaceSession({ ...session, record: withSummary(session.record, analyzed.summary) });
    scheduleRecordWrite(file);
  } catch {
    // Trace ou fiche illisible : le résumé précédent reste affiché.
  }
};

/**
 * Supprime une session : son GPX, sa fiche et ses capteurs, ainsi que les copies de la même
 * trace sous un autre nom, qui sans cela prendraient sa place dans la liste. Elles quittent
 * la liste avant les suppressions sur le disque, et restent dans `removing` jusqu'à la fin :
 * un recalcul de fond qui les traite ne les y remet pas (E-B4, 27/10).
 */
export const removeSession = async (file: string): Promise<void> => {
  const f = folder;
  const session = findSession(file);
  if (!f || !session) return;
  const files = all.filter((s) => s.record.summary.startMs === session.record.summary.startMs).map((s) => s.file);
  for (const name of files) {
    removing.add(name);
    cancelRecordWrite(name);
    unwritten.delete(name);
  }
  all = all.filter((s) => !files.includes(s.file));
  publish();
  try {
    for (const name of files) {
      // Le GPX d'abord : il fait l'identité. Un échec ensuite laisse une fiche ou des capteurs orphelins,
      // ignorés, et non un GPX sans fiche qui reviendrait, sans ses notes, au lancement suivant.
      await f.remove(sessionPath(name));
      await f.remove(sessionPath(recordFileName(name)));
      await f.remove(sessionPath(imuFileName(name)));
      rememberUnreadable(f, name, undefined);
      knownNames.delete(name);
      knownNames.delete(recordFileName(name));
      knownNames.delete(imuFileName(name));
    }
  } catch (err) {
    setState({ error: `Suppression incomplète : ${errorMessage(err, 'erreur inconnue')}` });
  } finally {
    for (const name of files) removing.delete(name);
  }
  all = all.filter((s) => !files.includes(s.file));
  publish();
  for (const name of files) cacheDirty.add(name);
  scheduleCacheUpdate(f);
};

/**
 * Fiche entière d'une session de la mémoire `f`, pour la recopier ailleurs :
 * une fiche allégée est complétée par celle du disque. Avec ses champs
 * illisibles à la lecture (`RecordUnreadable`), à réécrire tels quels.
 */
const fullRecordIn = async (
  f: MemoryFolder, session: LibrarySession
): Promise<{ record: SessionRecord; unreadable: RecordUnreadable | undefined }> => {
  if (!session.partial) return { record: session.record, unreadable: unreadableOf(f, session.file) };
  const text = await f.readText(sessionPath(recordFileName(session.file)));
  const parsed = text === null ? null : parseRecordWithRaw(text);
  const summary = parsed?.parts.summary;
  return parsed && summary
    ? { record: mergeLightRecord({ ...parsed.parts, summary }, session.record), unreadable: parsed.unreadable }
    : { record: session.record, unreadable: undefined };
};

/**
 * Fiche d'une session de la mémoire `f` à recopier dans une autre : entière (`fullRecordIn`), sauf celle
 * d'une session en lecture seule, relue sur le disque et rangée telle quelle si on ne sait pas la
 * réécrire (version plus récente, illisible : `keepRecordText`).
 */
const recordToCopy = async (f: MemoryFolder, session: LibrarySession): Promise<Pick<AddOptions, 'record' | 'unreadable' | 'keepRecordText'>> => {
  if (!session.readOnly) return fullRecordIn(f, session);
  const text = await f.readText(sessionPath(recordFileName(session.file)));
  if (text === null || isBlankRecordText(text)) return { record: null };
  const parsed = parseRecordWithRaw(text);
  const keepRecordText = recordToKeep(text, parsed);
  return keepRecordText ? { record: null, keepRecordText } : { record: parsed?.parts ?? null, unreadable: parsed?.unreadable };
};

/**
 * Au changement de dossier (décision du 01/11) : les saisies des fiches qu'on n'avait pas pu écrire
 * dans l'ancien (`carried`) sont reportées sur la même session du nouveau, retrouvée par le début de
 * trace (`carryRecordEdits`), puis écrites. Une session absente du nouveau dossier, ou dont la fiche ne
 * s'y écrit pas (lecture seule), est dite. Sans dossier ouvert (accès refusé, dossier inutilisable),
 * elles restent de côté pour le prochain (`heldUnwritten`).
 */
const carryUnwritten = async (carried: readonly LibrarySession[]): Promise<void> => {
  if (carried.length === 0) return;
  if (!folder) {
    heldUnwritten = [...carried, ...heldUnwritten];
    return;
  }
  // Les GPX sans fiche du nouveau dossier n'entrent dans la liste qu'une fois leur fiche créée.
  if (scanCompletion) await scanCompletion.then(() => undefined, () => undefined);
  const missed: string[] = [];
  for (const old of carried) {
    const target = findSessionAt(old.record.summary.startMs);
    if (!target || target.readOnly) {
      missed.push(old.file);
      continue;
    }
    const { record, resummarize: stale } = carryRecordEdits(target.record, old.record);
    if (record === target.record) continue;
    editCount += 1;
    lastEdit.set(target.file, editCount);
    replaceSession({ ...target, record });
    scheduleRecordWrite(target.file);
    if (stale) void resummarize(target.file);
  }
  if (missed.length > 0) {
    reportError(`Changements non reportés dans le nouveau dossier, la session n'y est pas ou sa fiche ne s'y écrit pas : ${missed.join(', ')}`);
  }
};

/** Vrai si l'on peut désigner un vrai dossier comme mémoire (Chrome et Edge sur ordinateur). */
export const canChooseMemoryFolder = canChooseFolder;

/**
 * Désigne un dossier comme mémoire, depuis un clic. Les sessions de la
 * mémoire du navigateur y sont recopiées ; les changements qu'on n'avait pas
 * pu écrire dans l'ancien dossier sont reportés dans le nouveau.
 */
export const chooseFolder = async (): Promise<void> => {
  let picked: MemoryFolder | null;
  try {
    picked = await chooseMemoryFolder();
  } catch (err) {
    setState({ error: err instanceof FolderRefusedError ? err.message : `Dossier inaccessible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (!picked) return;
  const previous = folder;
  // Les saisies en attente partent dans l'ancienne mémoire avant qu'on la quitte.
  await flushWrites();
  const carried = takeUnwritten();
  const previousSessions = previous?.kind === 'browser' ? [...all] : [];
  let settingsChanged: boolean;
  try {
    settingsChanged = await attach(picked);
  } catch (err) {
    detach('unavailable', picked.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
    await carryUnwritten(carried);
    return;
  }

  if (previous && previousSessions.length > 0) {
    let copied = 0;
    for (const session of previousSessions) {
      try {
        const text = await previous.readText(sessionPath(session.file));
        if (text === null) continue;
        const motion = await previous.readBytes(sessionPath(imuFileName(session.file)));
        const result = await addGpx(text, session.record.source, { ...await recordToCopy(previous, session), motion: motion ?? undefined });
        if (result.status === 'added') copied += 1;
      } catch (err) {
        reportError(`${session.file} non recopiée dans le dossier : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    if (copied > 0) {
      setState({ message: `${copied} session${copied > 1 ? 's' : ''} de la mémoire du navigateur recopiée${copied > 1 ? 's' : ''} dans le dossier.` });
    }
  }
  // Après la recopie : une session de la mémoire du navigateur que le dossier n'avait pas y est maintenant.
  await carryUnwritten(carried);
  await applySettingsChange(settingsChanged);
};

/** Redonne l'autorisation au dossier choisi, depuis un clic. */
export const reconnectFolder = async (): Promise<void> => {
  let f: MemoryFolder | null;
  try {
    f = await reconnectMemoryFolder();
  } catch (err) {
    if (err instanceof FolderRefusedError) {
      // Dossier retenu écarté (un sous-dossier d'une mémoire) : retour à la mémoire du navigateur.
      const carried = takeUnwritten();
      await openLibrary();
      setState({ error: err.message });
      await carryUnwritten(carried);
      return;
    }
    setState({ error: `Dossier inaccessible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (!f) {
    setState({ error: 'Autorisation refusée : le dossier reste inaccessible.' });
    return;
  }
  // Sur le téléphone, le dossier est désigné de nouveau : les changements pas encore écrits y sont reportés,
  // même mis de côté quand l'accès a été perdu (`detach` en « needs-permission »).
  const carried = takeUnwritten();
  let settingsChanged = false;
  try {
    settingsChanged = await attach(f);
  } catch (err) {
    detach('unavailable', f.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
  }
  await carryUnwritten(carried);
  await applySettingsChange(settingsChanged);
};

/** Oublie le dossier choisi et revient à la mémoire du navigateur, où sont reportés les changements pas encore écrits. */
export const switchToBrowserMemory = async (): Promise<void> => {
  await flushWrites();
  const carried = takeUnwritten();
  await forgetChosenFolder();
  await openLibrary();
  await carryUnwritten(carried);
};

/** Relecture en cours : un second appui attend la même. */
let refreshing: Promise<void> | null = null;

/**
 * Relit le dossier mémoire sans le refermer (« Mettre à jour ») : sessions et
 * itinéraires copiés depuis un autre appareil, réglages plus récents (qui
 * rechargent la page, comme au lancement). La liste reste affichée pendant la
 * relecture ; les écritures en attente partent d'abord, celles qui avaient
 * échoué comprises, pour qu'une fiche modifiée ne soit pas remplacée par
 * celle du disque (une fiche toujours pas écrite garde sa version en mémoire,
 * et son erreur reste dite). Le compte rendu dit combien de sessions sont
 * apparues.
 */
export const refreshLibrary = (): Promise<void> => {
  if (refreshing) return refreshing;
  const scanned = (async () => {
    await opening;
    const f = folder;
    if (!f || state.status !== 'ready') return null;
    setState({ refreshing: true, message: null, error: null });
    // Balayage en cours : ce qu'il n'a pas encore publié compte parmi les sessions d'avant.
    if (publishPending) publish();
    const before = new Set(state.sessions.map((s) => s.record.summary.startMs));
    // Une saisie faite à partir d'ici garde sa version en mémoire (`keptInMemory`).
    const editsBefore = editCount;
    await flushWrites();
    generation += 1;
    cancelCacheUpdate();
    const gen = generation;
    // Relecture voulue : les résumés qu'on n'avait pas su refaire sont retentés.
    refreshFailed.clear();
    const settingsChanged = await syncSettingsSafely(f);
    const jobs = await scan(f, gen, editsBefore);
    if (gen !== generation) return null;
    setState({ revision: state.revision + 1 });
    // Le balayage avant les sessions en attente, comme à l'ouverture (`attach`) ; son échec est dit plus bas.
    const completion = completeScan(f, gen, jobs);
    completion.catch(() => undefined);
    await flushPending();
    return { gen, completion, before, settingsChanged };
  })();
  // Les écritures (enregistrement, import) attendent la lecture du dossier, pas le calcul des fiches.
  opening = scanned.then(() => undefined, () => undefined);
  refreshing = scanned
    .then(async (read) => {
      if (!read) return;
      await read.completion;
      if (read.gen !== generation) return;
      const after = new Set(state.sessions.map((s) => s.record.summary.startMs));
      const added = [...after].filter((startMs) => !read.before.has(startMs)).length;
      const removed = [...read.before].filter((startMs) => !after.has(startMs)).length;
      const changes = [
        ...(added > 0 ? [`${plural(added, 'session')} de plus`] : []),
        ...(removed > 0 ? [`${plural(removed, 'session')} en moins`] : []),
      ];
      setState({ message: `Dossier relu : ${changes.length > 0 ? changes.join(', ') : 'rien de nouveau'}.` });
      await applySettingsChange(read.settingsChanged);
    })
    .catch((err: unknown) => {
      setState({ scanning: null, toUpdate: 0, error: `Relecture du dossier impossible : ${errorMessage(err, 'erreur inconnue')}` });
    })
    .finally(() => {
      refreshing = null;
      setState({ refreshing: false });
    });
  return refreshing;
};

/** Recalcul des résumés périmés en cours (`queueOutdatedRefresh`), et s'il faut réévaluer à sa fin. */
let outdatedRefresh: Promise<void> | null = null;
let outdatedAgain = false;

/**
 * Refait en tâche de fond les résumés que les réglages d'aujourd'hui rendent périmés (seuil d'une
 * activité changé dans Réglages, pré-réglage effacé, activité supprimée…), lot 37 : une trace à la
 * fois, par le même passage que les fiches du lancement (`completeScan`), la plus récente d'abord.
 * Attend la fin de l'ouverture, d'une relecture ou d'un passage en cours ; s'arrête avec lui si la
 * mémoire change (`generation`). Appelé de nouveau pendant qu'il tourne, il réévalue une fois à la
 * fin. Rien n'est relu ni écrit quand aucun résumé n'est périmé ; une trace déjà tentée sans succès
 * depuis l'ouverture n'est pas retentée (`refreshFailed`).
 */
export const queueOutdatedRefresh = (): Promise<void> => {
  if (outdatedRefresh) {
    outdatedAgain = true;
    return outdatedRefresh;
  }
  const run = (async () => {
    do {
      outdatedAgain = false;
      for (;;) {
        await opening;
        if (refreshing) await refreshing;
        else if (scanPass) await scanPass.then(() => undefined, () => undefined);
        else break;
      }
      const f = folder;
      if (!f || state.status !== 'ready') return;
      const files = outdatedRefreshFiles(all, summaryOutdatedTest(), refreshFailed);
      if (files.length === 0) continue;
      await completeScan(f, generation, files.map((file): SummaryJob => ({ file, kind: 'refresh', readOnly: false, warning: null })), true);
    } while (outdatedAgain);
  })()
    .catch((err: unknown) => {
      setState({ scanning: null, toUpdate: 0, error: `Mise à jour des résumés interrompue : ${errorMessage(err, 'erreur inconnue')}` });
    })
    .finally(() => {
      outdatedRefresh = null;
    });
  outdatedRefresh = run;
  return run;
};

export const dismissLibraryMessage = (): void => setState({ message: null, error: null });

/** Ferme la proposition d'un nouveau fichier de réglages ; il reste dans la liste de Réglages › Mémoire. */
export const dismissSettingsOffer = (): void => setState({ settingsOffer: null });

/** État de la bibliothèque, lu hors d'un composant. */
export const readLibraryState = (): LibraryState => state;

/**
 * Quelques champs de l'état : le composant n'est rendu de nouveau que si l'un
 * d'eux change (ni le balayage ni les messages, s'il ne les lit pas).
 */
export const useLibraryFields = <K extends keyof LibraryState>(...keys: K[]): Pick<LibraryState, K> => {
  const last = useRef<Pick<LibraryState, K> | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const prev = last.current;
    if (prev && keys.every((k) => prev[k] === state[k])) return prev;
    const next = {} as Pick<LibraryState, K>;
    for (const k of keys) next[k] = state[k];
    last.current = next;
    return next;
  });
};

/** Session d'un fichier, lue hors d'un composant, doublons compris. */
export const librarySession = (file: string): LibrarySession | undefined => findSession(file);

/** Session d'un fichier, ou `undefined` si la bibliothèque ne la connaît pas. */
export const findLibrarySession = (sessions: LibrarySession[], file: string | null): LibrarySession | undefined =>
  file === null ? undefined : sessionOfFile(sessions, file);

/**
 * Une partie de l'état de la bibliothèque : le composant n'est rendu de
 * nouveau que si elle change (une analyse ne suit pas le balayage ni les
 * messages). `select` doit rendre une valeur stable pour un même état : une
 * primitive, ou un objet déjà rangé dans l'état, jamais un objet neuf.
 */
export const useLibrarySelector = <T>(select: (s: LibraryState) => T): T =>
  useSyncExternalStore(subscribe, () => select(state));

/**
 * Session d'un fichier, `undefined` si la bibliothèque ne la connaît pas.
 * Elle garde son identité tant que sa fiche ne change pas.
 */
export const useLibrarySession = (file: string | null): LibrarySession | undefined =>
  useLibrarySelector((s) => findLibrarySession(s.sessions, file));

/** Nom donné par l'utilisateur à la session d'un fichier, `null` sans nom ou hors de la mémoire. */
export const useSessionName = (file: string | null): string | null =>
  useLibrarySelector((s) => findLibrarySession(s.sessions, file)?.record.name ?? null);

/**
 * Dossier mémoire en service, une fois l'ouverture en cours terminée ; `null`
 * s'il n'y en a aucun d'accessible. Pour ce qui se range à côté des sessions :
 * les itinéraires (`useRouteLibrary`).
 */
export const currentMemoryFolder = async (): Promise<MemoryFolder | null> => {
  await opening;
  return folder;
};
