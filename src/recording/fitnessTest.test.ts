import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../core/geo';
import type { LocationFix } from '../platform/location';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { kmhToMs, msToKmh } from '../core/units';
import {
  FITNESS_TESTS,
  closeFitnessTest,
  closeSessionTest,
  finishRamp,
  fixSpeedMs,
  guideReadings,
  phaseRemainingS,
  readSessionTest,
  replayFitnessTest,
  resolveFitnessTestParams,
  sanitizeFitnessTestSettings,
  startFitnessTest,
  stepFitnessTest,
  testPlan,
  type FitnessTestState,
  type TestSample,
} from './fitnessTest';
import type { TestSignal } from './signalTones';
import { mPerDegLon } from '../test/geo.fixture';

const PROTOCOL = FITNESS_TESTS['fc-max'];
const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);
const DEFAULT_SETTINGS = { warmupS: PROTOCOL.warmupS, warmupCeilingBpm: PROTOCOL.warmupCeilingBpm };
const MODEL = SPORT_PROFILES['run-test'].heartRate.zoneModel;
const NO_HR = { hrMax: null, hrRest: null, hrThresholds: null };
/** Seuils saisis du scénario : zones 2 à 3 de 78 à 88 bpm. */
const RUNNER = { athlete: { ...NO_HR, hrThresholds: [87, 88] }, age: null, zoneModel: MODEL, offsetBpm: 0 };
const params = () => resolveFitnessTestParams(PROTOCOL, DEFAULT_SETTINGS, RUNNER);

/** Vitesse d'un palier de la rampe du scénario (départ à 6 km/h). */
const stepKmh = (k: number) => 6 + 0.6 * k;

/**
 * Scénario : échauffement de 8 min (FC basse, dans la bande, trop haute, dans
 * la bande ; 6,2 km/h la dernière minute), six paliers suivis exactement, le
 * septième effondré (70 % de sa cible), puis récupération.
 */
const scenarioAt = (t: number): { speedKmh: number; hr: number } => {
  if (t < 480) {
    const hr = t < 60 ? 70 : t < 200 ? 83 : t < 260 ? 95 : 84;
    return { speedKmh: t >= 420 ? 6.2 : 6, hr };
  }
  if (t < 880) {
    const k = Math.floor((t - 480) / 60);
    return { speedKmh: k < 6 ? stepKmh(k) : 0.7 * stepKmh(6), hr: 84 + ((180 - 84) * (t - 480)) / 400 };
  }
  const r = t - 880;
  return { speedKmh: 4, hr: r <= 60 ? 180 - (30 * r) / 60 : 150 - (10 * (r - 60)) / 60 };
};

const samples = (hz: number, endS = 1000, options: { hr?: boolean } = {}): TestSample[] => {
  const out: TestSample[] = [];
  for (let k = 0; k <= endS * hz; k++) {
    const t = k / hz;
    const { speedKmh, hr } = scenarioAt(t);
    out.push({ timeMs: T0 + Math.round(t * 1000), speedMs: kmhToMs(speedKmh), ...(options.hr === false ? {} : { hrBpm: hr }) });
  }
  return out;
};

const run = (list: TestSample[], state: FitnessTestState = startFitnessTest(params())) => {
  const signals: { t: number; s: TestSignal }[] = [];
  let current = state;
  for (const sample of list) {
    const step = stepFitnessTest(current, sample);
    current = step.state;
    if (step.signal) signals.push({ t: (sample.timeMs - T0) / 1000, s: step.signal });
  }
  return { state: current, signals };
};

