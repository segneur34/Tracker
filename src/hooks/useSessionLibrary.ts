import { useSyncExternalStore } from 'react';
import { sessionActivity } from '../core/activities';
import { parseGpx } from '../core/gpxParser';
import { pruneImuFile } from '../core/imuPrune';
import { ELEVATION_PRESETS, SAILING_SPORTS, getSportProfile, sportTreatment } from '../core/sportProfiles';
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
  dedupeSessions,
  findLegacyNotes,
  imuFileName,
  isGpxFileName,
  isSummaryStale,
  isWritableRecord,
  parseRecord,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type RecordPatch,
  type SessionAnalysis,
  type SessionRecord,
  type SessionSource,
  type SessionSummary,
} from '../library/record';
import { planReconcile, type LibraryCache } from '../library/reconcile';
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
import { summarizeSession, type SummaryOptions } from '../library/summary';
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
  type MemoryFolder,
  type MemoryKind,
} from '../platform/memoryFolder';
import { isNativeApp } from '../platform/runtime';
import { jsonStore } from '../platform/storage';
import type { IntervalSeries } from '../recording/intervalTimer';
import { sessionFileName } from '../recording/session';
import { isKnownTerrain, readStoredActivities, readStoredSettings } from './useSportSettings';

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
 *    seules les fiches qui ont changé sont relues, et la liste s'affiche ;
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
const listeners = new Set<() => void>();

