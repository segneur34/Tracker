import type { PointData } from '../utils/kinematics';
import {
  MANEUVER_MAX_STEP_S,
  ORIENTATION_MAX_CONSERVATION,
  TURN_STRIDE_MIN_S,
  WIND_CONFIDENCE_MIN,
  WIND_ESTIMATION_MIN_SPEED_KN,
} from './sailingConfig';

/**
 * Estimation du vent à partir de la seule trace GPS.
 *
 * Critère physique de base : un engin à voile ne va jamais vite face au vent.
 * Sur la polaire de la trace, le vent est au centre de l'angle mort, le
 * secteur sans point rapide, encadré symétriquement par les deux allures de
 * près. C'est ce que cherche `estimateWindFromPolar`.
 *
 * L'angle mort a un jumeau : le vent arrière, lui aussi lent. Pour départager
 * les deux, la polaire d'un wingfoil est asymétrique en couverture, on
 * navigue au portant mais jamais dans le cône, et les virements font perdre
 * le vol face au vent, ce que les empannages ne font pas.
 */

export const angleDiff = (a: number, b: number): number => {
  let diff = a - b;
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  return diff;
};

export const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360;

/**
 * Vent montré par un pointeur posé à (`dx`, `dy`) du centre d'une boussole,
 * `dy` compté vers le bas comme à l'écran : 0° en haut (nord), sens horaire,
 * arrondi au degré, dans [0, 360[. La flèche de la boussole part de là vers le centre.
 */
export const pointerWindDeg = (dx: number, dy: number): number =>
  normalizeAngle(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI));

/**
 * Vent saisi au clavier (« 245 », « -10 », « 370 ») : entier ramené dans
 * [0, 360[, ou `null` si le texte ne dit rien.
 */
export const windDegFromText = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^[+-]?\d+(\.\d*)?$/.test(trimmed)) return null;
  return normalizeAngle(Math.round(parseFloat(trimmed)));
};

/** Une case de la polaire de vitesse : angle au vent (« 30° ») et vitesse max, en nœuds. */
export interface PolarBin {
  angle: string;
  vitesse: number;
}

/** Largeur d'une case de la polaire, en degrés. */
const POLAR_BIN_DEG = 10;

/**
 * Polaire de vitesse : la vitesse filtrée la plus haute dans chaque case
 * d'angle au vent `windDeg`, au-dessus de `minSpeedKn`. Pure, pour suivre le
 * vent pendant qu'on le règle sur la carte.
 */
export const speedPolar = (track: readonly PointData[], windDeg: number, minSpeedKn: number): PolarBin[] => {
  const bins = new Array<number>(360 / POLAR_BIN_DEG).fill(0);
  for (const p of track) {
    if (p.smoothedSpeed <= minSpeedKn) continue;
    const binIdx = Math.floor(normalizeAngle(p.bearing - windDeg) / POLAR_BIN_DEG);
    if (p.smoothedSpeed > bins[binIdx]) bins[binIdx] = p.smoothedSpeed;
  }
  return bins.map((maxSpd, i) => ({ angle: `${i * POLAR_BIN_DEG}°`, vitesse: parseFloat(maxSpd.toFixed(1)) }));
};

// ---------------------------------------------------------------------------
// Statistiques circulaires
// ---------------------------------------------------------------------------

export interface CircularStats {
  /** Direction moyenne, en degrés, dans [0, 360[. */
  mean: number;
  /** Longueur du vecteur moyen, de 0 (dispersion totale) à 1 (alignement parfait). */
  R: number;
  /** Écart-type circulaire, en degrés. */
  stdDevDeg: number;
  /** Plus grand écart à la moyenne vers la gauche (négatif) et vers la droite. */
  minDev: number;
  maxDev: number;
  count: number;
}

/**
 * Moyenne vectorielle de directions, éventuellement pondérées. C'est la seule
 * moyenne valide pour des angles : dérouler puis moyenner arithmétiquement
 * diverge dès qu'une inversion apparaît dans la série.
 */
