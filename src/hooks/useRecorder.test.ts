import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix, LocationSource, LocationWatchOptions } from '../platform/location';
import type { MotionCapture } from '../platform/motion';
import { recordingDurationMs } from '../recording/session';
import { journalFixLine, parseJournal } from '../recording/journal';

/**
 * Journal en mémoire ; chaque écriture complète (l'en-tête) est relevée. `unreadable` : présent mais
 * illisible ; `aside` : contenus mis de côté ; `setAsideFails` : la mise de côté échoue.
 */
const journal = vi.hoisted(() => {
  const file = {
    text: null as string | null,
    headers: 0,
    unreadable: false,
    aside: [] as (string | null)[],
    setAsideFails: false,
    read: async () => {
      if (file.unreadable) throw new Error('lecture impossible');
      return file.text;
    },
    setAside: async () => {
      if (file.setAsideFails) throw new Error('renommage refusé');
      file.aside.push(file.text);
      file.text = null;
      file.unreadable = false;
      return `recording-journal-${file.aside.length}.jsonl`;
    },
    write: async (text: string) => {
      file.headers += 1;
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
/** Greffon Filesystem simulé, pour la vraie lecture du dossier privé ; `null` : celui de la plateforme. */
const privateFs = vi.hoisted(() => ({ fake: null as object | null }));
vi.mock('../platform/files', async (importOriginal) => {
  const original = await importOriginal<typeof import('../platform/files')>();
  return {
    ...original,
    recordingJournal: journal,
    filesystem: () => (privateFs.fake ? Promise.resolve(privateFs.fake) : original.filesystem()),
  };
});

/**
 * Ceinture simulée : prise et rendue sans Bluetooth, mesures émises à la demande ; le service au premier plan relevé.
 * `holdFails` : la prise est refusée (Bluetooth éteint) ; `holdGate` : la prise attend cette promesse ; `state` : l'état
 * de la connexion ; `retries` et `retrySeen` : les nouveaux essais demandés au greffon, et ce qu'ils rendent.
 */
const belt = vi.hoisted(() => {
  const listeners = new Set<(sample: { bpm: number; timeMs: number; contact: boolean | null }) => void>();
  return {
    listeners,
    keepAlive: 0,
    stopKeepAlive: 0,
    /** Ceintures prises, puis rendues, par l'enregistreur. */
    holds: 0,
    releases: 0,
    holdFails: null as Error | null,
    holdGate: null as Promise<void> | null,
    state: 'off' as 'off' | 'connecting' | 'connected' | 'searching' | 'lost' | 'unsupported',
    retries: 0,
    retrySeen: true as boolean | Error,
    emit: (timeMs: number, bpm: number, contact: boolean | null = true) => listeners.forEach((l) => l({ bpm, timeMs, contact })),
  };
});
vi.mock('../platform/heartRate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/heartRate')>()),
  holdBelt: async () => {
    if (belt.holdGate) await belt.holdGate;
    if (belt.holdFails) throw belt.holdFails;
    belt.holds += 1;
    return () => {
      belt.releases += 1;
    };
  },
  beltState: () => belt.state,
  retryBelt: async () => {
    belt.retries += 1;
    if (belt.retrySeen instanceof Error) throw belt.retrySeen;
    return belt.retrySeen;
  },
  subscribeHeartRate: (listener: (sample: { bpm: number; timeMs: number; contact: boolean | null }) => void) => {
    belt.listeners.add(listener);
    return () => belt.listeners.delete(listener);
  },
  keepBeltAlive: async () => {
    belt.keepAlive += 1;
  },
  stopBeltKeepAlive: async () => {
    belt.stopKeepAlive += 1;
  },
}));

/** Veille du GPS simulée (lot 115) : minuteurs armés et désarmés relevés, échéance déclenchée à la demande. */
const gps = vi.hoisted(() => ({ arms: [] as number[], disarms: 0, expire: null as (() => void) | null }));
/** Veille de la ceinture simulée (lot 177), de même. */
const beltWatch = vi.hoisted(() => ({ arms: [] as number[], disarms: 0, expire: null as (() => void) | null }));
vi.mock('../platform/beeper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/beeper')>()),
  armGpsWatch: async (delayMs: number) => {
    gps.arms.push(delayMs);
  },
  disarmGpsWatch: async () => {
    gps.disarms += 1;
  },
  onGpsLost: (listener: () => void) => {
    gps.expire = listener;
    return () => undefined;
  },
  armBeltWatch: async (delayMs: number) => {
    beltWatch.arms.push(delayMs);
  },
  disarmBeltWatch: async () => {
    beltWatch.disarms += 1;
  },
  onBeltLost: (listener: () => void) => {
    beltWatch.expire = listener;
    return () => undefined;
  },
}));

/**
 * Capteurs simulés : la capture démarre et se met en pause ; sa reprise échoue à la demande. `stop` : ce
 * que rend l'arrêt (rien sinon, comme dans le navigateur) ; `findFails` : la capture d'un journal repris
 * ne se cherche pas.
 */
const sensors = vi.hoisted(() => ({
  resumeFails: false,
  findFails: false,
  stop: null as (() => Promise<MotionCapture | null>) | null,
  /** Lecture de la capture ; `null` : celle de la plateforme. */
  read: null as ((path: string) => Promise<Uint8Array | null>) | null,
  removed: [] as string[],
}));
vi.mock('../platform/motion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../platform/motion')>();
  return {
    ...original,
    startMotionCapture: async () => undefined,
    pauseMotionCapture: async () => undefined,
    resumeMotionCapture: async () => {
      if (sensors.resumeFails) throw new Error('capteurs muets');
    },
    stopMotionCapture: () => (sensors.stop ? sensors.stop() : original.stopMotionCapture()),
    findMotionCapture: async (startedAtMs: number) => {
      if (sensors.findFails) throw new Error('stockage muet');
      return original.findMotionCapture(startedAtMs);
    },
    readMotionCapture: (path: string) => (sensors.read ? sensors.read(path) : original.readMotionCapture(path)),
    removeMotionCapture: async (path: string) => {
      sensors.removed.push(path);
    },
  };
});

/**
 * Rangement simulé : les capteurs reçus par la bibliothèque, dans l'ordre, et le journal tel qu'il était à chaque
 * rangement (il est effacé une fois la session rangée). `gate` : le rangement attend cette promesse ; `fails` : il
 * échoue ensuite, comme une écriture refusée.
 */
const library = vi.hoisted(() => ({
  motions: [] as (Uint8Array | null)[], journals: [] as (string | null)[], gate: null as Promise<void> | null, fails: false,
}));
vi.mock('./useSessionLibrary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useSessionLibrary')>()),
  saveRecordedSession: async (_text: string, _sport: unknown, _activityId: unknown, _intervals: unknown, motion: Uint8Array | null) => {
    library.motions.push(motion);
    library.journals.push(journal.text);
    if (library.gate) await library.gate;
    if (library.fails) throw new Error('écriture refusée');
    return { file: 'rangee.gpx', location: 'ici' };
  },
}));

/** Autorisations simulées : sans objet (navigateur), sauf notifications refusées à la demande. */
const permissions = vi.hoisted(() => ({ notificationsDenied: false }));
vi.mock('../platform/permissions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../platform/permissions')>();
  return {
    ...original,
    readPermissions: async () => {
      const status = await original.readPermissions();
      return permissions.notificationsDenied ? { ...status, notifications: 'denied' as const } : status;
    },
  };
});

const recorder = await import('./useRecorder');
const live = await import('./useLiveRecording');
const { effectiveRecordingProfile } = await import('./useSportSettings');

const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);
const activity = baseActivity('running');

/**
 * Source simulée : compte ses démarrages et ses arrêts, dit si elle tourne, émet à la demande tant qu'elle tourne ;
 * `fail` joue un échec de la source, avec sa cause.
 */
const fakeSource = () => {
  let onFix: ((fix: LocationFix) => void) | null = null;
  let onError: ((message: string, cause?: 'locationOff') => void) | null = null;
  let onLocationOn: (() => void) | null = null;
  const source = {
    starts: 0,
    stops: 0,
    active: false,
    /** Durée du prochain arrêt, en millisecondes ; un second arrêt pendant le premier rend la main tout de suite. */
    stopDelayMs: 5,
    label: 'Simulée',
    /** Options du dernier démarrage, telles que le service du téléphone les reçoit. */
    options: null as LocationWatchOptions | null,
    /** Ordres de pause manuelle reçus, comme le service du téléphone (lot 232, étape 2). */
    pauses: [] as { paused: boolean; atMs: number }[],
    start: async (
      options: LocationWatchOptions, fix: (f: LocationFix) => void, error: (message: string, cause?: 'locationOff') => void, locationOn?: () => void
    ) => {
      source.starts += 1;
      source.options = options;
      // Un démarrage qui prend un peu de temps, comme le greffon.
      await new Promise((resolve) => setTimeout(resolve, 5));
      onFix = fix;
      onError = error;
      onLocationOn = locationOn ?? null;
      source.active = true;
      let stopping = false;
      return async () => {
        // Un arrêt qui prend un peu de temps, lui aussi.
        const delay = stopping ? 0 : source.stopDelayMs;
        stopping = true;
        await new Promise((resolve) => setTimeout(resolve, delay));
        onFix = null;
        onError = null;
        onLocationOn = null;
        source.active = false;
        source.stops += 1;
      };
    },
    setPaused: async (paused: boolean, atMs: number) => {
      source.pauses.push({ paused, atMs });
    },
    /** La localisation du téléphone, dite coupée, est rendue. */
    locationBack: () => onLocationOn?.(),
    /** `accuracyM` : 4 m par défaut, calé d'emblée ; `null` : sans incertitude, comme un rejeu de fichier. */
    emit: (s: number, speedMs = 3, accuracyM: number | null = 4) =>
      onFix?.({ timeMs: T0 + s * 1000, lat: 43 + s * 1e-5, lon: 3, speedMs, ...(accuracyM === null ? {} : { accuracyM }) }),
    fail: (message: string, cause?: 'locationOff') => onError?.(message, cause),
  };
  return source satisfies LocationSource & object;
};

