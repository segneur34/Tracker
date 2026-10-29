import { describe, expect, it } from 'vitest';
import { GARMIN_TRACKPOINT_NAMESPACE, escapeXmlAttr, escapeXmlText, gpxDocument } from './xml';

// Copies gelées des deux anciennes écritures.
const oldBundleEscape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const oldWriterEscape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TEXTS = ['', 'Piste', 'Piste "A" <10/10> & 20/20', '&amp;', '&&<<>>""', "l'été", 'a"b', '<![CDATA[x]]>'];

describe('xml', () => {
  it('échappe le texte sans toucher aux guillemets, comme le paquet de session', () => {
    for (const t of TEXTS) expect(escapeXmlText(t)).toBe(oldBundleEscape(t));
    expect(escapeXmlText('a"b')).toBe('a"b');
  });

  it("échappe aussi les guillemets pour un attribut, comme l'enregistreur", () => {
    for (const t of TEXTS) expect(escapeXmlAttr(t)).toBe(oldWriterEscape(t));
    expect(escapeXmlAttr('a"b')).toBe('a&quot;b');
  });

  it("refait l'enveloppe de l'enregistreur (une ligne par espace de noms)", () => {
    const old = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Tracker"',
      '  xmlns="http://www.topografix.com/GPX/1/1"',
      '  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">',
      '  <trk/>',
      '</gpx>',
      '',
    ].join('\n');
    expect(gpxDocument(['  <trk/>'], { gpxtpx: GARMIN_TRACKPOINT_NAMESPACE })).toBe(old);
  });

  it("refait l'enveloppe des itinéraires (une seule ligne)", () => {
    const old = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Tracker" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <trk/>',
      '</gpx>',
      '',
    ].join('\n');
    expect(gpxDocument(['  <trk/>'])).toBe(old);
  });
});
