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
 * Filet du lecteur GPX réécrit sans `DOMParser` (lot 126) : sur le corpus de chaque éditeur (`test/gpx/corpus.ts`),
 * le lecteur rend, nombre à nombre, ce que rend la copie gelée du 04/11 (`test/gpxParser.legacy.ts`), refuse les
 * mêmes fichiers avec le même message, puis tire de chaque fichier les chiffres attendus par construction.
 *
 * Écart voulu : le BOM en tête est ignoré (décision 1 du 04/11, comme le navigateur) ; xmldom refusait la déclaration
 * qui le suit, donc la copie gelée lit ce texte BOM retiré.
 */

// L'environnement de test est node, sans `DOMParser` : xmldom (dépendance de dev) en tient lieu pour la copie gelée.
beforeAll(() => {
  vi.stubGlobal('DOMParser', XmlDomParser);
});

/** Le texte sans son BOM de tête : ce que la copie gelée lit pour comparer (écart voulu, plus haut). */
const withoutBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

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
    expect(outcome(() => parseGpx(entry.texte))).toEqual(outcome(() => legacyParseGpx(withoutBom(entry.texte))));
    expect(outcome(() => parseGpxPath(entry.texte))).toEqual(outcome(() => legacyParseGpxPath(withoutBom(entry.texte))));
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

const GPX11 = 'http://www.topografix.com/GPX/1/1';
const T = (s: number) => `2026-10-01T10:00:${String(s).padStart(2, '0')}Z`;
const doc = (body: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="${GPX11}"${extra}>${body}</gpx>`;
const seg = (points: string) => `<trk><name>Trace</name><trkseg>${points}</trkseg></trk>`;

/** XML bien formé, mais loin des éditeurs : le nouveau lecteur doit y lire ce que lisait le DOM. */
const EDGE_CASES: [string, string][] = [
  ['entités et CDATA dans le nom et l’heure', doc(`<trk><name>A &amp; B &lt;&#233;&#x45;&gt; &quot;&apos;</name><trkseg><trkpt lat="45" lon="5"><time>2026-10-01T10:00:0&#48;Z</time></trkpt><trkpt lat="45" lon="5.001"><time><![CDATA[${T(1)}]]></time></trkpt></trkseg></trk>`)],
  ['commentaire et instruction dans l’heure', doc(seg(`<trkpt lat="45" lon="5"><time>2026-10-01T10:00<!-- x -->:02Z<?pi y?></time></trkpt>`))],
  ['CRLF et CR dans le nom, tabulations', doc(`<trk><name>\tLigne 1\r\nLigne 2\rLigne 3 </name><trkseg><trkpt lat="45" lon="5"><time>${T(0)}</time></trkpt></trkseg></trk>`)],
  ['attributs entre apostrophes, dans l’autre ordre, blancs autour de =', doc(seg(`<trkpt lon='5' lat='45'><time>${T(0)}</time></trkpt><trkpt lon = "5.001"  lat= '45' ><time>${T(1)}</time></trkpt >`))],
  ['référence numérique dans lat, entité inconnue dans lon', doc(seg(`<trkpt lat="&#52;5" lon="5"><time>${T(0)}</time></trkpt><trkpt lat="45" lon="&x;5"><time>${T(1)}</time></trkpt>`))],
  ['point fermé sur lui-même, sans heure', doc(seg(`<trkpt lat="45" lon="5"/><trkpt lat="45" lon="5.001"/><trkpt lat="45" lon="5.002"><time/></trkpt>`))],
  ['gpx:trkpt préfixé ignoré', doc(seg(`<g:trkpt lat="1" lon="1"><time>${T(0)}</time></g:trkpt><trkpt lat="45" lon="5"><time>${T(1)}</time></trkpt>`), ' xmlns:g="urn:g"')],
  ['élément dans l’heure et dans l’altitude', doc(seg(`<trkpt lat="45" lon="5"><time>2026-10-01<b>T10:00:03</b>Z</time><ele>1<x:y xmlns:x="urn:x">2</x:y>.5</ele></trkpt>`))],
  ['point dans un point, champs pris par les deux', doc(seg(`<trkpt lat="45" lon="5"><trkpt lat="46" lon="6"><time>${T(1)}</time><hr>99</hr></trkpt><time>${T(2)}</time><ele>3</ele></trkpt>`))],
  ['point racine', `<trkpt lat="45" lon="5"><time>${T(0)}</time><trkpt lat="46" lon="6"><time>${T(1)}</time></trkpt></trkpt>`],
  ['champ préfixé avant le même sans préfixe, champ vide en premier', doc(seg(`<trkpt lat="45" lon="5"><time>${T(0)}</time><e:hr xmlns:e="urn:e">150</e:hr><extensions><hr>151</hr></extensions><cad></cad><cad>80</cad></trkpt>`))],
  ['nom préfixé en premier enfant, nom vide en premier', doc(`<trk><e:name xmlns:e="urn:e">Préfixé</e:name><name>Second</name><type/><type>running</type><trkseg><trkpt lat="45" lon="5"><time>${T(0)}</time></trkpt></trkseg></trk>`)],
  ['trk imbriqué ailleurs, avant la vraie trace', doc(`<extensions><trk><name>Dans les extensions</name></trk></extensions>${seg(`<trkpt lat="45" lon="5"><time>${T(0)}</time></trkpt>`)}`)],
  ['nom de la route, puis des métadonnées', doc(`<metadata><name>Méta</name></metadata><rte><rtept lat="45" lon="5"><ele>10</ele></rtept><rtept lat="45" lon="5.01"/></rte>`)],
  ['nom des métadonnées seul, une trace d’un point et une route', doc(`<metadata><name> Méta </name></metadata><trk><trkseg><trkpt lat="45" lon="5"/></trkseg></trk><rte><name/><rtept lat="45" lon="5"/><rtept lat="45" lon="5.01"/></rte>`)],
  ['DOCTYPE à sous-ensemble, instruction et commentaires autour de la racine', `<?xml version="1.0"?>\n<!DOCTYPE gpx [ <!ENTITY e "v"> <!-- ] > --> ]>\n<?xml-stylesheet href="a.xsl"?><!-- avant -->${doc(seg(`<trkpt lat="45" lon="5"><time>${T(0)}</time></trkpt>`)).replace(/^<\?xml[^>]*\?>/, '')}<!-- après -->\n<?fin ?>\n`],
  ['entité déclarée dans le DOCTYPE gardée telle quelle', `<!DOCTYPE gpx [<!ENTITY nom "Sortie">]>${doc(`<trk><name>&nom;</name></trk>`).replace(/^<\?xml[^>]*\?>/, '')}`],
  ['& seul et entité inconnue gardés', doc(`<trk><name>Pêche & voile &amp &inconnue; &#xZZ;</name></trk>`)],
  ['> dans une valeur d’attribut et dans un texte', doc(`<trk desc="a > b"><name>c > d</name><trkseg><trkpt lat="45" lon="5" x="&gt;"><time>${T(0)}</time></trkpt></trkseg></trk>`)],
  ['heure qui recule, égale, illisible ; segments vides', doc(`<trk><trkseg/><trkseg><trkpt lat="45" lon="5"><time>${T(5)}</time></trkpt><trkpt lat="45" lon="5"><time>${T(5)}</time></trkpt></trkseg><trkseg><trkpt lat="45" lon="5"><time>${T(4)}</time></trkpt><trkpt lat="45" lon="5"><time>jamais</time></trkpt><trkpt lat="45" lon="5"><time>${T(6)}</time></trkpt></trkseg></trk>`)],
  ['points sans position (muscu), FC préfixée', doc(`<trk><type>muscu</type><trkseg><trkpt><time>${T(0)}</time><extensions><g:hr>90</g:hr></extensions></trkpt></trkseg><trkseg><trkpt><time>${T(9)}</time></trkpt></trkseg></trk>`, ' xmlns:g="urn:g"')],
  ['<parsererror> dans un document bien formé', doc(`<parsererror>x</parsererror>${seg(`<trkpt lat="45" lon="5"><time>${T(0)}</time></trkpt>`)}`)],
  ['<parsererror> préfixé', doc(`<p:parsererror xmlns:p="urn:p">x</p:parsererror>${seg(`<trkpt lat="45" lon="5"><time>${T(0)}</time></trkpt>`)}`)],
];

