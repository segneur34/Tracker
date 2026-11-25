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

/** Marques de Xiaomi, qui ont toutes l'écran du démarrage automatique de MIUI ou HyperOS. */
const XIAOMI_BRANDS = ['xiaomi', 'redmi', 'poco'];

/** Vrai pour un téléphone de Xiaomi (Xiaomi, Redmi, POCO), lu au fabricant ou à la marque, casse ignorée. */
export const isXiaomiDevice = (device: { manufacturer: string; brand: string }): boolean =>
  [device.manufacturer, device.brand].some((name) => XIAOMI_BRANDS.includes(name.trim().toLowerCase()));

/**
 * La ligne « Démarrage automatique » n'a lieu que sur un Xiaomi (lot 232, d'après Gtracker 408 et 419) ; aucun état
 * n'en est lu, Android ne le dit pas de façon sûre.
 */
export const showsAutostart = (device: { manufacturer: string; brand: string } | null): boolean =>
  device !== null && isXiaomiDevice(device);

/** Batterie restreinte : l'optimisation d'Android peut couper l'enregistrement ; faux tant que l'état n'est pas lu. */
export const batteryRestricted = (status: PermissionsStatus | null): boolean => status?.battery === 'denied';

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
