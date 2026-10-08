import { describe, expect, it } from 'vitest';
import { IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, decodeImu, encodeImu, selectImuWindows, type ImuHeader, type ImuRecording } from './imuFile';
import { pruneImuFile } from './imuPrune';
import { measureJumps, pruneWindows, type MeasuredJump } from './jumps';
import { SPORT_PROFILES } from './sportProfiles';

const G = 9.80665;
const D = SPORT_PROFILES.wingfoil.jumps!.detection;
const WALL_MS = 1_791_465_895_000;

/**
 * Mouvement synthétique du téléphone : accélération verticale et force
 * horizontale (portance, traction de l'aile) dans le repère du monde, et
 * inclinaison θ autour de l'axe x du téléphone. Le téléphone mesure
 * f = Rx(−θ)·(0, ay, az + g) et ω = (θ', 0, 0).
 */
interface Motion {
  durationS: number;
  rateHz?: number;
  az: (t: number) => number;
  ay?: (t: number) => number;
  tilt?: (t: number) => number;
  /** Bruit de l'accéléromètre, écart type approché, en m/s². */
  noise?: number;
  /** Biais de l'accéléromètre sur chaque axe, en m/s². */
  bias?: number;
  /** Erreur d'échelle de l'accéléromètre (0,01 : +1 %). */
  scale?: number;
  /** Dérive du gyroscope, en rad/s. */
  gyroDrift?: number;
  /** Trous de la capture, en secondes. */
  gaps?: [number, number][];
  /** Plage de l'accéléromètre, en m/s² : les axes y sont bornés. */
  accelRange?: number;
}

/** Bruit pseudo-aléatoire reproductible, centré, d'amplitude 1. */
const noiseSource = (seed: number) => {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (x / 2_147_483_648) * 2 - 1;
  };
};

const record = (m: Motion): ImuRecording => {
  const rate = m.rateHz ?? 100;
  const n = Math.round(m.durationS * rate);
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (!(m.gaps ?? []).some(([a, b]) => t >= a && t < b)) times.push(t);
  }
  const rand = noiseSource(42);
  const tilt = m.tilt ?? (() => Math.PI / 6);
  const range = m.accelRange ?? Infinity;
  const ax: number[] = [];
  const ay: number[] = [];
  const az: number[] = [];
  const gx: number[] = [];
  const gy: number[] = [];
  const gz: number[] = [];
  for (const t of times) {
    const th = tilt(t);
    const h = m.ay?.(t) ?? 0;
    const v = m.az(t) + G;
    const k = 1 + (m.scale ?? 0);
    const noise = () => (m.noise ?? 0.05) * rand() * Math.sqrt(3);
    const clamp = (x: number) => Math.max(-range, Math.min(range, x));
    ax.push(clamp((m.bias ?? 0) + noise()));
    ay.push(clamp(k * (Math.cos(th) * h + Math.sin(th) * v) + (m.bias ?? 0) + noise()));
    az.push(clamp(k * (-Math.sin(th) * h + Math.cos(th) * v) + (m.bias ?? 0) + noise()));
    const rate1 = (tilt(t + 0.0005) - tilt(t - 0.0005)) / 0.001;
    gx.push(rate1 + (m.gyroDrift ?? 0) + 0.002 * rand());
    gy.push((m.gyroDrift ?? 0) + 0.002 * rand());
    gz.push(0.002 * rand());
  }
  const t = Float64Array.from(times, (s) => Math.round(s * 1e6));
  const accelInfo = { ...PHONE_STREAMS[0], sensor: { maxRange: m.accelRange ?? 78.45 } };
  const gyroInfo = { ...PHONE_STREAMS[1], sensor: { maxRange: 34.9 } };
  const header: ImuHeader = {
    format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: WALL_MS, clock: { elapsedUs: 0, wallMs: WALL_MS },
    setup: { placement: 'poitrine', foil: true }, streams: [accelInfo, gyroInfo],
  };
  return {
    header,
    series: [
      { info: accelInfo, t, values: [Float32Array.from(ax), Float32Array.from(ay), Float32Array.from(az)] },
      { info: gyroInfo, t: t.slice(), values: [Float32Array.from(gx), Float32Array.from(gy), Float32Array.from(gz)] },
    ],
    chunks: 0, truncated: false, skippedChunks: 0,
  };
};

