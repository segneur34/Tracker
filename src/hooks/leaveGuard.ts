import { useEffect } from 'react';

/**
 * Avertissement avant de quitter une page qui a des modifications non
 * enregistrées (le brouillon d'une session, `useSessionDraft`).
 *
 * Le routeur de l'application (`BrowserRouter`) ne sait pas bloquer une
 * navigation. On intercepte donc, en amont de React, les clics sur les liens
 * internes (barre de navigation, retour de l'en-tête), la touche retour
 * d'Android (`installBackButton`), et la fermeture ou le rechargement de
 * l'onglet. Le retour arrière du navigateur, lui, passe : le brouillon est
 * alors retrouvé en revenant sur la session.
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
};

/** Pose l'avertissement tant que `warning` n'est pas `null` et que la page est affichée. */
export const useLeaveWarning = (warning: LeaveWarning | null): void => {
  const message = warning?.message ?? null;
  const discard = warning?.discard;
  useEffect(() => {
    if (message === null || !discard) return;
    const own: LeaveWarning = { message, discard };
    current = own;
    return () => {
      if (current === own) current = null;
    };
  }, [message, discard]);
};
