import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedEdits } from '../library/sessionEdits';
import type { SessionDraft } from '../library/sessionDrafts';
import { createJsonStore, type StorageBackend } from '../platform/storage';
import { DRAFT_WRITE_DELAY_MS, SESSION_DRAFTS_KEY, createDraftStore, type DraftScheduler } from './sessionDraftStore';

/**
 * Magasin des brouillons (lot 234) sur un faux stockage de l'appareil et des minuteries simulées : un second magasin
 * sur le même stockage tient lieu d'application relancée, ou d'un autre onglet du navigateur.
 */

/** Faux stockage de l'appareil, qui compte ses écritures. */
const fakeBackend = () => {
  const data = new Map<string, string>();
  let writes = 0;
  const backend: StorageBackend = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      data.set(key, value);
    },
  };
  return { backend, data, writes: () => writes };
};

const base = savedEdits(null);
const draft = (comment: string): SessionDraft => ({ base, edits: { ...base, notes: { ...base.notes, comment } } });
const storeOn = (backend: StorageBackend, schedule?: DraftScheduler) => createDraftStore(createJsonStore(() => backend), schedule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('brouillons de session gardés sur l’appareil (lot 234)', () => {
  it('écrit puis rendu par un magasin neuf sur le même stockage (application relancée)', () => {
    const device = fakeBackend();
    const first = storeOn(device.backend);
    first.set('a.gpx', { base, edits: { ...draft('Un long commentaire').edits, bikeWeightKg: 11, loadKg: 4 } });
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    const relaunched = storeOn(device.backend);
    expect(relaunched.get('a.gpx')?.edits.notes.comment).toBe('Un long commentaire');
    expect(relaunched.get('a.gpx')?.edits.bikeWeightKg).toBe(11);
    expect(relaunched.get('a.gpx')?.edits.loadKg).toBe(4);
    expect(relaunched.get('b.gpx')).toBeNull();
  });

  it('une seule écriture après plusieurs frappes, 1 s après la dernière', () => {
    const device = fakeBackend();
    const store = storeOn(device.backend);
    for (const text of ['U', 'Un', 'Un l', 'Un long']) {
      store.set('a.gpx', draft(text));
      vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS / 4);
    }
    expect(device.writes()).toBe(0);
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    expect(device.writes()).toBe(1);
    expect(JSON.parse(device.data.get(SESSION_DRAFTS_KEY) ?? 'null')['a.gpx'].edits.notes.comment).toBe('Un long');
  });

  it('horloge injectée : l’écriture attend le programmateur, `flush` l’avance', () => {
    const device = fakeBackend();
    const pending: (() => void)[] = [];
    const store = storeOn(device.backend, (run) => {
      pending.push(run);
      return () => undefined;
    });
    store.set('a.gpx', draft('A'));
    expect(device.writes()).toBe(0);
    store.flush();
    expect(device.writes()).toBe(1);
    // Rien de neuf : ni le programmateur ni un second `flush` n'écrivent.
    pending.forEach((run) => run());
    store.flush();
    expect(device.writes()).toBe(1);
  });

  it('effacé à l’enregistrement comme à l’annulation (brouillon retiré)', () => {
    const device = fakeBackend();
    const store = storeOn(device.backend);
    store.set('a.gpx', draft('A'));
    store.set('b.gpx', draft('B'));
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    store.set('a.gpx', null);
    store.set('b.gpx', null);
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    const relaunched = storeOn(device.backend);
    expect(relaunched.get('a.gpx')).toBeNull();
    expect(relaunched.get('b.gpx')).toBeNull();
  });

  it('un brouillon qui ne change rien n’est pas écrit', () => {
    const device = fakeBackend();
    const store = storeOn(device.backend);
    store.set('a.gpx', { base, edits: base });
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    expect(device.writes()).toBe(0);
    expect(store.get('a.gpx')).toBeNull();
  });

  it('jeté si la session n’existe plus : supprimée, ou absente de la mémoire lue en entier', () => {
    const device = fakeBackend();
    const store = storeOn(device.backend);
    store.enterMemory('navigateur:');
    store.set('a.gpx', draft('A'));
    store.set('b.gpx', draft('B'));
    store.set('c.gpx', draft('C'));
    store.forget(['a.gpx']);
    store.keepOnly('navigateur:', new Set(['b.gpx', 'b.json']));
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    const relaunched = storeOn(device.backend);
    expect(['a.gpx', 'b.gpx', 'c.gpx'].map((file) => relaunched.get(file) !== null)).toEqual([false, true, false]);
  });

  it('un changement de mémoire ne jette pas le brouillon : dossier désigné, puis retour au navigateur', () => {
    const device = fakeBackend();
    const store = storeOn(device.backend);
    store.enterMemory('navigateur:');
    store.set('x.gpx', draft('Saisie pas enregistrée'));
    // Dossier désigné : lu en entier avant la recopie des sessions, il ne porte pas encore x.gpx.
    store.enterMemory('dossier:Voile');
    store.keepOnly('dossier:Voile', new Set(['autre.gpx']));
    expect(store.get('x.gpx')?.edits.notes.comment).toBe('Saisie pas enregistrée');
    store.enterMemory('navigateur:');
    store.keepOnly('navigateur:', new Set(['x.gpx']));
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    expect(storeOn(device.backend).get('x.gpx')?.edits.notes.comment).toBe('Saisie pas enregistrée');
  });

  it('deux onglets du navigateur : chacun n’écrit que ses propres brouillons', () => {
    const device = fakeBackend();
    const tabA = storeOn(device.backend);
    tabA.set('x.gpx', draft('X'));
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    const tabB = storeOn(device.backend);
    expect(tabB.get('x.gpx')).not.toBeNull();
    tabB.set('y.gpx', draft('Y'));
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    tabA.set('x.gpx', draft('X modifié'));
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    const relaunched = storeOn(device.backend);
    expect(relaunched.get('x.gpx')?.edits.notes.comment).toBe('X modifié');
    expect(relaunched.get('y.gpx')?.edits.notes.comment).toBe('Y');
    tabB.set('y.gpx', null);
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS);
    const after = storeOn(device.backend);
    expect(after.get('x.gpx')?.edits.notes.comment).toBe('X modifié');
    expect(after.get('y.gpx')).toBeNull();
  });

  it('forme illisible ignorée', () => {
    const device = fakeBackend();
    device.data.set(SESSION_DRAFTS_KEY, '{pas du json');
    expect(storeOn(device.backend).get('a.gpx')).toBeNull();
    device.data.set(SESSION_DRAFTS_KEY, JSON.stringify({ 'a.gpx': { base: 1, edits: 'x' } }));
    expect(storeOn(device.backend).get('a.gpx')).toBeNull();
  });

  it('vidé tout de suite quand la page est cachée (application en arrière-plan), sans attendre le délai', async () => {
    const device = fakeBackend();
    const listeners = new Map<string, () => void>();
    const target = { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) };
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', { ...target, visibilityState: 'hidden' });
    vi.stubGlobal('localStorage', device.backend);
    vi.resetModules();
    try {
      const { sessionDraftStore } = await import('./sessionDraftStore');
      sessionDraftStore.set('a.gpx', draft('Avant la fermeture'));
      expect(device.writes()).toBe(0);
      listeners.get('visibilitychange')?.();
      expect(device.writes()).toBe(1);
      expect(device.data.get(SESSION_DRAFTS_KEY)).toContain('Avant la fermeture');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
