import { SAILING_TOP_TARGETS, SPORT_PROFILES, hasActiveThreshold, type SportProfile } from '../core/sportProfiles';
import type { SpeedRangeMs } from '../core/speedGradient';
import { bestWindowSpeedMs } from '../core/topSegments';
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

/** Plancher d'arrêt du support, en nœuds (`stillThreshold`) : en dessous, la planche est à l'arrêt. */
export const getStillSpeedKn = (sport: SportType = DEFAULT_SAILING_SPORT): number =>
  SPORT_PROFILES[sport].stillThreshold;


/** Virage cumulé minimal, en degrés, pour qu'une inflexion soit une manœuvre. */
export const MANEUVER_MIN_TURN_DEG = 60;

/**
 * Virage, en degrés, du cap d'approche au cap de sortie, à partir duquel un
 * demi-tour est un tour complet (un 360) : ni virement ni empannage, il n'est
 * jamais compté (décision du 28/10).
 */
export const MANEUVER_FULL_TURN_DEG = 270;

/**
 * Cohérence minimale d'un virage : virage net sur somme des rotations pas à
 * pas. Simple garde-fou contre la chute, où le cap part dans tous les sens :
 * le changement d'amures exigé écarte déjà loffs, abattées et chutes. À 1 Hz,
 * le bruit de cap d'un wing suffisait à écarter un vrai virement à 0,6 (0,57).
 * La même pour la détection des manœuvres et pour l'orientation du vent
 * (`observeTurns`), qui lisait 0,6 jusqu'au 04/11 (Q53 : mêmes règles des deux
 * côtés, pour qu'un virage ne soit pas vu par l'un et pas par l'autre).
 */
export const MANEUVER_MIN_COHERENCE = 0.5;

/**
 * Durée minimale, en secondes, pendant laquelle la vitesse doit rester sous
 * le seuil de réussite pour qu'une manœuvre soit ratée (04/11). Un rebond sur
 * l'eau ou un ralentissement d'un instant en restant en vol passait pour un
 * vol perdu, parce que la vitesse minimale seule décidait ; elle reste la
 * mesure affichée, les 2 s ne changent que le verdict. Lue sur la même série
 * et la même fenêtre que la vitesse minimale, bornes interpolées en temps
 * (règle 2). Surchargeable (`ManeuverOptions.lostFlightSeconds`).
 */
export const MANEUVER_LOST_FLIGHT_S = 2;

/**
 * Vitesse de rotation minimale, en degrés par seconde, du cœur d'un virage :
 * la plus grande suite de rotation à au moins cette vitesse, dans le sens du
 * virage, d'où se lisent le cap et la vitesse d'approche. Un vrai virage
 * tourne à 10 à 30°/s ; une dérive de décollage ou un loff lent n'en font pas
 * partie, et les y inclure faisait lire l'approche avant le décollage.
 */
export const MANEUVER_CORE_RATE_DEG_S = 5;

/** Durée d'observation d'une manœuvre, en secondes. */
export const MANEUVER_WINDOW_S = 12;

/** Part de la fenêtre d'observation sous laquelle rien n'est observable (fin de trace, coupure d'enregistrement). */
export const MANEUVER_MIN_WINDOW_SHARE = 0.5;

/** Nombre de fenêtres d'observation, depuis son déclenchement, jusqu'où un virage se prolonge tant que le cap tourne. */
export const TURN_EXTENSION_MAX_WINDOWS = 2;

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
 * Durée minimale, en secondes, d'un pas de lecture du cap dans la détection
 * des virages : somme des rotations (cohérence), prolongation du virage, cap
 * tenu en sortie. Lus de point à point, cinq pas de 0,2 s cumulent à 5 Hz cinq
 * fois le bruit d'un pas de 1 s : une session rééchantillonnée y perdait 62
 * manœuvres sur 68. Lu par pas d'au moins cette durée, le résultat ne dépend
 * plus de la cadence (règle 2). Un peu sous 1 s, parce qu'une vraie trace à
 * 1 Hz a du jitter en millisecondes : à 1 s strict, un pas de 998 ms en
 * avalerait deux. À 1 Hz, un pas est donc un point : rien ne change.
 */
export const TURN_STRIDE_MIN_S = 0.9;

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

/** Seuil d'activité suggéré, en nœuds, pour une session lente. */
export const SLOW_SESSION_ACTIVE_THRESHOLD_KN = 1;

/** Marge, en nœuds, ajoutée au pic de vitesse pour suggérer la borne haute de couleur. */
export const SPEED_RANGE_MAX_MARGIN_KN = 1;

/**
 * Seuil d'activité suggéré, en nœuds, à partir de l'allure de la session.
 *
 * Au-dessus de `FAST_SESSION_REFERENCE_KN`, la session a globalement volé ou
 * plané : le seuil du profil du support reste pertinent. En dessous, exiger
 * ce même seuil écarterait la session presque entière (§10, point 27) : le
 * seuil retombe à `SLOW_SESSION_ACTIVE_THRESHOLD_KN`. Le bateau, sans seuil
 * depuis le 21/10, n'en a pas l'usage (`withoutActiveThreshold`).
 */
export const suggestActiveThresholdKn = (sport: SportType, referenceSpeedKn: number): number => {
  const profile = SPORT_PROFILES[sport];
  if (!(referenceSpeedKn > 0)) return profile.defaultActiveThreshold;
  if (referenceSpeedKn > FAST_SESSION_REFERENCE_KN) return profile.defaultActiveThreshold;
  return SLOW_SESSION_ACTIVE_THRESHOLD_KN;
};

