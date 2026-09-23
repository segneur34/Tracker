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
  success: boolean;
  vmin: number;
  localWind: number;
  timeMs: number;
  trackIndex: number;
  /** Vrai si le vent local vient de caps stabilisés avant et après le virage. */
  stableHeadings: boolean;

  /** Vitesse de croisière à l'entrée, en nœuds : moyenne du bord stabilisé avant, sinon vitesse au début du virage. */
  entrySpeed: number;
  /**
   * Taux de conservation de la vitesse, de 0 à 1 : vitesse minimale sur
   * vitesse d'entrée. Isole la qualité technique de la manœuvre de la force
   * du vent et de la vitesse de navigation.
   */
  conservation: number;
  /**
   * Temps de relance, en secondes : du point le plus lent au retour à 90 % de
   * la vitesse d'entrée. `null` si la vitesse n'est pas revenue dans la
   * minute, chute ou arrêt. Long, il signale une relance laborieuse en mode
   * archimédien.
   */
  relaunchS: number | null;
  /**
   * Changement de cap effectif, en degrés, entre les caps stabilisés avant et
   * après. Un virement qui s'ouvre à 120° au lieu de 90° a perdu du cap pour
   * reprendre le vol.
   */
  headingChange: number;
  /** Distance parcourue de l'entrée du virage à la relance, en mètres. */
  distanceM: number;
  /** Indices de trace de l'entrée et de la sortie (relance, sinon fin du virage). */
  entryIndex: number;
  exitIndex: number;
  /**
   * Caps instantanés au début et à la fin de la rotation. Bruités, donc
   * impropres à mesurer un angle fin, mais définis pour toutes les manœuvres,
   * y compris celles sans cap stabilisé : ils servent à juger la symétrie du
   * virage, c'est-à-dire la confiance à accorder à sa mesure du vent.
   */
  entryHeading: number;
  exitHeading: number;
  /** Tracé de l'entrée à la sortie, pour la carte. */
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
  tackVmins: number[];
  jibeVmins: number[];
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
    (m) => m.stableHeadings && (m.type === 'tack' || (m.type === 'jibe' && m.success))
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
 * Le vol perdu se juge sur la **conservation**, la vitesse minimale rapportée
 * à la vitesse d'entrée, et non sur une vitesse absolue. Un seuil en nœuds est
 * une valeur de wingfoil : sur une session de planche lente, toute manœuvre
 * passe en dessous, tout est lu comme un virement et l'estimation part à
 * l'opposé. Un rapport, lui, vaut la même chose à toutes les échelles — c'est
 * ce qui rend ce critère juste du bateau au kite.
 */
export const maneuverAgreement = (
  stats: ManeuverStats
): { agreement: number; count: number; consistent: number; inconsistent: number } => {
  const all = stats.locations;
  if (all.length === 0) return { agreement: 0, count: 0, consistent: 0, inconsistent: 0 };
  let consistent = 0;
  for (const m of all) {
    const lostFlight = m.conservation < ORIENTATION_MAX_CONSERVATION;
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

/** Nœuds vers mètres par seconde. */
const KN_TO_MS = 0.514444;
/** Délai maximal, en secondes, pour retrouver la vitesse après le point le plus lent. */
const RELAUNCH_MAX_S = 60;
/** Part de la vitesse d'entrée à retrouver pour considérer la relance acquise. */
const RELAUNCH_RATIO = 0.9;

/**
 * Premier point, après le plus lent, où la vitesse retrouve 90 % de la
 * vitesse d'entrée. `null` si cela n'arrive pas dans le délai.
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
    if (dt > 0) meters += points[k].smoothedSpeed * KN_TO_MS * dt;
  }
  return meters;
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
    tackVmins: [],
    jibeVmins: [],
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
    let minSpd = 999;
    let apexIndex = i;

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
      if (points[j].smoothedSpeed < minSpd) {
        minSpd = points[j].smoothedSpeed;
        apexIndex = j;
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
        if (points[j].smoothedSpeed < minSpd) {
          minSpd = points[j].smoothedSpeed;
          apexIndex = j;
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

      const success = minSpd >= successThresholdKn;

      const before = stableSegment(points, turnStart, -1);
      const after = stableSegment(points, j, 1);
      const stableHeadings = before !== null && after !== null;

      // Bissectrice des deux caps, parcourue dans le sens du virage : pour un
      // virement cet arc contient la direction du vent, pour un empannage son
      // opposé. Le sens compte : sur un virage de 180°, l'arc court est
      // indéfini et seule la direction de rotation départage.
      let bisector = normalizeAngle(points[i].bearing + cumulativeTurn / 2);
      let headingChange = Math.abs(cumulativeTurn);
      if (before && after) {
        let delta = angleDiff(after.heading, before.heading);
        if (Math.sign(delta) !== turnSign && Math.abs(delta) > 150) delta += turnSign * 360;
        // Des caps stabilisés qui contredisent le sens du virage ne sont pas
        // exploitables : on garde alors la bissectrice du virage brut.
        if (Math.sign(delta) === turnSign) {
          bisector = normalizeAngle(before.heading + delta / 2);
          headingChange = Math.abs(delta);
        }
      }

      const timeMs = points[apexIndex].timeMs;
      const turnEndMs = points[j].timeMs;
      const type = classifyTurn(bisector, cumulativeTurn, windAt(wind, timeMs));

      if (type !== null) {
        // Métriques de qualité de la manœuvre.
        const entrySpeed = before ? before.meanSpeed : points[turnStart].smoothedSpeed;
        const relaunchIndex = entrySpeed > 0 ? findRelaunch(points, apexIndex, entrySpeed) : null;
        const exitIndex = relaunchIndex ?? j;

        const location: ManeuverLocation = {
          lat: points[apexIndex].lat,
          lon: points[apexIndex].lon,
          type,
          success,
          vmin: minSpd,
          // L'empannage se lit à l'opposé de la bissectrice : le vent y vient de l'arrière.
          localWind: Math.round(normalizeAngle(type === 'tack' ? bisector : bisector + 180)),
          timeMs,
          trackIndex: apexIndex,
          stableHeadings,
          entrySpeed,
          conservation: entrySpeed > 0 ? Math.min(1, minSpd / entrySpeed) : 0,
          relaunchS: relaunchIndex === null ? null : (points[relaunchIndex].timeMs - timeMs) / 1000,
          headingChange,
          distanceM: distanceBetween(points, turnStart, exitIndex),
          entryIndex: turnStart,
          exitIndex,
          entryHeading: points[turnStart].bearing,
          exitHeading: points[j].bearing,
          path: points.slice(turnStart, exitIndex + 1).map((p) => [p.lat, p.lon] as [number, number]),
        };

        if (type === 'tack') {
          if (success) { stats.tackSuccess++; stats.tackVmins.push(minSpd); } else stats.tackFail++;
        } else {
          if (success) { stats.jibeSuccess++; stats.jibeVmins.push(minSpd); } else stats.jibeFail++;
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
