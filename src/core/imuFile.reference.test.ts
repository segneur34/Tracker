import { describe, expect, it } from 'vitest';
import { IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, decodeImu } from './imuFile';

/**
 * Le format `.imu` a deux auteurs : `ImuWriter.java` l'écrit au téléphone, ce
 * module le lit. `imuFile.reference.imu` sort de l'écrivain Java
 * (`android/app/src/test/…/ImuReference.java`, qui dit le pourquoi de chaque
 * mesure) ; `ImuFormatTest.java` échoue si Java n'écrit plus la même chose, et
 * ce test, sans Gradle ni JDK, si le lecteur ne s'y retrouve plus.
 *
 * Attendus écrits à la main, à ne pas déduire du fichier. Le fichier ne se
 * refait que par `node outils/imu-reference.mjs`, pour un changement de format
 * voulu ; aucun test ne l'écrit.
 */

// Les types de Node ne sont pas ceux de l'app (voir `hooks/mediaQueries.test.ts`) : le peu qui sert est décrit à la main.
interface Fs {
  readFileSync(file: URL): Uint8Array;
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const REFERENCE = fs.readFileSync(new URL('./imuFile.reference.imu', import.meta.url));

/** Mesures de chaque flux, tous paquets à la suite. */
const decoded = async () => {
  const recording = await decodeImu(REFERENCE);
  if (!recording) throw new Error('référence illisible');
  const [accel, gyro, pressure] = recording.series;
  return { recording, accel, gyro, pressure };
};

/** Valeurs d'un axe, à 5e-5 près : bien sous la plus fine des unités (0,002), au-dessus de l'erreur du Float32 relu. */
const expectValues = (actual: Float32Array, expected: number[]): void => {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, i) => expect(actual[i], `mesure ${i}`).toBeCloseTo(value, 4));
};

