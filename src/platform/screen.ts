import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Écran allumé : seul accès au verrou d'écran (règle 12). Il empêche la mise
 * en veille automatique, pas le verrouillage par le bouton du téléphone.
 *
 * Sur le téléphone, le greffon maison `ScreenPlugin.java` pose ou retire
 * `FLAG_KEEP_SCREEN_ON` sur la fenêtre. Dans le navigateur, l'API Screen Wake
 * Lock, que le navigateur relâche quand la page est cachée : elle est
 * redemandée au retour. Sans l'API, rien ne se passe.
 */

interface ScreenPlugin {
  keepOn(options: { on: boolean }): Promise<void>;
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
