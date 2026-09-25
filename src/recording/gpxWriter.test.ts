import { describe, expect, it } from 'vitest';
import { buildGpx } from './gpxWriter';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

describe('buildGpx', () => {
  const gpx = buildGpx(
    [[
      { timeMs: T0, lat: 43.1234567, lon: 3.7654321, accuracyM: 4.2, altitudeM: 2.5, speedMs: 5.43, bearingDeg: 270.1 },
      { timeMs: T0 + 1000, lat: 43.1234667, lon: -3.5 },
    ]],
    { name: 'Voile & vent <fort>', sport: 'windsurf' }
  );

  it('écrit un point par position, en GPX 1.1', () => {
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
    expect(gpx).toContain('<trkpt lat="43.1234667" lon="-3.5"><time>2026-09-23T12:00:01.000Z</time></trkpt>');
  });

  it('porte vitesse en m/s et altitude du premier point, sans cap ni précision', () => {
    expect(gpx).toContain(
      '<trkpt lat="43.1234567" lon="3.7654321"><ele>2.5</ele><time>2026-09-23T12:00:00.000Z</time>'
      + '<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>5.43</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>'
    );
    expect(gpx).not.toContain('gpxtpx:course');
    expect(gpx).not.toContain('tracker:accuracy');
  });

  it('échappe le nom de la trace et indique le support', () => {
    expect(gpx).toContain('<name>Voile &amp; vent &lt;fort&gt;</name>');
    expect(gpx).toContain('<type>windsurf</type>');
    expect(gpx).not.toContain('<fort>');
  });

  it('reste un GPX valide sans aucune position', () => {
    const empty = buildGpx([], { name: 'Vide', sport: 'bateau' });
    expect(empty).toContain('<trkseg>');
    expect(empty).not.toContain('<trkpt');
    expect(empty.match(/<trkseg>/g)).toHaveLength(1);
  });

  it('écrit un <trkseg> par segment, dans l\'ordre', () => {
    const multi = buildGpx(
      [
        [{ timeMs: T0, lat: 1, lon: 1 }, { timeMs: T0 + 1000, lat: 1.1, lon: 1 }],
        [{ timeMs: T0 + 100_000, lat: 2, lon: 2 }, { timeMs: T0 + 101_000, lat: 2.1, lon: 2 }],
      ],
      { name: 'Deux segments', sport: 'kite' }
    );
    expect(multi.match(/<trkseg>/g)).toHaveLength(2);
    expect(multi.match(/<trkpt /g)).toHaveLength(4);
    const firstSegment = multi.split('<trkseg>')[1];
    expect(firstSegment).toContain('lat="1"');
    expect(firstSegment).not.toContain('lat="2"');
  });

  it('filtre un segment vide intercalé', () => {
    const withEmpty = buildGpx(
      [[{ timeMs: T0, lat: 1, lon: 1 }], [], [{ timeMs: T0 + 1000, lat: 2, lon: 2 }]],
      { name: 'Segment vide', sport: 'kite' }
    );
    expect(withEmpty.match(/<trkseg>/g)).toHaveLength(2);
  });
});
