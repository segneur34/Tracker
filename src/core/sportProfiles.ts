import type { JumpDetection } from './jumps';
import type { SportType, TopTarget } from './types';
import type { SpeedUnit } from './units';

/**
 * Profil d'un support. Regroupe tout ce qui varie d'une activité à l'autre :
 * unité d'affichage, seuils d'activité, fenêtres de filtrage, cibles de
 * meilleurs segments.
 *
 * Aucune de ces valeurs n'est figée dans le code de calcul. Le profil ne
 * fournit qu'un défaut : la valeur réellement utilisée est passée en paramètre
 * aux fonctions, et l'utilisateur peut la surcharger à tout moment.
 */

/** Réglage du calcul de dénivelé. */
export interface ElevationProfile {
  /** Lissage passe-bas de l'altitude avant tout cumul, en secondes. */
  smoothingSeconds: number;
  /**
   * Écart minimal, en mètres, entre un creux local et l'altitude courante pour
   * qu'une montée soit comptabilisée. Sans ce seuil, le bruit de l'altitude
   * GPS suffit à doubler le dénivelé réel.
   */
  minGainM: number;
}

/**
 * Retour d'une boucle qui évite l'aller : au plus 1,5 fois l'aller, choix de
 * l'utilisateur (06/10/2026, §10, point 87).
 */
export const DEFAULT_LOOP_RETURN_MAX_RATIO = 1.5;
/** Bornes du réglage du retour de boucle, en fois l'aller. */
export const LOOP_RETURN_RATIO_RANGE = { min: 1, max: 3 } as const;

/**
 * Deux terrains, deux réglages. Le parcours roulant demande un seuil bas pour
 * ne pas effacer les faux plats, le terrain accidenté demande un seuil haut
 * pour absorber le bruit.
 */
/** Pas proposés pour l'altitude du terrain, en mètres. */
export const TERRAIN_STEP_CHOICES_M = [5, 10, 20] as const;

export const ELEVATION_PRESETS: Record<'route' | 'trail', ElevationProfile> = {
  route: { smoothingSeconds: 20, minGainM: 3 },
  trail: { smoothingSeconds: 30, minGainM: 5 },
};

/**
 * Réglage de l'enregistrement GPS sur téléphone. L'enregistreur ne filtre
 * rien : il demande au système une position par intervalle et garde tout ce
 * qui arrive, l'intelligence restant dans le pipeline d'analyse.
 */
export interface RecordingProfile {
  /** Intervalle demandé entre deux positions, en millisecondes. */
  intervalMs: number;
  /** Déplacement minimal avant une nouvelle position, en mètres ; 0 n'en impose aucun. */
  distanceFilterM: number;
  /**
   * Écart de temps de trace, en secondes, au-delà duquel les positions reçues
   * sont écrites dans le journal. C'est la perte maximale en cas d'arrêt brutal.
   */
  journalFlushS: number;
  /**
   * Vitesse système en dessous de laquelle une immobilité prolongée déclenche
   * la pause automatique, en m/s ; 0 la désactive.
   */
  autoPauseSpeedMs: number;
  /** Temps réel, en secondes, sous ce seuil avant que la pause se déclenche. */
  autoPauseDelayS: number;
}

/**
 * Identique pour tous les supports au départ : 1 Hz, sans filtre de distance.
 * Le 1 Hz tient aussi le coût du recalcul du vent (`docs/HISTORIQUE.md`, point 23).
 * Pause automatique sous 0,3 m/s (environ 1 km/h, sous le bruit GPS au repos)
 * pendant 60 s.
 */
export const DEFAULT_RECORDING: RecordingProfile = {
  intervalMs: 1000,
  distanceFilterM: 0,
  journalFlushS: 10,
  autoPauseSpeedMs: 0.3,
  autoPauseDelayS: 60,
};

/**
 * Fractionné : pause automatique coupée, un repos immobile de plus de 60 s
 * couperait la trace (§10, point 89). Le délai reste, pour qui la rallume.
 */
const INTERVAL_RECORDING: RecordingProfile = { ...DEFAULT_RECORDING, autoPauseSpeedMs: 0 };

/**
 * Répétitions retrouvées dans la vitesse d'une session faite sans le compteur
 * (`running/intervalDetection.ts`). Le seuil d'effort, lui, est tiré de la
 * session, et se surcharge par session (`SessionAnalysis.effortThresholdMs`).
 */
