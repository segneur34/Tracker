import type { BeltState } from '../platform/heartRate';

/**
 * Boutons de secours de la ceinture cardio et du GPS sur la page Enregistrer (lot 232, d'après Gtracker 387) : ce que
 * la page propose selon l'état. Aucun ne touche à la trace, au fichier des capteurs ni à la notification ; ils ne font
 * que relancer, abandonner ou reprendre la ceinture de la session, ou demander au téléphone de hâter sa position.
 */

/**
 * Ceinture de la session laissée de côté pendant l'enregistrement : `failed`, injoignable (Bluetooth éteint,
 * permission refusée, au départ ou à une reprise) ; `stopped`, l'utilisateur a cessé de la chercher ; `null` sinon.
 */
export type BeltAside = 'failed' | 'stopped' | null;

export interface BeltRetryInput {
  /** Vrai pendant l'enregistrement, en cours ou en pause (ni au démarrage, ni à l'arrêt). */
  active: boolean;
  /**
   * Session à positions : sans position (muscu, FC de nuit), la séance se fait avec la ceinture, on ne renonce pas à
   * elle ; seul « Réessayer » est proposé.
   */
  withPositions: boolean;
  /** Ceinture tenue par l'enregistrement : état de la connexion ; `null` sans ceinture tenue. */
  heartRate: { state: BeltState } | null;
  /** Alerte de FC perdue en cours. */
  beltLost: boolean;
  beltAside: BeltAside;
}

export interface BeltRetryOffer {
  /** « Réessayer » : une tentative tout de suite, sans attendre la suivante du téléphone. */
  retry: boolean;
  /** « Arrêter de chercher » : l'enregistrement continue sans cardio, l'alerte se tait. */
  stop: boolean;
  /** « Reprendre la ceinture », après l'avoir laissée. */
  retake: boolean;
}

const NONE: BeltRetryOffer = { retry: false, stop: false, retake: false };

/** États d'une ceinture tenue que le téléphone n'a pas jointe : un nouvel essai peut devancer le sien. */
const UNJOINED: readonly BeltState[] = ['connecting', 'searching', 'lost', 'off'];

/**
 * Boutons de la ceinture pendant l'enregistrement. Jointe sans mesure (alerte de FC perdue, ceinture décollée) :
 * seulement l'abandon, une liaison établie n'ayant rien à relancer. Appareil sans fréquence cardiaque : l'abandon
 * aussi. Laissée de côté : la reprendre, ou, injoignable, réessayer ou retirer le message. Sans position, ni abandon
 * ni reprise : « Réessayer » seulement, ceinture pas jointe.
 */
export const beltRetryOffer = (input: BeltRetryInput): BeltRetryOffer => {
  if (!input.active) return NONE;
  if (!input.withPositions) {
    return input.heartRate !== null && UNJOINED.includes(input.heartRate.state) ? { retry: true, stop: false, retake: false } : NONE;
  }
  if (input.beltAside === 'stopped') return { retry: false, stop: false, retake: true };
  if (input.beltAside === 'failed') return { retry: true, stop: true, retake: false };
  if (input.heartRate === null) return NONE;
  const { state } = input.heartRate;
  if (UNJOINED.includes(state)) return { retry: true, stop: true, retake: false };
  if (state === 'unsupported' || input.beltLost) return { retry: false, stop: true, retake: false };
  return NONE;
};

/** Les boutons se montrent aussi sous l'alerte rouge quand elle parle de la ceinture (FC perdue, ceinture injoignable). */
export const beltRetryUnderAlert = (input: BeltRetryInput): boolean => {
  if (!input.active || !(input.beltLost || input.beltAside === 'failed')) return false;
  const offer = beltRetryOffer(input);
  return offer.retry || offer.stop || offer.retake;
};

/**
 * Avant le départ, ceinture cochée : « Réessayer » après un échec de la connexion (`failed`), ou pendant qu'elle est
 * encore cherchée.
 */
export const warmupRetryShown = (state: BeltState, failed: boolean): boolean =>
  failed || state === 'connecting' || state === 'searching' || state === 'lost';

/** Durée de « nouvelle tentative… » après un appui sur « Réessayer » du GPS, en millisecondes : un retour visible. */
export const GPS_RETRY_FEEDBACK_MS = 5_000;

export interface GpsRetryInput {
  /** Vrai pendant l'enregistrement, en cours ou en pause (ni au démarrage, ni à l'arrêt). */
  active: boolean;
  /** Pause manuelle en cours : le GPS reste allumé pour la carte, rien n'attend de position. */
  manualPause: boolean;
  /** Aucune position reçue depuis le départ (ou depuis une reprise). */
  awaitingFix: boolean;
  /**
   * Des positions viennent, mais aucune n'est encore assez précise pour commencer la trace (`judgeSettle`) : le GPS
   * se cale. Une position est venue, il n'y a rien à relancer.
   */
  settling: boolean;
  /** Alerte « GPS perdu » en cours. */
  gpsLost: boolean;
  /** Localisation du téléphone coupée, dite par la source. */
  locationOff: boolean;
}

export interface GpsRetryOffer {
  /** « Réessayer » : le téléphone recharge ses données d'aide au GPS, sans rien arrêter. */
  retry: boolean;
  /** « Activer la localisation » : le réglage de la localisation d'Android. */
  openSettings: boolean;
  /** Boutons posés sous l'alerte rouge, qui dit déjà la panne ; sinon sous la ligne d'état. */
  underAlert: boolean;
  /** « en attente de la première position » écrit à côté, faute d'alerte qui le dise. */
  waiting: boolean;
  /** « le GPS se cale » écrit à la place de l'attente, sans bouton : des positions viennent déjà. */
  settling: boolean;
}

const NO_GPS_OFFER: GpsRetryOffer = { retry: false, openSettings: false, underAlert: false, waiting: false, settling: false };

/**
 * Boutons du GPS pendant l'enregistrement. Localisation coupée : seulement le réglage d'Android, sous l'alerte qui le
 * dit, pause manuelle comprise (rien ne viendra sans elle). Sinon, hors pause manuelle : « Réessayer » sous l'alerte
 * « GPS perdu », ou sous la ligne d'état tant qu'aucune position n'est venue ; pendant le calage du départ, le calage
 * écrit seul, à la même place. Une seule ligne à la fois : l'alerte prime sur l'attente, l'attente sur le calage.
 */
export const gpsRetryOffer = (input: GpsRetryInput): GpsRetryOffer => {
  if (!input.active) return NO_GPS_OFFER;
  if (input.locationOff) return { ...NO_GPS_OFFER, openSettings: true, underAlert: true };
  if (input.manualPause) return NO_GPS_OFFER;
  if (input.gpsLost) return { ...NO_GPS_OFFER, retry: true, underAlert: true };
  if (input.awaitingFix) return { ...NO_GPS_OFFER, retry: true, waiting: true };
  if (input.settling) return { ...NO_GPS_OFFER, settling: true };
  return NO_GPS_OFFER;
};
