import { describe, expect, it } from 'vitest';
import {
  buildCumulativeTrack,
  computeActiveDistanceM,
  computeActiveTimeMs,
  computeActivityMask,
} from './sessionStats';
import { computeAllTopSegments, computeTopSegments } from './topSegments';
import type { TopTarget, TrackPoint } from './types';
import { msToKnots } from './units';

/**
 * Trace synthétique : vitesse imposée point par point, cadence réglable.
 * Les positions sont générées pour être cohérentes avec ces vitesses.
 */
const buildTrack = (speedsMs: number[], stepSeconds = 1): TrackPoint[] => {
  const startTime = Date.parse('2026-01-01T10:00:00Z');
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);

  let meters = 0;
  return speedsMs.map((speedMs, i) => {
    if (i > 0) meters += speedMs * stepSeconds;
    const timeMs = startTime + i * stepSeconds * 1000;
    return {
      lat,
      lon: 3.8 + meters / metersPerDegLon,
      time: new Date(timeMs).toISOString(),
      timeMs,
      speedMs,
      smoothedSpeedMs: speedMs,
      bearing: 90,
      speedSource: 'derived' as const,
    };
  });
};

const TIME_5S: TopTarget = { key: 't5s', label: '5 s', value: 5, kind: 'time' };
const DIST_100M: TopTarget = { key: 'd100m', label: '100 m', value: 100, kind: 'distance' };

describe('computeTopSegments, cible de temps', () => {
  it('retient le passage le plus rapide', () => {
    const speeds = new Array(30).fill(5);
    for (let i = 12; i < 19; i++) speeds[i] = 12;

    const track = buildTrack(speeds);
    const tops = computeTopSegments(track, buildCumulativeTrack(track), TIME_5S, msToKnots);

    expect(parseFloat(tops[0].val)).toBeCloseTo(msToKnots(12), 1);
  });

  it('renvoie exactement trois entrées, complétées par des tirets', () => {
    const track = buildTrack(new Array(8).fill(5));
    const tops = computeTopSegments(track, buildCumulativeTrack(track), TIME_5S, msToKnots);

    expect(tops).toHaveLength(3);
    expect(tops.every((t) => t.val === '-' || parseFloat(t.val) > 0)).toBe(true);
  });

  it('ne retient que des segments disjoints', () => {
    const speeds = new Array(40).fill(4);
    for (let i = 10; i < 17; i++) speeds[i] = 15;

    const track = buildTrack(speeds);
    const tops = computeTopSegments(track, buildCumulativeTrack(track), TIME_5S, msToKnots);

    expect(parseFloat(tops[0].val)).toBeGreaterThan(parseFloat(tops[1].val));
  });

  it('remplit un chemin exploitable par la carte', () => {
    const track = buildTrack(new Array(20).fill(6));
    const tops = computeTopSegments(track, buildCumulativeTrack(track), TIME_5S, msToKnots);

    expect(tops[0].path.length).toBeGreaterThan(1);
    expect(tops[0].path[0]).toHaveLength(2);
  });

  it('ne renvoie que des tirets si la trace est plus courte que la cible', () => {
    const track = buildTrack([5, 5]);
    const tops = computeTopSegments(track, buildCumulativeTrack(track), TIME_5S, msToKnots);

    expect(tops.map((t) => t.val)).toEqual(['-', '-', '-']);
  });

  it('interpole la borne de fin quand aucun point ne tombe pile sur la cible', () => {
    // Points toutes les 2 s : la cinquième seconde tombe entre deux points.
    const track = buildTrack(new Array(20).fill(10), 2);
    const tops = computeTopSegments(track, buildCumulativeTrack(track), TIME_5S, msToKnots);

    // Vitesse constante : le résultat doit être exactement 10 m/s malgré l'échantillonnage.
    expect(parseFloat(tops[0].val)).toBeCloseTo(msToKnots(10), 1);
  });

  it('ne dépend pas de la fréquence d\'échantillonnage', () => {
    const at1Hz = buildTrack(new Array(30).fill(8), 1);
    const at5Hz = buildTrack(new Array(150).fill(8), 0.2);

    const tops1 = computeTopSegments(at1Hz, buildCumulativeTrack(at1Hz), TIME_5S, msToKnots);
    const tops5 = computeTopSegments(at5Hz, buildCumulativeTrack(at5Hz), TIME_5S, msToKnots);

    expect(parseFloat(tops1[0].val)).toBeCloseTo(parseFloat(tops5[0].val), 1);
  });
});

