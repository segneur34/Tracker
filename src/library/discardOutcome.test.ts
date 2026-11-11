import { describe, expect, it } from 'vitest';
import { DISCARD_HOLD_MS, discardFailureMessage } from './discardOutcome';

describe('discardFailureMessage', () => {
  it('ne dit rien quand la session a quitté la liste, même avec une suppression incomplète', () => {
    expect(discardFailureMessage(false, null)).toBeNull();
    expect(discardFailureMessage(false, 'Suppression incomplète : disque plein')).toBeNull();
  });

  it("rend la raison de la bibliothèque quand la session est restée", () => {
    expect(discardFailureMessage(true, 'Mémoire en lecture seule.')).toBe('Mémoire en lecture seule.');
  });

  it('a une phrase générale sans raison ou avec une raison vide', () => {
    expect(discardFailureMessage(true, null)).toBe("La session n'a pas pu être supprimée.");
    expect(discardFailureMessage(true, '  ')).toBe("La session n'a pas pu être supprimée.");
  });

  it("tient l'appui long à une seconde", () => {
    expect(DISCARD_HOLD_MS).toBe(1000);
  });
});
