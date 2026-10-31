import { describe, expect, it } from 'vitest';
import { autocorrelation, firstStrongPeak, isPeak, refinedPeak } from './periodicity';

/** Signal de `n` cases tiré de `f(k)`, moyenne retirée. */
const signal = (n: number, f: (k: number) => number): Float64Array => {
  const x = Float64Array.from({ length: n }, (_, k) => f(k));
  const mean = x.reduce((s, v) => s + v, 0) / n;
  return x.map((v) => v - mean);
};

describe('période par autocorrélation', () => {
  it('trouve la période d’un sinus, affinée sous la case', () => {
    // Période de 13,3 cases : 1,5 Hz sur une grille de 0,05 s.
    const period = 13.3;
    const x = signal(121, (k) => Math.sin((2 * Math.PI * k) / period));
    const r = autocorrelation(x, 31);
    expect(r[0]).toBeCloseTo(1, 12);
    const k = firstStrongPeak(r, 2, 31, 0.5, 0.85);
    expect(k).toBe(13);
    expect(Math.abs(refinedPeak(r, k!) - period)).toBeLessThan(0.15);
  });

  it('retient la première période assez haute, pas son double, même plus haut', () => {
    // Période de 20 cases, un coup sur deux un peu plus fort : la crête à 40 dépasse celle à 20.
    const x = signal(200, (k) => Math.sin((2 * Math.PI * k) / 20) + 0.2 * Math.sin((2 * Math.PI * k) / 40));
    const r = autocorrelation(x, 45);
    expect(isPeak(r, 20) && isPeak(r, 40)).toBe(true);
    expect(r[40]).toBeGreaterThan(r[20]);
    expect(firstStrongPeak(r, 2, 45, 0.5, 0.85)).toBe(20);
    // Plus exigeant que la crête à 20 : le double l'emporte.
    expect(firstStrongPeak(r, 2, 45, 0.5, 0.99)).toBe(40);
  });

  it('ne trouve rien sur un bruit sans régularité', () => {
    let s = 7;
    const rand = () => {
      s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
      return s / 2_147_483_648 - 0.5;
    };
    const x = signal(121, () => rand());
    expect(firstStrongPeak(autocorrelation(x, 31), 2, 31, 0.5, 0.85)).toBeNull();
  });

  it('ne trouve rien sans crête dans la recherche : période plus longue que la plus longue cherchée', () => {
    // Période de 40 cases, recherche jusqu'à 31 : l'autocorrélation descend puis remonte sans crête.
    const x = signal(121, (k) => Math.sin((2 * Math.PI * k) / 40));
    expect(firstStrongPeak(autocorrelation(x, 31), 2, 31, 0.5, 0.85)).toBeNull();
  });
});
