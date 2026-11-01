import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewImageBackend } from '../platform/previewImages';
import { createPreviewImageStore } from './previewImageStore';
import { PREVIEW_IMAGE_INDEX_VERSION, previewImageName } from './previewImages';

/** Magasin factice : fichiers en mémoire, index en texte, écritures comptées. */
const fakeBackend = (initialIndex: string | null = null, initialFiles: Record<string, Blob> = {}) => {
  const backend = {
    index: initialIndex,
    files: new Map<string, Blob>(Object.entries(initialFiles)),
    indexReads: 0,
    indexWrites: 0,
    refuseWrite: false,
    readIndex: async () => {
      backend.indexReads++;
      return backend.index;
    },
    writeIndex: async (text: string) => {
      backend.indexWrites++;
      backend.index = text;
    },
    read: async (name: string) => backend.files.get(name) ?? null,
    write: async (name: string, blob: Blob) => {
      if (backend.refuseWrite) throw new Error('plein');
      backend.files.set(name, blob);
    },
    remove: async (names: readonly string[]) => {
      for (const name of names) backend.files.delete(name);
    },
    names: async () => [...backend.files.keys()],
  };
  return backend satisfies PreviewImageBackend;
};

/** PNG factice de `bytes` octets, au contenu reconnaissable. */
const png = (bytes: number, fill = 1): Blob => new Blob([new Uint8Array(bytes).fill(fill)], { type: 'image/png' });

const firstByte = async (blob: Blob | null): Promise<number | null> =>
  blob ? new Uint8Array(await blob.arrayBuffer())[0] : null;

