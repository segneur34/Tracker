import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import { GRADE_ANALYSIS } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import {
  DEFAULT_ENERGY_PARAMS, computeEnergy, flatCostJkgM, minettiCost, restingPowerWkg, runningCostJkgM,
  smoothMovingPower, walkingCostJkgM, walkingEnergyParams, walkingGrossWkg, type EnergyParams,
} from './energy';
import { computeGrades } from './runningAnalytics';

/**
 * Trace synthétique à cadence fixe : vitesse donnée par seconde écoulée,
 * altitude fonction de la distance.
 */
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
const gradesOf = (track: TrackPoint[]) => computeGrades(track.map((p) => p.ele ?? NaN), buildCumulativeTrack(track), GRADE_ANALYSIS.halfWindowM);
const NO_AIR: EnergyParams = { ...DEFAULT_ENERGY_PARAMS, airDragJs2M3Kg: 0 };

describe('minettiCost', () => {
  it('suit la courbe publiée', () => {
    expect(minettiCost(0)).toBeCloseTo(3.6, 6);
    expect(minettiCost(0.1) / minettiCost(0)).toBeCloseTo(1.658, 2);
    expect(minettiCost(-0.2)).toBeCloseTo(1.8, 1);
    // Le minimum est dans la descente, pas sur le plat.
    expect(minettiCost(-0.1)).toBeLessThan(minettiCost(0));
  });

  it('est bornée au domaine mesuré', () => {
    expect(minettiCost(0.8)).toBe(minettiCost(0.45));
    expect(minettiCost(-0.8)).toBe(minettiCost(-0.45));
  });

  it("remplace le plat par l'économie du coureur", () => {
    expect(flatCostJkgM(DEFAULT_ENERGY_PARAMS)).toBeCloseTo(4.18, 6);
    expect(runningCostJkgM(0, DEFAULT_ENERGY_PARAMS)).toBeCloseTo(4.18, 6);
    expect(runningCostJkgM(NaN, DEFAULT_ENERGY_PARAMS)).toBeCloseTo(4.18, 6);
  });
});

describe('restingPowerWkg', () => {
  it('prend Mifflin-St Jeor quand le profil est complet', () => {
    // 10×70 + 6,25×175 − 5×40 + 5 = 1 598,75 kcal/j, soit 77,4 W.
    expect(restingPowerWkg({ weightKg: 70, heightCm: 175, sex: 'm' }, 40, DEFAULT_ENERGY_PARAMS) * 70).toBeCloseTo(77.4, 1);
  });

  it('retombe sur 1 MET sinon', () => {
    expect(restingPowerWkg({ weightKg: 70, heightCm: null, sex: 'm' }, 40, DEFAULT_ENERGY_PARAMS)).toBeCloseTo(1.219, 3);
  });
});

