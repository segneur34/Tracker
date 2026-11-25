import { addRecordEdits, mergeChangedRecord } from './recordMerge';
import {
  RECORD_EDIT_FIELDS, isWritableRecord, parseRecordWithRaw, sameJson, serializeRecord, withoutCarriedSettings,
  type RecordUnreadable, type SessionRecord,
} from './record';
import type { SyncSideName } from './syncBase';

/**
 * Fusion des deux fiches d'une même session, celle de l'ordinateur et celle du téléphone, à la synchronisation.
 *
 * Chaque côté garde ce qui lui est propre : le nom de son GPX, sa date d'entrée, et son résumé, qui dépend des
 * réglages de l'appareil. Si le résumé voyageait, chaque appareil le referait avec ses seuils, réécrirait sa fiche,
 * et les deux se la renverraient sans fin : une fiche dont seul le résumé a changé n'est donc pas « changée ».
 * Seuls voyagent, du résumé, les champs que l'analyse y pose (manœuvres, vent, puissance).
 *
 * Avec la fiche de chaque côté à la dernière synchronisation (son ancêtre), c'est une fusion à trois : ce qu'un côté
 * a changé depuis passe à l'autre. Même champ changé des deux côtés : c'est un conflit, dit, et l'ordinateur
 * l'emporte. Aucune date ne départage : les horloges des deux appareils ne sont pas réglées ensemble, et chaque bloc
 * de notes ou de réglages garde la date de son appareil (`mergeChangedRecord`, `datedByClock: false`). La version qui
 * perd n'est gardée nulle part : la session reste une, la même des deux côtés. Sans ancêtre d'un côté ou de l'autre
 * (première rencontre, copie gardée perdue), ou avec une fiche refaite depuis (sa date d'entrée a changé : le GPX a
 * été remis, ou sa fiche perdue puis recréée vide), rien ne prouve qu'un champ vide a été vidé exprès : les deux fiches
 * se complètent, rien n'est effacé.
 */

/** Champs qui décrivent le fichier d'un côté, pas la session : ils ne passent jamais de l'un à l'autre. */
const SIDE_FIELDS: ReadonlySet<string> = new Set(['format', 'version', 'gpx', 'source', 'addedAt']);

const EDIT_FIELDS: ReadonlySet<string> = new Set(RECORD_EDIT_FIELDS);

/** Les deux fiches viennent de deux appareils : leurs dates ne se comparent pas. */
const ACROSS_DEVICES = { datedByClock: false } as const;

interface ReadRecord {
  record: SessionRecord;
  unreadable: RecordUnreadable;
}

const readRecord = (text: string | null): ReadRecord | null => {
  const parsed = text === null ? null : parseRecordWithRaw(text);
  return parsed?.parts.summary ? { record: { ...parsed.parts, summary: parsed.parts.summary }, unreadable: parsed.unreadable } : null;
};

/** `ok` : fiche qui se fond et se réécrit ; `future` : d'une version plus récente, jamais réécrite ; `unreadable` : pas une fiche, ou sans résumé lisible. */
export type SyncRecordState = 'ok' | 'future' | 'unreadable';

export interface SyncRecordInfo {
  state: SyncRecordState;
  /** Identité de la session d'après sa fiche ; `null` si elle ne se lit pas. */
  startMs: number | null;
  record: SessionRecord | null;
}

/** Ce que la synchronisation peut faire d'une fiche, d'après son texte. */
export const inspectSyncRecord = (text: string): SyncRecordInfo => {
  const read = readRecord(text);
  if (!read) return { state: 'unreadable', startMs: null, record: null };
  return { state: isWritableRecord(read.record) ? 'ok' : 'future', startMs: read.record.summary.startMs, record: read.record };
};

/** Texte d'une fiche recopiée à côté d'un GPX d'un autre nom ; `null` si elle ne se réécrit pas. */
export const renamedSyncRecord = (text: string, gpx: string): string | null => {
  const read = readRecord(text);
  return read && isWritableRecord(read.record) ? serializeRecord({ ...read.record, gpx }, read.unreadable) : null;
};