/** Ramène l'enregistreur au repos : session arrêtée, rangée si elle attendait encore, carte de fin effacée. */
const reset = async () => {
  library.gate = null;
  library.fails = false;
  await recorder.stopRecording();
  await recorder.savePendingSession();
  recorder.dismissRecorderResult();
};

beforeEach(() => {
  belt.holdFails = null;
  belt.holdGate = null;
  belt.state = 'off';
  belt.retries = 0;
  belt.retrySeen = true;
  journal.text = null;
  journal.headers = 0;
  journal.unreadable = false;
  journal.aside = [];
  journal.setAsideFails = false;
  sensors.findFails = false;
  sensors.stop = null;
  sensors.read = null;
  sensors.removed = [];
  library.motions = [];
  library.journals = [];
  library.gate = null;
  library.fails = false;
  privateFs.fake = null;
});
afterEach(async () => {
  vi.useRealTimers();
  await reset();
});

describe('enregistreur', () => {
  it('deux « Démarrer » sans attendre : un seul démarrage de la source et un seul en-tête (D-B3)', async () => {
    const source = fakeSource();
    await Promise.all([recorder.startRecording(activity, source), recorder.startRecording(activity, source)]);
    expect(source.starts).toBe(1);
    expect(journal.headers).toBe(1);
    expect(recorder.getRecorderState().status).toBe('recording');
  });

  it("deux « Reprendre » sans attendre : la source, restée allumée pendant la pause, n'est ni arrêtée ni relancée (D-B3, lot 104)", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    await recorder.pauseRecording();
    await Promise.all([recorder.resumeRecording(), recorder.resumeRecording()]);
    expect(source.starts).toBe(1);
    expect(source.stops).toBe(0);
    expect(source.active).toBe(true);
    expect(recorder.getRecorderState().status).toBe('recording');
  });

  it("pause manuelle : le GPS reste allumé, la carte suit le coureur, rien n'est gardé ni compté, la trace repart à la reprise (lot 104)", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    for (let s = 0; s < 10; s++) source.emit(s);
    await recorder.pauseRecording();
    expect(source.active).toBe(true);
    const seenByOthers: number[] = [];
    const offFixes = recorder.subscribeToFixes((f) => seenByOthers.push(f.timeMs));
    // Le coureur continue d'avancer, puis s'arrête plus longtemps que le délai de la pause automatique.
    for (let s = 10; s < 40; s++) source.emit(s);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 39_000);
    expect(recorder.getLastFix()?.timeMs).toBe(T0 + 9000);
    expect(recorder.getLiveHeadingFixes()).toHaveLength(31);
    for (let s = 40; s < 140; s++) source.emit(s, 0);
    offFixes();
    const paused = recorder.getRecorderState();
    expect(paused.stats.pointCount).toBe(10);
    expect(paused.status).toBe('paused');
    expect(paused.pausedReason).toBe('manual');
    // Notification, guidage et test ne voient pas les positions de la pause.
    expect(seenByOthers).toEqual([]);
    await recorder.resumeRecording();
    // Rien de gardé encore : la flèche reste sur la dernière position reçue en pause, pas sur le point de la pause.
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 139_000);
    expect(recorder.getLiveHeadingFixes()).toHaveLength(131);
    source.emit(140);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 140_000);
    expect(recorder.getLiveHeadingFixes().at(-1)?.timeMs).toBe(T0 + 140_000);
    expect(recorder.getLiveHeadingFixes()).toHaveLength(11);
    for (let s = 141; s < 150; s++) source.emit(s);
    expect(recorder.getLiveSegmentCount()).toBe(2);
    // Durée (lot 158) : 9 s avant la pause, 9 s après ; les 131 s de pause manuelle ne sont pas rattrapées à la reprise.
    expect(recordingDurationMs(recorder.getRecorderState().stats)).toBe(18_000);
    await recorder.stopRecording();
    const content = recorder.getRecorderState().saved!.content;
    expect(content.match(/<trkseg>/g)).toHaveLength(2);
    expect(content.match(/<trkpt/g)).toHaveLength(20);
    // Le second segment commence à la première position reprise.
    expect(content.split('<trkseg>')[2]).toContain(new Date(T0 + 140_000).toISOString().slice(0, 19));
  });

  it('le direct couvre la position qui vient d\'arriver (D-B4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    live.startLiveRecording();
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    // Sans page qui regarde, un calcul toutes les 5 s au plus : le suivant vient avec la position d'après le délai.
    vi.setSystemTime(T0 + 6000);
    source.emit(2);
    expect(live.getLiveRecording().segments.flat()).toHaveLength(3);
  });

  it('pause automatique, puis pause manuelle, puis reprise : une seule coupure', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    for (let s = 0; s < 10; s++) source.emit(s);
    // Immobile plus longtemps que le délai de la pause automatique.
    for (let s = 10; s < 100; s++) source.emit(s, 0);
    expect(recorder.getRecorderState().pausedReason).toBe('auto');
    await recorder.pauseRecording();
    expect(recorder.getRecorderState().pausedReason).toBe('manual');
    await recorder.resumeRecording();
    for (let s = 200; s < 210; s++) source.emit(s);
    await recorder.stopRecording();
    const saved = recorder.getRecorderState().saved;
    expect(saved).not.toBeNull();
    expect(saved!.content.match(/<trkseg>/g)).toHaveLength(2);
  });
});

describe('arrêt pendant une pause ou une reprise (B1)', () => {
  it('pause lancée puis « Arrêter » sans attendre : session en attente, au repos, GPS coupé', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    // Le greffon met du temps à couper le GPS : la pause finit après l'arrêt, s'il ne l'attend pas.
    source.stopDelayMs = 50;
    const pause = recorder.pauseRecording();
    const stop = recorder.stopRecording();
    await Promise.all([pause, stop]);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(recorder.getRecorderState().saved).not.toBeNull();
    expect(source.active).toBe(false);
  });

  it('reprise lancée puis « Arrêter » sans attendre : la source est arrêtée, jamais en pause à la fin', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    await recorder.pauseRecording();
    const statuses: string[] = [];
    const off = recorder.subscribeToRecorder(() => statuses.push(recorder.getRecorderState().status));
    const resume = recorder.resumeRecording();
    const stop = recorder.stopRecording();
    await Promise.all([resume, stop]);
    off();
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(statuses[statuses.length - 1]).toBe('idle');
    // Le GPS est resté allumé pendant la pause : un seul démarrage, un seul arrêt.
    expect(source.starts).toBe(1);
    expect(source.stops).toBe(1);
    expect(source.active).toBe(false);
    expect(recorder.getRecorderState().saved).not.toBeNull();
  });

  it('« Arrêter » pendant le démarrage : attend la fin du démarrage, puis arrête ; la source est arrêtée une fois', async () => {
    const source = fakeSource();
    const start = recorder.startRecording(activity, source);
    const stop = recorder.stopRecording();
    await Promise.all([start, stop]);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(source.starts).toBe(1);
    expect(source.stops).toBe(1);
    expect(source.active).toBe(false);
  });

  it("une pause demandée pendant l'arrêt est ignorée", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    const stop = recorder.stopRecording();
    const pause = recorder.pauseRecording();
    await Promise.all([stop, pause]);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(recorder.getRecorderState().saved).not.toBeNull();
  });
});

describe('journal sans en-tête lisible (D13)', () => {
  it('reprend la session sans deviner son activité : à classer, GPX sans type', async () => {
    journal.text = [0, 1, 2].map((s) => journalFixLine({ timeMs: T0 + s * 1000, lat: 43 + s * 1e-4, lon: 3, speedMs: 3, accuracyM: 4 })).join('');
    // Écriture refusée : la session reste hors de la mémoire, avec son nom de fichier.
    library.fails = true;
    await recorder.recoverInterruptedRecording();
    expect(recorder.getRecorderState().rangeFailed).toBe(true);
    const pending = recorder.getRecorderState().pending!;
    expect(pending.sport).toBeNull();
    expect(pending.activity).toBeNull();
    expect(pending.pointCount).toBe(3);
    expect(pending.fileName).toMatch(/_session\.gpx$/);
    expect(pending.content).not.toContain('<type>');
  });
});

describe('repère « Note » (D11)', () => {
  it("porte l'heure des positions, même quand l'horloge en diffère (rejeu), puis le temps écoulé depuis la dernière", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Rejeu : l'horloge du téléphone a une heure d'avance sur les positions.
    vi.setSystemTime(T0 + 3_600_000);
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(4);
    source.emit(5);
    expect(recorder.addRecordingMark()?.mark.timeMs).toBe(T0 + 5000);
    // Dix secondes sans position (pause manuelle) : le repère avance avec elles.
    vi.setSystemTime(Date.now() + 10_000);
    expect(recorder.addRecordingMark()?.mark.timeMs).toBe(T0 + 15_000);
  });
});

