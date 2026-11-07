import { describe, expect, it } from 'vitest';
import type { RawTrackPoint, SportType } from '../core/types';
import { gpxOf, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { SURF_FOIL_FLIGHTS, SURF_T0, SURF_TWO_WAVES, surfRaw } from '../test/surf.fixture';
import { phasesTrack } from '../test/track.fixture';
import { summarizeGpx } from './summarizeGpx';
import { summarizeSession, type SummaryOptions } from './summary';

/**
 * Garde du résumé (fiche 154, risque 2, lot 187) : le résumé d'une session de voile, de surf et d'une session sans
 * calcul est figé à l'octet, tel que le code d'avant le lot le rendait. Un déplacement de code, un profil neutre à la
 * place de la course, ne doivent rien y changer ; `SUMMARY_CALC_VERSION` ne bouge pas tant que ces chaînes tiennent.
 * Si un calcul change pour de bon, on relève les chaînes neuves et on augmente la version : jamais l'un sans l'autre.
 */

interface FrozenCase {
  raw: RawTrackPoint[];
  sport: SportType | null;
  options: SummaryOptions;
  /** `summarizeGpx` : le foil de l'activité, comme `summaryOptions` le lit. */
  foil: boolean | null;
}

/** FC régulière posée sur une trace : de 135 à 165 bpm, une ondulation toutes les 250 s environ. */
const withHeartRate = (raw: RawTrackPoint[]): RawTrackPoint[] => raw.map((p, i) => ({ ...p, hr: 150 + Math.round(15 * Math.sin(i / 40)) }));

const CASES: Record<string, FrozenCase> = {
  // Wingfoil bruité à graine : quatre bords de près puis quatre de largue, une minute chacun, avec FC.
  wingfoil: { raw: withHeartRate(sailRaw({ windDeg: 300, legs: upDownLegs(4, 60), seed: 11 })), sport: 'wingfoil', options: {}, foil: true },
  surf: { raw: surfRaw(SURF_TWO_WAVES), sport: 'surf', options: {}, foil: false },
  surfFoil: { raw: surfRaw(SURF_FOIL_FLIGHTS), sport: 'surf', options: { foil: true }, foil: true },
  // Session sans calcul (`sport` null) : FC et montée régulière, dix minutes.
  sansCalcul: { raw: withHeartRate(phasesTrack([[300, 3], [300, 2]], 1, { startMs: SURF_T0, climbPerS: 0.05 })), sport: null, options: {}, foil: null },
};

/** Résumés relevés sur le code d'avant le lot 187 (07/11, version 18 du calcul), `JSON.stringify` tel quel. */
const FROZEN_SESSION: Record<keyof typeof CASES, string> = {
  wingfoil: '{"calcVersion":18,"startMs":1780308000000,"endMs":1780308480000,"distanceM":3263.4180594255995,"movingTimeS":468,"movingDistanceM":3235.0855528132383,"inMotionS":480,"elevationGainM":null,"maxSpeedMs":8.679119618379104,"pointCount":481,"samplingS":1,"heartRate":{"avgBpm":150,"maxBpm":165,"coveredS":480,"histogram":{"fromBpm":135,"seconds":[41,31,21,19,15,14,14,12,9,8,9,7,9,9,7,8,13,10,10,12,12,10,12,14,12,16,14,18,22,30,42]}}}',
  surf: '{"calcVersion":18,"startMs":1789898400000,"endMs":1789898776000,"distanceM":323.20000000000886,"movingTimeS":24,"movingDistanceM":108.00000000001506,"elevationGainM":null,"maxSpeedMs":5.000000000004324,"pointCount":377,"samplingS":1,"waveCount":2,"longestWaveM":60.000000000016094,"longestFlightS":null,"flightS":null}',
  surfFoil: '{"calcVersion":18,"startMs":1789898400000,"endMs":1789898626000,"distanceM":283.60000000000855,"movingTimeS":40,"movingDistanceM":196.00000000001165,"elevationGainM":null,"maxSpeedMs":6.000000000008708,"pointCount":227,"samplingS":1,"waveCount":2,"longestWaveM":60.0000000000155,"longestFlightS":40,"flightS":40}',
  sansCalcul: '{"calcVersion":18,"startMs":1789898400000,"endMs":1789899000000,"distanceM":1499.999999999986,"movingTimeS":null,"movingDistanceM":null,"elevationGainM":30,"maxSpeedMs":3.0000000000133866,"pointCount":601,"samplingS":1,"heartRate":{"avgBpm":152,"maxBpm":165,"coveredS":600,"histogram":{"fromBpm":135,"seconds":[41,31,21,19,15,14,14,13,12,11,12,10,11,12,10,10,16,13,13,14,15,13,15,17,16,22,22,28,32,46,62]}}}',
};

/**
 * Les mêmes sessions passées par `summarizeGpx` (GPX au format Garmin v2, qui écrit altitude, FC et vitesse ;
 * réglages de l'activité sans seuil) : résumé avec son empreinte et ses réglages portés, calcul, titre.
 */
const FROZEN_GPX: Record<keyof typeof CASES, string> = {
  wingfoil: '{"summary":{"calcVersion":18,"startMs":1780308000000,"endMs":1780308480000,"distanceM":3263.4180594255995,"movingTimeS":468,"movingDistanceM":3235.0855528132383,"inMotionS":480,"elevationGainM":null,"maxSpeedMs":8.679119618379104,"pointCount":481,"samplingS":1,"heartRate":{"avgBpm":150,"maxBpm":165,"coveredS":480,"histogram":{"fromBpm":135,"seconds":[41,31,21,19,15,14,14,12,9,8,9,7,9,9,7,8,13,10,10,12,12,10,12,14,12,16,14,18,22,30,42]}},"optionsKey":"[null,null,null,null]","activitySettings":{"threshold":null}},"sport":"wingfoil","title":null}',
  surf: '{"summary":{"calcVersion":18,"startMs":1789898400000,"endMs":1789898776000,"distanceM":323.20000000000886,"movingTimeS":24,"movingDistanceM":108.00000000001506,"elevationGainM":null,"maxSpeedMs":5.000000000004324,"pointCount":377,"samplingS":1,"waveCount":2,"longestWaveM":60.000000000016094,"longestFlightS":null,"flightS":null,"optionsKey":"[null,null,false,null]","activitySettings":{"threshold":null,"foil":false}},"sport":"surf","title":null}',
  surfFoil: '{"summary":{"calcVersion":18,"startMs":1789898400000,"endMs":1789898626000,"distanceM":283.60000000000855,"movingTimeS":40,"movingDistanceM":196.00000000001165,"elevationGainM":null,"maxSpeedMs":6.000000000008708,"pointCount":227,"samplingS":1,"waveCount":2,"longestWaveM":60.0000000000155,"longestFlightS":40,"flightS":40,"optionsKey":"[null,null,true,null]","activitySettings":{"threshold":null,"foil":true}},"sport":"surf","title":null}',
  sansCalcul: '{"summary":{"calcVersion":18,"startMs":1789898400000,"endMs":1789899000000,"distanceM":1499.999999999986,"movingTimeS":null,"movingDistanceM":null,"elevationGainM":30,"maxSpeedMs":3.0000000000133866,"pointCount":601,"samplingS":1,"heartRate":{"avgBpm":152,"maxBpm":165,"coveredS":600,"histogram":{"fromBpm":135,"seconds":[41,31,21,19,15,14,14,13,12,11,12,10,11,12,10,10,16,13,13,14,15,13,15,17,16,22,22,28,32,46,62]}}},"sport":null,"title":null}',
};

describe('résumés de voile et de surf figés à l\'octet (garde du lot 187)', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`summarizeSession : ${name}`, () => {
      expect(JSON.stringify(summarizeSession(c.raw, c.sport, c.options))).toBe(FROZEN_SESSION[name]);
    });

    it(`summarizeGpx : ${name}`, () => {
      const activitySettings = c.sport === null ? {} : { [c.sport]: { thresholdOverride: undefined, foil: c.foil } };
      expect(JSON.stringify(summarizeGpx(gpxOf(c.raw, 'garmin-v2'), { sport: c.sport, analysis: null, activitySettings, elevation: null }))).toBe(FROZEN_GPX[name]);
    });
  }

  it('les chaînes figées portent bien FC et montée (garde-fou du test lui-même)', () => {
    expect(FROZEN_SESSION.wingfoil).toContain('"heartRate"');
    expect(FROZEN_SESSION.sansCalcul).toContain('"elevationGainM":30');
    expect(FROZEN_GPX.sansCalcul).toContain('"elevationGainM":30');
  });
});