describe('resolveFitnessTestParams', () => {
  const resolve = (athlete: typeof NO_HR | typeof RUNNER.athlete | { hrMax: number; hrRest: number | null; hrThresholds: null }, age: number | null) =>
    resolveFitnessTestParams(PROTOCOL, DEFAULT_SETTINGS, { athlete, age, zoneModel: MODEL, offsetBpm: 0 });

  it('échauffement en zones 2 à 3 : FC max estimée par l’âge, 35 ans sans âge ; haut coupé au plafond de 155 bpm', () => {
    // 208 − 0,7 × 35 = 184 : S1 144, S2 164 ; Z2 à 90 % de S1, Z4 aux deux tiers de S1 à S2 (158, coupé à 155).
    expect(resolve(NO_HR, null)).toMatchObject({ age: 35, ageSource: 'defaut', hrMaxRefBpm: 184, warmupLowBpm: 130, warmupHighBpm: 155, warmupCeilingBpm: 155 });
    expect(resolve(NO_HR, null).zones).toMatchObject({ method: 'max', estimated: true });
    // 154 : sous le plafond, inchangé.
    expect(resolve(NO_HR, 40)).toMatchObject({ age: 40, ageSource: 'profil', hrMaxRefBpm: 180, warmupLowBpm: 126, warmupHighBpm: 154 });
  });

  it('plafond réglé : 170 laisse 158 ; bas repoussé 10 bpm sous un plafond bas', () => {
    const withCeiling = (warmupCeilingBpm: number) =>
      resolveFitnessTestParams(PROTOCOL, { ...DEFAULT_SETTINGS, warmupCeilingBpm }, { athlete: NO_HR, age: null, zoneModel: MODEL, offsetBpm: 0 });
    expect(withCeiling(170)).toMatchObject({ warmupLowBpm: 130, warmupHighBpm: 158 });
    expect(withCeiling(155)).toMatchObject({ warmupLowBpm: 130, warmupHighBpm: 155 });
    expect(withCeiling(135)).toMatchObject({ warmupLowBpm: 125, warmupHighBpm: 135 });
    expect(withCeiling(120)).toMatchObject({ warmupLowBpm: 110, warmupHighBpm: 120 });
  });

  it('suit la réserve cardiaque avec la FC de repos, les seuils saisis d’abord', () => {
    // Haut de zone 3 à 162, coupé à 155.
    expect(resolve({ hrMax: 190, hrRest: 50, hrThresholds: null }, 40)).toMatchObject({ hrMaxRefBpm: 190, warmupLowBpm: 133, warmupHighBpm: 155 });
    expect(params()).toMatchObject({ warmupLowBpm: 78, warmupHighBpm: 88 });
    expect(params().zones.method).toBe('saisis');
  });

  it('écarte un âge invraisemblable', () => {
    expect(resolve(NO_HR, 3).ageSource).toBe('defaut');
  });
});

describe('sanitizeFitnessTestSettings', () => {
  it('garde les valeurs dans les bornes, remplace les autres', () => {
    expect(DEFAULT_SETTINGS).toEqual({ warmupS: 480, warmupCeilingBpm: 155 });
    // Anciens réglages, sans plafond : complétés.
    expect(sanitizeFitnessTestSettings({ warmupS: 300 }, PROTOCOL)).toEqual({ warmupS: 300, warmupCeilingBpm: 155 });
    expect(sanitizeFitnessTestSettings({ warmupS: 30, warmupPct: 0.9 }, PROTOCOL)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeFitnessTestSettings(null, PROTOCOL)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeFitnessTestSettings({ warmupCeilingBpm: 150 }, PROTOCOL)).toEqual({ warmupS: 480, warmupCeilingBpm: 150 });
    expect(sanitizeFitnessTestSettings({ warmupCeilingBpm: 120 }, PROTOCOL).warmupCeilingBpm).toBe(120);
    expect(sanitizeFitnessTestSettings({ warmupCeilingBpm: 180 }, PROTOCOL).warmupCeilingBpm).toBe(180);
    expect(sanitizeFitnessTestSettings({ warmupCeilingBpm: 190 }, PROTOCOL).warmupCeilingBpm).toBe(155);
    expect(sanitizeFitnessTestSettings({ warmupCeilingBpm: 100 }, PROTOCOL).warmupCeilingBpm).toBe(155);
    expect(sanitizeFitnessTestSettings({ warmupCeilingBpm: '150' }, PROTOCOL).warmupCeilingBpm).toBe(155);
  });
});

