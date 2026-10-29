import type { ReactNode } from 'react';
import { Polyline } from 'react-leaflet';
import { HIGHLIGHT_OPACITY, highlightPathOptions } from './highlightColors';

/**
 * Trait de surbrillance d'une analyse sur la carte : le tronçon montré (zone
 * cardiaque, pente, top, répétition…) dans la couleur de `highlightColors.ts`.
 * `children` : la bulle d'un `Popup`. Le style passe par `pathOptions` et reste
 * le même objet d'un rendu à l'autre.
 */
export default function HighlightPath({ positions, color, opacity = HIGHLIGHT_OPACITY, interactive = true, children }: {
  positions: [number, number][];
  color: string;
  opacity?: number;
  /** Faux : le trait laisse passer les clics (revêtement). */
  interactive?: boolean;
  children?: ReactNode;
}) {
  return <Polyline positions={positions} pathOptions={highlightPathOptions(color, opacity, interactive)}>{children}</Polyline>;
}
