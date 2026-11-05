import { SETTINGS_DIR, SETTINGS_FILE, settingsPath } from '../../library/folderLayout';
import {
  TRAVELLING_KEYS, adoptedValues, buildSettingsFile, checkedValues, chooseSettings, cleanDeviceName, deviceFileName,
  freeDeviceName, importedSettingsFileName, newestSettingsEntry, ownSettingsEntry, parseSettingsFile,
  serializeSettingsFile, settingsEntryKey, settingsEntryName, settingsFileInfo, settingsSignature,
  sortedSettingsFiles, unseenSettingsEntries, type SettingsEntry, type SettingsFileInfo,
} from '../../library/settingsFile';
import { readPickedFile } from '../../platform/files';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { isNativeApp } from '../../platform/runtime';
import { jsonStore, storageStartupFailure } from '../../platform/storage';
import { subscribeStoredSettings } from '../useSportSettings';
import { syncRestingHrFile } from '../restingHrFile';
import { errorMessage, finiteOr, newId } from '../../core/basics';
import { libraryState, reportError, setState } from './store';
import { lib, unwritten } from './memory';
import { cancelRecordWrite, recordTimers, writeRecordNow } from './recordWrites';
import { flushCacheUpdate } from './cache';
import { queueOutdatedRefresh } from './summaryQueue';

/**
 * Réglages de l'appareil, un fichier par appareil dans `reglages/` (§10, point 90 ; lot 113) : rapprochement à
 * l'ouverture, écriture différée, reprise du fichier d'un autre appareil, renommage, import ; et le vidage de
 * toutes les écritures en attente (`flushWrites`).
 */

/**
 * Écrit tout de suite les fiches et les réglages en attente d'écriture, puis le cache des fiches s'il
 * attendait. Les fiches dont la dernière écriture a échoué (`unwritten`) sont retentées : leur erreur
 * reste dite tant qu'elles ne sont pas écrites.
 */
export const flushWrites = async (): Promise<void> => {
  const files = [...new Set([...recordTimers.keys(), ...unwritten])];
  files.forEach(cancelRecordWrite);
  await Promise.all([
    ...files.map((file) => writeRecordNow(file)),
    ...(settingsTimer !== null ? [flushSettings()] : []),
  ]);
  await flushCacheUpdate();
};

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

/** Dossier quitté (`detach`) : la dernière lecture de `reglages/` n'a plus d'objet. */
export const forgetSettingsEntries = (): void => {
  settingsEntries = [];
  unreadableSettings = [];
};

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

/** Liste de Réglages › Mémoire : le fichier de l'appareil en tête, puis les autres du plus récent au plus ancien. */
const publishSettingsFiles = (): void => {
  setState({ settingsFiles: sortedSettingsFiles(settingsEntries, deviceId()), deviceName: deviceName() });
};

/**
 * Écrit le fichier de l'appareil, sous son nom. Le fichier d'un autre
 * appareil qui porte déjà ce nom n'est jamais écrasé, ni un fichier qui ne se
 * lit pas, fût-il le sien : l'appareil prend un nom libre (« Téléphone 2 »)
 * et l'annonce. Son fichier précédent, sous un autre nom, est retiré.
 */
const writeOwnSettings = async (f: MemoryFolder, savedAt: number): Promise<void> => {
  // Stockage illisible au démarrage : les réglages en mémoire ne sont pas ceux de l'appareil, son fichier reste tel quel.
  // Mémoire en lecture seule : rien n'y est écrit.
  if (storageStartupFailure() || f.readOnly) {
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
  const f = lib.folder;
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
  await lib.opening;
  lastSignature = settingsSignature(localTravellingValues());
  await flushSettings();
  // Pré-réglages changés par la mise à jour : un geste comme un autre, pris en compte après l'ouverture.
  void queueOutdatedRefresh();
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
  const previous = libraryState().settingsOffer;
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
  if (legacy && !startupFailed && !f.readOnly) await f.remove(SETTINGS_FILE);
  offerNewSettings(autoAdopted);
  return changed;
};

/** `syncSettings`, dont l'échec est dit sans empêcher d'ouvrir ni de relire le dossier. */
export const syncSettingsSafely = async (f: MemoryFolder): Promise<boolean> => {
  // Tests de FC repos (`fc-repos.json`) : leur échec est dit, sans empêcher les réglages ni l'ouverture.
  await syncRestingHrFile(f).catch((err: unknown) =>
    reportError(`Tests de FC repos du dossier non relus : ${errorMessage(err, 'erreur inconnue')}`));
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
  await lib.opening;
  const f = lib.folder;
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
  await lib.opening;
  const f = lib.folder;
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
  await lib.opening;
  const f = lib.folder;
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

/** Interface affichée (`startLibraryUi`) : des réglages repris du dossier rechargent alors la page. */
let uiStarted = false;

/** Faux pendant ce qu'un rechargement interromprait (un enregistrement). */
let canReload: () => boolean = () => true;

/** Vrai une fois l'interface affichée (`startLibraryUi`). */
export const libraryUiStarted = (): boolean => uiStarted;

/**
 * Les pages lisent les réglages à leur premier affichage : des réglages repris
 * du dossier après le démarrage ne s'appliquent qu'en rechargeant. Jamais
 * pendant un enregistrement.
 */
export const applySettingsChange = async (changed: boolean): Promise<void> => {
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
 * Une fois l'interface affichée : un réglage qui voyage, changé ici, date les réglages de l'appareil et réécrit
 * son fichier un instant plus tard ; un réglage d'activité qui change les résumés les fait refaire. `isBusy` dit si
 * un rechargement interromprait quelque chose (`applySettingsChange`).
 */
export const watchDeviceSettings = (isBusy: () => boolean): void => {
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
  // Réglage d'activité changé (seuil, foil…) : un geste, et les résumés de l'activité sont refaits, une fois
  // la saisie posée (elle écrit à chaque touche). Pas pour des réglages repris du dossier : la page se
  // recharge, ou ils valent au prochain lancement, dont la comparaison voit le geste (`attach`).
  let settingsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  subscribeStoredSettings(() => {
    if (applyingSettings) return;
    if (settingsRefreshTimer !== null) clearTimeout(settingsRefreshTimer);
    settingsRefreshTimer = setTimeout(() => {
      settingsRefreshTimer = null;
      void queueOutdatedRefresh();
    }, SETTINGS_REFRESH_DELAY_MS);
  });
};
