import { describe, expect, it } from 'vitest';
import { createMemoryFile, filesystem, safeFileName, setAsideName } from './files';

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
