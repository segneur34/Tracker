import { meanOf } from '../core/basics';
import { haversineDistance } from '../core/geo';
import type { FlightSpan } from '../core/pumping';
import { activeRuns, spanOfRun, type ActiveRun } from '../core/sessionStats';
import { bestWindowSpeedMs } from '../core/topSegments';
import type { SportProfile, SurfProfile } from '../core/sportProfiles';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { countDirectionChanges, rideEndMsOf } from './gpsTurns';

/**
 * Analyse d'une session de surf (§10, point 97), en SI, sur la trace du noyau.
 *
 * La session se découpe pas à pas (le pas `i` va du point `i − 1` au point `i`) :
 * - **glisse** : dans une vague, ou dans un vol sur foil. C'est une suite du
 *   masque d'activité (le seuil de vague, ou le seuil de vol sur foil),
 *   gardée si elle dure `minWaveS` et couvre `minWaveM` ;
 * - **attente** : immobile (vitesse lissée sous `stillMs`, le plancher d'arrêt
 *   du profil, `stillThreshold`) pendant au moins `minWaitS` d'affilée, au pic
 *   le plus souvent ;
 * - **rame** : le reste, arrêts courts compris (canard, série qui passe) ;
 * - **sans signal** : un pas plus long que `maxGapS`, le téléphone sous l'eau,
 *   ou le pas de reprise d'une pause manuelle (`segmentStart`). Il n'est jamais
 *   interpolé (règle 10) : il borne la phase en cours.
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
 *
 * Le masque n'entre en glisse qu'à sa détente haute et n'en sort qu'à sa
 * détente basse : le début de chaque glisse retenue remonte donc à la détente
 * basse tant que la vitesse monte (`riseStartOf`), comme sa fin. Sans foil,
 * chaque vague a en plus son départ : la mise en vitesse qui précède son début
 * compté, depuis presque l'arrêt (`departStartOf`). Il compte dans sa durée,
 * sa distance et sa moyenne, et ses pas sont de la glisse ; il ne fait jamais
 * compter une vague, et la vitesse max et les virages restent lus depuis le
 * début compté (`rideStart`).
 */

/**
 * Réglages de l'analyse : ceux du surf, le trou de la trace et la fenêtre de la
 * vitesse max du calcul, et `stillMs`, le plancher d'arrêt du profil
 * (`stillThreshold`) en m/s : un seul plancher pour le masque et l'attente (Q43).
 * `rideExitMs` et `waveExitMs` : détentes basses, en m/s, du masque de la
 * glisse et de celui des vagues sur foil (`null` sans foil), celles où une
 * glisse finit ; le début d'une glisse remonte jusqu'à elles (`riseStartOf`).
 */
export type SurfParams = Pick<
  SurfProfile, 'minWaitS' | 'minWaveS' | 'minWaveM' | 'takeoffSearchS' | 'turnMinDeg' | 'rise' | 'depart' | 'turnRules'
> & Pick<SportProfile, 'maxGapS' | 'maxSpeedWindowS'> & {
  stillMs: number;
  rideExitMs: number;
  waveExitMs: number | null;
};

/** Ce que fait le pratiquant sur un pas. */
export type SurfPhase = 'glisse' | 'rame' | 'attente' | 'trou';

/** Un passage de la trace, entre deux points. */
export interface SurfSpan extends FlightSpan {
  /** Vitesse max : la meilleure moyenne sur `maxSpeedWindowS` (Q34) ; la moyenne du passage s'il est plus court. */
  maxSpeedMs: number;
  avgSpeedMs: number;
}

