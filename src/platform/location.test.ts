import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptRunningService, createReplaySource, currentPosition, deviceLocationSource, type LocationFix } from './location';

/**
 * Greffon simulé, comme `@capgo/background-geolocation` : un seul service et
 * un seul destinataire ; un second `start` est refusé (`ALREADY_STARTED`) et
 * `stop` arrête le service pour tout le monde.
 */
const plugin = vi.hoisted(() => {
  type Callback = (location?: { latitude: number; longitude: number; accuracy: number; time: number }, error?: { message: string; code?: string }) => void;
  const fake = {
    running: false,
    watch: null as Callback | null,
    starts: 0,
    /** Vrai : chaque `start` est refusé, comme un service tenu par un autre. */
    refuseAlways: false,
    start: async (_options: unknown, callback: Callback): Promise<void> => {
      fake.starts += 1;
      if (fake.running || fake.refuseAlways) {
        queueMicrotask(() => callback(undefined, { message: 'Service already started', code: 'ALREADY_STARTED' }));
        return;
      }
      fake.running = true;
      fake.watch = callback;
    },
    stop: async (): Promise<void> => {
      fake.running = false;
      fake.watch = null;
    },
    emit: (timeMs: number) => fake.watch?.({ latitude: 43, longitude: 3, accuracy: 5, time: timeMs }),
  };
  return fake;
});
const runtime = vi.hoisted(() => ({ native: false }));
vi.mock('@capgo/background-geolocation', () => ({ BackgroundGeolocation: plugin }));
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

