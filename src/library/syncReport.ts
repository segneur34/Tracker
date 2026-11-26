import { plural } from '../core/basics';
import { formatSessionDate } from '../core/units';
import { conflictLabels } from './recordMerge';
import { otherSyncSide, type SyncSideName } from './syncBase';
import type { SyncExtrasPlan } from './syncExtras';
import type { SyncOutcome } from './syncOutcome';
import { syncDeletionSide, type SyncItem, type SyncLeftReason, type SyncOp, type SyncPlan } from './syncPlan';
import { isRouteDeletion, syncWholeGuard, type RouteSyncItem, type RouteSyncOp, type RouteSyncPlan } from './syncRoutes';

/**
 * Ce que l'ordinateur dit d'une synchronisation avec le téléphone avant de la faire : combien de sessions et
 * d'itinéraires vont de chaque côté, combien seront retirés, ce qui attend et pourquoi, et les champs changés des deux
 * côtés. En français simple, sans jargon ; pur, tout se lit dans les plans (`syncPlan.ts`, `syncRoutes.ts`,
 * `syncExtras.ts`) ; la confirmation chiffrée d'un passage à blanc (`describeSyncConfirmation`) ; puis, l'exécution
 * faite (`hooks/sessionLibrary/sync.ts`), le compte rendu : ce qui a été copié, mis de côté, refusé et pourquoi
 * (`describeSyncOutcome`).
 */

/** Les plans d'une synchronisation : sessions, et s'ils ont été faits, itinéraires et fichiers d'à côté. */
export interface SyncPlans {
  sessions: SyncPlan;
  routes?: RouteSyncPlan | null;
  extras?: SyncExtrasPlan | null;
}

/** Nombre de sessions et d'itinéraires touchés de chaque façon, chacun compté une fois par façon. */
export interface SyncCounts {
  /** Reçoivent quelque chose sur le téléphone : copie entière, fiche changée, capteurs. */
  toPhone: number;
  /** De même sur l'ordinateur. */
  toComputer: number;
  /** Retirés d'un appareil : à la corbeille de l'ordinateur, ou mis de côté sur le téléphone. */
  toRemove: number;
}

const writesTo = (op: SyncOp, side: SyncSideName): boolean =>
  (op.kind === 'copy' || op.kind === 'copyRecord' || op.kind === 'copyImu') ? op.to === side : op.kind === 'writeRecord' && op.on === side;

const routeWritesTo = (op: RouteSyncOp, side: SyncSideName): boolean => op.kind === 'copy' && op.to === side;

/** Les comptes d'un plan (déjà restreint à ce qui sera fait, `restrictSyncPlan`). */
export const syncCounts = ({ sessions, routes }: SyncPlans): SyncCounts => {
  const routeItems = routes?.items ?? [];
  const count = (side: SyncSideName): number =>
    sessions.items.filter((i) => syncDeletionSide(i) === null && i.ops.some((op) => writesTo(op, side))).length
    + routeItems.filter((i) => !isRouteDeletion(i) && i.ops.some((op) => routeWritesTo(op, side))).length;
  return {
    toPhone: count('phone'),
    toComputer: count('computer'),
    toRemove: sessions.items.filter((i) => syncDeletionSide(i) !== null).length + routeItems.filter(isRouteDeletion).length,
  };
};

/** « 3 à copier vers le téléphone, 5 vers l'ordinateur, 2 à retirer » ; `null` s'il n'y a rien à faire. */
export const syncCountsText = ({ toPhone, toComputer, toRemove }: SyncCounts): string | null => {
  const parts: string[] = [];
  if (toPhone > 0) parts.push(`${toPhone} à copier vers le téléphone`);
  if (toComputer > 0) parts.push(parts.length > 0 ? `${toComputer} vers l'ordinateur` : `${toComputer} à copier vers l'ordinateur`);
  if (toRemove > 0) parts.push(`${toRemove} à retirer`);
  return parts.length > 0 ? parts.join(', ') : null;
};

/** Nom montré d'une session : celui que l'appelant donne (`names`), sinon sa date et son heure de départ. */
const sessionName = (names: Readonly<Record<number, string>>, startMs: number): string => names[startMs] ?? formatSessionDate(startMs);

/** Raisons d'une session qui n'est pas finie de ranger sur son appareil. */
const UNFINISHED: readonly SyncLeftReason[] = ['noRecord', 'unreadableRecord', 'emptyGpx', 'unfinishedGpx'];

/** Ce que l'ordinateur montre avant de synchroniser. */
export interface SyncPreview {
  counts: SyncCounts;
  /** La phrase des comptes, ou « Rien à échanger… ». */
  headline: string;
  /** Phrases à dire en plus, dans l'ordre : première fois, garde-fou, conflits, ce qui attend, fichiers d'à côté. */
  notes: string[];
}

/** Nom montré d'un itinéraire : la base de ses fichiers, sinon son identité. */
const routeName = (item: RouteSyncItem): string => item.files.computer ?? item.files.phone ?? item.id;

/** « 12 sessions et 3 itinéraires », « 1 itinéraire » : chaque sorte comptée à part. */
const sessionsAndRoutes = (sessions: number, routes: number): string =>
  [sessions > 0 ? plural(sessions, 'session') : null, routes > 0 ? plural(routes, 'itinéraire') : null].filter((x) => x !== null).join(' et ');

