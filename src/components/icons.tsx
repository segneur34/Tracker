import type { SVGProps } from 'react';

/**
 * Icônes de l'application, en trait, à la couleur du texte (`currentColor`).
 * Dessinées sur une grille de 24 : elles se lisent de 16 à 32 px.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const strokeProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export const IconHome = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
  </svg>
);

export const IconSail = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 3v14" />
    <path d="M12 3c4 3 6 8 6 12h-6" />
    <path d="M12 6c-3 3-5 6-6 9h6" />
    <path d="M4 19c2.5 1.5 5 1.5 8 0s5.5-1.5 8 0" />
  </svg>
);

/** Coureur stylisé, en pleine foulée vers la droite. */
export const IconRun = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="16" cy="4" r="1.6" fill="currentColor" />
    <path d="M14.5 8l-2.5 6" />
    <path d="M14 9.5l3 2.5h2.5" />
    <path d="M14 9.5l-3.5.5-2 2.5" />
    <path d="M12 14l3 2v4.5" />
    <path d="M12 14l-2.5 4H5" />
  </svg>
);

export const IconBike = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="5.5" cy="16" r="3.5" />
    <circle cx="18.5" cy="16" r="3.5" />
    <path d="M5.5 16l4-7h6l3 7" />
    <path d="M9.5 9l3 7h6" />
    <path d="M8 6h3" />
    <path d="M15.5 9l-1-3h2" />
  </svg>
);

/** Chronomètre : le fractionné et son compteur. */
export const IconStopwatch = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 13.5V9.5" />
    <path d="M10 2.5h4" />
    <path d="M12 2.5V6" />
    <path d="M18.5 6.5l1.5-1.5" />
  </svg>
);

export const IconSettings = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);

export const IconFile = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M12 12v6M9 15l3 3 3-3" />
  </svg>
);

export const IconChevronRight = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconChevronUp = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);

/** Quatre carrés : le menu des sports de la barre du bas. */
export const IconGrid = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </svg>
);

export const IconHelp = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconBack =({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export const IconPause = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M8 5v14M16 5v14" />
  </svg>
);

export const IconPlay = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M7 5l11 7-11 7z" />
  </svg>
);

/** Flèche qui revient en arrière : « Précédent », annuler la dernière modification. */
export const IconUndo = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

export const IconRoute = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />
  </svg>
);

/** Trois points : le menu « … » des actions de moindre usage. */
export const IconMore = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="19" cy="12" r="1.3" fill="currentColor" />
  </svg>
);

/** Flèche vers un plateau : télécharger un fichier. */
export const IconDownload = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 4v11M7 10l5 5 5-5" />
    <path d="M5 19h14" />
  </svg>
);

/** Flèche qui tourne : « Mettre à jour », relire le dossier mémoire. */
export const IconRefresh = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M21 4v6h-6" />
    <path d="M20.5 15a9 9 0 1 1-2.1-9.4L21 10" />
  </svg>
);
