import { describe, expect, it } from 'vitest';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, completeRecord, type SessionRecord } from './record';
import { bundleSessionGpx, unbundleSessionGpx } from './sessionBundle';

const START_MS = Date.UTC(2026, 9, 10, 7, 0, 0);

const GPX = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Tracker" xmlns="http://www.topografix.com/GPX/1/1">\n'
  + '<trk><name>Fractionné</name><trkseg><trkpt lat="43.6" lon="3.8"><time>2026-10-10T07:00:00Z</time></trkpt></trkseg></trk>\n</gpx>\n';

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: '2026-10-10_09-00-00_fractionne-course.gpx',
  sport: 'running',
  activityId: null,
  source: 'enregistrement',
  addedAt: '2026-10-10T08:00:00.000Z',
  title: 'Fractionné',
  name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: START_MS,
    endMs: START_MS + 1_800_000,
    distanceM: 5000,
    movingTimeS: 1700,
    elevationGainM: null,
    maxSpeedMs: 6,
    pointCount: 1801,
    samplingS: 1,
  },
  notes: null,
  analysis: null,
  ...patch,
});

const INTERVALS: NonNullable<SessionRecord['intervals']> = [{
  workout: { reps: 2, workS: 10, restS: 10 },
  laps: [
    { kind: 'travail', rep: 1, startMs: START_MS, endMs: START_MS + 10_000 },
    { kind: 'repos', rep: 1, startMs: START_MS + 10_000, endMs: START_MS + 20_000 },
  ],
}];

describe('GPX complet', () => {
  it('rend le GPX d’origine à l’octet près, la fiche et les capteurs', () => {
    const fiche = record({ name: 'Piste <10/10> & 20/20 ]]>', intervals: INTERVALS });
    const motion = new Uint8Array([0, 1, 2, 250, 255]);
    const bundled = bundleSessionGpx(GPX, fiche, motion);
    expect(bundled).not.toBe(GPX);
    expect(bundled.indexOf('<trk>')).toBe(GPX.indexOf('<trk>'));
    const back = unbundleSessionGpx(bundled);
    expect(back.gpx).toBe(GPX);
    expect(back.record?.name).toBe('Piste <10/10> & 20/20 ]]>');
    expect(back.record?.intervals).toEqual(INTERVALS);
    expect(back.motion).toEqual(motion);
  });

  it('sans capteurs, n’en rend pas', () => {
    const back = unbundleSessionGpx(bundleSessionGpx(GPX, record(), null));
    expect(back.gpx).toBe(GPX);
    expect(back.record).not.toBeNull();
    expect(back.motion).toBeNull();
  });

  it('laisse tel quel un GPX sans paquet', () => {
    expect(unbundleSessionGpx(GPX)).toEqual({ gpx: GPX, record: null, motion: null });
  });

  it('retire puis ignore un paquet abîmé', () => {
    const bundled = bundleSessionGpx(GPX, record(), null).replace('"format"', '"forma');
    const back = unbundleSessionGpx(bundled);
    expect(back.gpx).toBe(GPX);
    expect(back.record).toBeNull();
  });

  it('ignore une fiche écrite par une version plus récente', () => {
    expect(unbundleSessionGpx(bundleSessionGpx(GPX, record({ version: RECORD_VERSION + 1 }), null)).record).toBeNull();
  });
});

describe('completeRecord', () => {
  it('reprend ce qui manque sans rien écraser', () => {
    const existing = record({ name: 'Nom du PC' });
    const incoming = record({ name: 'Nom du téléphone', intervals: INTERVALS });
    const done = completeRecord(existing, incoming);
    expect(done.name).toBe('Nom du PC');
    expect(done.intervals).toEqual(INTERVALS);
  });

  it('rend la même fiche si rien ne manque', () => {
    const existing = record({ intervals: INTERVALS });
    expect(completeRecord(existing, record({ intervals: [] }))).toBe(existing);
  });
});