const setState = (patch: Partial<LibraryState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

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

const replaceSession = (session: LibrarySession): void => {
  all = [...all.filter((s) => s.file !== session.file), session];
  publish();
};

// --- Cache des fiches, hors du dossier ---

const CACHE_KEY = 'tracker.libraryCache';

interface StoredCache {
  folder: string;
  entries: LibraryCache;
}

const folderId = (f: MemoryFolder): string => `${f.kind}:${f.label}`;

const readCache = (f: MemoryFolder): LibraryCache => {
  const cache = jsonStore.read<StoredCache>(CACHE_KEY);
  return cache && cache.folder === folderId(f) && cache.entries ? cache.entries : {};
};

/** Cache reconstruit d'après le contenu réel de `sessions/` et les fiches connues. */
const refreshCache = async (f: MemoryFolder, gen: number): Promise<void> => {
  const entries = await f.list(SESSIONS_DIR);
  if (gen !== generation) return;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const next: LibraryCache = {};
  for (const session of all) {
    // Une fiche en attente d'écriture diffère encore du fichier : elle sera relue au prochain lancement.
    if (session.readOnly || recordTimers.has(session.file)) continue;
    const name = recordFileName(session.file);
    const entry = byName.get(name);
    if (entry) next[name] = { size: entry.size, mtimeMs: entry.mtimeMs, record: session.record };
  }
  jsonStore.write(CACHE_KEY, { folder: folderId(f), entries: next } satisfies StoredCache);
};

// --- Résumés ---

/**
 * Réglages qui changent le résumé : ceux de l'activité de la session, et ceux
 * de la session (`analysis`, dans sa fiche). Le seuil de la session prime sur
 * celui de l'activité ; l'allure imposée n'existe que pour une session, et
 * qu'en voile. L'altitude du terrain de la fiche remplace celle du GPS en
 * course et à vélo, sauf si l'utilisateur a gardé le GPS.
 */
const summaryOptions = (
  sport: SportType | null,
  analysis?: SessionAnalysis | null,
  activityId?: string | null,
  elevation?: SessionElevation | null
): SummaryOptions => {
  if (sport === null) return {};
  const stored = readStoredSettings();
  const key = sessionActivity(readStoredActivities(), activityId, sport)?.id ?? sport;
  const terrain = stored.terrains?.[key];
  return {
    activeThreshold: analysis?.activeThreshold ?? stored.thresholds?.[key],
    referenceSpeedOverrideMs: SAILING_SPORTS.includes(sport) ? analysis?.referenceSpeedMs ?? undefined : undefined,
    elevation: isKnownTerrain(terrain) ? ELEVATION_PRESETS[terrain] : undefined,
    terrainElevation:
      sportTreatment(sport) !== 'voile' && elevation?.elevationSource !== 'gps' ? elevation?.terrainElevation : undefined,
  };
};

/** Altitude de la fiche : celle du terrain, et la source choisie. */
type SessionElevation = Pick<SessionRecord, 'terrainElevation' | 'elevationSource'>;

interface AnalyzedGpx {
  summary: SessionSummary;
  sport: SportType | null;
  title: string | null;
}

/**
 * Lit un GPX et le résume. `sport` absent : deviné depuis la trace.
 * `analysis` : réglages d'analyse de la fiche (seuil, allure), s'il y en a ;
 * `activityId` : son activité, dont les réglages s'appliquent ;
 * `elevation` : son altitude du terrain et la source choisie.
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
  const summary = summarizeSession(parsed.rawPoints, resolved, summaryOptions(resolved, analysis, activityId, elevation));
  return summary ? { summary, sport: resolved, title: parsed.trackName ?? null } : null;
};

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

/** Nouveau résumé, en gardant le nombre de manœuvres de la dernière analyse. */
const withSummary = (record: SessionRecord, summary: SessionSummary): SessionRecord => ({
  ...record,
  summary:
    record.summary.maneuverCount === undefined ? summary : { ...summary, maneuverCount: record.summary.maneuverCount },
});

// --- Écritures différées des fiches ---

const RECORD_WRITE_DELAY_MS = 800;
const recordTimers = new Map<string, ReturnType<typeof setTimeout>>();

const writeRecordNow = async (file: string): Promise<void> => {
  recordTimers.delete(file);
  const session = findSession(file);
  if (!session || session.readOnly || !folder) return;
  try {
    await folder.writeText(sessionPath(recordFileName(file)), serializeRecord(session.record));
  } catch (err) {
    setState({ error: `Fiche non enregistrée : ${errorMessage(err, 'erreur inconnue')}` });
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
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
    applySettingsChange(true);
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
  /** Fiche dont seul le résumé est à refaire ; `null` pour une fiche à créer. */
  previous: SessionRecord | null;
  /** Vrai si la fiche existante ne doit pas être réécrite. */
  readOnly: boolean;
  warning: string | null;
}

const FUTURE_RECORD_WARNING = 'Fiche écrite par une version plus récente de Tracker : lue sans être modifiée.';
const UNREADABLE_RECORD_WARNING = 'Fiche illisible, laissée telle quelle : le résumé affiché est recalculé.';

/**
 * Lit `sessions/` et publie la liste. Rend les fiches à créer ou à
 * recalculer, que `completeScan` traite ensuite en tâche de fond.
 */
const scan = async (f: MemoryFolder, gen: number): Promise<SummaryJob[]> => {
  let entries = await f.list(SESSIONS_DIR);
  const rootEntries = await f.list('');
  const cache = readCache(f);
  let plan = planReconcile(entries, rootEntries, cache);

  // Un GPX posé à la racine du dossier est rangé dans `sessions/`, avec la fiche posée à côté de lui.
  if (plan.rootGpx.length > 0) {
    const taken = new Set(entries.map((e) => e.name));
    for (const name of plan.rootGpx) {
      const text = await f.readText(name);
      if (text === null) continue;
      const target = uniqueSessionFileName(name, taken);
      const recordName = plan.rootRecords[name];
      const recordText = recordName ? await f.readText(recordName) : null;
      const motion = rootEntries.some((e) => e.name === imuFileName(name)) ? await f.readBytes(imuFileName(name)) : null;
      await f.writeText(sessionPath(target), text);
      if (recordName && recordText !== null) {
        await f.writeText(sessionPath(recordFileName(target)), recordText);
        await f.remove(recordName);
      }
      if (motion) {
        await f.writeBytes(sessionPath(imuFileName(target)), motion);
        await f.remove(imuFileName(name));
      }
      await f.remove(name);
      taken.add(target);
    }
    entries = await f.list(SESSIONS_DIR);
    plan = planReconcile(entries, [], cache);
  }
  if (gen !== generation) return [];

  knownNames = new Set(entries.map((e) => e.name));
  const jobs: SummaryJob[] = [];
  const found: LibrarySession[] = [];
  const keep = (file: string, record: SessionRecord) => {
    const readOnly = !isWritableRecord(record);
    found.push({ file, record: { ...record, gpx: file }, readOnly, warning: readOnly ? FUTURE_RECORD_WARNING : null });
    if (!readOnly && isSummaryStale(record)) jobs.push({ file, previous: record, readOnly: false, warning: null });
  };

  for (const [file, record] of Object.entries(plan.reuse)) keep(file, record);
  for (const file of plan.read) {
    const text = await f.readText(sessionPath(recordFileName(file)));
    const record = text === null ? null : parseRecord(text);
    if (record) keep(file, record);
    else jobs.push({ file, previous: null, readOnly: true, warning: UNREADABLE_RECORD_WARNING });
  }
  for (const file of plan.summarize) jobs.push({ file, previous: null, readOnly: false, warning: null });
  if (gen !== generation) return [];

  all = found;
  publish();
  return jobs;
};

/** Crée ou recalcule les fiches, une trace à la fois, en laissant l'interface répondre. */
const completeScan = async (f: MemoryFolder, gen: number, jobs: SummaryJob[]): Promise<void> => {
  const unreadable: string[] = [];
  for (let i = 0; i < jobs.length; i++) {
    if (gen !== generation) return;
    setState({ scanning: { done: i, total: jobs.length } });
    const job = jobs[i];
    try {
      const text = await f.readText(sessionPath(job.file));
      const analyzed = text === null ? null : analyzeGpx(
            text,
            job.previous ? job.previous.sport : undefined,
            job.previous?.analysis,
            job.previous?.activityId,
            job.previous
          );
      if (!analyzed) {
        unreadable.push(job.file);
        continue;
      }
      const record = job.previous
        ? withSummary(job.previous, analyzed.summary)
        : newRecord(job.file, analyzed, 'import');
      if (!job.readOnly) await f.writeText(sessionPath(recordFileName(job.file)), serializeRecord(record));
      if (gen !== generation) return;
      knownNames.add(recordFileName(job.file));
      replaceSession({ file: job.file, record, readOnly: job.readOnly, warning: job.warning });
    } catch {
      unreadable.push(job.file);
    }
    await pause();
  }
  if (gen !== generation) return;
  setState({ scanning: null, unreadable });
  await refreshCache(f, gen);
};

/** Sessions enregistrées sur le téléphone faute de dossier, rangées dès qu'il y en a un. */
const flushPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  const files = (await pending.list('')).filter((e) => e.kind === 'file' && isGpxFileName(e.name));
  for (const entry of files) {
    const text = await pending.readText(entry.name);
    if (text === null) continue;
    const motion = await pending.readBytes(imuFileName(entry.name));
    const result = await addGpx(text, 'enregistrement', { motion: motion ?? undefined });
    if (result.status === 'added' || result.status === 'duplicate') {
      await pending.remove(entry.name);
      if (motion) await pending.remove(imuFileName(entry.name));
    }
  }
  await countPending();
};

const countPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  const files = await pending.list('');
  setState({ pendingCount: files.filter((e) => e.kind === 'file' && isGpxFileName(e.name)).length });
};

