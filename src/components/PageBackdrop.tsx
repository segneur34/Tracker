import { useId } from 'react';
import { TILE_H, TILE_W, backdropTile, type BackdropVariant } from '../core/patternTiles';

/**
 * Fond dessiné d'une page (refonte du 22/10) : courbes de niveau (accueil,
 * Profil, Statistiques, Réglages) ou motif de la famille (sa bibliothèque :
 * volutes de vent, chemins pointillés, routes en lacets, houle, traits de
 * vitesse). Une tuile à l'échelle 1 répétée sur toute la page
 * (`core/patternTiles.ts`), dans la teinte `--backdrop-ink` posée par la page
 * (`--contour` sinon). La page porte `ui-page--backdrop`, qui fait passer son
 * contenu au-dessus.
 */
function PageBackdrop({ variant }: { variant: BackdropVariant }) {
  const id = `fond-${useId().replace(/:/g, '')}`;
  return (
    <svg className={`page-backdrop page-backdrop--${variant}`} aria-hidden="true">
      <defs>
        <pattern id={id} width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
          {backdropTile(variant).map((p, i) => (
            <path key={i} d={p.d} className={p.kind ? `page-backdrop__${p.kind}` : undefined} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

export default PageBackdrop;
