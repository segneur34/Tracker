import { describe, expect, it } from 'vitest';
import { cumulativeDistancesM } from '../core/geo';
import { IMPORT_MAX_OFFSET_M, applyImportedElevation, importedSamplePoints } from './importedElevation';
import { insertWaypoint, reverseRoute, routeFromTrack, routePoints, routeTotals, type PlannedRoute, type RoutePoint } from './route';

/** Altitude du terrain d'essai : monte d'un mètre tous les 11 m vers le nord (400 m sur les 0,04° de la trace). */
const terrainZ = (lat: number) => 200 + (lat - 43.6) * 10000;

/** Trace vers le nord le long de 3,8° E, un point tous les 0,001° (≈ 111 m), altitude du GPS bruitée autour de 100 m. */
const gpsTrack = (): RoutePoint[] =>
  Array.from({ length: 41 }, (_, i) => ({ lat: 43.6 + i * 0.001, lon: 3.8, eleM: 100 + (i % 2 === 0 ? 4 : -4) }));

const zOf = (samples: { lat: number }[], hole?: (lat: number) => boolean) =>
  samples.map((s) => (hole?.(s.lat) ? null : terrainZ(s.lat)));

const loaded = (): PlannedRoute => routeFromTrack(gpsTrack())!;

describe('échantillons demandés à l\'IGN', () => {
  it('un point tous les pas le long de la trace, premier et dernier compris', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    const points = routePoints(route);
    const length = cumulativeDistancesM(points).at(-1)!;
    expect(samples.length).toBe(Math.floor(length / 20) + 2);
    expect(samples[0]).toEqual({ lat: points[0].lat, lon: points[0].lon });
    expect(samples.at(-1)).toEqual({ lat: points.at(-1)!.lat, lon: points.at(-1)!.lon });
  });
});

