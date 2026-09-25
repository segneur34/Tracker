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
 * Deux terrains, deux réglages. Le parcours roulant demande un seuil bas pour
 * ne pas effacer les faux plats, le terrain accidenté demande un seuil haut
 * pour absorber le bruit.
 */
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
  /** Libellé du ratio de temps actif, propre au vocabulaire du support. */
  activeRatioLabel: string;
  /** Réglage du dénivelé. */
  elevation: ElevationProfile;
  /** Cibles de recherche des meilleurs segments. */
  topTargets: TopTarget[];
  /** Réglage de l'enregistrement GPS. */
  recording: RecordingProfile;
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
  topTargets: SAILING_TOP_TARGETS,
  recording: DEFAULT_RECORDING,
};

export const SPORT_PROFILES: Record<SportType, SportProfile> = {
  wingfoil: {
    ...SAILING_DEFAULTS,
    id: 'wingfoil',
    label: 'Wingfoil',
    defaultActiveThreshold: 8,
    activeRatioLabel: 'Ratio de vol',
  },
  windsurf: {
    ...SAILING_DEFAULTS,
    id: 'windsurf',
    label: 'Planche à voile',
    defaultActiveThreshold: 10,
    activeRatioLabel: 'Ratio de planing',
  },
  kite: {
    ...SAILING_DEFAULTS,
    id: 'kite',
    label: 'Kitesurf',
    defaultActiveThreshold: 8,
    activeRatioLabel: 'Ratio de navigation',
  },
  bateau: {
    ...SAILING_DEFAULTS,
    id: 'bateau',
    label: 'Bateau',
    defaultActiveThreshold: 3,
    defaultPolarMinSpeed: 2,
    activeRatioLabel: 'Ratio de navigation',
  },
  running: {
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
    // Les cibles de tops running restent à définir avec les métriques du module.
    topTargets: [],
    recording: DEFAULT_RECORDING,
  },
};

/** Supports dont l'analyse repose sur le vent. */
export const SAILING_SPORTS: SportType[] = ['wingfoil', 'windsurf', 'kite', 'bateau'];

export const getSportProfile = (sport: SportType): SportProfile => SPORT_PROFILES[sport];

/** Famille d'un support : elle choisit le module qui l'analyse et la bibliothèque qui le range. */
export type SportFamily = 'voile' | 'course';

export const sportFamily = (sport: SportType): SportFamily => (SAILING_SPORTS.includes(sport) ? 'voile' : 'course');

/** Les deux détentes du seuil d'activité, dans l'unité du profil. */
export const getActiveThresholds = (
  profile: SportProfile,
  threshold: number
): { enter: number; exit: number } => ({
  enter: threshold + profile.activeHysteresis.enterOffset,
  exit: Math.max(0, threshold + profile.activeHysteresis.exitOffset),
});
