// @vitest-environment node
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseGpx, parseGpxPath } from './gpxParser';

// L'environnement de test est node, sans `DOMParser` : xmldom (dépendance de dev) en tient lieu.
beforeAll(() => {
  vi.stubGlobal('DOMParser', XmlDomParser);
});

const NS = 'xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"';
const gpx = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" ${NS}>${body}</gpx>`;
const pt = (lat: number, lon: number, time: string | null, inner = '') =>
  `<trkpt lat="${lat}" lon="${lon}">${time ? `<time>${time}</time>` : ''}${inner}</trkpt>`;

describe('parseGpx', () => {
  it('lit position, altitude, heure, FC et cadence des extensions Garmin préfixées', () => {
    const xml = gpx(
      `<trk><name>Sortie</name><type>running</type><trkseg>${pt(
        45, 5, '2026-10-01T10:00:00Z', '<ele>120.5</ele><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>152</gpxtpx:hr><gpxtpx:cad>84</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>'
      )}</trkseg></trk>`
    );
    const r = parseGpx(xml);
    expect(r.rawPoints).toHaveLength(1);
    expect(r.rawPoints[0]).toMatchObject({ lat: 45, lon: 5, time: '2026-10-01T10:00:00Z', ele: 120.5, hr: 152, cadence: 84 });
    expect(r.trackName).toBe('Sortie');
    expect(r.trackType).toBe('running');
    expect(r.hasDeviceSpeed).toBe(false);
  });

  it('lit la vitesse directe de l\'extension (m/s) et le cap, et écarte les valeurs absurdes', () => {
    const xml = gpx(
      `<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z', '<extensions><speed>6.5</speed><course>270</course></extensions>')}${pt(
        45, 5.001, '2026-10-01T10:00:01Z', '<extensions><speed>-2</speed><course>400</course></extensions>'
      )}${pt(45, 5.002, '2026-10-01T10:00:02Z', '<extensions><speed>250</speed></extensions>')}</trkseg></trk>`
    );
    const r = parseGpx(xml);
    expect(r.hasDeviceSpeed).toBe(true);
    expect(r.rawPoints.map((p) => p.speedMs)).toEqual([6.5, undefined, undefined]);
    expect(r.rawPoints.map((p) => p.courseDeg)).toEqual([270, undefined, undefined]);
  });

  it('marque le premier point de chaque <trkseg> après le premier, sur un ou plusieurs <trk>', () => {
    const xml = gpx(
      `<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z')}${pt(45, 5.001, '2026-10-01T10:00:01Z')}</trkseg>` +
        `<trkseg>${pt(45, 5.002, '2026-10-01T10:05:00Z')}${pt(45, 5.003, '2026-10-01T10:05:01Z')}</trkseg></trk>` +
        `<trk><trkseg>${pt(45, 5.004, '2026-10-01T10:10:00Z')}</trkseg></trk>`
    );
    const r = parseGpx(xml);
    expect(r.rawPoints.map((p) => p.segmentStart === true)).toEqual([false, false, true, false, true]);
  });

  it('écarte un point sans heure ou sans position, sans casser la suite', () => {
    const xml = gpx(
      `<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z')}${pt(45, 5.001, null)}<trkpt lat="x" lon="5"><time>2026-10-01T10:00:02Z</time></trkpt>${pt(
        45, 5.003, '2026-10-01T10:00:03Z'
      )}</trkseg></trk>`
    );
    expect(parseGpx(xml).rawPoints.map((p) => p.lon)).toEqual([5, 5.003]);
  });

  it('un point écarté en tête d\'un segment ne fait pas perdre la reprise', () => {
    const xml = gpx(`<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z')}</trkseg><trkseg>${pt(45, 5.001, null)}${pt(45, 5.002, '2026-10-01T10:05:00Z')}</trkseg></trk>`);
    expect(parseGpx(xml).rawPoints.map((p) => p.segmentStart === true)).toEqual([false, true]);
  });

  it('garde un nom de trace et un type absents indéfinis', () => {
    const r = parseGpx(gpx(`<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z')}</trkseg></trk>`));
    expect(r.trackName).toBeUndefined();
    expect(r.trackType).toBeUndefined();
  });

  it('A-B7 : le nom d\'un point ne devient pas le nom de la trace', () => {
    const r = parseGpx(gpx(`<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z', '<name>Départ</name>')}</trkseg></trk>`));
    expect(r.trackName).toBeUndefined();
  });

  it('le nom de la trace est celui de son enfant direct, même avec un point nommé', () => {
    const r = parseGpx(gpx(`<trk><name>Sortie</name><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z', '<name>Départ</name>')}</trkseg></trk>`));
    expect(r.trackName).toBe('Sortie');
  });

  it('refuse un XML mal formé', () => {
    // Navigateur : élément parsererror, donc notre message ; xmldom lève sa propre erreur. Dans les deux cas, une erreur.
    expect(() => parseGpx('<gpx><trk><trkseg></gpx>')).toThrow();
  });

  it('un fichier vide de points rend une liste vide', () => {
    expect(parseGpx(gpx('')).rawPoints).toEqual([]);
  });
});

