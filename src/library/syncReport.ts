import { formatSessionDate } from '../core/units';
import { conflictLabels } from './recordMerge';
import type { SyncSideName } from './syncBase';
import type { SyncOutcome } from './syncOutcome';
import type { SyncItem, SyncLeftReason, SyncOp } from './syncPlan';
import type { RouteSyncItem, RouteSyncOp } from './syncRoutes';

/**
 * Ce que la fenêtre « Synchroniser » du programme Windows dit d'une synchronisation avec le téléphone branché par
 * câble (lot 242-2, d'après la fenêtre de Gtracker validée par l'utilisateur le 22/11) : l'état d'un téléphone qui
 * n'est pas prêt et ce qu'il y a à faire, l'écran de départ d'une première synchronisation, l'avancement, le compte
 * rendu rangé par geste (reçu, envoyé, modifié, supprimé, restauré, gardé), les exceptions chacune avec sa suite, et
 * la seule question à poser avant d'aller plus loin (suppressions en nombre, sessions de la corbeille encore sur le
 * téléphone). Sessions et itinéraires sont comptés à part, jamais additionnés, et chaque nombre se déplie en noms. En
 * français simple, sans mot de mécanique ; pur : tout se lit dans l'issue.
 */

/**
 * État d'un téléphone branché qui n'est pas prêt : autorisation à donner, sans réponse, câble tenu par un autre
 * programme, plusieurs appareils branchés, ou l'outil de Google qui lit le téléphone absent de l'ordinateur.
 */
export type PhoneCableHold = 'autorisation' | 'horsLigne' | 'occupe' | 'plusieurs' | 'adbIntrouvable';

/**
 * Téléphone qui n'est pas prêt : rien de branché (`absent`), ou un téléphone branché qui attend (`PhoneCableHold`) ;
 * `count`, le nombre d'appareils branchés pour `plusieurs` ; `folder`, où copier l'outil pour `adbIntrouvable`.
 */
export type PhoneNotReady = { kind: 'phone'; state: 'absent' | PhoneCableHold; count?: number; folder?: string };

/** Issue du bouton « Synchroniser », de l'état du téléphone au compte rendu. */
export type PhoneSyncResult =
  | PhoneNotReady
  /** La coquille ne sait pas écrire sur le téléphone (programme d'une version plus ancienne que sa page). */
  | { kind: 'cannotWrite' }
  /** Panne imprévue avant la synchronisation (état, ouverture du dossier) ; `detail` : sa phrase. */
  | { kind: 'error'; detail: string }
  /** La synchronisation a été tentée : son issue, même refusée ou coupée. */
  | { kind: 'synced'; phone: string; outcome: SyncOutcome };

/**
 * Le bouton qui accompagne « Fermer » : aucun (`close`) ; « Recommencer » après une écriture ratée sur l'ordinateur,
 * une panne ou un arrêt en route (`restart`) ; « Répondre » quand une question a été fermée sans réponse (`answer`) ;
 * « Réessayer » quand la phrase dit quoi faire avant (`retry`).
 */
export type SyncReportAction = 'close' | 'restart' | 'answer' | 'retry';

/** Une ligne du compte rendu : le geste, ce qu'il a touché (« 2 sessions, 1 itinéraire »), et leurs noms. */
export interface SyncReportRow {
  label: string;
  text: string;
  names: string[];
}

/** Une exception, avec ce qui va se passer ; `detail` : la raison technique, montrée repliée. */
export interface SyncReportNote {
  text: string;
  detail: string | null;
}

/** Ce que la fenêtre montre à l'issue d'une synchronisation. */
export interface SyncReport {
  title: string;
  /** Phrases d'en-tête : première synchronisation, rien à échanger, ou la raison d'un refus. */
  paragraphs: string[];
  /** Raison technique d'un refus, montrée repliée. */
  detail: string | null;
  rows: SyncReportRow[];
  notes: SyncReportNote[];
  /** Où est la copie de sécurité, à montrer à part pour qu'on puisse la recopier. */
  folder: string | null;
  action: SyncReportAction;
}

const report = (title: string, paragraphs: string[], action: SyncReportAction, patch: Partial<SyncReport> = {}): SyncReport => ({
  title, paragraphs, detail: null, rows: [], notes: [], folder: null, action, ...patch,
});

const clean = (detail: string): string => detail.replace(/\.\s*$/, '');

/** `one` ou `many` selon `n` (un seul ou aucun : `one`), `{n}` remplacé par le nombre. */
const byCount = (n: number, one: string, many: string): string => (n > 1 ? many : one).replace('{n}', String(n));

/** Titre de la fenêtre avant que le téléphone soit trouvé, ou quand il n'est pas prêt. */
export const SYNC_WINDOW_TITLE = 'Synchroniser avec le téléphone';

/**
 * Pourquoi la fenêtre attend : le téléphone n'est pas là ou pas prêt (`absent`), la liaison est tombée (`lost`), ou
 * l'ordinateur est occupé par un import ou un enregistrement (`busy`). Elle repart seule dès que la cause disparaît.
 */
export type SyncWaitReason = 'absent' | 'lost' | 'busy';

/** Ce que la fenêtre sait pendant qu'elle attend. */
export interface SyncWait {
  reason: SyncWaitReason;
  /** Le téléphone vu en dernier pendant cette synchronisation, `null` si aucun. */
  phone: string | null;
  /** Un téléphone branché qui attend, `null` sinon. */
  cable: PhoneCableHold | null;
  /** Nombre d'appareils branchés, pour `plusieurs`. */
  count: number | null;
  /** Où copier l'outil de Google, pour `adbIntrouvable`. */
  folder: string | null;
  /** Liaison perdue : vrai si elle est tombée pendant l'échange (ce qui est fait est gardé). */
  midway: boolean;
  /** Raison technique d'une liaison perdue, montrée repliée. */
  detail: string | null;
}

/** Ce que la fenêtre montre pendant qu'elle attend. */
export interface SyncWaitText {
  title: string;
  subtitle: string | null;
  /** Phrase d'en-tête (liaison perdue, câble, ordinateur occupé), `null` sinon. */
  lead: string | null;
  /** Ce qu'il y a à faire sur le téléphone, en liste, après « Sur le téléphone : ». */
  steps: string[];
  /** « La synchronisation démarre toute seule… », `null` quand l'en-tête le dit déjà. */
  closing: string | null;
  /** Remarques (la première fois). */
  notes: string[];
  /** Un dossier à montrer à part, pour qu'on puisse le recopier (où copier l'outil de Google). */
  folder: string | null;
}

