import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import { kinematicsOptionsOf, referenceSpeedMs, scalesFiltersToSession } from '../core/sessionSpeed';
import { buildCumulativeTrack, computeActiveDistanceM, computeActiveTimeMs, thresholdActivityMask } from '../core/sessionStats';
import { SPORT_PROFILES, type SportProfile } from '../core/sportProfiles';
import { knotsToMs } from '../core/units';
import { cyclingEnergyParams } from '../cycling/energy';
import type { LocationFix } from '../platform/location';
import { DEFAULT_ENERGY_PARAMS, runningCostJkgM } from '../running/energy';
import { sameData } from '../test/sameData';
import { runSurfSession, surfProfileOf } from '../surfing/surfSession';
import {
  EMPTY_LIVE_STATS, LIVE_STATS_DEFAULTS, computeLiveStats, createLiveStatsMemory, heartOnlyLiveStats, liveReferenceSpeedMs, usesActiveAverage, type LiveEnergySetup,
} from './liveStats';
import { M_PER_DEG_LAT } from '../test/geo.fixture';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

/**
 * Trace vers le nord, à `hz` positions par seconde, de `startS` à `endS`, à la
 * vitesse `speedAt(t)` (m/s) et à l'altitude `eleAt(t)`. Positions et vitesse
 * Doppler cohérentes.
 */
const trace = (
  startS: number,
  endS: number,
  hz: number,
  speedAt: (t: number) => number,
  eleAt?: (t: number) => number,
  startLat = 43.5
): LocationFix[] => {
  const fixes: LocationFix[] = [];
  let lat = startLat;
  const step = 1 / hz;
  for (let t = startS; t <= endS + 1e-9; t += step) {
    if (fixes.length > 0) lat += (speedAt(t) * step) / M_PER_DEG_LAT;
    fixes.push({ timeMs: T0 + t * 1000, lat, lon: 3.9, speedMs: speedAt(t), altitudeM: eleAt?.(t) });
  }
  return fixes;
};

const running = SPORT_PROFILES.running;
const wing = SPORT_PROFILES.wingfoil;

