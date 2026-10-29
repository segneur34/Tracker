import type { ImuRecording, ImuSeries } from './imuFile';
import { STANDARD_G } from './units';
import {
  captureBounds, centredMean, mergeWindows, rangeOf, verticalAcceleration, wallMsOf,
  type AttitudeParams, type ImuWindow,
} from './imuVertical';

/**
 * Sauts mesurés par l'accéléromètre et le gyroscope du téléphone (voile, course, vélo),
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

/** Constantes de la détection et de la mesure (`SPORT_PROFILES[…].jumps.detection`). */
export interface JumpDetection extends AttitudeParams {
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

/** Raison d'un doute, en clair ; la borne de la verticale (`attitudeMaxErrorM`) est dite en centimètres. */
export const jumpDoubtLabel = (doubt: JumpDoubt, d: Pick<JumpDetection, 'attitudeMaxErrorM'>): string => {
  switch (doubt) {
    case 'parabole': return "plus haut qu'un vol sans portance de même durée : l'aile a pu tirer vers le bas";
    case 'saturation': return 'capteur saturé pendant la poussée ou le vol';
    case 'trou': return 'mesures interrompues autour du saut';
    case 'verticale': return `verticale incertaine : la hauteur peut s'écarter de plus de ${Math.round(d.attitudeMaxErrorM * 100)} cm`;
  }
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

/** Point de la trace utile ici (`TrackPoint`). */
export interface JumpTrackPoint {
  timeMs: number;
  speedMs: number;
}

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
  const vertical = verticalAcceleration(rec, d, fromUs, toUs);
  if (!vertical) return [];
  const { acc, gyr, startUs, stepUs, dt, n, gLocal, aUp, horizontal, upF, upB, gap } = vertical;
  /** Angle entre les verticales des passes aller et retour, en radians. */
  const mismatch = (i: number) => Math.acos(Math.min(1, upF[0][i] * upB[0][i] + upF[1][i] * upB[1][i] + upF[2][i] * upB[2][i]));

  // Accélération verticale lissée, centrée.
  const aS = centredMean(aUp, Math.max(0, Math.round(d.smoothingS / dt / 2)));

  const pushSteps = Math.round(d.pushSearchS / dt);
  const maxSteps = Math.round(d.maxFlightS / dt);
  const biasSteps = Math.round(d.biasWindowS / dt);
  const curveSteps = Math.max(1, Math.round(d.curveStepS / dt));
  const marginSteps = Math.round(d.curveMarginS / dt);
  const doubtSteps = Math.round(d.doubtMarginS / dt);
  const edgeSteps = Math.round(d.edgeSearchS / dt);
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
      takeoffMs: wallMsOf(rec, takeoffUs),
      landingMs: wallMsOf(rec, landingUs),
      flightS,
      heightM,
      takeoffVerticalMs: v0,
      doubts,
      curve: { stepS: curveSteps * dt, startS: -(i0 - curveStart - firstOnStep) * dt, heightsM },
    });
  }
  return flights;
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

// --- Sur la carte ---

/** Point de la trace le plus proche d'un instant, la trace étant rangée par le temps ; 0 sur une trace vide. */
export const trackIndexAtTime = (track: ReadonlyArray<{ timeMs: number }>, ms: number): number => {
  if (track.length === 0) return 0;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].timeMs <= ms) lo = mid;
    else hi = mid;
  }
  return Math.abs(track[hi].timeMs - ms) < Math.abs(track[lo].timeMs - ms) ? hi : lo;
};

/**
 * Points de la trace d'un saut, pour la carte : du point qui précède le
 * décollage à celui qui suit l'atterrissage, deux au moins, puisqu'un saut
 * peut tenir dans un seul intervalle de la trace ; `start`, le point le plus
 * proche du décollage. `null` sur une trace de moins de deux points.
 */
export const jumpTrackSpan = (
  track: ReadonlyArray<{ timeMs: number }>,
  jump: Pick<SessionJump, 'takeoffMs' | 'landingMs'>
): { from: number; to: number; start: number } | null => {
  if (track.length < 2) return null;
  const start = trackIndexAtTime(track, jump.takeoffMs);
  let from = start;
  if (track[from].timeMs > jump.takeoffMs && from > 0) from -= 1;
  let to = trackIndexAtTime(track, jump.landingMs);
  if (track[to].timeMs < jump.landingMs && to < track.length - 1) to += 1;
  if (to <= from) to = Math.min(track.length - 1, from + 1);
  return { from, to, start };
};
