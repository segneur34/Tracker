import { describe, expect, it } from 'vitest';
import type { PointData } from '../utils/kinematics';
import {
  analyzeManeuvers,
  estimateWind,
  selectWindCandidate,
  windSamplesFrom,
  type WindEstimationOptions,
} from './maneuvers';
import { sessionManeuverThresholds } from './sailingConfig';
import { calculateWindStats, summarizeManeuvers } from './sailingAnalytics';
import {
  angleDiff,
  circularMean,
  describeWindCandidate,
  estimateWindFromPolar,
  estimateWindPolar,
} from './wind';

const TRACK_START_MS = Date.parse('2026-01-01T10:00:00Z');

/**
 * Trace synthétique décrite par une fonction cap(t) et une vitesse. Le cap est
 * imposé directement : ce sont les analyses, pas la kinématique, qui sont
 * testées ici.
 */
const buildTrack = (
  durationS: number,
  stepS: number,
  bearingAt: (t: number) => number,
  speedAt: number | ((t: number, bearing: number) => number) = 10
): PointData[] => {
  const points: PointData[] = [];
  for (let t = 0; t <= durationS; t += stepS) {
    const timeMs = TRACK_START_MS + Math.round(t * 1000);
    const bearing = ((bearingAt(t) % 360) + 360) % 360;
    const speed = typeof speedAt === 'function' ? speedAt(t, bearing) : speedAt;
    points.push({
      lat: 43.6,
      lon: 3.8 + t * 0.0001,
      time: new Date(timeMs).toISOString(),
      timeMs,
      speed,
      smoothedSpeed: speed,
      bearing,
    });
  }
  return points;
};

/**
 * Polaire simplifiée d'un wingfoil pour un vent venant de `windDir` : perte du
 * vol dans le cône face au vent, moyen au près, rapide au largue, lent au
 * vent arrière mais toujours en vol.
 */
const wingPolar = (twa: number): number => {
  if (twa < 35) return 3;
  if (twa < 60) return 12;
  if (twa < 110) return 18;
  if (twa < 150) return 15;
  return 10;
};

/**
 * La même polaire à l'échelle d'un support lent : 1,2 nœud dans le cône,
 * 4,8 au près, 7,2 au largue, 6 au portant, 4 au vent arrière. Sous le seuil
 * de 5 nœuds du wingfoil, une telle session est presque invisible à la
 * polaire, et tous ses empannages passent pour ratés.
 */
const slowPolar = (twa: number): number => wingPolar(twa) / 2.5;

const polarSpeed = (windDir: number | ((t: number) => number)) => (t: number, bearing: number): number => {
  const wind = typeof windDir === 'function' ? windDir(t) : windDir;
  return wingPolar(Math.abs(angleDiff(bearing, wind)));
};

/** Session qui balaie tous les caps, lentement, en dix minutes. */
const fullSweep = (t: number): number => (t * 0.6) % 360;

/**
 * Session réaliste par bords : chaque bord a un angle au vent signé (positif à
 * tribord du vent, négatif à bâbord) et une durée. Les transitions durent
 * `transitionS` et le cap y passe par l'arc court, donc par le vent pour un
 * virement et par le vent arrière pour un empannage. La vitesse suit la
 * polaire, ce qui fait chuter le virement à 3 nœuds et non l'empannage.
 */
interface Leg {
  twa: number;
  durationS: number;
}

