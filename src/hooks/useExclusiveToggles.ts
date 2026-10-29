import { useState } from 'react';

/**
 * Deux interrupteurs dont un seul est allumé à la fois : en allumer un éteint
 * l'autre, l'éteindre ne rallume rien. « Voir sur la carte » du revêtement et
 * de la pente, qui colorent tous deux la trace (analyses et planification).
 */
export const useExclusiveToggles = () => {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  const toggleFirst = () => {
    setFirst(!first);
    if (!first) setSecond(false);
  };
  const toggleSecond = () => {
    setSecond(!second);
    if (!second) setFirst(false);
  };
  return { first, second, toggleFirst, toggleSecond };
};
