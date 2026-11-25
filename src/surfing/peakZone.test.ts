import { describe, expect, it } from 'vitest';
import { planeProjection } from '../core/geo';
import { computeKinematics } from '../core/kinematics';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { LatLon, RawTrackPoint, TrackPoint } from '../core/types';
import { beachLineAxisDeg, buildPeakZone, departureLine, isInZone, peakZoneOutline, zoneEntry, type PeakZone } from './peakZone';
import type { WaveSense } from './waveSense';

const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const ORIGIN = { lat: 43.4, lon: 3.6 };
/** Plan local du test : x vers l'est, y vers le nord (le large), en mètres. */
const plane = planeProjection(ORIGIN.lat, ORIGIN);
const MAX_GAP_S = SPORT_PROFILES.surf.maxGapS;
/** Seuils de la zone du pic, ceux du profil. */
const PZ = SPORT_PROFILES.surf.surf!.peakZone;
const { marginM: ZONE_MARGIN_M, beachMarginM: ZONE_BEACH_MARGIN_M, minAspect: ZONE_MIN_ASPECT, insideM: ZONE_INSIDE_M, maxTiltDeg: ZONE_MAX_TILT_DEG } = PZ;

interface At {
  t: number;
  x: number;
  y: number;
  segmentStart?: true;
}

/** Trace par positions en mètres et instants en secondes. */
const trackOf = (points: At[]): TrackPoint[] => {
  const raw: RawTrackPoint[] = points.map((p) => ({
    ...plane.from(p), time: new Date(T0 + Math.round(p.t * 1000)), ...(p.segmentStart ? { segmentStart: true as const } : {}),
  }));
  const profile = SPORT_PROFILES.surf;
  return computeKinematics(raw, { medianWindowSeconds: profile.medianWindowSeconds, maxSpeedMs: profile.maxPlausibleSpeedMs });
};

/** Départs posés aux positions données, dix secondes l'un après l'autre, puis un dernier point : la trace et leurs indices. */
const departuresAt = (positions: { x: number; y: number }[]) => {
  const last = positions[positions.length - 1];
  return {
    track: trackOf([...positions.map((p, k) => ({ t: 10 * k, ...p })), { t: 10 * positions.length, x: last.x, y: last.y + 1 }]),
    departures: positions.map((_, k) => k),
  };
};

const senseTo = (directionDeg: number): WaveSense => ({ directionDeg, R: 0.9, samples: 6, reliable: true, source: 'estime' });
/** Les vagues déferlent vers le sud, la plage. */
const SOUTH = senseTo(180);

/** Position décalée de `dx`, `dy` mètres. */
const moved = (p: LatLon, dx: number, dy: number): LatLon => {
  const q = plane.to(p);
  return plane.from({ x: q.x + dx, y: q.y + dy });
};

/** Écart signé entre deux caps d'axe (modulo 180°). */
const axisGap = (a: number, b: number): number => ((a - b + 90 + 180) % 180) - 90;

