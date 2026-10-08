import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Bips et vibrations : seul accès au son et au vibreur (règle 12). Deux
 * usages : le guidage vers les balises (`getBeeper`) et le compteur du
 * fractionné (`getIntervalClock`).
 *
 * Sur le téléphone, un greffon Android tient le rythme sur un fil à lui :
 * écran éteint, les minuteries de la WebView sont bridées (point 40), pas
 * celles d'Android. Pour les balises, le service GPS de l'enregistrement
 * garde le processeur éveillé ; le compteur a son propre service au premier
 * plan, qui tourne sans GPS. Le son passe par le flux des alarmes : audible
 * téléphone en silencieux, au volume des alarmes. Dans le navigateur, Web
 * Audio et `navigator.vibrate` le remplacent, pour éprouver l'un et l'autre
 * au banc ; chaque son y est consigné en `console.debug` (« [bips] … »).
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
/** Long double, la fin d'une séance du compteur. */
export const BEEP_FINAL_MS = 1600;

/** Un son du compteur, après `delayMs` : court, long, ou le long double de la fin de séance. */
export interface ClockTone {
  delayMs: number;
  tone: 'court' | 'long' | 'final';
}

/** Un changement de phase du compteur, pour sa notification : son nom, et le temps qu'elle durera (0 : sans décompte). */
export interface ClockCue {
  delayMs: number;
  title: string;
  phaseMs: number;
}

/** Programme du compteur, à partir de maintenant. */
export interface ClockPlan {
  tones: ClockTone[];
  cues: ClockCue[];
  /** Fin d'elle-même après ce délai, en millisecondes (fin de séance) ; 0 : jamais (pause). */
  stopAfterMs: number;
}

export interface IntervalClock {
  /**
   * Remplace le programme en cours. Sur le téléphone, un service au premier
   * plan le joue, écran éteint, et le dit dans sa notification.
   */
  schedule(plan: ClockPlan, vibrate: boolean): Promise<void>;
  /** Silence, plus de notification. */
  stop(): Promise<void>;
}

/** Greffon maison, `android/app/src/main/java/io/github/segneur/tracker/BeeperPlugin.java`. */
interface BeeperPlugin {
  setInterval(options: { intervalMs: number | null; vibrate: boolean }): Promise<void>;
  validated(options: { vibrate: boolean }): Promise<void>;
  finished(options: { vibrate: boolean }): Promise<void>;
  stop(): Promise<void>;
  scheduleIntervals(options: ClockPlan & { vibrate: boolean }): Promise<void>;
  stopIntervals(): Promise<void>;
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

/** Contexte audio du navigateur, partagé par les bips et le compteur. */
let browserAudio: AudioContext | null = null;

/** Un son du navigateur, consigné pour le banc. */
const browserTone = (durationMs: number, vibrate: boolean, label: string) => {
  console.debug(`[bips] ${label} ${durationMs} ms à ${Date.now()}`);
  if (vibrate && typeof navigator.vibrate === 'function') navigator.vibrate(durationMs);
  try {
    browserAudio ??= new AudioContext();
    const start = browserAudio.currentTime;
    const oscillator = browserAudio.createOscillator();
    const gain = browserAudio.createGain();
    oscillator.frequency.value = TONE_HZ;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.setValueAtTime(0, start + durationMs / 1000);
    oscillator.connect(gain).connect(browserAudio.destination);
    oscillator.start(start);
    oscillator.stop(start + durationMs / 1000 + 0.05);
  } catch {
    // Pas de son dans ce navigateur : le journal suffit au banc.
  }
};

const createBrowserBeeper = (): Beeper => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let intervalMs: number | null = null;
  let vibrateOn = false;
  let lastBeepMs = -Infinity;

  const tone = browserTone;

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
      await browserAudio?.close().catch(() => {});
      browserAudio = null;
    },
  };
};

let beeper: Beeper | null = null;

/** Bips du téléphone, ou du navigateur. */
export const getBeeper = (): Beeper => {
  beeper ??= isNativeApp() ? nativeBeeper : createBrowserBeeper();
  return beeper;
};

const nativeIntervalClock: IntervalClock = {
  schedule: (plan, vibrate) => nativePlugin.scheduleIntervals({ ...plan, vibrate }),
  stop: () => nativePlugin.stopIntervals(),
};

/**
 * Compteur du navigateur : des minuteries, bridées écran éteint, mais le
 * banc les suit. Un son dû tout de suite part dans l'appel même, donc dans
 * le geste qui l'a lancé, sans quoi le navigateur peut le taire.
 */
const createBrowserIntervalClock = (): IntervalClock => {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  return {
    schedule: async (plan, vibrate) => {
      clear();
      const durations = { court: BEEP_SHORT_MS, long: BEEP_LONG_MS, final: BEEP_FINAL_MS };
      const play = (tone: ClockTone['tone']) => browserTone(durations[tone], vibrate, tone);
      // Les minuteries d'abord : le premier son ouvre le contexte audio, ce qui prend un moment.
      for (const t of plan.tones) if (t.delayMs > 0) timers.push(setTimeout(() => play(t.tone), t.delayMs));
      for (const c of plan.cues) {
        timers.push(setTimeout(() => console.debug(`[compteur] ${c.title} à ${Date.now()}`), Math.max(0, c.delayMs)));
      }
      for (const t of plan.tones) if (t.delayMs <= 0) play(t.tone);
    },
    stop: async () => clear(),
  };
};

let intervalClock: IntervalClock | null = null;

/** Compteur du fractionné, sur le téléphone ou dans le navigateur. */
export const getIntervalClock = (): IntervalClock => {
  intervalClock ??= isNativeApp() ? nativeIntervalClock : createBrowserIntervalClock();
  return intervalClock;
};
