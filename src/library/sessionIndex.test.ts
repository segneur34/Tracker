import { describe, expect, it } from 'vitest';
import { indexed, type ListIndex } from './sessionIndex';

interface Item {
  file: string;
  startMs: number;
}

describe('index d’une liste de sessions (lot 113)', () => {
  it('garde la première de chaque clé, comme `find`', () => {
    const index: ListIndex<Item, number> = new WeakMap();
    const list = [{ file: 'a', startMs: 1 }, { file: 'b', startMs: 1 }, { file: 'c', startMs: 2 }];
    const map = indexed(index, list, (s) => s.startMs);
    expect(map.get(1)?.file).toBe('a');
    expect(map.get(2)?.file).toBe('c');
    expect(map.get(3)).toBeUndefined();
  });

  it('reprend l’index tant que la liste est la même, en refait un pour une liste remplacée', () => {
    const index: ListIndex<Item, string> = new WeakMap();
    const list = [{ file: 'a', startMs: 1 }];
    let calls = 0;
    const key = (s: Item) => {
      calls += 1;
      return s.file;
    };
    const first = indexed(index, list, key);
    expect(indexed(index, list, key)).toBe(first);
    expect(calls).toBe(1);
    const replaced = [...list, { file: 'b', startMs: 2 }];
    expect(indexed(index, replaced, key).get('b')?.startMs).toBe(2);
    expect(calls).toBe(3);
  });
});
