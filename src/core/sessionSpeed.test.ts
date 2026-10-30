import { describe, expect, it } from 'vitest';
import { referenceSpeedMs, samplingIntervalS, sessionFilterThresholds } from './sessionSpeed';
import { DEFAULT_MAX_ACCELERATION } from './speedFilter';
import type { RawTrackPoint } from './types';
import { computeKinematics, DEVICE_SPEED_FACTOR, detectTrackDeviceSpeedUnit, pointTimeMs, spreadEqualTimes } from './kinematics';
import { sameData } from '../test/sameData';
import { haversineDistance } from './geo';

const START_MS = Date.parse('2026-01-01T10:00:00Z');
const LAT = 43.6;
const M_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);

/**
 * Trace vers l'est dont chaque pas avance de `speedsMs[i] × stepSeconds`
 * mètres : la vitesse dérivée du point i vaut donc `speedsMs[i]`.
 */
const buildTrack = (speedsMs: number[], stepSeconds = 1): RawTrackPoint[] => {
  const points: RawTrackPoint[] = [{ lat: LAT, lon: 3.8, time: new Date(START_MS).toISOString() }];
  let meters = 0;
  for (let i = 0; i < speedsMs.length; i++) {
    meters += speedsMs[i] * stepSeconds;
    points.push({
      lat: LAT,
      lon: 3.8 + meters / M_PER_DEG_LON,
      time: new Date(START_MS + (i + 1) * stepSeconds * 1000).toISOString(),
    });
  }
  return points;
};

/** `count` points à la même vitesse. */
const steady = (count: number, speedMs: number): number[] => new Array(count).fill(speedMs);

describe('referenceSpeedMs', () => {
  it('retient le neuvième décile, pas la moyenne ni le maximum', () => {
    // Cinq pour cent de pointes ne déplacent pas le décile : il décrit le
    // gros de la session.
    expect(referenceSpeedMs(buildTrack([...steady(95, 4), ...steady(5, 10)]))).toBeCloseTo(4, 1);

    // Un cinquième de la session menée vite, et le décile le voit.
    expect(referenceSpeedMs(buildTrack([...steady(80, 4), ...steady(20, 10)]))).toBeCloseTo(10, 1);
  });

  it('ignore un pic isolé, là où un maximum s\'y laisserait prendre', () => {
    const calme = buildTrack(steady(300, 4));
    const avecPic = buildTrack([...steady(150, 4), 9.3, ...steady(149, 4)]);

    expect(referenceSpeedMs(avecPic)).toBeCloseTo(referenceSpeedMs(calme), 1);
  });

  it('donne la même allure à 1 Hz et à 5 Hz', () => {
    // Même session, deux fréquences : deux tiers de bord lent, un tiers rapide.
    const profil = (count: number) => [...steady(count * 2, 4), ...steady(count, 12)];
    const à1Hz = buildTrack(profil(100), 1);
    const à5Hz = buildTrack(profil(500), 0.2);

    expect(referenceSpeedMs(à5Hz)).toBeCloseTo(referenceSpeedMs(à1Hz), 1);
  });

  it('ne laisse pas un trou d\'enregistrement peser plus que la session', () => {
    // Un point lent suivi d'une coupure d'une heure : sans plafond sur la
    // durée d'un échantillon, il écraserait à lui seul tout le reste.
    const points = buildTrack(steady(200, 10));
    const coupure = new Date(START_MS + 3600 * 1000).toISOString();
    points.push({ lat: LAT, lon: points[points.length - 1].lon, time: coupure });

    expect(referenceSpeedMs(points)).toBeGreaterThan(5);
  });

  it('renvoie zéro sur une trace trop courte', () => {
    expect(referenceSpeedMs([])).toBe(0);
    expect(referenceSpeedMs(buildTrack([]))).toBe(0);
  });
});

