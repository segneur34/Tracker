import { registerPlugin } from '@capacitor/core';
import type { PermissionKey, PermissionState, PermissionsStatus } from '../recording/permissionsPrompt';
import { bluetoothPermission, requestBluetoothPermission } from './heartRate';
import { isNativeApp } from './runtime';
import { jsonStore } from './storage';

/**
 * Autorisations du téléphone : seul passage autorisé vers elles (règle 12),
 * pour la carte « Autorisations » (accueil et Réglages). Sur le téléphone, la
 * position et les notifications passent par le greffon du GPS
 * (`@capgo/background-geolocation`), le Bluetooth par celui de la ceinture
 * (`HeartRate`), la batterie et le démarrage automatique par le greffon
 * maison `Permissions` (`android/…/PermissionsPlugin.java`). Dans le
 * navigateur, tout est sans objet et rien n'est demandé.
 */

/** Plugin maison, `android/app/src/main/java/io/github/segneur/tracker/PermissionsPlugin.java`. */
interface PermissionsPlugin {
  batteryStatus(): Promise<{ unrestricted: boolean }>;
  requestUnrestrictedBattery(): Promise<void>;
  openAutostart(): Promise<void>;
  openAppSettings(): Promise<void>;
}

const plugin = registerPlugin<PermissionsPlugin>('Permissions');

const UNAVAILABLE: PermissionsStatus = { location: 'unavailable', notifications: 'unavailable', battery: 'unavailable', bluetooth: 'unavailable' };

/** État d'une permission Capacitor (`prompt-with-rationale` compris) ramené aux nôtres ; dans le doute, à demander. */
const fromCapacitor = (state: string | undefined): PermissionState =>
  state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';

/**
 * Module du greffon du GPS, chargé à la demande. Jamais le greffon lui-même au
 * bout d'une promesse : la résolution lui demanderait `then`, que Capacitor
 * prend pour une méthode native, et la promesse ne se tiendrait jamais.
 */
const geolocation = () => import('@capgo/background-geolocation');

/** État de chaque autorisation, sans rien demander. Une lecture qui échoue compte comme « à demander ». */
export const readPermissions = async (): Promise<PermissionsStatus> => {
  if (!isNativeApp()) return UNAVAILABLE;
  const [gps, battery, bt] = await Promise.all([
    geolocation().then((g) => g.BackgroundGeolocation.checkPermissions()).catch(() => null),
    plugin.batteryStatus().catch(() => null),
    bluetoothPermission().catch(() => null),
  ]);
  return {
    location: fromCapacitor(gps?.location),
    notifications: fromCapacitor(gps?.notification),
    battery: battery === null ? 'prompt' : battery.unrestricted ? 'granted' : 'denied',
    bluetooth: fromCapacitor(bt ?? undefined),
  };
};

/**
 * Demande une autorisation : la demande système pour la position, les
 * notifications et le Bluetooth ; l'écran système de la batterie, dont on
 * revient par `onAppResume`. Un refus n'est pas une erreur.
 */
export const requestPermission = async (key: PermissionKey): Promise<void> => {
  if (!isNativeApp()) return;
  switch (key) {
    case 'location':
      await (await geolocation()).BackgroundGeolocation.requestPermissions({ permissions: ['location'] });
      return;
    case 'notifications':
      await (await geolocation()).BackgroundGeolocation.requestPermissions({ permissions: ['notification'] });
      return;
    case 'bluetooth':
      await requestBluetoothPermission();
      return;
    case 'battery':
      await plugin.requestUnrestrictedBattery();
  }
};

/** Écran du démarrage automatique (MIUI, HyperOS), sinon les réglages de l'application. */
export const openAutostart = async (): Promise<void> => {
  if (isNativeApp()) await plugin.openAutostart();
};

/** Réglages de l'application : une autorisation refusée pour de bon s'y accorde. */
export const openAppSettings = async (): Promise<void> => {
  if (isNativeApp()) await plugin.openAppSettings();
};

/** Retour au premier plan (après un écran système, par exemple) ; rend le désabonnement. Sans effet dans le navigateur. */
export const onAppResume = (listener: () => void): (() => void) => {
  if (!isNativeApp()) return () => {};
  let removed = false;
  let remove: (() => void) | null = null;
  void import('@capacitor/app').then(async ({ App }) => {
    const handle = await App.addListener('resume', listener);
    if (removed) void handle.remove();
    else remove = () => void handle.remove();
  });
  return () => {
    removed = true;
    remove?.();
  };
};

// --- Version vue en dernier ---

const SEEN_KEY = 'tracker.permissionsSeenVersion';

/** Version de l'application pour laquelle la carte a été vue (« Plus tard » ou tout accordé), ou `null`. */
export const permissionsSeenVersion = (): string | null => {
  const value = jsonStore.read<unknown>(SEEN_KEY);
  return typeof value === 'string' ? value : null;
};

/** Retient la version vue : la carte attend la suivante. */
export const markPermissionsSeen = (version: string): void => jsonStore.write(SEEN_KEY, version);
