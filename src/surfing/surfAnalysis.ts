import { haversineDistance } from '../core/kinematics';
import { activeRuns, type ActiveRun } from '../core/sessionStats';
import type { SurfProfile } from '../core/sportProfiles';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { countDirectionChanges } from './gpsTurns';

/**
 * Analyse d'une session de surf (§10, point 97), en SI, sur la trace du noyau.
 *
 * La session se découpe pas à pas (le pas `i` va du point `i − 1` au point `i`) :
 * - **glisse** : dans une vague, ou dans un vol sur foil. C'est une suite du
 *   masque d'activité (le seuil de vague, ou le seuil de vol sur foil),
 *   gardée si elle dure `minWaveS` et couvre `minWaveM` ;
 * - **attente** : immobile (vitesse lissée sous `stillMs`) pendant au moins
 *   `minWaitS` d'affilée, au pic le plus souvent ;
 * - **rame** : le reste, arrêts courts compris (canard, série qui passe) ;
 * - **sans signal** : un pas plus long que `maxGapS`, le téléphone sous l'eau.
 *   Il n'est jamais interpolé (règle 10) : il borne la phase en cours.
 *
 * Entre deux glisses, une remontée. Le retour au pic va de la fin de la
 * glisse au début de la première attente ; une glisse prise sans attente est
 * « enchaînée », et sa remontée n'entre pas dans la moyenne du retour. Avant la
 * première glisse, la première sortie va du premier coup de rame à la première
 * attente : la marche sur la plage y est comprise.
 *
 * Sur foil, les glisses sont des vols : une suite au seuil de vol, qui peut
 * relier plusieurs vagues en pompant entre elles. Les vagues d'un vol sont ses
 * passages au-dessus du seuil de vague en foil (`waveMask`) ; le reste du vol
 * est pompé. Sans foil, les glisses sont les vagues.
 */

export type SurfParams = Pick<
  SurfProfile, 'stillMs' | 'minWaitS' | 'minWaveS' | 'minWaveM' | 'takeoffSearchS' | 'maxGapS' | 'turnMinDeg'
>;

/** Ce que fait le pratiquant sur un pas. */
export type SurfPhase = 'glisse' | 'rame' | 'attente' | 'trou';

/** Un passage de la trace, entre deux points. */
export interface SurfSpan {
  /** Numéro, à partir de 1, dans l'ordre de la session. */
  n: number;
  /** Index des points de départ et d'arrivée. */
  start: number;
  end: number;
  startMs: number;
  endMs: number;
  durationS: number;
  /** Intégrale de la vitesse (règle 6). */
  distanceM: number;
  /** Plus haute vitesse lissée. */
  maxSpeedMs: number;
  avgSpeedMs: number;
}

export interface SurfWave extends SurfSpan {
  /**
   * Rame de départ : le mouvement continu qui précède la vague, au plus
   * `takeoffSearchS`, en secondes ; `null` pour une vague prise en vol (foil).
   */
  takeoffS: number | null;
  takeoffSpeedMs: number | null;
  /** Grands changements de direction vus par le GPS (`gpsTurns.ts`). */
  turns: number;
  /** Numéro du vol qui la porte, sur foil ; `null` sans foil. */
  flight: number | null;
}

export interface SurfFlight extends SurfSpan {
  takeoffS: number;
  takeoffSpeedMs: number | null;
  /** Vagues reliées par ce vol. */
  waveCount: number;
  /** Temps porté par les vagues, puis temps pompé, en secondes. */
  waveS: number;
  pumpS: number;
  pumpDistanceM: number;
  pumpSpeedMs: number | null;
}

/** Remontée après une glisse (`after` ≥ 1), ou première sortie (`after` = 0). */
export interface SurfReturn {
  after: number;
  startMs: number;
  /** Début de la glisse suivante, sinon fin de la session. */
  endMs: number;
  /** Retour au pic : jusqu'au début de la première attente, en secondes ; `null` sans attente (glisse enchaînée). */
  returnS: number | null;
  /** Distance à vol d'oiseau de la fin de la glisse au pic. */
  straightM: number | null;
  /** Vitesse de remontée : `straightM` ÷ `returnS`. */
  returnSpeedMs: number | null;
  /** Rame en mouvement (arrêts courts exclus), sur toute la remontée. */
  paddleS: number;
  paddleDistanceM: number;
  paddleSpeedMs: number | null;
  /** Attente, sur toute la remontée. */
  waitS: number;
}

