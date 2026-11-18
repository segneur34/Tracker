import { describe, expect, it } from 'vitest';
import { statSession, surfStatSession } from '../test/record.fixture';
import { rootSessionTimeS } from './useProfileRoot';

describe('rootSessionTimeS', () => {
  it('surf : tout le temps à l\'eau, pauses déduites (1 h dont 10 min de pause = 50 min)', () => {
    const s = surfStatSession(0, { movingTimeS: 33, waterTimeS: 3000 });
    expect(rootSessionTimeS(s)).toBe(3000);
  });

  it('surf, vieille fiche sans le champ : la durée', () => {
    expect(rootSessionTimeS(surfStatSession(0, { movingTimeS: 33, waterTimeS: null }))).toBe(3600);
  });

  it('une course garde son temps en mouvement, sinon sa durée', () => {
    expect(rootSessionTimeS(statSession(0, { movingTimeS: 3000, waterTimeS: 100 }))).toBe(3000);
    expect(rootSessionTimeS(statSession(0, { movingTimeS: null }))).toBe(3600);
  });
});