describe('computeLiveStats', () => {
  it('rend des statistiques vides sans trace', () => {
    const stats = computeLiveStats([], running);
    expect(stats.distanceM).toBe(0);
    expect(stats.lastDistanceSpeedMs).toBeNull();
    expect(stats.recentTopsMs).toEqual([null, null]);
  });

  it('donne la FC moyenne pondérée par le temps, sans franchir les pauses', () => {
    const withHr = (fixes: LocationFix[], bpm: number) => fixes.map((f) => ({ ...f, heartRateBpm: bpm }));
    const stats = computeLiveStats([withHr(trace(0, 300, 1, () => 3), 120), withHr(trace(600, 900, 1, () => 3, undefined, 43.51), 160)], wing);
    expect(stats.averageHeartRateBpm).toBeCloseTo(140, 0);
    expect(computeLiveStats([trace(0, 300, 1, () => 3)], running).averageHeartRateBpm).toBeNull();
  });

  it('donne distance, vitesse moyenne et allure du dernier km à vitesse constante', () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 3)], running);
    expect(stats.distanceM).toBeCloseTo(1800, 0);
    expect(stats.averageSpeedMs).toBeCloseTo(3, 3);
    expect(stats.lastDistanceSpeedMs).toBeCloseTo(3, 3);
    expect(stats.currentSpeedMs).toBeCloseTo(3, 3);
  });

  it("laisse l'allure du dernier km vide tant qu'il n'est pas parcouru", () => {
    expect(computeLiveStats([trace(0, 200, 1, () => 3)], running).lastDistanceSpeedMs).toBeNull();
  });

  it('mesure le dernier km sur la fin de trace seulement', () => {
    // 500 s à 2 m/s puis 400 s à 4 m/s : les 1000 derniers mètres tiennent dans la partie à 4 m/s.
    const stats = computeLiveStats([trace(0, 900, 1, (t) => (t <= 500 ? 2 : 4))], running);
    expect(stats.lastDistanceSpeedMs).toBeCloseTo(4, 1);
  });

  it('donne le même résultat à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 3 + Math.sin(t / 30);
    const ele = (t: number) => 50 + 20 * Math.sin(t / 120);
    const a = computeLiveStats([trace(0, 1200, 1, speed, ele)], running);
    const b = computeLiveStats([trace(0, 1200, 5, speed, ele)], running);
    expect(b.distanceM).toBeCloseTo(a.distanceM, -1);
    expect(b.lastDistanceSpeedMs!).toBeCloseTo(a.lastDistanceSpeedMs!, 1);
    expect(b.elevationGainM!).toBeCloseTo(a.elevationGainM!, 0);
    expect(b.recentGainM!).toBeCloseTo(a.recentGainM!, 0);
  });

  it('ne compte ni distance ni temps pendant une pause', () => {
    const before = trace(0, 300, 1, () => 3);
    const after = trace(900, 1200, 1, () => 3, undefined, before[before.length - 1].lat);
    const stats = computeLiveStats([before, after], running);
    expect(stats.distanceM).toBeCloseTo(1800, 0);
    expect(stats.movingTimeMs).toBe(600_000);
    // Le dernier km enjambe la pause sans la compter.
    expect(stats.lastDistanceSpeedMs).toBeCloseTo(3, 2);
  });

  it('compte D+ et D−, et le D+ des 5 dernières minutes seulement', () => {
    // Montée de 60 m en 10 min, puis descente de 60 m en 10 min, puis montée de 30 m en 5 min.
    const ele = (t: number) => (t <= 600 ? t / 10 : t <= 1200 ? 60 - (t - 600) / 10 : (t - 1200) / 10);
    const stats = computeLiveStats([trace(0, 1500, 1, () => 3, ele)], running);
    expect(stats.elevationGainM!).toBeGreaterThan(80);
    expect(stats.elevationGainM!).toBeLessThan(95);
    expect(stats.elevationLossM!).toBeGreaterThan(50);
    expect(stats.recentGainM!).toBeGreaterThan(25);
    expect(stats.recentGainM!).toBeLessThan(32);
  });

  it("laisse le dénivelé vide sans altitude", () => {
    const stats = computeLiveStats([trace(0, 300, 1, () => 3)], running);
    expect(stats.elevationGainM).toBeNull();
    expect(stats.recentGainM).toBeNull();
  });

  it('prend les tops sur les 5 dernières minutes seulement', () => {
    // Pointe à 12 m/s au début, hors fenêtre ; 8 m/s pendant 20 s dans la fenêtre ; 5 m/s ailleurs.
    const speed = (t: number) => (t >= 50 && t < 80 ? 12 : t >= 700 && t < 720 ? 8 : 5);
    const stats = computeLiveStats([trace(0, 900, 1, speed)], wing);
    expect(stats.recentTopsMs[0]).toBeCloseTo(8, 0);
    expect(stats.recentTopsMs[1]).toBeCloseTo(8, 0);
  });

  it('prend la vitesse max sur toute la session, tenue 2 s, sans franchir une pause', () => {
    // Pointe à 12 m/s pendant 30 s au début, hors de la fenêtre récente : elle compte pour le max.
    const speed = (t: number) => (t >= 50 && t < 80 ? 12 : 5);
    const stats = computeLiveStats([trace(0, 900, 1, speed)], wing);
    expect(stats.maxSpeedMs).toBeCloseTo(12, 0);
    expect(stats.recentTopsMs[0]).toBeCloseTo(5, 0);
    // Deux segments à 4 m/s séparés d'une pause d'un quart d'heure : pas de vitesse fictive par-dessus la pause.
    const before = trace(0, 120, 1, () => 4);
    const after = trace(1020, 1140, 1, () => 4, undefined, before[before.length - 1].lat + 0.05);
    expect(computeLiveStats([before, after], running).maxSpeedMs).toBeCloseTo(4, 1);
    expect(computeLiveStats([], running).maxSpeedMs).toBeNull();
  });

  it('donne la même vitesse max à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 5 + 3 * Math.sin(t / 20);
    const a = computeLiveStats([trace(0, 600, 1, speed)], wing);
    const b = computeLiveStats([trace(0, 600, 5, speed)], wing);
    expect(b.maxSpeedMs!).toBeCloseTo(a.maxSpeedMs!, 1);
  });
});

