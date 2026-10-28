import { useRef, useSyncExternalStore } from 'react';
import { baseActivity, sessionActivity } from '../core/activities';
import { parseGpx } from '../core/gpxParser';
import { decodeImuHeader } from '../core/imuFile';
import { pruneImuFile } from '../core/imuPrune';
import { JUMPS_CALC_VERSION } from '../core/jumps';
import { keepsWholeCaptureForPumping } from '../core/pumping';
import { pruneSurfImu } from '../surfing/pumping';
import type { SessionMark } from '../core/sessionMarks';
import { SAILING_SPORTS, getSportProfile, hasPositions, isLandTreatment, sportTreatment } from '../core/sportProfiles';
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
import { guessSport, uniqueSessionFileName } from '../library/naming';
import {
  RECORD_FORMAT,
  RECORD_VERSION,
  applyRecordPatch,
  completeRecord,
  dedupeSessions,
  findLegacyNotes,
  imuFileName,
  isGpxFileName,
  isSummaryStale,
  isWritableRecord,
  lightRecord,
  mergeLightRecord,
  parseRecord,
  parseRecordParts,
  readAnalysis,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type RecordPatch,
  type RecordWithoutSummary,
  type SessionAnalysis,
  type SessionRecord,
  type SessionSource,
  type SessionSummary,
} from '../library/record';
import { lowerRecordExtension, planReconcile, type LibraryCache } from '../library/reconcile';
import { unbundleSessionGpx } from '../library/sessionBundle';
import {
  TRAVELLING_KEYS,
  adoptedValues,
  buildSettingsFile,
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
import { summarizeHeartRateSession, summarizeSession, surfRides, type SummaryOptions } from '../library/summary';
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
import { jsonStore } from '../platform/storage';
import type { IntervalSeries } from '../recording/intervalTimer';
import type { SessionTest } from '../recording/fitnessTest';
import { sessionFileName } from '../recording/session';
import { effectiveFoil, effectivePumping, effectiveThresholdOverride, readStoredActivities } from './useSportSettings';
import { createListeners } from './createStore';
import { newId, plural } from '../core/basics';

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
  /** Fiches en cours de création ou de recalcul. */
  scanning: { done: number; total: number } | null;
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

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

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

const publish = (): void => {
  const { kept, duplicates } = dedupeSessions(all);
  setState({ sessions: kept, duplicates: duplicates.map((s) => s.file) });
};

const findSession = (file: string): LibrarySession | undefined => all.find((s) => s.file === file);

/**
 * Fichiers en cours de suppression (`removeSession`) : un recalcul ou une
 * relecture qui finit pendant ce temps ne les remet pas dans la liste et
 * n'en réécrit pas la fiche.
 */
const removing = new Set<string>();

/**
 * Fiches dont la dernière écriture a échoué : le fichier du disque n'est pas
 * la fiche en mémoire, qui n'entre donc pas dans le cache (E-B10). Retirées à
 * la première écriture réussie.
 */
const unwritten = new Set<string>();

const replaceSession = (session: LibrarySession): void => {
  if (removing.has(session.file)) return;
  all = [...all.filter((s) => s.file !== session.file), session];
  publish();
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
  entries: LibraryCache;
}

const folderId = (f: MemoryFolder): string => `${f.kind}:${f.label}`;

const readCache = (f: MemoryFolder): { entries: LibraryCache; light: boolean } => {
  const cache = jsonStore.read<StoredCache>(CACHE_KEY);
  return cache && cache.folder === folderId(f) && cache.entries
    ? { entries: cache.entries, light: cache.light === true }
    : { entries: {}, light: false };
};

/** Cache reconstruit d'après le contenu réel de `sessions/` et les fiches connues, allégées. */
const refreshCache = async (f: MemoryFolder, gen: number): Promise<void> => {
  const entries = await f.list(SESSIONS_DIR);
  if (gen !== generation) return;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const next: LibraryCache = {};
  for (const session of all) {
    // Une fiche en attente ou en cours d'écriture diffère encore du fichier : elle sera relue au prochain lancement.
    if (session.readOnly || recordTimers.has(session.file) || writing.has(session.file) || unwritten.has(session.file)) continue;
    const name = recordFileName(session.file);
    const entry = byName.get(name);
    if (entry) next[name] = { size: entry.size, mtimeMs: entry.mtimeMs, record: lightRecord(session.record) };
  }
  jsonStore.write(CACHE_KEY, { folder: folderId(f), light: true, entries: next } satisfies StoredCache);
};

const FUTURE_RECORD_WARNING = 'Fiche écrite par une version plus récente de Tracker : lue sans être modifiée.';
const UNREADABLE_RECORD_WARNING = 'Fiche illisible, laissée telle quelle : le résumé affiché est recalculé.';
const DAMAGED_RECORD_WARNING = 'Fiche devenue illisible, laissée telle quelle : les changements ne sont plus enregistrés.';

/** Relectures en cours, une seule par session. */
const hydrating = new Map<string, Promise<void>>();

/**
 * Relit en entier la fiche d'une session tirée du cache allégé (`partial`),
 * et la fond dans la session telle qu'elle est après la lecture : une saisie
 * faite pendant ce temps est gardée (`mergeLightRecord`). Une fiche absente
 * laisse la mémoire telle quelle, qui est alors tout ce qu'on a ; une fiche
 * illisible ou d'une version future met la session en lecture seule. Une
 * erreur de lecture remonte, et la session reste partielle : rien ne doit
 * alors être écrit.
 */
const hydrateSession = (f: MemoryFolder, file: string): Promise<void> => {
  if (!findSession(file)?.partial) return Promise.resolve();
  let pending = hydrating.get(file);
  if (!pending) {
    pending = (async () => {
      const text = await f.readText(sessionPath(recordFileName(file)));
      const current = findSession(file);
      if (!current?.partial || folder !== f) return;
      const parts = text === null ? null : parseRecordParts(text);
      // Résumé du disque illisible (écriture interrompue) : celui de la mémoire, refait depuis le GPX, le remplace (E-B10).
      const disk = parts ? { ...parts, summary: parts.summary ?? current.record.summary } : null;
      if (text !== null && !disk) {
        replaceSession({ ...current, partial: false, readOnly: true, warning: DAMAGED_RECORD_WARNING });
      } else if (disk && !isWritableRecord(disk)) {
        replaceSession({ ...current, record: { ...disk, gpx: file }, partial: false, readOnly: true, warning: FUTURE_RECORD_WARNING });
      } else {
        replaceSession({ ...current, record: disk ? mergeLightRecord(disk, current.record) : current.record, partial: false });
      }
    })().finally(() => hydrating.delete(file));
    hydrating.set(file, pending);
  }
  return pending;
};

// --- Résumés ---

/**
 * Réglages qui changent le résumé : ceux de l'activité de la session, et ceux
 * de la session (`analysis`, dans sa fiche). Le seuil de la session prime sur
 * celui de l'activité ; l'allure imposée n'existe que pour une session, et
 * qu'en voile. L'altitude du terrain de la fiche remplace celle du GPS en
 * course et à vélo, sauf si l'utilisateur a gardé le GPS. En surf, le foil
 * de la session (sinon de son activité) et son seuil de vague en foil.
 */
const summaryOptions = (
  sport: SportType | null,
  analysis?: SessionAnalysis | null,
  activityId?: string | null,
  elevation?: SessionElevation | null
): SummaryOptions => {
  if (sport === null) return {};
  const activity = sessionActivity(readStoredActivities(), activityId, sport) ?? baseActivity(sport);
  return {
    // Le seuil de la session, sinon celui réglé ou pré-réglé pour son activité (0 : aucun seuil réglé, arrêts complets ôtés d'office).
    activeThreshold: analysis?.activeThreshold ?? effectiveThresholdOverride(activity),
    referenceSpeedOverrideMs: SAILING_SPORTS.includes(sport) ? analysis?.referenceSpeedMs ?? undefined : undefined,
    terrainElevation:
      isLandTreatment(sportTreatment(sport)) && elevation?.elevationSource !== 'gps' ? elevation?.terrainElevation : undefined,
    // Surf : le foil de la session, sinon celui de son activité ; son seuil de vague en foil.
    foil: analysis?.foil ?? effectiveFoil(activity) ?? undefined,
    waveThreshold: analysis?.waveThreshold ?? undefined,
    test: elevation?.test,
  };
};

/** Altitude de la fiche (celle du terrain, et la source choisie) et son test guidé. */
type SessionElevation = Pick<SessionRecord, 'terrainElevation' | 'elevationSource' | 'test'>;

interface AnalyzedGpx {
  summary: SessionSummary;
  sport: SportType | null;
  title: string | null;
}

/**
 * Lit un GPX et le résume. `sport` absent : deviné depuis la trace.
 * `analysis` : réglages d'analyse de la fiche (seuil, allure), s'il y en a ;
 * `activityId` : son activité, dont les réglages s'appliquent ;
 * `elevation` : son altitude du terrain, la source choisie et son test guidé.
 * Rend `null` si la trace a moins de deux points, lève une erreur si le XML
 * est illisible.
 */
const analyzeGpx = (
  text: string,
  sport?: SportType | null,
  analysis?: SessionAnalysis | null,
  activityId?: string | null,
  elevation?: SessionElevation | null
): AnalyzedGpx | null => {
  const parsed = parseGpx(text);
  const resolved = sport === undefined ? guessSport(parsed.trackType) : sport;
  // Session sans trace (muscu) : ses points n'ont que l'heure et la FC.
  const summary = resolved !== null && !hasPositions(resolved)
    ? summarizeHeartRateSession(parsed.timedPoints, resolved)
    : summarizeSession(parsed.rawPoints, resolved, summaryOptions(resolved, analysis, activityId, elevation));
  return summary ? { summary, sport: resolved, title: parsed.trackName ?? null } : null;
};

/**
 * Résumé d'un GPX hors de la mémoire (image de partage d'une session en
 * attente), avec les réglages de son activité, comme la fiche le calculerait.
 * `null` si la trace a moins de deux points ; lève si le XML est illisible.
 */
export const summarizeGpxText = (text: string, sport: SportType, activityId: string | null): SessionSummary | null =>
  analyzeGpx(text, sport, null, activityId)?.summary ?? null;

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

/** Nouveau résumé, en gardant le nombre et la réussite des manœuvres de la dernière analyse. */
const withSummary = (record: RecordWithoutSummary, summary: SessionSummary): SessionRecord => ({
  ...record,
  summary: {
    ...summary,
    ...(record.summary?.maneuverCount !== undefined ? { maneuverCount: record.summary.maneuverCount } : {}),
    ...(record.summary?.maneuverResults !== undefined ? { maneuverResults: record.summary.maneuverResults } : {}),
  },
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
  if (!f || removing.has(file) || !findSession(file)) return false;
  writing.set(file, (writing.get(file) ?? 0) + 1);
  try {
    await hydrateSession(f, file);
    const session = findSession(file);
    if (!session || removing.has(file) || session.readOnly || session.partial || folder !== f) return false;
    await f.writeText(sessionPath(recordFileName(file)), serializeRecord(session.record));
    unwritten.delete(file);
    return true;
  } catch (err) {
    unwritten.add(file);
    reportError(`Fiche de ${file} non enregistrée : ${errorMessage(err, 'erreur inconnue')}`);
    return false;
  } finally {
    const left = (writing.get(file) ?? 1) - 1;
    if (left > 0) writing.set(file, left);
    else writing.delete(file);
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

/** Écrit tout de suite les fiches et les réglages en attente d'écriture. */
const flushWrites = async (): Promise<void> => {
  const files = [...recordTimers.keys()];
  files.forEach(cancelRecordWrite);
  await Promise.all([
    ...files.map((file) => writeRecordNow(file)),
    ...(settingsTimer !== null ? [flushSettings()] : []),
  ]);
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
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
/** Vrai pendant qu'on applique des réglages repris : ce ne sont pas des changements de l'utilisateur. */
let applyingSettings = false;

const readLocalSavedAt = (): number | null => {
  const value = jsonStore.read<number>(SETTINGS_SAVED_AT_KEY);
  return typeof value === 'number' && isFinite(value) ? value : null;
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

/** Fichiers lisibles de `reglages/` ; un fichier abîmé ou d'un autre format est ignoré. */
const readSettingsEntries = async (f: MemoryFolder): Promise<SettingsEntry[]> => {
  const entries: SettingsEntry[] = [];
  for (const entry of await f.list(SETTINGS_DIR)) {
    if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) continue;
    const file = parseSettingsFile(await f.readText(settingsPath(entry.name)));
    if (file) entries.push({ fileName: entry.name, file });
  }
  return entries;
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
 * appareil qui porte déjà ce nom n'est jamais écrasé : l'appareil prend un
 * nom libre (« Téléphone 2 ») et l'annonce. Son fichier précédent, sous un
 * autre nom, est retiré.
 */
const writeOwnSettings = async (f: MemoryFolder, savedAt: number): Promise<void> => {
  const id = deviceId();
  const own = ownSettingsEntry(settingsEntries, id);
  const othersFiles = new Set(settingsEntries.filter((e) => e !== own).map((e) => e.fileName.toLowerCase()));
  const wanted = deviceName();
  const name = freeDeviceName(wanted, othersFiles);
  if (name !== wanted) {
    jsonStore.write(DEVICE_NAME_KEY, name);
    setState({ message: `Cet appareil s'appelle désormais « ${name} » : un autre appareil du dossier s'appelle déjà « ${wanted} ».` });
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
    settingsEntries = await readSettingsEntries(f);
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
  settingsEntries = await readSettingsEntries(f);
  const own = ownSettingsEntry(settingsEntries, id);
  const legacy = parseSettingsFile(await f.readText(SETTINGS_FILE));
  let savedAt = readLocalSavedAt();
  let changed = false;
  let autoAdopted = false;
  if (savedAt === null) {
    const newest = own ?? newestSettingsEntry(settingsEntries);
    const source = newest?.file ?? legacy;
    if (source) {
      autoAdopted = true;
      changed = applySettingsValues(adoptedValues(source.values, localTravellingValues()));
      savedAt = source.savedAt;
      if (newest && newest !== own) setState({ message: `Réglages repris de « ${settingsEntryName(newest)} », le fichier le plus récent du dossier.` });
    }
  } else if (!own && legacy && chooseSettings(savedAt, legacy) === 'folder') {
    changed = applySettingsValues(legacy.values);
    savedAt = legacy.savedAt;
  }
  if (savedAt === null) savedAt = Date.now();
  jsonStore.write(SETTINGS_SAVED_AT_KEY, savedAt);
  lastSignature = settingsSignature(localTravellingValues());
  const upToDate = own !== null && own.file.savedAt === savedAt && own.fileName === deviceFileName(deviceName())
    && settingsSignature(own.file.values) === lastSignature;
  if (upToDate) publishSettingsFiles();
  else await writeOwnSettings(f, savedAt);
  if (legacy) await f.remove(SETTINGS_FILE);
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
    settingsEntries = await readSettingsEntries(f);
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
    const entries = f ? await readSettingsEntries(f) : [];
    const own = ownSettingsEntry(entries, deviceId());
    const clash = entries.find((e) => e !== own && e.fileName.toLowerCase() === deviceFileName(name));
    if (clash) return `Le fichier ${clash.fileName} est déjà celui de « ${settingsEntryName(clash)} » : choisissez un autre nom.`;
    jsonStore.write(DEVICE_NAME_KEY, name);
    if (!f) {
      setState({ deviceName: name });
      return null;
    }
    settingsEntries = entries;
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
    settingsEntries = await readSettingsEntries(f);
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
 * rendrait partielle la session d'une analyse ouverte.
 */
const keptInMemory = (read: LibrarySession, editsBefore: number): LibrarySession | undefined => {
  const current = findSession(read.file);
  if (!current) return undefined;
  if ((lastEdit.get(read.file) ?? 0) > editsBefore) return current;
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
  const keep = (file: string, record: SessionRecord, partial: boolean) => {
    const readOnly = !isWritableRecord(record);
    found.push({
      file,
      record: { ...record, gpx: file },
      readOnly,
      warning: readOnly ? FUTURE_RECORD_WARNING : null,
      ...(partial ? { partial: true } : {}),
    });
    if (!readOnly && isSummaryStale(record)) jobs.push({ file, kind: 'refresh', readOnly: false, warning: null });
  };

  for (const [file, record] of Object.entries(plan.reuse)) keep(file, record, cache.light);
  // Fiches à relire, par paquets lus ensemble. Mémoire encore vide (ouverture sans cache, téléphone
  // neuf) : la liste s'affiche par lots au fil de la lecture, au lieu d'attendre la dernière (E-O5).
  const progressive = all.length === 0;
  for (let from = 0; from < plan.read.length; from += RECORD_READ_BATCH) {
    const batch = plan.read.slice(from, from + RECORD_READ_BATCH);
    const texts = await Promise.all(batch.map((file) => f.readText(sessionPath(recordFileName(file)))));
    batch.forEach((file, i) => {
      const text = texts[i];
      const parts = text === null ? null : parseRecordParts(text);
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
  for (const file of plan.summarize) jobs.push({ file, kind: 'create', readOnly: false, warning: null });
  if (gen !== generation) return [];

  all = found.map((read) => keptInMemory(read, editsBefore) ?? read);
  publish();
  return jobs;
};

/** Fiches lues ensemble à l'ouverture : moins d'allers-retours avec le dossier. */
const RECORD_READ_BATCH = 8;
/** À l'ouverture d'une mémoire encore vide, la liste est publiée tous les tant de sessions lues. */
const PROGRESSIVE_PUBLISH_COUNT = 25;

/** `stopped` : le dossier a changé, le balayage s'arrête. */
type JobOutcome = 'done' | 'unreadable' | 'stopped';

/**
 * Crée une fiche, ou refait le résumé d'une fiche existante. Pour celle-ci,
 * la session est prise au moment du calcul, pas au début du balayage : une
 * saisie faite entre-temps (nom, notes, activité) est gardée, et l'analyse,
 * synchrone, n'en laisse passer aucune avant que le résumé soit posé. Seul un
 * GPX qu'on n'a pas su lire est « illisible » ; un échec d'écriture est dit
 * en clair.
 */
const runJob = async (f: MemoryFolder, gen: number, job: SummaryJob): Promise<JobOutcome> => {
  let text: string | null;
  try {
    text = await f.readText(sessionPath(job.file));
  } catch {
    return 'unreadable';
  }
  if (job.kind === 'refresh') {
    try {
      await hydrateSession(f, job.file);
    } catch (err) {
      reportError(`Fiche de ${job.file} non relue : ${errorMessage(err, 'erreur inconnue')}`);
      return 'done';
    }
  }
  if (gen !== generation) return 'stopped';
  const current = job.kind === 'refresh' ? findSession(job.file) : undefined;
  if (job.kind === 'refresh' && (!current || current.readOnly || current.partial)) return 'done';
  const from = current?.record ?? job.base;
  let analyzed: AnalyzedGpx | null;
  try {
    analyzed = text === null ? null : analyzeGpx(text, from ? from.sport : undefined, from?.analysis, from?.activityId, from);
  } catch {
    return 'unreadable';
  }
  if (!analyzed) return 'unreadable';
  // Supprimée pendant le calcul : ni remise dans la liste, ni fiche réécrite.
  if (removing.has(job.file)) return 'done';

  if (current) {
    replaceSession({ ...current, record: withSummary(current.record, analyzed.summary) });
    cancelRecordWrite(job.file);
    await writeRecordNow(job.file);
    return 'done';
  }
  const record = job.base ? withSummary({ ...job.base, gpx: job.file }, analyzed.summary) : newRecord(job.file, analyzed, 'import');
  if (!job.readOnly) {
    try {
      await f.writeText(sessionPath(recordFileName(job.file)), serializeRecord(record));
      knownNames.add(recordFileName(job.file));
      unwritten.delete(job.file);
    } catch (err) {
      unwritten.add(job.file);
      reportError(`Fiche de ${job.file} non enregistrée : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }
  if (gen !== generation) return 'stopped';
  replaceSession({ file: job.file, record, readOnly: job.readOnly, warning: job.warning });
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

/** Crée ou recalcule les fiches, une trace à la fois, en laissant l'interface répondre. */
const completeScan = (f: MemoryFolder, gen: number, jobs: SummaryJob[]): Promise<void> => {
  const run = runCompleteScan(f, gen, jobs).finally(() => {
    if (scanCompletion === run) scanCompletion = null;
  });
  scanCompletion = run;
  return run;
};

const runCompleteScan = async (f: MemoryFolder, gen: number, jobs: SummaryJob[]): Promise<void> => {
  const unreadable: string[] = [];
  let shownAt = -Infinity;
  for (let i = 0; i < jobs.length; i++) {
    if (gen !== generation) return;
    if (Date.now() - shownAt >= SCAN_PROGRESS_INTERVAL_MS) {
      shownAt = Date.now();
      setState({ scanning: { done: i, total: jobs.length } });
    }
    const outcome = await runJob(f, gen, jobs[i]);
    if (outcome === 'stopped') return;
    if (outcome === 'unreadable') unreadable.push(jobs[i].file);
    await pause();
  }
  if (gen !== generation) return;
  setState({ scanning: null, unreadable });
  await refreshCache(f, gen);
};

/**
 * Sessions enregistrées sur le téléphone faute de dossier, rangées dès qu'il
 * y en a un. Une session qu'on ne peut ranger reste en attente, sans retenir
 * les autres, et l'échec est dit.
 */
const flushPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  let files: FolderEntry[];
  try {
    files = (await pending.list('')).filter((e) => e.kind === 'file' && isGpxFileName(e.name));
  } catch (err) {
    reportError(`Sessions en attente illisibles : ${errorMessage(err, 'erreur inconnue')}`);
    return;
  }
  for (const entry of files) {
    try {
      const text = await pending.readText(entry.name);
      if (text === null) continue;
      const motion = await pending.readBytes(imuFileName(entry.name));
      const result = await addGpx(text, 'enregistrement', { motion: motion ?? undefined });
      if (result.status === 'added' || result.status === 'duplicate') {
        await pending.remove(entry.name);
        if (motion) await pending.remove(imuFileName(entry.name));
      } else if (result.status === 'invalid') {
        reportError(`Session en attente ${entry.name} illisible, laissée en attente : ${result.message ?? 'GPX illisible'}`);
      }
    } catch (err) {
      reportError(`Session en attente ${entry.name} non rangée : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }
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
 * sont dits, et l'ouverture continue.
 */
const attach = async (f: MemoryFolder): Promise<boolean> => {
  generation += 1;
  const gen = generation;
  folder = f;
  all = [];
  knownNames = new Set();
  setState({
    status: 'opening',
    folderKind: f.kind,
    folderLabel: f.label,
    reason: null,
    sessions: [],
    duplicates: [],
    unreadable: [],
    scanning: null,
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
  await flushPending();
  void completeScan(f, gen, jobs).catch((err) =>
    setState({ scanning: null, error: `Lecture du dossier interrompue : ${errorMessage(err, 'erreur inconnue')}` })
  );
  return settingsChanged;
};

const detach = (status: 'needs-permission' | 'unavailable', label: string | null, reason: string | null): void => {
  generation += 1;
  folder = null;
  all = [];
  knownNames = new Set();
  settingsEntries = [];
  setState({
    status,
    folderKind: null,
    folderLabel: label,
    reason,
    sessions: [],
    duplicates: [],
    unreadable: [],
    scanning: null,
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
}

interface AddOptions {
  /** Support imposé ; absent : celui de la fiche importée, sinon deviné. */
  sport?: SportType;
  /** Activité choisie à l'enregistrement. */
  activityId?: string;
  /** Fiche qui accompagne le GPX, lors de l'import d'un dossier ; son résumé est refait. */
  record?: RecordWithoutSummary | null;
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
}

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
      const rides = surfRides(parseGpx(text).rawPoints, sport, summaryOptions(sport, analysis, activityId));
      return rides ? await pruneSurfImu(motion, rides, profile.pump.pruneMarginS) : motion;
    }
    if (sportTreatment(sport) === 'voile') {
      const activity = sessionActivity(readStoredActivities(), activityId, sport) ?? baseActivity(sport);
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

/** Range un GPX dans la mémoire, avec sa fiche. */
const addGpx = async (text: string, source: SessionSource, options: AddOptions): Promise<AddResult> => {
  let analyzed: AnalyzedGpx | null;
  try {
    const sport = options.sport ?? options.record?.sport ?? undefined;
    const fields = options.test ? { ...options.record, test: options.test } : options.record;
    analyzed = analyzeGpx(text, sport, options.record?.analysis, options.activityId ?? options.record?.activityId, fields);
  } catch (err) {
    return { status: 'invalid', file: null, message: errorMessage(err, 'GPX illisible.') };
  }
  if (!analyzed) return { status: 'invalid', file: null, message: 'Pas assez de points horodatés.' };

  const startMs = analyzed.summary.startMs;
  let existing = all.find((s) => s.record.summary.startMs === startMs);
  // Première lecture du dossier en cours : sa session n'est peut-être pas encore publiée, on l'attend (aucune attente sinon).
  if (!existing && scanCompletion) {
    await scanCompletion.then(() => undefined, () => undefined);
    existing = all.find((s) => s.record.summary.startMs === startMs);
  }
  // Fiche du cache allégé : relue en entier, pour ne pas croire absents ses sauts, ses voies ou son altitude.
  if (existing?.partial && options.record && folder) {
    await hydrateSession(folder, existing.file).catch(() => undefined);
    existing = findSession(existing.file) ?? existing;
  }
  if (existing) {
    // Session entrée sans sa fiche complète (GPX importé seul) : celle de la copie lui donne ce qui
    // lui manque, sans rien écraser ; de même ses capteurs, s'ils ne sont pas encore là.
    let recordCompleted = false;
    if (options.record && !existing.readOnly && !existing.partial) {
      const { record, resummarize: stale } = completeRecord(existing.record, options.record);
      if (record !== existing.record) {
        replaceSession({ ...existing, record });
        scheduleRecordWrite(existing.file);
        recordCompleted = true;
        if (stale) void resummarize(existing.file);
      }
    }
    const f = folder;
    if (!options.motion || !f || hasSessionMotion(existing.file)) return { status: 'duplicate', file: existing.file, recordCompleted };
    const motion = source === 'enregistrement'
      ? await prunedMotion(options.motion, analyzed.sport, text, existing.record.analysis, existing.record.activityId)
      : options.motion;
    if (!motion) return { status: 'duplicate', file: existing.file, recordCompleted };
    await f.writeBytes(sessionPath(imuFileName(existing.file)), motion);
    knownNames.add(imuFileName(existing.file));
    return { status: 'duplicate', file: existing.file, motionAdded: true, recordCompleted };
  }

  const f = folder;
  const name = sessionFileName(startMs, analyzed.sport);
  if (!f) {
    // Seul un enregistrement attend un dossier ; un import sans dossier est refusé (décision du 27/10).
    const pending = source === 'enregistrement' ? pendingFolder() : null;
    if (!pending) return { status: 'unsaved', file: null };
    await pending.writeText(name, text);
    if (options.motion) await pending.writeBytes(imuFileName(name), options.motion);
    await countPending();
    return { status: 'pending', file: null };
  }

  const gpx = uniqueSessionFileName(name, knownNames);
  const made = options.record
    ? withSummary({ ...options.record, gpx, sport: analyzed.sport }, analyzed.summary)
    : {
      ...newRecord(gpx, analyzed, source, options.activityId ?? null),
      ...(options.foil !== undefined ? { analysis: readAnalysis({ foil: options.foil, savedAt: Date.now() }) } : {}),
    };
  // Capture de la seule cadence : la fiche dit tout de suite qu'il n'y a pas de sauts à chercher.
  const jumpsUnmeasured = options.motion && decodeImuHeader(options.motion)?.setup.jumps === false;
  const record = {
    ...made,
    ...(options.intervals && options.intervals.length > 0 ? { intervals: options.intervals } : {}),
    ...(options.marks && options.marks.length > 0 ? { marks: options.marks } : {}),
    ...(options.test ? { test: options.test } : {}),
    ...(jumpsUnmeasured && !made.jumps
      ? { jumps: { version: JUMPS_CALC_VERSION, computedAt: new Date().toISOString(), jumps: [], measured: false as const } }
      : {}),
  };
  // Un enregistrement est élagué en entrant ; un dossier importé est rangé tel quel.
  const motion = options.motion && source === 'enregistrement'
    ? await prunedMotion(options.motion, analyzed.sport, text, options.record?.analysis, options.activityId ?? options.record?.activityId)
    : options.motion;
  const written = [sessionPath(gpx), sessionPath(recordFileName(gpx)), ...(motion ? [sessionPath(imuFileName(gpx))] : [])];
  try {
    await f.writeText(sessionPath(gpx), text);
    await f.writeText(sessionPath(recordFileName(gpx)), serializeRecord(record));
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
  replaceSession({ file: gpx, record, readOnly: false, warning: null });
  return { status: 'added', file: gpx };
};

/**
 * Range une session qui vient d'être enregistrée, avec les séances du
 * compteur faites pendant elle, ses repères (`marks`), ses capteurs (`motion`, le contenu du
 * `.imu`), le foil de son activité (`foil`, `null` hors voile et surf) et son test guidé (`test`). Rend son nom dans la mémoire et, en clair, l'endroit où elle se
 * trouve. Ne lève d'erreur que si l'écriture échoue : l'enregistreur garde
 * alors son journal. Une session mise en attente faute de dossier n'a pas
 * encore de fiche : ses séances et ses repères ne sont pas gardés ; ses capteurs attendent
 * avec elle.
 */
export const saveRecordedSession = async (
  text: string,
  sport: SportType,
  activityId: string | null,
  intervals: IntervalSeries[] = [],
  motion: Uint8Array | null = null,
  marks: SessionMark[] = [],
  foil: boolean | null = null,
  test: SessionTest | null = null
): Promise<{ file: string | null; location: string }> => {
  await opening;
  const result = await addGpx(text, 'enregistrement', {
    sport, activityId: activityId ?? undefined, intervals, marks, motion: motion ?? undefined, foil: foil ?? undefined, test: test ?? undefined,
  });
  switch (result.status) {
    case 'added':
      return { file: result.file, location: state.folderLabel ?? 'mémoire' };
    case 'duplicate':
      return { file: result.file, location: 'déjà dans la mémoire' };
    case 'pending':
      return { file: null, location: 'en attente d\'un dossier mémoire (dossier privé de l\'application)' };
    case 'unsaved':
      return { file: null, location: 'non rangée, aucune mémoire accessible : à télécharger' };
    default:
      throw new Error(result.message ?? 'session illisible');
  }
};

export interface ImportReport {
  added: string[];
  /** Sessions déjà présentes, par leur nom dans la mémoire. */
  existing: string[];
  duplicates: number;
  invalid: string[];
  unsaved: number;
  /** Fichiers qu'on n'a pas pu lire ou ranger, avec la raison. */
  failed: string[];
  /** Sessions déjà présentes qui ont reçu leurs capteurs (`.imu`). */
  motionAdded: number;
  /** Sessions déjà présentes dont la fiche a été complétée. */
  recordCompleted: number;
}

/** Fichier choisi dans le navigateur, lu seulement au moment de le ranger. */
const pickedEntry = (file: File): ImportEntry => ({
  name: file.name,
  key: (file.webkitRelativePath || file.name).replace(/\.(gpx|json|imu)$/i, '').toLowerCase(),
  readText: () => readPickedFile(file),
  readBytes: () => readPickedBytes(file),
});

const describeImport = (report: ImportReport): string => {
  const parts: string[] = [];
  parts.push(report.added.length === 1 ? '1 session ajoutée' : `${report.added.length} sessions ajoutées`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} déjà présente${report.duplicates > 1 ? 's' : ''}`);
  if (report.motionAdded > 0) {
    parts.push(`capteurs ajoutés à ${report.motionAdded} session${report.motionAdded > 1 ? 's' : ''} déjà présente${report.motionAdded > 1 ? 's' : ''}`);
  }
  if (report.recordCompleted > 0) {
    parts.push(`fiche complétée pour ${report.recordCompleted} session${report.recordCompleted > 1 ? 's' : ''} déjà présente${report.recordCompleted > 1 ? 's' : ''}`);
  }
  if (report.invalid.length > 0) parts.push(`${report.invalid.length} illisible${report.invalid.length > 1 ? 's' : ''} (${report.invalid.join(', ')})`);
  if (report.unsaved > 0) {
    parts.push(`${report.unsaved} non rangée${report.unsaved > 1 ? 's' : ''} : désignez d'abord le dossier mémoire (Réglages › Mémoire)`);
  }
  return `${parts.join(', ')}.`;
};

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
  const report: ImportReport = { added: [], existing: [], duplicates: 0, invalid: [], unsaved: 0, failed: [], motionAdded: 0, recordCompleted: 0 };
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
        // GPX complet (`library/sessionBundle.ts`) : la fiche et les capteurs qu'il porte servent
        // à défaut de fichiers posés à côté ; la mémoire range le GPX sans eux.
        const bundle = unbundleSessionGpx(text);
        const recordText = await records.get(entry.key)?.readText();
        const sidecar = recordText ? parseRecordParts(recordText) : null;
        const record = sidecar && isWritableRecord(sidecar) ? sidecar : bundle.record;
        const motion = (await motions.get(entry.key)?.readBytes()) ?? bundle.motion ?? undefined;
        const result = await addGpx(bundle.gpx, 'import', { record, motion });
        if (result.status === 'added' && result.file) report.added.push(result.file);
        else if (result.status === 'duplicate') {
          report.duplicates += 1;
          if (result.file) report.existing.push(result.file);
          if (result.motionAdded) report.motionAdded += 1;
          if (result.recordCompleted) report.recordCompleted += 1;
        }
        else if (result.status === 'invalid') report.invalid.push(entry.name);
        else report.unsaved += 1;
      } catch (err) {
        report.failed.push(`${entry.name} : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    if (folder) void refreshCache(folder, generation).catch(() => undefined);
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
    setState({ importing: false, message: `Lecture du dossier impossible : ${err instanceof Error ? err.message : String(err)}` });
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
 * rangé, sa fiche entière et ses capteurs (`library/sessionBundle.ts`).
 * `null` si le GPX n'est pas lisible.
 */
export const readSessionExport = async (file: string): Promise<{ gpx: string; record: SessionRecord; motion: Uint8Array | null } | null> => {
  await opening;
  const f = folder;
  const session = findSession(file);
  if (!f || !session) return null;
  const gpx = await f.readText(sessionPath(file));
  if (gpx === null) return null;
  return { gpx, record: await fullRecordIn(f, session), motion: await readSessionMotion(file) };
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
    const analyzed = analyzeGpx(text, session.record.sport, session.record.analysis, session.record.activityId, session.record);
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
  void refreshCache(f, generation).catch(() => undefined);
};

/**
 * Fiche entière d'une session de la mémoire `f`, pour la recopier ailleurs :
 * une fiche allégée est complétée par celle du disque.
 */
const fullRecordIn = async (f: MemoryFolder, session: LibrarySession): Promise<SessionRecord> => {
  if (!session.partial) return session.record;
  const text = await f.readText(sessionPath(recordFileName(session.file)));
  const disk = text === null ? null : parseRecord(text);
  return disk ? mergeLightRecord(disk, session.record) : session.record;
};

/** Vrai si l'on peut désigner un vrai dossier comme mémoire (Chrome et Edge sur ordinateur). */
export const canChooseMemoryFolder = canChooseFolder;

/**
 * Désigne un dossier comme mémoire, depuis un clic. Les sessions de la
 * mémoire du navigateur y sont recopiées.
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
  const previousSessions = previous?.kind === 'browser' ? [...all] : [];
  let settingsChanged: boolean;
  try {
    settingsChanged = await attach(picked);
  } catch (err) {
    detach('unavailable', picked.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
    return;
  }

  if (previous && previousSessions.length > 0) {
    let copied = 0;
    for (const session of previousSessions) {
      try {
        const text = await previous.readText(sessionPath(session.file));
        if (text === null) continue;
        const motion = await previous.readBytes(sessionPath(imuFileName(session.file)));
        const result = await addGpx(text, session.record.source, {
          record: session.readOnly ? null : await fullRecordIn(previous, session),
          motion: motion ?? undefined,
        });
        if (result.status === 'added') copied += 1;
      } catch (err) {
        reportError(`${session.file} non recopiée dans le dossier : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    if (copied > 0) {
      setState({ message: `${copied} session${copied > 1 ? 's' : ''} de la mémoire du navigateur recopiée${copied > 1 ? 's' : ''} dans le dossier.` });
    }
  }
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
      await openLibrary();
      setState({ error: err.message });
      return;
    }
    setState({ error: `Dossier inaccessible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (!f) {
    setState({ error: 'Autorisation refusée : le dossier reste inaccessible.' });
    return;
  }
  try {
    await applySettingsChange(await attach(f));
  } catch (err) {
    detach('unavailable', f.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
  }
};

/** Oublie le dossier choisi et revient à la mémoire du navigateur. */
export const switchToBrowserMemory = async (): Promise<void> => {
  await flushWrites();
  await forgetChosenFolder();
  await openLibrary();
};

/** Relecture en cours : un second appui attend la même. */
let refreshing: Promise<void> | null = null;

/**
 * Relit le dossier mémoire sans le refermer (« Mettre à jour ») : sessions et
 * itinéraires copiés depuis un autre appareil, réglages plus récents (qui
 * rechargent la page, comme au lancement). La liste reste affichée pendant la
 * relecture ; les écritures en attente partent d'abord, pour qu'une fiche
 * modifiée ne soit pas remplacée par celle du disque. Le compte rendu dit
 * combien de sessions sont apparues.
 */
export const refreshLibrary = (): Promise<void> => {
  if (refreshing) return refreshing;
  const scanned = (async () => {
    await opening;
    const f = folder;
    if (!f || state.status !== 'ready') return null;
    setState({ refreshing: true, message: null, error: null });
    const before = new Set(state.sessions.map((s) => s.record.summary.startMs));
    // Une saisie faite à partir d'ici garde sa version en mémoire (`keptInMemory`).
    const editsBefore = editCount;
    await flushWrites();
    generation += 1;
    const gen = generation;
    const settingsChanged = await syncSettingsSafely(f);
    const jobs = await scan(f, gen, editsBefore);
    if (gen !== generation) return null;
    setState({ revision: state.revision + 1 });
    await flushPending();
    return { f, gen, jobs, before, settingsChanged };
  })();
  // Les écritures (enregistrement, import) attendent la lecture du dossier, pas le calcul des fiches.
  opening = scanned.then(() => undefined, () => undefined);
  refreshing = scanned
    .then(async (read) => {
      if (!read) return;
      await completeScan(read.f, read.gen, read.jobs);
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
      setState({ scanning: null, error: `Relecture du dossier impossible : ${errorMessage(err, 'erreur inconnue')}` });
    })
    .finally(() => {
      refreshing = null;
      setState({ refreshing: false });
    });
  return refreshing;
};

export const dismissLibraryMessage = (): void => setState({ message: null, error: null });

/** Ferme la proposition d'un nouveau fichier de réglages ; il reste dans la liste de Réglages › Mémoire. */
export const dismissSettingsOffer = (): void => setState({ settingsOffer: null });

/** État de la bibliothèque, relu à chaque changement. */
export const useSessionLibrary = (): LibraryState => useSyncExternalStore(subscribe, () => state);

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
  file === null ? undefined : sessions.find((s) => s.file === file);

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