export const circularMean = (angles: number[], weights?: number[]): { mean: number; R: number } => {
  let x = 0;
  let y = 0;
  let total = 0;
  for (let i = 0; i < angles.length; i++) {
    const w = weights ? weights[i] : 1;
    const rad = (angles[i] * Math.PI) / 180;
    x += w * Math.cos(rad);
    y += w * Math.sin(rad);
    total += w;
  }
  if (total === 0) return { mean: 0, R: 0 };
  x /= total;
  y /= total;
  return {
    mean: normalizeAngle((Math.atan2(y, x) * 180) / Math.PI),
    R: Math.sqrt(x * x + y * y),
  };
};

export const circularStats = (angles: number[], weights?: number[]): CircularStats => {
  if (angles.length === 0) {
    return { mean: 0, R: 0, stdDevDeg: 0, minDev: 0, maxDev: 0, count: 0 };
  }
  const { mean, R } = circularMean(angles, weights);

  // Écart-type circulaire standard, borné pour éviter l'infini quand R → 0.
  const stdDevDeg = R > 1e-9 ? (Math.sqrt(-2 * Math.log(Math.min(1, R))) * 180) / Math.PI : 180;

  let minDev = 0;
  let maxDev = 0;
  for (const a of angles) {
    const d = angleDiff(a, mean);
    if (d < minDev) minDev = d;
    if (d > maxDev) maxDev = d;
  }

  return { mean, R, stdDevDeg, minDev, maxDev, count: angles.length };
};

// ---------------------------------------------------------------------------
// Vent au fil du temps, interpolé entre des mesures ponctuelles
// ---------------------------------------------------------------------------

export interface TimedDirection {
  timeMs: number;
  direction: number;
}

/**
 * Interpole une série de directions à un instant, en travaillant sur les
 * écarts à une référence pour ne jamais traverser le saut 359 → 0.
 *
 * Avant la première mesure et après la dernière, la valeur la plus proche est
 * conservée tant que l'on reste à moins de `maxGapMs` : la courbe couvre ainsi
 * le début et la fin de la session, et pas seulement l'intervalle entre deux
 * manœuvres. Renvoie `null` au-delà, comme dans un trou trop large.
 */
export const interpolateDirection = (
  samples: TimedDirection[],
  timeMs: number,
  reference: number,
  maxGapMs: number
): number | null => {
  if (samples.length === 0) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (timeMs < first.timeMs) return first.timeMs - timeMs <= maxGapMs ? first.direction : null;
  if (timeMs > last.timeMs) return timeMs - last.timeMs <= maxGapMs ? last.direction : null;

  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeMs <= timeMs) lo = mid; else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  if (hi !== lo && b.timeMs - a.timeMs > maxGapMs) return null;

  const span = b.timeMs - a.timeMs;
  const ratio = span > 0 ? (timeMs - a.timeMs) / span : 0;
  const devA = angleDiff(a.direction, reference);
  const devB = angleDiff(b.direction, reference);
  return normalizeAngle(reference + devA + (devB - devA) * ratio);
};

/**
 * Vent en fonction du temps à partir de mesures ponctuelles : interpolation
 * entre deux mesures, valeur de la plus proche à moins de `maxGapMs` des
 * bornes, et repli fourni partout ailleurs : dans un trou trop large, au-delà
 * de `maxGapMs` avant la première mesure ou après la dernière (même règle aux
 * bords qu'au milieu, décision du 27/10), et sans aucune mesure.
 */
export const buildWindTimeline = (
  samples: TimedDirection[],
  fallback: number,
  maxGapMs: number
): ((timeMs: number) => number) => {
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  if (sorted.length === 0) return () => fallback;
  const reference = circularMean(sorted.map((s) => s.direction)).mean;

  return (timeMs: number) => interpolateDirection(sorted, timeMs, reference, maxGapMs) ?? fallback;
};

// ---------------------------------------------------------------------------
// Polaire de la trace et centre de l'angle mort
// ---------------------------------------------------------------------------

/** Demi-ouverture de l'angle mort, en degrés. */
export const NO_GO_HALF_ANGLE = 35;
/** Secteur de près, de part et d'autre de l'angle mort, en degrés du vent. */
export const UPWIND_SECTOR: [number, number] = [40, 85];
/** Poids de la pénalité des vitesses dans l'angle mort. */
const NO_GO_PENALTY = 4;

