import { readActivities } from '../core/activities';

/**
 * Fichiers de réglages du dossier mémoire (§10, point 90) : un par appareil,
 * `reglages/<nom de l'appareil>.json`. Ils portent ce qui voyage : activités
 * et leurs réglages, séances du compteur, barre du bas, profil du pratiquant.
 * La disposition de l'écran (sections ouvertes, tailles des blocs) reste
 * propre à chaque appareil.
 *
 * Chaque appareil écrit le sien et ne remplace jamais ses réglages par ceux
 * d'un autre de lui-même : on choisit dans Réglages › Mémoire le fichier à
 * reprendre (« Reprendre »). Seul un appareil neuf, sans réglage à lui,
 * reprend tout seul le plus récent. L'appareil reconnaît son fichier à son
 * identifiant, tiré au hasard, et non à son nom : deux téléphones nommés
 * « Téléphone » ne s'écrasent pas.
 *
 * Avant le point 90, un seul `reglages.json` à la racine, sans appareil
 * (version 1), et le plus récent l'emportait (`chooseSettings`) : cette règle
 * ne joue plus qu'une fois, au passage vers `reglages/`.
 */

export const SETTINGS_FORMAT = 'tracker-reglages';
/** 2 : appareil qui a écrit le fichier (`device`). */
export const SETTINGS_VERSION = 2;

/** Clés de `jsonStore` recopiées dans le dossier. */
export const TRAVELLING_KEYS = ['tracker.sportSettings', 'tracker.runnerProfile'] as const;

/** Appareil qui a écrit un fichier : identifiant tiré au hasard, nom choisi par l'utilisateur. */
export interface SettingsDevice {
  id: string;
  name: string;
}

export interface SettingsFile {
  format: typeof SETTINGS_FORMAT;
  version: number;
  /** Instant du dernier changement de réglage, en millisecondes. */
  savedAt: number;
  /** Appareil qui l'a écrit ; `null` pour un fichier de la version 1. */
  device: SettingsDevice | null;
  /** Valeur de chaque clé, telle que `jsonStore` la garde. */
  values: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readDevice = (raw: unknown): SettingsDevice | null => {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const name = cleanDeviceName(raw.name);
  return raw.id !== '' && name !== '' ? { id: raw.id, name } : null;
};

export const parseSettingsFile = (text: string | null): SettingsFile | null => {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.format !== SETTINGS_FORMAT) return null;
  if (typeof raw.version !== 'number' || typeof raw.savedAt !== 'number' || !isFinite(raw.savedAt)) return null;
  if (!isObject(raw.values)) return null;
  return { format: SETTINGS_FORMAT, version: raw.version, savedAt: raw.savedAt, device: readDevice(raw.device), values: raw.values };
};

/**
 * Fichier à écrire. Les clés que cette version ne connaît pas, écrites par une
 * version plus récente, sont reprises de `previous` plutôt que perdues.
 */
export const buildSettingsFile = (
  values: Record<string, unknown>,
  savedAt: number,
  previous: SettingsFile | null = null,
  device: SettingsDevice | null = null
): SettingsFile => ({
  format: SETTINGS_FORMAT,
  version: Math.max(SETTINGS_VERSION, previous?.version ?? 0),
  savedAt,
  device,
  values: { ...previous?.values, ...values },
});

export const serializeSettingsFile = (file: SettingsFile): string => `${JSON.stringify(file, null, 2)}\n`;

// --- Appareils et noms de fichier ---

export const DEVICE_NAME_MAX = 40;

/** Nom d'appareil tel qu'on le garde : sans espaces en trop, 40 caractères au plus. */
export const cleanDeviceName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, DEVICE_NAME_MAX).trim();

/** Fichier d'un appareil, tiré de son nom : « Téléphone de Léa » donne `telephone-de-lea.json`. */
export const deviceFileName = (name: string): string => {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'appareil'}.json`;
};

/**
 * Nom libre pour un appareil : le nom voulu si aucun fichier d'un autre
 * appareil ne le porte déjà, sinon suivi de 2, 3…
 */
export const freeDeviceName = (name: string, takenFiles: ReadonlySet<string>): string => {
  const taken = (candidate: string) => takenFiles.has(deviceFileName(candidate));
  if (!taken(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, DEVICE_NAME_MAX - String(n).length - 1)} ${n}`;
    if (!taken(candidate)) return candidate;
  }
};

/** Un fichier du dossier `reglages/`, lu. */
export interface SettingsEntry {
  fileName: string;
  file: SettingsFile;
}

/** Fichier de l'appareil : celui qui porte son identifiant. */
export const ownSettingsEntry = (entries: readonly SettingsEntry[], deviceId: string): SettingsEntry | null =>
  entries.find((e) => e.file.device?.id === deviceId) ?? null;

/** Le plus récent des fichiers, `null` s'il n'y en a aucun. */
export const newestSettingsEntry = (entries: readonly SettingsEntry[]): SettingsEntry | null =>
  entries.reduce<SettingsEntry | null>((best, e) => (best === null || e.file.savedAt > best.file.savedAt ? e : best), null);

