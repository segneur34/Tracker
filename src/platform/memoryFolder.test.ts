import { describe, expect, it } from 'vitest';
import { folderImportPaths, shouldDescendIntoMemory } from './memoryFolder';

describe('shouldDescendIntoMemory', () => {
  it('garde le dossier Tracker désigné, même vide', () => {
    expect(shouldDescendIntoMemory('Tracker', new Set())).toBe(false);
    expect(shouldDescendIntoMemory('Documents/Tracker', new Set(['Tracker']))).toBe(false);
  });

  it('descend dans Tracker quand on a désigné son parent', () => {
    expect(shouldDescendIntoMemory('Documents', new Set(['Tracker', 'Factures']))).toBe(true);
  });

  it('garde un dossier mémoire renommé, reconnu à son contenu', () => {
    expect(shouldDescendIntoMemory('Sauvegarde', new Set(['tracker.json', 'sessions', 'Tracker']))).toBe(false);
    expect(shouldDescendIntoMemory('Sauvegarde', new Set(['sessions']))).toBe(false);
  });

  it('garde un dossier quelconque sans Tracker : il deviendra la mémoire', () => {
    expect(shouldDescendIntoMemory('Traces', new Set(['a.gpx']))).toBe(false);
  });
});

describe('folderImportPaths', () => {
  const file = (name: string) => ({ name, kind: 'file' as const });
  const dir = (name: string) => ({ name, kind: 'directory' as const });

  it("reprend les GPX et les fiches de la racine et de sessions/", () => {
    expect(folderImportPaths(
      [file('tracker.json'), file('a.GPX'), dir('sessions')],
      [file('b.gpx'), file('b.json')]
    )).toEqual(['tracker.json', 'a.GPX', 'sessions/b.gpx', 'sessions/b.json']);
  });

  it('ignore les autres fichiers et les dossiers', () => {
    expect(folderImportPaths(
      [file('LISEZMOI.txt'), dir('x.gpx')],
      [file('photo.jpg'), dir('vieux')]
    )).toEqual([]);
  });
});
