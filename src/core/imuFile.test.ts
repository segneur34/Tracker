import { describe, expect, it } from 'vitest';
import {
  IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, decodeImu, encodeImu, imuCaptureStats, selectImuWindows, type ImuHeader, type ImuSeries, type ImuStreamInfo,
} from './imuFile';

const HEADER: ImuHeader = {
  format: IMU_FORMAT,
  version: IMU_VERSION,
  startedAtMs: 1_790_000_000_000,
  clock: { elapsedUs: 123_456_789_000, wallMs: 1_790_000_000_150 },
  device: { manufacturer: 'Xiaomi', model: 'test', android: 36 },
  setup: { placement: 'poitrine', foil: true },
  streams: [...PHONE_STREAMS],
};

const info = (kind: 'accel' | 'gyro' | 'pressure'): ImuStreamInfo => PHONE_STREAMS.find((s) => s.kind === kind)!;

/** Série régulière de `rateHz` pendant `durationS`, avec un léger tremblement des instants, et une valeur par axe. */
const series = (
  kind: 'accel' | 'gyro' | 'pressure',
  rateHz: number,
  durationS: number,
  value: (t: number, axis: number) => number,
  startUs = 0
): ImuSeries => {
  const s = info(kind);
  const n = Math.round(durationS * rateHz);
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = startUs + Math.round((i * 1e6) / rateHz + ((i * 37) % 7) * 13);
  const values = Array.from({ length: s.axes }, (_, a) => Float32Array.from(t, (ti) => value(ti / 1e6, a)));
  return { info: s, t, values };
};

const accel = () => series('accel', 100, 5, (t, a) => (a === 2 ? 9.81 + 3 * Math.sin(2 * Math.PI * 1.3 * t) : 0.5 * Math.cos(t + a)));
const gyro = () => series('gyro', 100, 5, (t, a) => 4 * Math.sin(3 * t + a));
const pressure = () => series('pressure', 5, 5, (t) => 1013.25 - 0.01 * t);