export interface IntervalDetectionProfile {
  /** Pas de lecture de la vitesse sur la distance cumulée, en secondes. */
  stepS: number;
  /** Lissage de la vitesse avant la recherche des efforts, en secondes. */
  smoothingS: number;
  /** On sort d'un effort sous le seuil diminué de cette fraction (hystérésis). */
  exitFraction: number;
  /** Effort plus court écarté, en secondes. */
  minWorkS: number;
  /** Effort plus court que cette part de la durée médiane de sa séance écarté (accélération d'échauffement). */
  minWorkFraction: number;
  /** Creux plus court fondu dans l'effort qui l'entoure, en secondes. */
  minDipS: number;
  /** Recherche du creux de vitesse qui précède un effort, d'où il part, en secondes. */
  launchSearchS: number;
  /**
   * Rapport minimal entre la vitesse moyenne des efforts et celle du reste ;
   * en dessous, la session n'a pas l'allure d'un fractionné.
   */
  minContrast: number;
  /**
   * Rapport à partir duquel les rapides se séparent encore en deux (footing
   * d'approche et efforts) : le seuil monte alors entre eux. Plus haut que
   * `minContrast`, pour ne pas couper entre deux allures d'effort.
   */
  upperContrast: number;
  /** Repos minimal qui ouvre une nouvelle séance (10/10 puis 20/20), en secondes. */
  blockMinGapS: number;
  /** …et en fois le repos médian de la session. */
  blockGapFactor: number;
}

/** Sauts mesurés par les capteurs du téléphone (voile, `core/jumps.ts`). */
export interface JumpProfile {
  /** Hauteur minimale d'un saut montré, en mètres, surchargeable par activité. */
  defaultMinHeightM: number;
  detection: JumpDetection;
}

/**
 * Détection et mesure des sauts, communes aux supports qui sautent. Réglées sur
 * les séances de wingfoil du 08/10/2026, téléphone sur la poitrine : la séance
 * témoin ne donne aucun vol de 0,2 m, l'autre ses 10 sauts (0,66 à 1,72 m) et
 * rien d'autre au-dessus de 0,33 m. Les longs vols du kite restent à vérifier
 * sur une séance de kite.
 */
const JUMP_DETECTION: JumpDetection = {
  gridStepS: 0.01, maxGapS: 0.05,
  calmForceFraction: 0.15, calmRotationRadS: 0.3, minCalmS: 1,
  attitudeTauS: 3, attitudeMaxRotationRadS: 1.5, attitudeInitS: 1,
  smoothingS: 0.1, pushG: 0.4, pushSearchS: 0.5, landingG: 0.3, edgeSearchS: 0.05,
  minFlightS: 0.2, maxFlightS: 8, minFallG: 0.2, biasWindowS: 10,
  keepMinFlightS: 0.4, keepMinHeightM: 0.2,
  pruneMinFlightS: 0.4, pruneMinHeightM: 0.15, pruneMarginS: 15, pruneChunkS: 300, pruneChunkMarginS: 20,
  dubiousBallisticFactor: 1.1, saturationFraction: 0.98, doubtMarginS: 2, attitudeMaxErrorM: 0.1,
  curveStepS: 0.05, curveMarginS: 0.5,
};

/** Libellé du ratio de temps actif d'une session sur foil, quel que soit le calcul. */
export const FOIL_RATIO_LABEL = 'Ratio de vol';

/** Analyse des répétitions (fractionné, §10, point 89). */
export interface IntervalProfile {
  /** Pas du profil de vitesse d'une répétition, en secondes. */
  profileStepS: number;
  /** Fin de la mise en vitesse : la répétition atteint cette part de sa vitesse. */
  launchFraction: number;
  detection: IntervalDetectionProfile;
}

/**
 * Commun à pied et à vélo : seuils relatifs et durées, aucun en vitesse
 * absolue. Efforts de 3 s au moins : sur une trace Komoot, un 10/10 ne montre
 * que 3 à 6 s de points rapides, le reste tombant dans le long segment de la
 * récupération (essai du 08/10).
 */
