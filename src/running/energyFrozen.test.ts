import { describe, expect, it } from 'vitest';
import { energyCases } from '../core/energyTestTracks';
import { classifyGrade, gradeZones, type GradeZoneKey } from '../core/grade';
import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import {
  DEFAULT_ENERGY_PARAMS, computeEnergy, runningCostJkgM, walkingCostJkgM, walkingEnergyParams,
  type EnergyParams, type EnergyResult,
} from './energy';

/**
 * Neutralité de la mise en commun de l'intégration (`core/energy.ts`) : copie
 * gelée de `computeEnergy` avant le lot 70, comparée bit à bit.
 */
const frozenComputeEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: EnergyParams,
  restWkg: number,
  loadRatio = 0
): EnergyResult => {
  const massRatio = 1 + Math.max(0, loadRatio);
  const n = track.length;
  const mechanicalPowerWkg = new Array<number>(n).fill(NaN);
  const cumulativeTotalJkg = new Array<number>(n).fill(0);
  const byZone: Record<GradeZoneKey, { netJkg: number; distanceM: number; timeS: number }> = {
    steepDown: { netJkg: 0, distanceM: 0, timeS: 0 },
    down: { netJkg: 0, distanceM: 0, timeS: 0 },
    flat: { netJkg: 0, distanceM: 0, timeS: 0 },
    up: { netJkg: 0, distanceM: 0, timeS: 0 },
    steepUp: { netJkg: 0, distanceM: 0, timeS: 0 },
  };
  let netJkg = 0;
  let restJkg = 0;
  let movingTimeS = 0;
  let movingDistanceM = 0;

  for (let i = 1; i < n; i++) {
    const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (dt <= 0) {
      cumulativeTotalJkg[i] = cumulativeTotalJkg[i - 1];
      continue;
    }
    const rest = restWkg * dt;
    restJkg += rest;
    let net = 0;
    if (activityMask[i]) {
      const d = segmentDistanceM(track, i);
      const v = track[i].speedMs;
      const grade = grades[i] ?? NaN;
      net = params.model === 'marche'
        ? (walkingCostJkgM(v, grade, loadRatio, params.bodyKg, params.walking) + params.airDragJs2M3Kg * v * v * massRatio) * d
        : (runningCostJkgM(grade, params) + params.airDragJs2M3Kg * v * v) * d * massRatio;
      mechanicalPowerWkg[i] = (net * params.mechanicalEfficiency) / dt;
      netJkg += net;
      movingTimeS += dt;
      movingDistanceM += d;
      const zone = byZone[classifyGrade(grade, params.gradeZones) ?? 'flat'];
      zone.netJkg += net;
      zone.distanceM += d;
      zone.timeS += dt;
    }
    cumulativeTotalJkg[i] = cumulativeTotalJkg[i - 1] + rest + net;
  }

  return {
    mechanicalPowerWkg,
    cumulativeTotalJkg,
    mechanicalJkg: netJkg * params.mechanicalEfficiency,
    netJkg,
    restJkg,
    totalJkg: netJkg + restJkg,
    movingTimeS,
    movingDistanceM,
    zones: gradeZones(params.gradeZones).map((zone) => ({
      zone,
      ...byZone[zone.key],
      mechanicalJkg: byZone[zone.key].netJkg * params.mechanicalEfficiency,
      share: netJkg > 0 ? byZone[zone.key].netJkg / netJkg : 0,
    })),
  };
};

const PARAMS: [string, EnergyParams, number][] = [
  ['course', DEFAULT_ENERGY_PARAMS, 0],
  ['course chargée', DEFAULT_ENERGY_PARAMS, 0.15],
  ['marche', walkingEnergyParams(null, 72), 0],
  ['marche chargée', walkingEnergyParams(210, null), 0.3],
];

describe('computeEnergy, copie gelée', () => {
  for (const c of energyCases()) {
    for (const [label, params, load] of PARAMS) {
      it(`${c.name}, ${label}`, () => {
        const now = computeEnergy(c.track, c.grades, c.mask, params, 1.2, load);
        const before = frozenComputeEnergy(c.track, c.grades, c.mask, params, 1.2, load);
        expect(now).toEqual(before);
        expect(JSON.stringify(now)).toBe(JSON.stringify(before));
        expect(now.netJkg).toBeGreaterThan(0);
      });
    }
  }
});
