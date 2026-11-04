import { describe, expect, it } from 'vitest';
import { sessionRecord } from '../test/record.fixture';
import { importRecordChoice } from './importEntry';
import { RECORD_VERSION, parseRecordWithRaw, serializeRecord } from './record';
import { FUTURE_RECORD_WARNING, UNREADABLE_RECORD_WARNING } from './recordText';

const sidecarText = serializeRecord(sessionRecord({ name: 'À côté' }));
const bundleText = serializeRecord(sessionRecord({ name: 'Du paquet' }));
const futureText = serializeRecord({ ...sessionRecord({ name: 'Future' }), version: RECORD_VERSION + 1 });
const bundle = { record: parseRecordWithRaw(bundleText)?.parts ?? null, recordText: bundleText, unreadable: {} };
const noBundle = { record: null, recordText: null, unreadable: {} };

describe('fiche d’un GPX importé (lot 113)', () => {
  it('prend la fiche posée à côté avant celle du paquet', () => {
    const choice = importRecordChoice(sidecarText, bundle);
    expect(choice.record?.name).toBe('À côté');
    expect(choice.keepRecordText).toBeUndefined();
    expect(choice.unreadable).toEqual({});
  });

  it('prend celle du paquet sans fiche à côté, ou à côté d’une fiche vide', () => {
    expect(importRecordChoice(undefined, bundle).record?.name).toBe('Du paquet');
    expect(importRecordChoice('  ', bundle).record?.name).toBe('Du paquet');
    expect(importRecordChoice(null, noBundle)).toEqual({ record: null, unreadable: {}, keepRecordText: undefined });
  });

  it('range telle quelle une fiche à côté illisible ou plus récente, sans fondre celle du paquet', () => {
    expect(importRecordChoice('{ abîmée', bundle)).toEqual({
      record: null, unreadable: undefined, keepRecordText: { text: '{ abîmée', warning: UNREADABLE_RECORD_WARNING, parts: null },
    });
    const future = importRecordChoice(futureText, bundle);
    expect(future.record).toBeNull();
    expect(future.keepRecordText?.warning).toBe(FUTURE_RECORD_WARNING);
    expect(future.keepRecordText?.parts?.name).toBe('Future');
  });

  it('range telle quelle la fiche du paquet qu’il n’a pas su lire, pas une fiche de paquet blanche', () => {
    const choice = importRecordChoice(undefined, { record: null, recordText: futureText, unreadable: {} });
    expect(choice.record).toBeNull();
    expect(choice.keepRecordText?.text).toBe(futureText);
    expect(importRecordChoice(undefined, { record: null, recordText: ' ', unreadable: {} }).keepRecordText).toBeUndefined();
  });
});