/** L'ordinateur occupé : la synchronisation démarre dès qu'il a fini. */
const COMPUTER_BUSY_TEXT = "L'ordinateur est occupé (import ou enregistrement en cours). La synchronisation démarre dès qu'il a fini.";

/** La première fois, le téléphone doit accepter le débogage USB. */
const USB_DEBUG_NOTE = 'La première fois, il faut aussi activer le « Débogage USB » du téléphone : dans Paramètres, À propos du téléphone, touchez sept fois « Version », puis activez « Débogage USB » dans les options pour les développeurs.';

/** Phrases de la fenêtre qui attend. */
export const describeWait = (wait: SyncWait): SyncWaitText => {
  const subtitle = wait.phone;
  const base = { subtitle, steps: [], notes: [], folder: null };
  if (wait.reason === 'busy') return { ...base, title: 'Synchronisation en attente', lead: COMPUTER_BUSY_TEXT, closing: null };
  const title = 'En attente de votre téléphone';
  const closing = "La synchronisation démarre toute seule dès qu'il est là.";
  switch (wait.cable) {
    case 'autorisation':
      return { ...base, title, lead: "Le téléphone branché demande une autorisation : sur son écran, cochez « Toujours autoriser cet ordinateur » et touchez « Autoriser ». La synchronisation démarre ensuite toute seule.", closing: null };
    case 'horsLigne':
      return { ...base, title, lead: 'Le téléphone est branché mais ne répond pas. Déverrouillez son écran, puis débranchez et rebranchez le câble.', closing };
    case 'occupe':
      return { ...base, title, lead: 'Un autre programme utilise déjà la liaison avec le téléphone (Android Studio, par exemple). Fermez-le.', closing };
    case 'plusieurs':
      return {
        ...base, title, closing,
        lead: `Plusieurs appareils sont branchés à l'ordinateur${wait.count ? ` (${wait.count})` : ''}. Ne laissez branché que votre téléphone, et fermez un téléphone virtuel s'il y en a un d'ouvert.`,
      };
    case 'adbIntrouvable':
      return {
        ...base, title, closing, folder: wait.folder,
        lead: "Pour joindre le téléphone, Tracker a besoin d'un outil gratuit de Google, « SDK Platform-Tools », absent de cet ordinateur. Téléchargez-le pour Windows sur developer.android.com/tools/releases/platform-tools, ouvrez le fichier .zip, et copiez le dossier « platform-tools » qu'il contient dans le dossier ci-dessous.",
      };
    default:
      break;
  }
  if (wait.reason === 'lost') {
    const lead = wait.midway
      ? "Le téléphone n'est plus relié : la synchronisation s'est arrêtée en route. Ce qui est fait est gardé. Elle reprend toute seule dès qu'il revient : câble rebranché, écran déverrouillé."
      : "Le téléphone a cessé de répondre. Ce qui est fait est gardé. La synchronisation reprend dès qu'il revient : câble rebranché, écran déverrouillé.";
    return { ...base, title, lead, closing: null };
  }
  return {
    ...base, title, lead: null, closing, notes: [USB_DEBUG_NOTE],
    steps: ["branchez-le à cet ordinateur par un câble USB ;", 'déverrouillez son écran.'],
  };
};

/**
 * L'écran d'un ordinateur qui ne connaît encore aucun téléphone. Déclaré pour le sans-fil (lot 250) : par le câble
 * seul, la fenêtre ne le montre jamais.
 */
export const describeNoPhone = (): { title: string; text: string } => ({
  title: 'Aucun téléphone relié',
  text: 'Cet ordinateur ne connaît encore aucun téléphone. Cela se fait une fois, en tapant un code sur le téléphone.',
});

/** L'ordinateur finit de créer les fiches de ses sessions avant l'échange : « … : 12 sur 40. » */
export const computerScanText = (done: number, total: number): string =>
  `L'ordinateur finit de mettre à jour ses sessions : ${done} sur ${total}.`;

/** Ce que dit l'écran de départ d'une première synchronisation, avant la copie de sécurité. */
export interface FirstStartText {
  title: string;
  /** « Chaque appareil va recevoir ce qui lui manque… » */
  lead: string;
  /** Où va la copie de sécurité. */
  copy: string;
}

/** L'écran de départ de la première synchronisation avec `phone` : ce qui va se passer, puis la copie de sécurité. */
export const describeFirstStart = (phone: string): FirstStartText => ({
  title: `Première synchronisation avec « ${phone} »`,
  lead: 'Chaque appareil va recevoir ce qui lui manque. Rien ne sera supprimé.',
  copy: 'Avant de commencer, Tracker copie les deux mémoires par sécurité.',
});

/** Titre de la fenêtre pendant que la synchronisation avance. */
export const SYNC_RUNNING_TITLE = 'Synchronisation en cours';

/** Sous-titre de la fenêtre : le téléphone et par où il est lu. */
export const syncSubtitle = (phone: string): string => `${phone} · par le câble`;

/** Phrase d'une étape d'avant l'échange. */
export const syncStepText = (step: 'searching' | 'comparing'): string =>
  step === 'searching' ? 'Recherche du téléphone…' : 'Comparaison des deux appareils…';

/**
 * Avancement de la copie de sécurité : « … : 30 fichiers sur 120. » ; sans nombres tant que le total n'est pas connu,
 * ou avec une coquille qui ne le dit pas.
 */
export const safetyCopyProgressText = (done: number, total: number): string =>
  total > 0
    ? byCount(total, `Copie de sécurité des deux mémoires : ${done} fichier sur {n}.`, `Copie de sécurité des deux mémoires : ${done} fichiers sur {n}.`)
    : 'Copie de sécurité des deux mémoires…';

/** Avancement de l'échange : « … : 12 fichiers sur 50. », sans nombres tant que le total n'est pas connu. */
export const syncProgressText = (done: number, total: number): string =>
  total > 0
    ? byCount(total, `Échange des sessions et des itinéraires : ${done} fichier sur {n}.`, `Échange des sessions et des itinéraires : ${done} fichiers sur {n}.`)
    : 'Échange des sessions et des itinéraires…';

/** Le texte qui accorde ce qu'il dit à ce qu'il compte : des sessions seules, des itinéraires seuls, ou les deux. */
interface Agreed {
  sessions: (n: number) => string;
  routes: (n: number) => string;
  both: (counts: { sessions: string; routes: string }) => string;
}

const sessionCount = (n: number): string => byCount(n, '{n} session', '{n} sessions');
const routeCount = (n: number): string => byCount(n, '{n} itinéraire', '{n} itinéraires');

