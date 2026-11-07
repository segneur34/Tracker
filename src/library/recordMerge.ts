import type { FileStat } from '../platform/memoryFolder';
import { ANALYSIS_SUMMARY_FIELDS, sameJson, type RecordWithoutSummary, type SessionRecord, type SessionSummary } from './record';

/**
 * Fiche changée sur le disque pendant qu'on la tenait en mémoire (lot 148) : deux appareils sur un
 * même dossier (Syncthing, Drive, copie à chaud). Avant d'écrire, la fiche du disque est fondue
 * champ à champ avec ce qui a été saisi ici : le disque pour tout, sauf les chemins changés ici.
 */

/**
 * Chemins changés ici depuis la dernière écriture, avec leur valeur d'avant le premier changement.
 * Un chemin : un champ de premier niveau (`name`, `marks`, `summary`), ou un champ de `notes`, d'`analysis`
 * (`notes.comment`), ou le nombre et la réussite des manœuvres (`summary.maneuverCount`).
 */
export type RecordEdits = ReadonlyMap<string, unknown>;

/** Blocs saisis, datés par leur `savedAt`, fondus champ à champ. */
const DATED_BLOCKS = ['notes', 'analysis'] as const;
type DatedBlock = (typeof DATED_BLOCKS)[number];

/** Le résumé, tiré du GPX, ne se fond pas : seuls ces champs, posés à part par l'analyse, le font. */
const MANEUVER_FIELDS = ANALYSIS_SUMMARY_FIELDS;

type Loose = Record<string, unknown>;

const loose = (value: unknown): Loose => value as Loose;

const summaryWithoutManeuvers = (summary: SessionSummary): Loose => {
  const others: Loose = { ...summary };
  for (const field of MANEUVER_FIELDS) delete others[field];
  return others;
};

/**
 * Ajoute à `edits` les chemins qui diffèrent entre deux états de la fiche, chacun gardant sa valeur
 * d'avant son premier changement.
 */
export const addRecordEdits = (edits: Map<string, unknown>, before: SessionRecord, after: SessionRecord): void => {
  const note = (path: string, value: unknown): void => {
    if (!edits.has(path)) edits.set(path, value);
  };
  const a = loose(before);
  const b = loose(after);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'gpx' || key === 'summary' || (DATED_BLOCKS as readonly string[]).includes(key)) continue;
    if (!sameJson(a[key], b[key])) note(key, a[key]);
  }
  for (const block of DATED_BLOCKS) {
    const from = before[block];
    const to = after[block];
    if (sameJson(from, to)) continue;
    if (!from || !to) {
      note(block, from);
      continue;
    }
    const x = loose(from);
    const y = loose(to);
    for (const field of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (field !== 'savedAt' && !sameJson(x[field], y[field])) note(`${block}.${field}`, x[field]);
    }
  }
  if (!sameJson(summaryWithoutManeuvers(before.summary), summaryWithoutManeuvers(after.summary))) note('summary', before.summary);
  for (const field of MANEUVER_FIELDS) {
    if (!sameJson(before.summary[field], after.summary[field])) note(`summary.${field}`, before.summary[field]);
  }
};

/** Valeur d'un chemin d'`RecordEdits` dans une fiche. */
const valueAt = (record: Pick<RecordWithoutSummary, DatedBlock>, path: string): unknown => {
  const dot = path.indexOf('.');
  if (dot < 0) return loose(record)[path];
  const parent = loose(record)[path.slice(0, dot)];
  return parent ? loose(parent)[path.slice(dot + 1)] : undefined;
};

/** Résumé fondu : celui de la mémoire s'il a été refait ici, sauf si le disque vient d'un calcul plus récent ; sinon celui du disque. */
const mergedSummary = (disk: SessionSummary | null, mine: SessionSummary, edits: RecordEdits): SessionSummary => {
  const ours = edits.has('summary') && (!disk || mine.calcVersion >= disk.calcVersion);
  const out: Loose = { ...(ours || !disk ? mine : disk) };
  for (const field of MANEUVER_FIELDS) {
    // Pas plus de manœuvres inventées : celles du disque, sauf si cette analyse vient de les compter.
    const from = edits.has(`summary.${field}`) ? mine : disk;
    if (!from) continue;
    if (from[field] === undefined) delete out[field];
    else out[field] = from[field];
  }
  return out as unknown as SessionSummary;
};

