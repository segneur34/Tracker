import { normalizeDeg, toDeg, toRad } from '../core/angles';
import { median } from '../core/basics';
import { planeProjection, type PlanePoint } from '../core/geo';
import type { SurfPeakZone } from '../core/sportProfiles';
import type { LatLon, TrackPoint } from '../core/types';
import type { WaveSense } from './waveSense';

/**
 * Zone du pic d'une session de surf : une ellipse mince qui contient les
 * départs des glisses (début compté d'une vague, décollage d'un vol sur foil),
 * une seule pour toute la session, allongée le long de la plage. Pur, en SI ;
 * seuils du profil (`SurfProfile.peakZone`).
 *
 * Le pic s'étale le long de la ligne de déferlement et n'est jamais deux fois
 * au même endroit : le grand axe suit la ligne des départs quand ils s'étalent
 * d'au moins `lineMinM`, tant qu'elle ne s'écarte pas de plus de
 * `maxTiltDeg` de la perpendiculaire au sens des vagues (des vagues
 * surfées en biais faussent le sens, pas la ligne). Départs groupés, départ
 * unique, ou ligne trop proche du sens des vagues : la perpendiculaire au
 * sens. Sans sens, la ligne des départs, sans borne ; sans ligne non plus,
 * l'est-ouest. Jamais un cercle : le grand axe vaut au moins
 * `minAspect` fois le petit. La même garde recale le sens estimé sur la
 * ligne des départs, à partir de trois départs gardés et non de deux
 * (`beachLineAxisDeg`, `alignedWaveSense`) ; la zone, elle,
 * reste orientée par le sens brut, pour que l'un ne réponde pas à l'autre.
 *
 * Zone mince : le grand demi-axe est la demi-étendue des départs le long de
 * l'axe, plus la marge ; le petit, leur demi-étendue de part et d'autre, plus
 * la marge. Sur la ligne des départs, leur décalage le long du sens des vagues
 * ne l'épaissit donc pas. Sur la perpendiculaire au sens (départs groupés, ou
 * étalés vers le large plutôt que le long de la plage), il l'épaissit : la zone
 * contient tous les départs gardés, et seuls ceux de l'intérieur en sortent.
 * Avec un sens, la marge n'est que de `beachMarginM` côté plage : une
 * vague courte finit vite hors de la zone, et le retour au pic se mesure. Le
 * centre se décale alors vers le large ; la forme reste une ellipse. Un départ
 * resté dehors (au bout du grand axe, où l'ellipse se resserre) fait grandir le
 * petit axe seul, juste assez.
 *
 * Un départ loin vers la plage (une vague de l'intérieur, reprise en chemin)
 * n'entre pas dans la zone : il est à plus de `insideM` de la médiane des
 * départs, le long du sens des vagues ; il est écarté avant le calcul de l'axe.
 * Sans sens, la plage n'est pas connue, et aucun départ n'est écarté.
 *
 * Le retour au pic se mesure jusqu'à l'entrée dans la zone (`zoneEntry`),
 * calculée sur le segment entre deux points : un long pas qui traverse le bord
 * compte (règle 10), mais pas un trou de la trace, jamais interpolé.
 */

/**
 * Jeu, en mètres, laissé au départ qui fait grandir le petit axe : posé
 * exactement sur le bord, il pourrait en sortir à l'arrondi de la projection.
 */
const EDGE_SLACK_M = 0.1;

/**
 * D'où vient l'axe de la zone : la ligne des départs, bornée par le sens des
 * vagues (`ligne`) ; la perpendiculaire au sens (`vagues`) ; sans sens, la
 * ligne des départs, ou l'est-ouest faute de ligne (`departs`).
 */
export type PeakZoneOrientation = 'ligne' | 'vagues' | 'departs';

export interface PeakZone {
  center: LatLon;
  /** Demi-grand axe, en mètres, le long de la plage. */
  semiMajorM: number;
  /** Demi-petit axe, en mètres, en travers du grand. */
  semiMinorM: number;
  /** Cap du grand axe, en degrés depuis le nord, de 0 à 180. */
  majorAxisDeg: number;
  orientation: PeakZoneOrientation;
  /** Points de la trace des départs qui font la zone. */
  departures: number[];
  /** Points de la trace des départs de l'intérieur, écartés de la zone. */
  insideDepartures: number[];
}

