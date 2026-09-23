import { Capacitor } from '@capacitor/core';

/**
 * Vrai dans l'application Android, faux dans un navigateur. Chaque module de
 * `platform/` choisit sa version d'après cette seule question : sur le PC,
 * l'application ne voit jamais le téléphone.
 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
