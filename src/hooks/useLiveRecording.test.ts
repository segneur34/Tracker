import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix } from '../platform/location';

/** État de l'enregistreur, tenu par le test. */
const recorder = vi.hoisted(() => ({
  state: { status: 'recording', activity: null as unknown, stats: { pointCount: 0 } },
  segments: [[]] as unknown[][],
  listeners: [] as (() => void)[],
}));

vi.mock('./useRecorder', () => ({
  getRecorderState: () => recorder.state,
  getLiveSegments: () => recorder.segments,
  getLiveHeartSegments: () => [],
  subscribeToRecorder: (listener: () => void) => {
    recorder.listeners.push(listener);
    return () => {};
  },
}));

// Une page qui lit le direct : sans rendu, seul son abonnement compte ici.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, get: () => unknown) => {
    subscribe(() => {});
    return get();
  },
}));

const { getLiveRecording, startLiveRecording, subscribeToLiveRecording, useLiveRecording } = await import('./useLiveRecording');

const T0 = Date.UTC(2026, 10, 4, 14, 0, 0);

const addFix = (nowMs: number) => {
  vi.setSystemTime(nowMs);
  const n = recorder.state.stats.pointCount;
  const fix: LocationFix = { timeMs: nowMs, lat: 43.6 + n * 1e-4, lon: 3.3, speedMs: 3 } as LocationFix;
  recorder.segments[0].push(fix);
  recorder.state.stats = { pointCount: n + 1 };
  recorder.listeners.forEach((listener) => listener());
};

describe('direct de l’enregistrement, écran éteint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    recorder.state.activity = baseActivity('running');
  });
  afterEach(() => vi.useRealTimers());

  it('avance à l’arrivée des positions même si son différé ne part plus : la notification en dépend', async () => {
    startLiveRecording();
    useLiveRecording();
    await vi.advanceTimersByTimeAsync(0);
    let published = 0;
    subscribeToLiveRecording(() => { published += 1; });

    addFix(T0);
    expect(published).toBe(1);
    // Moins de 2 s après le calcul : un différé part, qui reste gelé page cachée (l'horloge avance, pas les minuteries).
    addFix(T0 + 1000);
    expect(vi.getTimerCount()).toBe(1);
    expect(published).toBe(1);

    addFix(T0 + 60_000);
    expect(published).toBe(2);
    expect(getLiveRecording().updatedMs).toBe(T0 + 60_000);
    expect(vi.getTimerCount()).toBe(0);
    addFix(T0 + 120_000);
    expect(published).toBe(3);
  });
});
