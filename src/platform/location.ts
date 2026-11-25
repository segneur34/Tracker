import { finiteOr } from '../core/basics';
import { LOCATION_DENIED_TEXT } from './errorText';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Sources de position : seul point d'accès autorisé au GPS.
 *
 * Trois sources, une même forme : le service de position de l'application
 * sur le téléphone (`RecordingService.java`, par le greffon `Recording`),
 * `watchPosition` dans le navigateur, et un « rejeu » qui relit une trace en
 * accéléré pour éprouver tout l'enregistrement sur le PC. Aucune ne filtre
 * quoi que ce soit : l'intelligence reste dans le pipeline d'analyse
 * (`docs/ETAT_DU_PROJET.md` §12).
 *
 * Le service du téléphone survit à la page (lot 232, étape 2, d'après Gtracker 403) : application balayée hors des
 * applications récentes, moteur de rendu tombé. Il écrit chaque position dans son propre journal
 * (`readLoggedFixes`), que la page relit à son retour (`recording/nativeLog.ts`), et se laisse rejoindre sans être
 * relancé (`attachDeviceLocation`).
 */

/** Position reçue d'une source, en unités SI. */
export interface LocationFix {
  /** Instant de la mesure, en millisecondes depuis l'époque Unix. */
  timeMs: number;
  lat: number;
  lon: number;
  /** Rayon d'incertitude horizontale, en mètres, à 68 %. */
  accuracyM?: number;
  /** Altitude, en mètres. */
  altitudeM?: number;
  /** Vitesse fournie par le système (Doppler sur la plupart des puces), en m/s. */
  speedMs?: number;
  /** Cap fourni par le système, en degrés, 0 = nord, sens horaire. */
  bearingDeg?: number;
  /** Fréquence cardiaque de la ceinture, en battements par minute, jointe par l'enregistreur. */
  heartRateBpm?: number;
  /** Cadence à pied, en pas par minute, mesurée à l'arrêt sur la capture des capteurs (`running/cadence.ts`). */
  cadenceSpm?: number;
}

/**
 * Ce que le service du téléphone doit savoir de la session pour continuer sans la page : son identifiant, ses
 * textes quand l'application est fermée, sa veille du GPS et sa garde. Délais en secondes, rayon en mètres, comme
 * dans `RecordingProfile`, vitesse en m/s ; une valeur nulle ou négative éteint la règle.
 */
export interface ServiceWatchOptions {
  /** Identifiant de la session : le `startedAtMs` de l'en-tête du journal de la page. */
  session: number;
  /** Texte de la notification quand la page n'est plus là. */
  closedText: string;
  /** Titre de la notification pendant une perte du GPS, page absente. */
  gpsLostTitle: string;
  /** Titre et texte de la notification laissée par la garde, quand elle arrête l'enregistrement. */
  stoppedTitle: string;
  stoppedText: string;
  gpsLostDelayS: number;
  gpsLostRearmS: number;
  guardStillRadiusM: number;
  guardStillDelayS: number;
  guardMaxClosedS: number;
  /** Vraie vitesse, en m/s, qui tenue `guardMovingHoldS` relance le compte de la garde sans sortir du rayon. */
  guardMovingSpeedMs: number;
  guardMovingHoldS: number;
}

export interface LocationWatchOptions {
  /** Intervalle demandé entre deux positions, en millisecondes. */
  intervalMs: number;
  /** Déplacement minimal avant une nouvelle position, en mètres. */
  distanceFilterM: number;
  /** Titre et texte de la notification permanente qu'Android exige pendant l'enregistrement. */
  notificationTitle: string;
  notificationText: string;
  /** Pour le service du téléphone, qui ne démarre pas sans ; les autres sources n'en lisent rien. */
  service?: ServiceWatchOptions;
}

/** Arrête la réception des positions. */
export type StopLocation = () => Promise<void>;

/**
 * Cause d'un échec que la page sait traiter, dite par la source elle-même (lot 232) : `'locationOff'`, la
 * localisation du téléphone est coupée (« Activer la localisation »).
 */
export type LocationErrorCause = 'locationOff';

/** Échec de la source : son message, et sa cause quand la page en fait quelque chose. */
export type LocationErrorListener = (message: string, cause?: LocationErrorCause) => void;

export interface LocationSource {
  /** Libellé affiché à l'utilisateur. */
  label: string;
  /**
   * Démarre la réception : `onFix` à chaque position, `onError` quand la
   * source échoue (permission refusée, localisation coupée), avec sa cause
   * quand la page en fait quelque chose, et `onLocationOn` quand la
   * localisation du téléphone, dite coupée, est rendue (service du téléphone
   * seulement). Rend la fonction d'arrêt.
   */
  start(
    options: LocationWatchOptions,
    onFix: (fix: LocationFix) => void,
    onError: LocationErrorListener,
    onLocationOn?: () => void
  ): Promise<StopLocation>;
  /**
   * Service du téléphone seulement : lui dit la pause manuelle ouverte (`paused`) ou levée, à l'heure `atMs` de la
   * ligne que la page vient d'écrire dans son journal. Le GPS reste allumé ; page absente, le service se tait alors
   * sur un GPS perdu, et son journal sait que rien n'est à garder.
   */
  setPaused?(paused: boolean, atMs: number): Promise<void>;
}

/** État du service de position : s'il tourne, pour quelle session, et s'il est en pause manuelle. */
export interface DeviceLocationState {
  running: boolean;
  /** Le `startedAtMs` de l'en-tête du journal de la session suivie ; `null` si rien ne tourne. */
  session: number | null;
  paused: boolean;
}

/** Autorisations que le greffon de l'enregistrement lit et demande. */
export type ServicePermission = 'location' | 'notification';
type ServicePermissions = Record<ServicePermission, string>;

/** Refus ou événement d'erreur du greffon : seul le code se traduit, son message n'est jamais montré. */
interface ServiceError {
  code?: string;
  message?: string;
}

/** Greffon maison, `android/app/src/main/java/io/github/segneur/tracker/RecordingPlugin.java`. */
interface RecordingPlugin {
  start(options: ServiceWatchOptions & { intervalMs: number; distanceFilterM: number; title: string; text: string }): Promise<Partial<DeviceLocationState>>;
  stop(): Promise<void>;
  state(): Promise<Partial<DeviceLocationState>>;
  setPaused(options: { paused: boolean; atMs: number }): Promise<Partial<DeviceLocationState>>;
  readLog(options: { afterMs?: number }): Promise<{ text?: string | null }>;
  clearLog(): Promise<void>;
  currentPosition(options: { timeoutMs: number }): Promise<Partial<LocationFix>>;
  checkPermissions(): Promise<ServicePermissions>;
  requestPermissions(options: { permissions: ServicePermission[] }): Promise<ServicePermissions>;
  addListener(event: 'fix', listener: (fix: Partial<LocationFix>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', listener: (error: ServiceError) => void): Promise<PluginListenerHandle>;
  /** Sans charge : la localisation du téléphone est rendue, le GPS cherche sa position. */
  addListener(event: 'locationEnabled', listener: () => void): Promise<PluginListenerHandle>;
}

const recording = registerPlugin<RecordingPlugin>('Recording');

/** Position telle que le greffon la donne, déjà dans la forme de `LocationFix` ; `null` sans heure ni coordonnées lisibles. */
const fromService = (data: Partial<LocationFix>): LocationFix | null => {
  const timeMs = finiteOr(data.timeMs, null);
  const lat = finiteOr(data.lat, null);
  const lon = finiteOr(data.lon, null);
  if (timeMs === null || lat === null || lon === null) return null;
  return {
    timeMs, lat, lon,
    accuracyM: finiteOr(data.accuracyM, undefined),
    altitudeM: finiteOr(data.altitudeM, undefined),
    speedMs: finiteOr(data.speedMs, undefined),
    bearingDeg: finiteOr(data.bearingDeg, undefined),
  };
};

const LOCATION_UNAVAILABLE = 'Localisation indisponible.';
const LOCATION_DISABLED_TEXT = "Localisation du téléphone coupée : activez-la, l'enregistrement démarre à la première position.";
const POSITION_NOT_FOUND = 'Position introuvable : vérifiez que la localisation est activée.';

/**
 * Refus du greffon rendu en clair, par son code (lot 158) : `NOT_AUTHORIZED` (ou un refus qui dit « denied ») dit où
 * réactiver la localisation ; tout autre refus, qu'elle est indisponible. Le message du téléphone n'est jamais montré.
 */
export const locationErrorText = (error: unknown): string => {
  const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as ServiceError;
  if (code === 'NOT_AUTHORIZED' || (typeof message === 'string' && /denied/i.test(message))) return LOCATION_DENIED_TEXT;
  return LOCATION_UNAVAILABLE;
};

const codeOf = (error: unknown): string | null => {
  const code = typeof error === 'object' && error !== null ? (error as ServiceError).code : undefined;
  return typeof code === 'string' ? code : null;
};

/**
 * Arrêt du service en cours, `null` sinon. Un départ l'attend toujours : le service s'arrête sans numéro de départ,
 * et un `start` envoyé avant la fin de l'arrêt serait détruit après avoir répondu.
 */
let stopping: Promise<void> | null = null;
/** Nombre d'écoutes de la page sur le service : tant qu'il y en a une, il n'est pas orphelin. */
let listeners = 0;

const stopService = (): Promise<void> => {
  const done = recording.stop();
  const settled: Promise<void> = done.then(() => undefined, () => undefined).then(() => {
    if (stopping === settled) stopping = null;
  });
  stopping = settled;
  return done;
};

/**
 * Écoute le service : ses positions, ses erreurs et le retour de la localisation. La page est « là », pour lui,
 * tant qu'elle écoute ses positions : sans écoute, il affiche le texte de l'application fermée, veille seul sur le
 * GPS et arme sa garde. `stop` arrête le service puis retire l'écoute ; `unlisten` ne fait que la retirer.
 */
const listenToService = async (
  onFix: (fix: LocationFix) => void,
  onError: LocationErrorListener,
  onLocationOn?: () => void
): Promise<{ stop: StopLocation; unlisten: () => Promise<void> }> => {
  let stopped = false;
  let counted = false;
  const handles: PluginListenerHandle[] = [];
  const unlisten = async (): Promise<void> => {
    stopped = true;
    if (counted) listeners -= 1;
    counted = false;
    await Promise.all(handles.splice(0).map((handle) => handle.remove().catch(() => undefined)));
  };
  try {
    handles.push(await recording.addListener('fix', (data) => {
      if (stopped) return;
      const fix = fromService(data);
      if (!fix) return;
      try {
        onFix(fix);
      } catch (err) {
        console.warn('Position du service non traitée', err);
      }
    }));
    handles.push(await recording.addListener('error', (error) => {
      if (stopped) return;
      try {
        if (error.code === 'LOCATION_DISABLED') onError(LOCATION_DISABLED_TEXT, 'locationOff');
        // Le journal du service est un filet : sans lui, la page reçoit encore chaque position.
        else if (error.code === 'LOG_FAILED') console.warn('Journal des positions du service en échec');
        else onError(locationErrorText(error));
      } catch (err) {
        console.warn('Erreur du service non traitée', err);
      }
    }));
    handles.push(await recording.addListener('locationEnabled', () => {
      if (stopped) return;
      try {
        onLocationOn?.();
      } catch (err) {
        console.warn('Retour de la localisation non traité', err);
      }
    }));
  } catch (err) {
    await unlisten();
    throw err;
  }
  listeners += 1;
  counted = true;
  let stop: Promise<void> | null = null;
  return {
    unlisten,
    // Un seul arrêt, attendu par tous ceux qui le demandent. L'écoute n'est retirée qu'après : la retirer d'abord
    // ferait croire au service, un instant, que l'application est fermée.
    stop: () => (stop ??= (async () => {
      stopped = true;
      try {
        await stopService();
      } finally {
        await unlisten();
      }
    })()),
  };
};

/**
 * GPS du téléphone, par le service de l'application : au premier plan, avec sa notification, il continue écran
 * éteint et application fermée. La page écoute d'abord, démarre ensuite : le service la sait là dès sa première
 * position. Localisation coupée au démarrage : le service démarre quand même et le dit (`locationOff`), puis dit
 * son retour (`onLocationOn`) ; les positions arrivent seules ensuite. Session déjà en cours : rien n'est relancé.
 */
const nativeSource: LocationSource = {
  label: 'GPS du téléphone',
  start: async (options, onFix, onError, onLocationOn) => {
    const service = options.service;
    if (!service) throw new Error(LOCATION_UNAVAILABLE);
    await stopping;
    const { stop, unlisten } = await listenToService(onFix, onError, onLocationOn);
    try {
      await recording.start({
        ...service,
        intervalMs: options.intervalMs,
        distanceFilterM: options.distanceFilterM,
        title: options.notificationTitle,
        text: options.notificationText,
      });
    } catch (err) {
      // Rien n'a démarré pour cette page : l'écoute seule est retirée, jamais le service d'une autre demande.
      await unlisten();
      throw new Error(locationErrorText(err));
    }
    return stop;
  },
  setPaused: async (paused, atMs) => {
    await recording.setPaused({ paused, atMs });
  },
};

/**
 * GPS du navigateur. Suffit pour éprouver la page sur le PC ; inutilisable
 * pour une vraie session, le navigateur coupant la localisation écran éteint.
 */
const browserSource: LocationSource = {
  label: 'GPS du navigateur',
  start: async (_options, onFix, onError) => {
    if (!('geolocation' in navigator)) {
      onError('Ce navigateur ne donne pas accès à la position.');
      return async () => {};
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          timeMs: p.timestamp,
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracyM: finiteOr(p.coords.accuracy, undefined),
          altitudeM: finiteOr(p.coords.altitude, undefined),
          speedMs: finiteOr(p.coords.speed, undefined),
          bearingDeg: finiteOr(p.coords.heading, undefined),
        }),
      (e) => onError(e.code === e.PERMISSION_DENIED ? LOCATION_DENIED_TEXT : LOCATION_UNAVAILABLE),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    return async () => navigator.geolocation.clearWatch(id);
  },
};

/** Source de position de l'appareil : le service de l'application sur le téléphone, le navigateur ailleurs. */
export const deviceLocationSource = (): LocationSource => (isNativeApp() ? nativeSource : browserSource);

/**
 * Rejeu d'une trace : chaque position est émise quand le temps écoulé depuis
 * le départ, multiplié par `speedFactor`, atteint son écart au premier point.
 * Les heures d'origine sont conservées, si bien qu'une trace rejouée puis
 * enregistrée redonne la même analyse que le fichier de départ. Une minuterie
 * en retard émet d'un coup tout ce qui est échu.
 */
export const createReplaySource = (fixes: LocationFix[], speedFactor: number): LocationSource => ({
  label: `Rejeu ×${speedFactor}`,
  start: async (_options, onFix) => {
    let next = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const firstMs = fixes[0]?.timeMs ?? 0;
    const startedAt = Date.now();

    const tick = () => {
      if (stopped) return;
      const elapsedTrackMs = (Date.now() - startedAt) * speedFactor;
      while (next < fixes.length && fixes[next].timeMs - firstMs <= elapsedTrackMs) {
        onFix(fixes[next]);
        next++;
      }
      if (next < fixes.length) {
        const waitMs = (fixes[next].timeMs - firstMs - elapsedTrackMs) / speedFactor;
        timer = setTimeout(tick, Math.max(0, waitMs));
      }
    };
    tick();

    return async () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  },
});

const NO_SERVICE: DeviceLocationState = { running: false, session: null, paused: false };

/**
 * État du service de position du téléphone, sans rien y changer : la page rechargée ou rouverte sait ainsi s'il a
 * survécu, et pour quelle session. Dans le navigateur, rien ne tourne jamais.
 */
export const deviceLocationState = async (): Promise<DeviceLocationState> => {
  if (!isNativeApp()) return NO_SERVICE;
  const { running, session, paused } = await recording.state();
  return running === true ? { running: true, session: finiteOr(session, null), paused: paused === true } : NO_SERVICE;
};

/**
 * Rebranche la page, rechargée ou rouverte, sur le service de position resté en route, sans jamais le relancer :
 * elle écoute de nouveau ses positions, ses erreurs et le retour de la localisation, et le service la sait revenue.
 * Ce qu'il a reçu entre-temps est dans son journal (`readLoggedFixes`). Rend l'arrêt, qui arrête le service. Lève
 * dans le navigateur, où aucun service ne survit à la page.
 */
export const attachDeviceLocation = async (
  onFix: (fix: LocationFix) => void,
  onError: LocationErrorListener,
  onLocationOn?: () => void
): Promise<StopLocation> => {
  if (!isNativeApp()) throw new Error(LOCATION_UNAVAILABLE);
  await stopping;
  return (await listenToService(onFix, onError, onLocationOn)).stop;
};

/**
 * Journal des positions tenu par le service du téléphone, en texte, à donner à `parseNativeLog` ; `null` sans
 * fichier, et toujours dans le navigateur. `afterMs` : l'heure de la dernière position que le journal de la page
 * porte déjà ; le service ne rend alors que l'en-tête et la fin utile. Lève si le fichier ne se lit pas.
 */
export const readLoggedFixes = async (afterMs: number | null): Promise<string | null> => {
  if (!isNativeApp()) return null;
  const { text } = await recording.readLog(afterMs === null ? {} : { afterMs });
  return typeof text === 'string' ? text : null;
};

/**
 * Efface le journal des positions du service, et la notification laissée par sa garde : à appeler une fois la
 * session rangée ou jetée. Un échec n'est que consigné : le départ suivant remplace ce fichier. Sans effet dans le
 * navigateur.
 */
export const clearLoggedFixes = async (): Promise<void> => {
  if (!isNativeApp()) return;
  try {
    await recording.clearLog();
  } catch (err) {
    console.warn(`Journal des positions du service non effacé (${codeOf(err) ?? 'erreur inconnue'})`);
  }
};

/**
 * Arrête le service de position s'il tourne sans que la page l'écoute : laissé par une session que l'application
 * ne reprend pas. Rend la main une fois son journal fermé, donc relisible en entier. Sans effet dans le navigateur.
 */
export const stopOrphanedDeviceLocation = async (): Promise<void> => {
  if (!isNativeApp() || listeners > 0) return;
  try {
    await stopService();
  } catch {
    // Rien à arrêter.
  }
};

/** Autorisations de position et de notification du téléphone, sans rien demander. Sur le téléphone seulement. */
export const readServicePermissions = (): Promise<ServicePermissions> => recording.checkPermissions();

/** Demande système d'une autorisation du service ; un refus n'est pas une erreur. Sur le téléphone seulement. */
export const requestServicePermission = async (permission: ServicePermission): Promise<void> => {
  await recording.requestPermissions({ permissions: [permission] });
};

/**
 * Vrai si l'accès à la position est déjà accordé, sans jamais le demander :
 * une page peut alors s'en servir d'elle-même (Itinéraires centrée sur soi).
 * Dans le doute, faux.
 */
export const locationPermissionGranted = async (): Promise<boolean> => {
  try {
    if (isNativeApp()) return (await readServicePermissions()).location === 'granted';
    if (!('permissions' in navigator) || !('geolocation' in navigator)) return false;
    return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted';
  } catch {
    return false;
  }
};

/** Une seule position du navigateur : la première que donne `watchPosition`, ou un rejet à l'échéance. */
const browserPosition = (timeoutMs: number): Promise<LocationFix> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stop: StopLocation | null = null;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
      void stop?.();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(POSITION_NOT_FOUND))), timeoutMs);
    browserSource
      .start(
        { intervalMs: 1000, distanceFilterM: 0, notificationTitle: '', notificationText: '' },
        (fix) => finish(() => resolve(fix)),
        (message) => finish(() => reject(new Error(message)))
      )
      .then(
        (stopFn) => {
          stop = stopFn;
          // Position trouvée avant que le démarrage ne rende la main : on arrête tout de suite.
          if (settled) void stopFn();
        },
        (err) => finish(() => reject(err instanceof Error ? err : new Error(LOCATION_UNAVAILABLE)))
      );
  });

