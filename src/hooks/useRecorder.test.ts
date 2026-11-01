import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix, LocationSource } from '../platform/location';
import { journalFixLine, parseJournal } from '../recording/journal';

/** Journal en mémoire ; chaque écriture complète (l'en-tête) est relevée. */
const journal = vi.hoisted(() => {
  const file = {
    text: null as string | null,
    headers: 0,
    read: async () => file.text,
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
vi.mock('../platform/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/files')>()),
  recordingJournal: journal,
}));

/** Ceinture simulée : prise et rendue sans Bluetooth, mesures émises à la demande ; le service au premier plan relevé. */
const belt = vi.hoisted(() => {
  const listeners = new Set<(sample: { bpm: number; timeMs: number; contact: boolean | null }) => void>();
  return {
    listeners,
    keepAlive: 0,
    stopKeepAlive: 0,
    emit: (timeMs: number, bpm: number, contact: boolean | null = true) => listeners.forEach((l) => l({ bpm, timeMs, contact })),
  };
});
vi.mock('../platform/heartRate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/heartRate')>()),
  holdBelt: async () => () => undefined,
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
}));

/** Capteurs simulés : la capture démarre et se met en pause ; sa reprise échoue à la demande. */
const sensors = vi.hoisted(() => ({ resumeFails: false }));
vi.mock('../platform/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/motion')>()),
  startMotionCapture: async () => undefined,
  pauseMotionCapture: async () => undefined,
  resumeMotionCapture: async () => {
    if (sensors.resumeFails) throw new Error('capteurs muets');
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