describe('service GPS du téléphone partagé (D-B1)', () => {
  /** Laisse passer les promesses et les rappels en attente. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    runtime.native = true;
    Object.assign(plugin, { running: false, watch: null, starts: 0, refuseAlways: false });
  });
  afterEach(() => {
    runtime.native = false;
  });

  it('une recherche de position puis un enregistrement : la recherche est close, l\'enregistrement reçoit les positions', async () => {
    const search = currentPosition(15_000).then(() => 'trouvée', (err: Error) => err.message);
    await settle();
    expect(plugin.running).toBe(true);

    const received: number[] = [];
    const errors: string[] = [];
    const stop = await deviceLocationSource().start(OPTIONS, (f) => received.push(f.timeMs), (m) => errors.push(m));
    expect(await search).toBe("Recherche interrompue par l'enregistrement.");
    expect(plugin.starts).toBe(2);

    plugin.emit(T0);
    plugin.emit(T0 + 1000);
    expect(received).toEqual([T0, T0 + 1000]);
    expect(plugin.running).toBe(true);
    expect(errors).toEqual([]);

    await stop();
    expect(plugin.running).toBe(false);
  });

  it('une recherche de position pendant un enregistrement est refusée sans toucher au service', async () => {
    const received: number[] = [];
    const stop = await deviceLocationSource().start(OPTIONS, (f) => received.push(f.timeMs), () => {});
    await expect(currentPosition()).rejects.toThrow(/enregistrement/);
    expect(plugin.starts).toBe(1);
    plugin.emit(T0);
    expect(received).toEqual([T0]);
    await stop();
  });

  it('service déjà lancé : arrêté puis relancé une seule fois, sans message', async () => {
    plugin.running = true;
    const received: number[] = [];
    const errors: string[] = [];
    const stop = await deviceLocationSource().start(OPTIONS, (f) => received.push(f.timeMs), (m) => errors.push(m));
    await settle();
    expect(plugin.starts).toBe(2);
    plugin.emit(T0);
    expect(received).toEqual([T0]);
    expect(errors).toEqual([]);
    await stop();
  });

  it('service toujours refusé : une seule relance, puis un message en clair', async () => {
    plugin.refuseAlways = true;
    const errors: string[] = [];
    const stop = await deviceLocationSource().start(OPTIONS, () => {}, (m) => errors.push(m));
    await settle();
    await settle();
    expect(plugin.starts).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toMatch(/already/i);
    await stop();
  });
});

describe('raccord au service GPS resté vivant (lot 156)', () => {
  type Message = { pluginId?: string; methodName?: string; save?: boolean; success?: boolean; callbackId?: string; data?: unknown; error?: unknown };
  const LOCATION = { latitude: 43.5, longitude: 3.5, accuracy: 4, altitude: 2, speed: 3, bearing: 90, time: T0 + 1000 };
  const fromGps = (patch: Partial<Message> = {}): Message => ({
    pluginId: 'BackgroundGeolocation', methodName: 'start', callbackId: '123', save: true, success: true, data: { ...LOCATION }, ...patch,
  });

  /** Pont simulé, comme `native-bridge.js` : efface `data` une fois le message traité. */
  const fakeBridge = () => {
    const seen: Message[] = [];
    const bridge = {
      fromNative: (message: Message): void => {
        seen.push({ ...message });
        delete message.data;
        delete message.error;
      },
    };
    vi.stubGlobal('window', { Capacitor: bridge });
    return { bridge, seen };
  };

  beforeEach(() => {
    plugin.running = true;
    plugin.starts = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    plugin.running = false;
  });

  it('lit les positions au passage, les laisse à leur chemin, sans jamais relancer le service', async () => {
    const { bridge, seen } = fakeBridge();
    const fixes: LocationFix[] = [];
    const stop = adoptRunningService((fix) => fixes.push(fix), () => undefined);
    bridge.fromNative(fromGps());
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ timeMs: T0 + 1000, lat: 43.5, lon: 3.5, accuracyM: 4, altitudeM: 2, speedMs: 3, bearingDeg: 90 });
    expect(seen).toHaveLength(1);
    expect(plugin.starts).toBe(0);
    await stop();
  });

  it("ne garde que les positions du service : ni une réponse, ni un autre greffon, ni une autre méthode", async () => {
    const { bridge, seen } = fakeBridge();
    const fixes: LocationFix[] = [];
    const stop = adoptRunningService((fix) => fixes.push(fix), () => undefined);
    bridge.fromNative(fromGps({ pluginId: 'HeartRate' }));
    bridge.fromNative(fromGps({ methodName: 'stop' }));
    bridge.fromNative(fromGps({ save: false }));
    bridge.fromNative(fromGps({ success: false }));
    bridge.fromNative(fromGps({ data: undefined }));
    expect(fixes).toHaveLength(0);
    expect(seen).toHaveLength(5);
    await stop();
  });

  it('un refus du service va au rappel d\'erreur, en clair, sans relance ni position', async () => {
    const { bridge, seen } = fakeBridge();
    const fixes: LocationFix[] = [];
    const errors: string[] = [];
    const stop = adoptRunningService((fix) => fixes.push(fix), (message) => errors.push(message));
    const refusal = (error: unknown, patch: Partial<Message> = {}) => fromGps({ success: false, data: undefined, error, ...patch });

    bridge.fromNative(refusal({ message: 'Location services disabled.', code: 'NOT_AUTHORIZED' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Localisation du téléphone coupée');
    bridge.fromNative(refusal({ message: 'User denied location permission', code: 'NOT_AUTHORIZED' }));
    expect(errors[1]).toContain('Réglages');
    // Même sans appel gardé : un refus final en est encore un.
    bridge.fromNative(refusal({ message: 'Location services disabled.' }, { save: false }));
    expect(errors).toHaveLength(3);

    // Ceux d'un autre greffon, ou d'une autre méthode, ne le regardent pas.
    bridge.fromNative(refusal({ message: 'disabled' }, { pluginId: 'HeartRate' }));
    bridge.fromNative(refusal({ message: 'disabled' }, { methodName: 'stop' }));
    bridge.fromNative(fromGps({ success: false, data: undefined }));
    expect(errors).toHaveLength(3);

    expect(fixes).toHaveLength(0);
    expect(plugin.starts).toBe(0);
    expect(seen).toHaveLength(6);
    await stop();
    bridge.fromNative(refusal({ message: 'disabled' }));
    expect(errors).toHaveLength(3);
  });

  it('un rappel d\'erreur en échec ne coupe pas le pont', async () => {
    const { bridge, seen } = fakeBridge();
    const stop = adoptRunningService(() => undefined, () => {
      throw new Error('abonné en échec');
    });
    bridge.fromNative(fromGps({ success: false, data: undefined, error: { message: 'disabled' } }));
    expect(seen).toHaveLength(1);
    await stop();
  });

  it('un abonné en échec ne coupe pas le pont', async () => {
    const { bridge, seen } = fakeBridge();
    const stop = adoptRunningService(() => {
      throw new Error('abonné en échec');
    }, () => undefined);
    bridge.fromNative(fromGps());
    expect(seen).toHaveLength(1);
    await stop();
  });

  it("l'arrêt rend le pont, arrête le service, et il suffit d'une fois", async () => {
    const { bridge } = fakeBridge();
    const original = bridge.fromNative;
    const fixes: LocationFix[] = [];
    const stop = adoptRunningService((fix) => fixes.push(fix), () => undefined);
    expect(bridge.fromNative).not.toBe(original);
    await Promise.all([stop(), stop()]);
    expect(bridge.fromNative).toBe(original);
    expect(plugin.running).toBe(false);
    bridge.fromNative(fromGps());
    expect(fixes).toHaveLength(0);
  });

  it('détient le service : une position ponctuelle est refusée, un second raccord aussi', async () => {
    fakeBridge();
    runtime.native = true;
    const stop = adoptRunningService(() => undefined, () => undefined);
    expect(() => adoptRunningService(() => undefined, () => undefined)).toThrow();
    await expect(currentPosition()).rejects.toThrow();
    runtime.native = false;
    await stop();
  });

  it('sans pont : lève, la reprise retombe sur la mise en attente', () => {
    vi.stubGlobal('window', {});
    expect(() => adoptRunningService(() => undefined, () => undefined)).toThrow();
  });
});