describe('buildPeakZone', () => {
  it('sans départ, pas de zone', () => {
    expect(buildPeakZone(trackOf([{ t: 0, x: 0, y: 0 }, { t: 1, x: 0, y: 1 }]), [], SOUTH, PZ)).toBeNull();
  });

  it('le long de la ligne des départs, mince : la marge pleine vers le large, réduite vers la plage', () => {
    // Le pic s'étale d'est en ouest sur 60 m, les vagues vont au sud : la ligne des départs est à 0,2° de l'est-ouest.
    const { track, departures } = departuresAt([{ x: -30, y: 2 }, { x: -10, y: -3 }, { x: 5, y: 4 }, { x: 30, y: 0 }]);
    const zone = buildPeakZone(track, departures, SOUTH, PZ)!;
    expect(zone.orientation).toBe('ligne');
    expect(Math.abs(axisGap(zone.majorAxisDeg, 90))).toBeLessThan(0.5);
    // Grand demi-axe : 30 m de demi-étendue et la marge. Petit : 3,5 m de demi-étendue (de −3 à 4 m) et la moyenne des
    // deux marges ; le centre, à mi-hauteur des départs (0,5 m), décalé de leur demi-différence vers le large (le nord).
    expect(zone.semiMajorM).toBeCloseTo(30 + ZONE_MARGIN_M, 0);
    expect(zone.semiMinorM).toBeCloseTo(3.5 + (ZONE_MARGIN_M + ZONE_BEACH_MARGIN_M) / 2, 0);
    expect(plane.to(zone.center).y).toBeCloseTo(0.5 + (ZONE_MARGIN_M - ZONE_BEACH_MARGIN_M) / 2, 0);
    expect(zone.semiMajorM).toBeGreaterThanOrEqual(ZONE_MIN_ASPECT * zone.semiMinorM);
    expect(zone.departures).toEqual(departures);
    expect(zone.insideDepartures).toEqual([]);
    for (const i of departures) expect(isInZone(zone, track[i])).toBe(true);
    // Au large du départ le plus au large (4 m), la zone court jusqu'à 19 m ; vers la plage, au-delà du plus proche
    // (−3 m), jusqu'à −8 m seulement.
    expect(isInZone(zone, moved(track[2], 0, 14))).toBe(true);
    expect(isInZone(zone, moved(track[2], 0, 16))).toBe(false);
    expect(isInZone(zone, moved(track[1], 0, -4))).toBe(true);
    expect(isInZone(zone, moved(track[1], 0, -6))).toBe(false);
    // Des vagues vers l'est : la ligne des départs court alors le long du sens, au-delà de la borne ; la zone suit la
    // perpendiculaire au sens, du nord au sud.
    const east = buildPeakZone(track, departures, senseTo(90), PZ)!;
    expect(east.orientation).toBe('vagues');
    expect(axisGap(east.majorAxisDeg, 0)).toBeCloseTo(0, 6);
  });

  it('un départ resté dehors au bout du grand axe : le petit axe seul grandit, juste assez', () => {
    // Quatre départs aux coins d'un rectangle de 60 m sur 24, vagues vers le sud. Grand demi-axe 30 + 15 = 45 m ; petit,
    // 12 + 10 = 22 m, centré 5 m au nord du rectangle. Les coins sud, à 30 m le long et 17 m en travers du centre,
    // demandent un petit demi-axe de 17 / √(1 − (30 / 45)²) = 22,81 m, plus le jeu de 0,1 m.
    const { track, departures } = departuresAt([{ x: -30, y: 12 }, { x: -30, y: -12 }, { x: 30, y: 12 }, { x: 30, y: -12 }]);
    const zone = buildPeakZone(track, departures, SOUTH, PZ)!;
    expect(zone.orientation).toBe('ligne');
    expect(zone.semiMajorM).toBeCloseTo(30 + ZONE_MARGIN_M, 3);
    expect(zone.semiMinorM).toBeCloseTo(17 / Math.sqrt(1 - (30 / 45) ** 2) + 0.1, 2);
    for (const i of departures) expect(isInZone(zone, track[i])).toBe(true);
  });

  it('gauches et droites mêlées : le sens, faussé et peu concentré, ne détourne pas la zone de la plage', () => {
    // Trois gauches à 230° et une droite à 130°, à 50° de part et d'autre du sud : leur moyenne vectorielle tire le sens
    // de 31° vers l'ouest, R de 0,75. Les départs s'étalent le long de la plage (est-ouest) sur 95 m.
    const mixed: WaveSense = { directionDeg: 211, R: 0.75, samples: 4, reliable: true, source: 'estime' };
    const { track, departures } = departuresAt([{ x: -50, y: 3 }, { x: -20, y: -4 }, { x: 15, y: 5 }, { x: 45, y: -2 }]);
    const zone = buildPeakZone(track, departures, mixed, PZ)!;
    expect(zone.orientation).toBe('ligne');
    expect(Math.abs(axisGap(zone.majorAxisDeg, 90))).toBeLessThan(15);
    // La perpendiculaire au sens l'aurait mise à 31° de la plage.
    expect(Math.abs(axisGap(zone.majorAxisDeg, 211 + 90))).toBeGreaterThan(25);
  });

  it('vagues toutes en biais du même côté : la ligne des départs, tant que le sens ne s\'en écarte pas au-delà de la borne', () => {
    // Que des gauches, prises en biais : le sens mesuré s'écarte du sud de 40°, puis de 50°. Départs le long de la plage.
    const { track, departures } = departuresAt([{ x: -45, y: 2 }, { x: -15, y: -3 }, { x: 15, y: 3 }, { x: 45, y: -2 }]);
    const tilted = buildPeakZone(track, departures, senseTo(220), PZ)!;
    expect(tilted.orientation).toBe('ligne');
    expect(Math.abs(axisGap(tilted.majorAxisDeg, 90))).toBeLessThan(10);
    // À 50°, la ligne s'écarte de la perpendiculaire au sens au-delà de la borne (45°) : la zone suit la perpendiculaire.
    const beyond = buildPeakZone(track, departures, senseTo(230), PZ)!;
    expect(ZONE_MAX_TILT_DEG).toBeLessThan(50);
    expect(beyond.orientation).toBe('vagues');
    expect(axisGap(beyond.majorAxisDeg, 140)).toBeCloseTo(0, 6);
    // Borne surchargeable.
    const wider = buildPeakZone(track, departures, senseTo(230), { ...PZ, maxTiltDeg: 60 })!;
    expect(wider.orientation).toBe('ligne');
    expect(Math.abs(axisGap(wider.majorAxisDeg, 90))).toBeLessThan(10);
  });

  it('écarte un départ de l\'intérieur, loin vers la plage ; sans sens des vagues, aucun', () => {
    const { track, departures } = departuresAt([
      { x: -20, y: 0 }, { x: 0, y: 3 }, { x: 15, y: -2 }, { x: 25, y: 1 },
      { x: 5, y: -30 }, { x: 0, y: -(ZONE_INSIDE_M + 20) },
    ]);
    const zone = buildPeakZone(track, departures, SOUTH, PZ)!;
    expect(zone.insideDepartures).toEqual([5]);
    expect(zone.departures).toEqual([0, 1, 2, 3, 4]);
    expect(isInZone(zone, track[5])).toBe(false);
    expect(isInZone(zone, track[4])).toBe(true);
    // Vers le large, rien n'est écarté : la plage est de l'autre côté.
    const offshore = departuresAt([{ x: -20, y: 0 }, { x: 0, y: 3 }, { x: 15, y: -2 }, { x: 25, y: 1 }, { x: 0, y: 70 }]);
    expect(buildPeakZone(offshore.track, offshore.departures, SOUTH, PZ)!.insideDepartures).toEqual([]);
    const blind = buildPeakZone(track, departures, null, PZ)!;
    expect(blind.insideDepartures).toEqual([]);
    expect(isInZone(blind, track[5])).toBe(true);
  });

  it('sans sens des vagues : la ligne des départs, deux suffisent, la marge pleine des deux côtés ; jamais ronde', () => {
    const line = departuresAt([{ x: 0, y: 0 }, { x: 20, y: 21 }, { x: 45, y: 44 }]);
    const zone = buildPeakZone(line.track, line.departures, null, PZ)!;
    expect(zone.orientation).toBe('departs');
    expect(Math.abs(axisGap(zone.majorAxisDeg, 45))).toBeLessThan(2);
    for (const i of line.departures) expect(isInZone(zone, line.track[i])).toBe(true);

    // Deux départs à 40 m l'un de l'autre : 20 m de demi-étendue et la marge en long, la marge seule en travers.
    const two = departuresAt([{ x: 0, y: 0 }, { x: 40, y: 0 }]);
    const pair = buildPeakZone(two.track, two.departures, null, PZ)!;
    expect(pair.orientation).toBe('departs');
    expect(Math.abs(axisGap(pair.majorAxisDeg, 90))).toBeLessThan(0.01);
    expect(pair.semiMajorM).toBeCloseTo(20 + ZONE_MARGIN_M, 3);
    expect(pair.semiMinorM).toBeCloseTo(ZONE_MARGIN_M, 3);
    expect(plane.to(pair.center).y).toBeCloseTo(0, 3);
  });

  it('un seul départ : oblongue en travers des vagues, décalée vers le large ; sans sens, l\'est-ouest ; jamais ronde', () => {
    const one = departuresAt([{ x: 0, y: 0 }]);
    const zone = buildPeakZone(one.track, one.departures, SOUTH, PZ)!;
    expect(zone.orientation).toBe('vagues');
    expect(axisGap(zone.majorAxisDeg, 90)).toBeCloseTo(0, 6);
    // 15 m vers le large, 5 m vers la plage : un petit demi-axe de 10 m, centré 5 m au large du départ ; le grand, 1,5 fois.
    expect(zone.semiMinorM).toBeCloseTo((ZONE_MARGIN_M + ZONE_BEACH_MARGIN_M) / 2, 6);
    expect(zone.semiMajorM).toBeCloseTo(ZONE_MIN_ASPECT * zone.semiMinorM, 6);
    expect(plane.to(zone.center).y).toBeCloseTo((ZONE_MARGIN_M - ZONE_BEACH_MARGIN_M) / 2, 3);
    const blind = buildPeakZone(one.track, one.departures, null, PZ)!;
    expect(blind.orientation).toBe('departs');
    expect(blind.majorAxisDeg).toBe(90);
    expect(blind.semiMinorM).toBeCloseTo(ZONE_MARGIN_M, 6);
    expect(blind.semiMajorM).toBeCloseTo(ZONE_MIN_ASPECT * ZONE_MARGIN_M, 6);
    // Constantes surchargeables.
    const wide = buildPeakZone(one.track, one.departures, SOUTH, { ...PZ, marginM: 30, beachMarginM: 30, minAspect: 2 })!;
    expect(wide.semiMinorM).toBeCloseTo(30, 6);
    expect(wide.semiMajorM).toBeCloseTo(60, 6);
    expect(plane.to(wide.center).y).toBeCloseTo(0, 3);
  });

  it('contour : sur le bord de la zone', () => {
    const { track, departures } = departuresAt([{ x: -30, y: 2 }, { x: -10, y: -3 }, { x: 30, y: 0 }]);
    const zone = buildPeakZone(track, departures, senseTo(200), PZ)!;
    const outline = peakZoneOutline(zone, 32);
    expect(outline).toHaveLength(32);
    const local = planeProjection(zone.center.lat, zone.center);
    for (const p of outline) {
      const q = local.to(p);
      expect(isInZone(zone, local.from({ x: q.x * 0.99, y: q.y * 0.99 }))).toBe(true);
      expect(isInZone(zone, local.from({ x: q.x * 1.01, y: q.y * 1.01 }))).toBe(false);
    }
  });
});

