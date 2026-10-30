import { useEffect } from 'react';
import { isNativeApp } from '../platform/runtime';

/**
 * Avertissement avant de quitter une page qui a des modifications non
 * enregistrées (le brouillon d'une session, `useSessionDraft`).
 *
 * Le routeur de l'application (`BrowserRouter`) ne sait pas bloquer une
 * navigation. On intercepte donc, en amont de React, les clics sur les liens
 * internes (barre de navigation, retour de l'en-tête), la touche retour
 * d'Android (`installBackButton`), la fermeture ou le rechargement de
 * l'onglet, et le retour arrière du navigateur (`createHistoryGuard`).
 */

interface LeaveWarning {
  message: string;
  /** Appelé si l'utilisateur accepte de partir : le brouillon est abandonné. */
  discard: () => void;
}

let current: LeaveWarning | null = null;

/** Vrai si l'on peut partir : rien en attente, ou l'utilisateur l'accepte. */
export const confirmLeave = (): boolean => {
  if (current === null) return true;
  if (!window.confirm(current.message)) return false;
  const { discard } = current;
  current = null;
  discard();
  return true;
};

/** Ce que la garde de l'historique demande au navigateur (injecté pour le test). */
export interface HistoryPort {
  /** Empile une entrée « garde » sur l'adresse courante (même état de routeur, marque en plus). */
  pushGuard: () => void;
  /** Recule d'une entrée. */
  back: () => void;
  /** L'entrée courante est-elle une garde ? */
  onGuard: () => boolean;
  /** Adresse courante. */
  href: () => string;
}

/**
 * Retour arrière du navigateur : tant qu'un avertissement est posé, une entrée
 * « garde » est empilée sur la même adresse. Le retour la dépile (le routeur
 * ne bouge pas, l'adresse est la même) : `popstate` demande alors confirmation.
 * Refusé, la garde est remise et l'on reste ; accepté, on recule d'une entrée
 * de plus pour partir vraiment (le brouillon est déjà abandonné par
 * `canLeave`). Levée autrement (Enregistrer, Annuler), la garde est retirée si
 * elle est en tête ; une garde restée dessous (départ par un lien) est
 * traversée sans bruit quand on y revient.
 */
export const createHistoryGuard = (port: HistoryPort, canLeave: () => boolean) => {
  /** Adresse où la garde est posée ; `null` si aucune. */
  let armedAt: string | null = null;
  /** Retours que nous avons demandés et dont le `popstate` n'est pas encore arrivé. */
  let pending = 0;

  return {
    /** Pose la garde (une seule à la fois). */
    arm: (): void => {
      if (armedAt !== null) return;
      armedAt = port.href();
      if (!port.onGuard()) port.pushGuard();
    },
    /** Retire la garde si elle est en tête. */
    disarm: (): void => {
      if (armedAt === null) return;
      armedAt = null;
      if (port.onGuard()) {
        pending += 1;
        port.back();
      }
    },
    /** À appeler sur chaque `popstate`. */
    popstate: (): void => {
      if (pending > 0) {
        pending -= 1;
        // Garde reposée pendant que son retrait était en route : la remettre.
        if (armedAt !== null && !port.onGuard()) port.pushGuard();
        return;
      }
      if (armedAt !== null && port.href() === armedAt) {
        if (port.onGuard()) return;
        if (!canLeave()) {
          port.pushGuard();
          return;
        }
        armedAt = null;
        port.back();
        return;
      }
      // Une garde périmée (restée sous la page quittée par un lien) : on la traverse.
      armedAt = null;
      if (port.onGuard()) port.back();
    },
  };
};

const GUARD_KEY = 'leaveGuard';

const browserHistory: HistoryPort = {
  pushGuard: () => {
    const state: unknown = window.history.state;
    const base = typeof state === 'object' && state !== null ? state : {};
    window.history.pushState({ ...base, [GUARD_KEY]: true }, '', window.location.href);
  },
  back: () => window.history.back(),
  onGuard: () => {
    const state: unknown = window.history.state;
    return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[GUARD_KEY] === true;
  },
  href: () => window.location.href,
};

// Dans l'application Android, le retour passe par `installBackButton`, jamais par l'historique : pas de garde.
const historyGuard = createHistoryGuard(browserHistory, confirmLeave);

/** Lien vers une autre page de l'application, ouvert dans le même onglet. */
const internalLink = (target: EventTarget | null): HTMLAnchorElement | null => {
  const link = target instanceof Element ? target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.origin !== window.location.origin) {
    return null;
  }
  const here = window.location.pathname + window.location.search;
  return link.pathname + link.search === here ? null : link;
};

/** À appeler une fois, au démarrage. */
export const installLeaveGuard = (): void => {
  document.addEventListener(
    'click',
    (event) => {
      if (current === null || !internalLink(event.target)) return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );
  window.addEventListener('beforeunload', (event) => {
    if (current !== null) event.preventDefault();
  });
  if (!isNativeApp()) window.addEventListener('popstate', historyGuard.popstate);
};

/**
 * Retire la garde de l'historique si plus rien n'est à garder. Différé d'un
 * tour : un départ par un lien navigue juste après la confirmation (la garde
 * n'est alors plus en tête, rien à reculer), et un avertissement reposé tout de
 * suite (message changé) garde la sienne.
 */
const releaseHistory = (): void => {
  if (isNativeApp()) return;
  setTimeout(() => {
    if (current === null) historyGuard.disarm();
  }, 0);
};

/** Pose l'avertissement tant que `warning` n'est pas `null` et que la page est affichée. */
export const useLeaveWarning = (warning: LeaveWarning | null): void => {
  const message = warning?.message ?? null;
  const discard = warning?.discard;
  useEffect(() => {
    if (message === null || !discard) return;
    const own: LeaveWarning = { message, discard };
    current = own;
    if (!isNativeApp()) historyGuard.arm();
    return () => {
      // `current` peut déjà être vidé (départ accepté) : la garde, elle, se retire quand même.
      if (current === own) current = null;
      releaseHistory();
    };
  }, [message, discard]);
};
