import { describe, expect, it } from 'vitest';
import {
  EMPTY_RUNNER_PROFILE, RUNNER_NAME_MAX, runnerAvatar, runnerHrSource, runnerName, type RunnerAvatar, type RunnerProfile,
} from './runnerProfile';

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
