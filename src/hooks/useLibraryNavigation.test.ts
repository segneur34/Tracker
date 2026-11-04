import { describe, expect, it } from 'vitest';
import { gpxLoadAction, loadGpxOutcome, sessionReading, type GpxLoadOutcome } from './useLibraryNavigation';

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

describe('suite donnée à une lecture terminée (lot 157)', () => {
  const text: GpxLoadOutcome = { text: '<gpx/>' };
  const missing: GpxLoadOutcome = { error: 'GPX introuvable dans la mémoire.', retry: false };
  const thrown: GpxLoadOutcome = { error: 'Accès au dossier refusé.', retry: true };

  it('page quittée : la lecture est abandonnée, quel que soit son résultat', () => {
    expect(gpxLoadAction(text, false)).toBe('drop');
    expect(gpxLoadAction(missing, false)).toBe('drop');
    expect(gpxLoadAction(thrown, false)).toBe('drop');
  });

  it("dit l'erreur, et fait refaire une lecture qui a levé", () => {
    expect(gpxLoadAction(missing, true)).toBe('error');
    expect(gpxLoadAction(thrown, true)).toBe('retry');
  });

  it('remet le texte lu au module', () => {
    expect(gpxLoadAction(text, true)).toBe('deliver');
  });
});

describe('session en cours de lecture (lot 157)', () => {
  it('aucune session demandée : rien à lire', () => {
    expect(sessionReading({ requested: null, ready: true, known: true, deliveredFor: null, error: null })).toBe(false);
  });

  it('session demandée, trace pas encore remise : en lecture', () => {
    expect(sessionReading({ requested: 'a.gpx', ready: true, known: true, deliveredFor: null, error: null })).toBe(true);
  });

  it('trace remise : la lecture est finie', () => {
    expect(sessionReading({ requested: 'a.gpx', ready: true, known: true, deliveredFor: 'a.gpx', error: null })).toBe(false);
  });

  it("autre session demandée après une première : en lecture jusqu'à sa trace", () => {
    expect(sessionReading({ requested: 'b.gpx', ready: true, known: true, deliveredFor: 'a.gpx', error: null })).toBe(true);
  });

  it('session connue de la bibliothèque prête, pas encore remise : en lecture', () => {
    expect(sessionReading({ requested: 'a.gpx', ready: true, known: true, deliveredFor: null, error: null })).toBe(true);
  });

  it("mémoire pas prête (non autorisée, perdue, en ouverture) ou session inconnue : la page reste muette", () => {
    expect(sessionReading({ requested: 'a.gpx', ready: false, known: false, deliveredFor: null, error: null })).toBe(false);
    expect(sessionReading({ requested: 'a.gpx', ready: false, known: true, deliveredFor: null, error: null })).toBe(false);
    expect(sessionReading({ requested: 'a.gpx', ready: true, known: false, deliveredFor: null, error: null })).toBe(false);
  });

  it("erreur (session absente, GPX illisible) : l'erreur est dite, pas la lecture", () => {
    expect(sessionReading({ requested: 'a.gpx', ready: true, known: true, deliveredFor: null, error: "Cette session n'est pas dans la mémoire." })).toBe(false);
  });
});
