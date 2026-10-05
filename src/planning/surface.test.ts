import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import type { RawTrackPoint } from '../core/types';
import type { RouteLeg, RoutePoint } from './route';
import {
  buildSurfaceRuns, classifySurface, legSurfaceStretches, parseWayTags, readSurfaceRuns, routeSurfacePaths, routeSurfaces,
  shiftSurfaceRuns, summarizeSurfaces, surfacePaths, tagsAt, trackSurfaceStretches, wayTagsText,
} from './surface';

/** Points vers le nord, tous les 0,001° (≈ 111 m). */
const north = (n: number): RoutePoint[] => Array.from({ length: n }, (_, i) => ({ lat: 43.6 + i * 0.001, lon: 3.8 }));

describe('étiquettes d\'une voie', () => {
  it('lit le texte de BRouter et ne garde que celles du revêtement, dans l\'ordre', () => {
    const tags = parseWayTags('reversedirection=yes highway=path surface=earth estimated_forest_class=5 sac_scale=mountain_hiking');
    expect(tags.highway).toBe('path');
    expect(wayTagsText(tags)).toBe('highway=path surface=earth sac_scale=mountain_hiking');
    expect(wayTagsText({ surface: 'paving stones', tracktype: 'grade2', name: 'Rue' })).toBe('surface=paving_stones tracktype=grade2');
    expect(wayTagsText({ name: 'Rue' })).toBe('');
  });
});

describe('catégorie d\'une voie', () => {
  it('suit le revêtement déclaré, valeurs d\'OSM ou de BRouter', () => {
    expect(classifySurface('highway=residential surface=asphalt')).toBe('asphalte');
    expect(classifySurface('highway=footway surface=concrete:plates')).toBe('asphalte');
    expect(classifySurface('highway=footway surface=paved')).toBe('asphalte');
    expect(classifySurface('highway=footway surface=paving_stones:30')).toBe('pierresPlates');
    expect(classifySurface('highway=pedestrian surface=sett')).toBe('paves');
    expect(classifySurface('highway=track surface=fine_gravel')).toBe('gravillon');
    expect(classifySurface('highway=track surface=compacted')).toBe('gravillon');
    expect(classifySurface('highway=track surface=unpaved')).toBe('nonPave');
    expect(classifySurface('highway=path surface=ground')).toBe('terre');
    expect(classifySurface('highway=path surface=grass')).toBe('herbe');
    expect(classifySurface('highway=path surface=sand')).toBe('sable');
    expect(classifySurface('highway=path surface=rocky')).toBe('alpin');
    expect(classifySurface('highway=footway surface=wood')).toBe('autre');
    expect(classifySurface('highway=track surface=gravel;asphalt')).toBe('gravillon');
  });

  it('met un sentier de montagne en Alpin, avant son revêtement', () => {
    expect(classifySurface('highway=path surface=earth sac_scale=mountain_hiking')).toBe('alpin');
    expect(classifySurface('highway=path sac_scale=demanding_alpine_hiking')).toBe('alpin');
    expect(classifySurface('highway=path surface=earth sac_scale=hiking')).toBe('terre');
  });

  it('sans revêtement, lit l\'état de la piste, puis compte une route asphaltée', () => {
    expect(classifySurface('highway=track tracktype=grade1')).toBe('asphalte');
    expect(classifySurface('highway=track tracktype=grade2')).toBe('gravillon');
    expect(classifySurface('highway=track tracktype=grade4')).toBe('nonPave');
    expect(classifySurface('highway=residential')).toBe('asphalte');
    expect(classifySurface('highway=secondary')).toBe('asphalte');
    expect(classifySurface('highway=service')).toBe('asphalte');
    expect(classifySurface('highway=track')).toBe('inconnu');
    expect(classifySurface('highway=footway')).toBe('inconnu');
    expect(classifySurface('')).toBe('inconnu');
    expect(classifySurface(null)).toBe('inconnu');
  });
});

