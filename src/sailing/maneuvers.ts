import { roundBearingDeg, toRad, angleDiff, circularMean, normalizeDeg } from '../core/angles';
import { median } from '../core/basics';
import { knotsToMs } from '../core/units';
import { rawSpeedKn, type PointData } from './pointData';
import {
  MANEUVER_COOLDOWN_S,
  MANEUVER_CORE_RATE_DEG_S,
  MANEUVER_FULL_TURN_DEG,
  MANEUVER_MIN_COHERENCE,
  MANEUVER_MIN_ENTRY_SPEED_KN,
  MANEUVER_MAX_STEP_S,
  MANEUVER_MIN_DISTANCE_M,
  MANEUVER_MIN_TURN_DEG,
  MANEUVER_WINDOW_S,
  ORIENTATION_MAX_CONSERVATION,
  TURN_STRIDE_MIN_S,
  WIND_CONFIDENCE_MIN,
  WIND_ESTIMATION_MIN_SPEED_KN,
  getDefaultThresholdKn,
  getStillSpeedKn,
} from './sailingConfig';
import { CANDIDATE_MIN_SEPARATION, buildWindTimeline, isTurningStep, prepareWindPolar, scanTurnWindow, strideEnd, type PolarWindEstimate, type WindEstimate, type WindOrientationSource, type WindPolarStage } from './wind';

export interface ManeuverOptions {
  /**
   * Vitesse minimale, en nœuds, en dessous de laquelle une manœuvre est ratée.
   * Dépend du support et reste réglable par l'utilisateur.
   */
  successThresholdKn?: number;
  /** Vitesse minimale d'entrée de manœuvre, en nœuds. */
  minEntrySpeedKn?: number;
  /** Durée d'observation d'une manœuvre, en secondes. */
  windowSeconds?: number;
  /** Temps mort après une manœuvre validée, en secondes. */
  cooldownSeconds?: number;
  /** Durée maximale d'un intervalle unique lu comme virage, en secondes. */
  maxStepSeconds?: number;
  /** Distance minimale parcourue pendant le virage, en mètres. */
  minDistanceM?: number;
  /** Cohérence minimale du virage, garde-fou contre les chutes (`MANEUVER_MIN_COHERENCE`). */
  minCoherence?: number;
  /** Virage, en degrés, à partir duquel un demi-tour est un tour complet, jamais compté (`MANEUVER_FULL_TURN_DEG`). */
  fullTurnDeg?: number;
  /** Rotation minimale, en °/s, du cœur d'un virage, d'où se lit son approche (`MANEUVER_CORE_RATE_DEG_S`). */
  coreRateDegS?: number;
  /** Virage minimal, en degrés, pour qu'un changement de cap soit lu comme un virage (`MANEUVER_MIN_TURN_DEG`). */
  minTurnDeg?: number;
  /**
   * Seuil de vol (ou de navigation), en nœuds : le seuil d'activité de la
   * session. Donné, une manœuvre classée dont la vitesse d'approche est en
   * dessous n'est pas comptée : demi-tour hors vol (`noFlight`), ni réussi ni
   * raté. Absent (bateau, sans seuil d'activité), tout demi-tour classé compte.
   */
  flightThresholdKn?: number;
  /**
   * Plancher d'arrêt, en nœuds (`stillThreshold` du profil) : un cap
   * d'approche ou de sortie lu plus lentement, planche arrêtée après une
   * chute, n'est que du bruit de position.
   */
  stillSpeedKn?: number;
}

/**
 * Genre d'une manœuvre comptée : virement, empannage, ou sens incertain, un
 * demi-tour vu en un seul pas de la trace (enregistreur économique qui s'est
 * tu pendant le virage) dont l'arc court et l'arc long sont tous deux
 * plausibles (`SHORT_ARC_DOUBT_DEG`). On connaît le cap avant et le cap après,
 * pas le chemin : la manœuvre est comptée sans nom ni direction, et
 * n'alimente pas le vent (`isDirected`). Décision de l'utilisateur du 31/10 :
 * aucune hypothèse, ni perte de vitesse ni déport latéral.
 */
export type ManeuverKind = 'tack' | 'jibe' | 'undecided';

export interface ManeuverLocation {
  lat: number;
  lon: number;
  type: ManeuverKind;
  /** Vrai si la vitesse minimale reste au seuil de réussite ou au-dessus. */
  success: boolean;
  /**
   * Vitesse minimale, en nœuds, du début de la rotation jusqu'au retour à
   * 90 % de la vitesse d'approche, et au plus 10 s après la rotation : le
   * creux d'un virement vient souvent une fois le nouveau cap pris. Lue sur
   * la vitesse non filtrée (`measureRotation`) : la médiane de 3 s comble les
   * creux en V.
   */
  vmin: number;
  /**
   * Vent local, en degrés : bissectrice des caps du virage (à l'opposé pour
   * un empannage). Pour un sens incertain, celle de l'arc court, jamais lue :
   * le vent ne lit que les manœuvres dirigées (`isDirected`).
   */
  localWind: number;
  /**
   * Repère de la manœuvre, près du point le plus lent vu par la détection.
   * Le classement y lit le vent : il reste donc celui de la détection, pour
   * que ni le classement ni le vent ne dépendent de la mesure (§10, point 21).
   */
  timeMs: number;
  trackIndex: number;
  /** Vrai si le vent local vient de caps stabilisés avant et après le virage. */
  stableHeadings: boolean;
  /**
   * Conservation et réussite telles que la détection les lit, pour la seule
   * estimation du vent (`maneuverAgreement`, `windSamplesFrom`), réglée sur
   * elles (§10, points 23 et 26). Les métriques affichées ne les remplacent
   * pas : l'orientation du vent tient à un seuil de conservation de 50 %, et
   * des virements de synthèse passés de 49 à 52 % par la mesure corrigée
   * suffisaient à la faire tourner de 90° (§10, point 70).
   */
  windCriteria: { conservation: number; success: boolean };

  /** Vitesse d'approche, en nœuds : médiane de la vitesse retenue de 12 s à 2 s avant la rotation. */
  entrySpeed: number;
  /**
   * Taux de conservation de la vitesse, de 0 à 1 : vitesse minimale sur
   * vitesse d'approche. Isole la qualité technique de la manœuvre de la force
   * du vent et de la vitesse de navigation.
   */
  conservation: number;
  /**
   * Temps de relance, en secondes : du point le plus lent au retour à 90 % de
   * la vitesse d'approche. `null` si la vitesse n'est pas revenue dans la
   * minute : chute, arrêt, ou sortie sur une allure plus lente. Long, il
   * signale une relance laborieuse en mode archimédien.
   */
  relaunchS: number | null;
  /**
   * Changement de cap, en degrés, du cap d'approche au cap de sortie. Un
   * virement qui s'ouvre à 120° au lieu de 90° a perdu du cap pour reprendre
   * le vol.
   */
  headingChange: number;
  /**
   * Distance parcourue du début de la rotation à la relance, ou à la fin de
   * la rotation si elle vient après, en mètres. `null` sans relance : une
   * manœuvre jamais relancée n'a pas de fin, et ne doit pas passer pour courte.
   */
  distanceM: number | null;
  /**
   * Gain au vent, en mètres, pendant la seule rotation : chemin parcouru vers
   * le vent retenu pour un virement, à l'opposé du vent pour un empannage.
   * Positif quand la manœuvre avance dans son sens, négatif quand elle recule.
   * `null` pour une manœuvre ratée, seul le gain des manœuvres réussies se
   * comparant, et pour un sens incertain, sans direction.
   */
  windwardGainM: number | null;
  /**
   * Indice du creux de la vitesse filtrée, d'où part la relance. `vmin` se lit
   * sur la vitesse non filtrée, dans la même fenêtre : son point peut différer.
   */
  apexIndex: number;
  /** Indices de trace du début de la rotation et de la sortie (relance, sinon fin de la rotation). */
  entryIndex: number;
  exitIndex: number;
  /**
   * Caps instantanés au début et à la fin du virage détecté. Bruités, donc
   * impropres à mesurer un angle fin, mais définis pour toutes les manœuvres,
   * y compris celles sans cap stabilisé : ils servent à juger la symétrie du
   * virage, c'est-à-dire la confiance à accorder à sa mesure du vent.
   */
  entryHeading: number;
  exitHeading: number;
  /** Tracé du début de la rotation à la sortie, pour la carte. */
  path: [number, number][];
}

/**
 * Virages écartés avant d'être comptés comme manœuvre, par motif. Sans ce
 * décompte, une session qui n'affiche aucune manœuvre ne dit pas lequel des
 * trois murs elle a touché : une trace de planche lente peut n'avoir aucune
 * manœuvre parce que le vent estimé est faux, ce qui range tous les demi-tours
 * « au travers », et rien à l'écran ne le laisse voir.
 */
export interface ManeuverRejections {
  /** Virage franc mais entamé sous la vitesse minimale d'entrée. */
  slowEntry: number;
  /** Rotation trop dispersée pour un virage : chute, hésitation. */
  incoherent: number;
  /** Cap d'approche ou de sortie lu sous le plancher d'arrêt : planche arrêtée, le cap n'est que du bruit de position. */
  still: number;
  /** Virage franc et net, mais dont la bissectrice ne tombe près d'aucun axe du vent. */
  unclassified: number;
  /** Cap franc, mais sur une distance trop courte pour qu'il veuille dire quelque chose. */
  tooShort: number;
  /** Tour complet (un 360) : ni virement ni empannage, jamais compté. */
  fullTurn: number;
  /** Demi-tour classé, mais entamé sous le seuil de vol (ou de navigation) : ni réussi ni raté. */
  noFlight: number;
}

/** Virage écarté, tel que la détection l'a vu : pour le diagnostic d'une session. */
export interface RejectedTurn {
  motif: keyof ManeuverRejections;
  /**
   * Instant et indice de trace : le déclenchement de la détection, ou le
   * repère de la manœuvre pour un tour complet et un demi-tour hors vol.
   */
  timeMs: number;
  trackIndex: number;
  /**
   * Virage, en degrés : du cap d'approche au cap de sortie quand la détection
   * l'a mesuré, sinon sommé pas à pas sur la fenêtre d'observation.
   */
  turnDeg: number;
  /** Vitesse, en nœuds : d'approche pour un demi-tour hors vol, au déclenchement sinon. */
  speedKn: number;
  /** Classement d'un demi-tour hors vol. */
  type?: 'tack' | 'jibe';
}

