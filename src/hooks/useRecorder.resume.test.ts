import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix, LocationSource, StopLocation } from '../platform/location';
import { parseJournal } from '../recording/journal';
import { EMPTY_RECORDING_STATS, addFixAfterManualPause, addFixToStats, displayedDurationMs, type RecordingStats } from '../recording/session';

/**
 * Reprise d'un enregistrement après une chute du moteur de la page (lot 156). Une chute est simulée par des modules
 * neufs (`reload`) : la mémoire de la page est perdue, le journal et les services du téléphone restent.
 */

/** Journal en mémoire ; chaque `write` compté : une reprise n'en fait jamais. */
const journal = vi.hoisted(() => {
  const file = {
    text: null as string | null,
    writes: 0,
    readFails: false,
    read: async () => {
      if (file.readFails) throw new Error('lecture impossible');
      return file.text;
    },
    write: async (text: string) => {
      file.writes += 1;
      file.text = text;
    },
    append: async (text: string) => {
      file.text = (file.text ?? '') + text;
    },
    remove: async () => {
      file.text = null;
    },
    setAside: async () => 'de-cote.jsonl',
  };
  return file;
});
vi.mock('../platform/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/files')>()),
  recordingJournal: journal,
}));

/** Services vivants vus par `Recovery.state()`. */
const services = vi.hoisted(() => ({ gps: false, belt: false }));
vi.mock('../platform/recovery', () => ({ readRecoveryServices: async () => ({ gps: services.gps, belt: services.belt }) }));

/** Service GPS : le raccord sans relance, et les arrêts. */
const gpsService = vi.hoisted(() => ({
  onFix: null as ((fix: LocationFix) => void) | null,
  onError: null as ((message: string) => void) | null,
  adoptions: 0,
  adoptFails: false,
  stops: 0,
  orphanStops: 0,
}));
vi.mock('../platform/location', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/location')>()),
  adoptRunningService: (onFix: (fix: LocationFix) => void, onError: (message: string) => void): StopLocation => {
    if (gpsService.adoptFails) throw new Error('pont introuvable');
    gpsService.adoptions += 1;
    gpsService.onFix = onFix;
    gpsService.onError = onError;
    return async () => {
      gpsService.stops += 1;
      gpsService.onFix = null;
    };
  },
  stopOrphanedDeviceLocation: async () => {
    gpsService.orphanStops += 1;
  },
}));

/** Capture : jamais de `start` pendant une reprise. */
const sensors = vi.hoisted(() => ({
  starts: 0,
  stops: 0,
  pauses: 0,
  resumes: 0,
  running: null as null | { path: string; listening: boolean; setup: { placement: 'poitrine'; foil: boolean; jumps: boolean; cadence: boolean } },
  found: null as null | { path: string; bytes: number; durationS: number; samples: number; longestGapS: number; error: null },
  /** La lecture de la capture attend ceci : la reprise reste en `starting` le temps d'une commande. */
  gate: null as Promise<void> | null,
}));
vi.mock('../platform/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/motion')>()),
  startMotionCapture: async () => {
    sensors.starts += 1;
  },
  pauseMotionCapture: async () => {
    sensors.pauses += 1;
  },
  resumeMotionCapture: async () => {
    sensors.resumes += 1;
  },
  runningMotionCapture: async () => {
    await sensors.gate;
    return sensors.running;
  },
  stopMotionCapture: async () => {
    sensors.stops += 1;
    const path = sensors.running?.path;
    sensors.running = null;
    return path ? { path, bytes: 10, durationS: 1, samples: 2, longestGapS: 0, error: null } : null;
  },
  findMotionCapture: async () => sensors.found,
  readMotionCapture: async () => null,
  removeMotionCapture: async () => undefined,
}));

/** Ceinture : reprise sans `connect` ; prises à neuf comptées. */
const belt = vi.hoisted(() => {
  const listeners = new Set<(sample: { bpm: number; timeMs: number; contact: boolean | null }) => void>();
  return {
    listeners,
    adoptable: false,
    holds: 0,
    adoptions: 0,
    keepAlive: 0,
    saved: null as { address: string; name: string } | null,
    emit: (timeMs: number, bpm: number) => listeners.forEach((l) => l({ bpm, timeMs, contact: true })),
  };
});
vi.mock('../platform/heartRate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/heartRate')>()),
  adoptBelt: async () => {
    if (!belt.adoptable) return null;
    belt.adoptions += 1;
    return () => undefined;
  },
  holdBelt: async () => {
    belt.holds += 1;
    return () => undefined;
  },
  savedBelt: () => belt.saved,
  subscribeHeartRate: (listener: (sample: { bpm: number; timeMs: number; contact: boolean | null }) => void) => {
    belt.listeners.add(listener);
    return () => belt.listeners.delete(listener);
  },
  keepBeltAlive: async () => {
    belt.keepAlive += 1;
  },
  stopBeltKeepAlive: async () => undefined,
  releaseOrphanedBelt: async () => undefined,
}));

