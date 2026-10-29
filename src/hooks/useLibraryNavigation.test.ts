import { describe, expect, it } from 'vitest';
import { loadGpxOutcome } from './useLibraryNavigation';

describe("lecture du GPX d'une analyse (B2)", () => {
  it('rend le texte lu', async () => {
    expect(await loadGpxOutcome(Promise.resolve('<gpx/>'))).toEqual({ text: '<gpx/>' });
  });

  it('dit un GPX absent, sans relance', async () => {
    expect(await loadGpxOutcome(Promise.resolve(null))).toEqual({ error: 'GPX introuvable dans la mémoire.', retry: false });
  });

  it('dit une lecture qui lève, avec sa raison, et la fait refaire', async () => {
    expect(await loadGpxOutcome(Promise.reject(new Error('Accès au dossier refusé.'))))
      .toEqual({ error: 'Accès au dossier refusé.', retry: true });
    expect(await loadGpxOutcome(Promise.reject(new Error('')))).toEqual({ error: 'GPX illisible.', retry: true });
  });
});
