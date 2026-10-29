/**
 * Types génériques du noyau d'analyse, indépendants du sport.
 *
 * Règle centrale : dans le noyau, toutes les vitesses sont en mètres par
 * seconde, les distances en mètres, les durées en secondes ou millisecondes.
 * La conversion vers l'unité d'affichage (nœuds, km/h, min/km) se fait
 * uniquement en sortie, via `core/units.ts` et le profil de support actif.
 * Les caps restent en degrés, plus lisibles et sans effet sur la justesse.
 */

/**
 * Support / activité analysée. Le seuil d'activité et l'unité d'affichage en dépendent.
 * L'identifiant va dans le `<type>` du GPX enregistré et dans le nom de son fichier.
 */
export type SportType =
  | 'wingfoil' | 'windsurf' | 'kite' | 'bateau' | 'running' | 'cycling' | 'run-intervals' | 'bike-intervals' | 'run-test' | 'surf' | 'muscu';

/** Point brut tel que lu dans le fichier de trace, avant tout calcul. */
export interface RawTrackPoint {
  lat: number;
  lon: number;
  time: string | Date;
  /**
   * `time` en millisecondes, lu une fois à la lecture du fichier ou à
   * l'enregistrement (lot 56) : `rawPointTimeMs` le préfère à une nouvelle
   * lecture de la date. Une date illisible y vaut NaN, comme relue. Ce n'est
   * pas `TrackPoint.timeMs`, la date répartie (`spreadEqualTimes`).
   */
  rawTimeMs?: number;
  ele?: number;
  /**
   * Vitesse fournie par l'appareil, en m/s, lorsqu'elle est présente dans le
   * fichier. Elle vient du décalage Doppler du signal satellite et non d'une
   * dérivation de positions : elle est nettement plus fiable sur les pointes.
   */
  speedMs?: number;
  /** Cap fourni par l'appareil (Doppler), en degrés, 0 = nord, sens horaire, s'il est présent. */
  courseDeg?: number;
  /** Fréquence cardiaque en battements par minute, si présente. */
  hr?: number;
  /** Cadence, si présente. */
  cadence?: number;
  /**
   * Premier point d'un `<trkseg>` après le premier : la trace reprend après une
   * pause de l'enregistrement. Le pas qui y mène n'est ni parcouru ni en action.
   */
  segmentStart?: true;
}

/**
 * Point sans position, lu dans le GPX d'une session sans trace (muscu, lot I
 * du 25/10) : l'heure, et la FC si la ceinture l'a donnée. Jamais dans la
 * cinématique : seulement l'analyse de la FC (`core/heartRateSession.ts`).
 */
export interface TimedTrackPoint {
  time: string;
  /** Fréquence cardiaque en battements par minute, si présente. */
  hr?: number;
  /** Premier point d'un `<trkseg>` après le premier : reprise après une pause. */
  segmentStart?: true;
}

/** Origine de la vitesse retenue pour un point. */
export type SpeedSource = 'doppler' | 'derived';

/** Point enrichi par la kinématique. Vitesses en m/s. */
export interface TrackPoint {
  lat: number;
  lon: number;
  time: string | Date;
  /** Horodatage en millisecondes, précalculé pour éviter de reparser en boucle. */
  timeMs: number;
  ele?: number;
  hr?: number;
  cadence?: number;
  /** Vitesse retenue après écrêtage des aberrations, en m/s. */
  speedMs: number;
  /** Vitesse filtrée servant à toutes les analyses, en m/s. */
  smoothedSpeedMs: number;
  /** Cap en degrés, 0 = nord, sens horaire, tiré des positions (du point précédent à celui-ci). */
  bearing: number;
  /** Cap fourni par l'appareil, s'il est présent : plus juste que `bearing` à 1 Hz. */
  courseDeg?: number;
  /** D'où vient `speedMs`. */
  speedSource: SpeedSource;
  /** Reprise après une pause de l'enregistrement (`RawTrackPoint.segmentStart`). */
  segmentStart?: true;
  /**
   * Pas plus long que `maxGapS` (trou de la trace) : distance retenue pour ce
   * pas, bornée par la corde × 1,5 (`GAP_CHORD_FACTOR`) ; absent sur un pas ordinaire.
   */
  gapDistanceM?: number;
}

/** Meilleur segment sur une cible de temps ou de distance. */
export interface TopSegment {
  /** Valeur formatée dans l'unité d'affichage du support, ou "-" si non atteint. */
  val: string;
  /** La même vitesse, en nombre, dans l'unité du convertisseur ; `null` si non atteint (27/10). */
  speed: number | null;
  path: [number, number][];
}

/** Cible de recherche d'un meilleur segment. */
export interface TopTarget {
  /** Clé stable utilisée par l'interface, par exemple `t5s` ou `d500m`. */
  key: string;
  /** Libellé affiché, par exemple `5 s` ou `500 m`. */
  label: string;
  /** Secondes si `kind` vaut `time`, mètres si `kind` vaut `distance`. */
  value: number;
  kind: 'time' | 'distance';
}

/** Statistiques communes à tous les supports. */
export interface BaseSessionStats {
  /** Distance totale, en mètres ; formatée dans l'unité de l'activité à l'affichage. */
  distanceM: number;
  /** Distance parcourue au-dessus du seuil d'activité, en mètres. */
  activeDistanceM: number;
  /** Durée totale formatée, par exemple `1h24`. */
  totalTime: string;
  /** Durée passée au-dessus du seuil d'activité, formatée. */
  activeTime: string;
  /**
   * Part du temps actif, en pourcentage formaté : sur le temps total, ou sur
   * le temps en mouvement quand un masque de mouvement est donné (voile).
   */
  activeRatio: string;
  /**
   * Temps en mouvement, en secondes, dénominateur du ratio en voile (arrêts
   * ôtés au plancher d'arrêt) ; 0 sans masque de mouvement. Aucune page ne
   * l'affiche : le résumé des fiches en a besoin.
   */
  inMotionTimeS: number;
  /** Vitesse moyenne sur le temps total, en m/s, ou `null` sans durée. */
  avgSpeedMs: number | null;
  /** Vitesse moyenne sur le seul temps actif (distance active ÷ temps actif), en m/s, ou `null` sans temps actif. */
  activeAvgSpeedMs: number | null;
  /** Part des points dont la vitesse vient de l'appareil et non d'une dérivation. */
  speedSource: SpeedSource;
  /** Dénivelé positif cumulé en mètres, formaté sans décimale. */
  elevationGain: string;
  /** Dénivelé négatif cumulé en mètres, formaté sans décimale. */
  elevationLoss: string;
  /** Altitude minimale et maximale lissées, en mètres, formatées. */
  elevationMin: string;
  elevationMax: string;
  /** Vrai si la trace porte assez d'altitudes pour que le dénivelé ait un sens. */
  hasElevation: boolean;
}

/** Sommes cumulées le long de la trace, utilisées par les calculs de segments. */
export interface CumulativeTrack {
  /** Distance cumulée en mètres depuis le premier point. */
  cumDist: number[];
  /** Temps cumulé en secondes depuis le premier point. */
  cumTime: number[];
}
