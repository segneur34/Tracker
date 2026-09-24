/**
 * `reglages.json`, les réglages qui voyagent avec le dossier mémoire : seuils,
 * bornes de couleur et unités par support, profil du coureur. La disposition
 * de l'écran (sections ouvertes, tailles des blocs) reste propre à chaque
 * appareil.
 *
 * Règle de reprise : entre le fichier du dossier et les réglages de
 * l'appareil, le plus récent l'emporte. Une application neuve, sans réglage,
 * reprend donc ceux du dossier ; un appareil dont on vient de changer un
 * réglage l'écrit dans le dossier.
 */

export const SETTINGS_FORMAT = 'tracker-reglages';
export const SETTINGS_VERSION = 1;

/** Clés de `jsonStore` recopiées dans le dossier. */
export const TRAVELLING_KEYS = ['tracker.sportSettings', 'tracker.runnerProfile'] as const;

export interface SettingsFile {
  format: typeof SETTINGS_FORMAT;
  version: number;
  /** Instant du dernier changement de réglage, en millisecondes. */
  savedAt: number;
  /** Valeur de chaque clé, telle que `jsonStore` la garde. */
  values: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  return { format: SETTINGS_FORMAT, version: raw.version, savedAt: raw.savedAt, values: raw.values };
};

/**
 * Fichier à écrire. Les clés que cette version ne connaît pas, écrites par une
 * version plus récente, sont reprises de `previous` plutôt que perdues.
 */
export const buildSettingsFile = (
  values: Record<string, unknown>,
  savedAt: number,
  previous: SettingsFile | null = null
): SettingsFile => ({
  format: SETTINGS_FORMAT,
  version: Math.max(SETTINGS_VERSION, previous?.version ?? 0),
  savedAt,
  values: { ...previous?.values, ...values },
});

export const serializeSettingsFile = (file: SettingsFile): string => `${JSON.stringify(file, null, 2)}\n`;

/** `folder` : reprendre le fichier ; `local` : l'écrire ; `same` : rien à faire. */
export type SettingsChoice = 'folder' | 'local' | 'same';

export const chooseSettings = (localSavedAt: number | null, folder: SettingsFile | null): SettingsChoice => {
  if (folder === null) return 'local';
  if (localSavedAt === null || folder.savedAt > localSavedAt) return 'folder';
  return folder.savedAt < localSavedAt ? 'local' : 'same';
};
