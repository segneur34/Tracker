import { describe, expect, it } from 'vitest';
import type { Activity } from '../core/activities';
import type { SessionRecord } from './record';
import {
  averageMovingSpeedMs, cardioLoadBars, cardioTotals, dateTicks, groupTotals, heartRatePoints, metricSeries, metricsOf, recordKindsOf, regularity,
  inBounds, sessionLoad, statSessionOf, statsMetric, statsPeriodBounds, statsTotals, topSessions, weeklyDurations, type StatSession,
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
  movingDistanceM: 9000,
  elevationGainM: null,
  maxSpeedMs: 5,
  activityId: 'course',
  family: 'course',
  treatment: 'course',
  positions: true,
  maneuverCount: null,
  maneuverResults: null,
  foil: false,
  waveCount: null,
  longestWaveM: null,
  longestFlightS: null,
  flightS: null,
  reps: 0,
  heartRate: null,
  cadenceSpm: null,
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
    // Fiche d'avant la version 5 : ni distance en action, ni temps de vol, ni réussite.
    expect(s).toMatchObject({ movingDistanceM: null, flightS: null, maneuverResults: null, foil: false });
    expect(statSessionOf('a.json', record, activity, true).foil).toBe(true);
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
    // La distance en action, pas la distance entière.
    expect(t.movingDistanceM).toBe(18_000);
    expect(averageMovingSpeedMs(t)).toBeCloseTo(18_000 / 6000);
    expect(t.elevationGainM).toBe(120);
    expect(t.elevationSessions).toBe(1);
    expect(t.maxSpeedMs).toBe(6);
    expect(t.maneuvers).toBe(12);
    expect(t.maneuverSessions).toBe(1);
  });

  it('reprend la distance entière d\'une fiche pas encore recalculée', () => {
    const t = statsTotals([session(at(2026, 3, 1), { movingDistanceM: null })]);
    expect(t.movingDistanceM).toBe(10_000);
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

describe('metricSeries', () => {
  it('vitesse max : trie par date, suit le record établi et écarte les sessions sans vitesse', () => {
    const [serie] = metricSeries([
      session(at(2026, 3, 3), { maxSpeedMs: 7 }),
      session(at(2026, 3, 1), { maxSpeedMs: 5 }),
      session(at(2026, 3, 2), { maxSpeedMs: 4 }),
      session(at(2026, 3, 4), { maxSpeedMs: 0 }),
    ], statsMetric('vmax'));
    expect(serie.points.map((p) => [p.value, p.line, p.isRecord])).toEqual([[5, 5, true], [4, 5, false], [7, 7, true]]);
  });

  it('les autres données : une tendance sur les 5 dernières sessions', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((d) => session(at(2026, 3, d), { distanceM: d * 1000 }));
    const [serie] = metricSeries(list, statsMetric('distance'));
    expect(serie.points.map((p) => p.line)).toEqual([1000, 1500, 2000, 2500, 3000, 4000, 5000]);
    expect(serie.points.every((p) => !p.isRecord)).toBe(true);
    // Une tendance d'une seule session : la valeur elle-même.
    expect(metricSeries(list, statsMetric('distance'), 1)[0].points.map((p) => p.line)).toEqual(list.map((s) => s.distanceM));
  });

  it('moyenne en action : distance sur temps en action, rien sans eux', () => {
    const [serie] = metricSeries([
      session(at(2026, 3, 1)),
      session(at(2026, 3, 2), { movingDistanceM: null }),
      session(at(2026, 3, 3), { movingTimeS: null }),
    ], statsMetric('moyenne'));
    expect(serie.points.map((p) => p.value)).toEqual([3]);
  });

  it('% de vol : sur foil seulement en voile, le temps des vols en surf, borné à 100', () => {
    const voile = { family: 'voile', treatment: 'voile' } as const;
    const [serie] = metricSeries([
      session(at(2026, 3, 1), { ...voile, foil: true, movingTimeS: 1800 }),
      session(at(2026, 3, 2), { ...voile, foil: false, movingTimeS: 1800 }),
      session(at(2026, 3, 3), { family: 'surf', treatment: 'surf', flightS: 900 }),
      session(at(2026, 3, 4), { family: 'surf', treatment: 'surf', flightS: null }),
      session(at(2026, 3, 5), { ...voile, foil: true, movingTimeS: 99_999 }),
    ], statsMetric('vol'));
    expect(serie.points.map((p) => p.value)).toEqual([50, 25, 100]);
  });

  it('% de manœuvres réussies : virements et empannages en deux séries', () => {
    const voile = { family: 'voile', treatment: 'voile' } as const;
    const series = metricSeries([
      session(at(2026, 3, 1), { ...voile, maneuverResults: { tackSuccess: 3, tackFail: 1, jibeSuccess: 0, jibeFail: 0 } }),
      session(at(2026, 3, 2), { ...voile, maneuverResults: { tackSuccess: 0, tackFail: 2, jibeSuccess: 1, jibeFail: 1 } }),
      session(at(2026, 3, 3), { ...voile, maneuverCount: 6 }),
    ], statsMetric('reussite'));
    expect(series.map((s) => s.key)).toEqual(['virements', 'empannages']);
    expect(series[0].points.map((p) => p.value)).toEqual([75, 0]);
    expect(series[1].points.map((p) => p.value)).toEqual([50]);
  });
});

describe('metricsOf', () => {
  const keys = (family: Parameters<typeof metricsOf>[0], list: StatSession[]) => metricsOf(family, list).map((m) => m.key);

  it('propose les données de la famille qui ont une valeur', () => {
    expect(keys('course', [session(at(2026, 3, 1), { elevationGainM: 80 })])).toEqual(['vmax', 'moyenne', 'duree', 'distance', 'denivele']);
    expect(keys('course', [session(at(2026, 3, 1))])).toEqual(['vmax', 'moyenne', 'duree', 'distance']);
    const voile = { family: 'voile', treatment: 'voile' } as const;
    expect(keys('voile', [session(at(2026, 3, 1), voile)])).toEqual(['vmax', 'moyenne', 'duree', 'distance']);
    expect(keys('voile', [session(at(2026, 3, 1), { ...voile, foil: true, maneuverResults: { tackSuccess: 1, tackFail: 0, jibeSuccess: 0, jibeFail: 0 } })]))
      .toEqual(['vmax', 'moyenne', 'duree', 'distance', 'vol', 'reussite']);
    const surf = { family: 'surf', treatment: 'surf', waveCount: 4, longestWaveM: 80 } as const;
    expect(keys('surf', [session(at(2026, 3, 1), surf)])).toEqual(['vmax', 'moyenne', 'duree', 'distance', 'vagues', 'vague']);
    expect(keys('surf', [session(at(2026, 3, 1), { ...surf, flightS: 600, longestFlightS: 120 })]))
      .toEqual(['vmax', 'moyenne', 'duree', 'distance', 'vol', 'vagues', 'vague', 'volMax']);
  });

  it('cadence moyenne : à pied, quand une session en a', () => {
    expect(keys('course', [session(at(2026, 3, 1), { cadenceSpm: 168 })])).toEqual(['vmax', 'moyenne', 'duree', 'distance', 'cadence']);
    expect(keys('fractionne', [session(at(2026, 3, 1), { family: 'fractionne', cadenceSpm: 176 })])).toContain('cadence');
    expect(keys('velo', [session(at(2026, 3, 1), { family: 'velo', treatment: 'velo', cadenceSpm: 80 })])).not.toContain('cadence');
    expect(metricSeries([session(at(2026, 3, 1), { cadenceSpm: 168 }), session(at(2026, 3, 2))], statsMetric('cadence'))[0].points).toHaveLength(1);
  });

  it('vue d\'ensemble : la durée seule ; rien sans session', () => {
    expect(keys(null, [session(at(2026, 3, 1))])).toEqual(['duree']);
    expect(keys('course', [])).toEqual([]);
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

describe('session datée du futur', () => {
  it('hors de la période courante, mais comptée sur « tout »', () => {
    const now = at(2026, 10, 27);
    const future = session(at(2026, 12, 25));
    const week = statsPeriodBounds('semaine', now);
    expect(inBounds(future.startMs, week)).toBe(false);
    expect(inBounds(session(at(2026, 10, 28)).startMs, week)).toBe(true);
    expect(inBounds(future.startMs, statsPeriodBounds('tout', now))).toBe(true);
    expect(statsTotals([future]).sessions).toBe(1);
  });
});

describe('dateTicks, fuseau', () => {
  it('les repères tombent sur des minuits locales (Paris) : lundis et débuts de mois', () => {
    const { ticks } = dateTicks(at(2026, 8, 1), at(2026, 8, 31));
    expect(ticks.every((t) => new Date(t).getHours() === 0 && new Date(t).getDay() === 1)).toBe(true);
    // 31 août 00:00 local = 30 août 22:00 UTC : un repère en UTC tomberait un dimanche.
    expect(ticks).toContain(new Date(2026, 7, 31).getTime());
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

  it('sur dix ans, un repère tous les deux ans ; sur trois ans, tous les six mois', () => {
    const decade = dateTicks(at(2016, 5, 1), at(2026, 5, 1));
    expect(decade.ticks.map((t) => new Date(t).getFullYear())).toEqual([2018, 2020, 2022, 2024, 2026]);
    const three = dateTicks(at(2023, 2, 10), at(2026, 2, 10));
    expect(three.unit).toBe('mois');
    expect(three.ticks.map((t) => new Date(t).getMonth())).toEqual([6, 0, 6, 0, 6, 0]);
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
    const t = cardioTotals(list, () => bounds, weights);
    expect(t.sessions).toBe(2);
    expect(t.coveredS).toBe(2400);
    expect(t.avgBpm).toBeCloseTo(140, 6);
    expect(t.maxBpm).toBe(171);
    expect(t.zoneTimesS).toEqual([0, 0, 1200, 0, 1200, 0]);
    expect(t.load).toBeCloseTo(120, 6);
    expect(cardioTotals(list, null, weights)).toMatchObject({ zoneTimesS: null, load: null, sessions: 2 });
  });

  it("prend les zones de chaque session, décalées pour son activité", () => {
    const list = [session(at(2026, 10, 5), { heartRate: hr(150) }), session(at(2026, 10, 6), { heartRate: hr(150), activityId: 'velo' })];
    // Zones du vélo plus hautes : ses 130 tombent en Z1, ses 170 restent en Z4.
    const t = cardioTotals(list, (s) => (s.activityId === 'velo' ? [125, 140, 160, 165, 185] : bounds), weights);
    expect(t.zoneTimesS).toEqual([0, 600, 600, 0, 1200, 0]);
  });

  it('range la charge par semaine et la FC par session', () => {
    const list = [session(at(2026, 10, 5), { heartRate: hr(150) }), session(at(2026, 10, 14), { heartRate: hr(130) })];
    const reg = regularity(list, { fromMs: at(2026, 10, 5, 0), toMs: at(2026, 10, 19, 0) }, at(2026, 10, 18), ['course']);
    const bars = cardioLoadBars(reg.bars, list, () => bounds, weights);
    expect(bars.map((b) => Math.round(b.load))).toEqual([60, 60]);
    expect(heartRatePoints([...list].reverse()).map((p) => p.avgBpm)).toEqual([150, 130]);
  });
});

describe('muscu dans les statistiques (lot I du 25/10)', () => {
  it('compte en sessions et en durée, ni en temps ni en vitesse en action, ni en distance', () => {
    const run = session(at(2026, 3, 1));
    const muscu = session(at(2026, 3, 2), {
      family: 'fractionne', treatment: 'muscu', positions: false, distanceM: 0, movingDistanceM: null, maxSpeedMs: 0, movingTimeS: 1800,
    });
    const t = statsTotals([run, muscu]);
    expect(t.sessions).toBe(2);
    expect(t.durationS).toBe(7200);
    expect(t.movingTimeS).toBe(3000);
    expect(averageMovingSpeedMs(t)).toBeCloseTo(3, 6);
    expect(metricsOf('fractionne', [muscu]).map((m) => m.key)).toEqual(['duree']);
  });
});

describe('weeklyDurations', () => {
  it('somme les durées par semaine du lundi, zéros compris, dans l ordre', () => {
    // Lundi 20/10/2025 et lundi 3/11/2025 : la semaine du 27/10 est vide.
    const weeks = weeklyDurations([
      session(at(2025, 11, 5), { endMs: at(2025, 11, 5) + 1_800_000 }),
      session(at(2025, 10, 20, 0), { endMs: at(2025, 10, 20, 0) + 3_600_000 }),
      session(at(2025, 10, 26, 23), { endMs: at(2025, 10, 26, 23) + 7_200_000 }),
    ]);
    expect(weeks.map((w) => w.weekStartMs)).toEqual([at(2025, 10, 20, 0), at(2025, 10, 27, 0), at(2025, 11, 3, 0)]);
    expect(weeks.map((w) => w.durationS)).toEqual([10_800, 0, 1800]);
  });
  it('pose le point au milieu de la semaine', () => {
    const [w] = weeklyDurations([session(at(2025, 10, 22))]);
    expect(w.midMs).toBe(at(2025, 10, 23, 12));
  });
  it('une sélection vide donne un tableau vide', () => {
    expect(weeklyDurations([])).toEqual([]);
  });
});
