import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addWaypoint, legKey, withLegResult } from '../planning/route';
import { routeToRecord } from '../planning/routeRecord';
import { accumulateElevation } from '../core/elevation';
import { ELEVATION_PRESETS } from '../core/sportProfiles';
import {
  createFollowCursor, FOLLOW_DEFAULTS, FOLLOWED_TRACE_ELEVATION_TOLERANCE_M, FOLLOWED_TRACE_TOLERANCE_M,
  followedTraceFromPoints, followedTraceFromRoute, followedTraceFromSession, followedTraceLengthM, followProgress,
  splitFollowedTrace, thinFollowedTrace, type FollowedTrace,
} from './followedTrace';
import { M_PER_DEG_LAT, ORIGIN, at, fixesAlong, mPerDegLon } from '../test/geo.fixture';

const A = { lat: 43.6, lon: 3.8 };
const B = { lat: 43.61, lon: 3.8 };
const C = { lat: 43.62, lon: 3.81 };
const META = { name: 'Tour du Pic', activityId: null, createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' };

describe('trace suivie', () => {
  it('garde les positions exploitables, sans le reste du point', () => {
    const trace = followedTraceFromPoints([{ ...A, ele: 12 } as { lat: number; lon: number }, { lat: NaN, lon: 3.8 }, B], 'Sortie', 'session');
    expect(trace).toEqual({ name: 'Sortie', source: 'session', activityId: null, points: [A, B] });
    expect(followedTraceFromPoints([A, B], 'Sortie', 'session', 'kite')?.activityId).toBe('kite');
  });

  it('refuse une trace de moins de deux positions', () => {
    expect(followedTraceFromPoints([A], 'Un point', 'session')).toBeNull();
    expect(followedTraceFromPoints([A, { lat: Infinity, lon: 0 }], 'Un point', 'session')).toBeNull();
  });

  it('suit un itinéraire : tronçon calculé à la suite, tronçon en attente en ligne droite', () => {
    let route = [A, B, C].reduce((r, p) => addWaypoint(r, p, 'sentier'), EMPTY_ROUTE);
    const mid = { lat: 43.605, lon: 3.801 };
    route = withLegResult(route, legKey(route, 0)!, [A, mid, B]);
    const trace = followedTraceFromRoute(routeToRecord(route, META));
    // L'activité de l'itinéraire suit la trace : elle sera proposée pour l'enregistrement.
    expect(trace).toEqual({ name: 'Tour du Pic', source: 'route', activityId: META.activityId, points: [A, mid, B, C], marks: [A, B, C] });
  });

  it('garde les bips propres à l\'itinéraire, et aucun quand il n\'en a pas', () => {
    const route = [A, B, C].reduce((r, p) => addWaypoint(r, p, 'straight'), EMPTY_ROUTE);
    const guide = { curve: [{ distanceM: 30, intervalMs: 200 }, { distanceM: 120, intervalMs: 1500 }], vibrate: true };
    expect(followedTraceFromRoute(routeToRecord(route, { ...META, markGuide: guide }))?.markGuide).toEqual(guide);
    expect(followedTraceFromRoute(routeToRecord(route, META))).not.toHaveProperty('markGuide');
  });

  it('garde les balises exploitables, et aucune pour une session', () => {
    const trace = followedTraceFromPoints([A, B], 'Parcours', 'route', 'wingfoil', [A, { lat: NaN, lon: 3.8 }, C]);
    expect(trace?.marks).toEqual([A, C]);
    expect(followedTraceFromPoints([A, B], 'Sortie', 'session')).not.toHaveProperty('marks');
  });
});

const traceOf = (pts: [number, number][]): FollowedTrace => followedTraceFromPoints(pts.map(([e, n]) => at(e, n)), 'Test', 'route')!;

/** Parcours enregistré le long de sommets donnés, un point tous les `stepM` mètres. */
const walk = fixesAlong;

describe('avancement sur la trace suivie', () => {
  const line = traceOf([[0, 0], [0, 500], [0, 1000]]);

  it('suit un aller simple, la distance restante décroît', () => {
    const p = followProgress(line, [walk([[0, 0], [5, 600]], 5)]);
    expect(p!.totalM).toBeCloseTo(1000, -1);
    expect(p!.progressM).toBeCloseTo(600, -1);
    expect(p!.remainingM).toBeCloseTo(400, -1);
  });

  it('ne dépend pas de la cadence : pas de 1 m ou de 5 m donnent le même avancement', () => {
    const fine = followProgress(line, [walk([[0, 0], [10, 420]], 1)])!;
    const coarse = followProgress(line, [walk([[0, 0], [10, 420]], 5)])!;
    expect(fine.progressM).toBeCloseTo(coarse.progressM, 3);
  });

  it("reste nul tant que la trace n'est pas rejointe", () => {
    expect(followProgress(line, [walk([[500, 0], [500, 1000]], 10)])).toBeNull();
  });

  it("part de 0 sur une boucle dont le départ est l'arrivée", () => {
    const loop = traceOf([[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]]);
    const p = followProgress(loop, [walk([[0, 0], [100, 0]], 5)])!;
    expect(p.progressM).toBeCloseTo(100, -1);
    const end = followProgress(loop, [walk([[0, 0], [400, 0], [400, 400], [0, 400], [0, 10]], 5)])!;
    expect(end.remainingM).toBeCloseTo(10, -1);
  });

  it("ne saute pas sur le retour d'un aller-retour", () => {
    const outAndBack = traceOf([[0, 0], [0, 500], [0, 0]]);
    const going = followProgress(outAndBack, [walk([[0, 0], [0, 300]], 5)])!;
    expect(going.progressM).toBeCloseTo(300, -1);
    const back = followProgress(outAndBack, [walk([[0, 0], [0, 500], [0, 200]], 5)])!;
    expect(back.progressM).toBeCloseTo(800, -1);
  });

  it("gèle l'avancement hors trace, puis se raccroche plus loin (raccourci)", () => {
    // Un U : on quitte la trace en bas, on coupe tout droit, on la rejoint sur l'autre branche.
    const u = traceOf([[0, 0], [0, 1000], [300, 1000], [300, 0]]);
    const away = followProgress(u, [walk([[0, 0], [0, 200], [150, 200]], 5)])!;
    expect(away.progressM).toBeCloseTo(200, -1);
    const rejoined = followProgress(u, [walk([[0, 0], [0, 200], [300, 200], [300, 100]], 5)])!;
    expect(rejoined.progressM).toBeCloseTo(1000 + 300 + 900, -1);
  });

  it("traverse les pauses : chaque segment continue l'avancement", () => {
    const p = followProgress(line, [walk([[0, 0], [0, 300]], 5), walk([[0, 320], [0, 700]], 5)])!;
    expect(p.progressM).toBeCloseTo(700, -1);
  });
});

/** Avancement après chaque position, `null` avant le premier accrochage. */
const progressAfterEach = (trace: FollowedTrace, fixes: ReadonlyArray<{ lat: number; lon: number }>): (number | null)[] => {
  const cursor = createFollowCursor(trace);
  return fixes.map((_, n) => cursor.progress([fixes.slice(0, n + 1)])?.progressM ?? null);
};

const known = (values: (number | null)[]): number[] => values.filter((v): v is number => v !== null);

/** Plus grand recul de l'avancement, depuis le plus loin atteint. */
const worstDrop = (values: (number | null)[]): number => {
  let high = -Infinity;
  let worst = 0;
  for (const v of known(values)) {
    high = Math.max(high, v);
    worst = Math.max(worst, high - v);
  }
  return worst;
};

/** Bruit du GPS : chaque position décalée de ±`ampM` mètres sur chaque axe, à graine fixe. */
const withNoise = <P extends { lat: number; lon: number }>(fixes: ReadonlyArray<P>, ampM: number): { lat: number; lon: number }[] => {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return (seed / 2 ** 31 - 0.5) * 2 * ampM;
  };
  return fixes.map((p) => ({ lat: p.lat + next() / M_PER_DEG_LAT, lon: p.lon + next() / mPerDegLon(ORIGIN.lat) }));
};

