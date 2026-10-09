import { useEffect, useMemo, useState } from 'react';
import type { TrackPoint } from '../core/types';
import type { SessionSurfaces } from '../library/record';
import { fetchWays } from '../planning/overpass';
import {
  summarizeSurfaces, surfacePaths, trackSurfaceStretches, type SurfacePath, type SurfaceStretch, type SurfaceTotal,
} from '../planning/surface';
import { WAY_MATCH_DEFAULTS, WAY_MATCH_VERSION, queryLines, trackSurfaceRuns } from '../planning/wayMatch';
import { findLibrarySession, librarySession, updateSessionRecord, useSessionLibrary } from './useSessionLibrary';

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
const found = new Map<number, SessionSurfaces>();
/** Recherches en cours, par instant du premier point : une seule par trace. */
const searching = new Map<number, Promise<SessionSurfaces>>();

const search = (track: ReadonlyArray<TrackPoint>): Promise<SessionSurfaces> => {
  const startMs = track[0].timeMs;
  let pending = searching.get(startMs);
  if (!pending) {
    pending = fetchWays(queryLines(track, WAY_MATCH_DEFAULTS), WAY_MATCH_DEFAULTS.radiusM)
      .then((ways) => {
        const matched = trackSurfaceRuns(track, ways, WAY_MATCH_DEFAULTS);
        const surfaces: SessionSurfaces = {
          source: 'overpass',
          fetchedAt: new Date().toISOString(),
          matchVersion: WAY_MATCH_VERSION,
          startMs: matched.startMs,
          ...matched.surfaces,
        };
        found.set(startMs, surfaces);
        return surfaces;
      })
      .finally(() => searching.delete(startMs));
    searching.set(startMs, pending);
  }
  return pending;
};

/** Range les voies dans la fiche, si la session est dans la mémoire et que sa fiche peut être réécrite. */
const store = (file: string | null, surfaces: SessionSurfaces): void => {
  const session = file !== null ? librarySession(file) : undefined;
  if (session && !session.readOnly) updateSessionRecord(session.file, { surfaces });
};

const isCurrent = (surfaces: SessionSurfaces | undefined): surfaces is SessionSurfaces =>
  surfaces !== undefined && surfaces.matchVersion >= WAY_MATCH_VERSION;

export type SurfaceSearchStatus = 'idle' | 'searching' | 'error' | 'ready';

export const useSessionSurfaces = (track: TrackPoint[], file: string | null, active: boolean) => {
  const { sessions } = useSessionLibrary();
  const session = findLibrarySession(sessions, file);
  const startMs = track.length > 1 ? track[0].timeMs : null;
  const stored = session?.record.surfaces;
  // Fiche allégée, pas encore relue en entier : ses voies rangées ne sont pas encore connues.
  const partial = session?.partial === true;
  const [, setFoundCount] = useState(found.size);
  const [error, setError] = useState<{ startMs: number; message: string } | null>(null);

  const local = startMs !== null ? found.get(startMs) : undefined;
  const surfaces = isCurrent(stored) ? stored : local;
  const failed = error !== null && error.startMs === startMs ? error.message : null;

  // Voies trouvées avant que la bibliothèque connaisse la session : rangées dès qu'elle la connaît.
  useEffect(() => {
    if (local && !isCurrent(stored) && session && !session.readOnly && !partial) store(session.file, local);
  }, [local, stored, session, partial]);

  useEffect(() => {
    if (!active || surfaces || failed !== null || startMs === null || partial) return;
    search(track).then(
      (result) => {
        store(file, result);
        setFoundCount(found.size);
      },
      (err: unknown) => setError({ startMs, message: err instanceof Error ? err.message : 'Recherche des voies impossible.' })
    );
  }, [active, surfaces, failed, startMs, track, file, partial]);

  const retry = () => setError(null);

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
