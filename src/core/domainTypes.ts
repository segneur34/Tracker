/**
 * Types nés dans un domaine (cadence, compteur d'intervalles, autorisations,
 * capteurs de saut) que le noyau ou la plateforme doivent connaître : ils
 * sont posés ici pour que `core/` et `platform/` n'importent aucun domaine
 * (test `src/architecture.test.ts`). Chaque domaine les réexporte sous le
 * même nom.
 */

// --- Cadence à pied (`running/cadence.ts`) ---

/** Constantes de la mesure (`SPORT_PROFILES.running.cadence`). */
export interface CadenceDetection {
  /** Pas de la grille de calcul, en secondes. */
  gridStepS: number;
  /** Écart entre deux mesures au-delà duquel la capture a un trou, en secondes. */
  maxGapS: number;
  /** Moyenne glissante retirée au module (pesanteur, biais), en secondes. */
  gravityWindowS: number;
  /** Fenêtre de l'autocorrélation, centrée sur l'instant mesuré, en secondes. */
  windowS: number;
  /** Écart entre deux mesures de cadence, en secondes. */
  stepS: number;
  /** Cadence la plus basse et la plus haute cherchées, en pas par minute. */
  minSpm: number;
  maxSpm: number;
  /** Corrélation de la crête retenue sous laquelle le signal n'est pas régulier. */
  minCorrelation: number;
  /** Une crête plus tôt est prise si elle atteint cette part de la plus haute. */
  peakFraction: number;
  /** La demi-période d'une crête est le pas si elle en atteint cette part. */
  halfPeriodFraction: number;
  /**
   * Écart type du module, sans pesanteur, au-dessus duquel une crête sans
   * demi-période, qui pourrait être un pas lent ou une foulée de course, est
   * une foulée, en m/s².
   */
  strideRmsMs2: number;
  /** Écart type du module, sans pesanteur, sous lequel on est à l'arrêt, en m/s². */
  minRmsMs2: number;
  /** Part de la fenêtre que la capture doit couvrir. */
  minCoverage: number;
  /** Lissage de la courbe des graphes, en secondes. */
  chartSmoothingS: number;
  /** Temps couvert par la cadence sous lequel une session est dite sans cadence, en secondes. */
  minCoverageS: number;
  /** Écart entre deux points au-delà duquel la cadence n'est pas comptée entre eux, en secondes. */
  gapS: number;
  /**
   * Unité de `cad` d'un GPX, pas ou foulées par minute (décision du 27/10) :
   * longueur de pas divisée par la fréquence des pas (en pas par seconde),
   * vraisemblable entre ces bornes, en m·s. Lue sur les segments mesurés :
   * pris tels quels, puis doublés, un seul des deux sens doit y tomber.
   */
  stepLengthPerHz: { min: number; max: number };
  /**
   * Faute d'indice de longueur de pas (pas de mouvement, ou les deux sens
   * aussi vraisemblables) : une médiane de `cad` au-dessus est déjà en pas par
   * minute, en dessous en foulées.
   */
  spmAbove: number;
  /** Bornes basses des tranches de cadence de la marche et de la course, en pas par minute. */
  walkBands: readonly number[];
  runBands: readonly number[];
  /** Cadence moyenne au-dessus de laquelle la session prend les tranches de la course. */
  runAboveSpm: number;
  /** Durée de la cadence maximale, en secondes. */
  maxWindowS: number;
  /** Largeur d'une tranche de vitesse, en km/h. */
  speedBinKmh: number;
  /** Temps sous lequel une tranche de vitesse n'est pas montrée, en secondes. */
  minBinS: number;
  /** Temps mesuré en mouvement sous lequel la dérive n'est pas donnée, en secondes. */
  driftMinS: number;
  /**
   * Garder toute la capture dans la mémoire : vrai tant que la mesure se
   * règle sur de vraies sorties (relues par adb) ; faux, elle n'est pas
   * rangée quand elle ne servait qu'à la cadence.
   */
  keepCapture: boolean;
}

// --- Compteur d'intervalles (`recording/intervalTimer.ts`) ---

/** Bloc de répétitions : travail, repos, travail… sans repos après la dernière. */
export interface IntervalSeriesBlock {
  kind: 'series';
  reps: number;
  workS: number;
  restS: number;
}

/** Nom d'un bloc libre. */
export type IntervalFreeLabel = 'Échauffement' | 'Récupération' | 'Retour au calme';

/** Bloc libre : une seule phase, hors des répétitions. */
export interface IntervalFreeBlock {
  kind: 'libre';
  label: IntervalFreeLabel;
  durationS: number;
}

export type IntervalBlock = IntervalSeriesBlock | IntervalFreeBlock;

/**
 * Une séance. `reps`, `workS` et `restS` sont ceux de son premier bloc de
 * séries : une séance d'un seul bloc n'a pas de `blocks`, comme avant les
 * blocs (24/10), et une version d'avant lit encore le premier bloc d'une
 * séance qui en a plusieurs.
 */
export interface IntervalWorkout {
  /** Nombre de répétitions. */
  reps: number;
  /** Temps de travail de chaque répétition, en secondes. */
  workS: number;
  /** Temps de repos entre deux répétitions, en secondes ; 0 : aucun. */
  restS: number;
  /** Les blocs, dans l'ordre, quand la séance n'est pas un seul bloc de séries. */
  blocks?: IntervalBlock[];
}

/**
 * Une phase telle qu'elle s'est déroulée, en instants de l'horloge ; le départ
 * n'en est pas une. Un bloc libre en est une, hors des répétitions : une
 * version d'avant les blocs l'écarte à la lecture.
 */
export interface IntervalLap {
  kind: 'travail' | 'repos' | 'libre';
  rep: number;
  startMs: number;
  endMs: number;
  /** Indice du bloc de la séance ; absent dans une fiche d'avant les blocs : le premier. */
  block?: number;
}

/** Une séance telle qu'elle a été faite pendant un enregistrement. */
export interface IntervalSeries {
  workout: IntervalWorkout;
  laps: IntervalLap[];
}

// --- Autorisations du téléphone (`recording/permissionsPrompt.ts`) ---

/** Autorisations suivies, dans l'ordre de la carte. */
export type PermissionKey = 'location' | 'notifications' | 'battery' | 'bluetooth';

/**
 * `granted` : accordée ; `prompt` : jamais demandée, la demande système
 * s'affichera ; `denied` : refusée, il faut passer par les réglages de
 * l'application ; `unavailable` : sans objet ici (navigateur).
 */
export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unavailable';

export type PermissionsStatus = Record<PermissionKey, PermissionState>;

// --- Capteurs de saut (`recording/jumpSettings.ts`) ---

/** Où le téléphone est fixé : règle les seuils de détection et dit la précision à attendre. */
export type JumpPlacement = 'poitrine' | 'taille' | 'bras' | 'dos';

// --- Type de vélo (`cycling/energy.ts`) ---

/** Type de vélo, c'est-à-dire surtout ses pneus : il fixe le roulement, la traînée et le poids du vélo par défaut. */
export type BikeType = 'route' | 'gravel' | 'vtt' | 'ville';
