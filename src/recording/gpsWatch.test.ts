import { describe, expect, it } from 'vitest';
import { DEFAULT_RECORDING } from '../core/sportProfiles';
import {
  START_GPS_WATCH, gpsWatchOnExpired, gpsWatchOnFix, gpsWatchOnPause, gpsWatchOnResume, watchesGps,
  type GpsWatchState, type GpsWatchStep,
} from './gpsWatch';

const settings = { gpsLostDelayS: 60, gpsLostRearmS: 120 };
const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

/**
 * Veille simulée avec son minuteur : les positions et l'horloge avancent, le
 * minuteur échoit quand l'horloge passe son échéance. Relève les signaux et
 * les effacements, en secondes depuis T0.
 */
const simulate = () => {
  let state: GpsWatchState = START_GPS_WATCH;
  let timerAtMs: number | null = null;
  const lost: number[] = [];
  const cleared: number[] = [];
  const arms: number[] = [];
  const apply = (s: GpsWatchStep, nowMs: number) => {
    state = s.state;
    if (s.disarm) timerAtMs = null;
    if (s.armMs !== null) {
      timerAtMs = nowMs + s.armMs;
      arms.push((nowMs - T0) / 1000);
    }
    if (s.lost) lost.push((nowMs - T0) / 1000);
    if (s.cleared) cleared.push((nowMs - T0) / 1000);
  };
  /** Avance l'horloge jusqu'à `ms`, le minuteur échu en route. */
  const advance = (ms: number) => {
    if (timerAtMs !== null && timerAtMs <= ms) {
      const due = timerAtMs;
      timerAtMs = null;
      apply(gpsWatchOnExpired(state, due), due);
    }
  };
  return {
    lost, cleared, arms,
    get state() { return state; },
    /** Positions de `from` à `to` secondes (exclu), une toutes les `stepS`. */
    fixes: (from: number, to: number, stepS = 1) => {
      for (let k = 0; from + k * stepS < to - 1e-9; k++) {
        const ms = at(from + k * stepS);
        advance(ms);
        apply(gpsWatchOnFix(state, ms, settings), ms);
      }
    },
    until: (s: number) => advance(at(s)),
    pause: (s: number) => {
      advance(at(s));
      apply(gpsWatchOnPause(state), at(s));
    },
    resume: (s: number) => {
      advance(at(s));
      apply(gpsWatchOnResume(state, at(s), settings), at(s));
    },
  };
};

describe('veille du GPS', () => {
  it('perdu après 1 min sans position, pas à 59 s', () => {
    const w = simulate();
    w.fixes(0, 21);
    w.until(20 + 59);
    expect(w.lost).toEqual([]);
    w.until(20 + 61);
    expect(w.lost).toEqual([80]);
    expect(w.state.phase).toBe('lost');
  });

  it('un trou de 59 s ne dit rien', () => {
    const w = simulate();
    w.fixes(0, 21);
    w.fixes(79, 100);
    w.until(100);
    expect(w.lost).toEqual([]);
  });

  it('un seul signal par perte, aucun rappel', () => {
    const w = simulate();
    w.fixes(0, 21);
    w.until(20 + 600);
    expect(w.lost).toEqual([80]);
  });

  it("effacé au retour ; un trou de 30 s pendant le réarmement est muet ; nouveau signal après 2 min de retour puis 1 min sans position", () => {
    const w = simulate();
    w.fixes(0, 21);
    w.fixes(110, 141);
    expect(w.cleared).toEqual([110]);
    expect(w.state.phase).toBe('rearming');
    // Trou de 30 s : ni minuteur, ni signal.
    w.fixes(170, 231);
    expect(w.lost).toEqual([80]);
    // Réarmé à la première position 2 min après le retour (110 + 120 = 230).
    expect(w.arms.at(-1)).toBe(230);
    expect(w.state.phase).toBe('watching');
    w.fixes(231, 241);
    w.until(240 + 59);
    expect(w.lost).toEqual([80]);
    w.until(240 + 61);
    expect(w.lost).toEqual([80, 300]);
  });

  it('pendant le réarmement, un trou d’1 min recommence le retour à zéro', () => {
    const w = simulate();
    w.fixes(0, 21);
    w.fixes(110, 151);
    // Trou de 70 s, puis retour : le réarmement compte depuis 220.
    w.fixes(220, 400);
    expect(w.lost).toEqual([80]);
    expect(w.arms.filter((s) => s > 110)[0]).toBe(340);
  });

  it("rien avant la première position", () => {
    const w = simulate();
    w.until(600);
    expect(w.lost).toEqual([]);
    expect(w.arms).toEqual([]);
    expect(w.state.phase).toBe('waiting');
  });

  it('pause manuelle muette, reprise réarmée', () => {
    const w = simulate();
    w.fixes(0, 21);
    w.pause(25);
    w.until(25 + 300);
    expect(w.lost).toEqual([]);
    w.resume(400);
    w.until(400 + 59);
    expect(w.lost).toEqual([]);
    w.until(400 + 61);
    expect(w.lost).toEqual([460]);
  });

  it('une pause pendant une perte efface l’alerte, sans nouveau signal à la reprise tant que le GPS n’est pas revenu', () => {
    const w = simulate();
    w.fixes(0, 21);
    w.until(90);
    w.pause(100);
    expect(w.cleared).toEqual([100]);
    w.resume(110);
    w.until(600);
    expect(w.lost).toEqual([80]);
  });

  it('une trace à 5 Hz donne le même résultat qu’à 1 Hz', () => {
    const run = (stepS: number) => {
      const w = simulate();
      w.fixes(0, 20.1, stepS);
      w.until(150);
      w.fixes(150, 400.1, stepS);
      w.until(700);
      return { lost: w.lost, cleared: w.cleared };
    };
    expect(run(0.2)).toEqual(run(1));
    expect(run(1).lost).toEqual([80, 460]);
  });

  it('une échéance périmée est ignorée', () => {
    let state = gpsWatchOnFix(START_GPS_WATCH, at(0), settings).state;
    state = gpsWatchOnFix(state, at(30), settings).state;
    // L'échéance de la position à 0 s arrive après que celle de 30 s l'a repoussée.
    const stale = gpsWatchOnExpired(state, at(60));
    expect(stale.lost).toBe(false);
    expect(stale.state.phase).toBe('watching');
    expect(gpsWatchOnExpired(state, at(90)).lost).toBe(true);
  });

  it('muette sans position ou avec un filtre de distance', () => {
    expect(watchesGps(DEFAULT_RECORDING, true)).toBe(true);
    expect(watchesGps(DEFAULT_RECORDING, false)).toBe(false);
    expect(watchesGps({ distanceFilterM: 5 }, true)).toBe(false);
  });
});