describe('computeEnergy', () => {
  it('10 km sur le plat à 70 kg : environ 2 926 kJ de course', () => {
    const track = buildTrack(3000, () => 10000 / 3000);
    const result = computeEnergy(track, gradesOf(track), allMoving(track), NO_AIR, 0);
    expect(result.movingDistanceM).toBeCloseTo(10000, 3);
    expect((result.netJkg * 70) / 1000).toBeCloseTo(2926, 0);
    expect(result.totalJkg).toBe(result.netJkg);
  });

  it("ajoute la résistance de l'air en v²", () => {
    const track = buildTrack(1000, () => 5);
    const result = computeEnergy(track, gradesOf(track), allMoving(track), DEFAULT_ENERGY_PARAMS, 0);
    const expected = (4.18 + DEFAULT_ENERGY_PARAMS.airDragJs2M3Kg * 25) * 5000;
    expect(result.netJkg).toBeCloseTo(expected, 3);
  });

  it('10 kg de charge sur 70 kg : déplacement × 8/7, repos inchangé', () => {
    const track = buildTrack(1200, () => 3, 1, (m) => 100 + 0.05 * m);
    const rest = 1.2;
    const free = computeEnergy(track, gradesOf(track), allMoving(track), DEFAULT_ENERGY_PARAMS, rest);
    const loaded = computeEnergy(track, gradesOf(track), allMoving(track), DEFAULT_ENERGY_PARAMS, rest, 10 / 70);
    expect(loaded.netJkg).toBeCloseTo(free.netJkg * (8 / 7), 6);
    expect(loaded.mechanicalJkg).toBeCloseTo(free.mechanicalJkg * (8 / 7), 6);
    expect(loaded.restJkg).toBe(free.restJkg);
    expect(loaded.totalJkg).toBeCloseTo(free.netJkg * (8 / 7) + free.restJkg, 6);
    expect(loaded.cumulativeTotalJkg.at(-1)).toBeCloseTo(loaded.totalJkg, 6);
  });

  it("une pause n'ajoute que le repos", () => {
    const run = buildTrack(1200, () => 3);
    const paused = buildTrack(1200, (t) => (t > 400 && t <= 700 ? 0 : 3));
    const mask = paused.map((p, i) => i === 0 || p.speedMs > 0);
    const rest = 1.2;
    const a = computeEnergy(run, gradesOf(run), allMoving(run), NO_AIR, rest);
    const b = computeEnergy(paused, gradesOf(paused), mask, NO_AIR, rest);
    expect(b.restJkg).toBeCloseTo(rest * 1200, 6);
    expect(b.movingTimeS).toBe(900);
    expect(b.netJkg).toBeCloseTo(a.netJkg * 0.75, 3);
    expect(Number.isNaN(b.mechanicalPowerWkg[500])).toBe(true);
  });

  it('donne une puissance mécanique de capteur, pas la dépense : 313 W à 4 m/s pour 75 kg', () => {
    const track = buildTrack(600, () => 4);
    const result = computeEnergy(track, gradesOf(track), allMoving(track), NO_AIR, 0);
    expect(result.mechanicalPowerWkg[300] * 75).toBeCloseTo(4.18 * 0.25 * 4 * 75, 3);
    expect(result.mechanicalJkg).toBeCloseTo(result.netJkg * 0.25, 6);
  });

  it('donne la même énergie à 1 Hz et à 5 Hz', () => {
    const hill = (d: number) => 100 + 30 * Math.sin(d / 400);
    const speed = (t: number) => 3 + 0.5 * Math.sin(t / 90);
    const slow = buildTrack(1800, speed, 1, hill);
    const fast = buildTrack(1800, speed, 0.2, hill);
    const a = computeEnergy(slow, gradesOf(slow), allMoving(slow), DEFAULT_ENERGY_PARAMS, 1.2);
    const b = computeEnergy(fast, gradesOf(fast), allMoving(fast), DEFAULT_ENERGY_PARAMS, 1.2);
    expect(b.totalJkg / a.totalJkg).toBeCloseTo(1, 2);
  });

  it("sans altitude, la course compte comme plate", () => {
    const track = buildTrack(600, () => 3, 1, (d) => 100 + 0.1 * d);
    const flat = computeEnergy(track, [], allMoving(track), NO_AIR, 0);
    expect(flat.netJkg).toBeCloseTo(4.18 * 1800, 3);
    expect(flat.zones.find((z) => z.zone.key === 'flat')?.share).toBe(1);
  });

  it('coûte plus en montée, et ses zones font le total', () => {
    const track = buildTrack(1200, () => 3, 1, (d) => (d < 1800 ? 100 + 0.12 * d : 316 - 0.12 * (d - 1800)));
    const result = computeEnergy(track, gradesOf(track), allMoving(track), DEFAULT_ENERGY_PARAMS, 1.2);
    const zoneSum = result.zones.reduce((s, z) => s + z.netJkg, 0);
    expect(zoneSum).toBeCloseTo(result.netJkg, 6);
    const up = result.zones.find((z) => z.zone.key === 'steepUp')!;
    const down = result.zones.find((z) => z.zone.key === 'steepDown')!;
    expect(up.netJkg / up.distanceM).toBeGreaterThan(2 * (down.netJkg / down.distanceM));
    expect(result.cumulativeTotalJkg[track.length - 1]).toBeCloseTo(result.totalJkg, 6);
  });

  it('donne à chaque zone son temps et son travail : leur somme fait le total, et la montée pousse plus de watts', () => {
    const track = buildTrack(1200, () => 3, 1, (d) => (d < 1800 ? 100 + 0.12 * d : 316));
    const result = computeEnergy(track, gradesOf(track), allMoving(track), DEFAULT_ENERGY_PARAMS, 1.2);
    expect(result.zones.reduce((s, z) => s + z.timeS, 0)).toBeCloseTo(result.movingTimeS, 6);
    expect(result.zones.reduce((s, z) => s + z.mechanicalJkg, 0)).toBeCloseTo(result.mechanicalJkg, 6);
    const up = result.zones.find((z) => z.zone.key === 'steepUp')!;
    const flat = result.zones.find((z) => z.zone.key === 'flat')!;
    // Minetti à 12 % : environ 1,8 fois le coût du plat, à la même vitesse.
    expect(up.mechanicalJkg / up.timeS).toBeGreaterThan(1.5 * (flat.mechanicalJkg / flat.timeS));
  });
  it('une montée clairsemée (un point tous les 30 m) ne sort pas plate', () => {
    const at = (stepS: number) => buildTrack(1200, () => 3, stepS, (d) => 100 + 0.1 * d);
    const dense = at(1);
    const sparse = at(10);
    const a = computeEnergy(dense, gradesOf(dense), allMoving(dense), NO_AIR, 0);
    const b = computeEnergy(sparse, gradesOf(sparse), allMoving(sparse), NO_AIR, 0);
    expect(b.zones.find((z) => z.zone.key === 'steepUp')!.share).toBe(1);
    expect(Math.abs(b.netJkg - a.netJkg) / a.netJkg).toBeLessThan(0.01);
  });
});