const INTERVAL_ANALYSIS: IntervalProfile = {
  profileStepS: 1,
  launchFraction: 0.9,
  detection: {
    stepS: 1, smoothingS: 3, exitFraction: 0.05, minWorkS: 3, minWorkFraction: 0.4, minDipS: 5, launchSearchS: 8,
    minContrast: 1.25, upperContrast: 1.4, blockMinGapS: 60, blockGapFactor: 3,
  },
};

export interface SportProfile {
  id: SportType;
  label: string;
  /** Unité d'affichage principale des vitesses. */
  speedUnit: SpeedUnit;
  /** Unité dans laquelle le seuil d'activité est saisi, stocké et comparé. */
  thresholdUnit: SpeedUnit;
  /**
   * Seuil séparant « en action » de « à l'arrêt », exprimé dans `thresholdUnit`.
   * Selon l'activité il correspond au début de vol, au début de planing ou à
   * la sortie de l'arrêt : ces notions ne se recouvrent pas, d'où un réglage
   * par support.
   */
  defaultActiveThreshold: number;
  /**
   * Écarts appliqués au seuil pour obtenir les deux détentes.
   * Démarrage au-dessus de seuil + `enterOffset`, arrêt en dessous de
   * seuil + `exitOffset`, ce dernier étant négatif.
   */
  activeHysteresis: { enterOffset: number; exitOffset: number };
  /** Durée de confirmation avant tout changement d'état d'activité, en secondes. */
  minStateDurationS: number;
  /** Largeur du filtre médian appliqué à la vitesse, en secondes. */
  medianWindowSeconds: number;
  /**
   * Vitesse maximale physiquement plausible pour ce support, en m/s. Au-delà,
   * c'est une aberration GPS, quelle que soit l'accélération qui y mène.
   */
  maxPlausibleSpeedMs: number;
  /** Vitesse minimale, dans `thresholdUnit`, pour qu'un point alimente le diagramme polaire. */
  defaultPolarMinSpeed: number;
  /**
   * Libellé du ratio de temps actif, propre au vocabulaire du support, hors
   * foil : sur foil, c'est `FOIL_RATIO_LABEL` (`activeRatioLabel`).
   */
  activeRatioLabel: string;
  /**
   * Support sur foil par défaut. Surchargeable par activité (Réglages) et par
   * session (onglet réglages de l'analyse) ; sans objet hors voile.
   */
  foilDefault: boolean;
  /** Réglage du dénivelé. */
  elevation: ElevationProfile;
  /**
   * Pas des échantillons d'altitude du terrain (IGN), en mètres, surchargeable
   * par activité ; `null` : pas d'altitude du terrain (voile).
   */
  terrainElevationStepM: number | null;
  /**
   * Mode « Boucle » de la planification : longueur maximale du retour qui
   * évite l'aller, en fois l'aller ; au-delà, le retour le plus court.
   * Surchargeable par activité ; `null` : pas de boucle (voile, fractionné, qui ne planifie pas).
   */
  loopReturnMaxRatio: number | null;
  /** Cibles de recherche des meilleurs segments. */
  topTargets: TopTarget[];
  /** Réglage de l'enregistrement GPS. */
  recording: RecordingProfile;
  /**
   * Analyse des répétitions du compteur, et leur détection en famille
   * Fractionné ; `null` en voile, où le compteur ne sert pas.
   */
  intervals: IntervalProfile | null;
  /** Sauts mesurés par les capteurs du téléphone ; `null` hors voile et en bateau. */
  jumps: JumpProfile | null;
}

/** Cibles de tops utilisées par tous les supports à voile. */
export const SAILING_TOP_TARGETS: TopTarget[] = [
  { key: 't2s', label: '2 s', value: 2, kind: 'time' },
  { key: 't5s', label: '5 s', value: 5, kind: 'time' },
  { key: 't10s', label: '10 s', value: 10, kind: 'time' },
  { key: 'd100m', label: '100 m', value: 100, kind: 'distance' },
  { key: 'd500m', label: '500 m', value: 500, kind: 'distance' },
  { key: 'd1000m', label: '1000 m', value: 1000, kind: 'distance' },
  { key: 'd1NM', label: '1 mille', value: 1852, kind: 'distance' },
];