describe('stepFitnessTest', () => {
  it('donne les mêmes signaux à 1 Hz et à 5 Hz', () => {
    const a = run(samples(1)).signals;
    const b = run(samples(5)).signals;
    expect(b.map((x) => x.s)).toEqual(a.map((x) => x.s));
    b.forEach((x, i) => expect(Math.abs(x.t - a[i].t)).toBeLessThanOrEqual(1));
  });

  it('guide l’échauffement sur la FC : grâce, accélère, bien, trop vite', () => {
    const warmup = run(samples(1)).signals.filter((x) => x.t < 480);
    expect(warmup[0]).toEqual({ t: 0, s: 'debut' });
    // Rien pendant les 30 s de grâce, puis FC trop basse.
    expect(warmup[1]).toEqual({ t: 30, s: 'accelere' });
    expect(warmup.filter((x) => x.t > 0 && x.t < 30)).toEqual([]);
    expect(warmup.some((x) => x.s === 'bien' && x.t > 60 && x.t < 200)).toBe(true);
    expect(warmup.some((x) => x.s === 'trop' && x.t > 200 && x.t < 270)).toBe(true);
  });

  it('espace les corrections de 10 s et les « bien » de 30 s', () => {
    const { signals } = run(samples(1));
    for (let i = 1; i < signals.length; i++) {
      const s = signals[i];
      if (s.s === 'bien' || s.s === 'trop' || s.s === 'accelere') expect(s.t - signals[i - 1].t).toBeGreaterThanOrEqual(10);
    }
    const goods = signals.filter((x) => x.s === 'bien');
    for (let i = 1; i < goods.length; i++) expect(goods[i].t - goods[i - 1].t).toBeGreaterThanOrEqual(30);
  });

  it('espace de 30 s la même correction venue trois fois de suite, à 1 Hz comme à 5 Hz', () => {
    // FC trop haute tout l'échauffement, puis dans la bande de 200 à 300 s, puis de nouveau trop haute.
    const hrAt = (t: number) => (t >= 200 && t < 300 ? 84 : 120);
    const list = (hz: number) => samples(hz, 400).map((x) => ({ ...x, hrBpm: hrAt((x.timeMs - T0) / 1000) }));
    for (const hz of [1, 5]) {
      const warmup = run(list(hz)).signals.filter((x) => x.s !== 'debut');
      const times = warmup.map((x) => [Math.round(x.t), x.s]);
      // Trois « trop vite » à 10 s, puis toutes les 30 s ; un « bien » remet le compte à zéro.
      expect(times.slice(0, 6)).toEqual([[30, 'trop'], [40, 'trop'], [50, 'trop'], [80, 'trop'], [110, 'trop'], [140, 'trop']]);
      const lastGood = warmup.map((x) => x.s).lastIndexOf('bien');
      expect(warmup[lastGood].t).toBeGreaterThanOrEqual(200);
      const afterGood = warmup.slice(lastGood + 1);
      expect(afterGood.slice(0, 4).map((x) => x.s)).toEqual(['trop', 'trop', 'trop', 'trop']);
      expect(afterGood[1].t - afterGood[0].t).toBeCloseTo(10, 0);
      expect(afterGood[3].t - afterGood[2].t).toBeCloseTo(30, 0);
    }
  });

  it('part à la vitesse de la dernière minute arrondie, un palier toutes les 60 s', () => {
    const { state, signals } = run(samples(1));
    const test = state.test!;
    expect(msToKmh(test.v0Ms!)).toBeCloseTo(6, 6);
    expect(test.rampStartMs).toBe(T0 + 480_000);
    expect(signals.filter((x) => x.s === 'palier').map((x) => x.t)).toEqual([480, 540, 600, 660, 720, 780, 840]);
    expect(test.steps.map((s) => Math.round(msToKmh(s.targetMs) * 10) / 10)).toEqual([6, 6.6, 7.2, 7.8, 8.4, 9, 9.6]);
  });

  it('arrondit le départ au 0,5 km/h le plus proche', () => {
    const list = samples(1, 481).map((s) => ({ ...s, speedMs: kmhToMs((s.timeMs - T0) / 1000 >= 420 ? 6.3 : 6) }));
    expect(msToKmh(run(list).state.test!.v0Ms!)).toBeCloseTo(6.5, 6);
  });

  it('se tait pendant la grâce d’un palier', () => {
    const { signals } = run(samples(1));
    for (const p of signals.filter((x) => x.s === 'palier')) {
      expect(signals.filter((x) => x.t > p.t && x.t < p.t + 10)).toEqual([]);
    }
  });

  it('finit la rampe sur l’effondrement (20 % sous la cible pendant 30 s), puis la récupération après 120 s', () => {
    for (const hz of [1, 5]) {
      const { state, signals } = run(samples(hz));
      const test = state.test!;
      // Septième palier à 840 s, grâce jusqu'à 850 s : le manque commence à 850 s, la rampe finit à 880 s.
      expect(test.dropMs).toBe(T0 + 850_000);
      expect(test.rampEndMs).toBe(T0 + 880_000);
      expect(test.endReason).toBe('auto');
      expect(signals.find((x) => x.s === 'finRampe')?.t).toBe(880);
      expect(signals.find((x) => x.s === 'finTest')?.t).toBe(1000);
      expect(test.endMs).toBe(T0 + 1_000_000);
      expect(state.phase).toBe('fini');
      expect(signals.filter((x) => x.t > 880 && x.s !== 'finTest')).toEqual([]);
    }
  });

  it('sans FC, ne guide pas l’échauffement mais part à l’heure', () => {
    const { signals } = run(samples(1, 1000, { hr: false }));
    expect(signals.filter((x) => x.t < 480).map((x) => x.s)).toEqual(['debut']);
    expect(signals.find((x) => x.s === 'palier')?.t).toBe(480);
  });

  it('se tait après un trou de plus de 5 s, le temps de refaire la mesure', () => {
    const list = samples(1).filter((s) => {
      const t = (s.timeMs - T0) / 1000;
      return t < 300 || t >= 308;
    });
    const { signals } = run(list);
    expect(signals.filter((x) => x.t >= 308 && x.t < 313)).toEqual([]);
  });

  it('ne compte pas une pause manuelle', () => {
    const PAUSE_S = 100;
    let state = startFitnessTest(params());
    let rampAt: number | null = null;
    for (const sample of samples(1, 600)) {
      const t = (sample.timeMs - T0) / 1000;
      if (t > 200 && t <= 200 + PAUSE_S) continue;
      const step = stepFitnessTest(state, sample, { resumed: t === 201 + PAUSE_S });
      state = step.state;
      if (step.signal === 'palier' && rampAt === null) rampAt = t;
    }
    // L'échauffement reprend où il en était : 480 s actives, plus la pause et la seconde manquée à la reprise.
    expect(rampAt).toBe(480 + PAUSE_S + 1);
  });

  it('« Finir la rampe » la finit à la dernière position', () => {
    let state = run(samples(1, 700)).state;
    const step = finishRamp(state);
    state = step.state;
    expect(step.signal).toBe('finRampe');
    expect(state.test).toMatchObject({ endReason: 'manuel', rampEndMs: T0 + 700_000, dropMs: T0 + 700_000 });
    expect(finishRamp(state).signal).toBeNull();
  });

  it('un arrêt pendant la rampe la finit à la dernière position', () => {
    const test = closeFitnessTest(run(samples(1, 700)).state);
    expect(test).toMatchObject({ endReason: 'arret', rampEndMs: T0 + 700_000 });
    expect(closeFitnessTest(startFitnessTest(params()))).toBeNull();
  });

  it('un test relu, coupé pendant la rampe, finit à la dernière position ; fini, il reste tel quel', () => {
    const during = run(samples(1, 700)).state.test!;
    expect(closeSessionTest(during, T0 + 650_000)).toMatchObject({ endReason: 'arret', rampEndMs: T0 + 650_000, dropMs: T0 + 650_000 });
    const warmup = run(samples(1, 100)).state.test!;
    expect(closeSessionTest(warmup, T0 + 100_000)).toBe(warmup);
    const ended = finishRamp(run(samples(1, 700)).state).state.test!;
    expect(closeSessionTest(ended, T0 + 800_000)).toBe(ended);
  });

  it('ne rend pas d’état partagé avec le précédent', () => {
    const first = stepFitnessTest(startFitnessTest(params()), samples(1, 0)[0]).state;
    const next = stepFitnessTest(first, { timeMs: T0 + 1000, speedMs: 2, hrBpm: 80 }).state;
    expect(first.window).toHaveLength(1);
    expect(next.window).toHaveLength(2);
    expect(first.test!.signals).toHaveLength(1);
  });
});