describe('computeLiveStats : mémoire du direct', () => {
  const speed = (t: number) => 3 + 2 * Math.sin(t / 25) + (t >= 500 && t < 503 ? 6 : 0);
  const ele = (t: number) => 50 + 20 * Math.sin(t / 120);
  const withHr = (fixes: LocationFix[]) => fixes.map((f, k) => (k % 3 === 0 ? f : { ...f, heartRateBpm: 120 + Math.round(20 * Math.sin(k / 40)) }));
  /** Trois segments (deux pauses), chaque position étant l'objet du segment rejoué. */
  const replay = (hz: number): LocationFix[][] => {
    const a = withHr(trace(0, 400, hz, speed, ele));
    const b = withHr(trace(460, 900, hz, speed, ele, a[a.length - 1].lat));
    const c = withHr(trace(960, 1300, hz, speed, ele, b[b.length - 1].lat));
    return [a, b, c];
  };
  /** Bords de la pointe de vitesse de `replay`, en secondes : l'écrêtage de la cinématique reprise y travaille sur 3 s. */
  const SPIKE_EDGES_S = [500, 503];
  /**
   * Positions où le calcul sans mémoire contrôle le direct : les 40 premières, les trois premières et les trois
   * dernières de chaque segment (la mémoire ouvre et ferme ses segments à la position près, à toute cadence), toutes
   * celles à 2 s des bords de la pointe, une toutes les 37 s ailleurs, et la dernière.
   */
  const checkedPositions = (segments: LocationFix[][], hz: number): Set<number> => {
    const flat = segments.flat();
    const out = new Set<number>();
    flat.forEach((fix, k) => {
      const n = k + 1;
      const tS = (fix.timeMs - T0) / 1000;
      if (n <= 40 || n % (37 * hz) === 0 || n === flat.length || SPIKE_EDGES_S.some((e) => Math.abs(tS - e) <= 2 + 1e-9)) out.add(n);
    });
    let offset = 0;
    for (const segment of segments) {
      for (let k = 1; k <= 3; k++) out.add(offset + k).add(offset + segment.length + 1 - k);
      offset += segment.length;
    }
    return out;
  };
  /** Les segments tels que l'enregistreur les donne après `n` positions reçues : les fermés entiers, le dernier en cours. */
  const seenAfter = (segments: LocationFix[][], n: number): LocationFix[][] => {
    const out: LocationFix[][] = [];
    let left = n;
    for (const segment of segments) {
      if (left <= 0) break;
      out.push(segment.slice(0, Math.min(left, segment.length)));
      left -= segment.length;
    }
    return out;
  };

  for (const hz of [1, 5]) {
    it(`donne à chaque position le résultat du calcul sans mémoire, pauses, énergie et bords compris, à ${hz} Hz`, () => {
      const segments = replay(hz);
      const total = segments.reduce((n, s) => n + s.length, 0);
      const cases = [
        { profile: running, options: { ...LIVE_STATS_DEFAULTS, energy: { family: 'course' as const, params: DEFAULT_ENERGY_PARAMS, massKg: 70 } } },
        { profile: wing, options: LIVE_STATS_DEFAULTS },
      ];
      const checked = checkedPositions(segments, hz);
      for (const { profile, options } of cases) {
        // Le calcul sans mémoire refait tout : il ne contrôle que les positions retenues. Deux mémoires : l'une avance
        // toutes les 2 s de trace, au rythme du direct (`useLiveRecording`), et à chaque position retenue, donc à
        // chaque position aux bords des segments ; l'autre ne passe que toutes les 37 s, et enjambe les pauses (un
        // segment qui se ferme et le suivant qui s'ouvre dans le même appel).
        const memory = createLiveStatsMemory();
        const sparse = createLiveStatsMemory();
        for (let n = 1; n <= total; n++) {
          const isChecked = checked.has(n);
          if (!isChecked && n % (2 * hz) !== 0) continue;
          const seen = seenAfter(segments, n);
          const live = computeLiveStats(seen, profile, options, memory);
          if (!isChecked) continue;
          const whole = computeLiveStats(seen, profile, options);
          if (!sameData(live, whole)) expect(live).toEqual(whole);
          if (n % (37 * hz) !== 0 && n !== total) continue;
          const late = computeLiveStats(seen, profile, options, sparse);
          if (!sameData(late, whole)) expect(late).toEqual(whole);
        }
        const all = segments;
        expect(computeLiveStats(all, profile, options, memory)).toEqual(computeLiveStats(all, profile, options));
      }
    }, 20_000); // Le calcul sans mémoire, refait à chaque position contrôlée : plus de 2 s à 5 Hz quand toute la suite tourne.
  }

  it('repart de zéro si le profil, les réglages ou les positions changent', () => {
    const segments = replay(1);
    const memory = createLiveStatsMemory();
    computeLiveStats(seenAfter(segments, 500), running, LIVE_STATS_DEFAULTS, memory);
    expect(computeLiveStats(seenAfter(segments, 520), wing, LIVE_STATS_DEFAULTS, memory)).toEqual(computeLiveStats(seenAfter(segments, 520), wing));
    const options = { ...LIVE_STATS_DEFAULTS, lastDistanceM: 1852 };
    expect(computeLiveStats(seenAfter(segments, 540), wing, options, memory)).toEqual(computeLiveStats(seenAfter(segments, 540), wing, options));
    // Les mêmes positions recopiées : d'autres objets, tout est relu.
    const copy = seenAfter(segments, 560).map((s) => s.map((f) => ({ ...f })));
    expect(computeLiveStats(copy, wing, options, memory)).toEqual(computeLiveStats(copy, wing, options));
    // Un enregistrement plus court que le précédent.
    expect(computeLiveStats(seenAfter(segments, 100), wing, options, memory)).toEqual(computeLiveStats(seenAfter(segments, 100), wing, options));
  });
});