describe('accrochage lointain, à confirmer le long de la trace', () => {
  const u = traceOf([[0, 0], [0, 1000], [300, 1000], [300, 0]]);
  const branches = traceOf([[0, 0], [0, 2000], [100, 2000], [100, 0]]);
  const loop = traceOf([[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]]);
  const line = traceOf([[0, 0], [0, 500], [0, 1000]]);

  it("un bref hors-piste près d'une autre branche ne saute pas, et le retour reprend où il en était", () => {
    const seen = progressAfterEach(branches, walk([[0, 0], [0, 400], [70, 400], [0, 400], [0, 800]], 5));
    expect(Math.max(...known(seen))).toBeLessThan(805);
    expect(seen[seen.length - 1]).toBeCloseTo(800, -1);
    // Le long de l'autre branche, à contresens du sien : rien ne s'y valide. Revenu 120 m plus loin, hors de la
    // fenêtre, l'avancement attend les 80 m de confirmation, puis repart.
    const along = progressAfterEach(branches, walk([[0, 0], [0, 400], [70, 400], [70, 520], [0, 520], [0, 620]], 5));
    expect(Math.max(...known(along))).toBeLessThan(625);
    expect(along[along.length - 1]).toBeCloseTo(620, -1);
  });

  it("un échauffement sur le dernier côté d'une boucle, dans le sens de la trace, repart du début", () => {
    const warmup = walk([[0, 100], [0, 0]], 5);
    const seen = progressAfterEach(loop, [...warmup, ...walk([[0, 0], [200, 0]], 5)]);
    expect(seen[0]).toBeNull();
    expect(Math.max(...known(seen))).toBeLessThan(205);
    expect(seen[seen.length - 1]).toBeCloseTo(200, -1);
  });

  it('une boucle à contresens reste à 0 : limite assumée', () => {
    const fixes = walk([[0, 0], [0, 400], [400, 400], [400, 0], [0, 0]], 5);
    const seen = progressAfterEach(loop, fixes);
    // Rien tant qu'on n'approche pas du début par l'autre bout, puis retour à 0.
    expect(seen[Math.floor(fixes.length * 0.75)]).toBe(0);
    expect(Math.max(...known(seen))).toBeLessThan(110);
    expect(seen[seen.length - 1]).toBeLessThan(5);
  });

  it("un aller simple couru à l'envers n'accroche qu'en arrivant près du départ", () => {
    const seen = progressAfterEach(line, walk([[0, 1000], [0, 0]], 5));
    expect(seen.slice(0, 150).every((v) => v === null)).toBe(true);
    expect(Math.max(...known(seen))).toBeLessThanOrEqual(100);
    expect(seen[seen.length - 1]).toBeLessThan(5);
  });

  it('un premier accrochage est immédiat près du départ, à confirmer plus loin', () => {
    expect(followProgress(line, [[at(0, 90)]])!.progressM).toBeCloseTo(90, 0);
    expect(followProgress(line, [walk([[0, 400], [0, 470]], 5)])).toBeNull();
    expect(followProgress(line, [walk([[0, 400], [0, 490]], 5)])!.progressM).toBeCloseTo(490, -1);
  });

  it('un raccourci réel est validé après 80 m le long de la trace, pas avant', () => {
    // La trace est à portée dès 240 m à l'est : le candidat naît à 2100 m et y reste jusqu'à la jonction.
    const before = followProgress(u, [walk([[0, 0], [0, 200], [300, 200], [300, 130]], 5)])!;
    expect(before.progressM).toBeCloseTo(200, -1);
    const after = followProgress(u, [walk([[0, 0], [0, 200], [300, 200], [300, 110]], 5)])!;
    expect(after.progressM).toBeCloseTo(1000 + 300 + 890, -1);
  });

  it('un candidat quitté repart de zéro : deux morceaux ne se cumulent pas', () => {
    // 50 m le long de la branche, on la quitte hors de portée, on y revient : il manque encore de la distance.
    const fixes = [...walk([[0, 0], [0, 200]], 5), at(300, 400), at(300, 350), at(400, 350), ...walk([[360, 330], [300, 300]], 5)];
    expect(followProgress(u, [fixes])!.progressM).toBeCloseTo(200, -1);
  });

  it('un seul long intervalle GPS compte en mètres, pas en points', () => {
    const start = walk([[0, 0], [0, 200]], 5);
    // Le candidat est vu, puis un seul intervalle de 150 m le long de la trace le valide.
    expect(followProgress(u, [[...start, at(300, 200)]])!.progressM).toBeCloseTo(200, -1);
    expect(followProgress(u, [[...start, at(300, 200), at(300, 50)]])!.progressM).toBeCloseTo(1000 + 300 + 950, -1);
    // Dans le prolongement de la position, la fenêtre s'élargit de l'intervalle : pas d'attente.
    expect(followProgress(line, [[...start, at(0, 700)]])!.progressM).toBeCloseTo(700, -1);
  });

  it('un pas de côté entre deux lacets ne vaut pas la distance gagnée sur la trace', () => {
    // Deux lacets à 20 m : passer de l'un à l'autre gagne 90 m le long de la trace en 20 m de marche.
    const hairpin = traceOf([[0, 0], [0, 1000], [300, 1000], [300, 100], [320, 100], [320, 1000]]);
    const start = walk([[0, 0], [0, 200]], 5);
    const across = [...start, at(300, 135), at(320, 135)];
    expect(followProgress(hairpin, [across])!.progressM).toBeCloseTo(200, -1);
    expect(followProgress(hairpin, [[...across, at(320, 175)]])!.progressM).toBeCloseTo(200, -1);
  });
});

