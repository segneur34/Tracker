import { plural } from '../core/basics';
import { formatSessionDate } from '../core/units';
import { conflictLabels } from './recordMerge';
import { otherSyncSide, type SyncSideName } from './syncBase';
import type { SyncExtrasPlan } from './syncExtras';
import { syncDeletionSide, type SyncItem, type SyncLeftReason, type SyncOp, type SyncPlan } from './syncPlan';
import { isRouteDeletion, syncWholeGuard, type RouteSyncItem, type RouteSyncOp, type RouteSyncPlan } from './syncRoutes';

/**
 * Ce que l'ordinateur dit d'une synchronisation avec le téléphone avant de la faire : combien de sessions et
 * d'itinéraires vont de chaque côté, combien seront retirés, ce qui attend et pourquoi, et les champs changés des deux
 * côtés. En français simple, sans jargon ; pur, tout se lit dans les plans (`syncPlan.ts`, `syncRoutes.ts`,
 * `syncExtras.ts`). Le compte rendu d'après l'exécution (ce qui a été fait, coupé, raté) viendra avec l'exécutant.
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
