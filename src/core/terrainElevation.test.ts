import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from './sessionStats';
import { applyTerrainElevation, terrainSamplePoints, type TerrainSamples } from './terrainElevation';
import type { TrackPoint } from './types';

const START = Date.parse('2026-10-03T08:00:00Z');

/**
 * Trace vers l'est à vitesse constante, `hz` points par seconde, pendant
 * `seconds` secondes ; `stopAt` : un arrêt de `stopS` secondes à cet instant.
 */
const buildTrack = (hz: number, seconds: number, speedMs = 3, ele?: (s: number) => number, stop?: { atS: number; durationS: number }): TrackPoint[] => {
  const points: TrackPoint[] = [];
  const metersPerDegLon = 111_320 * Math.cos((43.6 * Math.PI) / 180);
  let x = 0;
  for (let i = 0; i <= seconds * hz; i++) {
    const s = i / hz;
    const stopped = stop !== undefined && s > stop.atS && s <= stop.atS + stop.durationS;
    const v = stopped ? 0 : speedMs;
    if (i > 0) x += v / hz;
    points.push({
      lat: 43.6,
      lon: 3.8 + x / metersPerDegLon,
      time: new Date(START + s * 1000).toISOString(),
      timeMs: START + s * 1000,
      ele: ele ? ele(s) : 100,
      speedMs: v,
      smoothedSpeedMs: v,
      bearing: 90,
      speedSource: 'doppler',
    });
  }
  return points;
};

const samplesOf = (track: TrackPoint[], stepM: number, z: (lon: number) => number | null): TerrainSamples => {
  const points = terrainSamplePoints(track, buildCumulativeTrack(track).cumDist, stepM);
  return { startMs: track[0].timeMs, t: points.map((p) => p.t), z: points.map((p) => z(p.lon)) };
};

describe('terrainSamplePoints', () => {
  it('prend un point tous les pas, premier et dernier compris', () => {
    const track = buildTrack(1, 100); // 300 m
    const cumDist = buildCumulativeTrack(track).cumDist;
    for (const stepM of [5, 10, 20]) {
      const points = terrainSamplePoints(track, cumDist, stepM);
      expect(points.length).toBe(300 / stepM + 1);
      expect(points[0].t).toBe(0);
      expect(points[points.length - 1].t).toBe(100_000);
      // 10 m à 3 m/s : un échantillon toutes les 3,33 s.
      expect(points[1].t).toBe(Math.round((stepM / 3) * 1000));
    }
  });

  it('donne les mêmes échantillons à 1 Hz et à 5 Hz', () => {
    const slow = buildTrack(1, 120);
    const fast = buildTrack(5, 120);
    const a = terrainSamplePoints(slow, buildCumulativeTrack(slow).cumDist, 10);
    const b = terrainSamplePoints(fast, buildCumulativeTrack(fast).cumDist, 10);
    expect(b.length).toBe(a.length);
    b.forEach((p, i) => {
      expect(p.t).toBe(a[i].t);
      expect(p.lon).toBeCloseTo(a[i].lon, 8);
    });
  });

  it("ne prend rien pendant un arrêt", () => {
    const track = buildTrack(1, 100, 3, undefined, { atS: 30, durationS: 40 });
    const points = terrainSamplePoints(track, buildCumulativeTrack(track).cumDist, 10);
    // 60 s en mouvement : 180 m, soit 18 pas, plus le premier point.
    expect(points.length).toBe(19);
    expect(points.some((p) => p.t > 30_000 && p.t < 70_000)).toBe(false);
  });

  it("rend une liste vide pour un pas nul ou une trace vide", () => {
    expect(terrainSamplePoints([], [], 10)).toEqual([]);
    const track = buildTrack(1, 10);
    expect(terrainSamplePoints(track, buildCumulativeTrack(track).cumDist, 0)).toEqual([]);
  });
});

describe('applyTerrainElevation', () => {
  // Terrain : une pente de 5 % vers l'est, mesurée sur la longitude.
  const metersPerDegLon = 111_320 * Math.cos((43.6 * Math.PI) / 180);
  const slope = (lon: number) => 50 + 0.05 * (lon - 3.8) * metersPerDegLon;

  it("remplace l'altitude GPS par celle du terrain, interpolée selon la distance", () => {
    const track = buildTrack(1, 100, 3, (s) => 150 + 10 * Math.sin(s));
    const cumDist = buildCumulativeTrack(track).cumDist;
    const { track: out, covered } = applyTerrainElevation(track, cumDist, samplesOf(track, 10, slope));
    expect(covered).toBe(true);
    out.forEach((p, i) => expect(p.ele).toBeCloseTo(50 + 0.05 * cumDist[i], 3));
    // Seule l'altitude change.
    expect(out[10].speedMs).toBe(track[10].speedMs);
    expect(out[10].lat).toBe(track[10].lat);
  });

  it('donne le même profil à 1 Hz et à 5 Hz', () => {
    const slow = buildTrack(1, 60);
    const fast = buildTrack(5, 60);
    const a = applyTerrainElevation(slow, buildCumulativeTrack(slow).cumDist, samplesOf(slow, 10, slope)).track;
    const b = applyTerrainElevation(fast, buildCumulativeTrack(fast).cumDist, samplesOf(fast, 10, slope)).track;
    a.forEach((p, i) => expect(b[i * 5].ele).toBeCloseTo(p.ele ?? NaN, 6));
  });

  it("garde une altitude constante pendant un arrêt", () => {
    const track = buildTrack(1, 100, 3, undefined, { atS: 30, durationS: 40 });
    const out = applyTerrainElevation(track, buildCumulativeTrack(track).cumDist, samplesOf(track, 10, slope)).track;
    const during = out.slice(31, 71).map((p) => p.ele);
    expect(Math.max(...(during as number[])) - Math.min(...(during as number[]))).toBeCloseTo(0, 6);
  });

  it("reprend l'altitude GPS hors couverture, décalée de l'écart médian", () => {
    // GPS 52 m au-dessus du terrain, terrain plat à 50 m ; la seconde moitié n'est pas couverte.
    const track = buildTrack(1, 100, 3, () => 102);
    const half = 3.8 + 150 / metersPerDegLon;
    const { track: out, covered } = applyTerrainElevation(
      track,
      buildCumulativeTrack(track).cumDist,
      samplesOf(track, 10, (lon) => (lon < half ? 50 : null))
    );
    expect(covered).toBe(true);
    out.forEach((p) => expect(p.ele).toBeCloseTo(50, 6));
  });

  it("rend la trace telle quelle si aucun point n'est couvert", () => {
    const track = buildTrack(1, 30, 3, () => 102);
    const { track: out, covered } = applyTerrainElevation(track, buildCumulativeTrack(track).cumDist, samplesOf(track, 10, () => null));
    expect(covered).toBe(false);
    out.forEach((p) => expect(p.ele).toBe(102));
  });

  it("donne une altitude aux points qui n'en avaient pas", () => {
    const track = buildTrack(1, 30).map((p) => ({ ...p, ele: undefined }));
    const out = applyTerrainElevation(track, buildCumulativeTrack(track).cumDist, samplesOf(track, 10, () => 50)).track;
    out.forEach((p) => expect(p.ele).toBe(50));
  });
});