describe('calage du GPS au départ (lot 232)', () => {
  it('rien de gardé ni de compté avant la première position calée, que la carte montre ; le chrono part avec la trace', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    const seenByOthers: number[] = [];
    const offFixes = recorder.subscribeToFixes((f) => seenByOthers.push(f.timeMs));
    source.emit(0, 12, 30);
    source.emit(1, 8, 20);
    let state = recorder.getRecorderState();
    expect(state.settlingAccuracyM).toBe(20);
    expect(state.awaitingFix).toBe(false);
    expect(state.stats.pointCount).toBe(0);
    expect(state.stats.firstMs).toBeNull();
    expect(recorder.getLiveFixes()).toHaveLength(0);
    expect(recorder.getLastFix()).toBeNull();
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 1000);

    source.emit(2, 3, 8);
    source.emit(3, 3, 40);
    offFixes();
    state = recorder.getRecorderState();
    expect(state.settlingAccuracyM).toBeNull();
    // Calé à 2 s : la position large qui suit est gardée, le calage ne joue plus.
    expect(recorder.getLiveFixes().map((f) => f.timeMs)).toEqual([T0 + 2000, T0 + 3000]);
    expect(state.stats.firstMs).toBe(T0 + 2000);
    expect(recordingDurationMs(state.stats)).toBe(1000);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 3000);
    // Les abonnés reçoivent toutes les positions ; guidage et test écartent celles du calage (`isGpsSettling`).
    expect(seenByOthers).toEqual([T0, T0 + 1000, T0 + 2000, T0 + 3000]);
    expect(recorder.isGpsSettling()).toBe(false);
    await recorder.stopRecording();
    // Le journal n'a que la trace : une reprise après coupure redonne les mêmes chiffres.
    expect(parseJournal(journal.text ?? library.journals.at(-1) ?? '').fixes.map((f) => f.timeMs)).toEqual([T0 + 2000, T0 + 3000]);
    expect(recorder.getRecorderState().settlingAccuracyM).toBeNull();
  });

  it.each([['1 Hz', 1], ['5 Hz', 0.2], ['pas de 7 s', 7]])('GPS qui ne se cale jamais, %s : la trace part 10 s après la première position, au temps', async (_name, stepS) => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    for (let k = 0; k * stepS <= 20; k++) source.emit(Math.round(k * stepS * 1000) / 1000, 3, 30);
    const firstKeptS = Math.ceil(10 / stepS - 1e-9) * stepS;
    expect(recorder.getLiveFixes()[0].timeMs).toBe(T0 + Math.round(firstKeptS * 1000));
    expect(recorder.getRecorderState().stats.firstMs).toBe(T0 + Math.round(firstKeptS * 1000));
    expect(recorder.getRecorderState().settlingAccuracyM).toBeNull();
  });

  it('« Note » pendant le calage : repère à l’heure seule, jamais avant le départ ; une fois calé, à sa position', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    const settling: boolean[] = [];
    const off = recorder.subscribeToFixes(() => settling.push(recorder.isGpsSettling()));
    source.emit(0, 3, 40);
    vi.setSystemTime(T0 + 4000);
    const early = recorder.addRecordingMark()!.mark;
    expect(early).toEqual({ timeMs: T0 + 4000, lat: null, lon: null, label: null });
    vi.setSystemTime(T0 + 5000);
    source.emit(5, 3, 4);
    const placed = recorder.addRecordingMark()!.mark;
    expect(placed.lat).toBe(43 + 5e-5);
    expect(placed.timeMs).toBe(T0 + 5000);
    off();
    expect(settling).toEqual([true, false]);
    // Au journal comme dans la session : le premier à l'heure seule, le second à sa position.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parseJournal(journal.text!).marks).toEqual([early, placed]);
    expect(recorder.getRecorderState().marks).toEqual([early, placed]);
  });

  it('« Note » pendant le calage, position datée avant le départ : à l’heure du départ', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 2000);
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    // Horloge du GPS un peu en retard sur celle du téléphone.
    source.emit(1, 3, 40);
    expect(recorder.addRecordingMark()!.mark.timeMs).toBe(T0 + 2000);
  });

  it('pause manuelle pendant le calage, puis reprise : la carte suit de nouveau la position du calage', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0, 3, 40);
    await recorder.pauseRecording();
    for (let s = 1; s <= 3; s++) source.emit(s, 3, 40);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 3000);
    await recorder.resumeRecording();
    source.emit(4, 3, 30);
    expect(recorder.getRecorderState().settlingAccuracyM).toBe(30);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 4000);
    expect(recorder.getLiveHeadingFixes()).toHaveLength(0);
    source.emit(5, 3, 25);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 5000);
    source.emit(6, 3, 4);
    expect(recorder.getLiveFixes().map((f) => f.timeMs)).toEqual([T0 + 6000]);
    expect(recorder.getLivePosition()?.timeMs).toBe(T0 + 6000);
  });

  it('positions sans incertitude (rejeu d’un fichier) : gardées dès la première, aucun calage', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0, 3, null);
    source.emit(1, 3, null);
    expect(recorder.getLiveFixes()).toHaveLength(2);
    expect(recorder.getRecorderState().settlingAccuracyM).toBeNull();
  });

  it('chaque départ se recale : le calage d’une session ne vaut pas pour la suivante', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0, 3, 4);
    expect(recorder.getLiveFixes()).toHaveLength(1);
    await reset();
    await recorder.startRecording(activity, source);
    source.emit(100, 3, 30);
    expect(recorder.getLiveFixes()).toHaveLength(0);
    expect(recorder.getRecorderState().settlingAccuracyM).toBe(30);
  });
});

