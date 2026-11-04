import { isWritableRecord, type ParsedRecord, type RecordWithoutSummary } from './record';

/**
 * Texte d'une fiche lue sur le disque ou apportée par un import, et les avertissements d'une session qu'on ne
 * réécrit pas (lot 113, sortis de la bibliothèque).
 */

export const FUTURE_RECORD_WARNING = 'Fiche écrite par une version plus récente de Tracker : lue sans être modifiée.';
export const UNREADABLE_RECORD_WARNING = 'Fiche illisible, laissée telle quelle : le résumé affiché est recalculé.';
export const DAMAGED_RECORD_WARNING = 'Fiche devenue illisible, laissée telle quelle : les changements ne sont plus enregistrés.';
export const NOT_READ_RECORD_WARNING = 'Fiche non lue (accès refusé) : laissée telle quelle, relue à « Mettre à jour ».';
export const READ_ONLY_MEMORY_WARNING = 'Dossier écrit par une version plus récente de Tracker : session lue sans être modifiée.';

/** Fiche de 0 octet (création interrompue, fichier créé vide avant d'être écrit) : tenue pour absente. */
export const isBlankRecordText = (text: string | null): boolean => text !== null && text.trim() === '';

/**
 * Fiche qui accompagne un GPX mais qu'on ne sait pas réécrire (version plus récente, illisible) :
 * rangée telle quelle, au caractère près, la session en lecture seule avec `warning` ; `parts` : ce
 * qu'on en a lu (version plus récente), sinon `null`. Elle ne complète pas une session déjà là.
 */
export interface KeptRecordText {
  text: string;
  warning: string;
  parts: RecordWithoutSummary | null;
}

/** Fiche à ranger telle quelle (`KeptRecordText`) : d'une version plus récente, ou illisible ; `undefined` si on sait la réécrire. */
export const recordToKeep = (text: string, parsed: ParsedRecord | null): KeptRecordText | undefined => {
  if (!parsed) return { text, warning: UNREADABLE_RECORD_WARNING, parts: null };
  return isWritableRecord(parsed.parts) ? undefined : { text, warning: FUTURE_RECORD_WARNING, parts: parsed.parts };
};
