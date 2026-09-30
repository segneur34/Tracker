import { median } from '../core/speedFilter';
import { knotsToMs } from '../core/units';
import type { PointData } from '../utils/kinematics';
import {
  MANEUVER_COOLDOWN_S,
  MANEUVER_MIN_ENTRY_SPEED_KN,
  MANEUVER_MAX_STEP_S,
  MANEUVER_MIN_DISTANCE_M,
  MANEUVER_MIN_TURN_DEG,
  MANEUVER_WINDOW_S,
  ORIENTATION_MAX_CONSERVATION,
  WIND_CONFIDENCE_MIN,
  WIND_ESTIMATION_MIN_SPEED_KN,
  getDefaultThresholdKn,
} from './sailingConfig';
import {
  CANDIDATE_MIN_SEPARATION,
  TURN_MIN_COHERENCE,
  angleDiff,
  buildWindTimeline,
  circularMean,
  describeWindCandidate,
  estimateWindPolar,
  normalizeAngle,
  polarWindCandidates,
  type PolarWindEstimate,
  type WindEstimate,
  type WindOrientationSource,
} from './wind';

export { angleDiff, type WindEstimate };

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
}

export interface ManeuverLocation {
  lat: number;
  lon: number;
  type: 'tack' | 'jibe';
  /** Vrai si la vitesse minimale reste au seuil de réussite ou au-dessus. */
  success: boolean;
  /**
   * Vitesse minimale, en nœuds, du début de la rotation jusqu'au retour à
   * 90 % de la vitesse d'approche, et au plus 10 s après la rotation : le
   * creux d'un virement vient souvent une fois le nouveau cap pris.
   */
  vmin: number;
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
   * `null` pour une manœuvre ratée : seul le gain des manœuvres réussies se
   * compare.
   */
  windwardGainM: number | null;
  /** Indice du point le plus lent, où se lit `vmin` et d'où part la relance. */
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
  /** Virage franc et net, mais dont la bissectrice ne tombe près d'aucun axe du vent. */
  unclassified: number;
  /** Cap franc, mais sur une distance trop courte pour qu'il veuille dire quelque chose. */
  tooShort: number;
}

export interface ManeuverStats {
  tackSuccess: number;
  tackFail: number;
  jibeSuccess: number;
  jibeFail: number;
  rejected: ManeuverRejections;
  locations: ManeuverLocation[];
}

/**
 * Vent de référence pour classer les manœuvres : une valeur fixe, ou une
 * fonction du temps quand le vent a tourné au cours de la session.
 */
export type WindReference = number | ((timeMs: number) => number);

const windAt = (wind: WindReference, timeMs: number): number =>
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

