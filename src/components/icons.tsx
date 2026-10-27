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

/** Planche en biais et pagaie croisée devant : surf, paddle et kayak. */
export const IconSurf = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M4.5 19.5C3.5 15 9 7.5 19.5 4.5 20.5 9 15 16.5 4.5 19.5z" />
    <path d="M4 7l3-3" />
    <path d="M5.5 5.5l10 10" />
    <path d="M15.5 15.5c1.8-.3 5.2 3.1 5.5 5.5-2.4-.3-5.8-3.7-5.5-5.5z" />
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

/** Sablier : le Timer de l'Entraînement, minuteries hors fractionné. */
export const IconTimer = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M6 3h12M6 21h12" />
    <path d="M7.5 3v2.5c0 2.5 4.5 4.5 4.5 6.5s-4.5 4-4.5 6.5V21" />
    <path d="M16.5 3v2.5c0 2.5-4.5 4.5-4.5 6.5s4.5 4 4.5 6.5V21" />
    <path d="M9.5 19h5" />
  </svg>
);

/** Cœur traversé d'un pouls : les tests de l'Entraînement (FC max). */
export const IconPulse = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
    <path d="M3 12.5h4l1.5-2.5 2.5 5 2-3.5h8" />
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

export const IconChevronDown = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Flèche vers le haut, avec sa hampe : monter un élément (pas replier, qui est le chevron). */
export const IconArrowUp = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

/** Flèche vers le bas, avec sa hampe : descendre un élément. */
export const IconArrowDown = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

/** Trois barres montantes sur leur axe : les statistiques. */
export const IconChart = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M4 20h16" />
    <path d="M7 16v-4" />
    <path d="M12 16V8" />
    <path d="M17 16V4" />
  </svg>
);

export const IconUser = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-3.5 4.4-5 8-5s6.5 1.5 8 5" />
  </svg>
);

/** Image : importer une photo. */
export const IconImage = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-5-5-7 8" />
  </svg>
);

export const IconHelp = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7" />
    <path d="M12 17h.01" />
  </svg>
);

/** Œil ouvert : visible (Réglages, cacher une famille ou une activité). */
export const IconEye = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Œil barré : caché. */
export const IconEyeOff = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6" />
    <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M3 3l18 18" />
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

/** Trois points reliés, comme le partage d'Android : partager l'image d'une session. */
export const IconShare = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5" />
  </svg>
);

/** Flèche qui tourne : « Mettre à jour », relire le dossier mémoire. */
export const IconRefresh = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M21 4v6h-6" />
    <path d="M20.5 15a9 9 0 1 1-2.1-9.4L21 10" />
  </svg>
);

/** Deux couches empilées : le bouton qui change le fond de carte, plan ou satellite. */
export const IconLayers = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

/** Fanion : le bouton « Note » de l'enregistrement, et les repères qu'il pose. */
export const IconFlag = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M6 21V4" />
    <path d="M6 4h11l-2.5 4L17 12H6" />
  </svg>
);

/** Cadenas fermé ou ouvert : l'orientation de l'écran figée pendant l'enregistrement, ou libre. */
export const IconLock = ({ size = 24, open = false, ...props }: IconProps & { open?: boolean }) => (
  <svg {...strokeProps(size)} {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d={open ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
  </svg>
);

/* Icônes d’activité (core/activityIcons.ts) : la course reprend IconRun. */

/** Voilier : mât, grand-voile, foc et coque. */
export const IconSailboat = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M12 3v13" />
    <path d="M12 3.5l6.5 11H12" />
    <path d="M10 6.5l-4.5 8H10" />
    <path d="M3.5 17.5h17l-2.5 3H6z" />
  </svg>
);

/**
 * Planche à voile : contour de la voile relevé sur la photo fournie par l'utilisateur (21/10), voile penchée,
 * mât courbe ; deux lattes, et le wishbone qui dépasse du point d'écoute. Voile vide, traits pleins (son choix).
 */
export const IconWindsurf = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} strokeWidth={1.6} {...props}>
    <path d="M8.7 1.3L11.9 1C15 5.4 16.6 9.2 17.2 13.2L17.4 22.9C14 21.6 11 20.8 9.9 20.4L7.6 18L6.3 17.7Z" />
    <path d="M8 6.6l6.5-.7M7.3 11.4l9.4-.8" strokeWidth={1.3} />
    <path d="M17.6 15.8L4.3 17.9" strokeWidth={1.8} />
  </svg>
);

