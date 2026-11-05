import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SportType } from '../../core/types';
import type { RecordWithoutSummary, SessionAnalysis, SessionSource } from '../../library/record';
import { analyzeGpx } from '../../library/summaryOptions';
import { handleTrackRequest, type TrackRequest, type TrackResponse } from '../../library/trackWorkerProtocol';
import type { MemoryFolder } from '../../platform/memoryFolder';
import type { SessionTest } from '../../recording/fitnessTest';
import { settle, trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';
import { sessionRecord } from '../../test/record.fixture';
import { gpxOf, sailRaw, slowPolar, upDownLegs } from '../../test/sailing.fixture';
import type { AddOptions } from './addSession';

/**
 * Entrée d'une session dans la mémoire avec son résumé calculé par le worker des traces (lot 161) : la fiche et le
 * résumé sont les mêmes par le worker et en ligne, et ceux du calcul direct ; le fil de l'affichage rend la main
 * pendant le calcul ; GPX illisible, écriture en échec, élagage en échec, worker mort : rien ne change. Les capteurs
 * ne partent jamais au worker. Les imports, qui passent par le même chemin, gardent leur ordre et leur rapport.
 */

/** Faux worker : le vrai aiguillage, messages clonés à l'aller et au retour ; `hold` garde les demandes jusqu'à `release`. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static hold = false;
  /** Tout ce qu'a reçu `postMessage` : le message, et un éventuel transfert. */
  static posts: unknown[][] = [];
  onmessage: ((event: { data: TrackResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  held: TrackRequest[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(...args: [TrackRequest, ...unknown[]]): void {
    FakeWorker.posts.push(args);
    const request = structuredClone(args[0]);
    if (FakeWorker.hold) this.held.push(request);
    else queueMicrotask(() => this.answer(request));
  }

  answer(request: TrackRequest): void {
    if (!this.terminated) this.onmessage?.({ data: structuredClone(handleTrackRequest(request)) });
  }

  release(): void {
    for (const request of this.held.splice(0)) this.answer(request);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const files = new Map<string, string>();
const bytes = new Map<string, Uint8Array>();
const log: string[] = [];
/** Les fiches ne s'écrivent pas : le GPX, écrit d'abord, doit être retiré. */
let refuseRecords = false;

const fakeFolder: MemoryFolder = createFakeFolder(files, log, {
  writeText: async (path, text) => {
    if (refuseRecords && path.startsWith('sessions/') && path.endsWith('.json')) throw new Error('écriture refusée');
    log.push(`write ${path}`);
    files.set(path, text);
  },
  writeBytes: async (path, data) => {
    log.push(`write ${path}`);
    bytes.set(path, data);
  },
});

/** Élagage simulé : rend ce résultat, ou lève ; `null` : le vrai. */
let pruneResult: Uint8Array | Error | null = null;

const openFresh = async () => {
  vi.resetModules();
  vi.doMock('../../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
  vi.doMock('../../core/imuPrune', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../core/imuPrune')>()),
    pruneImuFile: async (motion: Uint8Array) => {
      if (pruneResult instanceof Error) throw pruneResult;
      return pruneResult ?? motion;
    },
  }));
  const library = await import('../useSessionLibrary');
  const { addGpx } = await import('./addSession');
  const { sessionSummarySettings } = await import('./summarySettings');
  await library.openLibrary();
  await settle(library);
  return { library, addGpx, sessionSummarySettings };
};

const useWorker = (): void => {
  vi.stubGlobal('Worker', FakeWorker);
};

const reset = (): void => {
  files.clear();
  bytes.clear();
  log.length = 0;
  refuseRecords = false;
  FakeWorker.instances = [];
  FakeWorker.posts = [];
  FakeWorker.hold = false;
  pruneResult = null;
};

let stopTestTimers: () => void = () => undefined;
beforeEach(() => {
  reset();
  stopTestTimers = trackTestTimers();
  // Date figée seulement : les fiches des deux chemins portent le même `addedAt`, les minuteries restent vraies.
  vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 10, 5, 12, 0, 0) });
});
afterEach(() => {
  vi.useRealTimers();
  stopTestTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('../../platform/memoryFolder');
  vi.doUnmock('../../core/imuPrune');
});

/** Un tour de boucle, par une minuterie : tout ce qui pouvait se faire sans le worker est fait. */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

const analysis = (patch: Partial<SessionAnalysis>): SessionAnalysis => ({
  windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, waveThreshold: null, ...patch,
} as SessionAnalysis);

const TEST_START = Date.UTC(2026, 10, 4, 8);
const TEST: SessionTest = {
  protocol: 'fc-max',
  version: 1,
  settings: { warmupS: 480, age: 35, ageSource: 'profil', lowBpm: 110, highBpm: 147, zoneMethod: 'max' },
  startMs: TEST_START,
  rampStartMs: TEST_START + 5_000,
  v0Ms: 2.5,
  steps: [{ startMs: TEST_START + 5_000, targetMs: 2.5 }],
  rampEndMs: null,
  dropMs: null,
  endReason: null,
  endMs: null,
  signals: [{ t: TEST_START, s: 'debut' }],
};

const sail = (hz: number, meta?: { name: string; type: string }): string => gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(2, 60), hz }), 'simple', meta);
const run = (hz: number, meta?: { name: string; type: string }): string => gpxOf(sailRaw({ windDeg: 0, legs: upDownLegs(2, 60), hz, polar: slowPolar }), 'simple', meta);

