import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachDeviceLocation, clearLoggedFixes, createReplaySource, currentPosition, deviceLocationSource, deviceLocationState,
  locationPermissionGranted, readLoggedFixes, stopOrphanedDeviceLocation, type LocationFix, type LocationWatchOptions,
} from './location';

/**
 * Greffon `Recording` simulé, tel que `RecordingPlugin.java` répond (lot 232, étape 2) : un service, son journal, ses écouteurs, et la
 * suite des appels reçus. Un refus porte un code, comme `call.reject(message, code)`.
 */
const plugin = vi.hoisted(() => {
  type Listener = (data: Record<string, unknown>) => void;
  const refusal = (code: string) => Object.assign(new Error('message du téléphone, jamais montré'), { code });
  const fake = {
    calls: [] as string[],
    running: false,
    session: null as number | null,
    paused: false,
    started: null as Record<string, unknown> | null,
    pauses: [] as { paused: boolean; atMs: number }[],
    log: null as string | null,
    logReads: [] as (number | undefined)[],
    /** Code du refus du prochain `start`, `clearLog` ou `currentPosition` ; `null` : il aboutit. */
    startRefusal: null as string | null,
    clearRefusal: null as string | null,
    positionRefusal: null as string | null,
    /** L'arrêt attend ceci avant de finir. */
    stopGate: null as Promise<void> | null,
    listeners: { fix: new Set<Listener>(), error: new Set<Listener>(), locationEnabled: new Set<Listener>() },
    state: async () => ({ running: fake.running, session: fake.running ? fake.session : null, paused: fake.paused }),
    start: async (options: Record<string, unknown>) => {
      fake.calls.push('start');
      if (fake.startRefusal) throw refusal(fake.startRefusal);
      fake.running = true;
      fake.session = options.session as number;
      fake.paused = false;
      fake.started = options;
      return fake.state();
    },
    stop: async () => {
      fake.calls.push('stop');
      await fake.stopGate;
      fake.running = false;
      fake.paused = false;
      fake.calls.push('stopped');
    },
    setPaused: async (options: { paused: boolean; atMs: number }) => {
      fake.calls.push('setPaused');
      fake.pauses.push(options);
      fake.paused = options.paused;
      return fake.state();
    },
    readLog: async (options: { afterMs?: number }) => {
      fake.logReads.push(options.afterMs);
      return { text: fake.log };
    },
    clearLog: async () => {
      fake.calls.push('clearLog');
      if (fake.clearRefusal) throw refusal(fake.clearRefusal);
      fake.log = null;
    },
    currentPosition: async () => {
      fake.calls.push('currentPosition');
      if (fake.positionRefusal) throw refusal(fake.positionRefusal);
      return { timeMs: 1_794_819_600_000, lat: 43.5, lon: 3.5, accuracyM: 6 };
    },
    checkPermissions: async () => ({ location: 'granted', notification: 'denied' }),
    requestPermissions: async () => ({ location: 'granted', notification: 'granted' }),
    addListener: async (event: 'fix' | 'error' | 'locationEnabled', listener: Listener) => {
      fake.calls.push(`listen:${event}`);
      fake.listeners[event].add(listener);
      return {
        remove: async () => {
          fake.listeners[event].delete(listener);
        },
      };
    },
    emit: (timeMs: number) => fake.listeners.fix.forEach((l) => l({ timeMs, lat: 43, lon: 3, accuracyM: 5, speedMs: 2.5 })),
    fail: (code: string) => fake.listeners.error.forEach((l) => l({ code, message: 'message du téléphone, jamais montré' })),
    locationBack: () => fake.listeners.locationEnabled.forEach((l) => l({})),
  };
  return fake;
});
const runtime = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({ registerPlugin: (name: string) => (name === 'Recording' ? plugin : {}) }));
vi.mock('./runtime', () => ({ isNativeApp: () => runtime.native }));

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const OPTIONS = { intervalMs: 1000, distanceFilterM: 0, notificationTitle: '', notificationText: '' };
const track: LocationFix[] = [0, 1, 2, 5, 10].map((s) => ({ timeMs: T0 + s * 1000, lat: 43, lon: 3 }));

