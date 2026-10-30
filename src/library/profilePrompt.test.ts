import { describe, expect, it } from 'vitest';
import { EMPTY_RUNNER_PROFILE } from '../running/runnerProfile';
import { PROFILE_PROMPT_FIELDS, missingProfileFields, profilePromptGate, shouldPromptProfile } from './profilePrompt';

describe('missingProfileFields', () => {
  const full = { ...EMPTY_RUNNER_PROFILE, name: 'Tom', birthYear: 1985, sex: 'm' as const, weightKg: 72, heightCm: 178 };

  it('rend les cinq champs pour un profil vide, dans leur ordre', () => {
    expect(missingProfileFields(EMPTY_RUNNER_PROFILE)).toEqual([...PROFILE_PROMPT_FIELDS]);
  });

  it('ne rend rien pour un profil rempli, FC comprises ou non', () => {
    expect(missingProfileFields(full)).toEqual([]);
    expect(missingProfileFields({ ...full, hrMax: null, hrRest: null })).toEqual([]);
  });

  it("compte un nom fait d'espaces comme manquant", () => {
    expect(missingProfileFields({ ...full, name: '   ' })).toEqual(['name']);
  });

  it("compte une valeur importée hors plage ou d'un autre type comme manquante", () => {
    expect(missingProfileFields({ ...full, weightKg: 5, heightCm: '178' as unknown as number })).toEqual(['weightKg', 'heightCm']);
    expect(missingProfileFields({ ...full, sex: 'x' as unknown as 'f' })).toEqual(['sex']);
  });
});

describe('shouldPromptProfile', () => {
  const base = { native: true, missing: ['name'] as const, askedThisLaunch: false, otherCardShown: false };

  it("s'ouvre dans l'application, un champ manquant, pas encore ouvert à ce lancement", () => {
    expect(shouldPromptProfile(base)).toBe(true);
  });

  it("ne s'ouvre ni dans le navigateur, ni profil rempli, ni deux fois par lancement", () => {
    expect(shouldPromptProfile({ ...base, native: false })).toBe(false);
    expect(shouldPromptProfile({ ...base, missing: [] })).toBe(false);
    expect(shouldPromptProfile({ ...base, askedThisLaunch: true })).toBe(false);
  });

  it("ne s'ouvre pas par-dessus la carte de la mémoire ou des autorisations", () => {
    expect(shouldPromptProfile({ ...base, otherCardShown: true })).toBe(false);
  });
});

describe('profilePromptGate : mémoire, autorisations, puis profil', () => {
  const ready = { memoryNeedsAction: false, memoryReady: true };

  it('attend la lecture des autorisations', () => {
    expect(profilePromptGate({ ...ready, permissionsShown: null }).mount).toBe(false);
  });

  it("n'est pas posé tant que la mémoire n'est pas prête", () => {
    expect(profilePromptGate({ memoryNeedsAction: false, memoryReady: false, permissionsShown: false }).mount).toBe(false);
  });

  it('se tait derrière la carte de la mémoire', () => {
    expect(profilePromptGate({ memoryNeedsAction: true, memoryReady: false, permissionsShown: null })).toEqual({ mount: true, otherCardShown: true });
  });

  it('se tait derrière la carte des autorisations', () => {
    expect(profilePromptGate({ ...ready, permissionsShown: true })).toEqual({ mount: true, otherCardShown: true });
  });

  it('passe en dernier quand les deux sont réglées', () => {
    expect(profilePromptGate({ ...ready, permissionsShown: false })).toEqual({ mount: true, otherCardShown: false });
  });
});