describe('departureLine', () => {
  it('l\'axe principal des départs et leur étendue le long de lui', () => {
    // Quatre départs sur une droite au 60°, de −30 à 30 m de l'origine le long d'elle.
    const at = (d: number) => ({ x: d * Math.sin(Math.PI / 3), y: d * Math.cos(Math.PI / 3) });
    const line = departureLine([at(-30), at(-5), at(10), at(30)])!;
    expect(line.axisDeg).toBeCloseTo(60, 6);
    expect(line.extentM).toBeCloseTo(60, 6);
  });

  it('ni ligne sous deux départs, ni pour des départs confondus', () => {
    expect(departureLine([{ x: 3, y: 4 }])).toBeNull();
    expect(departureLine([{ x: 3, y: 4 }, { x: 3, y: 4 }])).toBeNull();
  });
});

describe('beachLineAxisDeg', () => {
  // Départs étalés d'est en ouest sur 90 m.
  const { track, departures } = departuresAt([{ x: -45, y: 2 }, { x: -15, y: -3 }, { x: 15, y: 3 }, { x: 45, y: -2 }]);

  it('l\'axe de la ligne quand la zone la suit, le même que celui de la zone', () => {
    const zone = buildPeakZone(track, departures, senseTo(220), PZ)!;
    expect(zone.orientation).toBe('ligne');
    expect(beachLineAxisDeg(track, departures, senseTo(220), PZ)).toBe(zone.majorAxisDeg);
    // Nombre minimal de départs gardés, deux par défaut, comme la zone.
    expect(beachLineAxisDeg(track, departures, senseTo(220), PZ, 4)).toBe(zone.majorAxisDeg);
    expect(beachLineAxisDeg(track, departures, senseTo(220), PZ, 5)).toBeNull();
  });

  it('rien quand la zone suit la perpendiculaire au sens : ligne trop proche du sens, départs groupés, aucun départ', () => {
    expect(buildPeakZone(track, departures, senseTo(230), PZ)!.orientation).toBe('vagues');
    expect(beachLineAxisDeg(track, departures, senseTo(230), PZ)).toBeNull();
    expect(beachLineAxisDeg(track, departures, senseTo(230), { ...PZ, maxTiltDeg: 60 })).not.toBeNull();
    expect(beachLineAxisDeg(track, departures, SOUTH, { ...PZ, lineMinM: 100 })).toBeNull();
    expect(beachLineAxisDeg(track, [], SOUTH, PZ)).toBeNull();
  });
});

