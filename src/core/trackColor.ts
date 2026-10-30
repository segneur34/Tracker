import { meanFilterByTime } from './speedFilter';
import { speedGradientColor, type SpeedRangeMs } from './speedGradient';
import type { Treatment } from './sportProfiles';
import type { TrackPoint } from './types';

/**
 * Couleur de la trace par la vitesse, la même dans l'analyse et dans la
 * vignette de la bibliothèque : une seule fonction, pour qu'une session ait
 * une seule coloration.
 */

/**
 * Lissage de la vitesse de couleur, en secondes, par traitement. À pied et à
 * vélo, le GPS tremble à basse vitesse et la trace se bariolerait : une
 * moyenne de 15 s la rend lisible. En voile, la vitesse lissée du noyau
 * suffit, et une moyenne effacerait les accélérations courtes ; en surf
 * aussi, où une vague ne dure que quelques secondes.
 */
export const TRACK_COLOR_SMOOTHING_S: Record<Treatment, number> = {
  voile: 0,
  course: 15,
  velo: 15,
  surf: 0,
  // Sans trace : sans objet.
  muscu: 0,
};

/** Vitesse de couleur de chaque point, en m/s. */
export const trackColorSpeedsMs = (track: readonly TrackPoint[], treatment: Treatment): number[] => {
  const speeds = track.map((p) => p.smoothedSpeedMs);
  const windowS = TRACK_COLOR_SMOOTHING_S[treatment];
  return windowS > 0 ? meanFilterByTime(speeds, track.map((p) => p.timeMs), windowS) : speeds;
};

/** Un trait de la trace : deux points consécutifs et leur couleur (`TrackSegmentsLayer`). */
export interface ColoredSegment {
  positions: [[number, number], [number, number]];
  color: string;
}

/**
 * Traits d'une suite de points déjà munis de leur vitesse de couleur
 * (`trackColorSpeedsMs`), un par paire de points consécutifs, à la couleur du
 * point d'arrivée. La vignette y passe ses points échantillonnés : la vitesse
 * ayant été lissée sur la trace entière, la couleur ne dépend pas de
 * l'échantillonnage.
 */
export const coloredSegments = (
  points: readonly { lat: number; lon: number; colorMs: number }[],
  range: SpeedRangeMs
): ColoredSegment[] => {
  const segments: ColoredSegment[] = [];
  for (let k = 1; k < points.length; k++) {
    const from = points[k - 1];
    const to = points[k];
    segments.push({
      positions: [[from.lat, from.lon], [to.lat, to.lon]],
      color: speedGradientColor(to.colorMs, range.minMs, range.maxMs),
    });
  }
  return segments;
};

/** Traits de la trace colorée par la vitesse, comme l'analyse la dessine. */
export const trackColorSegments = (
  track: readonly TrackPoint[],
  treatment: Treatment,
  range: SpeedRangeMs
): ColoredSegment[] => {
  const speeds = trackColorSpeedsMs(track, treatment);
  return coloredSegments(track.map((p, i) => ({ lat: p.lat, lon: p.lon, colorMs: speeds[i] })), range);
};

/**
 * Nombre de tranches de la trace dessinée (carte, image de partage) : traits
 * regroupés par couleur dans chaque tranche, tranches dans l'ordre
 * (`pathsByColor`). Un passage plus récent reste dessiné par-dessus un plus
 * ancien (tours, aller-retour), pour quelques centaines ou milliers de tracés
 * par dessin au lieu d'un par trait. 3 h de sortie : des tranches de 42 s.
 */
export const PAINT_ORDER_TRANCHES = 256;

/** Traits d'une même couleur (`pathsByColor`), par leur rang dans la liste des traits. */
export interface ColorPaths {
  color: string;
  segments: number[];
}

/**
 * Traits de la trace regroupés par couleur, pour les dessiner d'un seul tracé
 * par couleur (carte, image de partage) : la couleur exacte de chaque trait,
 * aucune teinte arrondie ; un trait de moins de deux points ne dessine rien et
 * n'est pas repris. Chaque groupe donne le rang de ses traits dans `segments`.
 *
 * Le regroupement se fait dans chacune des `tranches` parts égales de la
 * trace (en nombre de traits consécutifs, donc en durée quelle que soit la
 * cadence), tranches dans l'ordre de la trace ; dans une tranche, les couleurs
 * dans l'ordre de leur première apparition, les traits dans leur ordre. Une
 * trace qui repasse sur elle-même (tours de piste, aller-retour) garde ainsi
 * le passage le plus récent par-dessus, comme quand chaque trait était
 * dessiné à son tour ; seul un recoupement à l'intérieur d'une tranche se
 * mêle. Sans `tranches`, une seule.
 */
export const pathsByColor = (
  segments: ReadonlyArray<{ positions: ReadonlyArray<unknown>; color: string }>,
  tranches = 1
): ColorPaths[] => {
  const chunk = Math.max(1, Math.ceil(segments.length / Math.max(1, tranches)));
  const groups: ColorPaths[] = [];
  let byColor = new Map<string, number[]>();
  const flush = () => {
    for (const [color, indices] of byColor) groups.push({ color, segments: indices });
    byColor = new Map();
  };
  segments.forEach((s, i) => {
    if (i > 0 && i % chunk === 0) flush();
    if (s.positions.length < 2) return;
    let indices = byColor.get(s.color);
    if (!indices) {
      indices = [];
      byColor.set(s.color, indices);
    }
    indices.push(i);
  });
  flush();
  return groups;
};

/**
 * Bornes de couleur effectives d'une trace (décision transverse « Couleur de
 * trace »), dans cet ordre : celles de la trace (sa fiche, ou le brouillon de
 * son analyse) ; sinon celles de son activité, réglées dans Réglages ou
 * pré-réglées ; sinon, en voile, celles suggérées par l'allure de la session ;
 * sinon celles par défaut de l'activité, ou du calcul pour une session sans
 * activité (`SportProfile.speedRange`). Les modules d'analyse, les vignettes
 * et l'image partagée passent tous par ici.
 */
export const effectiveSpeedRange = ({ sessionRange, activityRange, suggested, fallback }: {
  sessionRange: SpeedRangeMs | null;
  activityRange: SpeedRangeMs | null;
  suggested: SpeedRangeMs | null;
  fallback: SpeedRangeMs;
}): SpeedRangeMs => sessionRange ?? activityRange ?? suggested ?? fallback;
