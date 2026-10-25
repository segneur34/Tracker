import { describe, expect, it } from 'vitest';
import { parentPage } from './parentPage';

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
    expect(parentPage('/fractionne/tests/fc-max', '')).toBe('/fractionne/tests');
    expect(parentPage('/fractionne/tests/fc-repos', '')).toBe('/fractionne/tests');
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
