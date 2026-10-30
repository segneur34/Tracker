/**
 * Compte rendu d'un import de sessions (fichiers GPX ou dossier mémoire) et sa
 * phrase pour l'utilisateur, purs (lot 72).
 */

export interface ImportReport {
  added: string[];
  /** Sessions déjà présentes, par leur nom dans la mémoire. */
  existing: string[];
  duplicates: number;
  invalid: string[];
  unsaved: number;
  /** Fichiers qu'on n'a pas pu lire ou ranger, avec la raison. */
  failed: string[];
  /** Sessions déjà présentes qui ont reçu leurs capteurs (`.imu`). */
  motionAdded: number;
  /** Sessions déjà présentes dont la fiche a été complétée. */
  recordCompleted: number;
}

/** Phrase du compte rendu : sessions ajoutées, déjà présentes, complétées, illisibles, non rangées. */
export const describeImport = (report: ImportReport): string => {
  const parts: string[] = [];
  parts.push(report.added.length === 1 ? '1 session ajoutée' : `${report.added.length} sessions ajoutées`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} déjà présente${report.duplicates > 1 ? 's' : ''}`);
  if (report.motionAdded > 0) {
    parts.push(`capteurs ajoutés à ${report.motionAdded} session${report.motionAdded > 1 ? 's' : ''} déjà présente${report.motionAdded > 1 ? 's' : ''}`);
  }
  if (report.recordCompleted > 0) {
    parts.push(`fiche complétée pour ${report.recordCompleted} session${report.recordCompleted > 1 ? 's' : ''} déjà présente${report.recordCompleted > 1 ? 's' : ''}`);
  }
  if (report.invalid.length > 0) parts.push(`${report.invalid.length} illisible${report.invalid.length > 1 ? 's' : ''} (${report.invalid.join(', ')})`);
  if (report.unsaved > 0) {
    parts.push(`${report.unsaved} non rangée${report.unsaved > 1 ? 's' : ''} : désignez d'abord le dossier mémoire (Réglages › Mémoire)`);
  }
  return `${parts.join(', ')}.`;
};