/** Échauffement court (3 min, à 6 km/h, FC dans la bande), puis la rampe : départ à 6 km/h, paliers à 180, 240, 300 s… */
const SHORT = () => resolveFitnessTestParams(PROTOCOL, { ...DEFAULT_SETTINGS, warmupS: 180 }, RUNNER);
const targetKmh = (t: number) => (t < 180 ? 6 : stepKmh(Math.floor((t - 180) / 60)));
const rampSamples = (speedKmh: (t: number) => number, hz: number, endS: number): TestSample[] => {
  const out: TestSample[] = [];
  for (let k = 0; k <= endS * hz; k++) {
    const t = k / hz;
    out.push({ timeMs: T0 + Math.round(t * 1000), speedMs: kmhToMs(t < 180 ? 6 : speedKmh(t)), hrBpm: 84 });
  }
  return out;
};
/** Rejoue en relevant le début de chaque manque, la fin de la rampe et la plus longue avance tenue. */
const runRamp = (list: TestSample[]) => {
  let state = startFitnessTest(SHORT());
  const signals: { t: number; s: TestSignal }[] = [];
  const since: ({ activeMs: number; timeMs: number } | null)[] = PROTOCOL.collapseRules.map(() => null);
  let endMs: number | null = null;
  let tooFastSince: number | null = null;
  let tooFastMaxS = 0;
  for (const sample of list) {
    const step = stepFitnessTest(state, sample);
    state = step.state;
    if (step.signal) signals.push({ t: (sample.timeMs - T0) / 1000, s: step.signal });
    state.collapseSince.forEach((x, i) => { if (x !== null && since[i] === null) since[i] = x; });
    if (state.phase === 'recuperation' && endMs === null) endMs = sample.timeMs;
    tooFastSince = state.tooFastSince ?? tooFastSince;
    if (state.tooFastSince !== null) tooFastMaxS = Math.max(tooFastMaxS, (state.activeMs - state.tooFastSince) / 1000);
  }
  return { state, signals, since, endMs, tooFastSince, tooFastMaxS };
};

