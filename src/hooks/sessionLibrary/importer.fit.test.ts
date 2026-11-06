import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportEntry, MemoryFolder } from '../../platform/memoryFolder';
import { buildFitActivity, type FitPointSpec } from '../../test/fit.fixture';
import { gpxAt, settle, tick, trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';

/**
 * Import de fichiers FIT par la bibliothèque (lot 35) : un FIT devient une session comme un GPX, un doublon compte
 * « déjà présente », un illisible n'arrête pas les autres, un dossier de plusieurs activités demande confirmation.
 */

const files = new Map<string, string>();
const log: string[] = [];
const fakeFolder: MemoryFolder = createFakeFolder(files, log);

/** Mémoire ouverte, ou aucun dossier désigné. */
let opened: 'ready' | 'unavailable' = 'ready';

const openFresh = async () => {
  vi.resetModules();
  vi.doMock('../../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../platform/memoryFolder')>()),
    openMemoryFolder: async () => (opened === 'ready' ? { state: 'ready', folder: fakeFolder } : { state: 'unavailable', reason: 'aucun dossier' }),
    pendingFolder: () => null,
  }));
  const library = await import('../useSessionLibrary');
  await library.openLibrary();
  await settle(library);
  return library;
};

const startOf = (minute: number): number => Date.parse(`2026-10-27T10:${String(minute).padStart(2, '0')}:00Z`);

/** Activité partie à la minute `minute`, les mêmes trois premiers points que `gpxAt` : même début de trace. */
const fitAt = (minute: number, spec: { fileType?: number; sessionSports?: number[] } = {}): Uint8Array => {
  const points: FitPointSpec[] = [0, 10, 20].map((s, i) => ({
    timeMs: startOf(minute) + s * 1000, lat: 43.6 + i * 0.0003, lon: 3.8, speedMs: 3, hr: 140 + i,
  }));
  return buildFitActivity({ points, ...spec });
};

const entry = (name: string, content: Uint8Array | string | null, onRead?: () => void): ImportEntry => ({
  name,
  key: name.replace(/\.[a-z]+$/i, '').toLowerCase(),
  readText: async () => (typeof content === 'string' ? content : null),
  readBytes: async () => {
    onRead?.();
    return typeof content === 'string' ? new TextEncoder().encode(content) : content;
  },
});

const sessionGpx = (): string[] => [...files.keys()].filter((path) => path.startsWith('sessions/') && path.endsWith('.gpx'));

let stopTimers = () => {};
beforeEach(() => {
  files.clear();
  log.length = 0;
  opened = 'ready';
  stopTimers = trackTestTimers();
});
afterEach(() => {
  stopTimers();
  vi.doUnmock('../../platform/memoryFolder');
});

describe('import de FIT', () => {
  it('range un FIT sous un GPX, jamais le .fit : FC et sport repris, fiche créée', async () => {
    const library = await openFresh();
    const report = await library.importEntries([entry('montre.fit', fitAt(1, { sessionSports: [1] }))]);
    expect(report.added).toHaveLength(1);
    expect(sessionGpx()).toEqual([`sessions/${report.added[0]}`]);
    expect([...files.keys()].some((path) => /\.fit$/i.test(path))).toBe(false);
    const gpx = files.get(`sessions/${report.added[0]}`)!;
    expect(gpx).toContain('<gpxtpx:hr>141</gpxtpx:hr>');
    expect(gpx).toContain('<type>running</type>');
    const session = library.readLibraryState().sessions[0];
    expect(session.record.sport).toBe('running');
    expect(session.record.source).toBe('import');
    expect(session.record.summary.startMs).toBe(startOf(1));
    expect(library.readLibraryState().message).toBe('1 session ajoutée.');
  });

  it('sport inconnu : session rangée à classer, sans question', async () => {
    const library = await openFresh();
    const report = await library.importEntries([entry('montre.fit', fitAt(1, { sessionSports: [0] }))]);
    expect(report.added).toHaveLength(1);
    expect(library.readLibraryState().sessions[0].record.sport).toBeNull();
  });

  it('même FIT réimporté : « déjà présente », rien n\'est écrasé', async () => {
    const library = await openFresh();
    const first = await library.importEntries([entry('montre.fit', fitAt(1))]);
    const before = files.get(`sessions/${first.added[0]}`);
    const again = await library.importEntries([entry('montre.fit', fitAt(1))]);
    expect(again.added).toEqual([]);
    expect(again.duplicates).toBe(1);
    expect(again.existing).toEqual(first.added);
    expect(files.get(`sessions/${first.added[0]}`)).toBe(before);
    expect(library.readLibraryState().message).toBe('0 sessions ajoutées, 1 déjà présente.');
  });

  it('GPX de la même sortie : les GPX passent d\'abord, le FIT compte « déjà présente », dans les deux sens', async () => {
    const library = await openFresh();
    const together = await library.importEntries([entry('montre.fit', fitAt(1)), entry('garmin.gpx', gpxAt(1))]);
    expect(together.added).toHaveLength(1);
    expect(together.duplicates).toBe(1);
    // Le GPX est rangé tel quel, sans la FC du FIT.
    expect(files.get(`sessions/${together.added[0]}`)).toBe(gpxAt(1));

    const later = await library.importEntries([entry('montre.fit', fitAt(1))]);
    expect(later.duplicates).toBe(1);
    expect(sessionGpx()).toHaveLength(1);

    const fitFirst = await library.importEntries([entry('montre2.fit', fitAt(2))]);
    expect(fitFirst.added).toHaveLength(1);
    const gpxAfter = await library.importEntries([entry('garmin2.gpx', gpxAt(2))]);
    expect(gpxAfter.duplicates).toBe(1);
    expect(sessionGpx()).toHaveLength(2);
  });

  it('un illisible parmi des bons : nommé avec sa raison, les autres rangés', async () => {
    const library = await openFresh();
    const report = await library.importEntries([
      entry('bon-1.fit', fitAt(1)),
      entry('faux.fit', '<gpx>ceci n\'est pas un FIT</gpx>'),
      entry('muet.fit', null),
      entry('salle.fit', buildFitActivity({ points: [{ timeMs: startOf(3), hr: 120 }, { timeMs: startOf(3) + 1000, hr: 121 }] })),
      entry('bon-2.fit', fitAt(2)),
    ]);
    expect(report.added).toHaveLength(2);
    expect(report.failed).toEqual([
      "faux.fit : ce n'est pas un fichier FIT",
      'muet.fit : illisible',
      'salle.fit : aucune position dans ce fichier (tapis, salle) : pas de trace à ranger',
    ]);
    expect(sessionGpx()).toHaveLength(2);
    expect(library.readLibraryState().error).toContain('faux.fit');
  });

  it('un FIT qui n\'est pas une activité : ignoré parmi d\'autres, dit clairement s\'il est seul', async () => {
    const library = await openFresh();
    const mixed = await library.importEntries([entry('reglages.fit', fitAt(1, { fileType: 2 })), entry('bon.fit', fitAt(2))]);
    expect(mixed.notActivities).toEqual(['reglages.fit']);
    expect(mixed.failed).toEqual([]);
    expect(library.readLibraryState().message).toBe('1 session ajoutée.');

    const alone = await library.importEntries([entry('reglages.fit', fitAt(1, { fileType: 2 }))]);
    expect(alone.added).toEqual([]);
    expect(library.readLibraryState().message).toBe("Ce fichier de montre n'est pas une activité (réglages, parcours…) : rien n'a été importé.");
  });

  it('sans dossier mémoire : rien n\'est rangé ni mis en attente, phrase existante', async () => {
    opened = 'unavailable';
    const library = await openFresh();
    const report = await library.importEntries([entry('montre.fit', fitAt(1))]);
    expect(report.added).toEqual([]);
    expect(report.unsaved).toBe(1);
    expect(library.readLibraryState().message).toContain("désignez d'abord le dossier mémoire");
    expect(files.size).toBe(0);
  });
});