describe('enregistreur sans position (muscu, lot I du 25/10)', () => {
  const muscu = baseActivity('muscu');
  const ceinture = { address: '00:11:22:33:44:55', name: 'Ceinture' };
  /** Mesure à `s` secondes de T0. */
  const at = (s: number, bpm = 100, contact: boolean | null = true) => belt.emit(T0 + s * 1000, bpm, contact);

  it('sans ceinture (lot 210) : séance chronométrée, un point d’heure seule au départ puis un par seconde, à la pause et à la reprise', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T0);
    const before = { start: belt.keepAlive, stop: belt.stopKeepAlive };
    await recorder.startRecording(muscu, null);
    const started = recorder.getRecorderState();
    expect(started.status).toBe('recording');
    expect(started.sourceLabel).toBe('Chronomètre');
    expect(started.heartRate).toBeNull();
    expect(started.error).toBeNull();
    // Le service au premier plan tient la séance écran éteint, ceinture ou non.
    expect(belt.keepAlive).toBe(before.start + 1);
    expect(started.stats.pointCount).toBe(1);
    expect(parseJournal(journal.text!).header?.withoutBelt).toBe(true);
    vi.advanceTimersByTime(5800);
    expect(recorder.getRecorderState().stats.pointCount).toBe(6);
    // Un point à l'instant de la pause : le segment va jusqu'à elle ; rien n'est gardé pendant.
    await recorder.pauseRecording();
    expect(recorder.getRecorderState().stats.pointCount).toBe(7);
    vi.advanceTimersByTime(30_000);
    expect(recorder.getRecorderState().stats.pointCount).toBe(7);
    // Un point tout de suite à la reprise, qui ouvre le segment ; le battement trop proche qui suit est écarté.
    await recorder.resumeRecording();
    expect(recorder.getRecorderState().stats.pointCount).toBe(8);
    vi.advanceTimersByTime(1700);
    const stats = recorder.getRecorderState().stats;
    expect(stats.pointCount).toBe(9);
    expect(recordingDurationMs(stats)).toBe(7000);
    await recorder.stopRecording();
    expect(belt.stopKeepAlive).toBeGreaterThan(before.stop);
    const saved = recorder.getRecorderState().saved!;
    expect(saved.sport).toBe('muscu');
    // Aucune mesure de la ceinture : la durée seule.
    expect(saved.pointCount).toBe(0);
    expect(saved.content).not.toContain('gpxtpx:hr');
    expect(saved.content).not.toContain('lat=');
    expect(saved.content.match(/<trkseg>/g)).toHaveLength(2);
    // 7 points jusqu'à la pause, puis la reprise, un battement et le point de l'arrêt.
    expect(saved.content.match(/<trkpt>/g)).toHaveLength(10);
    // Arrêté : plus aucun point, le minuteur ne tourne plus.
    const text = journal.text;
    vi.advanceTimersByTime(5000);
    expect(journal.text).toBe(text);
  });

  it('sans ceinture : rien d’autre que le départ, puis l’arrêt aussitôt, n’est pas rangé (« Session trop courte »)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T0);
    await recorder.startRecording(muscu, null);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().saved).toBeNull();
    expect(recorder.getRecorderState().error).toBe('Session trop courte : rien à enregistrer.');
  });

  it('sans ceinture : départ et arrêt à moins d’un intervalle du minuteur, deux points mais rien de gardé ; un intervalle suffit', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T0);
    const tickMs = effectiveRecordingProfile(muscu).intervalMs;
    await recorder.startRecording(muscu, null);
    vi.advanceTimersByTime(tickMs / 2);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().saved).toBeNull();
    expect(recorder.getRecorderState().error).toBe('Session trop courte : rien à enregistrer.');
    recorder.dismissRecorderResult();
    await recorder.startRecording(muscu, null);
    vi.advanceTimersByTime(tickMs);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().saved?.pointCount).toBe(0);
  });

  it('sans ceinture : le journal relu après un arrêt brutal redonne la séance, durée seule', async () => {
    journal.text = [
      JSON.stringify({ format: 'tracker-journal', version: 1, sport: 'muscu', startedAtMs: T0, activity: { id: 'muscu', name: 'Muscu' }, withoutBelt: true }),
      JSON.stringify(['hr', T0, null]),
      JSON.stringify(['hr', T0 + 1000, null]),
      JSON.stringify(['break', T0 + 60_000]),
      JSON.stringify(['hr', T0 + 60_000, null]),
      JSON.stringify(['hr', T0 + 61_000, null]),
    ].join('\n');
    await recorder.recoverInterruptedRecording();
    const saved = recorder.getRecorderState().saved!;
    expect(saved.recovered).toBe(true);
    expect(saved.pointCount).toBe(0);
    expect(saved.content.match(/<trkpt>/g)).toHaveLength(4);
    expect(saved.content.match(/<trkseg>/g)).toHaveLength(2);
  });

  it('garde une mesure par seconde au plus, sans mesure hors contact ; service au premier plan au départ et à l’arrêt', async () => {
    const before = { start: belt.keepAlive, stop: belt.stopKeepAlive };
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    expect(recorder.getRecorderState().status).toBe('recording');
    expect(belt.keepAlive).toBe(before.start + 1);
    at(0, 90);
    at(0.3, 91);
    at(1, 92);
    at(1.5, 93);
    at(2.1, 94);
    at(3.2, 0);
    at(4.5, 120, false);
    expect(recorder.getRecorderState().stats.pointCount).toBe(3);
    await recorder.stopRecording();
    // Journal tel qu'au rangement : les mesures, puis le point de l'arrêt ; effacé une fois la session rangée.
    expect(library.journals[0]?.match(/\["hr",/g)).toHaveLength(4);
    expect(journal.text).toBeNull();
    expect(belt.stopKeepAlive).toBeGreaterThan(before.stop);
    const saved = recorder.getRecorderState().saved!;
    expect(saved.pointCount).toBe(3);
    expect(saved.sport).toBe('muscu');
    expect(saved.content).not.toContain('lat=');
    expect(saved.content.match(/<gpxtpx:hr>/g)).toHaveLength(3);
    // Le point de l'arrêt, sans FC, après la dernière mesure.
    expect(saved.content.match(/<trkpt>/g)).toHaveLength(4);
  });

  it('pause manuelle : mesures ignorées, la reprise ouvre un segment ; « Note » à l’heure seule', async () => {
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    for (let s = 0; s < 5; s++) at(s);
    const note = recorder.addRecordingMark();
    expect(note?.mark.lat).toBeNull();
    await recorder.pauseRecording();
    for (let s = 5; s < 10; s++) at(s);
    await recorder.resumeRecording();
    for (let s = 20; s < 25; s++) at(s);
    expect(recorder.getRecorderState().stats.pointCount).toBe(10);
    await recorder.stopRecording();
    const saved = recorder.getRecorderState().saved!;
    expect(saved.content.match(/<trkseg>/g)).toHaveLength(2);
    expect(saved.marks).toHaveLength(1);
  });

  it('une seule mesure : gardée avec sa durée jusqu’à l’arrêt (lot 210) ; aucune : rien à garder, et le dit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 30_000);
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    at(0);
    await recorder.stopRecording();
    const saved = recorder.getRecorderState().saved!;
    expect(saved.pointCount).toBe(1);
    expect(saved.content.match(/<trkpt>/g)).toHaveLength(2);
    recorder.dismissRecorderResult();
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    await recorder.stopRecording();
    expect(recorder.getRecorderState().saved).toBeNull();
    expect(recorder.getRecorderState().pending).toBeNull();
    expect(recorder.getRecorderState().error).toBe('Session trop courte : rien à enregistrer.');
  });

  it('reprend le journal d’une muscu après un arrêt brutal', async () => {
    journal.text = [
      JSON.stringify({ format: 'tracker-journal', version: 1, sport: 'muscu', startedAtMs: T0, activity: { id: 'muscu', name: 'Muscu' } }),
      JSON.stringify(['hr', T0, 95]),
      JSON.stringify(['hr', T0 + 1000, 97]),
      JSON.stringify(['break', T0 + 60_000]),
      JSON.stringify(['hr', T0 + 60_000, 120]),
      JSON.stringify(['hr', T0 + 61_000, 121]),
      JSON.stringify(['note', { timeMs: T0 + 500, lat: null, lon: null, label: null }]),
      '["hr", 17',
    ].join('\n');
    await recorder.recoverInterruptedRecording();
    const saved = recorder.getRecorderState().saved!;
    expect(saved.recovered).toBe(true);
    expect(saved.sport).toBe('muscu');
    expect(saved.pointCount).toBe(4);
    expect(saved.content.match(/<trkseg>/g)).toHaveLength(2);
    expect(saved.marks).toEqual([{ timeMs: T0 + 500, lat: null, lon: null, label: null }]);
  });

  it('ne passe pas d’une muscu à une activité à positions en cours de route', async () => {
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    recorder.changeRecordingActivity(activity);
    expect(recorder.getRecorderState().activity?.id).toBe('muscu');
  });
});

