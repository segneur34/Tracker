import { describe, expect, it } from 'vitest';
import { RUNNER_NAME_MAX, runnerName } from './useRunnerProfile';

describe('runnerName', () => {
  it('rend le nom saisi, sans les espaces autour', () => {
    expect(runnerName({ name: '  Tom  ' })).toBe('Tom');
  });

  it('rend null sans nom, ou vide', () => {
    expect(runnerName({ name: null })).toBeNull();
    expect(runnerName({ name: '   ' })).toBeNull();
    expect(runnerName({} as { name: string | null })).toBeNull();
  });

  it('écarte une valeur qui n\'est pas du texte (fichier de réglages importé)', () => {
    expect(runnerName({ name: 42 as unknown as string })).toBeNull();
  });

  it('tronque un nom trop long', () => {
    expect(runnerName({ name: 'a'.repeat(60) })).toHaveLength(RUNNER_NAME_MAX);
  });
});
