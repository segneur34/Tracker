import type { SessionMark } from '../core/sessionMarks';
import type { SpeedRangeMs } from '../core/speedGradient';
import { EMPTY_NOTES, type GearChoice, type SailingSessionNotes } from '../sailing/sessionNotes';
import { normalizeDeg, type SessionAnalysis, type SessionRecord, type StoredSessionNotes } from './record';

/**
 * Ce que l'utilisateur change sur une session dans le module d'analyse : vent
 * saisi, seuil d'activité, allure imposée, couleurs de la trace, seuil
 * d'effort du fractionné, foil, pumping, seuil de vague en foil (surf), poids
 * du vélo et charge portée, notes, repères du bouton « Note » (nommés ou supprimés). Les changements restent en brouillon jusqu'à
 * « Enregistrer la session », qui les écrit dans la fiche.
 */
export interface SessionEdits {
  notes: SailingSessionNotes;
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null;
  /** Seuil d'activité de la session, dans l'unité du profil ; `null` : celui du support. */
  activeThreshold: number | null;
  /** Allure de la session imposée, en m/s ; `null` : déduite de la trace. */
  referenceSpeedMs: number | null;
  /** Bornes de couleur de la trace, en m/s ; `null` : celles des Réglages, sinon le défaut du module. */
  speedRange: SpeedRangeMs | null;
  /** Seuil d'effort de la détection des répétitions, en m/s ; `null` : celui tiré de la session. */
  effortThresholdMs: number | null;
  /** Support sur foil pour la session ; `null` : celui de l'activité. */
  foil: boolean | null;
  /** Pumping foil pour la session (surf, voile sur foil) ; `null` : celui de l'activité. */
  pumping: boolean | null;
  /** Seuil de vague en foil de la session (surf), dans l'unité du profil ; `null` : celui du profil. */
  waveThreshold: number | null;
  /** Poids du vélo et des bagages, en kg ; `null` : celui de l'activité. */
  bikeWeightKg: number | null;
  /** Charge portée en course, en kg ; `null` : celle de l'activité. */
  loadKg: number | null;
  /** Repères de la session, dans l'ordre du temps. */
  marks: SessionMark[];
}

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
export const savedEdits = (record: SessionRecord | null): SessionEdits => ({
  notes: record?.notes ? pickNotes(record.notes) : EMPTY_NOTES,
  windDeg: record?.analysis?.windDeg ?? null,
  activeThreshold: record?.analysis?.activeThreshold ?? null,
  referenceSpeedMs: record?.analysis?.referenceSpeedMs ?? null,
  speedRange: record?.analysis?.speedRange ?? null,
  effortThresholdMs: record?.analysis?.effortThresholdMs ?? null,
  foil: record?.analysis?.foil ?? null,
  pumping: record?.analysis?.pumping ?? null,
  waveThreshold: record?.analysis?.waveThreshold ?? null,
  bikeWeightKg: record?.analysis?.bikeWeightKg ?? null,
  loadKg: record?.analysis?.loadKg ?? null,
  marks: record?.marks ?? NO_MARKS,
});

const NO_MARKS: SessionMark[] = [];

const pickNotes = (notes: SailingSessionNotes): SailingSessionNotes =>
  Object.fromEntries(NOTE_FIELDS.map((field) => [field, notes[field]])) as unknown as SailingSessionNotes;

export type EditedPart = 'vent' | 'seuil' | 'allure' | 'couleurs' | 'effort' | 'foil' | 'pumping' | 'vague' | 'charge' | 'notes' | 'reperes';

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

const sameRange = (a: SpeedRangeMs | null, b: SpeedRangeMs | null): boolean =>
  a === b || (a !== null && b !== null && a.minMs === b.minMs && a.maxMs === b.maxMs);

const sameMarks = (a: readonly SessionMark[], b: readonly SessionMark[]): boolean =>
  a === b || (a.length === b.length && a.every((m, i) => {
    const o = b[i];
    return m.timeMs === o.timeMs && m.lat === o.lat && m.lon === o.lon && m.label === o.label;
  }));

/** Parties qui diffèrent entre deux états, dans l'ordre de l'écran. */
export const changedParts = (saved: SessionEdits, edits: SessionEdits): EditedPart[] => {
  const parts: EditedPart[] = [];
  if (saved.windDeg !== edits.windDeg) parts.push('vent');
  if (saved.activeThreshold !== edits.activeThreshold) parts.push('seuil');
  if (saved.referenceSpeedMs !== edits.referenceSpeedMs) parts.push('allure');
  if (!sameRange(saved.speedRange, edits.speedRange)) parts.push('couleurs');
  if (saved.effortThresholdMs !== edits.effortThresholdMs) parts.push('effort');
  if (saved.foil !== edits.foil) parts.push('foil');
  if (saved.pumping !== edits.pumping) parts.push('pumping');
  if (saved.waveThreshold !== edits.waveThreshold) parts.push('vague');
  if (saved.bikeWeightKg !== edits.bikeWeightKg || saved.loadKg !== edits.loadKg) parts.push('charge');
  if (!sameNotes(saved.notes, edits.notes)) parts.push('notes');
  if (!sameMarks(saved.marks, edits.marks)) parts.push('reperes');
  return parts;
};

/** Égalité de chaque partie du brouillon (hors notes, comparées champ par champ). */
const SAME: { [K in Exclude<keyof SessionEdits, 'notes'>]: (a: SessionEdits[K], b: SessionEdits[K]) => boolean } = {
  windDeg: (a, b) => a === b,
  activeThreshold: (a, b) => a === b,
  referenceSpeedMs: (a, b) => a === b,
  speedRange: sameRange,
  effortThresholdMs: (a, b) => a === b,
  foil: (a, b) => a === b,
  pumping: (a, b) => a === b,
  waveThreshold: (a, b) => a === b,
  bikeWeightKg: (a, b) => a === b,
  loadKg: (a, b) => a === b,
  marks: sameMarks,
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
  for (const key of Object.keys(SAME) as (keyof typeof SAME)[]) {
    const same = SAME[key] as (a: unknown, b: unknown) => boolean;
    if (same(draft[key], prevSaved[key]) && !same(draft[key], nextSaved[key])) {
      (next as unknown as Record<string, unknown>)[key] = nextSaved[key];
      changed = true;
    }
  }
  const notes: SailingSessionNotes = { ...draft.notes };
  for (const field of NOTE_FIELDS) {
    if (sameNoteField(field, draft.notes[field], prevSaved.notes[field]) && !sameNoteField(field, draft.notes[field], nextSaved.notes[field])) {
      (notes as unknown as Record<string, unknown>)[field] = nextSaved.notes[field];
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
      windDeg: edits.windDeg === null ? null : normalizeDeg(edits.windDeg),
      activeThreshold: edits.activeThreshold,
      referenceSpeedMs: edits.referenceSpeedMs,
      speedRange: edits.speedRange,
      effortThresholdMs: edits.effortThresholdMs,
      foil: edits.foil,
      pumping: edits.pumping,
      waveThreshold: edits.waveThreshold,
      bikeWeightKg: edits.bikeWeightKg,
      loadKg: edits.loadKg,
      savedAt: now,
    };
  }
  return patch;
};