describe('parseGpxPath', () => {
  it('n\'exige pas l\'heure, lit l\'altitude et le nom de la trace', () => {
    const r = parseGpxPath(gpx(`<trk><name>Rando</name><trkseg>${pt(45, 5, null, '<ele>10</ele>')}${pt(45, 5.001, null)}</trkseg></trk>`));
    expect(r.points).toEqual([{ lat: 45, lon: 5, eleM: 10 }, { lat: 45, lon: 5.001 }]);
    expect(r.name).toBe('Rando');
  });

  it('se rabat sur les points de route quand la trace en a moins de deux', () => {
    const r = parseGpxPath(gpx('<rte><name>Route</name><rtept lat="45" lon="5"/><rtept lat="45" lon="5.01"/></rte>'));
    expect(r.points).toHaveLength(2);
    expect(r.name).toBe('Route');
  });

  it('refuse un XML mal formé', () => {
    expect(() => parseGpxPath('<gpx>')).toThrow();
  });
});

describe('parseGpx : points sans position (muscu, lot I du 25/10)', () => {
  const hrPt = (time: string | null, bpm?: number) =>
    `<trkpt>${time ? `<time>${time}</time>` : ''}${bpm === undefined ? '' : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${bpm}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`}</trkpt>`;

  it('range dans timedPoints les points à l’heure sans position, FC comprise ; rawPoints vide', () => {
    const r = parseGpx(gpx(`<trk><type>muscu</type><trkseg>${hrPt('2026-10-01T10:00:00Z', 90)}${hrPt('2026-10-01T10:00:01Z')}</trkseg></trk>`));
    expect(r.rawPoints).toEqual([]);
    expect(r.timedPoints).toEqual([{ time: '2026-10-01T10:00:00Z', hr: 90 }, { time: '2026-10-01T10:00:01Z' }]);
  });

  it('un second <trkseg> pose segmentStart ; un point sans heure reste jeté', () => {
    const r = parseGpx(gpx(
      `<trk><trkseg>${hrPt('2026-10-01T10:00:00Z', 90)}${hrPt(null, 91)}</trkseg><trkseg>${hrPt(null, 92)}${hrPt('2026-10-01T10:05:00Z', 110)}</trkseg></trk>`
    ));
    expect(r.timedPoints.map((p) => p.hr)).toEqual([90, 110]);
    expect(r.timedPoints.map((p) => p.segmentStart === true)).toEqual([false, true]);
  });

  it('un GPX à positions garde les mêmes rawPoints, et des timedPoints vides', () => {
    // `rawTimeMs` : la date lue une fois (lot 56).
    const xml = gpx(`<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00Z', '<ele>3</ele>')}${pt(45, 5.001, '2026-10-01T10:00:01Z')}</trkseg>`
      + `<trkseg>${pt(45, 5.002, '2026-10-01T10:05:00Z')}</trkseg></trk>`);
    const r = parseGpx(xml);
    expect(r.timedPoints).toEqual([]);
    expect(r.rawPoints).toEqual([
      { lat: 45, lon: 5, time: '2026-10-01T10:00:00Z', rawTimeMs: Date.parse('2026-10-01T10:00:00Z'), ele: 3, speedMs: undefined, courseDeg: undefined, hr: undefined, cadence: undefined },
      { lat: 45, lon: 5.001, time: '2026-10-01T10:00:01Z', rawTimeMs: Date.parse('2026-10-01T10:00:01Z'), ele: undefined, speedMs: undefined, courseDeg: undefined, hr: undefined, cadence: undefined },
      { lat: 45, lon: 5.002, time: '2026-10-01T10:05:00Z', rawTimeMs: Date.parse('2026-10-01T10:05:00Z'), ele: undefined, speedMs: undefined, courseDeg: undefined, hr: undefined, cadence: undefined, segmentStart: true },
    ]);
  });

  it('date lue une fois : rawTimeMs vaut la date relue, NaN pour une date illisible', () => {
    const r = parseGpx(gpx(`<trk><trkseg>${pt(45, 5, '2026-10-01T10:00:00.123+02:00')}${pt(45, 5.001, 'pas une date')}</trkseg></trk>`));
    expect(r.rawPoints.map((p) => p.rawTimeMs)).toEqual(r.rawPoints.map((p) => new Date(p.time).getTime()));
    expect(r.rawPoints[1].rawTimeMs).toBeNaN();
  });
});