describe('computeLiveStats : derniers mètres, pente, vitesse ascensionnelle', () => {
  it('donne la vitesse des 300 derniers mètres', () => {
    // 800 s à 2 m/s puis 100 s à 4 m/s : les 300 derniers mètres tiennent dans la partie à 4 m/s.
    const stats = computeLiveStats([trace(0, 900, 1, (t) => (t <= 800 ? 2 : 4))], running);
    expect(stats.recentDistanceSpeedMs).toBeCloseTo(4, 1);
    expect(computeLiveStats([trace(0, 60, 1, () => 3)], running).recentDistanceSpeedMs).toBeNull();
  });

  it('donne le D+ des 300 derniers mètres et la pente du moment', () => {
    // Plat 10 min, puis rampe à 5 % (0,15 m/s à 3 m/s) pendant 5 min : 45 m, dont 15 sur les 300 derniers mètres.
    const ele = (t: number) => (t <= 600 ? 100 : 100 + 0.15 * (t - 600));
    const stats = computeLiveStats([trace(0, 900, 1, () => 3, ele)], running);
    expect(stats.recentDistanceGainM!).toBeGreaterThan(13);
    expect(stats.recentDistanceGainM!).toBeLessThan(16);
    expect(stats.currentGrade!).toBeCloseTo(0.05, 2);
  });

  it('donne la vitesse ascensionnelle sur le temps enregistré, pause exclue', () => {
    const ele = (t: number) => 0.15 * t;
    const straight = computeLiveStats([trace(0, 600, 1, () => 3, ele)], running);
    expect(straight.climbRateMh!).toBeGreaterThan(500);
    expect(straight.climbRateMh!).toBeLessThan(560);
    // Pause de 100 s dans la fenêtre de 5 min : la vitesse ascensionnelle reste celle de la marche.
    const before = trace(0, 300, 1, () => 3, ele);
    const after = trace(400, 600, 1, () => 3, ele, before[before.length - 1].lat);
    const paused = computeLiveStats([before, after], running);
    expect(paused.climbRateMh!).toBeGreaterThan(500);
    expect(paused.climbRateMh!).toBeLessThan(560);
    // Trop tôt : rien.
    expect(computeLiveStats([trace(0, 30, 1, () => 3, ele)], running).climbRateMh).toBeNull();
  });

  it("laisse pente, D+ récent et vitesse ascensionnelle vides sans altitude", () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 3)], running);
    expect(stats.recentDistanceGainM).toBeNull();
    expect(stats.currentGrade).toBeNull();
    expect(stats.climbRateMh).toBeNull();
  });
});

