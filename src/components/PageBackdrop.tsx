import { useId, type CSSProperties } from 'react';
import { backdropTile, type BackdropVariant } from '../core/backdropPattern';

/**
 * Fond dessiné d'une page (refonte du 22/10, dessins du 23/10) : courbes de
 * niveau sans session, sinon le motif d'une famille (souffles de vent,
 * sentier dans des courbes de niveau, courbes de dénivelé, vague, traits de vitesse), celle de
 * la bibliothèque ou du sport préféré (`useFavoriteBackdrop`). Une tuile
 * répétée sur toute la page (`core/backdropPattern.ts`), agrandie de son
 * espacement ; l'encre et l'épaisseur viennent de `.page-backdrop--<fond>`
 * (`ui.css`), le trait gardant son épaisseur quel que soit l'espacement. La
 * page porte `ui-page--backdrop`, qui fait passer son contenu au-dessus.
 */
function PageBackdrop({ variant }: { variant: BackdropVariant }) {
  const id = `fond-${useId().replace(/:/g, '')}`;
  const tile = backdropTile(variant);
  return (
    <svg className={`page-backdrop page-backdrop--${variant}`} aria-hidden="true"
      style={{ '--backdrop-scale': tile.scale } as CSSProperties}>
      <defs>
        <pattern id={id} width={tile.width} height={tile.height} patternUnits="userSpaceOnUse"
          patternTransform={tile.scale === 1 ? undefined : `scale(${tile.scale})`}>
          {tile.paths.map((p, i) => (
            <path key={i} d={p.d} className={p.kind ? `page-backdrop__${p.kind}` : undefined} opacity={p.alpha} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} stroke="none" />
    </svg>
  );
}

export default PageBackdrop;
