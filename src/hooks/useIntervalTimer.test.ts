import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix, LocationSource } from '../platform/location';
import { seriesWithin, type IntervalWorkout } from '../recording/intervalTimer';
import { parseJournal } from '../recording/journal';

/** Journal en mémoire. */
const journal = vi.hoisted(() => {
  const file = {
    text: null as string | null,
    read: async () => file.text,
    write: async (text: string) => {
      file.text = text;
    },
    append: async (text: string) => {
      file.text = (file.text ?? '') + text;
    },
    remove: async () => {
      file.text = null;
    },
  };
  return file;
});
vi.mock('../platform/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/files')>()),
  recordingJournal: journal,
}));

/** Horloge du compteur simulée : programmes confiés et arrêts relevés ; veille du GPS sans effet. */
const clock = vi.hoisted(() => ({ schedules: 0, stops: 0 }));
vi.mock('../platform/beeper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/beeper')>()),
  getIntervalClock: () => ({
    schedule: async () => {
      clock.schedules += 1;
    },
    stop: async () => {
      clock.stops += 1;
    },
  }),
  armGpsWatch: async () => undefined,
  disarmGpsWatch: async () => undefined,
  onGpsLost: () => () => undefined,
}));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
});

const recorder = await import('./useRecorder');
const timer = await import('./useIntervalTimer');

const T0 = Date.UTC(2026, 10, 3, 9, 0, 0);
const activity = baseActivity('run-intervals');
/** 3 s de départ, puis 2 × 10 s, 5 s de repos : 28 s en tout. */
const FIRST: IntervalWorkout = { reps: 2, workS: 10, restS: 5 };
/** Créée « sur le pouce » : 3 s de départ, puis 1 × 20 s. */
const SECOND: IntervalWorkout = { reps: 1, workS: 20, restS: 0 };

/** Source simulée : émet à la demande, à l'heure de la trace. */
const fakeSource = () => {
  let onFix: ((fix: LocationFix) => void) | null = null;
  const source = {
    label: 'Simulée',
    start: async (_options: unknown, fix: (f: LocationFix) => void) => {
      onFix = fix;
      return async () => {
        onFix = null;
      };
    },
    emit: (s: number) => onFix?.({ timeMs: T0 + s * 1000, lat: 43 + s * 1e-5, lon: 3, speedMs: 3, accuracyM: 4 }),
  };
  return source satisfies LocationSource & object;
};

/** Avance l'horloge à `s` secondes de T0, une position par seconde depuis `from`. */
const runTo = (source: ReturnType<typeof fakeSource>, from: number, s: number) => {
  for (let t = from; t <= s; t++) {
    vi.setSystemTime(T0 + t * 1000);
    source.emit(t);
  }
};

beforeEach(() => {
  journal.text = null;
  memory.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  timer.startIntervalTimer();
});
afterEach(async () => {
  timer.stopAndCloseIntervals();
  await recorder.stopRecording();
  await recorder.discardPendingSession();
  recorder.dismissRecorderResult();
  vi.useRealTimers();
});

