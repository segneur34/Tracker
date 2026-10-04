import { describe, expect, it } from 'vitest';
import { batchLines, overpassErrorMessage, overpassQuery, parseOverpassWays } from './overpass';

const p = (i: number) => ({ lat: 43.6 + i * 0.0002, lon: 3.85 });
const line = (from: number, n: number) => Array.from({ length: n }, (_, i) => p(from + i));

describe('Overpass', () => {
  it('demande les voies le long de chaque ligne, avec leurs étiquettes et leur tracé', () => {
    expect(overpassQuery([[p(0), p(1)], [p(5)]], 25)).toBe(
      '[out:json][timeout:90];(way[highway](around:25,43.600000,3.850000,43.600200,3.850000);' +
        'way[highway](around:25,43.601000,3.850000););out tags geom;'
    );
  });

  it('répartit les lignes en paquets bornés, une ligne coupée partageant un point', () => {
    const batches = batchLines([line(0, 5), line(10, 3)], 4);
    // 5 points : 4, puis 2 dont le point de coupe ; 3 points : 2 en fin de paquet, puis 2 dont le point de coupe.
    expect(batches.map((b) => b.map((l) => l.length))).toEqual([[4], [2, 2], [2]]);
    // Le morceau suivant repart du dernier point du précédent.
    expect(batches[1][0][0]).toEqual(batches[0][0][3]);
    expect(batches[2][0][0]).toEqual(batches[1][1][1]);
    expect(batchLines([line(0, 3), line(10, 2)], 1000)).toEqual([[line(0, 3), line(10, 2)]]);
  });

  it('lit les voies, étiquettes réduites au revêtement, et écarte les éléments illisibles', () => {
    const ways = parseOverpassWays({
      elements: [
        { type: 'way', id: 1, tags: { highway: 'track', tracktype: 'grade2', name: 'Chemin' }, geometry: [{ lat: 43.6, lon: 3.85 }, { lat: 43.601, lon: 3.85 }] },
        { type: 'way', id: 2, tags: { highway: 'path' }, geometry: [{ lat: 43.6, lon: 3.85 }] },
        { type: 'node', id: 3, lat: 43.6, lon: 3.85 },
      ],
    });
    expect(ways).toEqual([{ id: 1, tags: 'highway=track tracktype=grade2', geometry: [{ lat: 43.6, lon: 3.85 }, { lat: 43.601, lon: 3.85 }] }]);
  });

  it('refuse une réponse incomplète ou illisible, et traduit les erreurs', () => {
    expect(() => parseOverpassWays({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 91 seconds.' })).toThrow(/pas pu finir/);
    expect(() => parseOverpassWays('<html>')).toThrow(/illisible/);
    expect(overpassErrorMessage(429)).toMatch(/occupé/);
    expect(overpassErrorMessage(504)).toMatch(/occupé/);
    expect(overpassErrorMessage(400)).toMatch(/erreur 400/);
  });
});
