import type { RestingHrProtocol, RestingSample } from '../recording/restingHrTest';

/**
 * Résultat d'un test de FC repos (`recording/restingHrTest.ts`) : la moyenne
 * de 30 secondes la plus basse après la première minute, et la courbe à la seconde pour
 * le graphique. Tout se mesure en temps : chaque mesure vaut depuis son
 * instant jusqu'à la suivante (au plus `holdS`), donc une ceinture à 1 Hz et à
 * 5 Hz donnent la même courbe.
 */
export interface RestingHrResult {
  /** Moyenne de la fenêtre la plus basse, arrondie ; `null` si aucune fenêtre n'est assez couverte. */
  lowestBpm: number | null;
  /** Début et fin de cette fenêtre, en secondes depuis le départ. */
  fromS: number | null;
  toS: number | null;
  /** Moyenne et maximum de toute la mesure. */
  meanBpm: number | null;
  maxBpm: number | null;
  /** Part des secondes couvertes par une mesure, de 0 à 1. */
  coverage: number;
  /** Assez de mesures pour fier le résultat. */
  complete: boolean;
  /** La FC de chaque seconde (la moyenne de la seconde), `null` sans mesure. */
  series: (number | null)[];
}

const validBpm = (bpm: number | null, protocol: RestingHrProtocol): bpm is number =>
  bpm !== null && isFinite(bpm) && bpm >= protocol.minBpm && bpm <= protocol.maxBpm;

/** Courbe à la seconde : `durationS` valeurs, chacune la moyenne pondérée par le temps de sa seconde, `null` si moins de la moitié couverte. */
export const restingHrSeries = (samples: readonly RestingSample[], startMs: number, protocol: RestingHrProtocol): (number | null)[] => {
  const bins = protocol.durationS;
  const sum = new Array<number>(bins).fill(0);
  const dur = new Array<number>(bins).fill(0);
  const endMs = startMs + bins * 1000;
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  for (let i = 0; i < sorted.length; i++) {
    const { timeMs, bpm } = sorted[i];
    if (!validBpm(bpm, protocol)) continue;
    const nextMs = i + 1 < sorted.length ? sorted[i + 1].timeMs : Infinity;
    const from = Math.max(timeMs, startMs);
    const to = Math.min(nextMs, timeMs + protocol.holdS * 1000, endMs);
    if (to <= from) continue;
    for (let b = Math.floor((from - startMs) / 1000); b < bins && startMs + b * 1000 < to; b++) {
      const overlap = Math.min(to, startMs + (b + 1) * 1000) - Math.max(from, startMs + b * 1000);
      if (overlap <= 0) continue;
      sum[b] += bpm * overlap;
      dur[b] += overlap;
    }
  }
  return sum.map((s, b) => (dur[b] >= 500 ? s / dur[b] : null));
};

export const restingHrResult = (samples: readonly RestingSample[], startMs: number, protocol: RestingHrProtocol): RestingHrResult => {
  const series = restingHrSeries(samples, startMs, protocol);
  const known = series.filter((v): v is number => v !== null);
  const coverage = series.length > 0 ? known.length / series.length : 0;

  const needed = Math.ceil(protocol.windowS * protocol.minWindowCoverage - 1e-9);
  let lowest: number | null = null;
  let fromS: number | null = null;
  for (let s = protocol.settleS; s + protocol.windowS <= series.length; s++) {
    let total = 0;
    let count = 0;
    for (let k = s; k < s + protocol.windowS; k++) {
      const v = series[k];
      if (v === null) continue;
      total += v;
      count++;
    }
    if (count < needed) continue;
    const mean = total / count;
    if (lowest === null || mean < lowest - 1e-9) {
      lowest = mean;
      fromS = s;
    }
  }

  return {
    lowestBpm: lowest === null ? null : Math.round(lowest),
    fromS,
    toS: fromS === null ? null : fromS + protocol.windowS,
    meanBpm: known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null,
    maxBpm: known.length > 0 ? Math.round(Math.max(...known)) : null,
    coverage,
    complete: lowest !== null && coverage >= protocol.minCoverage,
    series,
  };
};
