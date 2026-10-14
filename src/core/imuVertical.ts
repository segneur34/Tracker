import type { ImuRecording, ImuSeries } from './imuFile';

/**
 * Accélération verticale du monde, tirée de l'accéléromètre et du gyroscope du
 * téléphone (`core/imuFile.ts`), quelle que soit son orientation : la base
 * commune des sauts (`core/jumps.ts`) et du pumping en surf
 * (`surfing/pumping.ts`). Tout est en SI : instants du fichier en
 * microsecondes, accélérations en m/s².
 *
 * 1. accéléromètre et gyroscope ramenés sur une grille fixe (`gridStepS`) :
 *    une capture à 50, 100 ou 200 Hz donne le même résultat ;
 * 2. échelle : la pesanteur locale est la médiane de la force mesurée aux
 *    moments calmes ;
 * 3. verticale : filtre complémentaire sur le vecteur « haut » dans le repère
 *    du téléphone, gyroscope intégré et recalé doucement sur la force mesurée
 *    quand elle vaut à peu près g. Une passe aller, une passe retour,
 *    moyennées : le recalage ne traîne d'aucun côté.
 */

/** Pesanteur normale, en m/s² : l'unité des seuils exprimés en g. */
export const STANDARD_G = 9.80665;

/** Constantes du calcul de la verticale, communes aux sauts et au pumping. */
export interface AttitudeParams {
  /** Pas de la grille où les deux capteurs sont ramenés, en secondes. */
  gridStepS: number;
  /** Écart entre deux mesures au-delà duquel la capture a un trou, en secondes. */
  maxGapS: number;
  /** Moment calme : force mesurée à moins de cette part de g… */
  calmForceFraction: number;
  /** …et rotation sous ce seuil, en rad/s (échelle de l'accéléromètre). */
  calmRotationRadS: number;
  /** Durée de calme en deçà de laquelle l'échelle reste g, en secondes. */
  minCalmS: number;
  /** Constante de temps du recalage de la verticale, en secondes. */
  attitudeTauS: number;
  /** Recalage coupé au-delà de cette rotation, en rad/s. */
  attitudeMaxRotationRadS: number;
  /** Durée moyennée pour la direction de départ de chaque passe, en secondes. */
  attitudeInitS: number;
}

/** Fenêtre de mesures, en instants du fichier (µs). */
export type ImuWindow = [number, number];

// --- Grille ---