describe('dossier de plusieurs activités de montre', () => {
  const waitForQuestion = async (library: Awaited<ReturnType<typeof openFresh>>) => {
    for (let i = 0; i < 200 && !library.readLibraryState().importQuestion; i++) await tick();
    return library.readLibraryState().importQuestion;
  };
  const folder = (): ImportEntry[] => [entry('a.fit', fitAt(1)), entry('b.fit', fitAt(2)), entry('reglages.fit', fitAt(3, { fileType: 2 }))];

  it('demande avant de tout prendre : les activités seules sont comptées, oui importe tout', async () => {
    const library = await openFresh();
    const importing = library.importEntries(folder(), { fromFolder: true });
    expect(await waitForQuestion(library)).toStrictEqual({ watchActivities: 2 });
    expect(library.readLibraryState().importing).toBe(true);
    expect(sessionGpx()).toEqual([]);

    library.answerImportQuestion(true);
    const report = await importing;
    expect(report.added).toHaveLength(2);
    expect(library.readLibraryState().importQuestion).toBeNull();
    expect(library.readLibraryState().importing).toBe(false);
  });

  it('refus : rien n\'est importé, et c\'est dit', async () => {
    const library = await openFresh();
    const importing = library.importEntries(folder(), { fromFolder: true });
    await waitForQuestion(library);
    library.answerImportQuestion(false);
    const report = await importing;
    expect(report.added).toEqual([]);
    expect(sessionGpx()).toEqual([]);
    expect(library.readLibraryState().importing).toBe(false);
    expect(library.readLibraryState().message).toBe("Import annulé : rien n'a été importé.");
  });

  it('une seule activité dans le dossier : pas de question', async () => {
    const library = await openFresh();
    const report = await library.importEntries([entry('a.fit', fitAt(1)), entry('reglages.fit', fitAt(3, { fileType: 2 })), entry('s.gpx', gpxAt(9))], { fromFolder: true });
    expect(report.added).toHaveLength(2);
    expect(library.readLibraryState().importQuestion).toBeNull();
  });

  it('plusieurs FIT choisis un par un : pas de question', async () => {
    const library = await openFresh();
    const report = await library.importEntries(folder());
    expect(report.added).toHaveLength(2);
    expect(library.readLibraryState().importQuestion).toBeNull();
  });

  it('un dossier Tracker sans FIT : pas de question', async () => {
    const library = await openFresh();
    const report = await library.importEntries([entry('s.gpx', gpxAt(9)), entry('t.gpx', gpxAt(10))], { fromFolder: true });
    expect(library.readLibraryState().importQuestion).toBeNull();
    expect(report.added).toHaveLength(2);
  });

  it('un seul FIT : pas de question, et une seule lecture', async () => {
    const library = await openFresh();
    const read = vi.fn();
    const report = await library.importEntries([entry('a.fit', fitAt(1), read)], { fromFolder: true });
    expect(library.readLibraryState().importQuestion).toBeNull();
    expect(report.added).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