const agree = (sessions: number, routes: number, forms: Agreed): string =>
  sessions > 0 && routes > 0 ? forms.both({ sessions: sessionCount(sessions), routes: routeCount(routes) })
    : sessions > 0 ? forms.sessions(sessions)
      : forms.routes(routes);

/** « 2 sessions, 1 itinéraire » : chacun compté à part. */
const counted = (sessions: number, routes: number): string =>
  [sessions > 0 ? sessionCount(sessions) : null, routes > 0 ? routeCount(routes) : null].filter((s) => s !== null).join(', ');

/** Accord d'une phrase qui reprend ce qu'elle nomme : une session, des sessions, un itinéraire, ou des itinéraires (mêlés compris). */
type Form = 'f1' | 'fN' | 'm1' | 'mN';
const formOf = (sessions: number, routes: number): Form =>
  routes === 0 ? (sessions === 1 ? 'f1' : 'fN') : sessions === 0 && routes === 1 ? 'm1' : 'mN';

const hasOp = (item: SyncItem, test: (op: SyncOp) => boolean): boolean => item.ops.some(test);
const hasRouteOp = (item: RouteSyncItem, test: (op: RouteSyncOp) => boolean): boolean => item.ops.some(test);

const sessionName = (outcome: SyncOutcome, startMs: number): string => outcome.names.sessions[startMs] ?? formatSessionDate(startMs);
const routeName = (outcome: SyncOutcome, item: RouteSyncItem): string =>
  outcome.names.routes[item.id] ?? item.files.computer ?? item.files.phone ?? item.id;

/** Raisons d'une session qui n'est pas finie de ranger sur son appareil. */
const UNFINISHED: readonly SyncLeftReason[] = ['noRecord', 'unreadableRecord', 'emptyGpx', 'unfinishedGpx'];

/** Base d'un chemin, sans dossier ni extension : le nom d'un appareil pour `reglages/<nom>.json`. */
const baseName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.json$/i, '');
const fileName = (path: string): string => path.split('/').pop() ?? path;

const NO_PHONE_MEMORY_TEXT = "Tracker n'a pas encore de mémoire sur ce téléphone. Ouvrez-le une fois sur le téléphone et choisissez son dossier (Réglages › Mémoire), puis revenez ici.";

/** La phrase d'une synchronisation refusée ; rien n'a été fait. */
const refusalReport = (outcome: SyncOutcome): SyncReport => {
  const title = 'Synchronisation impossible';
  switch (outcome.refusal) {
    case 'computerNoMarker':
    case 'noTrash':
    case 'memory':
      return report(title, ["La mémoire de cet ordinateur n'est pas disponible. Vérifiez son dossier dans Réglages › Mémoire."], 'close');
    case 'phoneNoMarker':
      return report(title, [NO_PHONE_MEMORY_TEXT], 'restart');
    case 'computerNewer':
    case 'phoneNewer':
    case 'newerBase':
      return report(title, ['Ce programme est plus ancien que le Tracker du téléphone. Installez sa dernière version, puis synchronisez.'], 'close');
    case 'trashLocked':
      return report(title, ["La corbeille de cet ordinateur est illisible : par prudence, rien n'a été synchronisé. Ouvrez Réglages › Mémoire › Corbeille."], 'close');
    case 'busy':
      return report(title, [COMPUTER_BUSY_TEXT], 'restart');
    case 'phoneRecording':
      return report(title, ["Le téléphone enregistre une session : rien n'a été fait, ni sur le téléphone ni sur l'ordinateur. Arrêtez l'enregistrement, puis cliquez sur « Réessayer »."], 'retry');
    default:
      return report(title, ["La copie de sécurité n'a pas pu être faite : rien n'a été synchronisé."], 'restart', {
        detail: outcome.error ? clean(outcome.error) : null,
      });
  }
};

