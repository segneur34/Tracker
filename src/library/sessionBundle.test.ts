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
    expect(bundled).toContain(GPX.slice(GPX.indexOf('<trkseg>'), GPX.indexOf('</trk>')));
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

describe('nom de la session dans le GPX complet', () => {
  /** Paquet de la 0.2.82 : la fiche et les capteurs, sans retouche du nom. */
  const OLD_BUNDLE = GPX.replace('</gpx>', '<extensions><tracker:session xmlns:tracker="https://github.com/segneur34/Tracker/session" version="1">'
    + '<tracker:record>' + JSON.stringify(record({ name: 'Ancien' })).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    + '</tracker:record></tracker:session></extensions></gpx>');

  it('écrit le nom dans les métadonnées, créées, et dans la trace, puis rend le GPX d’origine', () => {
    const bundled = bundleSessionGpx(GPX, record({ name: 'Carnon' }), null);
    expect(bundled).toContain('<metadata><name>Carnon</name></metadata>');
    expect(bundled).toContain('<trk><name>Carnon</name><trkseg>');
    expect(bundled).not.toContain('<name>Fractionné</name>');
    expect(unbundleSessionGpx(bundled).gpx).toBe(GPX);
  });

  it('échappe un nom avec &, < et des guillemets', () => {
    const name = 'Piste "A" <10/10> & 20/20';
    const bundled = bundleSessionGpx(GPX, record({ name }), null);
    expect(bundled).toContain('<trk><name>Piste "A" &lt;10/10&gt; &amp; 20/20</name>');
    const back = unbundleSessionGpx(bundled);
    expect(back.gpx).toBe(GPX);
    expect(back.record?.name).toBe(name);
  });

  it('remplace le nom des métadonnées existantes et ajoute celui d’une trace sans nom', () => {
    const metadata = '<metadata>\n  <name>Wingfoil, 10/10/2026 10:00</name><time>2026-10-10T07:00:00Z</time></metadata>\n';
    const gpx = GPX.replace('1/1">\n', `1/1">\n${metadata}`).replace('<trk><name>Fractionné</name>', '<trk>');
    const bundled = bundleSessionGpx(gpx, record({ name: 'Carnon' }), null);
    expect(bundled).toContain('<metadata>\n  <name>Carnon</name><time>');
    expect(bundled).toContain('<trk><name>Carnon</name><trkseg>');
    expect(unbundleSessionGpx(bundled).gpx).toBe(gpx);
  });

  it('laisse les noms d’une session sans nom', () => {
    const bundled = bundleSessionGpx(GPX, record({ name: null }), null);
    expect(bundled).toContain('<trk><name>Fractionné</name>');
    expect(bundled).not.toContain('<metadata>');
    expect(unbundleSessionGpx(bundled).gpx).toBe(GPX);
  });

  it('relit un paquet de la 0.2.82', () => {
    const back = unbundleSessionGpx(OLD_BUNDLE);
    expect(back.gpx).toBe(GPX);
    expect(back.record?.name).toBe('Ancien');
  });
});

describe('repères de la session dans le GPX complet', () => {
  const marks = [
    { timeMs: START_MS + 120_000, lat: 43.61, lon: 3.81, label: 'Bouée <rouge>' },
    { timeMs: START_MS + 60_000, lat: 43.6, lon: 3.8, label: null },
  ];

  it('les écrit en <wpt> avant la trace, puis rend le GPX d’origine', () => {
    const bundled = bundleSessionGpx(GPX, record({ marks }), null);
    expect(bundled).toContain('<wpt lat="43.6" lon="3.8"><time>2026-10-10T07:01:00.000Z</time><name>Note 1</name></wpt>'
      + '<wpt lat="43.61" lon="3.81"><time>2026-10-10T07:02:00.000Z</time><name>Bouée &lt;rouge&gt;</name></wpt><trk>');
    const back = unbundleSessionGpx(bundled);
    expect(back.gpx).toBe(GPX);
    expect(back.record?.marks).toEqual([...marks].reverse());
  });

  it('avec un nom : métadonnées, points de passage, puis la trace nommée', () => {
    const bundled = bundleSessionGpx(GPX, record({ name: 'Carnon', marks }), null);
    const order = ['<metadata><name>Carnon</name></metadata>', '<wpt ', '<trk><name>Carnon</name>'].map((t) => bundled.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(unbundleSessionGpx(bundled).gpx).toBe(GPX);
  });

  it('sans repère, n’écrit pas de <wpt>', () => {
    expect(bundleSessionGpx(GPX, record(), null)).not.toContain('<wpt');
  });
});

describe('GPX complet dont la fiche a un résumé abîmé', () => {
  it('rend la fiche sans son résumé, qui se refait à l’import', () => {
    const bundled = bundleSessionGpx(GPX, record({ name: 'Piste' }), null);
    const damaged = bundled.replace('&quot;maxSpeedMs&quot;: 6', '&quot;maxSpeedMs&quot;: null').replace('"maxSpeedMs": 6', '"maxSpeedMs": null');
    expect(damaged).not.toBe(bundled);
    const back = unbundleSessionGpx(damaged);
    expect(back.record?.summary).toBeNull();
    expect(back.record?.name).toBe('Piste');
  });
});

describe('completeRecord', () => {
  it('reprend ce qui manque sans rien écraser', () => {
    const existing = record({ name: 'Nom du PC' });
    const incoming = record({ name: 'Nom du téléphone', intervals: INTERVALS });
    const { record: done } = completeRecord(existing, incoming);
    expect(done.name).toBe('Nom du PC');
    expect(done.intervals).toEqual(INTERVALS);
  });

  it('rend la même fiche si rien ne manque', () => {
    const existing = record({ intervals: INTERVALS });
    expect(completeRecord(existing, record({ intervals: [] })).record).toBe(existing);
  });
});
