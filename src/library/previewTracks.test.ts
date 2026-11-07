import { describe, expect, it } from 'vitest';
import {
  PREVIEW_FORMAT_VERSION, decodePreview, encodePreview, parsePreviewDocument, previewEntriesToEvict, previewFingerprint,
  previewKey, roundPreviewPoints, unknownPreviewKeys, type PreviewTrack,
} from './previewTracks';

/** Boucle synthétique de `durationS` secondes à `hz` points par seconde, vitesse variable. */
const loop = (hz: number, durationS = 600): PreviewTrack['points'] => {
  const n = durationS * hz;
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { lat: 43.6 + 0.004 * Math.sin(a) + 1e-9 * i, lon: 3.87 + 0.006 * Math.cos(a), colorMs: 3 + Math.sin(3 * a) * 1.23456 };
  });
};

const track = (points: PreviewTrack['points']): PreviewTrack => ({
  zoom: 15,
  bounds: [[43.596, 3.864], [43.604, 3.876]],
  suggested: { minMs: 2.5, maxMs: 7.25 },
  points,
});

const fpOf = (overrides: Partial<Parameters<typeof previewFingerprint>[0]> = {}) => previewFingerprint({
  sport: 'wingfoil',
  referenceOverrideMs: null,
  family: 'voile',
  summary: { startMs: 1_000, endMs: 601_000, pointCount: 600 },
  ...overrides,
});

describe('empreinte d’une vignette gardée', () => {
  it('change avec le calcul, l’allure imposée, la famille et la trace', () => {
    const base = fpOf();
    expect(fpOf()).toBe(base);
    expect(fpOf({ sport: 'kite' })).not.toBe(base);
    expect(fpOf({ referenceOverrideMs: 4 })).not.toBe(base);
    expect(fpOf({ family: 'surf' })).not.toBe(base);
    expect(fpOf({ summary: { startMs: 1_000, endMs: 601_000, pointCount: 3000 } })).not.toBe(base);
    expect(fpOf({ summary: { startMs: 2_000, endMs: 601_000, pointCount: 600 } })).not.toBe(base);
  });

  it('clé : dossier et fichier', () => {
    expect(previewKey('Tracker', 'a.gpx')).toBe('Tracker|a.gpx');
    expect(previewKey(null, 'a.gpx')).not.toBe(previewKey('Tracker', 'a.gpx'));
  });
});

describe('codage des points', () => {
  it.each([1, 5])('aller-retour au millionième, à %i Hz', (hz) => {
    const points = loop(hz);
    const decoded = decodePreview(encodePreview(track(points), 'fp', 10));
    expect(decoded.points).toHaveLength(points.length);
    decoded.points.forEach((p, i) => {
      expect(Math.abs(p.lat - points[i].lat)).toBeLessThanOrEqual(5e-7 + 1e-12);
      expect(Math.abs(p.lon - points[i].lon)).toBeLessThanOrEqual(5e-7 + 1e-12);
      expect(Math.abs(p.colorMs - points[i].colorMs)).toBeLessThanOrEqual(5e-4 + 1e-12);
    });
    expect(decoded.zoom).toBe(15);
    expect(decoded.bounds).toEqual(track(points).bounds);
    expect(decoded.suggested).toEqual({ minMs: 2.5, maxMs: 7.25 });
  });

  it.each([1, 5])('points arrondis avant le dessin = points relus, à l’identique (%i Hz)', (hz) => {
    const rounded = roundPreviewPoints(loop(hz));
    // Passé par le JSON, comme sur l'appareil.
    const stored = JSON.parse(JSON.stringify(encodePreview(track(rounded), 'fp', 10)));
    expect(decodePreview(stored).points).toEqual(rounded);
    // Arrondir de nouveau ne change rien.
    expect(roundPreviewPoints(rounded)).toEqual(rounded);
  });

  it('range des entiers en écarts, petits', () => {
    const stored = encodePreview(track(roundPreviewPoints(loop(1))), 'fp', 10);
    expect(stored.lat[0]).toBe(Math.round(loop(1)[0].lat * 1e6));
    expect(Math.max(...stored.lat.slice(1).map(Math.abs))).toBeLessThan(100);
    expect([...stored.lat, ...stored.lon, ...stored.colorMs].every(Number.isInteger)).toBe(true);
  });
});

describe('document lu sur l’appareil', () => {
  const good = encodePreview(track(roundPreviewPoints(loop(1, 10))), 'fp', 10);

  it('relit un document bien formé', () => {
    const doc = JSON.parse(JSON.stringify({ version: PREVIEW_FORMAT_VERSION, entries: { 'x|a.gpx': good } }));
    expect([...parsePreviewDocument(doc).keys()]).toEqual(['x|a.gpx']);
  });

  it('illisible ou d’une autre version : vide', () => {
    expect(parsePreviewDocument(null).size).toBe(0);
    expect(parsePreviewDocument('texte').size).toBe(0);
    expect(parsePreviewDocument([]).size).toBe(0);
    expect(parsePreviewDocument({ version: PREVIEW_FORMAT_VERSION + 1, entries: { 'x|a.gpx': good } }).size).toBe(0);
    expect(parsePreviewDocument({ version: PREVIEW_FORMAT_VERSION }).size).toBe(0);
  });

  it('une entrée abîmée est oubliée seule', () => {
    const doc = {
      version: PREVIEW_FORMAT_VERSION,
      entries: {
        ok: good,
        sansEmpreinte: { ...good, fp: 3 },
        longueurs: { ...good, lon: good.lon.slice(1) },
        decimales: { ...good, lat: good.lat.map((v) => v + 0.5) },
        emprise: { ...good, bounds: [[1, 2]] },
        bornes: { ...good, suggested: { minMs: 'a', maxMs: 2 } },
        vide: { ...good, lat: [], lon: [], colorMs: [] },
        rien: null,
      },
    };
    expect([...parsePreviewDocument(doc).keys()]).toEqual(['ok']);
  });
});

describe('borne et nettoyage', () => {
  it('oublie les moins récemment vues d’abord, jusqu’à repasser sous la borne', () => {
    const entries = [
      { key: 'b', bytes: 400, usedAt: 20 },
      { key: 'a', bytes: 400, usedAt: 10 },
      { key: 'c', bytes: 400, usedAt: 30 },
    ];
    expect(previewEntriesToEvict(entries, 1200)).toEqual([]);
    expect(previewEntriesToEvict(entries, 1000)).toEqual(['a']);
    expect(previewEntriesToEvict(entries, 500)).toEqual(['a', 'b']);
  });

  it('retire les sessions inconnues et celles d’un autre dossier', () => {
    const keys = ['T|a.gpx', 'T|b.gpx', 'Autre|a.gpx', 'null|a.gpx'];
    expect(unknownPreviewKeys(keys, 'T', ['a.gpx', 'c.gpx'])).toEqual(['T|b.gpx', 'Autre|a.gpx', 'null|a.gpx']);
    expect(unknownPreviewKeys(keys, null, ['a.gpx'])).toEqual(['T|a.gpx', 'T|b.gpx', 'Autre|a.gpx']);
  });
});
