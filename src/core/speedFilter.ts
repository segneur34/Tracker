/**
 * Filtrage du bruit GPS sur les séries de vitesse.
 *
 * Une vitesse dérivée de positions successives hérite de l'incertitude de
 * chaque position. Un seul point aberrant produit un pic qui contamine ensuite
 * la vitesse maximale et les meilleurs segments. Deux protections sont
 * appliquées : un écrêtage des accélérations physiquement impossibles, puis un
 * filtre médian, qui rejette les valeurs extrêmes au lieu de les diluer comme
 * le ferait une moyenne.
 *
 * Toutes les fenêtres sont exprimées en secondes et jamais en nombre de
 * points : une montre à 1 Hz et une montre à 5 Hz doivent donner le même
 * résultat sur la même session.
 */

/** Accélération maximale retenue comme physiquement plausible, en m/s². */
export const DEFAULT_MAX_ACCELERATION = 10;

/** Durée maximale d'une aberration GPS, en secondes. Au-delà, le changement est jugé réel. */
export const DEFAULT_MAX_OUTLIER_S = 3;

/** Largeur par défaut du filtre médian, en secondes. */
export const DEFAULT_MEDIAN_WINDOW_S = 3;

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Durée, en secondes, sur laquelle la médiane initiale amorce l'écrêtage. */
const SEED_WINDOW_S = 10;

export interface ClampOptions {
  /** Accélération maximale plausible, en m/s². */
  maxAccel?: number;
  /** Durée maximale d'une aberration, en secondes. */
  maxOutlierSeconds?: number;
  /** Vitesse maximale plausible, en m/s. Au-delà, aberration quoi qu'il arrive. */
  maxSpeedMs?: number;
}

/**
 * Écarte les variations de vitesse physiquement impossibles.
 *
 * Un point dont l'accélération depuis la dernière valeur retenue dépasse le
 * seuil, ou dont la vitesse dépasse le plafond du support, est suspect. Deux
 * cas se présentent :
 *
 * - la série revient à une valeur plausible dans les secondes qui suivent :
 *   c'était une aberration de position, tous les points intermédiaires sont
 *   remplacés par la dernière valeur retenue ;
 * - elle ne revient pas : le changement est réel, on l'accepte.
 *
 * Cette recherche du retour est indispensable. Remplacer aveuglément chaque
 * point suspect par la valeur précédente verrouillerait le filtre : une fois
 * bloqué bas, il rejetterait ensuite toute vitesse réelle comme un saut trop
 * brutal, et la trace entière tomberait à zéro.
 *
 * La référence initiale est la médiane des premières secondes, et non la
 * première valeur : au démarrage, avant que la montre n'ait un bon fix, les
 * premiers points sont justement les plus suspects. Amorcer sur l'un d'eux
 * ferait passer l'aberration comme référence.
 */
export const clampByAcceleration = (
  speedsMs: number[],
  timesMs: number[],
  maxAccelOrOptions: number | ClampOptions = DEFAULT_MAX_ACCELERATION,
  maxOutlierSecondsArg = DEFAULT_MAX_OUTLIER_S
): number[] => {
  const options: ClampOptions =
    typeof maxAccelOrOptions === 'number'
      ? { maxAccel: maxAccelOrOptions, maxOutlierSeconds: maxOutlierSecondsArg }
      : maxAccelOrOptions;
  const maxAccel = options.maxAccel ?? DEFAULT_MAX_ACCELERATION;
  const maxOutlierSeconds = options.maxOutlierSeconds ?? DEFAULT_MAX_OUTLIER_S;
  const maxSpeedMs = options.maxSpeedMs ?? Infinity;

  const n = speedsMs.length;
  if (n === 0) return [];

  const out = new Array<number>(n);

  // Amorce : médiane des vitesses plausibles des premières secondes.
  const seedValues: number[] = [];
  for (let k = 0; k < n && timesMs[k] - timesMs[0] <= SEED_WINDOW_S * 1000; k++) {
    if (speedsMs[k] <= maxSpeedMs) seedValues.push(speedsMs[k]);
  }
  const seed = seedValues.length > 0 ? median(seedValues) : Math.min(speedsMs[0], maxSpeedMs);

  const isPlausible = (fromIndex: number, toIndex: number, fromSpeed: number): boolean => {
    if (speedsMs[toIndex] > maxSpeedMs) return false;
    const dt = (timesMs[toIndex] - timesMs[fromIndex]) / 1000;
    if (dt <= 0) return false;
    return Math.abs(speedsMs[toIndex] - fromSpeed) / dt <= maxAccel;
  };

  // Le premier point est jugé contre l'amorce, comme tous les autres, avec
  // une seconde de référence faute d'intervalle précédent.
  const firstDeviation = Math.abs(speedsMs[0] - seed);
  out[0] = speedsMs[0] <= maxSpeedMs && firstDeviation <= maxAccel ? speedsMs[0] : seed;

  let i = 1;
  while (i < n) {
    const previous = out[i - 1];

    if (timesMs[i] - timesMs[i - 1] <= 0) {
      out[i] = previous;
      i++;
      continue;
    }

    if (isPlausible(i - 1, i, previous)) {
      out[i] = speedsMs[i];
      i++;
      continue;
    }

    // Point suspect : y a-t-il un retour plausible dans le délai imparti ?
    let recovery = -1;
    for (let k = i + 1; k < n && timesMs[k] - timesMs[i - 1] <= maxOutlierSeconds * 1000; k++) {
      if (isPlausible(i - 1, k, previous)) {
        recovery = k;
        break;
      }
    }

    if (recovery === -1) {
      // Pas de retour : changement réel, sauf si la valeur dépasse le plafond
      // du support, qui n'est jamais accepté.
      out[i] = speedsMs[i] <= maxSpeedMs ? speedsMs[i] : previous;
      i++;
    } else {
      // Aberration : on neutralise tout jusqu'au point de retour inclus.
      for (let m = i; m < recovery; m++) out[m] = previous;
      out[recovery] = speedsMs[recovery];
      i = recovery + 1;
    }
  }

  return out;
};