/**
 * Ce qu'on dit avant une synchronisation. `plans` : ce qui sera fait (restreint) ; `full` : les plans entiers, avant
 * restriction, pour le garde-fou des sessions et des itinéraires ensemble (par défaut `plans`) ; `names` : nom montré
 * de chaque session qui en a un, par instant de départ.
 */
export const describeSyncPreview = (plans: SyncPlans, full: SyncPlans = plans, names: Readonly<Record<number, string>> = {}): SyncPreview => {
  const counts = syncCounts(plans);
  const headline = syncCountsText(counts) ?? 'Rien à échanger : les deux appareils ont les mêmes sessions.';
  const notes: string[] = [];
  const { sessions, routes, extras } = plans;

  if (sessions.pair.first === 'olderCopy') {
    notes.push("Le dossier du téléphone est une copie plus ancienne : il est traité comme un nouveau téléphone, et rien ne sera supprimé.");
  } else if (sessions.pair.first !== null) {
    notes.push('Première synchronisation avec ce téléphone : rien ne sera supprimé, chaque appareil reçoit ce qui lui manque.');
  }

  const asked = syncGuardQuestion(full, names);
  if (asked.sessions.length + asked.routes.length > 0) {
    const done = { sessions: sessions.items.filter((i) => syncDeletionSide(i) !== null).length, routes: routes?.items.filter(isRouteDeletion).length ?? 0 };
    if (done.sessions < asked.sessions.length || done.routes < asked.routes.length) {
      notes.push(`Cette synchronisation retirerait ${sessionsAndRoutes(asked.sessions.length, asked.routes.length)}. Rien n'est encore supprimé : il faut le confirmer.`);
    }
  }
  if (sessions.guard.toTrash > 0) {
    notes.push(`${plural(sessions.guard.toTrash, 'session')} supprimée${sessions.guard.toTrash > 1 ? 's' : ''} sur le téléphone : elle${sessions.guard.toTrash > 1 ? 's iront' : ' ira'} dans la corbeille de l'ordinateur (30 jours).`);
  }
  if (sessions.items.some((i) => i.ops.some((op) => op.kind === 'removeFromPhone')) || routes?.items.some((i) => i.ops.some((op) => op.kind === 'removeFromPhone'))) {
    notes.push("Rien n'est effacé du téléphone : ce qui en est retiré est mis de côté dans son dossier Documents/Tracker-corbeille.");
  }

  for (const side of ['phone', 'computer'] as const) {
    const n = sessions.items.filter((i) => i.revived === true && i.ops.some((op) => op.kind === 'copy' && op.to === side)).length;
    if (n === 0) continue;
    const [gone, kept] = side === 'phone' ? ['le téléphone', "l'ordinateur"] : ["l'ordinateur", 'le téléphone'];
    notes.push(n > 1
      ? `${n} sessions supprimées sur ${gone} avaient été modifiées sur ${kept} : elles sont gardées et reviennent sur ${gone}.`
      : `1 session supprimée sur ${gone} avait été modifiée sur ${kept} : elle est gardée et revient sur ${gone}.`);
  }
  for (const item of sessions.items.filter((i) => i.conflicts.length > 0)) {
    const labels = conflictLabels(item.conflicts);
    const winner = Object.values(item.conflictWinners ?? {}).includes('phone') ? 'du téléphone' : "de l'ordinateur";
    notes.push(`« ${sessionName(names, item.startMs)} » : ${labels.join(', ')} changé${labels.length > 1 ? 's' : ''} sur les deux appareils. La version ${winner} est gardée.`);
  }
  for (const item of routes?.items.filter((i) => i.conflict && i.ops.some((op) => op.kind === 'copy')) ?? []) {
    notes.push(`Itinéraire « ${routeName(item)} » changé sur les deux appareils : le plus récent est gardé, l'autre va dans la corbeille de l'ordinateur.`);
  }

  // Pas finie de ranger d'un côté : la session qui n'y est que là, et le GPX sans identité de ce côté.
  const unfinishedOn = (side: SyncSideName): number =>
    sessions.items.filter((i) => i.left !== null && UNFINISHED.includes(i.left) && i.files[side] !== null && i.files[otherSyncSide(side)] === null).length
    + sessions.unknown.filter((u) => u.side === side && UNFINISHED.includes(u.reason)).length;
  const unfinishedPhone = unfinishedOn('phone');
  if (unfinishedPhone > 0) {
    notes.push(`${plural(unfinishedPhone, 'session')} du téléphone pas encore finie${unfinishedPhone > 1 ? 's' : ''} de ranger : elle${unfinishedPhone > 1 ? 's viendront' : ' viendra'} la prochaine fois.`);
  }
  const unfinishedComputer = unfinishedOn('computer');
  if (unfinishedComputer > 0) {
    notes.push(`${plural(unfinishedComputer, 'session')} de l'ordinateur pas encore finie${unfinishedComputer > 1 ? 's' : ''} de ranger : elle${unfinishedComputer > 1 ? 's partiront' : ' partira'} la prochaine fois.`);
  }
  const changedGpx = sessions.items.filter((i) => i.left === 'changedGpx').length;
  if (changedGpx > 0) {
    notes.push(`${plural(changedGpx, 'session')} laissée${changedGpx > 1 ? 's' : ''} de côté : sa trace n'est plus la même sur les deux appareils. Rien n'est choisi à votre place.`);
  }
  const future = sessions.items.filter((i) => i.left === 'futureRecord').length + (routes?.items.filter((i) => i.left === 'newer').length ?? 0);
  if (future > 0) notes.push(`${future} élément${future > 1 ? 's' : ''} d'une version plus récente de Tracker : laissé${future > 1 ? 's' : ''} tel${future > 1 ? 's' : ''} quel${future > 1 ? 's' : ''}. Mettez ce programme à jour.`);
  const inTrash = sessions.items.filter((i) => i.left === 'inTrash').length + (routes?.items.filter((i) => i.left === 'inTrash').length ?? 0);
  if (inTrash > 0) {
    notes.push(`${inTrash} élément${inTrash > 1 ? 's' : ''} dans la corbeille de l'ordinateur et encore sur le téléphone : laissé${inTrash > 1 ? 's' : ''} sur le téléphone, ni ramené${inTrash > 1 ? 's' : ''} ni supprimé${inTrash > 1 ? 's' : ''}.`);
  }

  if (extras) {
    const settings = extras.ops.filter((op) => op.kind === 'settings').length;
    if (settings > 0) notes.push(`${plural(settings, 'fichier')} de réglages recopié${settings > 1 ? 's' : ''}, sans rien changer aux réglages de chaque appareil.`);
    if (extras.ops.some((op) => op.kind === 'restingHr')) notes.push('Tests de FC repos mis en commun.');
    const journals = extras.copies.length;
    if (journals > 0) notes.push(journals > 1 ? `${journals} journaux d'enregistrement copiés vers l'ordinateur.` : "1 journal d'enregistrement copié vers l'ordinateur.");
    for (const name of new Set(extras.left.filter((l) => l.reason === 'otherDevice').map((l) => l.path.split('/').pop()?.replace(/\.json$/i, '') ?? l.path))) {
      notes.push(`Deux appareils s'appellent « ${name} » : renommez-en un dans Réglages › Mémoire pour que leurs réglages s'échangent.`);
    }
  }
  return { counts, headline, notes };
};