export interface ManeuverStats {
  tackSuccess: number;
  tackFail: number;
  jibeSuccess: number;
  jibeFail: number;
  /** Manœuvres de sens incertain : comptées, ni virements ni empannages, hors du % de réussite. */
  undecided: number;
  rejected: ManeuverRejections;
  /** Virages écartés, un par virage compté dans `rejected`, dans l'ordre de la trace. */
  rejectedTurns: RejectedTurn[];
  locations: ManeuverLocation[];
}

/**
 * Vent de référence pour classer les manœuvres : une valeur fixe, ou une
 * fonction du temps quand le vent a tourné au cours de la session.
 */
export type WindReference = number | ((timeMs: number) => number);

/** Vent de référence à l'instant `timeMs`. */
export const windAt = (wind: WindReference, timeMs: number): number =>
  typeof wind === 'function' ? wind(timeMs) : wind;

/** Tolérance minimale, en degrés, entre la bissectrice d'un virage et l'axe qu'il traverse. */
const CLASSIFICATION_TOLERANCE_DEG = 60;

/**
 * Classe un virage d'après sa bissectrice : proche du vent, c'est un
 * virement ; proche du vent arrière, un empannage ; au travers, une simple
 * abattée ou remontée. La tolérance vaut au moins 60°, ou la moitié du
 * virage, pour rester juste même si le vent de référence est un peu faux.
 */
const classifyTurn = (
  bisector: number,
  cumulativeTurn: number,
  windDir: number
): 'tack' | 'jibe' | null => {
  const tolerance = Math.max(CLASSIFICATION_TOLERANCE_DEG, Math.abs(cumulativeTurn) / 2);
  const toWind = Math.abs(angleDiff(bisector, windDir));
  const toDownwind = Math.abs(angleDiff(bisector, windDir + 180));
  if (toWind <= tolerance && toWind < toDownwind) return 'tack';
  if (toDownwind <= tolerance && toDownwind < toWind) return 'jibe';
  return null;
};

/** Nombre d'allers-retours entre polaire et manœuvres. */
const WIND_REFINEMENT_ITERATIONS = 2;
/** Trou maximal, en minutes, à travers lequel le vent local est interpolé entre deux manœuvres. */
export const WIND_LOCAL_MAX_GAP_MIN = 30;
/** Poids plancher de la polaire dans la fusion, même quand sa confiance est basse. */
const POLAR_MIN_WEIGHT = 0.3;
/** Nombre de manœuvres à partir duquel leur moyenne atteint son plein poids. */
const MANEUVERS_FOR_FULL_WEIGHT = 4;
/** Poids des manœuvres face à la polaire dans la fusion finale. */
const MANEUVER_WEIGHT = 2;

/**
 * Vrai pour une manœuvre dont on connaît le sens : virement ou empannage. Un
 * sens incertain n'alimente jamais le vent, ni sa mesure (`windSamplesFrom`,
 * `calculateWindStats`) ni son orientation (`maneuverAgreement`).
 */
export const isDirected = (m: ManeuverLocation): m is ManeuverLocation & { type: 'tack' | 'jibe' } =>
  m.type === 'tack' || m.type === 'jibe';

/** Manœuvres dont le vent local est exploitable : caps stabilisés de part et d'autre. */
export const windSamplesFrom = (stats: ManeuverStats): ManeuverLocation[] =>
  stats.locations.filter(
    (m) => isDirected(m) && m.stableHeadings && (m.type === 'tack' || (m.type === 'jibe' && m.windCriteria.success))
  );

/**
 * Accord entre un vent candidat et la physique des manœuvres qu'il classe.
 *
 * Avec le bon vent, un virage où le vol est perdu traverse l'axe du vent : il
 * est classé virement. Un virage qui conserve le vol traverse l'axe opposé :
 * empannage. Avec un vent faux de 180°, tout est inversé ; avec un vent faux
 * de 90°, les virages traversent les deux axes et ne sont plus classés du
 * tout. L'accord vaut donc 1 pour le bon vent et tend vers 0 pour les autres.
 *
 * Le vol perdu se juge sur la **conservation** lue par la détection
 * (`windCriteria`), la vitesse minimale rapportée à la vitesse d'entrée, et non
 * sur une vitesse absolue. Un seuil en nœuds est une valeur de wingfoil : sur
 * une session de planche lente, toute manœuvre passe en dessous, tout est lu
 * comme un virement et l'estimation part à l'opposé. Un rapport, lui, vaut la même chose à toutes les échelles — c'est
 * ce qui rend ce critère juste du bateau au kite.
 */
export const maneuverAgreement = (
  stats: ManeuverStats
): { agreement: number; count: number; consistent: number; inconsistent: number } => {
  const all = stats.locations.filter(isDirected);
  if (all.length === 0) return { agreement: 0, count: 0, consistent: 0, inconsistent: 0 };
  let consistent = 0;
  for (const m of all) {
    const lostFlight = m.windCriteria.conservation < ORIENTATION_MAX_CONSERVATION;
    if ((m.type === 'tack') === lostFlight) consistent++;
  }
  return {
    agreement: consistent / all.length,
    count: all.length,
    consistent,
    inconsistent: all.length - consistent,
  };
};

/**
 * Réglages de l'estimation du vent. Comme partout ailleurs dans le noyau,
 * aucun seuil n'est codé en dur ici : les valeurs viennent du profil du
 * support et de la surcharge de l'utilisateur.
 */
export interface WindEstimationOptions {
  /**
   * Vitesse minimale, en nœuds, pour qu'un cap alimente la polaire. Vient de
   * `defaultPolarMinSpeed` : 5 nœuds pour un wingfoil, 2 pour un bateau, qui
   * passerait sinon toute sa session sous la barre.
   */
  minSpeedKn?: number;
  /**
   * Seuil de réussite d'une manœuvre, en nœuds. Il décide si un empannage
   * alimente la mesure du vent (`windSamplesFrom`) ; les virements comptent de
   * toute façon. C'est le seuil d'activité effectif du module, surcharge
   * comprise, pour qu'il n'y ait qu'une notion de réussite dans l'application.
   */
  successThresholdKn?: number;
  /**
   * Vitesse minimale d'entrée d'un virage, en nœuds, accordée à l'allure de la
   * session. Sans elle, aucun virage d'une session lente n'est observé, et
   * l'orientation du vent n'a plus rien sur quoi s'appuyer.
   */
  minEntrySpeedKn?: number;
  /**
   * Seuil de vol (ou de navigation), en nœuds, des manœuvres : celles entamées
   * en dessous ne sont pas lues (`ManeuverOptions.flightThresholdKn`).
   */
  flightThresholdKn?: number;
  /** Plancher d'arrêt, en nœuds (`ManeuverOptions.stillSpeedKn`). */
  stillSpeedKn?: number;
  /**
   * Détection préparée une fois sur `points` (`prepareManeuverDetection`), à
   * classer par candidat et par passe ; absente, l'estimation la prépare
   * elle-même. Elle doit porter sur la même trace, avec les mêmes réglages de
   * détection (`minEntrySpeedKn`, `stillSpeedKn`), sans quoi elle est refusée.
   */
  detection?: ManeuverDetection;
  /**
   * Étage polaire préparé une fois sur `points` (`prepareWindPolar`), commun
   * à tous les seuils d'activité ; absent, l'estimation le prépare elle-même.
   * Il doit porter sur la même trace, avec la même vitesse plancher de la
   * polaire (`minSpeedKn`), sans quoi il est refusé.
   */
  polarStage?: WindPolarStage;
}

/**
 * Étage polaire de l'estimation : celui que les options apportent, vérifié
 * (même trace, même vitesse plancher), sinon préparé ici.
 */
const polarStageFor = (points: PointData[], options: WindEstimationOptions): WindPolarStage => {
  const minSpeedKn = options.minSpeedKn ?? WIND_ESTIMATION_MIN_SPEED_KN;
  const given = options.polarStage;
  if (!given) return prepareWindPolar(points, minSpeedKn);
  if (given.points !== points) throw new Error(`L'étage polaire préparé ne porte pas sur cette trace.`);
  if (given.minSpeedKn !== minSpeedKn) throw new Error(`L'étage polaire préparé n'a pas la vitesse plancher de cette estimation.`);
  return given;
};

/**
 * Détection à classer : celle que les options apportent, vérifiée (même
 * trace, mêmes réglages de détection), sinon préparée ici.
 */
const detectionFor = (points: PointData[], options: WindEstimationOptions): ManeuverDetection => {
  const detectionOptions: ManeuverDetectionOptions = {
    minEntrySpeedKn: options.minEntrySpeedKn,
    stillSpeedKn: options.stillSpeedKn,
  };
  const given = options.detection;
  if (!given) return prepareManeuverDetection(points, detectionOptions);
  if (given.points !== points) throw new Error('La détection préparée ne porte pas sur cette trace.');
  const expected = resolveDetectionSettings(detectionOptions);
  for (const key of Object.keys(expected) as (keyof DetectionSettings)[]) {
    if (given.settings[key] !== expected[key]) {
      throw new Error(`La détection préparée n'a pas le réglage ${key} de cette estimation.`);
    }
  }
  return given;
};

/** Réglages du classement, tirés de ceux de l'estimation du vent. */
const classificationOptions = (options: WindEstimationOptions): ManeuverClassificationOptions => ({
  successThresholdKn: options.successThresholdKn,
  flightThresholdKn: options.flightThresholdKn,
});

/** Direction retenue parmi les candidats de la polaire, et ce qui la qualifie. */
export interface CandidateSelection {
  direction: number;
  orientedBy: WindOrientationSource;
  /** Confiance polaire de la direction retenue : symétrie × couverture × netteté. */
  polarConfidence: number;
  /**
   * Accord de la direction retenue, `consistent - 2 × inconsistent`. Négatif,
   * il signale qu'aucun candidat ne convainc : la direction renvoyée est alors
   * le moins mauvais d'entre eux, et la confiance qui l'accompagne le dit.
   */
  agreementScore: number;
}

