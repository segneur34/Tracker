import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix, LocationSource } from '../platform/location';
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

/** Ceinture simulée : prise et rendue sans Bluetooth, mesures émises à la demande ; le service au premier plan relevé. */
const belt = vi.hoisted(() => {
  const listeners = new Set<(sample: { bpm: number; timeMs: number; contact: boolean | null }) => void>();
  return {
    listeners,
    keepAlive: 0,
    stopKeepAlive: 0,
    /** Ceintures rendues par l'enregistreur. */
    releases: 0,
    emit: (timeMs: number, bpm: number, contact: boolean | null = true) => listeners.forEach((l) => l({ bpm, timeMs, contact })),
  };
});
vi.mock('../platform/heartRate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/heartRate')>()),
  holdBelt: async () => () => {
    belt.releases += 1;
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
 * Rangement simulé : les capteurs reçus par la bibliothèque, dans l'ordre. `gate` : le rangement attend cette
 * promesse ; `fails` : il échoue ensuite, comme une écriture refusée.
 */
const library = vi.hoisted(() => ({ motions: [] as (Uint8Array | null)[], gate: null as Promise<void> | null, fails: false }));
vi.mock('./useSessionLibrary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useSessionLibrary')>()),
  saveRecordedSession: async (_text: string, _sport: unknown, _activityId: unknown, _intervals: unknown, motion: Uint8Array | null) => {
    library.motions.push(motion);
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

const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);
const activity = baseActivity('running');

/** Source simulée : compte ses démarrages et ses arrêts, dit si elle tourne, émet à la demande tant qu'elle tourne. */
const fakeSource = () => {
  let onFix: ((fix: LocationFix) => void) | null = null;
  const source = {
    starts: 0,
    stops: 0,
    active: false,
    /** Durée du prochain arrêt, en millisecondes ; un second arrêt pendant le premier rend la main tout de suite. */
    stopDelayMs: 5,
    label: 'Simulée',
    start: async (_options: unknown, fix: (f: LocationFix) => void) => {
      source.starts += 1;
      // Un démarrage qui prend un peu de temps, comme le greffon.
      await new Promise((resolve) => setTimeout(resolve, 5));
      onFix = fix;
      source.active = true;
      let stopping = false;
      return async () => {
        // Un arrêt qui prend un peu de temps, lui aussi.
        const delay = stopping ? 0 : source.stopDelayMs;
        stopping = true;
        await new Promise((resolve) => setTimeout(resolve, delay));
        onFix = null;
        source.active = false;
        source.stops += 1;
      };
    },
    emit: (s: number, speedMs = 3) => onFix?.({ timeMs: T0 + s * 1000, lat: 43 + s * 1e-5, lon: 3, speedMs, accuracyM: 4 }),
  };
  return source satisfies LocationSource & object;
};

/** Ramène l'enregistreur au repos, session jetée. */
const reset = async () => {
  await recorder.stopRecording();
  await recorder.discardPendingSession();
  recorder.dismissRecorderResult();
};

beforeEach(() => {
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
    const content = recorder.getRecorderState().pending!.content;
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
    const pending = recorder.getRecorderState().pending;
    expect(pending).not.toBeNull();
    expect(pending!.content.match(/<trkseg>/g)).toHaveLength(2);
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
    expect(recorder.getRecorderState().pending).not.toBeNull();
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
    expect(recorder.getRecorderState().pending).not.toBeNull();
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
    expect(recorder.getRecorderState().pending).not.toBeNull();
  });
});

