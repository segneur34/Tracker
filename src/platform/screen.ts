import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { DARK_SCHEME_QUERY } from '../theme/theme';
import { isNativeApp } from './runtime';

/**
 * Écran allumé, orientation figée et thème clair ou sombre du téléphone : seul accès au verrou d'écran, à
 * l'orientation et au thème du système (règle 12). L'écran allumé
 * empêche la mise en veille automatique, pas le verrouillage par le bouton du téléphone.
 *
 * Sur le téléphone, le greffon maison `ScreenPlugin.java` pose ou retire
 * `FLAG_KEEP_SCREEN_ON` sur la fenêtre. Dans le navigateur, l'API Screen Wake
 * Lock, que le navigateur relâche quand la page est cachée : elle est
 * redemandée au retour. Sans l'API, rien ne se passe.
 */

interface ScreenPlugin {
  keepOn(options: { on: boolean }): Promise<void>;
  lockOrientation(options: { locked: boolean }): Promise<void>;
  isDarkMode(): Promise<{ dark: boolean }>;
  addListener(event: 'darkModeChange', listener: (data: { dark: boolean }) => void): Promise<PluginListenerHandle>;
}

const nativePlugin = registerPlugin<ScreenPlugin>('Screen');

let wanted = false;
let browserLock: WakeLockSentinel | null = null;

const requestBrowserLock = async (): Promise<void> => {
  if (!wanted || browserLock !== null || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!wanted) {
      void lock.release();
      return;
    }
    browserLock = lock;
    lock.addEventListener('release', () => { if (browserLock === lock) browserLock = null; });
  } catch {
    // Refusé (page cachée, économie d'énergie) : redemandé au prochain retour sur la page.
  }
};

const onVisibility = (): void => void requestBrowserLock();

/** Garde l'écran allumé, ou rend la main à la mise en veille. */
export const keepScreenOn = (on: boolean): void => {
  if (on === wanted) return;
  wanted = on;
  if (isNativeApp()) {
    void nativePlugin.keepOn({ on }).catch(() => undefined);
    return;
  }
  if (typeof document === 'undefined') return;
  if (on) {
    document.addEventListener('visibilitychange', onVisibility);
    void requestBrowserLock();
  } else {
    document.removeEventListener('visibilitychange', onVisibility);
    const lock = browserLock;
    browserLock = null;
    if (lock) void lock.release().catch(() => undefined);
  }
};

/**
 * Orientation figée (cadenas d'Enregistrer) : le greffon garde l'orientation du moment
 * (`SCREEN_ORIENTATION_LOCKED`), jusqu'à ce qu'on la libère ; l'application relancée repart libre. Sur le téléphone
 * seulement : le navigateur ne fige l'orientation qu'en plein écran.
 */
let orientationLocked = false;
const orientationListeners = new Set<() => void>();

/** Vrai là où l'orientation peut se figer. */
export const canLockOrientation = (): boolean => isNativeApp();

export const isOrientationLocked = (): boolean => orientationLocked;

/** Prévenu à chaque changement du cadenas ; rend la fonction qui désabonne. */
export const subscribeOrientationLock = (listener: () => void): (() => void) => {
  orientationListeners.add(listener);
  return () => { orientationListeners.delete(listener); };
};

/** Fige l'écran dans son orientation du moment, ou le rend libre de tourner. */
export const lockOrientation = (locked: boolean): void => {
  if (locked === orientationLocked || !canLockOrientation()) return;
  orientationLocked = locked;
  orientationListeners.forEach((listener) => listener());
  void nativePlugin.lockOrientation({ locked }).catch(() => undefined);
};

/**
 * Thème sombre du système, lu par « Auto » (`hooks/useTheme.ts`). Sur le téléphone, par le greffon : la WebView ne
 * réévalue pas toujours `prefers-color-scheme` quand le téléphone bascule (l'activité n'est pas recréée), le
 * greffon lit le thème du téléphone au démarrage puis prévient à chaque bascule, application ouverte ou reprise de
 * l'arrière-plan (`darkModeChange`). Tant que sa première réponse n'est pas arrivée, et dans le navigateur, par
 * `matchMedia`.
 */
let nativeDark: boolean | null = null;
let nativeDarkStarted = false;
const darkListeners = new Set<(dark: boolean) => void>();

/** Requête du thème sombre du navigateur ; `null` hors navigateur (tests). */
const browserDarkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_SCHEME_QUERY) : null;

/** Vrai si le système est en sombre : dernière valeur connue du greffon sur le téléphone, sinon celle du navigateur. */
export const systemPrefersDark = (): boolean =>
  isNativeApp() && nativeDark !== null ? nativeDark : (browserDarkQuery()?.matches ?? false);

const setNativeDark = (dark: boolean): void => {
  if (nativeDark === dark) return;
  nativeDark = dark;
  darkListeners.forEach((listener) => listener(dark));
};

/** Sur le téléphone, une seule fois : l'écoute du greffon, puis sa première lecture. */
const startNativeDark = (): void => {
  if (nativeDarkStarted) return;
  nativeDarkStarted = true;
  void nativePlugin.addListener('darkModeChange', ({ dark }) => setNativeDark(dark)).catch(() => undefined);
  void nativePlugin.isDarkMode().then(({ dark }) => setNativeDark(dark)).catch(() => undefined);
};

/** Prévenu quand le système passe du clair au sombre ou l'inverse ; rend la fonction qui désabonne. */
export const subscribeSystemDark = (listener: (dark: boolean) => void): (() => void) => {
  if (isNativeApp()) {
    darkListeners.add(listener);
    startNativeDark();
    return () => { darkListeners.delete(listener); };
  }
  const query = browserDarkQuery();
  if (!query) return () => undefined;
  const onChange = (event: MediaQueryListEvent): void => listener(event.matches);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