/** Vitesse maximale atteinte dans chaque secteur de 1° de cap. */
export const buildMaxSpeedsByBearing = (points: PointData[], minSpeedKn: number): number[] => {
  const maxSpeeds = new Array<number>(360).fill(0);
  for (const p of points) {
    if (p.smoothedSpeed <= minSpeedKn) continue;
    const index = normalizeAngle(Math.round(p.bearing)) % 360;
    if (p.smoothedSpeed > maxSpeeds[index]) maxSpeeds[index] = p.smoothedSpeed;
  }
  return maxSpeeds;
};

/** Décomposition du score d'une direction candidate. */
export interface PolarScore {
  /** Somme des vitesses max dans l'angle mort : doit être minimale. */
  noGo: number;
  /** Somme des vitesses max au près, bord gauche puis bord droit. */
  left: number;
  right: number;
  score: number;
}

export const scoreWindCandidate = (maxSpeeds: number[], w: number): PolarScore => {
  let noGo = 0;
  let left = 0;
  let right = 0;
  const [lo, hi] = UPWIND_SECTOR;

  for (let c = 0; c < 360; c++) {
    const spd = maxSpeeds[c];
    if (spd === 0) continue;
    const d = angleDiff(c, w);
    const abs = Math.abs(d);
    if (abs <= NO_GO_HALF_ANGLE) noGo += spd;
    else if (d < 0 && abs >= lo && abs <= hi) left += spd;
    else if (d > 0 && abs >= lo && abs <= hi) right += spd;
  }

  return { noGo, left, right, score: left + right - NO_GO_PENALTY * noGo - Math.abs(left - right) };
};

export interface PolarWindEstimate {
  /** Centre de l'angle mort, en degrés. */
  direction: number;
  /** Équilibre des deux bords de près : 0 un seul bord, 1 symétrique. */
  symmetry: number;
  /** Variété des caps parcourus, de 0 à 1. */
  coverage: number;
  /** Netteté de l'angle mort : 1 s'il est vide, 0 s'il est aussi rapide que le près. */
  clarity: number;
  /** Avance du score retenu sur celui de la direction opposée, de 0 à 1. */
  contrast: number;
  best: PolarScore;
  opposite: PolarScore;
}

/** Écart minimal, en degrés, entre deux candidats retenus. */
export const CANDIDATE_MIN_SEPARATION = 45;

/**
 * Intervalle moyen entre deux points, en secondes, au-delà duquel la trace
 * soutient de moins en moins la polaire : la durée d'un virage. Un enregistreur
 * économique pose un point quand on avance et se tait dès qu'on ralentit (§10,
 * point 27) : un virement entier tient dans un seul pas, dont la corde pointe
 * face au vent, là où la polaire attend l'angle mort, et le point le plus lent
 * n'est jamais enregistré, si bien que les manœuvres ne peuvent plus orienter
 * le vent. Une telle trace (517 points en 2 h, un toutes les 14 s en moyenne)
 * annonçait 90 % de confiance sur une direction fausse de 180°, que
 * l'utilisateur corrigeait par « Inverser ».
 */
export const POLAR_SUPPORT_INTERVAL_S = 5;

/**
 * Soutien de la trace à la polaire, de 0 à 1 : `POLAR_SUPPORT_INTERVAL_S`
 * rapporté à l'intervalle moyen entre deux points (la durée de la trace sur son
 * nombre de pas, pas de reprise de pause exclus), plafonné à 1. Continu, sans
 * marche : exactement 1 à 1 Hz comme à 5 Hz, 5/14 sur un point toutes les 14 s.
 * La moyenne de toute la trace, et non la médiane des pas qui nourrissent la
 * polaire : l'enregistreur économique pose ses points toutes les 6 s en marche
 * (médiane 6 s, soutien 0,83) et se tait des minutes dès qu'on ralentit ; c'est
 * ce silence qui lui cache les virages, et seule la moyenne le voit. Vaut 1
 * sans aucun pas.
 */
export const polarSampling = (points: readonly PointData[]): number => {
  let totalS = 0;
  let steps = 0;
  for (let k = 1; k < points.length; k++) {
    if (points[k].segmentStart) continue;
    totalS += (points[k].timeMs - points[k - 1].timeMs) / 1000;
    steps++;
  }
  if (steps === 0) return 1;
  const meanS = totalS / steps;
  return meanS > POLAR_SUPPORT_INTERVAL_S ? POLAR_SUPPORT_INTERVAL_S / meanS : 1;
};