describe('fichier des capteurs', () => {
  it('se relit à la résolution de chaque flux près, instants au dixième de milliseconde', async () => {
    const written = [accel(), gyro(), pressure()];
    const bytes = await encodeImu(HEADER, written);
    const read = await decodeImu(bytes);
    expect(read).not.toBeNull();
    expect(read!.header).toEqual(HEADER);
    expect(read!.truncated).toBe(false);
    expect(read!.skippedChunks).toBe(0);
    for (const w of written) {
      const r = read!.series.find((s) => s.info.kind === w.info.kind)!;
      expect(r.t.length).toBe(w.t.length);
      for (let i = 0; i < w.t.length; i++) {
        expect(Math.abs(r.t[i] - w.t[i])).toBeLessThanOrEqual(50);
        for (let a = 0; a < w.info.axes; a++) expect(Math.abs(r.values[a][i] - w.values[a][i])).toBeLessThanOrEqual(w.info.unit / 2 + 1e-4);
      }
    }
  });

  it('borne les valeurs hors plage et franchit les grands écarts', async () => {
    // De −40 g à +40 g d'une mesure à l'autre : l'entier est borné, son écart passe modulo 2^16.
    const s = series('accel', 100, 1, (t) => (Math.round(t * 100) % 2 === 0 ? 400 : -400));
    const read = (await decodeImu(await encodeImu(HEADER, [s])))!;
    const r = read.series.find((x) => x.info.kind === 'accel')!;
    expect(Math.max(...r.values[0])).toBeCloseTo(327.67, 2);
    expect(Math.min(...r.values[0])).toBeCloseTo(-327.68, 2);
  });

  it('ouvre un nouveau bloc après un trou de plus de 3,27 s, sans perdre les instants', async () => {
    const before = series('gyro', 100, 2, () => 1);
    const after = series('gyro', 100, 2, () => 2, 10_000_000);
    const joined: ImuSeries = {
      info: before.info,
      t: Float64Array.from([...before.t, ...after.t]),
      values: before.values.map((v, a) => Float32Array.from([...v, ...after.values[a]])),
    };
    // Un seul paquet de 20 s, qui contient le trou.
    const read = (await decodeImu(await encodeImu(HEADER, [joined], 20)))!;
    const r = read.series.find((x) => x.info.kind === 'gyro')!;
    expect(r.t.length).toBe(400);
    expect(r.t[200] - r.t[199]).toBeGreaterThan(7_000_000);
    expect(Math.abs(r.t[200] - after.t[0])).toBeLessThanOrEqual(50);
    expect(imuCaptureStats(read).streams.find((x) => x.kind === 'gyro')!.longestGapS).toBeGreaterThan(7);
  });

  it("ignore un dernier paquet tronqué par un arrêt brutal, et saute un paquet illisible", async () => {
    const bytes = await encodeImu(HEADER, [accel(), gyro()]);
    const cut = await decodeImu(bytes.subarray(0, bytes.length - 10));
    expect(cut!.truncated).toBe(true);
    const whole = (await decodeImu(bytes))!;
    expect(cut!.chunks).toBe(whole.chunks - 1);
    expect(cut!.series[0].t.length).toBeLessThan(whole.series[0].t.length);

    // Le deuxième paquet abîmé : les autres restent lus.
    const damaged = bytes.slice();
    const view = new DataView(damaged.buffer);
    const headerEnd = 8 + 4 + view.getUint32(8, true);
    const secondChunk = headerEnd + 4 + view.getUint32(headerEnd, true);
    for (let i = secondChunk + 4; i < secondChunk + 24; i++) damaged[i] = 0xff;
    const read = (await decodeImu(damaged))!;
    expect(read.skippedChunks).toBe(1);
    expect(read.chunks).toBe(whole.chunks - 1);
  });

  it("refuse un fichier sans marque ou à l'en-tête illisible", async () => {
    expect(await decodeImu(new TextEncoder().encode('<gpx></gpx>'))).toBeNull();
    const bytes = await encodeImu({ ...HEADER, format: 'autre' as typeof IMU_FORMAT }, []);
    expect(await decodeImu(bytes)).toBeNull();
  });

  it('dit la durée, la cadence et le plus long trou de chaque flux', async () => {
    const read = (await decodeImu(await encodeImu(HEADER, [accel(), gyro(), pressure()])))!;
    const stats = imuCaptureStats(read);
    expect(stats.durationS).toBeCloseTo(4.99, 1);
    expect(stats.startMs).toBe(HEADER.clock.wallMs);
    const a = stats.streams.find((s) => s.kind === 'accel')!;
    expect(a.count).toBe(500);
    expect(a.rateHz).toBeGreaterThan(95);
    expect(a.rateHz).toBeLessThan(105);
    expect(stats.streams.find((s) => s.kind === 'pressure')!.rateHz).toBeCloseTo(5, 0);
  });

  it("élague : garde les mesures des fenêtres, les inscrit dans l'en-tête, et se relit à l'identique", async () => {
    const whole = (await decodeImu(await encodeImu(HEADER, [accel(), gyro()])))!;
    const windows: [number, number][] = [[500_000, 1_500_000], [3_000_000, 3_200_000]];
    const pruned = selectImuWindows(whole, windows);
    expect(pruned.header.windows).toEqual(windows);
    for (const s of pruned.series.filter((x) => x.info.kind !== 'pressure')) {
      expect(s.t.every((t) => windows.some(([a, b]) => t >= a && t <= b))).toBe(true);
      expect(s.t.length).toBeGreaterThan(110);
      expect(s.t.length).toBeLessThan(130);
    }
    const read = (await decodeImu(await encodeImu(pruned.header, pruned.series, 1, true)))!;
    expect(read.header.windows).toEqual(windows);
    read.series.forEach((s, k) => {
      expect(Array.from(s.t)).toEqual(Array.from(pruned.series[k].t));
      s.values.forEach((v, a) => expect(Array.from(v)).toEqual(Array.from(pruned.series[k].values[a])));
    });
  });

  it("ignore des fenêtres mal formées dans l'en-tête", async () => {
    const bad = { ...HEADER, windows: [[2, 1]] } as unknown as typeof HEADER;
    const read = (await decodeImu(await encodeImu(bad, [accel()])))!;
    expect(read.header.windows).toBeUndefined();
  });
});