describe("aller-retour dont le retour recouvre l'aller", () => {
  const tenMetres = Array.from({ length: 51 }, (_, i): [number, number] => [0, i * 10]);
  const dense = traceOf([...tenMetres, ...tenMetres.slice(0, -1).reverse()]);
  const fixes = walk([[0, 0], [0, 500], [0, 0]], 5);

  it("va au bout, à points denses, sans jamais reculer au-delà de la tolérance", () => {
    const seen = progressAfterEach(dense, fixes);
    expect(seen[seen.length - 1]).toBeGreaterThan(990);
    expect(worstDrop(seen)).toBeLessThanOrEqual(FOLLOW_DEFAULTS.backM);
  });

  it('va au bout avec un bruit de ±3 m', () => {
    const seen = progressAfterEach(dense, withNoise(fixes, 3));
    expect(seen[seen.length - 1]).toBeGreaterThan(980);
    expect(worstDrop(seen)).toBeLessThanOrEqual(FOLLOW_DEFAULTS.backM);
  });

  it('ne bascule pas sur le retour avant le demi-tour', () => {
    const going = progressAfterEach(dense, walk([[0, 0], [0, 490]], 5));
    going.forEach((v, n) => expect(Math.abs(v! - n * 5)).toBeLessThan(5));
    // Arrêté avant le demi-tour, dans le bruit : l'avancement ne file pas sur le retour.
    const stopped = withNoise(Array.from({ length: 200 }, () => at(0, 470)), 3);
    const waited = progressAfterEach(dense, [...walk([[0, 0], [0, 470]], 5), ...stopped]);
    expect(Math.max(...known(waited))).toBeLessThan(480);
  });

  it("garde le passage attendu quand aller et retour ne sont qu'à quelques mètres", () => {
    const lanes = traceOf([[0, 0], [0, 500], [4, 500], [4, 0]]);
    const seen = progressAfterEach(lanes, walk([[0, 0], [0, 500], [4, 500], [4, 0]], 5));
    expect(seen[seen.length - 1]).toBeCloseTo(1004, -1);
    expect(worstDrop(seen)).toBeLessThanOrEqual(FOLLOW_DEFAULTS.backM);
  });
});