/** Bloc daté fondu, et les champs changés des deux côtés. Sur un champ changé des deux côtés, le bloc au `savedAt` le plus récent l'emporte. */
const mergedBlock = (
  block: DatedBlock, disk: RecordWithoutSummary, mine: SessionRecord, edits: RecordEdits, conflicts: string[]
): unknown => {
  const paths = [...edits.keys()].filter((path) => path === block || path.startsWith(`${block}.`));
  const fromDisk = disk[block];
  if (paths.length === 0) return fromDisk;
  const fromMine = mine[block];
  const diskAt = fromDisk?.savedAt ?? 0;
  const mineAt = fromMine?.savedAt ?? 0;
  let out: Loose | null = fromDisk ? { ...loose(fromDisk) } : null;
  for (const path of paths) {
    const inConflict = !sameJson(valueAt(disk, path), edits.get(path)) && !sameJson(valueAt(disk, path), valueAt(mine, path));
    if (inConflict) conflicts.push(path);
    if (inConflict && diskAt > mineAt) continue;
    if (path === block) out = fromMine ? { ...loose(fromMine) } : null;
    else if (!out) out = fromMine ? { ...loose(fromMine) } : null;
    else {
      const field = path.slice(block.length + 1);
      const value = valueAt(mine, path);
      if (value === undefined) delete out[field];
      else out[field] = value;
    }
  }
  return out ? { ...out, savedAt: Math.max(diskAt, mineAt) } : null;
};

export interface MergedRecord {
  record: SessionRecord;
  /** Chemins saisis par l'utilisateur et changés aussi sur le disque, à dire (`conflictLabels`). Les autres fontes sont silencieuses. */
  conflicts: string[];
}

/**
 * Fiche `disk` (relue sur le disque), plus ce qui a été changé ici dans `mine` (`edits`). Tout le reste
 * (champs d'une version plus récente compris) vient du disque. Un champ changé des deux côtés : en
 * notes et en réglages, le bloc au `savedAt` le plus récent ; ailleurs (nom, repères), la mémoire. Résumé :
 * `mergedSummary`. Si les réglages du disque ont changé, l'empreinte rend la session à refaire
 * (`isSummaryOutdated`), comme pour une allure changée ici.
 */
export const mergeChangedRecord = (disk: RecordWithoutSummary, mine: SessionRecord, edits: RecordEdits): MergedRecord => {
  const conflicts: string[] = [];
  const out: Loose = { ...disk, gpx: mine.gpx };
  const fromMine = loose(mine);
  for (const path of edits.keys()) {
    if (path.includes('.') || path === 'summary' || (DATED_BLOCKS as readonly string[]).includes(path)) continue;
    if (!sameJson(out[path], edits.get(path)) && !sameJson(out[path], fromMine[path])) conflicts.push(path);
    if (fromMine[path] === undefined) delete out[path];
    else out[path] = fromMine[path];
  }
  for (const block of DATED_BLOCKS) out[block] = mergedBlock(block, disk, mine, edits, conflicts);
  out.summary = mergedSummary(disk.summary, mine.summary, edits);
  return { record: out as unknown as SessionRecord, conflicts: conflicts.filter(isSaisie) };
};

/** Ce que l'utilisateur saisit, en clair, par champ de premier niveau ; les champs calculés (voies, altitude, sauts) ne s'annoncent pas. */
const SAISIE_LABEL: Readonly<Record<string, string>> = {
  sport: 'activité', activityId: 'activité', name: 'nom', notes: 'notes', analysis: 'réglages', marks: 'repères', elevationSource: 'altitude', mapBase: 'fond de carte',
};

const topField = (path: string): string => path.split('.')[0];

const isSaisie = (path: string): boolean => topField(path) in SAISIE_LABEL;

/** Ce qui a changé des deux côtés, en clair, sans doublon. */
export const conflictLabels = (conflicts: readonly string[]): string[] => [...new Set(conflicts.map((path) => SAISIE_LABEL[topField(path)]))];

/**
 * Mêmes taille et date, connues : le fichier n'a pas changé. Une date nulle (téléphone : fournisseur qui
 * ne la donne pas), un tampon ou une date absents ne prouvent rien : la fiche est relue. Reste un trou
 * accepté : même taille et même date, ou changement entre cette vérification et l'écriture.
 */
export const sameStamp = (a: FileStat | undefined, b: FileStat | null): boolean =>
  a !== undefined && b !== null && a.mtimeMs > 0 && b.mtimeMs > 0 && a.size === b.size && a.mtimeMs === b.mtimeMs;
