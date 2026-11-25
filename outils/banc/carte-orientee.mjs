// Banc de test : la carte du direct orientée selon le téléphone (lot 225), par la rotation de l'application
// (`components/map/rotation.ts`), sur l'aperçu avant départ d'un itinéraire.
// Usage : node carte-orientee.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Profil neuf, sans réseau (fausses tuiles de `lib/tuiles.mjs`), écran de téléphone 390 × 800 tactile, environ 1 min.
// La boussole est simulée par des événements `deviceorientationabsolute` espacés de 260 ms (`platform/compass.ts` en
// filtre à 200 ms), répétés 3 s pour que le lissage (`recording/mapBearing.ts`) arrive au cap. Le script vérifie :
//  1. le bouton « Carte orientée » sous le choix du fond, relâché au départ (nord en haut) ; enfoncé, la carte ne
//     tourne qu'à la première mesure de la boussole ;
//  2. à 45° : le rotor tourné de −45°, commandes (+ et −, fond, bouton) et mention OSM immobiles, droites et
//     visibles ; tuiles aux coins et aux milieux des bords ; tracé de la trace suivie dans le rotor, dessiné sur le
//     carré de la diagonale, et tenu dans la carte quel que soit l'angle ;
//  3. gestes à 45° : glisser de 100 px (le point sous le doigt y reste, à 2 px près), toucher (le point lu par la
//     carte est celui touché), pincer sur le côté (le point entre les doigts reste fixe) ; après le glisser,
//     « Recentrer », la carte toujours orientée ;
//  4. de 350° à 10° : la carte passe par 0°, sans faire le tour ;
//  5. le choix gardé après rechargement ; puis nord en haut : rotor sans transformation, tracé revenu à sa marge,
//     et la boussole n'y fait plus rien ;
//  6. aucune erreur de console.
// Verdicts ; fin par « Tout passe. » ou le nombre d'échecs, code 0 ou 1.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { BLOCKED_EXCEPT_TILES, fakeTiles } from './lib/tuiles.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node carte-orientee.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const W = 390;
const H = 800;

