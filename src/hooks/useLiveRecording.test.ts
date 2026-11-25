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

/** Calcul du direct qui lève à la demande, comme une erreur du calcul sur une trace inattendue. */
const failing = vi.hoisted(() => ({ on: false }));
vi.mock('../recording/liveStats', async (importOriginal) => {
  const original = await importOriginal<typeof import('../recording/liveStats')>();
  return {
    ...original,
    computeLiveStats: (...args: Parameters<typeof original.computeLiveStats>) => {
      if (failing.on) throw new Error('calcul en panne');
      return original.computeLiveStats(...args);
    },
  };
});

// Une page qui lit le direct : sans rendu, seul son abonnement compte ici.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, get: () => unknown) => {
    subscribe(() => {});
    return get();
  },
}));

/**
 * Le module du direct garde un état à lui (heure du dernier calcul, différé, abonnés) : chaque test en charge un
 * exemplaire neuf et repart d'un enregistreur vide, pour ne dépendre ni de l'ordre ni de l'heure du test d'avant
 * (ordre mélangé de la vérification : un test joué à une heure plus tardive figeait le suivant).
 */
const loadLive = async () => {
  vi.resetModules();
  recorder.state.stats = { pointCount: 0 };
  recorder.segments = [[]];
  recorder.listeners = [];
  return import('./useLiveRecording');
};

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
    const { getLiveRecording, startLiveRecording, subscribeToLiveRecording, useLiveRecording } = await loadLive();
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

describe('direct de la FC de nuit (lot 213)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 3_600_000);
    recorder.state.activity = baseActivity('night-hr');
  });
  afterEach(() => vi.useRealTimers());

  it('une mesure par seconde, page ouverte : un recalcul toutes les 30 s au plus, pas à chaque mesure', async () => {
    const start = T0 + 3_600_000;
    const { startLiveRecording, subscribeToLiveRecording, useLiveRecording } = await loadLive();
    startLiveRecording();
    useLiveRecording();
    await vi.advanceTimersByTimeAsync(0);
    let published = 0;
    subscribeToLiveRecording(() => { published += 1; });
    for (let s = 0; s < 120; s++) {
      addFix(start + s * 1000);
      await vi.advanceTimersByTimeAsync(0);
    }
    // 2 min de mesures : au départ, puis à 30, 60 et 90 s (pas 120 recalculs, ni 60 au rythme de la page).
    expect(published).toBe(4);
  });
});

describe('direct de l’enregistrement : calcul en erreur (lot 232)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    recorder.state.activity = baseActivity('running');
    failing.on = false;
  });
  afterEach(() => {
    failing.on = false;
    vi.useRealTimers();
  });

  it("une erreur du calcul ne remonte pas jusqu'à l'enregistreur et garde les derniers chiffres", async () => {
    const { getLiveRecording, startLiveRecording } = await loadLive();
    startLiveRecording();
    addFix(T0 + 200_000);
    const before = getLiveRecording();
    const beforeStats = JSON.stringify(before.stats);
    expect(before.updatedMs).toBe(T0 + 200_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failing.on = true;
    try {
      expect(() => addFix(T0 + 300_000)).not.toThrow();
      expect(getLiveRecording()).toBe(before);
      expect(JSON.stringify(getLiveRecording().stats)).toBe(beforeStats);
    } finally {
      failing.on = false;
      warn.mockRestore();
    }
    addFix(T0 + 400_000);
    expect(getLiveRecording().updatedMs).toBe(T0 + 400_000);
    expect(JSON.stringify(getLiveRecording().stats)).not.toBe(beforeStats);
  });
});