/**
 * Variété des caps parcourus : part des secteurs de 10° visités, saturée à
 * douze secteurs. Une session qui a balayé 120° de caps vaut déjà 1.
 */
const coverageOf = (maxSpeeds: number[]): number => {
  const sectors = new Array<boolean>(36).fill(false);
  for (let c = 0; c < 360; c++) if (maxSpeeds[c] > 0) sectors[Math.floor(c / 10)] = true;
  return Math.min(1, sectors.filter(Boolean).length / 12);
};

const describeCandidate = (
  maxSpeeds: number[],
  w: number,
  coverage: number
): PolarWindEstimate => {
  const best = scoreWindCandidate(maxSpeeds, w);
  const opposite = scoreWindCandidate(maxSpeeds, (w + 180) % 360);

  const edges = best.left + best.right;
  const symmetry = edges > 0 ? 1 - Math.abs(best.left - best.right) / edges : 0;
  const clarity = edges > 0 ? Math.max(0, 1 - best.noGo / edges) : 0;

  const spread = Math.abs(best.score) + Math.abs(opposite.score);
  const contrast = spread > 0 ? Math.max(0, (best.score - opposite.score) / spread) : 0;

  return { direction: w, symmetry, coverage, clarity, contrast, best, opposite };
};

/**
 * Les meilleures directions candidates au sens du score de l'angle mort :
 * maxima locaux du score, séparés d'au moins 45°, par score décroissant.
 *
 * Le score seul peut se laisser piéger par un trou de couverture, un secteur
 * jamais navigué entre le près et le portant. Plutôt que de prendre
 * aveuglément le maximum, on remonte plusieurs candidats que les manœuvres
 * départageront.
 */
export const polarWindCandidates = (
  points: PointData[],
  minSpeedKn = WIND_ESTIMATION_MIN_SPEED_KN,
  count = 3
): PolarWindEstimate[] => {
  const maxSpeeds = buildMaxSpeedsByBearing(points, minSpeedKn);

  const scores = new Array<number>(360);
  for (let w = 0; w < 360; w++) scores[w] = scoreWindCandidate(maxSpeeds, w).score;

  const coverage = coverageOf(maxSpeeds);

  const order = Array.from({ length: 360 }, (_, w) => w).sort((a, b) => scores[b] - scores[a]);
  const chosen: number[] = [];
  for (const w of order) {
    if (chosen.length >= count) break;
    if (chosen.every((c) => Math.abs(angleDiff(w, c)) >= CANDIDATE_MIN_SEPARATION)) chosen.push(w);
  }

  return chosen.map((w) => describeCandidate(maxSpeeds, w, coverage));
};

/**
 * Descripteur d'une direction imposée, sans passer par la recherche des
 * maxima du score. Sert au jumeau au vent arrière, testé comme candidat mais
 * qui n'est pas un maximum local du score polaire : sans lui, une direction
 * retenue pourrait n'avoir aucun descripteur, et donc aucune confiance à elle.
 */
export const describeWindCandidate = (
  points: PointData[],
  direction: number,
  minSpeedKn = WIND_ESTIMATION_MIN_SPEED_KN
): PolarWindEstimate => {
  const maxSpeeds = buildMaxSpeedsByBearing(points, minSpeedKn);
  return describeCandidate(maxSpeeds, normalizeAngle(direction), coverageOf(maxSpeeds));
};

/**
 * Cherche la direction qui centre le mieux l'angle mort : peu de vitesse dans
 * le cône, de la vitesse au près des deux côtés, et équilibre entre les deux
 * bords. C'est la méthode d'origine de l'application.
 */
export const estimateWindFromPolar = (
  points: PointData[],
  minSpeedKn = WIND_ESTIMATION_MIN_SPEED_KN
): PolarWindEstimate => polarWindCandidates(points, minSpeedKn, 1)[0];

// ---------------------------------------------------------------------------
// Virages francs et orientation
// ---------------------------------------------------------------------------

