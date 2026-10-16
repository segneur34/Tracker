import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './runtime';
import { jsonStore } from './storage';

/**
 * Ceinture cardio Bluetooth : seul passage autorisé vers elle (règle 12). Sur
 * le téléphone, le greffon maison `HeartRate`
 * (`android/…/HeartRatePlugin.java`) la cherche, s'y connecte par le service
 * standard de fréquence cardiaque et livre chaque mesure. Dans le navigateur,
 * rien.
 *
 * La connexion est partagée : Réglages (essai de la ceinture) et
 * l'enregistreur la prennent chacun sous leur nom (`holdBelt`) et la rendent ;
 * elle tombe quand plus personne ne la tient. La ceinture choisie est retenue
 * sur l'appareil, pas dans les réglages recopiés dans le dossier mémoire :
 * c'est un objet à portée de ce téléphone.
 */

export interface HeartRateBelt {
  address: string;
  name: string;
}

export interface FoundBelt extends HeartRateBelt {
  /** Force du signal, en dBm : plus proche de 0, plus près. */
  rssi: number;
}

export interface HeartRateSample {
  bpm: number;
  /** Instant de réception, à l'horloge du téléphone, en millisecondes. */
  timeMs: number;
  /** Contact avec la peau ; `null` si la ceinture ne sait pas le dire. */
  contact: boolean | null;
}

/**
 * `off` : pas de connexion ; `connecting` : premier essai ; `connected` :
 * mesures reçues ; `lost` : connexion perdue, relancée en attendant la
 * ceinture ; `unsupported` : l'appareil n'a pas de fréquence cardiaque.
 */
export type BeltState = 'off' | 'connecting' | 'connected' | 'lost' | 'unsupported';

/** État de la connexion, en clair. */
export const BELT_STATE_LABEL: Record<BeltState, string> = {
  off: 'non connectée',
  connecting: 'connexion…',
  connected: 'connectée',
  lost: 'perdue, en attente de la ceinture',
  unsupported: "cet appareil ne donne pas de fréquence cardiaque",
};

/** Plugin maison, `android/app/src/main/java/io/github/segneur/tracker/HeartRatePlugin.java`. */
interface HeartRatePlugin {
  availability(): Promise<{ bluetooth: boolean; enabled: boolean; permitted: boolean }>;
  scan(options: { durationMs: number }): Promise<{ devices: FoundBelt[] }>;
  connect(options: { address: string; name: string }): Promise<void>;
  disconnect(): Promise<void>;
  addListener(event: 'heartRate', listener: (data: { bpm: number; timeMs: number; contact?: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', listener: (data: { state: BeltState }) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<HeartRatePlugin>('HeartRate');

/** Vrai dans l'application Android, seule à parler au Bluetooth. */
export const heartRateSupported = (): boolean => isNativeApp();

/** Bluetooth présent et allumé ; dans le navigateur, faux. */
export const bluetoothReady = async (): Promise<boolean> => {
  if (!isNativeApp()) return false;
  const a = await plugin.availability();
  return a.bluetooth && a.enabled;
};

/** Ceintures à portée, cherchées pendant `durationMs` ; la plus proche en tête. */
export const scanBelts = async (durationMs = 6000): Promise<FoundBelt[]> => {
  if (!isNativeApp()) return [];
  const { devices } = await plugin.scan({ durationMs });
  return [...devices].sort((a, b) => b.rssi - a.rssi);
};

// --- Ceinture retenue ---

const BELT_KEY = 'tracker.heartRateBelt';

const isBelt = (value: unknown): value is HeartRateBelt =>
  typeof value === 'object' && value !== null &&
  typeof (value as HeartRateBelt).address === 'string' && typeof (value as HeartRateBelt).name === 'string';

/** Ceinture choisie dans Réglages, ou `null`. */
export const savedBelt = (): HeartRateBelt | null => {
  const value = jsonStore.read<unknown>(BELT_KEY);
  return isBelt(value) ? value : null;
};

/** Retient la ceinture (`null` : l'oublie). */
export const saveBelt = (belt: HeartRateBelt | null): void => jsonStore.write(BELT_KEY, belt);

// --- Connexion partagée ---

let state: BeltState = 'off';
let latest: HeartRateSample | null = null;
const holders = new Set<string>();
const sampleListeners = new Set<(sample: HeartRateSample) => void>();
const stateListeners = new Set<(state: BeltState) => void>();
let listening: Promise<void> | null = null;

const setState = (next: BeltState): void => {
  if (next === state) return;
  state = next;
  if (next !== 'connected') latest = null;
  stateListeners.forEach((listener) => listener(next));
};

/** Abonnement unique aux événements du greffon, pris au premier besoin. */
const listen = (): Promise<void> => {
  listening ??= Promise.all([
    plugin.addListener('heartRate', (data) => {
      const sample: HeartRateSample = { bpm: data.bpm, timeMs: data.timeMs, contact: typeof data.contact === 'boolean' ? data.contact : null };
      latest = sample;
      // Une mesure prouve la connexion, même si son annonce s'est perdue.
      setState('connected');
      sampleListeners.forEach((listener) => listener(sample));
    }),
    plugin.addListener('status', (data) => setState(data.state)),
  ]).then(() => undefined);
  return listening;
};

/**
 * Prend la connexion à `belt` sous le nom `holder`. Rend la fonction qui la
 * rend. Lève une erreur si la connexion ne peut pas être demandée
 * (permission refusée, Bluetooth éteint).
 */
export const holdBelt = async (holder: string, belt: HeartRateBelt): Promise<() => void> => {
  if (!isNativeApp()) throw new Error("Ceinture cardio sur l'application Android seulement.");
  await listen();
  const first = holders.size === 0;
  holders.add(holder);
  if (first || state === 'off' || state === 'unsupported') {
    try {
      await plugin.connect({ address: belt.address, name: belt.name });
    } catch (err) {
      holders.delete(holder);
      throw err;
    }
  }
  return () => releaseBelt(holder);
};

/** Rend la connexion prise sous `holder` ; la dernière rendue la coupe. */
export const releaseBelt = (holder: string): void => {
  if (!holders.delete(holder) || holders.size > 0) return;
  setState('off');
  void plugin.disconnect().catch(() => undefined);
};

/**
 * Coupe une connexion que personne ne tient plus : celle d'un enregistrement
 * dont la page a été rechargée (le greffon, lui, est resté connecté).
 */
export const releaseOrphanedBelt = async (): Promise<void> => {
  if (isNativeApp() && holders.size === 0) await plugin.disconnect().catch(() => undefined);
};

/** État de la connexion. */
export const beltState = (): BeltState => state;

/** Nom sous lequel l'enregistreur tient la connexion. */
export const RECORDING_BELT_HOLDER = 'enregistrement';

/** Vrai si `holder` tient la connexion (l'enregistreur, `RECORDING_BELT_HOLDER`, par exemple). */
export const beltHeldBy = (holder: string): boolean => holders.has(holder);

/** Dernière mesure reçue depuis la connexion, ou `null`. */
export const latestHeartRate = (): HeartRateSample | null => latest;

/** Chaque mesure reçue ; rend le désabonnement. */
export const subscribeHeartRate = (listener: (sample: HeartRateSample) => void): (() => void) => {
  sampleListeners.add(listener);
  return () => {
    sampleListeners.delete(listener);
  };
};

/** Chaque changement d'état de la connexion ; rend le désabonnement. */
export const subscribeBeltState = (listener: (state: BeltState) => void): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};
