import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseActivity, type Activity } from '../core/activities';
import type { LocationFix } from '../platform/location';
import type { FollowedTrace } from '../recording/followedTrace';
import type { MarkGuideSettings } from '../recording/markGuide';
import { T0, at } from '../test/geo.fixture';
import type { RecorderState } from './useRecorder';

/**
 * Guidage vers les balises, sans DOM (lot 159) : l'enregistreur est un faux magasin (état, abonnés, positions), les
 * bips un faux greffon qui note ce qu'on lui demande, la trace suivie la vraie (`followTrace`). Le module est
 * réimporté neuf à chaque test. Deux balises sur une ligne vers l'est : A à l'origine, B 500 m plus loin.
 */

const A = at(0, 0);
const B = at(500, 0);

/** Bips du parcours : validation à 20 m, un bip toutes les 200 ms à 20 m, toutes les secondes à 100 m, silence au-delà. */
const COURSE_GUIDE: MarkGuideSettings = { curve: [{ distanceM: 20, intervalMs: 200 }, { distanceM: 100, intervalMs: 1000 }], vibrate: true };

const course = (markGuide: MarkGuideSettings | null = COURSE_GUIDE, marks = [A, B]): FollowedTrace => ({
  name: 'Parcours',
  source: 'route',
  activityId: null,
  points: [at(-300, 0), A, B],
  marks,
  ...(markGuide ? { markGuide } : {}),
});

const wing = baseActivity('wingfoil');

/** Faux enregistreur : ce que le guidage en lit. */
const recorder = {
  state: {} as RecorderState,
  listeners: new Set<() => void>(),
  fixListeners: new Set<(fix: LocationFix) => void>(),
  segments: [] as LocationFix[][],
};

const setRecorder = (patch: Partial<RecorderState>): void => {
  recorder.state = { ...recorder.state, ...patch };
  recorder.listeners.forEach((listener) => listener());
};

let clock = 0;
/** Une position à `eastM` mètres à l'est de A, une seconde après la précédente. */
const fix = (eastM: number): LocationFix => ({ ...at(eastM, 0), timeMs: T0 + (clock += 1000) });
const emit = (eastM: number): void => {
  const f = fix(eastM);
  recorder.fixListeners.forEach((listener) => listener(f));
};

/** Ce que le greffon des bips a reçu, dans l'ordre. */
const beeps: string[] = [];
const fakeBeeper = {
  setInterval: async (intervalMs: number | null, vibrate: boolean) => {
    beeps.push(`${intervalMs === null ? 'silence' : `rythme ${intervalMs}`}${vibrate ? '' : ' sans vibreur'}`);
  },
  validated: async () => {
    beeps.push('validée');
  },
  finished: async () => {
    beeps.push('finie');
  },
  stop: async () => {
    beeps.push('arrêt');
  },
};

/** Stockage de l'appareil (réglages, trace suivie), neuf à chaque test. */
let stored = new Map<string, string>();

const load = async () => {
  vi.resetModules();
  vi.doMock('./useRecorder', () => ({
    getRecorderState: () => recorder.state,
    subscribeToRecorder: (listener: () => void) => {
      recorder.listeners.add(listener);
      return () => recorder.listeners.delete(listener);
    },
    subscribeToFixes: (listener: (f: LocationFix) => void) => {
      recorder.fixListeners.add(listener);
      return () => recorder.fixListeners.delete(listener);
    },
    getLiveSegments: () => recorder.segments,
  }));
  vi.doMock('../platform/beeper', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../platform/beeper')>()),
    getBeeper: () => fakeBeeper,
  }));
  const guide = await import('./useMarkGuide');
  const trace = await import('./useFollowedTrace');
  guide.startMarkGuide();
  return { guide, trace };
};

/** Chargé, parcours suivi, enregistrement de `activity` en cours ; bips relevés à partir d'ici. */
const recording = async (activity: Activity = wing, followed: FollowedTrace = course()) => {
  const loaded = await load();
  loaded.trace.followTrace(followed);
  setRecorder({ status: 'recording', activity });
  beeps.length = 0;
  return loaded;
};