/**
 * Un saut : poussée pendant `pushS` jusqu'à la vitesse verticale `v0`, vol
 * de `flightS` à l'accélération verticale `−fall` (g sans portance),
 * atterrissage qui annule la vitesse en `landS`. Rend l'accélération
 * verticale à l'instant t, 0 hors du saut.
 */
const jump = (takeoffS: number, v0: number, fall = G, pushS = 0.3, landS = 0.3) => {
  const flightS = (2 * v0) / fall;
  return {
    flightS,
    heightM: (v0 * v0) / (2 * fall),
    az: (t: number) => {
      if (t >= takeoffS - pushS && t < takeoffS) return v0 / pushS;
      if (t >= takeoffS && t < takeoffS + flightS) return -fall;
      if (t >= takeoffS + flightS && t < takeoffS + flightS + landS) return v0 / landS;
      return 0;
    },
  };
};

/** Clapot : quelques sinus de 2 à 4 Hz, 0,3 g au plus. */
const chop = (t: number) => 0.15 * G * Math.sin(2 * Math.PI * 2.3 * t) + 0.1 * G * Math.sin(2 * Math.PI * 3.7 * t + 1) + 0.05 * G * Math.sin(2 * Math.PI * 1.1 * t + 2);

const jumpsOf = (rec: ImuRecording, track: { timeMs: number; speedMs: number }[] = []): MeasuredJump[] => measureJumps(rec, D, track).jumps;

describe('sauts : hauteur', () => {
  it('mesure un vol libre de 2 m, téléphone penché de 30°, à g·T²/8 près', () => {
    const j = jump(30, Math.sqrt(2 * G * 2));
    const jumps = jumpsOf(record({ durationS: 60, az: (t) => j.az(t) + chop(t) * 0.3 }));
    expect(jumps).toHaveLength(1);
    expect(jumps[0].heightM).toBeCloseTo(2, 1);
    expect(Math.abs(jumps[0].heightM - 2)).toBeLessThan(0.05);
    expect(Math.abs(jumps[0].flightS - j.flightS)).toBeLessThan(0.05);
    expect(Math.abs(jumps[0].heightM - (G * jumps[0].flightS ** 2) / 8)).toBeLessThan(0.08);
    expect(jumps[0].doubts).toEqual([]);
  });

  it('mesure un vol porté par l\'aile sous la borne de la parabole', () => {
    // Portance verticale de 0,5 g et traction horizontale de 0,3 g en vol, 0,2 g de traction en navigation.
    const j = jump(30, 3.5, 0.5 * G);
    const inFlight = (t: number) => t >= 30 && t < 30 + j.flightS;
    const jumps = jumpsOf(record({ durationS: 60, az: j.az, ay: (t) => (inFlight(t) ? 0.3 * G : 0.2 * G) }));
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].heightM - j.heightM)).toBeLessThan(0.07);
    expect(jumps[0].heightM).toBeLessThan((G * jumps[0].flightS ** 2) / 8);
    expect(jumps[0].doubts).toEqual([]);
  });

  it('donne le même saut à 50, 100 et 200 Hz', () => {
    const j = jump(30, 4);
    const at = (rateHz: number) => jumpsOf(record({ durationS: 60, rateHz, az: (t) => j.az(t) + chop(t) * 0.3 }));
    const [a, b, c] = [at(50), at(100), at(200)];
    for (const r of [a, b, c]) expect(r).toHaveLength(1);
    expect(Math.abs(a[0].heightM - b[0].heightM)).toBeLessThan(0.03);
    expect(Math.abs(c[0].heightM - b[0].heightM)).toBeLessThan(0.03);
    expect(Math.abs(a[0].flightS - b[0].flightS)).toBeLessThan(0.03);
  });

  it('suit une rotation complète pendant un vol porté (360°/s, backloop)', () => {
    const j = jump(30, 3.5, 0.5 * G);
    const inFlight = (t: number) => t >= 30 && t < 30 + j.flightS;
    const tilt = (t: number) => Math.PI / 6 + (t < 30 ? 0 : t < 30 + j.flightS ? (2 * Math.PI * (t - 30)) / j.flightS : 2 * Math.PI);
    const jumps = jumpsOf(record({ durationS: 60, az: j.az, ay: (t) => (inFlight(t) ? 0.3 * G : 0.2 * G), tilt }));
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].heightM - j.heightM)).toBeLessThan(0.1);
  });

  it('résiste au biais, à l\'erreur d\'échelle et à la dérive du gyroscope', () => {
    const j = jump(30, Math.sqrt(2 * G * 1.5));
    const jumps = jumpsOf(record({
      durationS: 60, az: (t) => j.az(t) + chop(t) * 0.3, bias: 0.2, scale: 0.01, gyroDrift: (0.1 * Math.PI) / 180, gaps: [[10, 10.3]],
    }));
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].heightM - 1.5)).toBeLessThan(0.1);
    expect(jumps[0].doubts).toEqual([]);
  });

  it('rend la courbe du saut calée sur le décollage, au sommet à mi-vol', () => {
    const j = jump(30, Math.sqrt(2 * G * 1));
    const [only] = jumpsOf(record({ durationS: 60, az: j.az }));
    const { stepS, startS, heightsM } = only.curve;
    expect(stepS).toBeCloseTo(0.05, 6);
    expect(startS).toBeLessThan(0);
    expect(Math.abs(Math.round(startS / stepS) * stepS - startS)).toBeLessThan(1e-9);
    const top = heightsM.indexOf(Math.max(...heightsM));
    expect(Math.abs(startS + top * stepS - only.flightS / 2)).toBeLessThan(0.1);
    expect(Math.max(...heightsM)).toBeCloseTo(only.heightM, 1);
  });
});

