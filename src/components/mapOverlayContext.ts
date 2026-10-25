import { createContext } from 'react';

/** Vrai sous la carte en plein écran (`AnalysisMap`, `companion`) : « Afficher » y remplace « +carte » (`ZoomableChart`). */
export const MapOverlayContext = createContext(false);
