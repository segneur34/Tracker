import { Polyline } from 'react-leaflet';
import { SURFACE_COLOR, type SurfacePath } from '../planning/surface';

/** Bordure sombre sous le tracé : les teintes claires (Inconnu, Sable, Gravillon) restent lisibles sur le fond de carte. */
const CASING_COLOR = '#1b1f24';

/**
 * Tracé coloré par revêtement (`surfacePaths`), aux couleurs de la barre
 * `SurfaceBar`, sur une bordure sombre. Toutes les bordures d'abord, puis les
 * couleurs : une bordure ne recouvre jamais la jonction de deux morceaux. Le
 * tracé ne capte pas le toucher, laissé aux couches de la page.
 */
function SurfaceLayer({ paths, weight = 5 }: { paths: SurfacePath[]; weight?: number }) {
  return (
    <>
      {paths.map((path, idx) => (
        <Polyline key={`casing-${idx}`} positions={path.positions}
          pathOptions={{ color: CASING_COLOR, weight: weight + 3, opacity: 0.55, interactive: false }} />
      ))}
      {paths.map((path, idx) => (
        <Polyline key={`surface-${idx}`} positions={path.positions}
          pathOptions={{ color: SURFACE_COLOR[path.category], weight, opacity: 1, interactive: false }} />
      ))}
    </>
  );
}

export default SurfaceLayer;
