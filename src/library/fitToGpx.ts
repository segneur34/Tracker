import { FIT_FILE_ACTIVITY, parseFit, readFitFileType, type FitRecord, type FitTimerEvent } from '../core/fitParser';
import { getSportProfile } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import { buildGpx } from '../recording/gpxWriter';
import { sessionTitle } from '../recording/session';
import { guessSport } from './naming';

/**
 * D'un fichier FIT à une session : le FIT est converti une seule fois, à l'entrée, en GPX, le seul format de la
 * mémoire (fiche, balayage, vignettes, paquet GPX et les deux appareils n'ont rien à savoir de plus). Le `.fit`
 * d'origine n'est pas gardé. FC, cadence et vitesse vont dans `gpxtpx`, une pause de la minuterie sépare deux
 * `<trkseg>`, un point sans position est écarté. Le FIT ne porte pas de cap par point (profil FIT), ni de distance
 * relue : celle de la session est l'intégrale de la vitesse, comme pour tout GPX.
 */

/** Sports du profil FIT, par numéro, sous le nom écrit dans `<type>` et lu par `guessSport`. Absent : session à classer. */
const FIT_SPORT_NAMES: Record<number, string> = {
  1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 15: 'rowing', 16: 'mountaineering', 17: 'hiking', 19: 'paddling',
  21: 'e_biking', 23: 'boating', 32: 'sailing', 37: 'stand_up_paddleboarding', 38: 'surfing', 39: 'wakeboarding',
  40: 'water_skiing', 41: 'kayaking', 43: 'windsurfing', 44: 'kitesurfing', 77: 'wakesurfing', 88: 'canoeing',
};
/** Transition d'un multisport : ni un sport de la session, ni une raison de la laisser à classer. */
const FIT_SPORT_TRANSITION = 3;

/** Nom du sport d'un FIT : un seul sport, transitions à part ; sinon (générique, inconnu, plusieurs sports) `null`, session à classer. */
const fitSportName = (codes: readonly number[]): string | null => {
  const sports = new Set(codes.filter((code) => code !== FIT_SPORT_TRANSITION));
  return sports.size === 1 ? FIT_SPORT_NAMES[[...sports][0]] ?? null : null;
};

/** Précision des positions écrites : le centimètre suffit, et le GPX reste léger. */
const roundDeg = (deg: number): number => Math.round(deg * 1e7) / 1e7;

const fixOf = (record: FitRecord): LocationFix => ({
  timeMs: record.timeMs,
  lat: roundDeg(record.lat!),
  lon: roundDeg(record.lon!),
  altitudeM: record.altitudeM,
  speedMs: record.speedMs,
  heartRateBpm: record.heartRateBpm,
  // Le FIT donne des foulées par minute (des tours à vélo) et `buildGpx` attend des pas, qu'il divise par 2 : le double
  // ressort tel quel dans `gpxtpx:cad`.
  cadenceSpm: record.cadence === undefined ? undefined : record.cadence * 2,
});

/**
 * Points à positions de la trace, un tableau par continu de la minuterie : un point relevé pendant une pause (après
 * l'arrêt, avant le départ) n'est pas gardé, à l'image d'une pause de Tracker. Rien n'y dépend de la cadence.
 */
const fitSegments = (records: readonly FitRecord[], events: readonly FitTimerEvent[]): LocationFix[][] => {
  const located = records.filter((r) => r.lat !== undefined && r.lon !== undefined);
  const timer = [...events].sort((a, b) => a.timeMs - b.timeMs);
  const segments: LocationFix[][] = [];
  let current: LocationFix[] = [];
  let running = true;
  let stoppedAtMs = 0;
  let next = 0;
  for (const record of located) {
    for (; next < timer.length && timer[next].timeMs <= record.timeMs; next++) {
      const event = timer[next];
      if (!event.running && running) {
        running = false;
        stoppedAtMs = event.timeMs;
      } else if (event.running && !running) {
        running = true;
        if (current.length > 0) segments.push(current);
        current = [];
      }
    }
    // Le point de l'instant même de l'arrêt fait encore partie du continu.
    if (running || record.timeMs <= stoppedAtMs) current.push(fixOf(record));
  }
  if (current.length > 0) segments.push(current);
  // Minuterie fausse (arrêtée d'un bout à l'autre) : les points valent mieux qu'elle.
  return segments.length > 0 || located.length === 0 ? segments : [located.map(fixOf)];
};

export type FitConversion =
  /** Une session, en GPX. */
  | { kind: 'session'; gpx: string }
  /** Un FIT lisible qui n'est pas une activité (réglages, parcours, données du jour…). */
  | { kind: 'not-activity' }
  /** Une activité qu'on ne peut pas ranger, avec la raison en clair. */
  | { kind: 'refused'; reason: string };

/** Vrai si le FIT est une activité, sans en lire la suite : `false` pour un autre type ou un fichier qui n'est pas un FIT. */
export const isFitActivity = (bytes: Uint8Array): boolean => {
  try {
    const type = readFitFileType(bytes);
    return type === null || type === FIT_FILE_ACTIVITY;
  } catch {
    return false;
  }
};

/** Convertit un FIT ; lève une erreur en clair si ce n'en est pas un. Un FIT coupé rend les points lus jusqu'à la coupure. */
export const fitToGpx = (bytes: Uint8Array): FitConversion => {
  const fit = parseFit(bytes);
  if (fit.fileType !== null && fit.fileType !== FIT_FILE_ACTIVITY) return { kind: 'not-activity' };
  const segments = fitSegments(fit.records, fit.timerEvents);
  if (segments.length === 0) {
    return {
      kind: 'refused',
      reason: fit.truncated && fit.records.length === 0
        ? 'fichier coupé avant le premier point'
        : 'aucune position dans ce fichier (tapis, salle) : pas de trace à ranger',
    };
  }
  const type = fitSportName(fit.sportCodes);
  const sport = guessSport(type ?? undefined);
  const name = sessionTitle(segments[0][0].timeMs, sport ? getSportProfile(sport).label : 'Session');
  return { kind: 'session', gpx: buildGpx(segments, { name, sport: type }) };
};
