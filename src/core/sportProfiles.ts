import type { JumpDetection } from './jumps';
import type { HeartRateZoneModel } from './heartRate';
import type { PumpDetection } from './pumping';
import type { CadenceDetection } from '../running/cadence';
import type { SpeedRangeMs } from './speedGradient';
import type { SportType, TopTarget } from './types';
import { DEFAULT_MAX_DETOUR_RATIO } from './kinematics';
import { kmhToMs, knotsToMs, METERS_PER_DISTANCE_UNIT, type SpeedUnit } from './units';

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
 * Pas plus long que cette durée : trou de la trace (arrêt sans point, GPS
 * perdu), en secondes, commun à tous les supports (décision du 27/10).
 */
export const MAX_GAP_S = 10;

/** Pas proposés pour l'altitude du terrain, en mètres. */
export const TERRAIN_STEP_CHOICES_M = [5, 10, 20] as const;

/**
 * Lissage de l'altitude et plus petit dénivelé compté. Le réglage « route »
 * sert partout depuis le 21/10 : l'altitude de l'IGN est déjà propre, et le
 * choix du terrain par activité et par session a été retiré ; « trail » reste
 * pour mémoire et pour les tests.
 */
export const ELEVATION_PRESETS: Record<'route' | 'trail', ElevationProfile> = {
  route: { smoothingSeconds: 20, minGainM: 3 },
  trail: { smoothingSeconds: 30, minGainM: 5 },
};

/** Pente locale et zones de pente (`running/runningAnalytics.ts`). */
export interface GradeProfile {
  /**
   * Demi-largeur, en mètres, de la fenêtre sur laquelle la pente est mesurée :
   * entre deux points voisins, quelques dizaines de centimètres d'erreur
   * d'altitude font dix pour cent ; sur cinquante mètres, elles s'effacent.
   */
  halfWindowM: number;
  /** Pente, en fraction, au-dessous de laquelle le terrain est considéré plat. */
  flatMaxGrade: number;
  /** Pente, en fraction, à partir de laquelle une montée ou une descente est raide. */
  steepMinGrade: number;
}

/**
 * Pente et zones de pente, communes à tous les supports : course, vélo,
 * énergie, cadence selon la pente, profil d'altitude de la planification.
 */
export const GRADE_ANALYSIS: GradeProfile = { halfWindowM: 25, flatMaxGrade: 0.03, steepMinGrade: 0.1 };

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
 * Le surf la reprend : l'attente au pic est immobile.
 */
const INTERVAL_RECORDING: RecordingProfile = { ...DEFAULT_RECORDING, autoPauseSpeedMs: 0 };

/**
 * Bateau (21/10) : pause automatique sous 0,2 km/h pendant 60 s, plus bas que
 * le défaut : un bord lent, sous 1 km/h, ne doit pas mettre la trace en pause.
 */
const BOAT_RECORDING: RecordingProfile = { ...DEFAULT_RECORDING, autoPauseSpeedMs: kmhToMs(0.2) };

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
  /**
   * Rapport de durée qui ouvre aussi une séance sans long repos (10/10 enchaîné
   * sur un 20/20) : deux efforts de suite aussi éloignés de la durée médiane de
   * la séance en cours, plus longs ou plus courts.
   */
  blockWorkFactor: number;
}

/**
 * Ceinture cardio Bluetooth à l'enregistrement (`platform/heartRate.ts`) et
 * analyse de la FC (`core/heartRate.ts`), dans tous les sports.
 */
export interface HeartRateProfile {
  /**
   * Écart de temps au-delà duquel une mesure de la ceinture n'est plus jointe
   * à une position, en secondes : une ceinture émet environ une fois par seconde.
   */
  maxAgeS: number;
  /** Lissage de la FC, en secondes. */
  smoothS: number;
  /** Intervalle sans FC au-delà duquel c'est un trou, ni compté ni tracé, en secondes. */
  gapS: number;
  /** Temps couvert par la FC au-dessous duquel la session est dite sans FC, en secondes. */
  minCoverageS: number;
  /** Seuils S1 et S2, et zones 1 à 5 calées dessus (`heartRateZones`). */
  zoneModel: HeartRateZoneModel;
  /**
   * Décalage de S1 et de S2 pour ce calcul, en bpm, par rapport à la course
   * (Gemini, 25/10 : masse musculaire, posture, contraction) ; surchargeable
   * par activité dans Réglages, la Marche a le sien en pré-réglage.
   */
  thresholdOffsetBpm: number;
  /**
   * Coefficients de la charge par minute, de « sous Z1 » à Z5 : ceux d'Edwards
   * (1 à 5), plus le temps sous Z1, qui compte aussi (choix de l'utilisateur).
   */
  loadWeights: readonly number[];
  /** Temps actif à FC au-dessous duquel la dérive n'est pas donnée, en secondes. */
  driftMinS: number;
  /** Dérive sous laquelle la FC est dite stable, en %. */
  driftStablePct: number;
  /** Délai de la récupération d'une répétition, en secondes. */
  recoveryS: number;
  /** Durée d'un bloc du nuage FC / vitesse, en secondes. */
  scatterBlockS: number;
}

