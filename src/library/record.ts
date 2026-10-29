import type { HeartRateHistogram } from '../core/heartRate';
import { isValidBikeWeight } from '../cycling/energy';
import { JUMP_DOUBTS, type JumpDoubt, type SessionJump } from '../core/jumps';
import { readSessionMarks, type SessionMark } from '../core/sessionMarks';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import { sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import type { TerrainSamples } from '../core/terrainElevation';
import { readSurfaceRuns, type SurfaceRuns } from '../planning/surface';
import { readSessionTest, type SessionTest } from '../recording/fitnessTest';
import type { SummaryTest } from '../running/fitnessTestResults';
import { readIntervalSeries, type IntervalSeries } from '../recording/intervalTimer';
import { isSportType } from '../recording/session';
import { isValidCarriedLoad } from '../running/energy';
import { EMPTY_NOTES, type GearChoice, type SailingSessionNotes } from '../sailing/sessionNotes';
import { finiteOr, isFiniteNumber, isObject, parseJson } from '../core/basics';

/**
 * Fiche d'une session : le fichier JSON rangé à côté de son GPX dans le
 * dossier mémoire (`docs/ETAT_DU_PROJET.md` §6).
 *
 * Le GPX fait foi. La fiche en garde un résumé, pour afficher la liste sans
 * relire les traces, et ce que l'utilisateur a saisi : support, notes,
 * réglages d'analyse (vent, seuil d'activité, couleurs). Tout se recalcule
 * depuis le GPX, sauf ces saisies.
 *
 * Deux règles de compatibilité, parce que le dossier passe d'un appareil à
 * l'autre et d'une version de l'application à l'autre :
 * - les champs inconnus sont conservés à la réécriture : une version plus
 *   récente ne perd rien en passant par une plus ancienne ;
 * - une fiche d'une version future est lue, mais jamais réécrite.
 */

export const RECORD_FORMAT = 'tracker-session';
export const RECORD_VERSION = 1;

/**
 * Version du calcul du résumé. À augmenter quand `summarizeSession` change :
 * les fiches plus anciennes sont alors recalculées depuis leur GPX, notes
 * intactes.
 *
 * 2 (24 septembre 2026) : l'allure imposée ne vient plus des réglages du
 * support mais de la fiche de la session (`analysis.referenceSpeedMs`).
 *
 * 3 (14 octobre 2026) : une position qui saute puis revient est écartée de la
 * vitesse (`detourSpikes`), même suivie d'un trou.
 *
 * 4 (15 octobre 2026) : FC de la session (`heartRate`), pour les statistiques.
 *
 * 5 (16 octobre 2026) : distance en action (`movingDistanceM`) et temps de vol
 * en surf (`flightS`), pour le graphique des statistiques.
 *
 * 6 (17 octobre 2026) : cadence à pied (`cadence`), pour les statistiques.
 *
 * 7 (21 octobre 2026) : bateau sans seuil d'activité, toute la session en
 * navigation (`movingTimeS`, `movingDistanceM`).
 *
 * 9 (27 octobre 2026) : arrêts complets ôtés d'office à seuil 0
 * (`stillThreshold`), détente basse jamais nulle, trous de trace (pas plus long
 * que `maxGapS`) hors du temps en mouvement et distance bornée par la corde,
 * points d'une même seconde répartis.
 *
 * 10 (27 octobre 2026) : cadence à pied (`cadence`) en pas par minute selon
 * la longueur de pas (un GPX déjà en pas n'est plus doublé), couverture sans
 * les pauses ni les trous.
 *
 * 11 (28 octobre 2026) : la Marche sans seuil d'activité (pré-réglage à 0) :
 * son temps en mouvement est recalculé.
 *
 * 12 (28 octobre 2026) : voile à seuil, temps en mouvement (`inMotionS`),
 * dénominateur du ratio de vol, de navigation ou de planing ; détection des
 * manœuvres refaite (les comptes de la fiche suivent à la réouverture).
 */
export const SUMMARY_CALC_VERSION = 12;

export type SessionSource = 'enregistrement' | 'import';

/** Résumé d'une session, en unités SI. */
export interface SessionSummary {
  calcVersion: number;
  /** Instant du premier point : c'est l'identité de la session. */
  startMs: number;
  endMs: number;
  /** Distance intégrée de la vitesse retenue (règle 6). */
  distanceM: number;
  /** Temps en action au sens du support, `null` tant que le support est inconnu. */
  movingTimeS: number | null;
  /**
   * Voile à seuil : temps en mouvement, en secondes, arrêts complets ôtés au
   * plancher d'arrêt ; dénominateur du ratio de vol (ou de navigation, de
   * planing). Absent ailleurs, et des fiches d'avant la version 12.
   */
  inMotionS?: number;
  /** Distance parcourue pendant ce temps en action (en surf, en glisse) ; absente des fiches d'avant la version 5. */
  movingDistanceM?: number | null;
  /** Dénivelé positif, `null` si la trace n'a pas assez d'altitudes. */
  elevationGainM: number | null;
  /** Plus haute vitesse lissée. */
  maxSpeedMs: number;
  pointCount: number;
  /** Intervalle médian entre deux points : la cadence d'enregistrement. */
  samplingS: number;
  /** Virements et empannages classés à la dernière analyse, s'il y en a eu une. */
  maneuverCount?: number;
  /** Réussite des virements et empannages à cette même analyse (Vmin au seuil de la session). */
  maneuverResults?: ManeuverResults;
  /** Surf : vagues, plus longue vague, et plus long vol sur foil (`null` sans foil ou sans vague). */
  waveCount?: number;
  longestWaveM?: number | null;
  longestFlightS?: number | null;
  /** Surf sur foil : temps total en vol (`null` sans foil). */
  flightS?: number | null;
  /** FC de la session, si elle en a assez (`HeartRateProfile.minCoverageS`) ; indépendante des zones du pratiquant. */
  heartRate?: SummaryHeartRate;
  /** Cadence à pied, si la session en a assez (`CadenceDetection.minCoverageS`). */
  cadence?: SummaryCadence;
  /** Test guidé de la fiche (`test`) : FC max et dernier palier tenu ; absent sans test. */
  test?: SummaryTest;
}

/** Cadence d'une session à pied dans son résumé, comme l'onglet « cadence » la mesure. */
export interface SummaryCadence {
  /** Cadence moyenne en mouvement, en pas par minute. */
  avgSpm: number;
  /** Pas comptés sur la session. */
  steps: number;
}

const readSummaryCadence = (raw: unknown): SummaryCadence | null => {
  if (!isObject(raw) || !isFiniteNumber(raw.avgSpm) || !isFiniteNumber(raw.steps)) return null;
  return { avgSpm: raw.avgSpm, steps: raw.steps };
};

/** Manœuvres réussies et manquées d'une session de voile. */
export interface ManeuverResults {
  tackSuccess: number;
  tackFail: number;
  jibeSuccess: number;
  jibeFail: number;
}

const readSummaryTest = (raw: unknown): SummaryTest | null => {
  if (!isObject(raw) || !isFiniteNumber(raw.steps)) return null;
  return { hrMaxBpm: finiteOr(raw.hrMaxBpm, null), lastStepSpeedMs: finiteOr(raw.lastStepSpeedMs, null), steps: raw.steps };
};

const readManeuverResults = (raw: unknown): ManeuverResults | null => {
  if (!isObject(raw)) return null;
  const { tackSuccess, tackFail, jibeSuccess, jibeFail } = raw;
  const counts = [tackSuccess, tackFail, jibeSuccess, jibeFail];
  if (!counts.every((n) => isFiniteNumber(n) && Number.isInteger(n) && n >= 0)) return null;
  return { tackSuccess, tackFail, jibeSuccess, jibeFail } as ManeuverResults;
};

export const sameManeuverResults = (a: ManeuverResults | undefined, b: ManeuverResults | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.tackSuccess === b.tackSuccess && a.tackFail === b.tackFail
    && a.jibeSuccess === b.jibeSuccess && a.jibeFail === b.jibeFail);

/** FC d'une session dans son résumé : zones et charge s'en recalculent avec le profil du moment. */
export interface SummaryHeartRate {
  avgBpm: number;
  maxBpm: number;
  /** Temps couvert par la FC, en secondes. */
  coveredS: number;
  /** Secondes par battement (`heartRateHistogram`). */
  histogram: HeartRateHistogram;
}

const readSummaryHeartRate = (raw: unknown): SummaryHeartRate | null => {
  if (!isObject(raw) || !isObject(raw.histogram)) return null;
  const { avgBpm, maxBpm, coveredS } = raw;
  const { fromBpm, seconds } = raw.histogram;
  if (!isFiniteNumber(avgBpm) || !isFiniteNumber(maxBpm) || !isFiniteNumber(coveredS) || !isFiniteNumber(fromBpm)) return null;
  if (!Array.isArray(seconds) || !seconds.every(isFiniteNumber)) return null;
  return { avgBpm, maxBpm, coveredS, histogram: { fromBpm, seconds: seconds as number[] } };
};

/** Notes saisies, datées de leur dernier changement. */
export type StoredSessionNotes = SailingSessionNotes & { savedAt: number };

/**
 * Réglages d'analyse propres à la session, saisis par l'utilisateur et
 * enregistrés par lui. `null` : la valeur par défaut (vent estimé, seuil du
 * support ou suggéré par l'allure, allure déduite de la trace).
 */
export interface SessionAnalysis {
  /** Direction d'où vient le vent, en degrés, dans [0, 360). */
  windDeg: number | null;
  /** Seuil d'activité, dans l'unité du profil du support (nœuds en voile). */
  activeThreshold: number | null;
  /**
   * Allure de la session imposée, en m/s, pour une trace que sa propre vitesse
   * décrit mal ; voile seulement. Elle décrit la trace, pas le support : un
   * changement de support la garde.
   */
  referenceSpeedMs: number | null;
  /**
   * Bornes du dégradé de couleur de la trace, en m/s, propres à la session ;
   * `null` : celles des Réglages du support, sinon le défaut du module.
   */
  speedRange: SpeedRangeMs | null;
  /**
   * Seuil d'effort de la détection des répétitions (fractionné sans compteur),
   * en m/s ; `null` : celui tiré de la session. Il décrit la trace : un
   * changement de support le garde. Absent des fiches plus anciennes.
   */
  effortThresholdMs: number | null;
  /**
   * Support sur foil pour cette session ; `null` : celui de son activité
   * (Réglages). Il décrit le matériel du jour : un changement d'activité le
   * garde. Absent des fiches plus anciennes.
   */
  foil: boolean | null;
  /**
   * Pumping foil pour cette session (surf, point 104 ; voile sur foil, lot 22) ; `null` : celui de son
   * activité (Réglages). Absent des fiches plus anciennes.
   */
  pumping: boolean | null;
  /**
   * Seuil de vague sur foil (surf, point 97), dans l'unité du profil : au-dessus,
   * un vol est porté par une vague ; `null` : celui du profil. Absent des fiches plus anciennes.
   */
  waveThreshold: number | null;
  /**
   * Poids du vélo et des bagages pour cette session, en kg (vélo, énergie) ;
   * `null` : celui de son activité (Réglages). Il décrit le matériel du jour :
   * un changement d'activité le garde. Absent des fiches plus anciennes.
   */
  bikeWeightKg: number | null;
  /**
   * Charge portée (sac, affaires) pour cette session, en kg (course, énergie) ;
   * `null` : celle de son activité (Réglages). Un changement d'activité la
   * garde. Absente des fiches plus anciennes.
   */
  loadKg: number | null;
  savedAt: number;
}

/**
 * Voies suivies par la trace, demandées à OpenStreetMap (`planning/overpass.ts`)
 * à la première ouverture de l'onglet « surface », puis gardées : elles ne se
 * recalculent pas sans réseau. Les débuts des morceaux sont des décalages en
 * millisecondes depuis `startMs`, l'instant du premier point apparié.
 */
export interface SessionSurfaces extends SurfaceRuns {
  source: 'overpass';
  /** Date ISO de la demande. */
  fetchedAt: string;
  /** Version de l'appariement (`WAY_MATCH_VERSION`) : une plus ancienne est refaite. */
  matchVersion: number;
  startMs: number;
}

/**
 * Altitude du terrain, demandée à l'IGN (`planning/ignAltimetry.ts`) à la
 * première ouverture de l'analyse course ou vélo, puis gardée. Un échantillon
 * tous les `stepM` mètres, repéré par son instant (`core/terrainElevation.ts`).
 */
export interface SessionTerrainElevation extends TerrainSamples {
  source: 'ign';
  /** Modèle demandé (`IGN_RESOURCE`). */
  resource: string;
  /** Version de l'échantillonnage (`TERRAIN_ELEVATION_VERSION`) : une plus ancienne est redemandée. */
  version: number;
  /** Pas des échantillons, en mètres : un autre pas réglé est redemandé. */
  stepM: number;
  /** Date ISO de la demande. */
  fetchedAt: string;
}

/**
 * Sauts d'une session (voile, course, vélo), mesurés par les capteurs du téléphone
 * (`core/jumps.ts`) : calculés depuis le `.imu` rangé à côté du GPX à
 * l'ouverture de l'analyse, puis gardés, puisqu'ils ne se tirent pas du GPX.
 */
export interface SessionJumps {
  /** Version du calcul (`JUMPS_CALC_VERSION`) : une plus ancienne est refaite si le `.imu` est là. */
  version: number;
  /** Date ISO du calcul. */
  computedAt: string;
  /**
   * Vols assez longs et assez hauts pour être rangés, dans l'ordre du temps ;
   * la hauteur minimale de l'activité et le seuil d'activité ne filtrent
   * qu'à l'affichage.
   */
  jumps: SessionJump[];
  /**
   * `false` : la capture ne mesurait pas les sauts (cadence à pied seule,
   * `setup.jumps` de son en-tête) ; la session n'a pas d'onglet « sauts ».
   */
  measured?: false;
}

export interface SessionRecord {
  format: typeof RECORD_FORMAT;
  version: number;
  /** Nom du GPX, dans le même dossier. */
  gpx: string;
  /**
   * Calcul de la session (la base de son activité), `null` pour un GPX dont on
   * n'a pas su le deviner : il choisit le module et le résumé.
   */
  sport: SportType | null;
  /**
   * Activité choisie par l'utilisateur (`core/activities.ts`), `null` si
   * aucune : la session va alors à la première activité de son calcul
   * (`sessionActivity`). Absent des fiches d'avant les activités.
   */
  activityId: string | null;
  source: SessionSource;
  /** Instant d'entrée dans la mémoire, au format ISO. */
  addedAt: string;
  /** Nom de la trace lu dans le GPX. */
  title: string | null;
  /**
   * Nom donné par l'utilisateur, `null` s'il n'en a pas donné. Le GPX et la
   * fiche gardent leur nom de fichier. Absent des fiches plus anciennes.
   */
  name: string | null;
  summary: SessionSummary;
  notes: StoredSessionNotes | null;
  /** Absent des fiches écrites avant son introduction : lu comme `null`. */
  analysis: SessionAnalysis | null;
  /** Absent tant que l'onglet « surface » n'a rien trouvé, ou si la fiche en porte de mal formées. */
  surfaces?: SessionSurfaces;
  /** Absent tant que l'IGN n'a pas répondu, ou si la fiche en porte une mal formée. */
  terrainElevation?: SessionTerrainElevation;
  /** `'gps'` : l'utilisateur garde l'altitude du GPS ; absent : celle de l'IGN (course et vélo). */
  elevationSource?: 'gps';
  /**
   * Séances du compteur faites pendant l'enregistrement (fractionné, §10,
   * point 89), datées par l'horloge du téléphone : elles ne se tirent pas du
   * GPX. Absent sans compteur, ou si la fiche en porte de mal formées.
   */
  intervals?: IntervalSeries[];
  /** Sauts mesurés (voile, course, vélo) ; absent sans `.imu`, avant leur calcul, ou si la fiche en porte de mal formés. */
  jumps?: SessionJumps;
  /**
   * Repères posés par le bouton « Note » pendant l'enregistrement, nommés ou
   * supprimés dans l'analyse ; dans l'ordre du temps. Absent sans repère.
   */
  marks?: SessionMark[];
  /**
   * Test guidé fait pendant l'enregistrement (Entraînement › Tests) : phases,
   * paliers et signaux, en heure des positions. Absent sans test, ou mal formé.
   */
  test?: SessionTest;
}


const readSummary = (raw: unknown): SessionSummary | null => {
  if (!isObject(raw)) return null;
  const { calcVersion, startMs, endMs, distanceM, maxSpeedMs, pointCount, samplingS } = raw;
  if (
    !isFiniteNumber(calcVersion) ||
    !isFiniteNumber(startMs) ||
    !isFiniteNumber(endMs) ||
    !isFiniteNumber(distanceM) ||
    !isFiniteNumber(maxSpeedMs) ||
    !isFiniteNumber(pointCount) ||
    !isFiniteNumber(samplingS)
  ) {
    return null;
  }
  const summary: SessionSummary = {
    ...raw,
    calcVersion,
    startMs,
    endMs,
    distanceM,
    movingTimeS: isFiniteNumber(raw.movingTimeS) ? raw.movingTimeS : null,
    elevationGainM: isFiniteNumber(raw.elevationGainM) ? raw.elevationGainM : null,
    maxSpeedMs,
    pointCount,
    samplingS,
  };
  if (!isFiniteNumber(raw.maneuverCount)) delete summary.maneuverCount;
  if (!isFiniteNumber(raw.inMotionS) || raw.inMotionS < 0) delete summary.inMotionS;
  const maneuverResults = readManeuverResults(raw.maneuverResults);
  if (maneuverResults) summary.maneuverResults = maneuverResults;
  else delete summary.maneuverResults;
  if ('movingDistanceM' in raw) summary.movingDistanceM = isFiniteNumber(raw.movingDistanceM) ? raw.movingDistanceM : null;
  if ('flightS' in raw) summary.flightS = isFiniteNumber(raw.flightS) ? raw.flightS : null;
  if (!isFiniteNumber(raw.waveCount)) delete summary.waveCount;
  if ('longestWaveM' in raw) summary.longestWaveM = isFiniteNumber(raw.longestWaveM) ? raw.longestWaveM : null;
  if ('longestFlightS' in raw) summary.longestFlightS = isFiniteNumber(raw.longestFlightS) ? raw.longestFlightS : null;
  const heartRate = readSummaryHeartRate(raw.heartRate);
  if (heartRate) summary.heartRate = heartRate;
  else delete summary.heartRate;
  const cadence = readSummaryCadence(raw.cadence);
  if (cadence) summary.cadence = cadence;
  else delete summary.cadence;
  const test = readSummaryTest(raw.test);
  if (test) summary.test = test;
  else delete summary.test;
  return summary;
};

/** Matériel enregistré relu : les entrées sans identifiant ou sans nom sont écartées ; aucune : `null`. */
export const readGear = (raw: unknown): GearChoice[] | null => {
  if (!Array.isArray(raw)) return null;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const gear = raw.flatMap((entry): GearChoice[] => {
    if (!isObject(entry)) return [];
    const choice = { groupId: text(entry.groupId), groupName: text(entry.groupName), itemId: text(entry.itemId), itemName: text(entry.itemName) };
    return choice.groupId !== '' && choice.itemId !== '' && choice.itemName.trim() !== '' ? [choice] : [];
  });
  return gear.length > 0 ? gear : null;
};

/** Notes relues, champ par champ : un champ absent ou mal formé reprend sa valeur vide. */
export const readNotes = (raw: unknown): StoredSessionNotes | null => {
  if (!isObject(raw)) return null;
  const text = (key: 'foil' | 'mast' | 'wing' | 'gear1' | 'gear2' | 'conditions' | 'comment') =>
    typeof raw[key] === 'string' ? (raw[key] as string) : EMPTY_NOTES[key];
  const rating = raw.rating;
  return {
    ...raw,
    foil: text('foil'),
    mast: text('mast'),
    wing: text('wing'),
    gear1: text('gear1'),
    gear2: text('gear2'),
    conditions: text('conditions'),
    gear: readGear(raw.gear),
    comment: text('comment'),
    windLevel: typeof raw.windLevel === 'string' ? (raw.windLevel as SailingSessionNotes['windLevel']) : null,
    waterState: typeof raw.waterState === 'string' ? (raw.waterState as SailingSessionNotes['waterState']) : null,
    rating: rating === 1 || rating === 2 || rating === 3 || rating === 4 || rating === 5 ? rating : null,
    savedAt: isFiniteNumber(raw.savedAt) ? raw.savedAt : 0,
  };
};

/** Nom de session saisi ou relu : rogné, `null` s'il est vide ou n'est pas un texte. */
export const readSessionName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name === '' ? null : name;
};

