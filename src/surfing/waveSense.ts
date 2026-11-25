import { angleDiff, circularMean, normalizeDeg, toDeg } from '../core/angles';
import { planeProjection } from '../core/geo';
import type { ActiveRun } from '../core/sessionStats';
import type { SurfPeakZone, SurfWaveSense } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { beachLineAxisDeg } from './peakZone';

/**
 * Sens des vagues d'une session de surf : le cap vers lequel elles déferlent,
 * vers la plage, estimé sur les vagues prises comme le vent l'est sur les
 * manœuvres en voile, par une moyenne vectorielle pondérée, sans filtre. Pur,
 * en SI ; seuils du profil (`SurfProfile.waveSense`).
 *
 * Une mesure par glisse : son déplacement pendant les `windowS` premières
 * secondes, la descente, avant les virages. Les gauches et les droites partent
 * en biais de part et d'autre du sens et se compensent vers lui. Chaque
 * déplacement pèse sa longueur en mètres : une vague courte ou lente compte
 * moins, sans être écartée. La corde de toute la vague, trop latérale, n'est
 * pas retenue.
 *
 * Des vagues toutes prises en biais du même côté, ou plus de gauches que de
 * droites, tirent la moyenne de côté. Quand au moins `lineMinDepartures`
 * départs dessinent une ligne le long de la plage, la garde de la zone du pic
 * (étalée d'au moins `SurfPeakZone.lineMinM`, à `maxTiltDeg` au plus de la
 * perpendiculaire au sens) la reconnaît, et le sens estimé devient la
 * perpendiculaire à cette ligne, du côté du sens mesuré (`alignedWaveSense`).
 * La garde se juge sur le sens mesuré, celui qui oriente la zone ; `R`, le
 * nombre de mesures et `reliable` restent ceux des mesures. Un sens saisi
 * n'est jamais recalé.
 *
 * Sur foil, une remontée faite en vol, pompée assez vite pour passer le seuil
 * de vague, va contre ce sens : `isAgainstWaveSense` la reconnaît.
 */

export interface WaveSense {
  /** Cap vers lequel les vagues déferlent, en degrés depuis le nord, de 0 à 360. */
  directionDeg: number;
  /** Concentration des mesures, de 0 (tous les sens) à 1 (un seul). */
  R: number;
  /** Nombre de glisses mesurées. */
  samples: number;
  /** Vrai quand les mesures sont assez nombreuses et assez concentrées pour écarter des remontées pompées : au moins `minWaves` mesures et `R` d'au moins `minR`. */
  reliable: boolean;
  /** `saisi` : donné par l'utilisateur pour la session (`R` à 1, aucune mesure, fiable) ; `estime` : tiré de la trace. */
  source: 'saisi' | 'estime';
}

/** Sens des vagues saisi pour la session, cap vers lequel elles vont : il vaut un sens mesuré sans doute. */
export const enteredWaveSense = (directionDeg: number): WaveSense =>
  ({ directionDeg: normalizeDeg(directionDeg), R: 1, samples: 0, reliable: true, source: 'saisi' });

interface Displacement {
  bearingDeg: number;
  lengthM: number;
}

/** Position au temps `atMs`, entre les points `from` et `to`, interpolée sur le pas qui le contient : un long pas suffit (règle 10). */
const positionAt = (track: readonly TrackPoint[], from: number, to: number, atMs: number): { lat: number; lon: number } => {
  let j = from;
  while (j < to && track[j].timeMs < atMs) j++;
  const b = track[j];
  if (j === from || b.timeMs <= atMs) return b;
  const a = track[j - 1];
  const f = (atMs - a.timeMs) / (b.timeMs - a.timeMs);
  return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
};

/** Déplacement du point `from` jusqu'à la position donnée, en mètres, et son cap. */
const displacementTo = (track: readonly TrackPoint[], from: number, to: { lat: number; lon: number }): Displacement => {
  const origin = track[from];
  const q = planeProjection(origin.lat, origin).to(to);
  return { bearingDeg: normalizeDeg(toDeg(Math.atan2(q.x, q.y))), lengthM: Math.hypot(q.x, q.y) };
};

/** Déplacement des `windowS` premières secondes d'une glisse, bornées à sa fin. */
const earlyDisplacement = (track: readonly TrackPoint[], run: ActiveRun, windowS: number): Displacement => {
  const atMs = Math.min(track[run.start].timeMs + windowS * 1000, track[run.end].timeMs);
  return displacementTo(track, run.start, positionAt(track, run.start, run.end, atMs));
};

/**
 * Sens des vagues tiré des glisses `rides` (sans foil, les vagues ; sur foil,
 * la vague qui lance chaque vol). `null` seulement sans aucune mesure ; sinon
 * le sens est rendu, avec `reliable` à faux quand il y a moins de `minWaves`
 * mesures ou que `R` est sous `minR`.
 */
export const estimateWaveSense = (
  track: readonly TrackPoint[], rides: readonly ActiveRun[], ws: Pick<SurfWaveSense, 'windowS' | 'minWaves' | 'minR'>
): WaveSense | null => {
  const measures = rides.map((r) => earlyDisplacement(track, r, ws.windowS)).filter((d) => d.lengthM > 0);
  if (measures.length === 0) return null;
  const { mean, R } = circularMean(measures.map((d) => d.bearingDeg), measures.map((d) => d.lengthM));
  const reliable = measures.length >= ws.minWaves && R >= ws.minR;
  return { directionDeg: mean, R, samples: measures.length, reliable, source: 'estime' };
};

/**
 * Sens estimé `sense` recalé sur la ligne des départs `departures` (points de
 * la trace, ceux de la zone du pic) : quand la zone orientée par lui suivrait
 * cette ligne (`beachLineAxisDeg`), il devient sa perpendiculaire, du côté où
 * il pointe (produit scalaire positif avec lui). Rendu tel quel : `null`, un
 * sens saisi, un sens trop peu concentré pour orienter la zone (`R` sous
 * `minR`), moins de `lineMinDepartures` départs gardés, des départs groupés,
 * une ligne trop proche du sens, ou `onLine` à faux (le sens mesuré seul).
 * Seule la direction change.
 */
export const alignedWaveSense = (
  track: readonly TrackPoint[], departures: readonly number[], sense: WaveSense | null,
  ws: Pick<SurfWaveSense, 'minR' | 'lineMinDepartures'>, pz: SurfPeakZone, onLine = true
): WaveSense | null => {
  if (sense === null || sense.source === 'saisi' || !onLine) return sense;
  if (sense.R < ws.minR) return sense;
  const axisDeg = beachLineAxisDeg(track, departures, sense, pz, ws.lineMinDepartures);
  if (axisDeg === null) return sense;
  const across = normalizeDeg(axisDeg + 90);
  // La garde tient la ligne à 45° au plus de la perpendiculaire au sens : le côté n'est jamais douteux.
  return { ...sense, directionDeg: Math.abs(angleDiff(across, sense.directionDeg)) <= 90 ? across : normalizeDeg(across + 180) };
};

/**
 * Le passage `run` va-t-il contre le sens des vagues ? Sa corde, du début à la
 * fin, s'en écarte de plus de `againstDeg`. Un passage revenu à son point de
 * départ n'a pas de cap : il n'est pas jugé contre.
 */
export const isAgainstWaveSense = (
  track: readonly TrackPoint[], run: ActiveRun, sense: WaveSense, againstDeg: number
): boolean => {
  const chord = displacementTo(track, run.start, track[run.end]);
  return chord.lengthM > 0 && Math.abs(angleDiff(chord.bearingDeg, sense.directionDeg)) > againstDeg;
};