const gpsTimer = vi.hoisted(() => ({ arms: [] as number[], disarms: 0 }));
/** Sons joués, par nom. */
const sounds = vi.hoisted(() => ({ validated: 0, finished: 0, patterns: 0 }));
vi.mock('../platform/beeper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/beeper')>()),
  getBeeper: () => ({
    setInterval: async () => undefined,
    validated: async () => {
      sounds.validated += 1;
    },
    finished: async () => {
      sounds.finished += 1;
    },
    stop: async () => undefined,
  }),
  playPattern: async () => {
    sounds.patterns += 1;
  },
  armGpsWatch: async (delayMs: number) => {
    gpsTimer.arms.push(delayMs);
  },
  disarmGpsWatch: async () => {
    gpsTimer.disarms += 1;
  },
  onGpsLost: () => () => undefined,
}));

vi.mock('./useSessionLibrary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useSessionLibrary')>()),
  saveRecordedSession: async () => ({ file: 'rangee.gpx', location: 'ici' }),
}));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
});

const T0 = Date.UTC(2026, 10, 4, 9, 0, 0);
const activity = baseActivity('running');
const muscu = baseActivity('muscu');
const round = (ms: number) => Math.round(ms);

let recorder: typeof import('./useRecorder');

/** La page repart : plus rien en mémoire, le journal et les services du téléphone restent. */
const reload = async () => {
  vi.resetModules();
  recorder = await import('./useRecorder');
  return recorder;
};

const fixAt = (s: number, speedMs = 3): LocationFix => ({ timeMs: T0 + round(s * 1000), lat: 43 + s * 1e-5, lon: 3, speedMs, accuracyM: 4 });

/** Source simulée, relevant ses démarrages. */
const fakeSource = () => {
  let onFix: ((fix: LocationFix) => void) | null = null;
  const source = {
    starts: 0,
    label: 'Simulée',
    start: async (_options: unknown, fix: (f: LocationFix) => void) => {
      source.starts += 1;
      onFix = fix;
      return async () => {
        onFix = null;
      };
    },
    emit: (s: number, speedMs = 3) => onFix?.(fixAt(s, speedMs)),
  };
  return source satisfies LocationSource & object;
};

/** Les écritures en file sont passées. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Positions de `from` à `to` secondes, horloge à leur heure. */
const run = (emit: (s: number) => void, from: number, to: number, hz: number) => {
  for (let k = Math.round(from * hz); k <= Math.round(to * hz); k++) {
    const s = k / hz;
    vi.setSystemTime(T0 + round(s * 1000));
    emit(s);
  }
};