/**
 * Met un dossier en service. Rend vrai si des réglages du dossier ont
 * remplacé ceux de l'appareil.
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
  await ensureLayout(f);
  const settingsChanged = await syncSettings(f);
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
const applySettingsChange = (changed: boolean): void => {
  if (!changed || !uiStarted) return;
  if (canReload()) {
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
      if (access.notice) setState({ error: access.notice });
      applySettingsChange(settingsChanged);
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
}

interface AddOptions {
  /** Support imposé ; absent : celui de la fiche importée, sinon deviné. */
  sport?: SportType;
  /** Activité choisie à l'enregistrement. */
  activityId?: string;
  /** Fiche qui accompagne le GPX, lors de l'import d'un dossier. */
  record?: SessionRecord | null;
  /** Séances du compteur faites pendant l'enregistrement, rangées dans la fiche. */
  intervals?: IntervalSeries[];
  /** Capteurs de l'enregistrement (`.imu`), rangés à côté du GPX. */
  motion?: Uint8Array;
}

/**
 * Capteurs d'un enregistrement à leur entrée dans la mémoire : élagués autour
 * des vols si le calcul de la session mesure les sauts. En cas d'échec, la
 * capture complète : on ne perd jamais de mesure par erreur.
 */
const prunedMotion = async (motion: Uint8Array, sport: SportType | null): Promise<Uint8Array> => {
  const detection = sport ? getSportProfile(sport).jumps?.detection : null;
  if (!detection) return motion;
  try {
    return await pruneImuFile(motion, detection);
  } catch {
    return motion;
  }
};

