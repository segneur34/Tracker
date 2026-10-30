import { useMemo } from 'react';
import type { TrackPoint } from '../core/types';
import type { SessionSurfaces } from '../library/record';
import { fetchWays } from '../planning/overpass';
import {
  summarizeSurfaces, surfacePaths, trackSurfaceStretches, type SurfacePath, type SurfaceStretch, type SurfaceTotal,
} from '../planning/surface';
import { WAY_MATCH_DEFAULTS, WAY_MATCH_VERSION, queryLines, trackSurfaceRuns } from '../planning/wayMatch';
import { createSessionAssetCache, useSessionAsset } from './sessionAsset';

/**
 * Revêtement d'une session course ou vélo (onglet « surface », et roulement
 * de l'énergie à vélo) : les voies suivies sont demandées à OpenStreetMap la
 * première fois qu'on en a besoin (`active` : l'onglet s'ouvre, ou l'analyse
 * d'une session de vélo), une seule fois par trace, puis rangées dans la fiche
 * (`SessionRecord.surfaces`, hors brouillon : ce n'est pas une saisie).
 *
 * Une trace ouverte hors de la mémoire (`file` à `null`) n'a pas de fiche :
 * ses voies sont gardées le temps du lancement. La recherche va à son terme
 * même si l'on quitte la page : son résultat est rangé quand même.
 */

/** Voies trouvées pendant ce lancement, par instant du premier point de la trace. */
const cache = createSessionAssetCache<SessionSurfaces>();

const search = async (track: ReadonlyArray<TrackPoint>): Promise<SessionSurfaces> => {
  const ways = await fetchWays(queryLines(track, WAY_MATCH_DEFAULTS), WAY_MATCH_DEFAULTS.radiusM);
  const matched = trackSurfaceRuns(track, ways, WAY_MATCH_DEFAULTS);
  return {
    source: 'overpass',
    fetchedAt: new Date().toISOString(),
    matchVersion: WAY_MATCH_VERSION,
    startMs: matched.startMs,
    ...matched.surfaces,
  };
};

const isCurrent = (surfaces: SessionSurfaces | undefined): surfaces is SessionSurfaces =>
  surfaces !== undefined && surfaces.matchVersion >= WAY_MATCH_VERSION;

export type SurfaceSearchStatus = 'idle' | 'searching' | 'error' | 'ready';

export const useSessionSurfaces = (track: TrackPoint[], file: string | null, active: boolean) => {
  const startMs = track.length > 1 ? track[0].timeMs : null;
  const { value: surfaces, error: failed, retry } = useSessionAsset({
    cache, file, key: startMs !== null ? String(startMs) : null,
    isCurrent, active, compute: () => search(track), field: 'surfaces', errorText: 'Recherche des voies impossible.',
  });

  /**
   * Revêtement de chaque segment (pour l'énergie), longueurs par revêtement,
   * et tracé découpé par revêtement pour la carte.
   */
  const split: { stretches: SurfaceStretch[]; totals: SurfaceTotal[]; paths: SurfacePath[] } | null = useMemo(() => {
    if (!surfaces) return null;
    const stretches = trackSurfaceStretches(track, surfaces, surfaces.startMs);
    return { stretches, totals: summarizeSurfaces(stretches), paths: surfacePaths(track, stretches) };
  }, [track, surfaces]);
  const totals = split?.totals ?? null;

  // Onglet ouvert, sans voies ni échec : la recherche est lancée (ou le sera par l'effet).
  const status: SurfaceSearchStatus = totals ? 'ready' : failed !== null ? 'error' : active && startMs !== null ? 'searching' : 'idle';
  return { status, totals, stretches: split?.stretches ?? null, paths: split?.paths ?? null, error: failed, retry };
};
