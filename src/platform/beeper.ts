import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Bips et vibrations du guidage vers les balises : seul accès au son et au
 * vibreur (règle 12).
 *
 * Sur le téléphone, un greffon Android tient le rythme sur un fil à lui :
 * écran éteint, les minuteries de la WebView sont bridées (point 40), pas
 * celles d'Android, et le service GPS de l'enregistrement garde le
 * processeur éveillé. Le son passe par le flux des alarmes : audible
 * téléphone en silencieux, au volume des alarmes. Dans le navigateur, Web
 * Audio et `navigator.vibrate` le remplacent, pour éprouver le guidage au
 * banc ; chaque son y est consigné en `console.debug` (« [bips] … »).
 */

export interface Beeper {
  /**
   * Bips répétés toutes les `intervalMs` ; `null` : silence. Le rythme
   * change dès le bip suivant ; un intervalle plus court que le temps déjà
   * écoulé depuis le dernier bip en déclenche un tout de suite.
   */
  setInterval(intervalMs: number | null, vibrate: boolean): Promise<void>;
  /** Bip long : une balise vient d'être validée. Les bips répétés s'arrêtent. */
  validated(vibrate: boolean): Promise<void>;
  /** Trois bips longs : le parcours est fini. Les bips répétés s'arrêtent. */
  finished(vibrate: boolean): Promise<void>;
  /** Silence, ressources libérées. */
  stop(): Promise<void>;
}

/** Durées des sons, en millisecondes : bip d'approche, bip de validation, et pause entre les trois bips de fin. */
export const BEEP_SHORT_MS = 120;
export const BEEP_LONG_MS = 800;
export const BEEP_FINISH_GAP_MS = 250;

/** Greffon maison, `android/app/src/main/java/io/github/segneur/tracker/BeeperPlugin.java`. */
interface BeeperPlugin {
  setInterval(options: { intervalMs: number | null; vibrate: boolean }): Promise<void>;
  validated(options: { vibrate: boolean }): Promise<void>;
  finished(options: { vibrate: boolean }): Promise<void>;
  stop(): Promise<void>;
}

const nativePlugin = registerPlugin<BeeperPlugin>('Beeper');

const nativeBeeper: Beeper = {
  setInterval: (intervalMs, vibrate) => nativePlugin.setInterval({ intervalMs, vibrate }),
  validated: (vibrate) => nativePlugin.validated({ vibrate }),
  finished: (vibrate) => nativePlugin.finished({ vibrate }),
  stop: () => nativePlugin.stop(),
};

/** Hauteur des bips du navigateur, en hertz. */
const TONE_HZ = 880;

const createBrowserBeeper = (): Beeper => {
  let audio: AudioContext | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let intervalMs: number | null = null;
  let vibrateOn = false;
  let lastBeepMs = -Infinity;

  const tone = (durationMs: number, vibrate: boolean, label: string) => {
    console.debug(`[bips] ${label} ${durationMs} ms à ${Date.now()}`);
    if (vibrate && typeof navigator.vibrate === 'function') navigator.vibrate(durationMs);
    try {
      audio ??= new AudioContext();
      const start = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = TONE_HZ;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.setValueAtTime(0, start + durationMs / 1000);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + durationMs / 1000 + 0.05);
    } catch {
      // Pas de son dans ce navigateur : le journal suffit au banc.
    }
  };

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const loop = () => {
    if (intervalMs === null) return;
    tone(BEEP_SHORT_MS, vibrateOn, 'court');
    lastBeepMs = Date.now();
    timer = setTimeout(loop, intervalMs);
  };

  return {
    setInterval: async (next, vibrate) => {
      vibrateOn = vibrate;
      if (next === intervalMs) return;
      intervalMs = next;
      clear();
      if (next === null) return;
      timer = setTimeout(loop, Math.max(0, lastBeepMs + next - Date.now()));
    },
    validated: async (vibrate) => {
      intervalMs = null;
      clear();
      tone(BEEP_LONG_MS, vibrate, 'long');
      // Le bip suivant attend la fin du bip long.
      lastBeepMs = Date.now() + BEEP_LONG_MS;
    },
    finished: async (vibrate) => {
      intervalMs = null;
      clear();
      for (let k = 0; k < 3; k++) {
        const at = k * (BEEP_LONG_MS + BEEP_FINISH_GAP_MS);
        setTimeout(() => tone(BEEP_LONG_MS, vibrate, 'fin'), at);
      }
      lastBeepMs = Date.now() + 3 * BEEP_LONG_MS + 2 * BEEP_FINISH_GAP_MS;
    },
    stop: async () => {
      intervalMs = null;
      clear();
      await audio?.close().catch(() => {});
      audio = null;
    },
  };
};

let beeper: Beeper | null = null;

/** Bips du téléphone, ou du navigateur. */
export const getBeeper = (): Beeper => {
  beeper ??= isNativeApp() ? nativeBeeper : createBrowserBeeper();
  return beeper;
};
