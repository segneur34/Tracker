import { describe, expect, it } from 'vitest';
import { analysisPath, libraryPath, parentPage, sessionFamily } from './parentPage';

describe('parentPage', () => {
  it("rien au-dessus de l'accueil", () => {
    expect(parentPage('/', '')).toBeNull();
  });

  it("l'analyse renvoie à la bibliothèque de sa famille", () => {
    expect(parentPage('/voile/analyse', '?session=a.gpx')).toBe('/voile');
    expect(parentPage('/course/analyse', '?session=b.gpx')).toBe('/course');
    expect(parentPage('/velo/analyse', '')).toBe('/velo');
    expect(parentPage('/fractionne/analyse', '?session=c.gpx')).toBe('/fractionne');
    expect(parentPage('/surf/analyse', '?session=d.gpx')).toBe('/surf');
  });

  it("une page de l'Entraînement remonte d'un cran, jusqu'à sa bibliothèque", () => {
    expect(parentPage('/fractionne/seances', '')).toBe('/fractionne');
    expect(parentPage('/fractionne/seances/editer', '?id=a')).toBe('/fractionne/seances');
    expect(parentPage('/fractionne/tests', '')).toBe('/fractionne');
    // Lot I du 25/10 : les tuiles des tests sont sous « Fractionné et tests ».
    expect(parentPage('/fractionne/tests/fc-max', '')).toBe('/fractionne/seances');
    expect(parentPage('/fractionne/tests/fc-repos', '')).toBe('/fractionne/seances');
    expect(parentPage('/fractionne/timer', '')).toBe('/fractionne');
    expect(parentPage('/fractionne/timer/editer', '?id=s1')).toBe('/fractionne/timer');
    expect(parentPage('/course/seances', '')).toBe('/');
  });

  it('Enregistrer en mode Timer renvoie à la liste du Timer', () => {
    expect(parentPage('/enregistrer', '?minuterie=1')).toBe('/fractionne/timer');
    expect(parentPage('/enregistrer', '?activite=a-course')).toBe('/');
  });

  it("une bibliothèque renvoie à l'accueil, filtre compris", () => {
    expect(parentPage('/voile', '')).toBe('/');
    expect(parentPage('/course', '?activite=a-marche')).toBe('/');
    expect(parentPage('/velo', '?vue=planifiees')).toBe('/');
  });

  it("les autres pages renvoient à l'accueil", () => {
    for (const p of ['/enregistrer', '/profil', '/parametres', '/itineraires', '/itineraires/liste', '/inconnue', '/voile/autre']) {
      expect(parentPage(p, '')).toBe('/');
    }
    expect(parentPage('/itineraires', '?itineraire=x')).toBe('/');
  });

  it('les Statistiques remontent d\'un cran, la période gardée', () => {
    expect(parentPage('/statistiques', '?famille=voile&activite=kite&periode=annee')).toBe('/statistiques?famille=voile&periode=annee');
    expect(parentPage('/statistiques', '?famille=voile&activite=kite')).toBe('/statistiques?famille=voile');
    expect(parentPage('/statistiques', '?famille=voile&periode=annee')).toBe('/statistiques?periode=annee');
    expect(parentPage('/statistiques', '?famille=velo')).toBe('/statistiques');
    expect(parentPage('/statistiques', '?periode=annee')).toBe('/');
    expect(parentPage('/statistiques', '')).toBe('/');
  });

  it('une barre oblique finale ne change rien', () => {
    expect(parentPage('/voile/analyse/', '')).toBe('/voile');
    expect(parentPage('/statistiques/', '?famille=surf')).toBe('/statistiques');
  });
});

describe('chemins de la bibliothèque et des analyses (lot 72)', () => {
  it("ouvre la bibliothèque d'une famille, filtrée sur une activité", () => {
    expect(libraryPath('voile')).toBe('/voile');
    expect(libraryPath('course', 'a-trail é')).toBe('/course?activite=a-trail%20%C3%A9');
  });

  it("ouvre l'analyse d'une famille, sur une session si elle est donnée", () => {
    expect(analysisPath('velo')).toBe('/velo/analyse');
    expect(analysisPath('surf', '2026-09-23 surf.gpx')).toBe('/surf/analyse?session=2026-09-23%20surf.gpx');
    expect(parentPage('/surf/analyse', '?session=x')).toBe('/surf');
  });

  it('range une session dans la famille de son calcul, une session à classer dans celle donnée', () => {
    expect(sessionFamily({ record: { sport: 'run-intervals' } }, 'course')).toBe('fractionne');
    expect(sessionFamily({ record: { sport: null } }, 'voile')).toBe('voile');
    expect(sessionFamily(undefined, 'velo')).toBe('velo');
  });
});