describe('createReplaySource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('émet chaque position à son heure, divisée par le facteur, avec l\'heure d\'origine', async () => {
    const received: number[] = [];
    await createReplaySource(track, 10).start(OPTIONS, (f) => received.push(f.timeMs), () => {});

    expect(received).toEqual([T0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(received).toEqual([T0, T0 + 1000, T0 + 2000]);
    await vi.advanceTimersByTimeAsync(900);
    expect(received).toHaveLength(5);
    expect(received[4]).toBe(T0 + 10_000);
  });

  it('n\'émet plus rien une fois arrêté', async () => {
    const received: number[] = [];
    const stop = await createReplaySource(track, 1).start(OPTIONS, (f) => received.push(f.timeMs), () => {});
    await vi.advanceTimersByTimeAsync(1500);
    await stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(received).toEqual([T0, T0 + 1000]);
  });

  it('rattrape d\'un coup les positions échues quand la minuterie prend du retard', async () => {
    const received: number[] = [];
    await createReplaySource(track, 1).start(OPTIONS, (f) => received.push(f.timeMs), () => {});
    // Horloge avancée sans laisser tourner les minuteries, comme un onglet mis en sommeil.
    vi.setSystemTime(Date.now() + 6000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toEqual([T0, T0 + 1000, T0 + 2000, T0 + 5000]);
  });
});

const SERVICE = {
  session: T0,
  closedText: 'fermée',
  gpsLostTitle: 'GPS perdu',
  stoppedTitle: 'arrêté',
  stoppedText: 'à ranger',
  gpsLostDelayS: 60,
  gpsLostRearmS: 120,
  guardStillRadiusM: 200,
  guardStillDelayS: 3600,
  guardMaxClosedS: 43_200,
  guardMovingSpeedMs: 0.77,
  guardMovingHoldS: 5,
};
const NATIVE_OPTIONS: LocationWatchOptions = { intervalMs: 1000, distanceFilterM: 0, notificationTitle: 'titre', notificationText: 'texte', service: SERVICE };

describe('service de position du téléphone', () => {
  beforeEach(() => {
    runtime.native = true;
    Object.assign(plugin, {
      calls: [], running: false, session: null, paused: false, started: null, pauses: [], log: null, logReads: [],
      startRefusal: null, clearRefusal: null, positionRefusal: null, stopGate: null,
    });
    plugin.listeners.fix.clear();
    plugin.listeners.error.clear();
    plugin.listeners.locationEnabled.clear();
  });
  afterEach(() => {
    runtime.native = false;
  });

  it('départ : la page écoute avant de démarrer, et donne au service la session, ses textes et ses délais', async () => {
    const received: LocationFix[] = [];
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, (f) => received.push(f), () => {});
    expect(plugin.calls).toEqual(['listen:fix', 'listen:error', 'listen:locationEnabled', 'start']);
    expect(plugin.started).toEqual({ ...SERVICE, intervalMs: 1000, distanceFilterM: 0, title: 'titre', text: 'texte' });

    plugin.emit(T0);
    plugin.emit(T0 + 1000);
    expect(received.map((f) => f.timeMs)).toEqual([T0, T0 + 1000]);
    expect(received[0]).toEqual({ timeMs: T0, lat: 43, lon: 3, accuracyM: 5, altitudeM: undefined, speedMs: 2.5, bearingDeg: undefined });
    await stop();
  });

  it("arrêt : le service s'arrête, l'écoute est retirée ensuite, et il suffit d'une fois", async () => {
    const received: number[] = [];
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, (f) => received.push(f.timeMs), () => {});
    await Promise.all([stop(), stop()]);
    expect(plugin.calls.filter((c) => c === 'stop')).toHaveLength(1);
    expect(plugin.running).toBe(false);
    expect(plugin.listeners.fix.size).toBe(0);
    expect(plugin.listeners.error.size).toBe(0);
    expect(plugin.listeners.locationEnabled.size).toBe(0);
    plugin.emit(T0);
    expect(received).toEqual([]);
  });

  it("un départ attend la fin de l'arrêt en cours", async () => {
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, () => {}, () => {});
    let open!: () => void;
    plugin.stopGate = new Promise((resolve) => {
      open = resolve;
    });
    const stopping = stop();
    await Promise.resolve();
    const starting = deviceLocationSource().start({ ...NATIVE_OPTIONS, service: { ...SERVICE, session: T0 + 1 } }, () => {}, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plugin.calls.filter((c) => c === 'start')).toHaveLength(1);
    open();
    await stopping;
    const stopAgain = await starting;
    expect(plugin.calls.indexOf('stopped')).toBeLessThan(plugin.calls.lastIndexOf('start'));
    expect(plugin.session).toBe(T0 + 1);
    await stopAgain();
  });

  it('refus du départ : traduit par son code, écoute retirée, service jamais arrêté pour autant', async () => {
    plugin.startRefusal = 'NOT_AUTHORIZED';
    await expect(deviceLocationSource().start(NATIVE_OPTIONS, () => {}, () => {})).rejects.toThrow(/Réglages/);
    plugin.startRefusal = 'START_FAILED';
    const failed = await deviceLocationSource().start(NATIVE_OPTIONS, () => {}, () => {}).then(() => null, (err: Error) => err.message);
    expect(failed).toBe('Localisation indisponible.');
    expect(plugin.listeners.fix.size).toBe(0);
    expect(plugin.calls).not.toContain('stop');
  });

  it('sans session à suivre : refusé avant tout appel', async () => {
    await expect(deviceLocationSource().start(OPTIONS, () => {}, () => {})).rejects.toThrow();
    expect(plugin.calls).toEqual([]);
  });

  it('erreurs du service : localisation coupée dite avec sa cause, refus traduit, journal en échec tu', async () => {
    const errors: [string, string | undefined][] = [];
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, () => {}, (message, cause) => errors.push([message, cause]));
    plugin.fail('LOCATION_DISABLED');
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toContain('Localisation du téléphone coupée');
    expect(errors[0][1]).toBe('locationOff');
    plugin.fail('NOT_AUTHORIZED');
    expect(errors[1][0]).toContain('Réglages');
    plugin.fail('LOG_FAILED');
    expect(errors).toHaveLength(2);
    expect(errors.flat().join(' ')).not.toContain('jamais montré');
    await stop();
    plugin.fail('LOCATION_DISABLED');
    expect(errors).toHaveLength(2);
  });

  it('localisation rendue : dite à la page par son événement, sans erreur, et plus rien une fois arrêté', async () => {
    const events: string[] = [];
    const stop = await deviceLocationSource().start(
      NATIVE_OPTIONS, () => {}, (_message, cause) => events.push(`erreur:${cause ?? ''}`), () => events.push('rendue')
    );
    plugin.fail('LOCATION_DISABLED');
    plugin.locationBack();
    expect(events).toEqual(['erreur:locationOff', 'rendue']);
    // Un abonné en échec ne coupe pas l'écoute.
    const failing = await attachDeviceLocation(() => {}, () => {}, () => {
      throw new Error('abonné en échec');
    });
    expect(() => plugin.locationBack()).not.toThrow();
    expect(events).toEqual(['erreur:locationOff', 'rendue', 'rendue']);
    await stop();
    await failing();
    plugin.locationBack();
    expect(events).toHaveLength(3);
  });

  it('un abonné en échec ne coupe pas l\'écoute', async () => {
    const received: number[] = [];
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, (f) => {
      received.push(f.timeMs);
      throw new Error('abonné en échec');
    }, () => {
      throw new Error('abonné en échec');
    });
    expect(() => plugin.emit(T0)).not.toThrow();
    expect(() => plugin.fail('LOCATION_DISABLED')).not.toThrow();
    plugin.emit(T0 + 1000);
    expect(received).toEqual([T0, T0 + 1000]);
    await stop();
  });

  it('une position sans heure ou sans coordonnées est écartée', async () => {
    const received: number[] = [];
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, (f) => received.push(f.timeMs), () => {});
    plugin.listeners.fix.forEach((l) => l({ lat: 43, lon: 3 }));
    plugin.listeners.fix.forEach((l) => l({ timeMs: T0, lat: 'x', lon: 3 }));
    expect(received).toEqual([]);
    await stop();
  });

  it('pause manuelle : transmise au service avec son heure', async () => {
    const source = deviceLocationSource();
    const stop = await source.start(NATIVE_OPTIONS, () => {}, () => {});
    await source.setPaused?.(true, T0 + 5000);
    await source.setPaused?.(false, T0 + 9000);
    expect(plugin.pauses).toEqual([{ paused: true, atMs: T0 + 5000 }, { paused: false, atMs: T0 + 9000 }]);
    await stop();
  });

  it('état du service : en route, sa session et sa pause ; arrêté, rien', async () => {
    expect(await deviceLocationState()).toEqual({ running: false, session: null, paused: false });
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, () => {}, () => {});
    await deviceLocationSource().setPaused?.(true, T0);
    expect(await deviceLocationState()).toEqual({ running: true, session: T0, paused: true });
    await stop();
    expect(await deviceLocationState()).toEqual({ running: false, session: null, paused: false });
  });

  it('raccord au service resté en route : la page écoute de nouveau, sans jamais le relancer', async () => {
    plugin.running = true;
    plugin.session = T0;
    const received: number[] = [];
    const stop = await attachDeviceLocation((f) => received.push(f.timeMs), () => {});
    expect(plugin.calls).toEqual(['listen:fix', 'listen:error', 'listen:locationEnabled']);
    plugin.emit(T0 + 1000);
    expect(received).toEqual([T0 + 1000]);
    // Écouté par la page : il n'est pas orphelin.
    await stopOrphanedDeviceLocation();
    expect(plugin.running).toBe(true);
    await stop();
    expect(plugin.running).toBe(false);
    expect(plugin.listeners.fix.size).toBe(0);
  });

  it('service orphelin : arrêté quand personne ne l\'écoute', async () => {
    plugin.running = true;
    await stopOrphanedDeviceLocation();
    expect(plugin.running).toBe(false);
  });

  it('journal du service : lu après l\'heure donnée, ou en entier ; effacé sans jamais lever', async () => {
    plugin.log = '{"format":"tracker-positions","version":1,"session":1}\n';
    expect(await readLoggedFixes(T0)).toBe(plugin.log);
    expect(await readLoggedFixes(null)).toBe(plugin.log);
    expect(plugin.logReads).toEqual([T0, undefined]);
    plugin.clearRefusal = 'RUNNING';
    await expect(clearLoggedFixes()).resolves.toBeUndefined();
    expect(plugin.log).not.toBeNull();
    plugin.clearRefusal = null;
    await clearLoggedFixes();
    expect(await readLoggedFixes(null)).toBeNull();
  });

  it('une seule position : sans service ni écoute, possible pendant un enregistrement', async () => {
    const stop = await deviceLocationSource().start(NATIVE_OPTIONS, () => {}, () => {});
    plugin.calls = [];
    expect(await currentPosition(15_000)).toMatchObject({ timeMs: 1_794_819_600_000, lat: 43.5, lon: 3.5, accuracyM: 6 });
    expect(plugin.calls).toEqual(['currentPosition']);
    expect(plugin.running).toBe(true);
    await stop();
  });

  it('une seule position refusée : une phrase en clair selon le code', async () => {
    plugin.positionRefusal = 'TIMEOUT';
    await expect(currentPosition()).rejects.toThrow(/Position introuvable/);
    plugin.positionRefusal = 'LOCATION_DISABLED';
    await expect(currentPosition()).rejects.toThrow(/Position introuvable/);
    plugin.positionRefusal = 'NOT_AUTHORIZED';
    await expect(currentPosition()).rejects.toThrow(/Réglages/);
    plugin.positionRefusal = 'START_FAILED';
    await expect(currentPosition()).rejects.toThrow('Localisation indisponible.');
  });

  it('autorisation de position : lue chez le greffon, sans rien demander', async () => {
    expect(await locationPermissionGranted()).toBe(true);
  });
});

describe('navigateur : aucun service', () => {
  beforeEach(() => {
    plugin.calls = [];
  });

  it('ni état, ni journal, ni raccord : le greffon n\'est jamais appelé', async () => {
    expect(await deviceLocationState()).toEqual({ running: false, session: null, paused: false });
    expect(await readLoggedFixes(T0)).toBeNull();
    await clearLoggedFixes();
    await stopOrphanedDeviceLocation();
    await expect(attachDeviceLocation(() => {}, () => {})).rejects.toThrow();
    expect(deviceLocationSource().setPaused).toBeUndefined();
    expect(plugin.calls).toEqual([]);
  });
});