describe('parseGpx : un seul parcours des descendants par point (lot 56)', () => {
  /** Copie gelée de la recherche d'avant le lot 56 : nom qualifié, sinon premier descendant de ce nom local, champ par champ. */
  const frozenFind = (element: Element, localName: string): Element | null => {
    const direct = element.getElementsByTagName(localName)[0];
    if (direct) return direct;
    const all = element.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].localName === localName) return all[i];
    return null;
  };
  const frozenNumber = (element: Element, name: string): number | undefined => {
    const node = frozenFind(element, name);
    if (!node || node.textContent === null) return undefined;
    const value = parseFloat(node.textContent.trim());
    return isFinite(value) ? value : undefined;
  };

  it('mêmes champs que la recherche champ par champ : préfixes, doublons, nom qualifié imbriqué, champ illisible', () => {
    const inners = [
      '<ele>3</ele><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad><gpxtpx:speed>4.5</gpxtpx:speed><gpxtpx:course>91</gpxtpx:course></gpxtpx:TrackPointExtension></extensions>',
      // Un champ préfixé avant le même sans préfixe, imbriqué : le nom qualifié l'emporte.
      '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><x><hr>141</hr></x></gpxtpx:TrackPointExtension></extensions><ele>7</ele>',
      // Deux champs préfixés : le premier ; un premier illisible ne cède pas au suivant.
      '<extensions><gpxdata:speed xmlns:gpxdata="urn:x">abc</gpxdata:speed><gpxtpx:speed>5</gpxtpx:speed><a:cad xmlns:a="urn:a">70</a:cad><b:cad xmlns:b="urn:b">71</b:cad></extensions>',
      '<speed>6.2</speed><course>400</course><ele> 12.5 </ele>',
      '<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>3</gpxtpx:speed></gpxtpx:TrackPointExtension><speed>2</speed></extensions>',
    ];
    const xml = gpx(`<trk><trkseg>${inners.map((inner, k) => pt(45, 5 + k * 0.001, `2026-10-01T10:00:0${k}Z`, inner)).join('')}</trkseg></trk>`);
    const r = parseGpx(xml);
    const trkpts = new XmlDomParser().parseFromString(xml, 'application/xml').getElementsByTagName('trkpt');
    expect(r.rawPoints).toHaveLength(inners.length);
    r.rawPoints.forEach((p, k) => {
      const trkpt = trkpts[k] as unknown as Element;
      const speed = frozenNumber(trkpt, 'speed');
      const course = frozenNumber(trkpt, 'course');
      expect(p).toEqual({
        lat: 45, lon: 5 + k * 0.001, time: `2026-10-01T10:00:0${k}Z`, rawTimeMs: Date.parse(`2026-10-01T10:00:0${k}Z`),
        ele: frozenNumber(trkpt, 'ele'),
        speedMs: speed === undefined || speed < 0 || speed > 100 ? undefined : speed,
        courseDeg: course !== undefined && course >= 0 && course <= 360 ? course : undefined,
        hr: frozenNumber(trkpt, 'hr'),
        cadence: frozenNumber(trkpt, 'cad'),
      });
    });
    // Les cas voulus sont bien là.
    expect(r.rawPoints.map((p) => p.hr)).toEqual([150, 141, undefined, undefined, undefined]);
    expect(r.rawPoints.map((p) => p.speedMs)).toEqual([4.5, undefined, undefined, 6.2, 2]);
    expect(r.rawPoints[2].cadence).toBe(70);
  });
});