/** Lignes du compte rendu, une par geste qui a touché quelque chose. */
const gestureRows = (outcome: SyncOutcome): SyncReportRow[] => {
  const keptSessions = new Set(outcome.kept.sessions);
  const keptRoutes = new Set(outcome.kept.routes);
  // Une session gardée ou restaurée a sa ligne à elle : elle n'est ni « reçue » ni « envoyée ».
  const sessions = outcome.done.filter((i) => !keptSessions.has(i.startMs));
  const routes = outcome.routes.done.filter((i) => !keptRoutes.has(i.id));
  const plain = sessions.filter((i) => i.restored !== true);
  const plainRoutes = routes.filter((i) => i.restored !== true);
  const rows: SyncReportRow[] = [];
  const add = (label: string, picked: SyncItem[], pickedRoutes: RouteSyncItem[], text: (s: number, r: number) => string): void => {
    if (picked.length + pickedRoutes.length === 0) return;
    rows.push({
      label, text: text(picked.length, pickedRoutes.length),
      names: [...picked.map((i) => sessionName(outcome, i.startMs)), ...pickedRoutes.map((i) => routeName(outcome, i))],
    });
  };
  const copiedTo = (side: SyncSideName) => (i: SyncItem) => hasOp(i, (op) => op.kind === 'copy' && op.to === side);
  const routeCopiedTo = (side: SyncSideName) => (i: RouteSyncItem) =>
    (i.case === 'newOnComputer' || i.case === 'newOnPhone' || i.revived) && hasRouteOp(i, (op) => op.kind === 'copy' && op.to === side);

  add('Reçu du téléphone', plain.filter(copiedTo('computer')), plainRoutes.filter(routeCopiedTo('computer')), counted);
  add('Envoyé au téléphone', plain.filter(copiedTo('phone')), plainRoutes.filter(routeCopiedTo('phone')), counted);
  add('Modifié',
    plain.filter((i) => !hasOp(i, (op) => op.kind === 'copy') && hasOp(i, (op) => op.kind === 'writeRecord' || op.kind === 'copyRecord' || op.kind === 'copyImu')),
    plainRoutes.filter((i) => (i.case === 'followed' || i.case === 'firstMeeting') && !i.conflict && hasRouteOp(i, (op) => op.kind === 'copy')),
    (s, r) => agree(s, r, {
      sessions: (n) => byCount(n, "{n} session, recopiée sur l'autre appareil", "{n} sessions, recopiées sur l'autre appareil"),
      routes: (n) => byCount(n, "{n} itinéraire, recopié sur l'autre appareil", "{n} itinéraires, recopiés sur l'autre appareil"),
      both: (c) => `${c.sessions}, ${c.routes}, recopiés sur l'autre appareil`,
    }));
  // Corbeilles jumelles (lot 242-1) : une session supprimée d'un côté finit dans la corbeille de chaque appareil.
  add('Supprimé',
    sessions.filter((i) => i.case === 'deletedOnPhone' && hasOp(i, (op) => op.kind === 'trash')),
    routes.filter((i) => i.case === 'deletedOnPhone' && hasRouteOp(i, (op) => op.kind === 'trash')),
    (s, r) => agree(s, r, {
      sessions: (n) => byCount(n, '{n} session supprimée sur le téléphone : elle est dans la corbeille des deux appareils pour 30 jours', '{n} sessions supprimées sur le téléphone : elles sont dans la corbeille des deux appareils pour 30 jours'),
      routes: (n) => byCount(n, '{n} itinéraire supprimé sur le téléphone : il est dans la corbeille des deux appareils pour 30 jours', '{n} itinéraires supprimés sur le téléphone : ils sont dans la corbeille des deux appareils pour 30 jours'),
      both: (c) => `${c.sessions}, ${c.routes} supprimés sur le téléphone : ils sont dans la corbeille des deux appareils pour 30 jours`,
    }));
  add('Supprimé',
    sessions.filter((i) => i.case !== 'deletedOnPhone' && hasOp(i, (op) => op.kind === 'removeFromPhone')),
    routes.filter((i) => i.case !== 'deletedOnPhone' && hasRouteOp(i, (op) => op.kind === 'removeFromPhone')),
    (s, r) => agree(s, r, {
      sessions: (n) => byCount(n, "{n} session supprimée sur l'ordinateur, retirée du téléphone : elle est dans la corbeille des deux appareils pour 30 jours", "{n} sessions supprimées sur l'ordinateur, retirées du téléphone : elles sont dans la corbeille des deux appareils pour 30 jours"),
      routes: (n) => byCount(n, "{n} itinéraire supprimé sur l'ordinateur, retiré du téléphone : il est dans la corbeille des deux appareils pour 30 jours", "{n} itinéraires supprimés sur l'ordinateur, retirés du téléphone : ils sont dans la corbeille des deux appareils pour 30 jours"),
      both: (c) => `${c.sessions}, ${c.routes} supprimés sur l'ordinateur, retirés du téléphone : ils sont dans la corbeille des deux appareils pour 30 jours`,
    }));
  const restored = sessions.filter((i) => i.restored === true);
  const restoredRoutes = routes.filter((i) => i.restored === true);
  add('Restauré', restored.filter(copiedTo('phone')), restoredRoutes.filter((i) => hasRouteOp(i, (op) => op.kind === 'copy' && op.to === 'phone')),
    (s, r) => agree(s, r, {
      sessions: (n) => byCount(n, '{n} session sortie de la corbeille : renvoyée au téléphone', '{n} sessions sorties de la corbeille : renvoyées au téléphone'),
      routes: (n) => byCount(n, '{n} itinéraire sorti de la corbeille : renvoyé au téléphone', '{n} itinéraires sortis de la corbeille : renvoyés au téléphone'),
      both: (c) => `${c.sessions}, ${c.routes} sortis de la corbeille : renvoyés au téléphone`,
    }));
  add('Restauré', restored.filter((i) => !copiedTo('phone')(i)), restoredRoutes.filter((i) => !hasRouteOp(i, (op) => op.kind === 'copy' && op.to === 'phone')),
    (s, r) => agree(s, r, {
      sessions: (n) => byCount(n, '{n} session sortie de la corbeille : de nouveau sur les deux appareils', '{n} sessions sorties de la corbeille : de nouveau sur les deux appareils'),
      routes: (n) => byCount(n, '{n} itinéraire sorti de la corbeille : de nouveau sur les deux appareils', '{n} itinéraires sortis de la corbeille : de nouveau sur les deux appareils'),
      both: (c) => `${c.sessions}, ${c.routes} sortis de la corbeille : de nouveau sur les deux appareils`,
    }));
  const [keptS, keptR] = [outcome.kept.sessions.length, outcome.kept.routes.length];
  if (keptS + keptR > 0) {
    rows.push({
      label: 'Gardé',
      text: agree(keptS, keptR, {
        sessions: (n) => byCount(n, '{n} session gardée : remise là où elle manquait', '{n} sessions gardées : remises là où elles manquaient'),
        routes: (n) => byCount(n, '{n} itinéraire gardé : remis là où il manquait', '{n} itinéraires gardés : remis là où ils manquaient'),
        both: (c) => `${c.sessions}, ${c.routes} gardés : remis là où ils manquaient`,
      }),
      names: [
        ...outcome.kept.sessions.map((startMs) => sessionName(outcome, startMs)),
        ...outcome.kept.routes.map((id) => outcome.names.routes[id] ?? id),
      ],
    });
  }
  return rows;
};

/**
 * Éléments écartés sans être des suppressions en attente (restes d'une session déjà supprimée), ni ce qu'une coquille
 * qui n'écrit pas laisse au téléphone : ils restent à faire, la prochaine synchronisation s'en charge.
 */
const leftoversOf = (outcome: SyncOutcome): number => outcome.cut - outcome.withheldDeletions.length - outcome.routes.withheldDeletions.length
  - (outcome.phoneWritable ? 0 : outcome.withheldForPhone.length + outcome.routes.withheldForPhone.length);