const lineCount = (marker: string): number => (journal.text ?? '').split('\n').filter((l) => l.startsWith(`["${marker}"`)).length;
const headerCount = (): number => (journal.text ?? '').split('\n').filter((l) => l.startsWith('{"format"')).length;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  memory.clear();
  journal.text = null;
  journal.writes = 0;
  journal.readFails = false;
  services.gps = false;
  services.belt = false;
  gpsService.onFix = null;
  gpsService.adoptions = 0;
  gpsService.adoptFails = false;
  gpsService.stops = 0;
  gpsService.orphanStops = 0;
  sensors.starts = 0;
  sensors.stops = 0;
  sensors.pauses = 0;
  sensors.resumes = 0;
  sensors.running = null;
  sensors.found = null;
  sensors.gate = null;
  belt.listeners.clear();
  belt.adoptable = false;
  belt.holds = 0;
  belt.adoptions = 0;
  belt.keepAlive = 0;
  belt.saved = null;
  gpsTimer.arms = [];
  gpsTimer.disarms = 0;
  sounds.validated = 0;
  sounds.finished = 0;
  sounds.patterns = 0;
  await reload();
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each([[1], [5]])('reprise silencieuse après une chute du moteur, à %i Hz', (hz) => {
  /** Enregistre de 0 à `toS` puis laisse le journal à jour ; à un multiple de 10 s, rien n'attend d'être écrit. */
  const recordUntil = async (toS: number) => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    run(source.emit, 0, toS, hz);
    await settle();
    return source;
  };

  it('un seul en-tête, une seule frontière, service jamais relancé, redélivrance écartée', async () => {
    const source = await recordUntil(20);
    expect(source.starts).toBe(1);
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();

    const state = fresh.getRecorderState();
    expect(state.status).toBe('recording');
    expect(state.pending).toBeNull();
    expect(state.resuming).toBe(false);
    expect(state.landOnRecording).toBe(true);
    expect(gpsService.adoptions).toBe(1);
    // Ni relance de la source d'avant, ni départ neuf.
    expect(source.starts).toBe(1);
    expect(state.activity?.id).toBe(activity.id);

    const before = state.stats;
    // Position déjà reçue, redélivrée par le service : écartée.
    gpsService.onFix!(fixAt(20));
    gpsService.onFix!(fixAt(19));
    expect(fresh.getRecorderState().stats).toEqual(before);
    expect(lineCount('break')).toBe(0);

    run((s) => gpsService.onFix!(fixAt(s)), 20 + 1 / hz, 30, hz);
    await settle();
    expect(headerCount()).toBe(1);
    expect(journal.writes).toBe(1);
    expect(lineCount('break')).toBe(1);
    expect(fresh.getLiveSegmentCount()).toBe(2);
  });

  it('statistiques égales à une session sans coupure, journal relu compris', async () => {
    await recordUntil(20);
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    run((s) => gpsService.onFix!(fixAt(s)), 20 + 1 / hz, 40, hz);
    await settle();

    let uncut: RecordingStats = EMPTY_RECORDING_STATS;
    run((s) => { uncut = addFixToStats(uncut, fixAt(s)); }, 0, 40, hz);
    expect(fresh.getRecorderState().stats).toEqual(uncut);

    // À l'arrêt, le GPX a tous les points, en deux segments.
    await fresh.stopRecording();
    const pending = fresh.getRecorderState().pending!;
    expect(pending.pointCount).toBe(40 * hz + 1);
    expect((pending.content.match(/<trkseg>/g) ?? []).length).toBe(2);
    expect(gpsService.stops).toBe(1);
    expect(pending.canContinue).toBe(false);
    const parsed = parseJournal(journal.text!);
    expect(parsed.fixes).toHaveLength(40 * hz + 1);
    expect(parsed.stoppedAtMs).not.toBeNull();
  });

  it('une coupure avec des positions perdues : le trou reste de la durée, comme un GPS muet', async () => {
    await recordUntil(20);
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    run((s) => gpsService.onFix!(fixAt(s)), 25, 30, hz);
    const { stats } = fresh.getRecorderState();
    expect(stats.pointCount).toBe(20 * hz + 1 + 5 * hz + 1);
    expect(displayedDurationMs(stats, null, T0)).toBe(30_000);
    expect(stats.longestGapS).toBe(5);
  });

  it('pause manuelle pendant la chute : reste en pause, durée figée, GPS gardé ; la reprise ne fait pas sauter la durée', async () => {
    const source = await recordUntil(20);
    await recorder.pauseRecording();
    run(source.emit, 21, 25, hz);
    await settle();
    const frozen = displayedDurationMs(recorder.getRecorderState().stats, recorder.getRecorderState().pauseClock, T0 + 25_000);
    expect(frozen).toBe(20_000);

    services.gps = true;
    vi.setSystemTime(T0 + 30_000);
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const state = fresh.getRecorderState();
    expect(state.status).toBe('paused');
    expect(state.pausedReason).toBe('manual');
    expect(displayedDurationMs(state.stats, state.pauseClock, T0 + 300_000)).toBe(20_000);
    // Le minuteur « GPS perdu » reste coupé en pause manuelle.
    expect(gpsTimer.disarms).toBeGreaterThan(0);

    // Positions de la pause : pour la carte seule.
    run((s) => gpsService.onFix!(fixAt(s)), 31, 40, hz);
    expect(fresh.getRecorderState().stats.pointCount).toBe(20 * hz + 1);
    expect(fresh.getLivePosition()?.timeMs).toBe(T0 + 40_000);

    vi.setSystemTime(T0 + 41_000);
    await fresh.resumeRecording();
    run((s) => gpsService.onFix!(fixAt(s)), 42, 50, hz);
    await settle();
    const after = fresh.getRecorderState();
    expect(after.status).toBe('recording');
    // 20 s avant la pause, 8 s après ; la pause et la chute ne comptent pas.
    expect(displayedDurationMs(after.stats, null, T0)).toBe(28_000);
    expect(headerCount()).toBe(1);
    expect(lineCount('break')).toBe(1);

    let uncut: RecordingStats = EMPTY_RECORDING_STATS;
    run((s) => { uncut = addFixToStats(uncut, fixAt(s)); }, 0, 20, hz);
    run((s) => { uncut = s === 42 ? addFixAfterManualPause(uncut, fixAt(s)) : addFixToStats(uncut, fixAt(s)); }, 42, 50, hz);
    expect(after.stats).toEqual(uncut);
  });

  it('pause levée, chute avant le point suivant : pas en pause, et la pause ne compte toujours pas', async () => {
    const source = await recordUntil(20);
    await recorder.pauseRecording();
    vi.setSystemTime(T0 + 60_000);
    await recorder.resumeRecording();
    await settle();
    expect(source.starts).toBe(1);

    services.gps = true;
    vi.setSystemTime(T0 + 62_000);
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(fresh.getRecorderState().status).toBe('recording');
    run((s) => gpsService.onFix!(fixAt(s)), 63, 70, hz);
    expect(displayedDurationMs(fresh.getRecorderState().stats, null, T0)).toBe(27_000);
    await settle();
    expect(lineCount('break')).toBe(1);
  });

  it('deux chutes de suite : toujours un seul en-tête, une frontière par reprise, les mêmes chiffres', async () => {
    await recordUntil(20);
    services.gps = true;
    let page = await reload();
    await page.recoverInterruptedRecording();
    run((s) => gpsService.onFix!(fixAt(s)), 20 + 1 / hz, 30, hz);
    await settle();
    page = await reload();
    await page.recoverInterruptedRecording();
    run((s) => gpsService.onFix!(fixAt(s)), 30 + 1 / hz, 40, hz);
    await settle();
    expect(headerCount()).toBe(1);
    expect(journal.writes).toBe(1);
    expect(lineCount('break')).toBe(2);
    expect(page.getLiveSegmentCount()).toBe(3);
    expect(page.getRecorderState().stats.pointCount).toBe(40 * hz + 1);
    expect(displayedDurationMs(page.getRecorderState().stats, null, T0)).toBe(40_000);
  });
});

