import { describe, expect, it } from 'vitest';
import { prepareTrack } from '../core/prepareTrack';
import { gpxOf, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { failedState, gpxReading, preparedState, withSource, type GpxSource, type ShownGpx } from './useGpxSession';

/**
 * États de `useGpxSession` devenu asynchrone (lot 126 B) : « Lecture de la session… » tant qu'un autre fichier que
 * celui affiché se prépare ; la même source relue (allure, support) garde la trace affichée jusqu'au résultat ;
 * moins de deux points ou GPX illisible dits en clair, comme avant.
 */

const NOTHING: ShownGpx = { from: null, fileName: null, error: null, prepared: null };
const text = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(2, 60) }));
const a: GpxSource = { text, fileName: 'a.gpx' };
const b: GpxSource = { text, fileName: 'b.gpx' };

describe('useGpxSession : états de la lecture', () => {
  it('rien demandé : pas de lecture ; un fichier demandé : lecture jusqu’à sa trace', () => {
    expect(gpxReading({ source: null, shown: NOTHING })).toBe(false);
    const asked = withSource({ source: null, shown: NOTHING }, a);
    expect(asked.shown).toStrictEqual(NOTHING);
    expect(gpxReading(asked)).toBe(true);
    const done = { source: a, shown: preparedState(a, prepareTrack(a.text)) };
    expect(gpxReading(done)).toBe(false);
    expect(done.shown.fileName).toBe('a.gpx');
    expect(done.shown.error).toBeNull();
  });

  it('autre fichier : la trace affichée s’efface, lecture ; le même relu (dossier rouvert) : gardée', () => {
    const shownA = preparedState(a, prepareTrack(a.text));
    const other = withSource({ source: a, shown: shownA }, b);
    expect(other.shown).toStrictEqual(NOTHING);
    expect(gpxReading(other)).toBe(true);
    const again = withSource({ source: a, shown: shownA }, { text, fileName: 'a.gpx' });
    expect(again.shown).toBe(shownA);
    expect(gpxReading(again)).toBe(false);
  });

  it('le même texte redonné sous le même nom, ou sans nom, laisse l’état tel quel : rien n’est relu', () => {
    const a: GpxSource = { text, fileName: 'a.gpx' };
    const state = { source: a, shown: NOTHING };
    expect(withSource(state, { text, fileName: 'a.gpx' })).toBe(state);
    const loose = { source: { text, fileName: null }, shown: NOTHING };
    expect(withSource(loose, { text, fileName: null })).toBe(loose);
    expect(withSource(state, { text: text + ' ', fileName: 'a.gpx' })).not.toBe(state);
  });

  it('GPX hors de la mémoire (sans nom) : une autre source est un autre fichier', () => {
    const loose: GpxSource = { text, fileName: null };
    const shown = preparedState(loose, prepareTrack(loose.text));
    expect(gpxReading({ source: loose, shown })).toBe(false);
    expect(withSource({ source: loose, shown }, { text: `${text}
`, fileName: null }).shown).toStrictEqual(NOTHING);
  });

  it('moins de deux points horodatés, GPX illisible : dits en clair, sans lecture en cours', () => {
    const one = gpxOf(sailRaw({ windDeg: 0, legs: [{ twa: 90, durationS: 0 }] }));
    const few = preparedState(a, prepareTrack(one));
    expect(few.error).toBe('Le fichier ne contient pas assez de points horodatés.');
    let err: unknown = null;
    try {
      prepareTrack('<gpx>');
    } catch (e) {
      err = e;
    }
    const failed = failedState(a, err);
    expect(failed.error).toMatch(/illisible/);
    expect(failed.prepared).toBeNull();
    expect(failed.fileName).toBe('a.gpx');
    expect(gpxReading({ source: a, shown: failed })).toBe(false);
  });
});
