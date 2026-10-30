import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserTileStore } from './tileCache';

/** Cache API factice : réponses rangées par chemin, lectures comptées. */
class FakeCache {
  readonly entries = new Map<string, Response>();
  matches = 0;

  private path(request: RequestInfo | URL): string {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    return new URL(url, 'http://local').pathname;
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    this.matches++;
    return this.entries.get(this.path(request))?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    // Le corps est lu, comme le fait le navigateur.
    const body = await response.arrayBuffer();
    this.entries.set(this.path(request), new Response(body, { headers: response.headers }));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((p) => new Request(`http://local${p}`));
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.path(request));
  }
}

const fakeStorage = () => {
  let cache = new FakeCache();
  return {
    get cache() { return cache; },
    open: async () => cache as unknown as Cache,
    delete: async () => { cache = new FakeCache(); return true; },
  };
};

const tile = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tuiles gardées dans le navigateur', () => {
  it('liste les tuiles écrites, sans celles effacées', async () => {
    const store = createBrowserTileStore(fakeStorage());
    await store.write('14_1_1', tile(10));
    vi.setSystemTime(2_000_000);
    await store.write('sat_14_1_2', tile(30));
    await store.remove(['14_1_1']);
    expect(await store.list()).toEqual([{ key: 'sat_14_1_2', bytes: 30, savedAtMs: 2_000_000 }]);
    expect((await store.read('sat_14_1_2'))?.savedAtMs).toBe(2_000_000);
    expect(await store.read('14_1_1')).toBeNull();
  });

  it('range l’index après une seconde de calme ; la page suivante le relit sans lire chaque tuile', async () => {
    const storage = fakeStorage();
    const first = createBrowserTileStore(storage);
    for (let i = 0; i < 5; i++) await first.write(`14_1_${i}`, tile(10 + i));
    expect(storage.cache.entries.has('/tuiles-gardees/_index.json')).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.cache.entries.has('/tuiles-gardees/_index.json')).toBe(true);

    const next = createBrowserTileStore(storage);
    storage.cache.matches = 0;
    const listed = await next.list();
    expect(listed.map((e) => e.key).sort()).toEqual(['14_1_0', '14_1_1', '14_1_2', '14_1_3', '14_1_4']);
    expect(listed.find((e) => e.key === '14_1_3')?.bytes).toBe(13);
    // L'index seul est lu.
    expect(storage.cache.matches).toBe(1);
  });

  it('refait l’index en lisant chaque tuile s’il manque, ou s’il ne compte pas les tuiles du cache', async () => {
    const storage = fakeStorage();
    const first = createBrowserTileStore(storage);
    await first.write('14_1_1', tile(10));
    await first.write('14_1_2', tile(20));
    await first.flushIndex();
    // Une tuile gardée par une page fermée avant d'avoir rangé l'index.
    await storage.cache.put('/tuiles-gardees/14_1_3.png', new Response(tile(30), { headers: { 'content-length': '30', 'x-tracker-saved-at': '5' } }));
    const next = createBrowserTileStore(storage);
    // L'index rangé sert aussitôt, puis il est refait en arrière-plan.
    expect(await next.list()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect((await next.list()).map((e) => [e.key, e.bytes]).sort()).toEqual([['14_1_1', 10], ['14_1_2', 20], ['14_1_3', 30]]);

    storage.cache.entries.delete('/tuiles-gardees/_index.json');
    const bare = createBrowserTileStore(storage);
    expect(await bare.list()).toHaveLength(3);
    // Refait, il est rangé de nouveau.
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.cache.entries.has('/tuiles-gardees/_index.json')).toBe(true);
  });

  it('vide tout, index compris', async () => {
    const storage = fakeStorage();
    const store = createBrowserTileStore(storage);
    await store.write('14_1_1', tile(10));
    await store.clear();
    expect(await store.list()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await createBrowserTileStore(storage).list()).toEqual([]);
  });

  it('ne garde rien sans Cache API', async () => {
    const store = createBrowserTileStore(null);
    await store.write('14_1_1', tile(10));
    expect(await store.read('14_1_1')).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});
