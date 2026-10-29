import { useEffect, useState } from 'react';

/**
 * Valeur passagère : posée par le setter, elle s'efface d'elle-même (`null`)
 * au bout de `durationMs`. Pour un compte rendu de quelques secondes (« Note 3
 * posée », « Session enregistrée »), un rappel du geste.
 */
export const useTransientValue = <T>(durationMs: number) => {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (value === null) return undefined;
    const timer = setTimeout(() => setValue(null), durationMs);
    return () => clearTimeout(timer);
  }, [value, durationMs]);
  return [value, setValue] as const;
};