/** Direction ramenée dans [0, 360). */
export const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** Bornes de couleur relues : `null` si elles sont mal formées ou vides. */
const readSpeedRange = (raw: unknown): SpeedRangeMs | null =>
  isObject(raw) && isValidSpeedRange(raw) ? { minMs: raw.minMs, maxMs: raw.maxMs } : null;

/** Réglages d'analyse relus, champ par champ : une valeur mal formée revient au défaut. */
export const readAnalysis = (raw: unknown): SessionAnalysis | null => {
  if (!isObject(raw)) return null;
  return {
    ...raw,
    windDeg: isFiniteNumber(raw.windDeg) ? normalizeDeg(raw.windDeg) : null,
    activeThreshold: isFiniteNumber(raw.activeThreshold) && raw.activeThreshold >= 0 ? raw.activeThreshold : null,
    referenceSpeedMs: isFiniteNumber(raw.referenceSpeedMs) && raw.referenceSpeedMs > 0 ? raw.referenceSpeedMs : null,
    speedRange: readSpeedRange(raw.speedRange),
    effortThresholdMs: isFiniteNumber(raw.effortThresholdMs) && raw.effortThresholdMs > 0 ? raw.effortThresholdMs : null,
    foil: typeof raw.foil === 'boolean' ? raw.foil : null,
    pumping: typeof raw.pumping === 'boolean' ? raw.pumping : null,
    waveThreshold: isFiniteNumber(raw.waveThreshold) && raw.waveThreshold > 0 ? raw.waveThreshold : null,
    bikeWeightKg: isValidBikeWeight(raw.bikeWeightKg) ? raw.bikeWeightKg : null,
    loadKg: isValidCarriedLoad(raw.loadKg) ? raw.loadKg : null,
    savedAt: isFiniteNumber(raw.savedAt) ? raw.savedAt : 0,
  };
};

