import { describe, expect, it } from 'vitest';
import { FIT_BASE, FIT_INVALID, FIT_MESG, buildFitActivity, fitCrc, fitTime, fitWriter, semicircles } from '../test/fit.fixture';
import { FIT_FILE_ACTIVITY, parseFit, readFitFileType } from './fitParser';

const T0 = Date.UTC(2026, 9, 10, 10, 0, 0);

const point = (s: number) => ({
  timeMs: T0 + s * 1000, lat: 43.5 + s * 1e-5, lon: 3.9 - s * 1e-5, altitudeM: 12.4, speedMs: 3.456, hr: 150, cadence: 85, fractionalCadence: 64,
});

describe('lecteur FIT : valeurs et unités', () => {
  it('rend les points en SI : semi-cercles en degrés, époque de 1989, altitude, vitesse, cadence fractionnaire', () => {
    const { records, fileType, truncated } = parseFit(buildFitActivity({ points: [point(0), point(1)] }));
    expect(fileType).toBe(FIT_FILE_ACTIVITY);
    expect(truncated).toBe(false);
    expect(records).toHaveLength(2);
    const [r] = records;
    expect(new Date(r.timeMs).toISOString()).toBe('2026-10-10T10:00:00.000Z');
    expect(r.lat).toBeCloseTo(43.5, 6);
    expect(r.lon).toBeCloseTo(3.9, 6);
    expect(r.altitudeM).toBe(12.4);
    expect(r.speedMs).toBe(3.456);
    expect(r.heartRateBpm).toBe(150);
    expect(r.cadence).toBe(85.5);
  });

  it("l'époque du FIT est le 31/12/1989 à minuit UTC", () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, [{ num: 253, base: FIT_BASE.uint32 }]);
    // 1 000 000 000 s après l'époque du FIT, valeur de la documentation du format.
    writer.message(0, [1_000_000_000]);
    expect(new Date(parseFit(writer.bytes()).records[0].timeMs).toISOString()).toBe('2021-09-08T01:46:40.000Z');
  });

  it('lit les deux boutismes et les deux tailles d\'en-tête, à l\'identique', () => {
    const points = [point(0), point(1), point(2)];
    const reference = parseFit(buildFitActivity({ points }));
    expect(parseFit(buildFitActivity({ points, bigEndian: true }))).toStrictEqual(reference);
    expect(parseFit(buildFitActivity({ points, headerSize: 12 }))).toStrictEqual(reference);
  });

  it('préfère enhanced_speed et enhanced_altitude aux anciens champs, et lit ces anciens seuls', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, [
      { num: 253, base: FIT_BASE.uint32 }, { num: 2, base: FIT_BASE.uint16 }, { num: 6, base: FIT_BASE.uint16 },
      { num: 78, base: FIT_BASE.uint32 }, { num: 73, base: FIT_BASE.uint32 },
    ]);
    writer.message(0, [fitTime(T0), (100 + 500) * 5, 1000, (200 + 500) * 5, 2000]);
    writer.message(0, [fitTime(T0 + 1000), (100 + 500) * 5, 1000, FIT_INVALID.uint32, FIT_INVALID.uint32]);
    const { records } = parseFit(writer.bytes());
    expect(records[0]).toMatchObject({ altitudeM: 200, speedMs: 2 });
    expect(records[1]).toMatchObject({ altitudeM: 100, speedMs: 1 });
  });

  it('une valeur invalide est absente, jamais un chiffre : position, altitude, vitesse, FC, cadence', () => {
    const { records } = parseFit(buildFitActivity({ points: [{ timeMs: T0 }] }));
    expect(records).toStrictEqual([{ timeMs: T0 }]);
  });

  it('une FC à 0 (ceinture non portée) est absente, une cadence à 0 (arrêt) reste', () => {
    const { records } = parseFit(buildFitActivity({ points: [{ timeMs: T0, hr: 0, cadence: 0 }] }));
    expect(records[0].heartRateBpm).toBeUndefined();
    expect(records[0].cadence).toBe(0);
  });

  it('une latitude hors de la Terre écarte la position, pas le point', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, [{ num: 253, base: FIT_BASE.uint32 }, { num: 0, base: FIT_BASE.sint32 }, { num: 1, base: FIT_BASE.sint32 }]);
    writer.message(0, [fitTime(T0), semicircles(120), semicircles(3)]);
    expect(parseFit(writer.bytes()).records).toStrictEqual([{ timeMs: T0 }]);
  });

  it('écarte un point à une date relative (secondes depuis l\'allumage)', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, [{ num: 253, base: FIT_BASE.uint32 }]);
    writer.message(0, [1234]).message(0, [fitTime(T0)]);
    expect(parseFit(writer.bytes()).records).toStrictEqual([{ timeMs: T0 }]);
  });
});