/** Cibles de tops du vélo : les durées des tests d'effort, les distances des segments usuels. */
export const CYCLING_TOP_TARGETS: TopTarget[] = [
  { key: 't1min', label: '1 min', value: 60, kind: 'time' },
  { key: 't5min', label: '5 min', value: 300, kind: 'time' },
  { key: 't20min', label: '20 min', value: 1200, kind: 'time' },
  { key: 't60min', label: '1 h', value: 3600, kind: 'time' },
  { key: 'd1km', label: '1 km', value: 1000, kind: 'distance' },
  { key: 'd5km', label: '5 km', value: 5000, kind: 'distance' },
  { key: 'd10km', label: '10 km', value: 10000, kind: 'distance' },
  { key: 'd20km', label: '20 km', value: 20000, kind: 'distance' },
  { key: 'd40km', label: '40 km', value: 40000, kind: 'distance' },
];

/** Réglages communs aux supports à voile, surchargés au cas par cas. */
const SAILING_DEFAULTS = {
  speedUnit: 'kn' as SpeedUnit,
  thresholdUnit: 'kn' as SpeedUnit,
  activeHysteresis: { enterOffset: 0.5, exitOffset: -1 },
  minStateDurationS: 0,
  medianWindowSeconds: 3,
  // 30 m/s font 58 nœuds : hors de portée en session ordinaire.
  maxPlausibleSpeedMs: 30,
  defaultPolarMinSpeed: 5,
  elevation: ELEVATION_PRESETS.route,
  terrainElevationStepM: null,
  loopReturnMaxRatio: null,
  topTargets: SAILING_TOP_TARGETS,
  recording: DEFAULT_RECORDING,
  intervals: null,
  foilDefault: false,
};

const RUNNING_PROFILE: SportProfile = {
  id: 'running',
  label: 'Course à pied',
  speedUnit: 'minkm',
  thresholdUnit: 'kmh',
  // Reprise au-dessus de 4 km/h, pause en dessous de 2 km/h, confirmée sur 3 s.
  defaultActiveThreshold: 3,
  activeHysteresis: { enterOffset: 1, exitOffset: -1 },
  minStateDurationS: 3,
  medianWindowSeconds: 5,
  // 12 m/s font 43 km/h, au-delà du sprint humain.
  maxPlausibleSpeedMs: 12,
  defaultPolarMinSpeed: 0,
  activeRatioLabel: 'Ratio en mouvement',
  elevation: ELEVATION_PRESETS.route,
  terrainElevationStepM: 10,
  loopReturnMaxRatio: DEFAULT_LOOP_RETURN_MAX_RATIO,
  // Les cibles de tops running restent à définir avec les métriques du module.
  topTargets: [],
  recording: DEFAULT_RECORDING,
  intervals: INTERVAL_ANALYSIS,
  foilDefault: false,
  jumps: null,
};

const CYCLING_PROFILE: SportProfile = {
  id: 'cycling',
  label: 'Vélo',
  speedUnit: 'kmh',
  thresholdUnit: 'kmh',
  // Reprise au-dessus de 6 km/h, pause en dessous de 3 km/h, confirmée sur 3 s.
  defaultActiveThreshold: 5,
  activeHysteresis: { enterOffset: 1, exitOffset: -2 },
  minStateDurationS: 3,
  medianWindowSeconds: 3,
  // 25 m/s font 90 km/h, au-delà d'une descente de col ordinaire.
  maxPlausibleSpeedMs: 25,
  defaultPolarMinSpeed: 0,
  activeRatioLabel: 'Ratio en mouvement',
  elevation: ELEVATION_PRESETS.route,
  terrainElevationStepM: 10,
  loopReturnMaxRatio: DEFAULT_LOOP_RETURN_MAX_RATIO,
  topTargets: CYCLING_TOP_TARGETS,
  recording: DEFAULT_RECORDING,
  intervals: INTERVAL_ANALYSIS,
  foilDefault: false,
  jumps: null,
};