/** Premier indice dont l'instant est au moins `value`. */
export const lowerBound = (t: Float64Array, value: number): number => {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Mesures d'un flux entre deux instants, bornes comprises : indices [from, to). */
export const rangeOf = (s: ImuSeries, fromUs: number, toUs: number): [number, number] => [lowerBound(s.t, fromUs), lowerBound(s.t, toUs + 0.5)];

/**
 * Valeurs d'un flux sur la grille, par interpolation linéaire entre les seules
 * mesures de [from, to) : une fenêtre se calcule pareil, que les mesures qui
 * l'entourent existent ou non. `gap` marque un point entre deux mesures trop
 * espacées.
 */
const resample = (s: ImuSeries, from: number, to: number, startUs: number, n: number, stepUs: number, maxGapUs: number, gap: Uint8Array) => {
  const out = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  let j = from;
  for (let i = 0; i < n; i++) {
    const ti = startUs + i * stepUs;
    while (j < to - 2 && s.t[j + 1] <= ti) j += 1;
    const k = Math.min(j + 1, to - 1);
    const ta = s.t[j];
    const tb = s.t[k];
    const w = tb > ta ? Math.min(1, Math.max(0, (ti - ta) / (tb - ta))) : 0;
    for (let a = 0; a < 3; a++) out[a][i] = s.values[a][j] * (1 - w) + s.values[a][k] * w;
    if (tb - ta > maxGapUs) gap[i] = 1;
  }
  return out;
};

const median = (values: Float64Array): number => {
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
};

/** Vecteur « haut » dans le repère du téléphone, par une passe du filtre complémentaire, aller ou retour. */
const attitudePass = (
  f: Float64Array[], w: Float64Array[], norm: Float64Array, n: number, dt: number, gLocal: number, d: AttitudeParams, forward: boolean
): Float64Array[] => {
  const up = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const idx = (s: number) => (forward ? s : n - 1 - s);
  let x = 0;
  let y = 0;
  let z = 0;
  const init = Math.min(n, Math.max(1, Math.round(d.attitudeInitS / dt)));
  for (let s = 0; s < init; s++) {
    const i = idx(s);
    x += f[0][i];
    y += f[1][i];
    z += f[2][i];
  }
  let len = Math.hypot(x, y, z) || 1;
  x /= len;
  y /= len;
  z /= len;
  const h = forward ? dt : -dt;
  const k = dt / d.attitudeTauS;
  for (let s = 0; s < n; s++) {
    const i = idx(s);
    if (s > 0) {
      // Un vecteur fixe du monde tourne dans le repère du téléphone : du/dt = u × ω.
      const wx = w[0][i];
      const wy = w[1][i];
      const wz = w[2][i];
      const dx = y * wz - z * wy;
      const dy = z * wx - x * wz;
      const dz = x * wy - y * wx;
      x += dx * h;
      y += dy * h;
      z += dz * h;
      if (Math.abs(norm[i] - gLocal) < d.calmForceFraction * gLocal && Math.hypot(wx, wy, wz) < d.attitudeMaxRotationRadS) {
        x += (f[0][i] / norm[i] - x) * k;
        y += (f[1][i] / norm[i] - y) * k;
        z += (f[2][i] / norm[i] - z) * k;
      }
      len = Math.hypot(x, y, z) || 1;
      x /= len;
      y /= len;
      z /= len;
    }
    up[0][i] = x;
    up[1][i] = y;
    up[2][i] = z;
  }
  return up;
};

/** Verticale du monde sur une grille, entre deux instants du fichier. */
export interface ImuVertical {
  /** Accéléromètre et gyroscope du fichier. */
  acc: ImuSeries;
  gyr: ImuSeries;
  /** Premier point de la grille, en instant du fichier (µs), et pas (µs). */
  startUs: number;
  stepUs: number;
  /** Pas de la grille, en secondes. */
  dt: number;
  n: number;
  /** Pesanteur locale, en m/s². */
  gLocal: number;
  /** Accélération verticale, pesanteur retirée, en m/s². */
  aUp: Float64Array;
  /** Force horizontale mesurée (portance, traction de l'aile), en m/s². */
  horizontal: Float64Array;
  /** Vecteur « haut » des passes aller et retour, dans le repère du téléphone. */
  upF: Float64Array[];
  upB: Float64Array[];
  /** 1 sur un point entre deux mesures trop espacées. */
  gap: Uint8Array;
}

/**
 * Verticale entre deux instants du fichier : le calcul complet sur cet
 * intervalle, qui ne lit aucune mesure en dehors. `null` sans accéléromètre ni
 * gyroscope, ou sans assez de mesures.
 */
export const verticalAcceleration = (rec: ImuRecording, d: AttitudeParams, fromUs: number, toUs: number): ImuVertical | null => {
  const acc = rec.series.find((s) => s.info.kind === 'accel');
  const gyr = rec.series.find((s) => s.info.kind === 'gyro');
  if (!acc || !gyr || acc.info.axes < 3 || gyr.info.axes < 3) return null;
  const [aFrom, aTo] = rangeOf(acc, fromUs, toUs);
  const [gFrom, gTo] = rangeOf(gyr, fromUs, toUs);
  if (aTo - aFrom < 2 || gTo - gFrom < 2) return null;
  const startUs = Math.max(acc.t[aFrom], gyr.t[gFrom]);
  const endUs = Math.min(acc.t[aTo - 1], gyr.t[gTo - 1]);
  const stepUs = d.gridStepS * 1e6;
  const n = Math.floor((endUs - startUs) / stepUs) + 1;
  if (n < 2) return null;
  const dt = d.gridStepS;
  const maxGapUs = d.maxGapS * 1e6;
  const gap = new Uint8Array(n);
  const f = resample(acc, aFrom, aTo, startUs, n, stepUs, maxGapUs, gap);
  const w = resample(gyr, gFrom, gTo, startUs, n, stepUs, maxGapUs, gap);

  const norm = new Float64Array(n);
  for (let i = 0; i < n; i++) norm[i] = Math.hypot(f[0][i], f[1][i], f[2][i]);

  // Échelle : la force mesurée vaut g aux moments calmes.
  const calm: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(norm[i] - STANDARD_G) < d.calmForceFraction * STANDARD_G && Math.hypot(w[0][i], w[1][i], w[2][i]) < d.calmRotationRadS) calm.push(norm[i]);
  }
  const gLocal = calm.length * dt >= d.minCalmS ? median(Float64Array.from(calm)) : STANDARD_G;

  const upF = attitudePass(f, w, norm, n, dt, gLocal, d, true);
  const upB = attitudePass(f, w, norm, n, dt, gLocal, d, false);
  const aUp = new Float64Array(n);
  const horizontal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = upF[0][i] + upB[0][i];
    let y = upF[1][i] + upB[1][i];
    let z = upF[2][i] + upB[2][i];
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;
    const vertical = f[0][i] * x + f[1][i] * y + f[2][i] * z;
    aUp[i] = vertical - gLocal;
    horizontal[i] = Math.sqrt(Math.max(0, norm[i] * norm[i] - vertical * vertical));
  }
  return { acc, gyr, startUs, stepUs, dt, n, gLocal, aUp, horizontal, upF, upB, gap };
};

/** Moyenne glissante centrée sur `half` points de part et d'autre, rognée aux bords. */
export const centredMean = (a: Float64Array, half: number): Float64Array => {
  const n = a.length;
  const out = new Float64Array(n);
  let sum = 0;
  let count = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    while (hi < Math.min(n - 1, i + half)) {
      hi += 1;
      sum += a[hi];
      count += 1;
    }
    while (lo < i - half) {
      sum -= a[lo];
      lo += 1;
      count -= 1;
    }
    out[i] = sum / count;
  }
  return out;
};

// --- Fenêtres ---

/** Premier et dernier instant mesurés, tous flux confondus ; `null` sans mesure. */
export const captureBounds = (rec: ImuRecording): ImuWindow | null => {
  let first = Infinity;
  let last = -Infinity;
  for (const s of rec.series) {
    if (s.t.length === 0) continue;
    first = Math.min(first, s.t[0]);
    last = Math.max(last, s.t[s.t.length - 1]);
  }
  return first <= last ? [first, last] : null;
};

/** Fenêtres triées, celles qui se touchent fusionnées. */
export const mergeWindows = (windows: ImuWindow[]): ImuWindow[] => {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const merged: ImuWindow[] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
};

/** Heure (ms) d'un instant du fichier. */
export const wallMsOf = (rec: ImuRecording, us: number): number => rec.header.clock.wallMs + us / 1000;

/** Instant du fichier (µs) d'une heure (ms). */
export const fileUsOf = (rec: ImuRecording, ms: number): number => (ms - rec.header.clock.wallMs) * 1000;