/** Voies relues, `null` si elles sont mal formées. */
export const readSessionSurfaces = (raw: unknown): SessionSurfaces | null => {
  if (!isObject(raw) || raw.source !== 'overpass' || typeof raw.fetchedAt !== 'string') return null;
  if (!isFiniteNumber(raw.matchVersion) || !isFiniteNumber(raw.startMs)) return null;
  const runs = readSurfaceRuns(raw, Number.MAX_SAFE_INTEGER);
  return runs ? { ...raw, ...runs, source: 'overpass', fetchedAt: raw.fetchedAt, matchVersion: raw.matchVersion, startMs: raw.startMs } : null;
};

/**
 * Altitude du terrain relue, `null` si elle est mal formée : instants entiers,
 * strictement croissants depuis 0, autant d'altitudes que d'instants.
 */
export const readTerrainElevation = (raw: unknown): SessionTerrainElevation | null => {
  if (!isObject(raw) || raw.source !== 'ign' || typeof raw.resource !== 'string' || typeof raw.fetchedAt !== 'string') return null;
  if (!isFiniteNumber(raw.version) || !isFiniteNumber(raw.stepM) || raw.stepM <= 0 || !isFiniteNumber(raw.startMs)) return null;
  const { t, z } = raw;
  if (!Array.isArray(t) || !Array.isArray(z) || t.length === 0 || t.length !== z.length) return null;
  for (let i = 0; i < t.length; i++) {
    const ti: unknown = t[i];
    if (!Number.isInteger(ti) || (i === 0 ? ti !== 0 : (ti as number) <= (t[i - 1] as number))) return null;
    if (z[i] !== null && !isFiniteNumber(z[i])) return null;
  }
  return {
    ...raw,
    source: 'ign',
    resource: raw.resource,
    version: raw.version,
    stepM: raw.stepM,
    fetchedAt: raw.fetchedAt,
    startMs: raw.startMs,
    t: t as number[],
    z: z as (number | null)[],
  };
};

