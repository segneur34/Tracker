/**
 * Test « FC de nuit » (Entraînement › Tests, lot 213) : la ceinture cardio
 * portée toute la nuit, le téléphone posé près du lit, sans GPS. La session
 * passe par l'enregistreur, sur le calcul `night-hr` (sans position, silencieux,
 * hors des cumuls : `core/sportProfiles.ts`) ; ses chiffres se calculent sur le
 * GPX (`core/nightHeartRate.ts`) avec ce protocole, passé en paramètre (règle 3).
 *
 * Toutes les fenêtres sont en secondes, jamais en nombre de mesures (règle 2) :
 * une ceinture à 1 Hz, à 5 Hz ou qui saute des secondes donne les mêmes
 * chiffres. Une mesure vaut au plus `holdS` secondes : un trou reste un trou.
 *
 * Valeurs de la version 1 : recherche du 12/11 (`docs/backlog/213-fc-nuit-recherche.md`),
 * hypothèses prudentes. Version 2 (lot 218), réglée sur les nuits du 12 au
 * 15/11 : ligne de base sur 10 min, durée d'un sursaut jusqu'au retour à la
 * ligne de base + 4 bpm, rangement en mouvements (moins d'1 min), éveils brefs
 * (1 à 3 min) et réveils (plus de 3 min), rien dans les 15 premières minutes ;
 * part de nuit calme et indice de régularité sur des tranches de 5 min, calmes
 * sous 2 bpm d'écart-type.
 */

import { nightPlace, type NightHrParams, type NightHrPlace } from '../core/nightHeartRate';

export type {
  NightHrCalmProtocol, NightHrPlace, NightHrPlaceProtocol, NightHrStableProtocol, NightHrSurgeProtocol, NightHrWakeProtocol,
} from '../core/nightHeartRate';

export type NightHrTestId = 'fc-nuit';

/**
 * Protocole du test de FC de nuit : les réglages du calcul (`NightHrParams`,
 * déclarés dans `core/nightHeartRate.ts`, que le noyau lit sans importer ce
 * domaine), avec son identifiant, son nom et sa version.
 */
export interface NightHrProtocol extends NightHrParams {
  id: NightHrTestId;
  label: string;
  /** Version du protocole : un calcul qui change l'augmente (résumé à refaire). */
  version: number;
}

export const NIGHT_HR_TEST: NightHrProtocol = {
  id: 'fc-nuit',
  label: 'FC de nuit',
  version: 2,
  lowWindowS: 300,
  lowCoverage: 0.7,
  smoothS: 300,
  surge: { baselineS: 600, riseBpm: 8, holdS: 10, refractoryS: 60, returnBpm: 4, returnSmoothS: 10, returnMaxS: 1200, startSkipS: 900 },
  wake: { shortS: 60, longS: 180 },
  calm: { windowS: 300, sdBpm: 2 },
  gapS: 10,
  holdS: 5,
  stable: { aboveLowBpm: 3, holdS: 30 * 60 },
  nearLowBpm: 5,
  shortNightS: 3 * 3600,
  minBpm: 25,
  maxBpm: 250,
  place: { earlyBefore: 1 / 3, lateAfter: 2 / 3 },
  curveStepS: 30,
};

/** Place du creux d'après sa fraction de la nuit (0 à 1). */
export const nightHrPlace = (fraction: number, protocol: NightHrProtocol = NIGHT_HR_TEST): NightHrPlace =>
  nightPlace(fraction, protocol.place);

// --- Exemple, pour les tests et le banc (ceinture d'exemple du navigateur) ---

/** Un sursaut de la nuit d'exemple : centre et largeur en secondes depuis le départ, hauteur en bpm. */
interface ExampleSurge {
  atS: number;
  widthS: number;
  riseBpm: number;
}

/**
 * Repères de la nuit d'exemple (`exampleNightHr`), en secondes depuis le départ :
 * sa durée prévue, l'instant du creux et le centre de ses sursauts, un de chaque
 * classe au protocole : un mouvement (une trentaine de secondes), un éveil bref
 * (deux minutes environ), un réveil (près de six minutes).
 */
export const EXAMPLE_NIGHT = {
  durationS: 8 * 3600,
  lowAtS: 12_600,
  surges: [
    { atS: 6_600, widthS: 40, riseBpm: 14 },
    { atS: 16_800, widthS: 150, riseBpm: 16 },
    { atS: 23_400, widthS: 400, riseBpm: 20 },
  ] as readonly ExampleSurge[],
} as const;

/** Bosse en arche de sinus, nulle hors de `[atS - widthS / 2, atS + widthS / 2]`. */
const surgeBpm = (tS: number, { atS, widthS, riseBpm }: ExampleSurge): number => {
  const u = (tS - atS) / widthS + 0.5;
  return u > 0 && u < 1 ? riseBpm * Math.sin(Math.PI * u) : 0;
};

/**
 * FC d'exemple d'une nuit, déterministe (le banc la rejoue à l'identique) :
 * 68 bpm au coucher, descente à l'endormissement, creux vers 50 bpm à 3 h 30,
 * lente remontée, trois sursauts (un mouvement à 1 h 50, un éveil bref à 4 h 40,
 * un réveil à 6 h 30), réveil du matin après 7 h 30.
 * `tS` : secondes depuis le départ.
 */
export const exampleNightHr = (tS: number): number => {
  const asleep = 14 * Math.exp(-tS / 1500);
  const trough = Math.min(6, 4 * ((tS - EXAMPLE_NIGHT.lowAtS) / 14_400) ** 2);
  const morning = 8 * Math.min(1, Math.max(0, (tS - 27_000) / 1800));
  const surges = EXAMPLE_NIGHT.surges.reduce((sum, s) => sum + surgeBpm(tS, s), 0);
  const noise = 1.2 * Math.sin(tS * 1.3) + 0.8 * Math.sin(tS * 0.31 + 2);
  return Math.round(50 + asleep + trough + morning + surges + noise);
};