describe('prévenir quand ça rate (lot 115)', () => {
  it("un abonné qui lève n'empêche ni l'écriture du journal ni l'arrêt complet (lot 232)", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    const off = recorder.subscribeToRecorder(() => {
      throw new Error('abonné en panne');
    });
    try {
      for (let s = 0; s <= 30; s++) {
        source.emit(s);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      // Écrit par paquets pendant l'enregistrement, pas seulement à l'arrêt.
      expect(parseJournal(journal.text ?? '').fixes.length).toBeGreaterThan(0);
      await recorder.stopRecording();
      expect(source.stops).toBe(1);
      expect(source.active).toBe(false);
      expect(recorder.getRecorderState().status).toBe('idle');
      expect(recorder.getRecorderState().saved?.pointCount).toBe(31);
      expect(parseJournal(library.journals[0] ?? '').fixes).toHaveLength(31);
    } finally {
      off();
    }
  });

  it("GPS perdu après 1 min sans position : alerte posée une fois, effacée à la position suivante ; muet en pause manuelle", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    gps.arms = [];
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    // Rien d'armé avant la première position.
    expect(gps.arms).toEqual([]);
    source.emit(0);
    source.emit(1);
    expect(gps.arms).toEqual([60_000, 60_000]);
    // Échéance périmée (une position l'a repoussée) : rien.
    vi.setSystemTime(T0 + 30_000);
    gps.expire?.();
    expect(recorder.getRecorderState().gpsLost).toBe(false);
    vi.setSystemTime(T0 + 61_000);
    gps.expire?.();
    expect(recorder.getRecorderState().gpsLost).toBe(true);
    expect(recorder.getRecorderState().error).toBe(recorder.GPS_LOST_ERROR);
    source.emit(62);
    expect(recorder.getRecorderState().gpsLost).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
    // Pause manuelle : minuteur désarmé, une échéance qui arriverait quand même est ignorée.
    const disarms = gps.disarms;
    await recorder.pauseRecording();
    expect(gps.disarms).toBe(disarms + 1);
    vi.setSystemTime(T0 + 600_000);
    gps.expire?.();
    expect(recorder.getRecorderState().gpsLost).toBe(false);
  });

  it('FC perdue après 1 min sans mesure lisible, une fois, sans rien armer avant la première mesure ni en pause', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    beltWatch.arms = [];
    const source = fakeSource();
    await recorder.startRecording(activity, source, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    // Une ceinture jamais jointe n'est pas perdue.
    expect(beltWatch.arms).toEqual([]);
    belt.emit(T0, 100);
    belt.emit(T0, 100);
    expect(beltWatch.arms).toEqual([60_000, 60_000]);
    // Décollée, elle émet encore mais ne mesure plus : le minuteur n'est pas repoussé.
    vi.setSystemTime(T0 + 30_000);
    belt.emit(T0 + 30_000, 100, false);
    expect(beltWatch.arms).toHaveLength(2);
    vi.setSystemTime(T0 + 59_000);
    beltWatch.expire?.();
    expect(recorder.getRecorderState().beltLost).toBe(false);
    vi.setSystemTime(T0 + 61_000);
    beltWatch.expire?.();
    expect(recorder.getRecorderState().beltLost).toBe(true);
    expect(recorder.getRecorderState().error).toBe(recorder.BELT_LOST_ERROR);
    // Retour : l'alerte s'efface, rien n'est réarmé avant 2 min de mesures.
    belt.emit(T0 + 62_000, 100);
    expect(recorder.getRecorderState().beltLost).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
    expect(beltWatch.arms).toHaveLength(2);
    for (const s of [100, 140, 182]) {
      vi.setSystemTime(T0 + s * 1000);
      belt.emit(T0 + s * 1000, 100);
    }
    expect(beltWatch.arms).toHaveLength(3);
    // Pause manuelle : désarmé, une échéance qui arriverait quand même est ignorée.
    const disarms = beltWatch.disarms;
    await recorder.pauseRecording();
    expect(beltWatch.disarms).toBe(disarms + 1);
    vi.setSystemTime(T0 + 600_000);
    beltWatch.expire?.();
    expect(recorder.getRecorderState().beltLost).toBe(false);
  });

  it('muscu : la veille de la ceinture repart après une pause manuelle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await recorder.startRecording(baseActivity('muscu'), null, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    belt.emit(T0, 100);
    await recorder.pauseRecording();
    vi.setSystemTime(T0 + 10_000);
    await recorder.resumeRecording();
    beltWatch.arms = [];
    vi.setSystemTime(T0 + 11_000);
    belt.emit(T0 + 11_000, 100);
    expect(beltWatch.arms).toEqual([60_000]);
    vi.setSystemTime(T0 + 72_000);
    beltWatch.expire?.();
    expect(recorder.getRecorderState().beltLost).toBe(true);
    await recorder.stopRecording();
  });

  it("« Arrêter de chercher » (lot 198) : la ceinture est rendue, alerte et tuile retirées, plus rien ne la suit sans « Reprendre la ceinture »", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const source = fakeSource();
    await recorder.startRecording(activity, source, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    source.emit(0);
    belt.emit(T0, 100);
    vi.setSystemTime(T0 + 61_000);
    beltWatch.expire?.();
    expect(recorder.getRecorderState().beltLost).toBe(true);
    const releases = belt.releases;
    recorder.stopRecordingBeltSearch();
    expect(belt.releases).toBe(releases + 1);
    expect(recorder.getRecorderState().heartRate).toBeNull();
    expect(recorder.getRecorderState().beltLost).toBe(false);
    expect(recorder.getRecorderState().error ?? '').not.toContain(recorder.BELT_LOST_ERROR);
    expect(recorder.getRecorderState().status).toBe('recording');
    // Laissée de côté, réversible (lot 232) : la page propose de la reprendre.
    expect(recorder.getRecorderState().beltAside).toBe('stopped');
    // Plus suivie : une mesure qui arriverait encore ne réarme rien, et la pause ne la reprend pas.
    beltWatch.arms = [];
    belt.emit(T0 + 62_000, 100);
    expect(beltWatch.arms).toEqual([]);
    await recorder.pauseRecording();
    await recorder.resumeRecording();
    expect(recorder.getRecorderState().heartRate).toBeNull();
    // Un second appui ne rend rien de plus.
    recorder.stopRecordingBeltSearch();
    expect(belt.releases).toBe(releases + 1);
  });

  it('muscu : « Arrêter de chercher » est sans effet, la session se fait avec la ceinture', async () => {
    await recorder.startRecording(baseActivity('muscu'), null, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    const releases = belt.releases;
    recorder.stopRecordingBeltSearch();
    expect(belt.releases).toBe(releases);
    expect(recorder.getRecorderState().heartRate).not.toBeNull();
  });

  it("l'arrêt efface la perte de la FC : rien ne reste à la session suivante, et le minuteur est désarmé", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const source = fakeSource();
    await recorder.startRecording(activity, source, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    source.emit(0);
    belt.emit(T0, 100);
    vi.setSystemTime(T0 + 61_000);
    beltWatch.expire?.();
    expect(recorder.getRecorderState().beltLost).toBe(true);
    const disarms = beltWatch.disarms;
    await recorder.stopRecording();
    expect(beltWatch.disarms).toBeGreaterThan(disarms);
    expect(recorder.getRecorderState().beltLost).toBe(false);
    expect(recorder.getRecorderState().error ?? '').not.toContain(recorder.BELT_LOST_ERROR);
  });

  it("« GPS perdu » s'ajoute à l'alerte déjà affichée et se retire seul au retour : l'avertissement des notifications reste", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    permissions.notificationsDenied = true;
    try {
      const source = fakeSource();
      await recorder.startRecording(activity, source);
      // L'avertissement part après le départ, sans le retenir.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const warning = recorder.getRecorderState().error;
      expect(warning).toMatch(/^Notifications refusées/);
      source.emit(0);
      vi.setSystemTime(T0 + 61_000);
      gps.expire?.();
      expect(recorder.getRecorderState().gpsLost).toBe(true);
      expect(recorder.getRecorderState().error).toBe(`${warning} ${recorder.GPS_LOST_ERROR}`);
      source.emit(62);
      expect(recorder.getRecorderState().gpsLost).toBe(false);
      expect(recorder.getRecorderState().error).toBe(warning);
    } finally {
      permissions.notificationsDenied = false;
    }
  });

  it("muscu : aucune veille du GPS", async () => {
    gps.arms = [];
    await recorder.startRecording(baseActivity('muscu'), null, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    belt.emit(T0, 100);
    belt.emit(T0 + 1000, 101);
    expect(gps.arms).toEqual([]);
  });

  it("une écriture du journal qui échoue garde ses lignes : le journal finit complet et dans l'ordre", async () => {
    const append = journal.append;
    let failures = 0;
    journal.append = async (text: string) => {
      if (failures === 0) {
        failures += 1;
        throw new Error('disque plein');
      }
      await append(text);
    };
    try {
      const source = fakeSource();
      await recorder.startRecording(activity, source);
      for (let s = 0; s <= 30; s++) {
        source.emit(s);
        // Laisse partir l'écriture d'un paquet avant la position suivante.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await recorder.stopRecording();
      expect(failures).toBe(1);
      // Tel qu'au rangement : il est effacé ensuite.
      const times = parseJournal(library.journals[0] ?? '').fixes.map((f) => (f.timeMs - T0) / 1000);
      expect(times).toEqual(Array.from({ length: 31 }, (_, s) => s));
    } finally {
      journal.append = append;
    }
  });

  it('reprise des capteurs impossible : dit dans l’alerte, la mesure reste annoncée', async () => {
    sensors.resumeFails = true;
    try {
      const source = fakeSource();
      await recorder.startRecording(activity, source, { motion: { placement: 'poitrine', foil: false, jumps: false, cadence: true } });
      source.emit(0);
      source.emit(1);
      await recorder.pauseRecording();
      await recorder.resumeRecording();
      const state = recorder.getRecorderState();
      expect(state.status).toBe('recording');
      expect(state.error).toBe('Capteurs : reprise impossible, sauts et cadence arrêtés');
      expect(state.measuringMotion).toBe(true);
    } finally {
      sensors.resumeFails = false;
    }
  });
});

describe('journal illisible (lot 143, 123a)', () => {
  const header = JSON.stringify({ format: 'tracker-journal', version: 1, sport: 'running', startedAtMs: T0, activity: { id: 'running', name: 'Course' } });

  it('au lancement : mis de côté et dit, jamais pris pour absent ; le départ suivant écrit un journal neuf', async () => {
    journal.text = 'session perdue';
    journal.unreadable = true;
    expect(await recorder.recoverInterruptedRecording()).toBe('setAside');
    expect(journal.aside).toEqual(['session perdue']);
    expect(recorder.getRecorderState().pending).toBeNull();
    expect(recorder.getRecorderState().error).toMatch(/illisible .*mis de côté .*prochain lancement.*journaux/);
    await recorder.startRecording(activity, fakeSource());
    expect(recorder.getRecorderState().status).toBe('recording');
    expect(journal.headers).toBe(1);
    expect(journal.aside).toEqual(['session perdue']);
  });

  it("au « Démarrer » : mis de côté avant l'en-tête, le message reste affiché pendant l'enregistrement", async () => {
    journal.text = 'session perdue';
    journal.unreadable = true;
    await recorder.startRecording(activity, fakeSource());
    expect(recorder.getRecorderState().status).toBe('recording');
    expect(journal.aside).toEqual(['session perdue']);
    expect(journal.headers).toBe(1);
    expect(recorder.getRecorderState().error).toMatch(/journal est mis de côté/);
  });

  it('mise de côté impossible : aucun départ, le journal reste intact', async () => {
    journal.text = 'session perdue';
    journal.unreadable = true;
    journal.setAsideFails = true;
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(source.starts).toBe(0);
    expect(journal.headers).toBe(0);
    expect(journal.text).toBe('session perdue');
    expect(recorder.getRecorderState().error).toMatch(/pas pu être mis de côté/);
  });

  it('session impossible à reconstruire : le journal est mis de côté, pas écrasé', async () => {
    const fix = journalFixLine({ timeMs: T0, lat: 43, lon: 3, speedMs: 3, accuracyM: 4 });
    journal.text = `${header}\n${fix}`;
    sensors.findFails = true;
    expect(await recorder.recoverInterruptedRecording()).toBe('setAside');
    expect(journal.aside).toEqual([`${header}\n${fix}`]);
    expect(recorder.getRecorderState().error).toMatch(/non récupérée \(stockage muet\).*mis de côté/);
  });

  it('journal absent : rien à faire, rien de dit', async () => {
    expect(await recorder.recoverInterruptedRecording()).toBe('free');
    expect(journal.aside).toEqual([]);
    expect(recorder.getRecorderState().error).toBeNull();
  });
});


