import { describe, expect, it } from 'vitest';
import { SPORT_PROFILES, activeRatioLabel } from '../core/sportProfiles';
import { DEFAULT_JUMP_PLACEMENT, defaultJumpSettings, sanitizeJumpSettings } from './jumpSettings';

const kite = SPORT_PROFILES.kite.jumps!;

describe('réglages des sauts', () => {
  it('sont mesurés en wingfoil, planche et kite, pas en bateau ni hors voile', () => {
    expect(SPORT_PROFILES.wingfoil.jumps).not.toBeNull();
    expect(SPORT_PROFILES.windsurf.jumps).not.toBeNull();
    expect(SPORT_PROFILES.kite.jumps).not.toBeNull();
    expect(SPORT_PROFILES.bateau.jumps).toBeNull();
    expect(SPORT_PROFILES.running.jumps).toBeNull();
    expect(SPORT_PROFILES['bike-intervals'].jumps).toBeNull();
  });

  it('partent décochés, téléphone sur la poitrine, à la hauteur minimale du calcul', () => {
    expect(defaultJumpSettings(kite)).toEqual({ enabled: false, placement: DEFAULT_JUMP_PLACEMENT, minHeightM: 1 });
    expect(defaultJumpSettings(SPORT_PROFILES.wingfoil.jumps!).minHeightM).toBe(0.5);
  });

  it('sont relus champ par champ, un champ mal formé reprenant sa valeur par défaut', () => {
    expect(sanitizeJumpSettings({ enabled: true, placement: 'bras', minHeightM: 2 }, kite)).toEqual({ enabled: true, placement: 'bras', minHeightM: 2 });
    expect(sanitizeJumpSettings({ enabled: 'oui', placement: 'cuisse', minHeightM: -1 }, kite)).toEqual(defaultJumpSettings(kite));
    expect(sanitizeJumpSettings({ enabled: true, minHeightM: 50 }, kite)).toEqual({ ...defaultJumpSettings(kite), enabled: true });
    expect(sanitizeJumpSettings(null, kite)).toBeNull();
    expect(sanitizeJumpSettings([true], kite)).toBeNull();
  });
});

describe('foil', () => {
  it("est coché d'office pour le wingfoil seulement", () => {
    expect(SPORT_PROFILES.wingfoil.foilDefault).toBe(true);
    expect(SPORT_PROFILES.windsurf.foilDefault).toBe(false);
    expect(SPORT_PROFILES.kite.foilDefault).toBe(false);
    expect(SPORT_PROFILES.bateau.foilDefault).toBe(false);
  });

  it('donne « Ratio de vol », sinon le libellé du calcul', () => {
    expect(activeRatioLabel(SPORT_PROFILES.kite, true)).toBe('Ratio de vol');
    expect(activeRatioLabel(SPORT_PROFILES.windsurf, false)).toBe('Ratio de planing');
    // Le wingfoil, foil coché par défaut, garde son « Ratio de vol ».
    expect(activeRatioLabel(SPORT_PROFILES.wingfoil, SPORT_PROFILES.wingfoil.foilDefault)).toBe('Ratio de vol');
    expect(activeRatioLabel(SPORT_PROFILES.wingfoil, false)).toBe('Ratio de navigation');
  });
});