export const SPORT_PROFILES: Record<SportType, SportProfile> = {
  wingfoil: {
    ...SAILING_DEFAULTS,
    id: 'wingfoil',
    label: 'Wingfoil',
    defaultActiveThreshold: 8,
    // Sans foil (case décochée), un wing se dit « en navigation » ; sur foil, « Ratio de vol ».
    activeRatioLabel: 'Ratio de navigation',
    foilDefault: true,
    jumps: { defaultMinHeightM: 0.5, detection: JUMP_DETECTION },
  },
  windsurf: {
    ...SAILING_DEFAULTS,
    id: 'windsurf',
    label: 'Planche à voile',
    defaultActiveThreshold: 10,
    activeRatioLabel: 'Ratio de planing',
    jumps: { defaultMinHeightM: 0.5, detection: JUMP_DETECTION },
  },
  kite: {
    ...SAILING_DEFAULTS,
    id: 'kite',
    label: 'Kitesurf',
    defaultActiveThreshold: 8,
    activeRatioLabel: 'Ratio de navigation',
    jumps: { defaultMinHeightM: 1, detection: JUMP_DETECTION },
  },
  bateau: {
    ...SAILING_DEFAULTS,
    id: 'bateau',
    label: 'Bateau',
    defaultActiveThreshold: 3,
    defaultPolarMinSpeed: 2,
    activeRatioLabel: 'Ratio de navigation',
    jumps: null,
  },
  running: RUNNING_PROFILE,
  cycling: CYCLING_PROFILE,
  // Fractionné : les calculs de la course et du vélo, sans pause automatique ni planification.
  'run-intervals': {
    ...RUNNING_PROFILE, id: 'run-intervals', label: 'Fractionné à pied', loopReturnMaxRatio: null, recording: INTERVAL_RECORDING,
  },
  'bike-intervals': {
    ...CYCLING_PROFILE, id: 'bike-intervals', label: 'Fractionné vélo', loopReturnMaxRatio: null, recording: INTERVAL_RECORDING,
  },
};

/** Supports dont l'analyse repose sur le vent. */
export const SAILING_SPORTS: SportType[] = ['wingfoil', 'windsurf', 'kite', 'bateau'];

export const getSportProfile = (sport: SportType): SportProfile => SPORT_PROFILES[sport];

/** Libellé du ratio de temps actif d'une session : « Ratio de vol » sur foil, sinon celui du calcul. */
export const activeRatioLabel = (profile: SportProfile, foil: boolean): string =>
  foil ? FOIL_RATIO_LABEL : profile.activeRatioLabel;

/**
 * Traitement d'un calcul : la façon dont ses sessions se calculent et
 * s'affichent (unités, énergie, vélo, altitude du terrain, chiffres du direct,
 * module d'analyse). À ne pas confondre avec la famille, qui les range.
 */
export type Treatment = 'voile' | 'course' | 'velo';

/**
 * Famille d'un calcul : où ses sessions se rangent (bibliothèque, accueil,
 * barre de navigation, listes d'activités, Réglages). Une famille de
 * traitement porte son nom ; « Fractionné » range des calculs traités à pied
 * ou à vélo (§10, point 89).
 */
export type SportFamily = Treatment | 'fractionne';

/** Les familles, dans l'ordre de l'interface. */
export const SPORT_FAMILIES: SportFamily[] = ['voile', 'course', 'velo', 'fractionne'];

const SPORT_TREATMENT: Record<SportType, Treatment> = {
  wingfoil: 'voile',
  windsurf: 'voile',
  kite: 'voile',
  bateau: 'voile',
  running: 'course',
  cycling: 'velo',
  'run-intervals': 'course',
  'bike-intervals': 'velo',
};

const SPORT_FAMILY: Record<SportType, SportFamily> = {
  ...SPORT_TREATMENT,
  'run-intervals': 'fractionne',
  'bike-intervals': 'fractionne',
};

export const sportTreatment = (sport: SportType): Treatment => SPORT_TREATMENT[sport];

export const sportFamily = (sport: SportType): SportFamily => SPORT_FAMILY[sport];

/** Calculs d'une famille, dans l'ordre de `SPORT_PROFILES`. */
export const familySports = (family: SportFamily): SportType[] =>
  (Object.keys(SPORT_PROFILES) as SportType[]).filter((sport) => SPORT_FAMILY[sport] === family);

/** Les deux détentes du seuil d'activité, dans l'unité du profil. */
export const getActiveThresholds = (
  profile: SportProfile,
  threshold: number
): { enter: number; exit: number } => ({
  enter: threshold + profile.activeHysteresis.enterOffset,
  exit: Math.max(0, threshold + profile.activeHysteresis.exitOffset),
});
