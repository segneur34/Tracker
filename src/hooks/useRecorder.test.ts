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
