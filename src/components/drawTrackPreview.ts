import type { TrackBounds } from '../core/displayConfig';
import { fitBoundsView, projectPoint, viewTiles, type ShareView } from '../core/shareImage';
import { thinToPixels } from '../core/simplify';
import { PAINT_ORDER_TRANCHES, pathsByColor } from '../core/trackColor';
import { loadMapTile, tileImage } from '../platform/mapTiles';

/**
 * Vignette carte d'une session de la bibliothèque, dessinée une fois en image
 * fixe (PNG) au cadrage de la carte Leaflet qu'elle remplace (`fitBounds`,
 * marges de 8 px, zoom 17 au plus) : fond gris de Leaflet, tuiles du plan
 * d'OpenStreetMap (décision §8 : vignettes toujours en plan, sans liseré),
 * trace colorée de 3 px par-dessus, peinte comme sur la carte. Sans fond
 * (thème économe), la trace seule sur un fond transparent. La mention d'OSM
 * est posée en HTML par la page, par-dessus l'image.
 *
 * Aussi le tracé d'une trace colorée sur un canevas (`strokeColoredTrack`),
 * commun à la vignette et à l'image de partage (`drawShareImage.ts`).
 */

export const TRACK_PREVIEW = {
  /** Marge entre la trace et le bord de la vignette, comme `boundsOptions` de l'ancienne carte. */
  paddingPx: 8,
  maxZoom: 17,
  /** Épaisseur de la trace, celle de l'ancienne carte. */
  lineWidthPx: 3,
  /** Un point de la trace est gardé dès qu'il s'écarte de ce nombre de pixels du précédent (réponse du 30/10). */
  thinPx: 0.5,
} as const;

/** Fond de la carte de Leaflet sous les tuiles (`leaflet.css`) : donnée de carte, en dur. */
const LEAFLET_BACKGROUND = '#dddddd';

/** Cadrage de la vignette de `widthPx` × `heightPx` sur l'emprise de la trace. */
export const trackPreviewView = (bounds: TrackBounds, widthPx: number, heightPx: number): ShareView | null =>
  fitBoundsView(bounds, widthPx, heightPx, TRACK_PREVIEW);

/** Points de la trace réduits au zoom de la vignette (`thinToPixels`). */
export const thinForPreview = <P extends { lat: number; lon: number }>(points: readonly P[], view: ShareView): P[] =>
  thinToPixels(points, (p) => projectPoint(view, p.lat, p.lon), TRACK_PREVIEW.thinPx);

/** Un trait de trace : ses points `[lat, lon]` et sa couleur. */
export interface PaintedSegment {
  positions: ReadonlyArray<readonly [number, number]>;
  color: string;
}

/**
 * Trace colorée sur un canevas : sous elle, si `halo`, un liseré d'un seul
 * tracé ; puis un tracé par couleur, tranche par tranche, dans l'ordre de la
 * carte (`pathsByColor`, le passage récent par-dessus). `at` donne le pixel
 * d'un point.
 */
export const strokeColoredTrack = (
  ctx: CanvasRenderingContext2D,
  segments: ReadonlyArray<PaintedSegment>,
  at: (point: readonly [number, number]) => { x: number; y: number },
  { width, halo }: { width: number; halo?: { color: string; width: number } }
): void => {
  /** Ajoute au chemin les traits donnés par leur rang ; un trait qui commence où finit le précédent le prolonge. */
  const addPaths = (indices: Iterable<number>) => {
    let pen: { x: number; y: number } | null = null;
    for (const i of indices) {
      const positions = segments[i].positions;
      if (positions.length < 2) continue;
      const start = at(positions[0]);
      if (!pen || pen.x !== start.x || pen.y !== start.y) ctx.moveTo(start.x, start.y);
      for (let k = 1; k < positions.length; k++) {
        pen = at(positions[k]);
        ctx.lineTo(pen.x, pen.y);
      }
    }
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (halo) {
    ctx.beginPath();
    addPaths(segments.keys());
    ctx.strokeStyle = halo.color;
    ctx.lineWidth = halo.width;
    ctx.stroke();
  }
  ctx.lineWidth = width;
  for (const group of pathsByColor(segments, PAINT_ORDER_TRANCHES)) {
    ctx.beginPath();
    addPaths(group.segments);
    ctx.strokeStyle = group.color;
    ctx.stroke();
  }
};

const toPng = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));

export interface TrackPreviewContent {
  view: ShareView;
  segments: ReadonlyArray<PaintedSegment>;
  /** Densité de l'écran : l'image fait `pixelRatio` pixels par pixel de la page. */
  pixelRatio: number;
  /** Fond gris et tuiles du plan ; sans lui (thème économe), la trace seule, fond transparent. */
  withMap: boolean;
}

/**
 * La vignette, en PNG : d'abord la trace seule, rendue à `onTrace` (sur le
 * gris de Leaflet avec un fond), puis, avec un fond, la trace sur ses tuiles.
 * `null` si `signal` est coupé ou si le canevas manque.
 */
export const drawTrackPreview = async (
  { view, segments, pixelRatio, withMap }: TrackPreviewContent,
  { signal, onTrace }: { signal: AbortSignal; onTrace?: (png: Blob) => void }
): Promise<Blob | null> => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(view.widthPx * pixelRatio);
  canvas.height = Math.round(view.heightPx * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const at = ([lat, lon]: readonly [number, number]) => projectPoint(view, lat, lon);
  const paint = (tiles: ReadonlyArray<{ x: number; y: number; sizePx: number; image: CanvasImageSource | null }>) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (withMap) {
      ctx.fillStyle = LEAFLET_BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Tuiles calées sur les pixels de l'image : pas de liseré entre deux tuiles, quelle que soit la densité.
    for (const t of tiles) {
      if (!t.image) continue;
      const x = Math.round(t.x * pixelRatio);
      const y = Math.round(t.y * pixelRatio);
      ctx.drawImage(t.image, x, y, Math.round((t.x + t.sizePx) * pixelRatio) - x, Math.round((t.y + t.sizePx) * pixelRatio) - y);
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    strokeColoredTrack(ctx, segments, at, { width: TRACK_PREVIEW.lineWidthPx });
  };

  paint([]);
  const trace = await toPng(canvas);
  if (signal.aborted) return null;
  if (!withMap || !trace) return trace;
  onTrace?.(trace);

  const placed = viewTiles(view);
  const images = await Promise.all(placed.map((p) => loadMapTile(p.tile, 'plan', signal)
    .then((content) => (content === null ? null : tileImage(content)))
    .catch(() => null)));
  if (signal.aborted) {
    for (const image of images) if (image && 'close' in image) image.close();
    return null;
  }
  paint(placed.map((p, i) => ({ ...p, image: images[i] })));
  for (const image of images) if (image && 'close' in image) image.close();
  return toPng(canvas);
};