/**
 * Choisit, parmi les centres d'angle mort proposés par la polaire, celui dont
 * le classement des manœuvres colle le mieux à la physique : vol perdu au
 * virement, conservé à l'empannage.
 *
 * Un classement incohérent pèse double en négatif : un candidat faux de 30° à
 * 40° attrape des abattées et des remontées comme fausses manœuvres, et
 * gagnerait sinon au nombre. À égalité, l'ordre des candidats, donc le score
 * polaire, départage.
 *
 * Chaque direction testée porte son propre descripteur, jumeau au vent arrière
 * compris : la confiance renvoyée est toujours celle de la direction renvoyée,
 * y compris quand l'accord des manœuvres est mauvais.
 */
export const selectWindCandidate = (
  points: PointData[],
  polar: WindEstimate,
  options: WindEstimationOptions = {}
): CandidateSelection => {
  const fallback: CandidateSelection = {
    direction: polar.direction,
    orientedBy: polar.orientedBy,
    polarConfidence: polar.confidence,
    agreementScore: 0,
  };
  if (points.length === 0) return fallback;
  const detection = detectionFor(points, options);
  const classification = classificationOptions(options);

  // Candidats : les maxima du score, plus l'opposé du meilleur, jumeau au
  // vent arrière que seules les manœuvres peuvent écarter avec certitude.
  const stage = polarStageFor(points, options);
  const candidates = [...stage.candidates];
  if (candidates.length === 0) return fallback;
  const twin = normalizeDeg(candidates[0].direction + 180);
  if (candidates.every((c) => Math.abs(angleDiff(c.direction, twin)) >= CANDIDATE_MIN_SEPARATION)) {
    candidates.push(stage.describe(twin));
  }

  let chosen: PolarWindEstimate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const stats = classifyManeuvers(detection, candidate.direction, classification);
    const { count, consistent, inconsistent } = maneuverAgreement(stats);
    if (count === 0) continue;
    const score = consistent - 2 * inconsistent;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      chosen = candidate;
    }
  }

  if (chosen === null) return fallback;
  const agreementScore = bestScore;
  if (chosen.direction === polar.direction) return { ...fallback, agreementScore };

  // Les manœuvres ont désigné une autre direction que le meilleur score
  // polaire : ce sont elles qui ont orienté, et la confiance annoncée est
  // celle de ce candidat. Un accord négatif ne change pas la direction, qui
  // reste choisie par comparaison, mais il abaisse la confiance affichée au
  // lieu de laisser croire à celle d'une direction qui n'a pas été retenue.
  return {
    direction: chosen.direction,
    orientedBy: 'virages',
    polarConfidence: chosen.symmetry * chosen.coverage * chosen.clarity,
    agreementScore,
  };
};

/**
 * Estimation du vent sur toute la trace, par aller-retour entre la polaire et
 * les manœuvres.
 *
 * 1. La polaire propose quelques centres d'angle mort candidats.
 * 2. Chaque candidat classe les manœuvres ; on retient celui dont le
 *    classement est le plus cohérent avec la perte du vol : vol perdu au
 *    virement, conservé à l'empannage. Sans manœuvre, le meilleur score
 *    polaire l'emporte, orienté comme avant.
 * 3. Les vents locaux des manœuvres, bissectrices des caps stabilisés, sont
 *    fusionnés avec la polaire, et le vent obtenu reclasse les manœuvres.
 *    Deux passes suffisent.
 *
 * La polaire ancre l'estimation, les manœuvres l'affinent : l'angle mort a
 * une résolution de quelques degrés, les bissectrices de virement sont plus
 * fines mais dépendent du vent utilisé pour les classer.
 */
export const estimateWind = (
  points: PointData[],
  options: WindEstimationOptions = {}
): WindEstimate => {
  // L'étage polaire et la détection sont préparés une fois, pour les candidats et les deux passes.
  const polarStage = polarStageFor(points, options);
  const polar = polarStage.polar;
  if (points.length === 0) return polar;

  const detection = detectionFor(points, options);
  const classification = classificationOptions(options);
  const selection = selectWindCandidate(points, polar, { ...options, detection, polarStage });
  const orientedBy = selection.orientedBy;
  const polarConfidence = selection.polarConfidence;
  let direction = selection.direction;

  const anchor = direction;
  let maneuverCount = 0;
  let maneuverConfidence = 0;
  let wind: WindReference = direction;

  for (let iteration = 0; iteration < WIND_REFINEMENT_ITERATIONS; iteration++) {
    const samples = windSamplesFrom(classifyManeuvers(detection, wind, classification));
    if (samples.length === 0) break;

    const { mean, R } = circularMean(samples.map((m) => m.localWind));
    maneuverCount = samples.length;
    maneuverConfidence = R * Math.min(1, samples.length / MANEUVERS_FOR_FULL_WEIGHT);

    // Les bissectrices de manœuvres sont plus fines que l'angle mort : elles
    // pèsent double face à la polaire, qui reste l'ancre.
    const polarWeight = Math.max(POLAR_MIN_WEIGHT, polarConfidence);
    direction = circularMean([anchor, mean], [polarWeight, MANEUVER_WEIGHT * maneuverConfidence]).mean;

    // Passe suivante : chaque manœuvre est classée avec le vent local de son
    // instant, ce qui tient compte d'une bascule au cours de la session.
    wind = buildWindTimeline(
      samples.map((m) => ({ timeMs: m.timeMs, direction: m.localWind })),
      direction,
      WIND_LOCAL_MAX_GAP_MIN * 60 * 1000
    );
  }

  // Trace clairsemée (enregistreur économique) : la polaire comme les caps
  // stabilisés sont lus sur des cordes qui traversent les virages, et la
  // confiance annoncée se rabat sur le soutien de la trace (`polarSampling`),
  // jusqu'à demander le vent à l'utilisateur. Les poids ci-dessus n'en
  // tiennent pas compte : la direction reste la même, seule la confiance baisse.
  const confidence = Math.max(polarConfidence, maneuverConfidence * 0.9) * polarStage.sampling;

  return {
    direction: roundBearingDeg(direction),
    confidence,
    reliable: confidence >= WIND_CONFIDENCE_MIN,
    orientedBy,
    maneuverCount,
  };
};

// ---------------------------------------------------------------------------
// Caps stabilisés autour d'un virage
// ---------------------------------------------------------------------------

/** Recul et avance maximaux, en secondes, pour chercher un cap stabilisé. */
const STABLE_SEARCH_S = 20;
/**
 * Marge, en secondes, laissée autour du cœur du virage avant de chercher un
 * cap stabilisé : protège la précision du cap moyen calculé (`heading`)
 * contre le flottement de sortie de virage (accélération, cap pas encore
 * posé). Deux essais pour capter des manœuvres plus rapprochées (réduire
 * cette marge, puis seulement la durée ci-dessous) ont fait baisser le
 * nombre total de manœuvres détectées au lieu de l'augmenter — un cap moyen
 * même légèrement décalé peut suffire à faire sortir un virage limite de la
 * tolérance de classement (`classifyTurn`), qui le fait alors disparaître
 * entièrement plutôt que de simplement l'exclure de la courbe de vent.
 * Revenu aux valeurs d'origine ; voir `docs/HISTORIQUE.md`, point 21, pour
 * le détail avant de retenter un réglage.
 */
const STABLE_MARGIN_S = 4;
/** Durée minimale d'un segment stabilisé, en secondes. */
const STABLE_MIN_DURATION_S = 5;
/** Vitesse de rotation maximale d'un cap stabilisé, en degrés par seconde. */
const STABLE_MAX_RATE_DEG_S = 3;
/**
 * Repli quand aucun segment n'est assez droit (un wing à 1 Hz ne tient jamais
 * 3°/s d'un point au suivant) : la fenêtre médiane d'approche ou de sortie du
 * virage (`turnHeadings`) passe pour un cap stabilisé si aucun de ses caps ne
 * s'écarte de plus de 25° de sa médiane, et si elle dure au moins 4 s.
 */
const STABLE_MEDIAN_SPREAD_DEG = 25;
const STABLE_MEDIAN_MIN_DURATION_S = 4;

interface StableSegment {
  /** Cap moyen du segment. */
  heading: number;
  /** Vitesse moyenne du segment, en nœuds. */
  meanSpeed: number;
}

/**
 * Segment stabilisé situé avant (`direction` = -1) ou après (`direction` = +1)
 * un instant donné, ou `null` si aucun segment assez long et assez droit
 * n'existe dans la zone de recherche. Exporté pour son test à 1 et 5 Hz.
 *
 * La vitesse de rotation se lit par pas d'au moins `TURN_STRIDE_MIN_S`
 * (règle 2) : d'un point au suivant, 1° de bruit sur 0,2 s faisait 5°/s à
 * 5 Hz, au-dessus des 3°/s admis, et le segment n'existait presque jamais sur
 * un fichier dense. Les points d'un pas sont validés ensemble quand le pas
 * passe, abandonnés ensemble sinon ; un reste plus court qu'un pas est
 * abandonné. À 1 Hz, un pas est un point : rien ne change.
 */
export const stableSegment = (
  points: PointData[],
  fromIndex: number,
  direction: -1 | 1
): StableSegment | null => {
  const originMs = points[fromIndex].timeMs;
  const marginMs = STABLE_MARGIN_S * 1000;
  const searchMs = STABLE_SEARCH_S * 1000;

  const bearings: number[] = [];
  let speedSum = 0;
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  const accept = (p: PointData): void => {
    bearings.push(p.bearing);
    speedSum += p.smoothedSpeed;
    if (firstMs === null) firstMs = p.timeMs;
    lastMs = p.timeMs;
  };
  /** Dernier point validé, d'où part le pas en cours. */
  let anchor: PointData | null = null;
  /** Points du pas en cours, en attente du premier qui le clôt. */
  const pending: PointData[] = [];

  // On part du virage et on s'en éloigne : le segment retenu est le plus
  // proche du virage, et il s'arrête au premier changement de cap franc.
  for (let k = fromIndex; k >= 0 && k < points.length; k += direction) {
    const p = points[k];
    const elapsed = Math.abs(p.timeMs - originMs);
    if (elapsed > searchMs) break;
    if (elapsed < marginMs) continue;

    if (anchor === null) {
      accept(p);
      anchor = p;
      continue;
    }
    pending.push(p);
    const dt = Math.abs(p.timeMs - anchor.timeMs) / 1000;
    if (dt < TURN_STRIDE_MIN_S) continue;
    if (Math.abs(angleDiff(p.bearing, anchor.bearing)) / dt > STABLE_MAX_RATE_DEG_S) break;
    for (const q of pending) accept(q);
    pending.length = 0;
    anchor = p;
  }

  if (bearings.length < 2 || firstMs === null || lastMs === null) return null;
  if (Math.abs(lastMs - firstMs) / 1000 < STABLE_MIN_DURATION_S) return null;
  return { heading: circularMean(bearings).mean, meanSpeed: speedSum / bearings.length };
};