export interface SurfAnalysis {
  /** Phase de chaque pas ; celle du pas 0, qui n'existe pas, vaut `trou`. */
  phases: SurfPhase[];
  waves: SurfWave[];
  /** Vols, sur foil ; vide sans foil. */
  flights: SurfFlight[];
  /** Première sortie (si elle a une attente), puis une remontée après chaque glisse sauf la dernière. */
  returns: SurfReturn[];
}

const stepS = (track: TrackPoint[], i: number): number => (track[i].timeMs - track[i - 1].timeMs) / 1000;

/** Mesure d'un passage entre les points `start` et `end`. */
const spanOf = (track: TrackPoint[], cum: CumulativeTrack, n: number, run: ActiveRun): SurfSpan => {
  const durationS = (track[run.end].timeMs - track[run.start].timeMs) / 1000;
  const distanceM = cum.cumDist[run.end] - cum.cumDist[run.start];
  let maxSpeedMs = 0;
  for (let i = run.start + 1; i <= run.end; i++) maxSpeedMs = Math.max(maxSpeedMs, track[i].smoothedSpeedMs);
  return {
    n, start: run.start, end: run.end, startMs: track[run.start].timeMs, endMs: track[run.end].timeMs,
    durationS, distanceM, maxSpeedMs, avgSpeedMs: durationS > 0 ? distanceM / durationS : 0,
  };
};

const keptRuns = (track: TrackPoint[], cum: CumulativeTrack, runs: ActiveRun[], p: SurfParams): ActiveRun[] =>
  runs.filter((r) =>
    (track[r.end].timeMs - track[r.start].timeMs) / 1000 >= p.minWaveS && cum.cumDist[r.end] - cum.cumDist[r.start] >= p.minWaveM
  );

/** Phase de chaque pas, glisses données. */
const stepPhases = (track: TrackPoint[], rides: ActiveRun[], p: SurfParams): SurfPhase[] => {
  const phases = new Array<SurfPhase>(track.length).fill('rame');
  phases[0] = 'trou';
  for (const r of rides) for (let i = r.start + 1; i <= r.end; i++) phases[i] = 'glisse';
  // Arrêts : une suite de pas immobiles ; d'au moins `minWaitS`, c'est une attente.
  let from = -1;
  const closeStop = (to: number) => {
    if (from < 0) return;
    if ((track[to].timeMs - track[from - 1].timeMs) / 1000 >= p.minWaitS) for (let k = from; k <= to; k++) phases[k] = 'attente';
    from = -1;
  };
  for (let i = 1; i < track.length; i++) {
    if (stepS(track, i) > p.maxGapS) {
      closeStop(i - 1);
      phases[i] = 'trou';
      continue;
    }
    if (phases[i] === 'glisse') {
      closeStop(i - 1);
      continue;
    }
    if (track[i].smoothedSpeedMs < p.stillMs) {
      if (from < 0) from = i;
    } else closeStop(i - 1);
  }
  closeStop(track.length - 1);
  return phases;
};

/** Rame de départ d'une glisse qui part du point `start` : les pas de rame en mouvement qui la précèdent. */
const takeoffOf = (
  track: TrackPoint[], cum: CumulativeTrack, phases: SurfPhase[], start: number, p: SurfParams
): { takeoffS: number; takeoffSpeedMs: number | null } => {
  const endMs = track[start].timeMs;
  let b = start;
  while (b > 0 && phases[b] === 'rame' && track[b].smoothedSpeedMs >= p.stillMs && (endMs - track[b - 1].timeMs) / 1000 <= p.takeoffSearchS) b--;
  const takeoffS = (endMs - track[b].timeMs) / 1000;
  return { takeoffS, takeoffSpeedMs: takeoffS > 0 ? (cum.cumDist[start] - cum.cumDist[b]) / takeoffS : null };
};

/** Pas de rame en mouvement, au-dessus de l'immobilité (les arrêts courts n'en sont pas). */
const isPaddling = (track: TrackPoint[], phases: SurfPhase[], i: number, stillMs: number): boolean =>
  phases[i] === 'rame' && track[i].smoothedSpeedMs >= stillMs;

/**
 * Remontée des pas `from + 1` à `to`, partie du point `from` ; le retour au
 * pic se mesure du point `origin` à la première attente qui le suit.
 */
