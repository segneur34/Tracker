import { FAMILY_ACCENT } from '../core/activities';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cyclingEnergyView } from '../cycling/energyView';
import {
  runningEnergyView, type EnergyInputs, type EnergyViewData, type EnergyWarning,
} from '../running/energyView';

/**
 * Les familles terrestres, course à pied, vélo et fractionné, partagent un
 * module d'analyse (`LandModule`) : carte, synthèse, zones de pente, graphes
 * et réglages de session sont les mêmes. Ce qui change tient ici, en deux
 * parts :
 * - selon la famille, la page : titre, retour à la bibliothèque, couleur,
 *   identifiants mémorisés (`LAND_PAGES`) ;
 * - selon le traitement du calcul de l'activité, le modèle : énergie, ramenée
 *   à une forme d'affichage commune (`EnergyView`), revêtement demandé à
 *   l'ouverture, libellés (`LAND_TREATMENTS`). Le fractionné à pied a celui
 *   de la course, le fractionné vélo celui du vélo (§10, point 89).
 */

/** Familles analysées par `LandModule`. */
export type LandFamily = 'course' | 'velo' | 'fractionne';

/** Traitements terrestres. */
export type LandTreatment = 'course' | 'velo';

/** Ce que le panneau Énergie affiche (`EnergyViewData`), l'avertissement mis en phrase. */
export interface EnergyView extends Omit<EnergyViewData, 'warning'> {
  /** Avertissement sur les données manquantes, au-dessus des chiffres. */
  warning: ReactNode | null;
}

/** Ce qui suit la famille : la page et ce qu'elle mémorise. */
export interface LandPageConfig {
  family: LandFamily;
  title: string;
  /** Lien de retour vers la bibliothèque. */
  backLabel: string;
  accent: string;
  /**
   * Préfixe des sections ouvertes et des tailles de panneaux mémorisées
   * (`ResizablePanel`) : ne pas le renommer, les tailles seraient perdues.
   */
  storageId: string;
}

/** Ce qui suit le traitement du calcul : le modèle et ses libellés. */
export interface LandTreatmentConfig {
  treatment: LandTreatment;
  /** Libellé de la couleur grise de la légende, sous la borne basse. */
  slowLabel: string;
  zonesTitle: string;
  energyLabel: string;
  /** Avertissement d'un fichier sans altitude, sous les chiffres d'énergie. */
  flatWarning: string;
  /**
   * Revêtement demandé dès l'ouverture de l'analyse, pour l'énergie (le
   * roulement à vélo) ; sinon à la première ouverture de l'onglet « surface ».
   */
  surfacesAtOpening: boolean;
  energy: (inputs: EnergyInputs) => EnergyView;
}

const warningPerKg = (
  <>Poids non renseigné : valeurs par kilo. Il se saisit dans <Link to="/parametres">Réglages</Link>, bloc Pratiquant.</>
);

/** Avertissement d'énergie mis en phrase, lien vers Réglages compris. */
const energyWarningText = (warning: EnergyWarning): ReactNode => {
  switch (warning.code) {
    case 'sans-poids':
      return warningPerKg;
    case 'sans-poids-charge':
      return <>{warningPerKg} La charge portée ({warning.loadKg} kg) n'est prise en compte qu'avec le poids.</>;
    case 'sans-poids-velo':
      return <>Poids non renseigné : énergie non calculée. Il se saisit dans <Link to="/parametres">Réglages</Link>, bloc Pratiquant.</>;
    case 'revetement-recherche':
      return `Revêtement en cours de recherche (OpenStreetMap) : ${warning.nominal} partout en attendant.`;
    case 'revetement-introuvable':
      return `Revêtement introuvable : ${warning.nominal} partout. L'onglet surface permet de réessayer.`;
  }
};

/** Le panneau Énergie d'un modèle pur (`*EnergyView`), l'avertissement rendu. */
const withWarningText = (view: (inputs: EnergyInputs) => EnergyViewData) => (inputs: EnergyInputs): EnergyView => {
  const data = view(inputs);
  return { ...data, warning: data.warning ? energyWarningText(data.warning) : null };
};


export const LAND_PAGES: Record<LandFamily, LandPageConfig> = {
  course: {
    family: 'course',
    title: 'Analyse à pied',
    backLabel: 'Sessions à pied',
    accent: FAMILY_ACCENT.course,
    storageId: 'running',
  },
  velo: {
    family: 'velo',
    title: 'Analyse vélo',
    backLabel: 'Sessions vélo',
    accent: FAMILY_ACCENT.velo,
    storageId: 'cycling',
  },
  fractionne: {
    family: 'fractionne',
    title: 'Analyse fractionné',
    backLabel: 'Entraînement',
    accent: FAMILY_ACCENT.fractionne,
    storageId: 'intervals',
  },
};

export const LAND_TREATMENTS: Record<LandTreatment, LandTreatmentConfig> = {
  course: {
    treatment: 'course',
    slowLabel: 'marche',
    zonesTitle: 'Allure par zone de pente',
    energyLabel: 'Énergie',
    flatWarning: 'Sans altitude dans le fichier, la course est comptée comme plate.',
    surfacesAtOpening: false,
    energy: withWarningText(runningEnergyView),
  },
  velo: {
    treatment: 'velo',
    slowLabel: 'arrêt',
    zonesTitle: 'Vitesse par zone de pente',
    energyLabel: 'Énergie',
    flatWarning: 'Sans altitude dans le fichier, la sortie est comptée comme plate.',
    surfacesAtOpening: true,
    energy: withWarningText(cyclingEnergyView),
  },
};
