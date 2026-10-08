import { registerPlugin } from '@capacitor/core';
import type { JumpPlacement } from '../recording/jumpSettings';
import { privateFileSize, readPrivateBytes, removePrivateFile } from './memoryFolder';
import { isNativeApp } from './runtime';

/**
 * Capteurs du téléphone pendant un enregistrement, pour la mesure des sauts
 * en voile : seul passage autorisé vers eux (règle 12). Sur le téléphone, le
 * greffon maison `Motion` (`android/…/MotionPlugin.java`) écrit accéléromètre
 * et gyroscope bruts dans un fichier privé, `capteurs/<startedAtMs>.imu`
 * (format : `core/imuFile.ts`) ; l'enregistreur le range ensuite à côté du
 * GPX. Dans le navigateur, rien : écran éteint, les capteurs s'y arrêtent.
 */

export interface MotionCapabilities {
  /** Faux sans gyroscope, ou hors de l'application Android. */
  available: boolean;
  /** Pourquoi la mesure n'est pas possible, en clair. */
  reason: string | null;
  /** Plage de l'accéléromètre, en g ; `null` si inconnue. */
  accelMaxG: number | null;
  barometer: boolean;
}

export interface MotionSetup {
  placement: JumpPlacement;
  foil: boolean;
}

/** Capture arrêtée : son fichier privé et ce qu'il faut savoir pour la juger. */
export interface MotionCapture {
  /** Chemin dans le dossier privé de l'application. */
  path: string;
  bytes: number;
  /** Du premier au dernier relevé de l'accéléromètre, en secondes. */
  durationS: number;
  samples: number;
  /** Plus long écart entre deux relevés de l'accéléromètre, en secondes. */
  longestGapS: number;
  /** Dernière erreur d'écriture, s'il y en a eu une. */
  error: string | null;
}

/** Dossier des captures, dans le dossier privé de l'application. */
export const MOTION_DIR = 'capteurs';

/** Fichier de la capture d'un enregistrement, repéré par l'instant de l'en-tête de son journal. */
export const motionCapturePath = (startedAtMs: number): string => `${MOTION_DIR}/${startedAtMs}.imu`;

const STANDARD_G = 9.80665;

/** Plugin maison, `android/app/src/main/java/io/github/segneur/tracker/MotionPlugin.java`. */
interface MotionPlugin {
  capabilities(): Promise<{ accelerometer: boolean; gyroscope: boolean; barometer: boolean; accelMaxRange?: number }>;
  start(options: { startedAtMs: number; placement: JumpPlacement; foil: boolean }): Promise<{ path: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<{ path: string | null; bytes?: number; durationS?: number; samples?: number; longestGapS?: number; error?: string }>;
}

const plugin = registerPlugin<MotionPlugin>('Motion');

const UNAVAILABLE: MotionCapabilities = {
  available: false,
  reason: "Sur l'application Android seulement : écran éteint, le navigateur coupe les capteurs.",
  accelMaxG: null,
  barometer: false,
};

let capabilities: Promise<MotionCapabilities> | null = null;

/** Ce que le téléphone permet ; lu une fois par lancement. */
export const getMotionCapabilities = (): Promise<MotionCapabilities> => {
  if (!isNativeApp()) return Promise.resolve(UNAVAILABLE);
  capabilities ??= plugin.capabilities().then(
    (c): MotionCapabilities => ({
      available: c.accelerometer && c.gyroscope,
      reason: c.accelerometer && c.gyroscope ? null : "Ce téléphone n'a pas de gyroscope : la hauteur des sauts ne peut pas être mesurée.",
      accelMaxG: typeof c.accelMaxRange === 'number' && c.accelMaxRange > 0 ? c.accelMaxRange / STANDARD_G : null,
      barometer: c.barometer,
    }),
    (): MotionCapabilities => ({ ...UNAVAILABLE, reason: 'Capteurs du téléphone illisibles.' })
  );
  return capabilities;
};

/** Démarre la capture d'un enregistrement ; lève une erreur si le téléphone ne le permet pas. */
export const startMotionCapture = async (startedAtMs: number, setup: MotionSetup): Promise<void> => {
  if (!isNativeApp()) throw new Error(UNAVAILABLE.reason ?? 'Capteurs indisponibles.');
  await plugin.start({ startedAtMs, placement: setup.placement, foil: setup.foil });
};

export const pauseMotionCapture = async (): Promise<void> => {
  if (isNativeApp()) await plugin.pause();
};

export const resumeMotionCapture = async (): Promise<void> => {
  if (isNativeApp()) await plugin.resume();
};

/**
 * Arrête la capture en cours et ferme son fichier ; `null` si rien ne
 * tournait. Sert aussi, au démarrage, à fermer une capture restée ouverte
 * après un rechargement de la page.
 */
export const stopMotionCapture = async (): Promise<MotionCapture | null> => {
  if (!isNativeApp()) return null;
  const r = await plugin.stop();
  if (!r.path) return null;
  return {
    path: r.path,
    bytes: r.bytes ?? 0,
    durationS: r.durationS ?? 0,
    samples: r.samples ?? 0,
    longestGapS: r.longestGapS ?? 0,
    error: r.error ?? null,
  };
};

/**
 * Capture laissée par un enregistrement interrompu (application fermée de
 * force), retrouvée par l'instant de l'en-tête de son journal ; `null` s'il
 * n'y en a pas. Sa durée n'est pas connue sans la relire.
 */
export const findMotionCapture = async (startedAtMs: number): Promise<MotionCapture | null> => {
  if (!isNativeApp()) return null;
  const path = motionCapturePath(startedAtMs);
  const bytes = await privateFileSize(path);
  return bytes === null ? null : { path, bytes, durationS: 0, samples: 0, longestGapS: 0, error: null };
};

/** Contenu d'une capture du dossier privé ; `null` si elle n'existe pas. */
export const readMotionCapture = (path: string): Promise<Uint8Array | null> =>
  isNativeApp() ? readPrivateBytes(path) : Promise.resolve(null);

/** Efface une capture du dossier privé, une fois rangée ou jetée. */
export const removeMotionCapture = (path: string): Promise<void> =>
  isNativeApp() ? removePrivateFile(path) : Promise.resolve();
