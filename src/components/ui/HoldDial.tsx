import type { CSSProperties, ReactNode } from 'react';
import './HoldDial.css';

/**
 * Grand cadran au milieu de l'écran pendant un appui long : le doigt cache le
 * bouton tenu. Il se remplit en `pressMs`, à la couleur `color`. Sert à la
 * pause (bouton rond), au menu des sports et à l'arrêt de l'enregistrement.
 */
function HoldDial({ pressMs, color, icon, title, hint }: {
  pressMs: number;
  color: string;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="hold-dial" aria-hidden="true"
      style={{ '--press-ms': `${pressMs}ms`, '--hold-color': color } as CSSProperties}>
      <div className="hold-dial__dial">
        <svg className="hold-dial__ring" viewBox="0 0 100 100">
          <circle className="hold-dial__track" cx="50" cy="50" r="45" />
          <circle className="hold-dial__fill" cx="50" cy="50" r="45" pathLength="100" />
        </svg>
        <div className="hold-dial__label">
          {icon}
          <span className="hold-dial__title">{title}</span>
          <span className="hold-dial__hint">{hint}</span>
        </div>
      </div>
    </div>
  );
}

export default HoldDial;
