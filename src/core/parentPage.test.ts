import { describe, expect, it } from 'vitest';
import {
  HOME_PATH, LEGACY_PROFILE_PATH, PROFILE_PATH, SETTINGS_SENSORS_PATH, analysisPath, legacyRedirect, libraryPath, parentPage, sessionFamily,
  settingsBlockFromSearch,
} from './parentPage';

describe('Réglages ouverts sur un bloc (lot 232)', () => {
  it("lit le bloc désigné par l'adresse de Réglages, rien sans paramètre", () => {
    expect(settingsBlockFromSearch(SETTINGS_SENSORS_PATH.slice(SETTINGS_SENSORS_PATH.indexOf('?')))).toBe('capteurs');
    expect(settingsBlockFromSearch('')).toBeNull();
    expect(settingsBlockFromSearch('?activite=x')).toBeNull();
  });

  it('Réglages ouverts par le lien de la ceinture renvoient à Enregistrer, sinon au Profil', () => {
    expect(SETTINGS_SENSORS_PATH).toBe('/parametres?bloc=capteurs');
    expect(parentPage('/parametres', '?bloc=capteurs')).toBe('/enregistrer');
    expect(parentPage('/parametres/', '?bloc=capteurs')).toBe('/enregistrer');
    expect(parentPage('/parametres', '?bloc=autre')).toBe(PROFILE_PATH);
    expect(parentPage('/parametres', '')).toBe(PROFILE_PATH);
  });
});

describe('parentPage', () => {
  it('rien au-dessus du Profil, la page de base, ancienne adresse comprise (lot 238)', () => {
    expect(PROFILE_PATH).toBe('/');
    expect(parentPage('/', '')).toBeNull();
    expect(parentPage('/', '?periode=annee')).toBeNull();
    expect(parentPage('/profil', '')).toBeNull();
    expect(parentPage('/profil/', '')).toBeNull();
  });

  it("l'accueil remonte au Profil (lot 238)", () => {
    expect(HOME_PATH).toBe('/accueil');
    expect(parentPage('/accueil', '')).toBe('/');
    expect(parentPage('/accueil/', '')).toBe('/');
  });

  it("l'analyse renvoie à la bibliothèque de sa famille", () => {
    expect(parentPage('/voile/analyse', '?session=a.gpx')).toBe('/voile');
    expect(parentPage('/course/analyse', '?session=b.gpx')).toBe('/course');
    expect(parentPage('/velo/analyse', '')).toBe('/velo');
    expect(parentPage('/fractionne/analyse', '?session=c.gpx')).toBe('/fractionne');
    expect(parentPage('/surf/analyse', '?session=d.gpx')).toBe('/surf');
  });

  it("l'analyse rend le filtre d'activité de la bibliothèque d'où l'on vient (lot 158)", () => {
    expect(parentPage('/course/analyse', '?session=b.gpx&activite=a-marche')).toBe('/course?activite=a-marche');
    expect(analysisPath('course', 'b.gpx', 'a-marche')).toBe('/course/analyse?session=b.gpx&activite=a-marche');
    expect(analysisPath('course', 'b.gpx', null)).toBe('/course/analyse?session=b.gpx');
    expect(analysisPath('course', null, 'a-marche')).toBe('/course/analyse');
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
    expect(parentPage('/course/seances', '')).toBe(HOME_PATH);
  });

  it('une leçon des tutoriels remonte à leur liste, la liste à Réglages (lot 147)', () => {
    expect(parentPage('/tutoriels/enregistrer', '')).toBe('/tutoriels');
    expect(parentPage('/tutoriels/voile/', '')).toBe('/tutoriels');
    expect(parentPage('/tutoriels', '')).toBe('/parametres');
  });

  it('Enregistrer en mode Timer renvoie à la liste du Timer', () => {
    expect(parentPage('/enregistrer', '?minuterie=1')).toBe('/fractionne/timer');
    expect(parentPage('/enregistrer', '?activite=a-course')).toBe(PROFILE_PATH);
  });

  it("une bibliothèque renvoie à l'accueil, filtre compris", () => {
    for (const family of ['voile', 'course', 'velo', 'fractionne', 'surf']) expect(parentPage(`/${family}`, '')).toBe('/accueil');
    expect(parentPage('/course', '?activite=a-marche')).toBe('/accueil');
    expect(parentPage('/velo', '?vue=planifiees')).toBe('/accueil');
  });

  it("Planifier, les itinéraires et une adresse inconnue sous une famille renvoient à l'accueil", () => {
    for (const p of ['/itineraires', '/itineraires/liste', '/voile/autre']) expect(parentPage(p, '')).toBe('/accueil');
    expect(parentPage('/itineraires', '?itineraire=x')).toBe('/accueil');
  });

  it('Enregistrer, Réglages, Statistiques et toute autre page renvoient au Profil (lot 238)', () => {
    for (const p of ['/enregistrer', '/parametres', '/statistiques', '/inconnue']) expect(parentPage(p, '')).toBe('/');
  });

  it('les Statistiques remontent d\'un cran, la période gardée', () => {
    expect(parentPage('/statistiques', '?famille=voile&activite=kite&periode=annee')).toBe('/statistiques?famille=voile&periode=annee');
    expect(parentPage('/statistiques', '?famille=voile&activite=kite')).toBe('/statistiques?famille=voile');
    expect(parentPage('/statistiques', '?famille=voile&periode=annee')).toBe('/statistiques?periode=annee');
    expect(parentPage('/statistiques', '?famille=velo')).toBe('/statistiques');
    expect(parentPage('/statistiques', '?periode=annee')).toBe(PROFILE_PATH);
    expect(parentPage('/statistiques', '')).toBe(PROFILE_PATH);
  });

  it('une barre oblique finale ne change rien', () => {
    expect(parentPage('/voile/analyse/', '')).toBe('/voile');
    expect(parentPage('/statistiques/', '?famille=surf')).toBe('/statistiques');
  });
});

describe('ancienne adresse du Profil (lot 238)', () => {
  it('renvoie `/profil` à la racine, paramètres gardés', () => {
    expect(LEGACY_PROFILE_PATH).toBe('/profil');
    expect(legacyRedirect('/profil', '')).toBe('/');
    expect(legacyRedirect('/profil/', '?periode=annee')).toBe('/?periode=annee');
  });

  it('laisse toute autre adresse', () => {
    for (const p of ['/', '/accueil', '/parametres', '/profil/autre', '/profils']) expect(legacyRedirect(p, '')).toBeNull();
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
