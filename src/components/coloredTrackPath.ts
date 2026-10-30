import L from 'leaflet';
import { PAINT_ORDER_TRANCHES, pathsByColor } from '../core/trackColor';

/**
 * Trace colorée d'une carte en une seule couche Leaflet, dessinée sur un
 * canevas (`L.canvas`) : tous ses traits en une passe, un tracé par couleur
 * dans chacune des tranches de la trace prises dans l'ordre (`pathsByColor`,
 * couleur exacte de chaque trait, passage récent par-dessus), sous un liseré
 * facultatif d'un seul tracé. Une couche par trait en faisait 54 000 pour 3 h
 * à 5 Hz, que le moteur canevas reparcourait à chaque déplacement et zoom.
 *
 * Le moteur canevas de Leaflet garde la main : il appelle `_project` quand le
 * zoom change, `_update` quand la vue bouge, et `_updatePath` pendant qu'il
 * dessine. La couche ne capte ni clic ni survol (`_containsPoint`).
 */

/** Ce que la couche lit du moteur canevas, hors des déclarations publiques de Leaflet. */
interface CanvasInternals {
  _ctx: CanvasRenderingContext2D;
  /** Vrai pendant que le moteur redessine ses couches : on ne dessine qu'alors. */
  _drawing: boolean;
  /** Zone dessinée du canevas, en pixels de la couche. */
  _bounds: L.Bounds;
}

/** Liseré sous la trace (`haloStyle`). */
export interface TrackHalo {
  color: string;
  weight: number;
  opacity: number;
}

export class ColoredTrackPath extends L.Path {
  /** Points `[lat, lon]` à plat de tous les traits, dans l'ordre du dessin (`pathsByColor`). */
  private readonly latLon: Float64Array;
  /** Premier point de chaque trait dans `latLon`, puis la fin du dernier. */
  private readonly pathStarts: Uint32Array;
  /** Premier point (dans `latLon`) du trait suivant chaque trait dans la trace, -1 s'il n'y en a pas. */
  private readonly nextStarts: Int32Array;
  /** Premier trait de chaque couleur, puis la fin de la dernière. */
  private readonly colorStarts: Uint32Array;
  private readonly colors: string[];
  private readonly lineWeight: number;
  private readonly halo: TrackHalo | null;
  /**
   * Points projetés hors zoom (`crs.latLngToPoint` au zoom 0, divisés par son
   * échelle), calculés une fois : au zoom z, le pixel vaut ce point fois
   * l'échelle de z, le calcul même de Leaflet.
   */
  private unit: Float64Array | null = null;
  /** Points en pixels de la couche, au zoom de la carte, arrondis comme `latLngToLayerPoint`. */
  private readonly px: Float64Array;
  /** Emprise en pixels, liseré compris, lue par le moteur canevas pour ses redessins partiels. */
  _pxBounds: L.Bounds | undefined = undefined;

  constructor(
    segments: ReadonlyArray<{ positions: ReadonlyArray<readonly [number, number]>; color: string }>,
    { weight, halo, renderer }: { weight: number; halo: TrackHalo | null; renderer: L.Canvas }
  ) {
    super();
    const groups = pathsByColor(segments, PAINT_ORDER_TRANCHES);
    let pathCount = 0;
    let pointCount = 0;
    for (const g of groups) {
      pathCount += g.segments.length;
      for (const i of g.segments) pointCount += segments[i].positions.length;
    }
    this.latLon = new Float64Array(2 * pointCount);
    this.px = new Float64Array(2 * pointCount);
    this.pathStarts = new Uint32Array(pathCount + 1);
    this.nextStarts = new Int32Array(pathCount);
    this.colorStarts = new Uint32Array(groups.length + 1);
    this.colors = groups.map((g) => g.color);
    /** Rang du trait de chaque chemin, et premier point de chaque trait (-1 : non dessiné). */
    const pathSegment = new Uint32Array(pathCount);
    const segmentStart = new Int32Array(segments.length).fill(-1);
    let point = 0;
    let path = 0;
    groups.forEach((g, c) => {
      this.colorStarts[c] = path;
      for (const i of g.segments) {
        pathSegment[path] = i;
        segmentStart[i] = point;
        this.pathStarts[path++] = point;
        for (const [lat, lon] of segments[i].positions) {
          this.latLon[2 * point] = lat;
          this.latLon[2 * point + 1] = lon;
          point++;
        }
      }
    });
    this.pathStarts[pathCount] = point;
    this.colorStarts[groups.length] = pathCount;
    for (let p = 0; p < pathCount; p++) {
      const next = pathSegment[p] + 1;
      this.nextStarts[p] = next < segments.length ? segmentStart[next] : -1;
    }
    this.lineWeight = weight;
    this.halo = halo;
    // `weight` : la marge que le moteur prend autour de la couche pour l'effacer et la redessiner.
    L.Util.setOptions(this, { weight: Math.max(weight, halo?.weight ?? 0), interactive: false, renderer });
  }