describe('fin de la rampe sur un effondrement (protocole v2)', () => {
  it('ni 20 s à 0,5 km/h sous la cible, ni 15 % sous la cible pendant 60 s ne la finissent', () => {
    for (const hz of [1, 5]) {
      const speed = (t: number) => (t >= 200 && t < 220 ? targetKmh(t) - 0.5 : t >= 240 && t < 300 ? 0.85 * targetKmh(t) : targetKmh(t));
      const { state, signals } = runRamp(rampSamples(speed, hz, 400));
      expect(state.phase).toBe('rampe');
      expect(state.test!.endReason).toBeNull();
      expect(signals.some((x) => x.s === 'finRampe')).toBe(false);
    }
  });

  it('20 % sous la cible : pas à 29 s, à 30 s ; la fin date du début du manque', () => {
    for (const hz of [1, 5]) {
      // 30 % sous la cible du deuxième palier à partir de 250 s.
      const { state, since, endMs } = runRamp(rampSamples((t) => (t >= 250 ? 0.7 * 6.6 : targetKmh(t)), hz, 400));
      expect(since[0]).not.toBeNull();
      expect(since[1]).toBeNull();
      expect(endMs! - since[0]!.timeMs).toBe(30_000);
      expect(state.test).toMatchObject({ endReason: 'auto', dropMs: since[0]!.timeMs, rampEndMs: endMs });
      expect(since[0]!.timeMs).toBeGreaterThan(T0 + 250_000);
      expect(since[0]!.timeMs).toBeLessThan(T0 + 260_000);
    }
  });

  it('50 % sous la cible pendant 10 s la finit ; la fin date du début du manque des 20 %', () => {
    for (const hz of [1, 5]) {
      const { state, since, endMs } = runRamp(rampSamples((t) => (t >= 250 ? 0.3 * 6.6 : targetKmh(t)), hz, 400));
      expect(since[0]!.timeMs).toBeLessThan(since[1]!.timeMs);
      expect(endMs! - since[1]!.timeMs).toBe(10_000);
      expect(endMs! - since[0]!.timeMs).toBeLessThan(30_000);
      expect(state.test).toMatchObject({ endReason: 'auto', dropMs: since[0]!.timeMs, rampEndMs: endMs });
    }
  });

  it('un manque ne commence pas pendant la grâce d’un palier, mais un manque commencé avant la traverse', () => {
    for (const hz of [1, 5]) {
      // Lâché pendant la grâce du palier de 300 s : le manque ne compte qu'à sa fin, 310 s.
      const inGrace = runRamp(rampSamples((t) => (t >= 302 ? 0.7 * 7.2 : targetKmh(t)), hz, 400));
      expect(inGrace.since[0]!.timeMs).toBe(T0 + 310_000);
      expect(inGrace.endMs).toBe(T0 + 340_000);
      // Lâché à 285 s : le manque commence avant le palier et continue pendant sa grâce.
      const before = runRamp(rampSamples((t) => (t >= 285 ? 0.7 * 6.6 : targetKmh(t)), hz, 400));
      expect(before.since[0]!.timeMs).toBeLessThan(T0 + 300_000);
      expect(before.signals.some((x) => x.s === 'palier' && x.t === 300)).toBe(true);
      expect(before.endMs! - before.since[0]!.timeMs).toBe(30_000);
      expect(before.state.test!.dropMs).toBe(before.since[0]!.timeMs);
    }
  });
});

describe('« trop vite » sur la rampe (protocole v2)', () => {
  it('ni « trop » ni « bien » à 0,9 km/h au-dessus de la cible pendant un palier', () => {
    for (const hz of [1, 5]) {
      const { signals } = runRamp(rampSamples((t) => (t >= 240 && t < 300 ? targetKmh(t) + 0.9 : targetKmh(t)), hz, 330));
      expect(signals.filter((x) => x.t > 240 && x.t < 300)).toEqual([]);
      // À la cible, « bien » revient.
      expect(signals.some((x) => x.s === 'bien' && x.t > 300)).toBe(true);
    }
  });

  it('tu à 1,2 km/h au-dessus tenus moins de 20 s, dit à 20 s', () => {
    const at = { 1: 0, 5: 0 } as Record<number, number>;
    for (const hz of [1, 5]) {
      // Avance de 25 s à 1,2 km/h : la vitesse lissée passe la marque moins de 20 s.
      const short = runRamp(rampSamples((t) => (t >= 185 && t < 210 ? targetKmh(t) + 1.2 : targetKmh(t)), hz, 239));
      expect(short.signals.filter((x) => x.s === 'trop')).toEqual([]);
      expect(short.tooFastMaxS).toBeGreaterThan(15);
      expect(short.tooFastMaxS).toBeLessThan(20);
      // Avance tenue : « trop » 20 s après que la vitesse lissée a passé la marque, rien avant (ni « bien »).
      const held = runRamp(rampSamples((t) => (t >= 185 ? targetKmh(t) + 1.2 : targetKmh(t)), hz, 239));
      const trop = held.signals.filter((x) => x.s === 'trop');
      expect(trop[0].t).toBeCloseTo(held.tooFastSince! / 1000 + 20, 6);
      expect(held.signals.filter((x) => x.t > 180 && x.t < trop[0].t)).toEqual([]);
      at[hz] = trop[0].t;
    }
    expect(Math.abs(at[1] - at[5])).toBeLessThanOrEqual(1);
    expect(at[1]).toBeGreaterThan(210);
    expect(at[1]).toBeLessThan(216);
  });
});

