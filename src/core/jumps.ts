import type { ImuRecording, ImuSeries } from './imuFile';

/**
 * Sauts mesurés par l'accéléromètre et le gyroscope du téléphone (voile),
 * depuis le fichier `.imu` d'une session (`core/imuFile.ts`). Tout est en SI :
 * instants du fichier en microsecondes, heures en millisecondes, hauteurs en
 * mètres, accélérations en m/s².
 *
 * Calcul, réglé sur les séances de wingfoil du 08/10/2026 (téléphone sur la
 * poitrine), où il retrouve 0 saut dans la séance témoin et les 10 de l'autre :
 * 1. accéléromètre et gyroscope ramenés sur une grille fixe (`gridStepS`) :
 *    une capture à 50, 100 ou 200 Hz donne le même résultat ;
 * 2. échelle : la pesanteur locale est la médiane de la force mesurée aux
 *    moments calmes ;
 * 3. verticale : filtre complémentaire sur le vecteur « haut » dans le repère
 *    du téléphone, gyroscope intégré et recalé doucement sur la force mesurée
 *    quand elle vaut à peu près g. Une passe aller, une passe retour,
 *    moyennées : le recalage ne traîne pas d'un côté du saut ;
 * 4. vol : l'accélération verticale lissée repasse sous 0 après une poussée
 *    (décollage), puis remonte franchement (atterrissage). La force mesurée ne
 *    tombe pas à 0 en vol : l'aile porte encore ;
 * 5. hauteur : double intégration de l'accélération verticale pendant le vol,
 *    le corps retombant au niveau du décollage. C'est ce que gagne le
 *    téléphone, donc le buste, au-dessus de son niveau au décollage.
 *
 * Le calcul se fait fenêtre par fenêtre (`pruneWindows`) : une séance entière
 * et son fichier élagué, qui ne garde que ces fenêtres, donnent les mêmes
 * sauts.
 */

/** Version du calcul des sauts rangés dans la fiche : l'augmenter refait les sauts des sessions qui ont leur `.imu`. */
export const JUMPS_CALC_VERSION = 1;

/** Pesanteur normale, en m/s² : l'unité des seuils exprimés en g. */
const STANDARD_G = 9.80665;

/** Constantes de la détection et de la mesure (`SPORT_PROFILES[…].jumps.detection`). */
export interface JumpDetection {
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
  /** Lissage centré de l'accélération verticale, en secondes. */
  smoothingS: number;
  /** Poussée minimale avant le décollage, en g… */
  pushG: number;
  /** …cherchée dans cette durée, en secondes. */
  pushSearchS: number;
  /** Atterrissage : l'accélération verticale lissée dépasse cette valeur, en g. */
  landingG: number;
  /** Bornes du vol cherchées sur l'accélération brute à cette durée au plus des passages lissés, en secondes. */
  edgeSearchS: number;
  /** Vol plus court ignoré, en secondes. */
  minFlightS: number;
  /** Pas d'atterrissage dans cette durée : pas un vol, en secondes. */
  maxFlightS: number;
  /** Chute minimale : moyenne de l'accélération verticale pendant le vol, en g (valeur positive). */
  minFallG: number;
  /** Demi-largeur de la fenêtre du biais vertical, autour du vol, en secondes. */
  biasWindowS: number;
  /** Vol rangé : au moins cette durée, en secondes… */
  keepMinFlightS: number;
  /** …et cette hauteur, en mètres. La hauteur minimale de l'activité ne filtre qu'à l'affichage. */
  keepMinHeightM: number;
  /** Élagage : vol d'au moins cette durée, en secondes… */
  pruneMinFlightS: number;
  /** …et cette hauteur, en mètres, sans condition de vitesse. */
  pruneMinHeightM: number;
  /** Mesures gardées de part et d'autre d'un vol, en secondes. */
  pruneMarginS: number;
  /** Tranche de la passe d'élagage sur une séance entière, en secondes. */
  pruneChunkS: number;
  /** Marge de chaque tranche, pour que la verticale y soit établie, en secondes. */
  pruneChunkMarginS: number;
  /** Douteux : hauteur au-delà de ce multiple de g·T²/8 (vol sans portance). */
  dubiousBallisticFactor: number;
  /** Douteux : un axe à cette part de la plage du capteur ou plus (saturation). */
  saturationFraction: number;
  /** Trou cherché jusqu'à cette durée autour du vol, en secondes. */
  doubtMarginS: number;
  /**
   * Douteux : erreur de hauteur possible au-delà de cette valeur, en mètres,
   * d'après le désaccord des passes aller et retour sur la verticale au
   * décollage ou à l'atterrissage (moitié de l'angle, fois la force
   * horizontale du vol, fois T²/8).
   */
  attitudeMaxErrorM: number;
  /** Courbe du saut : pas, en secondes… */
  curveStepS: number;
  /** …et durée montrée avant le décollage et après l'atterrissage, en secondes. */
  curveMarginS: number;
}

