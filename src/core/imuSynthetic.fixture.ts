import { IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, type ImuHeader, type ImuRecording } from './imuFile';
import { STANDARD_G } from './units';

/**
 * Enregistrements synthétiques du téléphone, pour les tests des calculs sur
 * capteurs (sauts, pumping) : rien de l'application ne s'en sert.
 */

/** Heure du début de la capture. */
export const SYNTH_WALL_MS = 1_791_465_895_000;

/**
 * Mouvement synthétique du téléphone : accélération verticale et force
 * horizontale (portance, traction de l'aile) dans le repère du monde, et
 * inclinaison θ autour de l'axe x du téléphone. Le téléphone mesure
 * f = Rx(−θ)·(0, ay, az + g) et ω = (θ', 0, 0).
 */
export interface SynthMotion {
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
export const noiseSource = (seed: number) => {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (x / 2_147_483_648) * 2 - 1;
  };
};

export const synthImu = (m: SynthMotion): ImuRecording => {
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
    const v = m.az(t) + STANDARD_G;
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
    format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: SYNTH_WALL_MS, clock: { elapsedUs: 0, wallMs: SYNTH_WALL_MS },
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

