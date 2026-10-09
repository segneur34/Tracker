import { useEffect, useMemo, useState } from 'react';
import { TERRAIN_ELEVATION_VERSION, applyTerrainElevation, roundTerrainZ, terrainSamplePoints } from '../core/terrainElevation';
import type { TrackPoint } from '../core/types';
import type { SessionTerrainElevation } from '../library/record';
import { IGN_RESOURCE, fetchIgnElevations } from '../planning/ignAltimetry';
import { librarySession, updateSessionRecord, useLibrarySession } from './useSessionLibrary';

/**
 * Altitude d'une session course ou vélo : celle du terrain (IGN), demandée à
 * la première ouverture de l'analyse, une fois par trace et par pas, puis
 * rangée dans la fiche (`SessionRecord.terrainElevation`, hors brouillon : ce
 * n'est pas une saisie), ou celle du GPS si l'utilisateur la garde
 * (`elevationSource`, changée tout de suite, comme le support).
 *
 * Pendant la demande, en cas d'échec ou hors de la couverture de l'IGN, la
 * trace garde l'altitude du GPS. Une trace ouverte hors de la mémoire
 * (`file` à `null`) n'a pas de fiche : son altitude et sa source sont gardées
 * le temps du lancement.
 */

export type ElevationSource = 'ign' | 'gps';

/** Altitudes trouvées pendant ce lancement, par instant du premier point et pas. */
const found = new Map<string, SessionTerrainElevation>();
/** Demandes en cours, une seule par trace et par pas. */
const searching = new Map<string, Promise<SessionTerrainElevation>>();
/** Source choisie pour une trace hors de la mémoire, par instant du premier point. */
const localSources = new Map<number, ElevationSource>();

const cacheKey = (startMs: number, stepM: number) => `${startMs}|${stepM}`;

const search = (track: ReadonlyArray<TrackPoint>, cumDist: ReadonlyArray<number>, stepM: number): Promise<SessionTerrainElevation> => {
  const startMs = track[0].timeMs;
  const key = cacheKey(startMs, stepM);
  let pending = searching.get(key);
  if (!pending) {
    const points = terrainSamplePoints(track, cumDist, stepM);
    pending = fetchIgnElevations(points)
      .then((z) => {
        const terrain: SessionTerrainElevation = {
          source: 'ign',
          resource: IGN_RESOURCE,
          version: TERRAIN_ELEVATION_VERSION,
          stepM,
          fetchedAt: new Date().toISOString(),
          startMs,
          t: points.map((p) => p.t),
          z: z.map(roundTerrainZ),
        };
        found.set(key, terrain);
        return terrain;
      })
      .finally(() => searching.delete(key));
    searching.set(key, pending);
  }
  return pending;
};

/** Range l'altitude dans la fiche, si la session est dans la mémoire et que sa fiche peut être réécrite. */
const store = (file: string | null, terrain: SessionTerrainElevation): void => {
  const session = file !== null ? librarySession(file) : undefined;
  if (session && !session.readOnly) updateSessionRecord(session.file, { terrainElevation: terrain });
};

const isCurrent = (
  terrain: SessionTerrainElevation | undefined,
  startMs: number | null,
  stepM: number | null
): terrain is SessionTerrainElevation =>
  terrain !== undefined && terrain.startMs === startMs && terrain.stepM === stepM && terrain.version >= TERRAIN_ELEVATION_VERSION;

/**
 * `off` : altitude du GPS choisie ; `searching` : demande en cours ; `ready` :
 * altitude de l'IGN appliquée ; `outside` : aucun point couvert par l'IGN ;
 * `error` : demande échouée (`error` en dit la raison).
 */
export type TerrainElevationStatus = 'off' | 'searching' | 'error' | 'ready' | 'outside';

export const useTerrainElevation = (
  track: TrackPoint[],
  cumDist: number[],
  file: string | null,
  /** Pas des échantillons, en mètres ; `null` : pas d'altitude du terrain pour cette activité. */
  stepM: number | null
) => {
  const session = useLibrarySession(file);
  const startMs = track.length > 1 ? track[0].timeMs : null;
  const stored = session?.record.terrainElevation;
  // Fiche allégée, pas encore relue en entier : son altitude rangée n'est pas encore connue.
  const partial = session?.partial === true;
  const [, setFoundCount] = useState(found.size);
  const [, setLocalCount] = useState(0);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const source: ElevationSource = session
    ? session.record.elevationSource ?? 'ign'
    : (startMs !== null ? localSources.get(startMs) : undefined) ?? 'ign';
  const key = startMs !== null && stepM !== null ? cacheKey(startMs, stepM) : null;
  const local = key !== null ? found.get(key) : undefined;
  const terrain = isCurrent(stored, startMs, stepM) ? stored : local;
  const failed = error !== null && error.key === key ? error.message : null;
  const wanted = source === 'ign' && key !== null;

  // Altitude trouvée avant que la bibliothèque connaisse la session : rangée dès qu'elle la connaît.
  useEffect(() => {
    if (local && !isCurrent(stored, startMs, stepM) && session && !session.readOnly && !partial) store(session.file, local);
  }, [local, stored, startMs, stepM, session, partial]);

  useEffect(() => {
    if (!wanted || terrain || failed !== null || key === null || stepM === null || partial) return;
    search(track, cumDist, stepM).then(
      (result) => {
        store(file, result);
        setFoundCount(found.size);
      },
      (err: unknown) => setError({ key, message: err instanceof Error ? err.message : 'Altitude de l\'IGN indisponible.' })
    );
  }, [wanted, terrain, failed, key, track, cumDist, stepM, file, partial]);

  const retry = () => setError(null);

  /** Garde l'altitude du GPS ou revient à celle de l'IGN. */
  const setSource = (next: ElevationSource) => {
    if (session) {
      if (!session.readOnly) updateSessionRecord(session.file, { elevationSource: next === 'gps' ? 'gps' : null });
    } else if (startMs !== null) {
      localSources.set(startMs, next);
      setLocalCount((n) => n + 1);
    }
  };

  const applied = useMemo(
    () => (wanted && terrain ? applyTerrainElevation(track, cumDist, terrain) : null),
    [wanted, terrain, track, cumDist]
  );

  const status: TerrainElevationStatus = !wanted
    ? 'off'
    : applied
      ? applied.covered ? 'ready' : 'outside'
      : failed !== null ? 'error' : 'searching';
  return {
    /** Trace dont l'altitude est celle retenue : du terrain si elle est appliquée, sinon du GPS. */
    track: applied?.covered ? applied.track : track,
    status,
    source,
    setSource,
    /** Pas des échantillons appliqués, en mètres. */
    stepM: terrain?.stepM ?? stepM ?? 0,
    /** Faux pour une session dont la fiche ne peut être réécrite : la source ne peut changer. */
    canChangeSource: !session?.readOnly,
    error: failed,
    retry,
  };
};
