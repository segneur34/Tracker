import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import type { PlannedRoute, RouteLeg, RoutePoint, Waypoint } from './route';
import {
  placeLegPills, routeImageDescription, routeShareContent, routeShareStats, routeSurfaceBand, type PillRequest,
} from './routeShareImage';
import type { SurfaceRuns } from './surface';

const START: Waypoint = { lat: 43.5, lon: 3.9 };
/** Point à `northM` mètres au nord et `eastM` mètres à l'est du départ (à cette latitude, à 1 % près). */
const at = (northM: number, eastM = 0, eleM?: number): RoutePoint => ({
  lat: START.lat + northM / M_PER_DEG_LAT,
  lon: START.lon + eastM / (M_PER_DEG_LAT * Math.cos((START.lat * Math.PI) / 180)),
  ...(eleM !== undefined ? { eleM } : {}),
});

const straight = (from: RoutePoint, to: RoutePoint): RouteLeg => ({ mode: 'straight', status: 'ready', points: [from, to] });

/** Parcours de balises 1 → 2 → 3, droit au nord puis à l'est. */
const course = (looped = false): PlannedRoute => {
  const w = [at(0), at(1000), at(1000, 1000), ...(looped ? [at(0)] : [])];
  return { waypoints: w, legs: w.slice(1).map((to, i) => straight(w[i], to)) };
};

describe('image de partage d\'un itinéraire (lot 236)', () => {
  it('voile : balises numérotées, une pastille « distance · cap » par bord, la rose du nord', () => {
    const content = routeShareContent(course(), 'km', true);
    expect(content.marks.map((m) => `${m.label}:${m.role}`)).toEqual(['1:start', '2:mark', '3:end']);
    expect(content.pills.map((p) => `${p.from}→${p.to} ${p.text}`)).toEqual(['1→2 1,00 km · 0°', '2→3 1,00 km · 90°']);
    expect(content.north).toBe(true);
    // Pastille au milieu du bord.
    expect(content.pills[0].anchor.lat).toBeCloseTo(at(500).lat, 6);
  });

  it('voile, boucle : le départ porte l\'arrivée, une balise de moins', () => {
    const content = routeShareContent(course(true), 'nm', true);
    expect(content.marks.map((m) => `${m.label}:${m.role}`)).toEqual(['1:loop', '2:mark', '3:mark']);
    expect(content.pills.at(-1)?.to).toBe('1');
    const stats = routeShareStats(course(true), 'km', { markCourse: true, minGainM: 3, durationS: null });
    expect(stats.map((s) => `${s.label} ${s.value}`)).toEqual(['Distance 3,41 km', 'Balises 3', 'Plus long bord 1,41 km']);
  });

  it('à pied : le tracé, deux ronds sans numéro, ni pastille ni rose', () => {
    const content = routeShareContent(course(), 'km', false);
    expect(content.marks.map((m) => `${m.label}:${m.role}`)).toEqual([':start', ':end']);
    expect(content.pills).toEqual([]);
    expect(content.north).toBe(false);
    expect(routeShareContent(course(true), 'km', false).marks.map((m) => m.role)).toEqual(['loop']);
    expect(routeShareContent({ waypoints: [], legs: [] }, 'km', false).marks).toEqual([]);
  });

  it('à pied : distance, D+, D−, et le temps estimé seulement s\'il est connu', () => {
    const w = [at(0, 0, 10), at(2000, 0, 110)];
    const route: PlannedRoute = { waypoints: w, legs: [{ mode: 'route', status: 'ready', points: [w[0], at(1000, 0, 60), w[1]] }] };
    const without = routeShareStats(route, 'km', { markCourse: false, minGainM: 3, durationS: null });
    expect(without.map((s) => `${s.label} ${s.value}`)).toEqual(['Distance 2,00 km', 'D+ 100 m', 'D− 0 m']);
    const timed = routeShareStats(route, 'km', { markCourse: false, minGainM: 3, durationS: 1500 });
    expect(timed.at(-1)).toEqual({ key: 'duration', label: 'Temps estimé', value: '≈ 25 min' });
    // Lignes droites seules, sans altitude : « — ».
    expect(routeShareStats(course(), 'km', { markCourse: false, minGainM: 3, durationS: null })[1].value).toBe('—');
  });

  it('bande du revêtement : parts du bloc Surface, rien sans revêtement connu', () => {
    const points = [at(0), at(300), at(1000)];
    const surfaces: SurfaceRuns = { tags: ['highway=residential surface=asphalt', 'highway=track surface=gravel'], runs: [[0, 0], [1, 1]] };
    const route: PlannedRoute = { waypoints: [points[0], points[2]], legs: [{ mode: 'route', status: 'ready', points, surfaces }] };
    const band = routeSurfaceBand(route);
    expect(band?.map((p) => p.text)).toEqual(['Gravillon 70 %', 'Asphalte 30 %']);
    expect(band?.reduce((sum, p) => sum + p.fraction, 0)).toBeCloseTo(1, 9);
    // Lignes droites seules : tout « Inconnu », pas de bande à proposer.
    expect(routeSurfaceBand(course())).toBeNull();
    expect(routeSurfaceBand({ waypoints: [], legs: [] })).toBeNull();
  });

  it('texte de l\'image : titre, chiffres, bords, revêtement', () => {
    const content = routeShareContent(course(), 'km', true);
    const stats = routeShareStats(course(), 'km', { markCourse: true, minGainM: 3, durationS: null });
    expect(routeImageDescription('Aller du 20/11', 'Wing · itinéraire planifié', content, stats)).toBe(
      'Image de l\'itinéraire « Aller du 20/11 », Wing · itinéraire planifié : Distance 2,00 km, Balises 3, Plus long bord 1,00 km.'
      + ' Bords : 1 → 2 : 1,00 km · 0° ; 2 → 3 : 1,00 km · 90°.'
    );
  });

  it('pastilles : au milieu du bord si la place est libre, écartées d\'une balise, toujours dans le cadre', () => {
    const frame = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const pill = (x: number, y: number): PillRequest => ({ x, y, dx: 1, dy: 0, width: 100, height: 40 });
    expect(placeLegPills([pill(500, 500)], [], frame)).toEqual([{ x: 500, y: 500, width: 100, height: 40 }]);
    const pushed = placeLegPills([pill(500, 500)], [{ x: 500, y: 500, radius: 30 }], frame)[0];
    expect(Math.abs(pushed.y - 500)).toBeGreaterThanOrEqual(40);
    expect(pushed.x).toBe(500);
    const edge = placeLegPills([pill(10, 990)], [], frame)[0];
    expect(edge.x).toBe(50);
    expect(edge.y).toBe(980);
    // Deux pastilles au même endroit ne se chevauchent pas.
    const [a, b] = placeLegPills([pill(500, 500), pill(500, 500)], [], frame);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(40);
  });
});
