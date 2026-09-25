/**
 * Types génériques du noyau d'analyse, indépendants du sport.
 *
 * Règle centrale : dans le noyau, toutes les vitesses sont en mètres par
 * seconde, les distances en mètres, les durées en secondes ou millisecondes.
 * La conversion vers l'unité d'affichage (nœuds, km/h, min/km) se fait
 * uniquement en sortie, via `core/units.ts` et le profil de support actif.
 * Les caps restent en degrés, plus lisibles et sans effet sur la justesse.
 */

/** Support / activité analysée. Le seuil d'activité et l'unité d'affichage en dépendent. */
export type SportType = 'wingfoil' | 'windsurf' | 'kite' | 'bateau' | 'running';

/** Point brut tel que lu dans le fichier de trace, avant tout calcul. */
export interface RawTrackPoint {
  lat: number;
  lon: number;
  time: string | Date;
  ele?: number;
  /**
   * Vitesse fournie par l'appareil, en m/s, lorsqu'elle est présente dans le
   * fichier. Elle vient du décalage Doppler du signal satellite et non d'une
   * dérivation de positions : elle est nettement plus fiable sur les pointes.
   */
  speedMs?: number;
  /** Fréquence cardiaque en battements par minute, si présente. */
  hr?: number;
  /** Cadence, si présente. */
  cadence?: number;
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
  /** Cap en degrés, 0 = nord, sens horaire. */
  bearing: number;
  /** D'où vient `speedMs`. */
  speedSource: SpeedSource;
}

/** Meilleur segment sur une cible de temps ou de distance. */
export interface TopSegment {
  /** Valeur formatée dans l'unité d'affichage du support, ou "-" si non atteint. */
  val: string;
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
  /** Part du temps actif sur le temps total, en pourcentage formaté. */
  activeRatio: string;
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
