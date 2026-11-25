import CompassAdjustOverlay from '../CompassAdjustOverlay';
import { waveSenseOrigin } from './waveSenseView';

interface WaveSenseOverlayProps {
  /** Cap vers lequel vont les vagues, en degrés, tel qu'il est retenu ; `null` tant qu'il n'est pas estimé. */
  directionDeg: number | null;
  /** Sens calculé, rappelé quand un sens saisi le remplace ; `null` sans calcul exploitable. */
  autoDeg: number | null;
  /** Vrai quand le sens est saisi, faux quand il est calculé. */
  manual: boolean;
  /** Vrai quand le sens calculé est jugé sûr. */
  reliable: boolean;
  /** Écrit le sens saisi dans le brouillon ; `null` revient au calculé. */
  onChange: (deg: number | null) => void;
  onClose: () => void;
}

const WAVE_TEXTS = {
  value: (deg: number) => `Vagues ${deg}°`,
  field: 'Sens des vagues en degrés',
  dial: 'Sens des vagues',
  reset: 'Revenir au sens calculé',
};

/**
 * Réglage du sens des vagues posé sur la carte d'une analyse de surf : la
 * boussole commune (`CompassAdjustOverlay`), la flèche du centre vers le bord,
 * qui montre où vont les vagues ; la poignée au bord donne le cap.
 */
function WaveSenseOverlay({ directionDeg, autoDeg, manual, reliable, onChange, onClose }: WaveSenseOverlayProps) {
  return (
    <CompassAdjustOverlay value={directionDeg} autoValue={autoDeg} canReset={manual} onChange={onChange} onClose={onClose}
      arrow="versBord" texts={WAVE_TEXTS} source={waveSenseOrigin({ manual, reliable, autoDeg })} />
  );
}

export default WaveSenseOverlay;