/** Une session ou un itinéraire d'une question : son identité, l'appareil d'où il partirait, et son nom montré. */
export interface SyncQuestionSession {
  startMs: number;
  side: SyncSideName;
  label: string;
}

export interface SyncQuestionRoute {
  id: string;
  side: SyncSideName;
  label: string;
}

/** Ce que le garde-fou retient, à nommer avant de demander de confirmer. */
export interface SyncGuardQuestion {
  sessions: SyncQuestionSession[];
  routes: SyncQuestionRoute[];
}

/**
 * Les sessions et les itinéraires que le garde-fou de la synchronisation entière retient (`syncWholeGuard`), à
 * montrer avant de demander de confirmer leur retrait : ceux des plans entiers (`full`, avant restriction). Vide s'il
 * ne s'est pas déclenché.
 */
export const syncGuardQuestion = (full: SyncPlans, names: Readonly<Record<number, string>> = {}): SyncGuardQuestion => {
  if (!syncWholeGuard(full.sessions.guard, full.routes?.guard ?? null).tripped) return { sessions: [], routes: [] };
  return {
    sessions: full.sessions.items.flatMap((i: SyncItem) => {
      const side = syncDeletionSide(i);
      return side === null ? [] : [{ startMs: i.startMs, side, label: sessionName(names, i.startMs) }];
    }),
    routes: (full.routes?.items ?? []).filter(isRouteDeletion).map((i) => ({
      id: i.id, side: i.ops.some((op) => op.kind === 'trash') ? 'computer' as const : 'phone' as const, label: routeName(i),
    })),
  };
};

// ---------- après la synchronisation : le compte rendu ----------

/** Une ligne du compte rendu : ce qui a été fait, et le nom de chaque session ou itinéraire touché. */
export interface SyncReportRow {
  label: string;
  text: string;
  names: string[];
}

/** Le compte rendu d'une synchronisation, en français courant. */
export interface SyncReport {
  title: string;
  /** Phrases d'en-tête : reprise, première fois, copie de sécurité. */
  paragraphs: string[];
  /** Une ligne par geste qui a touché quelque chose (copié, modifié, mis à la corbeille, mis de côté…). */
  rows: SyncReportRow[];
  /** Ce qui n'a pas été fait et pourquoi, ce qui attend, les conflits et qui l'a emporté. */
  notes: string[];
  /** Vrai : proposer « Réessayer ». */
  retry: boolean;
}

/** « 2 sessions et 1 itinéraire » ; avec `none`, ce qu'on dit quand il n'y a rien. */
const both = (sessions: number, routes: number): string => sessionsAndRoutes(sessions, routes);

const outcomeSessionName = (outcome: SyncOutcome, startMs: number): string => sessionName(outcome.names.sessions, startMs);
const outcomeRouteName = (outcome: SyncOutcome, item: RouteSyncItem): string => outcome.names.routes[item.id] ?? routeName(item);

const hasSessionOp = (item: SyncItem, test: (op: SyncOp) => boolean): boolean => item.ops.some(test);
const hasRouteOp = (item: RouteSyncItem, test: (op: RouteSyncOp) => boolean): boolean => item.ops.some(test);

/** Accord d'un participe sur ce qu'il reprend : une session (féminin), sinon masculin, au pluriel au-delà d'un. */
const agreed = (sessions: number, routes: number, stem: string): string =>
  `${stem}${routes === 0 ? 'e' : ''}${sessions + routes > 1 ? 's' : ''}`;

