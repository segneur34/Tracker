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

export const IconRun = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
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