describe('séances du compteur pendant un enregistrement (lot 143, 140)', () => {
  it('une séance finie, fermée, puis une seconde lancée : les deux vont dans la session', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    runTo(source, 0, 10);
    timer.startIntervals(FIRST);
    runTo(source, 11, 60);
    // La carte se ferme (on va créer une séance dans Entraînement › Séances) : la séance finie est oubliée.
    timer.forgetClosedIntervals();
    expect(timer.getIntervalRun()).toBeNull();
    runTo(source, 61, 100);
    // « Lancer » ouvre Enregistrer, la carte s'ouvre, puis « Lancer le compteur ».
    timer.forgetClosedIntervals();
    timer.startIntervals(SECOND);
    runTo(source, 101, 200);
    await recorder.stopRecording();
    const pending = recorder.getRecorderState().pending!;
    expect(pending.intervals.map((s) => s.workout)).toEqual([FIRST, SECOND]);
    expect(pending.intervals[0].laps.map((l) => l.kind)).toEqual(['travail', 'repos', 'travail']);
    expect(pending.intervals[1].laps).toHaveLength(1);
    // Relue du journal (application fermée avant « Analyser ») : les deux encore.
    const parsed = parseJournal(journal.text!);
    expect(seriesWithin(parsed.intervalRuns, T0, T0 + 200_000).map((s) => s.workout)).toEqual([FIRST, SECOND]);
  });

  it("une séance lancée avant « Démarrer », arrêtée à la main et fermée, puis une seconde : les deux, la première depuis le départ", async () => {
    const source = fakeSource();
    timer.startIntervals(FIRST);
    vi.setSystemTime(T0 + 5000);
    await recorder.startRecording(activity, source);
    runTo(source, 5, 20);
    timer.stopIntervals();
    timer.closeIntervals();
    runTo(source, 21, 40);
    timer.startIntervals(SECOND);
    runTo(source, 41, 80);
    await recorder.stopRecording();
    const { intervals } = recorder.getRecorderState().pending!;
    expect(intervals.map((s) => s.workout)).toEqual([FIRST, SECOND]);
    expect(intervals[0].laps[0].startMs).toBe(T0 + 5000);
  });
});

describe('séance reprise au lancement de l’application (lot 143, 124)', () => {
  /** Relance l'application : modules neufs, stockage de l'appareil gardé. */
  const relaunch = async (keepConfided = false) => {
    vi.resetModules();
    const fresh = await import('./useIntervalTimer');
    fresh.startIntervalTimer(keepConfided);
    return fresh;
  };

  it("enregistrement repris seul après une chute de la page (lot 156) : sa séance continue, toujours confiée, programme rendu au téléphone", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    runTo(source, 0, 5);
    timer.startIntervals(FIRST);
    runTo(source, 6, 10);
    const schedules = clock.schedules;
    const fresh = await relaunch(true);
    expect(fresh.getIntervalRun()?.workout).toEqual(FIRST);
    expect(clock.schedules).toBeGreaterThan(schedules);
    fresh.stopAndCloseIntervals();
    expect(JSON.parse(memory.get('tracker.intervalRun') ?? 'null')).toBeNull();
  });

  it("une séance confiée à l'enregistrement coupé par un arrêt brutal ne reprend pas seule : arrêtée, le téléphone se tait", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    runTo(source, 0, 5);
    timer.startIntervals(FIRST);
    runTo(source, 6, 10);
    expect(JSON.parse(memory.get('tracker.intervalRun')!).confided).toBe(true);
    const stops = clock.stops;
    const fresh = await relaunch();
    expect(fresh.getIntervalRun()).toBeNull();
    expect(memory.get('tracker.intervalRun')).toBe('null');
    expect(clock.stops).toBeGreaterThan(stops);
  });

  it('une séance lancée sans enregistrement reprend telle quelle', async () => {
    timer.startIntervals(FIRST);
    vi.setSystemTime(T0 + 5000);
    expect(JSON.parse(memory.get('tracker.intervalRun')!).confided).toBeUndefined();
    const fresh = await relaunch();
    expect(fresh.getIntervalRun()?.workout).toEqual(FIRST);
    fresh.stopAndCloseIntervals();
  });

  it('une séance lancée avant « Démarrer » est confiée au départ de l’enregistrement', async () => {
    const source = fakeSource();
    timer.startIntervals(FIRST);
    expect(JSON.parse(memory.get('tracker.intervalRun')!).confided).toBeUndefined();
    await recorder.startRecording(activity, source);
    expect(JSON.parse(memory.get('tracker.intervalRun')!).confided).toBe(true);
  });

  it('un « Démarrer » en échec rend la séance libre : elle reprend seule après un arrêt brutal', async () => {
    const failing = { ...fakeSource(), start: async () => { throw new Error('GPS refusé'); } };
    timer.startIntervals(FIRST);
    await recorder.startRecording(activity, failing);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(JSON.parse(memory.get('tracker.intervalRun')!).confided).toBeUndefined();
    const fresh = await relaunch();
    expect(fresh.getIntervalRun()?.workout).toEqual(FIRST);
    fresh.stopAndCloseIntervals();
  });
});