/** Les exceptions de l'échange, chacune avec ce qui va se passer. */
const exceptionNotes = (outcome: SyncOutcome): SyncReportNote[] => {
  const notes: SyncReportNote[] = [];
  const say = (text: string, detail: string | null = null): void => {
    notes.push({ text, detail });
  };
  const items = outcome.plan?.items ?? [];
  const routeItems = outcome.routes.plan?.items ?? [];

  for (const item of outcome.done.filter((i) => i.conflicts.length > 0)) {
    const labels = conflictLabels(item.conflicts);
    const winner = Object.values(item.conflictWinners ?? {}).includes('phone') ? 'du téléphone' : "de l'ordinateur";
    say(`« ${sessionName(outcome, item.startMs)} » : ${labels.join(', ')} changé${labels.length > 1 ? 's' : ''} sur les deux appareils. La version ${winner} a été gardée sur les deux.`);
  }
  const routeConflicts = outcome.routes.done.filter((i) => i.conflict && hasRouteOp(i, (op) => op.kind === 'copy')).length;
  if (routeConflicts > 0) {
    say(byCount(routeConflicts, "{n} itinéraire modifié sur les deux appareils : la version la plus récente est gardée, l'autre est dans la corbeille de l'ordinateur (30 jours).", "{n} itinéraires modifiés sur les deux appareils : la version la plus récente est gardée, l'autre est dans la corbeille de l'ordinateur (30 jours)."));
  }

  const unfinishedOn = (side: SyncSideName): number =>
    items.filter((i) => i.left !== null && UNFINISHED.includes(i.left) && i.files[side] !== null && i.files[side === 'phone' ? 'computer' : 'phone'] === null).length
    + (outcome.plan?.unknown.filter((u) => u.side === side && UNFINISHED.includes(u.reason)).length ?? 0);
  const unfinishedPhone = unfinishedOn('phone');
  if (unfinishedPhone > 0) {
    say(byCount(unfinishedPhone, "{n} session du téléphone n'a pas été prise : elle est encore en cours d'enregistrement ou de rangement. Elle viendra à la prochaine synchronisation.", "{n} sessions du téléphone n'ont pas été prises : elles sont encore en cours d'enregistrement ou de rangement. Elles viendront à la prochaine synchronisation."));
  }
  const unfinishedComputer = unfinishedOn('computer');
  if (unfinishedComputer > 0) {
    say(byCount(unfinishedComputer, "{n} session de l'ordinateur n'a pas été envoyée : elle est encore en cours de rangement. Elle partira à la prochaine synchronisation.", "{n} sessions de l'ordinateur n'ont pas été envoyées : elles sont encore en cours de rangement. Elles partiront à la prochaine synchronisation."));
  }
  const changedGpx = items.filter((i) => i.left === 'changedGpx').length;
  if (changedGpx > 0) {
    say(byCount(changedGpx, "{n} session n'a pas été touchée : son fichier de trace n'est plus le même sur les deux appareils. Tracker ne choisit pas à votre place.", "{n} sessions n'ont pas été touchées : leur fichier de trace n'est plus le même sur les deux appareils. Tracker ne choisit pas à votre place."));
  }
  const future = items.filter((i) => i.left === 'futureRecord').length;
  const newerRoutes = routeItems.filter((i) => i.left === 'newer').length;
  if (future + newerRoutes > 0) {
    say(agree(future, newerRoutes, {
      sessions: (n) => byCount(n, "{n} session n'a pas été touchée : elle vient d'une version plus récente de Tracker. Installez la dernière version de ce programme.", "{n} sessions n'ont pas été touchées : elles viennent d'une version plus récente de Tracker. Installez la dernière version de ce programme."),
      routes: (n) => byCount(n, "{n} itinéraire n'a pas été touché : il vient d'une version plus récente de Tracker. Installez la dernière version de ce programme.", "{n} itinéraires n'ont pas été touchés : ils viennent d'une version plus récente de Tracker. Installez la dernière version de ce programme."),
      both: (c) => `${c.sessions}, ${c.routes} n'ont pas été touchés : ils viennent d'une version plus récente de Tracker. Installez la dernière version de ce programme.`,
    }));
  }
  const unreadable = [
    ...routeItems.filter((i) => i.left === 'unreadable').map((i) => i.files.computer ?? i.files.phone ?? i.id),
    ...(outcome.routes.plan?.aside.filter((a) => a.reason === 'unreadable').map((a) => a.base) ?? []),
    ...outcome.extras.left.filter((l) => l.reason === 'unreadable').map((l) => fileName(l.path)),
  ];
  if (unreadable.length > 0) {
    const names = [...new Set(unreadable)].map((name) => `« ${name} »`).join(', ');
    say(byCount(unreadable.length, `{n} fichier illisible n'a pas été touché : ${names}.`, `{n} fichiers illisibles n'ont pas été touchés : ${names}.`));
  }
  const newerExtras = outcome.extras.left.filter((l) => l.reason === 'newer');
  if (newerExtras.length > 0) {
    const names = [...new Set(newerExtras.map((l) => fileName(l.path)))].map((name) => `« ${name} »`).join(', ');
    say(byCount(newerExtras.length, `{n} fichier n'a pas été touché (${names}) : il vient d'une version plus récente de Tracker. Installez la dernière version de ce programme.`, `{n} fichiers n'ont pas été touchés (${names}) : ils viennent d'une version plus récente de Tracker. Installez la dernière version de ce programme.`));
  }
  const [skipped, skippedRoutes] = [outcome.skipped.length, outcome.routes.skipped.length];
  if (skipped + skippedRoutes > 0) {
    say(agree(skipped, skippedRoutes, {
      sessions: (n) => byCount(n, '{n} session était en cours de modification : elle passera à la prochaine synchronisation.', '{n} sessions étaient en cours de modification : elles passeront à la prochaine synchronisation.'),
      routes: (n) => byCount(n, '{n} itinéraire était en cours de modification : il passera à la prochaine synchronisation.', '{n} itinéraires étaient en cours de modification : ils passeront à la prochaine synchronisation.'),
      both: (c) => `${c.sessions}, ${c.routes} étaient en cours de modification : ils passeront à la prochaine synchronisation.`,
    }));
  }
  // Garde des brouillons (Tracker) : une session supprimée sur le téléphone qui porte un brouillon ici n'est pas retirée.
  for (const item of outcome.drafted) {
    say(`« ${sessionName(outcome, item.startMs)} » a des modifications non enregistrées : elle n'a pas été retirée. Enregistrez-la ou annulez, puis synchronisez de nouveau.`);
  }
  const leftovers = leftoversOf(outcome);
  if (leftovers > 0) {
    say(byCount(leftovers, "{n} élément n'a pas pu être traité entièrement cette fois : la prochaine synchronisation s'en chargera.", "{n} éléments n'ont pas pu être traités entièrement cette fois : la prochaine synchronisation s'en chargera."));
  }
  if (outcome.keptFromPhone.length > 0) {
    say(byCount(outcome.keptFromPhone.length, "{n} copie du téléphone mise aussi dans la corbeille de l'ordinateur avant d'être retirée : rien n'est perdu.", "{n} copies du téléphone mises aussi dans la corbeille de l'ordinateur avant d'être retirées : rien n'est perdu."));
  }
  const unknown = outcome.unknownActivities.filter((u) => u.side === 'computer').length;
  if (unknown > 0) {
    say(byCount(unknown, "{n} session utilise une activité que cet ordinateur n'a pas. Elle vous sera demandée à son ouverture, ou prenez les réglages du téléphone dans Réglages › Mémoire.", "{n} sessions utilisent une activité que cet ordinateur n'a pas. Elle vous sera demandée à leur ouverture, ou prenez les réglages du téléphone dans Réglages › Mémoire."));
  }
  for (const name of new Set(outcome.extras.left.filter((l) => l.reason === 'otherDevice').map((l) => baseName(l.path)))) {
    say(`Deux appareils s'appellent « ${name} » : renommez-en un dans Réglages › Mémoire pour que leurs réglages s'échangent.`);
  }
  if (outcome.extras.left.some((l) => l.reason === 'changed' || l.reason === 'failed')) {
    say("Réglages, FC repos ou journaux n'ont pas tous pu être échangés cette fois : ils le seront à la prochaine.");
  }

  if (!outcome.phoneWritable) {
    say("Ce programme n'a rien pu écrire sur le téléphone : installez sa dernière version.");
  } else if (outcome.routes.waiting) {
    say("Les itinéraires n'ont pas été échangés : Tracker est trop ancien sur l'un des deux appareils. Installez sa dernière version.");
  }

  if (outcome.failed.length > 0) {
    say(byCount(outcome.failed.length, "{n} session n'a pas pu être rangée sur l'ordinateur.", "{n} sessions n'ont pas pu être rangées sur l'ordinateur."),
      [...new Set(outcome.failed.map((f) => clean(f.detail)))].join(' ; '));
  }
  if (outcome.routes.failed.length > 0) {
    say(byCount(outcome.routes.failed.length, "{n} itinéraire n'a pas pu être rangé sur l'ordinateur.", "{n} itinéraires n'ont pas pu être rangés sur l'ordinateur."),
      [...new Set(outcome.routes.failed.map((f) => clean(f.detail)))].join(' ; '));
  }
  if (outcome.recordingStarted) {
    say("Un enregistrement a commencé sur le téléphone : la synchronisation s'est arrêtée là. Ce qui est fait est gardé ; le reste se fera à la prochaine.");
  } else if (outcome.linkLost !== null) {
    say("Le téléphone n'est plus relié : la synchronisation s'est arrêtée en route. Ce qui est fait est gardé.", clean(outcome.linkLost));
  } else if (outcome.error !== null) {
    say("La synchronisation s'est arrêtée. Ce qui est fait est gardé.", clean(outcome.error));
  }
  return notes;
};

