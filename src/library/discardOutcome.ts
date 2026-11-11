/** Appui long qui jette une session depuis son analyse (lot 212) : une seconde. */
export const DISCARD_HOLD_MS = 1000;

/**
 * Ce que dit la fenêtre de confirmation après `removeSession`, qui ne lève pas d'erreur : elle la range dans
 * l'état de la bibliothèque (mémoire en lecture seule…). Session partie de la liste : on repart, rien à dire
 * (une suppression incomplète, des capteurs orphelins, se lit dans la bibliothèque). Session restée : la
 * raison de la bibliothèque, sinon une phrase générale.
 */
export const discardFailureMessage = (stillListed: boolean, libraryError: string | null): string | null => {
  if (!stillListed) return null;
  const reason = libraryError?.trim();
  return reason ? reason : "La session n'a pas pu être supprimée.";
};
