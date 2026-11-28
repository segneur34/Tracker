import { useSyncExternalStore } from 'react';
import { errorMessage } from '../../core/basics';
import type { SyncOutcome } from '../../library/syncOutcome';
import {
  describeSyncQuestion, mergeSyncPasses, syncHasChangedItems, type PhoneCableHold, type PhoneNotReady, type PhoneSyncResult,
  type SyncQuestion, type SyncWait, type SyncWaitReason,
} from '../../library/syncReport';
import { noteJournal } from '../../platform/desktopBridge';
import { phoneCanWrite, phoneMemoryFolder, phoneSafetyCopy, phoneSafetyCopyExists, phoneState, type PhoneState } from '../../platform/phoneCable';
import { createStore } from '../createStore';
import { lib } from './memory';
import { libraryState, subscribe } from './store';
import { synchronizePhone, type SyncDeletionKey, type SyncHeldAnswer, type SyncLockOptions, type SyncRouteDeletionKey } from './sync';

/**
 * « Synchroniser avec le téléphone », dans Réglages › Mémoire du programme Windows (lot 242-2, d'après la fenêtre de
 * Gtracker validée par l'utilisateur le 22/11, décisions A2, B1 et C1) : la couche du bouton, sous la fenêtre. Un
 * clic : elle cherche le téléphone branché par câble, ouvre son dossier `Documents/Tracker` comme un dossier mémoire,
 * et lance la synchronisation des deux appareils (`synchronizePhone`), dont elle publie les étapes hors des composants
 * (`usePhoneSync`) : la fenêtre peut être fermée et rouverte pendant la synchronisation, qui continue.
 *
 * - Téléphone pas là ou pas prêt, liaison tombée en route, ordinateur occupé par un import ou un enregistrement :
 *   l'étape `waiting` attend et repart seule, sur un relevé toutes les `WAIT_POLL_MS`. Ce qui est fait est gardé.
 *   « Annuler » arrête l'attente (`cancelPhoneSyncWait`). Une liaison perdue reprend seule `MAX_LOST_RESUMES` fois au
 *   plus. L'étape `noPhone` (aucun téléphone jamais relié) n'existe que par un registre des téléphones
 *   (`setKnownPhones`), que le sans-fil branchera (lot 250) : par le câble seul, elle ne vient jamais.
 * - L'ordinateur qui crée encore des fiches est attendu, avancement montré (`computerBusy`) ; un passage qui ne fait
 *   que refaire des résumés cède à la synchronisation (`holdSummaryPasses`, dans l'exécutant).
 * - Gardé de Tracker : rien ne se fait si le téléphone enregistre (refus de l'exécutant, avant toute écriture), une
 *   session à brouillon n'est jamais mise à la corbeille, chaque retrait est relu octet pour octet, et la copie de
 *   sécurité est entière. Une coquille trop ancienne pour écrire ne synchronise pas (`cannotWrite`).
 * - À la première synchronisation d'un téléphone, un écran de départ (`firstStart`) dit ce qui va se passer ;
 *   « Commencer » (`startFirstSync`) lance la copie des deux dossiers par la coquille (`phoneSafetyCopy`) ; fermer
 *   l'écran (`declineFirstSync`) arrête tout, rien n'étant fait. Si la copie échoue, rien n'est fait.
 * - Une question (suppressions en nombre, sessions de la corbeille encore sur le téléphone) arrête sur l'étape
 *   `question`. Ses deux réponses la règlent pour de bon (`answerPhoneSyncQuestion`) : la synchronisation repart sans
 *   repasser par la recherche du téléphone, et son compte rendu reprend ce que la première passe avait fait. Fermer la
 *   question ne décide rien (`leavePhoneSyncQuestion`) : le compte rendu de ce qui est fait le dit, et elle revient.
 * - Une session, un itinéraire ou un fichier changé pendant l'opération est repris une fois, seul, avant le compte
 *   rendu : il n'est dit que s'il a encore changé.
 * - Le passage à blanc (`dryRun`) reste dans l'exécutant ; la fenêtre ne s'en sert plus : rien ne se perd sans question.
 * - Chaque étape est notée au journal du programme (`noteJournal`), sans nom ni chemin.
 */