interface Case {
  name: string;
  text: (hz: number) => string;
  source: SessionSource;
  options: AddOptions;
  /** Calcul attendu dans la fiche. */
  sport: SportType | null;
}

const CASES: Case[] = [
  {
    name: 'sport imposé, activité et test d’un enregistrement',
    text: (hz) => run(hz),
    source: 'enregistrement',
    options: { sport: 'running', activityId: 'a-marche', test: TEST, intervals: [], marks: [] },
    sport: 'running',
  },
  {
    name: 'sport deviné de la trace, sans fiche',
    text: (hz) => run(hz, { name: 'Footing', type: 'running' }),
    source: 'import',
    options: {},
    sport: 'running',
  },
  {
    name: 'sport null : session à classer',
    text: (hz) => sail(hz),
    source: 'enregistrement',
    options: { sport: null },
    sport: null,
  },
  {
    name: 'fiche qui accompagne le GPX, avec le seuil et l’allure de la session',
    text: (hz) => sail(hz),
    source: 'import',
    options: { record: sessionRecord({ sport: 'wingfoil', analysis: analysis({ activeThreshold: 7, referenceSpeedMs: 5 }) }) },
    sport: 'wingfoil',
  },
  {
    name: 'fiche sans calcul : le calcul se devine',
    text: (hz) => sail(hz, { name: 'Bords', type: 'wingfoil' }),
    source: 'import',
    options: { record: sessionRecord({ sport: null }) },
    sport: 'wingfoil',
  },
];

/** Fichiers des sessions sur le disque, dans l'ordre d'écriture ; le fichier de réglages de l'appareil porte un identifiant tiré au sort. */
const sessionFiles = (): [string, string][] => [...files].filter(([path]) => path.startsWith('sessions/'));

/** Range une session sur une mémoire vide ; rend ce qui est sur le disque, et le résultat. */
const addOnce = async (text: string, source: SessionSource, options: AddOptions) => {
  reset();
  const { library, addGpx, sessionSummarySettings } = await openFresh();
  const result = await addGpx(text, source, options);
  const from = (options.record ?? null) as RecordWithoutSummary | null;
  // La formule d'avant le lot 161, gardée ici comme référence.
  const direct = analyzeGpx(
    text,
    options.sport !== undefined ? options.sport : from?.sport ?? undefined,
    from?.analysis,
    sessionSummarySettings(from, options.activityId ?? from?.activityId),
    options.test ? { ...from, test: options.test } : from
  );
  return { result, disk: sessionFiles(), session: result.file ? library.librarySession(result.file) : undefined, direct };
};

