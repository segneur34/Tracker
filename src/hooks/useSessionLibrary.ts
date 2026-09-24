import { useSyncExternalStore } from 'react';
import { parseGpx } from '../core/gpxParser';
import { ELEVATION_PRESETS, SAILING_SPORTS } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import {
  MARKER_FILE,
  README_FILE,
  SESSIONS_DIR,
  SETTINGS_FILE,
  markerText,
  readmeText,
  sessionPath,
} from '../library/folderLayout';
import { guessSport, uniqueSessionFileName } from '../library/naming';
import {
  RECORD_FORMAT,
  RECORD_VERSION,
  dedupeSessions,
  findLegacyNotes,
  isGpxFileName,
  isSummaryStale,
  isWritableRecord,
  parseRecord,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type SessionRecord,
  type SessionSource,
  type SessionSummary,
  type StoredSessionNotes,
} from '../library/record';
import { planReconcile, type LibraryCache } from '../library/reconcile';
import {
  TRAVELLING_KEYS,
  buildSettingsFile,
  chooseSettings,
  parseSettingsFile,
  serializeSettingsFile,
  type SettingsChoice,
  type SettingsFile,
} from '../library/settingsFile';
import { summarizeSession, type SummaryOptions } from '../library/summary';
import { readPickedFile } from '../platform/files';
import {
  canChooseFolder,
  chooseMemoryFolder,
  forgetChosenFolder,
  openMemoryFolder,
  pendingFolder,
  reconnectMemoryFolder,
  type MemoryFolder,
  type MemoryKind,
} from '../platform/memoryFolder';
import { jsonStore } from '../platform/storage';
import { sessionFileName } from '../recording/session';
import { isKnownTerrain, readStoredSettings } from './useSportSettings';

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
 * Les écritures d'une fiche (notes surtout, saisies lettre à lettre) sont
 * regroupées et différées, puis vidées dès que l'application passe en
 * arrière-plan.
 */

export type LibraryStatus = 'opening' | 'ready' | 'needs-permission' | 'unavailable';

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
  /** D'où viennent les réglages en vigueur, à la dernière ouverture ou au dernier changement. */
  settingsSource: SettingsChoice | null;
  settingsSavedAt: number | null;
  /** Compte rendu de la dernière action (import, copie). */
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
  settingsSource: null,
  settingsSavedAt: null,
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

/** Réglages de l'utilisateur qui changent le résumé d'un support. */
const summaryOptions = (sport: SportType | null): SummaryOptions => {
  if (sport === null) return {};
  const stored = readStoredSettings();
  const terrain = stored.terrains?.[sport];
  return {
    activeThreshold: stored.thresholds?.[sport],
    referenceSpeedOverrideMs: SAILING_SPORTS.includes(sport) ? stored.referenceSpeeds?.[sport] : undefined,
    elevation: isKnownTerrain(terrain) ? ELEVATION_PRESETS[terrain] : undefined,
  };
};

interface AnalyzedGpx {
  summary: SessionSummary;
  sport: SportType | null;
  title: string | null;
}

/**
 * Lit un GPX et le résume. `sport` absent : deviné depuis la trace. Rend
 * `null` si la trace a moins de deux points, lève une erreur si le XML est
 * illisible.
 */
const analyzeGpx = (text: string, sport?: SportType | null): AnalyzedGpx | null => {
  const parsed = parseGpx(text);
  const resolved = sport === undefined ? guessSport(parsed.trackType) : sport;
  const summary = summarizeSession(parsed.rawPoints, resolved, summaryOptions(resolved));
  return summary ? { summary, sport: resolved, title: parsed.trackName ?? null } : null;
};

const LEGACY_NOTES_KEY = 'tracker.sailingNotes';

const newRecord = (gpx: string, analyzed: AnalyzedGpx, source: SessionSource): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx,
  sport: analyzed.sport,
  source,
  addedAt: new Date().toISOString(),
  title: analyzed.title,
  summary: analyzed.summary,
  // Notes saisies avant l'existence du dossier, pour la même trace.
  notes: findLegacyNotes(jsonStore.read<Record<string, unknown>>(LEGACY_NOTES_KEY), analyzed.summary.startMs),
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

// --- Réglages qui voyagent ---

/** Instant du dernier changement des réglages de l'appareil. */
const SETTINGS_SAVED_AT_KEY = 'tracker.settingsSavedAt';
const SETTINGS_WRITE_DELAY_MS = 2000;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
/** Vrai pendant qu'on applique les réglages du dossier : ce ne sont pas des changements de l'utilisateur. */
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

/**
 * Empreinte des réglages qui voyagent, sans le dernier support choisi dans un
 * module : ouvrir une session de kite n'est pas changer un réglage, et ne
 * doit pas rendre les réglages de l'appareil plus récents que ceux du dossier.
 */