/** Range un GPX dans la mémoire, avec sa fiche. */
const addGpx = async (text: string, source: SessionSource, options: AddOptions): Promise<AddResult> => {
  let analyzed: AnalyzedGpx | null;
  try {
    const sport = options.sport ?? options.record?.sport ?? undefined;
    analyzed = analyzeGpx(text, sport, options.record?.analysis, options.activityId ?? options.record?.activityId, options.record);
  } catch (err) {
    return { status: 'invalid', file: null, message: errorMessage(err, 'GPX illisible.') };
  }
  if (!analyzed) return { status: 'invalid', file: null, message: 'Pas assez de points horodatés.' };

  const startMs = analyzed.summary.startMs;
  const existing = all.find((s) => s.record.summary.startMs === startMs);
  if (existing) return { status: 'duplicate', file: existing.file };

  const f = folder;
  const name = sessionFileName(startMs, analyzed.sport);
  if (!f) {
    const pending = pendingFolder();
    if (!pending) return { status: 'unsaved', file: null };
    await pending.writeText(name, text);
    if (options.motion) await pending.writeBytes(imuFileName(name), options.motion);
    await countPending();
    return { status: 'pending', file: null };
  }

  const gpx = uniqueSessionFileName(name, knownNames);
  const made = options.record
    ? withSummary({ ...options.record, gpx, sport: analyzed.sport }, analyzed.summary)
    : newRecord(gpx, analyzed, source, options.activityId ?? null);
  const record = options.intervals && options.intervals.length > 0 ? { ...made, intervals: options.intervals } : made;
  await f.writeText(sessionPath(gpx), text);
  await f.writeText(sessionPath(recordFileName(gpx)), serializeRecord(record));
  knownNames.add(gpx);
  knownNames.add(recordFileName(gpx));
  if (options.motion) {
    // Un enregistrement est élagué en entrant ; un dossier importé est rangé tel quel.
    const motion = source === 'enregistrement' ? await prunedMotion(options.motion, analyzed.sport) : options.motion;
    await f.writeBytes(sessionPath(imuFileName(gpx)), motion);
    knownNames.add(imuFileName(gpx));
  }
  replaceSession({ file: gpx, record, readOnly: false, warning: null });
  return { status: 'added', file: gpx };
};

/**
 * Range une session qui vient d'être enregistrée, avec les séances du
 * compteur faites pendant elle et ses capteurs (`motion`, le contenu du
 * `.imu`). Rend son nom dans la mémoire et, en clair, l'endroit où elle se
 * trouve. Ne lève d'erreur que si l'écriture échoue : l'enregistreur garde
 * alors son journal. Une session mise en attente faute de dossier n'a pas
 * encore de fiche : ses séances ne sont pas gardées ; ses capteurs attendent
 * avec elle.
 */
export const saveRecordedSession = async (
  text: string,
  sport: SportType,
  activityId: string | null,
  intervals: IntervalSeries[] = [],
  motion: Uint8Array | null = null
): Promise<{ file: string | null; location: string }> => {
  await opening;
  const result = await addGpx(text, 'enregistrement', { sport, activityId: activityId ?? undefined, intervals, motion: motion ?? undefined });
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
}

