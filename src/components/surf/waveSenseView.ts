import type { WaveSense } from '../../surfing/waveSense';

export interface WaveSenseView {
  /** Sens montré, en degrés entiers : le saisi, ou le calculé quand ses mesures vont assez dans le même sens ; sinon `null`. */
  shownDeg: number | null;
  /** Vrai quand le sens est saisi. */
  manual: boolean;
  /** Vrai quand le sens montré est sûr (un sens saisi l'est toujours). */
  reliable: boolean;
  /** Sens calculé, rappelé à côté d'un sens saisi ; `null` sans saisie ou sans calcul exploitable. */
  autoDeg: number | null;
}

/** Mention qui dit d'où vient le sens des vagues montré : la ligne des réglages, le « général » et la boussole la partagent. */
export const waveSenseOrigin = ({ manual, reliable, autoDeg }: Pick<WaveSenseView, 'manual' | 'reliable' | 'autoDeg'>): string => {
  if (manual) return autoDeg !== null ? `saisi · calculé ${autoDeg}°` : 'saisi';
  return reliable ? 'calculé' : 'calculé · peu sûr';
};

const wholeDeg = (deg: number): number => Math.round(deg) % 360;

/**
 * Ce que la boussole et la ligne des réglages montrent du sens des vagues.
 * Le sens saisi se lit dans le brouillon, qui est à jour tout de suite ; seul
 * le sens calculé vient de l'analyse, dont les chiffres retardent pendant un
 * recalcul. `minR` : la concentration sous laquelle le calculé n'est pas
 * montré (`SurfProfile.waveSense.minR`, celle qui l'empêche d'orienter la zone
 * du pic).
 */
export const waveSenseView = (entered: number | null, estimated: WaveSense | null, minR: number): WaveSenseView => {
  const usable = estimated !== null && estimated.R >= minR ? estimated : null;
  if (entered !== null) {
    return { shownDeg: wholeDeg(entered), manual: true, reliable: true, autoDeg: usable === null ? null : wholeDeg(usable.directionDeg) };
  }
  return { shownDeg: usable === null ? null : wholeDeg(usable.directionDeg), manual: false, reliable: estimated?.reliable ?? false, autoDeg: null };
};