/** Nom affiché d'un fichier : celui de l'appareil qui l'a écrit, sinon le nom du fichier. */
export const settingsEntryName = (entry: SettingsEntry): string =>
  entry.file.device?.name ?? entry.fileName.replace(/\.json$/i, '');

/**
 * Ce qui fait reconnaître un fichier d'un lancement à l'autre : l'identifiant
 * de l'appareil qui l'a écrit, qui ne change pas quand il se renomme ; à
 * défaut, le nom du fichier.
 */
export const settingsEntryKey = (entry: SettingsEntry): string =>
  entry.file.device ? `appareil:${entry.file.device.id}` : `fichier:${entry.fileName.toLowerCase()}`;

/**
 * Fichiers d'autres appareils que celui-ci n'a jamais vus (`seen` : clés
 * `settingsEntryKey` déjà vues), le plus récent en tête : chacun n'est
 * proposé qu'une fois. Sans liste gardée (`null`), la première fois, aucun :
 * les fichiers déjà là sont tenus pour vus.
 */
export const unseenSettingsEntries = (
  entries: readonly SettingsEntry[],
  seen: ReadonlySet<string> | null,
  deviceId: string
): SettingsEntry[] =>
  seen === null
    ? []
    : entries
      .filter((e) => e.file.device?.id !== deviceId && !seen.has(settingsEntryKey(e)))
      .sort((a, b) => b.file.savedAt - a.file.savedAt);

/**
 * Nom sous lequel ranger dans `reglages/` un fichier choisi à la main
 * (« Importer un fichier de réglages ») : celui du fichier du même appareil,
 * qu'il remplace ; sinon tiré du nom de l'appareil (du nom du fichier choisi
 * à défaut), suivi de 2, 3… s'il est déjà pris (`taken`, en minuscules).
 */
export const importedSettingsFileName = (
  file: SettingsFile,
  pickedName: string,
  entries: readonly SettingsEntry[],
  taken: ReadonlySet<string>
): string => {
  const sameDevice = file.device ? entries.find((e) => e.file.device?.id === file.device?.id) : undefined;
  if (sameDevice) return sameDevice.fileName;
  const base = deviceFileName(file.device?.name ?? pickedName.replace(/\.json$/i, '')).replace(/\.json$/, '');
  if (!taken.has(`${base}.json`)) return `${base}.json`;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}.json`)) return `${base}-${n}.json`;
  }
};

/** Nombre d'activités d'un fichier ; sans liste rangée, celles du premier lancement. */
export const settingsActivityCount = (file: SettingsFile): number => {
  const sport = file.values['tracker.sportSettings'];
  return readActivities(isObject(sport) ? sport.activities : undefined).length;
};

// --- Choix retenus ---

/**
 * Choix retenus d'une fois sur l'autre, qui ne sont pas des réglages : le
 * support ou l'activité du module (`sport`, l'ancienne clé, et
 * `moduleActivity`), l'activité proposée à l'enregistrement et la dernière
 * séance lancée au compteur.
 */
const REMEMBERED_CHOICES = ['sport', 'moduleActivity', 'recordActivity', 'lastIntervalWorkout'];

/**
 * Empreinte des réglages qui voyagent, sans les choix retenus : ouvrir une
 * session de kite ou choisir l'activité d'un enregistrement n'est pas changer
 * un réglage, et ne doit pas dater les réglages de l'appareil.
 */
export const settingsSignature = (values: Record<string, unknown>): string => {
  const sportSettings = values['tracker.sportSettings'];
  if (!isObject(sportSettings)) return JSON.stringify(values);
  const settings = Object.fromEntries(Object.entries(sportSettings).filter(([key]) => !REMEMBERED_CHOICES.includes(key)));
  return JSON.stringify({ ...values, 'tracker.sportSettings': settings });
};

/**
 * Valeurs à prendre en reprenant le fichier d'un autre appareil : les
 * siennes, sauf les choix retenus, qui restent ceux de cet appareil.
 */
export const adoptedValues = (theirs: Record<string, unknown>, mine: Record<string, unknown>): Record<string, unknown> => {
  const theirSport = theirs['tracker.sportSettings'];
  if (!isObject(theirSport)) return theirs;
  const mySport = mine['tracker.sportSettings'];
  const settings: Record<string, unknown> = Object.fromEntries(Object.entries(theirSport).filter(([key]) => !REMEMBERED_CHOICES.includes(key)));
  if (isObject(mySport)) for (const key of REMEMBERED_CHOICES) if (key in mySport) settings[key] = mySport[key];
  return { ...theirs, 'tracker.sportSettings': settings };
};

// --- Ancien `reglages.json` ---

/** `folder` : reprendre le fichier ; `local` : l'écrire ; `same` : rien à faire. */
export type SettingsChoice = 'folder' | 'local' | 'same';

/** Règle d'avant le point 90, entre l'ancien `reglages.json` et l'appareil : le plus récent l'emporte. */
export const chooseSettings = (localSavedAt: number | null, folder: SettingsFile | null): SettingsChoice => {
  if (folder === null) return 'local';
  if (localSavedAt === null || folder.savedAt > localSavedAt) return 'folder';
  return folder.savedAt < localSavedAt ? 'local' : 'same';
};