/** Virage cumulé minimal pour qu'une inflexion serve à orienter l'axe. */
const ORIENTATION_MIN_TURN_DEG = 60;
/** Durée d'observation d'un virage pour l'orientation, en secondes. */
const ORIENTATION_WINDOW_S = 12;
/**
 * Cohérence minimale d'un virage : rapport entre le virage net et la somme
 * des rotations. Un vrai virage tourne toujours dans le même sens, rapport
 * proche de 1. Une chute produit un cap qui part dans tous les sens, rapport
 * faible, et ne doit pas passer pour un virement.
 */
export const TURN_MIN_COHERENCE = 0.6;
/** Durée, en secondes, de cap stable exigée après un virage. */
const EXIT_STABILITY_S = 5;
/** Variation de cap maximale sur un pas d'au moins `TURN_STRIDE_MIN_S`, en degrés, pour un cap tenu. */
const EXIT_MAX_STEP_DEG = 45;

/**
 * Vitesse de rotation minimale, en degrés par seconde, pour que le cap
 * « tourne franchement » d'un pas au suivant : 2° par pas à 1 Hz, comme
 * avant, et la même rotation à 5 Hz, où un pas de 2° voulait dire 10°/s.
 */
export const TURNING_RATE_MIN_DEG_S = 2;

/**
 * Indice du point qui clôt un pas d'au moins `TURN_STRIDE_MIN_S` depuis le
 * point `k` : le premier dont l'horodatage est à 0,9 s au moins, borné à
 * `last` (règle 2). À 1 Hz, c'est le point suivant ; à 5 Hz, le cinquième.
 */
export const strideEnd = (points: readonly PointData[], k: number, last: number): number => {
  const untilMs = points[k].timeMs + TURN_STRIDE_MIN_S * 1000;
  let next = k + 1;
  while (next < last && points[next].timeMs < untilMs) next++;
  return next;
};

/**
 * Vrai si le cap tourne dans le sens `turnSign` du point `from` au point `to`,
 * à `minRateDegS` au moins (par défaut, franchement : 2°/s).
 */
export const isTurningStep = (
  points: readonly PointData[],
  from: number,
  to: number,
  turnSign: number,
  minRateDegS: number = TURNING_RATE_MIN_DEG_S
): boolean => {
  const step = angleDiff(points[to].bearing, points[from].bearing);
  const dtS = (points[to].timeMs - points[from].timeMs) / 1000;
  return Math.sign(step) === turnSign && Math.abs(step) >= minRateDegS * Math.max(dtS, 0);
};

/** Ce que la fenêtre d'observation ouverte au point `i` dit du virage, sans le vent. */
export interface TurnWindowScan {
  /** Dernier point de la fenêtre. */
  j: number;
  /** Virage net, en degrés signés, sommé point à point. */
  cumulativeTurn: number;
  /**
   * Somme des rotations, en degrés, lue par pas d'au moins `TURN_STRIDE_MIN_S` :
   * point à point, cinq pas bruités de 0,2 s sommaient à 5 Hz cinq fois le
   * bruit d'un pas de 1 s, et la cohérence (virage net sur somme des rotations)
   * tombait sous son seuil sur presque tous les virages.
   */
  totalRotation: number;
}

/**
 * Balayage de la fenêtre d'observation d'un virage, commun à la détection des
 * manœuvres (`analyzeManeuvers`) et à l'orientation du vent (`observeTurns`),
 * pour que les deux voient les mêmes virages : les points qui tombent à
 * `windowMs` au plus du point `i`, ou, fenêtre vide, un pas unique jusqu'à
 * `maxStepMs`. Un enregistreur économique s'est alors tu pendant le virage,
 * qui tient tout entier dans ce seul pas ; jamais à travers une reprise de
 * pause, où rien n'a été parcouru.
 */
export const scanTurnWindow = (
  points: readonly PointData[],
  i: number,
  windowMs: number,
  maxStepMs: number
): TurnWindowScan => {
  const strideMs = TURN_STRIDE_MIN_S * 1000;
  let cumulativeTurn = 0;
  let totalRotation = 0;
  let strideStart = i;
  let j = i;
  while (
    j + 1 < points.length &&
    (points[j + 1].timeMs - points[i].timeMs <= windowMs ||
      (j === i && !points[j + 1].segmentStart && points[j + 1].timeMs - points[i].timeMs <= maxStepMs))
  ) {
    cumulativeTurn += angleDiff(points[j + 1].bearing, points[j].bearing);
    j++;
    if (points[j].timeMs - points[strideStart].timeMs >= strideMs) {
      totalRotation += Math.abs(angleDiff(points[j].bearing, points[strideStart].bearing));
      strideStart = j;
    }
  }
  // Reste de fenêtre plus court qu'un pas : compté tel quel, pour que la somme
  // des rotations couvre toujours le virage net.
  if (strideStart < j) totalRotation += Math.abs(angleDiff(points[j].bearing, points[strideStart].bearing));
  return { j, cumulativeTurn, totalRotation };
};

