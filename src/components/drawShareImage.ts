import { cardHeight, cardTop, fitView, fullView, mapHeight, projectPoint, SHARE_IMAGE, statColumns, viewTiles, type ShareStat } from '../core/shareImage';
import { MAP_BASES, type MapBase } from '../core/mapBase';
import { tileKey, type TileCoord } from '../core/tiles';
import { lightToken } from '../theme/lightToken';
import { loadMapTile, tileImage } from '../platform/mapTiles';
import { strokeColoredTrack } from './drawTrackPreview';
import type { TrackSegment } from './TrackSegmentsLayer';

/**
 * Image de partage d'une session, en hauteur (1080 × 1920), dessinée sur un
 * canevas : la trace colorée comme dans l'analyse sur son fond de carte, qui
 * remplit l'image ; en haut, sur un voile blanc bordé de la couleur de la
 * famille, le titre, l'activité et la date ; en bas, les chiffres retenus dans
 * un cartouche blanc, puis le pied. Le cadrage et la mise en page se calculent
 * dans `core/shareImage.ts`.
 */

export interface ShareImageContent {
  /** Nom de la session, ou de l'activité si elle n'en a pas. */
  title: string;
  /** Activité et date. */
  subtitle: string;
  /** Couleur de la famille, qui porte du texte blanc. */
  accent: string;
  segments: ReadonlyArray<TrackSegment>;
  stats: ReadonlyArray<ShareStat>;
  /** Fond de carte sous la trace ; sans lui, un aplat. */
  withMap: boolean;
  /** Fond retenu pour la famille de la session (`useMapBase`), dont la mention est dessinée. */
  base: MapBase;
  /** Nom ou pseudo du pratiquant, à droite du pied ; `null` : rien. */
  author: string | null;
}

/** Tuile du fond prête à dessiner, `null` si elle manque. */
export type TileImageLoader = (tile: TileCoord) => Promise<CanvasImageSource | null>;

/**
 * Chargeur des tuiles de `base` qui garde chacune le temps d'une fenêtre de
 * partage : cocher un chiffre redessine l'image sans redemander le fond.
 */
export const createTileImageLoader = (base: MapBase): TileImageLoader => {
  const images = new Map<string, Promise<CanvasImageSource | null>>();
  return (tile) => {
    const key = tileKey(tile);
    let image = images.get(key);
    if (!image) {
      image = loadMapTile(tile, base).then((content) => (content === null ? null : tileImage(content))).catch(() => null);
      images.set(key, image);
    }
    return image;
  };
};

/** Valeur d'une variable du thème, pour peindre l'image aux couleurs de l'interface : toujours la palette claire, l'image restant claire en thème sombre. */
const token = (name: string, fallback: string): string => lightToken(name, fallback);

/** Police de l'interface (`--font`), chargée avant de dessiner : sans elle, le canevas prend celle du système. */
const fontFamily = (): string => token('--font', 'system-ui, sans-serif');

/** Police du logo (`--font-logo`), pour « Tracker » au pied de l'image, comme sur l'accueil. */
const logoFamily = (): string => token('--font-logo', 'Georgia, serif');

const ensureFonts = async (family: string, logo: string): Promise<void> => {
  try {
    await Promise.all([
      document.fonts.load(`700 40px ${family}`), document.fonts.load(`600 40px ${family}`), document.fonts.load(`400 40px ${family}`),
      document.fonts.load(`400 40px ${logo}`),
    ]);
  } catch {
    // Police indisponible : celle du système fait l'affaire.
  }
};

/** Texte tronqué d'une ellipse pour tenir dans `maxWidth`. */
const fitText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end)}…`;
};

/** Texte réduit de `maxPx` jusqu'à `minPx` pour tenir dans sa colonne, tronqué au-delà. */
const drawFitted = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: { weight: number; maxPx: number; minPx: number; family: string }
) => {
  let size = font.maxPx;
  ctx.font = `${font.weight} ${size}px ${font.family}`;
  while (size > font.minPx && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${font.weight} ${size}px ${font.family}`;
  }
  ctx.fillText(fitText(ctx, text, maxWidth), x, y);
};

/** Trace cadrée entre le titre et le cartouche, la carte s'étendant à toute l'image. */
const drawTrack = (ctx: CanvasRenderingContext2D, content: ShareImageContent, count: number) => {
  const fitted = fitView(content.segments.flatMap((s) => s.positions), SHARE_IMAGE.widthPx, mapHeight(count));
  const view = fitted && fullView(fitted, SHARE_IMAGE.frameTopPx, SHARE_IMAGE.heightPx);
  return { view, draw: () => {
    if (!view || content.segments.length === 0) return;
    const at = ([lat, lon]: readonly [number, number]) => projectPoint(view, lat, lon);
    // Liseré blanc sous la trace, d'un seul tracé : elle reste lisible sur les routes et les couleurs du fond ;
    // puis un tracé par couleur, tranche par tranche, comme sur la carte (`ColoredTrackPath`).
    strokeColoredTrack(ctx, content.segments, at, { width: 8, halo: { color: 'rgba(255, 255, 255, 0.9)', width: 15 } });
    // Départ en blanc cerclé, arrivée pleine.
    const ink = token('--ink', '#1b1f24');
    const dot = (p: { x: number; y: number }, fill: string, ring: string) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = ring;
      ctx.stroke();
    };
    dot(at(content.segments[0].positions[0]), '#ffffff', ink);
    const last = content.segments[content.segments.length - 1].positions;
    dot(at(last[last.length - 1]), ink, '#ffffff');
  } };
};

