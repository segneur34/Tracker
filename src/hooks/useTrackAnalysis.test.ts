import { afterEach, describe, expect, it, vi } from 'vitest';
import { kinematicsProfileOf, prepareTrack, type PrepareTrackOptions } from '../core/prepareTrack';
import { getSportProfile } from '../core/sportProfiles';
import { createAnalysisStore, type AnalyzeSailingOptions } from '../library/analysisStore';
import { analyzeOnKeptTrace, resetTrackWorker, runInWorker } from '../library/trackWorkerClient';
import { analysisMemoryKey, handleTrackRequest, type TrackRequest, type TrackResponse } from '../library/trackWorkerProtocol';
import { retainedWind } from '../sailing/sailingSession';
import { gpxOf, sailRaw, upDownLegs } from '../test/sailing.fixture';
import { gpxSettled, preparedState, type AnalysisSource, type GpxSource } from './useGpxSession';
import { analysisView, colorKeyOf, createTrackAnalysisRequests, type AnalysisPair } from './useTrackAnalysis';

/**
 * Logique de `useTrackAnalysis` (lot 235), hors React : ce que la page montre d'une analyse reçue (jamais celle d'un
 * autre fichier ; les anciens chiffres gardés, en attente, tant qu'elle ne répond pas à la trace et aux entrées
 * demandées : le brouillon relance le calcul sans vider l'écran), et les demandes au calcul, en ligne comme par un faux
 * worker : la dernière gagne, quitter vide la mémoire.
 */

/** Faux worker : répond par le vrai aiguillage, messages clonés ; `hold` garde les demandes jusqu'à `flushHeld`. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static hold = false;
  onmessage: ((event: { data: TrackResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  held: TrackRequest[] = [];
  received: TrackRequest[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(data: TrackRequest): void {
    const request = structuredClone(data);
    this.received.push(request);
    if (FakeWorker.hold) this.held.push(request);
    else queueMicrotask(() => this.answer(request));
  }

  answer(request: TrackRequest): void {
    this.onmessage?.({ data: structuredClone(handleTrackRequest(request)) });
  }

  flushHeld(): void {
    const held = this.held;
    this.held = [];
    for (const request of held) this.answer(request);
  }

  terminate(): void {}
}

const profile = getSportProfile('wingfoil');
const textA = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(2, 60), hz: 5 }));
const textB = gpxOf(sailRaw({ windDeg: 200, legs: upDownLegs(3, 40), hz: 1, seed: 3 }));
const prepareOf = (name: string, referenceSpeedOverrideMs?: number): PrepareTrackOptions =>
  ({ fileName: `${name}.gpx`, profile: kinematicsProfileOf(profile), referenceSpeedOverrideMs });

/** Trace affichée d'une session, comme `useGpxSession` la donne à l'analyse. */
const sourceOf = (text: string, name: string, key = 'page', referenceSpeedOverrideMs?: number): AnalysisSource => {
  const prepare = prepareOf(name, referenceSpeedOverrideMs);
  return { from: { text, fileName: `${name}.gpx` }, prepared: prepareTrack(text, prepare), prepare, key, traceId: 1 };
};

const sailingOptions = (source: AnalysisSource, thresholdKn: number, windDeg: number | null): AnalyzeSailingOptions => ({
  key: source.key, traceId: source.traceId, prepare: source.prepare, sport: 'wingfoil', profile, thresholdKn, windDeg,
  color: { treatment: 'voile', sessionRange: null, activityRange: null, fallback: profile.speedRange },
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  resetTrackWorker();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.hold = false;
});

describe('analysisView : la trace et son analyse, inséparables', () => {
  const a = sourceOf(textA, 'a');
  const b = sourceOf(textB, 'b');
  const pairOf = (source: AnalysisSource, inputs: string): AnalysisPair<string> => ({ source, inputs, result: inputs });

  it('rien de lu : rien de montré, rien en attente', () => {
    expect(analysisView(pairOf(a, 'x'), null, 'x')).toStrictEqual({ pair: null, reading: false, pending: false });
  });

  it('trace neuve sans sa première analyse : rien de montré, lecture ; l’analyse d’un autre fichier n’est jamais montrée', () => {
    expect(analysisView(null, a, 'x')).toStrictEqual({ pair: null, reading: true, pending: true });
    expect(analysisView(pairOf(a, 'x'), b, 'x')).toStrictEqual({ pair: null, reading: true, pending: true });
  });

  it('analyse à jour : montrée, sans attente', () => {
    const pair = pairOf(a, 'x');
    expect(analysisView(pair, a, 'x')).toStrictEqual({ pair, reading: false, pending: false });
  });

  it('brouillon changé (vent saisi, seuil, couleurs), trace relue pour une autre allure, lecture pas à jour : les anciens chiffres restent, en attente', () => {
    const pair = pairOf(a, 'x');
    expect(analysisView(pair, a, 'y')).toStrictEqual({ pair, reading: false, pending: true });
    const reread = sourceOf(textA, 'a', 'page', 3.5);
    expect(analysisView(pair, reread, 'x')).toStrictEqual({ pair, reading: false, pending: true });
    expect(analysisView(pair, a, 'x', false)).toStrictEqual({ pair, reading: false, pending: true });
  });
});

