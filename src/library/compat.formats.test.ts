import { describe, expect, it } from 'vitest';
import { isWritableRouteRecord, parseRouteRecord, routeToRecord } from '../planning/routeRecord';
import { parseJournal } from '../recording/journal';
import { PREVIEW_FORMAT_VERSION, parsePreviewDocument } from './previewTracks';
import { PREVIEW_IMAGE_INDEX_VERSION, parsePreviewImageIndex } from './previewImages';
import { bundleSessionGpx, unbundleSessionGpx } from './sessionBundle';
import { serializeRecord } from './record';
import { sessionRecord } from '../test/record.fixture';

const route = (over: Record<string, unknown> = {}) => JSON.stringify({
  format: 'tracker-itineraire', version: 3, name: 'Tour', activityId: null, createdAt: 'a', updatedAt: 'b',
  waypoints: [{ lat: 43, lon: 3 }, { lat: 43.1, lon: 3.1 }], legs: [{ mode: 'straight', points: [[43, 3], [43.1, 3.1]], futurTroncon: 1 }],
  ...over,
});

describe('itinéraire, compatibilité', () => {
  it('(a) version future : lue, non réécrivable', () => {
    const r = parseRouteRecord(route({ version: 4 }))!;
    expect(isWritableRouteRecord(r)).toBe(false);
  });
  it('(b) point mal typé : fiche entière ignorée ; nom vide : « Itinéraire »', () => {
    expect(parseRouteRecord(route({ waypoints: [{ lat: '43', lon: 3 }, { lat: 43.1, lon: 3.1 }] }))).toBeNull();
    expect(parseRouteRecord(route({ name: '' }))?.name).toBe('Itinéraire');
  });
  it('(c) __proto__ sans pollution ; champ inconnu de tronçon perdu à la réécriture', () => {
    const r = parseRouteRecord(route().replace('"name"', '"__proto__":{"pollue":true},"name"'))!;
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    const again = routeToRecord({ waypoints: r.waypoints, legs: [{ mode: 'straight', status: 'ready', points: [{ lat: 43, lon: 3 }, { lat: 43.1, lon: 3.1 }] }] } as never,
      { name: 'Tour', activityId: null, createdAt: 'a', updatedAt: 'c' }, r);
    expect((again.legs[0] as unknown as Record<string, unknown>).futurTroncon).toBeUndefined();
  });
  it('BOM : retiré ; CRLF : lue', () => {
    expect(parseRouteRecord('﻿' + route())).not.toBeNull();
    expect(parseRouteRecord(route().replace(/,/g, ',\r\n'))).not.toBeNull();
  });
});

describe('journal, compatibilité', () => {
  const header = '{"format":"tracker-journal","version":1,"sport":"wingfoil","startedAtMs":1000}';
  it('(a) version future lue comme v1, ligne inconnue ignorée', () => {
    const j = parseJournal(`${header.replace('"version":1', '"version":9')}\n[2000,43,3]\n["futur",1]\n[3000,43.1,3.1]\n`);
    expect(j.header?.version).toBe(1);
    expect(j.fixes.length).toBe(2);
  });
  it('(b) position mal typée ignorée, dernière ligne tronquée ignorée', () => {
    const j = parseJournal(`${header}\n["2000",43,3]\n[3000,43.1,3.1]\n[4000,43.2`);
    expect(j.fixes.map((f) => f.timeMs)).toEqual([3000]);
  });
  it('CRLF lu ; BOM : retiré, en-tête gardé', () => {
    expect(parseJournal(`${header}\r\n[2000,43,3]\r\n`).fixes.length).toBe(1);
    const b = parseJournal(`﻿${header}\n[2000,43,3]\n`);
    expect(b.header).not.toBeNull();
    expect(b.fixes.length).toBe(1);
  });
  it('(c) __proto__ dans une note : sans pollution', () => {
    parseJournal(`${header}\n["note",{"__proto__":{"pollue":true},"timeMs":2000,"lat":43,"lon":3,"label":null}]\n`);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
  });
});

describe('vignettes, compatibilité', () => {
  const entry = { fp: 'x', usedAt: 1, zoom: 12, bounds: [[43, 3], [44, 4]], suggested: null, lat: [1], lon: [1], colorMs: [1] };
  it('(a) version future : document vide ; (b) entrée mal typée écartée seule', () => {
    expect(parsePreviewDocument({ version: PREVIEW_FORMAT_VERSION + 1, entries: { a: entry } }).size).toBe(0);
    const m = parsePreviewDocument({ version: PREVIEW_FORMAT_VERSION, entries: { a: entry, b: { ...entry, lat: ['1'] } } });
    expect([...m.keys()]).toEqual(['a']);
    expect(parsePreviewImageIndex({ version: PREVIEW_IMAGE_INDEX_VERSION + 1, entries: {} }).size).toBe(0);
  });
  it('(c) __proto__ comme clé : sans pollution', () => {
    parsePreviewDocument(JSON.parse(`{"version":${PREVIEW_FORMAT_VERSION},"entries":{"__proto__":${JSON.stringify(entry)}}}`));
    expect(({} as Record<string, unknown>).fp).toBeUndefined();
  });
});

describe('GPX complet, compatibilité (sessionBundle)', () => {
  const gpx = '<?xml version="1.0"?>\n<gpx version="1.1">\n<trk><name>T</name><trkseg><trkpt lat="43" lon="3"><time>2026-09-23T12:00:00Z</time></trkpt></trkseg></trk>\n</gpx>\n';
  const rec = sessionRecord({ name: 'Ma sortie', notes: { foil: '', mast: '', wing: '', gear1: '', gear2: '', conditions: '', gear: null, windLevel: null, waterState: null, rating: 4, comment: 'super', savedAt: 1 } });
  it('aller-retour exact', () => {
    const b = unbundleSessionGpx(bundleSessionGpx(gpx, rec, new Uint8Array([1, 2, 3])));
    expect(b.gpx).toBe(gpx);
    expect(b.record?.notes?.comment).toBe('super');
    expect([...(b.motion ?? [])]).toEqual([1, 2, 3]);
  });
  it('CRLF : fiche et capteurs relus, GPX gardé retouché (nom écrit dedans)', () => {
    const b = unbundleSessionGpx(bundleSessionGpx(gpx, rec, new Uint8Array([1])).replace(/\n/g, '\r\n'));
    expect(b.record?.name).toBe('Ma sortie');
    expect(b.motion).not.toBeNull();
    expect(b.gpx).not.toBe(gpx.replace(/\n/g, '\r\n'));
    expect(b.gpx).toContain('Ma sortie');
  });
  it('BOM : fiche relue, BOM gardé dans le GPX', () => {
    const b = unbundleSessionGpx('﻿' + bundleSessionGpx(gpx, rec, null));
    expect(b.record?.name).toBe('Ma sortie');
    expect(b.gpx.startsWith('﻿')).toBe(true);
  });
  it('fiche d\'une version future dans le paquet : non lue, son texte gardé (lot 148, C5-4)', () => {
    const b = unbundleSessionGpx(bundleSessionGpx(gpx, { ...rec, version: 2 }, null));
    expect(b.record).toBeNull();
    expect(b.recordText).toBe(serializeRecord({ ...rec, version: 2 }));
    expect(b.gpx).toBe(gpx);
  });
  it('bloc réindenté (guillemets simples) : non reconnu, fiche perdue', () => {
    const b = unbundleSessionGpx(bundleSessionGpx(gpx, rec, null).replace(/xmlns:tracker="([^"]*)"/, "xmlns:tracker='$1'"));
    expect(b.record).toBeNull();
  });
});
