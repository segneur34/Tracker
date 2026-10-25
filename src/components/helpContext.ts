import { createContext, useContext } from 'react';

/**
 * État des aides « ? » de l'application (`Help.tsx`) : la clé de l'aide ouverte,
 * une seule à la fois sur la page. Posé à la racine (`AppShell`).
 */
export interface HelpState {
  openKey: string | null;
  toggle: (key: string) => void;
  /** Nombre d'appuis sur « Tout réduire » de Réglages : un dépliant local (choix d'icône) ouvert avant le dernier est replié. */
  collapsed: number;
  /** « Tout réduire » : ferme l'aide ouverte et replie les dépliants locaux. */
  collapseAll: () => void;
}

export const HelpContext = createContext<HelpState | null>(null);

/** Vrai dans la page Réglages, posé par `SettingsScope` : les blocs communs y prennent leur disposition de Réglages. */
export const SettingsScopeContext = createContext(false);

/** Vrai dans Réglages : mémoire et autorisations y gardent leur disposition détaillée. */
export function useInSettings(): boolean {
  return useContext(SettingsScopeContext);
}

/** Repère du dernier « Tout réduire » de Réglages ; 0 sans fournisseur. */
export function useHelpCollapsed(): number {
  return useContext(HelpContext)?.collapsed ?? 0;
}

/** Le « Tout réduire » des aides et dépliants locaux ; sans effet sans fournisseur. */
export function useHelpCollapseAll(): () => void {
  return useContext(HelpContext)?.collapseAll ?? noop;
}

const noop = () => {};

/** L'aide `key` : ouverte ou non, et son bouton ; `null` sans fournisseur. */
export function useHelp(key: string): { open: boolean; toggle: () => void } | null {
  const state = useContext(HelpContext);
  if (state === null) return null;
  return { open: state.openKey === key, toggle: () => state.toggle(key) };
}
