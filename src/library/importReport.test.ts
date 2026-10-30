import { describe, expect, it } from 'vitest';
import { describeImport, type ImportReport } from './importReport';

const report = (patch: Partial<ImportReport> = {}): ImportReport => ({
  added: [], existing: [], duplicates: 0, invalid: [], unsaved: 0, failed: [], motionAdded: 0, recordCompleted: 0, ...patch,
});

describe("compte rendu d'un import (lot 72)", () => {
  it('dit les sessions ajoutées, au singulier comme au pluriel', () => {
    expect(describeImport(report({ added: ['a.gpx'] }))).toBe('1 session ajoutée.');
    expect(describeImport(report())).toBe('0 sessions ajoutées.');
  });

  it('ajoute les déjà présentes, complétées, illisibles et non rangées, dans cet ordre', () => {
    expect(describeImport(report({
      added: ['a.gpx', 'b.gpx'], duplicates: 2, motionAdded: 1, recordCompleted: 3, invalid: ['x.gpx'], unsaved: 1,
    }))).toBe(
      '2 sessions ajoutées, 2 déjà présentes, capteurs ajoutés à 1 session déjà présente, '
      + 'fiche complétée pour 3 sessions déjà présentes, 1 illisible (x.gpx), '
      + "1 non rangée : désignez d'abord le dossier mémoire (Réglages › Mémoire).",
    );
  });
});