describe('morceaux de voies', () => {
  it('fusionne deux morceaux voisins aux mêmes étiquettes et n\'écrit chaque étiquette qu\'une fois', () => {
    const runs = buildSurfaceRuns([
      { start: 0, tags: 'highway=residential' },
      { start: 3, tags: 'highway=residential' },
      { start: 5, tags: 'highway=track tracktype=grade2' },
      { start: 8, tags: null },
      { start: 9, tags: 'highway=residential' },
    ]);
    expect(runs).toEqual({ tags: ['highway=residential', 'highway=track tracktype=grade2'], runs: [[0, 0], [5, 1], [8, -1], [9, 0]] });
    expect(tagsAt(runs, 4)).toBe('highway=residential');
    expect(tagsAt(runs, 5)).toBe('highway=track tracktype=grade2');
    expect(tagsAt(runs, 8)).toBeNull();
    expect(tagsAt(runs, 100)).toBe('highway=residential');
  });

  it('remplace un morceau par le suivant qui commence au même instant', () => {
    const runs = buildSurfaceRuns([
      { start: 0, tags: 'highway=residential' },
      { start: 1000, tags: 'highway=footway' },
      { start: 1000, tags: 'highway=residential' },
      { start: 2000, tags: 'highway=track' },
    ]);
    expect(runs.runs).toEqual([[0, 0], [2000, 2]]);
  });

  it('décale les morceaux d\'un point ajouté en tête, le premier restant au début', () => {
    const runs = { tags: ['a', 'b'], runs: [[0, 0], [4, 1]] as [number, number][] };
    expect(shiftSurfaceRuns(runs, 1).runs).toEqual([[0, 0], [5, 1]]);
  });

  it('relit des morceaux bien formés, et rien d\'autre', () => {
    const ok = { tags: ['highway=residential'], runs: [[0, 0], [3, -1]] };
    expect(readSurfaceRuns(ok, 10)).toEqual(ok);
    expect(readSurfaceRuns({ tags: ['x'], runs: [[1, 0]] }, 10)).toBeNull();
    expect(readSurfaceRuns({ tags: ['x'], runs: [[0, 0], [0, -1]] }, 10)).toBeNull();
    expect(readSurfaceRuns({ tags: ['x'], runs: [[0, 1]] }, 10)).toBeNull();
    expect(readSurfaceRuns({ tags: ['x'], runs: [[0, 0], [12, 0]] }, 10)).toBeNull();
    expect(readSurfaceRuns({ tags: [3], runs: [[0, 0]] }, 10)).toBeNull();
    expect(readSurfaceRuns('x', 10)).toBeNull();
  });
});

describe('longueurs par revêtement', () => {
  it('compte chaque segment d\'un tronçon dans la voie de son premier point, du plus long au plus court', () => {
    const points = north(6);
    const surfaces = { tags: ['highway=residential', 'highway=track tracktype=grade2'], runs: [[0, 0], [3, 1]] as [number, number][] };
    const totals = summarizeSurfaces(legSurfaceStretches(points, surfaces));
    expect(totals.map((t) => t.category)).toEqual(['asphalte', 'gravillon']);
    expect(totals[0].distanceM).toBeCloseTo(3 * 111.2, 0);
    expect(totals[1].distanceM).toBeCloseTo(2 * 111.2, 0);
    expect(summarizeSurfaces(legSurfaceStretches(points, undefined))).toEqual([{ category: 'inconnu', distanceM: expect.closeTo(5 * 111.2, 0) }]);
  });

  it('retrouve la voie de chaque point d\'une trace par son instant, même résultat à 1 Hz et à 5 Hz', () => {
    const startMs = Date.UTC(2026, 9, 3, 15, 0, 0);
    // 200 s vers le nord à 3 m/s ; asphalte les 100 premières secondes, gravillon ensuite.
    const raw = (hz: number): RawTrackPoint[] =>
      Array.from({ length: 200 * hz + 1 }, (_, i) => ({
        lat: 43.6 + (3 * i) / hz / 111_195,
        lon: 3.8,
        time: new Date(startMs + (i * 1000) / hz).toISOString(),
      }));
    const surfaces = { tags: ['highway=residential', 'highway=track surface=gravel'], runs: [[0, 0], [100_000, 1]] as [number, number][] };
    const totals = (hz: number) => summarizeSurfaces(trackSurfaceStretches(computeKinematics(raw(hz)), surfaces, startMs));
    const at1 = totals(1);
    const at5 = totals(5);
    expect(at1.map((t) => t.category).sort()).toEqual(['asphalte', 'gravillon']);
    for (const t of at1) {
      expect(t.distanceM).toBeCloseTo(300, -1);
      expect(at5.find((u) => u.category === t.category)!.distanceM).toBeCloseTo(t.distanceM, -1);
    }
  });

  it('additionne les tronçons d\'un itinéraire, sans ceux en calcul, et repère ceux rangés sans revêtement', () => {
    const points = north(3);
    const legs: RouteLeg[] = [
      { mode: 'route', status: 'ready', points, surfaces: { tags: ['highway=residential'], runs: [[0, 0]] } },
      { mode: 'sentier', status: 'ready', points },
      { mode: 'straight', status: 'ready', points },
      { mode: 'imported', status: 'ready', points },
      { mode: 'piste', status: 'pending', points },
    ];
    const result = routeSurfaces(legs);
    expect(result.pendingLegs).toBe(1);
    expect(result.missingLegs).toBe(1);
    expect(result.totals.map((t) => t.category)).toEqual(['inconnu', 'asphalte']);
    expect(result.totals[0].distanceM).toBeCloseTo(3 * result.totals[1].distanceM, 6);
  });
});