/** Rythme du relevé pendant une attente : l'état du câble et l'occupation de l'ordinateur ne s'annoncent pas. */
export const WAIT_POLL_MS = 3000;

type SyncedResult = Extract<PhoneSyncResult, { kind: 'synced' }>;

/** Où en est la synchronisation ; `phone` : le nom du téléphone. */
export type PhoneSyncStep =
  | { step: 'idle' }
  | { step: 'searching' }
  /** La fenêtre attend (`wait`). */
  | { step: 'waiting'; wait: SyncWait }
  /** Cet ordinateur ne connaît encore aucun téléphone (sans-fil seulement). */
  | { step: 'noPhone' }
  /** L'ordinateur finit de créer les fiches de ses sessions (`done` sur `total`) avant l'échange. */
  | { step: 'computerBusy'; phone: string; done: number; total: number }
  | { step: 'comparing'; phone: string }
  /** Écran de départ d'une première synchronisation, avant la copie de sécurité. */
  | { step: 'firstStart'; phone: string }
  /** Copie de sécurité des deux dossiers, avant une première synchronisation. */
  | { step: 'safetyCopy'; phone: string }
  /** `done` fichiers de sessions traités sur `total` ; `first` : première synchronisation, rien n'est supprimé. */
  | { step: 'syncing'; phone: string; done: number; total: number; first: boolean }
  /** Une question attend sa réponse ; `result` : ce qui a déjà été fait. */
  | { step: 'question'; question: SyncQuestion; result: SyncedResult }
  /**
   * L'issue ; `unanswered` : la question fermée sans réponse, ou dont la réponse n'a pas pu s'appliquer, que le compte
   * rendu rappelle ; `answerFailed` : la passe de cette réponse, qui n'a rien pu faire (le compte rendu dit pourquoi).
   */
  | { step: 'over'; result: PhoneSyncResult; unanswered?: SyncQuestion; answerFailed?: PhoneSyncResult };

/**
 * Réponse à une question : aux suppressions en nombre, `keepAll` (« Tout garder » : chacune est défaite là où elle a
 * été faite) ou `deleteBoth` (« Supprimer des deux côtés ») ; aux sessions de la corbeille encore sur le téléphone,
 * `keepHeld` (« Les garder » : elles sortent de la corbeille) ou `removeHeld` (« Les retirer du téléphone »).
 */
export type PhoneSyncAnswer = 'keepAll' | 'deleteBoth' | 'keepHeld' | 'removeHeld';

const progress = createStore<PhoneSyncStep>({ step: 'idle' });

/** Étape de la synchronisation, lue hors d'un composant. */
export const phoneSyncStep = progress.get;

/** Étape de la synchronisation, suivie par le composant. */
export const usePhoneSync = (): PhoneSyncStep => useSyncExternalStore(progress.subscribe, progress.get);

/** Ce que permet une passe : les réponses déjà données pendant cette synchronisation, et l'enregistreur de l'appelant. */
interface RunOptions {
  recording?: () => boolean;
  confirmDeletions?: boolean;
  /** Les suppressions que la question a montrées, seules couvertes par « Supprimer des deux côtés ». */
  confirmedDeletions?: SyncDeletionKey[];
  /** Les suppressions d'itinéraires que la même question a montrées. */
  confirmedRouteDeletions?: SyncRouteDeletionKey[];
  /** « Tout garder » : les suppressions montrées, que l'utilisateur refuse. */
  keepRefused?: { sessions: SyncDeletionKey[]; routes: SyncRouteDeletionKey[] };
  heldOnPhone?: SyncHeldAnswer;
  /** Les sessions de la corbeille que la question a montrées, seules à retirer du téléphone. */
  heldToRemove?: number[];
  /** Les itinéraires de la corbeille que la même question a montrés (leurs identités). */
  heldRoutesToRemove?: string[];
  /** « Les garder » : les sessions et les itinéraires de la corbeille que la question a montrés. */
  heldToKeep?: number[];
  heldRoutesToKeep?: string[];
}

