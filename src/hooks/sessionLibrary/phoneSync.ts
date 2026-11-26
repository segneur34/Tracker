import { useSyncExternalStore } from 'react';
import { errorMessage } from '../../core/basics';
import {
  describePhoneProblem, describeSyncConfirmation, describeSyncOutcome, type PhoneSyncProblem, type SyncConfirmation, type SyncReport,
} from '../../library/syncReport';
import {
  phoneCanWrite, phoneMemoryFolder, phoneSafetyCopy, phoneSafetyCopyExists, phoneState, type PhoneMemoryFolder, type PhoneState,
} from '../../platform/phoneCable';
import { createStore } from '../createStore';
import { synchronizePhone, type SyncDeletionKey, type SyncLockOptions, type SyncRouteDeletionKey } from './sync';

/**
 * « Synchroniser avec le téléphone », dans Réglages › Mémoire du programme Windows (élément 217) : la couche du
 * bouton. Elle cherche le téléphone branché par câble, fait un passage à blanc (`dryRun`) qui ne touche à rien, et
 * montre la confirmation chiffrée (« 3 à copier vers le téléphone, 5 vers l'ordinateur, 2 à retirer ») ; rien n'est
 * écrit avant la réponse. « Synchroniser sans rien supprimer » (le choix principal) fait tout sauf les retraits ;
 * « Synchroniser et retirer » les fait aussi, ceux-là seuls que la confirmation a montrés (s'il en est apparu d'autres
 * depuis, aucun n'est fait et la question revient). Avant la première synchronisation d'un téléphone, la coquille fait
 * la copie de sécurité des deux dossiers (`phoneSafetyCopy`). À la fin, le compte rendu (`describeSyncOutcome`).
 * L'avancement et l'issue se lisent hors des composants (`usePhoneSync`) : on peut quitter Réglages pendant la
 * synchronisation, qui continue.
 */

/** Où en est la synchronisation. */
export type PhoneSyncStep =
  | { step: 'idle' }
  | { step: 'searching' }
  | { step: 'comparing'; phone: string }
  /** La confirmation chiffrée, avant toute écriture ; `first` : première synchronisation avec ce téléphone. */
  | { step: 'confirm'; phone: string; first: boolean; interrupted: boolean; confirmation: SyncConfirmation }
  | { step: 'safetyCopy'; phone: string }
  /** `done` fichiers traités sur `total`. */
  | { step: 'syncing'; phone: string; done: number; total: number }
  /** Le compte rendu ; `folder` : un dossier à montrer à part (outil de Google à copier). */
  | { step: 'over'; report: SyncReport; folder: string | null };

const progress = createStore<PhoneSyncStep>({ step: 'idle' });

/** Étape de la synchronisation, lue hors d'un composant. */
export const phoneSyncStep = progress.get;

/** Étape de la synchronisation, suivie par le composant. */
export const usePhoneSync = (): PhoneSyncStep => useSyncExternalStore(progress.subscribe, progress.get);

/** Le téléphone de la confirmation en cours, gardé jusqu'à la réponse. */
let pending: { folder: PhoneMemoryFolder; phone: string; confirmation: SyncConfirmation } | null = null;

/** Options communes aux deux passages : itinéraires, et le téléphone qui ne doit pas enregistrer. */
const baseOptions = (folder: PhoneMemoryFolder): SyncLockOptions => ({ phoneRoutes: true, phoneRecording: () => folder.recording() });

const over = (report: SyncReport, folder: string | null = null): void => progress.set({ step: 'over', report, folder });

const problem = (p: PhoneSyncProblem): void => {
  const { folder, ...report } = describePhoneProblem(p);
  over(report, folder);
};

/** Problème d'un téléphone qui n'est pas prêt. */
const notReady = (state: Exclude<PhoneState, { etat: 'pret' }>): PhoneSyncProblem => {
  switch (state.etat) {
    case 'adbIntrouvable':
      return { kind: 'toolMissing', folder: state.dossier };
    case 'plusieurs':
      return { kind: 'phone', state: 'plusieurs', count: state.nombre };
    default:
      return { kind: 'phone', state: state.etat };
  }
};