const buildLegSession = (
  legs: Leg[],
  windAt: (t: number) => number,
  options: {
    transitionS?: number;
    stepS?: number;
    currentKn?: number;
    currentDir?: number;
    /** Polaire du support, pour fabriquer une session plus lente qu'un wingfoil. */
    polar?: (twa: number) => number;
    /**
     * Intègre la position à partir du cap et de la vitesse, au lieu de la
     * faire avancer le long d'une ligne arbitraire. Indispensable dès qu'un
     * calcul lit les positions, comme la distance d'une manœuvre. Laissé
     * optionnel pour ne pas déplacer les distances des tests écrits avant lui.
     */
    integratePosition?: boolean;
  } = {}
): PointData[] => {
  const transitionS = options.transitionS ?? 6;
  const stepS = options.stepS ?? 1;
  const polar = options.polar ?? wingPolar;
  const M_PER_DEG_LAT = 111320;
  let lat = 43.6;
  let lon = 3.8;

  // Angle au vent en fonction du temps, avec transitions linéaires.
  const twaAt = (t: number): number => {
    let elapsed = 0;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const legEnd = elapsed + leg.durationS;
      if (t < legEnd - transitionS || i === legs.length - 1) return leg.twa;
      if (t < legEnd) {
        const next = legs[i + 1].twa;
        const ratio = (t - (legEnd - transitionS)) / transitionS;
        return leg.twa + angleDiff(next, leg.twa) * ratio;
      }
      elapsed = legEnd;
    }
    return legs[legs.length - 1].twa;
  };

  const totalS = legs.reduce((a, l) => a + l.durationS, 0);
  const points: PointData[] = [];

  for (let t = 0; t <= totalS; t += stepS) {
    const wind = windAt(t);
    const twa = twaAt(t);
    const heading = ((wind + twa) % 360 + 360) % 360;
    const boatSpeed = polar(Math.abs(angleDiff(heading, wind)));

    // Le courant s'ajoute vectoriellement : cap et vitesse sur le fond.
    let bearing = heading;
    let speed = boatSpeed;
    if (options.currentKn) {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const vx = boatSpeed * Math.sin(toRad(heading)) + options.currentKn * Math.sin(toRad(options.currentDir ?? 90));
      const vy = boatSpeed * Math.cos(toRad(heading)) + options.currentKn * Math.cos(toRad(options.currentDir ?? 90));
      bearing = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
      speed = Math.sqrt(vx * vx + vy * vy);
    }

    const timeMs = TRACK_START_MS + Math.round(t * 1000);
    points.push({
      lat: options.integratePosition ? lat : 43.6,
      lon: options.integratePosition ? lon : 3.8 + t * 0.0001,
      time: new Date(timeMs).toISOString(),
      timeMs,
      speed,
      smoothedSpeed: speed,
      bearing,
    });

    if (options.integratePosition) {
      const meters = speed * 0.514444 * stepS;
      const rad = (bearing * Math.PI) / 180;
      lat += (meters * Math.cos(rad)) / M_PER_DEG_LAT;
      lon += (meters * Math.sin(rad)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    }
  }
  return points;
};

/**
 * `count` bords de près alternés (count - 1 virements), puis une abattée sur
 * le même bord, un empannage, et une remontée sur le même bord. Aucun virage
 * de 180° : chaque transition a un sens sans ambiguïté.
 */
const upwindDownwindLegs = (count: number, legDurationS = 180): Leg[] => {
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) {
    legs.push({ twa: i % 2 === 0 ? 45 : -45, durationS: legDurationS });
  }
  const side = legs[legs.length - 1].twa > 0 ? 1 : -1;
  legs.push({ twa: side * 135, durationS: legDurationS });
  legs.push({ twa: -side * 135, durationS: legDurationS });
  legs.push({ twa: -side * 45, durationS: legDurationS });
  return legs;
};

const distanceTo = (angle: number, target: number) => Math.abs(angleDiff(angle, target));

/** Cap 90° pendant 30 s, puis virage de 180° par le nord en 6 s, puis cap 270°. */
const singleTackThroughNorth = (t: number): number => {
  if (t < 30) return 90;
  if (t > 36) return 270;
  return 90 - ((t - 30) / 6) * 180;
};

/**
 * Trace d'enregistreur économique, calquée sur une trace Komoot réelle : des
 * bords échantillonnés toutes les 6 s, et un virage entier compressé dans un
 * unique intervalle, parce que l'appareil cesse de poser des points quand la
 * planche ralentit. Les caps et les vitesses reproduisent le relevé de 13:07.
 */
const buildSparseTurnTrack = (turnGapS: number): PointData[] => {
  const points: PointData[] = [];
  let t = 0;
  const push = (bearing: number, speed: number) => {
    const timeMs = TRACK_START_MS + Math.round(t * 1000);
    points.push({
      lat: 43.553 + t * 0.00001,
      lon: 4.071 + t * 0.00001,
      time: new Date(timeMs).toISOString(),
      timeMs,
      speed,
      smoothedSpeed: speed,
      bearing,
    });
  };

  // Bord au nord-ouest, puis le virage en un seul pas, puis bord au sud-est.
  for (let k = 0; k < 10; k++, t += 6) push(324, 4.7);
  t += turnGapS;
  for (let k = 0; k < 10; k++, t += 6) push(109, 3.3);
  return points;
};

/**
 * Deux bords séparés par un unique pas, avec positions réelles : c'est le
 * virage de 12:50 de la trace Komoot, entamé à 2 nœuds et long de 12 m.
 * `speedKn` pilote la vitesse d'entrée, `stepM` la distance du virage.
 */
