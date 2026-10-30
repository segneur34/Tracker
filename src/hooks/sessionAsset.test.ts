import { describe, expect, it } from 'vitest';
import { createSessionAssetCache } from './sessionAsset';

/** Promesse résolue ou rejetée à la main. */
const deferred = <V>() => {
  let resolve!: (v: V) => void;
  const promise = new Promise<V>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('createSessionAssetCache', () => {
  it('cherche une fois, range une fois, garde le résultat et prévient les abonnés', async () => {
    const cache = createSessionAssetCache<number>();
    let computed = 0;
    const stored: number[] = [];
    let notified = 0;
    cache.subscribe(() => notified++);
    const d = deferred<number>();
    const compute = () => {
      computed++;
      return d.promise;
    };
    const first = cache.run('a', compute, (v) => stored.push(v));
    expect(cache.get('a')).toBeUndefined();
    d.resolve(7);
    await first;
    expect(cache.get('a')).toBe(7);
    expect(computed).toBe(1);
    expect(stored).toEqual([7]);
    expect(notified).toBe(1);
    expect(cache.version()).toBe(1);
  });

  it('trace recalculée pendant la demande : la même recherche, un seul rangement', async () => {
    const cache = createSessionAssetCache<string>();
    let computed = 0;
    const stored: string[] = [];
    const d = deferred<string>();
    const compute = () => {
      computed++;
      return d.promise;
    };
    // L'effet relancé par une trace recalculée demande la même clé pendant la recherche.
    const first = cache.run('t', compute, (v) => stored.push(v));
    const second = cache.run('t', compute, (v) => stored.push(v));
    expect(second).toBe(first);
    d.resolve('voies');
    await Promise.all([first, second]);
    expect(computed).toBe(1);
    expect(stored).toEqual(['voies']);
  });

  it('erreur puis réessai : la recherche est relancée et rangée', async () => {
    const cache = createSessionAssetCache<number>();
    const stored: number[] = [];
    let calls = 0;
    const compute = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('réseau')) : Promise.resolve(3);
    };
    await expect(cache.run('k', compute, (v) => stored.push(v))).rejects.toThrow('réseau');
    expect(cache.get('k')).toBeUndefined();
    expect(cache.version()).toBe(0);
    expect(stored).toEqual([]);
    await expect(cache.run('k', compute, (v) => stored.push(v))).resolves.toBe(3);
    expect(calls).toBe(2);
    expect(stored).toEqual([3]);
    expect(cache.get('k')).toBe(3);
  });

  it('clés distinctes : recherches distinctes ; désabonné, plus prévenu', async () => {
    const cache = createSessionAssetCache<number>();
    let notified = 0;
    const off = cache.subscribe(() => notified++);
    await cache.run('1', () => Promise.resolve(1));
    off();
    await cache.run('2', () => Promise.resolve(2));
    expect(notified).toBe(1);
    expect(cache.get('1')).toBe(1);
    expect(cache.get('2')).toBe(2);
    expect(cache.version()).toBe(2);
  });
});
