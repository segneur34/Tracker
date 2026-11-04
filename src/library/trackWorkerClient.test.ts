import { afterEach, describe, expect, it, vi } from 'vitest';
import { kinematicsProfileOf, prepareTrack } from '../core/prepareTrack';
import { getSportProfile } from '../core/sportProfiles';
import { sessionRecord } from '../test/record.fixture';
import { gpxOf, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { summarizeGpx, summarizeGpxOptions } from './summarizeGpx';
import { resetTrackWorker, runInWorker } from './trackWorkerClient';
import { handleTrackRequest, type TrackRequest, type TrackResponse } from './trackWorkerProtocol';

/**
 * Client du worker des traces (lot 126 B), sous node par un faux worker : il répond par le vrai aiguillage
 * (`handleTrackRequest`), messages passés par un clonage structuré à l'aller et au retour, comme un vrai. Un seul
 * worker pour plusieurs demandes, réponses rendues par leur identifiant, worker mort ou refusé : calcul en ligne,
 * mêmes chiffres, mêmes erreurs.
 */

/** Faux worker : répond au tour suivant, sauf `hold`, où il garde les demandes jusqu'à `release`. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static hold = false;
  onmessage: ((event: { data: TrackResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  held: TrackRequest[] = [];
  readonly url: string;
  readonly options: unknown;

  constructor(url: URL, options: unknown) {
    this.url = String(url);
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(data: TrackRequest): void {
    const request = structuredClone(data);
    if (FakeWorker.hold) this.held.push(request);
    else queueMicrotask(() => this.answer(request));
  }

  answer(request: TrackRequest): void {
    if (!this.terminated) this.onmessage?.({ data: structuredClone(handleTrackRequest(request)) });
  }

  /** Rend les demandes gardées, dans l'ordre donné. */
  release(order: 'reverse' | 'same' = 'same'): void {
    const held = order === 'reverse' ? [...this.held].reverse() : [...this.held];
    this.held = [];
    for (const request of held) this.answer(request);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const wing = kinematicsProfileOf(getSportProfile('wingfoil'));
const textA = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(2, 60), hz: 5 }));
const textB = gpxOf(sailRaw({ windDeg: 200, legs: upDownLegs(3, 40), hz: 1, seed: 3 }));
const BAD = '<gpx><trk>';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Erreur levée par un appel, ou `null`. */
const thrown = async (run: () => Promise<unknown>): Promise<Error | null> => {
  try {
    await run();
    return null;
  } catch (err) {
    return err as Error;
  }
};

afterEach(() => {
  resetTrackWorker();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.hold = false;
});

describe('runInWorker', () => {
  it('sans Worker : en ligne, le résultat de prepareTrack', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(await runInWorker('prepare', textA, { profile: wing, fileName: 'a.gpx' })).toStrictEqual(prepareTrack(textA, { profile: wing, fileName: 'a.gpx' }));
  });

  it('un seul worker pour plusieurs demandes, module ES, mêmes résultats qu’en ligne', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const record = sessionRecord({ sport: 'wingfoil' });
    const options = summarizeGpxOptions(record, () => ({ thresholdOverride: 8, foil: true }));
    const [a, b, summary] = await Promise.all([
      runInWorker('prepare', textA, { profile: wing }),
      runInWorker('prepare', textB, {}),
      runInWorker('summarize', textA, options),
    ]);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].url).toMatch(/trackWorker\.ts/);
    expect(FakeWorker.instances[0].options).toEqual({ type: 'module' });
    expect(a).toStrictEqual(prepareTrack(textA, { profile: wing }));
    expect(b).toStrictEqual(prepareTrack(textB, {}));
    expect(summary).toStrictEqual(summarizeGpx(textA, options));
  });

  it('réponses dans le désordre : chacune rendue à sa demande', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.hold = true;
    const a = runInWorker('prepare', textA, {});
    const b = runInWorker('prepare', textB, {});
    FakeWorker.instances[0].release('reverse');
    expect(await a).toStrictEqual(prepareTrack(textA));
    expect(await b).toStrictEqual(prepareTrack(textB));
  });

  it('erreur du calcul : même nom et même message qu’en ligne', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const viaWorker = await thrown(() => runInWorker('prepare', BAD, {}));
    vi.stubGlobal('Worker', undefined);
    resetTrackWorker();
    const inline = await thrown(() => runInWorker('prepare', BAD, {}));
    expect(viaWorker).toBeInstanceOf(Error);
    expect(viaWorker?.message).toBe(inline?.message);
    expect(viaWorker?.name).toBe(inline?.name);
    expect(inline?.message).toMatch(/illisible/);
  });

  it('worker mort après avoir répondu : demandes en cours refaites en ligne, le suivant est recréé', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    await runInWorker('prepare', textB, {});
    FakeWorker.hold = true;
    const waiting = runInWorker('prepare', textA, { profile: wing });
    FakeWorker.instances[0].onerror?.();
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(await waiting).toStrictEqual(prepareTrack(textA, { profile: wing }));
    FakeWorker.hold = false;
    expect(await runInWorker('prepare', textB, {})).toStrictEqual(prepareTrack(textB));
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('worker mort avant toute réponse : en ligne jusqu’au rechargement', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.hold = true;
    const waiting = runInWorker('prepare', textB, {});
    FakeWorker.instances[0].onmessageerror?.();
    expect(await waiting).toStrictEqual(prepareTrack(textB));
    FakeWorker.hold = false;
    expect(await runInWorker('prepare', textA, {})).toStrictEqual(prepareTrack(textA));
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('création qui lève : en ligne, sans retenter', async () => {
    let attempts = 0;
    vi.stubGlobal('Worker', class {
      constructor() {
        attempts += 1;
        throw new Error('refusé');
      }
    });
    expect(await runInWorker('prepare', textB, {})).toStrictEqual(prepareTrack(textB));
    expect(await runInWorker('prepare', textB, {})).toStrictEqual(prepareTrack(textB));
    expect(attempts).toBe(1);
  });

  it('une réponse d’un worker déjà remplacé n’est rendue à personne', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.hold = true;
    const waiting = runInWorker('prepare', textB, {});
    const first = FakeWorker.instances[0];
    resetTrackWorker();
    // Refaite en ligne par l'oubli du worker ; sa réponse tardive ne change rien.
    first.terminated = false;
    first.release();
    await flush();
    expect(await waiting).toStrictEqual(prepareTrack(textB));
  });
});
