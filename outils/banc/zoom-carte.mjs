// Banc de test : graphe zoomé vu sur la carte, lecture au-dessus des graphes, double-clic qui zoome
// (lot 2 des demandes du 23/10).
// Usage : node zoom-carte.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 2 min 30. Le script :
//  1. importe une course en ligne droite (FC, altitude), une session de surf et une session de voile (`make-gpx.mjs`),
//     toutes deux avec la FC ;
//  2. course, sur ordinateur : survol sans bulle Recharts, la valeur lue au-dessus du graphe, sans le faire bouger ;
//     double-clic à 25 % de la largeur : la plage passe de 5,4 km à 2,7 km autour du point visé (graduations 1, 2,
//     3 km), un second à 1,35 km (1,5 et 2 km) ; « +carte » et « Tout voir » paraissent ; « +carte »
//     allume le tronçon en violet et cadre la carte dessus, ramenée à l'écran ; un nouveau zoom met le violet à jour
//     sans recadrer ; « Tout voir » l'efface, et il ne revient pas au zoom suivant ; fermer l'onglet l'efface aussi ;
//  3. course : « +carte » des onglets cardio, énergie et zones de pente ; profil d'altitude de « général »
//     (24/10) : nom et lecture, double-clic, « +carte », zoom à part de « graphiques », boutons du zoom à 24 px,
//     titres à 13 px et noms des graphes à 10 px ;
//  4. voile (vitesse, vent) et surf : lecture, double-clic, « +carte » ;
//  5. à 390×844, au doigt : double toucher qui zoome ; carte hors de vue : « +carte » ouvre le plein écran
//     carte + graphes, × le ferme ; de même depuis le profil de « général » ; carte entière à l'écran (« général » replié) : elle se cadre sur place ;
//  6. à 390×844 (25/10) : « +carte » seul sur un graphe non zoomé ; il ouvre carte + graphes de l'onglet, sans violet ;
//     le retour d'Android (`window.trackerBack`, en développement) referme le plein écran et rend la page au même
//     défilement, zoom compris ; de même zoomé, et pour la carte seule ouverte d'un toucher ;
//  7. (25/10) « Afficher » sur chaque graphe, zoomé ou non, sur ordinateur et dans le plein écran (non zoomé :
//     toute la trace) ; « +carte » dans la page du téléphone ; un second clic à la même plage retire le violet,
//     zoom et plein écran gardés ; la plage changée entre-temps, il recadre.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node zoom-carte.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