describe('computeLiveStats : puissance et énergie', () => {
  const noAir = { ...DEFAULT_ENERGY_PARAMS, airDragJs2M3Kg: 0 };
  const withEnergy = (energy: LiveEnergySetup) => ({ ...LIVE_STATS_DEFAULTS, energy });

  it('donne en course la puissance mécanique sur 15 s et l\'énergie de course', () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 4)], running, withEnergy({ family: 'course', params: noAir, massKg: 75 }));
    expect(stats.recentPowerW!).toBeCloseTo(4.18 * 0.25 * 4 * 75, 0);
    expect(stats.effortJ! / (4.18 * 75 * 2400)).toBeCloseTo(1, 3);
    expect(stats.energyPerKg).toBe(false);
  });

  it("compte la pente jusqu'au dernier point, sans plat fictif en bout de trace", () => {
    // Rampe à 10 % à 3 m/s : toute la fenêtre de 15 s est en montée.
    const ele = (t: number) => 0.3 * t;
    const stats = computeLiveStats([trace(0, 600, 1, () => 3, ele)], running, withEnergy({ family: 'course', params: noAir, massKg: 70 }));
    const expected = runningCostJkgM(0.1, noAir) * 0.25 * 3 * 70;
    expect(stats.recentPowerW! / expected).toBeCloseTo(1, 2);
  });

  it('donne des valeurs par kilo sans poids', () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 4)], running, withEnergy({ family: 'course', params: noAir, massKg: null }));
    expect(stats.recentPowerW!).toBeCloseTo(4.18 * 0.25 * 4, 2);
    expect(stats.energyPerKg).toBe(true);
  });

  it('donne la même puissance à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 3 + Math.sin(t / 30);
    const ele = (t: number) => 50 + 20 * Math.sin(t / 120);
    const options = withEnergy({ family: 'course', params: DEFAULT_ENERGY_PARAMS, massKg: 70 });
    const a = computeLiveStats([trace(0, 600, 1, speed, ele)], running, options);
    const b = computeLiveStats([trace(0, 600, 5, speed, ele)], running, options);
    expect(b.recentPowerW! / a.recentPowerW!).toBeCloseTo(1, 1);
    expect(b.effortJ! / a.effortJ!).toBeCloseTo(1, 2);
  });

  it('ne donne aucune puissance à vélo dans une descente raide', () => {
    const ele = (t: number) => 500 - 0.8 * t;
    const options = withEnergy({ family: 'velo', params: cyclingEnergyParams('route', 8.5, 75) });
    const stats = computeLiveStats([trace(0, 300, 1, () => 8, ele)], SPORT_PROFILES.cycling, options);
    expect(stats.recentPowerW).toBe(0);
  });

  it("ne calcule ni puissance ni énergie sans modèle d'énergie", () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 4)], running);
    expect(stats.recentPowerW).toBeNull();
    expect(stats.effortJ).toBeNull();
  });
});

