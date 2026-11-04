import { describe, expect, it } from 'vitest';
import { createMemoryFile, setAsideName } from './files';

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
