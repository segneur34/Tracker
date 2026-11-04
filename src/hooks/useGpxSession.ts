import { plainError } from '../platform/errorText';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { kinematicsProfileOf, prepareRawTrack, type PreparedTrack } from '../core/prepareTrack';
import type { KinematicsProfile } from '../core/sessionSpeed';
import { runInWorker } from '../library/trackWorkerClient';

/**
 * Ingestion générique d'une trace GPX. Aucune notion de sport ici : le hook
 * lit le fichier, calcule la kinématique et s'arrête là. Chaque module de
 * support construit ensuite ses propres statistiques par-dessus.
 *
 * Lecture et kinématique se font hors du fil de l'affichage (lot 126 B,
 * `core/prepareTrack.ts` dans `library/trackWorker.ts`) : le résultat arrive
 * d'un coup, avec les mêmes chiffres qu'en ligne.
 */

export interface GpxSessionOptions {
  /**
   * Profil du calcul de la session : ses filtres (`kinematicsOptionsOf`),
   * accordés en voile à l'allure de la session (`scalesFiltersToSession`),
   * comme le résumé de la bibliothèque. Absent : aucun filtre.
   */
  profile?: KinematicsProfile;
  /** Allure de session imposée par l'utilisateur, en m/s, au lieu de celle déduite. */
  referenceSpeedOverrideMs?: number;
}

/** GPX à lire : son texte, gardé tant que l'analyse est ouverte (un changement d'allure ou de support le relit), et son fichier. */
export interface GpxSource {
  text: string;
  fileName: string | null;
}

/** Trace affichée : celle d'une source préparée (`from`), ou aucune. */
export interface ShownGpx {
  /** Source dont vient la trace affichée ; `null` : aucune. */
  from: GpxSource | null;
  fileName: string | null;
  /** Message d'erreur de lecture, le cas échéant. */
  error: string | null;
  /** Trace préparée ; `null` : aucune (rien de lu, ou GPX illisible). */
  prepared: PreparedTrack | null;
}

interface GpxState {
  /** GPX demandé, `null` avant le premier. */
  source: GpxSource | null;
  shown: ShownGpx;
}

const NOTHING_SHOWN: ShownGpx = { from: null, fileName: null, error: null, prepared: null };

/** Trace affichée une fois la source préparée ; moins de deux points horodatés : dit en clair. */
export const preparedState = (from: GpxSource, prepared: PreparedTrack): ShownGpx => ({
  from,
  fileName: from.fileName,
  error: prepared.rawPoints.length < 2 ? 'Le fichier ne contient pas assez de points horodatés.' : null,
  prepared,
});

/** GPX illisible : l'erreur dite en clair, pas de trace. */
export const failedState = (from: GpxSource, err: unknown): ShownGpx => ({
  from,
  fileName: from.fileName,
  error: plainError(err, 'Lecture du fichier impossible.'),
  prepared: null,
});

/** Même fichier de la mémoire : une source relue sous le même nom (dossier rouvert) garde la trace affichée jusqu'au résultat. */
const sameFile = (a: GpxSource, b: GpxSource): boolean => a === b || (a.fileName !== null && a.fileName === b.fileName);

/**
 * Vrai quand un autre fichier que celui affiché se prépare : « Lecture de la
 * session… ». Faux quand la même source est relue (allure, support) : la
 * trace précédente reste affichée jusqu'au résultat.
 */
export const gpxReading = ({ source, shown }: GpxState): boolean =>
  source !== null && (shown.from === null || !sameFile(shown.from, source));

/**
 * Nouvelle source : un autre fichier efface la trace affichée, le même la garde ;
 * le même texte sous le même nom, redonné tel quel (GPX chargé à la main deux
 * fois), rend l'état inchangé : rien n'est relu.
 */
export const withSource = (state: GpxState, source: GpxSource): GpxState => {
  if (state.source !== null && state.source.text === source.text && state.source.fileName === source.fileName) return state;
  return {
    source,
    shown: state.shown.from !== null && sameFile(state.shown.from, source) ? state.shown : NOTHING_SHOWN,
  };
};

