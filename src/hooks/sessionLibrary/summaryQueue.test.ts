import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecordWithRaw } from '../../library/record';
import type { AnalyzedGpx } from '../../library/summaryOptions';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';
import { sessionRecord } from '../../test/record.fixture';
import type { SummaryRunner } from './summaryQueue';

/**
 * Calcul des résumés remplaçable (lot 113, pour le lot 126 B) : la file appelle le calcul donné, une trace à la
 * fois, dans le même ordre et avec la même pause entre deux qu'avec `analyzeGpx`, et range ce qu'il rend.
 */

const files = new Map<string, string>();
const log: string[] = [];
const fakeFolder: MemoryFolder = createFakeFolder(files, log);

const START_MS = Date.UTC(2026, 10, 4, 8, 0, 0);
const NAMES = ['a.gpx', 'b.gpx', 'c.gpx'];

/** Faux calcul : un résumé par GPX, parti d'autant de minutes que son rang. */
const fakeRunner = vi.fn<SummaryRunner>((text): AnalyzedGpx | null => {
  const index = Number(/rang="(\d)"/.exec(text)?.[1]);
  return { summary: { ...sessionRecord().summary, startMs: START_MS + index * 60_000 }, sport: 'running', title: `Trace ${index}` };
});

const openFresh = async () => {
  vi.resetModules();
  vi.doMock('../../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
  const library = await import('../useSessionLibrary');
  const queue = await import('./summaryQueue');
  return { library, queue };
};

/** Un tour de boucle, par une minuterie de 1 ms : celles de 0 ms sont les pauses de la file, relevées. */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

/** Laisse finir le balayage de fond. */
const settleWithoutTimers = async (library: { readLibraryState(): { scanning: unknown } }): Promise<void> => {
  for (let i = 0; i < 10_000; i++) {
    await turn();
    if (library.readLibraryState().scanning === null && fakeRunner.mock.calls.length >= NAMES.length) return;
  }
  throw new Error('balayage encore en cours');
};

let stopTestTimers: () => void = () => undefined;
beforeEach(() => {
  files.clear();
  log.length = 0;
  fakeRunner.mockClear();
  NAMES.forEach((name, i) => files.set(`sessions/${name}`, `<gpx rang="${i}"></gpx>`));
  stopTestTimers = trackTestTimers();
});
afterEach(() => {
  stopTestTimers();
  vi.doUnmock('../../platform/memoryFolder');
});

describe('calcul des résumés de la file (setSummaryRunner)', () => {
  it('appelle le calcul donné pour chaque GPX sans fiche, dans l’ordre du balayage, une pause entre deux', async () => {
    const { library, queue } = await openFresh();
    queue.setSummaryRunner(fakeRunner);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      await library.openLibrary();
      await settleWithoutTimers(library);
      // Calculs et pauses (minuteries de 0 ms) dans l'ordre où ils ont eu lieu.
      const events = [
        ...fakeRunner.mock.invocationCallOrder.map((order, i) => ({ order, what: `calcul ${String(fakeRunner.mock.calls[i][0]).match(/rang="(\d)"/)?.[1]}` })),
        ...timers.mock.calls.flatMap((call, i) => (call[1] === 0 ? [{ order: timers.mock.invocationCallOrder[i], what: 'pause' }] : [])),
      ].sort((a, b) => a.order - b.order).map((e) => e.what);
      expect(events).toEqual(['calcul 0', 'pause', 'calcul 1', 'pause', 'calcul 2', 'pause']);
    } finally {
      timers.mockRestore();
      queue.setSummaryRunner(null);
    }
    // Ce que le calcul rend est rangé : fiche écrite, session publiée.
    expect(library.readLibraryState().sessions.map((s) => s.record.title).sort()).toEqual(['Trace 0', 'Trace 1', 'Trace 2']);
    expect(parseRecordWithRaw(files.get('sessions/b.json') ?? '')?.parts.summary?.startMs).toBe(START_MS + 60_000);
    // Le calcul reçoit le texte du GPX, le calcul deviné (aucun), et les réglages de l'activité à résoudre.
    const [text, sport, analysis, activityOf] = fakeRunner.mock.calls[0];
    expect(text).toBe('<gpx rang="0"></gpx>');
    expect(sport).toBeUndefined();
    expect(analysis).toBeUndefined();
    expect(typeof activityOf).toBe('function');
  });

  it('un GPX que le calcul ne sait pas résumer est dit illisible, sans arrêter les autres', async () => {
    const { library, queue } = await openFresh();
    queue.setSummaryRunner((text, ...rest) => (text.includes('rang="1"') ? null : fakeRunner(text, ...rest)));
    try {
      await library.openLibrary();
      for (let i = 0; i < 10_000 && library.readLibraryState().scanning !== null; i++) await turn();
      await turn();
    } finally {
      queue.setSummaryRunner(null);
    }
    expect(library.readLibraryState().unreadable).toEqual(['b.gpx']);
    expect(library.readLibraryState().sessions).toHaveLength(2);
  });
});
