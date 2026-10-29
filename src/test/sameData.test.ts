import { describe, expect, it } from 'vitest';
import { sameData } from './sameData';

describe('sameData', () => {
  it('dit égales deux données de même contenu, imbriquées, tableaux typés compris', () => {
    const make = () => ({ a: 1, b: 'x', c: [1, { d: null, e: [true] }], f: Float32Array.from([1.5, 2]) });
    expect(sameData(make(), make())).toBe(true);
    expect(sameData([], [])).toBe(true);
    expect(sameData(3, 3)).toBe(true);
  });

  it('dit inégales des données qui diffèrent par une feuille, une clé, une longueur ou un type', () => {
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData([1], { 0: 1 })).toBe(false);
    expect(sameData(Float32Array.from([1]), Float64Array.from([1]))).toBe(false);
    expect(sameData('1', 1)).toBe(false);
    expect(sameData(new Date(0), new Date(0))).toBe(false);
    expect(sameData({ [Symbol('s')]: 1 }, {})).toBe(false);
    expect(sameData(Object.assign([1], { extra: 2 }), [1])).toBe(false);
  });

  it('compte une clé valant undefined, comme le fait une égalité stricte', () => {
    expect(sameData({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    expect(sameData({ a: undefined }, { a: undefined })).toBe(true);
    const holey: unknown[] = [];
    holey[1] = 1;
    expect(sameData(holey, [undefined, 1])).toBe(false);
  });

  it('dit NaN égal à NaN, et 0 différent de −0, comme toEqual', () => {
    expect(sameData({ v: NaN }, { v: NaN })).toBe(true);
    expect(sameData([0], [-0])).toBe(false);
    expect([NaN]).toEqual([NaN]);
    expect([0]).not.toEqual([-0]);
  });
});
