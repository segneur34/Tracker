import { describe, expect, it } from 'vitest';
import {
  clampByAcceleration,
  linearSmoothByTime,
  meanFilterByTime,
  median,
  medianFilterByTime,
} from './speedFilter';

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