/**
 * Seuils et zones (25/10, d'après la synthèse demandée à Gemini) : S1 à 70 %
 * et S2 à 85 % de la réserve cardiaque (Karvonen), 78 et 89 % de la FC max
 * sans FC de repos. Z3 commence à S1, Z4 aux 2/3 de S1 à S2 (seuil lactique
 * stable), Z5 un peu au-dessus de S2. Z1 et Z2 sous S1, placées pour tomber
 * au même endroit avec et sans FC de repos (Z2 environ 15 bpm sous S1).
 */
export const HEART_RATE_ZONE_MODEL: HeartRateZoneModel = {
  reserveThresholds: [0.7, 0.85],
  maxThresholds: [0.78, 0.89],
  belowS1Reserve: [0.65, 0.85],
  belowS1Max: [0.77, 0.9],
  z4: 0.68,
  z5: 0.22,
};

const HEART_RATE: HeartRateProfile = {
  maxAgeS: 3,
  smoothS: 5,
  gapS: 10,
  minCoverageS: 60,
  zoneModel: HEART_RATE_ZONE_MODEL,
  thresholdOffsetBpm: 0,
  loadWeights: [0.5, 1, 2, 3, 4, 5],
  driftMinS: 20 * 60,
  driftStablePct: 5,
  recoveryS: 60,
  scatterBlockS: 30,
};

/** Sauts mesurés par les capteurs du téléphone (`core/jumps.ts`) : voile, course, vélo. */
export interface JumpProfile {
  /** Hauteur minimale d'un saut montré, en mètres, surchargeable par activité. */
  defaultMinHeightM: number;
  detection: JumpDetection;
}

/**
 * Grille et verticale des capteurs, communes aux sauts et au pumping : pas de
 * la grille, trou toléré, repos qui amorce la gravité, filtre d'attitude.
 */
const ATTITUDE = {
  gridStepS: 0.01, maxGapS: 0.05,
  calmForceFraction: 0.15, calmRotationRadS: 0.3, minCalmS: 1,
  attitudeTauS: 3, attitudeMaxRotationRadS: 1.5, attitudeInitS: 1,
};

/**
 * Détection et mesure des sauts, communes aux supports qui sautent. Réglées sur
 * les séances de wingfoil du 08/10/2026, téléphone sur la poitrine : la séance
 * témoin ne donne aucun vol de 0,2 m, l'autre ses 10 sauts (0,66 à 1,72 m) et
 * rien d'autre au-dessus de 0,33 m. Les longs vols du kite restent à vérifier
 * sur une séance de kite. À pied et à vélo (VTT), les mêmes seuils écartent
 * la foulée (vol d'environ 0,1 s) ; ils restent à vérifier sur le terrain.
 */
export const JUMP_DETECTION: JumpDetection = {
  ...ATTITUDE,
  smoothingS: 0.1, pushG: 0.4, pushSearchS: 0.5, landingG: 0.3, edgeSearchS: 0.05,
  minFlightS: 0.2, maxFlightS: 8, minFallG: 0.2, biasWindowS: 10,
  keepMinFlightS: 0.4, keepMinHeightM: 0.2,
  pruneMinFlightS: 0.4, pruneMinHeightM: 0.15, pruneMarginS: 15, pruneChunkS: 300, pruneChunkMarginS: 20,
  dubiousBallisticFactor: 1.1, saturationFraction: 0.98, doubtMarginS: 2, attitudeMaxErrorM: 0.1,
  curveStepS: 0.05, curveMarginS: 0.5,
};

/**
 * Pumping sur foil, téléphone sur la poitrine (point 104) : verticale calculée
 * comme pour les sauts ; coups, séries et décollage provisoires, à régler sur
 * une première session réelle.
 */
const PUMP_DETECTION: PumpDetection = {
  ...ATTITUDE,
  strokeSmoothingS: 0.15, strokeBaselineS: 2, strokeMinG: 0.12, strokeMinPeriodS: 0.3, strokeMaxGapS: 2.5, minSeriesStrokes: 3,
  liftoffHighPassS: 0.1, liftoffRoughWindowS: 0.5, liftoffCalmG: 0.08, liftoffCalmS: 1.5,
  liftoffSearchBeforeS: 10, liftoffSearchAfterS: 5,
  pruneCapture: false, pruneMarginS: 30,
  // Le surf a ses vols à lui (`SurfFlight`) : tous listés.
  minFlightS: 0,
};