describe('échauffement croisant FC et vitesse (protocole v2)', () => {
  /** Échauffement complet à 1 ou 5 Hz, FC constante, vitesse changée à 100 s. */
  const warmupRun = (hz: number, hr: number, speedKmh: (t: number) => number, correction: TestSignal) =>
    run(samples(hz, 200).map((x) => ({ ...x, hrBpm: hr, speedMs: kmhToMs(speedKmh((x.timeMs - T0) / 1000)) })))
      .signals.filter((x) => x.s === correction).map((x) => Math.round(x.t));
  /** Corrections à 30, 40, 50, 80 s, puis tues tant que la vitesse corrige déjà, revenues vers 134 s. */
  const expectSilencedThenBack = (times: number[]) => {
    expect(times.slice(0, 4)).toEqual([30, 40, 50, 80]);
    expect(times[4]).toBeGreaterThanOrEqual(133);
    expect(times[4]).toBeLessThanOrEqual(136);
  };

  it('FC au-dessus de la bande à vitesse constante : « trop vite »', () => {
    for (const hz of [1, 5]) expect(warmupRun(hz, 120, () => 8, 'trop').slice(0, 5)).toEqual([30, 40, 50, 80, 110]);
  });

  it('FC au-dessus mais vitesse déjà en baisse de 1 km/h : « trop » se tait, puis revient', () => {
    // Baisse à 100 s : tendance (20 dernières s moins les 30 d'avant) sous −0,5 km/h de 109 à 134 s environ ;
    // sans elle, « trop » serait revenu à 110 s.
    for (const hz of [1, 5]) expectSilencedThenBack(warmupRun(hz, 120, (t) => (t < 100 ? 8 : 7), 'trop'));
  });

  it('FC sous la bande mais vitesse déjà en hausse : « accélère » se tait, puis revient', () => {
    for (const hz of [1, 5]) {
      expect(warmupRun(hz, 70, () => 6, 'accelere').slice(0, 5)).toEqual([30, 40, 50, 80, 110]);
      expectSilencedThenBack(warmupRun(hz, 70, (t) => (t < 100 ? 6 : 7), 'accelere'));
    }
  });
});

describe('readSessionTest', () => {
  it('relit un test rangé, écarte un test mal formé', () => {
    const test = run(samples(1)).state.test!;
    expect(test.version).toBe(2);
    expect(readSessionTest(JSON.parse(JSON.stringify(test)))).toEqual(test);
    expect(readSessionTest({ ...test, protocol: 'vma' })).toBeNull();
    expect(readSessionTest({ ...test, settings: null })).toBeNull();
    expect(readSessionTest(null)).toBeNull();
  });

  it('relit un test du protocole v1 tel quel', () => {
    const v1 = {
      protocol: 'fc-max', version: 1,
      settings: { warmupS: 480, age: 35, ageSource: 'defaut', lowBpm: 130, highBpm: 158, zoneMethod: 'max' },
      startMs: T0, rampStartMs: T0 + 480_000, v0Ms: kmhToMs(6), steps: [{ startMs: T0 + 480_000, targetMs: kmhToMs(6) }],
      rampEndMs: T0 + 560_000, dropMs: T0 + 540_000, endReason: 'auto', endMs: T0 + 680_000,
      signals: [{ t: T0, s: 'debut' }, { t: T0 + 480_000, s: 'palier' }, { t: T0 + 560_000, s: 'finRampe' }],
    };
    expect(readSessionTest(JSON.parse(JSON.stringify(v1)))).toEqual(v1);
  });
});

describe('testPlan', () => {
  it('marches de +0,6 km/h, bips de chaque palier, phases', () => {
    const plan = testPlan(params(), { v0Ms: kmhToMs(8), steps: 10 });
    expect(plan.phases.map((p) => [p.phase, p.startS, p.endS])).toEqual([
      ['echauffement', 0, 480], ['rampe', 480, 1080], ['recuperation', 1080, 1200],
    ]);
    expect(plan.beeps.filter((b) => b.signal === 'palier')).toHaveLength(10);
    const targets = plan.points.map((p) => p.targetMs).filter((v): v is number => v !== null);
    expect(msToKmh(Math.max(...targets))).toBeCloseTo(8 + 0.6 * 9, 6);
    expect(plan.hrBand).toEqual({ lowBpm: 78, highBpm: 88 });
  });
});