const settingsSignature = (): string => {
  const values = localTravellingValues();
  const sportSettings = values['tracker.sportSettings'];
  if (sportSettings && typeof sportSettings === 'object') {
    const { sport: _lastSport, ...rest } = sportSettings as Record<string, unknown>;
    values['tracker.sportSettings'] = rest;
  }
  return JSON.stringify(values);
};

/** Empreinte au dernier rapprochement ou au dernier vrai changement. */
let lastSignature: string | null = null;

const writeSettingsFile = async (f: MemoryFolder, savedAt: number, previous: SettingsFile | null): Promise<void> => {
  await f.writeText(SETTINGS_FILE, serializeSettingsFile(buildSettingsFile(localTravellingValues(), savedAt, previous)));
};

const flushSettings = async (): Promise<void> => {
  if (settingsTimer !== null) clearTimeout(settingsTimer);
  settingsTimer = null;
  const f = folder;
  const savedAt = readLocalSavedAt();
  if (!f || savedAt === null) return;
  try {
    await writeSettingsFile(f, savedAt, parseSettingsFile(await f.readText(SETTINGS_FILE)));
  } catch (err) {
    setState({ error: `Réglages non recopiés dans le dossier : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * Rapproche les réglages de l'appareil et ceux du dossier. Rend vrai si des
 * réglages du dossier ont remplacé ceux de l'appareil : les pages déjà
 * affichées ne les voient qu'après un rechargement.
 */
const syncSettings = async (f: MemoryFolder): Promise<boolean> => {
  const file = parseSettingsFile(await f.readText(SETTINGS_FILE));
  const localSavedAt = readLocalSavedAt();
  const choice = chooseSettings(localSavedAt, file);
  let changed = false;
  if (choice === 'folder' && file) {
    applyingSettings = true;
    try {
      for (const key of TRAVELLING_KEYS) {
        if (!(key in file.values)) continue;
        if (JSON.stringify(jsonStore.read<unknown>(key)) === JSON.stringify(file.values[key])) continue;
        jsonStore.write(key, file.values[key]);
        changed = true;
      }
      jsonStore.write(SETTINGS_SAVED_AT_KEY, file.savedAt);
    } finally {
      applyingSettings = false;
    }
    setState({ settingsSource: 'folder', settingsSavedAt: file.savedAt });
  } else if (choice === 'local') {
    const savedAt = localSavedAt ?? Date.now();
    if (localSavedAt === null) jsonStore.write(SETTINGS_SAVED_AT_KEY, savedAt);
    await writeSettingsFile(f, savedAt, file);
    setState({ settingsSource: 'local', settingsSavedAt: savedAt });
  } else {
    setState({ settingsSource: 'same', settingsSavedAt: localSavedAt });
  }
  lastSignature = settingsSignature();
  return changed;
};

// --- Ouverture d'un dossier ---

/** Marqueur et mode d'emploi, écrits s'ils manquent. */
const ensureLayout = async (f: MemoryFolder): Promise<void> => {
  if ((await f.readText(MARKER_FILE)) === null) await f.writeText(MARKER_FILE, markerText());
  if ((await f.readText(README_FILE)) === null) await f.writeText(README_FILE, readmeText());
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

  // Un GPX posé à la racine du dossier est rangé dans `sessions/`.
  if (plan.rootGpx.length > 0) {
    const taken = new Set(entries.map((e) => e.name));
    for (const name of plan.rootGpx) {
      const text = await f.readText(name);
      if (text === null) continue;
      const target = uniqueSessionFileName(name, taken);
      await f.writeText(sessionPath(target), text);
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
      const analyzed = text === null ? null : analyzeGpx(text, job.previous ? job.previous.sport : undefined);
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
    const result = await addGpx(text, 'enregistrement', {});
    if (result.status === 'added' || result.status === 'duplicate') await pending.remove(entry.name);
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
  setState({
    status,
    folderKind: null,
    folderLabel: label,
    reason,
    sessions: [],
    duplicates: [],
    unreadable: [],
    scanning: null,
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
      applySettingsChange(await attach(access.folder));
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
    const signature = settingsSignature();
    if (signature === lastSignature) return;
    lastSignature = signature;
    const now = Date.now();
    jsonStore.write(SETTINGS_SAVED_AT_KEY, now);
    setState({ settingsSource: 'local', settingsSavedAt: now });
    if (settingsTimer !== null) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => void flushSettings(), SETTINGS_WRITE_DELAY_MS);
  });
  // Écritures différées vidées dès que l'application passe en arrière-plan.
  const flushAll = () => {
    for (const file of [...recordTimers.keys()]) {
      cancelRecordWrite(file);
      void writeRecordNow(file);
    }
    if (settingsTimer !== null) void flushSettings();
  };
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
  /** Fiche qui accompagne le GPX, lors de l'import d'un dossier. */
  record?: SessionRecord | null;
}

/** Range un GPX dans la mémoire, avec sa fiche. */
const addGpx = async (text: string, source: SessionSource, options: AddOptions): Promise<AddResult> => {
  let analyzed: AnalyzedGpx | null;
  try {
    const sport = options.sport ?? options.record?.sport ?? undefined;
    analyzed = analyzeGpx(text, sport);
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
    await countPending();
    return { status: 'pending', file: null };
  }

  const gpx = uniqueSessionFileName(name, knownNames);
  const record = options.record
    ? withSummary({ ...options.record, gpx, sport: analyzed.sport }, analyzed.summary)
    : newRecord(gpx, analyzed, source);
  await f.writeText(sessionPath(gpx), text);
  await f.writeText(sessionPath(recordFileName(gpx)), serializeRecord(record));
  knownNames.add(gpx);
  knownNames.add(recordFileName(gpx));
  replaceSession({ file: gpx, record, readOnly: false, warning: null });
  return { status: 'added', file: gpx };
};

/**
 * Range une session qui vient d'être enregistrée. Rend son nom dans la
 * mémoire et, en clair, l'endroit où elle se trouve. Ne lève d'erreur que si
 * l'écriture échoue : l'enregistreur garde alors son journal.
 */
export const saveRecordedSession = async (
  text: string,
  sport: SportType
): Promise<{ file: string | null; location: string }> => {
  await opening;
  const result = await addGpx(text, 'enregistrement', { sport });
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
  (file.webkitRelativePath || file.name).replace(/\.(gpx|json)$/i, '').toLowerCase();

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
  await opening;
  const records = new Map<string, File>();
  for (const file of files) if (/\.json$/i.test(file.name)) records.set(baseKey(file), file);

  const report: ImportReport = { added: [], existing: [], duplicates: 0, invalid: [], unsaved: 0 };
  for (const file of files) {
    if (!isGpxFileName(file.name)) continue;
    const recordFile = records.get(baseKey(file));
    const record = recordFile ? parseRecord(await readPickedFile(recordFile)) : null;
    const result = await addGpx(await readPickedFile(file), 'import', {
      record: record && isWritableRecord(record) ? record : null,
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
};

/** Contenu du GPX d'une session, `null` s'il n'est pas lisible. */
export const readSessionGpx = async (file: string): Promise<string | null> => {
  await opening;
  return folder ? folder.readText(sessionPath(file)) : null;
};

export interface RecordPatch {
  sport?: SportType | null;
  notes?: StoredSessionNotes | null;
  maneuverCount?: number;
}

/**
 * Modifie la fiche d'une session : support, notes, nombre de manœuvres. La
 * liste suit tout de suite ; le fichier est écrit un instant plus tard. Un
 * changement de support recalcule le résumé.
 */
export const updateSessionRecord = (file: string, patch: RecordPatch): void => {
  const session = findSession(file);
  if (!session || session.readOnly) return;
  let record = session.record;
  if (patch.notes !== undefined) record = { ...record, notes: patch.notes };
  if (patch.maneuverCount !== undefined && patch.maneuverCount !== record.summary.maneuverCount) {
    record = { ...record, summary: { ...record.summary, maneuverCount: patch.maneuverCount } };
  }
  const sportChanged = patch.sport !== undefined && patch.sport !== record.sport;
  if (sportChanged) record = { ...record, sport: patch.sport ?? null };
  if (record === session.record) return;
  replaceSession({ ...session, record });
  scheduleRecordWrite(file);
  if (sportChanged) void resummarize(file);
};

/** Résumé recalculé avec le support de la fiche. */
const resummarize = async (file: string): Promise<void> => {
  const f = folder;
  const session = findSession(file);
  if (!f || !session) return;
  try {
    const text = await f.readText(sessionPath(file));
    const analyzed = text === null ? null : analyzeGpx(text, session.record.sport);
    const current = findSession(file);
    if (!analyzed || !current || folder !== f) return;
    replaceSession({ ...current, record: withSummary(current.record, analyzed.summary) });
    scheduleRecordWrite(file);
  } catch {
    // Trace illisible : le résumé précédent reste affiché.
  }
};

/**
 * Supprime une session : son GPX et sa fiche, ainsi que les copies de la même
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
      await f.remove(sessionPath(copy.file));
      knownNames.delete(copy.file);
      knownNames.delete(recordFileName(copy.file));
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
    setState({ error: `Dossier inaccessible : ${errorMessage(err, 'erreur inconnue')}` });
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
      const result = await addGpx(text, session.record.source, { record: session.readOnly ? null : session.record });
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
  const f = await reconnectMemoryFolder();
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

export const dismissLibraryMessage = (): void => setState({ message: null, error: null });

/** État de la bibliothèque, relu à chaque changement. */
export const useSessionLibrary = (): LibraryState => useSyncExternalStore(subscribe, () => state);

/** Session d'un fichier, lue hors d'un composant, doublons compris. */
export const librarySession = (file: string): LibrarySession | undefined => findSession(file);

/** Session d'un fichier, ou `undefined` si la bibliothèque ne la connaît pas. */
export const findLibrarySession = (sessions: LibrarySession[], file: string | null): LibrarySession | undefined =>
  file === null ? undefined : sessions.find((s) => s.file === file);