const buildSlowTurnTrack = (speedKn: number, stepM: number): PointData[] => {
  const M_PER_DEG_LAT = 111320;
  const points: PointData[] = [];
  let lat = 43.5553;
  let t = 0;

  const push = (bearing: number, speed: number, advanceM: number) => {
    const timeMs = TRACK_START_MS + Math.round(t * 1000);
    points.push({
      lat,
      lon: 4.0720,
      time: new Date(timeMs).toISOString(),
      timeMs,
      speed,
      smoothedSpeed: speed,
      bearing,
    });
    lat += advanceM / M_PER_DEG_LAT;
  };

  // Bord vers l'ouest, le virage en un pas, puis bord vers l'est-sud-est.
  for (let k = 0; k < 6; k++, t += 10) push(282, speedKn, speedKn * 0.514444 * 10);
  t += 11;
  push(123, speedKn, stepM);
  for (let k = 0; k < 6; k++, t += 10) push(123, speedKn, speedKn * 0.514444 * 10);
  return points;
};

describe('analyzeManeuvers, seuils accordés à la session', () => {
  it('écarte un virage lent avec le seuil du wingfoil, le retient avec celui de la session', () => {
    const track = buildSlowTurnTrack(2, 12);

    // 4 nœuds à l'entrée : la valeur d'un wingfoil, que cette session
    // n'atteint jamais. Le virage est vu, mais écarté.
    const auSeuilWingfoil = analyzeManeuvers(track, 200, { successThresholdKn: 1 });
    expect(auSeuilWingfoil.locations).toHaveLength(0);
    expect(auSeuilWingfoil.rejected.slowEntry).toBeGreaterThan(0);

    // 0,7 nœud, soit la part correspondante d'une allure de 4,4 nœuds.
    const auSeuilDeLaSession = analyzeManeuvers(track, 200, {
      successThresholdKn: 1,
      minEntrySpeedKn: 0.7,
    });
    expect(auSeuilDeLaSession.locations).toHaveLength(1);
  });

  it('n\'invente pas de virage sur place, où le cap n\'est que du bruit', () => {
    // Même virage, mais trois mètres parcourus : à cette distance l'écart de
    // cap ne mesure que l'incertitude de position.
    const track = buildSlowTurnTrack(0.2, 3);
    const stats = analyzeManeuvers(track, 200, {
      successThresholdKn: 1,
      minEntrySpeedKn: 0.05,
    });

    expect(stats.locations).toHaveLength(0);
    expect(stats.rejected.tooShort).toBeGreaterThan(0);
  });
});

describe('sessionManeuverThresholds', () => {
  it('redonne les valeurs du profil sur une session rapide', () => {
    const seuils = sessionManeuverThresholds('wingfoil', 25);
    expect(seuils.minEntrySpeedKn).toBeCloseTo(4, 2);
    expect(seuils.polarMinSpeedKn).toBeCloseTo(5, 2);
  });

  it('les abaisse sur une session lente', () => {
    const seuils = sessionManeuverThresholds('windsurf', 4.4);
    expect(seuils.minEntrySpeedKn).toBeLessThan(1);
    expect(seuils.polarMinSpeedKn).toBeLessThan(1);
  });

  it('ne dépasse jamais les valeurs du profil, si rapide que soit la session', () => {
    const seuils = sessionManeuverThresholds('kite', 40);
    expect(seuils.minEntrySpeedKn).toBeCloseTo(4, 2);
    expect(seuils.polarMinSpeedKn).toBeCloseTo(5, 2);
  });

  it('s\'en remet au profil quand l\'allure est inconnue', () => {
    expect(sessionManeuverThresholds('bateau', 0)).toEqual({
      minEntrySpeedKn: 4,
      polarMinSpeedKn: 2,
    });
  });
});

describe('analyzeManeuvers, enregistrement économique', () => {
  it('lit le virage compressé dans un seul intervalle', () => {
    // Le cas réel : 22 s entre les deux bords, aucun point pendant le virement
    // puisque la planche s'était arrêtée. Vent à 23°, comme sur la trace.
    const stats = analyzeManeuvers(buildSparseTurnTrack(22), 23, { successThresholdKn: 8 });

    expect(stats.locations).toHaveLength(1);
    expect(stats.locations[0].type).toBe('tack');
  });

  it('n\'invente pas de virage à travers une vraie coupure', () => {
    // Une minute sans un point : les deux bords n'ont plus de rapport entre
    // eux, et les lire comme un virage fabriquerait une manœuvre imaginaire.
    const stats = analyzeManeuvers(buildSparseTurnTrack(60), 23, { successThresholdKn: 8 });

    expect(stats.locations).toHaveLength(0);
  });

  it('reste sans effet sur une trace dense', () => {
    // La branche ne s'arme que si la fenêtre est vide : à 1 Hz elle contient
    // douze points, et rien ne change pour les traces qui fonctionnent.
    const track = buildTrack(70, 1, singleTackThroughNorth);
    const stats = analyzeManeuvers(track, 0, { successThresholdKn: 8 });

    expect(stats.tackSuccess + stats.tackFail).toBe(1);
  });
});