/** Un virage franc relevé dans la trace, avec ce qu'il dit du vent. */
export interface TurnObservation {
  /** Cap au point le plus lent du virage. Face au vent si le vol a été perdu. */
  headingAtMin: number;
  /** Bissectrice des caps d'entrée et de sortie, dans le sens du virage. */
  midHeading: number;
  minSpeed: number;
  speedLoss: number;
  cumulativeTurn: number;
  /** Vrai si le vol a été perdu : c'est un virement. */
  slow: boolean;
}

/**
 * Relève tous les virages cohérents de plus de 60° de la trace.
 *
 * `minEntrySpeedKn` écarte les sorties de chute, où l'on repart d'un cap
 * quelconque. C'est la vitesse plancher du support, celle qui sert déjà à la
 * polaire, et non une constante : une planche lente n'a jamais 5 nœuds au
 * départ d'un virage, et tous ses virages disparaîtraient.
 */
export const observeTurns = (
  points: PointData[],
  minEntrySpeedKn: number = WIND_ESTIMATION_MIN_SPEED_KN
): TurnObservation[] => {
  const turns: TurnObservation[] = [];
  const windowMs = ORIENTATION_WINDOW_S * 1000;
  let i = 0;

  while (i < points.length - 1) {
    // Même balayage que `analyzeManeuvers`, pour que les deux voient les mêmes virages.
    const scan = scanTurnWindow(points, i, windowMs, MANEUVER_MAX_STEP_S * 1000);
    let { j, cumulativeTurn } = scan;
    let minSpd = points[i].smoothedSpeed;
    let minIndex = i;
    for (let k = i + 1; k <= j; k++) {
      if (points[k].smoothedSpeed < minSpd) {
        minSpd = points[k].smoothedSpeed;
        minIndex = k;
      }
    }

    const coherent = scan.totalRotation > 0 && Math.abs(cumulativeTurn) / scan.totalRotation >= TURN_MIN_COHERENCE;
    // Un virage commence en vol : la sortie d'une chute, où l'on repart
    // depuis un cap quelconque, n'est pas un virage.
    const entrySpeed = points[i].smoothedSpeed;
    const startsFlying = entrySpeed >= minEntrySpeedKn;

    if (Math.abs(cumulativeTurn) > ORIENTATION_MIN_TURN_DEG && coherent && startsFlying) {
      // Prolongation tant que le cap tourne franchement dans le même sens, par
      // pas d'au moins `TURN_STRIDE_MIN_S` (règle 2), le point le plus lent
      // suivi sur tous les points du pas.
      const turnSign = Math.sign(cumulativeTurn);
      while (j + 1 < points.length) {
        const next = strideEnd(points, j, points.length - 1);
        if (points[next].timeMs - points[i].timeMs > 2 * windowMs) break;
        if (!isTurningStep(points, j, next, turnSign)) break;
        for (let k = j + 1; k <= next; k++) {
          cumulativeTurn += angleDiff(points[k].bearing, points[k - 1].bearing);
          if (points[k].smoothedSpeed < minSpd) {
            minSpd = points[k].smoothedSpeed;
            minIndex = k;
          }
        }
        j = next;
      }

      // Un virage débouche sur un nouveau cap tenu. Le premier pas d'une chute
      // ressemble à un virage propre, mais le cap part ensuite dans tous les
      // sens : on exige quelques secondes de cap stable après le virage, lu
      // par pas d'au moins `TURN_STRIDE_MIN_S`.
      let exitStable = true;
      for (let k = j; k + 1 < points.length; ) {
        const next = strideEnd(points, k, points.length - 1);
        if (points[next].timeMs - points[j].timeMs > EXIT_STABILITY_S * 1000) break;
        if (Math.abs(angleDiff(points[next].bearing, points[k].bearing)) > EXIT_MAX_STEP_DEG) {
          exitStable = false;
          break;
        }
        k = next;
      }

      if (exitStable) {
        turns.push({
          headingAtMin: points[minIndex].bearing,
          midHeading: normalizeAngle(points[i].bearing + cumulativeTurn / 2),
          minSpeed: minSpd,
          speedLoss: Math.max(0, entrySpeed - minSpd),
          cumulativeTurn,
          slow: minSpd < ORIENTATION_MAX_CONSERVATION * entrySpeed,
        });
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  return turns;
};

export interface OrientationVote {
  /** Poids en faveur de `axis` comme direction d'où vient le vent. */
  forAxis: number;
  /** Poids en faveur de l'opposé. */
  forOpposite: number;
}

/**
 * Vote d'orientation par les virages. Un virement, vol perdu, a son point le
 * plus lent face au vent. Un virage qui a conservé le vol est le plus souvent
 * un empannage, dont le milieu est au vent arrière ; une abattée de 90° a son
 * milieu au travers et ne pèse rien, d'où le cosinus.
 */
export const orientationVotes = (turns: TurnObservation[], axis: number): OrientationVote => {
  const vote: OrientationVote = { forAxis: 0, forOpposite: 0 };
  for (const t of turns) {
    if (t.slow) {
      const c = Math.cos((angleDiff(t.midHeading, axis) * Math.PI) / 180);
      if (c > 0) vote.forAxis += c; else vote.forOpposite += -c;
    } else {
      const c = Math.cos((angleDiff(t.midHeading, axis) * Math.PI) / 180);
      const weight = Math.min(1, Math.abs(t.cumulativeTurn) / 180);
      if (c > 0) vote.forOpposite += c * weight; else vote.forAxis += -c * weight;
    }
  }
  return vote;
};

// ---------------------------------------------------------------------------
// Estimation par la polaire, orientée
// ---------------------------------------------------------------------------

export type WindOrientationSource = 'polaire' | 'virages';

export interface WindEstimate {
  /** Direction d'où vient le vent, en degrés. */
  direction: number;
  /** Fiabilité entre 0 et 1. */
  confidence: number;
  reliable: boolean;
  /** Ce qui a départagé l'angle mort de son jumeau au vent arrière. */
  orientedBy: WindOrientationSource;
  /** Nombre de manœuvres ayant affiné l'estimation. */
  maneuverCount: number;
}

export interface WindEstimateOptions {
  minSpeedKn?: number;
}

/** Contraste minimal du score polaire pour que l'orientation soit acquise sans aide. */
const POLAR_CONTRAST_MIN = 0.15;

/**
 * Centre de l'angle mort, puis orientation. Le score polaire départage
 * lui-même l'angle mort de son jumeau quand la couverture est assez
 * asymétrique ; sinon les virages tranchent, sinon la polaire garde son
 * orientation avec une confiance réduite d'autant.
 */
export const estimateWindPolar = (points: PointData[], options: WindEstimateOptions = {}): WindEstimate => {
  const minSpeedKn = options.minSpeedKn ?? WIND_ESTIMATION_MIN_SPEED_KN;
  const polar = estimateWindFromPolar(points, minSpeedKn);
  const candidateA = polar.direction;
  const candidateB = (polar.direction + 180) % 360;

  let direction = candidateA;
  let orientedBy: WindOrientationSource = 'polaire';
  let orientationConfidence = Math.min(1, polar.contrast / POLAR_CONTRAST_MIN);

  if (polar.contrast < POLAR_CONTRAST_MIN) {
    const votes = orientationVotes(observeTurns(points, minSpeedKn), candidateA);
    const total = votes.forAxis + votes.forOpposite;
    if (total > 0.5) {
      direction = votes.forAxis >= votes.forOpposite ? candidateA : candidateB;
      orientedBy = 'virages';
      orientationConfidence = Math.abs(votes.forAxis - votes.forOpposite) / total;
    }
  }

  const confidence = polar.symmetry * polar.coverage * polar.clarity * orientationConfidence;

  return {
    direction,
    confidence,
    reliable: confidence >= WIND_CONFIDENCE_MIN,
    orientedBy,
    maneuverCount: 0,
  };
};
