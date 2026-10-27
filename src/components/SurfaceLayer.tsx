import { useMemo } from 'react';
import type { PathOptions } from 'leaflet';
import { Polyline } from 'react-leaflet';
import { SURFACE_COLOR, type SurfaceCategory, type SurfacePath } from '../planning/surface';

/** Bordure sombre sous le tracé : les teintes claires (Inconnu, Sable, Gravillon) restent lisibles sur le fond de carte. */
const CASING_COLOR = '#1b1f24';

/**
 * Tracé coloré par revêtement (`surfacePaths`), aux couleurs de la barre
 * `SurfaceBar`, sur une bordure sombre. Toutes les bordures d'abord, puis les
 * couleurs : une bordure ne recouvre jamais la jonction de deux morceaux. Le
 * tracé ne capte pas le toucher, laissé aux couches de la page.
 */
function SurfaceLayer({ paths, weight = 5 }: { paths: SurfacePath[]; weight?: number }) {
  // Styles stables d'un rendu à l'autre : react-leaflet ne réapplique `setStyle` qu'à un nouvel objet (27/10).
  const styles = useMemo(() => {
    const casing: PathOptions = { color: CASING_COLOR, weight: weight + 3, opacity: 0.55, interactive: false };
    const byCategory = {} as Record<SurfaceCategory, PathOptions>;
    for (const category of Object.keys(SURFACE_COLOR) as SurfaceCategory[]) {
      byCategory[category] = { color: SURFACE_COLOR[category], weight, opacity: 1, interactive: false };
    }
    return { casing, byCategory };
  }, [weight]);
  return (
    <>
      {paths.map((path, idx) => (
        <Polyline key={`casing-${idx}`} positions={path.positions} pathOptions={styles.casing} />
      ))}
      {paths.map((path, idx) => (
        <Polyline key={`surface-${idx}`} positions={path.positions} pathOptions={styles.byCategory[path.category]} />
      ))}
    </>
  );
}

export default SurfaceLayer;
