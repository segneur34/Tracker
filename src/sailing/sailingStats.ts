import { flightSpans, type FlightSpan } from '../core/pumping';
import { activeRuns, buildCumulativeTrack, buildBaseSessionStats, thresholdActivityMask } from '../core/sessionStats';
import { getActiveThresholds, getSportProfile, hasActiveThreshold } from '../core/sportProfiles';
import { computeAllTopSegments } from '../core/topSegments';
import type { CumulativeTrack, SportType, TrackPoint } from '../core/types';
import { knotsToMs, msToKnots } from '../core/units';
import type { SessionStats } from './types';
import { DEFAULT_SAILING_SPORT, SAILING_TOP_TARGETS, getDefaultThresholdKn } from './sailingConfig';

export interface SailingStatsOptions {
  /** Support analysé, qui fixe les défauts d'hystérésis. */
  sport?: SportType;
  /**
   * Seuil d'activité en nœuds. Paramètre injecté : il vaut 8 en wingfoil mais
   * change selon le support, et l'utilisateur peut le régler. Ignoré en
   * bateau, sans seuil : toute la session y compte en navigation.
   */
  activeThresholdKn?: number;
  /** Cumuls déjà calculés, pour ne pas reparcourir la trace. */
  cumulative?: CumulativeTrack;
  /**
   * Tops de vitesse déjà calculés (`computeSailingTops`) : ils ne dépendent
   * que de la trace, pas du seuil, et ne sont pas refaits à chaque réglage.
   */
  tops?: SessionStats['tops'];
}

/** Tops de vitesse de la voile, en nœuds, sur les sept cibles du calcul. */
export const computeSailingTops = (track: TrackPoint[], cumulative: CumulativeTrack): SessionStats['tops'] => {
  const tops = computeAllTopSegments(track, cumulative, SAILING_TOP_TARGETS, msToKnots);
  return Object.fromEntries(SAILING_TOP_TARGETS.map(({ key }) => [key, tops[key]])) as SessionStats['tops'];
};

/**
 * Statistiques d'une session à voile : la base générique, plus les tops de
 * vitesse.
 */
export const buildSailingSessionStats = (
  track: TrackPoint[],
  options: SailingStatsOptions = {}
): SessionStats | null => {
  if (track.length === 0) return null;

  const sport = options.sport ?? DEFAULT_SAILING_SPORT;
  const profile = getSportProfile(sport);
  const activeThresholdKn = options.activeThresholdKn ?? getDefaultThresholdKn(sport);
  const thresholds = getActiveThresholds(profile, activeThresholdKn);

  const cumulative = options.cumulative ?? buildCumulativeTrack(track);
  // Sans seuil (bateau) : toute la session en navigation, pauses de l'enregistrement et trous immobiles ôtés.
  const activityMask = thresholdActivityMask(track, profile, activeThresholdKn);
  // Ratio de vol (ou de navigation, de planing) sur le temps en mouvement,
  // arrêts complets ôtés au plancher d'arrêt (décision du 28/10) : sur toute
  // la session, une demi-heure passée à l'arrêt le divisait par deux. Le
  // bateau, sans seuil, n'a pas de ratio.
  const ratioMask = hasActiveThreshold(profile) ? thresholdActivityMask(track, profile, 0) : undefined;

  const base = buildBaseSessionStats(track, {
    enterThresholdMs: knotsToMs(thresholds.enter),
    exitThresholdMs: knotsToMs(thresholds.exit),
    minStateDurationS: profile.minStateDurationS,
    cumulative,
    activityMask,
    ratioMask,
  });

  return { ...base, tops: options.tops ?? computeSailingTops(track, cumulative) };
};

/**
 * Vols d'une session de voile sur foil (pumping, lot 22) : les suites du
 * masque d'activité au seuil de la session, celui des statistiques (temps et
 * ratio de vol), coupées aux trous de la trace (`maxGapS`) ; celles de moins de
 * `minFlightS` secondes ne sont pas listées. La détection n'est pas retouchée :
 * c'est celle des chiffres « en vol ». Rien en bateau, sans seuil.
 */
export const sailingFlights = (
  track: TrackPoint[], cumulative: CumulativeTrack, sport: SportType, activeThresholdKn: number, minFlightS: number
): FlightSpan[] => {
  const profile = getSportProfile(sport);
  if (track.length < 2 || !hasActiveThreshold(profile)) return [];
  const mask = thresholdActivityMask(track, profile, activeThresholdKn);
  return flightSpans(track, cumulative, activeRuns(track, mask, profile.maxGapS), minFlightS);
};