describe('reprise silencieuse, cas limites', () => {
  const source = fakeSource;

  it('appelée deux fois, ou par un départ qui arrive pendant celle du lancement : une seule reprise', async () => {
    await recorder.startRecording(activity, source());
    services.gps = true;
    const fresh = await reload();
    const start = fresh.startRecording(activity, fakeSource());
    await Promise.all([fresh.recoverInterruptedRecording(), fresh.recoverInterruptedRecording(), start]);
    expect(gpsService.adoptions).toBe(1);
    expect(journal.writes).toBe(1);
    expect(fresh.getRecorderState().status).toBe('recording');
  });

  it('dernière ligne tronquée par la coupure : la suite du journal reste lisible', async () => {
    const live = source();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 10, 1);
    await settle();
    journal.text += `[${T0 + 11_000},43.1`;
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(fresh.getRecorderState().stats.pointCount).toBe(11);
    run((s) => gpsService.onFix!(fixAt(s)), 12, 20, 1);
    await settle();
    expect(parseJournal(journal.text!).fixes).toHaveLength(20);
  });

  it('le raccord échoue : retour à l\'attente, journal intact, « Continuer » proposé puisqu\'il est frais', async () => {
    const live = source();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 10, 1);
    await settle();
    const text = journal.text;
    services.gps = true;
    gpsService.adoptFails = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const state = fresh.getRecorderState();
    expect(state.status).toBe('idle');
    expect(state.pending?.pointCount).toBe(11);
    expect(state.pending?.canContinue).toBe(true);
    expect(state.landOnRecording).toBe(true);
    expect(gpsService.orphanStops).toBe(1);
    expect(journal.text).toBe(text);
    expect(journal.writes).toBe(1);
  });

  it('ligne « stop » et service vivant : en attente, service arrêté, ni reprise ni offre', async () => {
    const live = source();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 10, 1);
    await recorder.stopRecording();
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(gpsService.adoptions).toBe(0);
    expect(gpsService.orphanStops).toBe(1);
    expect(fresh.getRecorderState().pending?.canContinue).toBe(false);
  });

  it('sans journal et service vivant : service arrêté, rien d\'autre', async () => {
    services.gps = true;
    await recorder.recoverInterruptedRecording();
    expect(gpsService.orphanStops).toBe(1);
    expect(gpsService.adoptions).toBe(0);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(recorder.getRecorderState().pending).toBeNull();
  });

  it('sans journal ni service : rien', async () => {
    await recorder.recoverInterruptedRecording();
    expect(gpsService.orphanStops).toBe(0);
  });

  it('journal illisible et service vivant : service arrêté, journal mis de côté', async () => {
    journal.text = 'x';
    journal.readFails = true;
    services.gps = true;
    expect(await recorder.recoverInterruptedRecording()).toBe('setAside');
    expect(gpsService.orphanStops).toBe(1);
    expect(gpsService.adoptions).toBe(0);
  });

  it('capture ouverte : suivie, jamais redémarrée ; rendue à l\'arrêt', async () => {
    const live = source();
    await recorder.startRecording(activity, live, { motion: { placement: 'poitrine', foil: false, jumps: true, cadence: false } });
    run(live.emit, 0, 10, 1);
    await settle();
    expect(sensors.starts).toBe(1);
    const startedAtMs = parseJournal(journal.text!).header!.startedAtMs;
    sensors.running = { path: `capteurs/${startedAtMs}.imu`, listening: true, setup: { placement: 'poitrine', foil: false, jumps: true, cadence: false } };
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const state = fresh.getRecorderState();
    expect(state.measuringMotion).toBe(true);
    expect(state.motionSetup?.jumps).toBe(true);
    expect(sensors.starts).toBe(1);
    expect(sensors.stops).toBe(0);
    await fresh.stopRecording();
    expect(sensors.stops).toBe(1);
    expect(fresh.getRecorderState().pending?.motion?.path).toBe(`capteurs/${startedAtMs}.imu`);
  });

  it('capture et pause manuelle : un ordre perdu avec la page est rattrapé', async () => {
    const live = source();
    await recorder.startRecording(activity, live, { motion: { placement: 'poitrine', foil: false, jumps: true, cadence: false } });
    run(live.emit, 0, 10, 1);
    await recorder.pauseRecording();
    const startedAtMs = parseJournal(journal.text!).header!.startedAtMs;
    const pausesBefore = sensors.pauses;
    sensors.running = { path: `capteurs/${startedAtMs}.imu`, listening: true, setup: { placement: 'poitrine', foil: false, jumps: true, cadence: false } };
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(fresh.getRecorderState().status).toBe('paused');
    expect(sensors.pauses).toBe(pausesBefore + 1);
  });

  it('ceinture tenue par le téléphone : reprise sans nouvelle connexion, FC jointe de nouveau', async () => {
    const live = source();
    await recorder.startRecording(activity, live, { heartRate: { address: 'a', name: 'b' } });
    run(live.emit, 0, 10, 1);
    await settle();
    const holds = belt.holds;
    belt.adoptable = true;
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(belt.adoptions).toBe(1);
    expect(belt.holds).toBe(holds);
    expect(fresh.getRecorderState().heartRate).not.toBeNull();
  });

  it('muscu : le service de la ceinture vaut preuve, ses mesures reprennent, aucun GPS', async () => {
    belt.saved = { address: 'a', name: 'b' };
    await recorder.startRecording(muscu, null, { heartRate: belt.saved });
    for (let s = 0; s <= 10; s++) {
      vi.setSystemTime(T0 + s * 1000);
      belt.emit(T0 + s * 1000, 100 + s);
    }
    await settle();
    expect(belt.keepAlive).toBe(1);
    belt.listeners.clear();
    belt.adoptable = true;
    services.belt = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const state = fresh.getRecorderState();
    expect(state.status).toBe('recording');
    expect(state.stats.pointCount).toBe(11);
    expect(gpsService.adoptions).toBe(0);
    expect(belt.keepAlive).toBe(1);
    for (let s = 11; s <= 15; s++) {
      vi.setSystemTime(T0 + s * 1000);
      belt.emit(T0 + s * 1000, 120);
    }
    await settle();
    expect(fresh.getRecorderState().stats.pointCount).toBe(16);
    expect(headerCount()).toBe(1);
    expect(lineCount('break')).toBe(1);
  });

  it('le repère et l\'activité changée en route suivent la session', async () => {
    const live = source();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 5, 1);
    expect(recorder.addRecordingMark()).not.toBeNull();
    recorder.changeRecordingActivity(baseActivity('cycling'));
    await settle();
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const state = fresh.getRecorderState();
    expect(state.activity?.base).toBe('cycling');
    expect(state.marks).toHaveLength(1);
  });

  it('veille du GPS : le minuteur repart de la reprise', async () => {
    const live = source();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 10, 1);
    await settle();
    gpsTimer.arms = [];
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(gpsTimer.arms).toEqual([60_000]);
  });
});