// ---------------------------------------------------------------------------
// Mesure d'une manœuvre classée
// ---------------------------------------------------------------------------

/** Délai maximal, en secondes, pour retrouver la vitesse après le point le plus lent. */
const RELAUNCH_MAX_S = 60;
/** Part de la vitesse d'approche à retrouver pour considérer la relance acquise. */
const RELAUNCH_RATIO = 0.9;
/** Durée, en secondes, avant le déclenchement de la détection, sur laquelle se lit le cap d'approche. */
const APPROACH_HEADING_S = 4;
/**
 * Fenêtre, en secondes après la fin du virage détecté, sur laquelle se lit le
 * cap de sortie. Elle commence un peu après : la détection arrête le virage au
 * premier pas de cap hésitant, parfois avant que le nouveau cap soit pris.
 */
const EXIT_HEADING_FROM_S = 2;
const EXIT_HEADING_TO_S = 8;
/**
 * Écart au cap d'approche, puis au cap de sortie, qui borne la rotation : le
 * plus grand de 10° et d'un dixième du virage. Plus serré, le bruit du cap
 * suffirait à ouvrir la rotation avant l'heure.
 */
const ROTATION_EDGE_MIN_DEG = 10;
const ROTATION_EDGE_SHARE = 0.1;
/** Fenêtre, en secondes avant la rotation, sur laquelle se lit la vitesse d'approche. */
const APPROACH_SPEED_FROM_S = 12;
const APPROACH_SPEED_TO_S = 2;
/** Recherche du point le plus lent au-delà de la rotation, en secondes. */
const APEX_SEARCH_AFTER_S = 10;
/**
 * Demi-largeur, en millisecondes, de la moyenne centrée qui lit la vitesse non
 * filtrée au creux d'une manœuvre : la moitié d'un pas de lecture
 * (`TURN_STRIDE_MIN_S`, règle 2). À 1 Hz, gigue de 998 ms comprise, le point
 * seul ; à 5 Hz, les cinq points de sa seconde, dont le bruit indépendant
 * creuserait sinon le minimum à chaque point de plus.
 */
const RAW_SPEED_HALF_WINDOW_MS = (TURN_STRIDE_MIN_S * 1000) / 2;

/** Vitesse non filtrée au point `k`, en nœuds, moyennée sur ±`RAW_SPEED_HALF_WINDOW_MS`. */
const rawSpeedAround = (points: PointData[], k: number): number => {
  const centerMs = points[k].timeMs;
  let sum = rawSpeedKn(points[k]);
  let count = 1;
  for (let m = k - 1; m >= 0 && centerMs - points[m].timeMs <= RAW_SPEED_HALF_WINDOW_MS; m--) {
    sum += rawSpeedKn(points[m]);
    count++;
  }
  for (let m = k + 1; m < points.length && points[m].timeMs - centerMs <= RAW_SPEED_HALF_WINDOW_MS; m++) {
    sum += rawSpeedKn(points[m]);
    count++;
  }
  return sum / count;
};

/**
 * Départ du cœur d'un virage tournant dans le sens `turnSign`, entre les
 * points `from` et `to` : la suite de pas consécutifs tournant à
 * `minRateDegS` au moins qui cumule le plus de virage, ou `null` s'il n'y en a
 * aucune. Les pas se prennent d'au moins `TURN_STRIDE_MIN_S` (`strideEnd`,
 * règle 2) : à 5 Hz, un pas bruité de 0,2 s ne coupe pas une suite qu'il ne
 * couperait pas à 1 Hz, et à 1 Hz un pas de 998 ms de gigue n'en avale pas deux.
 */
const turnCoreStart = (
  points: PointData[],
  from: number,
  to: number,
  turnSign: number,
  minRateDegS: number
): number | null => {
  let best: number | null = null;
  let bestTurn = 0;
  let runStart: number | null = null;
  let runTurn = 0;
  let k = from;
  while (k < to) {
    const next = strideEnd(points, k, to);
    const step = turnSign * angleDiff(points[next].bearing, points[k].bearing);
    const dtS = (points[next].timeMs - points[k].timeMs) / 1000;
    if (step > 0 && step >= minRateDegS * Math.max(dtS, 0)) {
      if (runStart === null) {
        runStart = k;
        runTurn = 0;
      }
      runTurn += step;
      if (runTurn > bestTurn) {
        bestTurn = runTurn;
        best = runStart;
      }
    } else {
      runStart = null;
    }
    k = next;
  }
  return best;
};

/** Cap lu en médiane sur une fenêtre de la trace, déroulé avec le virage. */
interface HeadingWindow {
  /** Médiane des caps déroulés de la fenêtre, en degrés, non ramenée à [0, 360[. */
  heading: number;
  /**
   * Écart maximal, en degrés, à la médiane du cap d'un pas d'au moins
   * `TURN_STRIDE_MIN_S` de la fenêtre (`strideHeadings`), jamais d'un point.
   */
  spreadDeg: number;
  /** Durée couverte, en secondes, du premier au dernier point de la fenêtre. */
  durationS: number;
  /** Vitesse moyenne de la fenêtre, en nœuds. */
  meanSpeed: number;
}

/** Caps d'approche et de sortie d'un virage, sur une même chaîne de caps déroulés. */
interface TurnHeadings {
  /** Premier et dernier points lus. */
  first: number;
  last: number;
  /** Cap déroulé au point `k`, de `first` à `last`. */
  headingAt: (k: number) => number;
  approach: HeadingWindow;
  exit: HeadingWindow;
}

/**
 * Caps des pas d'au moins `TURN_STRIDE_MIN_S` (`strideEnd`, règle 2) des points
 * `from` à `to`, lus sur la chaîne de caps déroulés `headingAt` : un pas plus
 * court en fin de fenêtre reste un pas. Le cap d'un pas est la moyenne des
 * caps de ses points pondérée par la distance de leur pas (`stepDistanceM`),
 * soit à peu près celui de sa corde ; moyenne simple sans distance. À 1 Hz,
 * un pas est un point, et son cap celui du point. À 5 Hz, le bruit
 * indépendant d'un point à l'autre faisait monter l'écart d'une fenêtre lue
 * point à point de 21° à 29°, au-delà des 25° admis (n° 49).
 */
const strideHeadings = (
  points: PointData[],
  from: number,
  to: number,
  headingAt: (k: number) => number
): number[] => {
  const headings: number[] = [];
  const strideMs = TURN_STRIDE_MIN_S * 1000;
  for (let k = from; k <= to; ) {
    let next = k < to ? strideEnd(points, k, to) : to + 1;
    if (next === to && points[to].timeMs - points[k].timeMs < strideMs) next = to + 1;
    if (next === k + 1) {
      headings.push(headingAt(k));
    } else {
      let weighted = 0;
      let weightSum = 0;
      let plain = 0;
      for (let m = k; m < next; m++) {
        const w = stepDistanceM(points, m);
        weighted += w * headingAt(m);
        weightSum += w;
        plain += headingAt(m);
      }
      headings.push(weightSum > 0 ? weighted / weightSum : plain / (next - k));
    }
    k = next;
  }
  return headings;
};

/**
 * Caps d'approche et de sortie d'un virage, en médiane des caps déroulés :
 * approche sur les `APPROACH_HEADING_S` qui précèdent `startIndex` (lui
 * compris), sortie de `EXIT_HEADING_FROM_S` à `EXIT_HEADING_TO_S` après
 * `endIndex` (à défaut, le cap à `endIndex`). Le bruit du cap ne les déplace
 * pas. Les caps sont déroulés pas à pas par l'arc court, d'un bout à l'autre :
 * l'écart des deux compte tout le virage, un tour complet valant 360°.
 *
 * Forcer le sens du virage sur un pas voisin de 180° n'aide pas : un virage vu
 * en un seul pas tient déjà son sens de ce pas, et sur une planche arrêtée,
 * où le cap saute d'un bord à l'autre, cela empilait les tours (385°).
 */
const turnHeadings = (points: PointData[], startIndex: number, endIndex: number): TurnHeadings => {
  const startMs = points[startIndex].timeMs;
  const endMs = points[endIndex].timeMs;
  let first = startIndex;
  while (first > 0 && points[first - 1].timeMs >= startMs - APPROACH_HEADING_S * 1000) first--;
  let last = endIndex;
  while (last + 1 < points.length && points[last + 1].timeMs <= endMs + EXIT_HEADING_TO_S * 1000) last++;
  const unwrapped = [points[first].bearing];
  for (let k = first + 1; k <= last; k++) {
    unwrapped.push(unwrapped[unwrapped.length - 1] + angleDiff(points[k].bearing, points[k - 1].bearing));
  }
  const headingAt = (k: number): number => unwrapped[k - first];

  const windowOf = (from: number, to: number): HeadingWindow => {
    const headings: number[] = [];
    let speedSum = 0;
    for (let k = from; k <= to; k++) {
      headings.push(headingAt(k));
      speedSum += points[k].smoothedSpeed;
    }
    const heading = median(headings);
    let spreadDeg = 0;
    for (const h of strideHeadings(points, from, to, headingAt)) spreadDeg = Math.max(spreadDeg, Math.abs(h - heading));
    return {
      heading,
      spreadDeg,
      durationS: (points[to].timeMs - points[from].timeMs) / 1000,
      meanSpeed: speedSum / headings.length,
    };
  };

  let exitFrom = endIndex;
  while (exitFrom <= last && points[exitFrom].timeMs < endMs + EXIT_HEADING_FROM_S * 1000) exitFrom++;
  return {
    first,
    last,
    headingAt,
    approach: windowOf(first, startIndex),
    exit: exitFrom <= last ? windowOf(exitFrom, last) : windowOf(endIndex, endIndex),
  };
};

/**
 * Fenêtre médiane tenue pour cap stabilisé (repli de `stableSegment`), ou
 * `null` si ses caps s'écartent trop de leur médiane ou si elle est trop courte.
 */