/**
 * Pumping en voile sur foil (wing, planche, kite ; lot 22, décision du 28/10) :
 * au départ, copie de celui du surf, décollage compris. À régler sur une vraie
 * session de wing capturée entière (Pumping coché) : celle du 26/10, élaguée
 * autour des sauts, ne couvre que des bouts de vol. Pas d'élagage propre au
 * pumping : Pumping coché, la capture est rangée entière
 * (`keepsWholeCaptureForPumping`). Un vol est une suite au-dessus du seuil
 * d'activité ; ceux de moins de 10 s ne sont pas listés (`minFlightS`).
 */
const SAILING_PUMP_DETECTION: PumpDetection = {
  ...PUMP_DETECTION,
  minFlightS: 10,
};

/**
 * Cadence à pied (`running/cadence.ts`, demande du 16/10) : provisoire, à
 * régler sur de vraies sorties, téléphone porté comme d'habitude. De 70 pas
 * par minute (marche lente) à 240 (sprint).
 */
const CADENCE: CadenceDetection = {
  gridStepS: 0.02, maxGapS: 0.2, gravityWindowS: 2, windowS: 6, stepS: 1,
  // Foulée de course au-dessus de 10 m/s² : marche en poche 6 à 8, course 13 à 18 (17/10).
  minSpm: 70, maxSpm: 240, minCorrelation: 0.3, peakFraction: 0.85, halfPeriodFraction: 0.5, strideRmsMs2: 10,
  minRmsMs2: 0.5, minCoverage: 0.8, chartSmoothingS: 5, minCoverageS: 60, gapS: 10,
  walkBands: [90, 100, 110, 120, 130], runBands: [150, 160, 170, 180, 190], runAboveSpm: 140,
  maxWindowS: 30, speedBinKmh: 1, minBinS: 30, driftMinS: 10 * 60,
  // Unité de `cad` d'un GPX (décision du 27/10) : longueur de pas ÷ fréquence des pas vraisemblable,
  // marche 0,3 à 0,45, course 0,35 à 0,65 ; un facteur 2 faux la multiplie ou la divise par 4.
  stepLengthPerHz: { min: 0.2, max: 0.8 }, spmAbove: 130,
  keepCapture: true,
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
    minContrast: 1.25, upperContrast: 1.4, blockMinGapS: 60, blockGapFactor: 3, blockWorkFactor: 1.6,
  },
};

/**
 * Analyse d'une session de surf (`surfing/`, §10, point 97) : vagues, rame,
 * attente, vols sur foil. Les seuils de vitesse de la vague et du vol sont le
 * seuil d'activité (`defaultActiveThreshold`, `foilActiveThreshold`) ; le
 * reste est ici. Défauts provisoires, à valider sur des sessions réelles.
 */
export interface SurfProfile {
  /** Attente au pic sous cette vitesse lissée, en m/s ; au-dessus, hors vague, on rame. */
  stillMs: number;
  /** Arrêt plus court ignoré (canard, série qui passe) : pas encore l'attente au pic, en secondes. */
  minWaitS: number;
  /** Vague plus courte écartée, en secondes… */
  minWaveS: number;
  /** …ou plus courte que cette distance, en mètres. */
  minWaveM: number;
  /** Rame de départ : le mouvement continu qui précède la vague, cherché au plus cette durée, en secondes. */
  takeoffSearchS: number;
  /** Seuil de vol sur foil, dans `thresholdUnit` : le seuil d'activité par défaut d'une session sur foil. */
  foilActiveThreshold: number;
  /** Seuil de vague sur foil, dans `thresholdUnit` : au-dessus, le vol est porté par une vague ; en dessous, il est pompé. */
  foilWaveThreshold: number;
  /** Changement de direction compté par le GPS : rotation d'au moins cette valeur depuis l'extrême précédent, en degrés. */
  turnMinDeg: number;
}

