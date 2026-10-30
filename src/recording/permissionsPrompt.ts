/**
 * Autorisations du téléphone dont l'enregistrement a besoin, et quand les
 * demander d'office (carte « Autorisations » de l'accueil). Pur : l'état vient
 * de `platform/permissions.ts`, la version vue en dernier de l'appareil.
 */

import type { PermissionKey, PermissionState, PermissionsStatus } from '../core/domainTypes';

export type { PermissionKey, PermissionState, PermissionsStatus };

/** Nom de chaque autorisation, en clair. */
export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  location: 'Position',
  notifications: 'Notifications',
  battery: 'Batterie sans restriction',
  bluetooth: 'Bluetooth',
};

/** Position, notifications et batterie toujours ; le Bluetooth seulement si une ceinture est retenue. */
export const requiredPermissions = (beltSaved: boolean): PermissionKey[] =>
  beltSaved ? ['location', 'notifications', 'battery', 'bluetooth'] : ['location', 'notifications', 'battery'];

/** Autorisations requises qui manquent (ni accordées, ni sans objet). */
export const missingPermissions = (status: PermissionsStatus, beltSaved: boolean): PermissionKey[] =>
  requiredPermissions(beltSaved).filter((key) => status[key] !== 'granted' && status[key] !== 'unavailable');

/**
 * Montrer la carte d'office : s'il manque une autorisation requise, au
 * premier lancement (aucune version vue) ou après une mise à jour. « Plus
 * tard » écrit la version vue : la carte attend alors la version suivante.
 */
export const shouldPromptPermissions = (input: {
  seenVersion: string | null;
  appVersion: string;
  status: PermissionsStatus;
  beltSaved: boolean;
}): boolean =>
  input.seenVersion !== input.appVersion && missingPermissions(input.status, input.beltSaved).length > 0;