/** Wingfoil : l'aile, en aplat, vectorisée sur le modèle fourni par l'utilisateur (18/10) : bord d'attaque, boudin central, deux panneaux. */
export const IconWingfoil = ({ size = 24, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden focusable={false} {...props}>
    <path fillRule="evenodd" d="M14.9 1C12.2 1.6 9.4 3 7.4 4.8C5.4 6.6 4 8.3 3.1 10C0.1 15.2 0.2 19.5 3.3 22.5C3.9 23 4.5 23.3 4.5 23C4.4 22.9 4.2 22.5 4 22.1C1.6 18 2 14.6 5.3 10.2C7.2 7.7 6.7 7.7 9.4 10.3C10.8 11.6 11.1 11.9 11.5 12.2C11.7 12.4 12.1 12.7 12.3 12.9C12.5 13.1 13 13.5 13.3 13.8C13.6 14.1 14 14.4 14.2 14.6C15.3 15.6 15.8 15.9 15.8 15.4C15.8 15.3 14.9 14.2 14 13.2C13.8 13 13.4 12.5 13.1 12.2C12.8 11.9 12.4 11.5 12.2 11.2C11.9 10.9 11.6 10.6 11.5 10.5C11.5 10.4 11.3 10.1 11.1 9.9C10.3 9.1 10 8.7 9.6 8.2C9.3 7.9 9 7.6 8.9 7.4C8.4 6.9 8.4 6.8 9.3 6C13.5 1.9 17.8 1.1 21.9 3.6C23.4 4.5 23.5 4 22 2.8C19.9 1.2 17.3 0.5 14.9 1M17 2.9C17 2.9 16.8 3 16.6 3C15.8 3.1 14.4 3.6 13.4 4.1C13.1 4.3 12.6 4.6 12.4 4.7C10.3 5.9 10 7 11.3 8.6C11.4 8.7 11.6 8.9 11.6 9C11.7 9 12 9.5 12.4 9.9C13 10.7 13.2 10.9 14.1 11.9C14.3 12.2 14.7 12.6 14.8 12.7C15.6 13.7 15.9 13.7 16.2 12.9C17 10.3 18.5 8.4 21 6.6C22.9 5.1 22.3 3.8 19.3 3.1C18.7 3 17.1 2.8 17 2.9M6.8 10.3C5.9 10.6 5 11.8 3.9 14.1C2.7 16.4 2.9 20 4.2 21.4C5.1 22.2 5.6 22 7.1 20.2C8.3 18.7 9.4 17.8 10.9 17.1C11.8 16.6 11.9 16.5 12.9 16.2C14.1 15.8 14.2 15.8 10.3 12.3C10.1 12.2 9.8 11.9 9.6 11.7C9.4 11.6 9.1 11.3 9 11.2C7.8 10.2 7.5 10.1 6.8 10.3" />
  </svg>
);

/** Kite : aile pleine en croissant, bride en V, deux lignes jusqu'à la barre ; d'après le modèle de l'utilisateur (21/10), lignes raccourcies. */
export const IconKite = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} strokeWidth={1.2} {...props}>
    <path d="M9.2 6.8C10.4 1.2 19.6-.6 22.6 3.6C24.8 6.8 23.2 12.8 18.6 16.4C20.2 12.4 20.4 7.6 18.4 5.4C16.2 3.2 12.4 3.6 9.2 6.8Z" fill="currentColor" stroke="none" />
    <path d="M9.2 6.8L12.9 12L18.6 16.4M9.2 6.8L3.2 18.4M18.6 16.4L5.4 20.6" />
    <path d="M3.2 18.4L5.4 20.6" strokeWidth={2.2} />
  </svg>
);

/** Marcheur au bâton, sac au dos. */
export const IconWalk = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="11" cy="3.8" r="1.6" fill="currentColor" stroke="none" />
    <path d="M10.5 7.5l-1 6" />
    <path d="M9.5 13.5l2.5 3v4" />
    <path d="M9.5 13.5l-2 3.5-1.5 3.5" />
    <path d="M10.5 8.5l3.5 2.5" />
    <path d="M15 9l1.5 12" />
    <path d="M10 8H8v4.5h1.5" />
  </svg>
);

/** Vélo de route, cintre recourbé. */
export const IconRoadBike = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="5.5" cy="16" r="3.5" />
    <circle cx="18.5" cy="16" r="3.5" />
    <path d="M5.5 16l4-7h6l3 7" />
    <path d="M9.5 9l3 7h6" />
    <path d="M8 6h3" />
    <path d="M15.5 9l-1-3h2.5a1.5 1.5 0 0 1 0 3" />
  </svg>
);

