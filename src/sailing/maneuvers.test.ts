import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import type { RawTrackPoint } from '../core/types';
import { sampledIndices } from '../core/chartZoom';
import { CHART_MAX_POINTS } from '../core/displayConfig';
import { trackToPointData, type PointData } from '../utils/kinematics';
import {
  analyzeManeuvers,
  estimateWind,
  measureManeuver,
  selectWindCandidate,
  windSamplesFrom,
  type ManeuverLocation,
  type WindEstimationOptions,
} from './maneuvers';
import { sessionManeuverThresholds } from './sailingConfig';
import { calculateWindStats, summarizeManeuvers, windChartRows } from './sailingAnalytics';
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

/**
 * Manœuvre d'une session scriptée : la vitesse tombe linéairement jusqu'à
 * `conservation` × la vitesse de bord au milieu de la rotation (décalé de
 * `minLagS`), puis remonte en `recoveryS`. `slowdown` fait ralentir le rider
 * sur les secondes qui précèdent le virage, comme avant un empannage prudent.
 */
interface ScriptedManeuver {
  conservation: number;
  turnS: number;
  recoveryS: number;
  minLagS?: number;
  slowdown?: { toKn: number; overS: number };
}

/** Bruit d'une trace : erreur de position GPS corrélée, oscillation du cap, bruit Doppler. */
interface NoiseLevel {
  positionM: number;
  headingDeg: number;
  dopplerMs: number;
}

/**
 * Bruit calibré sur les traces réelles : il redonne la part de manœuvres à
 * caps stabilisés des deux côtés qu'on y observe, environ une sur cinq.
 */
const REALISTIC_NOISE: NoiseLevel = { positionM: 0.5, headingDeg: 1.5, dopplerMs: 0.15 };
/** Bruit faible, que la détection supporte aussi à 5 Hz. */
const LOW_NOISE: NoiseLevel = { positionM: 0.1, headingDeg: 0.5, dopplerMs: 0.05 };

/** Générateur pseudo-aléatoire à graine (mulberry32) : un test bruité doit rester reproductible. */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Session bruitée par bords, vent du nord : empannages entre largues à 135°,
 * ou virements entre bords de près à 45°. La position est intégrée depuis le
 * cap et la vitesse, bruitée, puis passée par `computeKinematics` comme un
 * vrai fichier : caps et vitesses retenues sortent de la chaîne réelle, filtre
 * médian compris. Rend aussi les instants vrais de chaque rotation.
 */
