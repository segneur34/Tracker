import { describe, expect, it } from 'vitest';
import { referenceSpeedMs, samplingIntervalS, sessionFilterThresholds } from './sessionSpeed';
import { DEFAULT_MAX_ACCELERATION } from './speedFilter';
import type { RawTrackPoint } from './types';

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