describe("computeLiveStats : moyenne active, comme l'analyse (voile, surf)", () => {
  const LON_M = 111_320 * Math.cos((43.4 * Math.PI) / 180);
  /** Bord vers l'est, `dt` secondes par pas, positions intégrées ; `skip` : pas sans point (trous). */
  const leg = (fromS: number, n: number, speed: (i: number) => number, startM: number, skip: (i: number) => boolean = () => false, dt = 1) => {
    const fixes: LocationFix[] = [];
    let x = startM;
    for (let i = 0; i < n; i++) {
      x += speed(i) * dt;
      if (!skip(i)) fixes.push({ timeMs: T0 + (fromS + i * dt) * 1000, lat: 43.4, lon: 3.6 + x / LON_M, speedMs: speed(i) });
    }
    return { fixes, endM: x };
  };
  /** La chaîne de l'analyse : les segments relus d'un seul tenant, filtres accordés à l'allure, masque au même seuil. */
  const analysisTrackOf = (segments: LocationFix[][], profile: SportProfile) => {
    const raw = segments.flatMap((segment, k) => segment.map((f, i) => {
      const time = new Date(f.timeMs);
      return { lat: f.lat, lon: f.lon, time, rawTimeMs: time.getTime(), speedMs: f.speedMs, ...(k > 0 && i === 0 ? { segmentStart: true as const } : {}) };
    }));
    return computeKinematics(raw, kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs: referenceSpeedMs(raw) }));
  };
  const analysisAverage = (segments: LocationFix[][], profile: SportProfile, threshold: number): number => {
    const track = analysisTrackOf(segments, profile);
    const mask = thresholdActivityMask(track, profile, threshold);
    return computeActiveDistanceM(track, mask) / (computeActiveTimeMs(track, mask) / 1000);
  };
  const withThreshold = (activeThreshold: number) => ({ ...LIVE_STATS_DEFAULTS, activeAverage: true, activeThreshold });
  /** En dessous du seuil la moitié du temps, autour de lui le reste : dérives lentes et reprises dans la bande du seuil. */
  const drifting = (i: number) => (Math.floor(i / 300) % 2 === 0 ? 6.5 + Math.sin(i / 7) : 1.2 + 0.5 * Math.sin(i / 9));
  /** Quatre segments qui reprennent chacun dans la bande de l'hystérésis, le pire cas pour un masque refait par segment. */
  const driftingSegments = (): LocationFix[][] => {
    const segments: LocationFix[][] = [];
    let x = 0;
    for (let s = 0; s < 4; s++) {
      const part = leg(s * 1500, 1200, (i) => (i < 30 ? knotsToMs(8) : drifting(i + s * 137)), x);
      segments.push(part.fixes);
      x = part.endM + 20;
    }
    return segments;
  };

  it("est celle de l'analyse à 0,1 % près : wing, trous, pointe GPS, pause", () => {
    const a = leg(0, 2400, (i) => (i >= 1200 && i < 1203 ? 16 : 7 + Math.sin(i / 40)), 0, (i) => i % 300 > 290);
    const b = leg(3600, 1200, (i) => 6 + Math.sin(i / 50), a.endM + 30);
    const segments = [a.fixes, b.fixes];
    const live = computeLiveStats(segments, wing, withThreshold(8)).activeAverageSpeedMs!;
    expect(Math.abs(live / analysisAverage(segments, wing, 8) - 1)).toBeLessThan(0.001);
  });

  it("reste à 1,5 % de l'analyse sur des dérives et des reprises dans la bande du seuil, là où la moyenne hors pauses en est loin", () => {
    const segments = driftingSegments();
    const stats = computeLiveStats(segments, wing, withThreshold(8));
    const analysis = analysisAverage(segments, wing, 8);
    expect(Math.abs(stats.activeAverageSpeedMs! / analysis - 1)).toBeLessThan(0.015);
    expect(stats.averageSpeedMs! / analysis).toBeLessThan(0.7);
  });

  it('en surf, au seuil de vague : celle de la glisse de la page', () => {
    const wave = (i: number) => { const c = i % 200; return c < 12 ? 5 : c < 90 ? 1 : 0.1; };
    const a = leg(0, 1800, wave, 0);
    const b = leg(2000, 1800, wave, a.endM + 10);
    const surf = SPORT_PROFILES.surf;
    const segments = [a.fixes, b.fixes];
    const live = computeLiveStats(segments, surf, withThreshold(9)).activeAverageSpeedMs!;
    expect(Math.abs(live / analysisAverage(segments, surf, 9) - 1)).toBeLessThan(0.001);
    const track = analysisTrackOf(segments, surf);
    const { summary } = runSurfSession(track, buildCumulativeTrack(track), surfProfileOf(surf)!, { threshold: 9, foil: false, waveThreshold: null });
    expect(summary.waveCount).toBeGreaterThan(0);
    expect(Math.abs(live / (summary.glisseDistanceM / summary.glisseS) - 1)).toBeLessThan(0.01);
  });

  it('donne le même chiffre à 1 Hz et à 5 Hz', () => {
    const at1 = computeLiveStats([leg(0, 3600, drifting, 0).fixes], wing, withThreshold(8)).activeAverageSpeedMs!;
    const at5 = computeLiveStats([leg(0, 3600 * 5, (i) => drifting(i / 5), 0, undefined, 0.2).fixes], wing, withThreshold(8)).activeAverageSpeedMs!;
    expect(Math.abs(at5 / at1 - 1)).toBeLessThan(0.001);
  });

  it('avec la mémoire du direct comme sans elle', () => {
    const segments = driftingSegments();
    const memory = createLiveStatsMemory();
    const options = withThreshold(8);
    for (let n = 1; n <= segments.length; n++) {
      for (const share of [0.3, 0.6, 1]) {
        const seen = [...segments.slice(0, n - 1), segments[n - 1].slice(0, Math.round(segments[n - 1].length * share))];
        expect(computeLiveStats(seen, wing, options, memory).activeAverageSpeedMs).toBe(computeLiveStats(seen, wing, options).activeAverageSpeedMs);
      }
    }
  });

  it("relue après un arrêt brutal : les segments du journal redonnent le chiffre, mémoire vide", () => {
    const segments = driftingSegments();
    const memory = createLiveStatsMemory();
    const options = withThreshold(8);
    const running = computeLiveStats(segments, wing, options, memory).activeAverageSpeedMs;
    const reread = segments.map((segment) => segment.map((f) => ({ ...f })));
    expect(computeLiveStats(reread, wing, options, createLiveStatsMemory()).activeAverageSpeedMs).toBe(running);
  });

  it('un seuil qui change refait le chiffre', () => {
    const segments = driftingSegments();
    const memory = createLiveStatsMemory();
    computeLiveStats(segments, wing, withThreshold(8), memory);
    expect(computeLiveStats(segments, wing, withThreshold(3), memory).activeAverageSpeedMs).toBe(computeLiveStats(segments, wing, withThreshold(3)).activeAverageSpeedMs);
  });

  it("sans seuil passé, rien n'est calculé ; sous le seuil, pas de chiffre", () => {
    const segments = driftingSegments();
    expect(computeLiveStats(segments, wing).activeAverageSpeedMs).toBeNull();
    expect(computeLiveStats(segments, running).activeAverageSpeedMs).toBeNull();
    expect(EMPTY_LIVE_STATS.activeAverageSpeedMs).toBeNull();
    expect(computeLiveStats([leg(0, 600, () => 1, 0).fixes], wing, withThreshold(20)).activeAverageSpeedMs).toBeNull();
    // Seuil à 0 : aucun seuil réglé, les arrêts complets seuls sont ôtés, comme dans l'analyse.
    expect(computeLiveStats([leg(0, 600, () => 3, 0).fixes], wing, withThreshold(0)).activeAverageSpeedMs).toBeCloseTo(3, 1);
  });

  it('la moyenne hors pauses du temps restant ne bouge pas', () => {
    const segments = driftingSegments();
    expect(computeLiveStats(segments, wing, withThreshold(8)).averageSpeedMs).toBe(computeLiveStats(segments, wing).averageSpeedMs);
  });

  it('voile et surf seulement, et pas le bateau, sans seuil', () => {
    expect(usesActiveAverage(wing)).toBe(true);
    expect(usesActiveAverage(SPORT_PROFILES.surf)).toBe(true);
    expect(usesActiveAverage(SPORT_PROFILES.bateau)).toBe(false);
    expect(usesActiveAverage(running)).toBe(false);
    expect(usesActiveAverage(SPORT_PROFILES.cycling)).toBe(false);
  });

  it("allure de la session : le pas de reprise d'une pause n'y compte pas", () => {
    const a = leg(0, 600, () => 5, 0).fixes;
    const b = leg(1200, 600, () => 5, 3000 + 50_000).fixes;
    expect(liveReferenceSpeedMs([a, b], wing.maxGapS)).toBeCloseTo(liveReferenceSpeedMs([a], wing.maxGapS), 1);
    expect(liveReferenceSpeedMs([], wing.maxGapS)).toBe(0);
  });
});

