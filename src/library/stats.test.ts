import { describe, expect, it } from 'vitest';
import type { Activity } from '../core/activities';
import type { SessionRecord } from './record';
import {
  averageMovingSpeedMs, cardioLoadBars, cardioTotals, dateTicks, groupTotals, heartRatePoints, maxSpeedSeries, recordKindsOf, regularity,
  sessionLoad, statSessionOf, statsPeriodBounds, statsTotals, topSessions, type StatSession,
} from './stats';

// Dates construites à l'heure locale : les tests ne dépendent pas du fuseau de la machine.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

const session = (startMs: number, over: Partial<StatSession> = {}): StatSession => ({
  file: `s-${startMs}.json`,
  name: null,
  startMs,
  endMs: startMs + 3_600_000,
  distanceM: 10_000,
  movingTimeS: 3000,
  elevationGainM: null,
  maxSpeedMs: 5,
  activityId: 'course',
  family: 'course',
  treatment: 'course',
  maneuverCount: null,
  waveCount: null,
  longestWaveM: null,
  longestFlightS: null,
  reps: 0,
  heartRate: null,
  ...over,
});

describe('statSessionOf', () => {
  it('reprend le résumé, la famille du calcul et compte les répétitions du compteur', () => {
    const record = {
      name: 'Piste',
      summary: { calcVersion: 2, startMs: 1000, endMs: 61_000, distanceM: 400, movingTimeS: 50, elevationGainM: 2, maxSpeedMs: 7, pointCount: 60, samplingS: 1 },
      intervals: [{
        workout: { reps: 2, workS: 10, restS: 10 },
        laps: [
          { kind: 'travail', rep: 1, startMs: 0, endMs: 1 }, { kind: 'repos', rep: 1, startMs: 1, endMs: 2 },
          { kind: 'travail', rep: 2, startMs: 2, endMs: 3 },
        ],
      }],
    } as unknown as SessionRecord;
    const activity: Activity = { id: 'frac', name: 'Fractionné à pied', base: 'run-intervals', color: '#c25700' };
    const s = statSessionOf('a.json', record, activity);
    expect(s).toMatchObject({ file: 'a.json', name: 'Piste', family: 'fractionne', treatment: 'course', reps: 2, maneuverCount: null });
  });
});

describe('statsTotals', () => {
  it('additionne, et ne compte que les sessions qui connaissent le temps en action, le D+ ou les manœuvres', () => {
    const t = statsTotals([
      session(at(2026, 3, 1), { elevationGainM: 120, maxSpeedMs: 6 }),
      session(at(2026, 3, 2), { movingTimeS: null, distanceM: 5000 }),
      session(at(2026, 3, 3), { maneuverCount: 12, family: 'voile', treatment: 'voile' }),
    ]);
    expect(t.sessions).toBe(3);
    expect(t.durationS).toBe(3 * 3600);
    expect(t.distanceM).toBe(25_000);
    expect(t.movingTimeS).toBe(6000);
    expect(t.movingDistanceM).toBe(20_000);
    expect(averageMovingSpeedMs(t)).toBeCloseTo(20_000 / 6000);
    expect(t.elevationGainM).toBe(120);
    expect(t.elevationSessions).toBe(1);
    expect(t.maxSpeedMs).toBe(6);
    expect(t.maneuvers).toBe(12);
    expect(t.maneuverSessions).toBe(1);
  });

  it('rend des totaux nuls sans session, sans vitesse moyenne', () => {
    const t = statsTotals([]);
    expect(t.sessions).toBe(0);
    expect(t.maxSpeedMs).toBeNull();
    expect(averageMovingSpeedMs(t)).toBeNull();
  });

  it('range par groupe dans l’ordre donné, les inconnus après', () => {
    const groups = groupTotals(
      [session(1, { activityId: 'b' }), session(2, { activityId: 'x' }), session(3, { activityId: 'a' }), session(4, { activityId: 'b' })],
      (s) => s.activityId, ['a', 'b', 'c']
    );
    expect(groups.map((g) => [g.key, g.totals.sessions])).toEqual([['a', 1], ['b', 2], ['x', 1]]);
  });
});

describe('maxSpeedSeries', () => {
  it('trie par date, suit le record établi et écarte les sessions sans vitesse', () => {
    const points = maxSpeedSeries([
      session(at(2026, 3, 3), { maxSpeedMs: 7 }),
      session(at(2026, 3, 1), { maxSpeedMs: 5 }),
      session(at(2026, 3, 2), { maxSpeedMs: 4 }),
      session(at(2026, 3, 4), { maxSpeedMs: 0 }),
    ]);
    expect(points.map((p) => [p.maxSpeedMs, p.bestMs, p.isRecord])).toEqual([[5, 5, true], [4, 5, false], [7, 7, true]]);
  });
});