describe('gpxSettled : la trace affichée répond-elle à la demande ?', () => {
  const from: GpxSource = { text: textA, fileName: 'a.gpx' };
  const filters = kinematicsProfileOf(profile);
  const shown = preparedState(from, prepareTrack(textA, { fileName: 'a.gpx', profile: filters }), { fileName: 'a.gpx', profile: filters });

  it('rien demandé : rien n’attend ; la trace de la source et des filtres demandés : à jour', () => {
    expect(gpxSettled({ source: null, shown }, filters, undefined)).toBe(true);
    expect(gpxSettled({ source: from, shown }, filters, undefined)).toBe(true);
  });

  it('autre allure imposée ou autres filtres en cours de relecture, autre source : pas à jour', () => {
    expect(gpxSettled({ source: from, shown }, filters, 3.2)).toBe(false);
    expect(gpxSettled({ source: from, shown }, kinematicsProfileOf(getSportProfile('kite')), undefined)).toBe(false);
    expect(gpxSettled({ source: { ...from }, shown }, filters, undefined)).toBe(false);
  });
});

describe('vent montré (`retainedWind`) pendant un recalcul', () => {
  const a = sourceOf(textA, 'a');
  const store = createAnalysisStore();
  const before = store.analyzeSailing(textA, sailingOptions(a, 12, 20)).analysis;
  const estimated = store.analyzeSailing(textA, sailingOptions(a, 12, null)).analysis;

  it('vent saisi : montré tout de suite, ramené dans [0 ; 360[, avant que l’analyse ait bougé', () => {
    expect(before.currentWindValue).toBe(20);
    expect(retainedWind(200, before.windEstimate)).toBe(200);
    expect(retainedWind(-160, before.windEstimate)).toBe(200);
  });

  it('vent effacé : l’estimation de l’analyse montrée, celle que le recalcul retiendra', () => {
    expect(retainedWind(null, before.windEstimate)).toBe(estimated.currentWindValue);
    expect(retainedWind(null, estimated.windEstimate && { ...estimated.windEstimate, reliable: false })).toBeNull();
    expect(retainedWind(null, null)).toBeNull();
  });
});

describe('colorKeyOf', () => {
  it('bornes ordonnées comme le calcul : session, activité, suggestion, défaut ; sans couleurs, texte vide', () => {
    const color = { treatment: 'voile' as const, sessionRange: null, activityRange: null, fallback: { minMs: 3, maxMs: 12 } };
    expect(colorKeyOf(null, null)).toBe('');
    expect(colorKeyOf(color, { minMs: 4, maxMs: 10 })).toBe(JSON.stringify(['voile', 4, 10]));
    expect(colorKeyOf(color, null)).toBe(JSON.stringify(['voile', 3, 12]));
    expect(colorKeyOf({ ...color, activityRange: { minMs: 2, maxMs: 8 } }, { minMs: 4, maxMs: 10 })).toBe(JSON.stringify(['voile', 2, 8]));
    expect(colorKeyOf({ ...color, sessionRange: { minMs: 5, maxMs: 9 } }, { minMs: 4, maxMs: 10 })).toBe(JSON.stringify(['voile', 5, 9]));
  });
});

describe('createTrackAnalysisRequests : la dernière demande gagne, quitter vide la mémoire', () => {
  it('seuil tiré trois fois de suite pendant un calcul : la première et la dernière calculées, seule la dernière montrée, égale au calcul direct', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const a = sourceOf(textA, 'a');
    await runInWorker('prepare', textA, { ...a.prepare, analysisKey: a.key, traceId: a.traceId });
    const requests = createTrackAnalysisRequests<unknown>();
    FakeWorker.hold = true;
    const ask = (thresholdKn: number) =>
      requests.request(a, String(thresholdKn), () => analyzeOnKeptTrace(textA, sailingOptions(a, thresholdKn, null)));
    const first = ask(10);
    const second = ask(11);
    const third = ask(12);
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker.held).toHaveLength(1);
    worker.flushHeld();
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    await flush();
    worker.flushHeld();
    const shown = await third;
    expect(shown?.inputs).toBe('12');
    expect(shown?.source).toBe(a);
    const analyzed = worker.received.filter((r) => r.kind === 'analyzeSailing').map((r) => (r.options as AnalyzeSailingOptions).thresholdKn);
    expect(analyzed).toEqual([10, 12]);
    // La trace gardée : aucune des deux demandes ne porte le texte du GPX.
    expect(worker.received.filter((r) => r.kind === 'analyzeSailing').map((r) => r.gpxText)).toEqual(['', '']);
    expect(shown?.result).toStrictEqual(createAnalysisStore().analyzeSailing(textA, sailingOptions(a, 12, null)));
  });

  it('page quittée : le calcul en vol est dépassé, la mémoire de la session vidée', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const a = sourceOf(textA, 'a', 'quittée');
    await runInWorker('prepare', textA, { ...a.prepare, analysisKey: a.key, traceId: a.traceId });
    expect(analysisMemoryKey()).toBe('quittée');
    const requests = createTrackAnalysisRequests<unknown>();
    FakeWorker.hold = true;
    const flying = requests.request(a, 'x', () => runInWorker('analyzeSailing', textA, sailingOptions(a, 12, null)));
    const left = requests.leave(a.key);
    FakeWorker.instances[0].flushHeld();
    await left;
    expect(await flying).toBeNull();
    // La demande en vol, servie avant `release`, a pu regarnir la mémoire : `release` passe après elle, dans l'ordre.
    expect(analysisMemoryKey()).toBeNull();
  });

  it('sans Worker : tout en ligne, mêmes résultats', async () => {
    vi.stubGlobal('Worker', undefined);
    const b = sourceOf(textB, 'b');
    const requests = createTrackAnalysisRequests<unknown>();
    const pair = await requests.request(b, 'x', () => runInWorker('analyzeSailing', textB, sailingOptions(b, 9, 210)));
    expect(pair?.result).toStrictEqual(createAnalysisStore().analyzeSailing(textB, sailingOptions(b, 9, 210)));
    await requests.leave(b.key);
    expect(analysisMemoryKey()).toBeNull();
  });
});
