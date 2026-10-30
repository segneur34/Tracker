import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../core/geo';
import type { LocationFix } from '../platform/location';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { kmhToMs, msToKmh } from '../core/units';
import {
  FITNESS_TESTS,
  TEST_SIGNAL_TONES,
  closeFitnessTest,
  closeSessionTest,
  finishRamp,
  fixSpeedMs,
  readSessionTest,
  resolveFitnessTestParams,
  sanitizeFitnessTestSettings,
  startFitnessTest,
  stepFitnessTest,
  testPlan,
  type FitnessTestState,
  type TestSample,
  type TestSignal,
} from './fitnessTest';

const PROTOCOL = FITNESS_TESTS['fc-max'];
const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);
const DEFAULT_SETTINGS = { warmupS: PROTOCOL.warmupS };
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
 * septième lâché (vitesse du sixième gardée), puis récupération.
 */
const scenarioAt = (t: number): { speedKmh: number; hr: number } => {
  if (t < 480) {
    const hr = t < 60 ? 70 : t < 200 ? 83 : t < 260 ? 95 : 84;
    return { speedKmh: t >= 420 ? 6.2 : 6, hr };
  }
  if (t < 870) {
    const k = Math.min(5, Math.floor((t - 480) / 60));
    return { speedKmh: stepKmh(k), hr: 84 + ((180 - 84) * (t - 480)) / 390 };
  }
  const r = t - 870;
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

  it('échauffement en zones 2 à 3 : FC max estimée par l’âge, 35 ans sans âge', () => {
    // 208 − 0,7 × 35 = 184 : S1 144, S2 164 ; Z2 à 90 % de S1, Z4 aux deux tiers de S1 à S2.
    expect(resolve(NO_HR, null)).toMatchObject({ age: 35, ageSource: 'defaut', hrMaxRefBpm: 184, warmupLowBpm: 130, warmupHighBpm: 158 });
    expect(resolve(NO_HR, null).zones).toMatchObject({ method: 'max', estimated: true });
    expect(resolve(NO_HR, 40)).toMatchObject({ age: 40, ageSource: 'profil', hrMaxRefBpm: 180, warmupLowBpm: 126, warmupHighBpm: 154 });
  });

  it('suit la réserve cardiaque avec la FC de repos, les seuils saisis d’abord', () => {
    expect(resolve({ hrMax: 190, hrRest: 50, hrThresholds: null }, 40)).toMatchObject({ hrMaxRefBpm: 190, warmupLowBpm: 133, warmupHighBpm: 162 });
    expect(params()).toMatchObject({ warmupLowBpm: 78, warmupHighBpm: 88 });
    expect(params().zones.method).toBe('saisis');
  });

  it('écarte un âge invraisemblable', () => {
    expect(resolve(NO_HR, 3).ageSource).toBe('defaut');
  });
});

describe('sanitizeFitnessTestSettings', () => {
  it('garde les valeurs dans les bornes, remplace les autres', () => {
    expect(sanitizeFitnessTestSettings({ warmupS: 300 }, PROTOCOL)).toEqual({ warmupS: 300 });
    expect(sanitizeFitnessTestSettings({ warmupS: 30, warmupPct: 0.9 }, PROTOCOL)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeFitnessTestSettings(null, PROTOCOL)).toEqual(DEFAULT_SETTINGS);
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

  it('finit la rampe après 20 s sous la cible, puis la récupération après 120 s', () => {
    const { state, signals } = run(samples(1));
    const test = state.test!;
    // Septième palier à 840 s, grâce jusqu'à 850 s : le manque commence à 850 s, la rampe finit à 870 s.
    expect(test.dropMs).toBe(T0 + 850_000);
    expect(test.rampEndMs).toBe(T0 + 870_000);
    expect(test.endReason).toBe('auto');
    expect(signals.find((x) => x.s === 'finRampe')?.t).toBe(870);
    expect(signals.find((x) => x.s === 'finTest')?.t).toBe(990);
    expect(test.endMs).toBe(T0 + 990_000);
    expect(state.phase).toBe('fini');
    expect(signals.filter((x) => x.t > 870 && x.s !== 'finTest')).toEqual([]);
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

describe('readSessionTest', () => {
  it('relit un test rangé, écarte un test mal formé', () => {
    const test = run(samples(1)).state.test!;
    expect(readSessionTest(JSON.parse(JSON.stringify(test)))).toEqual(test);
    expect(readSessionTest({ ...test, protocol: 'vma' })).toBeNull();
    expect(readSessionTest({ ...test, settings: null })).toBeNull();
    expect(readSessionTest(null)).toBeNull();
  });
});

describe('TEST_SIGNAL_TONES', () => {
  it('1, 2 ou 3 bips courts serrés ; un long au palier ; court, long, long double à la fin de la rampe', () => {
    expect(TEST_SIGNAL_TONES.bien.map((t) => t.tone)).toEqual(['court']);
    expect(TEST_SIGNAL_TONES.trop.map((t) => t.tone)).toEqual(['court', 'court']);
    expect(TEST_SIGNAL_TONES.accelere.map((t) => t.tone)).toEqual(['court', 'court', 'court']);
    expect(TEST_SIGNAL_TONES.accelere[2].delayMs).toBeLessThan(1000);
    expect(TEST_SIGNAL_TONES.palier.map((t) => t.tone)).toEqual(['long']);
    expect(TEST_SIGNAL_TONES.finRampe.map((t) => t.tone)).toEqual(['court', 'long', 'final']);
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
    lat: 43.7, lon: 3.85 + (3 * (i * stepMs) / 1000) / (111195 * Math.cos((43.7 * Math.PI) / 180)), timeMs: 1_000_000 + i * stepMs, accuracyM: 5,
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
