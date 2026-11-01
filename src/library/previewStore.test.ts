import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewBackend } from '../platform/previewStore';
import { createPreviewStore } from './previewStore';
import { PREVIEW_FORMAT_VERSION, encodePreview, roundPreviewPoints, type PreviewTrack } from './previewTracks';

/** Document factice : lectures et écritures comptées. */
const fakeBackend = (initial: string | null = null) => {
  const backend = {
    text: initial,
    reads: 0,
    writes: 0,
    read: async () => {
      backend.reads++;
      return backend.text;
    },
    write: async (text: string) => {
      backend.writes++;
      backend.text = text;
    },
  };
  return backend satisfies PreviewBackend;
};

/** Trace de `n` points à 1 Hz (ou `hz`), arrondie comme la page la garde. */
const trackOf = (n: number, zoom = 15, hz = 1): PreviewTrack => ({
  zoom,
  bounds: [[43.5, 3.8], [43.6, 3.9]],
  suggested: null,
  points: roundPreviewPoints(Array.from({ length: n * hz }, (_, i) => ({ lat: 43.5 + i * 1e-5 / hz, lon: 3.8 + i * 2e-5 / hz, colorMs: 3 + (i % 7) / 3 }))),
});

const OPTIONS = { maxBytes: 3e6, writeDelayMs: 2000 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('vignettes gardées sur l’appareil', () => {
  it.each([1, 5])('garde une trace et la relit au lancement suivant, à l’identique (%i Hz)', async (hz) => {
    const backend = fakeBackend();
    const first = createPreviewStore(backend, OPTIONS);
    const track = trackOf(50, 15, hz);
    await first.keep('T|a.gpx', 'fp1', track);
    expect(backend.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.writes).toBe(1);

    const next = createPreviewStore(backend, OPTIONS);
    expect(await next.stored('T|a.gpx', 'fp1')).toEqual(track);
  });

  it('lit le document une seule fois', async () => {
    const backend = fakeBackend();
    const store = createPreviewStore(backend, OPTIONS);
    await Promise.all([store.stored('a', 'fp'), store.stored('b', 'fp'), store.keep('c', 'fp', trackOf(10))]);
    await store.stored('c', 'fp');
    expect(backend.reads).toBe(1);
  });

  it('écrit après le calme, une fois pour plusieurs traces', async () => {
    const backend = fakeBackend();
    const store = createPreviewStore(backend, OPTIONS);
    await store.keep('a', 'fp', trackOf(10));
    await vi.advanceTimersByTimeAsync(1500);
    await store.keep('b', 'fp', trackOf(10));
    await vi.advanceTimersByTimeAsync(1500);
    expect(backend.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.writes).toBe(1);
    expect(Object.keys(JSON.parse(backend.text!).entries).sort()).toEqual(['a', 'b']);
    // Relire n'écrit rien.
    await store.stored('a', 'fp');
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.writes).toBe(1);
  });

  it('flush écrit aussitôt ce qui a changé, et rien sinon', async () => {
    const backend = fakeBackend();
    const store = createPreviewStore(backend, OPTIONS);
    await store.flush();
    expect(backend.writes).toBe(0);
    await store.keep('a', 'fp', trackOf(10));
    await store.flush();
    expect(backend.writes).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.writes).toBe(1);
  });

  it('ignore une entrée d’une autre empreinte, puis la remplace', async () => {
    const store = createPreviewStore(fakeBackend(), OPTIONS);
    await store.keep('a', 'ancienne', trackOf(10));
    expect(await store.stored('a', 'nouvelle')).toBeNull();
    await store.keep('a', 'nouvelle', trackOf(12));
    expect((await store.stored('a', 'nouvelle'))?.points).toHaveLength(12);
    expect(await store.stored('a', 'ancienne')).toBeNull();
  });

  it('document illisible : vide, puis réécrit', async () => {
    const backend = fakeBackend('{pas du json');
    const store = createPreviewStore(backend, OPTIONS);
    expect(await store.stored('a', 'fp')).toBeNull();
    await store.keep('a', 'fp', trackOf(10));
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(backend.text!).version).toBe(PREVIEW_FORMAT_VERSION);
  });

  it('borne : oublie les moins récemment vues ; une trace plus grosse que la borne n’est pas gardée', async () => {
    const size = JSON.stringify(encodePreview(trackOf(100), 'fp', 1_000_000)).length + 1;
    const store = createPreviewStore(fakeBackend(), { maxBytes: size * 2.5, writeDelayMs: 2000 });
    await store.keep('a', 'fp', trackOf(100));
    vi.setSystemTime(2_000_000);
    await store.keep('b', 'fp', trackOf(100));
    vi.setSystemTime(3_000_000);
    // « a » vue : c'est « b » la moins récente.
    expect(await store.stored('a', 'fp')).not.toBeNull();
    vi.setSystemTime(4_000_000);
    await store.keep('c', 'fp', trackOf(100));
    expect(await store.stored('b', 'fp')).toBeNull();
    expect(await store.stored('a', 'fp')).not.toBeNull();
    expect(await store.stored('c', 'fp')).not.toBeNull();

    await store.keep('c', 'fp2', trackOf(1000));
    expect(await store.stored('c', 'fp2')).toBeNull();
    // L'ancienne trace de la même session, périmée, part aussi.
    expect(await store.stored('c', 'fp')).toBeNull();
  });

  it('oublie au nettoyage les sessions que la bibliothèque ne porte plus', async () => {
    const backend = fakeBackend();
    const store = createPreviewStore(backend, OPTIONS);
    await store.keep('T|a.gpx', 'fp', trackOf(10));
    await store.keep('T|b.gpx', 'fp', trackOf(10));
    await store.flush();
    await store.prune('T', ['a.gpx', 'b.gpx']);
    await vi.advanceTimersByTimeAsync(2000);
    // Rien d'oublié, rien de réécrit.
    expect(backend.writes).toBe(1);
    await store.prune('T', ['a.gpx']);
    expect(await store.stored('T|b.gpx', 'fp')).toBeNull();
    expect(await store.stored('T|a.gpx', 'fp')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.writes).toBe(2);
  });

  it('écriture refusée : retentée à la suivante', async () => {
    const backend = fakeBackend();
    let refuse = true;
    const store = createPreviewStore({
      read: backend.read,
      write: async (text) => {
        if (refuse) throw new Error('plein');
        await backend.write(text);
      },
    }, OPTIONS);
    await store.keep('a', 'fp', trackOf(10));
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.writes).toBe(0);
    refuse = false;
    await store.flush();
    expect(backend.writes).toBe(1);
  });
});
