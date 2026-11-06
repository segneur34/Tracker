import { describe, expect, it, vi } from 'vitest';
import {
  MISSING_FOLDER_MESSAGE, READ_ONLY_MEMORY_MESSAGE, fileErrorCode, folderImportPaths, isMemorySubfolder, readOnlyFolder, readableFolderError, shouldDescendIntoMemory,
} from './memoryFolder';
import { createFakeFolder } from '../test/memoryFolder.fixture';

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

describe('isMemorySubfolder', () => {
  it('refuse le dossier sessions ou itineraires d\'une mémoire', () => {
    expect(isMemorySubfolder('sessions', new Set(['a.gpx', 'a.json']))).toBe(true);
    expect(isMemorySubfolder('Documents/Tracker/Sessions', new Set())).toBe(true);
    expect(isMemorySubfolder('itineraires', new Set(['Boucle.json']))).toBe(true);
  });

  it('accepte un dossier marqué comme mémoire, quel que soit son nom, et tout autre dossier', () => {
    expect(isMemorySubfolder('sessions', new Set(['tracker.json', 'sessions']))).toBe(false);
    expect(isMemorySubfolder('Tracker', new Set(['sessions']))).toBe(false);
    expect(isMemorySubfolder('Mes sessions', new Set())).toBe(false);
  });
});

describe('folderImportPaths', () => {
  const file = (name: string) => ({ name, kind: 'file' as const });
  const dir = (name: string) => ({ name, kind: 'directory' as const });

  it("reprend les GPX, les fiches et les capteurs de la racine et de sessions/", () => {
    expect(folderImportPaths(
      [file('tracker.json'), file('a.GPX'), dir('sessions')],
      [file('b.gpx'), file('b.json'), file('b.imu')]
    )).toEqual(['tracker.json', 'a.GPX', 'sessions/b.gpx', 'sessions/b.json', 'sessions/b.imu']);
  });

  it('reprend aussi les fichiers de montre, à la racine comme dans sessions/', () => {
    expect(folderImportPaths([file('a.FIT'), dir('sessions')], [file('b.fit')])).toEqual(['a.FIT', 'sessions/b.fit']);
  });

  it('ignore les autres fichiers et les dossiers', () => {
    expect(folderImportPaths(
      [file('LISEZMOI.txt'), dir('x.gpx')],
      [file('photo.jpg'), dir('vieux')]
    )).toEqual([]);
  });
});

describe('readableFolderError (lot 143, idée 122)', () => {
  it('rend en clair un dossier désigné qui n’existe plus, le détail en console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = readableFolderError(new Error('Écriture impossible : Missing file for primary:Documents/Tracker at /storage/emulated/0/Documents/Tracker'));
    expect((err as Error).message).toBe(MISSING_FOLDER_MESSAGE);
    expect(fileErrorCode(err)).toBe('NOT_FOUND');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Missing file for'));
    warn.mockRestore();
  });

  it('rend telle quelle une autre erreur', () => {
    const other = new Error('Écriture impossible : disque plein');
    expect(readableFolderError(other)).toBe(other);
  });

  it('un code explicite du greffon prime sur le texte (lot 148)', () => {
    const refused = Object.assign(new Error('Lecture impossible : java.io.FileNotFoundException: open failed: EACCES (Permission denied)'), { code: 'PERMISSION' });
    expect((readableFolderError(refused) as Error).message).toBe('Autorisation refusée : Réglages › Autorisations.');
    expect(fileErrorCode(readableFolderError(refused))).toBe('PERMISSION');
    const full = Object.assign(new Error('Écriture impossible : Missing file for x'), { code: 'NO_SPACE' });
    expect(fileErrorCode(readableFolderError(full))).toBe('NO_SPACE');
    expect((readableFolderError(full) as Error).message).toMatch(/place/);
  });

  it('un NOT_FOUND du greffon, à ce texte, reste le dossier introuvable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = readableFolderError(Object.assign(new Error('Lecture impossible : Missing file for primary:Tracker'), { code: 'NOT_FOUND' }));
    expect((err as Error).message).toBe(MISSING_FOLDER_MESSAGE);
    warn.mockRestore();
  });
});

describe('fileErrorCode (lot 148)', () => {
  it('lit le code du greffon', () => {
    for (const code of ['NOT_FOUND', 'PERMISSION', 'NO_SPACE', 'TOO_LARGE', 'UNKNOWN'] as const) {
      expect(fileErrorCode(Object.assign(new Error('x'), { code }))).toBe(code);
    }
  });

  it('lit le nom d\'une erreur du navigateur', () => {
    expect(fileErrorCode(new DOMException('x', 'NotFoundError'))).toBe('NOT_FOUND');
    expect(fileErrorCode(new DOMException('x', 'NotAllowedError'))).toBe('PERMISSION');
    expect(fileErrorCode(new DOMException('x', 'QuotaExceededError'))).toBe('NO_SPACE');
  });

  it('rend UNKNOWN pour le reste, code inconnu ou nom hérité compris', () => {
    expect(fileErrorCode(new Error('x'))).toBe('UNKNOWN');
    expect(fileErrorCode(Object.assign(new Error('x'), { code: 'AUTRE' }))).toBe('UNKNOWN');
    expect(fileErrorCode({ name: 'toString' })).toBe('UNKNOWN');
    expect(fileErrorCode('texte')).toBe('UNKNOWN');
    expect(fileErrorCode(null)).toBe('UNKNOWN');
  });
});

describe('readOnlyFolder (lot 148)', () => {
  it('lit, et refuse d\'écrire ou d\'effacer, sans toucher au dossier', async () => {
    const files = new Map([['a.txt', 'contenu']]);
    const log: string[] = [];
    const folder = readOnlyFolder(createFakeFolder(files, log));
    expect(folder.readOnly).toBe(true);
    expect(await folder.readText('a.txt')).toBe('contenu');
    expect(await folder.stat('a.txt')).toEqual({ size: 1, mtimeMs: 1 });
    expect(await folder.list('')).toHaveLength(1);
    await expect(folder.writeText('a.txt', 'autre')).rejects.toThrow(READ_ONLY_MEMORY_MESSAGE);
    await expect(folder.writeBytes('a.imu', new Uint8Array([1]))).rejects.toThrow(READ_ONLY_MEMORY_MESSAGE);
    await expect(folder.remove('a.txt')).rejects.toThrow(READ_ONLY_MEMORY_MESSAGE);
    expect(log).toEqual([]);
    expect(files.get('a.txt')).toBe('contenu');
  });
});
