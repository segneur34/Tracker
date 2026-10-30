import type { SessionMark } from '../core/sessionMarks';
import { EMPTY_NOTES, type GearChoice, type SailingSessionNotes } from './notes';
import {
  ANALYSIS_FIELDS,
  ANALYSIS_KEYS,
  mapAnalysis,
  type AnalysisField,
  type AnalysisKey,
  type AnalysisPart,
  type AnalysisValues,
  type SessionAnalysis,
  type SessionRecord,
  type StoredSessionNotes,
} from './record';

/**
 * Ce que l'utilisateur change sur une session dans le module d'analyse : les
 * réglages d'analyse de la fiche (`ANALYSIS_FIELDS` : vent saisi, seuil
 * d'activité, allure imposée, couleurs de la trace, seuil d'effort du
 * fractionné, foil, pumping, seuil de vague en foil, poids du vélo et charge
 * portée), notes, repères du bouton « Note » (nommés ou supprimés). Les
 * changements restent en brouillon jusqu'à « Enregistrer la session », qui les
 * écrit dans la fiche.
 */
export type SessionEdits = AnalysisValues & {
  notes: SailingSessionNotes;
  /** Repères de la session, dans l'ordre du temps. */
  marks: SessionMark[];
};

/** Copie d'un champ de `source` dans `target`. */
const copyKey = <T, K extends keyof T>(target: T, source: T, key: K): void => {
  target[key] = source[key];
};

const NOTE_FIELDS = Object.keys(EMPTY_NOTES) as (keyof SailingSessionNotes)[];

/** Même matériel choisi, au contenu près : une fiche relue en donne une copie. */
const sameGear = (a: readonly GearChoice[] | null, b: readonly GearChoice[] | null): boolean =>
  a === b || ((a?.length ?? 0) === 0 && (b?.length ?? 0) === 0) || (a !== null && b !== null && a.length === b.length && a.every((g, i) => {
    const o = b[i];
    return g.groupId === o.groupId && g.groupName === o.groupName && g.itemId === o.itemId && g.itemName === o.itemName;
  }));

/** Égalité d'un champ des notes : le matériel par son contenu, le reste tel quel. */
const sameNoteField = <F extends keyof SailingSessionNotes>(field: F, a: SailingSessionNotes[F], b: SailingSessionNotes[F]): boolean =>
  field === 'gear' ? sameGear(a as GearChoice[] | null, b as GearChoice[] | null) : a === b;

const sameNotes = (a: SailingSessionNotes, b: SailingSessionNotes): boolean =>
  NOTE_FIELDS.every((field) => sameNoteField(field, a[field], b[field]));

/**
 * État enregistré d'une session, tel que le module l'affiche. Ce que sa fiche
 * ne porte pas reste vide : aucune session n'emprunte le matériel d'une autre
 * (décision du 27/10, « vide si pas donné »).
 */
export const savedEdits = (record: SessionRecord | null): SessionEdits => {
  const analysis: AnalysisValues | null | undefined = record?.analysis;
  return {
    notes: record?.notes ? pickNotes(record.notes) : EMPTY_NOTES,
    ...mapAnalysis((key) => analysis?.[key] ?? null),
    marks: record?.marks ?? NO_MARKS,
  };
};

const NO_MARKS: SessionMark[] = [];

const pickNotes = (notes: SailingSessionNotes): SailingSessionNotes => {
  const out: SailingSessionNotes = { ...EMPTY_NOTES };
  for (const field of NOTE_FIELDS) copyKey(out, notes, field);
  return out;
};

export type EditedPart = AnalysisPart | 'notes' | 'reperes';

/** Nom de chaque partie, tel que l'écran l'annonce. */
export const EDITED_PART_LABEL: Record<EditedPart, string> = {
  vent: 'vent',
  seuil: "seuil d'activité",
  allure: 'allure de la session',
  couleurs: 'couleurs de la trace',
  effort: "seuil d'effort",
  foil: 'foil',
  pumping: 'pumping',
  vague: 'seuil de vague',
  charge: 'charge',
  notes: 'notes',
  reperes: 'repères',
};

/** Égalité d'un réglage d'analyse, selon sa ligne de la table (`===` par défaut). */
const sameValue = <K extends AnalysisKey>(key: K, a: AnalysisValues[K], b: AnalysisValues[K]): boolean => {
  const field: AnalysisField<K> = ANALYSIS_FIELDS[key];
  return field.same ? field.same(a, b) : a === b;
};