describe('analyzeManeuvers', () => {
  it('compte un seul virement pour un seul virage, grâce au temps mort', () => {
    const track = buildTrack(70, 1, singleTackThroughNorth);
    const stats = analyzeManeuvers(track, 0, { successThresholdKn: 8 });

    expect(stats.tackSuccess + stats.tackFail).toBe(1);
    expect(stats.jibeSuccess + stats.jibeFail).toBe(0);
  });

  it('classe le virage en virement quand il traverse l\'axe du vent', () => {
    const track = buildTrack(70, 1, singleTackThroughNorth);
    const stats = analyzeManeuvers(track, 0, { successThresholdKn: 8 });

    expect(stats.tackSuccess).toBe(1);
    expect(stats.locations[0].type).toBe('tack');
  });

  it('classe le même virage en empannage si le vent vient du sud', () => {
    const track = buildTrack(70, 1, singleTackThroughNorth);
    const stats = analyzeManeuvers(track, 180, { successThresholdKn: 8 });

    expect(stats.jibeSuccess + stats.jibeFail).toBe(1);
    expect(stats.tackSuccess + stats.tackFail).toBe(0);
  });

  it('mesure le vent local sur les caps stabilisés, à 0° pour un virage 90° → 270°', () => {
    const track = buildTrack(70, 1, singleTackThroughNorth);
    const stats = analyzeManeuvers(track, 0);

    expect(stats.locations[0].stableHeadings).toBe(true);
    expect(distanceTo(stats.locations[0].localWind, 0)).toBeLessThanOrEqual(3);
  });

  it('donne le même décompte à 1 Hz et à 5 Hz', () => {
    const at1Hz = analyzeManeuvers(buildTrack(70, 1, singleTackThroughNorth), 0);
    const at5Hz = analyzeManeuvers(buildTrack(70, 0.2, singleTackThroughNorth), 0);

    expect(at5Hz.tackSuccess + at5Hz.tackFail).toBe(at1Hz.tackSuccess + at1Hz.tackFail);
  });

  it('juge la réussite sur le seuil injecté', () => {
    const track = buildTrack(70, 1, singleTackThroughNorth, 10);

    expect(analyzeManeuvers(track, 0, { successThresholdKn: 8 }).tackSuccess).toBe(1);
    expect(analyzeManeuvers(track, 0, { successThresholdKn: 12 }).tackFail).toBe(1);
  });

  it('ne détecte rien sur un cap constant', () => {
    const stats = analyzeManeuvers(buildTrack(60, 1, () => 90), 0);
    expect(stats.locations).toHaveLength(0);
  });

  it('compte tous les virements et empannages d\'une session par bords', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const stats = analyzeManeuvers(track, 0, { successThresholdKn: 8 });

    // 5 virements entre les 6 bords de près, puis une abattée (aucun axe
    // franchi), un empannage, une remontée (aucun axe franchi).
    expect(stats.tackSuccess + stats.tackFail).toBe(5);
    expect(stats.jibeSuccess + stats.jibeFail).toBe(1);
  });

  it('mesure la qualité d\'un virement : conservation, relance, cap, distance', () => {
    const track = buildLegSession(upwindDownwindLegs(2), () => 0);
    const stats = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const tack = stats.locations.find((m) => m.type === 'tack');

    expect(tack).toBeDefined();
    // Entrée à 12 nœuds, minimum à 3 : un quart de la vitesse conservée.
    expect(tack!.entrySpeed).toBeCloseTo(12, 1);
    expect(tack!.conservation).toBeCloseTo(0.25, 2);
    // La vitesse revient à 12 nœuds dès la sortie du cône : relance courte.
    expect(tack!.relaunchS).not.toBeNull();
    expect(tack!.relaunchS!).toBeLessThanOrEqual(6);
    // De +45° à -45° : 90° de changement de cap.
    expect(Math.abs(tack!.headingChange - 90)).toBeLessThanOrEqual(5);
    expect(tack!.distanceM).toBeGreaterThan(10);
    expect(tack!.path.length).toBeGreaterThan(2);
  });

  it('laisse la relance indéfinie quand la vitesse ne revient pas', () => {
    // Après le virage, le rider reste à 3 nœuds : jamais relancé.
    const track = buildTrack(90, 1, singleTackThroughNorth, (t) => (t < 30 ? 10 : 3));
    const stats = analyzeManeuvers(track, 0);
    expect(stats.locations).toHaveLength(1);
    expect(stats.locations[0].relaunchS).toBeNull();
  });

  it('résume les manœuvres avec moyennes et podiums', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const summary = summarizeManeuvers(analyzeManeuvers(track, 0, { successThresholdKn: 8 }));

    expect(summary.tack).not.toBeNull();
    expect(summary.tack!.count).toBe(5);
    expect(summary.tack!.averages.conservation).toBe('25 %');
    expect(summary.tack!.tops.conservation).toHaveLength(3);
    // Podium trié : la conservation la plus haute d'abord, la distance la plus courte d'abord.
    const cons = summary.tack!.tops.conservation.map((t) => t.value);
    expect(cons[0]).toBeGreaterThanOrEqual(cons[1]);
    const dist = summary.tack!.tops.distance.map((t) => t.value);
    expect(dist[0]).toBeLessThanOrEqual(dist[1]);

    expect(summary.jibe).not.toBeNull();
    expect(summary.jibe!.count).toBe(1);
    expect(summary.jibe!.tops.relaunch.length).toBeLessThanOrEqual(1);
  });

  it('mesure le vent local d\'un empannage sur ses caps stabilisés', () => {
    const track = buildLegSession(upwindDownwindLegs(2), () => 0);
    const stats = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const jibe = stats.locations.find((m) => m.type === 'jibe');

    expect(jibe).toBeDefined();
    expect(distanceTo(jibe!.localWind, 0)).toBeLessThanOrEqual(5);
  });
});

