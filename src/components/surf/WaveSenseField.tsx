import { HelpText, HelpToggle } from '../Help';
import Button from '../ui/Button';
import { waveSenseOrigin } from './waveSenseView';

interface WaveSenseFieldProps {
  /** Cap vers lequel vont les vagues, en degrés ; `null` quand il n'est ni saisi ni estimé assez nettement. */
  directionDeg: number | null;
  /** Sens calculé, rappelé quand un sens saisi le remplace ; `null` sans calcul exploitable. */
  autoDeg: number | null;
  /** Vrai quand le sens est saisi pour la session. */
  manual: boolean;
  /** Vrai quand le sens calculé est jugé sûr. */
  reliable: boolean;
  /** Réglage en cours sur la carte : le bouton attend. */
  adjusting: boolean;
  onAdjust: () => void;
}

/**
 * Ligne « Sens des vagues » de l'onglet réglages du surf : le cap, d'où il
 * vient, et « Régler » qui ouvre la boussole sur la carte.
 */
function WaveSenseField({ directionDeg, autoDeg, manual, reliable, adjusting, onAdjust }: WaveSenseFieldProps) {
  return (
    <div>
      <div className="ui-row-6 ui-center ui-wrap">
        <strong>Sens des vagues :</strong>
        {directionDeg === null ? (
          <span className="ui-muted">non estimé</span>
        ) : (
          <>
            <span className="num">{directionDeg}°</span>
            <span className="ui-muted ui-text-xs">{waveSenseOrigin({ manual, reliable, autoDeg })}</span>
          </>
        )}
        <Button size="s" onClick={onAdjust} disabled={adjusting}>Régler</Button>
        <HelpToggle helpKey="surf:sens-vagues" label="Sens des vagues" />
      </div>
      <HelpText helpKey="surf:sens-vagues">
        La flèche montre où vont les vagues, vers la plage. Le sens calculé vient de vos vagues ; quand il se trompe, réglez-le à la main sur la carte. Il oriente la zone du pic et, sur foil, sert à ne pas compter comme une vague une remontée pompée.
      </HelpText>
    </div>
  );
}

export default WaveSenseField;
