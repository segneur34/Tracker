import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import type { SurfaceCategory } from '../planning/surface';
import { computeGrades } from '../running/runningAnalytics';
import {
  BIKE_TYPES, computeCyclingEnergy, cyclingEnergyParams, resistiveForceN, rollingCoefficient, type BikeType, type CyclingEnergyParams,
} from './energy';

/** Trace synthétique à cadence fixe, en ligne droite, altitude fonction de la distance. */
const buildTrack = (
  durationS: number,
  speedAt: (tS: number) => number,
  stepS = 1,
  altitudeAt: (distanceM: number) => number = () => 100
): TrackPoint[] => {
  const start = Date.parse('2026-01-01T10:00:00Z');
  const track: TrackPoint[] = [];
  let meters = 0;
  for (let k = 0; k * stepS <= durationS + 1e-9; k++) {
    const tS = k * stepS;
    const speedMs = speedAt(tS);
    if (k > 0) meters += speedMs * stepS;
    track.push({
      lat: 43.6,
      lon: 3.8 + meters / 80000,
      time: new Date(start + tS * 1000).toISOString(),
      timeMs: start + tS * 1000,
      ele: altitudeAt(meters),
      speedMs,
      smoothedSpeedMs: speedMs,
      bearing: 90,
      speedSource: 'derived',
    });
  }
  return track;
};

const allMoving = (track: TrackPoint[]) => track.map(() => true);
/** Revêtement de chaque segment, celui de son point de départ selon son instant (comme `trackSurfaceStretches`). */
const surfacesByTime = (track: TrackPoint[], at: (tS: number) => SurfaceCategory): SurfaceCategory[] =>
  track.slice(0, -1).map((p) => at((p.timeMs - track[0].timeMs) / 1000));
const gradesOf = (track: TrackPoint[]) => computeGrades(track.map((p) => p.ele ?? NaN), buildCumulativeTrack(track));
/** Vélo de route, 8,5 kg, cycliste de 70 kg. */
const ROAD: CyclingEnergyParams = cyclingEnergyParams('route', 8.5, 70);

describe('resistiveForceN', () => {
  it('sur le plat : roulement plus air, calculés à la main', () => {
    // 78,5 × 9,81 × 0,004 = 3,08 N ; ½ × 1,225 × 0,32 × 10² = 19,6 N.
    expect(resistiveForceN(10, 0, ROAD)).toBeCloseTo(3.08 + 19.6, 1);
  });

  it('une pente manquante compte comme plate', () => {
    expect(resistiveForceN(8, NaN, ROAD)).toBe(resistiveForceN(8, 0, ROAD));
  });

  it('devient négative dans une descente raide', () => {
    expect(resistiveForceN(5, -0.08, ROAD)).toBeLessThan(0);
  });
});

describe('roulement par revêtement', () => {
  const bikes = Object.keys(BIKE_TYPES) as BikeType[];

  it('prend le roulement du revêtement, sinon le roulement moyen du vélo', () => {
    const gravel = cyclingEnergyParams('gravel', 12, 70);
    expect(rollingCoefficient(gravel, 'asphalte')).toBe(0.005);
    expect(rollingCoefficient(gravel, 'terre')).toBe(0.012);
    expect(rollingCoefficient(gravel, 'inconnu')).toBe(BIKE_TYPES.gravel.crr);
    expect(rollingCoefficient(gravel, null)).toBe(BIKE_TYPES.gravel.crr);
    expect(rollingCoefficient({ ...gravel, crrBySurface: undefined }, 'terre')).toBe(BIKE_TYPES.gravel.crr);
  });

  it('pour chaque vélo, l’asphalte roule le mieux, et le sable le moins bien', () => {
    for (const bike of bikes) {
      const table = Object.values(BIKE_TYPES[bike].crrBySurface);
      expect(BIKE_TYPES[bike].crrBySurface.asphalte).toBe(Math.min(...table));
      expect(BIKE_TYPES[bike].crrBySurface.sable).toBe(Math.max(...table));
    }
  });

  it('le pneu de route roule le mieux sur l’asphalte, et perd le plus sur la terre', () => {
    const { route, gravel, vtt } = BIKE_TYPES;
    expect(route.crrBySurface.asphalte).toBeLessThan(gravel.crrBySurface.asphalte!);
    expect(gravel.crrBySurface.asphalte).toBeLessThan(vtt.crrBySurface.asphalte!);
    expect(route.crrBySurface.terre).toBeGreaterThan(gravel.crrBySurface.terre!);
    const loss = (bike: BikeType) => BIKE_TYPES[bike].crrBySurface.terre! / BIKE_TYPES[bike].crrBySurface.asphalte!;
    expect(loss('route')).toBeGreaterThan(loss('gravel'));
    expect(loss('gravel')).toBeGreaterThan(loss('vtt'));
  });
});

