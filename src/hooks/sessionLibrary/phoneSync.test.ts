import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySyncOutcome, type SyncOutcome } from '../../library/syncOutcome';
import { describePhoneSync } from '../../library/syncReport';
import type { SyncItem } from '../../library/syncPlan';
import type { RouteSyncItem } from '../../library/syncRoutes';
import type { SyncLockOptions } from './sync';

/**
 * La couche du bouton « Synchroniser avec le téléphone » (lot 242-2) : un clic, étapes publiées, options passées à la
 * synchronisation, questions et réponses définitives, reprise sans recherche du téléphone, reprise automatique d'un
 * élément changé en route, attentes qui repartent seules. Le téléphone et la synchronisation elle-même sont simulés
 * (l'exécutant a ses propres tests, sur le faux dossier).
 */

type State =
  | { etat: 'pret'; nom: string; ecriture?: boolean }
  | { etat: 'absent' }
  | { etat: 'autorisation' }
  | { etat: 'plusieurs'; nombre: number }
  | { etat: 'adbIntrouvable'; dossier: string };

let state: State;
let calls: SyncLockOptions[];
let outcomes: SyncOutcome[];

const held: SyncItem = {
  startMs: 1, case: 'deletedOnComputer', files: { computer: null, phone: 'a.gpx' }, ops: [], base: { kind: 'hold' }, left: 'inTrash',
  conflicts: [], twoTracks: false, withoutAncestor: false,
};

const stamp = (name: string) => ({ name, size: 10, mtimeMs: 0 });
const sent: SyncItem = {
  startMs: 2, case: 'newOnComputer', files: { computer: 'b.gpx', phone: null }, base: { kind: 'keep' }, left: null,
  ops: [{ kind: 'copy', to: 'phone', source: { gpx: stamp('b.gpx'), record: null, imu: null }, target: { gpx: 'b.gpx', record: null, imu: null }, recordText: null }],
  conflicts: [], twoTracks: false, withoutAncestor: false,
};

const synced = (patch: Partial<SyncOutcome> = {}): SyncOutcome => ({ ...emptySyncOutcome(null), phoneWritable: true, ...patch });
const inTrash = (): SyncOutcome => synced({ plan: { items: [held] } as never, done: [held] });
const guarded = (): SyncOutcome => synced({ deletions: 'awaitingConfirmation', withheldDeletions: [held] });

const READY: State = { etat: 'pret', nom: 'Xiaomi', ecriture: true };

/** États rendus d'abord, un par lecture, avant `state`. */
let stateQueue: State[];
/** Panne levée par la prochaine synchronisation. */
let failNext: Error | null;
let firstMeeting: boolean;
let copyFails: boolean;
let copies: string[];
let recordingAsked: number;
let notes: string[];

const load = async () => {
  vi.resetModules();
  vi.doMock('../../platform/phoneCable', () => ({
    phoneState: async () => stateQueue.shift() ?? state,
    phoneCanWrite: (s: State) => s.etat === 'pret' && s.ecriture === true,
    phoneMemoryFolder: (label: string) => ({
      label,
      recording: async () => {
        recordingAsked += 1;
        return false;
      },
    }),
    phoneSafetyCopyExists: async () => false,
    phoneSafetyCopy: async () => {
      if (copyFails) throw new Error('disque plein');
      copies.push('C:\\copies\\x');
      return 'C:\\copies\\x';
    },
  }));
  vi.doMock('../../platform/desktopBridge', () => ({ noteJournal: (text: string) => notes.push(text) }));
  vi.doMock('./sync', () => ({
    synchronizePhone: async (_folder: unknown, options: SyncLockOptions) => {
      calls.push(options);
      await options.phoneRecording?.();
      // Comme l'exécutant : la copie de sécurité seulement à une première rencontre.
      if (firstMeeting && options.beforeWrites) {
        try {
          await options.beforeWrites('noBase');
        } catch (err) {
          return { ...emptySyncOutcome('safetyCopy'), first: 'noBase', error: err instanceof Error ? err.message : String(err) };
        }
      }
      options.onPlanned?.({} as never, firstMeeting ? 'noBase' : null);
      options.onProgress?.(3, 5);
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
      return outcomes.shift() ?? synced({ complete: true });
    },
  }));
  return import('./phoneSync');
};

