import { describe, expect, it, vi } from 'vitest';
import { createLoadedListStore } from './loadedListStore';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createLoadedListStore (lot 158)', () => {
  it('ne lit qu\'une fois pour plusieurs pages montées sous la même clé', async () => {
    const list = vi.fn(async () => ['a', 'b']);
    const { store, ensure } = createLoadedListStore(list, String);
    ensure('dossier|1');
    ensure('dossier|1');
    ensure('dossier|1');
    expect(store.get().loaded).toBe(false);
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ items: ['a', 'b'], loaded: true, error: null });
  });

  it('relit quand la clé change et vide la liste le temps de la lecture', async () => {
    const list = vi.fn(async () => ['x']);
    const { store, ensure } = createLoadedListStore(list, String);
    ensure('un');
    await flush();
    ensure('deux');
    expect(store.get().loaded).toBe(false);
    expect(store.get().items).toEqual([]);
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('garde la liste affichée pendant une relecture après rangement, et jette une réponse périmée', async () => {
    let resolveFirst: (v: string[]) => void = () => undefined;
    const answers = [new Promise<string[]>((r) => { resolveFirst = r; }), Promise.resolve(['neuf'])];
    const list = vi.fn(() => answers.shift() ?? Promise.resolve([]));
    const { store, ensure, reload } = createLoadedListStore(list, String);
    ensure('k');
    reload();
    await flush();
    expect(store.get().items).toEqual(['neuf']);
    resolveFirst(['vieux']);
    await flush();
    expect(store.get().items).toEqual(['neuf']);
  });

  it('dit l\'erreur en clair sans marquer la liste lue', async () => {
    const { store, ensure } = createLoadedListStore(async () => { throw new Error('boum'); }, () => 'Lecture impossible.');
    ensure('k');
    await flush();
    expect(store.get()).toEqual({ items: [], loaded: false, error: 'Lecture impossible.' });
  });
});
