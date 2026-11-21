import { Capacitor } from '@capacitor/core';
import { desktopBridge } from './desktopBridge';

/**
 * Vrai dans l'application Android, faux dans un navigateur et dans le programme Windows. Chaque module de
 * `platform/` choisit sa version d'après cette question : sur le PC, l'application ne voit jamais le téléphone.
 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * Vrai dans le programme Windows, qui tient le dossier mémoire sur le disque (`desktopBridge.ts`). Seule la mémoire
 * en dépend : les autres modules de `platform/` y prennent leur version navigateur.
 */
export const isDesktopApp = (): boolean => !isNativeApp() && desktopBridge() !== null;

/** Où tourne l'application : un navigateur, le téléphone ou le programme Windows. */
export type AppShell = 'navigateur' | 'telephone' | 'ordinateur';

export const appShell = (): AppShell => (isNativeApp() ? 'telephone' : isDesktopApp() ? 'ordinateur' : 'navigateur');