/** « 2 sessions sur le téléphone, 1 itinéraire sur l'ordinateur » : ce qu'une question montrait, appareil par appareil. */
const pendingBySide = (question: SyncQuestion): string =>
  questionSides(question).map(({ deletedOn, sessions, routes }) => (deletedOn === 'phone'
    ? `${counted(sessions.length, routes.length)} sur le téléphone`
    : `${counted(sessions.length, routes.length)} sur l'ordinateur`)).join(', ');

/** La phrase d'une question fermée sans réponse : ce qui l'attend encore. */
const unansweredNote = (question: SyncQuestion): string => {
  if (question.kind === 'guard') return `Des suppressions attendent votre réponse : ${pendingBySide(question)}.`;
  return agree(question.sessions.length, question.routes.length, {
    sessions: (n) => byCount(n, '{n} session de la corbeille de cet ordinateur, encore sur le téléphone, attend votre réponse.', '{n} sessions de la corbeille de cet ordinateur, encore sur le téléphone, attendent votre réponse.'),
    routes: (n) => byCount(n, '{n} itinéraire de la corbeille de cet ordinateur, encore sur le téléphone, attend votre réponse.', '{n} itinéraires de la corbeille de cet ordinateur, encore sur le téléphone, attendent votre réponse.'),
    both: (c) => `${c.sessions}, ${c.routes} de la corbeille de cet ordinateur, encore sur le téléphone, attendent votre réponse.`,
  });
};

/**
 * Compte rendu d'une synchronisation : une ligne par geste qui a touché quelque chose, les exceptions, et le bouton
 * qui accompagne « Fermer ». `unanswered` : la question que l'utilisateur a fermée sans répondre ; `answerFailed` : la
 * passe d'une réponse qui n'a rien pu faire.
 */
export const describeSync = (outcome: SyncOutcome, unanswered: SyncQuestion | null = null, answerFailed: PhoneSyncResult | null = null): SyncReport => {
  if (outcome.refusal !== null) return refusalReport(outcome);
  const paragraphs: string[] = [];
  const stopped = outcome.linkLost !== null || outcome.error !== null || outcome.recordingStarted;
  // Une reprise elle-même arrêtée n'a rien terminé : la note d'arrêt dit seule ce qu'il en est.
  if (outcome.interrupted && !stopped) paragraphs.push("La synchronisation précédente s'était arrêtée en route : elle vient d'être terminée.");
  const rows = gestureRows(outcome);
  // Un téléphone qu'on ne peut pas écrire ne reçoit pas d'identifiant : chaque passe serait « la première ». Une
  // première synchronisation jointe à la passe d'une réponse peut avoir supprimé : la phrase se tait alors.
  const deleted = rows.some((row) => row.label === 'Supprimé');
  if (outcome.phoneWritable && outcome.first === 'olderCopy' && !deleted) {
    paragraphs.push("Le dossier du téléphone est une copie plus ancienne (une sauvegarde remise, ou le même dossier sur un autre téléphone) : il a été traité comme un nouveau téléphone, et rien n'a été supprimé. Des sessions supprimées depuis cette copie peuvent revenir : supprimez-les de nouveau si vous n'en voulez plus.");
  } else if (outcome.phoneWritable && outcome.first !== null && !deleted) paragraphs.push("Première synchronisation : rien n'a été supprimé.");
  const notes = exceptionNotes(outcome);
  if (answerFailed !== null) notes.push(answerFailureNote(answerFailed));
  if (unanswered !== null) notes.push({ text: unansweredNote(unanswered), detail: null });
  const restart = stopped || outcome.failed.length > 0 || outcome.routes.failed.length > 0;
  const nothing = rows.length === 0 && notes.length === 0;
  if (nothing) paragraphs.push('Rien à échanger : les deux appareils ont les mêmes sessions et les mêmes itinéraires.');
  if (outcome.safetyCopy !== null) paragraphs.push('Copie de sécurité :');
  const title = stopped ? 'Synchronisation arrêtée' : nothing ? 'Tout est à jour' : 'Synchronisation terminée';
  return report(title, paragraphs, restart ? 'restart' : unanswered !== null ? 'answer' : 'close', { rows, notes, folder: outcome.safetyCopy });
};

/**
 * Pourquoi une réponse à la question n'a pas pu s'appliquer, d'après la passe qu'elle a lancée et qui n'a rien fait :
 * le téléphone parti avant, ou la synchronisation refusée. La suite : répondre de nouveau.
 */
