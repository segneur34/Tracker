import { describe, expect, it } from 'vitest';
import { shareableStats } from '../core/shareImage';
import type { SessionSummary } from './record';
import { SHARE_EXTRA_KEYS, shareExtraStats, summaryShareStats } from './shareStats';

const summary = (patch: Partial<SessionSummary> = {}): SessionSummary => ({
  calcVersion: 6,
  startMs: 0,
  endMs: 3600_000,
  distanceM: 10_000,
  movingTimeS: 3000,
  movingDistanceM: 9000,
  elevationGainM: 120,
  maxSpeedMs: 5,
  pointCount: 3600,
  samplingS: 1,
  ...patch,
});

const values = (stats: ReturnType<typeof summaryShareStats>) => Object.fromEntries(stats.map((s) => [s.key, s.value]));

describe('summaryShareStats', () => {
  it('donne à pied les chiffres de l\'onglet « général », sous les mêmes clés', () => {
    const v = values(summaryShareStats(summary(), 'course', { speed: 'kmh', distance: 'km' }));
    expect(v.distance).toBe('10,00 km');
    expect(v.totalTime).toBe('1 h 00');
    expect(v.activeTime).toBe('50 min');
    expect(v.movingAverage).toBe('10,8 km/h');
    expect(v.overallAverage).toBe('10,0 km/h');
    expect(v.elevationGain).toBe('+120 m');
  });

  it("surf sans vague : vitesse max « — », jamais 0 ; écartée de l'image", () => {
    const units = { speed: 'kmh', distance: 'km' } as const;
    const none = summaryShareStats(summary({ maxSpeedMs: 0, waveCount: 0 }), 'surf', units);
    expect(values(none).maxSpeed).toBe('—');
    expect(shareableStats(none).map((s) => s.key)).not.toContain('maxSpeed');
    expect(values(summaryShareStats(summary({ maxSpeedMs: 5 }), 'surf', units)).maxSpeed).toBe('18,0 km/h');
  });

  it('écarte, une fois filtrés, les chiffres que la session n\'a pas', () => {
    const stats = shareableStats(summaryShareStats(summary({ elevationGainM: null }), 'velo', { speed: 'kmh', distance: 'km' }));
    const keys = stats.map((s) => s.key);
    expect(keys).not.toContain('elevationGain');
    expect(keys).not.toContain('heartRate');
    expect(keys).not.toContain('cadence');
  });

  it('ajoute la FC et la cadence quand la session en a', () => {
    const v = values(summaryShareStats(summary({
      heartRate: { avgBpm: 151.6, maxBpm: 180, coveredS: 3000, histogram: { fromBpm: 150, seconds: [3000] } },
      cadence: { avgSpm: 171.2, steps: 8000 },
    }), 'course', { speed: 'minkm', distance: 'km' }));
    expect(v.heartRate).toBe('152 bpm');
    expect(v.cadence).toBe('171 pas/min');
  });

  it('donne en voile la moyenne active et les manœuvres, dans l\'unité de l\'activité', () => {
    const v = values(summaryShareStats(summary({ maneuverCount: 14 }), 'voile', { speed: 'kn', distance: 'nm' }));
    expect(v.activeAverage).toBe('5,8 nds');
    expect(v.maneuvers).toBe('14');
    expect(v.distance).toBe('5,40 NM');
  });

  it('donne en surf les vagues, sans vol hors foil', () => {
    const stats = shareableStats(summaryShareStats(summary({ waveCount: 12, longestWaveM: 84.4, longestFlightS: null }), 'surf', { speed: 'kmh', distance: 'km' }));
    const v = values(stats);
    expect(v.waves).toBe('12');
    expect(v.longestWave).toBe('84 m');
    expect(v.longestFlight).toBeUndefined();
  });
});

describe('lignes ajoutées du partage (lot 145)', () => {
  const kn = { speed: 'kn', distance: 'nm' } as const;
  const km = { speed: 'kmh', distance: 'km' } as const;
  const tail = (stats: ReturnType<typeof summaryShareStats>, n: number) => stats.slice(-n).map((s) => s.key);

  it('mêmes clés, à la fin, dans le résumé et dans l’analyse ouverte (`shareExtraStats`)', () => {
    for (const treatment of ['course', 'velo', 'surf', 'muscu'] as const) {
      const keys = SHARE_EXTRA_KEYS[treatment];
      expect(tail(summaryShareStats(summary(), treatment, km), keys.length)).toEqual([...keys]);
      expect(shareExtraStats(treatment, {}).map((s) => s.key)).toEqual([...keys]);
    }
    expect(tail(summaryShareStats(summary(), 'voile', kn, true, true), 4)).toEqual([...SHARE_EXTRA_KEYS.voile]);
    // Hors foil, pas de pumping.
    expect(tail(summaryShareStats(summary(), 'voile', kn), 3)).toEqual(['maneuverSuccess', 'wind', 'rating']);
  });

  it('une valeur absente vaut « — »', () => {
    const v = values(summaryShareStats(summary(), 'velo', km));
    expect(v.puissance).toBe('—');
    expect(v['top-t5min']).toBe('—');
    expect(v.rating).toBe('—');
  });

  it('voile : manœuvres réussies, vent, appréciation, sans emoji', () => {
    const v = values(summaryShareStats(summary({ maneuverResults: { tackSuccess: 4, tackFail: 1, jibeSuccess: 6, jibeFail: 1 }, windDirDeg: 230 }), 'voile', kn, true, false,
      { rating: 4, windLevel: 'moyen' }));
    expect(v.maneuverSuccess).toBe('83 % (10/12)');
    expect(v.wind).toBe('230° · moyen');
    expect(v.rating).toBe('Bien');
    // Le vent saisi dans la fiche passe avant celui de l'analyse.
    expect(values(summaryShareStats(summary({ windDirDeg: 230 }), 'voile', kn, true, false, { windDeg: 10 })).wind).toBe('10°');
    expect(values(summaryShareStats(summary(), 'voile', kn)).wind).toBe('—');
  });

  it('voile sur foil seulement : ratio de vol et part du vol pompée', () => {
    const foil = values(summaryShareStats(summary({ movingTimeS: 2700, inMotionS: 3000, pumpingShare: 0.35 }), 'voile', kn, true, true));
    expect(foil.activeRatio).toBe('90,0%');
    expect(foil.pumpingShare).toBe('35 % du vol');
    const notFoil = values(summaryShareStats(summary({ inMotionS: 3000, pumpingShare: 0.35 }), 'voile', kn, true, false));
    expect(notFoil.activeRatio).toBeUndefined();
    expect(notFoil.pumpingShare).toBeUndefined();
  });

  it('à pied, meilleur kilomètre en temps ; à vélo, meilleures 5 min et puissance', () => {
    expect(values(summaryShareStats(summary({ best1kmS: 272 }), 'course', km))['top-d1km']).toBe('4 min 32');
    const ride = values(summaryShareStats(summary({ best5minMs: 10, avgPowerW: 181.6 }), 'velo', km));
    expect(ride['top-t5min']).toBe('36,0 km/h');
    expect(ride.puissance).toBe('182 W');
  });
});