export interface SurfWave extends SurfSpan {
  /**
   * Début compté de la vague (au-dessus de la détente basse), point et instant.
   * Sans foil, le passage (`start`, `startMs`) part plus tôt, au début de son
   * départ : durée, distance et moyenne comptent le départ ; la vitesse max et
   * les virages se lisent depuis le début compté. Sur foil, il n'y a pas de
   * départ : égal à `start`.
   */
  rideStart: number;
  rideStartMs: number;
  /** Durée du départ, la mise en vitesse avant le début compté, en secondes ; 0 sur foil. */
  departS: number;
  /**
   * Rame de départ : le mouvement continu qui précède la vague et son départ,
   * au plus `takeoffSearchS`, en secondes ; `null` pour une vague prise en vol
   * (foil).
   */
  takeoffS: number | null;
  takeoffSpeedMs: number | null;
  /** Grands changements de direction vus par le GPS (`gpsTurns.ts`). */
  turns: number;
  /**
   * Fin de glisse pour les virages, en ms : le dernier instant de la vague
   * au-dessus du plancher de lecture du cap ; sur foil, la fin de la vague,
   * qui s'achève en vol. Un virage ne compte que suivi d'assez de glisse
   * jusqu'à elle, au GPS comme au gyroscope (`gyroTurns.ts`).
   */
  turnRideEndMs: number;
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
  /** Début de la glisse suivante (celui de son départ, sans foil), sinon fin de la session. */
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

/**
 * Mesure d'un passage entre les points `start` et `end`. Vitesse max : la
 * meilleure moyenne sur `maxSpeedWindowS` dans le passage, sinon (passage plus
 * court, ou coupé de trous) sa moyenne.
 */
const spanOf = (track: TrackPoint[], cum: CumulativeTrack, n: number, run: ActiveRun, windowS: number): SurfSpan => {
  const span = spanOfRun(track, cum, run);
  const avgSpeedMs = span.durationS > 0 ? span.distanceM / span.durationS : 0;
  const maxSpeedMs = bestWindowSpeedMs(track, cum, windowS, run.start, run.end) ?? avgSpeedMs;
  return { n, ...span, maxSpeedMs, avgSpeedMs };
};

/** Dernier point à `windowS` secondes ou plus avant le point `i`, le premier de la trace au plus tôt. */
const pointBefore = (track: TrackPoint[], i: number, windowS: number): number => {
  const atMs = track[i].timeMs - windowS * 1000;
  let j = i - 1;
  while (j > 0 && track[j].timeMs > atMs) j--;
  return Math.max(0, j);
};

/** Bornes d'un recul du début (`climbStartOf`). */
interface ClimbBounds {
  maxGapS: number;
  /** Recul le plus long, en secondes. */
  maxS: number;
  /** Fenêtre et rapport de la montée (`SurfRise`). */
  windowS: number;
  maxRatio: number;
  /** Gain minimal sur la fenêtre, en m/s, en plus du rapport. */
  minGainMs: number;
}

/**
 * Recul du début d'un passage qui part du point `start`, d'un pas tant que :
 * - le point d'arrivée de ce pas, comme dans `activeRuns`, a une vitesse lissée
 *   au moins égale à `lowMs` ;
 * - ce point est encore dans la montée : la vitesse de `windowS` secondes plus
 *   tôt n'atteint pas `maxRatio` de la sienne, et la sienne la dépasse d'au
 *   moins `minGainMs`. Jugée sur une fenêtre en secondes, pas d'un point au
 *   suivant, la règle tient à toute cadence (règle 2), et une rame plate n'est
 *   pas avalée ;
 * - le recul ne dépasse pas `maxS` secondes ;
 * - le pas n'est ni un trou de la trace (plus long que `maxGapS`) ni la reprise
 *   d'une pause (`segmentStart`), et ne part pas avant le point `floor`.
 * Un long pas (règle 10) se juge comme un autre, sur son point d'arrivée.
 */
const climbStartOf = (track: TrackPoint[], start: number, floor: number, lowMs: number, b: ClimbBounds): number => {
  const startMs = track[start].timeMs;
  let s = start;
  while (s - 1 >= Math.max(0, floor)) {
    const arrival = track[s];
    if (arrival.segmentStart || stepS(track, s) > b.maxGapS) break;
    if ((startMs - track[s - 1].timeMs) / 1000 > b.maxS) break;
    const v = arrival.smoothedSpeedMs;
    if (v < lowMs) break;
    const before = track[pointBefore(track, s, b.windowS)].smoothedSpeedMs;
    if (before > b.maxRatio * v || before > v - b.minGainMs) break;
    s--;
  }
  return s;
};

/**
 * Début remonté d'une glisse qui part du point `start`. Le masque n'entre en
 * glisse qu'à sa détente haute et n'en sort qu'à sa détente basse : sans recul,
 * la mise en vitesse entre les deux détentes resterait de la rame au départ,
 * alors que la même plage de vitesse est de la glisse à la fin. Le début
 * remonte donc tant que la vitesse reste au-dessus de la détente basse `lowMs`
 * (la mise en vitesse dessous reste de la rame de départ) et monte encore, sur
 * au plus `rise.maxS` (`climbStartOf`) ; jamais avant le point `floor` (la fin
 * de la glisse précédente, ou le début du vol qui porte une vague).
 */
export const riseStartOf = (
  track: TrackPoint[], start: number, floor: number, lowMs: number, p: Pick<SurfParams, 'maxGapS' | 'rise'>
): number => climbStartOf(track, start, floor, lowMs, {
  maxGapS: p.maxGapS, maxS: p.rise.maxS, windowS: p.rise.windowS, maxRatio: p.rise.maxRatio, minGainMs: 0,
});

/**
 * Début du départ d'une vague comptée à partir du point `rideStart` : la mise
 * en vitesse qui la précède, remontée comme le début compté (`riseStartOf`)
 * mais jusqu'au plancher d'arrêt `stillMs` (presque l'arrêt), sur au plus
 * `depart.maxS` secondes, et tant que la vitesse gagne aussi au moins
 * `depart.minGainMs` sur la fenêtre : une rame à allure constante arrête le
 * recul. Jamais avant le point `floor`, la fin de la vague d'avant ; ni à
 * travers un trou ou la reprise d'une pause. Un long pas se juge sur son point
 * d'arrivée : un seul pas de 1 à 8 km/h fait tout le départ.
 */
export const departStartOf = (
  track: TrackPoint[], rideStart: number, floor: number, p: Pick<SurfParams, 'maxGapS' | 'stillMs' | 'rise' | 'depart'>
): number => climbStartOf(track, rideStart, floor, p.stillMs, {
  maxGapS: p.maxGapS, maxS: p.depart.maxS, windowS: p.rise.windowS, maxRatio: p.rise.maxRatio, minGainMs: p.depart.minGainMs,
});

/** Suites du masque dont le début est remonté (`riseStartOf`), chacune après la fin de la précédente et pas avant `floor`. */
const risenRuns = (track: TrackPoint[], runs: ActiveRun[], floor: number, lowMs: number, p: SurfParams): ActiveRun[] =>
  runs.map((r, k) => ({ start: riseStartOf(track, r.start, k > 0 ? runs[k - 1].end : floor, lowMs, p), end: r.end }));

const keptRuns = (track: TrackPoint[], cum: CumulativeTrack, runs: ActiveRun[], p: SurfParams): ActiveRun[] =>
  runs.filter((r) => {
    const { durationS, distanceM } = spanOfRun(track, cum, r);
    return durationS >= p.minWaveS && distanceM >= p.minWaveM;
  });

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
    // Trou de la trace, ou reprise après une pause manuelle : ni rame ni attente.
    if (stepS(track, i) > p.maxGapS || track[i].segmentStart) {
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
 * de vague en foil, `null` sans foil. Une glisse qui traverse un trou de la
 * trace parcouru en mouvement reste une glisse (Q56, `activeRuns`) ; le pas du
 * trou garde sa phase « trou » dans la frise (`stepPhases`).
 */
export const analyzeSurf = (
  track: TrackPoint[], cum: CumulativeTrack, rideMask: boolean[], waveMask: boolean[] | null, p: SurfParams
): SurfAnalysis => {
  if (track.length < 2) return { phases: track.map(() => 'trou'), waves: [], flights: [], returns: [] };
  // Début remonté avant le filtre de durée et de distance : une vague molle, rognée de sa mise en vitesse, était écartée.
  const rides = keptRuns(track, cum, risenRuns(track, activeRuns(track, rideMask), 0, p.rideExitMs, p), p);
  // Sans foil, le départ de chaque vague, après le filtre : il ne fait jamais compter une vague. Ses pas sont de la
  // glisse ; la rame de départ, les remontées et la première sortie s'arrêtent à son début. Sur foil, aucun départ.
  const departs = waveMask === null
    ? rides.map((r, k) => departStartOf(track, r.start, k > 0 ? rides[k - 1].end : 0, p))
    : rides.map((r) => r.start);
  const phases = stepPhases(track, rides.map((r, k) => ({ start: departs[k], end: r.end })), p);

  // Virages d'une vague, lus depuis son début compté, avec sa fin de glisse : un changement de direction ne compte
  // que suivi d'assez de glisse.
  const turnsOf = (w: ActiveRun, turnRideEndMs: number): Pick<SurfWave, 'turns' | 'turnRideEndMs'> => ({
    turns: countDirectionChanges(track, w.start, w.end, p.turnMinDeg, { ...p.turnRules, rideEndMs: turnRideEndMs, maxGapS: p.maxGapS }),
    turnRideEndMs,
  });

  const waves: SurfWave[] = [];
  const flights: SurfFlight[] = [];
  if (waveMask === null) {
    rides.forEach((r, k) => {
      // Durée, distance et moyenne du départ à la fin ; vitesse max sur la partie comptée, que le départ ne change pas.
      const counted = spanOf(track, cum, k + 1, r, p.maxSpeedWindowS);
      const span = spanOf(track, cum, k + 1, { start: departs[k], end: r.end }, p.maxSpeedWindowS);
      waves.push({
        ...span, maxSpeedMs: counted.maxSpeedMs,
        rideStart: r.start, rideStartMs: counted.startMs, departS: (counted.startMs - span.startMs) / 1000,
        ...takeoffOf(track, cum, phases, departs[k], p),
        ...turnsOf(r, rideEndMsOf(track, r.start, r.end, p.turnRules.courseMinSpeedMs, p.maxGapS)), flight: null,
      });
    });
  } else {
    rides.forEach((r, k) => {
      // Vagues du vol : les suites du masque de vague entre ses bornes, sans reparcourir la trace (27/10).
      // Leur début remonte comme celui des vols, à la détente basse des vagues, jamais avant le début du vol.
      const flightWaves = keptRuns(
        track, cum, risenRuns(track, activeRuns(track, waveMask, r.start + 1, r.end), r.start, p.waveExitMs ?? p.rideExitMs, p), p
      );
      let waveS = 0;
      let waveDistanceM = 0;
      for (const w of flightWaves) {
        const span = spanOf(track, cum, waves.length + 1, w, p.maxSpeedWindowS);
        waveS += span.durationS;
        waveDistanceM += span.distanceM;
        waves.push({
          ...span, rideStart: w.start, rideStartMs: span.startMs, departS: 0, takeoffS: null, takeoffSpeedMs: null,
          // Sur foil, la vague finit en vol, bien au-dessus du plancher : sa fin de glisse est sa fin.
          ...turnsOf(w, track[w.end].timeMs), flight: k + 1,
        });
      }
      const span = spanOf(track, cum, k + 1, r, p.maxSpeedWindowS);
      const pumpS = span.durationS - waveS;
      const pumpDistanceM = span.distanceM - waveDistanceM;
      flights.push({
        ...span, ...takeoffOf(track, cum, phases, r.start, p),
        waveCount: flightWaves.length, waveS, pumpS, pumpDistanceM, pumpSpeedMs: pumpS > 0 ? pumpDistanceM / pumpS : null,
      });
    });
  }

  const returns: SurfReturn[] = [];
  // Première sortie : du premier coup de rame à la première attente, avant la première glisse (le début de son départ).
  const firstRideStart = rides.length > 0 ? departs[0] : track.length - 1;
  let firstMove = -1;
  for (let i = 1; i <= firstRideStart && firstMove < 0; i++) if (isPaddling(track, phases, i, p.stillMs)) firstMove = i - 1;
  if (firstMove >= 0) {
    const out = returnOf(track, cum, phases, p, 0, 0, firstRideStart, firstMove);
    if (out.returnS !== null) returns.push(out);
  }
  for (let k = 0; k + 1 < rides.length; k++) {
    returns.push(returnOf(track, cum, phases, p, k + 1, rides[k].end, departs[k + 1], rides[k].end));
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
    avgReturnS: meanOf(returnTimes),
    bestReturnS: returnTimes.length > 0 ? Math.min(...returnTimes) : null,
    avgReturnSpeedMs: meanOf(measured.flatMap((r) => (r.returnSpeedMs === null ? [] : [r.returnSpeedMs]))),
    chainedCount: returns.filter((r) => r.after > 0 && r.returnS === null).length,
    firstOutS: firstOut?.returnS ?? null,
    flightCount: flights.length,
    flightS: flights.reduce((s, f) => s + f.durationS, 0),
    longestFlightS: flights.length > 0 ? Math.max(...flights.map((f) => f.durationS)) : null,
    maxWavesInFlight: flights.length > 0 ? Math.max(...flights.map((f) => f.waveCount)) : null,
  };
};