describe('addGpx : résumé par le worker', () => {
  for (const hz of [1, 5]) {
    for (const c of CASES) {
      it(`même fiche et même résumé en ligne et par le worker, ${c.name}, à ${hz} Hz`, async () => {
        const text = c.text(hz);
        const inline = await addOnce(text, c.source, c.options);
        useWorker();
        const worker = await addOnce(text, c.source, c.options);
        vi.unstubAllGlobals();
        expect(inline.result.status).toBe('added');
        expect(FakeWorker.posts).toHaveLength(1);
        expect(worker.result).toStrictEqual(inline.result);
        // Les fichiers, au caractère près : GPX et fiche.
        expect(worker.disk).toStrictEqual(inline.disk);
        expect(worker.session?.record).toStrictEqual(inline.session?.record);
        expect(worker.session?.record.sport).toBe(c.sport);
        // Et le résumé d'avant le lot, par le calcul direct.
        expect(worker.session?.record.summary).toStrictEqual(worker.direct?.summary);
      });
    }
  }

  it('rend la main au fil de l’affichage pendant le calcul : rien n’est écrit avant sa réponse', async () => {
    useWorker();
    FakeWorker.hold = true;
    const { addGpx } = await openFresh();
    let finished = false;
    const adding = addGpx(run(1), 'enregistrement', { sport: 'running' }).then((r) => {
      finished = true;
      return r;
    });
    // Sans capteurs ni scan à attendre, plusieurs tours de boucle passent : c'est là que « Rangement… » se peint.
    for (let i = 0; i < 3; i++) await turn();
    expect(finished).toBe(false);
    expect(log.filter((l) => l.includes('sessions/'))).toEqual([]);
    expect(FakeWorker.instances[0].held).toHaveLength(1);
    FakeWorker.instances[0].release();
    expect((await adding).status).toBe('added');
    expect(log.some((l) => l.endsWith('.gpx'))).toBe(true);
  });

  it('envoie le GPX et les réglages résolus, ceux de l’activité imposée, jamais les capteurs ni un transfert', async () => {
    useWorker();
    const { addGpx } = await openFresh();
    const motion = new Uint8Array([1, 2, 3, 4]);
    const buffer = motion.buffer;
    const result = await addGpx(run(1), 'enregistrement', { sport: 'running', activityId: 'a-marche', motion });
    expect(result.status).toBe('added');
    expect(FakeWorker.posts).toHaveLength(1);
    const [request, ...transfer] = FakeWorker.posts[0] as [TrackRequest, ...unknown[]];
    expect(transfer).toEqual([]);
    expect(Object.keys(request).sort()).toEqual(['gpxText', 'id', 'kind', 'options']);
    expect(request.kind).toBe('summarize');
    const { activitySummarySettings } = await import('./summarySettings');
    expect(request.options).toMatchObject({ sport: 'running', activitySettings: { running: activitySummarySettings('a-marche')('running') } });
    expect(Object.keys((request.options as { activitySettings: object }).activitySettings)).toEqual(['running']);
    // Rien n'est détaché : `analyzePendingSession` réutilise ces octets à chaque essai.
    expect(motion.buffer).toBe(buffer);
    expect(motion.byteLength).toBe(4);
    expect([...motion]).toEqual([1, 2, 3, 4]);
  });

  it('GPX illisible et trace trop courte : mêmes refus en ligne et par le worker, rien d’écrit', async () => {
    const one = gpxOf(sailRaw({ windDeg: 0, legs: [{ twa: 90, durationS: 0 }] }));
    const refusals = async () => {
      const { addGpx } = await openFresh();
      return [await addGpx('<gpx><trk>', 'import', {}), await addGpx(one, 'enregistrement', { sport: 'running' })];
    };
    const inline = await refusals();
    useWorker();
    const worker = await refusals();
    expect(worker).toStrictEqual(inline);
    expect(worker[0].status).toBe('invalid');
    expect(worker[0].message).toMatch(/illisible/);
    expect(worker[1]).toEqual({ status: 'invalid', file: null, message: 'Pas assez de points horodatés.' });
    expect(log.filter((l) => l.includes('sessions/'))).toEqual([]);
  });

  it('écriture en échec : l’erreur remonte, rien ne reste, et un nouvel essai range la session sous le même nom', async () => {
    useWorker();
    const { library, addGpx } = await openFresh();
    const text = run(1);
    refuseRecords = true;
    await expect(addGpx(text, 'enregistrement', { sport: 'running' })).rejects.toThrow('écriture refusée');
    refuseRecords = false;
    expect(log.some((l) => l.startsWith('write sessions/') && l.endsWith('.gpx'))).toBe(true);
    expect(sessionFiles()).toEqual([]);
    expect(library.readLibraryState().sessions).toEqual([]);
    const again = await addGpx(text, 'enregistrement', { sport: 'running' });
    expect(again.status).toBe('added');
    expect(again.file).not.toMatch(/-2\.gpx$/);
    expect(files.has(`sessions/${again.file}`)).toBe(true);
  });

  it('élagage : appliqué à l’enregistrement, capture entière s’il échoue, jamais à l’import', async () => {
    useWorker();
    const { addGpx } = await openFresh();
    const motion = new Uint8Array([9, 9, 9, 9]);
    pruneResult = new Uint8Array([9]);
    const pruned = await addGpx(sail(1), 'enregistrement', { sport: 'wingfoil', motion });
    expect(bytes.get(`sessions/${pruned.file?.replace(/\.gpx$/, '.imu')}`)).toEqual(new Uint8Array([9]));
    expect(motion.byteLength).toBe(4);

    reset();
    useWorker();
    const again = await openFresh();
    pruneResult = new Error('élagage impossible');
    const whole = await again.addGpx(sail(1), 'enregistrement', { sport: 'wingfoil', motion });
    expect(whole.status).toBe('added');
    expect(bytes.get(`sessions/${whole.file?.replace(/\.gpx$/, '.imu')}`)).toBe(motion);

    reset();
    useWorker();
    const imported = await openFresh();
    pruneResult = new Uint8Array([9]);
    const kept = await imported.addGpx(sail(1), 'import', { sport: 'wingfoil', motion });
    expect(bytes.get(`sessions/${kept.file?.replace(/\.gpx$/, '.imu')}`)).toBe(motion);
  });

  it('worker mort pendant le calcul : refait en ligne, la session est rangée pareil', async () => {
    const text = run(1);
    const inline = await addOnce(text, 'enregistrement', { sport: 'running' });
    reset();
    useWorker();
    FakeWorker.hold = true;
    const { addGpx } = await openFresh();
    const adding = addGpx(text, 'enregistrement', { sport: 'running' });
    await turn();
    FakeWorker.instances[0].onerror?.();
    expect((await adding).status).toBe('added');
    expect(sessionFiles()).toStrictEqual(inline.disk);
  });
});