/** Rectangle aux coins arrondis, ajouté au chemin courant ; coins droits sur un canevas trop ancien. */
const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

/** L'image, en PNG. */
export const drawShareImage = async (content: ShareImageContent, tileImage: TileImageLoader): Promise<Blob> => {
  const {
    widthPx, heightPx, marginPx: margin, veilPx, edgePx, titleBaselinePx, subtitleBaselinePx, cardMarginXPx, cardRadiusPx,
    cardBarPx, statsTopPx, statsMarginXPx, statRowPx, statLabelBaselinePx, statValueBaselinePx,
    ruleFromBottomPx, footerFromBottomPx, footerVeilPx, maxStats,
  } = SHARE_IMAGE;
  const stats = content.stats.slice(0, maxStats);
  const count = stats.length;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Dessin impossible sur cet appareil.');
  const family = fontFamily();
  const logo = logoFamily();
  await ensureFonts(family, logo);
  const ink = token('--ink', '#1b1f24');
  const muted = token('--muted', '#5b6470');
  ctx.textBaseline = 'alphabetic';

  // Carte sur toute l'image ; sans fond (muscu, fond décoché), un aplat.
  ctx.fillStyle = token('--surface-sunken', '#e9e7e2');
  ctx.fillRect(0, 0, widthPx, heightPx);
  const track = drawTrack(ctx, content, count);
  if (content.withMap && track.view) {
    const placed = viewTiles(track.view);
    const images = await Promise.all(placed.map((p) => tileImage(p.tile)));
    placed.forEach((p, i) => {
      const image = images[i];
      // Un pixel de plus : pas de liseré entre deux tuiles agrandies.
      if (image) ctx.drawImage(image, p.x, p.y, p.sizePx + 1, p.sizePx + 1);
    });
  }
  track.draw();
  // Sans trace (muscu), pas de fond de carte : pas de mention non plus.
  if (content.withMap && track.view) {
    // Mention qu'exigent les conditions d'usage des tuiles du fond, au ras du bas, sous le cartouche.
    ctx.font = `400 22px ${family}`;
    const text = MAP_BASES[content.base].credit;
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(widthPx - w, heightPx - 34, w, 34);
    ctx.fillStyle = ink;
    ctx.fillText(text, widthPx - w + 10, heightPx - 10);
  }

  // Voile du haut, liseré de la famille, titre et sous-titre.
  const veil = ctx.createLinearGradient(0, 0, 0, veilPx);
  veil.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
  veil.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, widthPx, veilPx);
  ctx.fillStyle = content.accent;
  ctx.fillRect(0, 0, edgePx, veilPx);
  ctx.fillStyle = ink;
  ctx.font = `700 58px ${family}`;
  ctx.fillText(fitText(ctx, content.title, widthPx - 2 * margin), margin, titleBaselinePx);
  ctx.fillStyle = muted;
  ctx.font = `400 32px ${family}`;
  ctx.fillText(fitText(ctx, content.subtitle, widthPx - 2 * margin), margin, subtitleBaselinePx);

  // Cartouche des chiffres ; sans chiffre, un voile sous le pied seul.
  const cardH = cardHeight(count);
  const cardY = cardTop(count);
  const cardW = widthPx - 2 * cardMarginXPx;
  if (count > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    roundedRect(ctx, cardMarginXPx, cardY, cardW, cardH, cardRadiusPx);
    ctx.fill();
    // Barre de la famille découpée dans la forme du cartouche : elle épouse ses coins arrondis.
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, cardMarginXPx, cardY, cardW, cardH, cardRadiusPx);
    ctx.clip();
    ctx.fillStyle = content.accent;
    ctx.fillRect(cardMarginXPx, cardY, cardW, cardBarPx);
    ctx.restore();
    const columns = statColumns(count);
    const columnPx = (widthPx - 2 * statsMarginXPx) / columns;
    const top = cardY + statsTopPx;
    stats.forEach((stat, i) => {
      const x = statsMarginXPx + (i % columns) * columnPx;
      const y = top + Math.floor(i / columns) * statRowPx;
      ctx.fillStyle = muted;
      drawFitted(ctx, stat.label, x, y + statLabelBaselinePx, columnPx - 24, { weight: 400, maxPx: 28, minPx: 20, family });
      ctx.fillStyle = ink;
      drawFitted(ctx, stat.value, x, y + statValueBaselinePx, columnPx - 24, { weight: 700, maxPx: 50, minPx: 32, family });
    });
    ctx.fillStyle = token('--line', '#e3e1dc');
    ctx.fillRect(statsMarginXPx, cardY + cardH - ruleFromBottomPx, widthPx - 2 * statsMarginXPx, 2);
  } else {
    const foot = ctx.createLinearGradient(0, heightPx - footerVeilPx, 0, heightPx);
    foot.addColorStop(0, 'rgba(255, 255, 255, 0)');
    foot.addColorStop(1, 'rgba(255, 255, 255, 0.85)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, heightPx - footerVeilPx, widthPx, footerVeilPx);
  }

  // Pied, à la même hauteur avec ou sans cartouche.
  const footerY = cardY + cardH - footerFromBottomPx;
  ctx.fillStyle = token('--faint', '#8a9099');
  ctx.font = `400 26px ${logo}`;
  ctx.fillText('TRACKER', margin, footerY);
  ctx.font = `600 26px ${family}`;
  if (content.author !== null) {
    ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, content.author, widthPx / 2 - margin), widthPx - margin, footerY);
    ctx.textAlign = 'left';
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image impossible à produire.'))), 'image/png');
  });
};
