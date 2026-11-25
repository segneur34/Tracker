import { toRad } from '../core/angles';
import { planeProjection, type PlanePoint } from '../core/geo';
import type { LatLon } from '../core/types';
import type { PeakZone } from './peakZone';

/**
 * Dessin du sens des vagues sur la carte de l'analyse surf, en deux pièces :
 * une ligne de vague parallèle au grand axe de la zone du pic, côté large, et
 * une flèche qui part du centre de la zone vers la plage. Les longueurs sont
 * fixées en pixels d'écran (constantes de dessin), passées en mètres par
 * l'échelle de la carte (mètres par pixel) ; les positions suivent le terrain.
 * Pur, en SI.
 */

/** Longueur de la flèche, pointe comprise, en pixels. */
export const WAVE_ARROW_LENGTH_PX = 50;
/** Longueur de la pointe de la flèche, dans le sens de la flèche, en pixels. */
export const WAVE_ARROW_HEAD_LENGTH_PX = 11;
/** Largeur de la pointe de la flèche, en pixels. */
export const WAVE_ARROW_HEAD_WIDTH_PX = 10;
/** Part du demi-grand axe que la ligne de vague couvre de chaque côté de son milieu. */
export const WAVE_LINE_HALF_SHARE = 0.8;
/** Écart de la ligne de vague au bord de la zone, côté large, en pixels. */
export const WAVE_LINE_GAP_PX = 12;

export interface WaveSenseMarks {
  /** Ligne de vague : ses deux extrémités. */
  line: [LatLon, LatLon];
  /** Tige de la flèche : du centre de la zone à la base de la pointe. */
  shaft: [LatLon, LatLon];
  /** Pointe de la flèche, triangle plein : sommet, puis les deux coins de la base. */
  head: [LatLon, LatLon, LatLon];
}

/**
 * Ligne de vague et flèche d'une zone, pour un sens des vagues (degrés depuis
 * le nord, vers la plage) et une échelle `metersPerPx`. La flèche suit le sens,
 * même quand le grand axe de la zone ne lui est pas perpendiculaire ; la ligne
 * est toujours du côté opposé au sens (le large).
 */
export const waveSenseMarks = (zone: PeakZone, directionDeg: number, metersPerPx: number): WaveSenseMarks => {
  const proj = planeProjection(zone.center.lat, zone.center);
  const at = (p: PlanePoint): LatLon => proj.from(p);
  const phi = toRad(zone.majorAxisDeg);
  const major: PlanePoint = { x: Math.sin(phi), y: Math.cos(phi) };
  const sense = toRad(directionDeg);
  const wave: PlanePoint = { x: Math.sin(sense), y: Math.cos(sense) };
  const across: PlanePoint = { x: -wave.y, y: wave.x };

  // Normale au grand axe, tournée vers le large (à l'opposé du sens des vagues).
  let normal: PlanePoint = { x: -major.y, y: major.x };
  if (normal.x * wave.x + normal.y * wave.y > 0) normal = { x: -normal.x, y: -normal.y };

  const offset = zone.semiMinorM + WAVE_LINE_GAP_PX * metersPerPx;
  const half = WAVE_LINE_HALF_SHARE * zone.semiMajorM;
  const mid: PlanePoint = { x: normal.x * offset, y: normal.y * offset };
  const line: [LatLon, LatLon] = [
    at({ x: mid.x - major.x * half, y: mid.y - major.y * half }),
    at({ x: mid.x + major.x * half, y: mid.y + major.y * half }),
  ];

  const tipLen = WAVE_ARROW_LENGTH_PX * metersPerPx;
  const baseLen = (WAVE_ARROW_LENGTH_PX - WAVE_ARROW_HEAD_LENGTH_PX) * metersPerPx;
  const wing = (WAVE_ARROW_HEAD_WIDTH_PX / 2) * metersPerPx;
  const base: PlanePoint = { x: wave.x * baseLen, y: wave.y * baseLen };
  return {
    line,
    shaft: [at({ x: 0, y: 0 }), at(base)],
    head: [
      at({ x: wave.x * tipLen, y: wave.y * tipLen }),
      at({ x: base.x + across.x * wing, y: base.y + across.y * wing }),
      at({ x: base.x - across.x * wing, y: base.y - across.y * wing }),
    ],
  };
};