describe('sauts : ce qui n\'en est pas', () => {
  it('ne trouve rien dans 10 min de clapot', () => {
    const rec = record({ durationS: 600, az: chop, noise: 0.3 });
    expect(jumpsOf(rec)).toEqual([]);
    expect(pruneWindows(rec, D)).toEqual([]);
  });

  it('ne trouve rien dans une houle de 1,5 m à 8 s', () => {
    const swell = (t: number) => -0.75 * (2 * Math.PI / 8) ** 2 * Math.sin((2 * Math.PI * t) / 8);
    expect(jumpsOf(record({ durationS: 300, az: (t) => swell(t) + chop(t) * 0.5 }))).toEqual([]);
  });

  it('ne range aucun pompage sur foil (1,5 Hz, ±1,4 m/s)', () => {
    const w = 2 * Math.PI * 1.5;
    const amplitude = 1.4 / w;
    const rec = record({ durationS: 120, az: (t) => -amplitude * w * w * Math.sin(w * t), ay: () => 0.2 * G });
    expect(jumpsOf(rec)).toEqual([]);
    expect(pruneWindows(rec, D)).toEqual([]);
  });
});

describe('sauts : mesures douteuses', () => {
  it('marque un capteur saturé pendant la poussée', () => {
    const j = jump(30, Math.sqrt(2 * G * 1.5), G, 0.05);
    const [only] = jumpsOf(record({ durationS: 60, az: j.az, accelRange: 78.45 }));
    expect(only.doubts).toContain('saturation');
  });

  it('marque un trou dans les mesures autour du vol', () => {
    const j = jump(30, Math.sqrt(2 * G * 1.5));
    const [only] = jumpsOf(record({ durationS: 60, az: j.az, gaps: [[31.5, 31.6]] }));
    expect(only.doubts).toContain('trou');
  });

  it('marque une hauteur au-delà de la parabole (aile qui tire vers le bas)', () => {
    const j = jump(30, 4, 1.3 * G);
    const [only] = jumpsOf(record({ durationS: 60, az: j.az }));
    expect(only.doubts).toContain('parabole');
  });
});

