import { describe, expect, it } from 'vitest';
import { sessionRecord } from '../test/record.fixture';
import { RECORD_VERSION, parseRecordWithRaw, serializeRecord } from './record';
import { FUTURE_RECORD_WARNING, UNREADABLE_RECORD_WARNING, isBlankRecordText, recordToKeep } from './recordText';

describe('texte d’une fiche (lot 113)', () => {
  it('tient une fiche de 0 octet ou blanche pour absente, pas une fiche manquante', () => {
    expect(isBlankRecordText('')).toBe(true);
    expect(isBlankRecordText(' \n\t')).toBe(true);
    expect(isBlankRecordText(null)).toBe(false);
    expect(isBlankRecordText('{}')).toBe(false);
  });

  it('garde telle quelle une fiche illisible ou d’une version plus récente, pas une fiche qu’on sait réécrire', () => {
    expect(recordToKeep('pas du json', null)).toEqual({ text: 'pas du json', warning: UNREADABLE_RECORD_WARNING, parts: null });
    const future = serializeRecord({ ...sessionRecord(), version: RECORD_VERSION + 1 });
    const parsedFuture = parseRecordWithRaw(future);
    expect(recordToKeep(future, parsedFuture)).toEqual({ text: future, warning: FUTURE_RECORD_WARNING, parts: parsedFuture?.parts });
    const current = serializeRecord(sessionRecord());
    expect(recordToKeep(current, parseRecordWithRaw(current))).toBeUndefined();
  });
});