/** Réglage d'analyse de `values` mis en forme pour la fiche, selon sa ligne de la table (tel quel par défaut). */
const writtenValue = <K extends AnalysisKey>(values: AnalysisValues, key: K): AnalysisValues[K] => {
  const field: AnalysisField<K> = ANALYSIS_FIELDS[key];
  return field.write ? field.write(values[key]) : values[key];
};

const sameMarks = (a: readonly SessionMark[], b: readonly SessionMark[]): boolean =>
  a === b || (a.length === b.length && a.every((m, i) => {
    const o = b[i];
    return m.timeMs === o.timeMs && m.lat === o.lat && m.lon === o.lon && m.label === o.label;
  }));

/** Parties qui diffèrent entre deux états, dans l'ordre de l'écran. */
export const changedParts = (saved: SessionEdits, edits: SessionEdits): EditedPart[] => {
  const parts: EditedPart[] = [];
  for (const key of ANALYSIS_KEYS) {
    // Une partie à plusieurs champs (« charge » : poids du vélo et charge portée) n'est annoncée qu'une fois.
    const { part } = ANALYSIS_FIELDS[key];
    if (!parts.includes(part) && !sameValue(key, saved[key], edits[key])) parts.push(part);
  }
  if (!sameNotes(saved.notes, edits.notes)) parts.push('notes');
  if (!sameMarks(saved.marks, edits.marks)) parts.push('reperes');
  return parts;
};

/**
 * Brouillon reporté sur une fiche qui a changé sous lui (activité changée,
 * qui efface le seuil ; fiche relue par « Mettre à jour ») : fusion à trois,
 * partie par partie et note par note. Ce que le brouillon n'avait pas changé
 * depuis `prevSaved` suit `nextSaved` ; ce qu'il avait changé est gardé. Rend
 * `draft` lui-même quand rien ne bouge.
 */
export const rebaseDraft = (prevSaved: SessionEdits, nextSaved: SessionEdits, draft: SessionEdits): SessionEdits => {
  if (prevSaved === nextSaved) return draft;
  const next: SessionEdits = { ...draft };
  let changed = false;
  for (const key of ANALYSIS_KEYS) {
    if (sameValue(key, draft[key], prevSaved[key]) && !sameValue(key, draft[key], nextSaved[key])) {
      copyKey(next, nextSaved, key);
      changed = true;
    }
  }
  if (sameMarks(draft.marks, prevSaved.marks) && !sameMarks(draft.marks, nextSaved.marks)) {
    next.marks = nextSaved.marks;
    changed = true;
  }
  const notes: SailingSessionNotes = { ...draft.notes };
  for (const field of NOTE_FIELDS) {
    if (sameNoteField(field, draft.notes[field], prevSaved.notes[field]) && !sameNoteField(field, draft.notes[field], nextSaved.notes[field])) {
      copyKey(notes, nextSaved.notes, field);
      changed = true;
    }
  }
  return changed ? { ...next, notes } : draft;
};

export interface EditsPatch {
  notes?: StoredSessionNotes;
  analysis?: SessionAnalysis;
  /** Repères ; une liste vide les retire de la fiche. */
  marks?: SessionMark[];
}

/**
 * Ce qu'il faut écrire dans la fiche pour enregistrer `edits` : seulement les
 * parties changées, datées de `now`. Les champs inconnus des notes et des
 * réglages d'analyse déjà présents sont gardés.
 */
export const editsPatch = (record: SessionRecord, saved: SessionEdits, edits: SessionEdits, now: number): EditsPatch => {
  const parts = changedParts(saved, edits);
  const patch: EditsPatch = {};
  if (parts.includes('notes')) patch.notes = { ...record.notes, ...edits.notes, savedAt: now };
  if (parts.includes('reperes')) patch.marks = edits.marks.map((m) => ({ ...m, label: m.label?.trim() || null }));
  if (parts.some((part) => part !== 'notes' && part !== 'reperes')) {
    patch.analysis = {
      ...record.analysis,
      ...mapAnalysis((key) => writtenValue(edits, key)),
      savedAt: now,
    };
  }
  return patch;
};

/**
 * Brouillon après un changement, fait sur le brouillon du moment (`current`,
 * `null` sans brouillon : l'état enregistré) et non sur celui du dernier
 * rendu : deux changements d'un même geste se cumulent. `patch` reçoit les
 * réglages du moment, pour fusionner un morceau (notes).
 */
export const patchedDraft = (
  current: SessionEdits | null,
  saved: SessionEdits,
  patch: (edits: SessionEdits) => Partial<SessionEdits>
): SessionEdits => {
  const edits = current ?? saved;
  return { ...edits, ...patch(edits) };
};
