import { describe, expect, it } from 'vitest';
import { kinematicsProfileOf, prepareTrack } from '../core/prepareTrack';
import { getSportProfile } from '../core/sportProfiles';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import { GPX_CORPUS } from '../test/gpx/corpus';
import { gpxOf, holeRaw, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { packPreparedTrack, pointsFromColumns, preparedTrackTransfer, trackColumns, unpackPreparedTrack } from './trackMessage';

/**
 * Trace préparée en colonnes (lot 235) : refaite côté page, elle est strictement celle du calcul, champs facultatifs
 * compris (présents à `undefined`, ou absents), même après un message qui transfère ses tableaux. Une trace d'une
 * autre forme part telle quelle.
 */

const wing = kinematicsProfileOf(getSportProfile('wingfoil'));

/** Le message tel que le reçoit la page : cloné, ses tableaux transférés. */
const throughMessage = <T>(message: T, transfer: ArrayBuffer[]): T => structuredClone(message, { transfer });

describe('packPreparedTrack et unpackPreparedTrack', () => {
  for (const hz of [1, 5]) {
    it(`voile à ${hz} Hz, avec trou, pause et allure imposée : strictement la même trace`, () => {
      const raw = holeRaw(sailRaw({ windDeg: 30, legs: upDownLegs(3, 60), hz }), 50, 70);
      const paused: RawTrackPoint[] = raw.map((p, i) => (i === Math.floor(raw.length * 0.6) ? { ...p, segmentStart: true as const } : p));
      const text = gpxOf(paused);
      for (const options of [{ profile: wing, fileName: 'a.gpx' }, { profile: wing, referenceSpeedOverrideMs: 3.3 }, {}]) {
        const prepared = prepareTrack(text, options);
        expect(prepared.track.some((p) => p.segmentStart)).toBe(true);
        // Le trou n'est borné qu'avec les filtres d'un profil (`maxGapS`).
        expect(prepared.track.some((p) => p.gapDistanceM !== undefined)).toBe('profile' in options);
        const message = packPreparedTrack(prepared);
        expect(message.columns).not.toBeNull();
        const unpacked = unpackPreparedTrack(throughMessage(message, preparedTrackTransfer(message)));
        expect(unpacked).toStrictEqual(prepared);
        // Les champs dans le même ordre aussi : un texte tiré d'un point (JSON) reste le même.
        expect(unpacked.track.map((p) => Object.keys(p).join())).toEqual(prepared.track.map((p) => Object.keys(p).join()));
      }
    });
  }

  it('sur chaque GPX lisible du corpus (FC, cadence, altitude, cap, Doppler) : strictement la même trace', () => {
    let packed = 0;
    for (const entry of GPX_CORPUS) {
      const prepared = prepareTrack(entry.texte, { profile: kinematicsProfileOf(getSportProfile('running')), fileName: 'c.gpx' });
      const message = packPreparedTrack(prepared);
      if (message.columns) packed += 1;
      expect(unpackPreparedTrack(structuredClone(message)), entry.nom).toStrictEqual(prepared);
    }
    expect(packed).toBeGreaterThan(5);
  });

  it('les tableaux transférés quittent le worker : il ne les garde pas', () => {
    const message = packPreparedTrack(prepareTrack(gpxOf(sailRaw({ windDeg: 0, legs: upDownLegs(1, 30) }))));
    const transfer = preparedTrackTransfer(message);
    expect(transfer.length).toBe(16);
    throughMessage(message, transfer);
    expect(message.cumDist.length).toBe(0);
  });

  it('trace vide : refaite vide', () => {
    const prepared = prepareTrack(gpxOf(sailRaw({ windDeg: 0, legs: [{ twa: 90, durationS: 0 }] })));
    expect(unpackPreparedTrack(structuredClone(packPreparedTrack(prepared)))).toStrictEqual(prepared);
  });
});

describe('trackColumns : une trace d’une autre forme part telle quelle', () => {
  const point: TrackPoint = {
    lat: 43.5, lon: 3.8, time: '2026-01-01T10:00:00Z', timeMs: Date.parse('2026-01-01T10:00:00Z'), ele: undefined, hr: 120,
    cadence: undefined, speedMs: 4, smoothedSpeedMs: 4, bearing: 90, courseDeg: 92, speedSource: 'doppler',
  };

  it('la forme de computeKinematics passe, refaite à l’identique', () => {
    const columns = trackColumns([point, { ...point, segmentStart: true, gapDistanceM: 12 }]);
    expect(columns).not.toBeNull();
    expect(pointsFromColumns(columns!)).toStrictEqual([point, { ...point, segmentStart: true, gapDistanceM: 12 }]);
  });

  it('heure en date, clé de plus, clé manquante, cap présent sans valeur : pas de colonnes, la trace rendue telle quelle', () => {
    const { ele: _ele, ...withoutEle } = point;
    const odd: TrackPoint[][] = [
      [{ ...point, time: new Date(point.timeMs) }],
      [{ ...point, extra: 1 } as TrackPoint],
      [withoutEle as TrackPoint],
      [{ ...point, courseDeg: undefined }],
    ];
    for (const track of odd) {
      expect(trackColumns(track)).toBeNull();
      const prepared = { ...prepareTrack(gpxOf(sailRaw({ windDeg: 0, legs: upDownLegs(1, 20) }))), track };
      const message = packPreparedTrack(prepared);
      expect(message.track).toBe(track);
      expect(unpackPreparedTrack(structuredClone(message))).toStrictEqual(prepared);
    }
  });
});