  /** Aucun trait à dessiner. */
  isEmpty(): boolean {
    return this.colors.length === 0;
  }

  private canvas(): CanvasInternals {
    return (this as unknown as { _renderer: CanvasInternals })._renderer;
  }

  /** Projection de tous les points au zoom de la carte, et emprise. */
  _project(): void {
    const map = this._map;
    const crs = map.options.crs ?? L.CRS.EPSG3857;
    if (!this.unit) {
      const unit = new Float64Array(this.latLon.length);
      const scale0 = crs.scale(0);
      for (let i = 0; i < unit.length; i += 2) {
        const p = crs.latLngToPoint(L.latLng(this.latLon[i], this.latLon[i + 1]), 0);
        unit[i] = p.x / scale0;
        unit[i + 1] = p.y / scale0;
      }
      this.unit = unit;
    }
    const scale = crs.scale(map.getZoom());
    const origin = map.getPixelOrigin();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.px.length; i += 2) {
      const x = Math.round(scale * this.unit[i]) - origin.x;
      const y = Math.round(scale * this.unit[i + 1]) - origin.y;
      this.px[i] = x;
      this.px[i + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = Math.max(this.lineWeight, this.halo?.weight ?? 0) / 2;
    this._pxBounds = this.px.length > 0 ? L.bounds([minX - pad, minY - pad], [maxX + pad, maxY + pad]) : undefined;
  }

  _update(): void {
    if (this._map) this._updatePath();
  }

  /** Dessin, seulement quand le moteur redessine : le liseré d'un tracé, puis un tracé par couleur et par tranche. */
  _updatePath(): void {
    const { _ctx: ctx, _drawing: drawing, _bounds: bounds } = this.canvas();
    if (!drawing || this.colors.length === 0) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    if (this.halo) {
      ctx.globalAlpha = this.halo.opacity;
      ctx.strokeStyle = this.halo.color;
      ctx.lineWidth = this.halo.weight;
      ctx.beginPath();
      this.addPaths(ctx, 0, this.pathStarts.length - 1, bounds, this.halo.weight / 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = this.lineWeight;
    for (let c = 0; c < this.colors.length; c++) {
      ctx.beginPath();
      this.addPaths(ctx, this.colorStarts[c], this.colorStarts[c + 1], bounds, this.lineWeight / 2);
      ctx.strokeStyle = this.colors[c];
      ctx.stroke();
    }
  }

  /**
   * Ajoute au chemin courant les traits `from` à `to` (exclu), sauf ceux tout
   * entiers hors de la zone dessinée, et sauf un trait réduit à un pixel que
   * le trait suivant recouvre : son bout arrondi, dessiné après lui quand
   * chaque trait l'était à son tour, est le même disque. À 5 Hz, la plupart
   * des traits tiennent dans un pixel à l'échelle de la sortie entière, et un
   * tracé de dizaines de milliers de disques coûterait cher à peindre. Un
   * point répété dans un trait n'ajoute rien non plus, et un trait qui
   * commence où finit le précédent le prolonge (jointure ronde : le même
   * dessin que deux bouts ronds).
   */
  private addPaths(ctx: CanvasRenderingContext2D, from: number, to: number, bounds: L.Bounds, pad: number): void {
    const { min, max } = bounds;
    if (!min || !max) return;
    const left = min.x - pad;
    const top = min.y - pad;
    const right = max.x + pad;
    const bottom = max.y + pad;
    const px = this.px;
    // Fin du dernier trait ajouté.
    let penX = NaN;
    let penY = NaN;
    for (let p = from; p < to; p++) {
      const start = 2 * this.pathStarts[p];
      const end = 2 * this.pathStarts[p + 1];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = start; i < end; i += 2) {
        if (px[i] < minX) minX = px[i];
        if (px[i] > maxX) maxX = px[i];
        if (px[i + 1] < minY) minY = px[i + 1];
        if (px[i + 1] > maxY) maxY = px[i + 1];
      }
      if (maxX < left || minX > right || maxY < top || minY > bottom) continue;
      if (minX === maxX && minY === maxY) {
        const next = 2 * this.nextStarts[p];
        if (next >= 0 && px[next] === minX && px[next + 1] === minY) continue;
      }
      if (px[start] !== penX || px[start + 1] !== penY) ctx.moveTo(px[start], px[start + 1]);
      for (let i = start + 2; i < end; i += 2) {
        if (px[i] !== px[i - 2] || px[i + 1] !== px[i - 1] || i + 2 === end) ctx.lineTo(px[i], px[i + 1]);
      }
      penX = px[end - 2];
      penY = px[end - 1];
    }
  }

  /** Ni clic ni survol. */
  _containsPoint(): boolean {
    return false;
  }

  _empty(): boolean {
    return this.isEmpty();
  }
}