const clickTab = (label, close = false) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  const isOpen = t.getAttribute('aria-pressed') === 'true';
  if (isOpen !== ${close}) return isOpen ? 'déjà ouvert' : 'déjà fermé';
  t.click(); return 'ok';
})()`);
/** Le panneau dont le titre commence ainsi. */
const SCOPE = (title) => `([...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *') ?? null)`;
/** Le n-ième graphe zoomable du panneau (ou du plein écran, `title` = null). */
const CHART = (title, nth) => `((${title === null ? `document.querySelector('.an-map-overlay__charts')` : SCOPE(title)})?.querySelectorAll('.zoom-chart')[${nth}] ?? null)`;
/** Lectures du panneau, au-dessus de ses graphes. */
const readouts = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? [...s.querySelectorAll('[data-chart-readout]')].map((r) => r.textContent.trim()).join(' | ') : '(absent)'; })()`);
/** Texte des infobulles de Recharts, dans toute la page : il doit rester vide. */
const tooltipText = () => evaluate(`[...document.querySelectorAll('.recharts-tooltip-wrapper')].map((w) => w.textContent.trim()).join('')`);
/** Graduations de l'axe des abscisses du n-ième graphe. */
const ticks = (title, nth) => evaluate(`(() => { const c = ${CHART(title, nth)}; return c ? [...c.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((t) => t.textContent.trim()).join(' | ') : '(absent)'; })()`);
/** Boutons du zoom posés sur le n-ième graphe. */
const zoomButtons = (title, nth) => evaluate(`(() => { const c = ${CHART(title, nth)}; return c ? [...c.querySelectorAll('.zoom-chart__map, .zoom-chart__actions button')].map((b) => b.textContent.trim()).join(' | ') : '(absent)'; })()`);
const clickZoomButton = (title, nth, label) => evaluate(`(() => {
  const c = ${CHART(title, nth)};
  const b = c ? [...c.querySelectorAll('.zoom-chart__map, .zoom-chart__actions button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}) : null;
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
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
const doubleClick = async (title, nth, fx) => {
  const p = await plotPoint(title, nth, fx);
  if (!p) return 'absent';
  await mouse('mouseMoved', p.x, p.y);
  await mouse('mousePressed', p.x, p.y, 1);
  await mouse('mouseReleased', p.x, p.y, 1);
  await mouse('mousePressed', p.x, p.y, 2);
  await mouse('mouseReleased', p.x, p.y, 2);
  await settle({ max: 800 });
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
/** Tronçon violet dans la carte de la page (`.an-map-row`) ou du plein écran : part de la carte qu'il couvre (largeur ou hauteur). */
const violet = (where = '.an-map-row') => evaluate(`(() => {
  const root = document.querySelector(${JSON.stringify(where)});
  const map = root?.querySelector('.leaflet-container');
  const paths = root ? [...root.querySelectorAll('path[stroke="#7b1fa2"]')] : [];
  if (!map || paths.length === 0) return { count: 0, cover: 0 };
  const m = map.getBoundingClientRect();
  const boxes = paths.map((p) => p.getBoundingClientRect());
  const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
  const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
  return { count: paths.length, cover: Math.round(100 * Math.max((right - left) / m.width, (bottom - top) / m.height)) / 100 };
})()`);
/** La carte de la page est-elle entière à l'écran, sous la barre du haut (sa marge de défilement) ? */
const mapOnScreen = () => evaluate(`(() => { const el = document.getElementById('map-view'); if (!el) return null; const r = el.getBoundingClientRect(); const top = parseFloat(getComputedStyle(el).scrollMarginTop) || 0; return r.top >= top - 1 && r.bottom <= window.innerHeight + 1; })()`);
const chartTop = (title, nth) => evaluate(`(() => { const c = ${CHART(title, nth)}; return c ? Math.round(c.getBoundingClientRect().top + window.scrollY) : null; })()`);
// Rangée « avancé » des analyses ouverte d'office, rouverte à chaque session neuve avec « général » (comme `graphes.mjs`).
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork();

// --- Sessions synthétiques ---
/** Course en ligne droite vers l'est, 3 m/s, altitude qui monte puis redescend, FC qui croît. */
const runGpx = (seconds, speed, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  let m = 0;
  let ele = 50;
  for (let k = 0; k <= seconds; k++) {
    if (k > 0) { m += speed; ele += (k < seconds * 0.4 ? 0.08 : -0.05) * speed; }
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(130 + k / 60)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Ligne</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const M_PER_DEG_LAT = 111_195;
const surfGpx = (startMs, phases, hrAt) => {
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const pts = [];
  const push = (speed, heading) => pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(startMs + t * 1000).toISOString()}</time>`
    + `<extensions><speed>${speed}</speed>${speed > 0 ? `<course>${heading}</course>` : ''}<gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(t))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
  push(0, 0);
  for (const [s, speed, heading = 0] of phases) {
    for (let k = 0; k < s; k++) {
      lat += (speed * Math.cos((heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (speed * Math.sin((heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += 1;
      push(speed, heading);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Matinée</name><type>surf</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const MORNING = [
  [60, 0], [60, 1.2, 90], [50, 1, 0], [4, 0.1], [40, 1, 270], [4, 0.1], [26, 1, 0], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1, 20], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1, 90],
];
const withHr = (gpx, hrAt) => {
  let k = 0;
  return gpx
    .replace('xmlns="http://www.topografix.com/GPX/1/1"', 'xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"')
    .replace(/<\/extensions><\/trkpt>/g, () => `<gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(k++))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
};
const voilePath = join(tmpdir(), 'zoom-carte-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);

const T_RUN = Date.UTC(2026, 9, 1, 8, 0, 0);
const T_SURF = Date.UTC(2026, 9, 3, 7, 0, 0);
const T_VOILE = Date.UTC(2026, 8, 20, 13, 0, 0);
const SESSIONS = [
  { key: 'course', page: 'course', start: T_RUN, gpx: runGpx(1800, 3, T_RUN) },
  { key: 'surf', page: 'surf', start: T_SURF, gpx: surfGpx(T_SURF, MORNING, (k) => 110 + 20 * Math.sin(k / 120)) },
  { key: 'voile', page: 'voile', start: T_VOILE, gpx: withHr(readFileSync(voilePath, 'utf8'), (k) => 120 + 25 * Math.sin(k / 300)) },
];

// --- 1. Import ---
const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `${s.key}.gpx`));
  const rec = await waitFor(async () => (await records())?.find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000), { timeout: 6000, label: `fiche ${s.key}` });
  await settle({ max: 2000, label: `import ${s.key}` });
  paths[s.key] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.key} rangée`, Boolean(rec));
}

// --- 2. Course, sur ordinateur ---
await go(paths.course, 6000);
console.log('  graphiques :', await clickTab('graphiques'));
await settle({ max: 1500 });
check(`course : graduations de départ (${await ticks('Graphiques', 0)})`, (await ticks('Graphiques', 0)) === '0 km | 2 km | 4 km');
check(`course : « Afficher » seul avant le zoom (${await zoomButtons('Graphiques', 0)})`, (await zoomButtons('Graphiques', 0)) === 'Afficher');
const deskPerChart = await evaluate(`(() => { const p = ${SCOPE('Graphiques')}; return p ? [...p.querySelectorAll('.zoom-chart')].map((c) => c.querySelectorAll(':scope > .zoom-chart__map').length).join('') : '(absent)'; })()`);
check(`course : « Afficher » sur chaque graphe, FC comprise (${deskPerChart})`, /^1{3,}$/.test(deskPerChart));
// Sans zoom : toute la trace en violet ; un second clic la retire.
await clickZoomButton('Graphiques', 0, 'Afficher');
await settle({ max: 1500 });
const wholeV = await violet();
check(`course : sans zoom, « Afficher » allume toute la trace (${wholeV.count}, ${wholeV.cover})`, wholeV.count >= 1 && wholeV.cover > 0.45);
await clickZoomButton('Graphiques', 0, 'Afficher');
await settle({ max: 800 });
check(`course : second clic, violet retiré (${(await violet()).count})`, (await violet()).count === 0);
await evaluate(`window.scrollTo(0, 0)`);
await wait(500);
const topBefore = await chartTop('Graphiques', 1);
console.log('  survol :', await hover('Graphiques', 0, 0.5));
const read = await readouts('Graphiques');
check(`course : lecture au-dessus des graphes (${read})`, /km\/h · .*km/.test(read) && read.includes(' m, pente') && read.includes('bpm'));
check(`course : aucune bulle Recharts (« ${await tooltipText()} »)`, (await tooltipText()) === '');
check(`course : le graphe suivant ne bouge pas au survol (${topBefore} → ${await chartTop('Graphiques', 1)})`, topBefore === (await chartTop('Graphiques', 1)));
await shoot('zoom-lecture');
console.log('  double-clic à 25 % :', await doubleClick('Graphiques', 0, 0.25));
check(`course : zoom ×2 autour du point visé (${await ticks('Graphiques', 0)})`, (await ticks('Graphiques', 0)) === '1 km | 2 km | 3 km');
check(`course : les autres graphes suivent (${await ticks('Graphiques', 1)})`, (await ticks('Graphiques', 1)) === '1 km | 2 km | 3 km');
check(`course : « Afficher » et « Tout voir » (${await zoomButtons('Graphiques', 0)})`, (await zoomButtons('Graphiques', 0)) === 'Afficher | Tout voir');
console.log('  second double-clic :', await doubleClick('Graphiques', 0, 0.25));
check(`course : zoom ×2 encore, sur le même point (${await ticks('Graphiques', 0)})`, (await ticks('Graphiques', 0)) === '1.5 km | 2 km');
check(`course : pas de violet avant le bouton (${(await violet()).count})`, (await violet()).count === 0);
const wholeCover = 1.35 / 5.4;
console.log('  Sur la carte :', await clickZoomButton('Graphiques', 0, 'Afficher'));
await settle({ max: 1800 });
const framed = await violet();
// Leaflet cadre au cran de zoom entier : le tronçon remplit entre la moitié et toute la carte.
check(`course : tronçon violet cadré, qui remplit la carte à un cran près (${framed.count} tracé, ${framed.cover})`, framed.count >= 1 && framed.cover > 0.45);
check(`course : carte ramenée à l'écran (${await mapOnScreen()})`, (await mapOnScreen()) === true);
await shoot('zoom-sur-la-carte');
console.log('  double-clic à 50 % :', await doubleClick('Graphiques', 0, 0.5));
const narrower = await violet();
check(`course : le violet suit le zoom, sans recadrer (${framed.cover} → ${narrower.cover})`, narrower.count >= 1 && narrower.cover < framed.cover * 0.7 && narrower.cover > 0.2);
console.log('  Tout voir :', await clickZoomButton('Graphiques', 0, 'Tout voir'));
await settle({ max: 800 });
check(`course : « Tout voir » efface le violet, « Afficher » reste (${(await violet()).count}, « ${await zoomButtons('Graphiques', 0)} »)`, (await violet()).count === 0 && (await zoomButtons('Graphiques', 0)) === 'Afficher');
await doubleClick('Graphiques', 0, 0.5);
check(`course : le violet ne revient pas au zoom suivant (${(await violet()).count})`, (await violet()).count === 0);
await clickZoomButton('Graphiques', 0, 'Afficher');
await settle({ max: 1500 });
check('course : rallumé par le bouton', (await violet()).count >= 1);
await clickZoomButton('Graphiques', 0, 'Afficher');
await settle({ max: 800 });
check(`course : second clic sur la même plage, violet retiré, zoom gardé (${(await violet()).count}, « ${await zoomButtons('Graphiques', 0)} »)`, (await violet()).count === 0 && (await zoomButtons('Graphiques', 0)) === 'Afficher | Tout voir');
await clickZoomButton('Graphiques', 0, 'Afficher');
await settle({ max: 1200 });
check('course : troisième clic, rallumé', (await violet()).count >= 1);
console.log('  graphiques fermé :', await clickTab('graphiques', true));
await settle({ max: 800 });
check(`course : onglet fermé, violet effacé (${(await violet()).count})`, (await violet()).count === 0);
await clickTab('graphiques');
await settle({ max: 1200 });
check(`course : rouvert, zoom gardé mais pas le violet (${(await violet()).count}, « ${await zoomButtons('Graphiques', 0)} »)`, (await violet()).count === 0 && (await zoomButtons('Graphiques', 0)) === 'Afficher | Tout voir');
await clickZoomButton('Graphiques', 0, 'Tout voir');
check(`course : tronçon entier = ${wholeCover.toFixed(2)} de la trace, pour mémoire`, true);

// --- 3. Course : cardio, énergie, zones de pente ---
await clickTab('graphiques', true);
for (const [tab, title] of [['cardio', 'Cardio'], ['énergie', 'Énergie'], ['zones de pente', 'Allure par zone de pente']]) {
  console.log(`  ${tab} :`, await clickTab(tab));
  await settle({ max: 1500 });
  await hover(title, 0, 0.4);
  check(`${tab} : lecture (${await readouts(title)})`, (await readouts(title)).includes(' · '));
  await doubleClick(title, 0, 0.5);
  check(`${tab} : zoomé (${await zoomButtons(title, 0)})`, (await zoomButtons(title, 0)) === 'Afficher | Tout voir');
  await clickZoomButton(title, 0, 'Afficher');
  await settle({ max: 1500 });
  const v = await violet();
  check(`${tab} : tronçon violet cadré (${v.count}, ${v.cover})`, v.count >= 1 && v.cover > 0.45);
  await clickZoomButton(title, 0, 'Tout voir');
  await wait(600);
  check(`${tab} : effacé par « Tout voir »`, (await violet()).count === 0);
  await clickTab(tab, true);
  await wait(600);
}

// --- 3 b. Course : profil d'altitude de « général » (lot 2 des demandes du 24/10) ---
check(`général : graduations de départ (${await ticks('Général', 0)})`, (await ticks('Général', 0)) === '0 km | 2 km | 4 km');
await hover('Général', 0, 0.5);
const generalRead = await readouts('Général');
check(`général : nom et lecture au-dessus du profil (${generalRead})`, /^Altitude\d+ m, pente -?\d+ % · [\d.]+ km$/.test(generalRead));
check(`général : aucune bulle (« ${await tooltipText()} »)`, (await tooltipText()) === '');
await doubleClick('Général', 0, 0.25);
check(`général : zoom ×2 autour du point visé (${await ticks('Général', 0)})`, (await ticks('Général', 0)) === '1 km | 2 km | 3 km');
check(`général : « Afficher » et « Tout voir » (${await zoomButtons('Général', 0)})`, (await zoomButtons('Général', 0)) === 'Afficher | Tout voir');
const buttonBox = await evaluate(`(() => { const b = ${CHART('Général', 0)}?.querySelector('.zoom-chart__actions button'); if (!b) return null; const s = getComputedStyle(b); return { h: Math.round(b.getBoundingClientRect().height), font: s.fontSize }; })()`);
check(`boutons du zoom 20 % plus petits (${JSON.stringify(buttonBox)})`, buttonBox?.h === 24 && buttonBox?.font === '10.4px');
const mapButtonBox = await evaluate(`(() => { const c = ${CHART('Général', 0)}; const b = c?.querySelector('.zoom-chart__map'); const r = c?.previousElementSibling; if (!b || !r) return null; const cb = c.getBoundingClientRect(), bb = b.getBoundingClientRect(), rb = r.getBoundingClientRect(); return { above: Math.round(cb.top - bb.bottom), right: Math.round(cb.right - bb.right), readoutRight: Math.round(rb.right - parseFloat(getComputedStyle(r).paddingRight) - bb.left) }; })()`);
check(`« Afficher » sur la ligne du nom, collé à droite, sans couvrir la lecture (${JSON.stringify(mapButtonBox)})`, mapButtonBox !== null && mapButtonBox.above >= 0 && mapButtonBox.right === 0 && mapButtonBox.readoutRight <= 0);
await clickZoomButton('Général', 0, 'Afficher');
await settle({ max: 1800 });
const generalV = await violet();
check(`général : tronçon violet cadré (${generalV.count}, ${generalV.cover})`, generalV.count >= 1 && generalV.cover > 0.45);
await clickTab('graphiques');
await settle({ max: 1500 });
check(`général : « graphiques » pas zoomé pour autant (${await ticks('Graphiques', 0)})`, (await ticks('Graphiques', 0)) === '0 km | 2 km | 4 km');
await clickTab('graphiques', true);
await wait(600);
await clickZoomButton('Général', 0, 'Tout voir');
await wait(600);
check(`général : « Tout voir » efface le violet, « Afficher » reste (${(await violet()).count}, « ${await zoomButtons('Général', 0)} »)`, (await violet()).count === 0 && (await zoomButtons('Général', 0)) === 'Afficher');
const sizes = await evaluate(`(() => { const t = ${SCOPE('Général')}?.querySelector('[role=button]'); const n = document.querySelector('.chart-readout__label'); return { titre: t && getComputedStyle(t).fontSize, nom: n && getComputedStyle(n).fontSize }; })()`);
check(`analyses : titres à 13 px, noms des graphes à 10 px (${JSON.stringify(sizes)})`, sizes?.titre === '13px' && sizes?.nom === '10px');

// --- 4. Voile et surf ---
await go(paths.voile, 8000);
await clickTab('graphiques');
await settle({ max: 2000 });
await hover('Graphiques', 0, 0.5);
const sailRead = await readouts('Graphiques');
check(`voile : lecture vitesse et FC, à l'heure (${sailRead})`, /nds? · \d\d:\d\d:\d\d/.test(sailRead) && sailRead.includes('bpm'));
check(`voile : aucune bulle (« ${await tooltipText()} »)`, (await tooltipText()) === '');
await doubleClick('Graphiques', 0, 0.5);
check(`voile : zoomé (${await zoomButtons('Graphiques', 0)})`, (await zoomButtons('Graphiques', 0)) === 'Afficher | Tout voir');
await clickZoomButton('Graphiques', 0, 'Afficher');
await settle({ max: 1800 });
const sailV = await violet();
check(`voile : tronçon violet cadré (${sailV.count}, ${sailV.cover})`, sailV.count >= 1 && sailV.cover > 0.45);
await clickTab('vent');
await settle({ max: 1500 });
await hover('Variations du Vent', 0, 0.5);
check(`vent : lecture en degrés (${await readouts('Variations du Vent')})`, /\d+° · \d\d:/.test(await readouts('Variations du Vent')));
check(`vent : même zoom (${await zoomButtons('Variations du Vent', 0)})`, (await zoomButtons('Variations du Vent', 0)) === 'Afficher | Tout voir');
await clickZoomButton('Variations du Vent', 0, 'Afficher');
await settle({ max: 1500 });
check('vent : le tronçon passe à l\'onglet vent', (await violet()).count >= 1);
await clickTab('vent', true);
await wait(600);
check('vent fermé : violet effacé', (await violet()).count === 0);
await clickZoomButton('Graphiques', 0, 'Tout voir');

await go(paths.surf, 6000);
await clickTab('graphiques');
await settle({ max: 1500 });
await hover('Vitesse', 0, 0.5);
check(`surf : lecture (${await readouts('Vitesse')})`, /km\/h · \d\d:/.test(await readouts('Vitesse')) && (await readouts('Vitesse')).includes('bpm'));
await doubleClick('Vitesse', 0, 0.6);
await clickZoomButton('Vitesse', 0, 'Afficher');
await settle({ max: 1500 });
const surfV = await violet();
check(`surf : tronçon violet (${surfV.count}, ${surfV.cover})`, surfV.count >= 1 && surfV.cover > 0.45);

// --- 5. Téléphone, au doigt ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await go(paths.course, 6000);
await clickTab('graphiques');
await settle({ max: 1500 });
check(`390 px : « +carte » seul avant le zoom (${await zoomButtons('Graphiques', 0)})`, (await zoomButtons('Graphiques', 0)) === '+carte');
const perChart = await evaluate(`(() => { const p = ${SCOPE('Graphiques')}; return p ? [...p.querySelectorAll('.zoom-chart')].map((c) => c.querySelectorAll(':scope > .zoom-chart__map').length).join('') : '(absent)'; })()`);
check(`390 px : « +carte » sur chaque graphe, FC comprise (${perChart})`, /^1{3,}$/.test(perChart));
console.log('  double toucher :', await doubleTap('Graphiques', 0, 0.25));
check(`390 px : le double toucher zoome ×2 (${await ticks('Graphiques', 0)})`, (await ticks('Graphiques', 0)) === '1 km | 2 km | 3 km');
check(`390 px : aucune bulle (« ${await tooltipText()} »)`, (await tooltipText()) === '');
check(`390 px : carte hors de vue (${await mapOnScreen()})`, (await mapOnScreen()) === false);
await clickZoomButton('Graphiques', 0, '+carte');
await settle({ max: 1800 });
const overlay = await evaluate(`(() => { const o = document.querySelector('.an-map-overlay'); return o ? { charts: o.querySelectorAll('.an-map-overlay__charts .zoom-chart').length, map: Boolean(o.querySelector('.leaflet-container')) } : null; })()`);
check(`390 px : plein écran carte + graphes (${JSON.stringify(overlay)})`, overlay !== null && overlay.map && overlay.charts >= 2);
const overV = await violet('.an-map-overlay');
check(`390 px : tronçon violet cadré dans le plein écran (${overV.count}, ${overV.cover})`, overV.count >= 1 && overV.cover > 0.45);
await shoot('zoom-plein-ecran');
console.log('  double toucher dans le plein écran :', await doubleTap(null, 0, 0.5));
// Touché au milieu de 0,675-3,375 km (2,025 km) : 1,35-2,7 km.
check(`390 px : on zoome encore sous la carte (${await ticks(null, 0)})`, (await ticks(null, 0)) === '1.5 km | 2 km | 2.5 km');
const overV2 = await violet('.an-map-overlay');
check(`390 px : le violet suit (${overV.cover} → ${overV2.cover})`, overV2.count >= 1 && overV2.cover < overV.cover * 0.7);
// Plage changée depuis le clic : « Afficher » recadre ; un second clic retire le violet, le plein écran reste.
check(`390 px : « Afficher » dans le plein écran (${await zoomButtons(null, 0)})`, (await zoomButtons(null, 0)) === 'Afficher | Tout voir');
await clickZoomButton(null, 0, 'Afficher');
await settle({ max: 1200 });
const reframed = await violet('.an-map-overlay');
check(`390 px : plage changée, « Afficher » recadre sans annuler (${reframed.count}, ${reframed.cover})`, (await evaluate(`Boolean(document.querySelector('.an-map-overlay'))`)) === true && reframed.count >= 1 && reframed.cover > 0.45);
await clickZoomButton(null, 0, 'Afficher');
await settle({ max: 1200 });
check(`390 px : second clic, violet retiré, plein écran ouvert (${(await violet('.an-map-overlay')).count})`, (await evaluate(`Boolean(document.querySelector('.an-map-overlay'))`)) === true && (await violet('.an-map-overlay')).count === 0);
await evaluate(`document.querySelector('.an-map-overlay__close')?.click()`);
await settle({ max: 800 });
check('390 px : × ferme le plein écran', (await evaluate(`Boolean(document.querySelector('.an-map-overlay'))`)) === false);
// Profil de « général » : double toucher, puis plein écran carte + profil.
console.log('  double toucher sur le profil de « général » :', await doubleTap('Général', 0, 0.25));
check(`390 px : le profil de « général » zoome ×2 (${await ticks('Général', 0)})`, (await ticks('Général', 0)) === '1 km | 2 km | 3 km');
await clickZoomButton('Général', 0, '+carte');
await settle({ max: 1800 });
const generalOverlay = await evaluate(`(() => { const o = document.querySelector('.an-map-overlay'); return o ? { charts: o.querySelectorAll('.an-map-overlay__charts .zoom-chart').length, name: o.querySelector('.an-map-overlay__charts .chart-readout__label')?.textContent ?? '' } : null; })()`);
check(`390 px : plein écran carte + profil de « général » (${JSON.stringify(generalOverlay)})`, generalOverlay?.charts === 1 && generalOverlay?.name === 'Altitude' && (await violet('.an-map-overlay')).count >= 1);
await shoot('zoom-general-plein-ecran');
await evaluate(`document.querySelector('.an-map-overlay__close')?.click()`);
await settle({ max: 800 });
await clickZoomButton('Général', 0, 'Tout voir');
await wait(600);
// Tout replié sauf « graphiques », en haut de page : la carte est à l'écran, elle se cadre sur place.
await clickTab('général', true);
await evaluate(`window.scrollTo(0, 0)`);
await settle({ max: 800 });
const onScreen = await mapOnScreen();
const buttonsVisible = await evaluate(`(() => { const b = document.querySelector('.zoom-chart__map'); if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()`);
console.log(`  carte à l'écran : ${onScreen}, bouton à l'écran : ${buttonsVisible}`);
await evaluate(`document.querySelector('.zoom-chart__map')?.click()`);
await settle({ max: 1500 });
check(`390 px : carte à l'écran, cadrée sur place sans plein écran (${onScreen})`, onScreen === true && (await evaluate(`Boolean(document.querySelector('.an-map-overlay'))`)) === false && (await violet()).count >= 1);
await shoot('zoom-sur-place');

// --- 6. Sans zoom, et retour d'Android (25/10) ---
const back = () => evaluate(`window.trackerBack ? window.trackerBack() : 'absent'`);
const overlayOpen = () => evaluate(`Boolean(document.querySelector('.an-map-overlay'))`);
await clickZoomButton('Graphiques', 0, 'Tout voir');
await wait(600);
await evaluate(`(() => { const c = ${CHART('Graphiques', 0)}; c?.scrollIntoView({ block: 'center' }); })()`);
await wait(600);
const scrollBefore = await evaluate(`Math.round(window.scrollY)`);
await clickZoomButton('Graphiques', 0, '+carte');
await settle({ max: 1800 });
const wholeOverlay = await evaluate(`(() => { const o = document.querySelector('.an-map-overlay'); return o ? { charts: o.querySelectorAll('.an-map-overlay__charts .zoom-chart').length, mapButtons: [...o.querySelectorAll('.an-map-overlay__charts .zoom-chart__map')].filter((b) => getComputedStyle(b).display !== 'none').length } : null; })()`);
check(`390 px : sans zoom, plein écran carte + graphes, « Afficher » sur chacun (${JSON.stringify(wholeOverlay)})`, wholeOverlay !== null && wholeOverlay.charts >= 2 && wholeOverlay.mapButtons === wholeOverlay.charts);
check('390 px : sans zoom, pas de tronçon violet', (await violet('.an-map-overlay')).count === 0);
check(`390 px : « Afficher » seul, sans zoom (${await zoomButtons(null, 0)})`, (await zoomButtons(null, 0)) === 'Afficher');
await shoot('sans-zoom-plein-ecran');
await clickZoomButton(null, 0, 'Afficher');
await settle({ max: 1200 });
const overWhole = await violet('.an-map-overlay');
check(`390 px : « Afficher » sans zoom allume toute la trace (${overWhole.count}, ${overWhole.cover})`, overWhole.count >= 1 && overWhole.cover > 0.45);
await clickZoomButton(null, 0, 'Afficher');
await settle({ max: 800 });
check('390 px : second clic, violet retiré, plein écran ouvert', (await violet('.an-map-overlay')).count === 0 && (await overlayOpen()) === true);
const backed = await back();
await settle({ max: 800 });
const scrollAfter = await evaluate(`Math.round(window.scrollY)`);
check(`390 px : le retour ferme carte + graphes (${backed})`, backed === 'layer' && (await overlayOpen()) === false);
check(`390 px : même défilement après le retour (${scrollBefore} → ${scrollAfter})`, Math.abs(scrollAfter - scrollBefore) <= 2);
check(`390 px : toujours sur l'analyse (${await evaluate('location.pathname')})`, (await evaluate('location.pathname')) === paths.course.split('?')[0]);
// Zoomé, carte hors de vue : plein écran, retour, zoom gardé.
console.log('  double toucher :', await doubleTap('Graphiques', 0, 0.25));
await clickZoomButton('Graphiques', 0, '+carte');
await settle({ max: 1800 });
check('390 px : zoomé, plein écran ouvert', (await overlayOpen()) === true);
await back();
await settle({ max: 800 });
check(`390 px : zoomé, le retour ferme et garde le zoom (${await ticks('Graphiques', 0)})`, (await overlayOpen()) === false && (await ticks('Graphiques', 0)) === '1 km | 2 km | 3 km');
// Carte seule, d'un toucher.
await evaluate(`window.scrollTo(0, 0)`);
await wait(500);
await evaluate(`document.querySelector('.an-map-row .an-map-frame')?.click()`);
await settle({ max: 1200 });
check('390 px : un toucher ouvre la carte seule', (await overlayOpen()) === true && (await evaluate(`Boolean(document.querySelector('.an-map-overlay--charts'))`)) === false);
const backedMap = await back();
await wait(600);
check(`390 px : le retour ferme la carte seule (${backedMap})`, backedMap === 'layer' && (await overlayOpen()) === false);

console.log('\n--- console (erreurs, avertissements) ---');
for (const l of logs) console.log(l);
await finish('\nTout passe.', { ko: (n) => `\n${n} échec(s).` });