beforeEach(() => {
  recorder.state = { status: 'idle', activity: null, pausedReason: null, gpsLost: false, resuming: false } as RecorderState;
  recorder.listeners.clear();
  recorder.fixListeners.clear();
  recorder.segments = [];
  beeps.length = 0;
  clock = 0;
  stored = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

describe('guidage actif ou non', () => {
  it('hors voile, rien n’est actif et rien ne sonne, même avec des balises', async () => {
    const { guide } = await recording(baseActivity('running'));
    emit(-50);
    expect(guide.getMarkGuideView().active).toBe(false);
    expect(beeps).toEqual([]);
  });

  it('sans balise, rien n’est actif', async () => {
    const { guide } = await recording(wing, course(COURSE_GUIDE, []));
    emit(-50);
    expect(guide.getMarkGuideView().active).toBe(false);
    expect(beeps).toEqual([]);
  });

  it('trace retirée puis fin de l’enregistrement : le guidage s’arrête et les bips aussi, une fois', async () => {
    const { guide, trace } = await recording();
    emit(-50);
    expect(guide.getMarkGuideView()).toMatchObject({ active: true, target: 0 });
    trace.clearFollowedTrace();
    expect(guide.getMarkGuideView().active).toBe(false);
    setRecorder({ status: 'idle', activity: null });
    expect(beeps.filter((b) => b === 'arrêt')).toHaveLength(1);
  });
});

describe('rythme des bips', () => {
  it('suit la distance à la balise visée, et n’est renvoyé que s’il change', async () => {
    const { guide } = await recording();
    emit(-200);
    emit(-150);
    emit(-60);
    emit(-60);
    emit(-40);
    expect(beeps).toEqual(['silence', 'rythme 600', 'rythme 400']);
    expect(guide.getMarkGuideView().distanceM).toBeCloseTo(40, 3);
    expect(guide.getMarkGuideView().remainingM).toBeCloseTo(540, 1);
  });

  it('bip long à la balise validée, le rythme repart pour la suivante ; trois bips à la dernière', async () => {
    const { guide } = await recording();
    emit(-40);
    emit(-10);
    expect(beeps).toEqual(['rythme 400', 'validée', 'silence']);
    expect(guide.getMarkGuideView()).toMatchObject({ target: 1, outcomes: ['validated'] });
    emit(420);
    emit(490);
    expect(beeps.slice(3)).toEqual(['rythme 800', 'finie', 'silence']);
    expect(guide.getMarkGuideView()).toMatchObject({ target: 2, finished: true, remainingM: 0, distanceM: null });
  });

  it('une trace peu dense qui enjambe la balise la valide quand même (règle 10)', async () => {
    const { guide } = await recording();
    emit(-150);
    emit(150);
    expect(beeps).toContain('validée');
    expect(guide.getMarkGuideView().target).toBe(1);
  });

  it('bips coupés : silence, aucun bip à la validation ; remis, le rythme reprend', async () => {
    const { guide } = await recording();
    emit(-60);
    guide.setBeepsMuted(true);
    emit(-10);
    expect(beeps).toEqual(['rythme 600', 'silence']);
    expect(guide.getMarkGuideView()).toMatchObject({ muted: true, target: 1 });
    guide.setBeepsMuted(false);
    emit(420);
    expect(beeps.slice(2)).toEqual(['rythme 800']);
  });
});

describe('pause et GPS perdu', () => {
  it('pause manuelle : silence ; à la reprise, le segment qui enjambe la pause ne valide rien', async () => {
    const { guide } = await recording();
    emit(-40);
    setRecorder({ status: 'paused', pausedReason: 'manual' });
    expect(beeps).toEqual(['rythme 400', 'silence']);
    setRecorder({ status: 'recording', pausedReason: null });
    emit(40);
    expect(guide.getMarkGuideView()).toMatchObject({ target: 0, outcomes: [] });
    expect(beeps).not.toContain('validée');
    expect(beeps.at(-1)).toBe('rythme 400');
  });

  it('pause automatique : les positions gardent leur suite, la balise enjambée est validée', async () => {
    const { guide } = await recording();
    emit(-40);
    setRecorder({ status: 'paused', pausedReason: 'auto' });
    setRecorder({ status: 'recording', pausedReason: null });
    emit(40);
    expect(guide.getMarkGuideView().target).toBe(1);
  });

  it('GPS perdu : silence ; la position suivante relance le rythme', async () => {
    await recording();
    emit(-60);
    setRecorder({ gpsLost: true });
    expect(beeps).toEqual(['rythme 600', 'silence']);
    setRecorder({ gpsLost: false });
    emit(-60);
    expect(beeps).toEqual(['rythme 600', 'silence', 'rythme 600']);
  });
});

describe('« Passer »', () => {
  it('laisse la balise visée, vise la suivante depuis la dernière position ; sans effet une fois le parcours fini', async () => {
    const { guide } = await recording();
    emit(-60);
    guide.skipMark();
    expect(guide.getMarkGuideView()).toMatchObject({ target: 1, outcomes: ['skipped'] });
    expect(guide.getMarkGuideView().distanceM).toBeCloseTo(560, 1);
    expect(beeps).toEqual(['rythme 600', 'silence']);
    guide.skipMark();
    guide.skipMark();
    expect(guide.getMarkGuideView()).toMatchObject({ target: 2, outcomes: ['skipped', 'skipped'], finished: true });
  });
});

describe('reprise après une chute de la page (lot 156)', () => {
  it('l’état se refait en silence sur les positions déjà gardées : la balise validée le reste', async () => {
    const { guide, trace } = await load();
    trace.followTrace(course());
    recorder.segments = [[fix(-60), fix(-10)], [fix(100)]];
    setRecorder({ status: 'starting', activity: wing, resuming: true });
    expect(guide.getMarkGuideView()).toMatchObject({ active: true, target: 1, outcomes: ['validated'] });
    expect(guide.getMarkGuideView().distanceM).toBeCloseTo(400, 1);
    expect(beeps).toEqual([]);
  });

  it('sans reprise, un départ repart de la première balise', async () => {
    const { guide, trace } = await load();
    trace.followTrace(course());
    recorder.segments = [[fix(-60), fix(-10)]];
    setRecorder({ status: 'starting', activity: wing, resuming: false });
    expect(guide.getMarkGuideView()).toMatchObject({ active: true, target: 0, outcomes: [], distanceM: null });
  });
});

describe('changement d’activité', () => {
  const moth: Activity = { id: 'a-moth', name: 'Moth', base: 'wingfoil', color: '#004aad' };
  const kite: Activity = { id: 'a-kite', name: 'Kite', base: 'kite', color: '#004aad' };
  const settingsWith = () =>
    stored.set('tracker.sportSettings', JSON.stringify({
      markGuide: {
        [moth.id]: { curve: [{ distanceM: 20, intervalMs: 200 }, { distanceM: 100, intervalMs: 1000 }], vibrate: true },
        [kite.id]: { curve: [{ distanceM: 30, intervalMs: 300 }, { distanceM: 200, intervalMs: 2000 }], vibrate: false },
      },
    }));

  it('une autre activité de voile prend ses propres bips, renvoyés tout de suite', async () => {
    settingsWith();
    const { guide } = await recording(moth, course(null));
    emit(-60);
    expect(beeps).toEqual(['rythme 600']);
    setRecorder({ activity: kite });
    expect(beeps.at(-1)).toBe('rythme 600 sans vibreur');
    expect(guide.getMarkGuideView().validationRadiusM).toBe(30);
    emit(-150);
    expect(beeps.at(-1)).toBe('rythme 1500 sans vibreur');
  });

  it('le parcours qui a ses propres bips les garde', async () => {
    settingsWith();
    const { guide } = await recording(moth);
    emit(-60);
    setRecorder({ activity: kite });
    expect(guide.getMarkGuideView().validationRadiusM).toBe(20);
    expect(beeps).toEqual(['rythme 600', 'rythme 600']);
  });

  it('passer à une activité hors voile arrête le guidage', async () => {
    const { guide } = await recording();
    emit(-60);
    setRecorder({ activity: baseActivity('running') });
    expect(guide.getMarkGuideView().active).toBe(false);
    expect(beeps.at(-1)).toBe('arrêt');
  });
});
