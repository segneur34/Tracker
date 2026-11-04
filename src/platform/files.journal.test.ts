import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le journal du dossier privé, au téléphone (lot 148) : absent seulement sur une preuve, sinon
 * illisible, pour qu'il ne soit jamais écrasé au « Démarrer » suivant. Greffon Filesystem simulé.
 */

vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  isNativeApp: () => true,
}));

const fs = vi.hoisted(() => ({
  readError: null as Error | null,
  statError: null as Error | null,
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async () => {
      if (fs.readError) throw fs.readError;
      return { data: 'journal' };
    },
    stat: async () => {
      if (fs.statError) throw fs.statError;
      return { size: 7 };
    },
  },
}));

const missing = (): Error => Object.assign(new Error('file does not exist.'), { code: 'OS-PLUG-FILE-0008' });
const silent = (): Error => new Error('Erreur passagère du stockage');

describe('journal du dossier privé', () => {
  beforeEach(() => {
    fs.readError = null;
    fs.statError = null;
  });

  it('se lit', async () => {
    const { recordingJournal } = await import('./files');
    await expect(recordingJournal.read()).resolves.toBe('journal');
  });

  it('absent sur la preuve de la lecture', async () => {
    const { recordingJournal } = await import('./files');
    fs.readError = missing();
    await expect(recordingJournal.read()).resolves.toBeNull();
  });

  it('absent sur la preuve du stat', async () => {
    const { recordingJournal } = await import('./files');
    fs.readError = silent();
    fs.statError = missing();
    await expect(recordingJournal.read()).resolves.toBeNull();
  });

  it('présent mais illisible : la lecture lève', async () => {
    const { recordingJournal } = await import('./files');
    fs.readError = silent();
    await expect(recordingJournal.read()).rejects.toBe(fs.readError);
  });

  it('lecture et stat en échec, sans preuve : la lecture lève, jamais pris pour absent', async () => {
    const { recordingJournal } = await import('./files');
    fs.readError = silent();
    fs.statError = silent();
    await expect(recordingJournal.read()).rejects.toBe(fs.readError);
  });
});