export const useGpxSession = (kinematicsOptions: GpxSessionOptions = {}) => {
  const [state, setState] = useState<GpxState>({ source: null, shown: NOTHING_SHOWN });
  const { profile, referenceSpeedOverrideMs } = kinematicsOptions;
  const { source, shown } = state;

  // Profil réduit aux champs des filtres, comparé par valeur : un autre objet aux mêmes filtres ne relit rien.
  const profileId = profile?.id;
  const medianWindowSeconds = profile?.medianWindowSeconds;
  const maxDetourRatio = profile?.maxDetourRatio;
  const maxPlausibleSpeedMs = profile?.maxPlausibleSpeedMs;
  const maxGapS = profile?.maxGapS;
  const filters = useMemo(
    () => (profileId === undefined || medianWindowSeconds === undefined || maxDetourRatio === undefined
      || maxPlausibleSpeedMs === undefined || maxGapS === undefined
      ? undefined
      : kinematicsProfileOf({ id: profileId, medianWindowSeconds, maxDetourRatio, maxPlausibleSpeedMs, maxGapS })),
    [profileId, medianWindowSeconds, maxDetourRatio, maxPlausibleSpeedMs, maxGapS]
  );

  /**
   * Lecture et kinématique de la source, hors du fil de l'affichage. Le
   * résultat est posé d'un coup ; celui d'une demande dépassée (autre fichier,
   * autre allure, page quittée) est jeté (`alive`).
   */
  useEffect(() => {
    if (source === null) return;
    let alive = true;
    runInWorker('prepare', source.text, { fileName: source.fileName, profile: filters, referenceSpeedOverrideMs }).then(
      (prepared) => {
        if (alive) setState((s) => (s.source === source ? { source, shown: preparedState(source, prepared) } : s));
      },
      (err: unknown) => {
        if (alive) setState((s) => (s.source === source ? { source, shown: failedState(source, err) } : s));
      }
    );
    return () => {
      alive = false;
    };
  }, [source, filters, referenceSpeedOverrideMs]);

  /** Trace vide, tant que rien n'est préparé : les mêmes valeurs qu'une trace sans point (allure imposée comprise). */
  const empty = useMemo(
    () => prepareRawTrack([], { trackName: null, hasDeviceSpeed: false }, { referenceSpeedOverrideMs }),
    [referenceSpeedOverrideMs]
  );
  const prepared = shown.prepared ?? empty;

  const loadGpxContent = useCallback((gpxContent: string, fileName: string | null = null) => {
    setState((s) => withSource(s, { text: gpxContent, fileName }));
  }, []);

  return {
    fileName: shown.fileName,
    trackName: prepared.trackName,
    rawPoints: prepared.rawPoints,
    /** Vrai si la vitesse vient de l'appareil (Doppler) et non des positions. */
    hasDeviceSpeed: prepared.hasDeviceSpeed,
    /** Message d'erreur de lecture, le cas échéant. */
    error: shown.error,
    track: prepared.track,
    /** Distance et temps cumulés le long de la trace, calculés une fois par trace pour tout le module. */
    cumulative: prepared.cumulative,
    /** Allure de la session, en m/s : déduite de la trace, ou imposée. */
    referenceSpeedMs: prepared.referenceSpeedMs,
    /** Intervalle médian entre deux points, en secondes : la cadence d'enregistrement. */
    samplingS: prepared.samplingS,
    /** Identité de la trace chargée : nom de trace et instant du premier point. Clé de remontage de la carte, et marque d'une nouvelle trace. */
    sessionKey: prepared.sessionKey,
    /** Unité dans laquelle le fichier exprime la vitesse de l'appareil, si elle existe. */
    deviceSpeedUnit: prepared.deviceSpeedUnit,
    /** Un autre fichier que celui affiché se prépare : « Lecture de la session… » (`useAnalysisSession`). */
    reading: gpxReading(state),
    loadGpxContent,
  };
};
