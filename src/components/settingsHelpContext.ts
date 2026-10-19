import { createContext, useContext } from 'react';

/**
 * État des aides de Réglages (`SettingsHelp.tsx`) : la clé de l'aide ouverte, une
 * seule à la fois. Absent hors de Réglages.
 */
export interface HelpState {
  openKey: string | null;
  toggle: (key: string) => void;
  /** Nombre d'appuis sur « Tout réduire » : un dépliant local (choix d'icône) ouvert avant le dernier est replié. */
  collapsed: number;
  /** « Tout réduire » : ferme l'aide ouverte et replie les dépliants locaux. */
  collapseAll: () => void;
}

export const SettingsHelpContext = createContext<HelpState | null>(null);

/** Vrai dans Réglages : les textes y passent sous un « ? ». */
export function useInSettingsHelp(): boolean {
  return useContext(SettingsHelpContext) !== null;
}

/** Repère du dernier « Tout réduire » de Réglages ; 0 hors de Réglages. */
export function useSettingsCollapsed(): number {
  return useContext(SettingsHelpContext)?.collapsed ?? 0;
}

/** Le « Tout réduire » des aides et dépliants locaux de Réglages ; sans effet hors de Réglages. */
export function useSettingsCollapseAll(): () => void {
  return useContext(SettingsHelpContext)?.collapseAll ?? noop;
}

const noop = () => {};

/** L'aide `key` : ouverte ou non, et son bouton ; `null` hors de Réglages. */
export function useSettingsHelp(key: string): { open: boolean; toggle: () => void } | null {
  const state = useContext(SettingsHelpContext);
  if (state === null) return null;
  return { open: state.openKey === key, toggle: () => state.toggle(key) };
}
