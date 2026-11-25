import {
  draftsOfMissingSessions, mergedSessionDrafts, parseSessionDrafts, sessionDraftsDocument, withSessionDraft,
  withoutSessionDrafts, type KeptDraft, type SessionDraft,
} from '../library/sessionDrafts';
import { onPageHidden } from '../platform/previewStore';
import { jsonStore, type JsonStore } from '../platform/storage';

/**
 * Magasin des brouillons de session gardés sur l'appareil (lot 234, `library/sessionDrafts.ts`) : le document est lu
 * au premier besoin, tenu en mémoire, et réécrit en entier peu après le dernier changement (pas une écriture par
 * frappe), aussitôt si la page est quittée ou cachée (application passée en arrière-plan) et avant la fermeture
 * (`flushBeforeExit`). Une seule clé de l'appareil, dont on réécrit l'objet.
 */

/** Clé de l'appareil du document des brouillons. */
export const SESSION_DRAFTS_KEY = 'tracker.brouillons';

/** Programme `run` ; rend de quoi l'annuler. */
export type DraftScheduler = (run: () => void) => () => void;

/** Délai entre le dernier changement d'un brouillon et l'écriture du document. */
export const DRAFT_WRITE_DELAY_MS = 1000;

/** `run` programmé après `ms` millisecondes. */
export const delayedBy = (ms: number): DraftScheduler => (run) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export interface DraftStore {
  /** Brouillon gardé de la session `file`, `null` sans brouillon. L'objet rendu ne doit pas être modifié. */
  get(file: string): SessionDraft | null;
  /** Pose le brouillon de `file`, vu dans la mémoire en service ; `null`, ou un brouillon qui ne change rien, le retire. */
  set(file: string, draft: SessionDraft | null): void;
  /** Retire les brouillons de ces fichiers (session supprimée). */
  forget(files: Iterable<string>): void;
  /** Mémoire mise en service (`folderId`), `null` sans mémoire : celle que notent les brouillons posés ensuite. */
  enterMemory(memory: string | null): void;
  /** Retire les brouillons faits dans la mémoire `memory` dont elle, lue en entier, ne porte plus la session. */
  keepOnly(memory: string, existing: ReadonlySet<string>): void;
  /** Écrit tout de suite le document s'il a changé depuis sa dernière écriture. */
  flush(): void;
}

/**
 * Magasin rangé sous `SESSION_DRAFTS_KEY` de `store`, écrit par `schedule`. À l'écriture, le document gardé est relu,
 * et seules les entrées que ce magasin a changées depuis sa dernière écriture y sont posées ou retirées : un autre
 * onglet du navigateur qui écrit les siennes ne les perd pas.
 */
export const createDraftStore = (
  store: Pick<JsonStore, 'read' | 'write'>,
  schedule: DraftScheduler = delayedBy(DRAFT_WRITE_DELAY_MS),
): DraftStore => {
  let drafts: Map<string, KeptDraft> | null = null;
  /** Fichiers dont le brouillon a changé ici depuis la dernière écriture. */
  let touched = new Set<string>();
  let memory: string | null = null;
  let cancel: (() => void) | null = null;

  const readStored = (): Map<string, KeptDraft> => parseSessionDrafts(store.read<unknown>(SESSION_DRAFTS_KEY));
  const held = (): Map<string, KeptDraft> => (drafts ??= readStored());

  const flush = (): void => {
    cancel?.();
    cancel = null;
    if (touched.size === 0 || !drafts) return;
    const merged = mergedSessionDrafts(readStored(), drafts, touched);
    touched = new Set();
    drafts = merged;
    store.write(SESSION_DRAFTS_KEY, sessionDraftsDocument(merged));
  };

  const replace = (next: Map<string, KeptDraft>, before: Map<string, KeptDraft>): void => {
    drafts = next;
    const changed = [...new Set([...before.keys(), ...next.keys()])].filter((file) => before.get(file) !== next.get(file));
    // Rien de retiré ni de posé : pas d'écriture.
    if (changed.length === 0) return;
    for (const file of changed) touched.add(file);
    cancel?.();
    cancel = schedule(() => {
      cancel = null;
      flush();
    });
  };

  return {
    get: (file) => held().get(file) ?? null,
    set: (file, draft) => {
      const before = held();
      replace(withSessionDraft(before, file, draft ? { base: draft.base, edits: draft.edits, memory } : null), before);
    },
    forget: (files) => {
      const before = held();
      replace(withoutSessionDrafts(before, files), before);
    },
    enterMemory: (next) => {
      memory = next;
    },
    keepOnly: (inMemory, existing) => {
      const before = held();
      replace(withoutSessionDrafts(before, draftsOfMissingSessions(before, inMemory, existing)), before);
    },
    flush,
  };
};

const createAppDraftStore = (): DraftStore => {
  const store = createDraftStore(jsonStore);
  onPageHidden(() => store.flush());
  return store;
};

/** Magasin de l'appareil. */
export const sessionDraftStore: DraftStore = createAppDraftStore();