/**
 * Raison d'une mesure douteuse : hauteur au-delà de la parabole, capteur
 * saturé, trou dans les mesures, verticale incertaine.
 */
export type JumpDoubt = 'parabole' | 'saturation' | 'trou' | 'verticale';

export const JUMP_DOUBTS: readonly JumpDoubt[] = ['parabole', 'saturation', 'trou', 'verticale'];

/** Raison d'un doute, en clair. */
export const JUMP_DOUBT_LABEL: Record<JumpDoubt, string> = {
  parabole: "plus haut qu'un vol sans portance de même durée : l'aile a pu tirer vers le bas",
  saturation: 'capteur saturé pendant la poussée ou le vol',
  trou: 'mesures interrompues autour du saut',
  verticale: "verticale incertaine : la hauteur peut s'écarter de plus de 10 cm",
};

/** Hauteur du téléphone autour d'un saut, au-dessus de son niveau au décollage. */
export interface JumpCurve {
  /** Pas, en secondes. */
  stepS: number;
  /** Instant du premier point, en secondes depuis le décollage (négatif). */
  startS: number;
  /** Hauteurs, en mètres, au centimètre. */
  heightsM: number[];
}

/** Un vol repéré dans les mesures, rangé ou non. */
export interface Flight {
  /** Décollage et atterrissage, en instants du fichier (µs depuis `clock.elapsedUs`). */
  takeoffUs: number;
  landingUs: number;
  /** Décollage et atterrissage, en heure (ms). */
  takeoffMs: number;
  landingMs: number;
  flightS: number;
  heightM: number;
  /** Vitesse verticale au décollage, en m/s. */
  takeoffVerticalMs: number;
  doubts: JumpDoubt[];
  curve: JumpCurve;
}

/** Un saut rangé : un vol retenu, avec la vitesse au décollage et la longueur tirées de la trace. */
export interface MeasuredJump extends Flight {
  /** Vitesse GPS au décollage, en m/s ; `null` hors de la trace. */
  speedMs: number | null;
  /** Longueur : intégrale de la vitesse retenue pendant le vol, en mètres ; `null` hors de la trace. */
  lengthM: number | null;
}

/** Saut tel que la fiche le garde : sans les instants du fichier, arrondi. */
export type SessionJump = Omit<MeasuredJump, 'takeoffUs' | 'landingUs'>;

const toHundredth = (x: number) => Math.round(x * 100) / 100;
const toTenth = (x: number) => Math.round(x * 10) / 10;

/** Saut arrondi pour la fiche : heures à la milliseconde, hauteur et vol au centième, longueur au décimètre. */
export const toSessionJump = (j: MeasuredJump): SessionJump => ({
  takeoffMs: Math.round(j.takeoffMs),
  landingMs: Math.round(j.landingMs),
  flightS: toHundredth(j.flightS),
  heightM: toHundredth(j.heightM),
  takeoffVerticalMs: toTenth(j.takeoffVerticalMs),
  speedMs: j.speedMs === null ? null : toHundredth(j.speedMs),
  lengthM: j.lengthM === null ? null : toTenth(j.lengthM),
  doubts: j.doubts,
  curve: j.curve,
});

/** Fenêtre de mesures, en instants du fichier (µs). */
export type ImuWindow = [number, number];

/** Point de la trace utile ici (`TrackPoint`). */
export interface JumpTrackPoint {
  timeMs: number;
  speedMs: number;
}

// --- Grille ---