describe('cas limites du XML : même lecture que la copie gelée', () => {
  it.each(EDGE_CASES)('%s', (nom, texte) => {
    // Tous lisibles, sauf le `<parsererror>` sans préfixe, refusé comme avant.
    expect('error' in outcome(() => parseGpx(texte))).toBe(nom === '<parsererror> dans un document bien formé');
    expect(outcome(() => parseGpx(texte))).toEqual(outcome(() => legacyParseGpx(texte)));
    expect(outcome(() => parseGpxPath(texte))).toEqual(outcome(() => legacyParseGpxPath(texte)));
  });
});

describe('fichier tronqué : même issue que la copie gelée, coupé tous les 37 caractères', () => {
  const kind = (o: { value: unknown } | { error: string }) => ('error' in o ? 'refus' : o);
  /** xmldom sans ses messages en console : des centaines de refus attendus. */
  class QuietXmlDom extends XmlDomParser {
    constructor() {
      super({ onError: () => {} });
    }
  }

  // Des centaines de lectures par fichier, en double : au-delà des 5 s par défaut quand toute la suite tourne en parallèle.
  const TRUNCATED_TIMEOUT_MS = 30_000;

  it.each(['Garmin Connect (ns3:, FC et cadence)', 'commentaires', 'Tracker (buildGpx), deux segments'])('%s', (nom) => {
    const texte = ENTRIES.find((e) => e.nom === nom)!.texte;
    vi.stubGlobal('DOMParser', QuietXmlDom);
    try {
      const cuts = [...Array.from({ length: Math.ceil(texte.length / 37) }, (_, k) => k * 37), texte.length];
      for (const cut of cuts) {
        const part = texte.slice(0, cut);
        expect(kind(outcome(() => parseGpx(part))), `coupé à ${cut}`).toEqual(kind(outcome(() => legacyParseGpx(part))));
        expect(kind(outcome(() => parseGpxPath(part))), `coupé à ${cut}`).toEqual(kind(outcome(() => legacyParseGpxPath(part))));
      }
    } finally {
      vi.stubGlobal('DOMParser', XmlDomParser);
    }
  }, TRUNCATED_TIMEOUT_MS);
});

describe('corpus des éditeurs : chiffres attendus par construction', () => {
  it.each(ENTRIES.map((e) => [e.nom, e] as const))('%s', (_, { texte, attendu }) => {
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