export interface SportProfile {
  id: SportType;
  label: string;
  /** Unité d'affichage principale des vitesses. */
  speedUnit: SpeedUnit;
  /** Unité dans laquelle le seuil d'activité est saisi, stocké et comparé. */
  thresholdUnit: SpeedUnit;
  /**
   * Calcul sans seuil d'activité (bateau, 21/10) : toute la session compte en
   * navigation, sans temps actif, ratio ni moyenne active ; la réussite des
   * manœuvres se lit à ce seuil fixe, non réglable, dans `thresholdUnit`.
   * `null` : seuil d'activité réglable (`defaultActiveThreshold`).
   */
  withoutActiveThreshold: { maneuverSuccess: number } | null;
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
   * seuil + `exitOffset`, ce dernier étant négatif. Quand seuil + `exitOffset`
   * n'est pas positif (seuil bas, la marche à 0,5 km/h), l'arrêt se fait sous
   * seuil × `EXIT_FLOOR_RATIO` : la détente basse n'est jamais nulle
   * (`getActiveThresholds`).
   */
  activeHysteresis: { enterOffset: number; exitOffset: number };
  /**
   * Plancher d'arrêt, dans `thresholdUnit` : quand aucun seuil d'activité
   * n'est réglé (seuil 0), un arrêt complet est ôté d'office du temps en
   * mouvement sous ce plancher (décision du 27/10). En bateau, sans seuil, il
   * ne sert qu'à juger un trou de la trace immobile.
   */
  stillThreshold: number;
  /** Pas plus long que cette durée : trou de la trace (arrêt sans point, GPS perdu), en secondes. */
  maxGapS: number;
  /** Durée de confirmation avant tout changement d'état d'activité, en secondes. */
  minStateDurationS: number;
  /** Largeur du filtre médian appliqué à la vitesse, en secondes. */
  medianWindowSeconds: number;
  /**
   * Détour maximal par un point, en fois le chemin direct entre ses voisins :
   * au-delà, si la vitesse qu'il donne est impossible, sa position a sauté
   * (`detourSpikes`). Rapport sans dimension, le même pour tous les supports.
   */
  maxDetourRatio: number;
  /**
   * Vitesse maximale physiquement plausible pour ce support, en m/s. Au-delà,
   * c'est une aberration GPS, quelle que soit l'accélération qui y mène.
   */
  maxPlausibleSpeedMs: number;
  /** Vitesse minimale, dans `thresholdUnit`, pour qu'un point alimente le diagramme polaire. */
  defaultPolarMinSpeed: number;
  /**
   * Bornes de couleur de la trace par défaut, fixes, en m/s ; `null` : celles
   * du traitement, et en voile la suggestion faite selon l'allure de la session.
   */
  speedRange: SpeedRangeMs | null;
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
  /** Pente locale et zones de pente. */
  grade: GradeProfile;
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
  /**
   * Cibles de recherche des meilleurs segments. L'onglet « tops » est natif en
   * voile et à vélo, générique à pied et en surf (`core/analysisTabs.ts`).
   */
  topTargets: readonly TopTarget[];
  /** Réglage de l'enregistrement GPS. */
  recording: RecordingProfile;
  /**
   * Analyse des répétitions du compteur, et leur détection en famille
   * Fractionné ; `null` en voile, où le compteur ne sert pas.
   */
  intervals: IntervalProfile | null;
  /** Sauts mesurés par les capteurs du téléphone ; `null` en bateau, en fractionné et en surf. */
  jumps: JumpProfile | null;
  /** Ceinture cardio proposée à l'enregistrement et analyse de la FC, dans tous les sports. */
  heartRate: HeartRateProfile;
  /** Cadence à pied mesurée par les capteurs du téléphone ; `null` hors course, marche et fractionné à pied. */
  cadence: CadenceDetection | null;
  /** Analyse des vagues ; `null` hors surf. */
  surf: SurfProfile | null;
  /**
   * Pumping sur foil, mesuré par les capteurs du téléphone (`core/pumping.ts`) :
   * surf (point 104) et voile sur foil (lot 22) ; `null` en bateau, à pied, à vélo.
   */
  pump: PumpDetection | null;
}

/** Cibles de tops utilisées par tous les supports à voile ; leurs clés font le type des tops de la voile (`SailingTopKey`). */
export const SAILING_TOP_TARGETS = [
  { key: 't2s', label: '2 s', value: 2, kind: 'time' },
  { key: 't5s', label: '5 s', value: 5, kind: 'time' },
  { key: 't10s', label: '10 s', value: 10, kind: 'time' },
  { key: 'd100m', label: '100 m', value: 100, kind: 'distance' },
  { key: 'd500m', label: '500 m', value: 500, kind: 'distance' },
  { key: 'd1000m', label: '1000 m', value: 1000, kind: 'distance' },
  { key: 'd1NM', label: '1 mille', value: METERS_PER_DISTANCE_UNIT.nm, kind: 'distance' },
] as const satisfies readonly TopTarget[];

/** Clé d'une cible de tops de la voile (`t2s` … `d1NM`). */
export type SailingTopKey = (typeof SAILING_TOP_TARGETS)[number]['key'];

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

/**
 * Cibles de tops à pied, course et marche : les durées des tests (Cooper sur
 * 12 min) et les distances des courses usuelles. Onglet caché tant que
 * l'activité ne le coche pas dans Réglages.
 */