beforeEach(() => {
  firstMeeting = false;
  copyFails = false;
  copies = [];
  recordingAsked = 0;
  notes = [];
  state = READY;
  calls = [];
  outcomes = [];
  stateQueue = [];
  failNext = null;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Laisse passer les promesses en attente, sans avancer l'horloge. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('bouton « Synchroniser avec le téléphone » : un clic', () => {
  it('rien ne se perd : un clic, aucune confirmation, ni passage à blanc ; étapes publiées jusqu’au compte rendu', async () => {
    const sync = await load();
    const steps: string[] = [];
    const recording = () => false;
    const done = sync.synchronizeWithPhone({ recording });
    steps.push(sync.phoneSyncStep().step);
    await done;
    expect(steps).toEqual(['searching']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ recording, phoneRoutes: true });
    expect(calls[0].dryRun).toBeUndefined();
    expect(calls[0].withoutDeletions).toBeUndefined();
    // Gardé de Tracker : le téléphone qui enregistre est demandé à la coquille, avant toute écriture.
    expect(recordingAsked).toBe(1);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'synced', phone: 'Xiaomi' } });
    calls[0].onPlanned?.({} as never, 'noBase');
    calls[0].onProgress?.(12, 50);
    expect(sync.phoneSyncStep()).toEqual({ step: 'syncing', phone: 'Xiaomi', done: 12, total: 50, first: true });
    // Chaque étape au journal du programme, sans nom.
    expect(notes).toEqual(['Synchroniser : recherche du téléphone', 'Synchroniser : échange avec le téléphone (câble)', 'Synchroniser : compte rendu']);
    expect(notes.join(' ')).not.toContain('Xiaomi');
  });

  it('un nouvel appel pendant la synchronisation rend la même, sans la doubler', async () => {
    const sync = await load();
    const a = sync.synchronizeWithPhone();
    const b = sync.synchronizeWithPhone();
    expect(a).toBe(b);
    await a;
    expect(calls).toHaveLength(1);
  });

  it('coquille qui ne sait pas écrire : rien n’est synchronisé, le compte rendu le dit', async () => {
    state = { etat: 'pret', nom: 'Xiaomi' };
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(calls).toEqual([]);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'cannotWrite' } });
  });

  it('le téléphone qui enregistre : refus de l’exécutant, dit avec « Réessayer »', async () => {
    outcomes = [emptySyncOutcome('phoneRecording')];
    const sync = await load();
    await sync.synchronizeWithPhone();
    const step = sync.phoneSyncStep();
    if (step.step !== 'over') throw new Error('compte rendu attendu');
    expect(describePhoneSync(step.result)).toMatchObject({ action: 'retry' });
  });
});

describe('première synchronisation : écran de départ et copie de sécurité', () => {
  const stepIs = async (sync: Awaited<ReturnType<typeof load>>, step: string) => {
    await vi.waitFor(() => expect(sync.phoneSyncStep().step).toBe(step));
  };

  it('première rencontre : l’écran de départ, puis « Commencer » lance la copie et la synchronisation', async () => {
    firstMeeting = true;
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await stepIs(sync, 'firstStart');
    expect(sync.phoneSyncStep()).toEqual({ step: 'firstStart', phone: 'Xiaomi' });
    expect(copies).toEqual([]);
    sync.startFirstSync();
    await done;
    expect(copies).toEqual(['C:\\copies\\x']);
    expect(sync.phoneSyncStep().step).toBe('over');
  });

  it('pas de première rencontre : aucun écran de départ', async () => {
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(sync.phoneSyncStep().step).toBe('over');
    expect(copies).toEqual([]);
  });

  it('l’écran de départ fermé sans « Commencer » : rien n’est copié ni synchronisé, la fenêtre revient au repos', async () => {
    firstMeeting = true;
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await stepIs(sync, 'firstStart');
    sync.declineFirstSync();
    await done;
    expect(copies).toEqual([]);
    expect(sync.phoneSyncStep()).toEqual({ step: 'idle' });
  });

  it('la copie qui échoue : le compte rendu le dit, avec « Recommencer »', async () => {
    firstMeeting = true;
    copyFails = true;
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await stepIs(sync, 'firstStart');
    sync.startFirstSync();
    await done;
    const step = sync.phoneSyncStep();
    if (step.step !== 'over') throw new Error('compte rendu attendu');
    expect(describePhoneSync(step.result)).toMatchObject({
      paragraphs: ["La copie de sécurité n'a pas pu être faite : rien n'a été synchronisé."], detail: 'disque plein', action: 'restart',
    });
  });
});

