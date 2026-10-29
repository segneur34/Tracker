import { describe, expect, it } from 'vitest';
import {
  buildBaseSessionStats,
  buildCumulativeTrack,
  computeActiveDistanceM,
  computeActiveTimeMs,
  computeActivityMask,
} from './sessionStats';
import { computeKinematics } from './kinematics';
import { computeAllTopSegments, computeTopSegments } from './topSegments';
import type { RawTrackPoint, TopTarget, TrackPoint } from './types';
import { msToKnots } from './units';
import { sameData } from '../test/sameData';
import { RUNNING_TOP_TARGETS, SPORT_PROFILES, SURF_TOP_TARGETS } from './sportProfiles';

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

  it('rend aussi la vitesse en nombre, et un seul segment vaut le premier du tri', () => {
    const speeds = new Array(40).fill(4);
    for (let i = 10; i < 17; i++) speeds[i] = 15;
    for (let i = 25; i < 32; i++) speeds[i] = 15;
    const track = buildTrack(speeds);
    const cum = buildCumulativeTrack(track);
    const tops = computeTopSegments(track, cum, TIME_5S, msToKnots);
    expect(tops[0].speed).not.toBeNull();
    expect(tops[0].val).toBe(tops[0].speed!.toFixed(2));
    const short = buildTrack(new Array(12).fill(4));
    expect(computeTopSegments(short, buildCumulativeTrack(short), TIME_5S, msToKnots)[2].speed).toBeNull();
    const [single] = computeTopSegments(track, cum, TIME_5S, msToKnots, { count: 1 });
    expect(single.speed).toBe(tops[0].speed);
    expect(single.path).toEqual(tops[0].path);
    expect(computeTopSegments(buildTrack([5, 5]), buildCumulativeTrack(buildTrack([5, 5])), TIME_5S, msToKnots, { count: 1 })[0].speed).toBeNull();
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

describe('buildBaseSessionStats, vitesses moyennes', () => {
  it('donne la moyenne totale et la moyenne active, quelle que soit la cadence', () => {
    for (const stepSeconds of [1, 0.2]) {
      const stats = buildBaseSessionStats(buildTrack([2, 2, 2, 2, 2, 8, 8, 8, 8, 8], stepSeconds), {
        enterThresholdMs: 6,
        exitThresholdMs: 6,
      });
      // 4 segments à 2 m/s puis 5 à 8 m/s : 48 m en 9 s au total, 40 m en 5 s en action.
      expect(stats.avgSpeedMs).toBeCloseTo(48 / 9, 6);
      expect(stats.activeAvgSpeedMs).toBeCloseTo(8, 6);
    }
  });

  it('renvoie null sans temps actif', () => {
    const stats = buildBaseSessionStats(buildTrack(new Array(10).fill(3)), { enterThresholdMs: 6, exitThresholdMs: 6 });

    expect(stats.avgSpeedMs).toBeCloseTo(3, 6);
    expect(stats.activeAvgSpeedMs).toBeNull();
  });
});

describe('cibles des tops à pied et en surf (onglet générique)', () => {
  /** Vitesse par seconde, répétée `hz` fois : la même session à 1 Hz et à 5 Hz. */
  const atRate = (perSecond: number[], hz: number) => buildTrack(perSecond.flatMap((v) => new Array(hz).fill(v)), 1 / hz);
  const kmh = (ms: number) => ms * 3.6;

  // Surf : 20 min de rame à 1,2 m/s, une vague de 12 s à 5 m/s, dont 2 s à 7 m/s.
  const surfSeconds = Array.from({ length: 1200 }, (_, t) => (t >= 305 && t < 307 ? 7 : t >= 300 && t < 312 ? 5 : 1.2));
  // Course : 40 min à 3 m/s, dont 80 s à 5 m/s (400 m).
  const runSeconds = Array.from({ length: 2400 }, (_, t) => (t >= 600 && t < 680 ? 5 : 3));

  for (const [name, seconds, targets] of [
    ['surf', surfSeconds, SURF_TOP_TARGETS],
    ['course', runSeconds, RUNNING_TOP_TARGETS],
  ] as const) {
    // Le meilleur passage est le même ; les suivants, sans chevauchement, se
    // placent à la fraction de seconde près au bord d'une vague : seule leur présence est comparée.
    it(`${name} : même meilleur passage à 1 Hz et à 5 Hz`, () => {
      const one = atRate(seconds, 1);
      const five = atRate(seconds, 5);
      const a = computeAllTopSegments(one, buildCumulativeTrack(one), targets, kmh);
      const b = computeAllTopSegments(five, buildCumulativeTrack(five), targets, kmh);
      for (const target of targets) {
        expect(b[target.key][0].val, target.key).toBe(a[target.key][0].val);
        expect(b[target.key].map((top) => top.val === '-'), target.key).toEqual(a[target.key].map((top) => top.val === '-'));
      }
    });
  }

  it('surf : la pointe de la vague sur 2 s, 5 km jamais atteints', () => {
    const track = atRate(surfSeconds, 1);
    const tops = computeAllTopSegments(track, buildCumulativeTrack(track), SURF_TOP_TARGETS, kmh);
    expect(parseFloat(tops.t2s[0].val)).toBeCloseTo(kmh(7), 0);
    expect(parseFloat(tops.t10s[0].val)).toBeGreaterThan(kmh(5) - 0.5);
    expect(tops.d1km[0].val).not.toBe('-');
    expect(tops.d5km[0].val).toBe('-');
  });

  it('course : les 400 m rapides, ni semi ni marathon', () => {
    const track = atRate(runSeconds, 1);
    const tops = computeAllTopSegments(track, buildCumulativeTrack(track), RUNNING_TOP_TARGETS, kmh);
    expect(parseFloat(tops.d400m[0].val)).toBeCloseTo(kmh(5), 0);
    expect(parseFloat(tops.t12min[0].val)).toBeGreaterThan(kmh(3));
    expect(tops.dsemi[0].val).toBe('-');
    expect(tops.dmarathon[0].val).toBe('-');
  });
});

describe('computeTopSegments, trou de la trace', () => {
  it('ne prend pas pour top 10 s la seule mesure Doppler lue après un trou (A-B4)', () => {
    // Wingfoil à 1 Hz, Doppler constant à 10 m/s, 20 s sans point (pochette étanche), reprise lue à 14 m/s.
    const startTime = Date.parse('2026-01-01T10:00:00Z');
    const lat = 43.6;
    const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
    const raw: RawTrackPoint[] = [];
    const push = (s: number, speedMs: number) =>
      raw.push({ lat, lon: 3.8 + (10 * s) / metersPerDegLon, time: new Date(startTime + s * 1000).toISOString(), speedMs });
    for (let s = 0; s <= 120; s++) push(s, 10);
    push(141, 14);
    for (let s = 142; s <= 260; s++) push(s, 10);
    const wing = SPORT_PROFILES.wingfoil;
    const track = computeKinematics(raw, { medianWindowSeconds: wing.medianWindowSeconds, maxGapS: wing.maxGapS });
    const tops = computeTopSegments(track, buildCumulativeTrack(track), { key: 't10s', label: '10 s', value: 10, kind: 'time' }, (ms) => ms);
    expect(parseFloat(tops[0].val)).toBeCloseTo(10, 1);
  });
});

/** Copie gelée de `computeTopSegments` d'avant le lot 56 : une fenêtre objet par point, tri complet. */
const frozenTopSegments = (
  track: TrackPoint[], cum: ReturnType<typeof buildCumulativeTrack>, target: TopTarget, toDisplaySpeed: (ms: number) => number,
  options: { count?: number; decimals?: number } = {}
) => {
  const count = options.count ?? 3;
  const decimals = options.decimals ?? 2;
  const { cumDist, cumTime } = cum;
  const isDistance = target.kind === 'distance';
  const reference = isDistance ? cumDist : cumTime;
  const interpolateAt = (ref: number[], t: number, values: number[], lower: number, upper: number): number => {
    const span = ref[upper] - ref[lower];
    if (span <= 0) return values[upper];
    return values[lower] + ((t - ref[lower]) / span) * (values[upper] - values[lower]);
  };
  const windows: { start: number; end: number; val: number }[] = [];
  const gapCount = new Array<number>(track.length).fill(0);
  for (let k = 1; k < track.length; k++) gapCount[k] = gapCount[k - 1] + (track[k].gapDistanceM !== undefined ? 1 : 0);
  let j = 1;
  for (let i = 0; i < track.length - 1; i++) {
    const threshold = reference[i] + target.value;
    if (j <= i) j = i + 1;
    while (j < track.length && reference[j] < threshold) j++;
    if (j >= track.length) break;
    if (gapCount[j] > gapCount[i]) continue;
    let distance: number;
    let duration: number;
    if (isDistance) {
      distance = target.value;
      duration = interpolateAt(cumDist, threshold, cumTime, j - 1, j) - cumTime[i];
    } else {
      distance = interpolateAt(cumTime, threshold, cumDist, j - 1, j) - cumDist[i];
      duration = target.value;
    }
    if (duration > 0 && distance > 0) windows.push({ start: i, end: j, val: toDisplaySpeed(distance / duration) });
  }
  const tops: { val: string; speed: number | null; path: [number, number][] }[] = [];
  const keep = (w: { start: number; end: number; val: number }) => {
    tops.push({ val: w.val.toFixed(decimals), speed: w.val, path: track.slice(w.start, w.end + 1).map((p) => [p.lat, p.lon] as [number, number]) });
  };
  if (count === 1) {
    let best: { start: number; end: number; val: number } | null = null;
    for (const w of windows) if (best === null || w.val > best.val) best = w;
    if (best !== null) keep(best);
  } else {
    windows.sort((a, b) => b.val - a.val);
    const selected: { start: number; end: number }[] = [];
    for (const w of windows) {
      if (tops.length >= count) break;
      if (!selected.some((s) => Math.max(w.start, s.start) <= Math.min(w.end, s.end))) {
        keep(w);
        selected.push({ start: w.start, end: w.end });
      }
    }
  }
  while (tops.length < count) tops.push({ val: '-', speed: null, path: [] });
  return tops;
};

describe('computeTopSegments, sélection sans tri (lot 56)', () => {
  /** Trace brute bruitée, arrondie au dixième de m/s (beaucoup d'égalités), avec pauses et trous. */
  const rawTrace = (stepS: number, seed: number, constant = false): RawTrackPoint[] => {
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const out: RawTrackPoint[] = [];
    const t0 = Date.parse('2026-01-01T10:00:00Z');
    let lon = 3.8;
    let offsetS = 0;
    for (let k = 0; k < 900 / stepS; k++) {
      if (k > 0 && k % Math.round(400 / stepS) === 0) offsetS += 30; // trou
      const speed = constant ? 5 : Math.round((5 + 3 * Math.sin(k * stepS / 40) + (rnd() - 0.5) * 2) * 10) / 10;
      lon += (speed * stepS) / 80_000;
      out.push({
        lat: 43.6, lon, time: new Date(t0 + Math.round((k * stepS + offsetS) * 1000)).toISOString(), speedMs: speed,
        ...(k > 0 && k % Math.round(700 / stepS) === 0 ? { segmentStart: true as const } : {}),
      });
    }
    return out;
  };
  const converters: [string, (ms: number) => number][] = [
    ['m/s', (ms) => ms], ['nœuds', msToKnots], ['km/h', (ms) => ms * 3.6], ['allure', (ms) => 1000 / ms / 60], ['arrondi', (ms) => Math.round(ms)],
  ];

  it('identique à la version gelée : chaque profil, chaque cible, 1 Hz et 5 Hz, unités, count 1, 3 et 5', () => {
    for (const stepS of [1, 0.2]) {
      for (const constant of [false, true]) {
        const raw = rawTrace(stepS, 11, constant);
        // Un profil par liste de cibles : ceux qui la partagent font le même calcul.
        const profiles = Object.values(SPORT_PROFILES).filter((p, k, all) => p.topTargets.length > 0 && all.findIndex((q) => q.topTargets === p.topTargets) === k);
        for (const profile of profiles) {
          const track = computeKinematics(raw, { medianWindowSeconds: profile.medianWindowSeconds, maxGapS: profile.maxGapS });
          const cum = buildCumulativeTrack(track);
          for (const [, convert] of converters) {
            for (const count of [1, 3, 5]) {
              const all = computeAllTopSegments(track, cum, profile.topTargets, convert, { count, decimals: 3 });
              for (const target of profile.topTargets) {
                const want = frozenTopSegments(track, cum, target, convert, { count, decimals: 3 });
                if (!sameData(all[target.key], want)) expect(all[target.key]).toEqual(want);
              }
            }
          }
        }
      }
    }
  });

  it('valeur NaN : même résultat que le tri', () => {
    const track = computeKinematics(rawTrace(1, 5), {});
    const cum = buildCumulativeTrack(track);
    const target: TopTarget = { key: 't10s', label: '10 s', value: 10, kind: 'time' };
    const holes = (ms: number) => (Math.round(ms * 10) % 7 === 0 ? NaN : ms);
    for (const count of [1, 3]) expect(computeTopSegments(track, cum, target, holes, { count })).toEqual(frozenTopSegments(track, cum, target, holes, { count }));
  });
});