describe('capteurs à l’arrêt (lot 143, 123c)', () => {
  const capture: MotionCapture = { path: `capteurs/${T0}.imu`, bytes: 4096, durationS: 2, samples: 200, longestGapS: 0.01, error: null };
  const setup = { placement: 'poitrine' as const, foil: false, jumps: true, cadence: true };

  /** Enregistre deux positions avec les capteurs, puis arrête : l'alerte une fois la session rangée. */
  const stopWith = async (stop: () => Promise<MotionCapture | null>): Promise<string | null> => {
    sensors.stop = stop;
    sensors.read = async () => null;
    const source = fakeSource();
    await recorder.startRecording(activity, source, { motion: setup });
    source.emit(0);
    source.emit(1);
    await recorder.stopRecording();
    const state = recorder.getRecorderState();
    expect(state.saved).not.toBeNull();
    // Ce que l'arrêt a dit suit la session rangée : la carte de fin reste, au lieu d'ouvrir l'analyse.
    expect(state.saved?.warning ?? null).toBe(state.error);
    return state.error;
  };

  it('capture complète : rien de dit', async () => {
    expect(await stopWith(async () => capture)).toBeNull();
  });

  it("échec d'écriture : dit en une phrase à l'arrêt, gardé après le rangement", async () => {
    expect(await stopWith(async () => ({ ...capture, error: 'mémoire pleine' }))).toMatch(/écriture interrompue \(mémoire pleine\)/);
  });

  it('rangement refusé puis « Réessayer » : l’alerte de la capture incomplète suit la session rangée', async () => {
    library.fails = true;
    sensors.stop = async () => ({ ...capture, error: 'mémoire pleine' });
    sensors.read = async () => null;
    const source = fakeSource();
    await recorder.startRecording(activity, source, { motion: setup });
    source.emit(0);
    source.emit(1);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().pending?.warning).toMatch(/écriture interrompue \(mémoire pleine\)/);
    library.fails = false;
    const saved = await recorder.savePendingSession();
    expect(saved?.warning).toMatch(/écriture interrompue \(mémoire pleine\)/);
  });

  it('aucune mesure reçue, arrêt impossible, plus rien ne tournait : dit aussi', async () => {
    expect(await stopWith(async () => ({ ...capture, samples: 0 }))).toMatch(/aucune mesure reçue/);
    await reset();
    expect(await stopWith(async () => {
      throw new Error('greffon muet');
    })).toMatch(/arrêt impossible \(greffon muet\)/);
    await reset();
    expect(await stopWith(async () => null)).toMatch(/s'était arrêtée/);
  });
});

describe('rangement dès l’arrêt (lot 212)', () => {
  const capture: MotionCapture = { path: `capteurs/${T0}.imu`, bytes: 4096, durationS: 2, samples: 200, longestGapS: 0.01, error: null };
  const setup = { placement: 'poitrine' as const, foil: true, jumps: true, cadence: false };
  const unreadable = async (): Promise<Uint8Array | null> => {
    throw new Error('mémoire du pont');
  };

  /** Session de voile avec ses capteurs, arrêtée : la capture n'est pas lue à l'arrêt (pas de cadence), mais au rangement. */
  const stopped = async (): Promise<void> => {
    sensors.stop = async () => capture;
    const source = fakeSource();
    await recorder.startRecording(baseActivity('wingfoil'), source, { motion: setup });
    source.emit(0);
    source.emit(1);
    await recorder.stopRecording();
  };

  it("l'arrêt range la session : capture rangée avec elle puis effacée, journal effacé, carte de fin", async () => {
    const bytes = new Uint8Array([1, 2]);
    sensors.read = async () => bytes;
    await stopped();
    const state = recorder.getRecorderState();
    expect(state.status).toBe('idle');
    expect(state.pending).toBeNull();
    expect(state.rangeFailed).toBe(false);
    expect(state.analyzing).toBe(false);
    expect(state.error).toBeNull();
    expect(state.saved).toMatchObject({ libraryFile: 'rangee.gpx', location: 'ici', rangedBy: 'finish', recovered: false, motionLeft: null, warning: null });
    expect(state.saved?.activity?.base).toBe('wingfoil');
    expect(library.motions).toEqual([bytes]);
    expect(sensors.removed).toEqual([capture.path]);
    // Journal complet, ligne d'arrêt comprise, jusqu'au rangement ; effacé seulement après.
    expect(parseJournal(library.journals[0] ?? '').stoppedAtMs).not.toBeNull();
    expect(journal.text).toBeNull();
  });

  it('capture illisible : rangée sans elle, le fichier reste sur l’appareil, et la session le dit (`motionLeft`)', async () => {
    sensors.read = unreadable;
    await stopped();
    const state = recorder.getRecorderState();
    expect(state.pending).toBeNull();
    expect(state.saved?.motionLeft).toEqual({ path: capture.path, file: 'rangee.gpx' });
    expect(library.motions).toEqual([null]);
    expect(sensors.removed).toEqual([]);
    expect(journal.text).toBeNull();
    expect(state.error).toBeNull();
  });

  it('message des capteurs illisibles : « Réessayer » encore illisible le dit, puis lue, la donne à la session et l’efface', async () => {
    sensors.read = unreadable;
    await stopped();
    expect(recorder.getRecorderState().leftCaptures).toEqual([{ file: 'rangee.gpx', path: capture.path, status: 'waiting', detail: null }]);
    // Le message survit à la carte de fin.
    recorder.dismissRecorderResult();
    expect(await recorder.retryLeftCapture('autre.gpx')).toBe(false);
    expect(await recorder.retryLeftCapture('rangee.gpx')).toBe(false);
    expect(recorder.getRecorderState().leftCaptures[0]).toMatchObject({ status: 'unreadable', detail: 'mémoire du pont' });
    expect(sensors.removed).toEqual([]);
    const bytes = new Uint8Array([7]);
    sensors.read = async () => bytes;
    library.fails = true;
    expect(await recorder.retryLeftCapture('rangee.gpx')).toBe(false);
    expect(recorder.getRecorderState().leftCaptures[0]).toMatchObject({ status: 'failed', detail: 'écriture refusée' });
    library.fails = false;
    expect(await recorder.retryLeftCapture('rangee.gpx')).toBe(true);
    expect(library.motions.at(-1)).toBe(bytes);
    expect(sensors.removed).toEqual([capture.path]);
    expect(recorder.getRecorderState().leftCaptures).toEqual([]);
  });

  it('capture absente : rangée sans elle, rien de laissé', async () => {
    sensors.read = async () => null;
    await stopped();
    expect(recorder.getRecorderState().saved?.motionLeft).toBeNull();
    expect(library.motions).toEqual([null]);
  });

  /** Greffon dont la lecture et le `stat` échouent avec ces erreurs, derrière la vraie `readPrivateBytes`. */
  const readingThrough = async (readError: Error, statError: Error): Promise<void> => {
    privateFs.fake = {
      Directory: { Data: 'DATA' },
      Filesystem: {
        readFile: async () => {
          throw readError;
        },
        stat: async () => {
          throw statError;
        },
      },
    };
    sensors.read = (await import('../platform/memoryFolder')).readPrivateBytes;
  };

  it('lecture et `stat` qui échouent sans dire « introuvable » : pas d’absence conclue, la capture reste', async () => {
    await readingThrough(new Error('mémoire du pont'), new Error('stockage muet'));
    await stopped();
    expect(recorder.getRecorderState().saved?.motionLeft?.path).toBe(capture.path);
    expect(sensors.removed).toEqual([]);
    expect(library.motions).toEqual([null]);
  });

  it('absence prouvée par le greffon : rangée sans elle, rien de laissé', async () => {
    const missing = Object.assign(new Error("'readFile' failed because file does not exist."), { code: 'OS-PLUG-FILE-0008' });
    await readingThrough(missing, missing);
    await stopped();
    expect(recorder.getRecorderState().saved?.motionLeft).toBeNull();
    expect(library.motions).toEqual([null]);
  });

  it('écriture refusée : la session attend, journal et capture gardés, aucun départ ; « Réessayer » la range', async () => {
    const bytes = new Uint8Array([3]);
    sensors.read = async () => bytes;
    library.fails = true;
    await stopped();
    let state = recorder.getRecorderState();
    expect(state.saved).toBeNull();
    expect(state.pending?.pointCount).toBe(2);
    expect(state.rangeFailed).toBe(true);
    expect(state.analyzing).toBe(false);
    expect(state.error).toMatch(/Rangement de la session impossible : écriture refusée/);
    expect(journal.text).not.toBeNull();
    expect(sensors.removed).toEqual([]);
    // Le journal de la session serait écrasé : pas de départ tant qu'elle n'est pas rangée.
    const other = fakeSource();
    await recorder.startRecording(activity, other);
    expect(other.starts).toBe(0);
    expect(recorder.getRecorderState().status).toBe('idle');

    library.fails = false;
    expect((await recorder.savePendingSession())?.libraryFile).toBe('rangee.gpx');
    state = recorder.getRecorderState();
    expect(state.pending).toBeNull();
    expect(state.rangeFailed).toBe(false);
    expect(state.error).toBeNull();
    expect(state.saved?.rangedBy).toBe('finish');
    expect(library.motions).toEqual([bytes, bytes]);
    expect(sensors.removed).toEqual([capture.path]);
    expect(journal.text).toBeNull();
  });

  it('« Jeter la session » après un rangement refusé : journal et capture effacés, page au repos, départ de nouveau possible', async () => {
    sensors.read = async () => null;
    // Sans échec, rien à jeter.
    await stopped();
    expect(await recorder.discardFailedSession()).toBe(false);
    recorder.dismissRecorderResult();
    sensors.removed = [];
    library.fails = true;
    await stopped();
    expect(recorder.getRecorderState().rangeFailed).toBe(true);
    expect(await recorder.discardFailedSession()).toBe(true);
    const state = recorder.getRecorderState();
    expect(state.pending).toBeNull();
    expect(state.rangeFailed).toBe(false);
    expect(state.saved).toBeNull();
    expect(state.error).toBeNull();
    expect(journal.text).toBeNull();
    expect(sensors.removed).toEqual([capture.path]);
    const other = fakeSource();
    await recorder.startRecording(activity, other);
    expect(other.starts).toBe(1);
  });

  it('moins de deux positions : rien de rangé, journal et capture effacés, et c’est dit', async () => {
    sensors.stop = async () => capture;
    const source = fakeSource();
    await recorder.startRecording(baseActivity('wingfoil'), source, { motion: setup });
    source.emit(0);
    await recorder.stopRecording();
    const state = recorder.getRecorderState();
    expect(state.pending).toBeNull();
    expect(state.saved).toBeNull();
    expect(state.error).toBe('Moins de deux positions reçues : rien à enregistrer.');
    expect(library.motions).toEqual([]);
    expect(sensors.removed).toEqual([capture.path]);
    expect(journal.text).toBeNull();
  });
});