describe('questions et réponses définitives', () => {
  it('une réponse repart sans repasser par la recherche du téléphone, et le compte rendu reprend la première passe', async () => {
    outcomes = [synced({ done: [sent], deletions: 'awaitingConfirmation', withheldDeletions: [held] })];
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question', question: { kind: 'guard' } });
    const answered = sync.answerPhoneSyncQuestion('deleteBoth');
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'syncing', phone: 'Xiaomi', done: 0, total: 0, first: false });
    await answered;
    const step = sync.phoneSyncStep();
    expect(step.step).toBe('over');
    expect(step.step === 'over' && step.result.kind === 'synced' && step.result.outcome.done.map((i) => i.startMs)).toEqual([2]);
  });

  it('« Tout garder » : les suppressions montrées partent comme refusées, aucune confirmation ; la question ne revient pas', async () => {
    outcomes = [guarded()];
    const sync = await load();
    await sync.synchronizeWithPhone();
    await sync.answerPhoneSyncQuestion('keepAll');
    expect(calls[1]).toMatchObject({ keepRefused: { sessions: [{ startMs: 1, side: 'phone' }], routes: [] }, confirmDeletions: false });
    expect(calls[1].confirmedDeletions).toBeUndefined();
    expect(sync.phoneSyncStep().step).toBe('over');
    // Au passage suivant, l'exécutant ne la retient plus (moteur réglé) : un clic, aucune question.
    await sync.synchronizeWithPhone();
    expect(sync.phoneSyncStep().step).toBe('over');
  });

  it('« Les garder » : les sessions et itinéraires montrés sortent de la corbeille', async () => {
    outcomes = [inTrash()];
    const sync = await load();
    await sync.synchronizeWithPhone();
    await sync.answerPhoneSyncQuestion('keepHeld');
    expect(calls[1]).toMatchObject({ heldOnPhone: 'keep', heldToKeep: [1], heldRoutesToKeep: [] });
    expect(calls[1].heldToRemove).toBeUndefined();
  });

  it('une réponse qui n’est pas celle de la question posée est sans effet', async () => {
    outcomes = [inTrash()];
    const sync = await load();
    await sync.synchronizeWithPhone();
    await sync.answerPhoneSyncQuestion('keepAll');
    await sync.answerPhoneSyncQuestion('deleteBoth');
    expect(calls).toHaveLength(1);
    expect(sync.phoneSyncStep().step).toBe('question');
  });

  it('garde-fou puis corbeille : la confirmation donnée ne couvre pas « Les retirer du téléphone », qui rouvre le garde-fou', async () => {
    outcomes = [guarded(), inTrash(), guarded()];
    const sync = await load();
    await sync.synchronizeWithPhone();
    await sync.answerPhoneSyncQuestion('deleteBoth');
    expect(calls[1]).toMatchObject({ confirmDeletions: true, confirmedDeletions: [{ startMs: 1, side: 'phone' }] });
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question', question: { kind: 'inTrash' } });
    await sync.answerPhoneSyncQuestion('removeHeld');
    expect(calls[2]).toMatchObject({ heldOnPhone: 'remove', heldToRemove: [1], confirmDeletions: false, confirmedDeletions: undefined });
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question', question: { kind: 'guard' } });
    await sync.answerPhoneSyncQuestion('deleteBoth');
    expect(calls[3]).toMatchObject({ heldOnPhone: 'remove', confirmDeletions: true });
    expect(sync.phoneSyncStep().step).toBe('over');
  });

  it('les itinéraires entrent dans les mêmes questions, et chaque réponse emporte ceux qu’elle a montrés', async () => {
    const route: RouteSyncItem = {
      id: '2026-11-01T10:00:00.000Z', createdAt: '2026-11-01T10:00:00.000Z', case: 'deletedOnComputer', files: { computer: null, phone: 'tour' },
      ops: [], base: { kind: 'hold' }, left: 'inTrash', conflict: false, revived: false,
    };
    const routes = (patch: Partial<SyncOutcome['routes']>): SyncOutcome['routes'] => ({ ...emptySyncOutcome(null).routes, ...patch });
    outcomes = [
      synced({ deletions: 'awaitingConfirmation', withheldDeletions: [held], routes: routes({ withheldDeletions: [route] }) }),
      synced({ routes: routes({ plan: { items: [route], aside: [] } as never }) }),
    ];
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question', question: { kind: 'guard', routes: [{ id: route.id, side: 'phone', label: 'tour' }] } });
    await sync.answerPhoneSyncQuestion('deleteBoth');
    expect(calls[1]).toMatchObject({ confirmedDeletions: [{ startMs: 1, side: 'phone' }], confirmedRouteDeletions: [{ id: route.id, side: 'phone' }] });
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question', question: { kind: 'inTrash' } });
    await sync.answerPhoneSyncQuestion('removeHeld');
    expect(calls[2]).toMatchObject({ heldOnPhone: 'remove', heldToRemove: [], heldRoutesToRemove: [route.id], confirmedRouteDeletions: undefined });
  });

  it('fermer la question ne décide rien : compte rendu de ce qui est fait, « Répondre » y revient, rien n’est relancé', async () => {
    outcomes = [guarded()];
    const sync = await load();
    await sync.synchronizeWithPhone();
    sync.leavePhoneSyncQuestion();
    expect(calls).toHaveLength(1);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'synced' }, unanswered: { kind: 'guard' } });
    sync.reopenPhoneSyncQuestion();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question', question: { kind: 'guard' } });
    sync.leavePhoneSyncQuestion();
    outcomes = [guarded()];
    await sync.synchronizeWithPhone();
    expect(calls).toHaveLength(2);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'question' });
  });

  it('le téléphone parti avant la réponse : ce qui était fait, la raison, et la question à reprendre', async () => {
    outcomes = [synced({ done: [sent], deletions: 'awaitingConfirmation', withheldDeletions: [held] })];
    const sync = await load();
    await sync.synchronizeWithPhone();
    state = { etat: 'absent' };
    await sync.answerPhoneSyncQuestion('keepAll');
    expect(calls).toHaveLength(1);
    expect(sync.phoneSyncStep()).toMatchObject({
      step: 'over', result: { kind: 'synced', outcome: { done: [sent] } }, unanswered: { kind: 'guard' }, answerFailed: { kind: 'phone', state: 'absent' },
    });
    sync.reopenPhoneSyncQuestion();
    state = READY;
    await sync.answerPhoneSyncQuestion('deleteBoth');
    expect(calls[1]).toMatchObject({ confirmDeletions: true });
    expect(calls[1].keepRefused).toBeUndefined();
  });
});