/** Chemins changés entre deux états d'une fiche, sans le résumé ni ce qui est propre à un côté ; `editsOnly` : les seuls champs saisis. */
const editsSince = (before: SessionRecord, after: SessionRecord, editsOnly: boolean): Map<string, unknown> => {
  const edits = new Map<string, unknown>();
  // Un bloc né depuis se compare champ par champ à un bloc vide : seuls ses champs remplis passent, et ceux que
  // l'autre côté aurait remplis de son côté ne sont pas écrasés par le bloc entier.
  const from = { ...before, notes: before.notes ?? blankBlock(after.notes), analysis: before.analysis ?? blankBlock(after.analysis) };
  addRecordEdits(edits, from, after);
  for (const path of [...edits.keys()]) {
    const top = path.split('.')[0];
    if (path === 'summary' || SIDE_FIELDS.has(top) || (editsOnly && !EDIT_FIELDS.has(top))) edits.delete(path);
  }
  return edits;
};

/** Bloc daté vidé champ par champ : textes vides, le reste nul. */
const blankBlock = <T extends { savedAt: number }>(block: T | null): T | null =>
  block && (Object.fromEntries(Object.entries(block).map(([key, value]) => [key, key === 'savedAt' ? value : typeof value === 'string' ? '' : null])) as T);

/**
 * La même fiche, sans rien de saisi ni de ce qui ne se tire pas du GPX seul (séances du compteur et test, faits pendant
 * l'enregistrement ; sauts, voies et altitude, calculés à part) : l'ancêtre supposé quand il n'y en a pas.
 */
const blank = (record: SessionRecord): SessionRecord => {
  const {
    place: _place, marks: _marks, mapBase: _mapBase, jumps: _jumps, elevationSource: _source, intervals: _intervals, test: _test,
    surfaces: _surfaces, terrainElevation: _terrain, ...rest
  } = record;
  return { ...rest, sport: null, activityId: null, name: null, notes: blankBlock(record.notes), analysis: blankBlock(record.analysis) };
};

/** Ce qu'une fiche porte, à apporter à l'autre faute d'ancêtre : ses champs non vides. */
const carriedFields = (record: SessionRecord, editsOnly: boolean): Map<string, unknown> => {
  const edits = editsSince(blank(record), record, editsOnly);
  if (record.marks?.length === 0) edits.delete('marks');
  return edits;
};

/**
 * Le calcul et l'activité vont ensemble : un calcul qui change de côté emporte son activité, même inchangée, pour
 * que l'autre fiche ne garde pas une activité d'un autre calcul.
 */
const pairActivity = (edits: Map<string, unknown>, before: SessionRecord, self: SessionRecord, other: SessionRecord): void => {
  if (edits.has('sport') && !edits.has('activityId') && self.sport !== other.sport) edits.set('activityId', before.activityId);
};

/** La fiche fondue telle qu'elle s'écrit d'un côté : son GPX, et un résumé à refaire si l'activité lui arrive changée. */
const settle = (merged: SessionRecord, original: SessionRecord): SessionRecord => {
  const next = { ...merged, gpx: original.gpx };
  return original.sport !== next.sport || original.activityId !== next.activityId ? withoutCarriedSettings(next) : next;
};

const textIfChanged = (next: SessionRecord, original: ReadRecord): string | null =>
  sameJson(next, original.record) ? null : serializeRecord(next, original.unreadable);

/** Ancêtre d'une fiche, s'il vaut encore : même date d'entrée, donc la même fiche continuée, pas une fiche refaite. */
const ancestorOf = (text: string | null, current: SessionRecord): SessionRecord | null => {
  const read = readRecord(text);
  return read && read.record.addedAt === current.addedAt ? read.record : null;
};

/** Vrai si la fiche a changé depuis son ancêtre, hors résumé ; vrai aussi sans ancêtre valable, ou si elle ne se lit pas. */
export const syncRecordChanged = (ancestorText: string | null, text: string): boolean => {
  const read = readRecord(text);
  const before = read && ancestorOf(ancestorText, read.record);
  return !read || !before || editsSince(before, read.record, false).size > 0;
};

export interface SyncRecordTexts {
  computer: string;
  phone: string;
  /** Texte de la fiche de chaque côté à la dernière synchronisation de la session ; `null` : première rencontre. */
  computerAncestor: string | null;
  phoneAncestor: string | null;
}