const isJumpDoubt = (value: unknown): value is JumpDoubt => (JUMP_DOUBTS as readonly unknown[]).includes(value);

/** Un saut relu, `null` s'il est mal formé. */
const readSessionJump = (raw: unknown): SessionJump | null => {
  if (!isObject(raw)) return null;
  const { takeoffMs, landingMs, flightS, heightM, takeoffVerticalMs, speedMs, lengthM, doubts, curve } = raw;
  if (![takeoffMs, landingMs, flightS, heightM, takeoffVerticalMs].every(isFiniteNumber)) return null;
  if ((speedMs !== null && !isFiniteNumber(speedMs)) || (lengthM !== null && !isFiniteNumber(lengthM))) return null;
  if (!Array.isArray(doubts) || !doubts.every(isJumpDoubt)) return null;
  if (!isObject(curve) || !isFiniteNumber(curve.stepS) || curve.stepS <= 0 || !isFiniteNumber(curve.startS)) return null;
  if (!Array.isArray(curve.heightsM) || !curve.heightsM.every(isFiniteNumber)) return null;
  return {
    takeoffMs: takeoffMs as number,
    landingMs: landingMs as number,
    flightS: flightS as number,
    heightM: heightM as number,
    takeoffVerticalMs: takeoffVerticalMs as number,
    speedMs: speedMs as number | null,
    lengthM: lengthM as number | null,
    doubts,
    curve: { stepS: curve.stepS, startS: curve.startS, heightsM: curve.heightsM },
  };
};

