import { describe, expect, it } from 'vitest';
import { downloadBaseName, guessSport, uniqueSessionFileName } from './naming';

describe('uniqueSessionFileName', () => {
  it("garde le nom s'il est libre, sinon ajoute un numéro", () => {
    expect(uniqueSessionFileName('a.gpx', [])).toBe('a.gpx');
    expect(uniqueSessionFileName('a.gpx', ['a.gpx'])).toBe('a-2.gpx');
    expect(uniqueSessionFileName('a.gpx', ['a.gpx', 'a-2.gpx'])).toBe('a-3.gpx');
  });

  it('écarte aussi un nom dont la fiche est prise', () => {
    expect(uniqueSessionFileName('a.gpx', ['a.json'])).toBe('a-2.gpx');
  });

  it('écarte aussi un nom dont les capteurs sont restés seuls', () => {
    expect(uniqueSessionFileName('a.gpx', ['a.imu'])).toBe('a-2.gpx');
  });

  it('ignore la casse, comme Windows', () => {
    expect(uniqueSessionFileName('Sortie.gpx', ['sortie.GPX'])).toBe('Sortie-2.gpx');
  });
});

describe('guessSport', () => {
  it('reconnaît nos supports tels que notre GPX les écrit', () => {
    expect(guessSport('wingfoil')).toBe('wingfoil');
    expect(guessSport('bateau')).toBe('bateau');
    expect(guessSport('cycling')).toBe('cycling');
  });

  it('reconnaît les types des autres applications, quelle que soit leur graphie', () => {
    expect(guessSport('running')).toBe('running');
    expect(guessSport('Trail Running')).toBe('running');
    expect(guessSport('trail_running')).toBe('running');
    expect(guessSport('Windsurfing')).toBe('windsurf');
    expect(guessSport('kitesurfing')).toBe('kite');
    expect(guessSport('Road Cycling')).toBe('cycling');
    expect(guessSport('mountain_biking')).toBe('cycling');
    expect(guessSport('Ride')).toBe('cycling');
    expect(guessSport('Surfing')).toBe('surf');
    expect(guessSport('surf')).toBe('surf');
    // Le kitesurf reste du kite.
    expect(guessSport('Kitesurf')).toBe('kite');
  });

  it('rend `null` pour un type inconnu ou absent', () => {
    expect(guessSport('parapente')).toBeNull();
    expect(guessSport('9')).toBeNull();
    expect(guessSport(undefined)).toBeNull();
    expect(guessSport('toString')).toBeNull();
  });
});

describe('downloadBaseName', () => {
  it("écrit la date du début, l'activité puis le nom", () => {
    const startMs = new Date(2026, 9, 10, 10, 0).getTime();
    expect(downloadBaseName('Carnon', 'Wingfoil', startMs, 'x.gpx')).toBe('2026-10-10 Wingfoil - Carnon');
  });

  it('prend sinon la date du nom de fichier', () => {
    expect(downloadBaseName(' Carnon ', 'Wingfoil', null, '2026-10-09_10-00-00_wingfoil.gpx')).toBe('2026-10-09 Wingfoil - Carnon');
  });

  it("se passe de date et d'activité inconnues", () => {
    expect(downloadBaseName('Carnon', null, null, 'sortie.gpx')).toBe('Carnon');
  });
});
