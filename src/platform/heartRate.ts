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
 *
 * Une muscu (lot I du 25/10) n'a pas de service GPS pour tenir l'application
 * écran éteint : `keepBeltAlive` démarre un service au premier plan du greffon
 * (`HeartRateService.java`), avec la notification de l'enregistrement.
 *
 * Dans le navigateur, la ceinture d'exemple (`EXAMPLE_BELT`) joue une FC
 * chaque seconde, pour éprouver la muscu au banc ; aucune autre ne s'y connecte.
 */

export interface HeartRateBelt {
  address: string;
  name: string;
  /**
   * Adresse aléatoire (vrai) ou publique (faux), dite par la recherche
   * d'Android 15 et plus ; absente si elle n'est pas connue. Le greffon la
   * cherche de toute façon avant de s'y connecter.
   */
  random?: boolean;
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
 * mesures reçues ; `searching` : pas encore jointe, recherchée de nouveau ;
 * `lost` : connexion perdue, relancée en attendant la ceinture ;
 * `unsupported` : l'appareil n'a pas de fréquence cardiaque.
 */
export type BeltState = 'off' | 'connecting' | 'connected' | 'searching' | 'lost' | 'unsupported';

/** État de la connexion, en clair. */
export const BELT_STATE_LABEL: Record<BeltState, string> = {
  off: 'non connectée',
  connecting: 'connexion…',
  connected: 'connectée',
  searching: 'introuvable pour le moment : portez-la, électrodes humidifiées ; recherche en cours',
  lost: 'perdue, en attente de la ceinture',
  unsupported: "cet appareil ne donne pas de fréquence cardiaque",
};

/** Plugin maison, `android/app/src/main/java/io/github/segneur/tracker/HeartRatePlugin.java`. */
interface HeartRatePlugin {
  availability(): Promise<{ bluetooth: boolean; enabled: boolean; permitted: boolean; permission?: string }>;
  requestPermission(): Promise<{ permission: string }>;
  scan(options: { durationMs: number }): Promise<{ devices: FoundBelt[] }>;
  connect(options: { address: string; name: string; random?: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  openBluetoothSettings(): Promise<void>;
  keepAlive(options: { title: string; text: string }): Promise<void>;
  stopKeepAlive(): Promise<void>;
  addListener(event: 'heartRate', listener: (data: { bpm: number; timeMs: number; contact?: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', listener: (data: { state: BeltState; address?: string; random?: boolean }) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<HeartRatePlugin>('HeartRate');

/** Ceinture d'exemple du navigateur : une FC jouée chaque seconde, sans Bluetooth (banc de la muscu). */
export const EXAMPLE_BELT: HeartRateBelt = { address: 'exemple', name: "FC d'exemple" };

/** FC d'exemple à `tS` secondes de la connexion : de 95 à 135 bpm, une montée par minute. */
const exampleBpm = (tS: number): number => Math.round(115 - 20 * Math.cos((2 * Math.PI * tS) / 60));

/** Minuterie de la ceinture d'exemple, `null` sans elle. */
let exampleTimer: ReturnType<typeof setInterval> | null = null;

/** Vrai dans l'application Android, seule à parler au Bluetooth. */
export const heartRateSupported = (): boolean => isNativeApp();

/** Bluetooth présent et allumé ; dans le navigateur, faux. */
export const bluetoothReady = async (): Promise<boolean> => {
  if (!isNativeApp()) return false;
  const a = await plugin.availability();
  return a.bluetooth && a.enabled;
};

/**
 * État de la permission Bluetooth, tel que Capacitor le donne (`granted`,
 * `denied`, `prompt`…) ; `null` dans le navigateur. Pour la carte « Autorisations » (`platform/permissions.ts`).
 */
export const bluetoothPermission = async (): Promise<string | null> =>
  isNativeApp() ? (await plugin.availability()).permission ?? null : null;

/** Demande la permission Bluetooth ; rend son nouvel état, ou `null` dans le navigateur. */
export const requestBluetoothPermission = async (): Promise<string | null> =>
  isNativeApp() ? (await plugin.requestPermission()).permission : null;

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
  typeof (value as HeartRateBelt).address === 'string' && typeof (value as HeartRateBelt).name === 'string' &&
  ((value as HeartRateBelt).random === undefined || typeof (value as HeartRateBelt).random === 'boolean');

/** Ceinture choisie dans Réglages, ou `null`. */
export const savedBelt = (): HeartRateBelt | null => {
  const value = jsonStore.read<unknown>(BELT_KEY);
  return isBelt(value) ? value : null;
};

/** Retient la ceinture (`null` : l'oublie). */
export const saveBelt = (belt: HeartRateBelt | null): void => jsonStore.write(BELT_KEY, belt);

/** Ouvre les réglages Bluetooth d'Android : le secours d'une ceinture introuvable. */
export const openBluetoothSettings = async (): Promise<void> => {
  if (isNativeApp()) await plugin.openBluetoothSettings();
};

/** Retient le type d'adresse que la recherche du greffon a appris, si la ceinture retenue ne l'avait pas. */
const learnAddressType = (address: string | undefined, random: boolean | undefined): void => {
  const belt = savedBelt();
  if (belt && random !== undefined && belt.random === undefined && belt.address === address) saveBelt({ ...belt, random });
};

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
    plugin.addListener('status', (data) => {
      learnAddressType(data.address, data.random);
      setState(data.state);
    }),
  ]).then(() => undefined);
  return listening;
};

/**
 * Prend la connexion à `belt` sous le nom `holder`. Rend la fonction qui la
 * rend. Lève une erreur si la connexion ne peut pas être demandée
 * (permission refusée, Bluetooth éteint).
 */
export const holdBelt = async (holder: string, belt: HeartRateBelt): Promise<() => void> => {
  if (!isNativeApp()) {
    if (belt.address !== EXAMPLE_BELT.address) throw new Error("Ceinture cardio sur l'application Android seulement.");
    holders.add(holder);
    startExampleBelt();
    return () => releaseBelt(holder);
  }
  await listen();
  const first = holders.size === 0;
  holders.add(holder);
  if (first || state === 'off' || state === 'unsupported') {
    try {
      await plugin.connect({ address: belt.address, name: belt.name, ...(belt.random !== undefined && { random: belt.random }) });
    } catch (err) {
      holders.delete(holder);
      throw err;
    }
  }
  return () => releaseBelt(holder);
};

/** Ceinture d'exemple : connectée tout de suite, une mesure par seconde. */
const startExampleBelt = (): void => {
  if (exampleTimer !== null) return;
  const startMs = Date.now();
  setState('connected');
  const emit = () => {
    const timeMs = Date.now();
    const sample: HeartRateSample = { bpm: exampleBpm((timeMs - startMs) / 1000), timeMs, contact: true };
    latest = sample;
    sampleListeners.forEach((listener) => listener(sample));
  };
  emit();
  exampleTimer = setInterval(emit, 1000);
};

/** Rend la connexion prise sous `holder` ; la dernière rendue la coupe. */
export const releaseBelt = (holder: string): void => {
  if (!holders.delete(holder) || holders.size > 0) return;
  setState('off');
  if (exampleTimer !== null) {
    clearInterval(exampleTimer);
    exampleTimer = null;
    return;
  }
  void plugin.disconnect().catch(() => undefined);
};

/**
 * Garde l'application en vie écran éteint pendant une session sans GPS
 * (muscu) : service au premier plan qui pose la notification de
 * l'enregistrement (`title`, `text`), récrite ensuite par
 * `platform/notification.ts`, et tient le processeur éveillé. Dans le
 * navigateur, rien.
 */
export const keepBeltAlive = async (title: string, text: string): Promise<void> => {
  if (isNativeApp()) await plugin.keepAlive({ title, text });
};

/** Arrête le service de `keepBeltAlive`, et sa notification ; sans effet s'il ne tourne pas. */
export const stopBeltKeepAlive = async (): Promise<void> => {
  if (isNativeApp()) await plugin.stopKeepAlive().catch(() => undefined);
};

/**
 * Coupe une connexion que personne ne tient plus : celle d'un enregistrement
 * dont la page a été rechargée (le greffon, lui, est resté connecté).
 */
export const releaseOrphanedBelt = async (): Promise<void> => {
  if (isNativeApp() && holders.size === 0) {
    await plugin.disconnect().catch(() => undefined);
    await stopBeltKeepAlive();
  }
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
