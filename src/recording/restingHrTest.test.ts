import { describe, expect, it } from 'vitest';
import {
  RESTING_HR_TEST as P, RESTING_SIGNAL_TONES, advanceRestingTest, exampleRestingHr, restingEndMs, restingRemainingS, startRestingTest,
} from './restingHrTest';

const T0 = 5_000_000;

describe('déroulé du test de FC repos', () => {
  it('commence en préparation, sans signal', () => {
    const state = startRestingTest(T0);
    expect(state.phase).toBe('preparation');
    expect(state.startMs).toBe(T0 + P.leadInS * 1000);
    expect(restingRemainingS(state, T0)).toBe(P.leadInS);
  });

  it('le bip de départ vient à la fin de la préparation, celui de la fin 3 min plus tard', () => {
    let state = startRestingTest(T0);
    const signals: [number, string][] = [];
    for (let t = 0; t <= P.leadInS + P.durationS + 5; t++) {
      const step = advanceRestingTest(state, T0 + t * 1000, { timeMs: T0 + t * 1000, bpm: 60 });
      state = step.state;
      step.signals.forEach((s) => signals.push([t, s]));
    }
    expect(signals).toEqual([[P.leadInS, 'debut'], [P.leadInS + P.durationS, 'fin']]);
    expect(state.phase).toBe('fini');
  });

  it('un test fini ne change plus', () => {
    let state = startRestingTest(T0);
    state = advanceRestingTest(state, restingEndMs(state)).state;
    expect(state.phase).toBe('fini');
    const again = advanceRestingTest(state, restingEndMs(state) + 60_000, { timeMs: restingEndMs(state) + 60_000, bpm: 50 });
    expect(again.state).toBe(state);
    expect(again.signals).toEqual([]);
  });

  it("un écran rendu après le départ, voire la fin, joue les deux signaux dans l'ordre", () => {
    const state = startRestingTest(T0);
    const step = advanceRestingTest(state, restingEndMs(state) + 1000);
    expect(step.signals).toEqual(['debut', 'fin']);
    expect(step.state.phase).toBe('fini');
  });

  it("le temps restant suit la phase", () => {
    const state = startRestingTest(T0);
    expect(restingRemainingS(state, T0 + 4000)).toBe(P.leadInS - 4);
    const running = advanceRestingTest(state, state.startMs + 30_000).state;
    expect(running.phase).toBe('mesure');
    expect(restingRemainingS(running, state.startMs + 30_000)).toBe(P.durationS - 30);
    expect(restingRemainingS(running, state.startMs + 10 * P.durationS * 1000)).toBe(0);
  });

  it("garde les mesures reçues, sans modifier l'état reçu", () => {
    const state = startRestingTest(T0);
    const next = advanceRestingTest(state, T0 + 1000, { timeMs: T0 + 1000, bpm: 61 }).state;
    expect(state.samples).toHaveLength(0);
    expect(next.samples).toEqual([{ timeMs: T0 + 1000, bpm: 61 }]);
  });
});

describe('sons et exemple', () => {
  it('un court au départ, un long à la fin', () => {
    expect(RESTING_SIGNAL_TONES.debut.map((t) => t.tone)).toEqual(['court']);
    expect(RESTING_SIGNAL_TONES.fin.map((t) => t.tone)).toEqual(['long']);
  });

  it("la FC d'exemple descend vers le repos et reste dans les bornes du protocole", () => {
    expect(exampleRestingHr(0)).toBeGreaterThan(exampleRestingHr(120));
    for (let t = 0; t < P.durationS; t++) {
      const v = exampleRestingHr(t);
      expect(v).toBeGreaterThanOrEqual(P.minBpm);
      expect(v).toBeLessThanOrEqual(P.maxBpm);
    }
  });
});

describe('sons du test de FC repos', () => {
  it('reprennent le départ et la fin des tests guidés, tels qu’avant', () => {
    expect(RESTING_SIGNAL_TONES).toEqual({ debut: [{ delayMs: 0, tone: 'court' }], fin: [{ delayMs: 0, tone: 'long' }] });
  });
});
