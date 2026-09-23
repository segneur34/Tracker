import type { Location as PluginLocation } from '@capgo/background-geolocation';
import { isNativeApp } from './runtime';

/**
 * Sources de position : seul point d'accès autorisé au GPS.
 *
 * Trois sources, une même forme : le plugin de géolocalisation en arrière-plan
 * dans l'application Android, `watchPosition` dans le navigateur, et un
 * « rejeu » qui relit une trace en accéléré pour éprouver tout l'enregistrement
 * sur le PC. Aucune ne filtre quoi que ce soit : l'intelligence reste dans le
 * pipeline d'analyse (`docs/ETAT_DU_PROJET.md` §12).
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
}

export interface LocationWatchOptions {
  /** Intervalle demandé entre deux positions, en millisecondes. */
  intervalMs: number;
  /** Déplacement minimal avant une nouvelle position, en mètres. */
  distanceFilterM: number;
  /** Titre et texte de la notification permanente qu'Android exige pendant l'enregistrement. */
  notificationTitle: string;
  notificationText: string;
}

/** Arrête la réception des positions. */
export type StopLocation = () => Promise<void>;

export interface LocationSource {
  /** Libellé affiché à l'utilisateur. */
  label: string;
  /**
   * Démarre la réception : `onFix` à chaque position, `onError` quand la
   * source échoue (permission refusée, localisation coupée). Rend la fonction
   * d'arrêt.
   */
  start(
    options: LocationWatchOptions,
    onFix: (fix: LocationFix) => void,
    onError: (message: string) => void
  ): Promise<StopLocation>;
}

/** Valeur absente ou non numérique ramenée à `undefined`. */
const optional = (value: number | null | undefined): number | undefined =>
  value === null || value === undefined || !isFinite(value) ? undefined : value;

const fromPlugin = (location: PluginLocation): LocationFix => ({
  timeMs: location.time ?? Date.now(),
  lat: location.latitude,
  lon: location.longitude,
  accuracyM: optional(location.accuracy),
  altitudeM: optional(location.altitude),
  speedMs: optional(location.speed),
  bearingDeg: optional(location.bearing),
});

/**
 * GPS du téléphone, par `@capgo/background-geolocation` : un service de
 * premier plan, avec sa notification, qui continue écran éteint. Le plugin est
 * chargé à la demande, pour ne rien coûter au navigateur.
 */
const nativeSource: LocationSource = {
  label: 'GPS du téléphone',
  start: async (options, onFix, onError) => {
    const { BackgroundGeolocation } = await import('@capgo/background-geolocation');
    await BackgroundGeolocation.start(
      {
        backgroundTitle: options.notificationTitle,
        backgroundMessage: options.notificationText,
        requestPermissions: true,
        // Jamais de position périmée : une position ancienne fausserait le premier intervalle.
        stale: false,
        distanceFilter: options.distanceFilterM,
        minIntervalMs: options.intervalMs,
      },
      (location, error) => {
        if (error) {
          onError(error.message || error.code || 'Localisation indisponible.');
          return;
        }
        if (location) onFix(fromPlugin(location));
      }
    );
    return () => BackgroundGeolocation.stop();
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
          accuracyM: optional(p.coords.accuracy),
          altitudeM: optional(p.coords.altitude),
          speedMs: optional(p.coords.speed),
          bearingDeg: optional(p.coords.heading),
        }),
      (e) => onError(e.message || 'Localisation refusée ou indisponible.'),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    return async () => navigator.geolocation.clearWatch(id);
  },
};

/** Source de position de l'appareil : le plugin sur le téléphone, le navigateur ailleurs. */
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

/**
 * Arrête le service GPS natif, s'il tourne encore sans personne pour
 * l'écouter : après un arrêt brutal de l'application, Android peut le
 * relancer seul. Sans effet dans le navigateur.
 */
export const stopOrphanedDeviceLocation = async (): Promise<void> => {
  if (!isNativeApp()) return;
  try {
    const { BackgroundGeolocation } = await import('@capgo/background-geolocation');
    await BackgroundGeolocation.stop();
  } catch {
    // Rien à arrêter.
  }
};