/** Comment une passe part : `resume`, téléphone déjà trouvé, sans repasser par sa recherche ; `previous`, ce qu'avait fait la passe d'avant. */
interface LaunchHow {
  resume?: { phone: string };
  previous?: SyncOutcome;
  /** La question à laquelle cette passe répond, et ce qui avait été fait : rendus tels quels si la réponse ne s'applique pas. */
  answering?: { question: SyncQuestion; result: SyncedResult; before: RunOptions };
}

/** Vrai si une passe n'a rien pu faire : téléphone pas prêt, panne avant la synchronisation, ou synchronisation refusée. */
const passFailed = (pass: PhoneSyncResult): boolean => pass.kind !== 'synced' || pass.outcome.refusal !== null;

/** Les réponses de la synchronisation en cours ou de la dernière, reprises par la passe suivante. */
let current: RunOptions = {};

let running: Promise<void> | null = null;

/** L'attente en cours : l'arrêter (« Annuler »). */
let waiting: { cancel: () => void } | null = null;

/** L'écran de départ affiché : « Commencer » (`true`) ou sa fermeture (`false`). */
let firstStart: { decide: (go: boolean) => void } | null = null;

/**
 * Le registre des téléphones que cet ordinateur connaît : rend leur nombre, `null` s'il ne le sait pas. Aucun par le
 * câble seul ; le sans-fil le posera (lot 250), et l'attente d'un téléphone jamais relié montrera alors `noPhone`.
 */
let knownPhones: (() => Promise<number | null>) | null = null;

/** Pose (ou retire, `null`) le registre des téléphones que lit l'attente. */
export const setKnownPhones = (read: (() => Promise<number | null>) | null): void => {
  knownPhones = read;
};

/** Levée quand l'écran de départ est fermé sans « Commencer » : la synchronisation s'arrête avant toute écriture. */
class FirstStartDeclined extends Error {}

/** L'écran de départ d'une première synchronisation ; lève `FirstStartDeclined` si l'écran est fermé. */
const awaitFirstStart = async (phone: string): Promise<void> => {
  noteJournal('Synchroniser : écran de départ de la première synchronisation');
  const go = await new Promise<boolean>((resolve) => {
    firstStart = {
      decide: (answer) => {
        firstStart = null;
        resolve(answer);
      },
    };
    progress.set({ step: 'firstStart', phone });
  });
  if (!go) throw new FirstStartDeclined();
};

const notReady = (state: Exclude<PhoneState, { etat: 'pret' }>): PhoneNotReady => {
  switch (state.etat) {
    case 'plusieurs':
      return { kind: 'phone', state: 'plusieurs', count: state.nombre };
    case 'adbIntrouvable':
      return { kind: 'phone', state: 'adbIntrouvable', folder: state.dossier };
    default:
      return { kind: 'phone', state: state.etat };
  }
};

/** Attend que l'ordinateur ait fini de créer les fiches de ses sessions, en montrant où il en est. */
const awaitComputerScan = async (phone: string): Promise<void> => {
  const pending = lib.scanCompletion;
  if (!pending) return;
  noteJournal("Synchroniser : attente de l'ordinateur, qui crée ses fiches");
  const show = (): void => {
    const scanning = libraryState().scanning;
    progress.set({ step: 'computerBusy', phone, done: scanning?.done ?? 0, total: scanning?.total ?? 0 });
  };
  show();
  const stop = subscribe(show);
  try {
    await pending.then(() => undefined, () => undefined);
  } finally {
    stop();
  }
};

/**
 * Une passe : état du téléphone, puis la synchronisation. `resume` : l'étape « Comparaison » n'est pas montrée.
 * Rend `null` si l'écran de départ a été fermé sans « Commencer » : rien n'a été fait.
 */
