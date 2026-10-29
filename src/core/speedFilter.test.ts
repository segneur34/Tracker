import { describe, expect, it } from 'vitest';
import {
  clampByAcceleration,
  linearSmoothByTime,
  meanFilterByTime,
  median,
  medianFilterByTime,
  medianFilterByTimeFrom,
} from './speedFilter';
import { sameData } from '../test/sameData';

const secondsToMs = (count: number, step = 1): number[] =>
  Array.from({ length: count }, (_, i) => i * step * 1000);

describe('median', () => {
  it('gère les tailles impaires et paires', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('renvoie zéro sur une série vide', () => {
    expect(median([])).toBe(0);
  });

  it('ne modifie pas la série d\'entrée', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('clampByAcceleration', () => {
  it('laisse passer une accélération plausible', () => {
    const speeds = [0, 2, 4, 6, 8];
    expect(clampByAcceleration(speeds, secondsToMs(5), 10)).toEqual(speeds);
  });

  it('remplace un pic impossible par la dernière valeur retenue', () => {
    const speeds = [5, 5, 300, 5, 5];
    expect(clampByAcceleration(speeds, secondsToMs(5), 10)).toEqual([5, 5, 5, 5, 5]);
  });

  it('juge l\'accélération sur la durée réelle entre deux points', () => {
    // Un aller-retour à 9 m/s : plausible en 1 s, aberrant en 0,2 s.
    expect(clampByAcceleration([0, 9, 0], [0, 1000, 2000], 10)[1]).toBe(9);
    expect(clampByAcceleration([0, 9, 0], [0, 200, 400], 10)[1]).toBe(0);
  });

  it('accepte un changement brutal qui se maintient', () => {
    // Départ arrêté puis 15 m/s tenus : pas une aberration, un vrai départ.
    const speeds = [0, 15, 15, 15, 15, 15, 15];
    const out = clampByAcceleration(speeds, secondsToMs(7), 10);
    expect(out[out.length - 1]).toBe(15);
  });

  it('ne se verrouille pas à basse vitesse à haute fréquence', () => {
    // À 5 Hz, l'accélération de 0 à 10 m/s en 0,2 s dépasse le seuil, mais la
    // vitesse se maintient : le filtre doit finir par la suivre.
    const speeds = [0, ...new Array(49).fill(10)];
    const out = clampByAcceleration(speeds, secondsToMs(50, 0.2), 10);
    expect(out[out.length - 1]).toBe(10);
    expect(out.filter((v) => v === 10).length).toBeGreaterThan(40);
  });

  it('neutralise une aberration de deux points, aller et retour', () => {
    // Un saut de position produit deux vitesses fausses consécutives.
    const speeds = [5, 5, 5, 505, 495, 5, 5, 5];
    const out = clampByAcceleration(speeds, secondsToMs(8), 10);
    expect(out).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it('neutralise une aberration sur les tout premiers points', () => {
    // Cas observé sur une vraie session : la montre n'a pas encore un bon fix,
    // les deux premiers points affichent 40 m/s, soit 80 nœuds.
    const speeds = [40, 40, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];
    const out = clampByAcceleration(speeds, secondsToMs(12), 10);
    expect(Math.max(...out)).toBeLessThanOrEqual(8);
  });

  it('rejette toute vitesse au-dessus du plafond du support, même tenue', () => {
    // Quatre secondes à 35 m/s : impossible en wingfoil, quoi qu'en dise l'accélération.
    const speeds = [8, 8, 8, 35, 35, 35, 35, 8, 8, 8];
    const out = clampByAcceleration(speeds, secondsToMs(10), { maxAccel: 10, maxSpeedMs: 30, maxOutlierSeconds: 6 });
    expect(Math.max(...out)).toBeLessThanOrEqual(8);
  });

  it('accepte un premier point normal', () => {
    const speeds = [8, 8, 8, 8, 8];
    expect(clampByAcceleration(speeds, secondsToMs(5), 10)[0]).toBe(8);
  });

  it('conserve la valeur précédente si le temps ne progresse pas', () => {
    expect(clampByAcceleration([5, 8], [0, 0], 10)).toEqual([5, 5]);
  });
});

describe('medianFilterByTime', () => {
  it('supprime un pic isolé', () => {
    const out = medianFilterByTime([5, 5, 50, 5, 5], secondsToMs(5), 3);
    expect(out[2]).toBe(5);
  });

  it('laisse une série constante inchangée', () => {
    expect(medianFilterByTime([4, 4, 4, 4], secondsToMs(4), 3)).toEqual([4, 4, 4, 4]);
  });

  it('borne la fenêtre par le temps et non par le nombre de points', () => {
    // À 5 Hz, une fenêtre de 3 s couvre 15 points : le pic de 3 points disparaît.
    const at5Hz = new Array(50).fill(5);
    at5Hz[25] = 50;
    at5Hz[26] = 50;
    at5Hz[27] = 50;
    const out = medianFilterByTime(at5Hz, secondsToMs(50, 0.2), 3);
    expect(out[26]).toBe(5);
  });

  it('conserve la longueur de la série', () => {
    expect(medianFilterByTime([1, 2, 3, 4, 5, 6], secondsToMs(6), 3).length).toBe(6);
  });
});

/** Copie gelée de `medianFilterByTimeFrom` d'avant le lot 56 : une médiane triée à chaque point. */
const legacyMedianFilterByTimeFrom = (
  values: number[], timesMs: number[], windowSeconds: number, from: number, prefix: ArrayLike<number> | null
): number[] => {
  if (values.length === 0) return [];
  const halfWindowMs = (windowSeconds * 1000) / 2;
  const out = new Array<number>(values.length);
  for (let k = 0; k < from; k++) out[k] = prefix ? prefix[k] : NaN;
  let start = from;
  while (start > 0 && timesMs[from] - timesMs[start - 1] <= halfWindowMs) start--;
  let end = from;
  for (let i = from; i < values.length; i++) {
    while (start < i && timesMs[i] - timesMs[start] > halfWindowMs) start++;
    if (end < i) end = i;
    while (end + 1 < values.length && timesMs[end + 1] - timesMs[i] <= halfWindowMs) end++;
    out[i] = median(values.slice(start, end + 1));
  }
  return out;
};

/** Suite pseudo-aléatoire reproductible. */
const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** Valeurs arrondies au dixième, pour beaucoup d'égalités, avec des 0 et des −0. */
const noisy = (count: number, seed: number): number[] => {
  const rnd = lcg(seed);
  return Array.from({ length: count }, () => {
    const r = rnd();
    if (r < 0.1) return 0;
    if (r < 0.2) return -0;
    return Math.round(rnd() * 80) / 10;
  });
};

const sameAsLegacy = (values: number[], timesMs: number[], windowS: number, from = 0, prefix: number[] | null = null) => {
  const got = medianFilterByTimeFrom(values, timesMs, windowS, from, prefix);
  const want = legacyMedianFilterByTimeFrom(values, timesMs, windowS, from, prefix);
  if (!sameData(got, want)) expect(got).toEqual(want);
};

describe('medianFilterByTimeFrom, fenêtre triée tenue à jour (lot 56)', () => {
  it('identique au tri à chaque point, à 1 Hz et à 5 Hz, fenêtres de 3 et 5 s', () => {
    for (const step of [1, 0.2]) {
      const values = noisy(3000, 7);
      for (const windowS of [3, 5]) sameAsLegacy(values, secondsToMs(3000, step), windowS);
    }
  });

  it('dates tronquées à la seconde, trous, dates qui reculent et dates illisibles', () => {
    const values = noisy(2000, 11);
    const truncated = secondsToMs(2000, 0.2).map((t) => Math.floor(t / 1000) * 1000);
    sameAsLegacy(values, truncated, 3);
    const withGaps = secondsToMs(2000).map((t, i) => t + Math.floor(i / 300) * 45_000);
    sameAsLegacy(values, withGaps, 5);
    const backwards = secondsToMs(2000).map((t, i) => (i % 97 === 3 ? t - 4000 : t));
    sameAsLegacy(values, backwards, 3);
    const unreadable = secondsToMs(2000).map((t, i) => (i % 211 === 5 ? NaN : t));
    sameAsLegacy(values, unreadable, 3);
  });

  it('valeurs NaN et infinies, fenêtre nulle', () => {
    const values = noisy(1500, 13).map((v, i) => (i % 101 === 7 ? NaN : i % 89 === 3 ? Infinity : i % 83 === 1 ? -Infinity : v));
    sameAsLegacy(values, secondsToMs(1500, 0.2), 3);
    sameAsLegacy(noisy(500, 17), secondsToMs(500, 0.2), 0);
    sameAsLegacy([], [], 3);
    sameAsLegacy([-0], [0], 3);
  });

  it("reprise depuis un indice, valeurs d'avant reprises du calcul précédent", () => {
    const values = noisy(1000, 19);
    const timesMs = secondsToMs(1000, 0.2);
    const prefix = legacyMedianFilterByTimeFrom(values, timesMs, 3, 0, null);
    for (const from of [0, 1, 7, 500, 999]) {
      sameAsLegacy(values, timesMs, 3, from, prefix);
      sameAsLegacy(values, timesMs, 3, from, null);
    }
  });
});

describe('linearSmoothByTime', () => {
  it('laisse une rampe parfaite intacte, bords compris', () => {
    const ramp = Array.from({ length: 50 }, (_, i) => 100 + i);
    const out = linearSmoothByTime(ramp, secondsToMs(50), 20);
    expect(out[0]).toBeCloseTo(100, 9);
    expect(out[49]).toBeCloseTo(149, 9);
    expect(out[25]).toBeCloseTo(125, 9);
  });

  it('vaut la moyenne au centre d\'une trace', () => {
    const values = [0, 0, 10, 0, 0];
    const linear = linearSmoothByTime(values, secondsToMs(5), 3);
    const mean = meanFilterByTime(values, secondsToMs(5), 3);
    expect(linear[2]).toBeCloseTo(mean[2], 9);
  });

  it('atténue un pic isolé', () => {
    const values = new Array(41).fill(100);
    values[20] = 130;
    const out = linearSmoothByTime(values, secondsToMs(41), 20);
    expect(out[20]).toBeLessThan(105);
  });

  it('retombe sur la moyenne quand tous les points partagent le même instant', () => {
    expect(linearSmoothByTime([4, 6], [0, 0], 3)).toEqual([5, 5]);
  });
});

describe('meanFilterByTime', () => {
  it('moyenne sur la fenêtre temporelle', () => {
    const out = meanFilterByTime([0, 0, 10, 0, 0], secondsToMs(5), 3);
    // Fenêtre ±1,5 s : trois points au centre.
    expect(out[2]).toBeCloseTo(10 / 3, 10);
  });

  it('laisse une série constante inchangée', () => {
    expect(meanFilterByTime([7, 7, 7], secondsToMs(3), 3)).toEqual([7, 7, 7]);
  });

  it('gère correctement le premier point', () => {
    const out = meanFilterByTime([10, 0, 0], secondsToMs(3), 3);
    // Fenêtre du premier point : lui-même et le suivant.
    expect(out[0]).toBe(5);
  });
});
