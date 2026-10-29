import { errorMessage } from '../core/basics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { holdBelt, releaseBelt, type HeartRateBelt } from '../platform/heartRate';

/** Nom de la connexion prise par la page Enregistrer avant le départ. */
const HOLDER = 'depart';

/**
 * Ceinture connectée dès que sa case est cochée, avant le départ : on voit
 * qu'elle répond (et la demande de permission Bluetooth arrive) avant de
 * partir, pas après. La connexion est tenue sous son nom tant que `active` est
 * vrai, rendue sinon (case décochée, activité sans ceinture, page quittée).
 *
 * Au départ, `handOver` la garde le temps que l'enregistreur la prenne sous
 * le sien (`startRecording` attend la ceinture), puis la rend : elle n'est
 * jamais lâchée entre les deux, donc jamais reconnectée.
 */
export function useBeltWarmup(belt: HeartRateBelt | null, active: boolean): {
  /** Échec de la connexion (permission refusée, Bluetooth éteint), ou `null`. */
  error: string | null;
  /** Nouvel essai après un échec. */
  retry: () => void;
  /** Lance le départ en gardant la connexion jusqu'à ce qu'il soit fait. */
  handOver: (start: () => Promise<void>) => Promise<void>;
} {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Vrai pendant le départ : la connexion n'est pas rendue quand la page cesse de la vouloir. */
  const handingOver = useRef(false);
  /** Numéro de la dernière prise : une prise annulée ne rend pas la ceinture qu'une plus récente tient. */
  const generation = useRef(0);

  useEffect(() => {
    if (!active || belt === null) return;
    let cancelled = false;
    const mine = ++generation.current;
    holdBelt(HOLDER, belt)
      .then(() => {
        // La page n'en veut plus depuis la demande : la rendre aussitôt, sauf si une prise plus
        // récente la tient sous le même nom (double passage d'effet de StrictMode, banc du 28/10).
        if (cancelled && !handingOver.current && generation.current === mine) releaseBelt(HOLDER);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
      // L'échec de cet essai ne vaut plus pour le suivant.
      setError(null);
      if (!handingOver.current) releaseBelt(HOLDER);
    };
  }, [active, belt, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const handOver = useCallback(async (start: () => Promise<void>) => {
    handingOver.current = true;
    try {
      await start();
    } finally {
      handingOver.current = false;
      releaseBelt(HOLDER);
    }
  }, []);

  return { error, retry, handOver };
}
