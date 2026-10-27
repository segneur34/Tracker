import { describe, expect, it } from 'vitest';
import { firstIndexAfter, firstIndexAtOrAfter, firstIndexAtOrAfterTime, lastIndexAtOrBeforeTime, partitionPoint } from './search';

describe('recherches dichotomiques', () => {
  const values = [1, 3, 3, 3, 7, 9];
  const points = values.map((timeMs) => ({ timeMs }));

  it('trouve la frontière d\'une suite vrai puis faux', () => {
    expect(partitionPoint(0, () => true)).toBe(0);
    expect(partitionPoint(5, () => true)).toBe(5);
    expect(partitionPoint(5, () => false)).toBe(0);
    expect(partitionPoint(10, (i) => i < 4)).toBe(4);
  });

  it('donne le premier rang à la valeur ou après, doublons compris', () => {
    expect(firstIndexAtOrAfter(values, 0)).toBe(0);
    expect(firstIndexAtOrAfter(values, 3)).toBe(1);
    expect(firstIndexAtOrAfter(values, 4)).toBe(4);
    expect(firstIndexAtOrAfter(values, 9)).toBe(5);
    expect(firstIndexAtOrAfter(values, 10)).toBe(6);
    expect(firstIndexAtOrAfter([], 1)).toBe(0);
  });

  it('donne le premier rang strictement après', () => {
    expect(firstIndexAfter(values, 3)).toBe(4);
    expect(firstIndexAfter(values, 0)).toBe(0);
    expect(firstIndexAfter(values, 9)).toBe(6);
  });

  it('cherche par l\'instant d\'une trace', () => {
    expect(firstIndexAtOrAfterTime(points, 3)).toBe(1);
    expect(firstIndexAtOrAfterTime(points, 10)).toBe(6);
    expect(lastIndexAtOrBeforeTime(points, 0)).toBe(-1);
    expect(lastIndexAtOrBeforeTime(points, 3)).toBe(3);
    expect(lastIndexAtOrBeforeTime(points, 8)).toBe(4);
    expect(lastIndexAtOrBeforeTime(points, 100)).toBe(5);
    expect(lastIndexAtOrBeforeTime([], 1)).toBe(-1);
  });

  it('marche sur un tableau typé, comme les instants d\'un fichier de capteurs', () => {
    expect(firstIndexAtOrAfter(new Float64Array([0, 10, 20]), 15)).toBe(2);
  });
});