const OPTIONS = { maxBytes: 10_000, writeDelayMs: 2000 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('images de vignettes gardées sur l’appareil', () => {
  it('garde une image et la relit au lancement suivant, à l’identique', async () => {
    const backend = fakeBackend();
    const first = createPreviewImageStore(backend, OPTIONS);
    await first.keep('T|a.gpx', 'k1', png(1000, 7));
    expect(backend.files.size).toBe(1);
    expect(backend.indexWrites).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.indexWrites).toBe(1);

    const next = createPreviewImageStore(backend, OPTIONS);
    const kept = await next.stored('T|a.gpx', 'k1');
    expect(kept?.size).toBe(1000);
    expect(await firstByte(kept)).toBe(7);
  });

  it('lit l’index une seule fois ; relire n’écrit rien', async () => {
    const backend = fakeBackend();
    const store = createPreviewImageStore(backend, OPTIONS);
    await Promise.all([store.stored('a', 'k'), store.stored('b', 'k'), store.keep('c', 'k', png(100))]);
    await store.flush();
    expect(await store.stored('c', 'k')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.indexReads).toBe(1);
    expect(backend.indexWrites).toBe(1);
  });

  it('une autre clé (taille, bornes, trace) : rien de montré, puis remplacée, l’ancienne image effacée', async () => {
    const backend = fakeBackend();
    const store = createPreviewImageStore(backend, OPTIONS);
    await store.keep('a', 'ancienne', png(100, 1));
    expect(await store.stored('a', 'nouvelle')).toBeNull();
    await store.keep('a', 'nouvelle', png(200, 2));
    expect(await firstByte(await store.stored('a', 'nouvelle'))).toBe(2);
    expect(await store.stored('a', 'ancienne')).toBeNull();
    expect([...backend.files.keys()]).toEqual([previewImageName('a', 'nouvelle')]);
  });

  it('même image regardée : rien de réécrit', async () => {
    const backend = fakeBackend();
    const store = createPreviewImageStore(backend, OPTIONS);
    await store.keep('a', 'k', png(100));
    await store.flush();
    const write = vi.spyOn(backend, 'write');
    await store.keep('a', 'k', png(100));
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).not.toHaveBeenCalled();
    expect(backend.indexWrites).toBe(1);
  });

  it('borne : oublie les moins récemment vues ; une image plus grosse que la borne n’est pas gardée', async () => {
    const backend = fakeBackend();
    const store = createPreviewImageStore(backend, { maxBytes: 2500, writeDelayMs: 2000 });
    await store.keep('a', 'k', png(1000));
    vi.setSystemTime(2_000_000);
    await store.keep('b', 'k', png(1000));
    vi.setSystemTime(3_000_000);
    // « a » vue : c'est « b » la moins récente.
    expect(await store.stored('a', 'k')).not.toBeNull();
    vi.setSystemTime(4_000_000);
    await store.keep('c', 'k', png(1000));
    expect(await store.stored('b', 'k')).toBeNull();
    expect(await store.stored('a', 'k')).not.toBeNull();
    expect(await store.stored('c', 'k')).not.toBeNull();
    expect(backend.files.size).toBe(2);

    await store.keep('c', 'k2', png(3000));
    expect(await store.stored('c', 'k2')).toBeNull();
    // L'ancienne image de la même session, périmée, part aussi.
    expect(await store.stored('c', 'k')).toBeNull();
    expect([...backend.files.keys()]).toEqual([previewImageName('a', 'k')]);
  });

  it('oublie au nettoyage les sessions que la bibliothèque ne porte plus, fichiers compris', async () => {
    const backend = fakeBackend();
    const store = createPreviewImageStore(backend, OPTIONS);
    await store.keep('T|a.gpx', 'k', png(100));
    await store.keep('T|b.gpx', 'k', png(100));
    await store.flush();
    await store.prune('T', ['a.gpx', 'b.gpx']);
    await vi.advanceTimersByTimeAsync(2000);
    // Rien d'oublié, rien de réécrit.
    expect(backend.indexWrites).toBe(1);
    await store.prune('T', ['a.gpx']);
    expect(await store.stored('T|b.gpx', 'k')).toBeNull();
    expect(await store.stored('T|a.gpx', 'k')).not.toBeNull();
    expect([...backend.files.keys()]).toEqual([previewImageName('T|a.gpx', 'k')]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.indexWrites).toBe(2);
  });

  it('au chargement : images orphelines effacées, entrées sans image retirées', async () => {
    const kept = previewImageName('a', 'k');
    const lost = previewImageName('b', 'k');
    const index = JSON.stringify({
      version: PREVIEW_IMAGE_INDEX_VERSION,
      entries: { a: { image: 'k', name: kept, bytes: 100, usedAt: 1 }, b: { image: 'k', name: lost, bytes: 100, usedAt: 1 } },
    });
    const backend = fakeBackend(index, { [kept]: png(100), orphelin1: png(100), orphelin2: png(100) });
    const store = createPreviewImageStore(backend, OPTIONS);
    expect(await store.stored('a', 'k')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect([...backend.files.keys()]).toEqual([kept]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(Object.keys(JSON.parse(backend.index!).entries)).toEqual(['a']);
  });

  it('image illisible : entrée retirée, la vignette sera redessinée', async () => {
    const name = previewImageName('a', 'k');
    const index = JSON.stringify({ version: PREVIEW_IMAGE_INDEX_VERSION, entries: { a: { image: 'k', name, bytes: 100, usedAt: 1 } } });
    const backend = fakeBackend(index, { [name]: png(100) });
    const store = createPreviewImageStore({ ...backend, read: async () => null }, OPTIONS);
    expect(await store.stored('a', 'k')).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(backend.index!).entries).toEqual({});
  });

  it('index illisible ou d’une autre version : vide, ses images effacées comme orphelines', async () => {
    const backend = fakeBackend('{pas du json', { vieille: png(100) });
    const store = createPreviewImageStore(backend, OPTIONS);
    expect(await store.stored('a', 'k')).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.files.size).toBe(0);
    await store.keep('a', 'k', png(100));
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(backend.index!).version).toBe(PREVIEW_IMAGE_INDEX_VERSION);
  });

  it('écriture d’image refusée : rien de gardé ; écriture d’index refusée : retentée à la suivante', async () => {
    const backend = fakeBackend();
    const store = createPreviewImageStore(backend, OPTIONS);
    backend.refuseWrite = true;
    await store.keep('a', 'k', png(100));
    expect(await store.stored('a', 'k')).toBeNull();
    backend.refuseWrite = false;

    let refuse = true;
    const indexed = createPreviewImageStore({
      ...backend,
      writeIndex: async (text) => {
        if (refuse) throw new Error('plein');
        await backend.writeIndex(text);
      },
    }, OPTIONS);
    await indexed.keep('b', 'k', png(100));
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.indexWrites).toBe(0);
    refuse = false;
    await indexed.flush();
    expect(backend.indexWrites).toBe(1);
  });
});