describe('regularity', () => {
  const now = at(2026, 9, 25, 18); // vendredi, semaine 39

  it('compte les semaines actives, la plus longue suite et la suite en cours', () => {
    // Semaines 30, 31, 32 actives, 33 vide, 34 active, puis rien jusqu'à la 38, active, et la 39 vide.
    const sessions = [at(2026, 7, 21), at(2026, 7, 28), at(2026, 7, 29), at(2026, 8, 4), at(2026, 8, 18), at(2026, 9, 15)].map((t) => session(t));
    const r = regularity(sessions, statsPeriodBounds('sixmois', now), now, ['course']);
    // De la semaine 30, celle de la plus vieille session, à la 39 : pas les six mois.
    expect(r.weeks).toBe(10);
    expect(r.activeWeeks).toBe(5);
    expect(r.longestStreak).toBe(3);
    // La semaine 39 n'est pas finie : la suite de la 38 tient toujours.
    expect(r.currentStreak).toBe(1);
    expect(r.weeksSinceLast).toBe(1);
    expect(r.perWeek).toBeCloseTo(6 / 10);
    expect(r.barUnit).toBe('semaine');
    expect(r.bars).toHaveLength(10);
    expect(r.bars[0].label).toBe('S30');
    expect(r.bars.find((b) => b.label === 'S31')?.count).toBe(2);
  });

  it('compte toute la période quand une session la précède', () => {
    const sessions = [at(2025, 1, 6), at(2026, 7, 21), at(2026, 9, 15)].map((t) => session(t));
    const r = regularity(sessions, statsPeriodBounds('sixmois', now), now, ['course']);
    expect(r.weeks).toBe(26);
    expect(r.perWeek).toBeCloseTo(2 / 26);
    expect(r.bars).toHaveLength(26);
  });

  it('part de la plus vieille session sur une année', () => {
    // Première session le lundi de la semaine 32 : 8 semaines comptées jusqu'à la 39, pas 52.
    const sessions = [at(2026, 8, 3), at(2026, 9, 21)].map((t) => session(t));
    const r = regularity(sessions, statsPeriodBounds('annee', now), now, ['course']);
    expect(r.weeks).toBe(8);
    expect(r.perWeek).toBeCloseTo(2 / 8);
  });

  it('suit une suite à cheval sur deux années', () => {
    const sessions = [at(2025, 12, 22), at(2025, 12, 29), at(2026, 1, 5), at(2026, 1, 12)].map((t) => session(t));
    const r = regularity(sessions, statsPeriodBounds('tout', at(2026, 1, 14)), at(2026, 1, 14), []);
    expect(r.weeks).toBe(4);
    expect(r.longestStreak).toBe(4);
    expect(r.currentStreak).toBe(4);
    expect(r.weeksSinceLast).toBe(0);
  });

  it('compte juste les semaines au changement d’heure', () => {
    // Passage à l'heure d'été le 29 mars 2026 : les lundis restent des lundis.
    const sessions = [at(2026, 3, 23), at(2026, 3, 30), at(2026, 4, 6)].map((t) => session(t));
    const r = regularity(sessions, statsPeriodBounds('tout', at(2026, 4, 8)), at(2026, 4, 8), []);
    expect(r.weeks).toBe(3);
    expect(r.longestStreak).toBe(3);
    expect(r.bars.map((b) => b.label)).toEqual(['S13', 'S14', 'S15']);
  });

  it('passe aux barres par mois au-delà d’un an, depuis la première session', () => {
    const sessions = [at(2024, 6, 10), at(2025, 2, 3), at(2026, 9, 21)].map((t) => session(t, { activityId: 'velo' }));
    const r = regularity(sessions, statsPeriodBounds('tout', now), now, ['course', 'velo']);
    expect(r.barUnit).toBe('mois');
    // De juin 2024 à septembre 2026.
    expect(r.bars).toHaveLength(28);
    expect(r.bars.reduce((n, b) => n + b.count, 0)).toBe(3);
    expect(r.bars[0].stacks).toEqual([{ activityId: 'velo', count: 1 }]);
    expect(r.weeksSinceLast).toBe(0);
  });

  it('sans session : aucune semaine et rien depuis la dernière', () => {
    const r = regularity([], statsPeriodBounds('tout', now), now, []);
    expect(r).toMatchObject({ weeks: 0, activeWeeks: 0, perWeek: 0, longestStreak: 0, currentStreak: 0, weeksSinceLast: null, bars: [] });
  });
});