// --- Itinéraire : 500 m vers le nord, 100 m vers l'est, 500 m vers le sud ---
const R = 6371000;
const O = { lat: 43.6, lon: 3.8 };
const at = (east, north) => ({
  lat: O.lat + (north / R) * (180 / Math.PI),
  lon: O.lon + (east / (R * Math.cos((O.lat * Math.PI) / 180))) * (180 / Math.PI),
});
const pts = [];
for (const [[e0, n0], [e1, n1]] of [[[0, 0], [0, 500]], [[0, 500], [100, 500]], [[100, 500], [100, 0]]]) {
  for (let j = 0; j <= 20; j++) pts.push(at(e0 + ((e1 - e0) * j) / 20, n0 + ((n1 - n0) * j) / 20));
}
const routePath = join(workDir, 'carte-orientee-itineraire.gpx');
writeFileSync(routePath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Orientee</name><type>running</type><trkseg>\n${
  pts.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"></trkpt>`).join('\n')}\n</trkseg></trk></gpx>\n`);

// --- Protocole (lib/cdp.mjs) ---
const b = await connect({ port, width: W, height: H, shotDir });
const { send, evaluate, go, settle, wait, waitFor, importFiles, clickText, shoot, check, finish, logs } = b;
await fakeTiles(b);
await b.blockNetwork(BLOCKED_EXCEPT_TILES);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// La boussole n'est écoutée que si la page connaît l'événement : posé d'avance s'il manquait.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!('ondeviceorientationabsolute' in window)) window.ondeviceorientationabsolute = null;` });

/** Boussole simulée au cap `headingDeg` pendant `durationMs` ; `sample` relevé après chaque mesure. */
const compass = async (headingDeg, durationMs = 3000, sample = null) => {
  const alpha = (360 - headingDeg) % 360;
  const end = Date.now() + durationMs;
  const seen = [];
  while (Date.now() < end) {
    await evaluate(`window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: ${alpha}, beta: 0, gamma: 0, absolute: true })); 1`);
    for (let k = 0; k < 3; k++) {
      await wait(87);
      if (sample) seen.push(await sample());
    }
  }
  return seen;
};
/** Angle du rotor à l'écran (style en ligne), en degrés ; `null` sans transformation, `undefined` sans rotor. */
const rotorAngle = () => evaluate(`(() => { const r = document.querySelector('.map-rotor'); if (!r) return undefined;
  const m = /rotate\\((-?[\\d.e-]+)deg\\)/.exec(r.style.transform); return m ? Number(m[1]) : null; })()`);
/** Angle affiché à l'instant (transition comprise), d'après la matrice calculée. */
const shownAngle = () => evaluate(`(() => { const t = getComputedStyle(document.querySelector('.map-rotor')).transform;
  if (t === 'none') return 0; const m = new DOMMatrix(t); return Math.atan2(m.b, m.a) * 180 / Math.PI; })()`);
const button = () => evaluate(`(() => { const el = document.querySelector('.map-orientation-switch__button'); if (!el) return null;
  return { pressed: el.getAttribute('aria-pressed'), title: el.title, label: el.getAttribute('aria-label'),
    under: el.closest('.leaflet-top.leaflet-left')?.querySelector('.map-base-switch') !== null
      && Boolean(el.closest('.leaflet-control').previousElementSibling?.classList.contains('map-base-switch')) }; })()`);
const near = (a, target, tol = 3) => typeof a === 'number' && Math.abs(a - target) <= tol;

// 1. « Partir » depuis la liste des itinéraires : l'aperçu avant départ, la carte entière dans l'écran.
await go('/itineraires/liste', 4000);
await waitFor(`Boolean(document.querySelector('input[type=file][accept=".gpx"]'))`, { timeout: 8000, label: 'import possible' });
await importFiles(routePath, 'input[type=file][accept=".gpx"]');
await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Partir')`, { timeout: 8000, label: 'itinéraire rangé' });
await settle({ max: 800 });
check('« Partir » depuis la liste', await clickText('Partir') === 'ok');
const previewReady = `location.pathname === '/enregistrer' && Boolean(document.querySelector('.leaflet-traceSuivie-pane svg path'))`;
await waitFor(previewReady, { timeout: 8000, label: 'aperçu de la trace' });
const scrollToMap = () => evaluate(`(() => { const r = document.querySelector('.leaflet-container').getBoundingClientRect(); window.scrollBy(0, r.top - 80); return 1; })()`);
await scrollToMap();
await settle({ max: 1500 });

const start = await button();
check('bouton sous le choix du fond', start?.under === true, JSON.stringify(start));
check('nord en haut au départ, bouton relâché', start?.pressed === 'false' && start?.title === 'Nord en haut' && start?.label === 'Carte orientée', JSON.stringify(start));
check('rotor posé, sans transformation', await rotorAngle() === null);

const box = await evaluate(`(() => { const r = document.querySelector('.leaflet-container').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const CONTROLS = ['.leaflet-control-zoom', '.map-base-switch', '.map-orientation-switch', '.leaflet-control-attribution'];
const controls = () => evaluate(`(() => ${JSON.stringify(CONTROLS)}.map((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, absent: true };
  const r = el.getBoundingClientRect();
  const turned = [];
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).transform !== 'none') turned.push(e.className || e.tagName);
  const visible = getComputedStyle(el).visibility === 'visible' && r.width > 0 && r.height > 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  return { sel, x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, turned, visible };
}))()`);
const before = await controls();
/** Marge du tracé de la trace suivie : largeur de son dessin SVG, et le cadre de son tracé à l'écran. */
const guideSvg = () => evaluate(`(() => {
  const path = document.querySelector('.leaflet-traceSuivie-pane svg path');
  if (!path) return null;
  const r = path.getBoundingClientRect();
  return { inRotor: Boolean(path.closest('.map-rotor')), width: Number(path.ownerSVGElement.getAttribute('width')),
    box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
})()`);
const northSvg = await guideSvg();

// --- Gestes et relevés (repris de la sonde de l'étape 1) ---
const tiles = () => evaluate(`[...document.querySelectorAll('img.leaflet-tile-loaded')].map((t) => {
  t.dataset.banc = t.dataset.banc || String(Math.random()).slice(2);
  const r = t.getBoundingClientRect();
  return { id: t.dataset.banc, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
})`);
const tileById = (id) => evaluate(`(() => { const t = document.querySelector('img[data-banc="${id}"]'); if (!t) return null;
  const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })()`);
const nearest = (list, p) => list.reduce((best, t) => (Math.hypot(t.x - p.x, t.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? t : best));
const touches = (points) => points.map(([x, y], id) => ({ x, y, id }));
const drag = async (from, dx, dy, measureId) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches([[from.x, from.y]]) });
  for (let k = 1; k <= 10; k++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches([[from.x + (dx * k) / 10, from.y + (dy * k) / 10]]) });
    await wait(30);
  }
  await wait(150);
  const during = await tileById(measureId);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return during;
};
const pinch = async (m, from, to, measureId) => {
  const fingers = (d) => touches([[m.x - d, m.y], [m.x + d, m.y]]);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(from) });
  for (let k = 1; k <= 8; k++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(from + ((to - from) * k) / 8) });
    await wait(40);
  }
  await wait(150);
  const during = await tileById(measureId);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return during;
};
// Carte Leaflet, lue dans la fibre React du conteneur (valeur du contexte de `MapContainer`) : le point lu au toucher.
const readMap = `(() => { const el = document.querySelector('.leaflet-container'); const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  let f = el[key]?.child; while (f) { const v = f.memoizedProps?.value; if (v && typeof v.getContainer === 'function') return v; f = f.child; } return null; })()`;
/**
 * Écart, en pixels de carte, entre le point touché `p` selon Leaflet et ce que l'écran y montre : sa place dans la
 * tuile `tile`, ramenée droite par l'angle affiché (matrice calculée du rotor), à partir du centre de la tuile.
 */
const tapError = async (p, tile) => {
  const armed = await evaluate(`(() => { const map = ${readMap}; if (!map) return false; window.__bancClic = null;
    map.once('click', (e) => { window.__bancClic = map.latLngToLayerPoint(e.latlng); }); return true; })()`);
  if (!armed) return 'carte introuvable';
  const turn = (await shownAngle()) * (Math.PI / 180);
  const [dx, dy] = [p.x - tile.x, p.y - tile.y];
  const local = { x: dx * Math.cos(turn) + dy * Math.sin(turn), y: -dx * Math.sin(turn) + dy * Math.cos(turn) };
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches([[p.x, p.y]]) });
  await wait(40);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor('Boolean(window.__bancClic)', { timeout: 2000, label: 'clic' });
  return evaluate(`(() => {
    const t = document.querySelector('img[data-banc="${tile.id}"]');
    const level = t.parentElement;
    const m = /translate3d\\((-?[\\d.]+)px, (-?[\\d.]+)px/.exec(level.style.transform);
    const s = /scale\\(([\\d.]+)\\)/.exec(level.style.transform);
    if (!m || (s && Math.abs(Number(s[1]) - 1) > 1e-6)) return 'niveau transformé : ' + level.style.transform;
    const local = ${JSON.stringify(local)};
    const p = { x: t._leaflet_pos.x + Number(m[1]) + t.width / 2 + local.x, y: t._leaflet_pos.y + Number(m[2]) + t.width / 2 + local.y };
    const got = window.__bancClic;
    return got ? Math.round(Math.hypot(got.x - p.x, got.y - p.y) * 10) / 10 : 'aucun clic';
  })()`);
};
// À 2 px des bords ; à 8 px dans les coins, arrondis par le cadre de la carte. Les tuiles ne prennent pas le toucher
// (`pointer-events: none` de Leaflet) : le temps du relevé, elles le prennent.
const testPoints = (() => {
  const [i, c] = [2, 8];
  const { x, y, w, h } = box;
  return [[x + c, y + c], [x + w / 2, y + i], [x + w - c, y + c], [x + w - i, y + h / 2], [x + w - c, y + h - c], [x + w / 2, y + h - i], [x + c, y + h - c], [x + i, y + h / 2]];
})();
const uncovered = () => evaluate(`(() => {
  const style = document.createElement('style');
  style.textContent = '.leaflet-tile-container, .leaflet-tile { pointer-events: auto !important; }';
  document.head.appendChild(style);
  const out = ${JSON.stringify(testPoints)}.filter(([x, y]) => !document.elementsFromPoint(x, y).some((e) => e.matches('img.leaflet-tile-loaded'))).map(([x, y]) => Math.round(x) + ',' + Math.round(y));
  style.remove();
  return out;
})()`);

// 1 bis. Bouton enfoncé : rien ne tourne sans boussole.
check('« Carte orientée »', await evaluate(`(() => { document.querySelector('.map-orientation-switch__button')?.click(); return 'ok'; })()`) === 'ok');
await settle({ max: 800 });
const pressed = await button();
check('bouton enfoncé, titre « Carte orientée »', pressed?.pressed === 'true' && pressed?.title === 'Carte orientée', JSON.stringify(pressed));
check('sans mesure de la boussole, la carte reste nord en haut', await rotorAngle() === null);

// 2. Boussole à 45°.
await compass(45);
await wait(400);
await settle({ max: 2000 });
const a45 = await rotorAngle();
check('à 45° : carte tournée de −45° (3° près)', near(a45, -45), String(a45));
check('à 45° : variable --map-bearing du rotor', await evaluate(`document.querySelector('.map-rotor').style.getPropertyValue('--map-bearing')`) === `${a45}deg`);
const now = await controls();
const moved = now.filter((c, k) => c.absent || c.x !== before[k].x || c.y !== before[k].y || c.w !== before[k].w || c.h !== before[k].h || c.turned.length > 0 || !c.visible);
check('à 45° : commandes et mention OSM immobiles, droites et visibles', moved.length === 0, JSON.stringify(moved));
const holes = await uncovered();
check('à 45° : tuile aux quatre coins et aux milieux des bords', holes.length === 0, holes.join(' '));
const svg45 = await guideSvg();
const side = Math.ceil(Math.hypot(box.w, box.h));
check('à 45° : tracé de la trace suivie dans le rotor', svg45?.inRotor === true);
check('à 45° : tracé dessiné sur le carré de la diagonale', svg45 !== null && svg45.width >= side, `${svg45?.width} px pour ${side}`);
const inside = svg45 !== null && svg45.box.left >= box.x - 1 && svg45.box.right <= box.x + box.w + 1 && svg45.box.top >= box.y - 1 && svg45.box.bottom <= box.y + box.h + 1;
check('à 45° : la trace suivie tient dans la carte', inside, JSON.stringify({ trace: svg45?.box, carte: box }));
await shoot('carte-orientee-45');

// 3. Gestes à 45°.
// Le doigt part d'un point de la carte ; une tuile proche, qui bouge d'un bloc avec elle, mesure le déplacement.
for (const [dx, dy] of [[100, 0], [0, 100]]) {
  const from = { x: box.x + box.w / 2 - 60, y: box.y + box.h / 2 + 40 };
  const t = nearest(await tiles(), from);
  const during = await drag(from, dx, dy, t.id);
  const err = during ? Math.hypot(during.x - (t.x + dx), during.y - (t.y + dy)) : Infinity;
  check(`à 45° : glisser de ${dx},${dy} px, le point sous le doigt y reste (2 px)`, err <= 2, `écart ${err.toFixed(1)} px`);
  await settle({ max: 1500 });
}
const recentrer = () => evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Recentrer')`);
check('après le glisser : « Recentrer », la carte toujours orientée', await recentrer() && near(await rotorAngle(), -45));
check('« Recentrer »', await clickText('Recentrer') === 'ok');
await settle({ max: 800 });
check('après « Recentrer » : bouton retiré, la carte toujours orientée', !(await recentrer()) && near(await rotorAngle(), -45));
{
  const p = { x: box.x + box.w * 0.7, y: box.y + box.h * 0.3 };
  const err = await tapError(p, nearest(await tiles(), p));
  check('à 45° : toucher, le point lu par la carte est celui touché (2 px)', typeof err === 'number' && err <= 2, String(err));
  await settle({ max: 1000 });
}
{
  const m = { x: box.x + 90, y: box.y + box.h * 0.35 };
  const t = nearest(await tiles(), m);
  const during = await pinch(m, 30, 40, t.id);
  const s = during ? during.w / t.w : 0;
  const err = during ? Math.hypot(during.x - (m.x + s * (t.x - m.x)), during.y - (m.y + s * (t.y - m.y))) : Infinity;
  check('à 45° : pincer sur le côté, le point entre les doigts reste fixe (2 px)', err <= 2 && s > 1.2, `échelle ${s.toFixed(3)}, écart ${err.toFixed(1)} px`);
  await wait(400);
  await settle({ max: 2000 });
}

// 4. De 350° à 10° : par 0°, sans faire le tour.
await compass(350);
const a350 = await rotorAngle();
const path = await compass(10, 3000, shownAngle);
const a10 = await rotorAngle();
await wait(400);
const widest = Math.max(...path.map((a) => Math.abs(a)));
check('350° puis 10° : la carte passe par 0°, sans faire le tour', near(a350, 10, 4) && near(a10, -10, 4) && widest <= 15,
  `${a350} puis ${a10}, au plus ${widest.toFixed(1)}° de 0°`);

// 5. Choix gardé après rechargement, puis nord en haut.
await send('Page.reload');
await waitFor(previewReady, { timeout: 10000, label: 'aperçu rechargé' });
await scrollToMap();
await settle({ max: 1500 });
const reloaded = await button();
check('après rechargement : bouton enfoncé', reloaded?.pressed === 'true', JSON.stringify(reloaded));
await compass(90);
await wait(400);
check('après rechargement : la carte suit la boussole (90°)', near(await rotorAngle(), -90), String(await rotorAngle()));
check('« Nord en haut »', await evaluate(`(() => { document.querySelector('.map-orientation-switch__button')?.click(); return 'ok'; })()`) === 'ok');
await settle({ max: 1000 });
const released = await button();
check('nord en haut : bouton relâché, titre « Nord en haut »', released?.pressed === 'false' && released?.title === 'Nord en haut', JSON.stringify(released));
check('nord en haut : rotor sans transformation', await rotorAngle() === null);
const svgNorth = await guideSvg();
check('nord en haut : tracé revenu à sa marge', svgNorth?.width === northSvg?.width, `${svgNorth?.width} px, ${northSvg?.width} px au départ`);
await compass(200, 1000);
check('nord en haut : la boussole n\'y fait plus rien', await rotorAngle() === null);

// 6. Console.
const errors = logs.filter((l) => /^(EXCEPTION|error)/.test(l));
check('aucune erreur de console', errors.length === 0, errors.join(' | ').slice(0, 600));
await finish('Tout passe.');