describe('computeCyclingEnergy', () => {
  it('sur le plat à 36 km/h : environ 234 W mécaniques', () => {
    const track = buildTrack(600, () => 10);
    const r = computeCyclingEnergy(track, gradesOf(track), allMoving(track), ROAD, 0);
    const expectedW = (resistiveForceN(10, 0, ROAD) * 10) / ROAD.drivetrainEfficiency;
    // (3,08 + 19,6) N × 10 m/s / 0,97.
    expect(expectedW).toBeCloseTo(233.8, 0);
    expect(r.mechanicalJ / r.movingTimeS).toBeCloseTo(expectedW, 0);
    expect(r.netJ).toBeCloseTo(r.mechanicalJ / ROAD.muscleEfficiency, 3);
    expect(r.zones.find((z) => z.zone.key === 'flat')!.share).toBeCloseTo(1, 6);
  });

  it('la montée coûte surtout la pesanteur, et coûte plus que le plat à la même vitesse', () => {
    const flat = buildTrack(600, () => 4);
    const climb = buildTrack(600, () => 4, 1, (m) => 100 + 0.07 * m);
    const rFlat = computeCyclingEnergy(flat, gradesOf(flat), allMoving(flat), ROAD, 0);
    const rClimb = computeCyclingEnergy(climb, gradesOf(climb), allMoving(climb), ROAD, 0);
    expect(rClimb.mechanicalJ).toBeGreaterThan(5 * rFlat.mechanicalJ);
    // Pesanteur seule à 7 % et 4 m/s : 78,5 × 9,81 × sin(atan 0,07) × 4 ≈ 215 W.
    expect(rClimb.mechanicalJ / rClimb.movingTimeS).toBeGreaterThan(215);
  });

  it('la descente en roue libre ne coûte rien', () => {
    const descent = buildTrack(300, () => 12, 1, (m) => 1000 - 0.08 * m);
    const r = computeCyclingEnergy(descent, gradesOf(descent), allMoving(descent), ROAD, 0);
    const steep = r.zones.filter((z) => z.zone.key === 'steepDown' || z.zone.key === 'down');
    expect(steep.reduce((s, z) => s + z.distanceM, 0)).toBeGreaterThan(0);
    expect(steep.reduce((s, z) => s + z.mechanicalJ, 0)).toBe(0);
  });

  it('même résultat à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 8 + 2 * Math.sin(t / 60);
    const altitude = (m: number) => 100 + 20 * Math.sin(m / 400);
    const slow = buildTrack(1200, speed, 1, altitude);
    const fast = buildTrack(1200, speed, 0.2, altitude);
    const a = computeCyclingEnergy(slow, gradesOf(slow), allMoving(slow), ROAD, 80);
    const b = computeCyclingEnergy(fast, gradesOf(fast), allMoving(fast), ROAD, 80);
    expect(b.mechanicalJ).toBeCloseTo(a.mechanicalJ, -3);
    expect(Math.abs(b.mechanicalJ - a.mechanicalJ) / a.mechanicalJ).toBeLessThan(0.01);
    expect(b.restJ).toBeCloseTo(a.restJ, 3);
  });

  it("à l'arrêt, seul le repos compte", () => {
    const track = buildTrack(120, () => 0);
    const r = computeCyclingEnergy(track, gradesOf(track), track.map(() => false), ROAD, 100);
    expect(r.netJ).toBe(0);
    expect(r.restJ).toBeCloseTo(12000, 6);
    expect(r.cumulativeTotalJ[track.length - 1]).toBeCloseTo(12000, 6);
    expect(r.mechanicalPowerW.every((p) => Number.isNaN(p))).toBe(true);
  });

  it('un vélo de ville coûte plus qu’un vélo de route à la même vitesse', () => {
    const track = buildTrack(600, () => 6);
    const city = cyclingEnergyParams('ville', BIKE_TYPES.ville.bikeKg, 70);
    const road = cyclingEnergyParams('route', BIKE_TYPES.route.bikeKg, 70);
    const rCity = computeCyclingEnergy(track, gradesOf(track), allMoving(track), city, 0);
    const rRoad = computeCyclingEnergy(track, gradesOf(track), allMoving(track), road, 0);
    expect(rCity.mechanicalJ).toBeGreaterThan(rRoad.mechanicalJ);
  });

  it('un VTT coûte plus qu’un gravel à la même vitesse', () => {
    const track = buildTrack(600, () => 6);
    const mtb = cyclingEnergyParams('vtt', BIKE_TYPES.vtt.bikeKg, 70);
    const gravel = cyclingEnergyParams('gravel', BIKE_TYPES.gravel.bikeKg, 70);
    const rMtb = computeCyclingEnergy(track, gradesOf(track), allMoving(track), mtb, 0);
    const rGravel = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0);
    expect(rMtb.mechanicalJ).toBeGreaterThan(rGravel.mechanicalJ);
  });

  it('sans revêtement, ou sur un revêtement inconnu, garde le roulement moyen du vélo', () => {
    const track = buildTrack(600, () => 6);
    const gravel = cyclingEnergyParams('gravel', BIKE_TYPES.gravel.bikeKg, 70);
    const without = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 50);
    const unknown = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 50, surfacesByTime(track, () => 'inconnu'));
    const other = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 50, surfacesByTime(track, () => 'autre'));
    expect(unknown.mechanicalJ).toBe(without.mechanicalJ);
    expect(other.cumulativeTotalJ).toEqual(without.cumulativeTotalJ);
    expect(without.surfaceDistanceM).toEqual({});
    expect(unknown.surfaceDistanceM.inconnu).toBeCloseTo(without.movingDistanceM, 6);
  });

  it('un gravel coûte moins sur l’asphalte que sur la terre, à la même vitesse', () => {
    const track = buildTrack(600, () => 6);
    const gravel = cyclingEnergyParams('gravel', BIKE_TYPES.gravel.bikeKg, 70);
    const road = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0, surfacesByTime(track, () => 'asphalte'));
    const dirt = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0, surfacesByTime(track, () => 'terre'));
    const nominal = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0);
    expect(road.mechanicalJ).toBeLessThan(nominal.mechanicalJ);
    expect(dirt.mechanicalJ).toBeGreaterThan(nominal.mechanicalJ);
    // Roulement seul à 6 m/s : 82 kg × 9,81 × (0,012 − 0,005) × 6 m/s / 0,97 ≈ 34,8 W d'écart.
    expect((dirt.mechanicalJ - road.mechanicalJ) / dirt.movingTimeS).toBeCloseTo(34.8, 0);
  });

  it('prend le roulement de chaque segment, et range sa distance sous son revêtement', () => {
    const track = buildTrack(600, () => 6);
    const gravel = cyclingEnergyParams('gravel', BIKE_TYPES.gravel.bikeKg, 70);
    const mixed = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0, surfacesByTime(track, (t) => (t < 300 ? 'asphalte' : 'terre')));
    const road = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0, surfacesByTime(track, () => 'asphalte'));
    const dirt = computeCyclingEnergy(track, gradesOf(track), allMoving(track), gravel, 0, surfacesByTime(track, () => 'terre'));
    expect(mixed.mechanicalJ).toBeCloseTo((road.mechanicalJ + dirt.mechanicalJ) / 2, 0);
    expect(mixed.surfaceDistanceM.asphalte).toBeCloseTo(1800, 6);
    expect(mixed.surfaceDistanceM.terre).toBeCloseTo(1800, 6);
  });

  it('même résultat à 1 Hz et à 5 Hz avec le revêtement', () => {
    const speed = (t: number) => 7 + 2 * Math.sin(t / 50);
    const surface = (t: number): SurfaceCategory => (t < 400 ? 'asphalte' : t < 800 ? 'gravillon' : 'terre');
    const gravel = cyclingEnergyParams('gravel', BIKE_TYPES.gravel.bikeKg, 70);
    const slow = buildTrack(1200, speed, 1);
    const fast = buildTrack(1200, speed, 0.2);
    const a = computeCyclingEnergy(slow, gradesOf(slow), allMoving(slow), gravel, 0, surfacesByTime(slow, surface));
    const b = computeCyclingEnergy(fast, gradesOf(fast), allMoving(fast), gravel, 0, surfacesByTime(fast, surface));
    expect(Math.abs(b.mechanicalJ - a.mechanicalJ) / a.mechanicalJ).toBeLessThan(0.01);
  });

  it('donne à chaque zone son temps : leur somme fait le temps en mouvement, et la montée pousse plus de watts', () => {
    const track = buildTrack(1200, () => 5, 1, (m) => (m < 3000 ? 100 + 0.07 * m : 310));
    const result = computeCyclingEnergy(track, gradesOf(track), allMoving(track), ROAD, 0);
    expect(result.zones.reduce((s, z) => s + z.timeS, 0)).toBeCloseTo(result.movingTimeS, 6);
    expect(result.zones.reduce((s, z) => s + z.mechanicalJ, 0)).toBeCloseTo(result.mechanicalJ, 6);
    const up = result.zones.find((z) => z.zone.key === 'up')!;
    const flat = result.zones.find((z) => z.zone.key === 'flat')!;
    expect(up.mechanicalJ / up.timeS).toBeGreaterThan(2 * (flat.mechanicalJ / flat.timeS));
  });
});