const returnOf = (
  track: TrackPoint[], cum: CumulativeTrack, phases: SurfPhase[], p: SurfParams,
  after: number, from: number, to: number, origin: number
): SurfReturn => {
  let paddleS = 0;
  let paddleDistanceM = 0;
  let waitS = 0;
  let firstWait = -1;
  for (let i = from + 1; i <= to; i++) {
    const dt = stepS(track, i);
    if (phases[i] === 'attente') {
      waitS += dt;
      if (firstWait < 0 && i - 1 >= origin) firstWait = i - 1;
    } else if (isPaddling(track, phases, i, p.stillMs)) {
      paddleS += dt;
      paddleDistanceM += cum.cumDist[i] - cum.cumDist[i - 1];
    }
  }
  const returnS = firstWait >= 0 ? (track[firstWait].timeMs - track[origin].timeMs) / 1000 : null;
  const straightM = returnS === null
    ? null
    : haversineDistance(track[origin].lat, track[origin].lon, track[firstWait].lat, track[firstWait].lon);
  return {
    after, startMs: track[from].timeMs, endMs: track[to].timeMs,
    returnS, straightM, returnSpeedMs: returnS && straightM !== null ? straightM / returnS : null,
    paddleS, paddleDistanceM, paddleSpeedMs: paddleS > 0 ? paddleDistanceM / paddleS : null, waitS,
  };
};

/**
 * Analyse d'une session. `rideMask` : le masque d'activité au seuil de la
 * session (vague, ou vol sur foil) ; `waveMask` : sur foil, le masque au seuil
 * de vague en foil, `null` sans foil.
 */
export const analyzeSurf = (
  track: TrackPoint[], cum: CumulativeTrack, rideMask: boolean[], waveMask: boolean[] | null, p: SurfParams
): SurfAnalysis => {
  if (track.length < 2) return { phases: track.map(() => 'trou'), waves: [], flights: [], returns: [] };
  const rides = keptRuns(track, cum, activeRuns(track, rideMask, p.maxGapS), p);
  const phases = stepPhases(track, rides, p);

  const waves: SurfWave[] = [];
  const flights: SurfFlight[] = [];
  if (waveMask === null) {
    rides.forEach((r, k) => {
      waves.push({
        ...spanOf(track, cum, k + 1, r), ...takeoffOf(track, cum, phases, r.start, p),
        turns: countDirectionChanges(track, r.start, r.end, p.turnMinDeg), flight: null,
      });
    });
  } else {
    rides.forEach((r, k) => {
      // Vagues du vol : les suites du masque de vague entre ses bornes, sans reparcourir la trace (27/10).
      const flightWaves = keptRuns(track, cum, activeRuns(track, waveMask, p.maxGapS, r.start + 1, r.end), p);
      let waveS = 0;
      let waveDistanceM = 0;
      for (const w of flightWaves) {
        const span = spanOf(track, cum, waves.length + 1, w);
        waveS += span.durationS;
        waveDistanceM += span.distanceM;
        waves.push({
          ...span, takeoffS: null, takeoffSpeedMs: null,
          turns: countDirectionChanges(track, w.start, w.end, p.turnMinDeg), flight: k + 1,
        });
      }
      const span = spanOf(track, cum, k + 1, r);
      const pumpS = span.durationS - waveS;
      const pumpDistanceM = span.distanceM - waveDistanceM;
      flights.push({
        ...span, ...takeoffOf(track, cum, phases, r.start, p),
        waveCount: flightWaves.length, waveS, pumpS, pumpDistanceM, pumpSpeedMs: pumpS > 0 ? pumpDistanceM / pumpS : null,
      });
    });
  }

  const returns: SurfReturn[] = [];
  // Première sortie : du premier coup de rame à la première attente, avant la première glisse.
  const firstRideStart = rides.length > 0 ? rides[0].start : track.length - 1;
  let firstMove = -1;
  for (let i = 1; i <= firstRideStart && firstMove < 0; i++) if (isPaddling(track, phases, i, p.stillMs)) firstMove = i - 1;
  if (firstMove >= 0) {
    const out = returnOf(track, cum, phases, p, 0, 0, firstRideStart, firstMove);
    if (out.returnS !== null) returns.push(out);
  }
  for (let k = 0; k + 1 < rides.length; k++) {
    returns.push(returnOf(track, cum, phases, p, k + 1, rides[k].end, rides[k + 1].start, rides[k].end));
  }
  return { phases, waves, flights, returns };
};

