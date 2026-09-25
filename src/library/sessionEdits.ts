import type { SpeedRangeMs } from '../core/speedGradient';
import { EMPTY_NOTES, type SailingSessionNotes } from '../sailing/sessionNotes';
import { normalizeDeg, type SessionAnalysis, type SessionRecord, type StoredSessionNotes } from './record';

/**
 * Ce que l'utilisateur change sur une session dans le module d'analyse : vent
 * saisi, seuil d'activité, allure imposée, couleurs de la trace, notes. Les
 * changements restent en brouillon jusqu'à « Enregistrer la session », qui
 * les écrit dans la fiche.
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
}

const NOTE_FIELDS = Object.keys(EMPTY_NOTES) as (keyof SailingSessionNotes)[];

const sameNotes = (a: SailingSessionNotes, b: SailingSessionNotes): boolean =>
  NOTE_FIELDS.every((field) => a[field] === b[field]);

/** Notes les plus récentes qui portent du matériel : proposées à une session encore sans notes. */
export const latestGearNotes = (records: readonly SessionRecord[]): StoredSessionNotes | null => {
  let latest: StoredSessionNotes | null = null;
  for (const record of records) {
    const n = record.notes;
    if (n && (n.foil || n.mast || n.wing) && (!latest || n.savedAt > latest.savedAt)) latest = n;
  }
  return latest;
};

/**
 * État enregistré d'une session, tel que le module l'affiche. Une session sans
 * notes reçoit le matériel de la dernière session notée (`gear`) : on change
 * rarement de foil entre deux sorties.
 */
export const savedEdits = (record: SessionRecord | null, gear: StoredSessionNotes | null): SessionEdits => {
  const notes: SailingSessionNotes = record?.notes
    ? pickNotes(record.notes)
    : gear
      ? { ...EMPTY_NOTES, foil: gear.foil, mast: gear.mast, wing: gear.wing }
      : EMPTY_NOTES;
  return {
    notes,
    windDeg: record?.analysis?.windDeg ?? null,
    activeThreshold: record?.analysis?.activeThreshold ?? null,
    referenceSpeedMs: record?.analysis?.referenceSpeedMs ?? null,
    speedRange: record?.analysis?.speedRange ?? null,
  };
};

const pickNotes = (notes: SailingSessionNotes): SailingSessionNotes =>
  Object.fromEntries(NOTE_FIELDS.map((field) => [field, notes[field]])) as unknown as SailingSessionNotes;

export type EditedPart = 'vent' | 'seuil' | 'allure' | 'couleurs' | 'notes';

/** Nom de chaque partie, tel que l'écran l'annonce. */
export const EDITED_PART_LABEL: Record<EditedPart, string> = {
  vent: 'vent',
  seuil: "seuil d'activité",
  allure: 'allure de la session',
  couleurs: 'couleurs de la trace',
  notes: 'notes',
};

const sameRange = (a: SpeedRangeMs | null, b: SpeedRangeMs | null): boolean =>
  a === b || (a !== null && b !== null && a.minMs === b.minMs && a.maxMs === b.maxMs);

/** Parties qui diffèrent entre deux états, dans l'ordre de l'écran. */
export const changedParts = (saved: SessionEdits, edits: SessionEdits): EditedPart[] => {
  const parts: EditedPart[] = [];
  if (saved.windDeg !== edits.windDeg) parts.push('vent');
  if (saved.activeThreshold !== edits.activeThreshold) parts.push('seuil');
  if (saved.referenceSpeedMs !== edits.referenceSpeedMs) parts.push('allure');
  if (!sameRange(saved.speedRange, edits.speedRange)) parts.push('couleurs');
  if (!sameNotes(saved.notes, edits.notes)) parts.push('notes');
  return parts;
};

export interface EditsPatch {
  notes?: StoredSessionNotes;
  analysis?: SessionAnalysis;
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
  if (parts.some((part) => part !== 'notes')) {
    patch.analysis = {
      ...record.analysis,
      windDeg: edits.windDeg === null ? null : normalizeDeg(edits.windDeg),
      activeThreshold: edits.activeThreshold,
      referenceSpeedMs: edits.referenceSpeedMs,
      speedRange: edits.speedRange,
      savedAt: now,
    };
  }
  return patch;
};
