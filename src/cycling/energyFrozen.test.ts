import { describe, expect, it } from 'vitest';
import { energyCases } from '../core/energyTestTracks';
import { classifyGrade, gradeZones, type GradeZoneKey } from '../core/grade';
import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import type { SurfaceCategory } from '../planning/surface';
import {
  computeCyclingEnergy, cyclingEnergyParams, resistiveForceN, rollingCoefficient,
  type CyclingEnergyParams, type CyclingEnergyResult,
} from './energy';

/**
 * Neutralité de la mise en commun de l'intégration (`core/energy.ts`) : copie
 * gelée de `computeCyclingEnergy` avant le lot 70, comparée bit à bit.
 */
const frozenComputeCyclingEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: CyclingEnergyParams,
  restW: number,
  surfaces?: ReadonlyArray<SurfaceCategory>
): CyclingEnergyResult => {
  const n = track.length;
  const mechanicalPowerW = new Array<number>(n).fill(NaN);
  const cumulativeTotalJ = new Array<number>(n).fill(0);
  const byZone: Record<GradeZoneKey, { mechanicalJ: number; netJ: number; distanceM: number; timeS: number }> = {
    steepDown: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    down: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    flat: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    up: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    steepUp: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
  };
  let mechanicalJ = 0;
  let netJ = 0;
  let restJ = 0;
  let movingTimeS = 0;
  let movingDistanceM = 0;
  const surfaceDistanceM: Partial<Record<SurfaceCategory, number>> = {};

  for (let i = 1; i < n; i++) {
    const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (dt <= 0) {
      cumulativeTotalJ[i] = cumulativeTotalJ[i - 1];
      continue;
    }
    const rest = restW * dt;
    restJ += rest;
    let net = 0;
    if (activityMask[i]) {
      const d = segmentDistanceM(track, i);
      const grade = grades[i] ?? NaN;
      const surface = surfaces?.[i - 1];
      const crr = rollingCoefficient(params, surface);
      const work = Math.max(0, resistiveForceN(track[i].speedMs, grade, params, crr) * d) / params.drivetrainEfficiency;
      if (surface) surfaceDistanceM[surface] = (surfaceDistanceM[surface] ?? 0) + d;
      net = work / params.muscleEfficiency;
      mechanicalPowerW[i] = work / dt;
      mechanicalJ += work;
      netJ += net;
      movingTimeS += dt;
      movingDistanceM += d;
      const zone = byZone[classifyGrade(grade, params.gradeZones) ?? 'flat'];
      zone.mechanicalJ += work;
      zone.netJ += net;
      zone.distanceM += d;
      zone.timeS += dt;
    }
    cumulativeTotalJ[i] = cumulativeTotalJ[i - 1] + rest + net;
  }

  return {
    mechanicalPowerW,
    cumulativeTotalJ,
    mechanicalJ,
    netJ,
    restJ,
    totalJ: netJ + restJ,
    movingTimeS,
    movingDistanceM,
    surfaceDistanceM,
    zones: gradeZones(params.gradeZones).map((zone) => ({
      zone,
      ...byZone[zone.key],
      share: netJ > 0 ? byZone[zone.key].netJ / netJ : 0,
    })),
  };
};

const SURFACES: SurfaceCategory[] = ['asphalte', 'gravillon', 'terre', 'inconnu', 'herbe'];

describe('computeCyclingEnergy, copie gelée', () => {
  for (const c of energyCases()) {
    for (const bike of ['route', 'gravel', 'vtt'] as const) {
      const params = cyclingEnergyParams(bike, 9, 72);
      it(`${c.name}, ${bike}`, () => {
        const now = computeCyclingEnergy(c.track, c.grades, c.mask, params, 85);
        const before = frozenComputeCyclingEnergy(c.track, c.grades, c.mask, params, 85);
        expect(now).toEqual(before);
        expect(JSON.stringify(now)).toBe(JSON.stringify(before));
        expect(now.netJ).toBeGreaterThan(0);
      });
      it(`${c.name}, ${bike}, revêtements`, () => {
        const surfaces = c.track.slice(1).map((_, k) => SURFACES[Math.floor(k / 37) % SURFACES.length]);
        const now = computeCyclingEnergy(c.track, c.grades, c.mask, params, 85, surfaces);
        const before = frozenComputeCyclingEnergy(c.track, c.grades, c.mask, params, 85, surfaces);
        expect(now).toEqual(before);
        expect(JSON.stringify(now)).toBe(JSON.stringify(before));
      });
    }
  }
});