describe('référence du format des capteurs, écrite par le téléphone', () => {
  it('commence par la marque, puis la longueur de l\'en-tête en octets, petit-boutiste', () => {
    // « TRKIMU1\n »
    expect(Array.from(REFERENCE.subarray(0, 8))).toEqual([0x54, 0x52, 0x4b, 0x49, 0x4d, 0x55, 0x31, 0x0a]);
    const view = new DataView(REFERENCE.buffer, REFERENCE.byteOffset, REFERENCE.byteLength);
    const length = view.getUint32(8, true);
    const text = new TextDecoder().decode(REFERENCE.subarray(12, 12 + length));
    expect(text.startsWith('{"format":"tracker-capteurs",')).toBe(true);
    expect(text.endsWith(']}')).toBe(true);
    // Texte en UTF-8 : les accents et l'euro comptent pour plus d'un octet dans la longueur.
    expect(length).toBeGreaterThan(text.length);
    expect(() => JSON.parse(text) as unknown).not.toThrow();
  });

  it('relit l\'en-tête, tel que le plugin l\'écrit', async () => {
    const { recording } = await decoded();
    expect(recording.header).toEqual({
      format: 'tracker-capteurs',
      version: 1,
      startedAtMs: 1_790_000_000_000,
      clock: { elapsedUs: 123_456_789_000, wallMs: 1_790_000_000_150 },
      device: { manufacturer: 'Société d\'essai', model: 'Téléphone €', android: 36 },
      setup: { placement: 'poitrine', foil: true, jumps: true, cadence: false },
      streams: [
        {
          id: 0, kind: 'accel', axes: 3, unit: 0.01, offset: 0,
          sensor: { name: 'Accéléromètre', vendor: 'Société d\'essai', maxRange: 78.5, resolution: 0.0025, minDelayUs: 2500 },
        },
        {
          id: 1, kind: 'gyro', axes: 3, unit: 0.002, offset: 0,
          sensor: { name: 'Gyroscope', vendor: 'Société d\'essai', maxRange: 34.5, resolution: 0.001, minDelayUs: 2500 },
        },
        {
          id: 2, kind: 'pressure', axes: 1, unit: 0.01, offset: 1000,
          sensor: { name: 'Baromètre', vendor: 'Société d\'essai', maxRange: 1260, resolution: 0.0099, minDelayUs: 40000 },
        },
      ],
    });
  });

  it('lit trois paquets entiers, et trois flux dans l\'ordre de leurs numéros', async () => {
    const { recording, accel, gyro, pressure } = await decoded();
    expect(recording.chunks).toBe(3);
    expect(recording.truncated).toBe(false);
    expect(recording.skippedChunks).toBe(0);
    expect(recording.series.map((s) => [s.info.id, s.info.kind, s.info.axes, s.info.unit, s.info.offset])).toEqual([
      [0, 'accel', 3, 0.01, 0],
      [1, 'gyro', 3, 0.002, 0],
      [2, 'pressure', 1, 0.01, 1000],
    ]);
    expect(accel.t.length).toBe(5 + 5 + 65_536);
    expect(gyro.t.length).toBe(3 + 1);
    expect(pressure.t.length).toBe(2);
    for (const s of recording.series) for (const axis of s.values) expect(axis.length).toBe(s.t.length);
  });

  it('paquet 1 : instants au dixième de milliseconde, au-delà de 32 bits', async () => {
    const { accel, gyro, pressure } = await decoded();
    expect(Array.from(accel.t.subarray(0, 5))).toEqual([
      5_000_000_123,
      5_000_010_123,
      // Écart de 20 047 µs : arrondi à 200 pas.
      5_000_020_123,
      // Écart de 30 050 µs, pile au milieu : arrondi au-dessus, 301 pas.
      5_000_030_223,
      5_000_040_123,
    ]);
    expect(Array.from(gyro.t.subarray(0, 3))).toEqual([5_000_001_123, 5_000_011_123, 5_000_021_123]);
    expect(Array.from(pressure.t)).toEqual([5_000_005_123, 5_000_205_123]);
  });

  it('paquet 1 : valeurs à l\'échelle et au décalage de chaque flux, bornées, écarts modulo 2^16', async () => {
    const { accel, gyro, pressure } = await decoded();
    // 46,60 m/s² = 0x1234 : les octets inversés liraient 0x3412, soit 133,30.
    expectValues(accel.values[0].subarray(0, 5), [46.6, -1.5, 3.27, 0, 0.01]);
    // ±400 m/s² bornés à ±327,67 : l'écart d'un extrême à l'autre ne tient qu'à modulo 2^16.
    expectValues(accel.values[1].subarray(0, 5), [327.67, -327.68, 327.67, 327.67, -327.68]);
    expectValues(accel.values[2].subarray(0, 5), [9.81, 9.81, 9.82, -9.81, 0]);
    expectValues(gyro.values[0].subarray(0, 3), [0.5, -0.5, 65.534]);
    expectValues(gyro.values[1].subarray(0, 3), [0.002, 0.004, -0.002]);
    expectValues(gyro.values[2].subarray(0, 3), [-65.536, 0, 0.1]);
    expectValues(pressure.values[0], [1013.25, 999.5]);
  });

  it('paquet 2 : un écart hors de [0, 32 767] ouvre un bloc, qui repart d\'un instant et d\'une valeur exacts', async () => {
    const { accel, gyro } = await decoded();
    expect(Array.from(accel.t.subarray(5, 10))).toEqual([
      5_001_000_123,
      // 32 767 pas : même bloc, les 30 µs de trop perdues.
      5_004_276_823,
      // 32 768 pas : nouveau bloc, ses 40 µs gardées.
      5_007_553_663,
      // L'instant recule : nouveau bloc, exact.
      5_007_552_670,
      // Dans ce bloc, 20 037 µs tombent sur 200 pas.
      5_007_572_670,
    ]);
    expectValues(accel.values[0].subarray(5, 10), [1, 2, 3, 4, 5]);
    expectValues(accel.values[1].subarray(5, 10), [0.25, 0.25, 0.5, 0.5, 0.75]);
    expectValues(accel.values[2].subarray(5, 10), [-1, -2, -3, -4, -5]);
    // Une mesure seule, sans écart ; le baromètre n'a rien dans ce paquet.
    expect(gyro.t[3]).toBe(5_001_000_246);
    expectValues(gyro.values[0].subarray(3), [1]);
    expectValues(gyro.values[1].subarray(3), [-1]);
    expectValues(gyro.values[2].subarray(3), [0.5]);
  });

  it('paquet 3 : 65 535 mesures dans un bloc au plus, nombre lu sans signe', async () => {
    const { accel } = await decoded();
    const start = 10;
    const count = 65_536;
    expect(accel.t[start]).toBe(6_000_000_000);
    expect(accel.t[start + 1]).toBe(6_000_010_000);
    // Dernière du bloc de 65 535 mesures, 100 Hz tenus.
    expect(accel.t[start + count - 2]).toBe(6_655_340_000);
    // Seule dans son bloc : ses 37 µs gardées.
    expect(accel.t[start + count - 1]).toBe(6_655_350_037);
    for (const [axis, value] of [[0, 1], [1, 2], [2, -1]]) {
      expect(accel.values[axis][start]).toBe(value);
      expect(accel.values[axis][start + count - 1]).toBe(value);
      expect(accel.values[axis].subarray(start).every((v) => v === value)).toBe(true);
    }
  });

  it('arrêt brutal : le dernier paquet, coupé, est ignoré et les autres sont lus', async () => {
    const recording = await decodeImu(REFERENCE.subarray(0, REFERENCE.length - 1));
    expect(recording?.truncated).toBe(true);
    expect(recording?.chunks).toBe(2);
    expect(recording?.skippedChunks).toBe(0);
    expect(recording?.series[0].t.length).toBe(5 + 5);
  });

  it('le plugin Android déclare les flux que le lecteur attend', () => {
    // Numéros, axes, unités et décalages ne vivent qu'en constantes privées de `MotionPlugin`, lié à Android : relus dans sa source.
    const plugin = fs.readFileSync(new URL('../../android/app/src/main/java/io/github/segneur/tracker/MotionPlugin.java', import.meta.url), 'utf8');
    expect(plugin).toContain(`header.put("format", "${IMU_FORMAT}")`);
    expect(plugin).toContain(`header.put("version", ${IMU_VERSION})`);
    for (const { id, kind, axes, unit, offset } of PHONE_STREAMS) {
      const name = kind.toUpperCase();
      expect(plugin).toContain(`private static final int ${name} = ${id};`);
      expect(plugin).toContain(`new ImuWriter.Stream(${name}, ${axes}, ${unit}, ${offset})`);
      expect(plugin).toContain(`streamInfo(${name}, "${kind}", ${axes}, ${unit}, ${offset}, ${kind})`);
    }
  });
});
