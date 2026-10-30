import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import { buildCumulativeTrack, computeActivityMask } from '../core/sessionStats';
import { SPORT_PROFILES, defaultActiveThresholdOf, getActiveThresholds } from '../core/sportProfiles';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import { fromDisplaySpeed } from '../core/units';
import { summarizeSession } from '../library/summary';
import { analyzeSurf, summarizeSurf, type SurfParams } from './surfAnalysis';
import { runSurfSession, surfProfileOf } from './surfSession';
import { M_PER_DEG_LAT } from '../test/geo.fixture';

/**
 * Session de surf synthétique : une suite de phases à vitesse et cap
 * constants, positions intégrées le long du cap, vitesse de l'appareil
 * (Doppler) et cap de l'appareil sur chaque point. Le nord est le large.
 */
interface Phase {
  s: number;
  speed: number;
  heading?: number;
  /** Phase sans aucun point : le téléphone sous l'eau. */
  gap?: boolean;
}

const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);

const buildSurfSession = (phases: Phase[], cadenceS = 1): TrackPoint[] => {
  const raw: RawTrackPoint[] = [];
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const push = (speed: number, heading: number) =>
    raw.push({ lat, lon, time: new Date(T0 + t * 1000), speedMs: speed, ...(speed > 0 ? { courseDeg: heading } : {}) });
  push(0, 0);
  for (const ph of phases) {
    const heading = ph.heading ?? 0;
    const steps = Math.max(1, Math.round(ph.s / cadenceS));
    const dt = ph.s / steps;
    for (let k = 0; k < steps; k++) {
      const d = ph.speed * dt;
      lat += (d * Math.cos((heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (d * Math.sin((heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += dt;
      if (!ph.gap) push(ph.speed, heading);
    }
  }
  const profile = SPORT_PROFILES.surf;
  return computeKinematics(raw, { medianWindowSeconds: profile.medianWindowSeconds, maxSpeedMs: profile.maxPlausibleSpeedMs });
};

const surf = SPORT_PROFILES.surf.surf!;
const params: SurfParams = { ...surf, maxGapS: SPORT_PROFILES.surf.maxGapS };

/** Masque au seuil donné, en km/h, avec l'hystérésis du profil. */
const maskAt = (track: TrackPoint[], thresholdKmh: number): boolean[] => {
  const t = getActiveThresholds(SPORT_PROFILES.surf, thresholdKmh);
  return computeActivityMask(track, {
    enterThresholdMs: fromDisplaySpeed(t.enter, 'kmh'),
    exitThresholdMs: fromDisplaySpeed(t.exit, 'kmh'),
    minStateDurationS: SPORT_PROFILES.surf.minStateDurationS,
  });
};

const analyze = (track: TrackPoint[], foil = false) => {
  const cum = buildCumulativeTrack(track);
  const rideMask = maskAt(track, foil ? surf.foilActiveThreshold : SPORT_PROFILES.surf.defaultActiveThreshold);
  const waveMask = foil ? maskAt(track, surf.foilWaveThreshold) : null;
  const analysis = analyzeSurf(track, cum, rideMask, waveMask, params);
  return { analysis, summary: summarizeSurf(track, cum, analysis, params.stillMs) };
};

/**
 * Une matinée : plage, marche, sortie avec deux canards, attente, trois
 * vagues ; la troisième prise en remontant, sans attente.
 */
const MORNING: Phase[] = [
  { s: 60, speed: 0 },
  { s: 60, speed: 1.2 },
  { s: 50, speed: 1 },
  { s: 4, speed: 0.1 },
  { s: 40, speed: 1 },
  { s: 4, speed: 0.1 },
  { s: 26, speed: 1 },
  { s: 90, speed: 0.1 },
  { s: 6, speed: 1.6, heading: 180 },
  { s: 12, speed: 5, heading: 200 },
  { s: 100, speed: 1 },
  { s: 60, speed: 0.1 },
  { s: 5, speed: 1.5, heading: 180 },
  { s: 20, speed: 6, heading: 160 },
  { s: 40, speed: 1 },
  { s: 5, speed: 1.6, heading: 180 },
  { s: 8, speed: 4.5, heading: 190 },
  { s: 80, speed: 1 },
  { s: 30, speed: 0.1 },
];

describe('analyzeSurf, sans foil', () => {
  const { analysis, summary } = analyze(buildSurfSession(MORNING));

  it('trouve les trois vagues, leur durée et leur distance', () => {
    expect(analysis.waves).toHaveLength(3);
    const [a, b, c] = analysis.waves;
    expect(a.durationS).toBeCloseTo(12, -0.5);
    expect(a.distanceM).toBeCloseTo(60, -1);
    expect(b.distanceM).toBeCloseTo(120, -1);
    expect(c.distanceM).toBeCloseTo(36, -1);
    expect(b.maxSpeedMs).toBeCloseTo(6, 1);
    expect(summary.longestWaveM).toBe(b.distanceM);
    expect(summary.avgWaveDistanceM).toBeCloseTo((a.distanceM + b.distanceM + c.distanceM) / 3, 6);
  });

  it('mesure la rame de départ de chaque vague', () => {
    const [a, b] = analysis.waves;
    expect(a.takeoffS).toBeGreaterThanOrEqual(5);
    expect(a.takeoffS).toBeLessThanOrEqual(8);
    expect(a.takeoffSpeedMs).toBeGreaterThan(1.3);
    expect(b.takeoffS).toBeLessThanOrEqual(params.takeoffSearchS);
  });

  it('mesure le retour au pic, et compte la vague enchaînée à part', () => {
    const afterFirst = analysis.returns.find((r) => r.after === 1)!;
    expect(afterFirst.returnS).toBeCloseTo(100, -1);
    expect(afterFirst.straightM).toBeCloseTo(100, -1);
    expect(afterFirst.paddleSpeedMs).toBeCloseTo(1, 1);
    expect(analysis.returns.find((r) => r.after === 2)!.returnS).toBeNull();
    expect(summary.chainedCount).toBe(1);
    expect(summary.avgReturnS).toBeCloseTo(afterFirst.returnS!, 6);
  });

  it('compte la première sortie, marche comprise, sans s\'arrêter aux canards', () => {
    expect(summary.firstOutS).toBeCloseTo(60 + 120 + 8, -1);
  });

  it('répartit le temps entre glisse, rame et attente', () => {
    expect(summary.glisseS).toBeCloseTo(40, -1);
    expect(summary.attenteS).toBeGreaterThan(60 + 90 + 60 + 30 - 10);
    expect(summary.glisseS + summary.rameS + summary.attenteS + summary.trouS).toBeCloseTo(summary.totalS, 6);
    expect(summary.paddleSpeedMs).toBeGreaterThan(0.9);
    expect(summary.paddleSpeedMs).toBeLessThan(1.3);
  });
});

describe('analyzeSurf, cadence', () => {
  it('donne le même résultat à 1 Hz et à 5 Hz', () => {
    const slow = analyze(buildSurfSession(MORNING, 1)).summary;
    const fast = analyze(buildSurfSession(MORNING, 0.2)).summary;
    expect(fast.waveCount).toBe(slow.waveCount);
    expect(fast.waveDistanceM).toBeCloseTo(slow.waveDistanceM, -1);
    expect(fast.avgReturnS!).toBeCloseTo(slow.avgReturnS!, -0.5);
    expect(fast.firstOutS!).toBeCloseTo(slow.firstOutS!, -0.5);
  });

  it('garde une vague compressée en trois points (cadence de 4 s)', () => {
    const sparse = analyze(buildSurfSession(MORNING, 4));
    expect(sparse.analysis.waves).toHaveLength(3);
    expect(sparse.summary.longestWaveM).toBeCloseTo(120, -1);
  });

  it('ne compte pas un trou de la trace (téléphone sous l\'eau) comme de la glisse', () => {
    const withGap: Phase[] = [
      ...MORNING.slice(0, 14),
      { s: 25, speed: 1, gap: true },
      ...MORNING.slice(14),
    ];
    const { analysis, summary } = analyze(buildSurfSession(withGap));
    expect(analysis.waves).toHaveLength(3);
    expect(summary.trouS).toBeCloseTo(26, -0.5);
    expect(analysis.waves[1].distanceM).toBeCloseTo(120, -1);
  });
});

describe('analyzeSurf, sur foil', () => {
  /** Un vol de trois vagues reliées par du pompage, un posé, puis un vol court d'une vague. */
  const FOIL: Phase[] = [
    { s: 60, speed: 1 },
    { s: 30, speed: 0.1 },
    { s: 5, speed: 2, heading: 180 },
    { s: 15, speed: 6.5, heading: 200 },
    { s: 20, speed: 4, heading: 20 },
    { s: 15, speed: 6.5, heading: 190 },
    { s: 20, speed: 4, heading: 10 },
    { s: 10, speed: 6.5, heading: 200 },
    { s: 40, speed: 0.8 },
    { s: 30, speed: 0.1 },
    { s: 5, speed: 2, heading: 180 },
    { s: 12, speed: 6.5, heading: 200 },
    { s: 30, speed: 0.8 },
  ];
  const { analysis, summary } = analyze(buildSurfSession(FOIL), true);

  it('relie les vagues d\'un même vol, et mesure le pompage', () => {
    expect(analysis.flights).toHaveLength(2);
    const [first, second] = analysis.flights;
    expect(first.waveCount).toBe(3);
    expect(first.durationS).toBeCloseTo(80, -1);
    expect(first.pumpS).toBeGreaterThan(30);
    expect(first.pumpSpeedMs).toBeCloseTo(4, 0);
    expect(second.waveCount).toBe(1);
    expect(summary.longestFlightS).toBe(first.durationS);
    expect(summary.maxWavesInFlight).toBe(3);
    expect(summary.flightS).toBeCloseTo(first.durationS + second.durationS, 5);
  });

  it('mesure la distance en glisse, celle des pas en phase « glisse »', () => {
    const track = buildSurfSession(FOIL);
    const cum = buildCumulativeTrack(track);
    let expected = 0;
    for (let i = 1; i < track.length; i++) if (analysis.phases[i] === 'glisse') expected += cum.cumDist[i] - cum.cumDist[i - 1];
    expect(summary.glisseDistanceM).toBeCloseTo(expected, 5);
    expect(summary.glisseDistanceM).toBeGreaterThan(0);
    expect(summary.glisseDistanceM).toBeLessThan(cum.cumDist[cum.cumDist.length - 1]);
  });

  it('numérote les vagues sur toute la session, chacune avec son vol', () => {
    expect(analysis.waves.map((w) => w.flight)).toEqual([1, 1, 1, 2]);
    expect(analysis.waves.map((w) => w.n)).toEqual([1, 2, 3, 4]);
    expect(summary.waveCount).toBe(4);
  });

  it('mesure la remontée entre deux vols', () => {
    const back = analysis.returns.find((r) => r.after === 1)!;
    expect(back.returnS).toBeCloseTo(40, -1);
  });
});

describe('runSurfSession et résumé de la bibliothèque', () => {
  const profile = surfProfileOf(SPORT_PROFILES.surf)!;

  it('prend le seuil de vol par défaut sur foil, et celui de vague sinon', () => {
    expect(defaultActiveThresholdOf(SPORT_PROFILES.surf, true)).toBe(surf.foilActiveThreshold);
    expect(defaultActiveThresholdOf(SPORT_PROFILES.surf, false)).toBe(SPORT_PROFILES.surf.defaultActiveThreshold);
    // En voile, le foil ne touche pas au seuil.
    expect(defaultActiveThresholdOf(SPORT_PROFILES.wingfoil, true)).toBe(SPORT_PROFILES.wingfoil.defaultActiveThreshold);
  });

  it('donne les mêmes vagues que le découpage, seuil de vague en foil imposé compris', () => {
    const track = buildSurfSession(MORNING);
    const cum = buildCumulativeTrack(track);
    const run = runSurfSession(track, cum, profile, { threshold: SPORT_PROFILES.surf.defaultActiveThreshold, foil: false, waveThreshold: null });
    expect(run.summary).toEqual(analyze(track).summary);
    // Sur foil, un seuil de vague au-dessus de toutes les vitesses : des vols, aucune vague.
    const high = runSurfSession(track, cum, profile, { threshold: surf.foilActiveThreshold, foil: true, waveThreshold: 40 });
    expect(high.summary.waveCount).toBe(0);
    expect(high.summary.flightCount).toBeGreaterThan(0);
  });

  it('sans foil, la glisse est faite des vagues : même durée que « sur la vague » (la légende ne la redit pas)', () => {
    for (const cadenceS of [1, 0.2]) {
      const { summary } = analyze(buildSurfSession(MORNING, cadenceS));
      expect(summary.waveCount).toBeGreaterThan(0);
      expect(summary.glisseS).toBeCloseTo(summary.waveS, 6);
    }
  });

  it('résume une session de surf pour la liste : vagues, plus longue, temps sur la vague', () => {
    const raw: RawTrackPoint[] = buildSurfSession(MORNING).map((p) => ({ lat: p.lat, lon: p.lon, time: p.time, speedMs: p.speedMs }));
    const summary = summarizeSession(raw, 'surf')!;
    expect(summary.waveCount).toBe(3);
    expect(summary.longestWaveM).toBeCloseTo(120, -1);
    expect(summary.longestFlightS).toBeNull();
    expect(summary.movingTimeS).toBeCloseTo(40, -1);
    // Distance en glisse : à peu près la vitesse sur la vague fois le temps de glisse.
    expect(summary.movingDistanceM! / summary.movingTimeS!).toBeGreaterThan(3);
    expect(summary.flightS).toBeNull();
    // Sur foil : le temps total des vols.
    const foil = summarizeSession(raw, 'surf', { foil: true })!;
    expect(foil.flightS).not.toBeNull();
    expect(foil.flightS!).toBeGreaterThanOrEqual(foil.longestFlightS ?? 0);
    // Sur une autre famille, pas de champ du surf.
    expect(summarizeSession(raw, 'running')!.waveCount).toBeUndefined();
  });
});