const medianStableSegment = (window: HeadingWindow): StableSegment | null =>
  window.durationS >= STABLE_MEDIAN_MIN_DURATION_S && window.spreadDeg <= STABLE_MEDIAN_SPREAD_DEG
    ? { heading: normalizeDeg(window.heading), meanSpeed: window.meanSpeed }
    : null;

/** Virage détecté et classé, tel que la mesure le reçoit. */
export interface DetectedTurn {
  /** Point où la détection s'est déclenchée, quelques secondes avant le virage. */
  triggerIndex: number;
  /** Dernier point où le cap tournait encore franchement dans le sens du virage. */
  endIndex: number;
  /** Sens du virage : 1 à droite, −1 à gauche. */
  turnSign: number;
  type: 'tack' | 'jibe';
}

/** Mesures d'une manœuvre, définies comme les champs de même nom de `ManeuverLocation`. */
export interface ManeuverMeasure {
  /** Dernier point encore au cap d'approche : la rotation part de là. */
  rotationStartIndex: number;
  /** Premier point au cap de sortie : la rotation s'achève là. */
  rotationEndIndex: number;
  apexIndex: number;
  exitIndex: number;
  entrySpeed: number;
  vmin: number;
  conservation: number;
  relaunchS: number | null;
  headingChange: number;
  distanceM: number | null;
  /** Gain au vent pendant la rotation, en mètres, que la manœuvre soit réussie ou non. */
  gainM: number;
}

/**
 * Premier point, après le plus lent, où la vitesse retrouve 90 % de la
 * vitesse d'approche. `null` si cela n'arrive pas dans le délai.
 */
const findRelaunch = (points: PointData[], apexIndex: number, entrySpeed: number): number | null => {
  const target = RELAUNCH_RATIO * entrySpeed;
  const deadlineMs = points[apexIndex].timeMs + RELAUNCH_MAX_S * 1000;
  for (let k = apexIndex; k < points.length && points[k].timeMs <= deadlineMs; k++) {
    if (points[k].smoothedSpeed >= target) return k;
  }
  return null;
};

/**
 * Distance du pas qui arrive au point `k`, en mètres : celle du noyau
 * (`stepDistanceM`, règle 6 : vitesse retenue × durée, bornée par la corde
 * × 1,5 sur un trou de la trace), la même que la distance de la session. Le
 * pas qui reprend après une pause de l'enregistrement (`segmentStart`) ne
 * compte pas : rien n'y a été parcouru. Repli, pour une trace synthétique
 * posée à la main sans distance de pas : la vitesse lissée × durée.
 */
const stepDistanceM = (points: PointData[], k: number): number => {
  if (k <= 0 || points[k].segmentStart) return 0;
  const given = points[k].stepDistanceM;
  if (given !== undefined) return given;
  const dt = (points[k].timeMs - points[k - 1].timeMs) / 1000;
  return dt > 0 ? knotsToMs(points[k].smoothedSpeed) * dt : 0;
};

/** Distance parcourue entre deux indices, en mètres : somme des pas (`stepDistanceM`). */
const distanceBetween = (points: PointData[], from: number, to: number): number => {
  let meters = 0;
  for (let k = from + 1; k <= to; k++) meters += stepDistanceM(points, k);
  return meters;
};

/**
 * Chemin parcouru projeté sur une direction entre deux instants, en mètres :
 * somme des pas (`stepDistanceM`) fois le cosinus de l'écart entre la route et
 * cette direction, comme `distanceBetween`, les intervalles au bord n'étant
 * comptés que pour leur part de durée. Un virage compressé dans un seul
 * intervalle compte par la route de cet intervalle, sa corde. Les intervalles
 * lus vont du point `from` au point `to`, qui doivent encadrer les deux instants.
 */
const distanceAlongBetween = (
  points: PointData[],
  from: number,
  to: number,
  fromMs: number,
  toMs: number,
  directionDeg: number
): number => {
  let meters = 0;
  for (let k = Math.max(1, from); k <= to; k++) {
    if (points[k].segmentStart) continue;
    const dtS = (points[k].timeMs - points[k - 1].timeMs) / 1000;
    const overlapS = (Math.min(points[k].timeMs, toMs) - Math.max(points[k - 1].timeMs, fromMs)) / 1000;
    if (!(overlapS > 0) || !(dtS > 0)) continue;
    const given = points[k].stepDistanceM;
    // Même repli que `stepDistanceM`, écrit tel quel pour rendre les mêmes flottants qu'avant sur une trace synthétique.
    const share = given !== undefined ? (given * overlapS) / dtS : knotsToMs(points[k].smoothedSpeed) * overlapS;
    meters += share * Math.cos(toRad(angleDiff(points[k].bearing, directionDeg)));
  }
  return meters;
};

/**
 * Instant où l'écart de cap franchit `edge`, entre l'intervalle qui arrive au
 * point `k` et celui qui arrive au point `k + 1`. Le cap d'un intervalle est
 * celui de sa corde : il vaut au milieu de l'intervalle, et c'est là qu'on le
 * place. Sans cela, une borne tombait à 1 Hz sur la seconde entière d'après,
 * et le gain d'un virage de 5 s variait de près de 20 % entre 1 Hz et 5 Hz.
 */
const crossingMs = (points: PointData[], k: number, fromDeg: number, toDeg: number, edge: number): number => {
  const fromMid = k > 0 ? (points[k - 1].timeMs + points[k].timeMs) / 2 : points[k].timeMs;
  const toMid = (points[k].timeMs + points[k + 1].timeMs) / 2;
  const ratio = toDeg === fromDeg ? 0 : (edge - fromDeg) / (toDeg - fromDeg);
  return fromMid + Math.min(1, Math.max(0, ratio)) * (toMid - fromMid);
};

/**
 * Mesure une manœuvre que la détection a trouvée et classée.
 *
 * La détection se déclenche plusieurs secondes avant le virage et l'arrête au
 * premier pas de cap hésitant : ses bornes suffisent à classer, pas à mesurer.
 * Prises telles quelles, elles faisaient commencer la manœuvre en pleine
 * approche (5 s trop tôt en médiane sur une trace bruitée) et la finissaient
 * au point le plus lent, parfois au milieu du virage. La rotation est donc
 * rebornée sur le cap lui-même : elle commence quand le cap quitte celui
 * d'approche et s'achève quand il atteint celui de sortie, deux caps lus en
 * médiane, que le bruit ne déplace pas.
 *
 * Tout le reste en découle : la vitesse d'approche, lue avant la rotation et
 * non à son premier point, où le rider a souvent déjà ralenti ; le point le
 * plus lent, cherché sur toute la rotation et au-delà ; la relance, la
 * distance et le gain au vent.
 */
export const measureManeuver = (points: PointData[], turn: DetectedTurn, windDeg: number): ManeuverMeasure => {
  const { triggerIndex, endIndex, turnSign, type } = turn;
  const rotation = measureRotation(points, triggerIndex, endIndex, turnSign, turnHeadings(points, triggerIndex, endIndex));
  const { rotationStartMs: _startMs, rotationEndMs: _endMs, ...measure } = rotation;
  return { ...measure, gainM: windwardGainM(points, rotation, type, windDeg) };
};

/** Mesures d'une manœuvre qui ne dépendent pas du vent : tout sauf le gain au vent. */
export interface RotationMeasure extends Omit<ManeuverMeasure, 'gainM'> {
  /** Instants où le cap quitte celui d'approche et atteint celui de sortie, pour le gain au vent. */
  rotationStartMs: number;
  rotationEndMs: number;
}

/**
 * Gain au vent d'une rotation mesurée, en mètres : vers le vent pour un
 * virement, à l'opposé pour un empannage, chacun compté dans le sens où il
 * fait avancer. Seule mesure qui lise le vent : elle se refait par candidat,
 * sur une rotation mesurée une fois.
 */
export const windwardGainM = (points: PointData[], rotation: RotationMeasure, type: 'tack' | 'jibe', windDeg: number): number => {
  const gainDirection = type === 'tack' ? windDeg : windDeg + 180;
  return distanceAlongBetween(
    points,
    rotation.rotationStartIndex,
    rotation.rotationEndIndex,
    rotation.rotationStartMs,
    rotation.rotationEndMs,
    gainDirection
  );
};

/**
 * Mesure de la rotation d'un virage détecté, du cap d'approche au cap de
 * sortie (`headings`, lus sur `triggerIndex` et `endIndex`), sans le vent ni
 * le type : ce que `measureManeuver` fait, le gain au vent mis à part.
 */