describe('estimateWind', () => {
  it('signale une faible confiance sur un aller simple', () => {
    const estimate = estimateWind(buildTrack(600, 1, () => 135));
    expect(estimate.reliable).toBe(false);
    expect(estimate.confidence).toBeLessThan(0.4);
  });

  it('retrouve le vent et son sens sur une session par bords', () => {
    const estimate = estimateWind(buildLegSession(upwindDownwindLegs(6), () => 0));

    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(8);
    expect(estimate.reliable).toBe(true);
    expect(estimate.maneuverCount).toBeGreaterThan(0);
  });

  it('n\'est pas pollué par une chute au milieu de la session', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    // Trente secondes à l'eau au tiers de la session : vitesse quasi nulle, cap aléatoire.
    const fallStart = Math.floor(track.length / 3);
    const noise = [130, 20, 250, 80, 300, 10, 200, 90, 330, 160, 40, 270, 120, 350, 60, 210, 30, 280, 150, 100, 320, 70, 240, 180, 50, 290, 140, 20, 260, 110];
    noise.forEach((b, k) => {
      track[fallStart + k] = { ...track[fallStart + k], bearing: b, speed: 0.5, smoothedSpeed: 0.5 };
    });

    const estimate = estimateWind(track);
    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(8);

    // La chute peut être comptée comme manœuvre ratée, mais elle n'a pas de
    // caps stabilisés de part et d'autre : elle ne sert jamais au vent.
    const maneuvers = analyzeManeuvers(track, estimate.direction);
    const duringFall = maneuvers.locations.filter(
      (m) => m.trackIndex >= fallStart - 15 && m.trackIndex <= fallStart + noise.length + 15
    );
    expect(duringFall.filter((m) => m.stableHeadings)).toHaveLength(0);
  });

  it('retrouve un vent d\'ouest sur une session par bords', () => {
    const estimate = estimateWind(buildLegSession(upwindDownwindLegs(6), () => 270));
    expect(distanceTo(estimate.direction, 270)).toBeLessThanOrEqual(8);
  });

  it('ne confond pas le vent et son opposé', () => {
    // C'est l'aberration observée sur une vraie session : 38° contre 176°.
    const estimate = estimateWind(buildLegSession(upwindDownwindLegs(8), () => 38));
    expect(distanceTo(estimate.direction, 38)).toBeLessThanOrEqual(8);
    expect(distanceTo(estimate.direction, 218)).toBeGreaterThan(90);
  });

  it('retrouve un vent de nord à partir de la seule polaire, sans virement', () => {
    const estimate = estimateWind(buildTrack(600, 1, fullSweep, polarSpeed(0)));
    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(10);
    expect(estimate.orientedBy).toBe('polaire');
  });

  // Protocole 1 : asymétrie du rider.
  it('reste proche du vent réel quand le rider remonte mieux sur un bord', () => {
    const legs: Leg[] = [];
    for (let i = 0; i < 8; i++) legs.push({ twa: i % 2 === 0 ? 45 : -55, durationS: 180 });
    const track = buildLegSession(legs, () => 0);

    const estimate = estimateWind(track);
    const maneuvers = analyzeManeuvers(track, estimate.direction);
    const localWinds = maneuvers.locations.map((m) => m.localWind);

    // Biais théorique de la bissectrice : 5°. On tolère le double.
    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(10);
    expect(localWinds.length).toBeGreaterThan(0);
    for (const w of localWinds) expect(distanceTo(w, 0)).toBeLessThanOrEqual(10);
  });

  // Protocole 2 : session tronquée, que du près.
  it('résiste à l\'absence totale de bords de largue', () => {
    const legs: Leg[] = [];
    for (let i = 0; i < 8; i++) legs.push({ twa: i % 2 === 0 ? 45 : -45, durationS: 150 });
    const estimate = estimateWind(buildLegSession(legs, () => 120));

    expect(distanceTo(estimate.direction, 120)).toBeLessThanOrEqual(10);
    expect(estimate.reliable).toBe(true);
  });

  // Protocole 3 : courant traversier constant.
  it('reste borné, sans diverger, sous un courant traversier de 2 nœuds', () => {
    const estimate = estimateWind(
      buildLegSession(upwindDownwindLegs(8), () => 0, { currentKn: 2, currentDir: 90 })
    );

    // Sans capteur de cap, le biais est inévitable : il doit rester modéré.
    expect(Number.isFinite(estimate.direction)).toBe(true);
    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(20);
  });
});