/** Premier indice dont l'instant est au moins `value`. */
const lowerBound = (t: Float64Array, value: number): number => {
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
const rangeOf = (s: ImuSeries, fromUs: number, toUs: number): [number, number] => [lowerBound(s.t, fromUs), lowerBound(s.t, toUs + 0.5)];

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
  f: Float64Array[], w: Float64Array[], norm: Float64Array, n: number, dt: number, gLocal: number, d: JumpDetection, forward: boolean
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

/**
 * Passage par 0 de `a` le plus proche de l'indice `at`, à `within` pas au
 * plus : montant (`rising`, de négatif à positif ou nul) ou descendant. Rend
 * l'indice du premier point après le passage, ou `at` s'il n'y en a pas.
 */
const nearestCrossing = (a: Float64Array, at: number, within: number, rising: boolean): number => {
  for (let offset = 0; offset <= within; offset++) {
    for (const k of offset === 0 ? [at] : [at - offset, at + offset]) {
      if (k < 1 || k >= a.length) continue;
      if (rising ? a[k - 1] < 0 && a[k] >= 0 : a[k - 1] >= 0 && a[k] < 0) return k;
    }
  }
  return at;
};

/** Plus grande valeur absolue d'un axe d'un flux entre deux instants. */
const peakAbs = (s: ImuSeries, fromUs: number, toUs: number): number => {
  const [from, to] = rangeOf(s, fromUs, toUs);
  let peak = 0;
  for (let i = from; i < to; i++) for (const v of s.values) peak = Math.max(peak, Math.abs(v[i]));
  return peak;
};

/**
 * Vols repérés dans les mesures entre deux instants du fichier, retenus ou
 * non : le calcul complet sur cet intervalle, qui ne lit aucune mesure en
 * dehors. Rend une liste vide sans accéléromètre ni gyroscope.
 */
export const detectFlights = (rec: ImuRecording, d: JumpDetection, fromUs: number, toUs: number): Flight[] => {
  const acc = rec.series.find((s) => s.info.kind === 'accel');
  const gyr = rec.series.find((s) => s.info.kind === 'gyro');
  if (!acc || !gyr || acc.info.axes < 3 || gyr.info.axes < 3) return [];
  const [aFrom, aTo] = rangeOf(acc, fromUs, toUs);
  const [gFrom, gTo] = rangeOf(gyr, fromUs, toUs);
  if (aTo - aFrom < 2 || gTo - gFrom < 2) return [];
  const startUs = Math.max(acc.t[aFrom], gyr.t[gFrom]);
  const endUs = Math.min(acc.t[aTo - 1], gyr.t[gTo - 1]);
  const stepUs = d.gridStepS * 1e6;
  const n = Math.floor((endUs - startUs) / stepUs) + 1;
  if (n < 2) return [];
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
  /** Force horizontale mesurée (portance, traction de l'aile), en m/s². */
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
  /** Angle entre les verticales des passes aller et retour, en radians. */
  const mismatch = (i: number) => Math.acos(Math.min(1, upF[0][i] * upB[0][i] + upF[1][i] * upB[1][i] + upF[2][i] * upB[2][i]));

  // Accélération verticale lissée, centrée.
  const half = Math.max(0, Math.round(d.smoothingS / dt / 2));
  const aS = new Float64Array(n);
  {
    let sum = 0;
    let count = 0;
    let lo = 0;
    let hi = -1;
    for (let i = 0; i < n; i++) {
      while (hi < Math.min(n - 1, i + half)) {
        hi += 1;
        sum += aUp[hi];
        count += 1;
      }
      while (lo < i - half) {
        sum -= aUp[lo];
        lo += 1;
        count -= 1;
      }
      aS[i] = sum / count;
    }
  }

  const pushSteps = Math.round(d.pushSearchS / dt);
  const maxSteps = Math.round(d.maxFlightS / dt);
  const biasSteps = Math.round(d.biasWindowS / dt);
  const curveSteps = Math.max(1, Math.round(d.curveStepS / dt));
  const marginSteps = Math.round(d.curveMarginS / dt);
  const doubtSteps = Math.round(d.doubtMarginS / dt);
  const edgeSteps = Math.round(d.edgeSearchS / dt);
  const wall =(us: number) => rec.header.clock.wallMs + us / 1000;
  const flights: Flight[] = [];

  for (let i = 1; i < n; i++) {
    if (!(aS[i - 1] >= 0 && aS[i] < 0)) continue;
    let push = -Infinity;
    for (let k = Math.max(0, i - pushSteps); k < i; k++) push = Math.max(push, aS[k]);
    if (push < d.pushG * gLocal) continue;
    let landing = i + 1;
    while (landing < n && landing - i <= maxSteps && aS[landing] < d.landingG * gLocal) landing += 1;
    if (landing >= n || landing - i > maxSteps) continue;
    // Retour de l'accélération lissée au-dessus de 0 avant l'atterrissage repéré.
    let rise = landing;
    while (rise > i + 1 && aS[rise - 1] >= 0) rise -= 1;
    // Bornes du vol sur les passages par 0 de l'accélération brute (plus grande vitesse montante, début de la décélération) :
    // le lissage décale ses passages différemment à la poussée et à l'atterrissage, et z(t1) = z(t0) y est sensible.
    const i0 = nearestCrossing(aUp, i, edgeSteps, false);
    const i1 = nearestCrossing(aUp, rise, edgeSteps, true);
    i = landing - 1;
    if (i1 <= i0) continue;
    const flightS = (i1 - i0) * dt;
    if (flightS < d.minFlightS) continue;
    let fall = 0;
    for (let k = i0; k < i1; k++) fall += aUp[k];
    if (fall / (i1 - i0) > -d.minFallG * gLocal) continue;

    // Biais vertical : moyenne sur la fenêtre autour du vol, vol compris (la vitesse verticale y revient au même).
    let bias = 0;
    {
      const lo = Math.max(0, i0 - biasSteps);
      const hi = Math.min(n, i1 + biasSteps);
      for (let k = lo; k < hi; k++) bias += aUp[k];
      bias /= hi - lo;
    }
    // Double intégration pendant le vol, partie à vitesse nulle, puis vitesse de départ qui ramène au niveau du décollage.
    const zs = new Float64Array(i1 - i0 + 1);
    let v = 0;
    let z = 0;
    for (let k = i0; k < i1; k++) {
      v += (aUp[k] - bias) * dt;
      z += v * dt;
      zs[k - i0 + 1] = z;
    }
    const v0 = -z / flightS;
    let heightM = 0;
    for (let k = 0; k < zs.length; k++) heightM = Math.max(heightM, zs[k] + v0 * k * dt);

    // Courbe : prolongée de part et d'autre du vol avec la même vitesse de départ et le même biais.
    const before: number[] = [];
    {
      let vb = v0;
      let zb = 0;
      for (let k = i0 - 1; k >= Math.max(0, i0 - marginSteps); k--) {
        vb -= (aUp[k] - bias) * dt;
        zb -= vb * dt;
        before.push(zb);
      }
    }
    const heights: number[] = [...before].reverse();
    for (let k = 0; k < zs.length; k++) heights.push(zs[k] + v0 * k * dt);
    {
      let va = v + v0;
      let za = 0;
      for (let k = i1; k < Math.min(n, i1 + marginSteps); k++) {
        va += (aUp[k] - bias) * dt;
        za += va * dt;
        heights.push(za);
      }
    }
    const curveStart = i0 - before.length;
    // Points de la courbe calés sur le décollage.
    const firstOnStep = (i0 - curveStart) % curveSteps;
    const heightsM: number[] = [];
    for (let k = firstOnStep; k < heights.length; k += curveSteps) heightsM.push(Math.round(heights[k] * 100) / 100);

    const takeoffUs = startUs + i0 * stepUs;
    const landingUs = startUs + i1 * stepUs;
    const doubts: JumpDoubt[] = [];
    if (heightM > (d.dubiousBallisticFactor * STANDARD_G * flightS * flightS) / 8) doubts.push('parabole');
    // Saturation pendant la poussée et le vol seulement : le choc de l'atterrissage n'entre pas dans le calcul.
    const saturated = [acc, gyr].some((s) => {
      const range = s.info.sensor?.maxRange;
      return range !== undefined && range > 0 && peakAbs(s, takeoffUs - d.pushSearchS * 1e6, landingUs) >= d.saturationFraction * range;
    });
    if (saturated) doubts.push('saturation');
    let holed = false;
    for (let k = Math.max(0, i0 - doubtSteps); k < Math.min(n, i1 + doubtSteps) && !holed; k++) holed = gap[k] === 1;
    if (holed) doubts.push('trou');
    let force = 0;
    for (let k = i0; k < i1; k++) force += horizontal[k];
    const attitudeErrorM = (Math.sin(Math.max(mismatch(i0), mismatch(i1)) / 2) * (force / (i1 - i0)) * flightS * flightS) / 8;
    if (attitudeErrorM > d.attitudeMaxErrorM) doubts.push('verticale');

    flights.push({
      takeoffUs,
      landingUs,
      takeoffMs: wall(takeoffUs),
      landingMs: wall(landingUs),
      flightS,
      heightM,
      takeoffVerticalMs: v0,
      doubts,
      curve: { stepS: curveSteps * dt, startS: -(i0 - curveStart - firstOnStep) * dt, heightsM },
    });
  }
  return flights;
};

/** Premier et dernier instant mesurés, tous flux confondus ; `null` sans mesure. */
const captureBounds = (rec: ImuRecording): ImuWindow | null => {
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
const mergeWindows = (windows: ImuWindow[]): ImuWindow[] => {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const merged: ImuWindow[] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
};

/**
 * Fenêtres à garder d'une séance entière : `pruneMarginS` de part et d'autre
 * de tout vol assez long et assez haut (critères larges, sans condition de
 * vitesse), fusionnées et rognées aux bords de la capture. Une séance déjà
 * élaguée rend ses fenêtres. Le calcul passe par tranches, pour ne pas tenir
 * toute la séance en mémoire.
 */
export const pruneWindows = (rec: ImuRecording, d: JumpDetection): ImuWindow[] => {
  if (rec.header.windows) return rec.header.windows;
  const bounds = captureBounds(rec);
  if (!bounds) return [];
  const chunkUs = d.pruneChunkS * 1e6;
  const marginUs = d.pruneChunkMarginS * 1e6;
  const keepUs = d.pruneMarginS * 1e6;
  const windows: ImuWindow[] = [];
  for (let core = bounds[0]; core <= bounds[1]; core += chunkUs) {
    for (const flight of detectFlights(rec, d, core - marginUs, core + chunkUs + marginUs)) {
      if (flight.takeoffUs < core || flight.takeoffUs >= core + chunkUs) continue;
      if (flight.flightS < d.pruneMinFlightS || flight.heightM < d.pruneMinHeightM) continue;
      windows.push([Math.max(bounds[0], flight.takeoffUs - keepUs), Math.min(bounds[1], flight.landingUs + keepUs)]);
    }
  }
  return mergeWindows(windows);
};

/** Vitesse de la trace à un instant, interpolée ; `null` hors de la trace. */
const speedAt = (track: ReadonlyArray<JumpTrackPoint>, ms: number): number | null => {
  if (track.length === 0 || ms < track[0].timeMs || ms > track[track.length - 1].timeMs) return null;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].timeMs <= ms) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const w = b.timeMs > a.timeMs ? (ms - a.timeMs) / (b.timeMs - a.timeMs) : 0;
  return a.speedMs * (1 - w) + b.speedMs * w;
};