describe('reprise automatique', () => {
  it('un élément changé en route est repris une fois, seul, sans recherche du téléphone, avant le compte rendu', async () => {
    outcomes = [synced({ done: [sent], skipped: [held] }), synced({ done: [held] })];
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(calls).toHaveLength(2);
    const step = sync.phoneSyncStep();
    expect(step).toMatchObject({ step: 'over', result: { kind: 'synced', outcome: { skipped: [] } } });
    expect(step.step === 'over' && step.result.kind === 'synced' && step.result.outcome.done.map((i) => i.startMs)).toEqual([2, 1]);
  });

  it('changé encore à la reprise : pas de troisième passe, le compte rendu le dit', async () => {
    outcomes = [synced({ skipped: [held] }), synced({ skipped: [held] })];
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(calls).toHaveLength(2);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { outcome: { skipped: [held] } } });
  });
});

describe('attentes', () => {
  it('téléphone absent : la fenêtre attend sans synchroniser, et part seule quand il est prêt (relevé toutes les 3 s)', async () => {
    vi.useFakeTimers();
    state = { etat: 'absent' };
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await flush();
    expect(calls).toEqual([]);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { reason: 'absent', cable: null, midway: false } });
    void sync.synchronizeWithPhone();
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    expect(calls).toEqual([]);
    state = READY;
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    await done;
    expect(calls).toHaveLength(1);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'synced' } });
  });

  it('téléphone branché qui attend : autorisation, plusieurs appareils, outil absent, dits pendant l’attente', async () => {
    vi.useFakeTimers();
    state = { etat: 'autorisation' };
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await flush();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { reason: 'absent', cable: 'autorisation' } });
    state = { etat: 'plusieurs', nombre: 2 };
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { cable: 'plusieurs', count: 2 } });
    state = { etat: 'adbIntrouvable', dossier: 'C:\\outil' };
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { cable: 'adbIntrouvable', folder: 'C:\\outil' } });
    await sync.cancelPhoneSyncWait();
    await done;
    expect(sync.phoneSyncStep()).toEqual({ step: 'idle' });
    expect(calls).toEqual([]);
  });

  it('aucun téléphone jamais relié (registre du sans-fil) : l’écran « Aucun téléphone relié » ; sans registre, jamais', async () => {
    vi.useFakeTimers();
    state = { etat: 'absent' };
    const sync = await load();
    sync.setKnownPhones(async () => 0);
    const done = sync.synchronizeWithPhone();
    await flush();
    expect(sync.phoneSyncStep()).toEqual({ step: 'noPhone' });
    await sync.cancelPhoneSyncWait();
    await done;
    expect(sync.phoneSyncStep()).toEqual({ step: 'idle' });
    sync.setKnownPhones(null);
    const again = sync.synchronizeWithPhone();
    await flush();
    expect(sync.phoneSyncStep().step).toBe('waiting');
    await sync.cancelPhoneSyncWait();
    await again;
  });

  it('liaison perdue pendant l’échange : ce qui est fait est gardé, la synchronisation reprend seule', async () => {
    vi.useFakeTimers();
    outcomes = [synced({ done: [sent], linkLost: 'câble débranché' }), synced({ done: [held] })];
    stateQueue = [READY, { etat: 'absent' }];
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await flush();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { reason: 'lost', midway: true, detail: 'câble débranché' } });
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    await done;
    const step = sync.phoneSyncStep();
    expect(step).toMatchObject({ step: 'over', result: { outcome: { linkLost: null } } });
    expect(step.step === 'over' && step.result.kind === 'synced' && step.result.outcome.done.map((i) => i.startMs)).toEqual([2, 1]);
  });

  it('panne avec un téléphone présent : pas d’attente, la panne se dit avec « Recommencer », sans boucler', async () => {
    vi.useFakeTimers();
    outcomes = [synced({ done: [sent], linkLost: 'écriture refusée' })];
    const sync = await load();
    await sync.synchronizeWithPhone();
    expect(calls).toHaveLength(1);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'synced', outcome: { linkLost: 'écriture refusée', done: [sent] } } });
    failNext = new Error('lecture impossible');
    await sync.synchronizeWithPhone();
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS * 3);
    expect(calls).toHaveLength(2);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'error' } });
  });

  it('liaison perdue encore et encore : quelques reprises seules au plus, puis l’arrêt se dit', async () => {
    vi.useFakeTimers();
    outcomes = Array.from({ length: 6 }, () => synced({ done: [sent], linkLost: 'coupée' }));
    const gone: State = { etat: 'absent' };
    stateQueue = Array.from({ length: 6 }, () => [READY, gone, gone, READY]).flat();
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    await done;
    expect(calls).toHaveLength(sync.MAX_LOST_RESUMES + 1);
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'synced', outcome: { linkLost: 'coupée', done: [sent] } } });
  });

  it('« Annuler » après une passe partielle : le compte rendu de ce qui est fait, avec l’arrêt', async () => {
    vi.useFakeTimers();
    outcomes = [synced({ done: [sent], linkLost: 'coupée' })];
    stateQueue = [READY, { etat: 'absent' }];
    state = { etat: 'absent' };
    const sync = await load();
    const done = sync.synchronizeWithPhone();
    await flush();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { reason: 'lost' } });
    await sync.cancelPhoneSyncWait();
    await done;
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', result: { kind: 'synced', outcome: { done: [sent], linkLost: 'coupée' } } });
  });

  it('ordinateur occupé (import ou enregistrement) : la fenêtre attend qu’il ait fini, puis part seule', async () => {
    vi.useFakeTimers();
    let recordingNow = true;
    outcomes = [emptySyncOutcome('busy')];
    const sync = await load();
    const done = sync.synchronizeWithPhone({ recording: () => recordingNow });
    await flush();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'waiting', wait: { reason: 'busy' } });
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    expect(calls).toHaveLength(1);
    recordingNow = false;
    await vi.advanceTimersByTimeAsync(sync.WAIT_POLL_MS);
    await done;
    expect(calls).toHaveLength(2);
    expect(sync.phoneSyncStep().step).toBe('over');
  });

  it('l’ordinateur qui crée encore ses fiches est attendu, avancement montré, avant l’échange', async () => {
    const sync = await load();
    const { lib } = await import('./memory');
    let finish!: () => void;
    lib.scanCompletion = new Promise<void>((resolve) => { finish = resolve; });
    const done = sync.synchronizeWithPhone();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'computerBusy', phone: 'Xiaomi' });
    expect(calls).toEqual([]);
    finish();
    lib.scanCompletion = null;
    await done;
    expect(calls).toHaveLength(1);
  });
});
