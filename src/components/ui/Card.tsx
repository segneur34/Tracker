import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Titre de la carte, facultatif. */
  heading?: ReactNode;
}

/** Bloc blanc arrondi, l'unité de mise en page des écrans. */
function Card({ heading, className, children, ...rest }: CardProps) {
  return (
    <section className={['ui-card', className].filter(Boolean).join(' ')} {...rest}>
      {heading && <h2 className="ui-card__title">{heading}</h2>}
      {children}
    </section>
  );
}

export default Card;