const buildNoisySession = (
  maneuvers: ScriptedManeuver[],
  options: { tack?: boolean; hz?: number; legKn?: number; noise?: NoiseLevel; seed?: number } = {}
): { points: PointData[]; truth: { startMs: number; endMs: number }[] } => {
  const tack = options.tack ?? false;
  const hz = options.hz ?? 1;
  const legKn = options.legKn ?? 18;
  const noise = options.noise ?? REALISTIC_NOISE;
  const legS = 40;
  const random = seededRandom(options.seed ?? 1);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };

  // Le cap passe par le lit du vent au virement (45 → −45), par le vent
  // arrière à l'empannage (135 → 225).
  const twa = tack ? 45 : 135;
  const legHeading = (k: number) => (k % 2 === 0 ? twa : tack ? -twa : 360 - twa);
  const events = maneuvers.map((m, k) => {
    const startS = legS * (k + 1) + maneuvers.slice(0, k).reduce((a, p) => a + p.turnS, 0);
    return { ...m, k, startS, endS: startS + m.turnS, apexS: startS + m.turnS / 2 + (m.minLagS ?? 0) };
  });
  const totalS = legS * (maneuvers.length + 1) + maneuvers.reduce((a, m) => a + m.turnS, 0);

  const dt = 0.02;
  const decay = (value: number, tauS: number, sigma: number) =>
    value - (value / tauS) * dt + sigma * Math.sqrt((2 * dt) / tauS) * gauss();
  let north = 0;
  let east = 0;
  let errorNorth = 0;
  let errorEast = 0;
  let wobble = 0;
  let nextSampleS = 0;
  const raw: RawTrackPoint[] = [];
  for (let s = 0; s <= totalS + 1e-9; s += dt) {
    let heading = legHeading(0);
    let speedKn = legKn;
    for (const e of events) {
      const from = legHeading(e.k);
      const to = legHeading(e.k + 1);
      if (s >= e.endS) heading = to;
      if (s >= e.startS && s < e.endS) heading = from + (to - from) * ((s - e.startS) / e.turnS);
      const minKn = legKn * e.conservation;
      const entryKn = e.slowdown ? e.slowdown.toKn : legKn;
      if (e.slowdown && s >= e.startS - e.slowdown.overS && s < e.startS) {
        speedKn = Math.min(speedKn, legKn + (entryKn - legKn) * ((s - e.startS + e.slowdown.overS) / e.slowdown.overS));
      }
      if (s >= e.startS && s < e.apexS) {
        speedKn = Math.min(speedKn, entryKn + (minKn - entryKn) * ((s - e.startS) / (e.apexS - e.startS)));
      } else if (s >= e.apexS && s < e.apexS + e.recoveryS) {
        speedKn = Math.min(speedKn, minKn + (legKn - minKn) * ((s - e.apexS) / e.recoveryS));
      }
    }
    // Erreur GPS lente (10 s), oscillation du cap plus vive (3 s).
    errorNorth = decay(errorNorth, 10, noise.positionM);
    errorEast = decay(errorEast, 10, noise.positionM);
    wobble = decay(wobble, 3, noise.headingDeg);
    const rad = ((heading + wobble) * Math.PI) / 180;
    const speedMs = speedKn * 0.514444;
    north += speedMs * Math.cos(rad) * dt;
    east += speedMs * Math.sin(rad) * dt;
    if (s >= nextSampleS - 1e-9) {
      raw.push({
        lat: 43.5 + (north + errorNorth) / 111320,
        lon: 3.8 + (east + errorEast) / (111320 * Math.cos((43.5 * Math.PI) / 180)),
        time: new Date(TRACK_START_MS + Math.round(s * 1000)).toISOString(),
        speedMs: Math.max(0, speedMs + noise.dopplerMs * gauss()),
      });
      nextSampleS += 1 / hz;
    }
  }
  return {
    points: trackToPointData(computeKinematics(raw, { medianWindowSeconds: 3 })),
    truth: events.map((e) => ({ startMs: TRACK_START_MS + e.startS * 1000, endMs: TRACK_START_MS + e.endS * 1000 })),
  };
};

/** Qualités d'empannage et de virement, de la meilleure à la moins bonne. */
const GOOD_JIBES: ScriptedManeuver[] = [
  { conservation: 0.85, turnS: 5, recoveryS: 3 },
  { conservation: 0.65, turnS: 5, recoveryS: 6 },
  { conservation: 0.5, turnS: 6, recoveryS: 9 },
];
const GOOD_TACKS: ScriptedManeuver[] = [
  { conservation: 0.6, turnS: 4, recoveryS: 3 },
  { conservation: 0.4, turnS: 5, recoveryS: 6 },
  { conservation: 0.25, turnS: 6, recoveryS: 10 },
];

/**
 * Un virement sans bruit, cap et vitesse imposés (donc sans filtre médian) :
 * près à 45° jusqu'à 40 s, rotation jusqu'à −45° en 4 s, et une vitesse qui
 * touche le fond, 4,5 nœuds, `minLagS` secondes après le milieu de la
 * rotation. Rend aussi l'instant de ce creux.
 */
const scriptedTack = (minLagS: number) => {
  const apexS = 42 + minLagS;
  const track = buildTrack(
    100,
    1,
    (t) => (t < 40 ? 45 : t < 44 ? 45 - ((t - 40) / 4) * 90 : -45),
    (t) => {
      const dip = t < apexS ? 15 - (10.5 * Math.max(0, t - 38)) / (apexS - 38) : 4.5 + (10.5 * (t - apexS)) / 6;
      return Math.min(15, dip);
    }
  );
  return { track, apexMs: TRACK_START_MS + apexS * 1000 };
};

