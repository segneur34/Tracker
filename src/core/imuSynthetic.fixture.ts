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
  // Réglages lus une fois, hors de la boucle des mesures (60 000 pour 10 min à 100 Hz).
  const gapStarts = (m.gaps ?? []).map(([a]) => a);
  const gapEnds = (m.gaps ?? []).map(([, b]) => b);
  const rand = noiseSource(42);
  const tilt = m.tilt ?? (() => Math.PI / 6);
  const lateral = m.ay;
  const range = m.accelRange ?? Infinity;
  const k = 1 + (m.scale ?? 0);
  const bias = m.bias ?? 0;
  const noiseAmplitude = m.noise ?? 0.05;
  const sqrt3 = Math.sqrt(3);
  const drift = m.gyroDrift ?? 0;
  const clamp = (x: number) => Math.max(-range, Math.min(range, x));
  const times = new Float64Array(n);
  const ax = new Float32Array(n);
  const ay = new Float32Array(n);
  const az = new Float32Array(n);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const gz = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let inGap = false;
    for (let g = 0; g < gapStarts.length; g++) {
      if (t >= gapStarts[g] && t < gapEnds[g]) {
        inGap = true;
        break;
      }
    }
    if (inGap) continue;
    const th = tilt(t);
    const h = (lateral ? lateral(t) : undefined) ?? 0;
    const v = m.az(t) + STANDARD_G;
    // Même ordre des tirages et des opérations qu'avant (une sortie identique à l'octet près) : ax, ay, az, puis gx, gy, gz.
    ax[count] = clamp(bias + noiseAmplitude * rand() * sqrt3);
    ay[count] = clamp(k * (Math.cos(th) * h + Math.sin(th) * v) + bias + noiseAmplitude * rand() * sqrt3);
    az[count] = clamp(k * (-Math.sin(th) * h + Math.cos(th) * v) + bias + noiseAmplitude * rand() * sqrt3);
    const rate1 = (tilt(t + 0.0005) - tilt(t - 0.0005)) / 0.001;
    gx[count] = rate1 + drift + 0.002 * rand();
    gy[count] = drift + 0.002 * rand();
    gz[count] = 0.002 * rand();
    times[count] = Math.round(t * 1e6);
    count++;
  }
  const t = times.slice(0, count);
  const accelInfo = { ...PHONE_STREAMS[0], sensor: { maxRange: m.accelRange ?? 78.45 } };
  const gyroInfo = { ...PHONE_STREAMS[1], sensor: { maxRange: 34.9 } };
  const header: ImuHeader = {
    format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: SYNTH_WALL_MS, clock: { elapsedUs: 0, wallMs: SYNTH_WALL_MS },
    setup: { placement: 'poitrine', foil: true }, streams: [accelInfo, gyroInfo],
  };
  return {
    header,
    series: [
      { info: accelInfo, t, values: [ax.slice(0, count), ay.slice(0, count), az.slice(0, count)] },
      { info: gyroInfo, t: t.slice(), values: [gx.slice(0, count), gy.slice(0, count), gz.slice(0, count)] },
    ],
    chunks: 0, truncated: false, skippedChunks: 0,
  };
};

