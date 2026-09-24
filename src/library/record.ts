import type { SportType } from '../core/types';
import { isSportType } from '../recording/session';
import { EMPTY_NOTES, type SailingSessionNotes } from '../sailing/sessionNotes';

/**
 * Fiche d'une session : le fichier JSON rangé à côté de son GPX dans le
 * dossier mémoire (`docs/ETAT_DU_PROJET.md` §6).
 *
 * Le GPX fait foi. La fiche en garde un résumé, pour afficher la liste sans
 * relire les traces, et ce que l'utilisateur a saisi : support, notes. Tout
 * se recalcule depuis le GPX, sauf les notes.
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
 */
export const SUMMARY_CALC_VERSION = 1;

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

export interface SessionRecord {
  format: typeof RECORD_FORMAT;
  version: number;
  /** Nom du GPX, dans le même dossier. */
  gpx: string;
  /** Support, `null` pour un GPX dont on n'a pas su le deviner. */
  sport: SportType | null;
  source: SessionSource;
  /** Instant d'entrée dans la mémoire, au format ISO. */
  addedAt: string;
  /** Nom de la trace lu dans le GPX. */
  title: string | null;
  summary: SessionSummary;
  notes: StoredSessionNotes | null;
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
  return {
    ...raw,
    format: RECORD_FORMAT,
    version: raw.version,
    gpx: raw.gpx,
    sport: isSportType(raw.sport) ? raw.sport : null,
    source: raw.source === 'enregistrement' ? 'enregistrement' : 'import',
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date(summary.startMs).toISOString(),
    title: typeof raw.title === 'string' ? raw.title : null,
    summary,
    notes: readNotes(raw.notes),
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

/** Une session montrée par la bibliothèque : la fiche, et ce qu'on sait de son état. */
export interface LibrarySession {
  /** Nom du GPX dans `sessions/` : la clé de stockage. */
  file: string;
  record: SessionRecord;
  /** Vrai si la fiche ne doit pas être réécrite : version future, ou fiche illisible gardée telle quelle. */
  readOnly: boolean;
  /** Ce qui cloche, en clair, s'il y a lieu. */
  warning: string | null;
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
