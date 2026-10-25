import { describe, expect, it } from 'vitest';
import {
  EMPTY_RUNNER_PROFILE, PROFILE_PROMPT_FIELDS, RUNNER_NAME_MAX, missingProfileFields, runnerAvatar, runnerHrSource, runnerName, shouldPromptProfile,
  type RunnerAvatar, type RunnerProfile,
} from './useRunnerProfile';

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

describe('runnerAvatar', () => {
  it('reprend un dessin connu et une photo réduite', () => {
    expect(runnerAvatar({ avatar: { kind: 'dessin', icon: 'kite' } })).toEqual({ kind: 'dessin', icon: 'kite' });
    const photo = { kind: 'photo' as const, dataUrl: 'data:image/jpeg;base64,AAAA' };
    expect(runnerAvatar({ avatar: photo })).toEqual(photo);
  });

  it('écarte un profil sans photo, un dessin inconnu, une adresse qui n’est pas une image ou une image trop lourde', () => {
    expect(runnerAvatar({})).toBeNull();
    expect(runnerAvatar({ avatar: null })).toBeNull();
    expect(runnerAvatar({ avatar: { kind: 'dessin', icon: 'pétanque' } as unknown as RunnerAvatar })).toBeNull();
    expect(runnerAvatar({ avatar: { kind: 'photo', dataUrl: 'https://exemple.fr/moi.jpg' } })).toBeNull();
    expect(runnerAvatar({ avatar: { kind: 'photo', dataUrl: `data:image/jpeg;base64,${'A'.repeat(300_000)}` } })).toBeNull();
  });
});

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

describe('runnerHrSource', () => {
  it("rend l'origine rangée avec la FC", () => {
    const profile: Partial<RunnerProfile> = { hrMax: 192, hrMaxSource: { kind: 'test', atMs: 1_000 }, hrRest: 48, hrRestSource: { kind: 'seance', atMs: null } };
    expect(runnerHrSource(profile, 'hrMax')).toEqual({ kind: 'test', atMs: 1_000 });
    expect(runnerHrSource(profile, 'hrRest')).toEqual({ kind: 'seance', atMs: null });
  });

  it("dit saisie une FC d'avant les origines, ou à l'origine mal formée", () => {
    expect(runnerHrSource({ hrMax: 185 }, 'hrMax')).toEqual({ kind: 'saisie', atMs: null });
    expect(runnerHrSource({ hrMax: 185, hrMaxSource: { kind: 'labo' } as unknown as RunnerProfile['hrMaxSource'] }, 'hrMax')).toEqual({ kind: 'saisie', atMs: null });
  });

  it('rend null sans FC', () => {
    expect(runnerHrSource({ ...EMPTY_RUNNER_PROFILE, hrMaxSource: { kind: 'test', atMs: 1 } }, 'hrMax')).toBeNull();
  });
});