describe('mêmes trajets, à toute cadence, en direct comme en rejeu', () => {
  const u = traceOf([[0, 0], [0, 1000], [300, 1000], [300, 0]]);
  const branches = traceOf([[0, 0], [0, 2000], [100, 2000], [100, 0]]);
  const loop = traceOf([[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]]);
  const line = traceOf([[0, 0], [0, 500], [0, 1000]]);
  const tenMetres = Array.from({ length: 51 }, (_, i): [number, number] => [0, i * 10]);
  const dense = traceOf([...tenMetres, ...tenMetres.slice(0, -1).reverse()]);
  const trips: { name: string; trace: FollowedTrace; path: [number, number][] }[] = [
    { name: 'hors-piste', trace: branches, path: [[0, 0], [0, 400], [70, 400], [0, 400], [0, 800]] },
    { name: 'échauffement', trace: loop, path: [[0, 100], [0, 0], [200, 0]] },
    { name: 'contresens', trace: loop, path: [[0, 0], [0, 400], [400, 400], [400, 0], [0, 0]] },
    { name: "à l'envers", trace: line, path: [[0, 1000], [0, 0]] },
    { name: 'raccourci', trace: u, path: [[0, 0], [0, 200], [300, 200], [300, 50]] },
    { name: 'aller-retour', trace: dense, path: [[0, 0], [0, 500], [0, 100]] },
  ];

  it.each(trips)('$name : 1 Hz et 5 Hz donnent le même avancement', ({ trace, path }) => {
    // 5 m/s : un point tous les 5 m à 1 Hz, tous les mètres à 5 Hz.
    const slow = followProgress(trace, [walk(path, 5)])!;
    const fast = followProgress(trace, [walk(path, 1)])!;
    expect(Math.abs(slow.progressM - fast.progressM)).toBeLessThan(2);
  });

  it.each(trips)('$name : le curseur égale followProgress à chaque position', ({ trace, path }) => {
    const fixes = withNoise(walk(path, 10), 2);
    const cursor = createFollowCursor(trace);
    for (let n = 1; n <= fixes.length; n++) {
      const seen = [fixes.slice(0, n)];
      expect(cursor.progress(seen)).toEqual(followProgress(trace, seen));
    }
  });
});