describe('tracé par revêtement, pour la carte', () => {
  it('regroupe les segments voisins de même catégorie, les morceaux partageant leur point de jonction', () => {
    const points = north(6);
    const surfaces = { tags: ['highway=residential', 'highway=track tracktype=grade2'], runs: [[0, 0], [3, 1]] as [number, number][] };
    const paths = surfacePaths(points, legSurfaceStretches(points, surfaces));
    expect(paths.map((p) => p.category)).toEqual(['asphalte', 'gravillon']);
    expect(paths[0].positions).toEqual(points.slice(0, 4).map((p) => [p.lat, p.lon]));
    expect(paths[1].positions).toEqual(points.slice(3).map((p) => [p.lat, p.lon]));
    expect(surfacePaths(points.slice(0, 1), [])).toEqual([]);
  });

  it('découpe une trace au même instant à 1 Hz et à 5 Hz', () => {
    const startMs = Date.UTC(2026, 9, 3, 15, 0, 0);
    const raw = (hz: number): RawTrackPoint[] =>
      Array.from({ length: 200 * hz + 1 }, (_, i) => ({
        lat: 43.6 + (3 * i) / hz / 111_195,
        lon: 3.8,
        time: new Date(startMs + (i * 1000) / hz).toISOString(),
      }));
    const surfaces = { tags: ['highway=residential', 'highway=track surface=gravel'], runs: [[0, 0], [100_000, 1]] as [number, number][] };
    const split = (hz: number) => {
      const track = computeKinematics(raw(hz));
      return surfacePaths(track, trackSurfaceStretches(track, surfaces, startMs));
    };
    const at1 = split(1);
    const at5 = split(5);
    expect(at1.map((p) => p.category)).toEqual(['asphalte', 'gravillon']);
    expect(at5.map((p) => p.category)).toEqual(['asphalte', 'gravillon']);
    expect(at5[1].positions[0][0]).toBeCloseTo(at1[1].positions[0][0], 6);
  });

  it('dessine chaque tronçon prêt, ligne droite en « Inconnu », et laisse de côté ceux en calcul ou en échec', () => {
    const points = north(3);
    const legs: RouteLeg[] = [
      { mode: 'route', status: 'ready', points, surfaces: { tags: ['highway=residential'], runs: [[0, 0]] } },
      { mode: 'straight', status: 'ready', points },
      { mode: 'piste', status: 'pending', points },
      { mode: 'piste', status: 'error', points },
    ];
    const paths = routeSurfacePaths(legs);
    expect(paths[0]?.map((p) => p.category)).toEqual(['asphalte']);
    expect(paths[0]?.[0].positions).toHaveLength(3);
    expect(paths[1]?.map((p) => p.category)).toEqual(['inconnu']);
    expect(paths[2]).toBeNull();
    expect(paths[3]).toBeNull();
  });
});