/** Sauts relus, `null` s'ils sont mal formés : ils seront refaits depuis le `.imu`. */
export const readSessionJumps = (raw: unknown): SessionJumps | null => {
  if (!isObject(raw) || !isFiniteNumber(raw.version) || typeof raw.computedAt !== 'string' || !Array.isArray(raw.jumps)) return null;
  const jumps = raw.jumps.map(readSessionJump);
  if (jumps.some((j) => j === null)) return null;
  return { version: raw.version, computedAt: raw.computedAt, jumps: jumps as SessionJump[], ...(raw.measured === false ? { measured: false as const } : {}) };
};

/**
 * Fiche relue sans son résumé, mal formé (un `NaN` écrit `null`, une retouche
 * à la main) : il se refait depuis le GPX, et le reste (nom, notes, réglages)
 * est gardé.
 */
export type RecordWithoutSummary = Omit<SessionRecord, 'summary'> & { summary: SessionSummary | null };

/**
 * Champ connu de la fiche que la lecture n'a pas su rendre tel quel (forme
 * nouvelle écrite par une version plus récente, valeur hors des bornes) :
 * `raw` est le texte du disque, relu en JSON, `read` ce que la lecture en a
 * fait (`undefined` : champ écarté).
 */
export interface UnreadableField {
  raw: unknown;
  read: unknown;
}

/**
 * Champs illisibles d'une fiche, par chemin : `surfaces` au premier niveau,
 * `summary.heartRate` ou `analysis.windDeg` dans un objet. Gardés hors de la
 * fiche (le cache allégé la recopie champ à champ), et rendus par
 * `serializeRecord` tant que la valeur n'a pas changé depuis la lecture : une
 * version plus ancienne qui renomme une session ne perd rien de ce qu'une plus
 * récente y avait rangé.
 */
export type RecordUnreadable = Readonly<Record<string, UnreadableField>>;

/** Champs de premier niveau dont la lecture peut perdre quelque chose. */
const GUARDED_FIELDS = ['sport', 'surfaces', 'terrainElevation', 'elevationSource', 'intervals', 'jumps', 'marks', 'test'] as const;
/** Objets relus champ par champ : un champ illisible y est gardé seul ; l'objet entier s'il est illisible (sauf le résumé, refait depuis le GPX). */
const GUARDED_OBJECTS = ['summary', 'analysis', 'notes'] as const;

/** Tri des clés, pour comparer deux valeurs JSON sans dépendre de l'ordre de leurs champs. */
const sortedJson = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortedJson)
    : isObject(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]))
      : value;

/** Vrai si les deux valeurs s'écrivent pareil en JSON, à l'ordre des champs près (`undefined` : absent). */
const sameJson = (a: unknown, b: unknown): boolean => {
  const textA = JSON.stringify(a);
  const textB = JSON.stringify(b);
  if (textA === undefined || textB === undefined) return textA === textB;
  return textA === textB || JSON.stringify(sortedJson(JSON.parse(textA))) === JSON.stringify(sortedJson(JSON.parse(textB)));
};

/** Champs illisibles d'une fiche relue (`parts`), d'après son JSON brut (`raw`). */
const unreadableFields = (raw: Record<string, unknown>, parts: RecordWithoutSummary): RecordUnreadable => {
  const lost: Record<string, UnreadableField> = {};
  const read = parts as unknown as Record<string, unknown>;
  for (const key of GUARDED_FIELDS) {
    if (raw[key] !== undefined && !sameJson(read[key], raw[key])) lost[key] = { raw: raw[key], read: read[key] };
  }
  for (const key of GUARDED_OBJECTS) {
    const rawObject = raw[key];
    const readObject = read[key];
    if (rawObject === undefined || rawObject === null) continue;
    if (!isObject(readObject)) {
      // Résumé illisible : refait depuis le GPX, sans garder son brut (DECISIONS §8).
      if (key !== 'summary') lost[key] = { raw: rawObject, read: readObject };
      continue;
    }
    if (!isObject(rawObject)) continue;
    for (const [field, value] of Object.entries(rawObject)) {
      if (value !== undefined && !sameJson(readObject[field], value)) lost[`${key}.${field}`] = { raw: value, read: readObject[field] };
    }
  }
  return lost;
};

