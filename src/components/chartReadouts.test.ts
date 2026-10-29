import { describe, expect, it } from 'vitest';
import { SAILING_SPEED_COLOR, SPEED_COLOR } from './chartStyle';
import { heartRateReadout, speedReadout } from './chartReadouts';
import { HEART_RATE_COLOR } from './heartRateColors';

describe('heartRateReadout', () => {
  it('arrondit la FC et la donne dans la couleur de la courbe', () => {
    expect(heartRateReadout(141.6, '12:03')).toEqual({ values: [{ text: '142 bpm', color: HEART_RATE_COLOR }], at: '12:03' });
  });

  it('un tiret sans valeur, null ou absente', () => {
    expect(heartRateReadout(null, 'x').values[0].text).toBe('—');
    expect(heartRateReadout(undefined, 'x').values[0].text).toBe('—');
  });

  it('une FC de 0 reste une valeur', () => {
    expect(heartRateReadout(0, 'x').values[0].text).toBe('0 bpm');
  });
});

describe('speedReadout', () => {
  it('bleu de la vitesse par défaut, celui de la voile au choix', () => {
    expect(speedReadout('12,3 km/h', '10:00')).toEqual({ values: [{ text: '12,3 km/h', color: SPEED_COLOR }], at: '10:00' });
    expect(speedReadout('18 nds', '10:00', SAILING_SPEED_COLOR).values[0].color).toBe(SAILING_SPEED_COLOR);
  });
});