/** Manœuvres dont le vent local est exploitable : caps stabilisés de part et d'autre. */
export const windSamplesFrom = (stats: ManeuverStats): ManeuverLocation[] =>
  stats.locations.filter(
    (m) => m.stableHeadings && (m.type === 'tack' || (m.type === 'jibe' && m.windCriteria.success))
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
  const all = stats.locations;
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
}

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
  const minSpeedKn = options.minSpeedKn ?? WIND_ESTIMATION_MIN_SPEED_KN;
  const maneuverOptions: ManeuverOptions = {
    successThresholdKn: options.successThresholdKn,
    minEntrySpeedKn: options.minEntrySpeedKn,
  };
  const fallback: CandidateSelection = {
    direction: polar.direction,
    orientedBy: polar.orientedBy,
    polarConfidence: polar.confidence,
    agreementScore: 0,
  };
  if (points.length === 0) return fallback;

  // Candidats : les maxima du score, plus l'opposé du meilleur, jumeau au
  // vent arrière que seules les manœuvres peuvent écarter avec certitude.
  const candidates = polarWindCandidates(points, minSpeedKn, 3);
  if (candidates.length === 0) return fallback;
  const twin = normalizeAngle(candidates[0].direction + 180);
  if (candidates.every((c) => Math.abs(angleDiff(c.direction, twin)) >= CANDIDATE_MIN_SEPARATION)) {
    candidates.push(describeWindCandidate(points, twin, minSpeedKn));
  }

  let chosen: PolarWindEstimate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const stats = analyzeManeuvers(points, candidate.direction, maneuverOptions);
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
  const minSpeedKn = options.minSpeedKn ?? WIND_ESTIMATION_MIN_SPEED_KN;
  const maneuverOptions: ManeuverOptions = {
    successThresholdKn: options.successThresholdKn,
    minEntrySpeedKn: options.minEntrySpeedKn,
  };

  const polar = estimateWindPolar(points, { minSpeedKn });
  if (points.length === 0) return polar;

  const selection = selectWindCandidate(points, polar, options);
  const orientedBy = selection.orientedBy;
  const polarConfidence = selection.polarConfidence;
  let direction = selection.direction;

  const anchor = direction;
  let maneuverCount = 0;
  let maneuverConfidence = 0;
  let wind: WindReference = direction;

  for (let iteration = 0; iteration < WIND_REFINEMENT_ITERATIONS; iteration++) {
    const samples = windSamplesFrom(analyzeManeuvers(points, wind, maneuverOptions));
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

  const confidence = Math.max(polarConfidence, maneuverConfidence * 0.9);

  return {
    direction: Math.round(direction) % 360,
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

interface StableSegment {
  /** Cap moyen du segment. */
  heading: number;
  /** Vitesse moyenne du segment, en nœuds. */
  meanSpeed: number;
}

/**
 * Segment stabilisé situé avant (`direction` = -1) ou après (`direction` = +1)
 * un instant donné, ou `null` si aucun segment assez long et assez droit
 * n'existe dans la zone de recherche.
 */
const stableSegment = (
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
  let previous: PointData | null = null;

  // On part du virage et on s'en éloigne : le segment retenu est le plus
  // proche du virage, et il s'arrête au premier changement de cap franc.
  for (let k = fromIndex; k >= 0 && k < points.length; k += direction) {
    const p = points[k];
    const elapsed = Math.abs(p.timeMs - originMs);
    if (elapsed > searchMs) break;
    if (elapsed < marginMs) continue;

    if (previous) {
      const dt = Math.abs(p.timeMs - previous.timeMs) / 1000;
      const rate = dt > 0 ? Math.abs(angleDiff(p.bearing, previous.bearing)) / dt : 0;
      if (rate > STABLE_MAX_RATE_DEG_S) break;
    }

    bearings.push(p.bearing);
    speedSum += p.smoothedSpeed;
    if (firstMs === null) firstMs = p.timeMs;
    lastMs = p.timeMs;
    previous = p;
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

/** Distance parcourue entre deux indices, en mètres, par intégration de la vitesse. */
const distanceBetween = (points: PointData[], from: number, to: number): number => {
  let meters = 0;
  for (let k = from + 1; k <= to; k++) {
    const dt = (points[k].timeMs - points[k - 1].timeMs) / 1000;
    if (dt > 0) meters += knotsToMs(points[k].smoothedSpeed) * dt;
  }
  return meters;
};

/**
 * Chemin parcouru projeté sur une direction entre deux instants, en mètres :
 * intégrale de la vitesse retenue fois le cosinus de l'écart entre la route et
 * cette direction, comme `distanceBetween`, les intervalles au bord n'étant
 * comptés que pour leur part. Un virage compressé dans un seul intervalle
 * compte par la route de cet intervalle, sa corde. Les intervalles lus vont du
 * point `from` au point `to`, qui doivent encadrer les deux instants.
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
    const overlapS = (Math.min(points[k].timeMs, toMs) - Math.max(points[k - 1].timeMs, fromMs)) / 1000;
    if (overlapS > 0) meters += knotsToMs(points[k].smoothedSpeed) * overlapS * Math.cos((angleDiff(points[k].bearing, directionDeg) * Math.PI) / 180);
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
  const triggerMs = points[triggerIndex].timeMs;
  const endMs = points[endIndex].timeMs;

  // Cap déroulé, du cap d'approche au cap de sortie, pas à pas par l'arc court.
  // Forcer le sens du virage sur un pas voisin de 180° n'aide pas : un virage vu
  // en un seul pas tient déjà son sens de ce pas, et sur une planche arrêtée,
  // où le cap saute d'un bord à l'autre, cela empilait les tours (385°).
  let first = triggerIndex;
  while (first > 0 && points[first - 1].timeMs >= triggerMs - APPROACH_HEADING_S * 1000) first--;
  let last = endIndex;
  while (last + 1 < points.length && points[last + 1].timeMs <= endMs + EXIT_HEADING_TO_S * 1000) last++;
  const unwrapped = [points[first].bearing];
  for (let k = first + 1; k <= last; k++) {
    unwrapped.push(unwrapped[unwrapped.length - 1] + angleDiff(points[k].bearing, points[k - 1].bearing));
  }
  const headingAt = (k: number): number => unwrapped[k - first];

  const approachHeadings: number[] = [];
  for (let k = first; k <= triggerIndex; k++) approachHeadings.push(headingAt(k));
  const exitHeadings: number[] = [];
  for (let k = endIndex; k <= last; k++) {
    if (points[k].timeMs >= endMs + EXIT_HEADING_FROM_S * 1000) exitHeadings.push(headingAt(k));
  }
  const approachHeading = median(approachHeadings);
  const exitHeading = exitHeadings.length > 0 ? median(exitHeadings) : headingAt(endIndex);
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
  // le nouveau cap pris.
  const recoveredSpeed = RELAUNCH_RATIO * entrySpeed;
  const apexSearchEndMs = points[rotationEnd].timeMs + APEX_SEARCH_AFTER_S * 1000;
  let apexIndex = rotationStart;
  for (let k = rotationStart + 1; k < points.length && points[k].timeMs <= apexSearchEndMs; k++) {
    if (k > rotationEnd && points[k].smoothedSpeed >= recoveredSpeed) break;
    if (points[k].smoothedSpeed < points[apexIndex].smoothedSpeed) apexIndex = k;
  }
  const vmin = points[apexIndex].smoothedSpeed;

  const relaunchIndex = entrySpeed > 0 ? findRelaunch(points, apexIndex, entrySpeed) : null;
  const exitIndex = relaunchIndex === null ? rotationEnd : Math.max(rotationEnd, relaunchIndex);
  // Vers le vent pour un virement, à l'opposé pour un empannage : chacun est
  // compté dans le sens où il fait avancer.
  const gainDirection = type === 'tack' ? windDeg : windDeg + 180;

  return {
    rotationStartIndex: rotationStart,
    rotationEndIndex: rotationEnd,
    apexIndex,
    exitIndex,
    entrySpeed,
    vmin,
    conservation: entrySpeed > 0 ? Math.min(1, vmin / entrySpeed) : 0,
    relaunchS: relaunchIndex === null ? null : (points[relaunchIndex].timeMs - points[apexIndex].timeMs) / 1000,
    headingChange: Math.abs(exitHeading - approachHeading),
    distanceM: relaunchIndex === null ? null : distanceBetween(points, rotationStart, exitIndex),
    gainM: distanceAlongBetween(points, rotationStart, rotationEnd, rotationStartMs, rotationEndMs, gainDirection),
  };
};

/**
 * Détecte virements et empannages.
 *
 * Fenêtre d'observation et temps mort sont en secondes : le même virage doit
 * être compté une fois, qu'il ait été enregistré à 1 Hz ou à 5 Hz.
 *
 * Le vent local est la bissectrice des caps stabilisés avant et après le
 * virage, et non celle du virage brut : l'abattée qui suit une manœuvre est
 * souvent asymétrique et fausserait l'angle. Faute de segments stabilisés,
 * on retombe sur la bissectrice du virage complet.
 */
export const analyzeManeuvers = (
  points: PointData[],
  wind: WindReference,
  options: ManeuverOptions = {}
): ManeuverStats => {
  const successThresholdKn = options.successThresholdKn ?? getDefaultThresholdKn();
  const minEntrySpeedKn = options.minEntrySpeedKn ?? MANEUVER_MIN_ENTRY_SPEED_KN;
  const windowMs = (options.windowSeconds ?? MANEUVER_WINDOW_S) * 1000;
  const cooldownMs = (options.cooldownSeconds ?? MANEUVER_COOLDOWN_S) * 1000;
  const maxStepMs = (options.maxStepSeconds ?? MANEUVER_MAX_STEP_S) * 1000;
  const minDistanceM = options.minDistanceM ?? MANEUVER_MIN_DISTANCE_M;

  const stats: ManeuverStats = {
    tackSuccess: 0,
    tackFail: 0,
    jibeSuccess: 0,
    jibeFail: 0,
    rejected: { slowEntry: 0, incoherent: 0, unclassified: 0, tooShort: 0 },
    locations: [],
  };

  let ignoreUntilMs = -Infinity;

  /**
   * Un virage écarté ne pose pas de temps mort — et ne doit pas en poser : il
   * peut être classé une poignée de points plus loin, et l'écarter pour de bon
   * est précisément ce qui a fait échouer les deux tentatives du §10 point 21.
   * Il est donc rencontré à nouveau à chaque point suivant, d'où cette borne
   * qui ne sert qu'à ne pas le compter vingt fois.
   */
  let countedRejectionUntilMs = -Infinity;
  const countRejection = (motif: keyof ManeuverRejections, atMs: number, endMs: number): void => {
    if (atMs < countedRejectionUntilMs) return;
    stats.rejected[motif]++;
    countedRejectionUntilMs = endMs;
  };

  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].timeMs < ignoreUntilMs) continue;

    let cumulativeTurn = 0;
    let totalRotation = 0;
    // Point le plus lent vu par la détection. Il date la manœuvre, à l'instant
    // où le classement lit le vent, et nourrit la lecture qu'en fait
    // l'estimation du vent (`windCriteria`). Il omet le dernier point de la
    // fenêtre initiale : il reste tel quel, car le déplacer changerait le
    // classement et le vent (§10, points 21 et 70). La vitesse minimale
    // affichée est celle de `measureManeuver`, sur toute la rotation.
    let anchorSpeed = Infinity;
    let anchorIndex = i;

    let j = i;
    while (
      j + 1 < points.length &&
      // Cas courant : le point suivant tombe dans la fenêtre d'observation.
      (points[j + 1].timeMs - points[i].timeMs <= windowMs ||
        // Enregistreur économique : la fenêtre est vide parce que l'appareil
        // s'est tu pendant le virage, quand la planche a ralenti. Toute la
        // rotation tient alors dans ce seul pas, qu'il faut donc lire.
        (j === i && points[j + 1].timeMs - points[i].timeMs <= maxStepMs))
    ) {
      const step = angleDiff(points[j + 1].bearing, points[j].bearing);
      cumulativeTurn += step;
      totalRotation += Math.abs(step);
      if (points[j].smoothedSpeed < anchorSpeed) {
        anchorSpeed = points[j].smoothedSpeed;
        anchorIndex = j;
      }
      j++;
    }

    // Rien d'observable : fin de trace, ou coupure d'enregistrement trop
    // longue pour qu'un virage puisse encore s'y lire. Un pas unique retenu
    // ci-dessus dure, lui, plus longtemps que la fenêtre entière.
    if (points[j].timeMs - points[i].timeMs < windowMs * 0.5) continue;

    // Une chute fait aussi tourner le cap de plus de 60°, mais dans tous les
    // sens : le virage net est petit devant la somme des rotations. Un vrai
    // virage tourne toujours du même côté.
    const coherent = totalRotation > 0 && Math.abs(cumulativeTurn) / totalRotation >= TURN_MIN_COHERENCE;
    const turnedEnough = Math.abs(cumulativeTurn) > MANEUVER_MIN_TURN_DEG;
    const fastEnough = points[i].smoothedSpeed > minEntrySpeedKn;
    // Un virage déplace le bateau. Sur place, le cap n'est que du bruit de
    // position, et un virage lu en un seul pas est toujours « cohérent ».
    const movedEnough = distanceBetween(points, i, j) >= minDistanceM;

    if (turnedEnough && !coherent) countRejection('incoherent', points[i].timeMs, points[j].timeMs);
    if (turnedEnough && coherent && !fastEnough) {
      countRejection('slowEntry', points[i].timeMs, points[j].timeMs);
    }
    if (turnedEnough && coherent && fastEnough && !movedEnough) {
      countRejection('tooShort', points[i].timeMs, points[j].timeMs);
    }

    if (turnedEnough && coherent && fastEnough && movedEnough) {
      // La fenêtre s'est déclenchée dès 60° de virage, souvent avant la fin
      // de celui-ci. On prolonge l'observation tant que le cap continue de
      // tourner dans le même sens, pour mesurer le virage complet.
      const turnSign = Math.sign(cumulativeTurn);
      let turnStart = i;
      while (j + 1 < points.length && points[j + 1].timeMs - points[i].timeMs <= 2 * windowMs) {
        const step = angleDiff(points[j + 1].bearing, points[j].bearing);
        if (Math.sign(step) !== turnSign || Math.abs(step) < 2) break;
        cumulativeTurn += step;
        j++;
        if (points[j].smoothedSpeed < anchorSpeed) {
          anchorSpeed = points[j].smoothedSpeed;
          anchorIndex = j;
        }
      }

      // Début réel du virage : premier point de la fenêtre où le cap tourne
      // franchement dans le sens du virage.
      for (let k = i; k < j; k++) {
        const step = angleDiff(points[k + 1].bearing, points[k].bearing);
        if (Math.sign(step) === turnSign && Math.abs(step) >= 2) {
          turnStart = k;
          break;
        }
      }

      const before = stableSegment(points, turnStart, -1);
      const after = stableSegment(points, j, 1);
      const stableHeadings = before !== null && after !== null;

      // Bissectrice des deux caps, parcourue dans le sens du virage : pour un
      // virement cet arc contient la direction du vent, pour un empannage son
      // opposé. Le sens compte : sur un virage de 180°, l'arc court est
      // indéfini et seule la direction de rotation départage.
      let bisector = normalizeAngle(points[i].bearing + cumulativeTurn / 2);
      if (before && after) {
        let delta = angleDiff(after.heading, before.heading);
        if (Math.sign(delta) !== turnSign && Math.abs(delta) > 150) delta += turnSign * 360;
        // Des caps stabilisés qui contredisent le sens du virage ne sont pas
        // exploitables : on garde alors la bissectrice du virage brut.
        if (Math.sign(delta) === turnSign) bisector = normalizeAngle(before.heading + delta / 2);
      }

      const timeMs = points[anchorIndex].timeMs;
      const turnEndMs = points[j].timeMs;
      const windDeg = windAt(wind, timeMs);
      const type = classifyTurn(bisector, cumulativeTurn, windDeg);

      if (type !== null) {
        // Métriques de qualité, sur des bornes propres à la mesure : celles de
        // la détection ne servent qu'à trouver et classer le virage.
        // Le gain se projette au vent retenu, et non à la bissectrice de la
        // manœuvre même, qui rendrait la mesure circulaire.
        const measure = measureManeuver(points, { triggerIndex: i, endIndex: j, turnSign, type }, windDeg);
        const success = measure.vmin >= successThresholdKn;
        // Lecture de la détection, pour l'estimation du vent : vitesse du bord
        // stabilisé avant, sinon celle du début du virage détecté, et point le
        // plus lent de la détection.
        const windEntrySpeed = before ? before.meanSpeed : points[turnStart].smoothedSpeed;

        const location: ManeuverLocation = {
          lat: points[anchorIndex].lat,
          lon: points[anchorIndex].lon,
          type,
          success,
          vmin: measure.vmin,
          // L'empannage se lit à l'opposé de la bissectrice : le vent y vient de l'arrière.
          localWind: Math.round(normalizeAngle(type === 'tack' ? bisector : bisector + 180)),
          timeMs,
          trackIndex: anchorIndex,
          stableHeadings,
          windCriteria: {
            conservation: windEntrySpeed > 0 ? Math.min(1, anchorSpeed / windEntrySpeed) : 0,
            success: anchorSpeed >= successThresholdKn,
          },
          entrySpeed: measure.entrySpeed,
          conservation: measure.conservation,
          relaunchS: measure.relaunchS,
          headingChange: measure.headingChange,
          distanceM: measure.distanceM,
          windwardGainM: success ? measure.gainM : null,
          apexIndex: measure.apexIndex,
          entryIndex: measure.rotationStartIndex,
          exitIndex: measure.exitIndex,
          entryHeading: points[turnStart].bearing,
          exitHeading: points[j].bearing,
          path: points
            .slice(measure.rotationStartIndex, measure.exitIndex + 1)
            .map((p) => [p.lat, p.lon] as [number, number]),
        };

        if (type === 'tack') {
          if (success) stats.tackSuccess++; else stats.tackFail++;
        } else {
          if (success) stats.jibeSuccess++; else stats.jibeFail++;
        }
        stats.locations.push(location);
        ignoreUntilMs = turnEndMs + cooldownMs;
      } else {
        countRejection('unclassified', points[i].timeMs, turnEndMs);
      }
    }
  }

  return stats;
};
