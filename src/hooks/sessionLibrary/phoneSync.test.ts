import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_GUARD_LIMITS, type SyncItem, type SyncPlan } from '../../library/syncPlan';
import { emptySyncOutcome, type SyncOutcome } from '../../library/syncOutcome';
import type { SyncLockOptions } from './sync';

/**
 * La couche du bouton « Synchroniser avec le téléphone » : un passage à blanc d'abord, la confirmation chiffrée, et
 * seulement après la réponse la vraie synchronisation, avec les options que la réponse demande. Le téléphone et
 * l'exécutant sont simulés (l'exécutant a ses propres tests, sur le faux dossier).
 */

type State = { etat: 'pret'; nom: string } | { etat: 'absent' } | { etat: 'adbIntrouvable'; dossier: string };

let state: State;
let writable: boolean;
let calls: SyncLockOptions[];
let outcomes: SyncOutcome[];
let copies: number;
let recordingAsked: number;

const stamp = (name: string) => ({ name, size: 10, mtimeMs: 0 });
const item = (patch: Partial<SyncItem>): SyncItem => ({
  startMs: 1, case: 'newOnComputer', files: { computer: 'a.gpx', phone: null }, ops: [], base: { kind: 'keep' }, left: null,
  conflicts: [], twoTracks: false, withoutAncestor: false, ...patch,
});
const toPhone = item({ startMs: 1, ops: [{ kind: 'copy', to: 'phone', source: { gpx: stamp('a.gpx'), record: null, imu: null }, target: { gpx: 'a.gpx', record: null, imu: null }, recordText: null }] });
const removed = item({
  startMs: 2, case: 'deletedOnComputer', files: { computer: null, phone: 'b.gpx' },
  ops: [{ kind: 'removeFromPhone', files: [stamp('b.gpx')], absent: null, keep: 'none', recordText: null, moveTo: 'Tracker-corbeille/2026-11-26' }],
});

const planOf = (items: SyncItem[], first: SyncPlan['pair']['first'] = null): SyncPlan => ({
  pair: { first, base: null, newId: { computer: false, phone: false } }, saveBase: true, items, duplicates: [], unknown: [],
  guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 0, count: { computer: 5, phone: 5 } },
});
const preview = (items: SyncItem[], first: SyncPlan['pair']['first'] = null): SyncOutcome => ({
  ...emptySyncOutcome(null), preview: true, phoneWritable: true, first, plan: planOf(items, first), names: { sessions: { 2: 'Sortie du 2' }, routes: {} },
});
const done = (): SyncOutcome => ({ ...emptySyncOutcome(null), phoneWritable: true, plan: planOf([toPhone]), done: [toPhone], complete: true, phoneChanged: true });

const load = async () => {
  vi.resetModules();
  vi.doMock('../../platform/phoneCable', () => ({
    phoneState: async () => state,
    phoneCanWrite: () => writable,
    phoneMemoryFolder: (label: string) => ({
      label, recording: async () => {
        recordingAsked += 1;
        return false;
      },
    }),
    phoneSafetyCopyExists: async () => false,
    phoneSafetyCopy: async () => {
      copies += 1;
      return 'C:\\Documents\\Tracker-copies\\2026-11-26 10-00-00';
    },
  }));
  vi.doMock('./sync', () => ({
    synchronizePhone: async (_folder: unknown, options: SyncLockOptions) => {
      calls.push(options);
      await options.phoneRecording?.();
      if (!options.dryRun && options.beforeWrites) await options.beforeWrites('noBase');
      options.onProgress?.(1, 2);
      return outcomes.shift() ?? done();
    },
  }));
  return import('./phoneSync');
};

beforeEach(() => {
  state = { etat: 'pret', nom: 'Xiaomi' };
  writable = true;
  calls = [];
  outcomes = [];
  copies = 0;
  recordingAsked = 0;
});