describe('heartOnlyLiveStats (muscu, lot I du 25/10)', () => {
  it('FC moyenne pondérée par le temps et temps hors pauses, à 1 Hz comme à 5 Hz ; ni distance ni vitesse', () => {
    const T = Date.UTC(2026, 9, 28, 18, 0, 0);
    const seg = (fromS: number, toS: number, stepS: number, bpm: number) =>
      Array.from({ length: Math.round((toS - fromS) / stepS) + 1 }, (_, k) => ({ timeMs: T + (fromS + k * stepS) * 1000, heartRateBpm: bpm }));
    const params = SPORT_PROFILES.muscu.heartRate;
    const at1Hz = heartOnlyLiveStats([seg(0, 60, 1, 100), seg(120, 180, 1, 140)], params);
    const at5Hz = heartOnlyLiveStats([seg(0, 60, 0.2, 100), seg(120, 180, 0.2, 140)], params);
    expect(at1Hz.averageHeartRateBpm).toBeCloseTo(120, 6);
    expect(at5Hz.averageHeartRateBpm).toBeCloseTo(120, 6);
    expect(at1Hz.movingTimeMs).toBe(120_000);
    expect(at1Hz.distanceM).toBe(0);
    expect(at1Hz.averageSpeedMs).toBeNull();
    expect(heartOnlyLiveStats([], params).averageHeartRateBpm).toBeNull();
  });
});
