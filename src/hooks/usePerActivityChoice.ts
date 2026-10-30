import { useState } from 'react';

/** Case cochée ou décochée sur la page pour une activité. */
export interface PerActivityChoice {
  activityId: string;
  measure: boolean;
}

/** Valeur d'une case : le choix fait sur la page pour cette activité, sinon `fallback` (Réglages). */
export const choiceFor = (choice: PerActivityChoice | null, activityId: string | null, fallback: boolean): boolean =>
  choice !== null && activityId !== null && choice.activityId === activityId ? choice.measure : fallback;

/**
 * Case d'Enregistrer qui vaut pour cet enregistrement (sauts, pumping,
 * cadence, ceinture) : cochée selon l'activité dans Réglages (`fallback`),
 * jusqu'à ce que l'utilisateur la change ; son choix ne suit pas une autre
 * activité choisie ensuite. Rend la valeur et de quoi la changer.
 */
export const usePerActivityChoice = (activityId: string | null, fallback: boolean): [boolean, (measure: boolean) => void] => {
  const [choice, setChoice] = useState<PerActivityChoice | null>(null);
  const set = (measure: boolean) => {
    if (activityId !== null) setChoice({ activityId, measure });
  };
  return [choiceFor(choice, activityId, fallback), set];
};
