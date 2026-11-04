import { describe, expect, it } from 'vitest';
import { GPX_CORPUS, UNREADABLE_GPX } from '../test/gpx/corpus';
import { gpxOf, holeRaw, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { parseGpx } from './gpxParser';
import { computeKinematics, detectTrackDeviceSpeedUnit } from './kinematics';
import { kinematicsProfileOf, prepareRawTrack, prepareTrack, type PrepareTrackOptions } from './prepareTrack';
import {
  referenceSpeedMs as sessionReferenceSpeedMs,
  kinematicsOptionsOf,
  samplingIntervalS,
  scalesFiltersToSession,
} from './sessionSpeed';
import { buildCumulativeTrack } from './sessionStats';
import { getSportProfile } from './sportProfiles';
import type { RawTrackPoint, SportType } from './types';

/**
 * `prepareTrack` (lot 126 B) rend ce que `useGpxSession` dérivait en `useMemo` avant d'aller dans le worker : la
 * copie gelée ci-dessous est l'enchaînement du hook tel qu'il était (version 0.4.77), recopié tel quel. Égalité
 * stricte, à 1 Hz et à 5 Hz, en voile avec et sans allure imposée, à pied, sans profil, avec trou et pause.
 */

/** Copie gelée de l'enchaînement de `useGpxSession` avant le lot 126 B : ne pas la faire évoluer avec le code. */
const frozenHookChain = (gpxContent: string, { fileName = null, profile, referenceSpeedOverrideMs }: PrepareTrackOptions) => {
  const { rawPoints, trackName: name, hasDeviceSpeed } = parseGpx(gpxContent);
  const trackName = name ?? null;
  const deviceSpeedUnit = detectTrackDeviceSpeedUnit(rawPoints);
  const referenceSpeedMs = referenceSpeedOverrideMs ?? sessionReferenceSpeedMs(rawPoints, deviceSpeedUnit);
  const track = computeKinematics(
    rawPoints,
    profile ? kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs: referenceSpeedMs }) : {}
  );
  const cumulative = buildCumulativeTrack(track);
  const samplingS = samplingIntervalS(rawPoints);
  const sessionKey = track.length === 0 ? null : `${trackName ?? fileName ?? 'session'}|${track[0].timeMs}`;
  return { trackName, rawPoints, hasDeviceSpeed, deviceSpeedUnit, referenceSpeedMs, track, cumulative, samplingS, sessionKey };
};

const profileOf = (sport: SportType) => kinematicsProfileOf(getSportProfile(sport));

const sailGpx = (hz: number) => gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(4, 60), hz }));

describe('prepareTrack : mêmes sorties que l’enchaînement de useGpxSession', () => {
  for (const hz of [1, 5]) {
    it(`voile à ${hz} Hz, allure déduite puis imposée`, () => {
      const text = sailGpx(hz);
      const wing = profileOf('wingfoil');
      for (const options of [{ profile: wing, fileName: 'a.gpx' }, { profile: wing, referenceSpeedOverrideMs: 4.2, fileName: 'a.gpx' }]) {
        const prepared = prepareTrack(text, options);
        expect(prepared).toStrictEqual(frozenHookChain(text, options));
        expect(prepared.track.length).toBeGreaterThan(100);
      }
    });

    it(`à pied, sans profil, avec trou et pause, à ${hz} Hz`, () => {
      const raw = holeRaw(sailRaw({ windDeg: 0, legs: upDownLegs(2, 90), hz }), 60, 75);
      const paused: RawTrackPoint[] = raw.map((p, i) => (i === Math.floor(raw.length * 0.7) ? { ...p, segmentStart: true as const } : p));
      const text = gpxOf(paused);
      for (const options of [{ profile: profileOf('running') }, {}, { profile: profileOf('cycling'), fileName: 'v.gpx' }]) {
        expect(prepareTrack(text, options)).toStrictEqual(frozenHookChain(text, options));
      }
    });
  }

  it('sur chaque GPX lisible du corpus, au format de chaque éditeur', () => {
    for (const entry of GPX_CORPUS) {
      for (const options of [{ profile: profileOf('running'), fileName: 'c.gpx' }, { profile: profileOf('kite') }]) {
        expect(prepareTrack(entry.texte, options), entry.nom).toStrictEqual(frozenHookChain(entry.texte, options));
      }
    }
  });

  it('XML illisible : la même erreur que la lecture du GPX', () => {
    let refused = 0;
    for (const { nom, texte } of UNREADABLE_GPX) {
      let expected: unknown = null;
      try {
        parseGpx(texte);
      } catch (err) {
        expected = err;
      }
      if (expected === null) continue;
      refused += 1;
      expect(() => prepareTrack(texte), nom).toThrow((expected as Error).message);
    }
    expect(refused).toBeGreaterThan(5);
  });

  it('sans point : trace vide, ni clé ni cadence, l’allure imposée gardée', () => {
    expect(prepareRawTrack([], { trackName: null, hasDeviceSpeed: false }, { referenceSpeedOverrideMs: 3 })).toStrictEqual({
      trackName: null, rawPoints: [], hasDeviceSpeed: false, deviceSpeedUnit: null, referenceSpeedMs: 3, track: [],
      cumulative: { cumDist: [0], cumTime: [0] }, samplingS: 0, sessionKey: null,
    });
  });

  it('le profil réduit aux champs des filtres traverse un clonage structuré, résultat compris', () => {
    const text = sailGpx(5);
    const wing = profileOf('wingfoil');
    expect(Object.keys(wing).sort()).toEqual(['id', 'maxDetourRatio', 'maxGapS', 'maxPlausibleSpeedMs', 'medianWindowSeconds']);
    const prepared = prepareTrack(text, structuredClone({ profile: wing }));
    expect(structuredClone(prepared)).toStrictEqual(prepared);
  });
});
