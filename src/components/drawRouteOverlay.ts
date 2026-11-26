import { fitView, fullView, projectPoint, SHARE_IMAGE, type ShareView } from '../core/shareImage';
import { END_COLOR, ROUTE_COLOR, START_COLOR } from '../planning/routeColors';
import { placeLegPills, type RouteImageMark, type RouteShareContent, type SurfaceBandPart } from '../planning/routeShareImage';

/**
 * Itinéraire sur l'image de partage (`drawShareImage`, lot 236, d'après le lot 458 de Gtracker) : le tracé bleu
 * sur un liseré blanc ; en voile et en surf, les balises numérotées (départ vert, arrivée rouge, les autres
 * bleues, le départ d'une boucle moitié vert, moitié rouge), une pastille blanche « distance · cap » par bord et la
 * rose du nord en haut à droite ; à pied et à vélo, les ronds du départ et de l'arrivée, et la bande du revêtement
 * au-dessus du cartouche si elle est demandée. Ce qui se montre et la place des pastilles se calculent dans
 * `planning/routeShareImage.ts`.
 */

/** Ce que le dessin reprend de l'image : la police et les couleurs de l'interface (palette claire). */
export interface RouteOverlayStyle {
  font: string;
  ink: string;
  muted: string;
  /** Contour des pastilles, de la rose et de la bande. */
  line: string;
}

/** Marge entre l'itinéraire et le bord de sa zone de cadrage : la place d'une pastille de chaque côté. */
const COURSE_PADDING_PX = 130;
/** Tracé et son liseré blanc. */
const LINE_PX = 10;
const HALO_PX = 18;
/** Balises : rayon, cerne blanc et chiffre ; ronds sans numéro (départ et arrivée à pied et à vélo). */
const MARK_RADIUS_PX = 26;
const DOT_RADIUS_PX = 16;
const MARK_RING_PX = 5;
const MARK_FONT_PX = 26;
/** Pastilles : hauteur, marge du texte de chaque côté, taille du texte. */
const PILL_HEIGHT_PX = 52;
const PILL_PAD_X_PX = 22;
const PILL_FONT_PX = 28;
/** Écart des pastilles avec les bords de l'image et le haut du cartouche. */
const PILL_FRAME_MARGIN_PX = 16;
/** Rose du nord : rayon, et centre sous le haut de l'image, entre titre et sous-titre. */
const NORTH_RADIUS_PX = 40;
const NORTH_CENTER_Y_PX = 118;
/** Bande du revêtement : hauteur de son encart, écart au cartouche, barre, texte. */
const BAND_HEIGHT_PX = 128;
const BAND_GAP_PX = 20;
const BAND_PAD_PX = 28;
const BAND_BAR_PX = 24;
const BAND_FONT_PX = 28;
/** Parts nommées sous la barre, les plus longues ; les autres ne se lisent que par leur couleur. */
const BAND_NAMED_PARTS = 3;

/** Place que la rose du nord prend à droite du titre et du sous-titre. */
export const NORTH_ARROW_ROOM_PX = 2 * NORTH_RADIUS_PX + 30;

/** Hauteur que la bande du revêtement prend au-dessus du cartouche, écart compris. */
export const SURFACE_BAND_ROOM_PX = BAND_HEIGHT_PX + BAND_GAP_PX;

/** Rectangle aux coins arrondis, ajouté au chemin courant ; coins droits sur un canevas trop ancien. */
const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

const markFill = (role: RouteImageMark['role']): string =>
  role === 'start' ? START_COLOR : role === 'end' ? END_COLOR : ROUTE_COLOR;

/** Une balise : un rond plein cerné de blanc, son numéro en blanc ; sans numéro, un rond plus petit. */
const drawMark = (ctx: CanvasRenderingContext2D, mark: RouteImageMark, p: { x: number; y: number }, font: string) => {
  const radius = mark.label ? MARK_RADIUS_PX : DOT_RADIUS_PX;
  ctx.save();
  if (mark.role === 'loop') {
    // Départ d'une boucle, qui en est aussi l'arrivée : moitié gauche verte, moitié droite rouge.
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.fillStyle = START_COLOR;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = END_COLOR;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = markFill(mark.role);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
  ctx.lineWidth = MARK_RING_PX;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  if (mark.label) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${MARK_FONT_PX}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark.label, p.x, p.y + 1);
  }
  ctx.restore();
};

/**
 * Cadrage de l'itinéraire entre le titre et `bottomPx` (le haut du cartouche, ou de la bande du revêtement), la
 * carte s'étendant à toute l'image, et son dessin.
 */