const synchronize = async (options: RunOptions, resume: boolean): Promise<PhoneSyncResult | null> => {
  const start = { declined: false };
  try {
    const state = await phoneState();
    if (state.etat !== 'pret') return notReady(state);
    if (!phoneCanWrite(state)) return { kind: 'cannotWrite' };
    const phone = state.nom;
    const folder = phoneMemoryFolder(phone);
    if (!resume) progress.set({ step: 'comparing', phone });
    await awaitComputerScan(phone);
    let first = false;
    const lock: SyncLockOptions = {
      recording: options.recording,
      phoneRecording: () => folder.recording(),
      confirmDeletions: options.confirmDeletions,
      confirmedDeletions: options.confirmedDeletions,
      confirmedRouteDeletions: options.confirmedRouteDeletions,
      keepRefused: options.keepRefused,
      heldOnPhone: options.heldOnPhone,
      heldToRemove: options.heldToRemove,
      heldRoutesToRemove: options.heldRoutesToRemove,
      heldToKeep: options.heldToKeep,
      heldRoutesToKeep: options.heldRoutesToKeep,
      phoneRoutes: true,
      beforeWrites: async () => {
        try {
          await awaitFirstStart(phone);
        } catch (err) {
          start.declined = err instanceof FirstStartDeclined;
          throw err;
        }
        progress.set({ step: 'safetyCopy', phone });
        noteJournal('Synchroniser : copie de sécurité');
        return phoneSafetyCopy();
      },
      safetyCopyExists: phoneSafetyCopyExists,
      onPlanned: (_plan, reason) => {
        first = reason !== null;
        progress.set({ step: 'syncing', phone, done: 0, total: 0, first });
      },
      onProgress: (done, total) => progress.set({ step: 'syncing', phone, done, total, first }),
    };
    noteJournal('Synchroniser : échange avec le téléphone (câble)');
    const outcome = await synchronizePhone(folder, lock);
    if (start.declined) return null;
    return { kind: 'synced', phone, outcome };
  } catch (err) {
    return { kind: 'error', detail: errorMessage(err, 'erreur inconnue') };
  }
};

/** L'issue d'une passe, jointe à ce qu'avait fait la passe d'avant quand les deux ont synchronisé. */
const joined = (previous: SyncOutcome | undefined, pass: PhoneSyncResult): PhoneSyncResult =>
  previous && pass.kind === 'synced' ? { ...pass, outcome: mergeSyncPasses(previous, pass.outcome) } : pass;

/** Ce qui fait attendre après une passe, `null` si rien : `midway`, la synchronisation avait déjà commencé. */
interface WaitCause {
  reason: SyncWaitReason;
  midway: boolean;
  cable: PhoneCableHold | null;
  count: number | null;
  folder: string | null;
  detail: string | null;
}

/**
 * Ce qui fait attendre après une passe, `null` si rien : un téléphone pas prêt, une liaison réellement perdue (le
 * téléphone ne se dit plus prêt : `phoneGone`), un ordinateur occupé. Une panne avec un téléphone présent (erreur de
 * lecture ou d'écriture, liaison coupée alors qu'il se dit encore prêt) n'attend pas : elle se dit, avec « Recommencer ».
 */
const waitCauseOf = (pass: PhoneSyncResult, started: boolean, phoneGone: boolean): WaitCause | null => {
  const none = { cable: null, count: null, folder: null, detail: null };
  if (pass.kind === 'phone') {
    return {
      ...none, reason: started ? 'lost' : 'absent', midway: started, cable: pass.state === 'absent' ? null : pass.state,
      count: pass.count ?? null, folder: pass.folder ?? null,
    };
  }
  if (pass.kind !== 'synced') return null;
  if (pass.outcome.linkLost !== null) return phoneGone ? { ...none, reason: 'lost', midway: true, detail: pass.outcome.linkLost } : null;
  if (pass.outcome.refusal === 'busy') return { ...none, reason: 'busy', midway: started };
  return null;
};

/** Reprises seules au plus après une liaison perdue, pour une même synchronisation : au-delà, l'arrêt se dit, avec « Recommencer ». */
export const MAX_LOST_RESUMES = 3;

/** Vrai si le téléphone ne se dit plus prêt : la liaison est réellement perdue. */
const phoneGoneNow = async (): Promise<boolean> => {
  const state = await phoneState().catch(() => null);
  return state?.etat !== 'pret';
};