export interface SyncRecordMerge {
  /** Texte à écrire de chaque côté ; `null` : la fiche de ce côté ne change pas. */
  computer: string | null;
  phone: string | null;
  /** Chemins saisis changés des deux côtés, à dire (`conflictLabels` de `recordMerge.ts`). */
  conflicts: string[];
  /** Côté dont la version l'emporte, pour chaque chemin de `conflicts`. */
  winners: Record<string, SyncSideName>;
  /** Vrai si les fiches ont été complétées l'une par l'autre, faute d'ancêtres valables. */
  union: boolean;
}

/** Le calcul et l'activité se tranchent ensemble : un seul côté les donne tous deux (`pairActivity`). */
const ACTIVITY_PATHS = ['sport', 'activityId'];

/**
 * Fond les fiches des deux côtés. `editsOnly` : seuls les champs saisis passent (deux traces différentes du même
 * instant : sauts et manœuvres de l'une ne valent pas pour l'autre). `null` si l'une des deux ne se fond pas
 * (illisible, sans résumé, ou d'une version plus récente) : rien ne doit alors être écrit.
 */
export const mergeSyncRecords = (texts: SyncRecordTexts, { editsOnly = false }: { editsOnly?: boolean } = {}): SyncRecordMerge | null => {
  const sides: Record<SyncSideName, ReadRecord | null> = { computer: readRecord(texts.computer), phone: readRecord(texts.phone) };
  const { computer, phone } = sides;
  if (!computer || !phone || !isWritableRecord(computer.record) || !isWritableRecord(phone.record)) return null;
  const before = { computer: ancestorOf(texts.computerAncestor, computer.record), phone: ancestorOf(texts.phoneAncestor, phone.record) };
  const union = !before.computer || !before.phone;
  // Le côté dont la fiche a été refaite ne l'emporte pas sur l'autre ; sinon l'ordinateur.
  const winnerSide: SyncSideName = union && before.phone && !before.computer ? 'phone' : 'computer';
  const loserSide: SyncSideName = winnerSide === 'computer' ? 'phone' : 'computer';
  const winner = sides[winnerSide] as ReadRecord;
  const loser = sides[loserSide] as ReadRecord;
  const editsOf = (side: SyncSideName, self: ReadRecord, other: ReadRecord): Map<string, unknown> => {
    const ancestor = union ? null : before[side];
    const edits = ancestor ? editsSince(ancestor, self.record, editsOnly) : carriedFields(self.record, editsOnly);
    pairActivity(edits, ancestor ?? blank(self.record), self.record, other.record);
    return edits;
  };
  const winnerEdits = editsOf(winnerSide, winner, loser);
  const loserEdits = editsOf(loserSide, loser, winner);
  if (winnerEdits.size === 0 && loserEdits.size === 0) return { computer: null, phone: null, conflicts: [], winners: {}, union };
  // Le perdant reçoit ce que le gagnant a changé ; le gagnant reçoit ensuite, sur tout chemin changé d'un côté ou de
  // l'autre, la valeur ainsi tranchée : les deux fiches finissent d'accord.
  let first = mergeChangedRecord(loser.record, winner.record, winnerEdits, ACROSS_DEVICES);
  const conflicts = first.conflicts;
  const winners: Record<string, SyncSideName> = Object.fromEntries(conflicts.map((path) => [path, winnerSide]));
  // Activité tranchée pour le gagnant : son calcul vient avec elle, même s'il n'a changé que de l'autre côté (une
  // activité du même calcul choisie ici, une d'un autre calcul là-bas), sans quoi la fiche marierait les deux.
  const activityPath = ACTIVITY_PATHS.find((path) => winners[path] !== undefined);
  const pulled = activityPath !== undefined ? ACTIVITY_PATHS.filter((path) => loserEdits.has(path) && !winnerEdits.has(path)) : [];
  for (const path of pulled) winnerEdits.set(path, loserEdits.get(path));
  if (pulled.length > 0) first = mergeChangedRecord(loser.record, winner.record, winnerEdits, ACROSS_DEVICES);
  const nextLoser = settle(first.record, loser.record);
  const everyEdit = new Map([...loserEdits, ...winnerEdits]);
  const nextWinner = settle(mergeChangedRecord(winner.record, nextLoser, everyEdit, ACROSS_DEVICES).record, winner.record);
  const written = { [winnerSide]: textIfChanged(nextWinner, winner), [loserSide]: textIfChanged(nextLoser, loser) } as Record<SyncSideName, string | null>;
  return { computer: written.computer, phone: written.phone, conflicts, winners, union };
};