/** Fiche lue, et ses champs illisibles (`RecordUnreadable`), à rendre à l'écriture. */
export interface ParsedRecord {
  parts: RecordWithoutSummary;
  unreadable: RecordUnreadable;
}

/**
 * Lit une fiche, résumé compris s'il est lisible. Rend `null` si le texte
 * n'est pas une fiche : JSON mal formé, autre format, GPX non nommé. Les
 * champs absents, ceux qu'une ancienne version ignorait, restent nuls ; les
 * champs inconnus sont gardés tels quels ; les champs connus illisibles sont
 * rendus à part, bruts (`unreadable`).
 */
export const parseRecordWithRaw = (text: string): ParsedRecord | null => {
  const raw = parseJson(text);
  const parts = readRecordParts(raw);
  return parts && isObject(raw) ? { parts, unreadable: unreadableFields(raw, parts) } : null;
};

/** Lit une fiche, résumé compris s'il est lisible (`parseRecordWithRaw`, sans les champs illisibles). */
export const parseRecordParts = (text: string): RecordWithoutSummary | null => parseRecordWithRaw(text)?.parts ?? null;

const readRecordParts = (raw: unknown): RecordWithoutSummary | null => {
  if (!isObject(raw) || raw.format !== RECORD_FORMAT || !isFiniteNumber(raw.version)) return null;
  if (typeof raw.gpx !== 'string' || raw.gpx === '') return null;
  const summary = readSummary(raw.summary);
  const { surfaces: rawSurfaces, terrainElevation: rawTerrain, elevationSource: rawSource, intervals: rawIntervals, jumps: rawJumps, marks: rawMarks, test: rawTest, ...rest } = raw;
  const surfaces = readSessionSurfaces(rawSurfaces);
  const terrainElevation = readTerrainElevation(rawTerrain);
  const intervals = readIntervalSeries(rawIntervals);
  const jumps = readSessionJumps(rawJumps);
  const marks = readSessionMarks(rawMarks);
  const test = readSessionTest(rawTest);
  return {
    ...rest,
    format: RECORD_FORMAT,
    version: raw.version,
    gpx: raw.gpx,
    sport: isSportType(raw.sport) ? raw.sport : null,
    activityId: typeof raw.activityId === 'string' && raw.activityId !== '' ? raw.activityId : null,
    source: raw.source === 'enregistrement' ? 'enregistrement' : 'import',
    // Sans date d'entrée : celle de la trace, sinon maintenant, puisqu'elle entre dans la mémoire.
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date(summary?.startMs ?? Date.now()).toISOString(),
    title: typeof raw.title === 'string' ? raw.title : null,
    name: readSessionName(raw.name),
    summary,
    notes: readNotes(raw.notes),
    analysis: readAnalysis(raw.analysis),
    ...(surfaces ? { surfaces } : {}),
    ...(terrainElevation ? { terrainElevation } : {}),
    ...(rawSource === 'gps' ? { elevationSource: 'gps' as const } : {}),
    ...(intervals ? { intervals } : {}),
    ...(jumps ? { jumps } : {}),
    ...(marks ? { marks } : {}),
    ...(test ? { test } : {}),
  };
};

/** Lit une fiche, `null` si elle n'est pas lisible ou si son résumé ne l'est pas (`parseRecordParts`). */
export const parseRecord = (text: string): SessionRecord | null => {
  const parts = parseRecordParts(text);
  return parts?.summary ? { ...parts, summary: parts.summary } : null;
};

/**
 * Fiche à écrire, champs illisibles à la lecture (`unreadable`) rendus bruts
 * là où la valeur n'a pas changé depuis : une valeur neuve l'emporte.
 */
const withUnreadable = (record: SessionRecord, unreadable: RecordUnreadable): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...record };
  for (const [path, { raw, read }] of Object.entries(unreadable)) {
    const dot = path.indexOf('.');
    if (dot < 0) {
      if (sameJson(out[path], read)) out[path] = raw;
      continue;
    }
    const key = path.slice(0, dot);
    const field = path.slice(dot + 1);
    const parent = out[key];
    if (isObject(parent) && sameJson(parent[field], read)) out[key] = { ...parent, [field]: raw };
  }
  return out;
};

/**
 * Texte de la fiche, indenté pour rester lisible dans un éditeur. `unreadable` :
 * champs illisibles à sa lecture (`parseRecordWithRaw`), réécrits tels quels
 * s'ils n'ont pas changé depuis.
 */
export const serializeRecord = (record: SessionRecord, unreadable?: RecordUnreadable): string => {
  const out = unreadable && Object.keys(unreadable).length > 0 ? withUnreadable(record, unreadable) : record;
  return `${JSON.stringify(out, null, 2)}\n`;
};

/** Faux pour une fiche écrite par une version plus récente : on la lit sans jamais la réécrire. */
export const isWritableRecord = (record: Pick<SessionRecord, 'version'>): boolean => record.version <= RECORD_VERSION;

/**
 * Fiche de la mémoire complétée par celle d'une copie de la même session
 * (import d'un GPX complet, `library/sessionBundle.ts`, ou d'un GPX et de sa
 * fiche) : support et activité inconnus, séances du compteur, repères, test, nom,
 * notes, réglages, sauts, voies et altitude qu'elle n'a pas encore. Rien de ce
 * qu'elle porte n'est écrasé ; rend la même fiche si rien ne manque.
 * `resummarize` : le résumé est à refaire (support, activité, réglages,
 * altitude ou test reçus).
 */