describe('fixSpeedMs (lot 67, sorti de useFitnessTest)', () => {
  /** Copie gelée de l'ancienne fonction du service, seuil en dur. */
  const oldFixSpeedMs = (fix: LocationFix, previous: LocationFix | null): number | undefined => {
    if (fix.speedMs !== undefined) return fix.speedMs;
    if (!previous) return undefined;
    const dtMs = fix.timeMs - previous.timeMs;
    if (dtMs <= 0 || dtMs > 5000) return undefined;
    return haversineDistance(previous.lat, previous.lon, fix.lat, fix.lon) / (dtMs / 1000);
  };
  const gap = FITNESS_TESTS['fc-max'].derivedSpeedMaxGapS;
  /** Positions à 3 m/s vers l'est, une toutes les `stepMs`, sans vitesse du GPS. */
  const track = (stepMs: number, n: number): LocationFix[] => Array.from({ length: n }, (_, i) => ({
    lat: 43.7, lon: 3.85 + (3 * (i * stepMs) / 1000) / mPerDegLon(43.7), timeMs: 1_000_000 + i * stepMs, accuracyM: 5,
  }));

  it('donne la vitesse tirée de la précédente, la même à 1 Hz et à 5 Hz', () => {
    for (const stepMs of [1000, 200]) {
      const fixes = track(stepMs, 20);
      for (let i = 1; i < fixes.length; i++) {
        const speed = fixSpeedMs(fixes[i], fixes[i - 1], gap);
        expect(speed).toBe(oldFixSpeedMs(fixes[i], fixes[i - 1]));
        expect(speed).toBeCloseTo(3, 3);
      }
    }
  });

  it('garde la vitesse du GPS, rien sans précédente ni pour une date identique ou plus ancienne', () => {
    const [a, b] = track(1000, 2);
    expect(fixSpeedMs({ ...b, speedMs: 4.2 }, a, gap)).toBe(4.2);
    expect(fixSpeedMs(b, null, gap)).toBeUndefined();
    expect(fixSpeedMs({ ...b, timeMs: a.timeMs }, a, gap)).toBeUndefined();
    expect(fixSpeedMs(a, b, gap)).toBeUndefined();
  });

  it('tire encore la vitesse à 5 s d\'écart, plus au-delà', () => {
    const fixes = track(1000, 8);
    expect(gap).toBe(5);
    expect(fixSpeedMs(fixes[5], fixes[0], gap)).toBe(oldFixSpeedMs(fixes[5], fixes[0]));
    expect(fixSpeedMs(fixes[5], fixes[0], gap)).toBeCloseTo(3, 3);
    expect(fixSpeedMs(fixes[6], fixes[0], gap)).toBeUndefined();
    expect(oldFixSpeedMs(fixes[6], fixes[0])).toBeUndefined();
    expect(fixSpeedMs({ ...fixes[5], timeMs: fixes[5].timeMs + 1 }, fixes[0], gap)).toBeUndefined();
  });
});

describe('rejeu sur les positions relues d\'un journal (lot 156)', () => {
  const asFix = (sample: TestSample): LocationFix => ({ timeMs: sample.timeMs, lat: 43, lon: 3, speedMs: sample.speedMs, heartRateBpm: sample.hrBpm });

  /** Le guidage en direct, comme `useFitnessTest` : vitesse du GPS, reprise à la frontière de segment, sans son. */
  const lived = (segments: LocationFix[][]) => {
    let state = startFitnessTest(params());
    let previous: LocationFix | null = null;
    segments.forEach((segment, i) => segment.forEach((fix, j) => {
      const speedMs = fixSpeedMs(fix, previous, PROTOCOL.derivedSpeedMaxGapS);
      previous = fix;
      state = stepFitnessTest(state, { timeMs: fix.timeMs, speedMs, hrBpm: fix.heartRateBpm }, { resumed: i > 0 && j === 0 }).state;
    }));
    return state;
  };

  it.each([[1], [5]])('à %i Hz : le même état qu\'en direct, en pleine rampe, signaux et paliers compris', (hz) => {
    const fixes = samples(hz, 600).map(asFix);
    const state = lived([fixes]);
    expect(state.phase).toBe('rampe');
    const replayed = replayFitnessTest(params(), [fixes], state.test!);
    expect(replayed.state).toEqual(state);
    expect(replayed.previous).toBe(fixes[fixes.length - 1]);
  });

  it.each([[1], [5]])('à %i Hz : une pause manuelle (deux segments) reste une reprise, son temps ôté', (hz) => {
    const all = samples(hz, 700).map(asFix);
    const cut = 500 * hz;
    const resume = 560 * hz;
    const segments = [all.slice(0, cut), all.slice(resume)];
    const state = lived(segments);
    const replayed = replayFitnessTest(params(), segments, state.test!);
    expect(replayed.state).toEqual(state);
    // 60 s de pause ôtées du temps actif.
    expect(replayed.state.activeMs).toBeLessThan(700_000 - 50_000);
  });

  it('respecte « Finir la rampe », qu\'aucune position ne dit', () => {
    const fixes = samples(1, 700).map(asFix);
    const untilTap = fixes.slice(0, 600);
    let state = lived([untilTap]);
    state = finishRamp(state).state;
    const kept = state.test!;
    expect(kept.endReason).toBe('manuel');
    const replayed = replayFitnessTest(params(), [fixes], kept);
    expect(replayed.state.phase).toBe('recuperation');
    expect(replayed.state.test!.rampEndMs).toBe(kept.rampEndMs);
    expect(replayed.state.test!.endReason).toBe('manuel');
  });

  it('ignore les positions d\'avant le test : une activité changée en route', () => {
    const before: LocationFix[] = [0, 1, 2].map((s) => ({ timeMs: T0 - 60_000 + s * 1000, lat: 43, lon: 3, speedMs: 2 }));
    const fixes = samples(1, 100).map(asFix);
    const state = lived([fixes]);
    expect(replayFitnessTest(params(), [[...before, ...fixes]], state.test!).state).toEqual(state);
  });
});

