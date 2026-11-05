// Banc de test : gestes sur les graphes zoomables d'une analyse (lot 2 des demandes du 23/10), sortis de
// `zoom-carte.mjs` pour être partagés avec `fluidite.mjs` (lot 114). Sélecteurs d'un panneau et de son n-ième
// graphe, point visé dans la zone de tracé, double-clic à la souris, survol et double toucher daté comme par un doigt.
// Usage : `const { plotPoint, mouse, doubleClick, hover, doubleTap, pinch } = graphGestures(b)` après `connect`.

/** Le panneau dont le titre commence ainsi. */
export const SCOPE = (title) => `([...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *') ?? null)`;
/** Le n-ième graphe zoomable du panneau (ou du plein écran, `title` = null). */
export const CHART = (title, nth) => `((${title === null ? `document.querySelector('.an-map-overlay__charts')` : SCOPE(title)})?.querySelectorAll('.zoom-chart')[${nth}] ?? null)`;

/** Gestes sur les graphes, sur la connexion `b` de `lib/cdp.mjs` (`send`, `evaluate`, `settle`, `wait`). */
export const graphGestures = ({ send, evaluate, settle, wait }) => {
  /** Point du n-ième graphe à la fraction `fx` de la largeur de sa zone de tracé, à mi-hauteur, graphe ramené au milieu de l'écran. */
  const plotPoint = (title, nth, fx) => evaluate(`(async () => {
    const c = ${CHART(title, nth)};
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 300));
    const grid = c.querySelector('.recharts-cartesian-grid') ?? c;
    const r = grid.getBoundingClientRect();
    return { x: r.left + r.width * ${fx}, y: r.top + r.height / 2 };
  })()`);
  const mouse = (type, x, y, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount });
  /** Double-clic à la souris au point visé, puis la page calme (`settle`, plafond `settleMax`). */
  const doubleClick = async (title, nth, fx, { settleMax = 800 } = {}) => {
    const p = await plotPoint(title, nth, fx);
    if (!p) return 'absent';
    await mouse('mouseMoved', p.x, p.y);
    await mouse('mousePressed', p.x, p.y, 1);
    await mouse('mouseReleased', p.x, p.y, 1);
    await mouse('mousePressed', p.x, p.y, 2);
    await mouse('mouseReleased', p.x, p.y, 2);
    await settle({ max: settleMax });
    return 'ok';
  };
  const hover = async (title, nth, fx) => {
    const p = await plotPoint(title, nth, fx);
    if (!p) return 'absent';
    for (let k = 0; k < 4; k++) { await mouse('mouseMoved', p.x + k * 6, p.y); await wait(60); }
    await wait(300);
    return 'ok';
  };
  /**
   * Double toucher daté comme par un doigt : 40 ms de contact, 90 ms entre les deux. Sans date, chaque toucher
   * part quand la page a fini de redessiner le précédent, et l'écart mesuré dépasse celui d'un vrai double toucher.
   */
  const doubleTap = async (title, nth, fx) => {
    const p = await plotPoint(title, nth, fx);
    if (!p) return 'absent';
    const t0 = Date.now() / 1000;
    for (const [type, dt] of [['touchStart', 0], ['touchEnd', 0.04], ['touchStart', 0.13], ['touchEnd', 0.17]]) {
      await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchStart' ? [{ x: p.x, y: p.y }] : [], timestamp: t0 + dt });
    }
    await settle({ max: 900 });
    return 'ok';
  };
  /**
   * Pincement à deux doigts, datés comme un vrai geste : doigts à `from` (fractions de la largeur du tracé, à mi-hauteur)
   * au départ, à `to` à la fin, en `steps` mouvements espacés de `stepMs`. Écarter zoome (lot 164). Sous ralenti, le geste
   * s'allonge : chaque mouvement attend que la page l'ait reçu, comme les événements qu'un téléphone regroupe.
   */
  const pinch = async (title, nth, { from = [0.4, 0.6], to = [0.1, 0.9], steps = 12, stepMs = 16 } = {}) => {
    const p0 = await plotPoint(title, nth, 0);
    if (!p0) return 'absent';
    const width = await evaluate(`(() => { const c = ${CHART(title, nth)}; return (c.querySelector('.recharts-cartesian-grid') ?? c).getBoundingClientRect().width; })()`);
    const fingers = (k) => {
      const f = k / steps;
      return [0, 1].map((id) => ({ id, x: p0.x + width * (from[id] + (to[id] - from[id]) * f), y: p0.y }));
    };
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0) });
    for (let k = 1; k <= steps; k++) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(k) });
      await wait(stepMs);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return 'ok';
  };
  return { plotPoint, mouse, doubleClick, hover, doubleTap, pinch };
};