const answerFailureNote = (failed: PhoneSyncResult): SyncReportNote => {
  const lead = "Votre réponse n'a pas pu s'appliquer : rien n'a été supprimé ni remis.";
  if (failed.kind !== 'synced') {
    return {
      text: `${lead} Le téléphone ne répond plus. Répondez de nouveau quand il est là : câble branché, écran déverrouillé.`,
      detail: failed.kind === 'error' ? clean(failed.detail) : null,
    };
  }
  const reason = failed.outcome.refusal === 'busy'
    ? "L'ordinateur est occupé (import ou enregistrement en cours). Répondez de nouveau quand il a fini."
    : refusalReport(failed.outcome).paragraphs[0];
  return { text: `${lead} ${reason}`, detail: failed.outcome.error ? clean(failed.outcome.error) : null };
};

/**
 * Issue entière du bouton « Synchroniser » ; `answerFailed` : la passe d'une réponse qui n'a rien pu faire, dont la
 * raison s'ajoute au compte rendu.
 */
export const describePhoneSync = (result: PhoneSyncResult, unanswered: SyncQuestion | null = null, answerFailed: PhoneSyncResult | null = null): SyncReport => {
  switch (result.kind) {
    // La fenêtre attend un téléphone qui n'est pas prêt (`describeWait`) : cette issue ne s'y montre pas d'ordinaire.
    case 'phone':
      return report(SYNC_WINDOW_TITLE, ["Le téléphone n'est pas prêt : branchez-le par un câble USB et déverrouillez son écran, puis réessayez."], 'retry');
    case 'cannotWrite':
      return report('Synchronisation impossible', ['Ce programme ne sait pas encore écrire sur le téléphone : installez sa dernière version.'], 'close');
    // Panne avant l'échange, téléphone présent : elle se dit, avec « Recommencer ».
    case 'error':
      return report('Synchronisation arrêtée', ["La synchronisation s'est arrêtée. Ce qui est fait est gardé."], 'restart', { detail: clean(result.detail) });
    case 'synced':
      return describeSync(result.outcome, unanswered, answerFailed);
  }
};

/**
 * Rassemble deux passes d'une même synchronisation (la reprise d'éléments changés en route, ou la passe d'une réponse)
 * en une seule issue, pour un seul compte rendu : ce que la première a fait, puis l'état laissé par la seconde.
 * Une session ou un itinéraire fait aux deux passes n'est compté qu'une fois, par la passe qui l'a touché.
 */
export const mergeSyncPasses = (earlier: SyncOutcome, later: SyncOutcome): SyncOutcome => {
  if (later.refusal !== null) return earlier;
  const laterSessions = new Map(later.done.map((i) => [i.startMs, i]));
  const done = [
    ...earlier.done.map((i) => (i.ops.length === 0 ? laterSessions.get(i.startMs) ?? i : i)),
    ...later.done.filter((i) => !earlier.done.some((e) => e.startMs === i.startMs)),
  ];
  const laterRoutes = new Map(later.routes.done.map((i) => [i.id, i]));
  const routesDone = [
    ...earlier.routes.done.map((i) => (i.ops.length === 0 ? laterRoutes.get(i.id) ?? i : i)),
    ...later.routes.done.filter((i) => !earlier.routes.done.some((e) => e.id === i.id)),
  ];
  const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])];
  return {
    ...later,
    interrupted: earlier.interrupted || later.interrupted,
    first: earlier.first ?? later.first,
    safetyCopy: earlier.safetyCopy ?? later.safetyCopy,
    phoneChanged: earlier.phoneChanged || later.phoneChanged,
    done,
    keptFromPhone: union(earlier.keptFromPhone, later.keptFromPhone),
    kept: {
      sessions: union(earlier.kept.sessions, later.kept.sessions),
      routes: union(earlier.kept.routes, later.kept.routes),
      fromTrash: {
        sessions: union(earlier.kept.fromTrash.sessions, later.kept.fromTrash.sessions),
        routes: union(earlier.kept.fromTrash.routes, later.kept.fromTrash.routes),
      },
    },
    names: { sessions: { ...earlier.names.sessions, ...later.names.sessions }, routes: { ...earlier.names.routes, ...later.names.routes } },
    extras: { ...later.extras, done: [...earlier.extras.done, ...later.extras.done], copied: [...earlier.extras.copied, ...later.extras.copied] },
    routes: { ...later.routes, done: routesDone },
    unknownActivities: [
      ...earlier.unknownActivities,
      ...later.unknownActivities.filter((u) => !earlier.unknownActivities.some((e) => e.side === u.side && e.startMs === u.startMs)),
    ],
  };
};

/** Vrai si l'issue laisse des éléments changés pendant l'opération, qu'une passe de plus reprendrait. */
export const syncHasChangedItems = (outcome: SyncOutcome): boolean =>
  outcome.refusal === null && outcome.linkLost === null && outcome.error === null && !outcome.recordingStarted
  && (outcome.skipped.length > 0 || outcome.routes.skipped.length > 0 || outcome.extras.left.some((l) => l.reason === 'changed'));

/** Une session nommée dans une question : où elle est, son GPX, et son nom montré. */
export interface SyncQuestionSession {
  startMs: number;
  /** L'appareil dont elle serait retirée (`computer` : mise à la corbeille). */
  side: SyncSideName;
  /** Nom de son GPX de ce côté. */
  file: string;
  /** Son nom montré, sinon sa date et son heure de départ. */
  label: string;
}

/** Un itinéraire nommé dans une question : son identité, l'appareil dont il serait retiré, et son nom. */
export interface SyncQuestionRoute {
  id: string;
  side: SyncSideName;
  label: string;
}

/**
 * Question à poser avant d'aller plus loin : `guard`, le garde-fou retient des suppressions à confirmer ; `inTrash`,
 * des sessions de la corbeille de l'ordinateur sont encore sur le téléphone, à garder ou à retirer. Les deux réponses
 * règlent la question ; fermer la fenêtre ne décide rien.
 */
export interface SyncQuestion {
  kind: 'guard' | 'inTrash';
  sessions: SyncQuestionSession[];
  routes: SyncQuestionRoute[];
}

const otherSide = (side: SyncSideName): SyncSideName => (side === 'phone' ? 'computer' : 'phone');

/** Ce qu'une question nomme, rangé par l'appareil où la suppression a été faite : le téléphone d'abord. */
const questionSides = (question: SyncQuestion): { deletedOn: SyncSideName; sessions: SyncQuestionSession[]; routes: SyncQuestionRoute[] }[] =>
  (['phone', 'computer'] as const)
    .map((deletedOn) => ({
      deletedOn,
      sessions: question.sessions.filter((s) => otherSide(s.side) === deletedOn),
      routes: question.routes.filter((r) => otherSide(r.side) === deletedOn),
    }))
    .filter((g) => g.sessions.length + g.routes.length > 0);