describe('zoneEntry', () => {
  // Deux départs à 20 m de part et d'autre de l'origine, vagues vers le sud : la zone court d'est en ouest.
  const pic = departuresAt([{ x: -20, y: 0 }, { x: 20, y: 0 }]);
  const zone: PeakZone = buildPeakZone(pic.track, pic.departures, SOUTH, PZ)!;
  /** Bord sud de la zone (côté plage), à `edge` mètres au sud des départs : atteint après `60 − edge` secondes de rame. */
  const edge = zone.semiMinorM - plane.to(zone.center).y;
  const entryS = (track: TrackPoint[], from = 0, to = track.length - 1): number | null => {
    const entry = zoneEntry(track, zone, from, to, MAX_GAP_S);
    return entry === null ? null : (entry.timeMs - T0) / 1000;
  };
  /** Rame vers le nord à 1 m/s, partie de 60 m au sud du centre, aux instants donnés. */
  const paddle = (times: number[]): TrackPoint[] => trackOf(times.map((t) => ({ t, x: 0, y: -60 + t })));
  const range = (to: number, stepS: number): number[] => Array.from({ length: Math.round(to / stepS) + 1 }, (_, k) => k * stepS);

  it('la zone : le long des départs, la marge pleine vers le large, réduite vers la plage', () => {
    expect(zone.orientation).toBe('ligne');
    expect(plane.to(zone.center).x).toBeCloseTo(0, 3);
    // Centre décalé de (15 − 5) / 2 = 5 m vers le large ; petit demi-axe de (15 + 5) / 2 = 10 m ; grand, 20 m et la marge.
    expect(plane.to(zone.center).y).toBeCloseTo((ZONE_MARGIN_M - ZONE_BEACH_MARGIN_M) / 2, 3);
    expect(zone.semiMinorM).toBeCloseTo((ZONE_MARGIN_M + ZONE_BEACH_MARGIN_M) / 2, 3);
    expect(zone.semiMajorM).toBeCloseTo(20 + ZONE_MARGIN_M, 3);
    expect(edge).toBeCloseTo(ZONE_BEACH_MARGIN_M, 3);
    // Au bout du grand axe, sur son milieu, la marge pleine au-delà du départ.
    expect(isInZone(zone, moved(pic.track[1], ZONE_MARGIN_M - 0.1, 5))).toBe(true);
    expect(isInZone(zone, moved(pic.track[1], ZONE_MARGIN_M + 0.1, 5))).toBe(false);
  });

  it('entrée au bord, interpolée sur le pas : la même à 1 Hz, à 5 Hz et sur un long pas de 8 s', () => {
    expect(entryS(paddle(range(60, 1)))).toBeCloseTo(60 - edge, 3);
    expect(entryS(paddle(range(60, 0.2)))).toBeCloseTo(60 - edge, 3);
    // Le long pas de 51 à 59 s porte le bord, franchi à 55 s.
    expect(entryS(paddle([...range(51, 1), 59, 60]))).toBeCloseTo(60 - edge, 3);
    const entry = zoneEntry(paddle(range(60, 1)), zone, 0, 60, MAX_GAP_S)!;
    expect(plane.to(entry).y).toBeCloseTo(-edge, 3);
  });

  it('un seul pas qui traverse toute la zone compte', () => {
    // De 60 m au sud à 60 m au nord en 10 s : le bord sud franchi aux (60 − edge) / 120 du pas.
    const track = trackOf([{ t: 0, x: 0, y: -60 }, { t: 10, x: 0, y: 60 }]);
    expect(entryS(track)).toBeCloseTo((10 * (60 - edge)) / 120, 3);
  });

  it('pas d\'entrée interpolée à travers un trou de la trace ou une pause', () => {
    expect(entryS(trackOf([{ t: 0, x: 0, y: -60 }, { t: 30, x: 0, y: 60 }]))).toBeNull();
    expect(entryS(trackOf([{ t: 0, x: 0, y: -60 }, { t: 30, x: 0, y: 0 }]))).toBe(30);
    expect(entryS(trackOf([{ t: 0, x: 0, y: -60 }, { t: 1, x: 0, y: -59 }, { t: 9, x: 0, y: 60, segmentStart: true }]))).toBeNull();
  });

  it('déjà dans la zone : l\'instant du départ ; à côté de la zone, ou trop tard : aucune entrée', () => {
    const track = paddle(range(60, 1));
    // À 58 s, 2 m au sud des départs : déjà dans la zone.
    expect(entryS(track, 58)).toBe(58);
    expect(entryS(track, 0, 40)).toBeNull();
    expect(entryS(trackOf(range(60, 1).map((t) => ({ t, x: -60 + 2 * t, y: -20 }))))).toBeNull();
  });
});