export const measureRotation = (
  points: PointData[],
  triggerIndex: number,
  endIndex: number,
  turnSign: number,
  headings: TurnHeadings
): RotationMeasure => {
  // Cap déroulé, du cap d'approche au cap de sortie, lus en médiane.
  const { first, last, headingAt, approach, exit } = headings;
  const approachHeading = approach.heading;
  const exitHeading = exit.heading;
  /** Changement de cap compté dans le sens du virage. */
  const turned = turnSign * (exitHeading - approachHeading);

  // Bornes de la rotation, cherchées de part et d'autre du milieu du virage.
  // Des caps d'approche et de sortie trop proches, ou qui contredisent le sens
  // du virage, ne bornent rien : on garde alors celles de la détection.
  let rotationStart = triggerIndex;
  let rotationEnd = endIndex;
  let rotationStartMs = points[rotationStart].timeMs;
  let rotationEndMs = points[rotationEnd].timeMs;
  if (turned > 2 * ROTATION_EDGE_MIN_DEG) {
    const edge = Math.max(ROTATION_EDGE_MIN_DEG, ROTATION_EDGE_SHARE * turned);
    /** Cap tourné depuis le cap d'approche, dans le sens du virage. */
    const turnedAt = (k: number): number => turnSign * (headingAt(k) - approachHeading);
    let middle = -1;
    for (let k = triggerIndex; k <= last && middle < 0; k++) {
      if (turnedAt(k) >= turned / 2) middle = k;
    }
    if (middle > first) {
      let start = first;
      for (let k = middle; k >= first; k--) {
        if (turnedAt(k) <= edge) { start = k; break; }
      }
      let end = last;
      for (let k = middle; k <= last; k++) {
        if (turned - turnedAt(k) <= edge) { end = k; break; }
      }
      if (end > start && start < middle) {
        rotationStart = start;
        rotationEnd = end;
        rotationStartMs = crossingMs(points, start, turnedAt(start), turnedAt(start + 1), edge);
        rotationEndMs = crossingMs(points, end - 1, turnedAt(end - 1), turnedAt(end), turned - edge);
      }
    }
  }

  // Vitesse d'approche, lue avant la rotation : à son premier point, le rider
  // a souvent déjà ralenti, et la manœuvre passait pour parfaite.
  const startMs = points[rotationStart].timeMs;
  const approachSpeeds: number[] = [];
  for (let k = rotationStart - 1; k >= 0 && points[k].timeMs >= startMs - APPROACH_SPEED_FROM_S * 1000; k--) {
    if (points[k].timeMs <= startMs - APPROACH_SPEED_TO_S * 1000) approachSpeeds.push(points[k].smoothedSpeed);
  }
  const entrySpeed = approachSpeeds.length > 0 ? median(approachSpeeds) : points[rotationStart].smoothedSpeed;

  // Point le plus lent : sur toute la rotation, puis au-delà tant que la
  // vitesse n'est pas revenue, le creux d'un virement venant souvent une fois
  // le nouveau cap pris. Le creux de la vitesse filtrée borne la fenêtre et
  // fait partir la relance ; la vitesse minimale se lit, dans la même
  // fenêtre, sur la vitesse non filtrée, que la médiane de 3 s ne remonte pas
  // (creux en V : conservation surestimée de 0,05 à 0,1). Le plus bas des
  // deux, pour qu'une trace sans vitesse non filtrée ne change pas.
  const recoveredSpeed = RELAUNCH_RATIO * entrySpeed;
  const apexSearchEndMs = points[rotationEnd].timeMs + APEX_SEARCH_AFTER_S * 1000;
  let apexIndex = rotationStart;
  let rawMin = rawSpeedAround(points, rotationStart);
  for (let k = rotationStart + 1; k < points.length && points[k].timeMs <= apexSearchEndMs; k++) {
    if (k > rotationEnd && points[k].smoothedSpeed >= recoveredSpeed) break;
    if (points[k].smoothedSpeed < points[apexIndex].smoothedSpeed) apexIndex = k;
    rawMin = Math.min(rawMin, rawSpeedAround(points, k));
  }
  const vmin = Math.min(rawMin, points[apexIndex].smoothedSpeed);

  const relaunchIndex = entrySpeed > 0 ? findRelaunch(points, apexIndex, entrySpeed) : null;
  const exitIndex = relaunchIndex === null ? rotationEnd : Math.max(rotationEnd, relaunchIndex);

  return {
    rotationStartIndex: rotationStart,
    rotationEndIndex: rotationEnd,
    rotationStartMs,
    rotationEndMs,
    apexIndex,
    exitIndex,
    entrySpeed,
    vmin,
    conservation: entrySpeed > 0 ? Math.min(1, vmin / entrySpeed) : 0,
    relaunchS: relaunchIndex === null ? null : (points[relaunchIndex].timeMs - points[apexIndex].timeMs) / 1000,
    headingChange: Math.abs(exitHeading - approachHeading),
    distanceM: relaunchIndex === null ? null : distanceBetween(points, rotationStart, exitIndex),
  };
};

// ---------------------------------------------------------------------------
// Détection des virages, une fois par trace ; classement, par vent
// ---------------------------------------------------------------------------

/** Réglages de la détection, résolus : ceux de `ManeuverOptions` que le vent ne touche pas. */
export interface DetectionSettings {
  minEntrySpeedKn: number;
  windowMs: number;
  maxStepMs: number;
  minDistanceM: number;
  minCoherence: number;
  fullTurnDeg: number;
  coreRateDegS: number;
  stillSpeedKn: number;
  minTurnDeg: number;
}

/** Réglages de la seule détection, parmi `ManeuverOptions`. */
export type ManeuverDetectionOptions = Pick<
  ManeuverOptions,
  'minEntrySpeedKn' | 'windowSeconds' | 'maxStepSeconds' | 'minDistanceM' | 'minCoherence' | 'fullTurnDeg' | 'coreRateDegS' | 'stillSpeedKn' | 'minTurnDeg'
>;

/** Réglages du seul classement, parmi `ManeuverOptions` : ceux qui vont avec le vent. */
export type ManeuverClassificationOptions = Pick<ManeuverOptions, 'successThresholdKn' | 'flightThresholdKn' | 'cooldownSeconds'>;

const resolveDetectionSettings = (options: ManeuverDetectionOptions): DetectionSettings => ({
  minEntrySpeedKn: options.minEntrySpeedKn ?? MANEUVER_MIN_ENTRY_SPEED_KN,
  windowMs: (options.windowSeconds ?? MANEUVER_WINDOW_S) * 1000,
  maxStepMs: (options.maxStepSeconds ?? MANEUVER_MAX_STEP_S) * 1000,
  minDistanceM: options.minDistanceM ?? MANEUVER_MIN_DISTANCE_M,
  minCoherence: options.minCoherence ?? MANEUVER_MIN_COHERENCE,
  fullTurnDeg: options.fullTurnDeg ?? MANEUVER_FULL_TURN_DEG,
  coreRateDegS: options.coreRateDegS ?? MANEUVER_CORE_RATE_DEG_S,
  stillSpeedKn: options.stillSpeedKn ?? getStillSpeedKn(),
  minTurnDeg: options.minTurnDeg ?? MANEUVER_MIN_TURN_DEG,
});

/**
 * Ce que la fenêtre d'observation ouverte au point `i` dit, sans le vent :
 * rien d'observable, un virage écarté avant d'être lu, ou un virage à lire.
 */
export type WindowReading =
  | { kind: 'nothing' }
  | { kind: 'rejected'; motif: 'incoherent' | 'slowEntry' | 'tooShort'; endMs: number; turnDeg: number }
  | {
      kind: 'turn';
      /** Dernier point de la fenêtre, prolongation comprise. */
      j: number;
      /** Virage sommé pas à pas, prolongation comprise, en degrés signés. */
      cumulativeTurn: number;
      turnSign: number;
      /** Point le plus lent vu par la détection, et sa vitesse. */
      anchorIndex: number;
      anchorSpeed: number;
      /** Borne basse de la recherche du cœur du virage quand aucune manœuvre précédente ne la limite. */
      lowestFree: number;
    };

type TurnWindow = Extract<WindowReading, { kind: 'turn' }>;

const NOTHING: WindowReading = { kind: 'nothing' };

/**
 * Virage lu depuis sa borne basse `lowest`, sans le vent : son verdict quand
 * le vent n'y change rien (planche arrêtée, virage trop petit, tour complet),
 * sinon tout ce que le classement et la mesure reçoivent.
 */
export type TurnReading =
  | { verdict: 'still' }
  | { verdict: 'small'; turn: number }
  | { verdict: 'fullTurn'; turn: number; turnStart: number; turnEnd: number; turnEndMs: number }
  | {
      verdict: 'candidate';
      /** Virage du cap d'approche au cap de sortie, compté dans le sens du virage. */
      turn: number;
      turnSign: number;
      turnStart: number;
      turnEnd: number;
      turnEndMs: number;
      headings: TurnHeadings;
      /** Cap stabilisé avant le virage, ou sa fenêtre médiane ; `null` sans l'un ni l'autre. */
      before: StableSegment | null;
      stableHeadings: boolean;
      bisector: number;
      /** Mesure de la rotation, faite à la première manœuvre classée. */
      rotation: RotationMeasure | null;
      /**
       * Vrai si la fenêtre d'observation n'a vu qu'un pas unique, plus long
       * qu'elle (enregistreur économique qui s'est tu pendant le virage) : le
       * chemin entre les deux caps est inconnu (`SHORT_ARC_DOUBT_DEG`).
       */
      singleStep: boolean;
    };

type CandidateTurn = Extract<TurnReading, { verdict: 'candidate' }>;

const STILL: TurnReading = { verdict: 'still' };

/**
 * Changement de cap, en degrés, à partir duquel l'arc court et l'arc long
 * entre deux caps sont tous deux plausibles. Un virage vu en un seul pas de
 * la trace et au moins aussi grand est de sens incertain (`ManeuverKind`) ;
 * plus petit, il garde l'arc court, l'autre côté faisant un tour de plus de
 * 210°. Le même seuil départage, sur un virage dense, des caps stabilisés
 * qui contredisent le sens du virage.
 */
const SHORT_ARC_DOUBT_DEG = 150;

/**
 * Détection des virages d'une trace, préparée une fois pour tous les vents :
 * la trace, ses réglages de détection, et ses lectures, mémorisées à la
 * demande. Seuls le temps mort, le changement d'amures, le classement, le gain
 * au vent et la réussite dépendent du vent (`classifyManeuvers`).
 */
export interface ManeuverDetection {
  readonly points: PointData[];
  readonly settings: DetectionSettings;
  /** Lecture de la fenêtre ouverte au point `i`. */
  readonly windowAt: (i: number) => WindowReading;
  /** Lecture du virage de la fenêtre `i` (de genre `turn`) depuis la borne basse `lowest`. */
  readonly turnAt: (i: number, lowest: number) => TurnReading;
  /** Mesure de la rotation d'un virage candidat, faite une fois. */
  readonly rotationOf: (reading: CandidateTurn) => RotationMeasure;
}

/**
 * Prépare la détection des virages de `points`, une fois pour tous les vents.
 *
 * Fenêtre d'observation et temps mort sont en secondes : le même virage doit
 * être compté une fois, qu'il ait été enregistré à 1 Hz ou à 5 Hz.
 *
 * La fenêtre se déclenche sur le virage sommé pas à pas ; le virage se juge
 * ensuite du cap d'approche au cap de sortie, lus en médiane (`turnHeadings`) :
 * son ampleur, sa bissectrice et son classement ne dépendent plus du bruit du
 * cap. Le vent local est la bissectrice des caps stabilisés avant et après le
 * virage, et non celle du virage brut : l'abattée qui suit une manœuvre est
 * souvent asymétrique et fausserait l'angle. Faute de segments stabilisés, on
 * retombe sur la bissectrice des caps médians.
 *
 * Rien ici ne lit le vent : l'estimation du vent classe cette détection par
 * candidat, puis le module par vent global et par vent local, sans refaire le
 * balayage de la trace (cinq à six fois, 0,5 s par mouvement du seuil sur 3 h
 * à 5 Hz, §10 point 23). Les lectures sont mémorisées par fenêtre, et par
 * borne basse de recherche du cœur du virage, qui seule dépend de la manœuvre
 * précédente, donc du vent.
 */
