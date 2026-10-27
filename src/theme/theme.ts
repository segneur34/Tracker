/**
 * Thème de l'interface (lot 12, maquette du 28/10) : Clair, Sombre ou Auto,
 * qui suit le réglage du téléphone ou du navigateur (`prefers-color-scheme`),
 * plus la case « Économe » (noir pur, moins d'effets), qui impose le sombre.
 * Réglé par appareil, dans Réglages › Affichage (clé `THEME_STORAGE_KEY`),
 * jamais repris d'un autre appareil. Économe n'agit que sur l'aspect : ni le
 * GPS ni l'écran allumé pendant l'enregistrement ne changent.
 *
 * Calcul pur : la résolution d'« Auto » reçoit l'état du système en
 * paramètre ; la lecture de `matchMedia` et la pose sur `<html>` sont dans
 * `hooks/useTheme.ts`, seul endroit qui décide (aucun bloc
 * `prefers-color-scheme` dans les feuilles de style).
 */

export type ThemeChoice = 'clair' | 'sombre' | 'auto';

/** Choix du bouton glissant de Réglages, dans l'ordre. */
export const THEME_CHOICES: ReadonlyArray<{ key: ThemeChoice; label: string }> = [
  { key: 'clair', label: 'Clair' },
  { key: 'sombre', label: 'Sombre' },
  { key: 'auto', label: 'Auto' },
];

export interface ThemeSettings {
  choice: ThemeChoice;
  /** Économe : noir pur et moins d'effets ; impose le sombre, quel que soit `choice`. */
  eco: boolean;
}

/** Clé de stockage, propre à l'appareil (hors du fichier de réglages qui voyage, `library/settingsFile.ts`). */
export const THEME_STORAGE_KEY = 'tracker.theme';

/** Réglage de départ (décision du 28/10) : Auto, sans Économe. */
export const THEME_DEFAULT: ThemeSettings = { choice: 'auto', eco: false };

/** Requête du thème sombre du système, lue par « Auto ». */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

const isChoice = (value: unknown): value is ThemeChoice =>
  value === 'clair' || value === 'sombre' || value === 'auto';

/** Réglage lu dans le stockage : une valeur absente ou abîmée retombe, champ par champ, sur le défaut. */
export const parseThemeSettings = (raw: unknown): ThemeSettings => {
  if (raw === null || typeof raw !== 'object') return THEME_DEFAULT;
  const value = raw as { choice?: unknown; eco?: unknown };
  return {
    choice: isChoice(value.choice) ? value.choice : THEME_DEFAULT.choice,
    eco: typeof value.eco === 'boolean' ? value.eco : THEME_DEFAULT.eco,
  };
};

/** Thème posé sur `<html>` : `data-theme` (clair ou sombre) et `data-eco`. */
export interface AppliedTheme {
  theme: 'light' | 'dark';
  eco: boolean;
}

/** Thème à poser : Économe impose le sombre ; Auto suit le système (`systemDark`). */
export const resolveTheme = (settings: ThemeSettings, systemDark: boolean): AppliedTheme => {
  if (settings.eco) return { theme: 'dark', eco: true };
  const dark = settings.choice === 'sombre' || (settings.choice === 'auto' && systemDark);
  return { theme: dark ? 'dark' : 'light', eco: false };
};

export const sameAppliedTheme = (a: AppliedTheme, b: AppliedTheme): boolean => a.theme === b.theme && a.eco === b.eco;
