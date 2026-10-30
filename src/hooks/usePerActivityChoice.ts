import { useState } from 'react';

/** Choix fait sur la page pour une activité (case cochée ou décochée, zone visée). */
export interface PerActivityChoice<T = boolean> {
  activityId: string;
  measure: T;
}

/** Valeur d'un choix : celui fait sur la page pour cette activité, sinon `fallback` (Réglages). */
export const choiceFor = <T,>(choice: PerActivityChoice<T> | null, activityId: string | null, fallback: T): T =>
  choice !== null && activityId !== null && choice.activityId === activityId ? choice.measure : fallback;

/**
 * Choix d'Enregistrer qui vaut pour cet enregistrement (sauts, pumping,
 * cadence, ceinture, zone visée) : celui de l'activité dans Réglages
 * (`fallback`), jusqu'à ce que l'utilisateur le change ; son choix ne suit pas
 * une autre activité choisie ensuite. Rend la valeur et de quoi la changer.
 */
export const usePerActivityChoice = <T = boolean,>(activityId: string | null, fallback: T): [T, (measure: T) => void] => {
  const [choice, setChoice] = useState<PerActivityChoice<T> | null>(null);
  const set = (measure: T) => {
    if (activityId !== null) setChoice({ activityId, measure });
  };
  return [choiceFor(choice, activityId, fallback), set];
};
