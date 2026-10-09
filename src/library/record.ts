import { JUMP_DOUBTS, type JumpDoubt, type SessionJump } from '../core/jumps';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import { ELEVATION_PRESETS, sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import type { TerrainSamples } from '../core/terrainElevation';
import { readSurfaceRuns, type SurfaceRuns } from '../planning/surface';
import { readIntervalSeries, type IntervalSeries } from '../recording/intervalTimer';
import { isSportType } from '../recording/session';
import { EMPTY_NOTES, type SailingSessionNotes } from '../sailing/sessionNotes';

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
 */
export const SUMMARY_CALC_VERSION = 2;

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
  /** Dénivelé positif, `null` si la trace n'a pas assez d'altitudes. */
  elevationGainM: number | null;
  /** Plus haute vitesse lissée. */
  maxSpeedMs: number;
  pointCount: number;
  /** Intervalle médian entre deux points : la cadence d'enregistrement. */
  samplingS: number;
  /** Virements et empannages classés à la dernière analyse, s'il y en a eu une. */
  maneuverCount?: number;
}

/** Notes saisies, datées de leur dernier changement. */
export type StoredSessionNotes = SailingSessionNotes & { savedAt: number };

/** Terrain du dénivelé, une clé de `ELEVATION_PRESETS`. */
export type SessionTerrain = keyof typeof ELEVATION_PRESETS;

export const isSessionTerrain = (value: unknown): value is SessionTerrain =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ELEVATION_PRESETS, value);

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
   * Terrain du dénivelé (route, trail) pour cette session, course et vélo ;
   * `null` : celui de son activité (Réglages). Il décrit le parcours : un
   * changement d'activité le garde. Absent des fiches plus anciennes.
   */
  terrain: SessionTerrain | null;
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
 * Sauts d'une session de voile, mesurés par les capteurs du téléphone
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
  /** Sauts mesurés (voile) ; absent sans `.imu`, avant leur calcul, ou si la fiche en porte de mal formés. */
  jumps?: SessionJumps;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

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
  return summary;
};

/** Notes relues, champ par champ : un champ absent ou mal formé reprend sa valeur vide. */
export const readNotes = (raw: unknown): StoredSessionNotes | null => {
  if (!isObject(raw)) return null;
  const text = (key: 'foil' | 'mast' | 'wing' | 'comment') =>
    typeof raw[key] === 'string' ? (raw[key] as string) : EMPTY_NOTES[key];
  const rating = raw.rating;
  return {
    ...raw,
    foil: text('foil'),
    mast: text('mast'),
    wing: text('wing'),
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
    terrain: isSessionTerrain(raw.terrain) ? raw.terrain : null,
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
  return { version: raw.version, computedAt: raw.computedAt, jumps: jumps as SessionJump[] };
};

/**
 * Lit une fiche. Rend `null` si le texte n'est pas une fiche lisible : JSON
 * mal formé, autre format, champ indispensable absent. Les champs inconnus
 * sont gardés tels quels.
 */
export const parseRecord = (text: string): SessionRecord | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.format !== RECORD_FORMAT || !isFiniteNumber(raw.version)) return null;
  if (typeof raw.gpx !== 'string' || raw.gpx === '') return null;
  const summary = readSummary(raw.summary);
  if (!summary) return null;
  const { surfaces: rawSurfaces, terrainElevation: rawTerrain, elevationSource: rawSource, intervals: rawIntervals, jumps: rawJumps, ...rest } = raw;
  const surfaces = readSessionSurfaces(rawSurfaces);
  const terrainElevation = readTerrainElevation(rawTerrain);
  const intervals = readIntervalSeries(rawIntervals);
  const jumps = readSessionJumps(rawJumps);
  return {
    ...rest,
    format: RECORD_FORMAT,
    version: raw.version,
    gpx: raw.gpx,
    sport: isSportType(raw.sport) ? raw.sport : null,
    activityId: typeof raw.activityId === 'string' && raw.activityId !== '' ? raw.activityId : null,
    source: raw.source === 'enregistrement' ? 'enregistrement' : 'import',
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date(summary.startMs).toISOString(),
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
  };
};

/** Texte de la fiche, indenté pour rester lisible dans un éditeur. */
export const serializeRecord = (record: SessionRecord): string => `${JSON.stringify(record, null, 2)}\n`;

/** Faux pour une fiche écrite par une version plus récente : on la lit sans jamais la réécrire. */
export const isWritableRecord = (record: SessionRecord): boolean => record.version <= RECORD_VERSION;

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
  'summary', 'notes', 'analysis', 'elevationSource', 'intervals',
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
  /** Voies trouvées pour la trace ; `null` les retire. */
  surfaces?: SessionSurfaces | null;
  /** Altitude du terrain ; `null` la retire. */
  terrainElevation?: SessionTerrainElevation | null;
  /** Source de l'altitude ; `null` : celle de l'IGN. */
  elevationSource?: 'gps' | null;
  /** Sauts calculés ; `null` les retire. */
  jumps?: SessionJumps | null;
}

/**
 * Fiche après un changement : support, activité, nom, notes, réglages
 * d'analyse, nombre de manœuvres, voies suivies, altitude du terrain et sa
 * source, sauts. Rend la fiche d'origine, à l'identique, si rien ne change.
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
  const terrainBefore = next.analysis?.terrain ?? null;
  if (patch.analysis !== undefined) next = { ...next, analysis: patch.analysis };
  if (patch.maneuverCount !== undefined && patch.maneuverCount !== next.summary.maneuverCount) {
    next = { ...next, summary: { ...next.summary, maneuverCount: patch.maneuverCount } };
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
        ...(treatmentChanged ? { speedRange: null } : {}),
      };
      if (cleared.activeThreshold !== next.analysis.activeThreshold || cleared.speedRange !== next.analysis.speedRange) {
        next = { ...next, analysis: cleared };
      }
    }
  }
  if (next === original) return { record: original, resummarize: false };
  const analysisChanged =
    (next.analysis?.activeThreshold ?? null) !== thresholdBefore ||
    (next.analysis?.referenceSpeedMs ?? null) !== referenceBefore ||
    (next.analysis?.terrain ?? null) !== terrainBefore;
  return { record: next, resummarize: sportChanged || activityChanged || analysisChanged || elevationChanged };
};
