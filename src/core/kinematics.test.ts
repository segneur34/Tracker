import { describe, expect, it } from 'vitest';
import {
  computeKinematics,
  detectDeviceSpeedUnit,
  detectTrackDeviceSpeedUnit,
  detourSpikes,
  distanceToSegmentM,
  haversineDistance,
  initialBearing,
  pointTimeMs,
  resumeKinematics,
  spreadEqualTimes,
  type KinematicsRun,
} from './kinematics';
import { segmentDistanceM } from './sessionStats';
import type { RawTrackPoint } from './types';

/** Construit une trace rectiligne vers l'est, à vitesse et cadence constantes. */
const buildEastwardTrack = (
  count: number,
  metersPerStep: number,
  stepSeconds: number,
  deviceSpeedMs?: number
) => {
  const startTime = Date.parse('2026-01-01T10:00:00Z');
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);

  const points: RawTrackPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat,
      lon: 3.8 + (i * metersPerStep) / metersPerDegLon,
      time: new Date(startTime + i * stepSeconds * 1000).toISOString(),
      speedMs: deviceSpeedMs,
    });
  }
  return points;
};

describe('haversineDistance', () => {
  it('renvoie zéro pour deux positions identiques', () => {
    expect(haversineDistance(43.6, 3.8, 43.6, 3.8)).toBe(0);
  });

  it('mesure un degré de latitude à environ 111 km', () => {
    const d = haversineDistance(43.0, 3.8, 44.0, 3.8);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('est symétrique', () => {
    const ab = haversineDistance(43.6, 3.8, 43.7, 3.9);
    const ba = haversineDistance(43.7, 3.9, 43.6, 3.8);
    expect(ab).toBeCloseTo(ba, 9);
  });
});

describe('initialBearing', () => {
  it('donne 0° vers le nord', () => {
    expect(initialBearing(43.6, 3.8, 43.7, 3.8)).toBeCloseTo(0, 6);
  });

  it('donne 90° vers l\'est', () => {
    expect(initialBearing(43.6, 3.8, 43.6, 3.9)).toBeCloseTo(90, 1);
  });

  it('donne 180° vers le sud', () => {
    expect(initialBearing(43.6, 3.8, 43.5, 3.8)).toBeCloseTo(180, 6);
  });

  it('reste dans l\'intervalle [0, 360[', () => {
    const bearing = initialBearing(43.6, 3.8, 43.6, 3.7);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});

describe('distanceToSegmentM', () => {
  const M_PER_DEG_LAT = 111195;
  const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((43.6 * Math.PI) / 180);
  /** Position à `east` m à l'est et `north` m au nord de (43,6 ; 3,8). */
  const at = (east: number, north: number) => ({ lat: 43.6 + north / M_PER_DEG_LAT, lon: 3.8 + east / M_PER_DEG_LON });

  it('mesure l\'écart perpendiculaire quand le pied tombe dans le segment', () => {
    expect(distanceToSegmentM(at(30, 0), at(0, -100), at(0, 100))).toBeCloseTo(30, 0);
  });

  it('mesure la distance au bout le plus proche au-delà du segment', () => {
    expect(distanceToSegmentM(at(0, 140), at(0, -100), at(0, 100))).toBeCloseTo(40, 0);
    expect(distanceToSegmentM(at(30, -140), at(0, -100), at(0, 100))).toBeCloseTo(50, 0);
  });

  it('traite un segment réduit à un point comme ce point', () => {
    expect(distanceToSegmentM(at(30, 40), at(0, 0), at(0, 0))).toBeCloseTo(50, 0);
  });
});

describe('computeKinematics', () => {
  it('renvoie une trace vide en dessous de deux points', () => {
    expect(computeKinematics([])).toEqual([]);
    expect(computeKinematics([{ lat: 43.6, lon: 3.8, time: '2026-01-01T10:00:00Z' }])).toEqual([]);
  });

  it('produit des vitesses en m/s, pas en nœuds', () => {
    // 10 m toutes les secondes, donc 10 m/s, soit environ 19,4 nœuds.
    const track = computeKinematics(buildEastwardTrack(10, 10, 1));
    expect(track[5].speedMs).toBeCloseTo(10, 2);
    expect(track[5].speedSource).toBe('derived');
  });

  it('précalcule l\'horodatage en millisecondes', () => {
    const track = computeKinematics(buildEastwardTrack(3, 10, 1));
    expect(track[1].timeMs - track[0].timeMs).toBe(1000);
  });

  it('prête au premier point la vitesse et le cap du second', () => {
    // Un zéro artificiel au départ passerait pour un démarrage aberrant, et un
    // cap nul pour un virage de 90° sur cette trace qui part vers l'est.
    const track = computeKinematics(buildEastwardTrack(5, 10, 1));
    expect(track[0].speedMs).toBeCloseTo(track[1].speedMs, 9);
    expect(track[0].bearing).toBeCloseTo(track[1].bearing, 9);
    expect(track[0].bearing).toBeCloseTo(90, 1);
  });

  it('oriente une trace vers l\'est à environ 90°', () => {
    const track = computeKinematics(buildEastwardTrack(5, 10, 1));
    expect(track[3].bearing).toBeCloseTo(90, 1);
  });

  it('met une vitesse nulle quand toute la trace partage le même horodatage, faute d\'écart où répartir les points', () => {
    const points: RawTrackPoint[] = [
      { lat: 43.6, lon: 3.8, time: '2026-01-01T10:00:00Z' },
      { lat: 43.6, lon: 3.9, time: '2026-01-01T10:00:00Z' },
    ];
    expect(computeKinematics(points)[1].speedMs).toBe(0);
  });

  it('conserve altitude, fréquence cardiaque et cadence du point brut', () => {
    const points: RawTrackPoint[] = [
      { lat: 43.6, lon: 3.8, time: '2026-01-01T10:00:00Z', ele: 12, hr: 140, cadence: 85 },
      { lat: 43.6, lon: 3.81, time: '2026-01-01T10:00:01Z', ele: 15, hr: 142, cadence: 86 },
    ];
    const track = computeKinematics(points);
    expect(track[1].ele).toBe(15);
    expect(track[1].hr).toBe(142);
    expect(track[1].cadence).toBe(86);
  });

  it('préfère la vitesse de l\'appareil quand elle existe', () => {
    // Positions à 10 m/s, mais l'appareil annonce 7 m/s : c'est lui qui gagne.
    const track = computeKinematics(buildEastwardTrack(10, 10, 1, 7));
    expect(track[5].speedMs).toBeCloseTo(7, 6);
    expect(track[5].speedSource).toBe('doppler');
  });

  it('peut forcer la dérivation depuis les positions', () => {
    const track = computeKinematics(buildEastwardTrack(10, 10, 1, 7), { forceDerivedSpeed: true });
    expect(track[5].speedMs).toBeCloseTo(10, 2);
    expect(track[5].speedSource).toBe('derived');
  });

  it('écrête un saut de position aberrant', () => {
    // Trace régulière à 5 m/s, sauf un point téléporté 500 m plus loin.
    const points = buildEastwardTrack(20, 5, 1);
    const lat = 43.6;
    const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
    points[10] = { ...points[10], lon: points[10].lon + 500 / metersPerDegLon };

    const track = computeKinematics(points);
    // Sans écrêtage, le point 10 afficherait plus de 500 m/s.
    expect(track[10].speedMs).toBeLessThan(20);
    expect(Math.max(...track.map((p) => p.smoothedSpeedMs))).toBeLessThan(20);
  });

  it('reconnaît une vitesse appareil écrite en km/h et la convertit', () => {
    // Positions à 3 m/s, appareil qui annonce 10,8, soit 3 m/s exprimés en km/h.
    const points = buildEastwardTrack(40, 3, 1, 10.8);
    expect(detectTrackDeviceSpeedUnit(points)).toBe('kmh');

    const track = computeKinematics(points);
    expect(track[20].speedMs).toBeCloseTo(3, 2);
    expect(track[20].speedSource).toBe('doppler');
  });

  it('reconnaît une vitesse appareil en m/s et la garde telle quelle', () => {
    const points = buildEastwardTrack(40, 3, 1, 3.2);
    expect(detectTrackDeviceSpeedUnit(points)).toBe('ms');
    expect(computeKinematics(points)[20].speedMs).toBeCloseTo(3.2, 6);
  });

  it('reconnaît des nœuds', () => {
    // 5 m/s valent 9,72 nœuds.
    const points = buildEastwardTrack(40, 5, 1, 9.72);
    expect(detectTrackDeviceSpeedUnit(points)).toBe('kn');
    expect(computeKinematics(points)[20].speedMs).toBeCloseTo(5, 1);
  });

  it('suppose des m/s faute d\'échantillons comparables', () => {
    expect(detectDeviceSpeedUnit([2, 2, 2], [0, 0, 0])).toBe('ms');
    expect(detectTrackDeviceSpeedUnit(buildEastwardTrack(5, 3, 1))).toBeNull();
  });

  it('donne le même lissage à 1 Hz et à 5 Hz sur la même durée', () => {
    // Même trajet, même vitesse, deux fréquences d'échantillonnage.
    const at1Hz = computeKinematics(buildEastwardTrack(30, 10, 1));
    const at5Hz = computeKinematics(buildEastwardTrack(150, 2, 0.2));

    // Milieu de trace, loin des bords : les deux doivent lire 10 m/s.
    expect(at1Hz[15].smoothedSpeedMs).toBeCloseTo(10, 1);
    expect(at5Hz[75].smoothedSpeedMs).toBeCloseTo(10, 1);
  });
});

describe('resumeKinematics', () => {
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const startTime = Date.parse('2026-01-01T10:00:00Z');

  /**
   * Trace de `seconds` s à `hz`, vitesse qui ondule, avec ce qui met chaque étape à l'épreuve : des positions qui
   * sautent (toutes les 97 s), des dates tronquées à la seconde (de 200 à 230 s), une pause et un trou de 20 s
   * (à 300 s), la vitesse Doppler sur un point sur deux si `doppler`, un point immobile répété (à 400 s).
   */
  const build = (seconds: number, hz: number, doppler: boolean): RawTrackPoint[] => {
    const points: RawTrackPoint[] = [];
    let meters = 0;
    for (let k = 0; k <= seconds * hz; k++) {
      const t = k / hz;
      const speed = 3 + 2 * Math.sin(t / 25);
      if (k > 0 && !(t >= 400 && t < 405)) meters += speed / hz;
      let lon = 3.8 + meters / metersPerDegLon;
      if (k % Math.round(97 * hz) === 0 && k > 0) lon += 40 / metersPerDegLon;
      const timeMs = startTime + (t >= 300 ? (t + 20) * 1000 : t * 1000);
      const time = new Date(t >= 200 && t < 230 ? Math.floor(timeMs / 1000) * 1000 : timeMs).toISOString();
      points.push({
        lat, lon, time,
        ...(doppler && k % 2 === 0 ? { speedMs: speed } : {}),
        ...(Math.abs(t - 300) < 1e-9 ? { segmentStart: true as const } : {}),
      });
    }
    return points;
  };
  const options = { medianWindowSeconds: 3, maxDetourRatio: 3, maxSpeedMs: 20, maxGapS: 10 };

  for (const hz of [1, 5]) {
    for (const doppler of [false, true]) {
      it(`donne la trace de computeKinematics à chaque point ajouté, à ${hz} Hz, ${doppler ? 'avec' : 'sans'} Doppler`, () => {
        const points = build(480, hz, doppler);
        let run: KinematicsRun | null = null;
        let resumed = 0;
        for (let n = 2; n <= points.length; n += n < 40 ? 1 : Math.max(1, Math.round(hz * 1.7))) {
          const prefix = points.slice(0, n);
          const next = resumeKinematics(prefix, options, run);
          expect(next).not.toBeNull();
          if (run && next!.track[0] === run.track[0] && n > 60 * hz) resumed++;
          run = next;
          expect(run!.track).toEqual(computeKinematics(prefix, options));
        }
        // La reprise a bien servi : passé le début, les premiers points sont repris tels quels.
        expect(resumed).toBeGreaterThan(50);
      });
    }
  }

  it('refait tout si les points, les réglages ou la vitesse appareil changent', () => {
    const points = build(120, 1, false);
    const run = resumeKinematics(points.slice(0, 100), options, null)!;
    const other = points.slice(0, 110).map((p) => ({ ...p }));
    expect(resumeKinematics(other, options, run)!.track).toEqual(computeKinematics(other, options));
    expect(resumeKinematics(points, { ...options, medianWindowSeconds: 5 }, run)!.track).toEqual(computeKinematics(points, { ...options, medianWindowSeconds: 5 }));
    const withDoppler = [...points.slice(0, 110), { ...points[110], speedMs: 4 }];
    expect(resumeKinematics(withDoppler, options, run)!.track).toEqual(computeKinematics(withDoppler, options));
    expect(resumeKinematics([points[0]], options, run)).toBeNull();
  });
});

describe('detourSpikes', () => {
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const metersPerDegLat = (Math.PI / 180) * 6371e3;
  const startTime = Date.parse('2026-01-01T10:00:00Z');

  /** Trace plane à partir de positions en mètres (est, nord) et d'instants en secondes. */
  const buildTrack = (steps: { x: number; y: number; t: number }[]): RawTrackPoint[] =>
    steps.map(({ x, y, t }) => ({
      lat: lat + y / metersPerDegLat,
      lon: 3.8 + x / metersPerDegLon,
      time: new Date(startTime + t * 1000).toISOString(),
    }));

  /**
   * Ligne droite à 6 m/s jusqu'à 20 s, puis arrêt (une chute), un point
   * toutes les `stepS` secondes ; à 22 s, un point déplacé de 50 m sur le côté,
   * suivi d'un trou jusqu'à 29 s : le cas de la session Komoot à 41 nd, que la
   * fenêtre de 3 s de `clampByAcceleration` laissait passer.
   */
  const spikeThenGap = (stepS = 2) => {
    const steps: { x: number; y: number; t: number }[] = [];
    for (let k = 0; k * stepS <= 20 + 1e-9; k++) steps.push({ x: 6 * k * stepS, y: 0, t: k * stepS });
    steps.push({ x: 120, y: 50, t: 22 });
    for (let k = 0; 29 + k * stepS <= 49 + 1e-9; k++) steps.push({ x: 121, y: 0, t: 29 + k * stepS });
    return buildTrack(steps);
  };

  it('écarte un point déplacé suivi d\'un trou', () => {
    const points = spikeThenGap();
    const times = points.map((p) => pointTimeMs(p.time));
    expect(detourSpikes(points, times)).toEqual([11]);
  });

  it('ramène la vitesse max à l\'allure de la trace', () => {
    const track = computeKinematics(spikeThenGap());
    const max = Math.max(...track.map((p) => p.speedMs));
    expect(max).toBeLessThan(6.5);
    // Sans le filtre, le point déplacé donne 25 m/s.
    const unfiltered = computeKinematics(spikeThenGap(), { maxDetourRatio: Infinity });
    expect(Math.max(...unfiltered.map((p) => p.speedMs))).toBeGreaterThan(20);
  });

  it('garde un demi-tour serré parcouru à vitesse constante', () => {
    // Empannage de 8 m de rayon à 8 m/s, un point toutes les 2 s, quel que
    // soit l'instant du premier point par rapport au virage.
    const radius = 8;
    const arc = Math.PI * radius;
    const along = (s: number) => {
      if (s <= 80) return { x: s, y: 0 };
      if (s <= 80 + arc) {
        const angle = (s - 80) / radius - Math.PI / 2;
        return { x: 80 + radius * Math.cos(angle), y: radius + radius * Math.sin(angle) };
      }
      return { x: 80 - (s - 80 - arc), y: 2 * radius };
    };
    for (const offset of [0, 0.5, 1, 1.5]) {
      const steps: { x: number; y: number; t: number }[] = [];
      for (let t = offset; t <= 30; t += 2) steps.push({ ...along(8 * t), t });
      const points = buildTrack(steps);
      const times = points.map((p) => pointTimeMs(p.time));
      expect(detourSpikes(points, times, 3, 2)).toEqual([]);
    }
  });

  it('n\'écarte rien à l\'arrêt, malgré le bruit de position', () => {
    const offsets = [0, 0.4, -0.3, 0.2, 0.5, -0.4, 0.1, -0.2, 0.3, 0];
    const points = buildTrack(offsets.map((o, k) => ({ x: o, y: -o, t: k })));
    const times = points.map((p) => pointTimeMs(p.time));
    expect(detourSpikes(points, times, 3, 2)).toEqual([]);
  });

  it('donne la même vitesse max à 1 Hz et à 5 Hz', () => {
    const max = (stepS: number) => Math.max(...computeKinematics(spikeThenGap(stepS)).map((p) => p.speedMs));
    expect(max(1)).toBeLessThan(6.5);
    expect(max(0.2)).toBeLessThan(6.5);
  });

  it('ne change pas une trace qui a la vitesse de l\'appareil', () => {
    const points = spikeThenGap().map((p) => ({ ...p, speedMs: 6 }));
    const track = computeKinematics(points);
    const unfiltered = computeKinematics(points, { maxDetourRatio: Infinity });
    expect(track.map((p) => [p.speedMs, p.bearing])).toEqual(unfiltered.map((p) => [p.speedMs, p.bearing]));
  });
});

/** Point brut à `eastM` mètres à l'est et `northM` au nord du départ, `s` secondes après lui. */
const T0_MS = Date.parse('2026-01-01T10:00:00Z');
const M_PER_DEG_LAT = (Math.PI / 180) * 6371e3;
const M_PER_DEG_LON_43 = M_PER_DEG_LAT * Math.cos((43.6 * Math.PI) / 180);
const pointAt = (eastM: number, s: number, northM = 0): RawTrackPoint => ({
  lat: 43.6 + northM / M_PER_DEG_LAT,
  lon: 3.8 + eastM / M_PER_DEG_LON_43,
  time: new Date(T0_MS + s * 1000).toISOString(),
});

describe('spreadEqualTimes et points d\'une même seconde (A-B5)', () => {
  it('répartit des points à 5 Hz datés à la seconde : distance et vitesse justes', () => {
    // 600 s à 5 m/s, 5 Hz, heures tronquées à la seconde, sans vitesse de l'appareil.
    const raw: RawTrackPoint[] = [];
    for (let k = 0; k <= 3000; k++) raw.push(pointAt(k, Math.floor(k / 5)));
    const track = computeKinematics(raw);
    let distanceM = 0;
    for (let i = 1; i < track.length; i++) distanceM += segmentDistanceM(track, i);
    expect(Math.abs(distanceM - 3000) / 3000).toBeLessThan(0.01);
    const smoothed = track.map((p) => p.smoothedSpeedMs).sort((a, b) => a - b);
    expect(smoothed[Math.floor(smoothed.length / 2)]).toBeCloseTo(5, 1);
  });

  it('laisse un vrai doublon (même date, même position) à sa date, son pas nul', () => {
    const raw = [0, 1, 2, 3].map((s) => pointAt(10 * s, s));
    raw.splice(2, 0, { ...raw[2] });
    const spread = spreadEqualTimes(raw, raw.map((p) => pointTimeMs(p.time)));
    expect(spread[3]).toBe(spread[2]);
    const track = computeKinematics(raw);
    expect(segmentDistanceM(track, 3)).toBe(0);
    expect(track[4].timeMs - track[3].timeMs).toBe(1000);
  });

  it('étale la dernière suite de la trace sur l\'écart qui la précède', () => {
    const raw = [pointAt(0, 0), pointAt(10, 2), pointAt(15, 2)];
    expect(spreadEqualTimes(raw, raw.map((p) => pointTimeMs(p.time)))).toEqual([T0_MS, T0_MS + 2000, T0_MS + 3000]);
  });
});

describe('computeKinematics, positions répétées et reprises', () => {
  it('garde le cap du pas précédent sur une position répétée (A-B6)', () => {
    // Trace vers l'est ; le point de la 5e seconde est répété à la 6e (arrêt sur place).
    const raw = [0, 10, 20, 30, 40, 40, 50, 60].map((m, s) => pointAt(m, s));
    for (const p of computeKinematics(raw)) expect(p.bearing).toBeCloseTo(90, 1);
    // Positions répétées dès le départ : le cap du premier pas qui avance.
    const still = [0, 0, 0, 10, 20].map((m, s) => pointAt(m, s));
    for (const p of computeKinematics(still)) expect(p.bearing).toBeCloseTo(90, 1);
  });

  it('ne prend pas un pic juste avant une reprise pour un saut de position (A-B8)', () => {
    // Vers l'est à 3 m/s ; le point de la 10e seconde saute de 200 m au nord, puis pause de 10 min.
    const raw: RawTrackPoint[] = [];
    for (let s = 0; s < 10; s++) raw.push(pointAt(3 * s, s));
    raw.push(pointAt(30, 10, 200));
    raw.push({ ...pointAt(33, 610), segmentStart: true });
    for (let s = 611; s < 620; s++) raw.push(pointAt(33 + 3 * (s - 610), s));
    const times = raw.map((p) => pointTimeMs(p.time));
    // Sans le drapeau de reprise, le point qui précède la pause passerait pour un saut.
    expect(detourSpikes(raw.map((p) => ({ lat: p.lat, lon: p.lon })), times)).toContain(10);
    expect(detourSpikes(raw, times)).not.toContain(10);
    const track = computeKinematics(raw);
    const resume = 11;
    expect(track[resume].segmentStart).toBe(true);
    // La reprise garde la vitesse et le cap du pas suivant, pas la corde de part et d'autre de la pause.
    expect(track[resume].speedMs).toBeCloseTo(3, 1);
    expect(track[resume].bearing).toBeCloseTo(90, 1);
  });

  it('donne au dernier point en reprise la vitesse et le cap du pas précédent (A-B9)', () => {
    const raw: RawTrackPoint[] = [];
    for (let s = 0; s < 20; s++) raw.push(pointAt(3 * s, s));
    raw.push({ ...pointAt(57, 620, 100), segmentStart: true });
    const track = computeKinematics(raw);
    const last = track[track.length - 1];
    expect(last.speedMs).toBeCloseTo(3, 1);
    expect(last.bearing).toBeCloseTo(90, 1);
  });

  it('ne compte aucune distance sur le pas de reprise, même avec la vitesse de l\'appareil', () => {
    const raw: RawTrackPoint[] = [];
    for (let s = 0; s < 20; s++) raw.push({ ...pointAt(3 * s, s), speedMs: 3 });
    raw.push({ ...pointAt(200, 620), speedMs: 3, segmentStart: true });
    for (let s = 621; s < 640; s++) raw.push({ ...pointAt(200 + 3 * (s - 620), s), speedMs: 3 });
    const track = computeKinematics(raw, { maxGapS: 10 });
    expect(segmentDistanceM(track, 20)).toBe(0);
    // Une reprise n'est pas un trou : la pause a déjà sa règle.
    expect(track[20].gapDistanceM).toBeUndefined();
  });
});