/** Entrée dans la zone : l'instant et la position, interpolés sur le pas qui franchit le bord. */
export interface ZoneEntry extends LatLon {
  timeMs: number;
}

/** Vecteurs unitaires du grand axe, au cap `majorAxisDeg`, et du petit axe, 90° plus loin dans le sens inverse des aiguilles. */
const axesOf = (majorAxisDeg: number): { major: PlanePoint; minor: PlanePoint } => {
  const phi = toRad(majorAxisDeg);
  return { major: { x: Math.sin(phi), y: Math.cos(phi) }, minor: { x: -Math.cos(phi), y: Math.sin(phi) } };
};

const dot = (a: PlanePoint, b: PlanePoint): number => a.x * b.x + a.y * b.y;

/** Cap de l'axe principal d'un nuage de points, de 0 à 180 ; `null` s'il n'en a pas (points confondus ou nuage rond). */
const principalAxisDeg = (points: readonly PlanePoint[]): number | null => {
  const mx = points.reduce((s, q) => s + q.x, 0) / points.length;
  const my = points.reduce((s, q) => s + q.y, 0) / points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const q of points) {
    sxx += (q.x - mx) ** 2;
    syy += (q.y - my) ** 2;
    sxy += (q.x - mx) * (q.y - my);
  }
  const spread = sxx + syy;
  if (spread === 0 || Math.hypot(sxx - syy, 2 * sxy) <= 1e-9 * spread) return null;
  // Angle de l'axe depuis l'est, sens inverse des aiguilles ; le cap se compte depuis le nord, sens des aiguilles.
  const alpha = Math.atan2(2 * sxy, sxx - syy) / 2;
  return normalizeDeg(90 - toDeg(alpha)) % 180;
};