describe('reprise silencieuse : refus du service', () => {
  it('dit à l\'écran comme pour une source démarrée, effacé à la position suivante', async () => {
    const live = fakeSource();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 10, 1);
    await settle();
    services.gps = true;
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    gpsService.onError!('Localisation coupée');
    expect(fresh.getRecorderState().error).toBe('Localisation coupée');
    expect(fresh.getRecorderState().status).toBe('recording');
    gpsService.onFix!(fixAt(11));
    expect(fresh.getRecorderState().error).toBeNull();
  });
});

describe('commandes pendant le `starting` d\'une reprise silencieuse', () => {
  /** Une chute en plein enregistrement ; la reprise s'arrête en `starting`, jusqu'à `open`. */
  const resumingHeld = async () => {
    const live = fakeSource();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 10, 1);
    await settle();
    services.gps = true;
    let open!: () => void;
    sensors.gate = new Promise((resolve) => {
      open = resolve;
    });
    const fresh = await reload();
    const recovered = fresh.recoverInterruptedRecording();
    for (let i = 0; i < 20 && fresh.getRecorderState().status !== 'starting'; i++) await settle();
    expect(fresh.getRecorderState().status).toBe('starting');
    expect(gpsService.adoptions).toBe(0);
    return { fresh, recovered, open };
  };

  it('« Arrêter » attend la fin de la reprise, puis arrête : session gardée, service arrêté une fois, rien de doublé', async () => {
    const { fresh, recovered, open } = await resumingHeld();
    const stop = fresh.stopRecording();
    await settle();
    expect(fresh.getRecorderState().status).toBe('starting');
    expect(lineCount('stop')).toBe(0);
    open();
    await Promise.all([recovered, stop]);
    const state = fresh.getRecorderState();
    expect(state.status).toBe('idle');
    expect(state.pending?.pointCount).toBe(11);
    expect(state.pending?.recovered).toBe(false);
    expect(gpsService.adoptions).toBe(1);
    expect(gpsService.stops).toBe(1);
    expect(gpsService.orphanStops).toBe(0);
    expect(headerCount()).toBe(1);
    expect(journal.writes).toBe(1);
    expect(lineCount('stop')).toBe(1);
    expect(lineCount('break')).toBe(0);
  });

  it('une pause, une reprise ou la bascule sont refusées sans dégât : la session reprend, en enregistrement', async () => {
    const { fresh, recovered, open } = await resumingHeld();
    await Promise.all([fresh.pauseRecording(), fresh.resumeRecording(), fresh.togglePauseRecording()]);
    expect(lineCount('pause')).toBe(0);
    expect(lineCount('resume')).toBe(0);
    open();
    await recovered;
    const state = fresh.getRecorderState();
    expect(state.status).toBe('recording');
    expect(state.pausedReason).toBeNull();
    gpsService.onFix!(fixAt(11));
    await settle();
    expect(fresh.getRecorderState().stats.pointCount).toBe(12);
    expect(headerCount()).toBe(1);
    expect(lineCount('break')).toBe(1);
    expect(displayedDurationMs(fresh.getRecorderState().stats, null, T0)).toBe(11_000);
  });

  it('un départ pendant la reprise est ignoré : ni en-tête, ni source neuve', async () => {
    const { fresh, recovered, open } = await resumingHeld();
    const other = fakeSource();
    await fresh.startRecording(activity, other);
    open();
    await recovered;
    expect(other.starts).toBe(0);
    expect(journal.writes).toBe(1);
    expect(fresh.getRecorderState().status).toBe('recording');
  });

  it('un « Arrêter » pendant une reprise qui échoue : session en attente, service arrêté, journal intact', async () => {
    const { fresh, recovered, open } = await resumingHeld();
    const text = journal.text;
    gpsService.adoptFails = true;
    const stop = fresh.stopRecording();
    open();
    await Promise.all([recovered, stop]);
    const state = fresh.getRecorderState();
    expect(state.status).toBe('idle');
    expect(state.pending?.pointCount).toBe(11);
    expect(gpsService.orphanStops).toBe(1);
    expect(journal.text).toBe(text);
  });

  it('commandes de nouveau libres après la reprise', async () => {
    const { fresh, recovered, open } = await resumingHeld();
    open();
    await recovered;
    await fresh.pauseRecording();
    expect(fresh.getRecorderState().status).toBe('paused');
    expect(lineCount('pause')).toBe(1);
  });
});