describe('rangement en cours, état du module (lot 161)', () => {
  /** Quelques tours de la boucle, le temps qu'une étape asynchrone passe. */
  const until = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 50 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  };
  /** Rangement suspendu jusqu'à `open()`. */
  const gated = (): (() => void) => {
    let open: () => void = () => undefined;
    library.gate = new Promise((resolve) => {
      open = resolve;
    });
    return () => open();
  };

  it("pendant le rangement de l'arrêt : « Rangement… », aucun départ, un seul rangement ; le drapeau retombe après", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    const open = gated();
    const stop = recorder.stopRecording();
    await until(() => library.motions.length > 0);
    let state = recorder.getRecorderState();
    expect(state.status).toBe('idle');
    expect(state.analyzing).toBe(true);
    expect(state.pending).not.toBeNull();
    expect(state.saved).toBeNull();
    // Un départ arrive pendant l'arrêt, rangement compris : il est ignoré.
    const other = fakeSource();
    await recorder.startRecording(activity, other);
    expect(other.starts).toBe(0);
    // Un second rangement demandé pendant celui-ci rend le même.
    expect(recorder.savePendingSession()).toBe(recorder.savePendingSession());
    open();
    await stop;
    state = recorder.getRecorderState();
    expect(state.analyzing).toBe(false);
    expect(state.pending).toBeNull();
    // La page rouverte entre-temps trouve la session rangée.
    expect(state.saved?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toHaveLength(1);
    expect(await recorder.savePendingSession()).toBeNull();
  });

  it('« Réessayer » : le drapeau monte pendant le rangement et retombe après, même promesse à un second appel', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    library.fails = true;
    await recorder.stopRecording();
    expect(recorder.getRecorderState().analyzing).toBe(false);
    expect(recorder.getRecorderState().rangeFailed).toBe(true);

    library.fails = false;
    const open = gated();
    const retry = recorder.savePendingSession();
    // Levé dès l'appel : la page qui le lit peint « Rangement… » avant le calcul.
    expect(recorder.getRecorderState().analyzing).toBe(true);
    expect(recorder.savePendingSession()).toBe(retry);
    open();
    expect((await retry)?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toHaveLength(2);
    expect(recorder.getRecorderState().analyzing).toBe(false);
    expect(journal.text).toBeNull();
  });

  it('sans session en attente : rien à ranger, drapeau baissé', async () => {
    expect(await recorder.savePendingSession()).toBeNull();
    expect(recorder.getRecorderState().analyzing).toBe(false);
    expect(library.motions).toEqual([]);
  });
});

