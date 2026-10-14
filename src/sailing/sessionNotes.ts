/**
 * Notes de session : matériel utilisé, conditions rencontrées, appréciation.
 * Saisies par l'utilisateur, jamais déduites de la trace. En voile : foil, mât,
 * aile, vent et plan d'eau ; ailleurs : deux champs de matériel nommés par
 * activité dans Réglages, et des conditions en texte libre. L'appréciation et
 * le commentaire sont communs à toutes les activités.
 */

export type WindLevel = 'tres-faible' | 'faible' | 'moyen' | 'fort' | 'tres-fort';
export type WaterState = 'plat' | 'clapot' | 'vagues';
export type Rating = 1 | 2 | 3 | 4 | 5;

export interface SailingSessionNotes {
  foil: string;
  mast: string;
  wing: string;
  /** Matériel hors voile, sous les intitulés de l'activité (`gearLabels` des Réglages). */
  gear1: string;
  gear2: string;
  /** Conditions hors voile, en texte libre. */
  conditions: string;
  windLevel: WindLevel | null;
  waterState: WaterState | null;
  rating: Rating | null;
  comment: string;
}

export const EMPTY_NOTES: SailingSessionNotes = {
  foil: '',
  mast: '',
  wing: '',
  gear1: '',
  gear2: '',
  conditions: '',
  windLevel: null,
  waterState: null,
  rating: null,
  comment: '',
};

export const WIND_LEVELS: { value: WindLevel; label: string }[] = [
  { value: 'tres-faible', label: 'Très faible' },
  { value: 'faible', label: 'Faible' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'fort', label: 'Fort' },
  { value: 'tres-fort', label: 'Très fort' },
];

export const WATER_STATES: { value: WaterState; label: string }[] = [
  { value: 'plat', label: 'Plat' },
  { value: 'clapot', label: 'Clapot' },
  { value: 'vagues', label: 'Vagues' },
];

export const RATINGS: { value: Rating; label: string; emoji: string }[] = [
  { value: 1, label: 'Nul', emoji: '😞' },
  { value: 2, label: 'Bof', emoji: '😕' },
  { value: 3, label: 'Moyen', emoji: '😐' },
  { value: 4, label: 'Bien', emoji: '🙂' },
  { value: 5, label: 'Très bien', emoji: '😄' },
];
