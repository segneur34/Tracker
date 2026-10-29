import { useEffect, useState } from 'react';
import { addDays, startOfDay } from '../core/calendar';

/** Marge après minuit : la minuterie ne repart pas juste avant, sur un réveil un peu en avance. */
const AFTER_MIDNIGHT_MS = 1000;

/**
 * « Maintenant », pour les pages qui comptent en jours et en semaines
 * (Statistiques, Profil) : relu quand la page redevient visible (une page
 * reste montée tant que l'application vit en arrière-plan) et à chaque minuit
 * local. Sans cela, après une nuit en arrière-plan, la semaine passée resterait
 * « cette semaine ».
 */
export function useNow(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      timer = window.setTimeout(refresh, addDays(startOfDay(now), 1) - now + AFTER_MIDNIGHT_MS);
    };
    const refresh = () => {
      setNowMs(Date.now());
      arm();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return nowMs;
}