describe('sauts : élagage et trace', () => {
  // Trois sauts, dont un à 5 s du début et deux à 20 s l'un de l'autre.
  const jumps = [jump(5, 4), jump(200, 5), jump(220, 3.5)];
  const motion: Motion = { durationS: 400, az: (t) => jumps.reduce((s, j) => s + j.az(t), 0) + chop(t) * 0.3 };

  it('garde chaque saut dans une fenêtre, fenêtres fusionnées et rognées au début', () => {
    const rec = record(motion);
    const windows = pruneWindows(rec, D);
    expect(windows).toHaveLength(2);
    expect(windows[0][0]).toBe(0);
    expect(windows[1][0]).toBeLessThan(200e6 - 14e6);
    expect(windows[1][1]).toBeGreaterThan(220e6 + 14e6);
    const kept = windows.reduce((s, [a, b]) => s + b - a, 0) / 400e6;
    expect(kept).toBeLessThan(0.3);
  });

  it('donne les mêmes sauts depuis la séance entière et depuis le fichier élagué', async () => {
    const rec = record(motion);
    const whole = jumpsOf(rec);
    expect(whole).toHaveLength(3);
    const pruned = (await decodeImu(await encodeImu(selectImuWindows(rec, pruneWindows(rec, D)).header, selectImuWindows(rec, pruneWindows(rec, D)).series, 1, true)))!;
    expect(pruned.header.windows).toHaveLength(2);
    expect(pruned.series[0].t.length).toBeLessThan(rec.series[0].t.length / 2);
    const fromPruned = jumpsOf(pruned);
    expect(fromPruned).toHaveLength(3);
    fromPruned.forEach((j, k) => {
      expect(Math.abs(j.heightM - whole[k].heightM)).toBeLessThan(0.005);
      expect(Math.abs(j.takeoffMs - whole[k].takeoffMs)).toBeLessThan(1);
    });
  });

  it('tire la vitesse au décollage et la longueur de la trace', () => {
    const track = Array.from({ length: 401 }, (_, s) => ({ timeMs: WALL_MS + s * 1000, speedMs: 8 }));
    const [first] = jumpsOf(record(motion), track);
    expect(first.speedMs).toBeCloseTo(8, 6);
    expect(first.lengthM).toBeCloseTo(8 * first.flightS, 3);
    expect(jumpsOf(record(motion))[0].speedMs).toBeNull();
  });
});

describe('sauts : élagage du fichier', () => {
  const jumps = [jump(60, 4.5), jump(200, 3.5)];
  const motion: Motion = { durationS: 300, az: (t) => jumps.reduce((s, j) => s + j.az(t), 0) + chop(t) * 0.3 };

  it('garde les fenêtres des vols, un fichier plus petit, et les mêmes sauts', async () => {
    const rec = record(motion);
    const whole = await encodeImu(rec.header, rec.series);
    const pruned = await pruneImuFile(whole, D);
    expect(pruned.length).toBeLessThan(whole.length / 2);
    const read = (await decodeImu(pruned))!;
    expect(read.header.windows).toHaveLength(2);
    const before = jumpsOf((await decodeImu(whole))!);
    const after = jumpsOf(read);
    expect(after.map((j) => [j.takeoffMs, j.heightM])).toEqual(before.map((j) => [j.takeoffMs, j.heightM]));
  });

  it('rend tel quel un fichier déjà élagué ou illisible', async () => {
    const rec = record(motion);
    const once = await pruneImuFile(await encodeImu(rec.header, rec.series), D);
    expect(await pruneImuFile(once, D)).toBe(once);
    const junk = new TextEncoder().encode('<gpx></gpx>');
    expect(await pruneImuFile(junk, D)).toBe(junk);
  });
});