export const prepareManeuverDetection = (points: PointData[], options: ManeuverDetectionOptions = {}): ManeuverDetection => {
  const settings = resolveDetectionSettings(options);
  const { minEntrySpeedKn, windowMs, maxStepMs, minDistanceM, minCoherence, fullTurnDeg, coreRateDegS, stillSpeedKn, minTurnDeg } = settings;
  const n = points.length;
  const windows = new Array<WindowReading | undefined>(n);
  /** Virages lus depuis leur borne basse libre, par `i`. */
  const turns = new Array<TurnReading | undefined>(n);
  /** Virages lus depuis une borne basse limitée par la manœuvre précédente, par `i * (n + 1) + lowest`. */
  const turnsFrom = new Map<number, TurnReading>();

  const readWindow = (i: number): WindowReading => {
    // Fenêtre d'observation : les points à `windowMs` au plus, ou, fenêtre
    // vide (enregistreur économique qui s'est tu pendant le virage), un pas
    // unique jusqu'à `maxStepMs`. Le virage net y est sommé point à point, la
    // somme des rotations par pas d'au moins `TURN_STRIDE_MIN_S`.
    const scan = scanTurnWindow(points, i, windowMs, maxStepMs);
    let { j, cumulativeTurn } = scan;
    // Point le plus lent vu par la détection. Il date la manœuvre, à l'instant
    // où le classement lit le vent, et nourrit la lecture qu'en fait
    // l'estimation du vent (`windCriteria`). Il omet le dernier point de la
    // fenêtre initiale : il reste tel quel, car le déplacer changerait le
    // classement et le vent (§10, points 21 et 70). La vitesse minimale
    // affichée est celle de `measureRotation`, sur toute la rotation.
    let anchorSpeed = Infinity;
    let anchorIndex = i;
    for (let k = i; k < j; k++) {
      if (points[k].smoothedSpeed < anchorSpeed) {
        anchorSpeed = points[k].smoothedSpeed;
        anchorIndex = k;
      }
    }

    // Rien d'observable : fin de trace, ou coupure d'enregistrement trop
    // longue pour qu'un virage puisse encore s'y lire. Un pas unique retenu
    // ci-dessus dure, lui, plus longtemps que la fenêtre entière.
    if (points[j].timeMs - points[i].timeMs < windowMs * 0.5) return NOTHING;
    if (!(Math.abs(cumulativeTurn) > minTurnDeg)) return NOTHING;

    // Une chute fait aussi tourner le cap de plus de 60°, mais dans tous les
    // sens : le virage net est petit devant la somme des rotations. Un vrai
    // virage tourne toujours du même côté.
    const endMs = points[j].timeMs;
    const coherent = scan.totalRotation > 0 && Math.abs(cumulativeTurn) / scan.totalRotation >= minCoherence;
    if (!coherent) return { kind: 'rejected', motif: 'incoherent', endMs, turnDeg: cumulativeTurn };
    if (!(points[i].smoothedSpeed > minEntrySpeedKn)) return { kind: 'rejected', motif: 'slowEntry', endMs, turnDeg: cumulativeTurn };
    // Un virage déplace le bateau. Sur place, le cap n'est que du bruit de
    // position, et un virage lu en un seul pas est toujours « cohérent ».
    if (!(distanceBetween(points, i, j) >= minDistanceM)) return { kind: 'rejected', motif: 'tooShort', endMs, turnDeg: cumulativeTurn };

    // La fenêtre s'est déclenchée dès 60° de virage, souvent avant la fin
    // de celui-ci. On prolonge l'observation tant que le cap continue de
    // tourner dans le même sens, par pas d'au moins `TURN_STRIDE_MIN_S`
    // (règle 2), pour mesurer le virage complet ; le point le plus lent est
    // suivi sur tous les points du pas.
    const turnSign = Math.sign(cumulativeTurn);
    while (j + 1 < n) {
      const next = strideEnd(points, j, n - 1);
      if (points[next].timeMs - points[i].timeMs > 2 * windowMs) break;
      if (!isTurningStep(points, j, next, turnSign)) break;
      for (let k = j + 1; k <= next; k++) {
        cumulativeTurn += angleDiff(points[k].bearing, points[k - 1].bearing);
        if (points[k].smoothedSpeed < anchorSpeed) {
          anchorSpeed = points[k].smoothedSpeed;
          anchorIndex = k;
        }
      }
      j = next;
    }

    // Borne basse de la recherche du cœur du virage, cherchée en reculant
    // depuis `i`, jamais depuis le début de la trace : le coût reste celui
    // d'une fenêtre, quel que soit le nombre de virages écartés avant la
    // première manœuvre retenue. La manœuvre précédente peut la relever.
    let lowestFree = i;
    while (lowestFree > 0 && points[lowestFree - 1].timeMs >= points[i].timeMs - windowMs) lowestFree--;

    return { kind: 'turn', j, cumulativeTurn, turnSign, anchorIndex, anchorSpeed, lowestFree };
  };

  const readTurn = (i: number, window: TurnWindow, lowest: number): TurnReading => {
    const { j, turnSign } = window;

    // Début réel du virage : le départ de son cœur (`turnCoreStart`), qui
    // peut précéder le déclenchement (virage enchaîné, déjà entamé à la fin
    // du temps mort) ou le suivre (fenêtre déclenchée sur une dérive lente
    // pendant le décollage). Sans cœur, premier pas de la fenêtre où le cap
    // tourne franchement.
    let turnStart = turnCoreStart(points, lowest, j, turnSign, coreRateDegS) ?? i;
    if (turnStart === i) {
      for (let k = i; k < j; ) {
        const next = strideEnd(points, k, j);
        if (isTurningStep(points, k, next, turnSign)) {
          turnStart = k;
          break;
        }
        k = next;
      }
    }

    // Fin du virage : le premier point où le cap a presque fini de tourner
    // dans son sens, à max(10°, 10 % du virage) près, comme la fin de la
    // rotation de `measureRotation`. La fenêtre court 12 s après son
    // déclenchement : quand celui-ci tombe au milieu du virage (fin d'un
    // temps mort), elle déborde sur le bord suivant, où se lisait alors le
    // cap de sortie, et le temps mort compté depuis elle mangeait la
    // manœuvre enchaînée.
    const rotations = [0];
    let maxRotation = 0;
    for (let k = turnStart + 1; k <= j; k++) {
      const rotation = rotations[rotations.length - 1] + turnSign * angleDiff(points[k].bearing, points[k - 1].bearing);
      rotations.push(rotation);
      maxRotation = Math.max(maxRotation, rotation);
    }
    const endEdge = Math.max(ROTATION_EDGE_MIN_DEG, ROTATION_EDGE_SHARE * maxRotation);
    let turnEnd = j;
    for (let k = turnStart + 1; k <= j; k++) {
      if (rotations[k - turnStart] >= maxRotation - endEdge) {
        turnEnd = k;
        break;
      }
    }
    const turnEndMs = points[turnEnd].timeMs;

    // Virage du cap d'approche au cap de sortie, compté dans le sens du
    // virage : il juge l'ampleur, la bissectrice et le classement, à la place
    // du virage sommé pas à pas, qui n'a servi qu'à déclencher.
    const headings = turnHeadings(points, turnStart, turnEnd);
    // Un cap ne se lit qu'en mouvement : planche arrêtée après une chute,
    // il n'est que du bruit de position, et la « sortie » n'en est pas une.
    if (headings.approach.meanSpeed < stillSpeedKn || headings.exit.meanSpeed < stillSpeedKn) return STILL;
    const turn = turnSign * (headings.exit.heading - headings.approach.heading);
    if (turn <= minTurnDeg) return { verdict: 'small', turn };
    if (turn >= fullTurnDeg) return { verdict: 'fullTurn', turn, turnStart, turnEnd, turnEndMs };

    const before = stableSegment(points, turnStart, -1) ?? medianStableSegment(headings.approach);
    const after = stableSegment(points, turnEnd, 1) ?? medianStableSegment(headings.exit);
    const stableHeadings = before !== null && after !== null;

    // Bissectrice des deux caps, parcourue dans le sens du virage : pour un
    // virement cet arc contient la direction du vent, pour un empannage son
    // opposé. Le sens compte : sur un virage de 180°, l'arc court est
    // indéfini et seule la direction de rotation départage.
    let bisector = normalizeDeg(headings.approach.heading + (turnSign * turn) / 2);
    if (before && after) {
      let delta = angleDiff(after.heading, before.heading);
      if (Math.sign(delta) !== turnSign && Math.abs(delta) > SHORT_ARC_DOUBT_DEG) delta += turnSign * 360;
      // Des caps stabilisés qui contredisent le sens du virage ne sont pas
      // exploitables : on garde alors la bissectrice des caps médians.
      if (Math.sign(delta) === turnSign) bisector = normalizeDeg(before.heading + delta / 2);
    }

    // Pas unique : la condition même qui l'arme dans `scanTurnWindow`.
    const singleStep = points[i + 1].timeMs - points[i].timeMs > windowMs;
    return { verdict: 'candidate', turn, turnSign, turnStart, turnEnd, turnEndMs, headings, before, stableHeadings, bisector, rotation: null, singleStep };
  };

  const windowAt = (i: number): WindowReading => {
    let reading = windows[i];
    if (reading === undefined) {
      reading = readWindow(i);
      windows[i] = reading;
    }
    return reading;
  };

  const turnAt = (i: number, lowest: number): TurnReading => {
    const window = windowAt(i);
    if (window.kind !== 'turn') throw new Error('Pas de virage à lire dans cette fenêtre.');
    if (lowest === window.lowestFree) {
      let reading = turns[i];
      if (reading === undefined) {
        reading = readTurn(i, window, lowest);
        turns[i] = reading;
      }
      return reading;
    }
    const key = i * (n + 1) + lowest;
    let reading = turnsFrom.get(key);
    if (reading === undefined) {
      reading = readTurn(i, window, lowest);
      turnsFrom.set(key, reading);
    }
    return reading;
  };

  const rotationOf = (reading: CandidateTurn): RotationMeasure => {
    if (reading.rotation === null) {
      reading.rotation = measureRotation(points, reading.turnStart, reading.turnEnd, reading.turnSign, reading.headings);
    }
    return reading.rotation;
  };

  return { points, settings, windowAt, turnAt, rotationOf };
};

