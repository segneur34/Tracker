import { isObject } from '../core/basics';
import { readSessionMark, type SessionMark } from '../core/sessionMarks';
import { EMPTY_NOTES, WATER_STATES, WIND_LEVELS, type SailingSessionNotes } from './notes';
import { ANALYSIS_FIELDS, mapAnalysis, readNotes } from './record';
import { changedParts, type SessionEdits } from './sessionEdits';

/**
 * Brouillons des sessions de la mémoire gardés sur l'appareil (lot 234, repris de Gtracker), pour qu'une saisie pas
 * encore enregistrée survive à la fermeture de l'application par Android. Un seul document, rangé sous une clé de
 * l'appareil (`hooks/sessionDraftStore.ts`) : un objet qui associe au nom de fichier de chaque session son brouillon et
 * l'état enregistré sur lequel il a été fait (de quoi le reporter sur la fiche relue, `rebaseDraft`). Ici, sa lecture,
 * qui vérifie chaque champ par les lectures de la fiche (`record.ts`) et jette le reste, et ses changements, sans
 * jamais modifier la valeur reçue.
 *
 * Chaque brouillon note la mémoire où sa session a été vue en dernier : seule la lecture complète de cette mémoire-là
 * peut le jeter, jamais celle d'une autre (dossier désigné après coup, retour à la mémoire du navigateur). Le même
 * nom de fichier dans deux mémoires est la même session recopiée : le brouillon la suit.
 */

/** Brouillon d'une session et état enregistré sur lequel il a été fait. */
export interface SessionDraft {
  base: SessionEdits;
  edits: SessionEdits;
}

/** Brouillon gardé, avec l'identité de la mémoire où sa session a été vue (`null` : inconnue, jamais jeté par la purge). */
export interface KeptDraft extends SessionDraft {
  memory: string | null;
}

/** Brouillons par nom de fichier de session. */
export type SessionDrafts = ReadonlyMap<string, KeptDraft>;

const NOTE_FIELDS = Object.keys(EMPTY_NOTES) as (keyof SailingSessionNotes)[];

const copyNote = <K extends keyof SailingSessionNotes>(target: SailingSessionNotes, source: SailingSessionNotes, key: K): void => {
  target[key] = source[key];
};

/**
 * Notes relues : les seuls champs des notes, lus par `readNotes` (un champ mal formé reprend sa valeur vide), la force
 * du vent et l'état de l'eau gardés seulement s'ils sont de leur liste.
 */
const readDraftNotes = (raw: unknown): SailingSessionNotes | null => {
  const notes = readNotes(raw);
  if (!notes) return null;
  const out: SailingSessionNotes = { ...EMPTY_NOTES };
  for (const field of NOTE_FIELDS) copyNote(out, notes, field);
  if (!WIND_LEVELS.some((w) => w.value === out.windLevel)) out.windLevel = null;
  if (!WATER_STATES.some((w) => w.value === out.waterState)) out.waterState = null;
  return out;
};

/** Repères relus dans leur ordre ; les mal formés sont écartés ; `null` si ce n'est pas une liste. */
const readDraftMarks = (raw: unknown): SessionMark[] | null =>
  Array.isArray(raw) ? raw.map(readSessionMark).filter((m): m is SessionMark => m !== null) : null;

/**
 * État d'une session relu du document : réglages d'analyse champ par champ (`ANALYSIS_FIELDS`, une valeur mal formée
 * revient au défaut), notes et repères ; `null` si ce n'est pas un objet, ou si ses notes ou ses repères manquent.
 */
export const readSessionEdits = (raw: unknown): SessionEdits | null => {
  if (!isObject(raw)) return null;
  const notes = readDraftNotes(raw.notes);
  const marks = readDraftMarks(raw.marks);
  if (!notes || !marks) return null;
  return { ...mapAnalysis((key) => ANALYSIS_FIELDS[key].read(raw[key])), notes, marks };
};

/** Vrai si le brouillon change quelque chose à l'état sur lequel il a été fait : seul un tel brouillon est gardé. */
export const draftHasChanges = (draft: SessionDraft): boolean => changedParts(draft.base, draft.edits).length > 0;

/**
 * Brouillons relus du document de l'appareil. Une entrée mal formée, ou qui ne change rien, est jetée ; un document
 * illisible n'en porte aucun.
 */
export const parseSessionDrafts = (raw: unknown): Map<string, KeptDraft> => {
  const drafts = new Map<string, KeptDraft>();
  if (!isObject(raw)) return drafts;
  for (const [file, entry] of Object.entries(raw)) {
    if (file === '' || !isObject(entry)) continue;
    const base = readSessionEdits(entry.base);
    const edits = readSessionEdits(entry.edits);
    const memory = typeof entry.memory === 'string' ? entry.memory : null;
    if (base && edits && draftHasChanges({ base, edits })) drafts.set(file, { base, edits, memory });
  }
  return drafts;
};

/** Document à ranger sur l'appareil. */
export const sessionDraftsDocument = (drafts: SessionDrafts): Record<string, KeptDraft> => Object.fromEntries(drafts);

/** Brouillons avec celui de `file` posé (`null`, ou un brouillon qui ne change rien : retiré). */
export const withSessionDraft = (drafts: SessionDrafts, file: string, draft: KeptDraft | null): Map<string, KeptDraft> => {
  const next = new Map(drafts);
  if (draft && draftHasChanges(draft)) next.set(file, draft);
  else next.delete(file);
  return next;
};

/** Brouillons sans ceux des fichiers donnés. */
export const withoutSessionDrafts = (drafts: SessionDrafts, files: Iterable<string>): Map<string, KeptDraft> => {
  const next = new Map(drafts);
  for (const file of files) next.delete(file);
  return next;
};

/**
 * Fichiers dont le brouillon a été fait dans la mémoire `memory`, que cette mémoire, lue en entier (`existing`), ne
 * porte plus. Le brouillon d'une autre mémoire, ou d'une mémoire inconnue, n'en est jamais.
 */
export const draftsOfMissingSessions = (drafts: SessionDrafts, memory: string, existing: ReadonlySet<string>): string[] =>
  [...drafts].filter(([file, draft]) => draft.memory === memory && !existing.has(file)).map(([file]) => file);

/**
 * Document gardé (`stored`, relu à l'instant, peut-être réécrit par un autre onglet du navigateur) où seules les
 * entrées que ce magasin a changées (`touched`) prennent sa valeur (`own`) : posées, ou retirées s'il ne les a plus.
 * Les autres restent celles du document gardé.
 */
export const mergedSessionDrafts = (stored: SessionDrafts, own: SessionDrafts, touched: Iterable<string>): Map<string, KeptDraft> => {
  const next = new Map(stored);
  for (const file of touched) {
    const draft = own.get(file);
    if (draft) next.set(file, draft);
    else next.delete(file);
  }
  return next;
};
