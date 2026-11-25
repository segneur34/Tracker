import { describe, expect, it } from 'vitest';
import { SPORT_PROFILES } from '../../core/sportProfiles';
import type { WaveSense } from '../../surfing/waveSense';
import { waveSenseOrigin, waveSenseView } from './waveSenseView';

const MIN_R = SPORT_PROFILES.surf.surf!.waveSense.minR;

describe('waveSenseOrigin : la mention des deux endroits', () => {
  it('dit calculé, peu sûr, saisi, ou saisi avec le calculé rappelé', () => {
    expect(waveSenseOrigin({ manual: false, reliable: true, autoDeg: null })).toBe('calculé');
    expect(waveSenseOrigin({ manual: false, reliable: false, autoDeg: null })).toBe('calculé · peu sûr');
    expect(waveSenseOrigin({ manual: true, reliable: true, autoDeg: null })).toBe('saisi');
    expect(waveSenseOrigin({ manual: true, reliable: true, autoDeg: 182 })).toBe('saisi · calculé 182°');
  });
});

const estimated = (directionDeg: number, R: number, reliable: boolean): WaveSense => ({ directionDeg, R, samples: 5, reliable, source: 'estime' });

describe('waveSenseView : saisi lu dans le brouillon, calculé dans l’analyse', () => {
  it('un sens saisi prime tout de suite, même si l’analyse porte encore l’ancien', () => {
    expect(waveSenseView(120, estimated(200, 0.9, true), MIN_R)).toEqual({ shownDeg: 120, manual: true, reliable: true, autoDeg: 200 });
  });

  it('saisi sans calcul exploitable : pas de calculé rappelé', () => {
    expect(waveSenseView(90, null, MIN_R).autoDeg).toBeNull();
    expect(waveSenseView(90, estimated(200, 0.3, false), MIN_R).autoDeg).toBeNull();
  });

  it('rien de saisi : le calculé est montré, sûr ou non', () => {
    expect(waveSenseView(null, estimated(200.4, 0.9, true), MIN_R)).toEqual({ shownDeg: 200, manual: false, reliable: true, autoDeg: null });
    expect(waveSenseView(null, estimated(359.6, 0.6, false), MIN_R)).toEqual({ shownDeg: 0, manual: false, reliable: false, autoDeg: null });
  });

  it('rien de saisi et calcul trop dispersé ou absent : non estimé', () => {
    expect(waveSenseView(null, estimated(200, 0.3, false), MIN_R).shownDeg).toBeNull();
    expect(waveSenseView(null, null, MIN_R).shownDeg).toBeNull();
  });
});
