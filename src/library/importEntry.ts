import { isWritableRecord, parseRecordWithRaw, type RecordUnreadable, type RecordWithoutSummary } from './record';
import { isBlankRecordText, recordToKeep, type KeptRecordText } from './recordText';
import type { UnbundledGpx } from './sessionBundle';

/**
 * Fiche d'un GPX importé (lot 113, sorti de la bibliothèque) : celle posée à côté de lui, à défaut celle que
 * porte le GPX complet (`library/sessionBundle.ts`).
 */

/** Ce que l'import apporte à la fiche de la session (`addGpx` de la bibliothèque). */
export interface ImportRecordChoice {
  /** Fiche à fondre, résumé refait ; `null` sans fiche, ou si elle est gardée telle quelle. */
  record: RecordWithoutSummary | null;
  /** Champs illisibles de cette fiche, réécrits tels quels. */
  unreadable: RecordUnreadable | undefined;
  /** Fiche qu'on ne sait pas réécrire (version plus récente, illisible) : rangée telle quelle. */
  keepRecordText: KeptRecordText | undefined;
}

/**
 * Fiche posée à côté (`recordText`, `undefined` ou `null` sans fichier), sinon celle du paquet : une fiche vide
 * est tenue pour absente ; une qu'on ne sait pas réécrire (version plus récente, illisible) est rangée telle
 * quelle, au caractère près, et la session reste sans fiche fondue.
 */
export const importRecordChoice = (
  recordText: string | null | undefined,
  bundle: Pick<UnbundledGpx, 'record' | 'recordText' | 'unreadable'>
): ImportRecordChoice => {
  const hasSidecar = typeof recordText === 'string' && !isBlankRecordText(recordText);
  const sidecar = hasSidecar ? parseRecordWithRaw(recordText) : null;
  // Fiche posée à côté, ou à défaut portée par le GPX complet, qu'on ne sait pas réécrire (version plus récente, illisible) : rangée telle quelle.
  const keepRecordText = hasSidecar
    ? recordToKeep(recordText, sidecar)
    : bundle.record === null && bundle.recordText !== null && !isBlankRecordText(bundle.recordText)
      ? recordToKeep(bundle.recordText, parseRecordWithRaw(bundle.recordText))
      : undefined;
  const fromSidecar = sidecar !== null && isWritableRecord(sidecar.parts);
  return {
    record: fromSidecar ? sidecar.parts : keepRecordText ? null : bundle.record,
    unreadable: fromSidecar ? sidecar.unreadable : keepRecordText ? undefined : bundle.unreadable,
    keepRecordText,
  };
};