/**
 * Classe virements et empannages d'une détection préparée, par le vent.
 *
 * Un virage doit changer d'amures (sinon c'est une abattée, un loff ou une
 * chute) ; un tour complet n'est pas compté, ni, quand le seuil de vol est
 * donné, un demi-tour entamé en dessous. Le temps mort ne se pose qu'après
 * une manœuvre classée : le balayage lui-même dépend donc du vent, et c'est
 * ici qu'il se fait, sur les lectures mémorisées de la détection.
 */
export const classifyManeuvers = (
  detection: ManeuverDetection,
  wind: WindReference,
  options: ManeuverClassificationOptions = {}
): ManeuverStats => {
  const { points, settings } = detection;
  const { windowMs } = settings;
  const successThresholdKn = options.successThresholdKn ?? getDefaultThresholdKn();
  const cooldownMs = (options.cooldownSeconds ?? MANEUVER_COOLDOWN_S) * 1000;
  const flightThresholdKn = options.flightThresholdKn;

  const stats: ManeuverStats = {
    tackSuccess: 0,
    tackFail: 0,
    jibeSuccess: 0,
    jibeFail: 0,
    undecided: 0,
    rejected: { slowEntry: 0, incoherent: 0, still: 0, unclassified: 0, tooShort: 0, fullTurn: 0, noFlight: 0 },
    rejectedTurns: [],
    locations: [],
  };

  let ignoreUntilMs = -Infinity;
  /**
   * Fin de la dernière manœuvre retenue, comptée ou mise de côté : le début
   * d'un virage ne se cherche pas avant.
   */
  let previousEndIndex = 0;

  /**
   * Un virage écarté ne pose pas de temps mort — et ne doit pas en poser : il
   * peut être classé une poignée de points plus loin, et l'écarter pour de bon
   * est précisément ce qui a fait échouer les deux tentatives du §10 point 21.
   * Il est donc rencontré à nouveau à chaque point suivant, d'où cette borne
   * qui ne sert qu'à ne pas le compter vingt fois.
   */
  let countedRejectionUntilMs = -Infinity;
  const countRejection = (motif: keyof ManeuverRejections, index: number, endMs: number, turnDeg: number): void => {
    const atMs = points[index].timeMs;
    if (atMs < countedRejectionUntilMs) return;
    stats.rejected[motif]++;
    stats.rejectedTurns.push({ motif, timeMs: atMs, trackIndex: index, turnDeg, speedKn: points[index].smoothedSpeed });
    countedRejectionUntilMs = endMs;
  };
  /**
   * Un tour complet et un demi-tour hors vol sont de vraies manœuvres, mises
   * de côté : chacun est compté une fois, et pose le temps mort d'une
   * manœuvre, pour qu'aucun morceau n'en soit relu au point suivant.
   */
  const setAside = (
    motif: 'fullTurn' | 'noFlight',
    index: number,
    turnDeg: number,
    speedKn: number,
    type?: 'tack' | 'jibe'
  ): void => {
    stats.rejected[motif]++;
    stats.rejectedTurns.push({ motif, timeMs: points[index].timeMs, trackIndex: index, turnDeg, speedKn, type });
  };

  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].timeMs < ignoreUntilMs) continue;

    const window = detection.windowAt(i);
    if (window.kind === 'nothing') continue;
    if (window.kind === 'rejected') {
      countRejection(window.motif, i, window.endMs, window.turnDeg);
      continue;
    }
    const { j, cumulativeTurn, anchorIndex, anchorSpeed } = window;

    // Borne basse de la recherche du cœur du virage : la fenêtre, relevée à
    // la fin de la manœuvre précédente, qui dépend du vent.
    let lowest = i;
    while (lowest > previousEndIndex && points[lowest - 1].timeMs >= points[i].timeMs - windowMs) lowest--;
    const reading = detection.turnAt(i, lowest);

    const timeMs = points[anchorIndex].timeMs;
    const windowEndMs = points[j].timeMs;
    if (reading.verdict === 'still') {
      countRejection('still', i, windowEndMs, cumulativeTurn);
      continue;
    }
    if (reading.verdict === 'small') {
      countRejection('unclassified', i, windowEndMs, reading.turn);
      continue;
    }
    if (reading.verdict === 'fullTurn') {
      setAside('fullTurn', anchorIndex, reading.turn, points[reading.turnStart].smoothedSpeed);
      ignoreUntilMs = reading.turnEndMs + cooldownMs;
      previousEndIndex = reading.turnEnd;
      continue;
    }

    const { turn, turnStart, turnEnd, turnEndMs, headings, before, stableHeadings, bisector } = reading;
    // Lecture de la détection, pour l'estimation du vent : vitesse du bord
    // stabilisé avant, sinon celle du début du virage détecté, et point le
    // plus lent de la détection.
    const windEntrySpeed = before ? before.meanSpeed : points[turnStart].smoothedSpeed;
    const windCriteria = {
      conservation: windEntrySpeed > 0 ? Math.min(1, anchorSpeed / windEntrySpeed) : 0,
      success: anchorSpeed >= successThresholdKn,
    };
    /** Manœuvre comptée, ses métriques de qualité tirées de la mesure. */
    const locationOf = (
      measure: RotationMeasure,
      fields: Pick<ManeuverLocation, 'type' | 'success' | 'localWind' | 'stableHeadings' | 'windwardGainM'>
    ): ManeuverLocation => ({
      lat: points[anchorIndex].lat,
      lon: points[anchorIndex].lon,
      type: fields.type,
      success: fields.success,
      vmin: measure.vmin,
      localWind: fields.localWind,
      timeMs,
      trackIndex: anchorIndex,
      stableHeadings: fields.stableHeadings,
      windCriteria,
      entrySpeed: measure.entrySpeed,
      conservation: measure.conservation,
      relaunchS: measure.relaunchS,
      headingChange: measure.headingChange,
      distanceM: measure.distanceM,
      windwardGainM: fields.windwardGainM,
      apexIndex: measure.apexIndex,
      entryIndex: measure.rotationStartIndex,
      exitIndex: measure.exitIndex,
      entryHeading: points[turnStart].bearing,
      exitHeading: points[turnEnd].bearing,
      path: points
        .slice(measure.rotationStartIndex, measure.exitIndex + 1)
        .map((p) => [p.lat, p.lon] as [number, number]),
    });

    // Demi-tour vu en un seul pas, assez grand pour que l'arc long soit aussi
    // plausible que l'arc court : un virement passé par le lit du vent peut
    // ressortir en empannage. Compté, mesuré, sans nom ni direction, et sans
    // lire le vent (décision du 31/10) ; plus petit, il garde l'arc court et
    // se classe comme les autres. Un virage observé sur plusieurs points n'est
    // jamais concerné.
    if (reading.singleStep && turn >= SHORT_ARC_DOUBT_DEG) {
      const measure = detection.rotationOf(reading);
      ignoreUntilMs = turnEndMs + cooldownMs;
      previousEndIndex = measure.exitIndex;
      if (flightThresholdKn !== undefined && measure.entrySpeed < flightThresholdKn) {
        setAside('noFlight', anchorIndex, turn, measure.entrySpeed);
        continue;
      }
      stats.locations.push(
        locationOf(measure, {
          type: 'undecided',
          success: measure.vmin >= successThresholdKn,
          // Bissectrice de l'arc court, jamais lue : le vent ne lit que les manœuvres dirigées.
          localWind: normalizeDeg(Math.round(bisector)),
          stableHeadings: false,
          windwardGainM: null,
        })
      );
      stats.undecided++;
      continue;
    }

    const windDeg = windAt(wind, timeMs);
    // Un virement comme un empannage change d'amures : sans cela, c'est une
    // abattée, un loff ou une chute, quel que soit l'axe le plus proche.
    const tackChanged =
      angleDiff(headings.approach.heading, windDeg) < 0 !== angleDiff(headings.exit.heading, windDeg) < 0;
    if (!tackChanged) {
      countRejection('unclassified', i, windowEndMs, turn);
      continue;
    }
    const type = classifyTurn(bisector, turn, windDeg);
    if (type === null) {
      countRejection('unclassified', i, windowEndMs, turn);
      continue;
    }

    // Métriques de qualité, sur des bornes propres à la mesure : celles de
    // la détection ne servent qu'à trouver et classer le virage. Un virage
    // entamé avant le déclenchement se mesure depuis son début.
    const measure = detection.rotationOf(reading);
    ignoreUntilMs = turnEndMs + cooldownMs;
    previousEndIndex = measure.exitIndex;
    // Entamé sous le seuil de vol : un demi-tour en archimédien, qui n'est
    // ni réussi ni raté (décision du 28/10).
    if (flightThresholdKn !== undefined && measure.entrySpeed < flightThresholdKn) {
      setAside('noFlight', anchorIndex, turn, measure.entrySpeed, type);
      continue;
    }
    const success = measure.vmin >= successThresholdKn;
    const location = locationOf(measure, {
      type,
      success,
      // L'empannage se lit à l'opposé de la bissectrice : le vent y vient de l'arrière.
      // Arrondi puis normalisé : 359,7° donne 0, jamais 360.
      localWind: normalizeDeg(Math.round(type === 'tack' ? bisector : bisector + 180)),
      stableHeadings,
      // Le gain se projette au vent retenu, et non à la bissectrice de la
      // manœuvre même, qui rendrait la mesure circulaire.
      windwardGainM: success ? windwardGainM(points, measure, type, windDeg) : null,
    });

    if (type === 'tack') {
      if (success) stats.tackSuccess++; else stats.tackFail++;
    } else {
      if (success) stats.jibeSuccess++; else stats.jibeFail++;
    }
    stats.locations.push(location);
  }

  return stats;
};

/**
 * Détecte et classe virements et empannages, en une fois : la détection
 * préparée (`prepareManeuverDetection`) puis classée par `wind`
 * (`classifyManeuvers`). Pour classer une même trace par plusieurs vents,
 * préparer la détection une fois et la classer autant de fois.
 */
export const analyzeManeuvers = (
  points: PointData[],
  wind: WindReference,
  options: ManeuverOptions = {}
): ManeuverStats => classifyManeuvers(prepareManeuverDetection(points, options), wind, options);