export const RUNNING_TOP_TARGETS: TopTarget[] = [
  { key: 't1min', label: '1 min', value: 60, kind: 'time' },
  { key: 't5min', label: '5 min', value: 300, kind: 'time' },
  { key: 't12min', label: '12 min', value: 720, kind: 'time' },
  { key: 't30min', label: '30 min', value: 1800, kind: 'time' },
  { key: 't60min', label: '1 h', value: 3600, kind: 'time' },
  { key: 'd400m', label: '400 m', value: 400, kind: 'distance' },
  { key: 'd1km', label: '1 km', value: 1000, kind: 'distance' },
  { key: 'd5km', label: '5 km', value: 5000, kind: 'distance' },
  { key: 'd10km', label: '10 km', value: 10000, kind: 'distance' },
  { key: 'dsemi', label: 'semi', value: 21097.5, kind: 'distance' },
  { key: 'dmarathon', label: 'marathon', value: 42195, kind: 'distance' },
];

/**
 * Cibles de tops de la famille surf (surf, paddle, SUP foil, kayak,
 * downwind) : la pointe et la glisse d'une vague, les distances du kayak
 * (200, 500, 1000 m) et celles d'un downwind. Onglet caché tant que
 * l'activité ne le coche pas dans Réglages.
 */
export const SURF_TOP_TARGETS: TopTarget[] = [
  { key: 't2s', label: '2 s', value: 2, kind: 'time' },
  { key: 't10s', label: '10 s', value: 10, kind: 'time' },
  { key: 't1min', label: '1 min', value: 60, kind: 'time' },
  { key: 't10min', label: '10 min', value: 600, kind: 'time' },
  { key: 'd100m', label: '100 m', value: 100, kind: 'distance' },
  { key: 'd200m', label: '200 m', value: 200, kind: 'distance' },
  { key: 'd500m', label: '500 m', value: 500, kind: 'distance' },
  { key: 'd1km', label: '1 km', value: 1000, kind: 'distance' },
  { key: 'd5km', label: '5 km', value: 5000, kind: 'distance' },
  { key: 'd10km', label: '10 km', value: 10000, kind: 'distance' },
];

/** Réglages communs à tous les calculs, surchargés au cas par cas. */
const COMMON_DEFAULTS = {
  maxGapS: MAX_GAP_S,
  maxDetourRatio: DEFAULT_MAX_DETOUR_RATIO,
  withoutActiveThreshold: null,
  speedRange: null,
  elevation: ELEVATION_PRESETS.route,
  grade: GRADE_ANALYSIS,
  foilDefault: false,
  recording: DEFAULT_RECORDING,
};

/** Réglages communs aux supports à voile, surchargés au cas par cas. */
const SAILING_DEFAULTS = {
  ...COMMON_DEFAULTS,
  speedUnit: 'kn' as SpeedUnit,
  thresholdUnit: 'kn' as SpeedUnit,
  activeHysteresis: { enterOffset: 0.5, exitOffset: -1 },
  stillThreshold: 1,
  minStateDurationS: 0,
  medianWindowSeconds: 3,
  // 30 m/s font 58 nœuds : hors de portée en session ordinaire.
  maxPlausibleSpeedMs: 30,
  defaultPolarMinSpeed: 5,
  terrainElevationStepM: null,
  loopReturnMaxRatio: null,
  topTargets: SAILING_TOP_TARGETS,
  intervals: null,
  heartRate: HEART_RATE,
  cadence: null,
  surf: null,
  pump: SAILING_PUMP_DETECTION,
};

/** Seuils cardio d'un calcul décalés de `offsetBpm` par rapport à la course. */
const heartRateOffset = (offsetBpm: number): HeartRateProfile => ({ ...HEART_RATE, thresholdOffsetBpm: offsetBpm });

const RUNNING_PROFILE: SportProfile = {
  ...COMMON_DEFAULTS,
  id: 'running',
  label: 'À pied',
  speedUnit: 'minkm',
  thresholdUnit: 'kmh',
  // Reprise au-dessus de 4 km/h, pause en dessous de 2 km/h, confirmée sur 3 s.
  defaultActiveThreshold: 3,
  activeHysteresis: { enterOffset: 1, exitOffset: -1 },
  // Sans seuil réglé : arrêt complet sous 0,5 km/h, reprise au-dessus de 2 km/h.
  stillThreshold: 1,
  minStateDurationS: 3,
  medianWindowSeconds: 5,
  // 12 m/s font 43 km/h, au-delà du sprint humain.
  maxPlausibleSpeedMs: 12,
  defaultPolarMinSpeed: 0,
  activeRatioLabel: 'Ratio en mouvement',
  terrainElevationStepM: 10,
  loopReturnMaxRatio: DEFAULT_LOOP_RETURN_MAX_RATIO,
  topTargets: RUNNING_TOP_TARGETS,
  intervals: INTERVAL_ANALYSIS,
  jumps: { defaultMinHeightM: 0.3, detection: JUMP_DETECTION },
  heartRate: HEART_RATE,
  cadence: CADENCE,
  surf: null,
  pump: null,
};