describe('« Continuer l\'enregistrement », application tuée puis rouverte', () => {
  /** Enregistre jusqu'à 20 s, puis l'application est tuée : plus aucun service. */
  const killedAt20 = async (hz: number) => {
    const live = fakeSource();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 20, hz);
    await settle();
  };

  it('proposé à moins de 10 min de la dernière ligne, plus au-delà', async () => {
    await killedAt20(1);
    vi.setSystemTime(T0 + 20_000 + 599_000);
    let fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(fresh.getRecorderState().pending?.canContinue).toBe(true);
    expect(fresh.getRecorderState().pending?.recovered).toBe(true);
    expect(fresh.getRecorderState().landOnRecording).toBe(true);

    vi.setSystemTime(T0 + 20_000 + 601_000);
    fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(fresh.getRecorderState().pending?.canContinue).toBe(false);
    expect(fresh.getRecorderState().landOnRecording).toBe(false);
  });

  it.each([[1], [5]])('même journal, segment neuf, source relancée par le geste, durée sans saut, à %i Hz', async (hz) => {
    await killedAt20(hz);
    vi.setSystemTime(T0 + 200_000);
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    fresh.acknowledgeRecordingLanding();
    const next = fakeSource();
    await fresh.continuePendingSession(next);
    const state = fresh.getRecorderState();
    expect(state.status).toBe('recording');
    expect(state.pending).toBeNull();
    expect(state.landOnRecording).toBe(false);
    expect(next.starts).toBe(1);
    expect(gpsService.adoptions).toBe(0);
    run(next.emit, 201, 210, hz);
    await settle();
    expect(headerCount()).toBe(1);
    expect(journal.writes).toBe(1);
    expect(lineCount('break')).toBe(1);
    // 20 s, puis 9 s : les 3 min hors de l'application ne comptent pas.
    expect(displayedDurationMs(fresh.getRecorderState().stats, null, T0)).toBe(29_000);
    await fresh.stopRecording();
    expect(fresh.getRecorderState().pending?.pointCount).toBe(20 * hz + 1 + 9 * hz + 1);
    expect((fresh.getRecorderState().pending?.content.match(/<trkseg>/g) ?? []).length).toBe(2);
  });

  it('une chute après « Continuer » : la durée reste juste', async () => {
    await killedAt20(1);
    vi.setSystemTime(T0 + 200_000);
    let fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const next = fakeSource();
    await fresh.continuePendingSession(next);
    run(next.emit, 201, 210, 1);
    await settle();
    services.gps = true;
    fresh = await reload();
    await fresh.recoverInterruptedRecording();
    expect(displayedDurationMs(fresh.getRecorderState().stats, null, T0)).toBe(29_000);
  });

  it('la source ne démarre pas : session toujours en attente, journal gardé', async () => {
    await killedAt20(1);
    vi.setSystemTime(T0 + 60_000);
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const failing: LocationSource = {
      label: 'Refus',
      start: async () => {
        throw new Error('localisation refusée');
      },
    };
    await fresh.continuePendingSession(failing);
    const state = fresh.getRecorderState();
    expect(state.status).toBe('idle');
    expect(state.pending?.canContinue).toBe(true);
    expect(state.error).toContain('localisation refusée');
    expect(parseJournal(journal.text!).fixes).toHaveLength(21);
    expect(headerCount()).toBe(1);
  });

  it('capture : ne reprend pas, c\'est dit, et le fichier d\'avant reste avec la session', async () => {
    await killedAt20(1);
    const path = `capteurs/${parseJournal(journal.text!).header!.startedAtMs}.imu`;
    sensors.found = { path, bytes: 10, durationS: 0, samples: 0, longestGapS: 0, error: null };
    vi.setSystemTime(T0 + 60_000);
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const next = fakeSource();
    await fresh.continuePendingSession(next);
    const starts = sensors.starts;
    expect(fresh.getRecorderState().measuringMotion).toBe(false);
    expect(fresh.getRecorderState().error).toContain('Capteurs');
    run(next.emit, 61, 65, 1);
    await fresh.stopRecording();
    expect(sensors.starts).toBe(starts);
    expect(fresh.getRecorderState().pending?.motion?.path).toBe(path);
  });

  it('sans offre : le bouton ne fait rien', async () => {
    await killedAt20(1);
    vi.setSystemTime(T0 + 3_600_000);
    const fresh = await reload();
    await fresh.recoverInterruptedRecording();
    const next = fakeSource();
    await fresh.continuePendingSession(next);
    expect(next.starts).toBe(0);
    expect(fresh.getRecorderState().pending).not.toBeNull();
  });
});