describe('aller-retour du journal (audit du 03/11, C4)', () => {
  it("le GPX refait depuis le journal est celui de l'arrêt, à l'octet : pauses automatique et manuelle, note, activité changée", async () => {
    const source = fakeSource();
    await recorder.startRecording(baseActivity('wingfoil'), source);
    for (let s = 0; s < 120; s++) source.emit(s, 7);
    // Immobile plus longtemps que le délai de la pause automatique, puis reprise.
    for (let s = 120; s < 200; s++) source.emit(s, 0);
    for (let s = 200; s < 260; s++) source.emit(s, 6);
    recorder.addRecordingMark();
    // Pause manuelle : positions reçues pour la carte, jamais gardées.
    await recorder.pauseRecording();
    for (let s = 260; s < 290; s++) source.emit(s, 3);
    await recorder.resumeRecording();
    // D'une famille à l'autre : voile, puis surf.
    recorder.changeRecordingActivity(baseActivity('surf'));
    for (let s = 290; s < 340; s++) source.emit(s, 4);
    await recorder.stopRecording();
    const fromMemory = recorder.getRecorderState().saved!;
    expect(fromMemory.content).toContain('<type>surf</type>');
    expect((fromMemory.content.match(/<trkseg>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Le journal tel qu'au rangement de l'arrêt.
    const kept = library.journals[0];
    expect(kept).not.toBeNull();

    // Coupure avant son effacement : le journal remis tel quel, repris au lancement, rangé d'office.
    recorder.dismissRecorderResult();
    journal.text = kept;
    await recorder.recoverInterruptedRecording();
    const fromJournal = recorder.getRecorderState().saved!;
    expect(fromJournal.recovered).toBe(true);
    expect(fromJournal.rangedBy).toBe('recovery');
    expect(recorder.getRecorderState().landOnRecording).toBe(false);
    expect(fromJournal.pointCount).toBe(fromMemory.pointCount);
    expect(fromJournal.content).toBe(fromMemory.content);
    expect(journal.text).toBeNull();
  });
});

describe('boutons de secours de la ceinture (lot 232)', () => {
  const BELT = { address: '00:11:22:33:44:55', name: 'Ceinture' };
  /** Lignes de la ceinture écrites au journal, dans l'ordre. */
  const beltLines = (): string[] => (journal.text ?? '').split('\n').filter((l) => l.startsWith('["belt"')).map((l) => JSON.parse(l)[2] as string);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("injoignable au départ : retenue de côté, « Réessayer » la reprend, le message s'efface et rien d'autre ne bouge", async () => {
    permissions.notificationsDenied = true;
    try {
      belt.holdFails = new Error('Bluetooth éteint');
      const source = fakeSource();
      await recorder.startRecording(activity, source, { heartRate: BELT });
      await settle();
      let state = recorder.getRecorderState();
      expect(state.beltAside).toBe('failed');
      expect(state.heartRate).toBeNull();
      expect(state.error).toContain('Ceinture cardio injoignable : Bluetooth éteint');
      expect(state.error).toMatch(/Notifications refusées/);
      belt.holdFails = null;
      await recorder.retryRecordingBelt();
      state = recorder.getRecorderState();
      expect(state.beltAside).toBeNull();
      expect(state.beltRetrying).toBe(false);
      expect(state.heartRate).not.toBeNull();
      expect(state.error ?? '').not.toContain('Ceinture cardio injoignable');
      // L'avertissement des notifications reste.
      expect(state.error).toMatch(/^Notifications refusées/);
      await settle();
      expect(beltLines()).toEqual(['asked']);
      expect(source.starts).toBe(1);
    } finally {
      permissions.notificationsDenied = false;
    }
  });

  it('injoignable puis de nouveau refusée : le message revient, une seule fois, et la proposition de réessayer reste', async () => {
    belt.holdFails = new Error('Bluetooth éteint');
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    belt.holdFails = new Error('permission refusée');
    await recorder.retakeRecordingBelt();
    const state = recorder.getRecorderState();
    expect(state.beltAside).toBe('failed');
    expect(state.error).toBe("Ceinture cardio injoignable : permission refusée. L'enregistrement continue sans elle.");
    await settle();
    expect(beltLines()).toEqual(['asked', 'failed']);
  });

  it('« Arrêter de chercher » sur une ceinture injoignable : le message part, « Reprendre la ceinture » la redemande', async () => {
    belt.holdFails = new Error('Bluetooth éteint');
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    recorder.stopRecordingBeltSearch();
    expect(recorder.getRecorderState().beltAside).toBe('stopped');
    expect(recorder.getRecorderState().error).toBeNull();
    belt.holdFails = null;
    const holds = belt.holds;
    await recorder.retakeRecordingBelt();
    expect(belt.holds).toBe(holds + 1);
    expect(recorder.getRecorderState().beltAside).toBeNull();
    expect(recorder.getRecorderState().heartRate).not.toBeNull();
    await settle();
    expect(beltLines()).toEqual(['stopped', 'asked']);
  });

  it('reprise après « Arrêter de chercher » : la veille de la FC repart de zéro, rien avant la première mesure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    belt.emit(T0, 100);
    recorder.stopRecordingBeltSearch();
    beltWatch.arms = [];
    await recorder.retakeRecordingBelt();
    expect(beltWatch.arms).toEqual([]);
    belt.emit(T0 + 5000, 100);
    expect(beltWatch.arms).toEqual([60_000]);
  });

  it('Pause et Reprendre passent pendant une prise de la ceinture qui ne rend pas la main ; la ceinture prise ensuite suit la session', async () => {
    belt.holdFails = new Error('Bluetooth éteint');
    const source = fakeSource();
    await recorder.startRecording(activity, source, { heartRate: BELT });
    belt.holdFails = null;
    let open!: () => void;
    belt.holdGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const retake = recorder.retakeRecordingBelt();
    try {
      await settle();
      expect(recorder.getRecorderState().beltRetrying).toBe(true);
      await recorder.pauseRecording();
      expect(recorder.getRecorderState().status).toBe('paused');
      expect(recorder.getRecorderState().pausedReason).toBe('manual');
      await recorder.resumeRecording();
      expect(recorder.getRecorderState().status).toBe('recording');
      await recorder.pauseRecording();
      expect(recorder.getRecorderState().status).toBe('paused');
    } finally {
      open();
    }
    await retake;
    expect(recorder.getRecorderState().heartRate).not.toBeNull();
    expect(recorder.getRecorderState().beltAside).toBeNull();
    expect(recorder.getRecorderState().beltRetrying).toBe(false);
    expect(recorder.getRecorderState().status).toBe('paused');
  });

  it("Arrêter pendant une prise de la ceinture qui ne rend pas la main : l'arrêt passe, la ceinture prise ensuite est rendue", async () => {
    belt.holdFails = new Error('Bluetooth éteint');
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    belt.holdFails = null;
    let open!: () => void;
    belt.holdGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const retake = recorder.retakeRecordingBelt();
    let releases = 0;
    try {
      await settle();
      await recorder.stopRecording();
      expect(recorder.getRecorderState().status).toBe('idle');
      expect(recorder.getRecorderState().beltRetrying).toBe(false);
      releases = belt.releases;
    } finally {
      open();
    }
    await retake;
    expect(belt.releases).toBe(releases + 1);
    expect(recorder.getRecorderState().heartRate).toBeNull();
    expect(recorder.getRecorderState().beltAside).toBeNull();
  });

  it("« Arrêter de chercher » pendant la reprise l'emporte : la ceinture prise ensuite est rendue aussitôt", async () => {
    belt.holdFails = new Error('Bluetooth éteint');
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    belt.holdFails = null;
    let open!: () => void;
    belt.holdGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const retake = recorder.retakeRecordingBelt();
    try {
      await settle();
      expect(recorder.getRecorderState().beltRetrying).toBe(true);
      recorder.stopRecordingBeltSearch();
      expect(recorder.getRecorderState().beltRetrying).toBe(false);
    } finally {
      open();
    }
    const releases = belt.releases;
    await retake;
    expect(belt.releases).toBe(releases + 1);
    expect(recorder.getRecorderState().heartRate).toBeNull();
    expect(recorder.getRecorderState().beltAside).toBe('stopped');
    expect(recorder.getRecorderState().beltRetrying).toBe(false);
  });

  it('ceinture tenue encore cherchée : « Réessayer » demande au téléphone une recherche tout de suite, sans la lâcher', async () => {
    belt.state = 'searching';
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    const releases = belt.releases;
    await recorder.retryRecordingBelt();
    expect(belt.retries).toBe(1);
    expect(belt.releases).toBe(releases);
    expect(recorder.getRecorderState().beltRetrying).toBe(false);
    belt.retrySeen = false;
    await recorder.retryRecordingBelt();
    belt.retrySeen = new Error('Bluetooth éteint');
    await recorder.retryRecordingBelt();
    await settle();
    expect(beltLines()).toEqual(['retry', 'found', 'retry', 'missed', 'retry', 'failed']);
  });

  it('hors enregistrement, rien : ni essai, ni reprise, ni ligne au journal', async () => {
    await recorder.retryRecordingBelt();
    await recorder.retakeRecordingBelt();
    recorder.stopRecordingBeltSearch();
    expect(belt.retries).toBe(0);
    expect(recorder.getRecorderState().beltAside).toBeNull();
  });

  it('muscu : « Réessayer » ne lâche jamais la ceinture, « Reprendre la ceinture » est sans effet', async () => {
    belt.state = 'lost';
    await recorder.startRecording(baseActivity('muscu'), null, { heartRate: BELT });
    const releases = belt.releases;
    await recorder.retryRecordingBelt();
    expect(belt.retries).toBe(1);
    await recorder.retakeRecordingBelt();
    expect(belt.releases).toBe(releases);
    expect(recorder.getRecorderState().heartRate).not.toBeNull();
  });

  it("l'arrêt efface la ceinture laissée de côté : rien ne reste à la session suivante", async () => {
    belt.holdFails = new Error('Bluetooth éteint');
    await recorder.startRecording(activity, fakeSource(), { heartRate: BELT });
    expect(recorder.getRecorderState().beltAside).toBe('failed');
    await recorder.stopRecording();
    expect(recorder.getRecorderState().beltAside).toBeNull();
    belt.holdFails = null;
    await recorder.savePendingSession();
    recorder.dismissRecorderResult();
    await recorder.startRecording(activity, fakeSource());
    await recorder.retakeRecordingBelt();
    expect(recorder.getRecorderState().heartRate).toBeNull();
  });
});

describe('boutons de secours du GPS (lot 232)', () => {
  const gpsLines = (): string[] => (journal.text ?? '').split('\n').filter((l) => l.startsWith('["gps"')).map((l) => JSON.parse(l)[2] as string);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("en attente de la première position depuis le départ, plus après elle ; jamais pour une session sans position", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    expect(recorder.getRecorderState().awaitingFix).toBe(true);
    source.emit(0);
    expect(recorder.getRecorderState().awaitingFix).toBe(false);
    await recorder.stopRecording();
    await recorder.savePendingSession();
    recorder.dismissRecorderResult();
    await recorder.startRecording(baseActivity('muscu'), null, { heartRate: { address: '00:11:22:33:44:55', name: 'Ceinture' } });
    expect(recorder.getRecorderState().awaitingFix).toBe(false);
  });

  it('localisation coupée, dite par la source : retenue pour la page, effacée à la position suivante', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.fail('Localisation coupée', 'locationOff');
    expect(recorder.getRecorderState().locationOff).toBe(true);
    expect(recorder.getRecorderState().error).toBe('Localisation coupée');
    source.fail('Autre panne');
    expect(recorder.getRecorderState().locationOff).toBe(false);
    source.fail('Localisation coupée', 'locationOff');
    source.emit(0);
    expect(recorder.getRecorderState().locationOff).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
  });

  it('localisation rendue, dite par le service (lot 232, étape 2) : alerte rouge et message partis avant toute position', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.fail('Localisation coupée', 'locationOff');
    expect(recorder.getRecorderState().locationOff).toBe(true);
    source.locationBack();
    expect(recorder.getRecorderState().locationOff).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
    // Toujours en attente de la première position : la page le redit.
    expect(recorder.getRecorderState().awaitingFix).toBe(true);
    // Sans localisation dite coupée : rien ne bouge, un autre message reste.
    source.fail('Autre panne');
    source.locationBack();
    expect(recorder.getRecorderState().error).toBe('Autre panne');
  });

  it('au départ, le service reçoit la session, ses textes en français et les seuils du profil', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    const header = parseJournal(journal.text!).header!;
    expect(source.options?.notificationTitle).toBe('Tracker enregistre');
    expect(source.options?.service).toMatchObject({
      session: header.startedAtMs,
      closedText: "Application fermée : l'enregistrement continue",
      gpsLostTitle: 'GPS perdu',
      stoppedTitle: 'Enregistrement arrêté',
      gpsLostDelayS: 60,
      gpsLostRearmS: 120,
      guardStillRadiusM: 200,
      guardStillDelayS: 3600,
      guardMaxClosedS: 12 * 3600,
      guardMovingHoldS: 5,
    });
    // Vitesse de la garde à pied : 2 km/h.
    expect(source.options?.service?.guardMovingSpeedMs).toBeCloseTo(2 / 3.6, 6);
  });

  it('pause manuelle et reprise dites au service, à l\'heure des lignes du journal', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    for (let s = 0; s <= 10; s++) source.emit(s);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 11_000);
    await recorder.pauseRecording();
    vi.setSystemTime(T0 + 15_000);
    await recorder.resumeRecording();
    vi.useRealTimers();
    expect(source.pauses).toEqual([{ paused: true, atMs: T0 + 11_000 }, { paused: false, atMs: T0 + 15_000 }]);
    expect(journal.text).toContain(`["pause",${T0 + 11_000}`);
    expect(journal.text).toContain(`["resume",${T0 + 15_000}]`);
  });

  it("« Réessayer » : « nouvelle tentative… » 5 s, un second appui ignoré, l'appui et son résultat au journal ; rien d'autre ne bouge", async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await recorder.retryRecordingGps();
    expect(recorder.getRecorderState().gpsRetrying).toBe(true);
    await recorder.retryRecordingGps();
    vi.advanceTimersByTime(4_999);
    expect(recorder.getRecorderState().gpsRetrying).toBe(true);
    vi.advanceTimersByTime(1);
    expect(recorder.getRecorderState().gpsRetrying).toBe(false);
    vi.useRealTimers();
    await settle();
    // Navigateur : rien n'a pu partir vers le téléphone.
    expect(gpsLines()).toEqual(['retry', 'unassisted']);
    expect(source.starts).toBe(1);
    expect(source.stops).toBe(0);
    expect(source.active).toBe(true);
  });

  it("« Activer la localisation » : une ligne au journal, l'enregistrement continue ; hors enregistrement, rien", async () => {
    await recorder.openRecordingLocationSettings();
    expect(journal.text).toBeNull();
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    await recorder.openRecordingLocationSettings();
    await settle();
    expect(gpsLines()).toEqual(['settings']);
    expect(recorder.getRecorderState().status).toBe('recording');
  });
});
