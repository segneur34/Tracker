import { describe, expect, it } from 'vitest';
import { buildGpx } from './gpxWriter';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

describe('buildGpx', () => {
  const gpx = buildGpx(
    [
      { timeMs: T0, lat: 43.1234567, lon: 3.7654321, accuracyM: 4.2, altitudeM: 2.5, speedMs: 5.43, bearingDeg: 270.1 },
      { timeMs: T0 + 1000, lat: 43.1234667, lon: -3.5 },
    ],
    { name: 'Voile & vent <fort>', sport: 'windsurf' }
  );

  it('écrit un point par position, en GPX 1.1', () => {
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
    expect(gpx).toContain('<trkpt lat="43.1234667" lon="-3.5"><time>2026-09-23T12:00:01.000Z</time></trkpt>');
  });

  it('porte vitesse en m/s, cap, altitude et précision du premier point', () => {
    expect(gpx).toContain(
      '<trkpt lat="43.1234567" lon="3.7654321"><ele>2.5</ele><time>2026-09-23T12:00:00.000Z</time>'
      + '<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>5.43</gpxtpx:speed><gpxtpx:course>270.1</gpxtpx:course>'
      + '</gpxtpx:TrackPointExtension><tracker:accuracy>4.2</tracker:accuracy></extensions></trkpt>'
    );
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
  });
});