describe('lecteur FIT : structure du fichier', () => {
  const RECORD_HR = [{ num: 253, base: FIT_BASE.uint32 }, { num: 3, base: FIT_BASE.uint8 }];

  it('temps compressé : décalage sur 5 bits, tour de 32 s compris', () => {
    const start = fitTime(T0);
    const low = start % 32;
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, RECORD_HR).define(1, FIT_MESG.record, [{ num: 3, base: FIT_BASE.uint8 }]);
    writer.message(0, [start, 100]);
    writer.compressed(1, (low + 5) % 32, [101]); // + 5 s
    writer.compressed(1, (low + 30) % 32, [102]); // + 30 s
    writer.compressed(1, (low + 40) % 32, [103]); // + 40 s, le tour de 32 s passé au moins une fois
    const seconds = parseFit(writer.bytes()).records.map((r) => (r.timeMs - T0) / 1000);
    expect(seconds).toEqual([0, 5, 30, 40]);
  });

  it('un temps compressé sans date connue écarte le point sans décaler la suite', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, [{ num: 3, base: FIT_BASE.uint8 }]).define(1, FIT_MESG.record, RECORD_HR);
    writer.compressed(0, 3, [90]).message(1, [fitTime(T0), 91]);
    expect(parseFit(writer.bytes()).records).toStrictEqual([{ timeMs: T0, heartRateBpm: 91 }]);
  });

  it('un autre message porteur de la date sert de référence au temps compressé', () => {
    const start = fitTime(T0);
    const writer = fitWriter();
    writer.define(0, FIT_MESG.lap, [{ num: 253, base: FIT_BASE.uint32 }]).define(1, FIT_MESG.record, [{ num: 3, base: FIT_BASE.uint8 }]);
    writer.message(0, [start]).compressed(1, (start + 2) % 32, [100]);
    expect(parseFit(writer.bytes()).records[0].timeMs).toBe(T0 + 2000);
  });

  it('saute les champs développeur, sans décaler le message suivant', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, RECORD_HR, [2, 3]);
    writer.message(0, [fitTime(T0), 120], [9, 9, 9, 9, 9]);
    writer.message(0, [fitTime(T0 + 1000), 121], [9, 9, 9, 9, 9]);
    expect(parseFit(writer.bytes()).records.map((r) => r.heartRateBpm)).toEqual([120, 121]);
  });

  it('une redéfinition du message local remplace la précédente', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, RECORD_HR).message(0, [fitTime(T0), 120]);
    writer.define(0, FIT_MESG.record, [{ num: 253, base: FIT_BASE.uint32 }, { num: 4, base: FIT_BASE.uint8 }]).message(0, [fitTime(T0 + 1000), 80]);
    writer.define(0, FIT_MESG.lap, [{ num: 253, base: FIT_BASE.uint32 }]).message(0, [fitTime(T0 + 2000)]);
    const { records } = parseFit(writer.bytes());
    expect(records).toStrictEqual([{ timeMs: T0, heartRateBpm: 120 }, { timeMs: T0 + 1000, cadence: 80 }]);
  });

  it('un message inconnu, même long, est sauté', () => {
    const writer = fitWriter();
    writer.define(0, 999, [{ num: 1, base: FIT_BASE.uint32 }, { num: 2, base: FIT_BASE.uint32 }]).define(1, FIT_MESG.record, RECORD_HR);
    writer.message(0, [7, 8]).message(1, [fitTime(T0), 100]);
    expect(parseFit(writer.bytes()).records).toHaveLength(1);
  });

  it('lit deux FIT mis bout à bout', () => {
    const a = buildFitActivity({ points: [point(0)] });
    const b = buildFitActivity({ points: [point(1)] });
    const both = new Uint8Array(a.length + b.length);
    both.set(a);
    both.set(b, a.length);
    const { records, truncated } = parseFit(both);
    expect(records).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it('rend le sport des sessions, à défaut celui du message `sport`', () => {
    expect(parseFit(buildFitActivity({ points: [point(0)], sessionSports: [2, 3, 1], sportMessage: 5 })).sportCodes).toEqual([2, 3, 1]);
    expect(parseFit(buildFitActivity({ points: [point(0)], sessionSports: [], sportMessage: 5 })).sportCodes).toEqual([5]);
    expect(parseFit(buildFitActivity({ points: [point(0)], sessionSports: [] })).sportCodes).toEqual([]);
  });

  it('rend les arrêts et départs de la minuterie, seuls parmi les événements', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.event, [{ num: 253, base: FIT_BASE.uint32 }, { num: 0, base: FIT_BASE.enum }, { num: 1, base: FIT_BASE.enum }]);
    writer.message(0, [fitTime(T0), 0, 0]); // minuterie, départ
    writer.message(0, [fitTime(T0 + 1000), 0, 4]); // minuterie, arrêt général
    writer.message(0, [fitTime(T0 + 2000), 0, 1]); // minuterie, arrêt
    writer.message(0, [fitTime(T0 + 3000), 0, 3]); // minuterie, repère : pas un arrêt
    writer.message(0, [fitTime(T0 + 4000), 9, 0]); // un tour : pas la minuterie
    expect(parseFit(writer.bytes()).timerEvents).toStrictEqual([
      { timeMs: T0, running: true }, { timeMs: T0 + 1000, running: false }, { timeMs: T0 + 2000, running: false },
    ]);
  });
});