export const routeOverlay = (
  ctx: CanvasRenderingContext2D,
  course: RouteShareContent,
  bottomPx: number,
  style: RouteOverlayStyle
): { view: ShareView | null; draw: () => void } => {
  const points = [
    ...course.paths.flatMap((path) => path.map((p): [number, number] => [p.lat, p.lon])),
    ...course.marks.map((m): [number, number] => [m.lat, m.lon]),
  ];
  const padding = course.pills.length > 0 ? COURSE_PADDING_PX : SHARE_IMAGE.paddingPx;
  const fitted = fitView(points, SHARE_IMAGE.widthPx, bottomPx - SHARE_IMAGE.frameTopPx, padding);
  const view = fitted && fullView(fitted, SHARE_IMAGE.frameTopPx, SHARE_IMAGE.heightPx);
  return { view, draw: () => {
    if (!view) return;
    const at = (p: { lat: number; lon: number }) => projectPoint(view, p.lat, p.lon);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Liseré blanc de tout le tracé d'abord, puis le tracé : une jonction de tronçons ne coupe pas le trait.
    for (const [color, width] of [['rgba(255, 255, 255, 0.9)', HALO_PX], [ROUTE_COLOR, LINE_PX]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const path of course.paths) {
        if (path.length < 2) continue;
        ctx.beginPath();
        path.forEach((p, i) => {
          const { x, y } = at(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    ctx.restore();

    const marks = course.marks.map((m) => ({ mark: m, p: at(m) }));
    for (const { mark, p } of marks) drawMark(ctx, mark, p, style.font);
    if (course.pills.length === 0) return;

    ctx.save();
    ctx.font = `600 ${PILL_FONT_PX}px ${style.font}`;
    const requests = course.pills.map((pill) => {
      const anchor = at(pill.anchor);
      const before = at(pill.before);
      const after = at(pill.after);
      return {
        x: anchor.x, y: anchor.y, dx: after.x - before.x, dy: after.y - before.y,
        width: ctx.measureText(pill.text).width + 2 * PILL_PAD_X_PX, height: PILL_HEIGHT_PX,
      };
    });
    const placed = placeLegPills(
      requests,
      marks.map(({ mark, p }) => ({ x: p.x, y: p.y, radius: (mark.label ? MARK_RADIUS_PX : DOT_RADIUS_PX) + MARK_RING_PX })),
      {
        left: PILL_FRAME_MARGIN_PX, top: SHARE_IMAGE.frameTopPx,
        right: SHARE_IMAGE.widthPx - PILL_FRAME_MARGIN_PX, bottom: bottomPx - PILL_FRAME_MARGIN_PX,
      }
    );
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    placed.forEach((box, i) => {
      ctx.beginPath();
      roundedRect(ctx, box.x - box.width / 2, box.y - box.height / 2, box.width, box.height, box.height / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = style.line;
      ctx.stroke();
      ctx.fillStyle = style.ink;
      ctx.fillText(course.pills[i].text, box.x, box.y + 1);
    });
    ctx.restore();
  } };
};

/** Rose du nord, en haut à droite : un rond blanc cerné, une flèche à l'encre pointée vers le haut de l'image. */
export const drawNorthArrow = (ctx: CanvasRenderingContext2D, style: RouteOverlayStyle) => {
  const x = SHARE_IMAGE.widthPx - SHARE_IMAGE.marginPx - NORTH_RADIUS_PX;
  const y = NORTH_CENTER_Y_PX;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, NORTH_RADIUS_PX, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.line;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x + 13, y + 18);
  ctx.lineTo(x, y + 9);
  ctx.lineTo(x - 13, y + 18);
  ctx.closePath();
  ctx.fillStyle = style.ink;
  ctx.fill();
  ctx.restore();
};

/**
 * Bande du revêtement, dans un encart blanc juste au-dessus du cartouche (`cardTopPx`), de sa largeur : une barre
 * en parts proportionnelles aux couleurs du bloc Surface, puis les parts les plus longues nommées dessous.
 */
export const drawSurfaceBand = (
  ctx: CanvasRenderingContext2D,
  parts: ReadonlyArray<SurfaceBandPart>,
  cardTopPx: number,
  style: RouteOverlayStyle
) => {
  const { cardMarginXPx, widthPx, cardRadiusPx } = SHARE_IMAGE;
  const x = cardMarginXPx;
  const w = widthPx - 2 * cardMarginXPx;
  const y = cardTopPx - SURFACE_BAND_ROOM_PX;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  roundedRect(ctx, x, y, w, BAND_HEIGHT_PX, cardRadiusPx);
  ctx.fill();
  // Barre en parts, découpée dans une forme arrondie.
  const barX = x + BAND_PAD_PX;
  const barW = w - 2 * BAND_PAD_PX;
  const barY = y + BAND_PAD_PX;
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, barX, barY, barW, BAND_BAR_PX, BAND_BAR_PX / 2);
  ctx.clip();
  let left = barX;
  for (const part of parts) {
    const width = part.fraction * barW;
    ctx.fillStyle = part.color;
    // Un demi-pixel de plus : pas de jour entre deux parts.
    ctx.fillRect(left, barY, width + 0.5, BAND_BAR_PX);
    left += width;
  }
  ctx.restore();
  ctx.beginPath();
  roundedRect(ctx, barX, barY, barW, BAND_BAR_PX, BAND_BAR_PX / 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.line;
  ctx.stroke();
  // Parts nommées : une pastille de couleur, puis « Asphalte 62 % », à la suite, tant qu'elles tiennent.
  ctx.font = `600 ${BAND_FONT_PX}px ${style.font}`;
  ctx.textBaseline = 'middle';
  // Au milieu de ce qui reste de l'encart sous la barre.
  const textY = barY + BAND_BAR_PX + (BAND_HEIGHT_PX - BAND_PAD_PX - BAND_BAR_PX) / 2;
  let cursor = barX;
  for (const part of parts.slice(0, BAND_NAMED_PARTS)) {
    const textW = ctx.measureText(part.text).width;
    if (cursor + 24 + textW > barX + barW) break;
    ctx.beginPath();
    ctx.arc(cursor + 9, textY, 9, 0, 2 * Math.PI);
    ctx.fillStyle = part.color;
    ctx.fill();
    ctx.fillStyle = style.muted;
    ctx.fillText(part.text, cursor + 24, textY + 1);
    cursor += 24 + textW + 36;
  }
  ctx.restore();
};
