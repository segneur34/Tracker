import { routeShareFile, type SavedRoute } from '../hooks/routeFiles';
import { plainError } from '../platform/errorText';
import { shareFile } from '../platform/share';

/** Phrase à montrer après un partage : son succès silencieux n'en a pas. */
export interface RouteShareNote {
  text: string;
  error: boolean;
}

/**
 * « Partager le GPX » d'un itinéraire rangé (lot 194, repris au lot 236 pour Planifier) : le GPX tel que rangé, sa
 * fiche en extension, confié au partage du système. Rend la phrase à montrer : un navigateur qui ne partage pas de
 * fichier le télécharge, et le dit ; un échec est dit en clair ; un partage abouti ne dit rien (`null`).
 */
export const shareRouteGpx = async (saved: SavedRoute): Promise<RouteShareNote | null> => {
  try {
    const { fileName, text } = await routeShareFile(saved);
    const outcome = await shareFile(new Blob([text], { type: 'application/gpx+xml' }), fileName, "Partager l'itinéraire");
    return outcome === 'downloaded' ? { text: 'Ce navigateur ne partage pas de fichier : le GPX est téléchargé.', error: false } : null;
  } catch (err) {
    return { text: `Partage impossible : ${plainError(err, 'erreur inconnue')}`, error: true };
  }
};