const CYCLING_PROFILE: SportProfile = {
  ...COMMON_DEFAULTS,
  id: 'cycling',
  label: 'Vélo',
  speedUnit: 'kmh',
  thresholdUnit: 'kmh',
  // Reprise au-dessus de 6 km/h, pause en dessous de 3 km/h, confirmée sur 3 s.
  defaultActiveThreshold: 5,
  activeHysteresis: { enterOffset: 1, exitOffset: -2 },
  // Sans seuil réglé : arrêt complet sous 1 km/h, reprise au-dessus de 3 km/h.
  stillThreshold: 2,
  minStateDurationS: 3,
  medianWindowSeconds: 3,
  // 25 m/s font 90 km/h, au-delà d'une descente de col ordinaire.
  maxPlausibleSpeedMs: 25,
  defaultPolarMinSpeed: 0,
  activeRatioLabel: 'Ratio en mouvement',
  terrainElevationStepM: 10,
  loopReturnMaxRatio: DEFAULT_LOOP_RETURN_MAX_RATIO,
  topTargets: CYCLING_TOP_TARGETS,
  intervals: INTERVAL_ANALYSIS,
  jumps: { defaultMinHeightM: 0.3, detection: JUMP_DETECTION },
  heartRate: heartRateOffset(-7),
  cadence: null,
  surf: null,
  pump: null,
};

/**
 * Surf : pause automatique coupée, l'attente au pic est immobile. Seuil de
 * vague à 9 km/h (entrée à 10, sortie à 7) : la rame la plus vive reste sous
 * 7 km/h, une vague se surfe au-dessus de 10. Sur foil, le vol commence à
 * 11 km/h et finit sous 8 ; il est porté par une vague au-dessus de 18 km/h,
 * pompé en dessous. Valeurs de départ, à valider sur des sessions réelles.
 */
const SURF_PROFILE: SportProfile = {
  ...COMMON_DEFAULTS,
  id: 'surf',
  label: 'Surf',
  speedUnit: 'kmh',
  thresholdUnit: 'kmh',
  defaultActiveThreshold: 9,
  activeHysteresis: { enterOffset: 1, exitOffset: -2 },
  stillThreshold: 2,
  minStateDurationS: 0,
  medianWindowSeconds: 3,
  // 20 m/s font 72 km/h, au-delà d'une grosse vague ordinaire.
  maxPlausibleSpeedMs: 20,
  defaultPolarMinSpeed: 0,
  activeRatioLabel: 'Ratio sur la vague',
  terrainElevationStepM: null,
  loopReturnMaxRatio: null,
  topTargets: SURF_TOP_TARGETS,
  recording: INTERVAL_RECORDING,
  intervals: null,
  jumps: null,
  heartRate: heartRateOffset(-10),
  cadence: null,
  surf: {
    stillMs: 0.5, minWaitS: 10, minWaveS: 3, minWaveM: 15, takeoffSearchS: 15,
    foilActiveThreshold: 10, foilWaveThreshold: 18, turnMinDeg: 60,
  },
  pump: PUMP_DETECTION,
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
    heartRate: heartRateOffset(-8),
    jumps: { defaultMinHeightM: 0.5, detection: JUMP_DETECTION },
  },
  windsurf: {
    ...SAILING_DEFAULTS,
    id: 'windsurf',
    label: 'Planche à voile',
    defaultActiveThreshold: 10,
    activeRatioLabel: 'Ratio de planing',
    heartRate: heartRateOffset(-5),
    jumps: { defaultMinHeightM: 0.5, detection: JUMP_DETECTION },
  },
  kite: {
    ...SAILING_DEFAULTS,
    id: 'kite',
    label: 'Kitesurf',
    defaultActiveThreshold: 8,
    activeRatioLabel: 'Ratio de navigation',
    heartRate: heartRateOffset(-8),
    jumps: { defaultMinHeightM: 1, detection: JUMP_DETECTION },
  },
  bateau: {
    ...SAILING_DEFAULTS,
    id: 'bateau',
    label: 'Bateau',
    // Sans seuil (21/10) : un bord peut passer sous 1 nœud ; une manœuvre sous 1 nœud est ratée.
    defaultActiveThreshold: 1,
    withoutActiveThreshold: { maneuverSuccess: 1 },
    defaultPolarMinSpeed: 2,
    // Couleurs de 1 à 15 nœuds, fixes, plutôt que selon l'allure (21/10).
    speedRange: { minMs: knotsToMs(1), maxMs: knotsToMs(15) },
    recording: BOAT_RECORDING,
    activeRatioLabel: 'Ratio de navigation',
    // Voile au rappel, comme la planche (25/10).
    heartRate: heartRateOffset(-5),
    jumps: null,
    // Ni foil pompé ni capteurs du pumping.
    pump: null,
  },
  running: RUNNING_PROFILE,
  cycling: CYCLING_PROFILE,
  // Fractionné : les calculs de la course et du vélo, sans pause automatique, planification ni sauts.
  'run-intervals': {
    ...RUNNING_PROFILE, id: 'run-intervals', label: 'Fractionné à pied', loopReturnMaxRatio: null, recording: INTERVAL_RECORDING, jumps: null,
  },
  'bike-intervals': {
    ...CYCLING_PROFILE, id: 'bike-intervals', label: 'Fractionné vélo', loopReturnMaxRatio: null, recording: INTERVAL_RECORDING, jumps: null,
  },
  // Tests guidés à pied (FC max, 24/10) : la course sans pause automatique, ni planification, ni sauts, ni répétitions.
  'run-test': {
    ...RUNNING_PROFILE, id: 'run-test', label: 'Test à pied', loopReturnMaxRatio: null, recording: INTERVAL_RECORDING, jumps: null, intervals: null,
  },
  surf: SURF_PROFILE,
  // Muscu (lot I du 25/10) : la ceinture cardio seule, sans position ni GPS ; la course pour le
  // reste (FC, zones), sans pause automatique, planification, sauts, cadence ni répétitions
  // retrouvées. Décalage de S1 et S2 à 0, faute de référence, surchargeable par activité.
  muscu: {
    ...RUNNING_PROFILE, id: 'muscu', label: 'Muscu', loopReturnMaxRatio: null, recording: INTERVAL_RECORDING,
    jumps: null, intervals: null, cadence: null, terrainElevationStepM: null, topTargets: [], heartRate: heartRateOffset(0),
  },
};

