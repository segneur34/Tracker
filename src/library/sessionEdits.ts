import { sessionActivity, type Activity } from '../core/activities';
import type { SessionMark } from '../core/sessionMarks';
import type { SpeedRangeMs } from '../core/speedGradient';
import { EMPTY_NOTES, type SailingSessionNotes } from '../sailing/sessionNotes';
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
  /** Pumping foil pour la session (surf) ; `null` : celui de l'activité. */
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

const sameNotes = (a: SailingSessionNotes, b: SailingSessionNotes): boolean =>
  NOTE_FIELDS.every((field) => a[field] === b[field]);

/**
 * Notes les plus récentes d'une session de l'activité `activityId` qui portent
 * du matériel : proposées à une session enregistrée encore sans notes. Les
 * autres activités sont écartées : une course ne reçoit pas l'aile de la
 * dernière session de wing.
 */
export const latestGearNotes = (
  records: readonly SessionRecord[],
  activityId: string,
  activities: Activity[]
): StoredSessionNotes | null => {
  let latest: StoredSessionNotes | null = null;
  for (const record of records) {
    const n = record.notes;
    if (!n || !(n.foil || n.mast || n.wing || n.gear1 || n.gear2) || (latest && n.savedAt <= latest.savedAt)) continue;
    if (sessionActivity(activities, record.activityId, record.sport)?.id === activityId) latest = n;
  }
  return latest;
};

/**
 * État enregistré d'une session, tel que le module l'affiche. Une session
 * enregistrée sans notes reçoit le matériel de la dernière session notée de
 * son activité (`gear`) : on change rarement de foil entre deux sorties ; les
 * conditions, propres à la sortie, ne sont pas reprises. Une session
 * importée, ou un GPX hors de la mémoire, n'emprunte rien : ce que sa fiche ne
 * porte pas reste vide.
 */
export const savedEdits = (record: SessionRecord | null, gear: StoredSessionNotes | null): SessionEdits => {
  const notes: SailingSessionNotes = record?.notes
    ? pickNotes(record.notes)
    : gear && record?.source === 'enregistrement'
      ? { ...EMPTY_NOTES, foil: gear.foil, mast: gear.mast, wing: gear.wing, gear1: gear.gear1, gear2: gear.gear2 }
      : EMPTY_NOTES;
  return {
    notes,
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
  };
};

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
