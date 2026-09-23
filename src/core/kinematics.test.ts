import { describe, expect, it } from 'vitest';
import {
  computeKinematics,
  detectDeviceSpeedUnit,
  detectTrackDeviceSpeedUnit,
  haversineDistance,
  initialBearing,
} from './kinematics';
import type { RawTrackPoint } from './types';

/** Construit une trace rectiligne vers l'est, à vitesse et cadence constantes. */
const buildEastwardTrack = (
  count: number,
  metersPerStep: number,
  stepSeconds: number,
  deviceSpeedMs?: number
) => {
  const startTime = Date.parse('2026-01-01T10:00:00Z');
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);

  const points: RawTrackPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat,
      lon: 3.8 + (i * metersPerStep) / metersPerDegLon,
      time: new Date(startTime + i * stepSeconds * 1000).toISOString(),
      speedMs: deviceSpeedMs,
    });
  }
  return points;
};

describe('haversineDistance', () => {
  it('renvoie zéro pour deux positions identiques', () => {
    expect(haversineDistance(43.6, 3.8, 43.6, 3.8)).toBe(0);
  });

  it('mesure un degré de latitude à environ 111 km', () => {
    const d = haversineDistance(43.0, 3.8, 44.0, 3.8);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('est symétrique', () => {
    const ab = haversineDistance(43.6, 3.8, 43.7, 3.9);
    const ba = haversineDistance(43.7, 3.9, 43.6, 3.8);
    expect(ab).toBeCloseTo(ba, 9);
  });
});

describe('initialBearing', () => {
  it('donne 0° vers le nord', () => {
    expect(initialBearing(43.6, 3.8, 43.7, 3.8)).toBeCloseTo(0, 6);
  });

  it('donne 90° vers l\'est', () => {
    expect(initialBearing(43.6, 3.8, 43.6, 3.9)).toBeCloseTo(90, 1);
  });

  it('donne 180° vers le sud', () => {
    expect(initialBearing(43.6, 3.8, 43.5, 3.8)).toBeCloseTo(180, 6);
  });

  it('reste dans l\'intervalle [0, 360[', () => {
    const bearing = initialBearing(43.6, 3.8, 43.6, 3.7);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});

describe('computeKinematics', () => {
  it('renvoie une trace vide en dessous de deux points', () => {
    expect(computeKinematics([])).toEqual([]);
    expect(computeKinematics([{ lat: 43.6, lon: 3.8, time: '2026-01-01T10:00:00Z' }])).toEqual([]);
  });

  it('produit des vitesses en m/s, pas en nœuds', () => {
    // 10 m toutes les secondes, donc 10 m/s, soit environ 19,4 nœuds.
    const track = computeKinematics(buildEastwardTrack(10, 10, 1));
    expect(track[5].speedMs).toBeCloseTo(10, 2);
    expect(track[5].speedSource).toBe('derived');
  });

  it('précalcule l\'horodatage en millisecondes', () => {
    const track = computeKinematics(buildEastwardTrack(3, 10, 1));
    expect(track[1].timeMs - track[0].timeMs).toBe(1000);
  });

  it('prête au premier point la vitesse du second, et un cap nul', () => {
    // Un zéro artificiel au départ passerait pour un démarrage aberrant.
    const track = computeKinematics(buildEastwardTrack(5, 10, 1));
    expect(track[0].speedMs).toBeCloseTo(track[1].speedMs, 9);
    expect(track[0].bearing).toBe(0);
  });

  it('oriente une trace vers l\'est à environ 90°', () => {
    const track = computeKinematics(buildEastwardTrack(5, 10, 1));
    expect(track[3].bearing).toBeCloseTo(90, 1);
  });

  it('met une vitesse nulle quand deux points partagent le même horodatage', () => {
    const points: RawTrackPoint[] = [
      { lat: 43.6, lon: 3.8, time: '2026-01-01T10:00:00Z' },
      { lat: 43.6, lon: 3.9, time: '2026-01-01T10:00:00Z' },
    ];
    expect(computeKinematics(points)[1].speedMs).toBe(0);
  });

  it('conserve altitude, fréquence cardiaque et cadence du point brut', () => {
    const points: RawTrackPoint[] = [
      { lat: 43.6, lon: 3.8, time: '2026-01-01T10:00:00Z', ele: 12, hr: 140, cadence: 85 },
      { lat: 43.6, lon: 3.81, time: '2026-01-01T10:00:01Z', ele: 15, hr: 142, cadence: 86 },
    ];
    const track = computeKinematics(points);
    expect(track[1].ele).toBe(15);
    expect(track[1].hr).toBe(142);
    expect(track[1].cadence).toBe(86);
  });

  it('préfère la vitesse de l\'appareil quand elle existe', () => {
    // Positions à 10 m/s, mais l'appareil annonce 7 m/s : c'est lui qui gagne.
    const track = computeKinematics(buildEastwardTrack(10, 10, 1, 7));
    expect(track[5].speedMs).toBeCloseTo(7, 6);
    expect(track[5].speedSource).toBe('doppler');
  });

  it('peut forcer la dérivation depuis les positions', () => {
    const track = computeKinematics(buildEastwardTrack(10, 10, 1, 7), { forceDerivedSpeed: true });
    expect(track[5].speedMs).toBeCloseTo(10, 2);
    expect(track[5].speedSource).toBe('derived');
  });

  it('écrête un saut de position aberrant', () => {
    // Trace régulière à 5 m/s, sauf un point téléporté 500 m plus loin.
    const points = buildEastwardTrack(20, 5, 1);
    const lat = 43.6;
    const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
    points[10] = { ...points[10], lon: points[10].lon + 500 / metersPerDegLon };

    const track = computeKinematics(points);
    // Sans écrêtage, le point 10 afficherait plus de 500 m/s.
    expect(track[10].speedMs).toBeLessThan(20);
    expect(Math.max(...track.map((p) => p.smoothedSpeedMs))).toBeLessThan(20);
  });

  it('reconnaît une vitesse appareil écrite en km/h et la convertit', () => {
    // Positions à 3 m/s, appareil qui annonce 10,8, soit 3 m/s exprimés en km/h.
    const points = buildEastwardTrack(40, 3, 1, 10.8);
    expect(detectTrackDeviceSpeedUnit(points)).toBe('kmh');

    const track = computeKinematics(points);
    expect(track[20].speedMs).toBeCloseTo(3, 2);
    expect(track[20].speedSource).toBe('doppler');
  });

  it('reconnaît une vitesse appareil en m/s et la garde telle quelle', () => {
    const points = buildEastwardTrack(40, 3, 1, 3.2);
    expect(detectTrackDeviceSpeedUnit(points)).toBe('ms');
    expect(computeKinematics(points)[20].speedMs).toBeCloseTo(3.2, 6);
  });

  it('reconnaît des nœuds', () => {
    // 5 m/s valent 9,72 nœuds.
    const points = buildEastwardTrack(40, 5, 1, 9.72);
    expect(detectTrackDeviceSpeedUnit(points)).toBe('kn');
    expect(computeKinematics(points)[20].speedMs).toBeCloseTo(5, 1);
  });

  it('suppose des m/s faute d\'échantillons comparables', () => {
    expect(detectDeviceSpeedUnit([2, 2, 2], [0, 0, 0])).toBe('ms');
    expect(detectTrackDeviceSpeedUnit(buildEastwardTrack(5, 3, 1))).toBeNull();
  });

  it('donne le même lissage à 1 Hz et à 5 Hz sur la même durée', () => {
    // Même trajet, même vitesse, deux fréquences d'échantillonnage.
    const at1Hz = computeKinematics(buildEastwardTrack(30, 10, 1));
    const at5Hz = computeKinematics(buildEastwardTrack(150, 2, 0.2));

    // Milieu de trace, loin des bords : les deux doivent lire 10 m/s.
    expect(at1Hz[15].smoothedSpeedMs).toBeCloseTo(10, 1);
    expect(at5Hz[75].smoothedSpeedMs).toBeCloseTo(10, 1);
  });
});