/** Le téléphone branché qui attend, d'après un état lu pendant l'attente. */
const holdOf = (state: PhoneState | null): Pick<SyncWait, 'cable' | 'count' | 'folder'> => {
  if (state === null || state.etat === 'pret' || state.etat === 'absent') return { cable: null, count: null, folder: null };
  if (state.etat === 'plusieurs') return { cable: 'plusieurs', count: state.nombre, folder: null };
  if (state.etat === 'adbIntrouvable') return { cable: 'adbIntrouvable', count: null, folder: state.dossier };
  return { cable: state.etat, count: null, folder: null };
};

/**
 * Attend que la cause disparaisse : rend vrai quand la synchronisation peut repartir, faux si l'attente est annulée.
 * L'écran est relu à chaque relevé (`WAIT_POLL_MS`).
 */
const waitUntilReady = (cause: WaitCause, options: RunOptions, phoneHint: string | null): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let done = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wait: SyncWait = {
      reason: cause.reason, phone: phoneHint, cable: cause.cable, count: cause.count, folder: cause.folder, midway: cause.midway, detail: cause.detail,
    };
    const finish = (go: boolean): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      waiting = null;
      noteJournal(go ? "Synchroniser : fin de l'attente, reprise" : 'Synchroniser : attente annulée');
      resolve(go);
    };
    const show = (): void => progress.set({ step: 'waiting', wait });
    /** `mayGo` faux : le relevé ne fait que remplir l'écran (premier relevé d'une liaison perdue, qui peut encore se dire prête). */
    const tick = async (mayGo = true): Promise<void> => {
      if (done || reading) return;
      reading = true;
      try {
        if (cause.reason === 'busy') {
          if (mayGo && !libraryState().importing && !options.recording?.()) return finish(true);
          return show();
        }
        const state = await phoneState().catch(() => null);
        if (done) return;
        if (state?.etat === 'pret') {
          if (mayGo) return finish(true);
          return show();
        }
        const hold = holdOf(state);
        if (cause.reason === 'absent' && hold.cable === null && knownPhones) {
          const known = await knownPhones().catch(() => null);
          if (done) return;
          if (known === 0) {
            progress.set({ step: 'noPhone' });
            return;
          }
        }
        wait = { ...wait, ...hold };
        show();
      } finally {
        reading = false;
        if (!done) {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => void tick(), WAIT_POLL_MS);
        }
      }
    };
    waiting = { cancel: () => finish(false) };
    noteJournal(`Synchroniser : attente (${cause.reason === 'busy' ? 'ordinateur occupé' : cause.reason === 'lost' ? 'liaison perdue' : 'téléphone absent'})`);
    show();
    // Une liaison qui vient de tomber peut encore se dire prête : la reprise attend au moins un relevé, sans boucler.
    void tick(cause.reason === 'absent');
  });

/**
 * Une synchronisation, de la recherche du téléphone (ou de la reprise, `how.resume`) à la question ou au compte rendu,
 * en attendant ce qui manque (téléphone, liaison, ordinateur) sans rien perdre de ce qui est fait. Ce qui a changé
 * pendant l'opération est repris par une seconde passe, une seule fois. Une réponse qui ne peut pas s'appliquer
 * (téléphone parti avant, synchronisation refusée) rend le compte rendu de ce qui était fait, la raison
 * (`answerFailed`), et la question laissée sans réponse, à laquelle « Répondre » revient.
 */