describe('imports, par le même chemin', () => {
  const entry = (name: string, text: string) => ({
    name, key: name.replace(/\.gpx$/, ''), readText: async () => text, readBytes: async () => null,
  });
  const entries = () => [
    entry('a.gpx', run(1, { name: 'A', type: 'running' })),
    entry('illisible.gpx', '<gpx><trk>'),
    entry('vide.gpx', '  '),
    entry('b.gpx', gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(2, 60), startMs: Date.UTC(2026, 9, 3, 10) }), 'simple', { name: 'B', type: 'wingfoil' })),
    entry('a-encore.gpx', run(1, { name: 'A', type: 'running' })),
  ];

  it('même rapport et mêmes écritures, dans le même ordre, en ligne et par le worker, une session à la fois', async () => {
    const importAll = async () => {
      reset();
      const { library } = await openFresh();
      const report = await library.importEntries(entries());
      return { report, log: log.filter((l) => l.includes('sessions/')), disk: sessionFiles() };
    };
    const inline = await importAll();
    useWorker();
    const worker = await importAll();
    expect(worker.report).toStrictEqual(inline.report);
    expect(worker.log).toEqual(inline.log);
    expect(worker.disk).toStrictEqual(inline.disk);
    expect(worker.report.added).toHaveLength(2);
    expect(worker.report.invalid).toEqual(['illisible.gpx']);
    expect(worker.report.ignored).toEqual(['vide.gpx']);
    expect(worker.report.duplicates).toBe(1);
    expect(worker.report.existing).toEqual([worker.report.added[0]]);
    expect(worker.log.filter((l) => l.endsWith('.gpx')).map((l) => l.slice('write sessions/'.length))).toEqual(worker.report.added);
    // Trois GPX non vides lisibles, un illisible : une demande par GPX, dans l'ordre.
    expect(FakeWorker.posts).toHaveLength(4);
  });

  it('attend la réponse de chaque session avant de passer à la suivante', async () => {
    useWorker();
    FakeWorker.hold = true;
    const { library } = await openFresh();
    const importing = library.importEntries(entries());
    for (let answered = 0; answered < 4; answered++) {
      for (let i = 0; i < 20 && FakeWorker.instances[0]?.held.length !== 1; i++) await turn();
      expect(FakeWorker.instances[0].held).toHaveLength(1);
      FakeWorker.instances[0].release();
    }
    const report = await importing;
    expect(report.added).toHaveLength(2);
    expect(report.duplicates).toBe(1);
  });
});