describe('samplingIntervalS', () => {
  it('donne la cadence d\'un enregistrement régulier', () => {
    expect(samplingIntervalS(buildTrack(steady(50, 5), 1))).toBeCloseTo(1, 3);
    expect(samplingIntervalS(buildTrack(steady(50, 5), 0.2))).toBeCloseTo(0.2, 3);
  });

  it('ne se laisse pas tirer par une coupure, là où une moyenne le serait', () => {
    // Cent points toutes les 6 secondes, puis un quart d'heure sans rien :
    // la cadence reste de 6 s, alors que la moyenne dirait 15 s.
    const points = buildTrack(steady(100, 5), 6);
    const dernier = points[points.length - 1];
    points.push({
      lat: dernier.lat,
      lon: dernier.lon,
      time: new Date(Date.parse(dernier.time as string) + 900 * 1000).toISOString(),
    });

    expect(samplingIntervalS(points)).toBeCloseTo(6, 1);
  });

  it('renvoie zéro sur une trace trop courte', () => {
    expect(samplingIntervalS([])).toBe(0);
  });
});

describe('sessionFilterThresholds', () => {
  it('resserre les seuils d\'une session lente', () => {
    const lente = sessionFilterThresholds(4, 30);
    expect(lente.maxAcceleration).toBeLessThan(DEFAULT_MAX_ACCELERATION);

    // Le cas réel : une session à 8 nœuds de croisière où l'enregistrement
    // saute à 18 nœuds en une seconde. Cette accélération doit désormais
    // paraître suspecte, ce qu'elle n'était pas sous les 10 m/s² du wingfoil.
    const accelerationDuPic = (9.3 - 2) / 1;
    expect(accelerationDuPic).toBeGreaterThan(lente.maxAcceleration);
    expect(accelerationDuPic).toBeLessThan(DEFAULT_MAX_ACCELERATION);
  });

  it('laisse une session rapide aux valeurs du support', () => {
    const rapide = sessionFilterThresholds(12.9, 30);
    expect(rapide.maxAcceleration).toBeGreaterThanOrEqual(DEFAULT_MAX_ACCELERATION);
    expect(rapide.maxSpeedMs).toBe(30);
  });

  it('n\'ouvre jamais le plafond au-delà de celui du support', () => {
    expect(sessionFilterThresholds(50, 30).maxSpeedMs).toBe(30);
  });

  it('garde un plancher d\'accélération sur une session presque immobile', () => {
    expect(sessionFilterThresholds(0.5, 30).maxAcceleration).toBeGreaterThan(1);
  });

  it('s\'en remet au support quand l\'allure est inconnue', () => {
    expect(sessionFilterThresholds(0, 30)).toEqual({
      maxAcceleration: DEFAULT_MAX_ACCELERATION,
      maxSpeedMs: 30,
    });
  });
});

/** Copie gelée de `referenceSpeedMs` d'avant le lot 56 : objets, tri, dates relues. */
const frozenReferenceSpeedMs = (points: RawTrackPoint[]): number => {
  if (points.length < 2) return 0;
  const deviceUnit = detectTrackDeviceSpeedUnit(points.map(({ lat, lon, time, speedMs }) => ({ lat, lon, time, speedMs })));
  const deviceFactor = deviceUnit === null ? 0 : DEVICE_SPEED_FACTOR[deviceUnit];
  const samples: { speed: number; weight: number }[] = [];
  const timesMs = spreadEqualTimes(points, points.map((p) => pointTimeMs(p.time)));
  for (let i = 1; i < points.length; i++) {
    const dt = (timesMs[i] - timesMs[i - 1]) / 1000;
    if (dt <= 0) continue;
    const p0 = points[i - 1];
    const p1 = points[i];
    const derived = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon) / dt;
    const speed = deviceUnit !== null && p1.speedMs !== undefined ? p1.speedMs * deviceFactor : derived;
    samples.push({ speed, weight: Math.min(dt, 10) });
  }
  if (samples.length === 0) return 0;
  samples.sort((a, b) => a.speed - b.speed);
  const totalWeight = samples.reduce((sum, x) => sum + x.weight, 0);
  const target = totalWeight * 0.9;
  let cumulated = 0;
  for (const sample of samples) {
    cumulated += sample.weight;
    if (cumulated >= target) return sample.speed;
  }
  return samples[samples.length - 1].speed;
};

