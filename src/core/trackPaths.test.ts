import { describe, expect, it } from 'vitest';
import { energyCases } from './energyTestTracks';
import { classifyGrade, type GradeZoneKey } from './grade';
import { GRADE_ANALYSIS } from './sportProfiles';
import type { TrackPoint } from './types';
import { consecutiveSteps, pathsWhere } from './trackPaths';
import { gradeZonePaths } from '../running/runningAnalytics';

/** Copie gelée de `gradeZonePaths` avant le lot 70. */
const frozenGradeZonePaths = (track: TrackPoint[], grades: number[], activityMask: boolean[], zone: GradeZoneKey): [number, number][][] => {
  const paths: [number, number][][] = [];
  let current: [number, number][] | null = null;
  for (let i = 1; i < track.length; i++) {
    if (!activityMask[i] || classifyGrade(grades[i], GRADE_ANALYSIS) !== zone) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [[track[i - 1].lat, track[i - 1].lon]];
      paths.push(current);
    }
    current.push([track[i].lat, track[i].lon]);
  }
  return paths;
};

const pts = [0, 1, 2, 3, 4, 5].map((k) => ({ lat: k, lon: -k }));

describe('pathsWhere', () => {
  it('prolonge un tracé sur des pas qui se suivent, le coupe ailleurs', () => {
    const steps = [{ from: 0, to: 1 }, { from: 1, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }];
    expect(pathsWhere(pts, steps, (s) => s.from !== 3)).toEqual([
      [[0, -0], [1, -1], [2, -2], [3, -3]],
      [[4, -4], [5, -5]],
    ]);
    expect(pathsWhere(pts, consecutiveSteps(pts.length), () => false)).toEqual([]);
  });

  it('redonne gradeZonePaths à l’identique, 1 Hz et 5 Hz, pauses et pente manquante', () => {
    for (const c of energyCases()) {
      for (const zone of ['steepDown', 'down', 'flat', 'up', 'steepUp'] as GradeZoneKey[]) {
        expect(gradeZonePaths(c.track, c.grades, c.mask, zone, GRADE_ANALYSIS))
          .toEqual(frozenGradeZonePaths(c.track, c.grades, c.mask, zone));
      }
    }
  });
});
