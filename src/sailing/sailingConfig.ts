import { SAILING_TOP_TARGETS, SPORT_PROFILES } from '../core/sportProfiles';
import type { SpeedRangeMs } from '../core/speedGradient';
import { computeTopSegments } from '../core/topSegments';
import type { CumulativeTrack, SportType, TrackPoint } from '../core/types';
import { knotsToMs } from '../core/units';

/**
 * Réglages propres aux supports à voile. Le reste du noyau ignore ces valeurs.
 * Toutes les fenêtres sont en secondes ou en minutes, jamais en nombre de
 * points, pour que le résultat ne dépende pas de la fréquence de la montre.
 */

/** Cibles de meilleurs segments de la voile : 2 s, 5 s, 10 s, 100 m, 500 m, 1000 m, 1 mille. */
export { SAILING_TOP_TARGETS };

/** Support voile retenu par défaut à l'ouverture du module. */
export const DEFAULT_SAILING_SPORT: SportType = 'wingfoil';

/** Seuil d'activité par défaut du support, en nœuds. */
export const getDefaultThresholdKn = (sport: SportType = DEFAULT_SAILING_SPORT): number =>
  SPORT_PROFILES[sport].defaultActiveThreshold;

/**
 * Bornes par défaut du dégradé de couleur de la trace (`core/speedGradient.ts`),
 * en m/s : gris sous 8 nœuds, rouge franc à partir de 28 nœuds. Réglables par
 * support dans la légende, comme en course.
 */
export const DEFAULT_SAILING_SPEED_RANGE_MS: SpeedRangeMs = { minMs: knotsToMs(8), maxMs: knotsToMs(28) };

/** Virage cumulé minimal, en degrés, pour qu'une inflexion soit une manœuvre. */
export const MANEUVER_MIN_TURN_DEG = 60;

/** Durée d'observation d'une manœuvre, en secondes. */
export const MANEUVER_WINDOW_S = 12;

/**
 * Durée maximale, en secondes, d'un intervalle unique tenu pour observable
 * quand la fenêtre d'observation ne contient aucun point.
 *
 * Les enregistreurs économiques — les applications de randonnée, par exemple —
 * posent un point quand on se déplace, et se taisent quand on ralentit.
 * Pendant un virement de bord la planche s'arrête : toute la rotation se
 * retrouve compressée dans un seul intervalle, plus long que la fenêtre, et le
 * virage devient invisible alors que le fichier le décrit. On accepte donc de
 * lire un pas unique, tant qu'il reste de la durée d'une manœuvre.
 *
 * Au-delà, deux points éloignés ne décrivent plus un virage mais deux bords
 * sans rapport, et les lire comme une manœuvre en fabriquerait d'imaginaires.
 */
export const MANEUVER_MAX_STEP_S = 30;

/**
 * Temps mort après une manœuvre validée, en secondes. Tout nouveau
 * franchissement d'axe pendant ce délai est ignoré : un virage hésitant ne
 * doit pas être compté deux fois.
 */
export const MANEUVER_COOLDOWN_S = 10;

/** Vitesse minimale d'entrée de manœuvre, en nœuds. */
export const MANEUVER_MIN_ENTRY_SPEED_KN = 4;

/**
 * Distance minimale parcourue, en mètres, entre le début et la fin d'un virage.
 *
 * Plusieurs fois l'incertitude d'une position GPS. Sans elle, deux points
 * presque superposés — une planche à l'arrêt — donnent un cap quelconque, et
 * un virage lu en un seul pas a toujours une cohérence parfaite : le critère
 * qui écarte les chutes ne protège alors de rien.
 */
export const MANEUVER_MIN_DISTANCE_M = 10;

/**
 * Part de l'allure de la session en dessous de laquelle on n'entre pas dans un
 * virage, et part en dessous de laquelle un cap n'alimente pas la polaire.
 *
 * Les deux valeurs absolues ci-dessus sont celles d'un wingfoil, dont l'allure
 * tourne autour de 25 nœuds ; ces rapports les y redonnent à l'identique. Sur
 * une session de planche à 4,4 nœuds, exiger 4 nœuds à l'entrée d'un virage
 * revient à en demander 91 % de la vitesse de croisière, ce qu'on ne fait
 * jamais : aucun demi-tour n'est alors détecté.
 */
export const MANEUVER_ENTRY_SPEED_RATIO = 0.16;
export const POLAR_MIN_SPEED_RATIO = 0.2;

/**
 * Seuils de manœuvre accordés à l'allure de la session.
 *
 * Toujours le minimum entre le profil et la mise à l'échelle : celle-ci ne
 * peut qu'abaisser un seuil, jamais l'ouvrir. Une session rapide garde donc
 * exactement les valeurs d'aujourd'hui.
 */
export const sessionManeuverThresholds = (
  sport: SportType,
  referenceSpeedKn: number
): { minEntrySpeedKn: number; polarMinSpeedKn: number } => {
  const profile = SPORT_PROFILES[sport];
  if (!(referenceSpeedKn > 0)) {
    return {
      minEntrySpeedKn: MANEUVER_MIN_ENTRY_SPEED_KN,
      polarMinSpeedKn: profile.defaultPolarMinSpeed,
    };
  }
  return {
    minEntrySpeedKn: Math.min(
      MANEUVER_MIN_ENTRY_SPEED_KN,
      MANEUVER_ENTRY_SPEED_RATIO * referenceSpeedKn
    ),
    polarMinSpeedKn: Math.min(
      profile.defaultPolarMinSpeed,
      POLAR_MIN_SPEED_RATIO * referenceSpeedKn
    ),
  };
};