export const completeRecord = (
  existing: SessionRecord,
  incoming: RecordWithoutSummary
): { record: SessionRecord; resummarize: boolean } => {
  const patch: Partial<SessionRecord> = {};
  if (existing.sport === null && incoming.sport !== null) patch.sport = incoming.sport;
  if (existing.activityId === null && incoming.activityId !== null && (patch.sport ?? existing.sport) === incoming.sport) {
    patch.activityId = incoming.activityId;
  }
  if (!existing.intervals?.length && incoming.intervals?.length) patch.intervals = incoming.intervals;
  if (!existing.marks?.length && incoming.marks?.length) patch.marks = incoming.marks;
  if (!existing.test && incoming.test) patch.test = incoming.test;
  if (existing.name === null && incoming.name !== null) patch.name = incoming.name;
  if (existing.notes === null && incoming.notes !== null) patch.notes = incoming.notes;
  if (existing.analysis === null && incoming.analysis !== null) patch.analysis = incoming.analysis;
  if (!existing.jumps && incoming.jumps) patch.jumps = incoming.jumps;
  if (!existing.surfaces && incoming.surfaces) patch.surfaces = incoming.surfaces;
  if (!existing.terrainElevation && incoming.terrainElevation) patch.terrainElevation = incoming.terrainElevation;
  if (!existing.elevationSource && incoming.elevationSource) patch.elevationSource = incoming.elevationSource;
  if (Object.keys(patch).length === 0) return { record: existing, resummarize: false };
  const resummarize = ['sport', 'activityId', 'analysis', 'terrainElevation', 'elevationSource', 'test'].some((key) => key in patch);
  return { record: { ...existing, ...patch }, resummarize };
};

/** Vrai si le résumé a été calculé par une version antérieure du calcul. */
export const isSummaryStale = (record: SessionRecord): boolean =>
  record.summary.calcVersion < SUMMARY_CALC_VERSION;

/** Nom de la fiche d'un GPX : même nom, extension `.json`. */
export const recordFileName = (gpxName: string): string => gpxName.replace(/\.gpx$/i, '') + '.json';

/** Nom du fichier des capteurs d'un GPX (`core/imuFile.ts`) : même nom, extension `.imu`. */
export const imuFileName = (gpxName: string): string => gpxName.replace(/\.gpx$/i, '') + '.imu';

export const isGpxFileName = (name: string): boolean => /\.gpx$/i.test(name);

/**
 * Notes saisies avant l'existence du dossier mémoire (`tracker.sailingNotes`),
 * rangées sous `nom de trace ou de fichier|instant du premier point`. Le nom a
 * pu changer depuis, l'instant non : c'est lui qui les retrouve.
 */
export const findLegacyNotes = (
  legacy: Record<string, unknown> | null,
  startMs: number
): StoredSessionNotes | null => {
  if (!legacy) return null;
  const suffix = `|${startMs}`;
  for (const [key, value] of Object.entries(legacy)) {
    if (!key.endsWith(suffix)) continue;
    const notes = readNotes(value);
    if (notes) return notes;
  }
  return null;
};

/**
 * Champs d'une fiche gardés dans le cache de la bibliothèque : ce que la liste
 * montre et ce que l'utilisateur saisit. Le reste (altitude du terrain, voies,
 * sauts, champs d'une version future) pèse lourd et ne sert qu'à l'analyse :
 * il est relu sur le disque quand on en a besoin.
 */
export const RECORD_LIGHT_FIELDS = [
  'format', 'version', 'gpx', 'sport', 'activityId', 'source', 'addedAt', 'title', 'name',
  'summary', 'notes', 'analysis', 'elevationSource', 'intervals', 'marks', 'test',
] as const satisfies readonly (keyof SessionRecord)[];

const LIGHT_FIELDS: ReadonlySet<string> = new Set(RECORD_LIGHT_FIELDS);

/** Fiche réduite aux champs légers (`RECORD_LIGHT_FIELDS`), pour le cache. */
export const lightRecord = (record: SessionRecord): SessionRecord =>
  Object.fromEntries(Object.entries(record).filter(([key]) => LIGHT_FIELDS.has(key))) as unknown as SessionRecord;

/**
 * Fiche entière, tirée de celle du disque (`disk`) et de la fiche allégée
 * tenue en mémoire (`light`) : les champs lourds et inconnus viennent du
 * disque, les champs légers de la mémoire seule, qui porte les saisies. Un
 * champ léger retiré en mémoire (la source de l'altitude) ne revient donc pas ;
 * un champ lourd posé en mémoire depuis (altitude trouvée) l'emporte.
 */
export const mergeLightRecord = (disk: SessionRecord, light: SessionRecord): SessionRecord => ({
  ...(Object.fromEntries(Object.entries(disk).filter(([key]) => !LIGHT_FIELDS.has(key))) as Partial<SessionRecord>),
  ...light,
});

/** Une session montrée par la bibliothèque : la fiche, et ce qu'on sait de son état. */
export interface LibrarySession {
  /** Nom du GPX dans `sessions/` : la clé de stockage. */
  file: string;
  record: SessionRecord;
  /** Vrai si la fiche ne doit pas être réécrite : version future, ou fiche illisible gardée telle quelle. */
  readOnly: boolean;
  /** Ce qui cloche, en clair, s'il y a lieu. */
  warning: string | null;
  /**
   * Vrai si la fiche vient du cache allégé (`lightRecord`) : altitude du
   * terrain, voies et sauts n'y sont pas encore. La bibliothèque la relit en
   * entier avant de l'écrire ou de l'ouvrir dans une analyse.
   */
  partial?: boolean;
}

/**
 * Une seule session par identité. Deux fichiers de la même trace arrivent
 * quand on fusionne deux dossiers où elle porte des noms différents : on garde
 * celle qui a des notes, sinon le premier nom dans l'ordre alphabétique, et
 * l'on rend les autres pour les signaler.
 */
export const dedupeSessions = (
  sessions: LibrarySession[]
): { kept: LibrarySession[]; duplicates: LibrarySession[] } => {
  const byStart = new Map<number, LibrarySession>();
  const duplicates: LibrarySession[] = [];
  const sorted = [...sessions].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const session of sorted) {
    const key = session.record.summary.startMs;
    const current = byStart.get(key);
    if (!current) {
      byStart.set(key, session);
    } else if (!current.record.notes && session.record.notes) {
      byStart.set(key, session);
      duplicates.push(current);
    } else {
      duplicates.push(session);
    }
  }
  const kept = [...byStart.values()].sort((a, b) => b.record.summary.startMs - a.record.summary.startMs);
  return { kept, duplicates };
};