/** Copie gelée de `samplingIntervalS` d'avant le lot 56. */
const frozenSamplingIntervalS = (points: ReadonlyArray<Pick<RawTrackPoint, 'time'>>): number => {
  if (points.length < 2) return 0;
  const gaps: number[] = [];
  let previousMs = pointTimeMs(points[0].time);
  for (let i = 1; i < points.length; i++) {
    const timeMs = pointTimeMs(points[i].time);
    if (timeMs > previousMs) gaps.push((timeMs - previousMs) / 1000);
    previousMs = timeMs;
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
};

describe('dates lues une fois, tri par indices (lot 56)', () => {
  /** Trace bruitée, vitesses arrondies (égalités, 0 et −0), dates tronquées ou non, Doppler en km/h ou absent, reculs et dates illisibles. */
  const noisyTrace = (stepS: number, seed: number, o: { truncate?: boolean; doppler?: number; unreadable?: boolean } = {}): RawTrackPoint[] => {
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const points: RawTrackPoint[] = [];
    let lon = 3.8;
    for (let k = 0; k < 1500; k++) {
      const speed = Math.round((4 + 3 * Math.sin(k / 50) + (rnd() - 0.5) * 3) * 10) / 10;
      lon += (speed * stepS) / M_PER_DEG_LON;
      let ms = START_MS + Math.round(k * stepS * 1000) + (k % 301 === 7 ? -1500 : 0);
      if (o.truncate) ms = Math.floor(ms / 1000) * 1000;
      const time = o.unreadable && k % 409 === 11 ? 'illisible' : new Date(ms).toISOString();
      points.push({ lat: LAT + (rnd() - 0.5) * 1e-5, lon, time, ...(o.doppler && rnd() > 0.02 ? { speedMs: k % 13 === 0 ? (k % 2 ? -0 : 0) : speed * o.doppler } : {}) });
    }
    return points;
  };
  const withRaw = (points: RawTrackPoint[]) => points.map((p) => ({ ...p, rawTimeMs: pointTimeMs(p.time) }));
  const cases = (): [string, RawTrackPoint[]][] => [1, 0.2].flatMap((stepS) => [
    [`${stepS} s`, noisyTrace(stepS, 3)],
    [`${stepS} s, tronquées`, noisyTrace(stepS, 5, { truncate: true })],
    [`${stepS} s, Doppler`, noisyTrace(stepS, 7, { doppler: 1 })],
    [`${stepS} s, Doppler km/h`, noisyTrace(stepS, 9, { doppler: 3.6 })],
    [`${stepS} s, illisibles`, noisyTrace(stepS, 11, { unreadable: true, doppler: 1 })],
  ] as [string, RawTrackPoint[]][]);

  it('referenceSpeedMs : identique à la version gelée, avec et sans rawTimeMs, unité détectée ou donnée', () => {
    for (const [name, points] of cases()) {
      const want = frozenReferenceSpeedMs(points);
      expect(Object.is(referenceSpeedMs(points), want), name).toBe(true);
      expect(Object.is(referenceSpeedMs(withRaw(points)), want), name).toBe(true);
      expect(Object.is(referenceSpeedMs(points, detectTrackDeviceSpeedUnit(points)), want), name).toBe(true);
    }
  });

  it('vitesses à égalité, 0 et −0 : celle du tri stable', () => {
    for (const pattern of [[-0, 0, 0], [0, -0], [0, 0, -0, -0, 0]]) {
      const points = buildTrack(Array.from({ length: 10 }, () => 0)).map((p, k) => ({ ...p, speedMs: pattern[k % pattern.length] }));
      expect(Object.is(referenceSpeedMs(points), frozenReferenceSpeedMs(points))).toBe(true);
    }
  });

  it('samplingIntervalS : identique à la version gelée, avec et sans rawTimeMs', () => {
    for (const [name, points] of cases()) {
      const want = frozenSamplingIntervalS(points);
      expect(Object.is(samplingIntervalS(points), want), name).toBe(true);
      expect(Object.is(samplingIntervalS(withRaw(points)), want), name).toBe(true);
    }
  });

  it('computeKinematics et unité du Doppler : mêmes résultats avec rawTimeMs', () => {
    for (const [name, points] of cases()) {
      const a = computeKinematics(points, { medianWindowSeconds: 3, maxGapS: 10 });
      const b = computeKinematics(withRaw(points), { medianWindowSeconds: 3, maxGapS: 10 });
      if (!sameData(a, b)) expect(b, name).toEqual(a);
      expect(detectTrackDeviceSpeedUnit(withRaw(points)), name).toBe(detectTrackDeviceSpeedUnit(points));
    }
  });
});