/** État du scénario à `endS` secondes de test, échantillonné à `hz`. */
const stateAt = (hz: number, endS: number): FitnessTestState => run(samples(hz, endS)).state;

describe('phaseRemainingS', () => {
  it('rien avant la première position ni après le test', () => {
    expect(phaseRemainingS(startFitnessTest(params()))).toBeNull();
    expect(phaseRemainingS({ ...stateAt(1, 100), phase: 'fini' })).toBeNull();
  });

  it('échauffement : décompte depuis 480 s, plancher 0', () => {
    const early = stateAt(1, 100);
    expect(early.phase).toBe('echauffement');
    expect(phaseRemainingS(early)).toBeCloseTo(380, 6);
    expect(phaseRemainingS({ ...early, activeMs: 600_000 })).toBe(0);
  });

  it('rampe : temps restant du palier de 60 s, qui repart à chaque palier', () => {
    const mid = stateAt(1, 480 + 15);
    expect(mid.phase).toBe('rampe');
    expect(phaseRemainingS(mid)).toBeCloseTo(45, 6);
    // Troisième palier, 10 s dedans.
    expect(phaseRemainingS(stateAt(1, 480 + 130))).toBeCloseTo(50, 6);
    // Pile à un changement de palier : palier entier devant soi.
    expect(phaseRemainingS(stateAt(1, 480 + 120))).toBeCloseTo(60, 6);
  });

  it('récupération : décompte depuis 120 s, plancher 0', () => {
    const rec = stateAt(1, 880 + 30);
    expect(rec.phase).toBe('recuperation');
    expect(phaseRemainingS(rec)).toBeCloseTo(PROTOCOL.recoveryS - 30, 6);
    expect(phaseRemainingS({ ...rec, activeMs: rec.activeMs + 500_000 })).toBe(0);
  });

  it('même décompte à 1 Hz et à 5 Hz', () => {
    for (const t of [100, 495, 610, 900]) {
      expect(phaseRemainingS(stateAt(5, t))).toBeCloseTo(phaseRemainingS(stateAt(1, t))!, 6);
    }
  });
});

describe('guideReadings', () => {
  it('sans position, rien', () => {
    expect(guideReadings(startFitnessTest(params()))).toEqual({ speedMs: null, hrBpm: null });
  });

  it('moyenne sur les 10 s de lissage : vitesse constante rendue telle quelle, FC en rampe lissée', () => {
    const state = stateAt(1, 300);
    const { speedMs, hrBpm } = guideReadings(state);
    expect(speedMs).toBeCloseTo(kmhToMs(6), 6);
    expect(hrBpm).toBe(84);
    // Palier 1 (t 540 à 600) à 6,6 km/h, pris en son milieu ; la FC monte de 0,24 bpm/s, moyenne de la fenêtre au milieu de ses 10 s.
    const ramp = guideReadings(stateAt(1, 570));
    expect(ramp.speedMs).toBeCloseTo(kmhToMs(stepKmh(1)), 6);
    expect(ramp.hrBpm).toBeCloseTo(84 + (96 * (565.5 - 480)) / 400, 1);
  });

  it('sans FC reçue, la vitesse seule', () => {
    const state = run(samples(1, 300, { hr: false })).state;
    const r = guideReadings(state);
    expect(r.hrBpm).toBeNull();
    expect(r.speedMs).toBeCloseTo(kmhToMs(6), 6);
  });

  it('mêmes valeurs à 1 Hz et à 5 Hz (fenêtre en secondes)', () => {
    for (const t of [300, 450, 570, 690]) {
      const a = guideReadings(stateAt(1, t));
      const b = guideReadings(stateAt(5, t));
      expect(b.speedMs).toBeCloseTo(a.speedMs!, 3);
      expect(Math.abs(b.hrBpm! - a.hrBpm!)).toBeLessThan(0.5);
    }
  });
});