describe('lecteur FIT : fichiers abîmés', () => {
  const points = [point(0), point(1), point(2), point(3)];

  it('fichier coupé : garde les points lus jusqu\'à la coupure', () => {
    const whole = buildFitActivity({ points, sessionSports: [] });
    const { records, truncated } = parseFit(whole.subarray(0, whole.length - 10));
    expect(truncated).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThan(points.length);
    expect(records[0]).toStrictEqual(parseFit(whole).records[0]);
  });

  it('coupé en plein en-tête de données ou de définition : aucune erreur', () => {
    const whole = buildFitActivity({ points });
    for (let size = 14; size < whole.length; size += 1) {
      expect(() => parseFit(whole.subarray(0, size))).not.toThrow();
    }
  });

  it('somme de contrôle fausse : rien ne change', () => {
    const whole = buildFitActivity({ points });
    const damaged = whole.slice();
    damaged[damaged.length - 1] ^= 0xff;
    expect(parseFit(damaged)).toStrictEqual(parseFit(whole));
  });

  it('la fabrique écrit la vraie somme de contrôle : celle du fichier entier vaut 0', () => {
    expect(fitCrc(buildFitActivity({ points }))).toBe(0);
  });

  it('message local jamais défini : la lecture s\'arrête là, ce qui précède reste', () => {
    const whole = fitWriter();
    whole.define(0, FIT_MESG.record, [{ num: 253, base: FIT_BASE.uint32 }]).message(0, [fitTime(T0)]);
    const good = whole.bytes();
    const headerAndData = good.length - 2;
    const broken = new Uint8Array(good.length + 3);
    broken.set(good.subarray(0, headerAndData));
    broken[headerAndData] = 0x05; // message local 5, jamais défini
    new DataView(broken.buffer).setUint32(4, headerAndData - 14 + 3, true);
    const { records, truncated } = parseFit(broken);
    expect(records).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it('taille annoncée nulle (écriture jamais terminée) : lit ce qu\'il y a', () => {
    const whole = buildFitActivity({ points });
    const unfinished = whole.slice();
    new DataView(unfinished.buffer).setUint32(4, 0, true);
    expect(parseFit(unfinished).records).toHaveLength(points.length);
  });

  it('vide ou signature fausse : une erreur en clair', () => {
    expect(() => parseFit(new Uint8Array())).toThrow('fichier vide');
    const whole = buildFitActivity({ points });
    const wrong = whole.slice();
    wrong[8] = 0x41;
    expect(() => parseFit(wrong)).toThrow("ce n'est pas un fichier FIT");
    expect(() => parseFit(new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>'))).toThrow("ce n'est pas un fichier FIT");
    expect(() => parseFit(whole.subarray(0, 8))).toThrow("ce n'est pas un fichier FIT");
  });
});

describe('type du fichier, sans lire la suite', () => {
  it('rend le type du `file_id`, même si la suite est abîmée', () => {
    expect(readFitFileType(buildFitActivity({ points: [point(0)] }))).toBe(FIT_FILE_ACTIVITY);
    const settings = buildFitActivity({ points: [point(0)], fileType: 2 });
    expect(readFitFileType(settings)).toBe(2);
    expect(readFitFileType(settings.subarray(0, 14 + 12))).toBe(2);
  });

  it('`null` sans `file_id`, erreur si ce n\'est pas un FIT', () => {
    const writer = fitWriter();
    writer.define(0, FIT_MESG.record, [{ num: 253, base: FIT_BASE.uint32 }]).message(0, [fitTime(T0)]);
    expect(readFitFileType(writer.bytes())).toBeNull();
    expect(() => readFitFileType(new Uint8Array(3))).toThrow("ce n'est pas un fichier FIT");
  });
});