describe('altitude de l\'IGN posée sur une trace chargée', () => {
  it('remplace l\'altitude du GPS en chaque point, interpolée entre les échantillons', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    const { route: out, covered } = applyImportedElevation(route, samples, zOf(samples));
    expect(covered).toBe(true);
    const points = routePoints(out);
    expect(points).toHaveLength(41);
    points.forEach((p) => expect(p.eleM!).toBeCloseTo(terrainZ(p.lat), 1));
    // Le GPS bruité (± 4 m) donne un D+ bien plus grand que la montée réelle de 400 m ; le terrain donne celle-là.
    expect(routeTotals(out, 3).gainM!).toBeCloseTo(400, 0);
    expect(routeTotals(out, 3).lossM!).toBeCloseTo(0, 0);
  });

  it('hors couverture, le point garde l\'altitude du GPS décalée de l\'écart médian', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    // Les points au-delà de 43,63° N sont hors couverture.
    const { route: out, covered } = applyImportedElevation(route, samples, zOf(samples, (lat) => lat > 43.63));
    expect(covered).toBe(true);
    const before = routePoints(route);
    const after = routePoints(out);
    const onTrack = before.flatMap((p, i) => (p.lat <= 43.63 - 0.0005 ? [i] : []));
    onTrack.forEach((i) => expect(after[i].eleM!).toBeCloseTo(terrainZ(before[i].lat), 1));
    // Les points hors couverture reçoivent tous le même décalage, pris parmi les écarts terrain − GPS des points couverts.
    const shifts = before.flatMap((p, i) => (p.lat > 43.63 + 0.0005 ? [after[i].eleM! - p.eleM!] : []));
    expect(shifts.length).toBeGreaterThan(5);
    shifts.forEach((d) => expect(d).toBeCloseTo(shifts[0], 6));
    const gaps = onTrack.map((i) => after[i].eleM! - before[i].eleM!);
    expect(shifts[0]).toBeGreaterThanOrEqual(Math.min(...gaps));
    expect(shifts[0]).toBeLessThanOrEqual(Math.max(...gaps));
  });

  it('rien de couvert : l\'itinéraire est rendu lui-même', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    const result = applyImportedElevation(route, samples, samples.map(() => null));
    expect(result.covered).toBe(false);
    expect(result.route).toBe(route);
  });

  it('un tronçon qui n\'est pas importé reste intact, un point loin de la trace aussi', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    const straight = {
      mode: 'straight' as const,
      status: 'ready' as const,
      points: [{ lat: 43.64, lon: 3.8, eleM: 55 }, { lat: 43.641, lon: 3.8, eleM: 56 }],
    };
    // 0,01° de longitude : près de 800 m de la trace, bien au-delà de l'écart toléré.
    const far: RoutePoint = { lat: 43.62, lon: 3.81, eleM: 77 };
    expect(0.01 * 111_000 * Math.cos(43.62 * Math.PI / 180)).toBeGreaterThan(IMPORT_MAX_OFFSET_M);
    const mixed: PlannedRoute = {
      waypoints: [...route.waypoints, { lat: 43.641, lon: 3.8 }],
      legs: [{ ...route.legs[0], points: [...route.legs[0].points, far] }, straight],
    };
    const { route: out } = applyImportedElevation(mixed, samples, zOf(samples));
    expect(out.legs[1]).toBe(straight);
    // Loin de la trace chargée, le point n'a pas l'altitude du terrain : il garde celle du GPS, décalée comme les points non couverts.
    const lastFar = out.legs[0].points.at(-1)!;
    expect({ lat: lastFar.lat, lon: lastFar.lon }).toEqual({ lat: far.lat, lon: far.lon });
    expect(lastFar.eleM!).toBeGreaterThan(far.eleM!);
    expect(Math.abs(lastFar.eleM! - terrainZ(far.lat))).toBeGreaterThan(10);
  });

  it('un tronçon coupé par un point garde les mêmes altitudes, posées avant ou après la coupe', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    const z = zOf(samples);
    const cut = insertWaypoint(route, 0, { lat: 43.6137, lon: 3.8 });
    expect(cut.legs).toHaveLength(2);
    const afterCut = applyImportedElevation(cut, samples, z).route;
    expect(afterCut.legs.every((l) => l.mode === 'imported')).toBe(true);
    // La coupe ajoute un point interpolé : il porte l'altitude du terrain à sa place.
    const cutPoints = routePoints(afterCut);
    expect(cutPoints).toHaveLength(42);
    cutPoints.forEach((p) => expect(p.eleM!).toBeCloseTo(terrainZ(p.lat), 1));
    // Poser l'altitude puis couper donne le même D+ que couper puis poser.
    const cutAfter = insertWaypoint(applyImportedElevation(route, samples, z).route, 0, { lat: 43.6137, lon: 3.8 });
    expect(routeTotals(cutAfter, 3).gainM).toBeCloseTo(routeTotals(afterCut, 3).gainM!, 1);
  });

  it('une trace parcourue à l\'envers reçoit la même altitude', () => {
    const route = loaded();
    const samples = importedSamplePoints(route, 20);
    const { route: out } = applyImportedElevation(reverseRoute(route), samples, zOf(samples));
    routePoints(out).forEach((p) => expect(p.eleM!).toBeCloseTo(terrainZ(p.lat), 1));
  });

  it('un aller-retour sur la même ligne reçoit l\'altitude du terrain aux deux passages', () => {
    const go = gpsTrack();
    const back = [...go].reverse().slice(1);
    const route = routeFromTrack([...go, ...back])!;
    const samples = importedSamplePoints(route, 20);
    const { route: out } = applyImportedElevation(route, samples, zOf(samples));
    // Au demi-tour, aucun échantillon ne tombe pile sur le point le plus au nord : l'écart tient au pas (1,8 m par pas de 20 m).
    routePoints(out).forEach((p) => expect(Math.abs(p.eleM! - terrainZ(p.lat))).toBeLessThan(1));
    expect(routeTotals(out, 3).gainM!).toBeGreaterThan(395);
  });

  it('un GPX sans altitude en reçoit une', () => {
    const route = routeFromTrack(gpsTrack().map(({ lat, lon }) => ({ lat, lon })))!;
    expect(routeTotals(route, 3).gainM).toBeNull();
    const samples = importedSamplePoints(route, 20);
    const { route: out } = applyImportedElevation(route, samples, zOf(samples));
    expect(routeTotals(out, 3).gainM!).toBeCloseTo(400, 0);
  });
});
