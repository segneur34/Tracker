import { plural } from '../core/basics';

/**
 * Compte rendu d'un import de sessions (fichiers GPX ou FIT, dossier mémoire) et sa
 * phrase pour l'utilisateur, purs (lot 72).
 */

export interface ImportReport {
  added: string[];
  /** Sessions déjà présentes, par leur nom dans la mémoire. */
  existing: string[];
  duplicates: number;
  invalid: string[];
  /**
   * GPX vides ou blancs (écriture interrompue) : ni sessions ni illisibles. Comptés, pas dits dans
   * la phrase du compte rendu.
   */
  ignored: string[];
  /** FIT lisibles qui ne sont pas des activités (réglages, parcours…) : ignorés, dits seulement si rien d'autre n'est à dire. */
  notActivities: string[];
  unsaved: number;
  /** Fichiers qu'on n'a pas pu lire ou ranger, avec la raison. */
  failed: string[];
  /**
   * Parmi `failed`, ceux dont le rangement a levé une erreur (écriture dans la mémoire, lecture passagère), par leur nom :
   * un nouvel essai peut réussir, à la différence d'un fichier illisible.
   */
  retryable: string[];
  /** Sessions déjà présentes qui ont reçu leurs capteurs (`.imu`). */
  motionAdded: number;
  /** GPX rangés ou déjà présents dont les capteurs (`.imu`) ne se sont pas lus : gardés sans eux, un nouvel import les ajoute. */
  motionFailed: string[];
  /** Sessions déjà présentes dont la fiche a été complétée. */
  recordCompleted: number;
  /** Sessions déjà présentes à compléter dont la fiche n'a pas pu être relue : rien n'y a été ajouté. */
  recordNotRead: number;
}

/** Phrase du compte rendu : sessions ajoutées, déjà présentes, complétées ou non, illisibles, non rangées. */
export const describeImport = (report: ImportReport): string => {
  const nothingElse = report.added.length === 0 && report.duplicates === 0 && report.invalid.length === 0 && report.unsaved === 0 && report.failed.length === 0;
  if (report.notActivities.length > 0 && nothingElse) {
    return report.notActivities.length > 1
      ? `Ces ${report.notActivities.length} fichiers de montre ne sont pas des activités (réglages, parcours…) : rien n'a été importé.`
      : "Ce fichier de montre n'est pas une activité (réglages, parcours…) : rien n'a été importé.";
  }
  const parts: string[] = [];
  parts.push(report.added.length === 1 ? '1 session ajoutée' : `${report.added.length} sessions ajoutées`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} déjà présente${report.duplicates > 1 ? 's' : ''}`);
  if (report.motionAdded > 0) {
    parts.push(`capteurs ajoutés à ${report.motionAdded} session${report.motionAdded > 1 ? 's' : ''} déjà présente${report.motionAdded > 1 ? 's' : ''}`);
  }
  if (report.motionFailed.length > 0) {
    const s = report.motionFailed.length > 1 ? 's' : '';
    parts.push(`capteurs illisibles pour ${report.motionFailed.length} session${s} (${report.motionFailed.join(', ')}), gardée${s} sans eux : un nouvel import les ajoutera`);
  }
  if (report.recordCompleted > 0) {
    parts.push(`fiche complétée pour ${report.recordCompleted} session${report.recordCompleted > 1 ? 's' : ''} déjà présente${report.recordCompleted > 1 ? 's' : ''}`);
  }
  if (report.recordNotRead > 0) {
    const s = report.recordNotRead > 1 ? 's' : '';
    parts.push(`fiche non relue pour ${report.recordNotRead} session${s} déjà présente${s} : non complétée${s}`);
  }
  if (report.invalid.length > 0) parts.push(`${report.invalid.length} illisible${report.invalid.length > 1 ? 's' : ''} (${report.invalid.join(', ')})`);
  if (report.unsaved > 0) {
    parts.push(`${report.unsaved} non rangée${report.unsaved > 1 ? 's' : ''} : désignez d'abord le dossier mémoire (Réglages › Mémoire)`);
  }
  return `${parts.join(', ')}.`;
};

/**
 * Compte rendu de « Mettre à jour » : sessions apparues et disparues, d'après les débuts de trace d'avant et
 * d'après la relecture (lot 113, sorti de la bibliothèque).
 */
export const describeRefresh = (before: ReadonlySet<number>, after: ReadonlySet<number>): string => {
  const added = [...after].filter((startMs) => !before.has(startMs)).length;
  const removed = [...before].filter((startMs) => !after.has(startMs)).length;
  const changes = [
    ...(added > 0 ? [`${plural(added, 'session')} de plus`] : []),
    ...(removed > 0 ? [`${plural(removed, 'session')} en moins`] : []),
  ];
  return `Dossier relu : ${changes.length > 0 ? changes.join(', ') : 'rien de nouveau'}.`;
};