describe('zone visée', () => {
  it('reprise après une chute ; un départ ordinaire ne relit jamais une zone restée', async () => {
    const zone = await import('./useZoneAlert');
    zone.startZoneAlertGuide();
    zone.armZoneAlert(3);
    const live = fakeSource();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 5, 1);
    await settle();
    expect(zone.getZoneAlertTarget()).toBe(3);

    services.gps = true;
    const fresh = await reload();
    const freshZone = await import('./useZoneAlert');
    freshZone.startZoneAlertGuide();
    expect(freshZone.getZoneAlertTarget()).toBe(0);
    await fresh.recoverInterruptedRecording();
    expect(freshZone.getZoneAlertTarget()).toBe(3);

    // Tuée pendant la session, rouverte, puis nouvelle sortie sans zone : pas de bip surprise.
    services.gps = false;
    journal.text = null;
    const again = await reload();
    const againZone = await import('./useZoneAlert');
    againZone.startZoneAlertGuide();
    await again.startRecording(activity, fakeSource());
    expect(againZone.getZoneAlertTarget()).toBe(0);
    await again.stopRecording();
  });

  it('course à bornes : la bande, changée en direct, est reprise après une chute (05/11)', async () => {
    const zone = await import('./useZoneAlert');
    zone.startZoneAlertGuide();
    zone.armHeartBand({ minBpm: 140, maxBpm: 160 });
    const live = fakeSource();
    await recorder.startRecording(activity, live);
    run(live.emit, 0, 5, 1);
    await settle();
    expect(zone.getHeartGuide()).toEqual({ minBpm: 140, maxBpm: 160 });
    zone.setLiveBand({ minBpm: null, maxBpm: 150 });
    expect(zone.getHeartGuide()).toEqual({ minBpm: null, maxBpm: 150 });
    // Mini au-dessus du maxi : ignorée.
    zone.setLiveBand({ minBpm: 170, maxBpm: 150 });
    expect(zone.getHeartGuide()).toEqual({ minBpm: null, maxBpm: 150 });

    services.gps = true;
    const fresh = await reload();
    const freshZone = await import('./useZoneAlert');
    freshZone.startZoneAlertGuide();
    expect(freshZone.getHeartGuide()).toBe(0);
    await fresh.recoverInterruptedRecording();
    expect(freshZone.getHeartGuide()).toEqual({ minBpm: null, maxBpm: 150 });
    expect(freshZone.getZoneAlertTarget()).toBe(0);
    await fresh.stopRecording();
    expect(freshZone.getHeartGuide()).toBe(0);
  });
});