/** Manœuvre factice, pour éprouver le résumé sans passer par la détection. */
const fakeManeuver = (overrides: Partial<ManeuverLocation>): ManeuverLocation => ({
  lat: 43.6,
  lon: 3.8,
  type: 'jibe',
  success: true,
  vmin: 12,
  localWind: 0,
  timeMs: TRACK_START_MS,
  trackIndex: 0,
  stableHeadings: false,
  windCriteria: { conservation: 0.7, success: true },
  entrySpeed: 18,
  conservation: 0.7,
  relaunchS: 3,
  headingChange: 90,
  distanceM: 60,
  windwardGainM: 20,
  apexIndex: 0,
  entryIndex: 0,
  exitIndex: 0,
  entryHeading: 135,
  exitHeading: 225,
  path: [],
  ...overrides,
});

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
    // Virement tombé à 3 nœuds, raté au seuil de 8 : pas de gain au vent.
    expect(tack!.success).toBe(false);
    expect(tack!.windwardGainM).toBeNull();
  });

  it('mesure le gain au vent des manœuvres réussies dans leur sens : vers le vent en virement, sous le vent en empannage, indépendant de la cadence', () => {
    const at1Hz = analyzeManeuvers(buildLegSession(upwindDownwindLegs(2), () => 0), 0, { successThresholdKn: 2 }).locations;
    const at5Hz = analyzeManeuvers(buildLegSession(upwindDownwindLegs(2), () => 0, { stepS: 0.2 }), 0, { successThresholdKn: 2 }).locations;

    for (const type of ['tack', 'jibe'] as const) {
      const at1 = at1Hz.find((m) => m.type === type)!;
      const at5 = at5Hz.find((m) => m.type === type)!;
      // Face au vent pendant le virement, dos au vent pendant l'empannage :
      // chacun avance dans son sens, sur une part du chemin parcouru.
      expect(at1.success).toBe(true);
      expect(at1.windwardGainM!).toBeGreaterThan(0);
      expect(at1.windwardGainM!).toBeLessThan(at1.distanceM!);
      expect(Math.abs(at5.windwardGainM! - at1.windwardGainM!)).toBeLessThanOrEqual(0.2 * at1.windwardGainM!);
    }
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
    // Gain au vent : réussies seulement (ici, aucun virement), puis le plus grand d'abord, affiché signé.
    expect(summary.tack!.tops.windwardGain).toHaveLength(0);
    expect(summary.tack!.averages.windwardGain).toBe('-');
    const reussies = summarizeManeuvers(analyzeManeuvers(track, 0, { successThresholdKn: 2 }));
    const gain = reussies.tack!.tops.windwardGain.map((t) => t.value);
    expect(gain).toHaveLength(3);
    expect(gain[0]).toBeGreaterThanOrEqual(gain[1]);
    expect(reussies.tack!.averages.windwardGain).toMatch(/^\+\d+ m$/);
    // Un empannage avance sous le vent : son gain est positif lui aussi.
    expect(reussies.jibe!.averages.windwardGain).toMatch(/^\+\d+ m$/);
    // Le cap de sortie d'un empannage est un choix d'allure : moyenne, pas de podium.
    expect(summary.tack!.tops.headingChange.length).toBeGreaterThan(0);
    expect(summary.jibe!.tops.headingChange).toHaveLength(0);
    expect(summary.jibe!.averages.headingChange).not.toBe('-');

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

describe('measureManeuver', () => {
  const at = (points: PointData[], index: number) => points[index].timeMs;
  const nearestTruth = (truth: { startMs: number; endMs: number }[], timeMs: number) =>
    truth.reduce((best, t) => (Math.abs(t.startMs - timeMs) < Math.abs(best.startMs - timeMs) ? t : best));

  it('borne la manœuvre au virage lui-même, malgré le bruit de la trace', () => {
    // La détection se déclenche plusieurs secondes avant le virage : ses
    // bornes faisaient commencer la manœuvre 5 s trop tôt en médiane.
    for (const tack of [false, true]) {
      for (const seed of [1, 2, 3]) {
        const { points, truth } = buildNoisySession(tack ? GOOD_TACKS : GOOD_JIBES, { tack, legKn: tack ? 15 : 18, seed });
        const found = analyzeManeuvers(points, 0, { successThresholdKn: 2 }).locations;
        expect(found).toHaveLength(3);
        for (const m of found) {
          expect(m.type).toBe(tack ? 'tack' : 'jibe');
          const t = nearestTruth(truth, at(points, m.entryIndex));
          expect(Math.abs(at(points, m.entryIndex) - t.startMs)).toBeLessThanOrEqual(2000);
          // La sortie ne tombe jamais avant la fin de la rotation.
          expect(at(points, m.exitIndex)).toBeGreaterThanOrEqual(t.endMs - 2000);
        }
      }
    }
  });

  it('garde les mêmes bornes où que la détection se soit déclenchée', () => {
    const { track } = scriptedTack(0);
    const bounds = new Set<string>();
    for (const triggerS of [30, 34, 38]) {
      for (const endS of [43, 44, 45]) {
        const m = measureManeuver(track, { triggerIndex: triggerS, endIndex: endS, turnSign: -1, type: 'tack' }, 0);
        bounds.add(`${m.rotationStartIndex}-${m.rotationEndIndex}`);
      }
    }
    expect(bounds.size).toBe(1);
  });

  it('classe les manœuvres comme leur qualité, en conservation comme en relance', () => {
    for (const tack of [false, true]) {
      for (const seed of [1, 2, 3]) {
        const { points } = buildNoisySession(tack ? GOOD_TACKS : GOOD_JIBES, { tack, legKn: tack ? 15 : 18, seed });
        const stats = analyzeManeuvers(points, 0, { successThresholdKn: 2 });
        // Dans l'ordre du temps : la meilleure, la moyenne, la moins bonne.
        const [good, medium, poor] = stats.locations;
        expect(good.conservation).toBeGreaterThan(medium.conservation);
        expect(medium.conservation).toBeGreaterThan(poor.conservation);
        expect(good.relaunchS!).toBeLessThan(medium.relaunchS!);
        expect(medium.relaunchS!).toBeLessThan(poor.relaunchS!);

        const summary = summarizeManeuvers(stats)[tack ? 'tack' : 'jibe']!;
        expect(summary.tops.conservation.map((t) => t.index)).toEqual([0, 1, 2]);
        expect(summary.tops.relaunch.map((t) => t.index)).toEqual([0, 1, 2]);
      }
    }
  });

  it('lit la vitesse d\'approche avant la rotation : ralentir avant d\'empanner n\'en fait pas un sans-faute', () => {
    // Le cas relevé sur une séance réelle : 21 nœuds au largue, 12 au début
    // du virage. Lue au premier point de la rotation, la vitesse d'entrée
    // donnait 100 % de conservation, une relance de 0 s et une distance nulle.
    const { points } = buildNoisySession(
      [{ conservation: 12 / 18, turnS: 6, recoveryS: 8, slowdown: { toKn: 12, overS: 6 } }],
      { seed: 3 }
    );
    const jibe = analyzeManeuvers(points, 0, { successThresholdKn: 2 }).locations.find((m) => m.type === 'jibe')!;

    expect(Math.abs(jibe.entrySpeed - 18)).toBeLessThanOrEqual(1);
    expect(jibe.conservation).toBeLessThan(0.75);
    expect(jibe.relaunchS!).toBeGreaterThan(3);
    expect(jibe.distanceM!).toBeGreaterThan(20);
  });

  it('trouve le creux de vitesse où qu\'il tombe, jusqu\'après la rotation', () => {
    // Pendant la rotation, à sa fin, ou quelques secondes après : le creux
    // d'un virement vient souvent une fois le nouveau cap pris. La détection
    // ne le cherchait pas après la rotation et sautait le dernier point de sa
    // fenêtre initiale.
    for (const minLagS of [-1, 0, 2, 4, 8]) {
      const { track, apexMs } = scriptedTack(minLagS);
      const tack = analyzeManeuvers(track, 0, { successThresholdKn: 2 }).locations.find((m) => m.type === 'tack')!;

      expect(tack.vmin).toBeCloseTo(4.5, 6);
      expect(track[tack.apexIndex].timeMs).toBe(apexMs);
      expect(tack.conservation).toBeCloseTo(0.3, 6);
      expect(tack.relaunchS!).toBeGreaterThan(0);
    }
  });

  it('mesure le gain au vent dans le sens de la manœuvre, plus grand pour la plus rapide', () => {
    // Même durée de rotation : seule la vitesse conservée les distingue.
    for (const tack of [false, true]) {
      const fast = { conservation: tack ? 0.6 : 0.85, turnS: 5, recoveryS: 3 };
      const slow = { conservation: tack ? 0.3 : 0.5, turnS: 5, recoveryS: 8 };
      const { points } = buildNoisySession([fast, slow], { tack, legKn: tack ? 15 : 18, noise: LOW_NOISE });
      const [first, second] = analyzeManeuvers(points, 0, { successThresholdKn: 2 }).locations;

      expect(second.windwardGainM!).toBeGreaterThan(0);
      expect(first.windwardGainM!).toBeGreaterThan(second.windwardGainM!);
    }
  });

  it('donne les mêmes mesures à 1 Hz et à 5 Hz', () => {
    // À bruit faible : au-delà, c'est la détection qui ne voit plus les
    // virages à 5 Hz, un défaut connu qui ne relève pas de la mesure.
    for (const tack of [false, true]) {
      for (const seed of [1, 2, 3]) {
        const options = { tack, legKn: tack ? 15 : 18, noise: LOW_NOISE, seed };
        const at1Hz = analyzeManeuvers(buildNoisySession(tack ? GOOD_TACKS : GOOD_JIBES, options).points, 0, { successThresholdKn: 2 }).locations;
        const at5Hz = analyzeManeuvers(buildNoisySession(tack ? GOOD_TACKS : GOOD_JIBES, { ...options, hz: 5 }).points, 0, { successThresholdKn: 2 }).locations;

        expect(at5Hz).toHaveLength(at1Hz.length);
        at1Hz.forEach((a, k) => {
          const b = at5Hz[k];
          expect(Math.abs(a.conservation - b.conservation)).toBeLessThanOrEqual(0.05);
          expect(Math.abs(a.relaunchS! - b.relaunchS!)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(a.headingChange - b.headingChange)).toBeLessThanOrEqual(3);
          expect(Math.abs(a.windwardGainM! - b.windwardGainM!)).toBeLessThanOrEqual(3);
        });
      }
    }
  });
});

describe('summarizeManeuvers', () => {
  it('départage les égalités par la conservation, puis la conservation par la relance', () => {
    const stats = {
      tackSuccess: 0,
      tackFail: 0,
      jibeSuccess: 4,
      jibeFail: 0,
      rejected: { slowEntry: 0, incoherent: 0, unclassified: 0, tooShort: 0 },
      locations: [
        fakeManeuver({ timeMs: TRACK_START_MS, relaunchS: 2, conservation: 0.6 }),
        fakeManeuver({ timeMs: TRACK_START_MS + 60000, relaunchS: 2, conservation: 0.8 }),
        fakeManeuver({ timeMs: TRACK_START_MS + 120000, relaunchS: 4, conservation: 0.8 }),
        fakeManeuver({ timeMs: TRACK_START_MS + 180000, relaunchS: null, conservation: 0.8 }),
      ],
    };
    const jibe = summarizeManeuvers(stats).jibe!;

    // Même relance de 2 s : la meilleure conservation passe devant la plus ancienne.
    expect(jibe.tops.relaunch.map((t) => t.index)).toEqual([1, 0, 2]);
    // Même conservation de 80 % : la relance la plus courte d'abord, sans relance en dernier.
    expect(jibe.tops.conservation.map((t) => t.index)).toEqual([1, 2, 3]);
  });

  it('compte à part les manœuvres sans relance, absentes de la moyenne', () => {
    const stats = {
      tackSuccess: 0,
      tackFail: 0,
      jibeSuccess: 3,
      jibeFail: 0,
      rejected: { slowEntry: 0, incoherent: 0, unclassified: 0, tooShort: 0 },
      locations: [
        fakeManeuver({ relaunchS: 2 }),
        fakeManeuver({ relaunchS: 4 }),
        fakeManeuver({ relaunchS: null, distanceM: null }),
      ],
    };
    const jibe = summarizeManeuvers(stats).jibe!;

    expect(jibe.withoutRelaunch).toBe(1);
    expect(jibe.averages.relaunch).toBe('3.0 s');
    // Sans relance, pas de distance de manœuvre : elle ne gagne pas le podium des plus courtes.
    expect(jibe.tops.distance).toHaveLength(2);
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

  it('ne dépend pas de la mesure affichée des manœuvres', () => {
    // La trace du banc de test (outils/banc/make-gpx.mjs) : bords de près et
    // de portant, virements qui tombent de 7 à 3 m/s. La détection lit leur
    // conservation à 49 %, la mesure affichée à 51 %, de l'autre côté du
    // seuil de 50 % qui oriente le vent. Lue sur la mesure affichée, elle
    // faisait tourner l'estimation de 90° et ne laissait qu'une manœuvre.
    const start = Date.UTC(2026, 8, 20, 13, 0, 0);
    const raw: RawTrackPoint[] = [];
    let lat = 43.5;
    let lon = 3.95;
    const step = (heading: number, speedMs: number) => {
      const rad = (heading * Math.PI) / 180;
      lat += (speedMs * Math.cos(rad)) / 6371000 * (180 / Math.PI);
      lon += (speedMs * Math.sin(rad)) / (6371000 * Math.cos((lat * Math.PI) / 180)) * (180 / Math.PI);
      raw.push({ lat, lon, time: new Date(start + raw.length * 1000).toISOString(), speedMs });
    };
    const leg = (heading: number, speedMs: number, count: number) => {
      for (let i = 0; i < count; i++) step(heading + Math.sin(i / 7) * 3, speedMs + Math.sin(i / 5) * 0.5);
    };
    const turn = (from: number, to: number, minMs: number, maxMs: number, count: number) => {
      const diff = ((to - from + 540) % 360) - 180;
      for (let i = 1; i <= count; i++) {
        step((from + (diff * i) / count + 360) % 360, maxMs - (maxMs - minMs) * Math.sin((Math.PI * i) / count));
      }
    };
    for (let k = 0; k < 6; k++) { leg(45, 7, 150); turn(45, 315, 3, 7, 6); leg(315, 7, 150); turn(315, 45, 3, 7, 6); }
    turn(45, 135, 6, 9, 5);
    for (let k = 0; k < 6; k++) { leg(135, 9, 150); turn(135, 225, 6, 9, 6); leg(225, 9, 150); turn(225, 135, 6, 9, 6); }
    const track = trackToPointData(computeKinematics(raw, { medianWindowSeconds: 3 }));

    const tacks = analyzeManeuvers(track, 0).locations.filter((m) => m.type === 'tack');
    expect(tacks.length).toBeGreaterThan(0);
    for (const m of tacks) {
      expect(m.windCriteria.conservation).toBeLessThan(0.5);
      expect(m.conservation).toBeGreaterThan(0.5);
    }
    expect(distanceTo(estimateWind(track).direction, 0)).toBeLessThanOrEqual(8);
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
    expect(windChartRows(track, stats!, sampledIndices(0, track.length - 1, CHART_MAX_POINTS)).some((p) => p.angle === null)).toBe(true);
  });

  it('marque chaque manœuvre sur la courbe, là où se trouve la mesure', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const maneuvers = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const stats = calculateWindStats(track, maneuvers, 0);

    expect(stats).not.toBeNull();

    // Un point marqué par manœuvre, et chacun près de la manœuvre qu'il marque.
    const rows = windChartRows(track, stats!, sampledIndices(0, track.length - 1, CHART_MAX_POINTS));
    expect(rows.filter((p) => p.isManeuver).length).toBe(maneuvers.locations.length);
    for (const m of maneuvers.locations) {
      const marked = rows.some((p) => p.isManeuver && Math.abs(track[p.index].timeMs - m.timeMs) <= 10000);
      expect(marked).toBe(true);
    }
  });

  it('ne marque, zoomé, que les manœuvres de la plage visible', () => {
    const track = buildLegSession(upwindDownwindLegs(6), () => 0);
    const maneuvers = analyzeManeuvers(track, 0, { successThresholdKn: 8 });
    const stats = calculateWindStats(track, maneuvers, 0);
    expect(stats).not.toBeNull();

    // Première moitié de la trace, à 50 lignes : seules ses manœuvres sont marquées.
    const last = Math.floor(track.length / 2);
    const rows = windChartRows(track, stats!, sampledIndices(0, last, 50));
    const inside = maneuvers.locations.filter((m) => m.trackIndex <= last).length;
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(maneuvers.locations.length);
    expect(rows.filter((p) => p.isManeuver).length).toBe(inside);
    expect(rows[0].minutes).toBe(0);
    // Angle tracé autour de la référence : jamais déroulé de plus d'un demi-tour.
    for (const row of rows) if (row.angle !== null) expect(Math.abs(row.angle - stats!.referenceDeg)).toBeLessThanOrEqual(180);
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
