import { useCallback, useSyncExternalStore } from 'react';
import { shadeForTheme } from '../core/activities';
import { systemPrefersDark, subscribeSystemDark } from '../platform/screen';
import { jsonStore } from '../platform/storage';
import { setSystemBarsDark } from '../platform/systemBars';
import {
  THEME_STORAGE_KEY, parseThemeSettings, resolveTheme, sameAppliedTheme, type AppliedTheme, type ThemeSettings,
} from '../theme/theme';
import { createListeners } from './createStore';

/**
 * Thème de l'interface, réglé par appareil dans Réglages › Affichage
 * (`theme/theme.ts`) : seul endroit qui le pose sur `<html>` (`data-theme`,
 * `data-eco`, lus par `theme/tokens.css`), règle la couleur de la barre du
 * navigateur et les icônes des barres du téléphone, et suit le réglage du
 * système pour « Auto » (`platform/screen.ts` : greffon sur le téléphone,
 * `matchMedia` dans le navigateur). `startTheme` le pose avant le premier
 * rendu (`main.tsx`), puis le suit : réglage changé, thème du téléphone
 * changé, application ouverte ou reprise de l'arrière-plan.
 */

/** Dernière lecture : le même objet tant que la valeur stockée ne change pas (`useSyncExternalStore`). */
let lastRead: { raw: unknown; settings: ThemeSettings } | null = null;

const readSettings = (): ThemeSettings => {
  const raw = jsonStore.read<unknown>(THEME_STORAGE_KEY);
  if (lastRead && lastRead.raw === raw) return lastRead.settings;
  lastRead = { raw, settings: parseThemeSettings(raw) };
  return lastRead.settings;
};

let applied: AppliedTheme = { theme: 'light', eco: false };
const listeners = createListeners();
let started = false;

/** Couleur de la barre du navigateur (`<meta name="theme-color">`) : le fond de la page du thème posé. */
const updateThemeColor = (): void => {
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
};

/** Pose le thème du réglage et du système sur `<html>` ; prévient les abonnés s'il change. */
const apply = (force = false): void => {
  if (typeof document === 'undefined') return;
  const next = resolveTheme(readSettings(), systemPrefersDark());
  if (!force && sameAppliedTheme(next, applied)) return;
  applied = next;
  const root = document.documentElement;
  root.dataset.theme = next.theme;
  if (next.eco) root.dataset.eco = '';
  else delete root.dataset.eco;
  updateThemeColor();
  setSystemBarsDark(next.theme === 'dark');
  listeners.notify();
};

/**
 * Pose le thème tout de suite, de façon synchrone, puis le suit. À appeler
 * avant le premier rendu, et de nouveau une fois le stockage du téléphone
 * chargé (`initStorage`), qui peut porter un autre réglage : le second appel
 * ne fait que reposer le thème (barres du téléphone comprises).
 */
export const startTheme = (): void => {
  apply(true);
  if (started) return;
  started = true;
  subscribeSystemDark(() => apply());
  jsonStore.subscribe((key) => {
    if (key === THEME_STORAGE_KEY) apply();
  });
};

/** Thème posé (clair ou sombre, économe ou non), suivi en direct : pour ce qui se dessine en JavaScript (racine du Profil). */
export const useAppliedTheme = (): AppliedTheme => useSyncExternalStore(listeners.subscribe, () => applied);

/** Couleur d'activité à afficher selon le thème posé (`shadeForTheme`) ; la fiche garde la couleur claire. */
export const useThemedShade = (): ((color: string) => string) => {
  const dark = useAppliedTheme().theme === 'dark';
  return useCallback((color: string) => shadeForTheme(color, dark), [dark]);
};

/** Réglage de l'appareil (Réglages › Affichage) et son changement, champ par champ. */
export const useThemeSettings = (): [ThemeSettings, (patch: Partial<ThemeSettings>) => void] => {
  const settings = useSyncExternalStore(jsonStore.subscribe, readSettings);
  const update = useCallback((patch: Partial<ThemeSettings>) => {
    jsonStore.write(THEME_STORAGE_KEY, { ...readSettings(), ...patch } satisfies ThemeSettings);
  }, []);
  return [settings, update];
};
