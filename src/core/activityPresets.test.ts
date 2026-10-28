import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES, GRAVEL_ACTIVITY, MARCHE_ACTIVITY, VTT_ACTIVITY, baseActivity } from './activities';
import { DEFAULT_INTERVAL_PRESETS, PRESET_BASES, presetOf } from './activityPresets';
import { kmhToMs, knotsToMs } from './units';

describe('presetOf', () => {
  it('une activité de départ qui a son pré-réglage le garde en entier, sans reprendre celui du calcul', () => {
    const marche = presetOf(MARCHE_ACTIVITY);
    expect(marche.threshold).toBe(0.5);
    expect(marche.heartRate).toBeUndefined(); // la course, elle, le porte
    expect(presetOf(baseActivity('running')).heartRate).toBe(true);
    expect(presetOf(GRAVEL_ACTIVITY).bikeType).toBe('gravel');
    expect(presetOf(VTT_ACTIVITY).tabs).toEqual({ tops: false });
  });

  it('une activité créée par l\'utilisateur prend le pré-réglage de son calcul', () => {
    const trail = { id: 'a-trail', name: 'Trail', base: 'running' as const };
    expect(presetOf(trail)).toBe(presetOf(baseActivity('running')));
    expect(presetOf(trail).wayTypes).toEqual(['sentier', 'piste']);
    const fixie = { id: 'a-fixie', name: 'Fixie', base: 'cycling' as const };
    expect(presetOf(fixie).bikeKg).toBe(12);
  });

  it('une activité créée sur le wingfoil ou la planche reprend les 8 nœuds', () => {
    for (const base of ['wingfoil', 'windsurf'] as const) {
      const p = presetOf({ id: `a-${base}-2`, base });
      expect(p.threshold).toBe(8);
      expect(p.speedRangeMs?.minMs).toBeCloseTo(knotsToMs(8), 9);
    }
  });

  it('un calcul sans pré-réglage rend un objet vide, toujours le même', () => {
    const a = presetOf({ id: 'a-kite', base: 'kite' });
    expect(a).toEqual({});
    expect(presetOf({ id: 'autre', base: 'kite' })).toBe(a);
  });

  it('chaque pré-réglage de calcul porte des bornes de couleur croissantes et des unités connues', () => {
    for (const base of PRESET_BASES) {
      const p = presetOf({ id: `test-${base}`, base });
      if (p.speedRangeMs) expect(p.speedRangeMs.minMs).toBeLessThan(p.speedRangeMs.maxMs);
      if (p.gradeRange) expect(p.gradeRange.min).toBeLessThan(p.gradeRange.max);
      if (p.autoPause) expect(p.autoPause.delayS).toBeGreaterThan(0);
    }
  });

  it('toutes les activités de départ rendent un pré-réglage sans surprise', () => {
    for (const activity of DEFAULT_ACTIVITIES) expect(() => presetOf(activity)).not.toThrow();
    expect(presetOf(MARCHE_ACTIVITY).pace?.customFlatSpeedMs).toBeCloseTo(kmhToMs(5), 9);
  });
});

describe("notification de l'Entraînement (26/10)", () => {
  it("fractionné à pied, à vélo et tests : l'étape d'office, avec la FC, deux chiffres au plus", () => {
    for (const base of ['run-intervals', 'bike-intervals', 'run-test'] as const) {
      expect(presetOf(baseActivity(base)).notificationFields).toEqual(['step', 'heartRate']);
      // Une activité créée sur ces calculs les reprend.
      expect(presetOf({ id: `a-${base}-2`, base }).notificationFields).toEqual(['step', 'heartRate']);
    }
    expect(presetOf(baseActivity('running')).notificationFields).toBeUndefined();
  });

  it('muscu : ceinture d’office, FC et durée en direct, étape et FC dans la notification (lot I du 25/10)', () => {
    const muscu = presetOf(baseActivity('muscu'));
    expect(muscu.heartRate).toBe(true);
    expect(muscu.liveFields).toEqual(['heartRate', 'heartRateZone', 'averageHeartRate', 'duration']);
    expect(muscu.notificationFields).toEqual(['step', 'heartRate']);
    expect(muscu.speedRangeMs).toBeUndefined();
    expect(PRESET_BASES).toContain('muscu');
  });
});

describe('PRESET_BASES', () => {
  it('liste les calculs qui ont un pré-réglage, voile à la planche comprise', () => {
    expect(PRESET_BASES).toEqual(expect.arrayContaining(['wingfoil', 'windsurf', 'running', 'cycling', 'run-intervals', 'run-test', 'bike-intervals']));
    expect(PRESET_BASES).not.toContain('kite');
  });
});

describe('DEFAULT_INTERVAL_PRESETS', () => {
  it('trois séances aux identifiants distincts', () => {
    expect(new Set(DEFAULT_INTERVAL_PRESETS.map((s) => s.id)).size).toBe(3);
  });
});