const running = (): boolean => {
  const step = progress.get().step;
  return step === 'searching' || step === 'comparing' || step === 'safetyCopy' || step === 'syncing';
};

/**
 * Cherche le téléphone et prépare la confirmation, sans rien écrire. Sans effet pendant une synchronisation. Rien
 * à échanger : le compte rendu le dit aussitôt.
 */
export const startPhoneSync = async (): Promise<void> => {
  if (running()) return;
  pending = null;
  progress.set({ step: 'searching' });
  try {
    const state = await phoneState();
    if (state.etat !== 'pret') return problem(notReady(state));
    if (!phoneCanWrite()) return problem({ kind: 'cannotWrite' });
    const folder = phoneMemoryFolder(state.nom);
    progress.set({ step: 'comparing', phone: state.nom });
    const preview = await synchronizePhone(folder, { ...baseOptions(folder), dryRun: true });
    if (preview.refusal !== null || !preview.preview || preview.plan === null) {
      over(describeSyncOutcome(preview));
      return;
    }
    const confirmation = describeSyncConfirmation(preview);
    // Une synchronisation coupée se termine toujours, même sans rien à copier (fichiers d'à côté, date de fin).
    const nothing = confirmation.counts === null && confirmation.notes.length === 0 && preview.first === null && !preview.interrupted;
    if (nothing) {
      over({ title: 'Synchronisation faite', paragraphs: ['Les deux appareils sont déjà à jour : rien à échanger.'], rows: [], notes: [], retry: false });
      return;
    }
    pending = { folder, phone: state.nom, confirmation };
    progress.set({ step: 'confirm', phone: state.nom, first: preview.first !== null, interrupted: preview.interrupted, confirmation });
  } catch (err) {
    problem({ kind: 'error', detail: errorMessage(err, 'erreur inconnue') });
  }
};

/**
 * Réponse à la confirmation : `removals` faux, « Synchroniser sans rien supprimer » ; vrai, « Synchroniser et
 * retirer », les retraits montrés seulement. Rien d'autre n'est confirmé que ce que la confirmation a nommé.
 */
export const confirmPhoneSync = async (removals: boolean): Promise<void> => {
  const asked = pending;
  if (!asked || progress.get().step !== 'confirm') return;
  pending = null;
  const { folder, phone, confirmation } = asked;
  const toRemove = confirmation.removals.sessions.length + confirmation.removals.routes.length;
  const sessions: SyncDeletionKey[] = confirmation.removals.sessions.map((s) => ({ startMs: s.startMs, side: s.side }));
  const routes: SyncRouteDeletionKey[] = confirmation.removals.routes.map((r) => ({ id: r.id, side: r.side }));
  // « Sans rien supprimer » écarte tout retrait, même apparu depuis l'aperçu ; « retirer » ne vaut que pour les
  // retraits montrés : s'il en est apparu d'autres, aucun n'est fait et la question revient.
  const deletions: SyncLockOptions = removals && toRemove > 0
    ? { confirmDeletions: true, confirmedDeletions: sessions, confirmedRouteDeletions: routes }
    : { withoutDeletions: true };
  progress.set({ step: 'syncing', phone, done: 0, total: 0 });
  try {
    const outcome = await synchronizePhone(folder, {
      ...baseOptions(folder),
      ...deletions,
      beforeWrites: async () => {
        progress.set({ step: 'safetyCopy', phone });
        const copy = await phoneSafetyCopy();
        progress.set({ step: 'syncing', phone, done: 0, total: 0 });
        return copy;
      },
      safetyCopyExists: phoneSafetyCopyExists,
      onProgress: (done, total) => progress.set({ step: 'syncing', phone, done, total }),
    });
    over(describeSyncOutcome(outcome));
  } catch (err) {
    problem({ kind: 'error', detail: errorMessage(err, 'erreur inconnue') });
  }
};

/** « Annuler » à la confirmation : rien n'a été fait. */
export const cancelPhoneSync = (): void => {
  if (progress.get().step !== 'confirm') return;
  pending = null;
  progress.set({ step: 'idle' });
};

/** Efface le compte rendu (« Fermer ») ; sans effet pendant la synchronisation. */
export const dismissPhoneSync = (): void => {
  if (progress.get().step === 'over') progress.set({ step: 'idle' });
};