/** Bords de portant alternés : que des empannages, aucun virement. */
const downwindLegs = (count: number, legDurationS = 180): Leg[] => {
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) legs.push({ twa: i % 2 === 0 ? 135 : -135, durationS: legDurationS });
  return legs;
};

/** Les réglages du profil d'un support lent, un bateau : polaire à 2 nœuds, réussite à 3. */
const SLOW_SPORT: WindEstimationOptions = { minSpeedKn: 2, successThresholdKn: 3 };

describe('estimateWind, réglages du support', () => {
  it('la polaire d\'un support lent se trompe de bord au seuil du wingfoil', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0, { polar: slowPolar });

    // À 5 nœuds, seuls le largue et le portant dépassent le seuil : l'angle
    // mort trouvé est celui du vent arrière, à 180° du vrai vent.
    expect(distanceTo(estimateWindFromPolar(track, 5).direction, 0)).toBeGreaterThan(90);

    // À 2 nœuds, le seuil du profil bateau, seul le cône reste sous la barre
    // et la polaire retrouve le vent d'elle-même.
    expect(distanceTo(estimateWindFromPolar(track, 2).direction, 0)).toBeLessThanOrEqual(15);
  });

  it('compte les virages écartés, une fois chacun', () => {
    // Vent faux de 90° : chaque demi-tour devient une abattée pour le
    // classement, et disparaît sans laisser de trace au compteur près. C'est
    // le cas qui n'affichait « aucune manœuvre » sans dire pourquoi.
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const justes = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const fausses = analyzeManeuvers(track, 90, { successThresholdKn: 8 });

    // Quelques virages très ouverts restent classables — la tolérance vaut la
    // moitié du virage — mais l'essentiel s'évapore, et c'est cette évaporation
    // que le compteur rend enfin visible.
    expect(fausses.locations.length).toBeLessThan(justes.locations.length / 2);
    expect(fausses.rejected.unclassified).toBeGreaterThan(0);

    // Un virage écarté ne pose pas de temps mort : il est rencontré à chaque
    // point suivant. Sans déduplication, le compteur annoncerait des
    // centaines de rejets pour une poignée de demi-tours.
    expect(fausses.rejected.unclassified).toBeLessThanOrEqual(justes.locations.length + 2);
  });

  it('les virages redressent le bord que la polaire a manqué', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0, { polar: slowPolar });

    // Même au seuil du wingfoil, où la polaire seule part à l'opposé (test
    // précédent), l'orientation par les virages rattrape le bon bord : le vol
    // perdu se juge sur la part de vitesse conservée et non sur des nœuds, si
    // bien qu'un empannage de support lent n'est plus pris pour un virement.
    const estimate = estimateWindPolar(track, { minSpeedKn: 5 });
    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(15);
    expect(estimate.orientedBy).toBe('virages');
  });

  it('un empannage lent n\'alimente le vent qu\'au seuil de son support', () => {
    const track = buildLegSession(downwindLegs(6), () => 0, { polar: slowPolar });

    // Les empannages sont détectés dans les deux cas : c'est leur réussite,
    // donc leur droit à mesurer le vent, qui dépend du seuil.
    expect(analyzeManeuvers(track, 0, { successThresholdKn: 8 }).locations).not.toHaveLength(0);

    expect(windSamplesFrom(analyzeManeuvers(track, 0, { successThresholdKn: 8 }))).toHaveLength(0);
    expect(windSamplesFrom(analyzeManeuvers(track, 0, { successThresholdKn: 3 })).length).toBeGreaterThan(0);
  });

  it('retrouve le vent d\'un support lent avec les seuils de son profil', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0, { polar: slowPolar });
    const estimate = estimateWind(track, SLOW_SPORT);

    expect(distanceTo(estimate.direction, 0)).toBeLessThanOrEqual(15);
    expect(estimate.reliable).toBe(true);
    // L'empannage, raté au seuil du wingfoil, compte désormais parmi les mesures.
    expect(estimate.maneuverCount).toBeGreaterThan(estimateWind(track).maneuverCount);
  });

  it('sans options, reproduit exactement les valeurs du wingfoil', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    expect(estimateWind(track)).toEqual(estimateWind(track, { minSpeedKn: 5, successThresholdKn: 8 }));
  });
});