describe('suivi repris (curseur du direct)', () => {
  // Un U quitté puis rejoint, avec une pause : raccrochage, fenêtre élargie et reprise par segment sont tous parcourus.
  const u = traceOf([[0, 0], [0, 1000], [300, 1000], [300, 0]]);
  const first = walk([[0, 0], [0, 200], [150, 200], [300, 200], [300, 100]], 5);
  const second = walk([[300, 80], [300, 0]], 5);

  it("donne à chaque position l'avancement de followProgress, pauses comprises", () => {
    const cursor = createFollowCursor(u);
    for (let n = 1; n <= first.length; n++) {
      const seen = [first.slice(0, n)];
      expect(cursor.progress(seen)).toEqual(followProgress(u, seen));
    }
    for (let n = 1; n <= second.length; n++) {
      const seen = [first, second.slice(0, n)];
      expect(cursor.progress(seen)).toEqual(followProgress(u, seen));
    }
  });

  it('repart de zéro si les segments ne sont pas ceux déjà lus', () => {
    const cursor = createFollowCursor(u);
    cursor.progress([first]);
    // Un autre enregistrement, plus court, sur la même trace.
    const other = walk([[0, 0], [0, 400]], 5);
    expect(cursor.progress([other])).toEqual(followProgress(u, [other]));
    // Le même segment, mais recopié point par point : les objets changent, tout est relu.
    const copy = other.map((p) => ({ ...p }));
    expect(cursor.progress([copy])).toEqual(followProgress(u, [copy]));
  });
});

describe('découpe de la trace suivie', () => {
  const line = traceOf([[0, 0], [0, 500], [0, 1000]]);

  it("coupe au point d'avancement, partagé par les deux parties", () => {
    const { done, remaining } = splitFollowedTrace(line, 250);
    expect(done).toHaveLength(2);
    expect(remaining).toHaveLength(3);
    expect(done[1]).toEqual(remaining[0]);
    expect(done[1].lat).toBeCloseTo(at(0, 250).lat, 6);
  });

  it("aux bords : rien de fait au départ, tout fait à l'arrivée", () => {
    expect(splitFollowedTrace(line, 0)).toEqual({ done: [], remaining: line.points });
    expect(splitFollowedTrace(line, followedTraceLengthM(line))).toEqual({ done: line.points, remaining: [] });
  });
});