/** Chiffres d'une session, en SI ; `null` quand ils n'ont pas de sens (aucune vague, aucun retour). */
export interface SurfSummary {
  totalS: number;
  /** Temps par phase, en secondes. */
  glisseS: number;
  rameS: number;
  attenteS: number;
  trouS: number;
  /** Distance parcourue en glisse : avec `glisseS`, la moyenne en action des statistiques. */
  glisseDistanceM: number;
  waveCount: number;
  wavesPerHour: number | null;
  /** Temps et distance sur les vagues (sur foil : au-dessus du seuil de vague). */
  waveS: number;
  waveDistanceM: number;
  avgWaveDistanceM: number | null;
  longestWaveM: number | null;
  avgWaveSpeedMs: number | null;
  maxWaveSpeedMs: number | null;
  /** Rame en mouvement sur toute la session, arrêts courts exclus. */
  paddleSpeedMs: number | null;
  /** Retour au pic, sur les remontées qui ont une attente (première sortie exclue). */
  avgReturnS: number | null;
  bestReturnS: number | null;
  avgReturnSpeedMs: number | null;
  /** Glisses prises sans attente depuis la précédente. */
  chainedCount: number;
  firstOutS: number | null;
  flightCount: number;
  flightS: number;
  longestFlightS: number | null;
  maxWavesInFlight: number | null;
}

const mean = (values: number[]): number | null => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

export const summarizeSurf = (track: TrackPoint[], cum: CumulativeTrack, analysis: SurfAnalysis, stillMs: number): SurfSummary => {
  const { phases, waves, flights, returns } = analysis;
  const time: Record<SurfPhase, number> = { glisse: 0, rame: 0, attente: 0, trou: 0 };
  let paddleS = 0;
  let paddleDistanceM = 0;
  let glisseDistanceM = 0;
  for (let i = 1; i < track.length; i++) {
    const dt = stepS(track, i);
    time[phases[i]] += dt;
    if (phases[i] === 'glisse') glisseDistanceM += cum.cumDist[i] - cum.cumDist[i - 1];
    if (isPaddling(track, phases, i, stillMs)) {
      paddleS += dt;
      paddleDistanceM += cum.cumDist[i] - cum.cumDist[i - 1];
    }
  }
  const totalS = track.length > 1 ? (track[track.length - 1].timeMs - track[0].timeMs) / 1000 : 0;
  const waveS = waves.reduce((s, w) => s + w.durationS, 0);
  const waveDistanceM = waves.reduce((s, w) => s + w.distanceM, 0);
  const measured = returns.filter((r) => r.after > 0 && r.returnS !== null);
  const returnTimes = measured.map((r) => r.returnS as number);
  const firstOut = returns.find((r) => r.after === 0);
  return {
    totalS,
    glisseS: time.glisse,
    rameS: time.rame,
    attenteS: time.attente,
    trouS: time.trou,
    glisseDistanceM,
    waveCount: waves.length,
    wavesPerHour: totalS > 0 ? waves.length / (totalS / 3600) : null,
    waveS,
    waveDistanceM,
    avgWaveDistanceM: waves.length > 0 ? waveDistanceM / waves.length : null,
    longestWaveM: waves.length > 0 ? Math.max(...waves.map((w) => w.distanceM)) : null,
    avgWaveSpeedMs: waveS > 0 ? waveDistanceM / waveS : null,
    maxWaveSpeedMs: waves.length > 0 ? Math.max(...waves.map((w) => w.maxSpeedMs)) : null,
    paddleSpeedMs: paddleS > 0 ? paddleDistanceM / paddleS : null,
    avgReturnS: mean(returnTimes),
    bestReturnS: returnTimes.length > 0 ? Math.min(...returnTimes) : null,
    avgReturnSpeedMs: mean(measured.flatMap((r) => (r.returnSpeedMs === null ? [] : [r.returnSpeedMs]))),
    chainedCount: returns.filter((r) => r.after > 0 && r.returnS === null).length,
    firstOutS: firstOut?.returnS ?? null,
    flightCount: flights.length,
    flightS: flights.reduce((s, f) => s + f.durationS, 0),
    longestFlightS: flights.length > 0 ? Math.max(...flights.map((f) => f.durationS)) : null,
    maxWavesInFlight: flights.length > 0 ? Math.max(...flights.map((f) => f.waveCount)) : null,
  };
};