describe('journal sans en-tête lisible (D13)', () => {
  it('reprend la session sans deviner son activité : à classer, GPX sans type', async () => {
    journal.text = [0, 1, 2].map((s) => journalFixLine({ timeMs: T0 + s * 1000, lat: 43 + s * 1e-4, lon: 3, speedMs: 3, accuracyM: 4 })).join('');
    await recorder.recoverInterruptedRecording();
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

describe('enregistreur sans position (muscu, lot I du 25/10)', () => {
  const muscu = baseActivity('muscu');
  const ceinture = { address: '00:11:22:33:44:55', name: 'Ceinture' };
  /** Mesure à `s` secondes de T0. */
  const at = (s: number, bpm = 100, contact: boolean | null = true) => belt.emit(T0 + s * 1000, bpm, contact);

  it('refuse le départ sans ceinture, et le dit', async () => {
    await recorder.startRecording(muscu, null);
    expect(recorder.getRecorderState().status).toBe('idle');
    expect(recorder.getRecorderState().error).toMatch(/ceinture/);
    expect(journal.headers).toBe(0);
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
    // Journal gardé jusqu'à « Analyser » : les mesures, puis le point de l'arrêt.
    expect(journal.text?.match(/\["hr",/g)).toHaveLength(4);
    expect(belt.stopKeepAlive).toBeGreaterThan(before.stop);
    const pending = recorder.getRecorderState().pending!;
    expect(pending.pointCount).toBe(3);
    expect(pending.sport).toBe('muscu');
    expect(pending.content).not.toContain('lat=');
    expect(pending.content.match(/<gpxtpx:hr>/g)).toHaveLength(3);
    // Le point de l'arrêt, sans FC, après la dernière mesure.
    expect(pending.content.match(/<trkpt>/g)).toHaveLength(4);
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
    const pending = recorder.getRecorderState().pending!;
    expect(pending.content.match(/<trkseg>/g)).toHaveLength(2);
    expect(pending.marks).toHaveLength(1);
  });

  it('moins de deux mesures : rien à garder, et le dit', async () => {
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    at(0);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().pending).toBeNull();
    expect(recorder.getRecorderState().error).toMatch(/mesures de la ceinture/);
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
    const pending = recorder.getRecorderState().pending!;
    expect(pending.recovered).toBe(true);
    expect(pending.sport).toBe('muscu');
    expect(pending.pointCount).toBe(4);
    expect(pending.content.match(/<trkseg>/g)).toHaveLength(2);
    expect(pending.marks).toEqual([{ timeMs: T0 + 500, lat: null, lon: null, label: null }]);
  });

  it('ne passe pas d’une muscu à une activité à positions en cours de route', async () => {
    await recorder.startRecording(muscu, null, { heartRate: ceinture });
    recorder.changeRecordingActivity(activity);
    expect(recorder.getRecorderState().activity?.id).toBe('muscu');
  });
});

describe('prévenir quand ça rate (lot 115)', () => {
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

  it("« Arrêter de chercher » (lot 198) : la ceinture est rendue, alerte et tuile retirées, plus rien ne la suit jusqu'à l'arrêt", async () => {
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
      const times = parseJournal(journal.text ?? '').fixes.map((f) => (f.timeMs - T0) / 1000);
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
    expect(recorder.getRecorderState().error).toMatch(/illisible .*gardé de côté/);
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
    expect(recorder.getRecorderState().error).toMatch(/gardé de côté/);
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
    expect(recorder.getRecorderState().error).toMatch(/non récupérée \(stockage muet\).*gardé de côté/);
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

  /** Enregistre deux positions avec les capteurs, puis arrête : l'alerte de l'arrêt. */
  const stopWith = async (stop: () => Promise<MotionCapture | null>): Promise<string | null> => {
    sensors.stop = stop;
    const source = fakeSource();
    await recorder.startRecording(activity, source, { motion: setup });
    source.emit(0);
    source.emit(1);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().pending).not.toBeNull();
    return recorder.getRecorderState().error;
  };

  it('capture complète : rien de dit', async () => {
    expect(await stopWith(async () => capture)).toBeNull();
  });

  it("échec d'écriture : dit en une phrase à l'arrêt", async () => {
    expect(await stopWith(async () => ({ ...capture, error: 'mémoire pleine' }))).toMatch(/écriture interrompue \(mémoire pleine\)/);
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

describe('capture à « Analyser » (lot 148, T2-1)', () => {
  const capture: MotionCapture = { path: `capteurs/${T0}.imu`, bytes: 4096, durationS: 2, samples: 200, longestGapS: 0.01, error: null };
  const setup = { placement: 'poitrine' as const, foil: true, jumps: true, cadence: false };

  /** Session de voile arrêtée, en attente : la capture n'a pas été lue à l'arrêt (chemin normal). */
  const stopped = async (): Promise<void> => {
    sensors.stop = async () => capture;
    const source = fakeSource();
    await recorder.startRecording(baseActivity('wingfoil'), source, { motion: setup });
    source.emit(0);
    source.emit(1);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().pending?.motion?.path).toBe(capture.path);
    expect(recorder.getRecorderState().pending?.motionBytes).toBeNull();
  };
  const unreadable = async (): Promise<Uint8Array | null> => {
    throw new Error('mémoire du pont');
  };

  it('qui lève : rien d\'effacé, ni rangé, session en attente et c\'est dit ; un nouvel essai réussi la range et l\'efface', async () => {
    await stopped();
    sensors.read = unreadable;
    expect(await recorder.analyzePendingSession()).toBeNull();
    const state = recorder.getRecorderState();
    expect(state.pending).not.toBeNull();
    expect(state.motionUnreadable).toBe(true);
    expect(state.error).toMatch(/capteurs/);
    expect(sensors.removed).toEqual([]);
    expect(library.motions).toEqual([]);
    expect(journal.text).not.toBeNull();

    const bytes = new Uint8Array([1, 2]);
    sensors.read = async () => bytes;
    expect((await recorder.analyzePendingSession())?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toEqual([bytes]);
    expect(sensors.removed).toEqual([capture.path]);
    expect(recorder.getRecorderState().pending).toBeNull();
    expect(recorder.getRecorderState().motionUnreadable).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
    expect(journal.text).toBeNull();
  });

  it('absente : la session est rangée sans elle', async () => {
    await stopped();
    sensors.read = async () => null;
    expect((await recorder.analyzePendingSession())?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toEqual([null]);
    expect(recorder.getRecorderState().motionUnreadable).toBe(false);
  });

  it('« Analyser sans les capteurs » : rangée sans elle, le fichier reste sur l\'appareil', async () => {
    await stopped();
    sensors.read = unreadable;
    await recorder.analyzePendingSession();
    expect((await recorder.analyzePendingSession(true))?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toEqual([null]);
    expect(sensors.removed).toEqual([]);
    expect(recorder.getRecorderState().pending).toBeNull();
    expect(recorder.getRecorderState().motionUnreadable).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
    expect(journal.text).toBeNull();
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

  it('lecture et `stat` qui échouent sans dire « introuvable » : pas d\'absence conclue, rien d\'effacé', async () => {
    await stopped();
    await readingThrough(new Error('mémoire du pont'), new Error('stockage muet'));
    expect(await recorder.analyzePendingSession()).toBeNull();
    expect(recorder.getRecorderState().motionUnreadable).toBe(true);
    expect(recorder.getRecorderState().pending).not.toBeNull();
    expect(sensors.removed).toEqual([]);
    expect(library.motions).toEqual([]);
  });

  it('absence prouvée par le greffon : rangée sans elle', async () => {
    await stopped();
    const missing = Object.assign(new Error("'readFile' failed because file does not exist."), { code: 'OS-PLUG-FILE-0008' });
    await readingThrough(missing, missing);
    expect((await recorder.analyzePendingSession())?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toEqual([null]);
  });

  it('« Jeter » après l\'échec : la capture est effacée, l\'avertissement retombe', async () => {
    await stopped();
    sensors.read = unreadable;
    await recorder.analyzePendingSession();
    await recorder.discardPendingSession();
    expect(sensors.removed).toEqual([capture.path]);
    expect(recorder.getRecorderState().motionUnreadable).toBe(false);
    expect(recorder.getRecorderState().error).toBeNull();
  });

  it('illisible : le drapeau du rangement retombe aussi', async () => {
    await stopped();
    sensors.read = unreadable;
    const run = recorder.analyzePendingSession();
    expect(recorder.getRecorderState().analyzing).toBe(true);
    expect(await run).toBeNull();
    expect(recorder.getRecorderState().analyzing).toBe(false);
    expect(recorder.getRecorderState().motionUnreadable).toBe(true);
  });
});

describe('rangement en cours, état du module (lot 161)', () => {
  /** Session arrêtée, en attente, dont le rangement attend `open()`. */
  const held = async (): Promise<() => void> => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    await recorder.stopRecording();
    expect(recorder.getRecorderState().pending).not.toBeNull();
    let open: () => void = () => undefined;
    library.gate = new Promise((resolve) => {
      open = resolve;
    });
    return () => open();
  };

  it('un second appel rend la même promesse, même avec un autre paramètre : un seul rangement ; le drapeau retombe après', async () => {
    const open = await held();
    expect(recorder.getRecorderState().analyzing).toBe(false);
    const first = recorder.analyzePendingSession();
    // Levé dès l'appel : la page qui le lit peint « Rangement… » avant le calcul.
    expect(recorder.getRecorderState().analyzing).toBe(true);
    expect(recorder.analyzePendingSession()).toBe(first);
    expect(recorder.analyzePendingSession(true)).toBe(first);
    open();
    expect((await first)?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toHaveLength(1);
    const state = recorder.getRecorderState();
    expect(state.analyzing).toBe(false);
    expect(state.pending).toBeNull();
    // La page rouverte entre-temps trouve la session rangée.
    expect(state.saved?.libraryFile).toBe('rangee.gpx');
    expect(await recorder.analyzePendingSession()).toBeNull();
    expect(library.motions).toHaveLength(1);
  });

  it('« Jeter » pendant le rangement ne fait rien : ni journal effacé, ni session retirée', async () => {
    const open = await held();
    const run = recorder.analyzePendingSession();
    const pending = recorder.getRecorderState().pending;
    await recorder.discardPendingSession();
    expect(journal.text).not.toBeNull();
    expect(recorder.getRecorderState().pending).toBe(pending);
    expect(recorder.getRecorderState().analyzing).toBe(true);
    open();
    expect((await run)?.libraryFile).toBe('rangee.gpx');
    expect(recorder.getRecorderState().saved?.libraryFile).toBe('rangee.gpx');
    expect(journal.text).toBeNull();
  });

  it('écriture en échec : le drapeau retombe, la session reste en attente et un nouvel essai est possible', async () => {
    const open = await held();
    library.fails = true;
    const failed = recorder.analyzePendingSession();
    open();
    expect(await failed).toBeNull();
    let state = recorder.getRecorderState();
    expect(state.analyzing).toBe(false);
    expect(state.pending).not.toBeNull();
    expect(state.error).toMatch(/écriture refusée/);
    expect(journal.text).not.toBeNull();

    library.fails = false;
    const retry = recorder.analyzePendingSession();
    expect(retry).not.toBe(failed);
    expect((await retry)?.libraryFile).toBe('rangee.gpx');
    expect(library.motions).toHaveLength(2);
    state = recorder.getRecorderState();
    expect(state.analyzing).toBe(false);
    expect(state.pending).toBeNull();
    expect(journal.text).toBeNull();
  });

  it('« Jeter » après un échec reprend son effet', async () => {
    const open = await held();
    library.fails = true;
    const failed = recorder.analyzePendingSession();
    open();
    await failed;
    await recorder.discardPendingSession();
    expect(recorder.getRecorderState().pending).toBeNull();
    expect(journal.text).toBeNull();
  });

  it('sans session en attente : rien à ranger, drapeau baissé', async () => {
    expect(await recorder.analyzePendingSession()).toBeNull();
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
    const fromMemory = recorder.getRecorderState().pending!;
    expect(fromMemory.content).toContain('<type>surf</type>');
    expect((fromMemory.content.match(/<trkseg>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const kept = journal.text;
    expect(kept).not.toBeNull();

    // Coupure : la session est jetée (journal effacé), le journal remis tel quel, puis repris au lancement.
    await recorder.discardPendingSession();
    journal.text = kept;
    await recorder.recoverInterruptedRecording();
    const fromJournal = recorder.getRecorderState().pending!;
    expect(fromJournal.recovered).toBe(true);
    expect(fromJournal.pointCount).toBe(fromMemory.pointCount);
    expect(fromJournal.content).toBe(fromMemory.content);
  });
});
