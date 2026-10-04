import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import type { RawTrackPoint } from '../core/types';
import type { Waypoint } from './route';
import { summarizeSurfaces, trackSurfaceStretches } from './surface';
import { WAY_MATCH_DEFAULTS, matchTrackToWays, queryLines, trackSurfaceRuns, type OsmWay } from './wayMatch';

/** Un mètre vers l'est et vers le nord, en degrés, autour de 43,6° N. */
const M_LAT = 1 / 111_195;
const M_LON = 1 / (111_195 * Math.cos((43.6 * Math.PI) / 180));
const LAT0 = 43.6;
const LON0 = 3.8;
/** Point à `x` mètres à l'est et `y` mètres au nord de l'origine. */
const at = (x: number, y: number): Waypoint => ({ lat: LAT0 + y * M_LAT, lon: LON0 + x * M_LON });

/** Deux voies parallèles vers l'est, à 0 et 8 m au nord (une route et son trottoir), et un sentier qui part au nord à x = 300 m. */
const WAYS: OsmWay[] = [
  { id: 1, tags: 'highway=residential surface=asphalt', geometry: [at(-50, 0), at(300, 0)] },
  { id: 2, tags: 'highway=footway', geometry: [at(-50, 8), at(300, 8)] },
  { id: 3, tags: 'highway=path surface=ground', geometry: [at(300, 0), at(300, 400)] },
];

describe('lignes envoyées au serveur', () => {
  it('prend un point tous les 25 m le long de la trace, dernier compris', () => {
    const points = Array.from({ length: 101 }, (_, i) => at(i * 2, 0));
    const [line, ...rest] = queryLines(points, WAY_MATCH_DEFAULTS);
    expect(rest).toEqual([]);
    expect(line[0]).toEqual(points[0]);
    expect(line[line.length - 1]).toEqual(points[100]);
    expect(line.length).toBe(9);
  });

  it('coupe la ligne là où la trace saute (trajet en pause)', () => {
    const points = [at(0, 0), at(10, 0), at(20, 0), at(2000, 0), at(2010, 0)];
    const lines = queryLines(points, WAY_MATCH_DEFAULTS);
    expect(lines).toHaveLength(2);
    expect(lines[0][lines[0].length - 1]).toEqual(points[2]);
    expect(lines[1]).toEqual([points[3], points[4]]);
  });
});

describe('voie de chaque point', () => {
  it('prend la voie la plus proche, et aucune au-delà du rayon', () => {
    expect(matchTrackToWays([at(0, 1), at(0, 7.5), at(0, -40)], WAYS, WAY_MATCH_DEFAULTS)).toEqual([0, 1, -1]);
  });

  it('garde la voie du point précédent tant qu\'une autre n\'est pas nettement plus proche', () => {
    // Le GPS dérive de la route vers le trottoir : au-delà de la marge seulement, il en change.
    const points = [at(0, 1), at(10, 3.5), at(20, 5.5), at(30, 7.5), at(40, 8)];
    expect(matchTrackToWays(points, WAYS, WAY_MATCH_DEFAULTS)).toEqual([0, 0, 0, 1, 1]);
    expect(matchTrackToWays(points, WAYS, { ...WAY_MATCH_DEFAULTS, switchMarginM: 0 })).toEqual([0, 0, 1, 1, 1]);
  });

  it('trouve une voie dont les nœuds sont loin du point', () => {
    const long: OsmWay = { id: 9, tags: 'highway=track', geometry: [at(-5000, 3000), at(5000, -3000)] };
    expect(matchTrackToWays([at(0, 10)], [long], WAY_MATCH_DEFAULTS)).toEqual([0]);
  });
});

describe('revêtement d\'une trace', () => {
  const startMs = Date.UTC(2026, 9, 3, 15, 0, 0);
  /** 300 m vers l'est sur la route, puis 200 m vers le nord sur le sentier, à 3 m/s. */
  const raw = (hz: number): RawTrackPoint[] => {
    const points: RawTrackPoint[] = [];
    const n = Math.round((500 / 3) * hz);
    for (let i = 0; i <= n; i++) {
      const d = (3 * i) / hz;
      const p = d <= 300 ? at(d, 1) : at(299, d - 300);
      points.push({ ...p, time: new Date(startMs + (i * 1000) / hz).toISOString() });
    }
    return points;
  };

  it('date les morceaux depuis le premier point, et donne le même revêtement à 1 Hz et à 5 Hz', () => {
    const totals = (hz: number) => {
      const track = computeKinematics(raw(hz));
      const { startMs: origin, surfaces } = trackSurfaceRuns(track, WAYS, WAY_MATCH_DEFAULTS);
      expect(origin).toBe(startMs);
      expect(surfaces.runs[0][0]).toBe(0);
      return summarizeSurfaces(trackSurfaceStretches(track, surfaces, origin));
    };
    const at1 = totals(1);
    const at5 = totals(5);
    expect(at1.map((t) => t.category)).toEqual(['asphalte', 'terre']);
    // Au coin, la route est gardée tant que le sentier n'est pas plus proche de la marge : quelques mètres.
    expect(Math.abs(at1[0].distanceM - 300)).toBeLessThan(15);
    expect(Math.abs(at1[1].distanceM - 200)).toBeLessThan(15);
    at5.forEach((t, i) => {
      expect(t.category).toBe(at1[i].category);
      expect(t.distanceM).toBeCloseTo(at1[i].distanceM, -1);
    });
  });
});
