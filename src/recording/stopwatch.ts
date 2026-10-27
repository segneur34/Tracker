/**
 * Chronomètre libre de la carte du compteur (lot 2 des demandes du
 * 10-14/10) : départ, tours, pause, reprise. Comme le compteur
 * (`intervalTimer.ts`), il ne garde que l'instant du départ et ses commandes,
 * et son état se recalcule depuis l'horloge : juste après une mise en
 * arrière-plan ou un écran éteint. La remise à zéro l'efface, sans commande.
 */

import { formatMinSecHours } from '../core/units';

export type StopwatchCommand = 'lap' | 'pause' | 'resume';

export interface Stopwatch {
  /** Instant du départ, en ms. */
  startedAtMs: number;
  /** Commandes acceptées, dans l'ordre. */
  commands: { kind: StopwatchCommand; atMs: number }[];
}

export interface StopwatchLap {
  /** Numéro du tour, à partir de 1. */
  n: number;
  /** Durée du tour, pauses ôtées, en ms. */
  lapMs: number;
  /** Temps cumulé à la fin du tour, en ms. */
  totalMs: number;
}

export interface StopwatchState {
  status: 'running' | 'paused';
  /** Temps de marche depuis le départ, pauses ôtées, en ms. */
  elapsedMs: number;
  /** Tours pris, dans l'ordre. */
  laps: StopwatchLap[];
  /** Temps du tour en cours, en ms. */
  currentLapMs: number;
}

export const startStopwatch = (nowMs: number): Stopwatch => ({ startedAtMs: nowMs, commands: [] });

/** État du chrono à l'instant `nowMs` ; les commandes postérieures sont ignorées. */
export const stopwatchState = (sw: Stopwatch, nowMs: number): StopwatchState => {
  let elapsedMs = 0;
  let t = sw.startedAtMs;
  let running = true;
  const laps: StopwatchLap[] = [];
  const advance = (to: number) => {
    if (running && to > t) elapsedMs += to - t;
    t = Math.max(t, to);
  };
  for (const command of sw.commands) {
    if (command.atMs > nowMs) break;
    advance(command.atMs);
    if (command.kind === 'pause') running = false;
    else if (command.kind === 'resume') running = true;
    else {
      const previous = laps.length > 0 ? laps[laps.length - 1].totalMs : 0;
      laps.push({ n: laps.length + 1, lapMs: elapsedMs - previous, totalMs: elapsedMs });
    }
  }
  advance(nowMs);
  const lastTotal = laps.length > 0 ? laps[laps.length - 1].totalMs : 0;
  return { status: running ? 'running' : 'paused', elapsedMs, laps, currentLapMs: elapsedMs - lastTotal };
};

/**
 * Chrono après une commande, à l'instant `nowMs` ; inchangé si elle n'a pas
 * de sens (tour ou pause à l'arrêt, reprise en marche, instant passé).
 */
export const stopwatchCommand = (sw: Stopwatch, kind: StopwatchCommand, nowMs: number): Stopwatch => {
  const last = sw.commands.length > 0 ? sw.commands[sw.commands.length - 1].atMs : sw.startedAtMs;
  if (nowMs < last) return sw;
  const { status } = stopwatchState(sw, nowMs);
  const allowed = kind === 'resume' ? status === 'paused' : status === 'running';
  return allowed ? { ...sw, commands: [...sw.commands, { kind, atMs: nowMs }] } : sw;
};

/** Chrono relu de l'appareil ; `null` si la valeur est absente ou abîmée. */
export const readStopwatch = (value: unknown): Stopwatch | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { startedAtMs, commands } = value as Record<string, unknown>;
  if (typeof startedAtMs !== 'number' || !isFinite(startedAtMs) || !Array.isArray(commands)) return null;
  const kinds: StopwatchCommand[] = ['lap', 'pause', 'resume'];
  const kept = commands.filter((c): c is Stopwatch['commands'][number] => {
    if (typeof c !== 'object' || c === null) return false;
    const { kind, atMs } = c as Record<string, unknown>;
    return kinds.includes(kind as StopwatchCommand) && typeof atMs === 'number' && isFinite(atMs);
  });
  return { startedAtMs, commands: kept.map(({ kind, atMs }) => ({ kind, atMs })) };
};

/** Temps du chrono, au dixième : « 1:23.4 », « 1:02:03.4 » au-delà d'une heure. */
export const formatStopwatch = (ms: number): string => {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  return formatMinSecHours(Math.floor(tenths / 10), `.${tenths % 10}`);
};
