import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';

/**
 * Une nuit (FC de nuit, lot 213) est un test, mais pas un test guidé : le guidage de la FC max ne s'arme pas,
 * aucun bip ni palier, rien dans la fiche.
 */

const recorder = vi.hoisted(() => ({
  state: { status: 'idle', activity: null as unknown, resuming: false, pausedReason: null },
  listeners: [] as (() => void)[],
  noted: [] as unknown[],
}));

vi.mock('./useRecorder', () => ({
  getRecorderState: () => recorder.state,
  subscribeToRecorder: (listener: () => void) => {
    recorder.listeners.push(listener);
    return () => {};
  },
  subscribeToFixes: () => () => {},
  getLiveSegments: () => [],
  getRecordedTest: () => null,
  noteFitnessTest: (test: unknown) => recorder.noted.push(test),
}));

const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const { getFitnessTestView, startFitnessTestGuide } = await import('./useFitnessTest');

const record = (activity: unknown) => {
  recorder.state = { ...recorder.state, status: 'recording', activity };
  recorder.listeners.forEach((listener) => listener());
};

const stop = () => {
  recorder.state = { ...recorder.state, status: 'idle', activity: null };
  recorder.listeners.forEach((listener) => listener());
};

describe('guidage des tests et FC de nuit', () => {
  it('une nuit ne lance pas le guidage ; un test de FC max, si', () => {
    startFitnessTestGuide();
    record(baseActivity('night-hr'));
    expect(getFitnessTestView().active).toBe(false);
    stop();
    record(baseActivity('run-test'));
    expect(getFitnessTestView().active).toBe(true);
    stop();
    expect(getFitnessTestView().active).toBe(false);
    // Aucun test noté pour la nuit (celui de la FC max, arrêté avant sa première position, n'a rien à noter non plus).
    expect(recorder.noted).toEqual([]);
  });
});