/** Seuils d'une session de voile, en nœuds (`resolveSailingThresholds`). */
export interface SailingThresholds {
  /** Seuil d'activité réglable : tous les supports sauf le bateau. */
  withThreshold: boolean;
  /** Seuil suggéré par l'allure de la session (`suggestActiveThresholdKn`). */
  suggestedKn: number;
  /** Seuil de la session à défaut du sien : celui de l'activité s'il est réglé ou pré-réglé, sinon la suggestion. */
  defaultKn: number;
  /** Seuil d'activité effectif, qui dit aussi la réussite des manœuvres. */
  activeKn: number;
  /** Seuil de vol (ou de navigation) des manœuvres ; `undefined` sans seuil (bateau), qui compte tout. */
  flightKn: number | undefined;
}

/**
 * Seuils d'une session de voile, dans cet ordre de priorité (§10, point 29) :
 * 1. sans seuil (bateau, 21/10), le seuil fixe de réussite des manœuvres du
 *    calcul (`withoutActiveThreshold`), qui ne se règle nulle part ;
 * 2. le seuil de la session (`sessionKn`, sa fiche ou son brouillon) ;
 * 3. celui de l'activité, réglé dans Réglages ou pré-réglé (`activityKn`) ;
 * 4. la suggestion selon l'allure de la session (`referenceKn`), jamais le
 *    défaut fixe du profil (une trace lente au seuil wingfoil n'affichait
 *    aucune manœuvre, point 27).
 * Le seuil de vol des manœuvres est le seuil d'activité : un demi-tour entamé
 * en dessous n'est ni réussi ni raté (28/10) ; le bateau compte tout.
 */
export const resolveSailingThresholds = (
  profile: SportProfile,
  activityKn: number | null,
  sessionKn: number | null,
  referenceKn: number
): SailingThresholds => {
  const withThreshold = hasActiveThreshold(profile);
  const fixedKn = profile.withoutActiveThreshold?.maneuverSuccess ?? null;
  const suggestedKn = suggestActiveThresholdKn(profile.id, referenceKn);
  const defaultKn = fixedKn ?? activityKn ?? suggestedKn;
  const activeKn = fixedKn ?? sessionKn ?? defaultKn;
  return { withThreshold, suggestedKn, defaultKn, activeKn, flightKn: withThreshold ? activeKn : undefined };
};

/**
 * Bornes de couleur suggérées, en m/s, à partir de l'allure de la session :
 * borne basse alignée sur le seuil d'activité suggéré, borne haute au pic de
 * vitesse sur 2 s plus une marge. Repli sur les bornes du calcul
 * (`SportProfile.speedRange`) si la trace est trop courte pour mesurer ce pic.
 * Un calcul aux bornes fixes (`speedRangeFollowsPace` faux : bateau, de 1 à
 * 15 nœuds) garde les siennes, quelle que soit la session.
 */
export const suggestSpeedRangeMs = (
  sport: SportType,
  referenceSpeedKn: number,
  track: TrackPoint[],
  cum: CumulativeTrack
): SpeedRangeMs => {
  const profile = SPORT_PROFILES[sport];
  if (!profile.speedRangeFollowsPace) return profile.speedRange;
  const peakMs = bestWindowSpeedMs(track, cum, profile.maxSpeedWindowS);
  if (peakMs === null) return profile.speedRange;
  return {
    minMs: knotsToMs(suggestActiveThresholdKn(sport, referenceSpeedKn)),
    maxMs: peakMs + knotsToMs(SPEED_RANGE_MAX_MARGIN_KN),
  };
};

/**
 * Polaire affichée : un virement qui passe moins de `POLAR_TACK_FACE_WIND_MAX_S`
 * à moins de `POLAR_TACK_FACE_WIND_DEG` du vent en est écarté : sa vitesse près
 * du vent n'est que l'élan du virage. Plus long, c'est une vraie remontée, en
 * pumping par exemple (décidé le 05/11 ; sur 80 virements réels en wing : 2 s en
 * médiane, 4 s au plus).
 */
export const POLAR_TACK_FACE_WIND_DEG = 30;
export const POLAR_TACK_FACE_WIND_MAX_S = 3;

/** Fenêtre de moyennage de la VMG, en secondes. */
export const VMG_WINDOW_S = 10;

/** Part de la fenêtre de VMG sous laquelle elle est trop courte (fin de trace, trou juste après le départ) et ignorée. */
export const VMG_MIN_WINDOW_RATIO = 0.8;

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

/** Poids total des votes des virages (`orientationVotes`) sous lequel ils ne tranchent pas l'orientation du vent. */
export const ORIENTATION_MIN_VOTE_WEIGHT = 0.5;

/**
 * Indice de confiance minimal de l'estimation automatique du vent. En dessous,
 * l'estimation est jugée non fiable et la saisie manuelle est exigée. C'est
 * le cas typique du downwinder ou du plan d'eau à fort courant : aucun
 * algorithme purement GPS ne peut deviner le vent sur une trace unilatérale.
 */
export const WIND_CONFIDENCE_MIN = 0.4;

/**
 * Facteur appliqué à la confiance polaire quand aucun candidat de vent ne
 * classe une seule manœuvre alors que la trace a des virages (lot 149, C1-2) :
 * la polaire a le dernier mot, mais rien ne l'a contrôlée, et sur une session
 * de wing réaliste son meilleur score désigne souvent le trou de couverture
 * entre près et largue, à 90° du vrai vent. Sous `WIND_CONFIDENCE_MIN` dans
 * les cas vus : le vent est demandé plutôt qu'annoncé faux.
 */
export const WIND_UNCHECKED_CONFIDENCE_FACTOR = 0.5;