describe('guidages rejoués en silence', () => {
  it('balises : celles déjà validées le restent, aucun son', async () => {
    const wing = baseActivity('wingfoil');
    const north = (m: number) => 43 + m / 111_000;
    const marks = [{ lat: north(0), lon: 3 }, { lat: north(600), lon: 3 }, { lat: north(1200), lon: 3 }];
    const { followedTraceFromPoints } = await import('../recording/followedTrace');
    const trace = await import('./useFollowedTrace');
    trace.followTrace(followedTraceFromPoints(marks, 'Parcours', 'route', wing.id, marks)!);
    const guide = await import('./useMarkGuide');
    guide.startMarkGuide();
    const along = (s: number): LocationFix => ({ timeMs: T0 + s * 1000, lat: north(s * 10), lon: 3, speedMs: 10, accuracyM: 4 });
    let send: ((fix: LocationFix) => void) | null = null;
    const live: LocationSource = {
      label: 'Simulée',
      start: async (_options, onFix) => {
        send = onFix;
        return async () => undefined;
      },
    };
    await recorder.startRecording(wing, live);
    run((s) => send?.(along(s)), 0, 70, 1);
    await settle();
    const before = guide.getMarkGuideView();
    expect(before.target).toBe(2);
    expect(sounds.validated).toBe(2);

    services.gps = true;
    const fresh = await reload();
    const freshGuide = await import('./useMarkGuide');
    freshGuide.startMarkGuide();
    await fresh.recoverInterruptedRecording();
    const after = freshGuide.getMarkGuideView();
    expect(after.active).toBe(true);
    expect(after.target).toBe(2);
    expect(after.outcomes).toEqual(['validated', 'validated']);
    expect(after.distanceM).toBeCloseTo(before.distanceM!, 3);
    expect(sounds.validated).toBe(2);

    // La suite en direct continue de là, et sonne.
    run((s) => gpsService.onFix!(along(s)), 71, 125, 1);
    expect(freshGuide.getMarkGuideView().finished).toBe(true);
    expect(sounds.finished).toBe(1);
  });

  it('test de FC max : phase et chiffres retrouvés, aucun signal rejoué, rien de neuf au journal hors la suite', async () => {
    const test = baseActivity('run-test');
    const guide = await import('./useFitnessTest');
    guide.startFitnessTestGuide();
    const live = fakeSource();
    await recorder.startRecording(test, live);
    run(live.emit, 0, 30, 1);
    await settle();
    const before = guide.getFitnessTestView();
    expect(before.phase).toBe('echauffement');
    const played = sounds.patterns;
    expect(played).toBeGreaterThan(0);

    services.gps = true;
    const fresh = await reload();
    const freshGuide = await import('./useFitnessTest');
    freshGuide.startFitnessTestGuide();
    await fresh.recoverInterruptedRecording();
    const after = freshGuide.getFitnessTestView();
    expect(after.active).toBe(true);
    expect(after.phase).toBe('echauffement');
    expect(after.remainingS).toBe(before.remainingS);
    expect(sounds.patterns).toBe(played);
    expect(fresh.getRecordedTest()?.startMs).toBe(T0);
    expect(parseJournal(journal.text!).test?.startMs).toBe(T0);
  });
});