describe('trace suivie amincie pour être gardée', () => {
  /** Générateur pseudo-aléatoire à graine fixe. */
  const noise = (() => {
    let seed = 42;
    return () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31 - 0.5;
    };
  })();

  it('réduit fortement trois heures à 1 Hz, à 1 % près sur la longueur, bouts et balises intacts', () => {
    // Une boucle de 10 800 points, avec un bruit de ±1 m. Le bruit allonge la trace brute ;
    // l'amincie retrouve la longueur du tracé sans bruit.
    const clean: [number, number][] = [];
    for (let i = 0; i < 10_800; i++) {
      const a = (2 * Math.PI * i) / 10_800;
      clean.push([3000 * Math.cos(a), 2000 * Math.sin(2 * a)]);
    }
    const marks = [at(3000, 0), at(-3000, 0)];
    const trace = { ...traceOf(clean.map(([e, n]) => [e + 2 * noise(), n + 2 * noise()])), marks };
    const thin = thinFollowedTrace(trace, FOLLOWED_TRACE_TOLERANCE_M);
    expect(thin.points.length).toBeLessThan(trace.points.length / 5);
    expect(thin.points[0]).toEqual({ lat: Math.round(trace.points[0].lat * 1e6) / 1e6, lon: Math.round(trace.points[0].lon * 1e6) / 1e6 });
    expect(thin.marks).toBe(marks);
    expect(thin.name).toBe(trace.name);
    expect(Math.abs(followedTraceLengthM(thin) / followedTraceLengthM(traceOf(clean)) - 1)).toBeLessThan(0.01);
    // Plus léger d'un facteur dix une fois gardé.
    expect(JSON.stringify(thin).length).toBeLessThan(JSON.stringify(trace).length / 10);
  });

  it('suit la même avancée que la trace complète', () => {
    const line = traceOf(walk([[0, 0], [0, 500], [400, 900]], 1).map((p) => [
      (p.lon - ORIGIN.lon) * mPerDegLon(ORIGIN.lat), (p.lat - ORIGIN.lat) * M_PER_DEG_LAT,
    ] as [number, number]));
    const thin = thinFollowedTrace(line, FOLLOWED_TRACE_TOLERANCE_M);
    expect(thin.points.length).toBe(3);
    const fixes = [walk([[0, 0], [0, 500], [200, 700]], 5)];
    expect(followProgress(thin, fixes)!.progressM).toBeCloseTo(followProgress(line, fixes)!.progressM, -1);
  });
});