describe('marche (Pandolf, Santee en descente)', () => {
  const walking = DEFAULT_ENERGY_PARAMS.walking;

  it('suit Pandolf sur le plat et en montée', () => {
    // 1,5 + 1,5 × 1,4² = 1,5 + 2,94 = 4,44 W/kg.
    expect(walkingGrossWkg(1.4, 0, 0, 70, walking)).toBeCloseTo(4.44, 6);
    // + 0,35 × 1,4 × 10 = 4,9 W/kg de plus à 10 %.
    expect(walkingGrossWkg(1.4, 0.1, 0, 70, walking)).toBeCloseTo(9.34, 6);
    expect(walkingCostJkgM(1.4, 0, 0, 70, walking)).toBeCloseTo(2.94 / 1.4, 6);
    expect(walkingCostJkgM(1.4, NaN, 0, 70, walking)).toBeCloseTo(2.94 / 1.4, 6);
  });

  it('corrige la descente par Santee : moins que le plat, plus que zéro', () => {
    // Pandolf : 4,44 − 4,9 = −0,46 ; CF/W = −14/3,5 − 4²/70 + (25 − 1,96)/70 = −3,8994 ; −0,46 + 3,8994 = 3,4394.
    const down10 = walkingGrossWkg(1.4, -0.1, 0, 70, walking);
    expect(down10).toBeCloseTo(3.4394, 3);
    expect(down10).toBeGreaterThan(walking.standingWkg);
    expect(down10).toBeLessThan(walkingGrossWkg(1.4, 0, 0, 70, walking));
    // −15 % : 4,44 − 7,35 + 6 + 81/70 − 23,04/70 = 3,918.
    expect(walkingGrossWkg(1.4, -0.15, 0, 70, walking)).toBeCloseTo(3.918, 3);
    // Juste sous le plat, la correction ne s'annule pas : (36 − 23,04)/70 = +0,185 W/kg.
    expect(walkingGrossWkg(1.4, -1e-9, 0, 70, walking) - walkingGrossWkg(1.4, 0, 0, 70, walking)).toBeCloseTo(0.185, 3);
  });

  it('borne la pente à ±25 %', () => {
    expect(walkingGrossWkg(1.2, -0.4, 0, 70, walking)).toBe(walkingGrossWkg(1.2, -0.25, 0, 70, walking));
    expect(walkingGrossWkg(1.2, 0.4, 0, 70, walking)).toBe(walkingGrossWkg(1.2, 0.25, 0, 70, walking));
  });

  it('fait payer la charge portée selon la formule', () => {
    // r = 10/70 : 2 × (1 + r) × r² de station chargée, et le déplacement × (1 + r).
    const r = 10 / 70;
    const loaded = walkingGrossWkg(1.4, 0, r, 70, walking);
    expect(loaded).toBeCloseTo(1.5 + 2 * (1 + r) * r * r + (1 + r) * 2.94, 6);
    expect(loaded - walkingGrossWkg(1.4, 0, 0, 70, walking)).toBeCloseTo(2 * (1 + r) * r * r + r * 2.94, 6);
  });

  it('prend le poids de référence sans poids saisi, dans la seule correction de descente', () => {
    expect(walkingGrossWkg(1.4, 0.05, 0, null, walking)).toBe(walkingGrossWkg(1.4, 0.05, 0, 70, walking));
    expect(walkingGrossWkg(1.4, -0.1, 0, null, walking)).toBe(walkingGrossWkg(1.4, -0.1, 0, walking.referenceBodyKg, walking));
  });

  it('coûte environ moitié de la course sur le plat, sans le repos', () => {
    const track = buildTrack(1000, () => 1.4);
    const params = { ...walkingEnergyParams(null, 70), airDragJs2M3Kg: 0 };
    const result = computeEnergy(track, gradesOf(track), allMoving(track), params, 0);
    expect(result.movingDistanceM).toBeCloseTo(1400, 3);
    expect(result.netJkg).toBeCloseTo(2.94 * 1000, 3);
    expect(result.mechanicalJkg).toBeCloseTo(result.netJkg * 0.25, 6);
  });

  it("ne multiplie pas Pandolf par la masse portée, seulement l'air", () => {
    const track = buildTrack(1000, () => 1.4);
    const params = walkingEnergyParams(null, 70);
    const r = 10 / 70;
    const result = computeEnergy(track, gradesOf(track), allMoving(track), params, 0, r);
    const expected = (walkingCostJkgM(1.4, 0, r, 70, params.walking) + params.airDragJs2M3Kg * 1.96 * (1 + r)) * 1400;
    expect(result.netJkg).toBeCloseTo(expected, 3);
  });

  it('donne la même énergie et les mêmes zones à 1 Hz et à 5 Hz', () => {
    const hill = (d: number) => 100 + 30 * Math.sin(d / 300);
    const speed = (t: number) => 1.3 + 0.2 * Math.sin(t / 90);
    const slow = buildTrack(1800, speed, 1, hill);
    const fast = buildTrack(1800, speed, 0.2, hill);
    const params = walkingEnergyParams(null, 70);
    const a = computeEnergy(slow, gradesOf(slow), allMoving(slow), params, 1.2);
    const b = computeEnergy(fast, gradesOf(fast), allMoving(fast), params, 1.2);
    expect(b.netJkg / a.netJkg).toBeCloseTo(1, 2);
    for (let k = 0; k < a.zones.length; k++) expect(b.zones[k].share).toBeCloseTo(a.zones[k].share, 2);
  });

  it('laisse la course telle quelle, paramètres de marche présents', () => {
    const track = buildTrack(1200, () => 3, 1, (m) => 100 + 0.05 * m);
    const withBody = { ...DEFAULT_ENERGY_PARAMS, bodyKg: 70 };
    const a = computeEnergy(track, gradesOf(track), allMoving(track), DEFAULT_ENERGY_PARAMS, 1.2, 0.1);
    const b = computeEnergy(track, gradesOf(track), allMoving(track), withBody, 1.2, 0.1);
    expect(b.netJkg).toBe(a.netJkg);
    expect(walkingEnergyParams(210, 70)).toMatchObject({ model: 'marche', economyMlKgKm: 210, bodyKg: 70 });
    expect(DEFAULT_ENERGY_PARAMS.model).toBe('course');
  });
});