/** Supports dont l'analyse repose sur le vent. */
export const SAILING_SPORTS: SportType[] = ['wingfoil', 'windsurf', 'kite', 'bateau'];

export const getSportProfile = (sport: SportType): SportProfile => SPORT_PROFILES[sport];

/**
 * Seuil d'activité par défaut d'un calcul, dans `thresholdUnit`. En surf, il dépend du foil : le
 * seuil de vague sans lui, le seuil de vol avec (point 97). En voile, le foil n'y touche pas.
 */
export const defaultActiveThresholdOf = (profile: SportProfile, foil: boolean): number =>
  foil && profile.surf ? profile.surf.foilActiveThreshold : profile.defaultActiveThreshold;

/**
 * Calcul au seuil d'activité réglable : tous sauf le bateau (`withoutActiveThreshold`).
 * Un seuil réglé à 0 veut dire « aucun seuil réglé » ; les arrêts complets sont
 * pourtant ôtés d'office, sous le plancher `stillThreshold` (`thresholdActivityMask`).
 */
export const hasActiveThreshold = (profile: SportProfile): boolean => profile.withoutActiveThreshold === null;

/** Libellé du ratio de temps actif d'une session : « Ratio de vol » sur foil, sinon celui du calcul. */
export const activeRatioLabel = (profile: SportProfile, foil: boolean): string =>
  foil ? FOIL_RATIO_LABEL : profile.activeRatioLabel;

/**
 * Traitement d'un calcul : la façon dont ses sessions se calculent et
 * s'affichent (unités, énergie, vélo, altitude du terrain, chiffres du direct,
 * module d'analyse). À ne pas confondre avec la famille, qui les range.
 */
export type Treatment = 'voile' | 'course' | 'velo' | 'surf' | 'muscu';

/** Traitement à pied ou à vélo : dénivelé, altitude du terrain, pente, énergie. */
export const isLandTreatment = (treatment: Treatment): boolean => treatment === 'course' || treatment === 'velo';

/**
 * Famille d'un calcul : où ses sessions se rangent (bibliothèque, accueil,
 * barre de navigation, listes d'activités, Réglages). Une famille de
 * traitement porte son nom ; `fractionne`, nommée « Entraînement » depuis le
 * 24/10, range des calculs traités à pied ou à vélo (§10, point 89).
 */
export type SportFamily = 'voile' | 'course' | 'velo' | 'surf' | 'fractionne';