/**
 * Une seule position, pour centrer une carte (page Itinéraires). Sur le
 * téléphone, le GPS est écouté le temps de la trouver, sans service ni
 * notification, pendant un enregistrement compris. Rejette, en clair, si
 * elle n'est pas trouvée avant `timeoutMs`, si la localisation est coupée ou
 * si l'autorisation est refusée.
 */
export const currentPosition = async (timeoutMs = 30_000): Promise<LocationFix> => {
  if (!isNativeApp()) return browserPosition(timeoutMs);
  let found: Partial<LocationFix>;
  try {
    found = await recording.currentPosition({ timeoutMs });
  } catch (err) {
    const code = codeOf(err);
    throw new Error(code === 'TIMEOUT' || code === 'LOCATION_DISABLED' ? POSITION_NOT_FOUND : locationErrorText(err));
  }
  const fix = fromService(found);
  if (!fix) throw new Error(POSITION_NOT_FOUND);
  return fix;
};

/** Satellites du GPS : servant à la position, et en vue. */
export interface SatelliteCount {
  used: number;
  visible: number;
}

interface GnssPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  refreshAssistance(): Promise<{ sent: boolean }>;
  addListener(event: 'satellites', listener: (data: SatelliteCount) => void): Promise<PluginListenerHandle>;
}