describe('smoothMovingPower', () => {
  it('garde une puissance constante et laisse un trou aux pauses', () => {
    const track = buildTrack(600, (t) => (t > 200 && t <= 300 ? 0 : 3));
    const mask = track.map((p, i) => i === 0 || p.speedMs > 0);
    const { mechanicalPowerWkg } = computeEnergy(track, gradesOf(track), mask, NO_AIR, 0);
    const smooth = smoothMovingPower(mechanicalPowerWkg, track, 60);
    expect(smooth[100]).toBeCloseTo(4.18 * 0.25 * 3, 6);
    expect(smooth[199]).toBeCloseTo(4.18 * 0.25 * 3, 6);
    expect(Number.isNaN(smooth[250])).toBe(true);
  });

  it('rétrécit la fenêtre des deux côtés au départ : une rampe ressort intacte', () => {
    // Puissance qui croît d'1 W/kg par minute : une moyenne centrée la rend telle
    // quelle, bords compris ; tronquée d'un côté, elle prendrait 30 s d'avance.
    const track = buildTrack(300, () => 3);
    const power = track.map((p, i) => (i === 0 ? NaN : (p.timeMs - track[0].timeMs) / 60000));
    const smooth = smoothMovingPower(power, track, 60);
    expect(smooth[1]).toBeCloseTo(power[1], 6);
    expect(smooth[10]).toBeCloseTo(power[10], 6);
    expect(smooth[150]).toBeCloseTo(power[150], 6);
    expect(smooth[300]).toBeCloseTo(power[300], 6);
  });

  it('repart du premier point après un long arrêt, mais lisse à travers un arrêt court', () => {
    const track = buildTrack(400, () => 3);
    // 20 s puis 100 s sans mouvement ; puissance de 2 W/kg avant, 5 W/kg après chacun.
    const power = track.map((_, i) => (i === 0 || (i > 100 && i <= 120) || (i > 200 && i <= 300) ? NaN : i > 300 ? 5 : i > 120 ? 5 : 2));
    const smooth = smoothMovingPower(power, track, 60);
    expect(smooth[301]).toBeCloseTo(5, 6);
    expect(smooth[121]).toBeLessThan(5);
    expect(smooth[121]).toBeGreaterThan(2);
  });

  it('donne la même courbe à 1 Hz et à 5 Hz', () => {
    const climb = (d: number) => 100 + (d < 300 ? d * 0.2 : 60);
    const at = (stepS: number) => {
      const track = buildTrack(600, (t) => (t < 5 ? 0 : 2.5), stepS, climb);
      const mask = track.map((p) => p.speedMs > 0);
      const { mechanicalPowerWkg } = computeEnergy(track, gradesOf(track), mask, NO_AIR, 0);
      return { track, smooth: smoothMovingPower(mechanicalPowerWkg, track, 60) };
    };
    const slow = at(1);
    const fast = at(0.2);
    // L'écart qui reste vient de la pente, mesurée sur des points différents au départ.
    for (const tS of [10, 30, 120, 400]) {
      expect(Math.abs(fast.smooth[tS * 5] - slow.smooth[tS]) / slow.smooth[tS]).toBeLessThan(0.02);
    }
  });
});