describe('selectWindCandidate', () => {
  const protocoles: [string, PointData[]][] = [
    ['wingfoil par bords', buildLegSession(upwindDownwindLegs(6), () => 0)],
    ['wingfoil vent 38', buildLegSession(upwindDownwindLegs(8), () => 38)],
    ['support lent par bords', buildLegSession(upwindDownwindLegs(6), () => 0, { polar: slowPolar })],
    ['support lent au portant', buildLegSession(downwindLegs(6), () => 0, { polar: slowPolar })],
  ];

  // Le jumeau au vent arrière est testé comme candidat sans être un maximum du
  // score polaire : il n'avait donc pas de descripteur, et la confiance
  // annoncée retombait sur celle d'une direction qui n'avait pas été retenue.
  it.each(protocoles)('annonce la confiance de la direction qu\'elle retient (%s)', (_nom, track) => {
    for (const options of [{}, SLOW_SPORT] as WindEstimationOptions[]) {
      const minSpeedKn = options.minSpeedKn ?? 5;
      const polar = estimateWindPolar(track, { minSpeedKn });
      const selection = selectWindCandidate(track, polar, options);

      if (selection.direction === polar.direction) {
        expect(selection.polarConfidence).toBe(polar.confidence);
        expect(selection.orientedBy).toBe(polar.orientedBy);
        continue;
      }

      const retenu = describeWindCandidate(track, selection.direction, minSpeedKn);
      expect(selection.orientedBy).toBe('virages');
      expect(selection.polarConfidence).toBeCloseTo(
        retenu.symmetry * retenu.coverage * retenu.clarity,
        10
      );
    }
  });

  it('retient le candidat de meilleur accord, même quand tous sont mauvais', () => {
    // Session au portant pur : aucun virement pour ancrer l'orientation, et
    // une vitesse partout sous les 5 nœuds du critère de vol perdu. Aucun
    // candidat ne peut convaincre, mais une direction doit tout de même sortir,
    // accompagnée de la confiance qui lui correspond.
    const track = buildLegSession(downwindLegs(6), () => 0, { polar: slowPolar });
    const polar = estimateWindPolar(track, { minSpeedKn: 2 });
    const selection = selectWindCandidate(track, polar, SLOW_SPORT);

    expect(Number.isFinite(selection.direction)).toBe(true);
    expect(selection.polarConfidence).toBeGreaterThanOrEqual(0);
    expect(selection.polarConfidence).toBeLessThanOrEqual(1);
  });
});

