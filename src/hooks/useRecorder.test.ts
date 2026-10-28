import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity } from '../core/activities';
import type { LocationFix, LocationSource } from '../platform/location';

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

const recorder = await import('./useRecorder');
const live = await import('./useLiveRecording');

const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);
const activity = baseActivity('running');

/** Source simulée : compte ses démarrages, émet à la demande tant qu'elle tourne. */
const fakeSource = () => {
  let onFix: ((fix: LocationFix) => void) | null = null;
  const source = {
    starts: 0,
    label: 'Simulée',
    start: async (_options: unknown, fix: (f: LocationFix) => void) => {
      source.starts += 1;
      // Un démarrage qui prend un peu de temps, comme le greffon.
      await new Promise((resolve) => setTimeout(resolve, 5));
      onFix = fix;
      return async () => {
        onFix = null;
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

  it('deux « Reprendre » sans attendre : un seul redémarrage de la source (D-B3)', async () => {
    const source = fakeSource();
    await recorder.startRecording(activity, source);
    source.emit(0);
    source.emit(1);
    await recorder.pauseRecording();
    await Promise.all([recorder.resumeRecording(), recorder.resumeRecording()]);
    expect(source.starts).toBe(2);
    expect(recorder.getRecorderState().status).toBe('recording');
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