const launch = (options: RunOptions, how: LaunchHow = {}): Promise<void> => {
  current = options;
  progress.set(how.resume ? { step: 'syncing', phone: how.resume.phone, done: 0, total: 0, first: false } : { step: 'searching' });
  if (!how.resume) noteJournal('Synchroniser : recherche du téléphone');
  const run = async (): Promise<void> => {
    let previous = how.previous;
    let resume = how.resume !== undefined;
    let retried = false;
    let lostResumes = 0;
    let phoneHint = how.resume?.phone ?? null;
    /** Ce qui est fait jusqu'ici, avec le téléphone : le compte rendu d'un arrêt en route. */
    let lastSynced: SyncedResult | null = how.answering?.result ?? null;
    /** Arrêt en route (attente annulée, panne, reprises épuisées) : le compte rendu de ce qui est fait, avec la note de l'arrêt. */
    const stopWith = (detail: string | null, kind: 'linkLost' | 'error'): boolean => {
      // Une passe refusée (copie de sécurité ratée, ordinateur occupé…) n'a rien fait : rien à rapporter.
      if (!lastSynced || !previous || previous.refusal !== null) return false;
      const note = detail ?? '';
      const outcome: SyncOutcome = kind === 'linkLost'
        ? { ...previous, linkLost: previous.linkLost ?? note }
        : { ...previous, error: previous.error ?? note };
      progress.set({ step: 'over', result: { ...lastSynced, outcome } });
      noteJournal('Synchroniser : arrêt en route, compte rendu de ce qui est fait');
      return true;
    };
    for (;;) {
      const pass = await synchronize(options, resume);
      if (pass === null) {
        progress.set({ step: 'idle' });
        noteJournal('Synchroniser : écran de départ fermé, rien de fait');
        return;
      }
      if (how.answering && passFailed(pass)) {
        // La réponse n'a rien réglé : la suivante repart des choix d'avant elle.
        current = how.answering.before;
        progress.set({ step: 'over', result: how.answering.result, unanswered: how.answering.question, answerFailed: pass });
        noteJournal("Synchroniser : la réponse n'a pas pu s'appliquer");
        return;
      }
      if (pass.kind === 'synced') {
        phoneHint = pass.phone;
        // Ce que la passe a fait est gardé pour le compte rendu, même coupée ; une reprise ne refait que le reste.
        const merged = previous ? mergeSyncPasses(previous, pass.outcome) : pass.outcome;
        lastSynced = { ...pass, outcome: merged };
      }
      // Panne de lecture avec ce qui était déjà fait : son compte rendu, avec l'arrêt et « Recommencer ».
      if (pass.kind === 'error' && stopWith(pass.detail, 'error')) return;
      const gone = pass.kind === 'synced' && pass.outcome.linkLost !== null ? await phoneGoneNow() : false;
      const cause = waitCauseOf(pass, previous !== undefined, gone);
      if (cause) {
        if (pass.kind === 'synced') previous = lastSynced?.outcome ?? pass.outcome;
        if (cause.reason === 'lost' && ++lostResumes > MAX_LOST_RESUMES && stopWith(cause.detail, 'linkLost')) return;
        if (!(await waitUntilReady(cause, options, phoneHint))) {
          if (!stopWith(cause.detail, cause.reason === 'lost' ? 'linkLost' : 'error')) progress.set({ step: 'idle' });
          return;
        }
        resume = false;
        continue;
      }
      const result = joined(previous, pass);
      const question = result.kind === 'synced' ? describeSyncQuestion(result.outcome) : null;
      if (question === null && result.kind === 'synced' && pass.kind === 'synced' && !retried && syncHasChangedItems(pass.outcome)) {
        retried = true;
        previous = result.outcome;
        resume = true;
        progress.set({ step: 'syncing', phone: result.phone, done: 0, total: 0, first: false });
        noteJournal('Synchroniser : reprise des éléments changés en route');
        continue;
      }
      progress.set(question && result.kind === 'synced' ? { step: 'question', question, result } : { step: 'over', result });
      noteJournal(question ? 'Synchroniser : question posée' : 'Synchroniser : compte rendu');
      return;
    }
  };
  running = run().finally(() => {
    running = null;
  });
  return running;
};

/**
 * Lance « Synchroniser » ; pendant qu'elle tourne (attente comprise), un nouvel appel rend la même. `recording` : vrai
 * pendant un enregistrement sur cet appareil (l'enregistreur dépend de la bibliothèque : l'appelant le passe), qui fait
 * attendre.
 */
export const synchronizeWithPhone = (options: { recording?: () => boolean } = {}): Promise<void> =>
  running ?? launch({ recording: options.recording });

/**
 * « Annuler » de l'attente : la synchronisation s'arrête là, ce qui était fait reste fait. Après une passe partielle,
 * l'étape passe au compte rendu de ce qui est fait, avec la note de l'arrêt ; sinon, au repos. Rend la promesse de la
 * synchronisation, résolue une fois l'étape posée. Sans effet hors d'une attente.
 */