/**
 * Filtre médian sur une fenêtre temporelle centrée.
 *
 * La fenêtre étant bornée par le temps et non par un nombre de points, le
 * résultat ne dépend pas de la fréquence d'échantillonnage de l'appareil.
 */
export const medianFilterByTime = (
  values: number[],
  timesMs: number[],
  windowSeconds = DEFAULT_MEDIAN_WINDOW_S
): number[] => {
  if (values.length === 0) return [];

  const halfWindowMs = (windowSeconds * 1000) / 2;
  const out = new Array<number>(values.length);
  let start = 0;
  let end = 0;

  for (let i = 0; i < values.length; i++) {
    while (start < i && timesMs[i] - timesMs[start] > halfWindowMs) start++;
    if (end < i) end = i;
    while (end + 1 < values.length && timesMs[end + 1] - timesMs[i] <= halfWindowMs) end++;

    out[i] = median(values.slice(start, end + 1));
  }

  return out;
};

/**
 * Lissage par ajustement linéaire local sur une fenêtre temporelle centrée.
 *
 * Pour chaque point, on ajuste une droite aux voisins de la fenêtre et on
 * retient sa valeur au point. Au centre d'une trace, le résultat est celui
 * d'une moyenne mobile. Aux extrémités, là où la fenêtre est tronquée d'un
 * côté, la moyenne dériverait vers l'intérieur de la trace et raboterait
 * toute pente. La droite, elle, suit la pente : une rampe parfaite ressort
 * intacte, du premier au dernier point.
 */
export const linearSmoothByTime = (
  values: number[],
  timesMs: number[],
  windowSeconds: number
): number[] => {
  if (values.length === 0) return [];

  const halfWindowMs = (windowSeconds * 1000) / 2;
  const out = new Array<number>(values.length);
  let start = 0;
  let end = 0;

  for (let i = 0; i < values.length; i++) {
    while (start < i && timesMs[i] - timesMs[start] > halfWindowMs) start++;
    if (end < i) end = i;
    while (end + 1 < values.length && timesMs[end + 1] - timesMs[i] <= halfWindowMs) end++;

    // Moindres carrés, abscisse relative au point courant : l'ordonnée à
    // l'origine de la droite est directement la valeur lissée.
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let k = start; k <= end; k++) {
      const x = (timesMs[k] - timesMs[i]) / 1000;
      const y = values[k];
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }

    const denominator = n * sxx - sx * sx;
    out[i] = Math.abs(denominator) < 1e-9 ? sy / n : (sy * sxx - sx * sxy) / denominator;
  }

  return out;
};

/**
 * Moyenne mobile sur une fenêtre temporelle centrée.
 * Conservée pour les séries où le lissage prime sur le rejet d'aberrations.
 */
export const meanFilterByTime = (
  values: number[],
  timesMs: number[],
  windowSeconds: number
): number[] => {
  if (values.length === 0) return [];

  const halfWindowMs = (windowSeconds * 1000) / 2;
  const out = new Array<number>(values.length);
  let start = 0;
  let end = 0;
  // `sum` vaut en permanence la somme de values[start..end].
  let sum = values[0];

  for (let i = 0; i < values.length; i++) {
    while (end < i) {
      end++;
      sum += values[end];
    }
    while (start < i && timesMs[i] - timesMs[start] > halfWindowMs) {
      sum -= values[start];
      start++;
    }
    while (end + 1 < values.length && timesMs[end + 1] - timesMs[i] <= halfWindowMs) {
      end++;
      sum += values[end];
    }

    out[i] = sum / (end - start + 1);
  }

  return out;
};
