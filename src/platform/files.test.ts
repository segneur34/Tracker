import { describe, expect, it } from 'vitest';
import { createMemoryFile, filesystem, isSetAsideNameOf, safeFileName, setAsideName, setAsideTimeMs } from './files';

describe('fichier mis de côté (lot 143, 123a)', () => {
  const at = Date.UTC(2026, 10, 3, 14, 25, 1, 123);

  it('garde son extension, horodaté avant elle, sans deux-points', () => {
    expect(setAsideName('recording-journal.jsonl', at)).toBe('recording-journal-2026-11-03T14-25-01-123Z.jsonl');
    expect(setAsideName('dossier.v2/journal', at)).toBe('dossier.v2/journal-2026-11-03T14-25-01-123Z');
  });

  it('en mémoire : le nom d’origine est libéré, un nouveau contenu y repart de zéro', async () => {
    const file = createMemoryFile('journal.jsonl');
    await file.write('ancien');
    expect(await file.setAside()).toMatch(/^journal-.*\.jsonl$/);
    expect(await file.read()).toBeNull();
    await file.append('neuf');
    expect(await file.read()).toBe('neuf');
  });

  it('son nom dit quand il a été mis de côté (lot 232)', () => {
    expect(setAsideTimeMs(setAsideName('recording-journal.jsonl', at))).toBe(at);
    expect(setAsideTimeMs(setAsideName('dossier.v2/journal', at))).toBe(at);
    expect(setAsideTimeMs('recording-journal.jsonl')).toBeNull();
    expect(setAsideTimeMs('recording-journal-2026-13-45T99-00-00-000Z.jsonl')).toBeNull();
  });

  it('reconnu à son nom, à côté du fichier, jamais le fichier lui-même (lot 232)', () => {
    const journal = 'recording-journal.jsonl';
    expect(isSetAsideNameOf(journal, setAsideName(journal, at))).toBe(true);
    expect(isSetAsideNameOf(journal, journal)).toBe(false);
    expect(isSetAsideNameOf(journal, 'recording-journal-.jsonl')).toBe(false);
    expect(isSetAsideNameOf(journal, 'recording-journal-2026.txt')).toBe(false);
    expect(isSetAsideNameOf(journal, 'autre-journal-2026.jsonl')).toBe(false);
    expect(isSetAsideNameOf('dossier/journal.jsonl', setAsideName('dossier/journal.jsonl', at))).toBe(true);
    expect(isSetAsideNameOf('dossier/journal.jsonl', 'dossier/journal-x/y.jsonl')).toBe(false);
  });

  it('en mémoire : listé, relu puis effacé, le fichier courant à part (lot 232)', async () => {
    const file = createMemoryFile('journal.jsonl');
    await file.write('premier');
    const first = await file.setAside();
    await file.write('courant');
    expect(await file.listAside()).toEqual([first]);
    expect(await file.readAside(first)).toBe('premier');
    await file.removeAside(first);
    expect(await file.listAside()).toEqual([]);
    expect(await file.readAside(first)).toBeNull();
    expect(await file.read()).toBe('courant');
  });
});

describe('greffon de fichiers', () => {
  it('chargé une seule fois : écran éteint, un nouvel import() ne rend plus la main', () => {
    expect(filesystem()).toBe(filesystem());
  });
});

describe('safeFileName (lot 160)', () => {
  it('garde un nom ordinaire tel quel', () => {
    expect(safeFileName('2026-10-10 Wingfoil - Carnon')).toBe('2026-10-10 Wingfoil - Carnon');
  });
  it('retire caractères refusés et de contrôle, points en tête et en fin', () => {
    expect(safeFileName(String.raw`x\y`)).toBe('x y');
    expect(safeFileName(`a${String.fromCharCode(1)}b`)).toBe('a b');
    expect(safeFileName('a/b:cd	e')).toBe('a b c d e');
    expect(safeFileName('..cache. ')).toBe('cache');
  });
  it('suffixe les noms réservés de Windows', () => {
    expect(safeFileName('CON')).toBe('CON_');
    expect(safeFileName('lpt1.txt')).toBe('lpt1.txt_');
    expect(safeFileName('Console')).toBe('Console');
  });
  it('borne la longueur', () => {
    expect(Array.from(safeFileName('x'.repeat(500))).length).toBe(100);
  });
});