/** Changement demandé sur une fiche ; un champ absent n'est pas touché. */
export interface RecordPatch {
  sport?: SportType | null;
  /** Activité ; `null` : la première de son calcul. */
  activityId?: string | null;
  /** Nom donné par l'utilisateur ; vide ou `null` : plus de nom. */
  name?: string | null;
  notes?: StoredSessionNotes | null;
  analysis?: SessionAnalysis | null;
  maneuverCount?: number;
  maneuverResults?: ManeuverResults;
  /** Voies trouvées pour la trace ; `null` les retire. */
  surfaces?: SessionSurfaces | null;
  /** Altitude du terrain ; `null` la retire. */
  terrainElevation?: SessionTerrainElevation | null;
  /** Source de l'altitude ; `null` : celle de l'IGN. */
  elevationSource?: 'gps' | null;
  /** Sauts calculés ; `null` les retire. */
  jumps?: SessionJumps | null;
  /** Repères du bouton « Note » ; `null` ou une liste vide les retire. */
  marks?: SessionMark[] | null;
}

/**
 * Fiche après un changement : support, activité, nom, notes, réglages
 * d'analyse, nombre et réussite des manœuvres, voies suivies, altitude du terrain et sa
 * source, sauts, repères. Rend la fiche d'origine, à l'identique, si rien ne change.
 * `resummarize` : le résumé est à recalculer (support, activité, seuil, allure
 * imposée, altitude ou source de l'altitude changés).
 *
 * Un changement de support efface le seuil propre à la session, exprimé dans
 * l'unité de l'ancien support ; un changement de traitement (voile ↔ course ↔
 * vélo) efface aussi ses bornes de couleur, pensées pour les vitesses de
 * l'autre sport : passer de la course au fractionné à pied les garde. Le vent saisi, l'allure imposée (elle décrit la trace) et les notes
 * restent : sans effet en course, ils reviennent si la session repasse en
 * voile.
 */
export const applyRecordPatch = (record: SessionRecord, patch: RecordPatch): { record: SessionRecord; resummarize: boolean } => {
  const original = record;
  let next = record;
  if (patch.name !== undefined) {
    const name = readSessionName(patch.name);
    if (name !== next.name) next = { ...next, name };
  }
  if (patch.notes !== undefined) next = { ...next, notes: patch.notes };
  if (patch.jumps !== undefined) {
    const { jumps: _previous, ...others } = next;
    next = patch.jumps ? { ...others, jumps: patch.jumps } : others;
  }
  if (patch.marks !== undefined) {
    const { marks: _previous, ...others } = next;
    next = patch.marks?.length ? { ...others, marks: patch.marks } : others;
  }
  if (patch.surfaces !== undefined) {
    const { surfaces: _previous, ...others } = next;
    next = patch.surfaces ? { ...others, surfaces: patch.surfaces } : others;
  }
  // L'altitude change le dénivelé du résumé.
  let elevationChanged = false;
  if (patch.terrainElevation !== undefined && (patch.terrainElevation ?? undefined) !== next.terrainElevation) {
    const { terrainElevation: _previous, ...others } = next;
    next = patch.terrainElevation ? { ...others, terrainElevation: patch.terrainElevation } : others;
    elevationChanged = true;
  }
  if (patch.elevationSource !== undefined && (patch.elevationSource ?? undefined) !== next.elevationSource) {
    const { elevationSource: _previous, ...others } = next;
    next = patch.elevationSource ? { ...others, elevationSource: patch.elevationSource } : others;
    elevationChanged = true;
  }
  const thresholdBefore = next.analysis?.activeThreshold ?? null;
  const referenceBefore = next.analysis?.referenceSpeedMs ?? null;
  // En surf, le foil et le seuil de vague changent les vagues du résumé.
  const foilBefore = next.analysis?.foil ?? null;
  const waveBefore = next.analysis?.waveThreshold ?? null;
  if (patch.analysis !== undefined) next = { ...next, analysis: patch.analysis };
  if (patch.maneuverCount !== undefined && patch.maneuverCount !== next.summary.maneuverCount) {
    next = { ...next, summary: { ...next.summary, maneuverCount: patch.maneuverCount } };
  }
  if (patch.maneuverResults !== undefined && !sameManeuverResults(patch.maneuverResults, next.summary.maneuverResults)) {
    next = { ...next, summary: { ...next.summary, maneuverResults: patch.maneuverResults } };
  }
  const activityChanged = patch.activityId !== undefined && patch.activityId !== next.activityId;
  if (activityChanged) next = { ...next, activityId: patch.activityId ?? null };
  const sportChanged = patch.sport !== undefined && patch.sport !== next.sport;
  if (sportChanged) {
    const before = next.sport;
    const after = patch.sport ?? null;
    const treatmentChanged = before !== null && after !== null && sportTreatment(before) !== sportTreatment(after);
    next = { ...next, sport: after };
    if (next.analysis) {
      const cleared = {
        ...next.analysis,
        activeThreshold: null,
        waveThreshold: null,
        ...(treatmentChanged ? { speedRange: null } : {}),
      };
      if (
        cleared.activeThreshold !== next.analysis.activeThreshold || cleared.speedRange !== next.analysis.speedRange
        || cleared.waveThreshold !== (next.analysis.waveThreshold ?? null)
      ) {
        next = { ...next, analysis: cleared };
      }
    }
  }
  if (next === original) return { record: original, resummarize: false };
  const analysisChanged =
    (next.analysis?.activeThreshold ?? null) !== thresholdBefore ||
    (next.analysis?.referenceSpeedMs ?? null) !== referenceBefore ||
    (next.analysis?.foil ?? null) !== foilBefore ||
    (next.analysis?.waveThreshold ?? null) !== waveBefore;
  return { record: next, resummarize: sportChanged || activityChanged || analysisChanged || elevationChanged };
};