describe('records', () => {
  it('classe les meilleures sessions, la plus ancienne d’abord à égalité, sans celles qui n’ont pas la valeur', () => {
    const a = session(at(2026, 3, 1), { elevationGainM: 300 });
    const b = session(at(2026, 3, 2), { elevationGainM: 500 });
    const c = session(at(2026, 3, 3), { elevationGainM: 300 });
    const d = session(at(2026, 3, 4));
    expect(topSessions([d, c, b, a], 'denivele').map((e) => e.session)).toEqual([b, a, c]);
    expect(topSessions([a, b], 'denivele', 1).map((e) => e.value)).toEqual([500]);
  });

  it('propose les records de chaque famille', () => {
    expect(recordKindsOf('voile')).toContain('manoeuvres');
    expect(recordKindsOf('surf')).toEqual(expect.arrayContaining(['vague', 'vol']));
    expect(recordKindsOf('fractionne')).toContain('denivele');
    expect(recordKindsOf(null)).not.toContain('vitesse');
  });
});

describe('dateTicks', () => {
  it('prend des jours sur une semaine', () => {
    const { ticks, unit } = dateTicks(at(2026, 3, 2, 0), at(2026, 3, 6, 0));
    expect(unit).toBe('jour');
    expect(ticks).toHaveLength(5);
  });

  it('prend des lundis sur un mois', () => {
    const { ticks, unit } = dateTicks(at(2026, 3, 1), at(2026, 3, 31));
    expect(unit).toBe('jour');
    expect(ticks.every((t) => new Date(t).getDay() === 1)).toBe(true);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it('prend des débuts de mois sur une année, de trimestre ou d’année au-delà', () => {
    const year = dateTicks(at(2026, 1, 15), at(2026, 12, 15));
    expect(year.unit).toBe('mois');
    expect(year.ticks.every((t) => new Date(t).getDate() === 1)).toBe(true);
    const decade = dateTicks(at(2016, 5, 1), at(2026, 5, 1));
    expect(decade.unit).toBe('annee');
    expect(decade.ticks.every((t) => new Date(t).getMonth() === 0)).toBe(true);
  });
});

describe('cardio', () => {
  const bounds = [100, 120, 140, 160, 180];
  const weights = [0.5, 1, 2, 3, 4, 5];
  // 10 min à 130 (Z2), 10 min à 170 (Z4) : charge 10 × 2 + 10 × 4 = 60.
  const hr = (avgBpm: number) => ({ avgBpm, maxBpm: 171, coveredS: 1200, histogram: { fromBpm: 130, seconds: [600, ...new Array(39).fill(0), 600] } });

  it("tire la charge et les zones de l'histogramme, avec les zones du moment", () => {
    const s = session(at(2026, 10, 5), { heartRate: hr(150) });
    expect(sessionLoad(s, bounds, weights)).toBeCloseTo(60, 6);
    expect(sessionLoad(session(at(2026, 10, 5)), bounds, weights)).toBeNull();
    // Zones plus hautes : les 130 tombent en Z1, les 170 en Z3.
    expect(sessionLoad(s, [125, 140, 160, 175, 185], weights)).toBeCloseTo(10 * 1 + 10 * 3, 6);
    // Zones plus hautes encore : les 130 tombent sous Z1 et comptent à 0,5.
    expect(sessionLoad(s, [135, 150, 165, 175, 185], weights)).toBeCloseTo(10 * 0.5 + 10 * 3, 6);
  });

  it('fait les totaux sur les seules sessions à FC', () => {
    const list = [session(at(2026, 10, 5), { heartRate: hr(150) }), session(at(2026, 10, 6), { heartRate: hr(130) }), session(at(2026, 10, 7))];
    const t = cardioTotals(list, bounds, weights);
    expect(t.sessions).toBe(2);
    expect(t.coveredS).toBe(2400);
    expect(t.avgBpm).toBeCloseTo(140, 6);
    expect(t.maxBpm).toBe(171);
    expect(t.zoneTimesS).toEqual([0, 0, 1200, 0, 1200, 0]);
    expect(t.load).toBeCloseTo(120, 6);
    expect(cardioTotals(list, null, weights)).toMatchObject({ zoneTimesS: null, load: null, sessions: 2 });
  });

  it('range la charge par semaine et la FC par session', () => {
    const list = [session(at(2026, 10, 5), { heartRate: hr(150) }), session(at(2026, 10, 14), { heartRate: hr(130) })];
    const reg = regularity(list, { fromMs: at(2026, 10, 5, 0), toMs: at(2026, 10, 19, 0) }, at(2026, 10, 18), ['course']);
    const bars = cardioLoadBars(reg.bars, list, bounds, weights);
    expect(bars.map((b) => Math.round(b.load))).toEqual([60, 60]);
    expect(heartRatePoints([...list].reverse()).map((p) => p.avgBpm)).toEqual([150, 130]);
  });
});
