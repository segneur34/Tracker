import type { TrackPoint } from './types';

/**
 * Altitude du terrain (IGN, `planning/ignAltimetry.ts`) substituée à celle du
 * GPS, pour la course et le vélo. Le GPX n'est jamais réécrit : les
 * échantillons sont rangés dans la fiche de la session et appliqués à la
 * lecture, avant tout calcul d'altitude.
 *
 * Les échantillons sont pris tous les `stepM` mètres le long de la distance
 * retenue (règle 2 : une trace à 1 Hz et à 5 Hz donne les mêmes), et repérés
 * par leur instant, en millisecondes depuis le premier point : un changement
 * de filtre de vitesse ne les rend pas caducs.
 */

/** Version de l'échantillonnage : une fiche d'une version plus ancienne est redemandée. */
export const TERRAIN_ELEVATION_VERSION = 1;

/** Échantillons rangés : instants en ms depuis `startMs` (entiers, strictement croissants), altitudes en m, `null` hors couverture. */
export interface TerrainSamples {
  startMs: number;
  t: number[];
  z: (number | null)[];
}

/** Position à demander au service, avec son instant en ms depuis le premier point. */
export interface TerrainSamplePoint {
  lat: number;
  lon: number;
  t: number;
}

/**
 * Une position tous les `stepM` mètres de `cumDist` (distance cumulée de la
 * trace, `buildCumulativeTrack`), interpolée entre les deux points qui
 * l'encadrent, plus le premier et le dernier point. Un arrêt (distance qui
 * n'avance pas) ne donne pas d'échantillon.
 */
export const terrainSamplePoints = (
  track: ReadonlyArray<TrackPoint>,
  cumDist: ReadonlyArray<number>,
  stepM: number
): TerrainSamplePoint[] => {
  if (track.length === 0 || !(stepM > 0)) return [];
  const startMs = track[0].timeMs;
  const points: TerrainSamplePoint[] = [];
  const push = (lat: number, lon: number, timeMs: number) => {
    const t = Math.round(timeMs - startMs);
    if (points.length > 0 && t <= points[points.length - 1].t) return;
    points.push({ lat, lon, t });
  };
  push(track[0].lat, track[0].lon, startMs);
  let next = stepM;
  for (let i = 1; i < track.length; i++) {
    const d0 = cumDist[i - 1];
    const d1 = cumDist[i];
    while (d1 > d0 && next <= d1) {
      const f = (next - d0) / (d1 - d0);
      const a = track[i - 1];
      const b = track[i];
      push(a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon), a.timeMs + f * (b.timeMs - a.timeMs));
      next += stepM;
    }
  }
  const last = track[track.length - 1];
  push(last.lat, last.lon, last.timeMs);
  return points;
};

/** Médiane d'une liste non vide. */
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Trace dont l'altitude est celle du terrain : en chaque point, interpolée
 * selon la distance entre les deux échantillons qui l'encadrent (un arrêt
 * garde donc une altitude constante), la plus proche aux bords.
 *
 * Hors couverture (échantillon `null`), l'altitude GPS reprend, décalée de
 * l'écart médian terrain − GPS des points couverts : pas de marche à la
 * frontière, l'altitude GPS d'Android étant au-dessus de l'ellipsoïde.
 * `covered` est faux si aucun point n'est couvert : la trace est alors rendue
 * telle quelle.
 */
export const applyTerrainElevation = (
  track: ReadonlyArray<TrackPoint>,
  cumDist: ReadonlyArray<number>,
  samples: TerrainSamples
): { track: TrackPoint[]; covered: boolean } => {
  const n = samples.t.length;
  if (track.length === 0 || n === 0) return { track: [...track], covered: false };

  // Distance de chaque échantillon, lue sur la trace à son instant.
  const sampleDist: number[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const timeMs = samples.startMs + samples.t[k];
    while (j < track.length - 1 && track[j + 1].timeMs <= timeMs) j++;
    if (j >= track.length - 1 || timeMs <= track[j].timeMs) {
      sampleDist.push(cumDist[Math.min(j, track.length - 1)]);
    } else {
      const f = (timeMs - track[j].timeMs) / (track[j + 1].timeMs - track[j].timeMs);
      sampleDist.push(cumDist[j] + f * (cumDist[j + 1] - cumDist[j]));
    }
  }

  // Altitude du terrain en chaque point, `null` hors couverture.
  const terrain: (number | null)[] = [];
  let k = 0;
  for (let i = 0; i < track.length; i++) {
    const d = cumDist[i];
    while (k < n - 1 && sampleDist[k + 1] <= d) k++;
    const z0 = samples.z[k];
    if (k >= n - 1 || d <= sampleDist[k]) {
      terrain.push(z0);
      continue;
    }
    const z1 = samples.z[k + 1];
    const span = sampleDist[k + 1] - sampleDist[k];
    if (z0 === null || z1 === null) terrain.push(null);
    else terrain.push(span > 0 ? z0 + ((d - sampleDist[k]) / span) * (z1 - z0) : z0);
  }

  if (!terrain.some((z) => z !== null)) return { track: [...track], covered: false };

  const offsets: number[] = [];
  track.forEach((p, i) => {
    const z = terrain[i];
    if (z !== null && p.ele !== undefined && isFinite(p.ele)) offsets.push(z - p.ele);
  });
  const offset = offsets.length > 0 ? median(offsets) : 0;

  return {
    track: track.map((p, i) => {
      const z = terrain[i];
      if (z !== null) return { ...p, ele: z };
      return p.ele !== undefined && isFinite(p.ele) ? { ...p, ele: p.ele + offset } : p;
    }),
    covered: true,
  };
};

/** Altitudes rangées au centimètre. */
export const roundTerrainZ = (z: number | null): number | null => (z === null ? null : Math.round(z * 100) / 100);