/** VTT sur un sol accidenté. */
export const IconMtb = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="5.5" cy="15" r="3.5" />
    <circle cx="18.5" cy="15" r="3.5" />
    <path d="M5.5 15l4-7h6l3 7" />
    <path d="M9.5 8l3 7h6" />
    <path d="M8 5h3" />
    <path d="M15.5 8l-1-3h3" />
    <path d="M2 21.5l3-1 3 .5 3-1.5 3 .5 3-1 4-.5" />
  </svg>
);

/** Gravel : vélo et sacoche de selle. */
export const IconGravel = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="5.5" cy="16" r="3.5" />
    <circle cx="18.5" cy="16" r="3.5" />
    <path d="M5.5 16l4-7h6l3 7" />
    <path d="M9.5 9l3 7h6" />
    <path d="M8 6h3" />
    <path d="M15.5 9l-1-3h2" />
    <rect x="2.5" y="8" width="4.5" height="3.5" rx="1" />
  </svg>
);

/** Surf : vague qui déferle et planche. */
export const IconSurfer = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M2.5 20.5C2.5 11 8 5 14.5 5c3 0 5.5 2 5.5 4.5-2.5-1.5-6-1-7.5 2" />
    <path d="M9 20c3-3.5 7-6 12-6.5-1.5 3.5-6 6-12 6.5z" />
  </svg>
);

/** Surf foil : surfeur debout, planche sur son foil. */
export const IconSurfFoil = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="12" cy="3.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 6.5v3.5" />
    <path d="M8 8.5l4-1.5 4 1.5" />
    <path d="M9.5 14l2.5-4 2.5 4" />
    <path d="M4 14h16" />
    <path d="M12.5 14v6" />
    <path d="M9 20h7" />
  </svg>
);

/** Kayak et pagaie double. */
export const IconKayak = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M2.5 16c6 2.5 13 2.5 19 0-6-1.8-13-1.8-19 0z" />
    <circle cx="12" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 12v2.5" />
    <path d="M5.5 20L19 5" />
    <path d="M18 3.5l2.5 2.5" />
    <path d="M4 18.5l2.5 2.5" />
  </svg>
);

/** Paddle : debout sur la planche, pagaie simple. */
export const IconPaddle = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="10.5" cy="3.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M10.5 6.5v6.5" />
    <path d="M10.5 13l-2 6" />
    <path d="M10.5 13l2 6" />
    <path d="M10.5 8.5l4 1.5 3-2" />
    <path d="M18.5 3.5l-2.5 14" />
    <path d="M15 17l.5 3.5" />
    <path d="M3 20.5h18" />
  </svg>
);

/** Paddle foil : pagayeur debout, planche sur son foil. */
export const IconPaddleFoil = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <circle cx="10.5" cy="3" r="1.6" fill="currentColor" stroke="none" />
    <path d="M10.5 5.5v4.5" />
    <path d="M10.5 10l-1.5 4" />
    <path d="M10.5 10l1.5 4" />
    <path d="M10.5 7l3.5 1.5 2.5-2" />
    <path d="M17.5 3l-2 11" />
    <path d="M4 14h16" />
    <path d="M12.5 14v6" />
    <path d="M9 20h7" />
  </svg>
);

/** Fractionné vélo : vélo et chronomètre. */
export const IconBikeIntervals = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <g transform="translate(0 4.5) scale(.78)" strokeWidth="2.5">
      <circle cx="5.5" cy="16" r="3.5" />
      <circle cx="18.5" cy="16" r="3.5" />
      <path d="M5.5 16l4-7h6l3 7" />
      <path d="M9.5 9l3 7h6" />
      <path d="M8 6h3" />
      <path d="M15.5 9l-1-3h2" />
    </g>
    <circle cx="18.5" cy="6.5" r="4" />
    <path d="M18.5 6.5V4.5" />
    <path d="M17.5 1.5h2" />
  </svg>
);

/** Fractionné à pied : coureur et chronomètre. */
export const IconRunIntervals = ({ size = 24, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <g transform="translate(4.8 4.8) scale(.8)" strokeWidth="2.5">
      <circle cx="16" cy="4" r="1.6" fill="currentColor" stroke="none" />
      <path d="M14.5 8l-2.5 6" />
      <path d="M14 9.5l3 2.5h2.5" />
      <path d="M14 9.5l-3.5.5-2 2.5" />
      <path d="M12 14l3 2v4.5" />
      <path d="M12 14l-2.5 4H5" />
    </g>
    <circle cx="6" cy="7" r="4" />
    <path d="M6 7V5" />
    <path d="M5 2h2" />
  </svg>
);

/** Croix : supprimer. */
export const IconClose = ({ size = 20, ...props }: IconProps) => (
  <svg {...strokeProps(size)} {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