/** Les familles, dans l'ordre de l'interface. */
export const SPORT_FAMILIES: SportFamily[] = ['voile', 'course', 'velo', 'surf', 'fractionne'];

const SPORT_TREATMENT: Record<SportType, Treatment> = {
  wingfoil: 'voile',
  windsurf: 'voile',
  kite: 'voile',
  bateau: 'voile',
  running: 'course',
  cycling: 'velo',
  'run-intervals': 'course',
  'bike-intervals': 'velo',
  'run-test': 'course',
  surf: 'surf',
  muscu: 'muscu',
};

const SPORT_FAMILY: Record<SportType, SportFamily> = {
  wingfoil: 'voile',
  windsurf: 'voile',
  kite: 'voile',
  bateau: 'voile',
  running: 'course',
  cycling: 'velo',
  'run-intervals': 'fractionne',
  'bike-intervals': 'fractionne',
  'run-test': 'fractionne',
  surf: 'surf',
  muscu: 'fractionne',
};

export const sportTreatment = (sport: SportType): Treatment => SPORT_TREATMENT[sport];

export const sportFamily = (sport: SportType): SportFamily => SPORT_FAMILY[sport];

/**
 * Calcul du fractionné, à pied ou à vélo : le seul de la famille Entraînement
 * à avoir l'onglet « fractionné », la détection des répétitions et le compteur
 * proposé d'office (24/10).
 */
export const isIntervalSport = (sport: SportType): boolean => sport === 'run-intervals' || sport === 'bike-intervals';

/**
 * Type d'entraînement d'un calcul de la famille Entraînement (24/10) : la
 * rangée « Fractionné · Tests · Muscu » d'Enregistrer, au-dessus des
 * activités du type (à pied, vélo). `null` hors de la famille.
 */
export type TrainingKind = 'fractionne' | 'tests' | 'muscu';

export const TRAINING_KINDS: readonly TrainingKind[] = ['fractionne', 'tests', 'muscu'];

export const TRAINING_KIND_LABEL: Record<TrainingKind, string> = { fractionne: 'Fractionné', tests: 'Tests', muscu: 'Muscu' };

export const trainingKind = (sport: SportType): TrainingKind | null =>
  isIntervalSport(sport) ? 'fractionne' : sport === 'run-test' ? 'tests' : sport === 'muscu' ? 'muscu' : null;

/**
 * Calcul enregistré avec des positions (GPS) : tous sauf la muscu, faite de
 * la ceinture cardio seule (lot I du 25/10). Une session sans position n'a ni
 * trace, ni carte, ni cinématique : son GPX ne porte que l'heure et la FC
 * (`ParsedGpx.timedPoints`). C'est ce prédicat qu'on teste, pas le nom du
 * calcul, pour qu'un autre calcul sans trace (test de FC repos) s'y range.
 */
export const hasPositions = (sport: SportType): boolean => sport !== 'muscu';

/** Calcul d'un test guidé (`recording/fitnessTest.ts`) : la rangée « Test » d'Enregistrer, l'onglet « test » de l'analyse. */
export const isTestSport = (sport: SportType): boolean => trainingKind(sport) === 'tests';

/**
 * Famille qui navigue sur un parcours de balises (voile, surf) : itinéraire
 * de balises numérotées en ligne droite, validées dans l'ordre avec des bips
 * d'approche. Le vent, les bords et les manœuvres restent propres à la voile.
 */
export const usesMarkCourse = (family: SportFamily): boolean => family === 'voile' || family === 'surf';

/** Calculs d'une famille, dans l'ordre de `SPORT_PROFILES`. */
export const familySports = (family: SportFamily): SportType[] =>
  (Object.keys(SPORT_PROFILES) as SportType[]).filter((sport) => SPORT_FAMILY[sport] === family);

/**
 * Détente basse d'un seuil plus petit que l'écart `exitOffset`, en fois le
 * seuil (rapport sans dimension, règle 4) : sans elle, la détente vaudrait 0 et
 * le masque d'activité ne sortirait plus jamais une fois entré (27/10).
 */
export const EXIT_FLOOR_RATIO = 0.5;

/**
 * Les deux détentes du seuil d'activité, dans l'unité du profil. La détente
 * basse vaut seuil + `exitOffset` si elle reste positive, sinon seuil ×
 * `EXIT_FLOOR_RATIO` ; un seuil de 0 donne une détente basse nulle.
 */
export const getActiveThresholds = (
  profile: SportProfile,
  threshold: number
): { enter: number; exit: number } => {
  const exit = threshold + profile.activeHysteresis.exitOffset;
  return {
    enter: threshold + profile.activeHysteresis.enterOffset,
    exit: exit > 0 ? exit : threshold * EXIT_FLOOR_RATIO,
  };
};
