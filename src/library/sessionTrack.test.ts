import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getSportProfile } from '../core/sportProfiles';
import { knotsToMs } from '../core/units';
import { fixesAlong, T0 } from '../test/geo.fixture';
import { sessionRecord } from '../test/record.fixture';
import { sessionColorTrack, sessionSpeedRange } from './sessionTrack';

/** GPX d'une trace droite vers l'est, un point par seconde à `speedMs` pendant `durationS`. */
const straightGpx = (speedMs: number, durationS: number, hz = 1): string => {
  const fixes = fixesAlong([[0, 0], [speedMs * durationS, 0]], speedMs / hz);
  const points = fixes.map((f, i) =>
    `<trkpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}"><time>${new Date(T0 + (i * 1000) / hz).toISOString()}</time></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
};

describe("bornes de couleur hors de l'analyse (vignettes, partage)", () => {
  const own = { minMs: 1, maxMs: 2 };
  const activity = { fixed: { minMs: 3, maxMs: 4 }, fallback: { minMs: 5, maxMs: 6 } };
  const suggested = { minMs: 7, maxMs: 8 };

  it("celles de la fiche, puis celles de l'activité, puis la suggestion, puis le défaut de l'activité", () => {
    const record = sessionRecord({ analysis: { speedRange: own } as never });
    expect(sessionSpeedRange(record, activity, 'voile', suggested)).toEqual(own);
    const bare = sessionRecord();
    expect(sessionSpeedRange(bare, activity, 'voile', suggested)).toEqual(activity.fixed);
    expect(sessionSpeedRange(bare, { ...activity, fixed: null }, 'voile', suggested)).toEqual(suggested);
    expect(sessionSpeedRange(bare, { ...activity, fixed: null }, 'course', null)).toEqual(activity.fallback);
  });

  it('une session à classer, sans activité : la suggestion en voile, sinon le calcul de la famille', () => {
    expect(sessionSpeedRange({ analysis: null, sport: 'wingfoil' }, null, 'voile', suggested)).toEqual(suggested);
    expect(sessionSpeedRange({ analysis: null, sport: null }, null, 'voile', null)).toEqual(getSportProfile('wingfoil').speedRange);
    expect(sessionSpeedRange({ analysis: null, sport: null }, null, 'velo', null)).toEqual(getSportProfile('cycling').speedRange);
    expect(sessionSpeedRange({ analysis: null, sport: 'surf' }, null, 'surf', null)).toEqual(getSportProfile('surf').speedRange);
  });
});

describe('trace colorée tirée du GPX', () => {
  // L'environnement de test est node, sans `DOMParser` : xmldom (dépendance de dev) en tient lieu.
  beforeAll(() => vi.stubGlobal('DOMParser', XmlDomParser));
  afterAll(() => vi.unstubAllGlobals());

  it('suggère des bornes en voile, pas à pied ; bateau aux siennes', () => {
    const gpx = straightGpx(knotsToMs(15), 120);
    const wing = sessionColorTrack(gpx, 'wingfoil', null, 'voile');
    expect(wing?.points.length).toBeGreaterThan(100);
    expect(wing?.suggested?.maxMs).toBeGreaterThan(knotsToMs(15));
    expect(sessionColorTrack(gpx, 'bateau', null, 'voile')?.suggested).toEqual(getSportProfile('bateau').speedRange);
    expect(sessionColorTrack(straightGpx(3, 120), 'running', null, 'course')?.suggested).toBeNull();
  });

  it('même vitesse de couleur à 1 Hz et à 5 Hz', () => {
    const at1 = sessionColorTrack(straightGpx(3, 120, 1), 'running', null, 'course')!;
    const at5 = sessionColorTrack(straightGpx(3, 120, 5), 'running', null, 'course')!;
    const mid = (t: typeof at1) => t.points[Math.floor(t.points.length / 2)].colorMs;
    expect(mid(at5)).toBeCloseTo(mid(at1), 1);
  });

  it('rien sous deux points', () => {
    const one = straightGpx(3, 10).replace(/(<\/trkpt>)<trkpt.*<\/trkpt>/, '$1');
    expect(one.match(/<trkpt/g)).toHaveLength(1);
    expect(sessionColorTrack(one, 'running', null, 'course')).toBeNull();
  });
});
