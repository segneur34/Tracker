import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecordWithRaw, serializeRecord, type SessionAnalysis } from '../../library/record';
import type { SummarizeGpxOptions } from '../../library/summarizeGpx';
import type { AnalyzedGpx } from '../../library/summaryOptions';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';
import { sessionRecord } from '../../test/record.fixture';
import type { SummaryRunner } from './summaryQueue';

/**
 * Calcul des résumés remplaçable (lot 113), asynchrone depuis le lot 126 B (worker) : la file appelle le calcul
 * donné, une trace à la fois, dans le même ordre et avec la même pause entre deux, et range ce qu'il rend ; la
 * session est relue au retour du calcul (saisie gardée, résumé refait si ses réglages ont changé).
 */

const files = new Map<string, string>();
const log: string[] = [];
const fakeFolder: MemoryFolder = createFakeFolder(files, log);

const START_MS = Date.UTC(2026, 10, 4, 8, 0, 0);
const NAMES = ['a.gpx', 'b.gpx', 'c.gpx'];

/** Résumé du faux calcul : parti d'autant de minutes que `index`. */
const analyzedAt = (index: number): AnalyzedGpx => ({
  summary: { ...sessionRecord().summary, startMs: START_MS + index * 60_000 }, sport: 'running', title: `Trace ${index}`,
});

/** Faux calcul, asynchrone comme celui du worker : un résumé par GPX, parti d'autant de minutes que son rang. */
const fakeRunner = vi.fn<SummaryRunner>(async (text) => analyzedAt(Number(/rang="(\d)"/.exec(text)?.[1])));

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
    // Le calcul reçoit le texte du GPX, le calcul à deviner, et les réglages de l'activité résolus pour les onze calculs.
    const [text, options] = fakeRunner.mock.calls[0];
    expect(text).toBe('<gpx rang="0"></gpx>');
    expect(options.sport).toBeUndefined();
    expect(options.analysis).toBeUndefined();
    expect(options.elevation).toBeUndefined();
    expect(Object.keys(options.activitySettings)).toHaveLength(11);
    // Des données seulement : elles traversent un message vers le worker.
    expect(structuredClone(options)).toStrictEqual(options);
  });

  it('un GPX que le calcul ne sait pas résumer est dit illisible, sans arrêter les autres', async () => {
    const { library, queue } = await openFresh();
    queue.setSummaryRunner((text, options) => (text.includes('rang="1"') ? Promise.resolve(null) : fakeRunner(text, options)));
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

describe('calcul asynchrone (lot 126 B) : la session relue quand le résumé revient', () => {
  /** Calcul qui ne rend son résumé que sur demande (`calls[i].resolve`). */
  const heldRunner = () => {
    const calls: { options: SummarizeGpxOptions; resolve: (analyzed: AnalyzedGpx | null) => void }[] = [];
    const run: SummaryRunner = (_text, options) => new Promise((resolve) => calls.push({ options, resolve }));
    return { calls, run };
  };

  /** Une seule session, à la fiche d'avant l'empreinte des réglages : son résumé est à refaire. */
  const putOutdated = (): void => {
    files.clear();
    files.set('sessions/a.gpx', '<gpx rang="0"></gpx>');
    files.set('sessions/a.json', serializeRecord(sessionRecord({ gpx: 'a.gpx', sport: 'running', activityId: 'running', title: null })));
  };

  const waitFor = async (what: string, done: () => boolean): Promise<void> => {
    for (let i = 0; i < 10_000 && !done(); i++) await turn();
    if (!done()) throw new Error(`attendu : ${what}`);
  };

  const diskRecord = () => parseRecordWithRaw(files.get('sessions/a.json') ?? '')?.parts;

  const analysis = (patch: Partial<SessionAnalysis>): SessionAnalysis => ({
    windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null,
    pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 1, ...patch,
  });

  it('nom changé pendant le calcul : gardé, avec le résumé, sans recalcul', async () => {
    putOutdated();
    const { library, queue } = await openFresh();
    const { calls, run } = heldRunner();
    queue.setSummaryRunner(run);
    try {
      await library.openLibrary();
      await waitFor('un calcul demandé', () => calls.length === 1);
      library.updateSessionRecord('a.gpx', { name: 'Au large' });
      calls[0].resolve(analyzedAt(5));
      await waitFor('résumé posé', () => library.readLibraryState().sessions[0]?.record.summary.startMs === START_MS + 5 * 60_000);
      await waitFor('fiche écrite', () => diskRecord()?.summary?.startMs === START_MS + 5 * 60_000);
    } finally {
      queue.setSummaryRunner(null);
    }
    expect(calls).toHaveLength(1);
    expect(library.readLibraryState().sessions[0].record.name).toBe('Au large');
    expect(diskRecord()?.name).toBe('Au large');
  });

  it('seuil changé pendant le calcul : résumé refait avec le nouveau seuil, le dernier posé', async () => {
    putOutdated();
    const { library, queue } = await openFresh();
    const { calls, run } = heldRunner();
    queue.setSummaryRunner(run);
    try {
      await library.openLibrary();
      await waitFor('un calcul demandé', () => calls.length === 1);
      expect(calls[0].options.analysis).toBeNull();
      library.updateSessionRecord('a.gpx', { analysis: analysis({ activeThreshold: 2.5 }) });
      calls[0].resolve(analyzedAt(5));
      await waitFor('un second calcul', () => calls.length === 2);
      expect(calls[1].options.analysis?.activeThreshold).toBe(2.5);
      // Le résumé calculé à l'ancien seuil n'a jamais été posé : refait dans la même tâche.
      expect(library.readLibraryState().sessions[0].record.summary.startMs).not.toBe(START_MS + 5 * 60_000);
      expect(diskRecord()?.summary?.startMs).not.toBe(START_MS + 5 * 60_000);
      calls[1].resolve(analyzedAt(7));
      await waitFor('résumé posé', () => library.readLibraryState().sessions[0]?.record.summary.startMs === START_MS + 7 * 60_000);
    } finally {
      queue.setSummaryRunner(null);
    }
    expect(calls).toHaveLength(2);
    expect(library.readLibraryState().sessions[0].record.analysis?.activeThreshold).toBe(2.5);
  });
});