describe('calculateWindStats', () => {
  it('renvoie null avec moins de deux manœuvres', () => {
    const track = buildTrack(120, 1, fullSweep, polarSpeed(0));
    expect(calculateWindStats(track, null)).toBeNull();
    expect(calculateWindStats(track, analyzeManeuvers(track, 0))).toBeNull();
  });

  it('retient toutes les manœuvres, pas seulement celles à caps stabilisés', () => {
    // Bords de 18 s, transitions comprises : trop courts pour que `stableSegment`
    // trouve un cap stabilisé des deux côtés de chaque virage. C'est le cas qui
    // vidait la courbe, et sur lequel les tentatives d'assouplissement du §10-21
    // avaient échoué.
    const track = buildLegSession(upwindDownwindLegs(10, 18), () => 0);
    const maneuvers = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const stats = calculateWindStats(track, maneuvers, 0);

    expect(stats).not.toBeNull();
    expect(windSamplesFrom(maneuvers).length).toBeLessThan(maneuvers.locations.length);
    expect(stats!.count).toBe(maneuvers.locations.length);
    expect(stats!.stableShare).toBeLessThan(1);
  });

  it('fait davantage confiance aux manœuvres symétriques', () => {
    // Trois virements symétriques, puis quatre virages où l'on entre au largue
    // pour ressortir au près. Ces derniers sont classés virements mais leur
    // milieu est décalé de près de 40° : c'est exactement le défaut décrit sur
    // trace réelle, et à la majorité ils tirent la moyenne brute avec eux.
    const legs: Leg[] = [
      { twa: 45, durationS: 120 }, { twa: -45, durationS: 120 },
      { twa: 45, durationS: 120 }, { twa: -45, durationS: 120 },
      { twa: 120, durationS: 120 }, { twa: -45, durationS: 120 },
      { twa: 120, durationS: 120 }, { twa: -45, durationS: 120 },
    ];
    const track = buildLegSession(legs, () => 0);
    const maneuvers = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const stats = calculateWindStats(track, maneuvers, 0);

    const brute = circularMean(maneuvers.locations.map((m) => m.localWind)).mean;
    expect(distanceTo(brute, 0)).toBeGreaterThan(20);
    expect(distanceTo(stats!.avgWind, 0)).toBeLessThan(12);
  });

  it('se rabat sur la moyenne des mesures sans vent de référence', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const maneuvers = analyzeManeuvers(track, 0, { successThresholdKn: 8 });

    // Sur une session propre, l'amorce importe peu : les deux voies concordent.
    const avecReference = calculateWindStats(track, maneuvers, 0);
    const sansReference = calculateWindStats(track, maneuvers);
    expect(sansReference).not.toBeNull();
    expect(distanceTo(sansReference!.avgWind, avecReference!.avgWind)).toBeLessThanOrEqual(5);
  });

  it('ne diverge pas quand la série traverse le nord', () => {
    // Vent oscillant de ±20° autour de 0 : moyenne 0, plage 40, pas de dérive.
    const wind = (t: number) => 20 * Math.sin(t / 300);
    const track = buildLegSession(upwindDownwindLegs(14, 120), wind);
    const stats = calculateWindStats(track, analyzeManeuvers(track, 0));

    expect(stats).not.toBeNull();
    expect(distanceTo(stats!.avgWind, 0)).toBeLessThanOrEqual(10);
    expect(stats!.range).toBeLessThan(90);
    expect(stats!.range).toBeGreaterThan(20);
  });

  it('interrompt la courbe au-delà d\'un long trou sans manœuvre', () => {
    // Deux séries de bords séparées par 45 minutes de cap constant.
    const legs: Leg[] = [
      { twa: 45, durationS: 180 }, { twa: -45, durationS: 180 }, { twa: 45, durationS: 180 },
      { twa: 100, durationS: 2700 },
      { twa: 45, durationS: 180 }, { twa: -45, durationS: 180 }, { twa: 45, durationS: 180 },
    ];
    const track = buildLegSession(legs, () => 0);
    const stats = calculateWindStats(track, analyzeManeuvers(track, 0));

    expect(stats).not.toBeNull();
    expect(stats!.windAt(TRACK_START_MS + 1800 * 1000)).toBeNull();
    expect(stats!.graphData.some((p) => p.angle === null)).toBe(true);
  });

  it('marque chaque manœuvre sur la courbe, là où se trouve la mesure', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const maneuvers = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const stats = calculateWindStats(track, maneuvers, 0);

    expect(stats).not.toBeNull();

    // Un point marqué par manœuvre, et chacun près de la manœuvre qu'il marque.
    expect(stats!.graphData.filter((p) => p.isManeuver).length).toBe(maneuvers.locations.length);
    for (const m of maneuvers.locations) {
      const marked = stats!.graphData.some(
        (p) => p.isManeuver && Math.abs(track[p.index].timeMs - m.timeMs) <= 10000
      );
      expect(marked).toBe(true);
    }
  });

  // Protocole 4 : bascule de vent.
  it('voit une bascule de 60° sur les manœuvres', () => {
    const wind = (t: number) => (t < 1200 ? 0 : t < 1380 ? ((t - 1200) / 180) * 60 : 60);
    const track = buildLegSession(upwindDownwindLegs(16, 150), wind);
    const global = estimateWind(track);
    const maneuvers = analyzeManeuvers(track, global.direction);
    const stats = calculateWindStats(track, maneuvers);

    expect(stats).not.toBeNull();

    // Les vents locaux des dernières manœuvres doivent lire le nouveau vent.
    const late = maneuvers.locations.filter((m) => m.timeMs - TRACK_START_MS > 1600 * 1000);
    expect(late.length).toBeGreaterThan(0);
    for (const m of late) expect(distanceTo(m.localWind, 60)).toBeLessThanOrEqual(12);

    // La courbe finit près de 60° et a couvert la bascule.
    const end = stats!.windAt(TRACK_START_MS + 2200 * 1000);
    expect(end).not.toBeNull();
    expect(distanceTo(end!, 60)).toBeLessThanOrEqual(12);
    expect(stats!.range).toBeGreaterThanOrEqual(45);
  });
});