describe('computeTopSegments, cible de distance', () => {
  it('mesure la vitesse moyenne sur la distance demandée', () => {
    const track = buildTrack(new Array(40).fill(10));
    const tops = computeTopSegments(track, buildCumulativeTrack(track), DIST_100M, msToKnots);

    expect(parseFloat(tops[0].val)).toBeCloseTo(msToKnots(10), 1);
  });

  it('préfère le tronçon le plus rapide', () => {
    const slow = new Array(30).fill(4);
    const fast = new Array(30).fill(14);
    const track = buildTrack([...slow, ...fast]);
    const tops = computeTopSegments(track, buildCumulativeTrack(track), DIST_100M, msToKnots);

    expect(parseFloat(tops[0].val)).toBeGreaterThan(msToKnots(10));
  });

  it('utilise la même définition que les cibles de temps', () => {
    // À vitesse constante, 100 m et 5 s doivent donner la même vitesse.
    const track = buildTrack(new Array(60).fill(10));
    const cum = buildCumulativeTrack(track);

    const parDistance = computeTopSegments(track, cum, DIST_100M, (v) => v);
    const parTemps = computeTopSegments(track, cum, TIME_5S, (v) => v);

    expect(parseFloat(parDistance[0].val)).toBeCloseTo(parseFloat(parTemps[0].val), 2);
  });
});

describe('computeTopSegments, conversion d\'unité', () => {
  it('applique le convertisseur fourni', () => {
    const track = buildTrack(new Array(20).fill(10));
    const cum = buildCumulativeTrack(track);

    const enMs = computeTopSegments(track, cum, TIME_5S, (v) => v);
    const enNoeuds = computeTopSegments(track, cum, TIME_5S, msToKnots);

    expect(parseFloat(enNoeuds[0].val) / parseFloat(enMs[0].val)).toBeCloseTo(1.94384, 3);
  });
});

describe('computeAllTopSegments', () => {
  it('indexe les résultats par clé de cible', () => {
    const track = buildTrack(new Array(40).fill(8));
    const result = computeAllTopSegments(
      track,
      buildCumulativeTrack(track),
      [TIME_5S, DIST_100M],
      msToKnots
    );

    expect(Object.keys(result).sort()).toEqual(['d100m', 't5s']);
    expect(result.t5s).toHaveLength(3);
  });
});

describe('buildCumulativeTrack', () => {
  it('intègre la vitesse retenue plutôt que la position brute', () => {
    const track = buildTrack(new Array(11).fill(10));
    const cum = buildCumulativeTrack(track);

    expect(cum.cumDist[10]).toBeCloseTo(100, 6);
    expect(cum.cumTime[10]).toBe(10);
  });
});

describe('computeActivityMask, trigger de Schmitt', () => {
  const schmitt = { enterThresholdMs: 8.5, exitThresholdMs: 7 };

  it('ne démarre qu\'au-dessus du seuil haut', () => {
    const track = buildTrack([0, 7.5, 8, 8.4, 8.6, 9]);
    const mask = computeActivityMask(track, schmitt);
    expect(mask).toEqual([false, false, false, false, true, true]);
  });

  it('ne s\'arrête qu\'en dessous du seuil bas', () => {
    const track = buildTrack([9, 9, 8, 7.5, 7.2, 6.9, 6]);
    const mask = computeActivityMask(track, schmitt);
    expect(mask).toEqual([true, true, true, true, true, false, false]);
  });

  it('ne bagote pas quand la vitesse oscille entre les deux seuils', () => {
    const track = buildTrack([9, 8, 7.5, 8.2, 7.1, 8.4, 7.3, 8]);
    const mask = computeActivityMask(track, schmitt);
    // Une fois lancé, tout reste actif tant qu'on ne passe pas sous 7.
    expect(mask.every(Boolean)).toBe(true);
  });

  it('un seuil unique, lui, bagote sur la même trace', () => {
    // Démonstration par contraste : seuils haut et bas confondus à 8.
    const track = buildTrack([9, 8, 7.5, 8.2, 7.1, 8.4, 7.3, 8]);
    const mask = computeActivityMask(track, { enterThresholdMs: 8, exitThresholdMs: 8 });
    const transitions = mask.filter((v, i) => i > 0 && v !== mask[i - 1]).length;
    expect(transitions).toBeGreaterThan(2);
  });

  it('exige une durée de confirmation si demandé', () => {
    // Pic isolé d'une seconde : pas assez pour valider le démarrage sur 3 s.
    const track = buildTrack([0, 0, 10, 0, 0, 0, 10, 10, 10, 10, 10]);
    const mask = computeActivityMask(track, { ...schmitt, minStateDurationS: 3 });
    expect(mask[2]).toBe(false);
    // Le second plateau dure assez longtemps pour être confirmé.
    expect(mask[10]).toBe(true);
  });
});

describe('computeActiveTimeMs et computeActiveDistanceM', () => {
  it('ne comptent que les segments actifs', () => {
    const track = buildTrack([2, 2, 2, 2, 2, 8, 8, 8, 8, 8]);
    const mask = computeActivityMask(track, { enterThresholdMs: 6, exitThresholdMs: 6 });

    expect(computeActiveTimeMs(track, mask)).toBe(5000);
    expect(computeActiveDistanceM(track, mask)).toBeCloseTo(40, 6);
  });

  it('renvoient zéro si rien n\'atteint le seuil', () => {
    const track = buildTrack(new Array(10).fill(3));
    const mask = computeActivityMask(track, { enterThresholdMs: 6, exitThresholdMs: 6 });

    expect(computeActiveTimeMs(track, mask)).toBe(0);
    expect(computeActiveDistanceM(track, mask)).toBe(0);
  });
});