/** Allure de session, en nœuds, au-dessus de laquelle une session est tenue pour rapide. */
export const FAST_SESSION_REFERENCE_KN = 12;

/**
 * Seuil d'activité suggéré, en nœuds, pour une session lente — et pour le
 * bateau quelle que soit son allure, dont le défaut de profil (3 nds) reste
 * trop haut pour compter la session presque entière comme active.
 */
export const SLOW_SESSION_ACTIVE_THRESHOLD_KN = 1;

/** Marge, en nœuds, ajoutée au pic de vitesse pour suggérer la borne haute de couleur. */
export const SPEED_RANGE_MAX_MARGIN_KN = 1;

/**
 * Seuil d'activité suggéré, en nœuds, à partir de l'allure de la session.
 *
 * Au-dessus de `FAST_SESSION_REFERENCE_KN`, la session a globalement volé ou
 * plané : le seuil du profil du support reste pertinent. En dessous, exiger
 * ce même seuil écarterait la session presque entière (§10, point 27) : le
 * seuil retombe à `SLOW_SESSION_ACTIVE_THRESHOLD_KN`. Le bateau n'a pas de
 * régime rapide propre — son allure dépasse rarement ce seuil, et son défaut
 * de profil est de toute façon trop haut — il retombe donc lui aussi à
 * `SLOW_SESSION_ACTIVE_THRESHOLD_KN`.
 */
export const suggestActiveThresholdKn = (sport: SportType, referenceSpeedKn: number): number => {
  const profile = SPORT_PROFILES[sport];
  if (!(referenceSpeedKn > 0)) return profile.defaultActiveThreshold;
  if (referenceSpeedKn > FAST_SESSION_REFERENCE_KN && sport !== 'bateau') {
    return profile.defaultActiveThreshold;
  }
  return SLOW_SESSION_ACTIVE_THRESHOLD_KN;
};

/**
 * Vitesse maximale sur une fenêtre glissante de 2 s, en m/s, ou `null` si la
 * trace est trop courte pour en couvrir une. Réutilise `computeTopSegments`
 * avec la cible `t2s` déjà définie pour les tops de vitesse : son premier
 * segment après tri, avant filtrage du chevauchement, est déjà le maximum
 * cherché.
 */
const maxWindowSpeedMs = (track: TrackPoint[], cum: CumulativeTrack): number | null => {
  const t2s = SAILING_TOP_TARGETS.find((target) => target.key === 't2s')!;
  const [top] = computeTopSegments(track, cum, t2s, (speedMs) => speedMs, { count: 1, decimals: 6 });
  return top && top.val !== '-' ? parseFloat(top.val) : null;
};

/**
 * Bornes de couleur suggérées, en m/s, à partir de l'allure de la session :
 * borne basse alignée sur le seuil d'activité suggéré, borne haute au pic de
 * vitesse sur 2 s plus une marge. Repli sur `DEFAULT_SAILING_SPEED_RANGE_MS`
 * si la trace est trop courte pour mesurer ce pic.
 */
export const suggestSpeedRangeMs = (
  sport: SportType,
  referenceSpeedKn: number,
  track: TrackPoint[],
  cum: CumulativeTrack
): SpeedRangeMs => {
  const peakMs = maxWindowSpeedMs(track, cum);
  if (peakMs === null) return DEFAULT_SAILING_SPEED_RANGE_MS;
  return {
    minMs: knotsToMs(suggestActiveThresholdKn(sport, referenceSpeedKn)),
    maxMs: peakMs + knotsToMs(SPEED_RANGE_MAX_MARGIN_KN),
  };
};

/** Fenêtre de moyennage de la VMG, en secondes. */
export const VMG_WINDOW_S = 10;

/** Vitesse minimale, en nœuds, pour qu'un cap alimente l'estimation du vent. */
export const WIND_ESTIMATION_MIN_SPEED_KN = 5;

/**
 * Conservation de vitesse — vitesse minimale sur vitesse d'entrée — en dessous
 * de laquelle un virage est tenu pour un passage face au vent, vol perdu.
 *
 * C'est le seul ancrage physique qui empêche l'estimation du vent de s'inverser
 * de 180°. Il est exprimé en rapport, et non en nœuds, pour valoir aussi bien
 * sur un bateau à 4 nœuds que sur un kite à 30 : un virement s'arrête, un
 * empannage conserve, quelle que soit l'échelle du support.
 */
export const ORIENTATION_MAX_CONSERVATION = 0.5;

/**
 * Indice de confiance minimal de l'estimation automatique du vent. En dessous,
 * l'estimation est jugée non fiable et la saisie manuelle est exigée. C'est
 * le cas typique du downwinder ou du plan d'eau à fort courant : aucun
 * algorithme purement GPS ne peut deviner le vent sur une trace unilatérale.
 */
export const WIND_CONFIDENCE_MIN = 0.4;

