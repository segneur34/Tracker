import { plainError } from '../platform/errorText';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { kinematicsProfileOf, prepareRawTrack, type PreparedTrack, type PrepareTrackOptions } from '../core/prepareTrack';
import type { KinematicsProfile } from '../core/sessionSpeed';
import { runInWorker } from '../library/trackWorkerClient';

/**
 * Ingestion générique d'une trace GPX. Aucune notion de sport ici : le hook
 * lit le fichier, calcule la kinématique et s'arrête là. Chaque module de
 * support construit ensuite ses propres statistiques par-dessus.
 *
 * Lecture et kinématique se font hors du fil de l'affichage (lot 126 B,
 * `core/prepareTrack.ts` dans `library/trackWorker.ts`) : le résultat arrive
 * d'un coup, avec les mêmes chiffres qu'en ligne. Le calcul garde la trace lue
 * sous la clé de la page (lot 235) : l'analyse qui suit (`useTrackAnalysis`)
 * la reprend sans la relire.
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
  /**
   * La trace lue est gardée par le calcul en arrière-plan pour l'analyse qui suit (`useTrackAnalysis`, lot 235), qui
   * la libère en quittant la page : la voile seule. Faux par défaut : rien n'est gardé.
   */
  keepForAnalysis?: boolean;
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
  /** Options de lecture qui ont donné `prepared` ; `null` sans trace. */
  options: PrepareTrackOptions | null;
  /** Numéro de la lecture qui a donné `prepared` dans la page (lot 235) ; `null` sans trace. */
  traceId: number | null;
}

/**
 * Trace d'où part l'analyse de la session ouverte (`useTrackAnalysis`, lot 235) : sa source, sa trace préparée, les
 * options exactes de sa lecture (l'analyse les redonne au calcul, qui reprend ainsi la trace gardée au lieu de la
 * relire), et la clé sous laquelle le calcul la garde.
 */
export interface AnalysisSource {
  from: GpxSource;
  prepared: PreparedTrack;
  prepare: PrepareTrackOptions;
  key: string;
  /** Numéro de la lecture : avec `key`, ce qui désigne la trace gardée par le calcul. */
  traceId: number;
}

/** Ce que l'analyse lit de la lecture : la clé de sa mémoire, la trace affichée, et si elle répond à la demande courante. */
export interface GpxAnalysisInput {
  /** Clé de la session dans la mémoire du calcul, propre à la page. */
  key: string;
  /** Trace affichée ; `null` : aucune (rien de lu, autre fichier en lecture, GPX illisible). */
  source: AnalysisSource | null;
  /** Faux tant que la même source se relit (allure, support) : la trace affichée n'est pas encore celle demandée. */
  settled: boolean;
}

interface GpxState {
  /** GPX demandé, `null` avant le premier. */
  source: GpxSource | null;
  shown: ShownGpx;
}

const NOTHING_SHOWN: ShownGpx = { from: null, fileName: null, error: null, prepared: null, options: null, traceId: null };

/** Trace affichée une fois la source préparée, avec les options de sa lecture ; moins de deux points horodatés : dit en clair. */
export const preparedState = (
  from: GpxSource, prepared: PreparedTrack, options: PrepareTrackOptions = {}, traceId = 0
): ShownGpx => ({
  from,
  fileName: from.fileName,
  error: prepared.pointCount < 2 ? 'Le fichier ne contient pas assez de points horodatés.' : null,
  prepared,
  options,
  traceId,
});

/** GPX illisible : l'erreur dite en clair, pas de trace. */
export const failedState = (from: GpxSource, err: unknown): ShownGpx => ({
  from,
  fileName: from.fileName,
  error: plainError(err, 'Lecture du fichier impossible.'),
  prepared: null,
  options: null,
  traceId: null,
});

/** Même fichier de la mémoire : une source relue sous le même nom (dossier rouvert) garde la trace affichée jusqu'au résultat. */
export const sameFile = (a: GpxSource, b: GpxSource): boolean => a === b || (a.fileName !== null && a.fileName === b.fileName);

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

/**
 * La trace affichée répond à la source et aux filtres demandés (lot 235) ; sans demande, rien n'attend. Faux pendant
 * qu'un autre fichier se lit, ou que la même source se relit pour une autre allure ou un autre support : l'analyse
 * montrée est alors dite en attente, et rien n'en est recopié dans la fiche.
 */
export const gpxSettled = (
  { source, shown }: GpxState, filters: KinematicsProfile | undefined, referenceSpeedOverrideMs: number | undefined
): boolean =>
  source === null
  || (shown.from === source && (shown.options === null
    || (shown.options.profile === filters && shown.options.referenceSpeedOverrideMs === referenceSpeedOverrideMs)));

export const useGpxSession = (kinematicsOptions: GpxSessionOptions = {}) => {
  const [state, setState] = useState<GpxState>({ source: null, shown: NOTHING_SHOWN });
  const { profile, referenceSpeedOverrideMs, keepForAnalysis = false } = kinematicsOptions;
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

  /** Clé de la session dans la mémoire du calcul : la trace lue y est gardée pour l'analyse qui suit (`useTrackAnalysis`). */
  const analysisKey = useId();
  /** Numéro de la dernière lecture lancée : chaque lecture garde sa trace sous un numéro à elle. */
  const traceSeq = useRef(0);

  /**
   * Lecture et kinématique de la source, hors du fil de l'affichage. Le
   * résultat est posé d'un coup ; celui d'une demande dépassée (autre fichier,
   * autre allure, page quittée) est jeté (`alive`).
   */
  useEffect(() => {
    if (source === null) return;
    let alive = true;
    const options: PrepareTrackOptions = { fileName: source.fileName, profile: filters, referenceSpeedOverrideMs };
    traceSeq.current += 1;
    const traceId = traceSeq.current;
    runInWorker('prepare', source.text, keepForAnalysis ? { ...options, analysisKey, traceId } : options).then(
      (prepared) => {
        if (alive) setState((s) => (s.source === source ? { source, shown: preparedState(source, prepared, options, traceId) } : s));
      },
      (err: unknown) => {
        if (alive) setState((s) => (s.source === source ? { source, shown: failedState(source, err) } : s));
      }
    );
    return () => {
      alive = false;
    };
  }, [source, filters, referenceSpeedOverrideMs, analysisKey, keepForAnalysis]);

  /** Trace affichée, telle que l'analyse la lit ; même objet tant qu'elle ne change pas. */
  const analysisSource = useMemo(
    (): AnalysisSource | null =>
      shown.from !== null && shown.prepared !== null && shown.options !== null && shown.traceId !== null
        ? { from: shown.from, prepared: shown.prepared, prepare: shown.options, key: analysisKey, traceId: shown.traceId }
        : null,
    [shown, analysisKey]
  );
  const settled = gpxSettled(state, filters, referenceSpeedOverrideMs);
  const analysis = useMemo(
    (): GpxAnalysisInput => ({ key: analysisKey, source: analysisSource, settled }),
    [analysisKey, analysisSource, settled]
  );

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
    /** Nombre de points du fichier, avant tout filtrage. */
    pointCount: prepared.pointCount,
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
    /** Ce que l'analyse de la session lit (`useTrackAnalysis`) : clé de sa mémoire, trace affichée, lecture à jour. */
    analysis,
    /** Trace sans point : celle que montre une page dont l'analyse n'est pas encore arrivée. */
    emptyPrepared: empty,
  };
};