/** Intégrale de la vitesse de la trace entre deux instants (règle 6), par pas de `stepS` ; `null` hors de la trace. */
const distanceBetween = (track: ReadonlyArray<JumpTrackPoint>, fromMs: number, toMs: number, stepS: number): number | null => {
  if (speedAt(track, fromMs) === null || speedAt(track, toMs) === null) return null;
  const stepMs = stepS * 1000;
  let distance = 0;
  for (let t = fromMs; t < toMs; t += stepMs) {
    const next = Math.min(toMs, t + stepMs);
    distance += (((speedAt(track, t) ?? 0) + (speedAt(track, next) ?? 0)) / 2) * ((next - t) / 1000);
  }
  return distance;
};

export interface JumpsMeasure {
  /** Sauts rangés, dans l'ordre du temps. */
  jumps: MeasuredJump[];
  /** Tous les vols repérés dans les fenêtres, pour le diagnostic. */
  flights: Flight[];
  /** Fenêtres calculées : celles de l'en-tête si le fichier est élagué. */
  windows: ImuWindow[];
}

/**
 * Sauts d'une session : fenêtres (`pruneWindows`), vols de chaque fenêtre,
 * puis ceux qui ont la durée et la hauteur à ranger. La vitesse au décollage
 * et la longueur viennent de la trace, si elle est fournie. Le seuil
 * d'activité et la hauteur minimale de l'activité ne filtrent qu'à
 * l'affichage.
 */
export const measureJumps = (rec: ImuRecording, d: JumpDetection, track: ReadonlyArray<JumpTrackPoint> = []): JumpsMeasure => {
  const windows = pruneWindows(rec, d);
  const flights = windows.flatMap(([from, to]) => detectFlights(rec, d, from, to));
  const jumps = flights
    .filter((f) => f.flightS >= d.keepMinFlightS && f.heightM >= d.keepMinHeightM)
    .map((f): MeasuredJump => ({
      ...f,
      speedMs: speedAt(track, f.takeoffMs),
      lengthM: distanceBetween(track, f.takeoffMs, f.landingMs, d.gridStepS),
    }));
  return { jumps, flights, windows };
};