/** Ce que la fenêtre montre d'une question : ses phrases, ses lignes par appareil ou sa liste, et ses deux réponses. */
export interface SyncQuestionText {
  title: string;
  intro: string;
  /** Garde-fou : une ligne par appareil où des suppressions ont été faites. */
  rows: SyncReportRow[];
  /** Corbeille : les noms, en liste simple. */
  names: string[];
  /** La question elle-même ; `null` quand l'introduction la pose déjà. */
  ask: string | null;
  keepLabel: string;
  removeLabel: string;
  hint: string;
}

/** Phrases d'une question. */
export const describeQuestion = (question: SyncQuestion): SyncQuestionText => {
  const [s, r] = [question.sessions.length, question.routes.length];
  const form = formOf(s, r);
  if (question.kind === 'guard') {
    const rows = questionSides(question).map(({ deletedOn, sessions, routes }) => ({
      label: deletedOn === 'phone' ? 'Sur le téléphone' : "Sur l'ordinateur",
      text: agree(sessions.length, routes.length, {
        sessions: (n) => byCount(n, '{n} session supprimée', '{n} sessions supprimées'),
        routes: (n) => byCount(n, '{n} itinéraire supprimé', '{n} itinéraires supprimés'),
        both: (c) => `${c.sessions}, ${c.routes} supprimés`,
      }),
      names: [...sessions.map((x) => x.label), ...routes.map((x) => x.label)],
    }));
    const tail = "Rien n'est perdu : tout reste 30 jours dans la corbeille des deux appareils.";
    const ask = form === 'f1' ? "Faut-il la supprimer aussi de l'autre appareil ?" : form === 'm1' ? "Faut-il le supprimer aussi de l'autre appareil ?" : "Faut-il les supprimer aussi de l'autre appareil ?";
    const keepHint = r === 0 ? '« Tout garder » remet chaque session là où elle manque.'
      : s === 0 ? '« Tout garder » remet chaque itinéraire là où il manque.'
        : '« Tout garder » remet chaque session et chaque itinéraire là où ils manquent.';
    return {
      title: s + r > 1 ? "Beaucoup de suppressions d'un coup" : 'Une suppression à confirmer',
      intro: 'Depuis la dernière synchronisation :',
      rows, names: [],
      ask: `${ask} ${tail}`,
      keepLabel: 'Tout garder',
      removeLabel: 'Supprimer des deux côtés',
      hint: `${keepHint} Fermer la fenêtre ne décide rien : la question reviendra.`,
    };
  }
  const intro = agree(s, r, {
    sessions: (n) => byCount(n, '{n} session est dans la corbeille de cet ordinateur, mais encore sur le téléphone :', '{n} sessions sont dans la corbeille de cet ordinateur, mais encore sur le téléphone :'),
    routes: (n) => byCount(n, '{n} itinéraire est dans la corbeille de cet ordinateur, mais encore sur le téléphone :', '{n} itinéraires sont dans la corbeille de cet ordinateur, mais encore sur le téléphone :'),
    both: (c) => `${c.sessions}, ${c.routes} sont dans la corbeille de cet ordinateur, mais encore sur le téléphone :`,
  });
  const labels: Record<Form, [string, string, string]> = {
    f1: ['La garder', 'La retirer du téléphone', '« La garder » la sort de la corbeille : elle est de nouveau sur les deux appareils.'],
    fN: ['Les garder', 'Les retirer du téléphone', '« Les garder » les sort de la corbeille : elles sont de nouveau sur les deux appareils.'],
    m1: ['Le garder', 'Le retirer du téléphone', '« Le garder » le sort de la corbeille : il est de nouveau sur les deux appareils.'],
    mN: ['Les garder', 'Les retirer du téléphone', '« Les garder » les sort de la corbeille : ils sont de nouveau sur les deux appareils.'],
  };
  const [keepLabel, removeLabel, hint] = labels[form];
  return {
    title: s > 0 ? 'Supprimée ici, encore sur le téléphone' : 'Supprimé ici, encore sur le téléphone',
    intro, rows: [], names: [...question.sessions.map((x) => x.label), ...question.routes.map((x) => x.label)],
    ask: null, keepLabel, removeLabel, hint,
  };
};

const questionSession = (outcome: SyncOutcome, item: SyncItem, side: SyncSideName): SyncQuestionSession => ({
  startMs: item.startMs, side, file: item.files[side] ?? item.files[otherSide(side)] ?? '', label: sessionName(outcome, item.startMs),
});

const questionRoute = (outcome: SyncOutcome, item: RouteSyncItem, side: SyncSideName): SyncQuestionRoute => ({
  id: item.id, side, label: routeName(outcome, item),
});

/**
 * La question qu'appelle une synchronisation, ou `null`. Le garde-fou d'abord ; les sessions de la corbeille encore sur
 * le téléphone ensuite, seulement si le téléphone s'écrit, que les suppressions étaient permises et que rien ne s'est
 * arrêté en route.
 */
export const describeSyncQuestion = (outcome: SyncOutcome): SyncQuestion | null => {
  if (outcome.refusal !== null) return null;
  const withheldRoutes = outcome.routes.withheldDeletions;
  if (outcome.deletions === 'awaitingConfirmation' && outcome.withheldDeletions.length + withheldRoutes.length > 0) {
    return {
      kind: 'guard',
      sessions: outcome.withheldDeletions.map((item) => questionSession(outcome, item, item.case === 'deletedOnPhone' ? 'computer' : 'phone')),
      routes: withheldRoutes.map((item) => questionRoute(outcome, item, item.case === 'deletedOnPhone' ? 'computer' : 'phone')),
    };
  }
  if (!outcome.phoneWritable || outcome.deletions !== 'made' || outcome.linkLost !== null || outcome.error !== null || outcome.recordingStarted) return null;
  const held = (outcome.plan?.items ?? []).filter((i) => i.left === 'inTrash');
  const heldRoutes = (outcome.routes.plan?.items ?? []).filter((i) => i.left === 'inTrash');
  if (held.length + heldRoutes.length === 0) return null;
  return {
    kind: 'inTrash',
    sessions: held.map((item) => questionSession(outcome, item, 'phone')),
    routes: heldRoutes.map((item) => questionRoute(outcome, item, 'phone')),
  };
};