/** La phrase d'une synchronisation refusée ; rien n'a été fait. */
const refusalReport = (outcome: SyncOutcome): SyncReport => {
  const say = (text: string, retry: boolean): SyncReport => ({ title: 'Synchronisation impossible', paragraphs: [text], rows: [], notes: [], retry });
  switch (outcome.refusal) {
    case 'computerNoMarker':
    case 'noTrash':
    case 'memory':
      return say("La mémoire de cet ordinateur n'est pas disponible : vérifiez son dossier ci-dessus, dans Réglages › Mémoire.", false);
    case 'phoneNoMarker':
      return say("Tracker n'a pas encore de mémoire sur ce téléphone. Ouvrez-le une fois sur le téléphone et choisissez son dossier (Réglages › Mémoire), puis cliquez sur « Réessayer ».", true);
    case 'computerNewer':
    case 'phoneNewer':
    case 'newerBase':
      return say("Ce programme est plus ancien que le Tracker du téléphone. Installez sa dernière version, puis synchronisez.", false);
    case 'trashLocked':
      return say("La corbeille de cet ordinateur ne se lit pas : par prudence, rien n'a été synchronisé.", false);
    case 'busy':
      return say("Un import de sessions ou une autre synchronisation est déjà en cours. Attendez qu'il finisse, puis cliquez sur « Réessayer ».", true);
    case 'phoneRecording':
      return say("Le téléphone enregistre une session : rien n'a été fait, ni sur le téléphone ni sur l'ordinateur. Arrêtez l'enregistrement, puis cliquez sur « Réessayer ».", true);
    default:
      return say(`La copie de sécurité des deux dossiers n'a pas pu être faite : rien n'a été synchronisé.${outcome.error ? ` (${outcome.error.replace(/\.\s*$/, '')}.)` : ''}`, true);
  }
};

/** Lignes du compte rendu, une par geste qui a touché quelque chose. */
const gestureRows = (outcome: SyncOutcome): SyncReportRow[] => {
  const kept = new Set(outcome.kept.sessions);
  const keptRoutes = new Set(outcome.kept.routes);
  const sessions = outcome.done.filter((i) => !kept.has(i.startMs));
  const routes = outcome.routes.done.filter((i) => !keptRoutes.has(i.id));
  const rows: SyncReportRow[] = [];
  const add = (label: string, picked: SyncItem[], pickedRoutes: RouteSyncItem[], text: (s: number, r: number) => string): void => {
    if (picked.length + pickedRoutes.length === 0) return;
    rows.push({
      label, text: text(picked.length, pickedRoutes.length),
      names: [...picked.map((i) => outcomeSessionName(outcome, i.startMs)), ...pickedRoutes.map((i) => outcomeRouteName(outcome, i))],
    });
  };
  const copiedTo = (side: SyncSideName) => (i: SyncItem) => hasSessionOp(i, (op) => op.kind === 'copy' && op.to === side);
  const routeCopiedTo = (side: SyncSideName) => (i: RouteSyncItem) =>
    (i.case === 'newOnComputer' || i.case === 'newOnPhone' || i.revived) && hasRouteOp(i, (op) => op.kind === 'copy' && op.to === side);
  const plain = sessions.filter((i) => i.restored !== true);
  const plainRoutes = routes.filter((i) => i.restored !== true);
  add('Copié vers l’ordinateur', plain.filter(copiedTo('computer')), plainRoutes.filter(routeCopiedTo('computer')), both);
  add('Copié vers le téléphone', plain.filter(copiedTo('phone')), plainRoutes.filter(routeCopiedTo('phone')), both);
  add('Modifié',
    plain.filter((i) => !hasSessionOp(i, (op) => op.kind === 'copy') && hasSessionOp(i, (op) => op.kind === 'writeRecord' || op.kind === 'copyRecord' || op.kind === 'copyImu')),
    plainRoutes.filter((i) => (i.case === 'followed' || i.case === 'firstMeeting') && !i.conflict && hasRouteOp(i, (op) => op.kind === 'copy')),
    (s, r) => `${both(s, r)}, ${agreed(s, r, 'recopié')} sur l'autre appareil`);
  add('Mis à la corbeille',
    sessions.filter((i) => hasSessionOp(i, (op) => op.kind === 'trash')),
    routes.filter((i) => hasRouteOp(i, (op) => op.kind === 'trash')),
    (s, r) => `${both(s, r)} ${agreed(s, r, 'supprimé')} sur le téléphone : dans la corbeille de l'ordinateur pour 30 jours`);
  add('Mis de côté sur le téléphone',
    sessions.filter((i) => hasSessionOp(i, (op) => op.kind === 'removeFromPhone')),
    routes.filter((i) => hasRouteOp(i, (op) => op.kind === 'removeFromPhone')),
    (s, r) => `${both(s, r)} ${agreed(s, r, 'supprimé')} sur l'ordinateur : ${s + r > 1 ? 'retirés' : agreed(s, r, 'retiré')} de la mémoire du téléphone, rangé${s + r > 1 ? 's' : r === 0 ? 'e' : ''} dans son dossier Documents/Tracker-corbeille (rien n'y est effacé)`);
  add('Restauré',
    sessions.filter((i) => i.restored === true),
    routes.filter((i) => i.restored === true),
    (s, r) => `${both(s, r)} ${s + r > 1 ? 'sortis' : agreed(s, r, 'sorti')} de la corbeille : de nouveau sur les deux appareils`);
  const [keptS, keptR] = [outcome.kept.sessions.length, outcome.kept.routes.length];
  if (keptS + keptR > 0) {
    rows.push({
      label: 'Gardé',
      text: `${both(keptS, keptR)} ${keptS + keptR > 1 ? 'gardés' : agreed(keptS, keptR, 'gardé')} : remis là où il en manquait`,
      names: [...outcome.kept.sessions.map((startMs) => outcomeSessionName(outcome, startMs)), ...outcome.kept.routes.map((id) => outcome.names.routes[id] ?? id)],
    });
  }
  const settings = outcome.extras.done.filter((op) => op.kind === 'settings').length;
  if (settings > 0) rows.push({ label: 'Réglages', text: `${plural(settings, 'fichier')} de réglages recopié${settings > 1 ? 's' : ''}, sans rien changer aux réglages de chaque appareil`, names: [] });
  if (outcome.extras.done.some((op) => op.kind === 'restingHr')) rows.push({ label: 'FC repos', text: 'Tests de FC repos mis en commun', names: [] });
  const journals = outcome.extras.copied.length;
  if (journals > 0) rows.push({ label: 'Journaux', text: journals > 1 ? `${journals} journaux d'enregistrement copiés vers l'ordinateur` : "1 journal d'enregistrement copié vers l'ordinateur", names: [] });
  return rows;
};

