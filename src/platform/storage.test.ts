import { describe, expect, it } from 'vitest';
import { createJsonStore, type StorageBackend } from './storage';

/** Stockage en mémoire, qui se comporte comme `localStorage`. */
const memoryBackend = (initial: Record<string, string> = {}): StorageBackend & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

/** Stockage qui refuse tout, comme un navigateur aux données de site bloquées ou au quota plein. */
const failingBackend: StorageBackend = {
  getItem: () => {
    throw new Error('stockage bloqué');
  },
  setItem: () => {
    throw new Error('quota dépassé');
  },
};

describe('createJsonStore', () => {
  it('rend null pour une clé jamais écrite', () => {
    const store = createJsonStore(() => memoryBackend());
    expect(store.read('tracker.sportSettings')).toBeNull();
  });

  it('relit ce qu\'il a écrit', () => {
    const backend = memoryBackend();
    const store = createJsonStore(() => backend);
    const settings = { sport: 'windsurf', thresholds: { windsurf: 6.5 } };

    store.write('tracker.sportSettings', settings);

    expect(store.read('tracker.sportSettings')).toEqual(settings);
  });

  it('écrit le même JSON que l\'ancien accès direct, pour relire les données déjà enregistrées', () => {
    // Les réglages, notes et tailles de panneaux de l'utilisateur ont été
    // écrits par `localStorage.setItem(clé, JSON.stringify(valeur))` : le
    // format ne doit pas changer d'un octet.
    const value = { 'sailing.carte': { width: 640, height: 600 } };
    const backend = memoryBackend();
    createJsonStore(() => backend).write('tracker.panelSizes', value);

    expect(backend.data.get('tracker.panelSizes')).toBe(JSON.stringify(value));

    const legacy = memoryBackend({ 'tracker.panelSizes': JSON.stringify(value) });
    expect(createJsonStore(() => legacy).read('tracker.panelSizes')).toEqual(value);
  });

  it('rend null sur un JSON illisible au lieu de lever une erreur', () => {
    const store = createJsonStore(() => memoryBackend({ 'tracker.sections': '{"sailing": ' }));
    expect(store.read('tracker.sections')).toBeNull();
  });

  it('ne lève aucune erreur quand le stockage refuse de lire ou d\'écrire', () => {
    const store = createJsonStore(() => failingBackend);
    expect(store.read('tracker.sailingNotes')).toBeNull();
    expect(() => store.write('tracker.sailingNotes', { a: 1 })).not.toThrow();
  });

  it('absorbe aussi l\'erreur levée dès l\'accès au stockage', () => {
    const store = createJsonStore(() => {
      throw new Error('localStorage inaccessible');
    });
    expect(store.read('tracker.runnerProfile')).toBeNull();
    expect(() => store.write('tracker.runnerProfile', { me: {} })).not.toThrow();
  });
});
