// @vitest-environment node
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LocationFix } from '../platform/location';
import { buildGpx } from '../recording/gpxWriter';
import { BASE_POINT_COUNT, GPX_CORPUS, UNREADABLE_GPX, basePoints, segmentsOf, type CorpusEntry } from '../test/gpx/corpus';
import { parseGpx as legacyParseGpx, parseGpxPath as legacyParseGpxPath } from '../test/gpxParser.legacy';
import { gpxOf, rawToGpx, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { parseGpx, parseGpxPath } from './gpxParser';

/**
 * Filet du lecteur GPX avant sa réécriture (lot 126) : sur le corpus de chaque éditeur (`test/gpx/corpus.ts`),
 * le lecteur rend, nombre à nombre, ce que rend la copie gelée du 04/11 (`test/gpxParser.legacy.ts`), refuse les
 * mêmes fichiers avec le même message, puis tire de chaque fichier les chiffres attendus par construction.
 */

// L'environnement de test est node, sans `DOMParser` : xmldom (dépendance de dev) en tient lieu, comme dans `gpxParser.test.ts`.
beforeAll(() => {
  vi.stubGlobal('DOMParser', XmlDomParser);
});

/** Résultat d'une lecture, ou son message d'erreur : deux lecteurs se comparent aussi sur ce qu'ils refusent. */
const outcome = <T,>(read: () => T): { value: T } | { error: string } => {
  try {
    return { value: read() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/** Sortie de l'enregistreur de Tracker (`buildGpx`) : la trace de base en deux segments, vitesse, cap, FC et cadence. */
const trackerEntry = (): CorpusEntry => {
  const fixes: LocationFix[] = basePoints().map((p) => ({
    lat: p.lat,
    lon: p.lon,
    timeMs: Date.parse(p.time!),
    altitudeM: p.ele,
    speedMs: p.speedMs,
    bearingDeg: p.courseDeg,
    heartRateBpm: p.hr,
    cadenceSpm: p.cad === undefined ? undefined : p.cad * 2,
  }));
  return {
    nom: 'Tracker (buildGpx), deux segments',
    texte: buildGpx(segmentsOf(fixes, 2), { name: 'Course, 01/10/2026 10:00', sport: 'running' }),
    attendu: { points: BASE_POINT_COUNT, segments: 2, hasDeviceSpeed: true, avecFc: true, trackName: 'Course, 01/10/2026 10:00', trackType: 'running' },
  };
};

const ENTRIES: CorpusEntry[] = [...GPX_CORPUS, trackerEntry()];

describe('corpus des éditeurs : même lecture que la copie gelée du 04/11', () => {
  it.each(ENTRIES.map((e) => [e.nom, e] as const))('%s', (_, entry) => {
    expect(outcome(() => parseGpx(entry.texte))).toEqual(outcome(() => legacyParseGpx(entry.texte)));
    expect(outcome(() => parseGpxPath(entry.texte))).toEqual(outcome(() => legacyParseGpxPath(entry.texte)));
  });

  // Sous xmldom, un XML mal formé lève l'erreur de xmldom : seule l'issue (refus ou lecture) se compare, pas son texte.
  it.each(UNREADABLE_GPX.map((e) => [e.nom, e.texte] as const))('fichier illisible « %s » : même issue', (_, texte) => {
    const kind = (o: { value: unknown } | { error: string }) => ('error' in o ? 'refus' : o);
    expect(kind(outcome(() => parseGpx(texte)))).toEqual(kind(outcome(() => legacyParseGpx(texte))));
    expect(kind(outcome(() => parseGpxPath(texte)))).toEqual(kind(outcome(() => legacyParseGpxPath(texte))));
  });

  // Le navigateur ne lève pas : il rend un document à `<parsererror>`, et le message est celui de l'application.
  it.each(UNREADABLE_GPX.map((e) => [e.nom, e.texte] as const))('fichier illisible « %s », comme dans le navigateur : même message', (_, texte) => {
    class BrowserLikeParser {
      parseFromString(text: string, type: string) {
        try {
          return new XmlDomParser().parseFromString(text, type as 'application/xml');
        } catch {
          return new XmlDomParser().parseFromString('<parsererror>XML mal formé</parsererror>', 'application/xml');
        }
      }
    }
    vi.stubGlobal('DOMParser', BrowserLikeParser);
    try {
      expect(outcome(() => parseGpx(texte))).toEqual(outcome(() => legacyParseGpx(texte)));
      expect(outcome(() => parseGpxPath(texte))).toEqual(outcome(() => legacyParseGpxPath(texte)));
    } finally {
      vi.stubGlobal('DOMParser', XmlDomParser);
    }
  });
});

describe('corpus des éditeurs : chiffres attendus par construction', () => {
  it.each(ENTRIES.map((e) => [e.nom, e] as const))('%s', (_, { texte, attendu }) => {
    if (attendu.refusSousXmldom !== undefined) {
      expect(() => parseGpx(texte)).toThrow(attendu.refusSousXmldom);
      return;
    }
    const parsed = parseGpx(texte);
    expect(parsed.rawPoints).toHaveLength(attendu.points);
    const segments = parsed.rawPoints.length === 0 ? 0 : 1 + parsed.rawPoints.filter((p) => p.segmentStart).length;
    expect(segments).toBe(attendu.segments);
    expect(parsed.hasDeviceSpeed).toBe(attendu.hasDeviceSpeed);
    expect(parsed.rawPoints.some((p) => p.hr !== undefined)).toBe(attendu.avecFc);
    expect(parsed.timedPoints).toEqual([]);
    if (attendu.trackName !== undefined) expect(parsed.trackName).toBe(attendu.trackName);
    if (attendu.trackType !== undefined) expect(parsed.trackType).toBe(attendu.trackType);
    // Les points gardés vont dans l'ordre du temps, et chacun porte sa date relue une fois.
    for (const p of parsed.rawPoints) expect(p.rawTimeMs).toBe(new Date(p.time).getTime());
    const times = parsed.rawPoints.map((p) => p.rawTimeMs!);
    expect(times.every((t, i) => i === 0 || t >= times[i - 1])).toBe(true);
    expect(parseGpxPath(texte).points).toHaveLength(attendu.chemin ?? attendu.points);
  });

  it('la trace de base garde ses valeurs : vitesse, cap, FC, cadence et altitude du format Garmin v2', () => {
    const entry = GPX_CORPUS.find((e) => e.nom.startsWith('Garmin gpxtpx: v2'))!;
    const base = basePoints();
    const parsed = parseGpx(entry.texte).rawPoints;
    expect(parsed.map((p) => [p.lat, p.lon, p.ele, p.speedMs, p.courseDeg, p.hr, p.cadence])).toEqual(
      base.map((p) => [p.lat, p.lon, p.ele, p.speedMs, p.courseDeg, p.hr, p.cad]),
    );
  });

  it('le décalage horaire et les fractions de seconde donnent les mêmes instants que la trace de base, à 250 ms près', () => {
    const entry = GPX_CORPUS.find((e) => e.nom.startsWith('heures décimales'))!;
    const base = basePoints();
    expect(parseGpx(entry.texte).rawPoints.map((p) => p.rawTimeMs)).toEqual(base.map((p) => Date.parse(p.time!) + 250));
  });

  it.each([1, 5])('gpxOf (aides de voile) : une session à %i Hz relue telle qu’écrite, la vitesse perdue au format Strava', (hz) => {
    const raw = sailRaw({ windDeg: 20, legs: upDownLegs(2, 30), hz });
    const simple = parseGpx(gpxOf(raw)).rawPoints;
    expect(simple.map((p) => [p.lat, p.lon, p.time, p.speedMs])).toEqual(raw.map((p) => [p.lat, p.lon, p.time, p.speedMs]));
    expect(gpxOf(raw)).toBe(rawToGpx(raw));
    const strava = parseGpx(gpxOf(raw, 'strava'));
    expect(strava.rawPoints).toHaveLength(raw.length);
    expect(strava.hasDeviceSpeed).toBe(false);
    expect(parseGpx(gpxOf(raw, 'garmin-v2')).rawPoints.map((p) => p.speedMs)).toEqual(raw.map((p) => p.speedMs));
  });

  it('un point mis en commentaire n’est pas lu, ni une heure en commentaire', () => {
    const entry = GPX_CORPUS.find((e) => e.nom === 'commentaires')!;
    const parsed = parseGpx(entry.texte).rawPoints;
    expect(parsed.some((p) => p.lat === 1)).toBe(false);
    expect(parsed[20].rawTimeMs).toBe(Date.parse(basePoints()[20].time!));
  });
});