export const cancelPhoneSyncWait = (): Promise<void> => {
  waiting?.cancel();
  return running ?? Promise.resolve();
};

/**
 * Répond à la question posée (étape `question`) : la synchronisation repart avec ce que la réponse règle, en gardant
 * les réponses déjà données (une confirmation donnée avant « Les retirer du téléphone » ne couvre pas ces retraits,
 * qui peuvent rouvrir le garde-fou). Chaque réponse ne vaut que pour ce que sa question a montré : l'exécutant reçoit
 * leur liste, et une suppression apparue depuis reste soumise au garde-fou. Sans effet hors de l'étape `question`, ou
 * pour une réponse qui n'est pas celle de la question posée.
 */
export const answerPhoneSyncQuestion = (answer: PhoneSyncAnswer): Promise<void> => {
  const step = progress.get();
  if (step.step !== 'question' || running) return running ?? Promise.resolve();
  const { question, result } = step;
  const forGuard = answer === 'keepAll' || answer === 'deleteBoth';
  if (forGuard !== (question.kind === 'guard')) return Promise.resolve();
  const how: LaunchHow = { resume: { phone: result.phone }, previous: result.outcome, answering: { question, result, before: current } };
  const sessions = question.sessions.map((s) => ({ startMs: s.startMs, side: s.side }));
  const routes = question.routes.map((r) => ({ id: r.id, side: r.side }));
  switch (answer) {
    case 'keepAll':
      return launch({
        ...current, keepRefused: { sessions, routes }, confirmDeletions: false, confirmedDeletions: undefined, confirmedRouteDeletions: undefined,
      }, how);
    case 'deleteBoth':
      return launch({ ...current, confirmDeletions: true, confirmedDeletions: sessions, confirmedRouteDeletions: routes }, how);
    case 'keepHeld':
      return launch({
        ...current, heldOnPhone: 'keep', heldToKeep: question.sessions.map((s) => s.startMs), heldRoutesToKeep: question.routes.map((r) => r.id),
        heldToRemove: undefined, heldRoutesToRemove: undefined,
      }, how);
    default:
      // Des retraits qui dépassent le garde-fou rouvrent sa fenêtre : une confirmation donnée avant ne les couvre pas.
      return launch({
        ...current, heldOnPhone: 'remove', heldToRemove: question.sessions.map((s) => s.startMs), heldRoutesToRemove: question.routes.map((r) => r.id),
        heldToKeep: undefined, heldRoutesToKeep: undefined, confirmDeletions: false, confirmedDeletions: undefined, confirmedRouteDeletions: undefined,
      }, how);
  }
};

/**
 * La question est fermée sans réponse : rien n'est décidé. L'étape passe au compte rendu de ce qui est fait, qui
 * rappelle ce qui attend la réponse (`unanswered`) ; la prochaine synchronisation repose la question.
 */
export const leavePhoneSyncQuestion = (): void => {
  const step = progress.get();
  if (step.step === 'question') progress.set({ step: 'over', result: step.result, unanswered: step.question });
};

/** Revient à la question fermée sans réponse (« Répondre » du compte rendu). Sans effet sans question laissée. */
export const reopenPhoneSyncQuestion = (): void => {
  const step = progress.get();
  if (step.step === 'over' && step.unanswered && step.result.kind === 'synced' && !running) {
    progress.set({ step: 'question', question: step.unanswered, result: step.result });
  }
};

/** « Commencer » de l'écran de départ : la copie de sécurité part, puis la synchronisation. Sans effet hors de cet écran. */
export const startFirstSync = (): void => {
  if (progress.get().step === 'firstStart') firstStart?.decide(true);
};

/** L'écran de départ est fermé sans « Commencer » : la synchronisation s'arrête, rien n'est fait. Sans effet ailleurs. */
export const declineFirstSync = (): void => {
  firstStart?.decide(false);
};

/** Efface le compte rendu (« Fermer ») ; sans effet pendant la synchronisation. */
export const dismissPhoneSync = (): void => {
  if (progress.get().step === 'over') progress.set({ step: 'idle' });
};