const baseKey = (file: File): string =>
  (file.webkitRelativePath || file.name).replace(/\.(gpx|json|imu)$/i, '').toLowerCase();

const describeImport = (report: ImportReport): string => {
  const parts: string[] = [];
  parts.push(report.added.length === 1 ? '1 session ajoutée' : `${report.added.length} sessions ajoutées`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} déjà présente${report.duplicates > 1 ? 's' : ''}`);
  if (report.invalid.length > 0) parts.push(`${report.invalid.length} illisible${report.invalid.length > 1 ? 's' : ''} (${report.invalid.join(', ')})`);
  if (report.unsaved > 0) parts.push(`${report.unsaved} non rangée${report.unsaved > 1 ? 's' : ''}, faute de mémoire accessible`);
  return `${parts.join(', ')}.`;
};

/**
 * Importe des fichiers choisis par l'utilisateur : des GPX, ou un dossier
 * mémoire entier, dont chaque fiche accompagne son GPX (notes et support
 * compris). Une session déjà présente n'est pas dupliquée.
 */
export const importFiles = async (files: File[]): Promise<ImportReport> => {
  setState({ importing: true });
  try {
    await opening;
    const records = new Map<string, File>();
    const motions = new Map<string, File>();
    for (const file of files) {
      if (/\.json$/i.test(file.name)) records.set(baseKey(file), file);
      else if (/\.imu$/i.test(file.name)) motions.set(baseKey(file), file);
    }

    const report: ImportReport = { added: [], existing: [], duplicates: 0, invalid: [], unsaved: 0 };
    for (const file of files) {
      if (!isGpxFileName(file.name)) continue;
      const recordFile = records.get(baseKey(file));
      const record = recordFile ? parseRecord(await readPickedFile(recordFile)) : null;
      const motionFile = motions.get(baseKey(file));
      const result = await addGpx(await readPickedFile(file), 'import', {
        record: record && isWritableRecord(record) ? record : null,
        motion: motionFile ? await readPickedBytes(motionFile) : undefined,
      });
      if (result.status === 'added' && result.file) report.added.push(result.file);
      else if (result.status === 'duplicate') {
        report.duplicates += 1;
        if (result.file) report.existing.push(result.file);
      }
      else if (result.status === 'invalid') report.invalid.push(file.name);
      else report.unsaved += 1;
    }
    if (folder) void refreshCache(folder, generation);
    setState({ message: describeImport(report) });
    return report;
  } finally {
    setState({ importing: false });
  }
};

/**
 * Sur le téléphone, ajoute les sessions d'un dossier que l'utilisateur désigne
 * (un dossier Tracker copié depuis le PC) : `importFiles` sur ses GPX et ses
 * fiches. `null` si l'utilisateur renonce.
 */
export const importFromFolder = async (): Promise<ImportReport | null> => {
  let files: File[] | null;
  try {
    files = await pickFolderToImport();
  } catch (err) {
    setState({ message: `Lecture du dossier impossible : ${err instanceof Error ? err.message : String(err)}` });
    return null;
  }
  return files ? importFiles(files) : null;
};

/**
 * Peut-on importer : mémoire ouverte, ou sans dossier sur le téléphone (les
 * sessions attendent alors dans le dossier privé).
 */
export const canImportSessions = (s: Pick<LibraryState, 'status' | 'pendingCount'>): boolean =>
  s.status === 'ready' || s.pendingCount > 0 || s.status === 'unavailable';

/** Contenu du GPX d'une session, `null` s'il n'est pas lisible. */
export const readSessionGpx = async (file: string): Promise<string | null> => {
  await opening;
  return folder ? folder.readText(sessionPath(file)) : null;
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
  replaceSession({ ...session, record });
  scheduleRecordWrite(file);
  if (stale) void resummarize(file);
};

/** Résumé recalculé avec le support de la fiche. */
const resummarize = async (file: string): Promise<void> => {
  const f = folder;
  const session = findSession(file);
  if (!f || !session) return;
  try {
    const text = await f.readText(sessionPath(file));
    const analyzed = text === null ? null : analyzeGpx(text, session.record.sport, session.record.analysis, session.record.activityId, session.record);
    const current = findSession(file);
    if (!analyzed || !current || folder !== f) return;
    replaceSession({ ...current, record: withSummary(current.record, analyzed.summary) });
    scheduleRecordWrite(file);
  } catch {
    // Trace illisible : le résumé précédent reste affiché.
  }
};

/**
 * Supprime une session : son GPX, sa fiche et ses capteurs, ainsi que les copies de la même
 * trace sous un autre nom, qui sans cela prendraient sa place dans la liste.
 */
export const removeSession = async (file: string): Promise<void> => {
  const f = folder;
  const session = findSession(file);
  if (!f || !session) return;
  const copies = all.filter((s) => s.record.summary.startMs === session.record.summary.startMs);
  try {
    for (const copy of copies) {
      cancelRecordWrite(copy.file);
      await f.remove(sessionPath(recordFileName(copy.file)));
      await f.remove(sessionPath(imuFileName(copy.file)));
      await f.remove(sessionPath(copy.file));
      knownNames.delete(copy.file);
      knownNames.delete(recordFileName(copy.file));
      knownNames.delete(imuFileName(copy.file));
    }
  } catch (err) {
    setState({ error: `Suppression incomplète : ${errorMessage(err, 'erreur inconnue')}` });
  }
  all = all.filter((s) => !copies.includes(s));
  publish();
  void refreshCache(f, generation);
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
      const text = await previous.readText(sessionPath(session.file));
      if (text === null) continue;
      const motion = await previous.readBytes(sessionPath(imuFileName(session.file)));
      const result = await addGpx(text, session.record.source, {
        record: session.readOnly ? null : session.record,
        motion: motion ?? undefined,
      });
      if (result.status === 'added') copied += 1;
    }
    if (copied > 0) {
      setState({ message: `${copied} session${copied > 1 ? 's' : ''} de la mémoire du navigateur recopiée${copied > 1 ? 's' : ''} dans le dossier.` });
    }
  }
  applySettingsChange(settingsChanged);
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
    applySettingsChange(await attach(f));
  } catch (err) {
    detach('unavailable', f.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
  }
};

/** Oublie le dossier choisi et revient à la mémoire du navigateur. */
export const switchToBrowserMemory = async (): Promise<void> => {
  await forgetChosenFolder();
  await openLibrary();
};

/** Relecture en cours : un second appui attend la même. */
let refreshing: Promise<void> | null = null;

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

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
    await flushWrites();
    generation += 1;
    const gen = generation;
    const settingsChanged = await syncSettings(f);
    const jobs = await scan(f, gen);
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
      applySettingsChange(read.settingsChanged);
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

/** Session d'un fichier, lue hors d'un composant, doublons compris. */
export const librarySession = (file: string): LibrarySession | undefined => findSession(file);

/** Session d'un fichier, ou `undefined` si la bibliothèque ne la connaît pas. */
export const findLibrarySession = (sessions: LibrarySession[], file: string | null): LibrarySession | undefined =>
  file === null ? undefined : sessions.find((s) => s.file === file);

/** Nom donné par l'utilisateur à la session d'un fichier, `null` sans nom ou hors de la mémoire. */
export const useSessionName = (file: string | null): string | null =>
  findLibrarySession(useSessionLibrary().sessions, file)?.record.name ?? null;

/**
 * Dossier mémoire en service, une fois l'ouverture en cours terminée ; `null`
 * s'il n'y en a aucun d'accessible. Pour ce qui se range à côté des sessions :
 * les itinéraires (`useRouteLibrary`).
 */
export const currentMemoryFolder = async (): Promise<MemoryFolder | null> => {
  await opening;
  return folder;
};
