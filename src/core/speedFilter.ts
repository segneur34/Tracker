import { median } from './basics';

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

/** Durée, en secondes, sur laquelle la médiane initiale amorce l'écrêtage. */
export const SEED_WINDOW_S = 10;

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
  return clampByAccelerationFrom(speedsMs, timesMs, options, null, -1).out;
};

/** Reprise de l'écrêtage : à `from`, la valeur retenue au point d'avant, et les valeurs déjà retenues avant `from`. */
export interface ClampResume {
  from: number;
  previous: number;
  prefix: ArrayLike<number>;
}

/**
 * `clampByAcceleration`, repris à `resume.from` quand le calcul précédent
 * vaut encore jusque-là, et qui dit d'où le prochain pourra reprendre
 * (`restart`) : le dernier passage de la boucle, au plus à `settledBefore`,
 * dont la fenêtre de retour (`maxOutlierSeconds`) finit avant
 * `settledBefore`, l'amorce étant figée (un point au-delà de ses
 * `SEED_WINDOW_S` avant `settledBefore`) ; -1 sinon. Les décisions d'avant
 * ce passage ne dépendent que de points figés : un calcul repris là donne la
 * même sortie que le calcul entier (`resumeKinematics`).
 */
export const clampByAccelerationFrom = (
  speedsMs: number[],
  timesMs: number[],
  options: ClampOptions,
  resume: ClampResume | null,
  settledBefore: number
): { out: number[]; restart: number } => {
  const maxAccel = options.maxAccel ?? DEFAULT_MAX_ACCELERATION;
  const maxOutlierSeconds = options.maxOutlierSeconds ?? DEFAULT_MAX_OUTLIER_S;
  const maxSpeedMs = options.maxSpeedMs ?? Infinity;

  const n = speedsMs.length;
  if (n === 0) return { out: [], restart: -1 };

  const out = new Array<number>(n);

  const isPlausible = (fromIndex: number, toIndex: number, fromSpeed: number): boolean => {
    if (speedsMs[toIndex] > maxSpeedMs) return false;
    const dt = (timesMs[toIndex] - timesMs[fromIndex]) / 1000;
    if (dt <= 0) return false;
    return Math.abs(speedsMs[toIndex] - fromSpeed) / dt <= maxAccel;
  };

  let i: number;
  if (resume) {
    for (let k = 0; k < resume.from; k++) out[k] = resume.prefix[k];
    i = resume.from;
  } else {
    // Amorce : médiane des vitesses plausibles des premières secondes.
    const seedValues: number[] = [];
    for (let k = 0; k < n && timesMs[k] - timesMs[0] <= SEED_WINDOW_S * 1000; k++) {
      if (speedsMs[k] <= maxSpeedMs) seedValues.push(speedsMs[k]);
    }
    const seed = seedValues.length > 0 ? median(seedValues) : Math.min(speedsMs[0], maxSpeedMs);

    // Le premier point est jugé contre l'amorce, comme tous les autres, avec
    // une seconde de référence faute d'intervalle précédent.
    const firstDeviation = Math.abs(speedsMs[0] - seed);
    out[0] = speedsMs[0] <= maxSpeedMs && firstDeviation <= maxAccel ? speedsMs[0] : seed;
    i = 1;
  }

  const maxOutlierMs = maxOutlierSeconds * 1000;
  const seedSettled = settledBefore >= 2 && timesMs[settledBefore - 1] - timesMs[0] > SEED_WINDOW_S * 1000;
  let restart = -1;
  while (i < n) {
    if (seedSettled && i <= settledBefore && timesMs[settledBefore] - timesMs[i - 1] > maxOutlierMs) restart = i;
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

  return { out, restart };
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
): number[] => medianFilterByTimeFrom(values, timesMs, windowSeconds, 0, null);

/**
 * `medianFilterByTime` à partir de `from`, les valeurs d'avant reprises de
 * `prefix` (calcul précédent, `resumeKinematics`) : la fenêtre étant
 * centrée, les médianes d'avant `from` ne lisent que des valeurs figées
 * quand `from` est pris une demi-fenêtre avant la première valeur changée.
 */
export const medianFilterByTimeFrom = (
  values: number[],
  timesMs: number[],
  windowSeconds: number,
  from: number,
  prefix: ArrayLike<number> | null
): number[] => {
  if (values.length === 0) return [];

  const halfWindowMs = (windowSeconds * 1000) / 2;
  const out = new Array<number>(values.length);
  for (let k = 0; k < from; k++) out[k] = prefix ? prefix[k] : NaN;
  let start = from;
  while (start > 0 && timesMs[from] - timesMs[start - 1] <= halfWindowMs) start--;
  let end = from;

  // Fenêtre triée tenue à jour (lot 56) : `start` et `end` ne font qu'avancer,
  // on insère `values[end]` et on retire `values[start]` au lieu de trier la
  // fenêtre à chaque point. Même ordre que le tri stable de `median` : une
  // valeur entre après ses égales (elle a le plus grand indice de la fenêtre),
  // la sortante est la première de ses égales (le plus petit) ; -0 et +0
  // gardent ainsi leur place. Une fenêtre qui contient un NaN, que le tri ne
  // range pas de façon sûre, repasse par `median`.
  const window = new SortedWindow();
  let inStart = start;
  let inEnd = start - 1;

  for (let i = from; i < values.length; i++) {
    while (start < i && timesMs[i] - timesMs[start] > halfWindowMs) start++;
    if (end < i) end = i;
    while (end + 1 < values.length && timesMs[end + 1] - timesMs[i] <= halfWindowMs) end++;

    while (inEnd < end) window.add(values[++inEnd]);
    while (inStart < start) window.remove(values[inStart++]);
    out[i] = window.nanCount > 0 ? median(values.slice(start, end + 1)) : window.median();
  }

  return out;
};

/**
 * Valeurs d'une fenêtre glissante, triées comme le tri stable de `median`
 * (`medianFilterByTimeFrom`) ; les NaN sont seulement comptés.
 */
class SortedWindow {
  private sorted = new Float64Array(64);
  private size = 0;
  nanCount = 0;

  /** Ajoute une valeur après ses égales. */
  add(value: number): void {
    if (Number.isNaN(value)) {
      this.nanCount++;
      return;
    }
    if (this.size === this.sorted.length) {
      const grown = new Float64Array(this.sorted.length * 2);
      grown.set(this.sorted);
      this.sorted = grown;
    }
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (value < this.sorted[mid]) hi = mid;
      else lo = mid + 1;
    }
    this.sorted.copyWithin(lo + 1, lo, this.size);
    this.sorted[lo] = value;
    this.size++;
  }

  /** Retire la première des valeurs égales à `value`. */
  remove(value: number): void {
    if (Number.isNaN(value)) {
      this.nanCount--;
      return;
    }
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    this.sorted.copyWithin(lo, lo + 1, this.size);
    this.size--;
  }

  /** Médiane des valeurs, comme `median` (0 si aucune). */
  median(): number {
    if (this.size === 0) return 0;
    const mid = Math.floor(this.size / 2);
    return this.size % 2 === 0 ? (this.sorted[mid - 1] + this.sorted[mid]) / 2 : this.sorted[mid];
  }
}

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
