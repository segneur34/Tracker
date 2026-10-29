import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useLongPress } from '../../hooks/useLongPress';
import { useTransientValue } from '../../hooks/useTransientValue';
import Button from './Button';
import HoldDial from './HoldDial';

/** Carré rouge de l'arrêt, dans le grand cadran. */
const STOP_ICON = <span className="ui-record-dot ui-record-dot--stop" style={{ width: '48px', height: '48px', borderRadius: '8px' }} />;

/**
 * Bouton qu'on tient pour agir (arrêt de l'enregistrement, arrêt d'une séance
 * du compteur) : tenu `getHoldMs()`, le grand cadran sous le doigt ; un appui
 * court rappelle le geste quelques secondes. À 0, un simple appui agit.
 */
function HoldButton({ onHold, getHoldMs, label, lead, dialTitle, color = 'var(--recording)', icon = STOP_ICON, disabled = false, size, style }: {
  onHold: () => void;
  /** Lue au rendu et à chaque appui : un réglage changé vaut au retour sur la page. */
  getHoldMs: () => number;
  label: string;
  /** Devant le texte, gardé pendant le rappel du geste (le carré de l'arrêt). */
  lead?: ReactNode;
  dialTitle: string;
  color?: string;
  icon?: ReactNode;
  disabled?: boolean;
  size?: 's' | 'm' | 'l';
  style?: CSSProperties;
}) {
  const holdMs = getHoldMs();
  const { pressingMs, handlers } = useLongPress(onHold, getHoldMs, holdMs > 0 && !disabled);
  /** Rappel du geste après un appui trop court, effacé au bout de quelques secondes. */
  const [hint, setHint] = useTransientValue<true>(3000);

  const onClick = (e: MouseEvent) => {
    if (holdMs === 0) {
      onHold();
      return;
    }
    handlers.onClick(e);
    // Le clic qui suit un appui long abouti est annulé par `useLongPress` : seul un appui court rappelle le geste.
    if (!e.defaultPrevented) setHint(true);
  };

  const holdS = (holdMs / 1000).toLocaleString('fr-FR');
  return (
    <>
      <Button variant="danger" size={size} className="ui-btn--hold" style={style} disabled={disabled} {...handlers} onClick={onClick}>
        {lead}
        {hint ? `Maintenir ${holdS} s pour arrêter` : label}
      </Button>
      {pressingMs !== null && <HoldDial pressMs={pressingMs} color={color} icon={icon} title={dialTitle} hint="Maintenez le bouton" />}
    </>
  );
}

export default HoldButton;
