/**
 * XML et GPX : l'échappement des textes, et l'enveloppe d'un document GPX 1.1
 * (déclaration, ouverture, fermeture) que partagent l'enregistreur
 * (`recording/gpxWriter.ts`) et les itinéraires (`planning/routeGpx.ts`). Pur.
 */

/**
 * Caractères interdits en XML 1.0 : un seul suffit pour que le lecteur (`core/gpxParser.ts`) et le
 * navigateur refusent le fichier entier. Tabulation, saut de ligne et retour chariot restent permis.
 */
// eslint-disable-next-line no-control-regex
export const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\u{FFFE}\u{FFFF}]/u;
const INVALID_XML_CHARS_ALL = new RegExp(INVALID_XML_CHARS.source, 'gu');

/**
 * Texte sûr dans un contenu XML : `&`, `<` et `>` échappés, caractères interdits retirés (un nom collé
 * avec un caractère invisible rendrait sinon le GPX illisible, par l'application elle-même comprise).
 */
export const escapeXmlText = (text: string): string =>
  text.replace(INVALID_XML_CHARS_ALL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texte sûr dans un contenu ou un attribut XML : comme `escapeXmlText`, guillemets compris. */
export const escapeXmlAttr = (text: string): string => escapeXmlText(text).replace(/"/g, '&quot;');

const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';

/** Extension Garmin des points de trace (FC, cadence, vitesse, cap). */
export const GARMIN_TRACKPOINT_NAMESPACE = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v2';

/**
 * Document GPX 1.1 : `lines` est ce qu'il y a entre `<gpx>` et `</gpx>`.
 * `extraNamespaces` (préfixe → adresse) : sans eux, l'ouverture tient sur une
 * ligne ; avec eux, une ligne par espace de noms.
 */
export const gpxDocument = (lines: readonly string[], extraNamespaces: Readonly<Record<string, string>> = {}): string => {
  const extra = Object.entries(extraNamespaces).map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`);
  const open =
    extra.length === 0
      ? [`<gpx version="1.1" creator="Tracker" xmlns="${GPX_NAMESPACE}">`]
      : ['<gpx version="1.1" creator="Tracker"', `  xmlns="${GPX_NAMESPACE}"`, ...extra.map((ns, i) => `  ${ns}${i === extra.length - 1 ? '>' : ''}`)];
  return ['<?xml version="1.0" encoding="UTF-8"?>', ...open, ...lines, '</gpx>', ''].join('\n');
};