/** Ce qui n'a pas été fait, ce qui attend, les conflits et qui l'a emporté. */
const exceptionNotes = (outcome: SyncOutcome): string[] => {
  const notes: string[] = [];
  const items = outcome.plan?.items ?? [];
  const routeItems = outcome.routes.plan?.items ?? [];
  for (const item of outcome.done.filter((i) => i.conflicts.length > 0)) {
    const labels = conflictLabels(item.conflicts);
    const winner = Object.values(item.conflictWinners ?? {}).includes('phone') ? 'du téléphone' : "de l'ordinateur";
    notes.push(`« ${outcomeSessionName(outcome, item.startMs)} » : ${labels.join(', ')} changé${labels.length > 1 ? 's' : ''} sur les deux appareils. La version ${winner} a été gardée sur les deux.`);
  }
  for (const item of outcome.routes.done.filter((i) => i.conflict && hasRouteOp(i, (op) => op.kind === 'copy'))) {
    notes.push(`Itinéraire « ${outcomeRouteName(outcome, item)} » changé sur les deux appareils : le plus récent a été gardé, l'autre est dans la corbeille de l'ordinateur (30 jours).`);
  }
  if (outcome.deletions === 'excluded' && outcome.withheldDeletions.length + outcome.routes.withheldDeletions.length > 0) {
    const [s, r] = [outcome.withheldDeletions.length, outcome.routes.withheldDeletions.length];
    notes.push(`Rien n'a été supprimé : ${both(s, r)} supprimé${s + r > 1 ? 's' : r === 0 ? 'e' : ''} sur un appareil ${s + r > 1 ? 'sont' : 'est'} encore sur l'autre. La question reviendra à la prochaine synchronisation.`);
  } else if (outcome.deletions === 'awaitingConfirmation') {
    const [s, r] = [outcome.withheldDeletions.length, outcome.routes.withheldDeletions.length];
    notes.push(`Rien n'a été supprimé : ${both(s, r)} à retirer attend${s + r > 1 ? 'ent' : ''} votre accord.`);
  }
  const unfinishedOn = (side: SyncSideName): number =>
    items.filter((i) => i.left !== null && UNFINISHED.includes(i.left) && i.files[side] !== null && i.files[otherSyncSide(side)] === null).length
    + (outcome.plan?.unknown.filter((u) => u.side === side && UNFINISHED.includes(u.reason)).length ?? 0);
  const unfinishedPhone = unfinishedOn('phone');
  if (unfinishedPhone > 0) notes.push(`${plural(unfinishedPhone, 'session')} du téléphone pas encore finie${unfinishedPhone > 1 ? 's' : ''} de ranger : elle${unfinishedPhone > 1 ? 's viendront' : ' viendra'} la prochaine fois.`);
  const unfinishedComputer = unfinishedOn('computer');
  if (unfinishedComputer > 0) notes.push(`${plural(unfinishedComputer, 'session')} de l'ordinateur pas encore finie${unfinishedComputer > 1 ? 's' : ''} de ranger : elle${unfinishedComputer > 1 ? 's partiront' : ' partira'} la prochaine fois.`);
  const changedGpx = items.filter((i) => i.left === 'changedGpx').length;
  if (changedGpx > 0) notes.push(`${plural(changedGpx, 'session')} laissée${changedGpx > 1 ? 's' : ''} de côté : sa trace n'est plus la même sur les deux appareils. Rien n'est choisi à votre place.`);
  const future = items.filter((i) => i.left === 'futureRecord').length + routeItems.filter((i) => i.left === 'newer').length;
  if (future > 0) notes.push(`${future} élément${future > 1 ? 's' : ''} d'une version plus récente de Tracker : laissé${future > 1 ? 's' : ''} tel${future > 1 ? 's' : ''} quel${future > 1 ? 's' : ''}. Installez la dernière version de ce programme.`);
  const inTrash = items.filter((i) => i.left === 'inTrash').length + routeItems.filter((i) => i.left === 'inTrash').length;
  if (inTrash > 0) notes.push(`${inTrash} élément${inTrash > 1 ? 's' : ''} dans la corbeille de l'ordinateur et encore sur le téléphone : laissé${inTrash > 1 ? 's' : ''} sur le téléphone, ni ramené${inTrash > 1 ? 's' : ''} ni retiré${inTrash > 1 ? 's' : ''}.`);
  notes.push(...draftNotes(outcome));
  const leftovers = outcome.cut - outcome.withheldDeletions.length - outcome.routes.withheldDeletions.length
    - (outcome.phoneWritable ? 0 : outcome.withheldForPhone.length + outcome.routes.withheldForPhone.length);
  if (leftovers > 0) {
    notes.push(outcome.deletions === 'excluded'
      ? "Rien n'a été supprimé : des restes de sessions déjà supprimées attendent d'être retirés. Ils le seront quand vous accepterez les retraits."
      : `${leftovers > 1 ? `${leftovers} éléments n'ont` : "1 élément n'a"} pas pu être traité${leftovers > 1 ? 's' : ''} entièrement cette fois : la prochaine synchronisation s'en chargera.`);
  }
  const [skipped, skippedRoutes] = [outcome.skipped.length, outcome.routes.skipped.length];
  if (skipped + skippedRoutes > 0) notes.push(`${both(skipped, skippedRoutes)} ${skipped + skippedRoutes > 1 ? 'changeaient' : 'changeait'} pendant la synchronisation : ${skipped + skippedRoutes > 1 ? 'ils passeront' : 'il passera'} la prochaine fois.`);
  if (outcome.keptFromPhone.length > 0) notes.push(`${plural(outcome.keptFromPhone.length, 'copie')} du téléphone mise${outcome.keptFromPhone.length > 1 ? 's' : ''} aussi dans la corbeille de l'ordinateur avant d'être retirée${outcome.keptFromPhone.length > 1 ? 's' : ''} : rien n'est perdu.`);
  const unknown = outcome.unknownActivities.filter((u) => u.side === 'computer').length;
  if (unknown > 0) notes.push(`${plural(unknown, 'session')} d'une activité que cet ordinateur n'a pas : elle vous sera demandée à l'ouverture, ou reprenez les réglages du téléphone dans Réglages › Mémoire.`);
  for (const name of new Set(outcome.extras.left.filter((l) => l.reason === 'otherDevice').map((l) => l.path.split('/').pop()?.replace(/\.json$/i, '') ?? l.path))) {
    notes.push(`Deux appareils s'appellent « ${name} » : renommez-en un dans Réglages › Mémoire pour que leurs réglages s'échangent.`);
  }
  if (outcome.extras.left.some((l) => l.reason === 'changed' || l.reason === 'failed')) notes.push("Réglages, FC repos ou journaux n'ont pas tous pu être échangés cette fois : ils le seront à la prochaine.");
  if (!outcome.phoneWritable) notes.push("Ce programme n'a rien pu écrire sur le téléphone : installez sa dernière version.");
  else if (outcome.routes.waiting) notes.push("Les itinéraires n'ont pas été échangés cette fois.");
  if (outcome.failed.length + outcome.routes.failed.length > 0) {
    const n = outcome.failed.length + outcome.routes.failed.length;
    const detail = [...new Set([...outcome.failed, ...outcome.routes.failed].map((f) => f.detail.replace(/\.\s*$/, '')))].join(' ; ');
    notes.push(`${n} élément${n > 1 ? 's' : ''} n'${n > 1 ? 'ont' : 'a'} pas pu être rangé${n > 1 ? 's' : ''} sur l'ordinateur (${detail}).`);
  }
  if (outcome.recordingStarted) {
    notes.push("Un enregistrement a commencé sur le téléphone : la synchronisation s'est arrêtée là. Ce qui est fait est gardé ; le reste se fera à la prochaine.");
  } else if (outcome.linkLost !== null) {
    notes.push(`Le téléphone ne répond plus (${outcome.linkLost.replace(/\.\s*$/, '')}) : la synchronisation s'est arrêtée en route. Ce qui est fait est gardé ; rebranchez-le et cliquez sur « Réessayer ».`);
  } else if (outcome.error !== null) {
    notes.push(`La synchronisation s'est arrêtée (${outcome.error.replace(/\.\s*$/, '')}). Ce qui est fait est gardé.`);
  }
  return notes;
};

/** Une phrase par session laissée parce qu'elle porte un brouillon non enregistré sur l'ordinateur. */
const draftNotes = (outcome: SyncOutcome): string[] =>
  outcome.drafted.map((item) =>
    `« ${outcomeSessionName(outcome, item.startMs)} » a des modifications non enregistrées : elle n'a pas été retirée. Enregistrez-la ou annulez, puis réessayez.`);

/** Le compte rendu d'une synchronisation faite (ou refusée), à montrer à la fin. */
export const describeSyncOutcome = (outcome: SyncOutcome): SyncReport => {
  if (outcome.refusal !== null) return refusalReport(outcome);
  const stopped = outcome.linkLost !== null || outcome.error !== null || outcome.recordingStarted;
  // Incomplète : quelque chose a échoué, a été laissé (changé en route) ou attend un accord.
  const extrasStopped = outcome.extras.left.some((l) => l.reason === 'changed' || l.reason === 'failed');
  const failed = outcome.failed.length + outcome.routes.failed.length > 0;
  const skipped = outcome.skipped.length + outcome.routes.skipped.length + outcome.drafted.length > 0;
  // Des opérations écartées sans être comptées comme retraits (restes d'une session déjà supprimée) : en « sans rien
  // supprimer », la phrase le dit ; sinon la synchronisation est incomplète.
  const uncounted = outcome.cut - outcome.withheldDeletions.length - outcome.routes.withheldDeletions.length
    - (outcome.phoneWritable ? 0 : outcome.withheldForPhone.length + outcome.routes.withheldForPhone.length);
  const incomplete = !stopped && (failed || skipped || extrasStopped || outcome.deletions === 'awaitingConfirmation'
    || (uncounted > 0 && outcome.deletions !== 'excluded'));
  const paragraphs: string[] = [];
  if (outcome.interrupted && !stopped && !incomplete) paragraphs.push("La synchronisation précédente s'était arrêtée en route : elle vient d'être terminée.");
  const rows = gestureRows(outcome);
  const removed = rows.some((row) => row.label === 'Mis à la corbeille' || row.label === 'Mis de côté sur le téléphone');
  if (outcome.first === 'olderCopy' && !removed) {
    paragraphs.push("Le dossier du téléphone est une copie plus ancienne : il a été traité comme un nouveau téléphone, et rien n'a été supprimé. Des sessions supprimées depuis cette copie peuvent revenir : supprimez-les de nouveau si vous n'en voulez plus.");
  } else if (outcome.first !== null && !removed) {
    paragraphs.push("Première synchronisation avec ce téléphone : rien n'a été supprimé, chaque appareil a reçu ce qui lui manquait.");
  }
  if (outcome.safetyCopy) paragraphs.push(`Copie de sécurité des deux dossiers, faite avant toute écriture : ${outcome.safetyCopy}`);
  const notes = exceptionNotes(outcome);
  if (rows.length === 0 && notes.length === 0 && !stopped) paragraphs.push('Les deux appareils étaient déjà à jour.');
  if (outcome.phoneChanged) notes.push('Sur le téléphone, touchez « Mettre à jour » dans Réglages › Mémoire (ou relancez Tracker) pour voir les changements.');
  // Réessayer peut aboutir après une coupure, un échec, ou un élément qui changeait pendant la synchronisation.
  const retry = stopped || failed || skipped || extrasStopped;
  const title = stopped ? 'Synchronisation arrêtée' : incomplete ? 'Synchronisation incomplète' : 'Synchronisation faite';
  return { title, paragraphs, rows, notes, retry };
};

/** Une session nommée dans une question : où elle est, son GPX, et son nom montré. */
export interface SyncOutcomeQuestionSession {
  startMs: number;
  side: SyncSideName;
  file: string;
  label: string;
}

/**
 * Question qu'appelle une issue : `guard`, des suppressions attendent l'accord de l'utilisateur ; `inTrash`, des
 * sessions ou des itinéraires de la corbeille de l'ordinateur sont encore sur le téléphone. `null` sinon.
 */
export interface SyncOutcomeQuestion {
  kind: 'guard' | 'inTrash';
  sessions: SyncOutcomeQuestionSession[];
  routes: SyncQuestionRoute[];
}

export const describeSyncQuestion = (outcome: SyncOutcome): SyncOutcomeQuestion | null => {
  if (outcome.refusal !== null) return null;
  const session = (item: SyncItem, side: SyncSideName): SyncOutcomeQuestionSession => ({
    startMs: item.startMs, side, file: item.files[side] ?? item.files[otherSyncSide(side)] ?? '', label: outcomeSessionName(outcome, item.startMs),
  });
  const route = (item: RouteSyncItem, side: SyncSideName): SyncQuestionRoute => ({ id: item.id, side, label: outcomeRouteName(outcome, item) });
  const withheldRoutes = outcome.routes.withheldDeletions;
  if (outcome.deletions === 'awaitingConfirmation' && outcome.withheldDeletions.length + withheldRoutes.length > 0) {
    return {
      kind: 'guard',
      sessions: outcome.withheldDeletions.map((item) => session(item, item.case === 'deletedOnPhone' ? 'computer' : 'phone')),
      routes: withheldRoutes.map((item) => route(item, item.case === 'deletedOnPhone' ? 'computer' : 'phone')),
    };
  }
  if (!outcome.phoneWritable || outcome.deletions !== 'made' || outcome.linkLost !== null || outcome.error !== null) return null;
  const held = (outcome.plan?.items ?? []).filter((i) => i.left === 'inTrash');
  const heldRoutes = (outcome.routes.plan?.items ?? []).filter((i) => i.left === 'inTrash');
  if (held.length + heldRoutes.length === 0) return null;
  return { kind: 'inTrash', sessions: held.map((item) => session(item, 'phone')), routes: heldRoutes.map((item) => route(item, 'phone')) };
};

// ---------- avant la synchronisation : la confirmation chiffrée ----------

/** Ce qu'un passage à blanc (`SyncOptions.dryRun`) donne à confirmer. */
export interface SyncConfirmation {
  /** « 3 à copier vers le téléphone, 5 vers l'ordinateur, 2 à retirer » ; `null` : rien à faire. */
  counts: string | null;
  /** Les nombres eux-mêmes. */
  numbers: SyncCounts;
  /** Ce que la confirmation dit en plus (première fois, conflits, ce qui attend). */
  notes: string[];
  /** Ce qui serait retiré, à nommer avant d'accepter : sessions et itinéraires, et l'appareil d'où ils partiraient. */
  removals: SyncGuardQuestion;
}

/** La confirmation d'un passage à blanc : les comptes du plan entier permis, suppressions comprises. */
export const describeSyncConfirmation = (preview: SyncOutcome): SyncConfirmation => {
  const plans: SyncPlans = { sessions: preview.plan as SyncPlan, routes: preview.routes.plan, extras: preview.extrasPlan };
  const said = describeSyncPreview(plans, plans, preview.names.sessions);
  const removals: SyncGuardQuestion = {
    sessions: plans.sessions.items.flatMap((i) => {
      const side = syncDeletionSide(i);
      return side === null ? [] : [{ startMs: i.startMs, side, label: sessionName(preview.names.sessions, i.startMs) }];
    }),
    routes: (plans.routes?.items ?? []).filter(isRouteDeletion).map((i) => ({
      id: i.id, side: i.ops.some((op) => op.kind === 'trash') ? 'computer' as const : 'phone' as const, label: preview.names.routes[i.id] ?? routeName(i),
    })),
  };
  // Le garde-fou se confirme ici même : sa phrase n'a pas lieu d'être. Une session à brouillon n'est pas comptée.
  const notes = [...said.notes.filter((note) => !note.startsWith('Cette synchronisation retirerait')), ...draftNotes(preview)];
  return { counts: syncCountsText(said.counts), numbers: said.counts, notes, removals };
};

// ---------- le téléphone pas prêt ----------

/** Pourquoi le téléphone n'a pas pu être lu ni écrit, avant toute synchronisation. */
export type PhoneSyncProblem =
  /** Le téléphone n'est pas prêt ; `count` : nombre d'appareils branchés, pour `plusieurs`. */
  | { kind: 'phone'; state: 'absent' | 'autorisation' | 'horsLigne' | 'occupe' | 'plusieurs'; count?: number }
  /** L'outil de Google qui lit le téléphone manque ; `folder` : où copier son dossier `platform-tools`. */
  | { kind: 'toolMissing'; folder: string }
  /** Pas de dossier `Documents/Tracker` sur le téléphone `phone`. */
  | { kind: 'noPhoneFolder'; phone: string }
  /** La coquille ne sait pas écrire sur le téléphone (programme d'une version plus ancienne que sa page). */
  | { kind: 'cannotWrite' }
  /** Panne imprévue ; `detail` : sa phrase. */
  | { kind: 'error'; detail: string };

/** Les phrases d'un téléphone pas prêt, sans mot technique, avec « Réessayer » et le dossier à recopier s'il y en a un. */
export const describePhoneProblem = (problem: PhoneSyncProblem): SyncReport & { folder: string | null } => {
  const say = (paragraphs: string[], retry = true, folder: string | null = null) => ({ title: 'Téléphone non joint', paragraphs, rows: [], notes: [], retry, folder });
  switch (problem.kind) {
    case 'phone':
      switch (problem.state) {
        case 'absent':
          return say([
            "Aucun téléphone n'est vu. Branchez votre téléphone à l'ordinateur par un câble USB, déverrouillez-le, puis cliquez sur « Réessayer ».",
            'La première fois, il faut aussi activer le « Débogage USB » du téléphone : dans Paramètres, À propos du téléphone, touchez sept fois « Version », puis activez « Débogage USB » dans les options pour les développeurs.',
          ]);
        case 'autorisation':
          return say(["Regardez l'écran du téléphone : il demande « Autoriser le débogage USB ? ». Cochez « Toujours autoriser cet ordinateur », touchez « Autoriser », puis cliquez ici sur « Réessayer »."]);
        case 'horsLigne':
          return say(['Le téléphone est branché mais ne répond pas. Déverrouillez son écran, débranchez puis rebranchez le câble, et cliquez sur « Réessayer ».']);
        case 'plusieurs':
          return say([`Plusieurs appareils sont branchés à l'ordinateur${problem.count ? ` (${problem.count})` : ''}. Ne laissez branché que votre téléphone, fermez un téléphone virtuel s'il y en a un d'ouvert, puis cliquez sur « Réessayer ».`]);
        default:
          return say(['Un autre programme utilise déjà la liaison avec le téléphone (Android Studio, par exemple). Fermez-le, puis cliquez sur « Réessayer ».']);
      }
    case 'toolMissing':
      return say([
        "Pour joindre le téléphone, Tracker a besoin d'un outil gratuit de Google, « SDK Platform-Tools », absent de cet ordinateur.",
        "Téléchargez-le pour Windows sur developer.android.com/tools/releases/platform-tools, ouvrez le fichier .zip, copiez le dossier « platform-tools » qu'il contient dans le dossier ci-dessous, puis cliquez sur « Réessayer ».",
      ], true, problem.folder);
    case 'noPhoneFolder':
      return say([`Le téléphone ${problem.phone} n'a pas de dossier « Documents/Tracker ». Sur le téléphone, ouvrez Tracker, Réglages, Mémoire, et choisissez ce dossier, puis cliquez sur « Réessayer ».`]);
    case 'cannotWrite':
      return say(['Ce programme ne sait pas encore écrire sur le téléphone : installez sa dernière version.'], false);
    case 'error':
      return say([`Le téléphone n'a pas pu être joint (${problem.detail.replace(/\.\s*$/, '')}). Vérifiez le câble, puis cliquez sur « Réessayer ».`]);
  }
};
