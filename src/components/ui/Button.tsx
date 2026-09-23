import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'record' | 'danger' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Rôle du bouton : `record` pour Enregistrer, `danger` pour Arrêter. */
  variant?: ButtonVariant;
  /** `l` pour l'action principale d'un écran de téléphone, `s` dans un tableau ou une légende. */
  size?: 's' | 'm' | 'l';
  /** Toute la largeur disponible. */
  block?: boolean;
}

/** Bouton de l'application, en `type="button"` par défaut : jamais d'envoi de formulaire involontaire. */
function Button({ variant = 'secondary', size = 'm', block = false, className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['ui-btn', `ui-btn--${variant}`, size !== 'm' && `ui-btn--${size}`, block && 'ui-btn--block', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}

export default Button;