const gnss = registerPlugin<GnssPlugin>('Gnss');

/**
 * « Réessayer » du GPS (lot 232) : demande au téléphone de recharger ses données d'aide (heure, orbites des
 * satellites), qui hâtent une position, sans arrêter le service, la trace ni la notification ; ces données ne sont
 * jamais effacées. Tant qu'aucune position n'est arrivée depuis le départ, localisation allumée, le service de
 * l'enregistrement refait aussi son inscription au GPS (`RecordingService.retryGps`). Vrai si le téléphone a pris la
 * demande ; faux dans le navigateur, ou si elle n'a pas pu partir.
 */
export const refreshGpsAssistance = async (): Promise<boolean> => {
  if (!isNativeApp()) return false;
  try {
    return (await gnss.refreshAssistance()).sent === true;
  } catch {
    return false;
  }
};

/**
 * Suit les satellites du GPS sur le téléphone (`GnssPlugin.java`), une fois
 * par seconde environ, tant que le GPS tourne ; rend l'arrêt. Sans effet dans
 * le navigateur, qui n'en dit rien.
 */
export const watchSatellites = (listener: (count: SatelliteCount) => void): (() => void) => {
  if (!isNativeApp()) return () => undefined;
  let stopped = false;
  let handle: PluginListenerHandle | null = null;
  void gnss.addListener('satellites', (data) => {
    if (!stopped) listener({ used: data.used, visible: data.visible });
  }).then((h) => {
    handle = h;
    if (stopped) void h.remove();
    else void gnss.start().catch(() => undefined);
  }).catch(() => undefined);
  return () => {
    stopped = true;
    void handle?.remove();
    void gnss.stop().catch(() => undefined);
  };
};