describe('bouton « Synchroniser avec le téléphone »', () => {
  it('passage à blanc d’abord : la confirmation chiffrée, rien d’écrit, aucune copie avant la réponse', async () => {
    const sync = await load();
    outcomes = [preview([toPhone, removed], 'noBase')];
    await sync.startPhoneSync();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ dryRun: true, phoneRoutes: true });
    expect(recordingAsked).toBe(1);
    expect(copies).toBe(0);
    const step = sync.phoneSyncStep();
    expect(step.step).toBe('confirm');
    if (step.step !== 'confirm') return;
    expect(step.first).toBe(true);
    expect(step.confirmation.counts).toBe('1 à copier vers le téléphone, 1 à retirer');
    expect(step.confirmation.removals.sessions).toEqual([{ startMs: 2, side: 'phone', label: 'Sortie du 2' }]);
  });

  it('« Synchroniser sans rien supprimer » : tout sauf les retraits, copie de sécurité faite par l’exécutant, puis le compte rendu', async () => {
    const sync = await load();
    outcomes = [preview([toPhone, removed], 'noBase')];
    await sync.startPhoneSync();
    await sync.confirmPhoneSync(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ withoutDeletions: true, phoneRoutes: true });
    expect(calls[1].dryRun).toBeUndefined();
    expect(calls[1].confirmDeletions).toBeUndefined();
    expect(copies).toBe(1);
    const step = sync.phoneSyncStep();
    expect(step).toMatchObject({ step: 'over', report: { title: 'Synchronisation faite' } });
    if (step.step === 'over') expect(step.report.notes.some((n) => n.startsWith('Sur le téléphone, touchez « Mettre à jour »'))).toBe(true);
  });

  it('« Synchroniser et retirer » : les seuls retraits montrés sont confirmés', async () => {
    const sync = await load();
    outcomes = [preview([toPhone, removed])];
    await sync.startPhoneSync();
    await sync.confirmPhoneSync(true);
    expect(calls[1]).toMatchObject({ confirmDeletions: true, confirmedDeletions: [{ startMs: 2, side: 'phone' }], confirmedRouteDeletions: [] });
    expect(calls[1].withoutDeletions).toBeUndefined();
  });

  it('rien à retirer dans l’aperçu : « sans rien supprimer » quand même, un retrait apparu depuis n’est jamais fait', async () => {
    const sync = await load();
    outcomes = [preview([toPhone])];
    await sync.startPhoneSync();
    await sync.confirmPhoneSync(false);
    expect(calls[1].withoutDeletions).toBe(true);
    expect(calls[1].confirmDeletions).toBeUndefined();
    // « Retirer » sans rien de montré n'est pas offert : la réponse vaut « sans rien supprimer ».
    outcomes = [preview([toPhone])];
    await sync.startPhoneSync();
    await sync.confirmPhoneSync(true);
    expect(calls[3]).toMatchObject({ withoutDeletions: true });
    expect(calls[3].confirmDeletions).toBeUndefined();
  });

  it('« Annuler » : rien n’est fait', async () => {
    const sync = await load();
    outcomes = [preview([toPhone])];
    await sync.startPhoneSync();
    sync.cancelPhoneSync();
    expect(sync.phoneSyncStep()).toEqual({ step: 'idle' });
    await sync.confirmPhoneSync(false);
    expect(calls).toHaveLength(1);
  });

  it('rien à copier mais une synchronisation coupée à terminer : la confirmation est montrée', async () => {
    const sync = await load();
    outcomes = [{ ...preview([]), interrupted: true }];
    await sync.startPhoneSync();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'confirm', interrupted: true });
  });

  it('rien à échanger : dit aussitôt, sans seconde passe', async () => {
    const sync = await load();
    outcomes = [preview([])];
    await sync.startPhoneSync();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', report: { paragraphs: ['Les deux appareils sont déjà à jour : rien à échanger.'] } });
    expect(calls).toHaveLength(1);
  });

  it('téléphone qui enregistre : refus dit en clair, sans confirmation', async () => {
    const sync = await load();
    outcomes = [emptySyncOutcome('phoneRecording')];
    await sync.startPhoneSync();
    const step = sync.phoneSyncStep();
    expect(step.step).toBe('over');
    if (step.step === 'over') expect(step.report.paragraphs[0]).toMatch(/^Le téléphone enregistre une session : rien n'a été fait/);
  });

  it('téléphone pas prêt, outil absent, programme qui ne sait pas écrire : dit sans rien lancer', async () => {
    const sync = await load();
    state = { etat: 'absent' };
    await sync.startPhoneSync();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', report: { retry: true } });
    state = { etat: 'adbIntrouvable', dossier: 'C:\\profil' };
    await sync.startPhoneSync();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', folder: 'C:\\profil' });
    state = { etat: 'pret', nom: 'Xiaomi' };
    writable = false;
    await sync.startPhoneSync();
    expect(sync.phoneSyncStep()).toMatchObject({ step: 'over', report: { retry: false } });
    expect(calls).toEqual([]);
  });
});
