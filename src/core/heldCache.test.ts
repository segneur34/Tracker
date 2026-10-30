import { describe, expect, it } from 'vitest';
import { createHeldCache } from './heldCache';

describe('createHeldCache', () => {
  it('libère les moins récemment demandées au-delà du plafond', () => {
    const disposed: string[] = [];
    const cache = createHeldCache<string>(2, (v) => disposed.push(v));
    for (const k of ['a', 'b']) {
      cache.put(k, k.toUpperCase());
      cache.release(k);
    }
    // « a » redemandée : « b » est la plus ancienne.
    expect(cache.acquire('a')).toBe('A');
    cache.release('a');
    cache.put('c', 'C');
    cache.release('c');
    expect(disposed).toEqual(['B']);
    expect(cache.acquire('b')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('ne libère jamais une valeur retenue, et la libère une fois relâchée', () => {
    const disposed: string[] = [];
    const cache = createHeldCache<string>(1, (v) => disposed.push(v));
    cache.put('a', 'A');
    cache.put('b', 'B');
    expect(disposed).toEqual([]);
    expect(cache.size).toBe(2);
    cache.release('a');
    expect(disposed).toEqual(['A']);
    expect(cache.size).toBe(1);
  });

  it('rend la valeur déjà rangée sous la même clé et libère la nouvelle', () => {
    const disposed: string[] = [];
    const cache = createHeldCache<string>(5, (v) => disposed.push(v));
    cache.put('a', 'A1');
    expect(cache.put('a', 'A2')).toBe('A1');
    expect(disposed).toEqual(['A2']);
    // Retenue deux fois : il faut deux relâches pour qu'elle puisse partir.
    cache.release('a');
    const small = createHeldCache<string>(0, (v) => disposed.push(v));
    small.put('x', 'X');
    small.acquire('x');
    small.release('x');
    expect(disposed).toEqual(['A2']);
    small.release('x');
    expect(disposed).toEqual(['A2', 'X']);
  });
});