describe('altitude de la trace suivie', () => {
  const MIN_GAIN = ELEVATION_PRESETS.route.minGainM;
  const gainOf = (trace: FollowedTrace): number => accumulateElevation(trace.points.map((p) => p.eleM ?? NaN), MIN_GAIN).gainM;

  /** Générateur pseudo-aléatoire à graine fixe. */
  const noiseFrom = (start: number) => {
    let seed = start;
    return () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31 - 0.5;
    };
  };

  /** Deux bosses de 60 et 40 m, sur 6 km : altitude à `d` mètres. */
  const twoHills = (d: number): number => 100 + (d < 3000 ? 60 * Math.sin((Math.PI * d) / 3000) : 40 * Math.sin((Math.PI * (d - 3000)) / 3000));

  /** Session sur une route vers le nord à 3 m/s, à `hz` points par seconde, bruit d'altitude de ±`noiseM` mètres. */
  const session = (hz: number, noiseM: number) => {
    const noise = noiseFrom(7);
    return Array.from({ length: 2000 * hz + 1 }, (_, i) => {
      const d = (3 * i) / hz;
      return { ...at(0, d), ele: twoHills(d) + 2 * noiseM * noise() };
    });
  };

  it('garde l\'altitude d\'un itinéraire calculé', () => {
    let route = [A, B].reduce((r, p) => addWaypoint(r, p, 'sentier'), EMPTY_ROUTE);
    route = withLegResult(route, legKey(route, 0)!, [{ ...A, eleM: 100 }, { lat: 43.605, lon: 3.801, eleM: 120 }, { ...B, eleM: 110 }]);
    const trace = followedTraceFromRoute(routeToRecord(route, META));
    expect(trace?.points.map((p) => p.eleM)).toEqual([100, 120, 110]);
    // Les balises restent des positions.
    expect(trace?.marks).toEqual([A, B]);
  });

  it('écarte une altitude illisible, sans écarter le point', () => {
    const stored = [{ ...A, eleM: 100 }, { ...B, eleM: NaN }, { ...C, eleM: 'haut' as unknown as number }];
    expect(followedTraceFromPoints(stored, 'Relue', 'route')?.points).toEqual([{ ...A, eleM: 100 }, B, C]);
  });

  it('relit à l\'identique une ancienne trace sans altitude, amincie comme avant', () => {
    const old = traceOf([[0, 0], [0, 500], [400, 900]]);
    expect(old.points.every((p) => !('eleM' in p))).toBe(true);
    expect(thinFollowedTrace(old, FOLLOWED_TRACE_TOLERANCE_M).points.every((p) => !('eleM' in p))).toBe(true);
    expect(thinFollowedTrace(old, FOLLOWED_TRACE_TOLERANCE_M).points).toHaveLength(3);
  });

  it('une session à terre porte son altitude lissée, le même D+ à 1 Hz et à 5 Hz', () => {
    const at1Hz = followedTraceFromSession(session(1, 3), 'Sortie', 'course', { land: true })!;
    const at5Hz = followedTraceFromSession(session(5, 3), 'Sortie', 'course', { land: true })!;
    // Sans lissage, le bruit gonfle le D+ ; lissé, il reste celui des deux bosses (100 m).
    const rough = accumulateElevation(session(1, 3).map((p) => p.ele), MIN_GAIN).gainM;
    expect(gainOf(at1Hz)).toBeLessThan(rough);
    expect(gainOf(at1Hz)).toBeGreaterThan(90);
    expect(gainOf(at1Hz)).toBeLessThan(115);
    expect(Math.abs(gainOf(at1Hz) - gainOf(at5Hz))).toBeLessThan(5);
  });

  it('une session hors terre garde ses positions seules', () => {
    const trace = followedTraceFromSession(session(1, 0), 'Sortie', 'wingfoil', { land: false })!;
    expect(trace.points.every((p) => !('eleM' in p))).toBe(true);
    expect(trace.source).toBe('session');
    expect(trace.activityId).toBe('wingfoil');
  });

  it('une session à terre sans altitude reste sans altitude', () => {
    const flat = session(1, 0).map(({ lat, lon }) => ({ lat, lon }));
    expect(followedTraceFromSession(flat, 'Sortie', 'course', { land: true })!.points.every((p) => !('eleM' in p))).toBe(true);
  });

  it('amincir garde les sommets, et deux fois garde le D+ à 1 m près', () => {
    const full = followedTraceFromSession(session(1, 0), 'Sortie', 'course', { land: true })!;
    const once = thinFollowedTrace(full, FOLLOWED_TRACE_TOLERANCE_M);
    const twice = thinFollowedTrace(once, FOLLOWED_TRACE_TOLERANCE_M);
    // La route est droite : seul le relief garde des points.
    expect(once.points.length).toBeGreaterThan(5);
    expect(once.points.length).toBeLessThan(full.points.length / 5);
    expect(Math.abs(gainOf(once) - gainOf(full))).toBeLessThanOrEqual(FOLLOWED_TRACE_ELEVATION_TOLERANCE_M);
    expect(Math.abs(gainOf(twice) - gainOf(once))).toBeLessThanOrEqual(FOLLOWED_TRACE_ELEVATION_TOLERANCE_M);
  });

  it('trois heures à 1 Hz sur un parcours sinueux et vallonné : moins de 80 Ko, altitude comprise', () => {
    const noise = noiseFrom(42);
    const points = Array.from({ length: 10_800 }, (_, i) => {
      const a = (2 * Math.PI * i) / 10_800;
      const d = 3 * i;
      return {
        ...at(3000 * Math.cos(a) + 40 * Math.sin(d / 60) + 2 * noise(), 2000 * Math.sin(2 * a) + 40 * Math.cos(d / 45) + 2 * noise()),
        eleM: 200 + 80 * Math.sin(d / 900) + 40 * Math.sin(d / 170),
      };
    });
    const trace = followedTraceFromPoints(points, 'Boucle', 'route')!;
    const flat = followedTraceFromPoints(points.map(({ lat, lon }) => ({ lat, lon })), 'Boucle', 'route')!;
    const size = (t: FollowedTrace): number => JSON.stringify(thinFollowedTrace(t, FOLLOWED_TRACE_TOLERANCE_M)).length;
    expect(size(trace)).toBeLessThan(80_000);
    expect(size(trace)).toBeLessThan(2.5 * size(flat));
    expect(size(trace)).toBeLessThan(JSON.stringify(trace).length / 5);
  });
});