/** Écart entre deux caps d'axe, modulo 180°, de 0 à 90. */
const axisGapDeg = (a: number, b: number): number => {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

/** Axe de la zone sans sens des vagues ni ligne des départs (un seul départ, ou des départs confondus) : l'est-ouest, par convention. */
const EAST_WEST_DEG = 90;

/** Ligne des départs : le cap de leur axe principal, de 0 à 180, et leur étendue le long de lui, en mètres. */
export interface DepartureLine {
  axisDeg: number;
  extentM: number;
}

/**
 * Ligne d'un nuage de départs, positions dans un plan local en mètres : leur
 * axe principal et leur étendue le long de lui. `null` sous deux départs, ou
 * sans axe (départs confondus, ou nuage rond).
 */
export const departureLine = (points: readonly PlanePoint[]): DepartureLine | null => {
  const axisDeg = points.length >= 2 ? principalAxisDeg(points) : null;
  if (axisDeg === null) return null;
  const along = points.map((q) => dot(q, axesOf(axisDeg).major));
  return { axisDeg, extentM: Math.max(...along) - Math.min(...along) };
};

/** Cap de la perpendiculaire au sens des vagues, de 0 à 180 : la plage, faute de mieux. */
const acrossDeg = (sense: WaveSense): number => normalizeDeg(sense.directionDeg + 90) % 180;

/**
 * La ligne des départs suit-elle la plage ? Étalée d'au moins `lineMinM`,
 * à `maxTiltDeg` au plus de la perpendiculaire au sens des vagues.
 */
const followsBeach = (line: DepartureLine | null, sense: WaveSense, pz: SurfPeakZone): line is DepartureLine =>
  line !== null && line.extentM >= pz.lineMinM && axisGapDeg(line.axisDeg, acrossDeg(sense)) <= pz.maxTiltDeg;

/**
 * Départs projetés dans le plan centré sur leur moyenne, le vecteur vers la
 * plage (le long du sens des vagues, `null` sans sens), et les départs qui
 * font la zone, en rangs de `departures` : sans ceux de l'intérieur quand la
 * plage est connue.
 */
const zoneDepartures = (
  track: readonly TrackPoint[], departures: readonly number[], sense: WaveSense | null, pz: SurfPeakZone
) => {
  const origin = {
    lat: departures.reduce((s, i) => s + track[i].lat, 0) / departures.length,
    lon: departures.reduce((s, i) => s + track[i].lon, 0) / departures.length,
  };
  const proj = planeProjection(origin.lat, origin);
  const points = departures.map((i) => proj.to(track[i]));
  const toBeach = sense === null ? null : { x: Math.sin(toRad(sense.directionDeg)), y: Math.cos(toRad(sense.directionDeg)) };
  let kept = departures.map((_, k) => k);
  if (toBeach !== null) {
    const along = points.map((q) => dot(q, toBeach));
    const mid = median(along);
    kept = kept.filter((k) => along[k] - mid <= pz.insideM);
  }
  return { proj, points, toBeach, kept };
};

/**
 * Axe de la ligne des départs quand la zone orientée par `sense` la suit
 * (orientation `ligne`) : mêmes départs gardés, même garde que
 * `buildPeakZone`. `null` sinon : sans départ, départs groupés, ligne trop
 * proche du sens des vagues, ou moins de `minDepartures` départs gardés (deux,
 * comme pour la zone, par défaut ; trois pour recaler le sens,
 * `SurfWaveSense.lineMinDepartures`).
 */
export const beachLineAxisDeg = (
  track: readonly TrackPoint[], departures: readonly number[], sense: WaveSense, pz: SurfPeakZone, minDepartures = 2
): number | null => {
  if (departures.length === 0) return null;
  const { points, kept } = zoneDepartures(track, departures, sense, pz);
  if (kept.length < minDepartures) return null;
  const line = departureLine(kept.map((k) => points[k]));
  return followsBeach(line, sense, pz) ? line.axisDeg : null;
};

/**
 * Zone du pic, faite des départs `departures` (points de la trace), orientée
 * par le sens des vagues `sense` quand il est utilisable (au moins une mesure
 * assez concentrée : c'est à l'appelant d'en juger). `null` sans départ.
 */
export const buildPeakZone = (
  track: readonly TrackPoint[], departures: readonly number[], sense: WaveSense | null, pz: SurfPeakZone
): PeakZone | null => {
  if (departures.length === 0) return null;
  const marginM = pz.marginM;
  // Vers la plage, le long du sens des vagues ; sans sens, la plage n'est pas connue, et aucun départ n'est écarté.
  const { proj, points, toBeach, kept } = zoneDepartures(track, departures, sense, pz);
  const keptPoints = kept.map((k) => points[k]);

  // La ligne des départs gardés : leur axe principal, suivi s'ils s'étalent assez le long de lui.
  const line = departureLine(keptPoints);

  let orientation: PeakZoneOrientation;
  let majorAxisDeg: number;
  if (sense !== null) {
    const isLine = followsBeach(line, sense, pz);
    orientation = isLine ? 'ligne' : 'vagues';
    majorAxisDeg = isLine ? line.axisDeg : acrossDeg(sense);
  } else {
    orientation = 'departs';
    majorAxisDeg = line?.axisDeg ?? EAST_WEST_DEG;
  }

  const { major, minor } = axesOf(majorAxisDeg);
  const s = keptPoints.map((q) => dot(q, major));
  const a = keptPoints.map((q) => dot(q, minor));
  const sMid = (Math.min(...s) + Math.max(...s)) / 2;
  const aMid = (Math.min(...a) + Math.max(...a)) / 2;
  const sHalf = (Math.max(...s) - Math.min(...s)) / 2;
  const aHalf = (Math.max(...a) - Math.min(...a)) / 2;

  // Marges de part et d'autre du grand axe : la pleine vers le large, la réduite vers la plage quand elle est connue.
  // Le côté plage du petit axe : le signe de sa projection sur le sens des vagues (l'axe n'en est jamais perpendiculaire).
  const beachMarginM = toBeach === null ? marginM : pz.beachMarginM;
  const beachSign = toBeach === null ? 1 : Math.sign(dot(minor, toBeach)) || 1;
  const aCenter = aMid - (beachSign * (marginM - beachMarginM)) / 2;
  let semiMinorM = aHalf + (marginM + beachMarginM) / 2;
  const minAspect = pz.minAspect;
  let semiMajorM = Math.max(sHalf + marginM, minAspect * semiMinorM);
  // Là où l'ellipse se resserre (au bout du grand axe, dans les coins de la boîte des départs), un départ peut rester
  // dehors : le petit axe seul grandit, juste assez pour le reprendre.
  for (let j = 0; j < kept.length; j++) {
    const ds = s[j] - sMid;
    const da = a[j] - aCenter;
    const room = 1 - (ds / semiMajorM) ** 2;
    if (room > 0 && (da / semiMinorM) ** 2 > room) semiMinorM = Math.abs(da) / Math.sqrt(room) + EDGE_SLACK_M;
  }
  // L'allongement minimal tient encore : la zone n'est jamais ronde.
  semiMajorM = Math.max(semiMajorM, minAspect * semiMinorM);
  const center = proj.from({ x: sMid * major.x + aCenter * minor.x, y: sMid * major.y + aCenter * minor.y });
  return {
    center, semiMajorM, semiMinorM, majorAxisDeg, orientation,
    departures: kept.map((k) => departures[k]),
    insideDepartures: departures.filter((_, k) => !kept.includes(k)),
  };
};

/** Position en coordonnées de l'ellipse ramenée au cercle unité : dedans si la norme ne dépasse pas 1. */
const unitFrameOf = (zone: PeakZone): ((p: LatLon) => PlanePoint) => {
  const proj = planeProjection(zone.center.lat, zone.center);
  const { major, minor } = axesOf(zone.majorAxisDeg);
  return (p) => {
    const q = proj.to(p);
    return { x: dot(q, major) / zone.semiMajorM, y: dot(q, minor) / zone.semiMinorM };
  };
};

const insideUnit = (u: PlanePoint): boolean => dot(u, u) <= 1;

/** La position est-elle dans la zone (bord compris) ? */
export const isInZone = (zone: PeakZone, p: LatLon): boolean => insideUnit(unitFrameOf(zone)(p));

/**
 * Premier instant, de 0 à 1 le long du segment `u0` → `u1` (coordonnées du
 * cercle unité, `u0` dehors), où il entre dans le cercle ; `null` s'il n'y entre pas.
 */
const firstInside = (u0: PlanePoint, u1: PlanePoint): number | null => {
  const d = { x: u1.x - u0.x, y: u1.y - u0.y };
  const qa = dot(d, d);
  if (qa === 0) return null;
  const qb = 2 * dot(u0, d);
  const qc = dot(u0, u0) - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const t = (-qb - Math.sqrt(disc)) / (2 * qa);
  return t >= 0 && t <= 1 ? t : null;
};

/**
 * Première entrée dans la zone entre les points `from` et `to` : le point
 * `from` lui-même s'il y est déjà, sinon le franchissement du bord, interpolé
 * dans le temps et l'espace sur le pas qui le porte. Un pas plus long que
 * `maxGapS`, ou la reprise d'une pause (`segmentStart`), n'est pas interpolé :
 * seul son point d'arrivée compte. `null` si la trace n'y entre pas.
 */
export const zoneEntry = (
  track: readonly TrackPoint[], zone: PeakZone, from: number, to: number, maxGapS: number
): ZoneEntry | null => {
  const unit = unitFrameOf(zone);
  const at = (i: number): ZoneEntry => ({ timeMs: track[i].timeMs, lat: track[i].lat, lon: track[i].lon });
  let prev = unit(track[from]);
  if (insideUnit(prev)) return at(from);
  for (let i = from + 1; i <= to; i++) {
    const cur = unit(track[i]);
    const a = track[i - 1];
    const b = track[i];
    if (b.segmentStart || (b.timeMs - a.timeMs) / 1000 > maxGapS) {
      if (insideUnit(cur)) return at(i);
    } else {
      const t = firstInside(prev, cur);
      if (t !== null) {
        return { timeMs: a.timeMs + t * (b.timeMs - a.timeMs), lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
      }
    }
    prev = cur;
  }
  return null;
};

/** Contour de la zone, `n` points répartis sur l'ellipse, pour la dessiner. */
export const peakZoneOutline = (zone: PeakZone, n = 64): LatLon[] => {
  const proj = planeProjection(zone.center.lat, zone.center);
  const { major, minor } = axesOf(zone.majorAxisDeg);
  return Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n;
    const s = zone.semiMajorM * Math.cos(angle);
    const a = zone.semiMinorM * Math.sin(angle);
    return proj.from({ x: s * major.x + a * minor.x, y: s * major.y + a * minor.y });
  });
};
