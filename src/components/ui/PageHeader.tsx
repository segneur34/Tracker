import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconBack } from '../icons';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Lien de retour, au-dessus du titre. */
  back?: { to: string; label: string };
  /** Contenu aligné à droite du titre : une date, un bouton. */
  aside?: ReactNode;
}

/** En-tête d'écran : retour éventuel, titre, sous-titre. */
function PageHeader({ title, subtitle, back, aside }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      {back && (
        <Link to={back.to} className="ui-back">
          <IconBack />
          {back.label}
        </Link>
      )}
      <div className="ui-page-header__row">
        <h1>{title}</h1>
        {aside}
      </div>
      {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
    </header>
  );
}

export default PageHeader;
