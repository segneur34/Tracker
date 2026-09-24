import { describe, expect, it } from 'vitest';
import { guessSport, uniqueSessionFileName } from './naming';

describe('uniqueSessionFileName', () => {
  it("garde le nom s'il est libre, sinon ajoute un numéro", () => {
    expect(uniqueSessionFileName('a.gpx', [])).toBe('a.gpx');
    expect(uniqueSessionFileName('a.gpx', ['a.gpx'])).toBe('a-2.gpx');
    expect(uniqueSessionFileName('a.gpx', ['a.gpx', 'a-2.gpx'])).toBe('a-3.gpx');
  });

  it('écarte aussi un nom dont la fiche est prise', () => {
    expect(uniqueSessionFileName('a.gpx', ['a.json'])).toBe('a-2.gpx');
  });

  it('ignore la casse, comme Windows', () => {
    expect(uniqueSessionFileName('Sortie.gpx', ['sortie.GPX'])).toBe('Sortie-2.gpx');
  });
});

describe('guessSport', () => {
  it('reconnaît nos supports tels que notre GPX les écrit', () => {
    expect(guessSport('wingfoil')).toBe('wingfoil');
    expect(guessSport('bateau')).toBe('bateau');
  });

  it('reconnaît les types des autres applications, quelle que soit leur graphie', () => {
    expect(guessSport('running')).toBe('running');
    expect(guessSport('Trail Running')).toBe('running');
    expect(guessSport('trail_running')).toBe('running');
    expect(guessSport('Windsurfing')).toBe('windsurf');
    expect(guessSport('kitesurfing')).toBe('kite');
  });

  it('rend `null` pour un type inconnu ou absent', () => {
    expect(guessSport('cycling')).toBeNull();
    expect(guessSport('9')).toBeNull();
    expect(guessSport(undefined)).toBeNull();
    expect(guessSport('toString')).toBeNull();
  });
});
