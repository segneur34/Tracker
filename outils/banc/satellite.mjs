// Banc de test : vue satellite (lot 4 des demandes du 20/10).
// Usage : node satellite.mjs <port> [<dossier des captures>]
// Sur un profil neuf, avec réseau vers server.arcgisonline.com (IGN, Overpass, BRouter et OSM bloqués). Dure environ 1 min 30.
// Le script :
//  1. importe une voile, une course, une sortie à vélo et une session de surf ;
//  2. dans chaque analyse, à 1400×1000 : un bouton « Fond de carte » sous le + et le −, mention OSM ; un toucher ouvre
//     le choix Plan · Satellite sans rien changer, un toucher ailleurs ou Échap le ferme ; « Satellite » passe à la photo
//     (mention Esri) et ferme le choix ; le texte de la page ne change pas hors mention ; le fond est rangé dans la
//     fiche de la session (lot 193), pas pour la famille (`tracker.fondCarte`), et retrouvé après rechargement ; la
//     voile en satellite laisse la course en plan ;
//  3. bibliothèque (vignettes) : pas de bouton, mention OSM ; planification : le fond de la famille de son activité
//     (la Voile, en satellite), son bouton qui ne pose pas de point, deux points posés sur la photo ;
//  4. image de partage de la voile : capture de l'aperçu (photo et mention Esri, à l'œil) ;
//  5. hors ligne : les tuiles satellite vues sont gardées (`sat_…`) et réaffichées après rechargement sans Esri ;
//  6. à 390×844 : bouton présent, rien ne déborde, choix ouvert compris ; ni le bouton ni le choix n'ouvrent la carte
//     en plein écran ; la vue agrandie suit le même fond, avec son bouton ;
//  7. mentions sur téléphone (lot 195), à 390×844 puis 320×640 : satellite sur une seule ligne de 12 px, « Powered by Esri »
//     en tête, un toucher déplie (classe is-open, hauteur qui grandit, aria-expanded) et un second replie ; plan : « © OpenStreetMap »
//     entier et sur une ligne ; à 1400 px, rien de replié ni d'aria sur la mention.
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node satellite.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
let failures = 0;
const check = (what, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures++; };

/** Boutons du fond et mentions des cartes de la page (carte compacte d'abord). */
/** Boutons du fond de la page (ou de `scope`). */
const buttons = (scope = '') => evaluate(`document.querySelectorAll('${scope} .map-base-switch__button').length`);
const menuOpen = (scope = '') => evaluate(`document.querySelector('${scope} .map-base-switch__menu') !== null`);
/** Ouvre le choix du premier bouton (de `scope`) et rend ses lignes. */
const openMenu = async (scope = '') => {
  if (!(await menuOpen(scope))) await evaluate(`document.querySelector('${scope} .map-base-switch__button').click()`);
  await wait(300);
  return evaluate(`[...document.querySelectorAll('${scope} .map-base-switch__choice')].map((b) => ({ label: b.textContent.trim(), checked: b.getAttribute('aria-checked') === 'true' }))`);
};
const closeMenu = async () => {
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(300);
};
/** Fond coché dans le choix (ouvert puis refermé). */
const current = async (scope = '') => {
  const lines = await openMenu(scope);
  await closeMenu();
  return lines.find((l) => l.checked)?.label ?? null;
};
const choose = async (label, scope = '', ms = 1000) => {
  await openMenu(scope);
  await evaluate(`[...document.querySelectorAll('${scope} .map-base-switch__choice')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  await wait(ms);
};
const attribution = () => evaluate(`document.querySelector('.leaflet-control-attribution')?.textContent ?? ''`);
const pageText = () => evaluate(`document.body.innerText.replace(/(Powered by Esri · Imagerie © Esri, Vantor, Earthstar Geographics, GIS User Community|Powered by Esri · Imagerie © Esri, Vantor, Earthstar Geographics|© OpenStreetMap)/g, '<mention>')`);
const storedBases = () => evaluate(`JSON.parse(localStorage.getItem('tracker.fondCarte') ?? '{}')`);
/** Tuiles de la carte compacte affichées (image chargée). */
const loadedTiles = () => evaluate(`[...document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0).length`);
const cachedSatTiles = () => evaluate(`(async () => {
  const cache = await caches.open('tracker-tuiles');
  return (await cache.keys()).filter((r) => r.url.includes('/sat_')).length;
})()`);

// Rangée « avancé » des analyses ouverte d'office, onglets posés dans `tracker.sections` rejoués à chaque analyse (`lib/onglets.mjs`, 05/11) ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
const BLOCKED = ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'];
await blockNetwork(BLOCKED);

// --- 1. Sessions synthétiques : un aller-retour le long de la côte, à Palavas ---
const loopGpx = (type, seconds, speed, t0) => {
  const lat0 = 43.515;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat0 * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= seconds; k++) {
    const half = seconds / 2;
    const m = (k <= half ? k : seconds - k) * speed;
    const lat = lat0 - (k <= half ? 0 : 0.002);
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${(3.9 + m / mPerDegLon).toFixed(7)}"><ele>2</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Boucle</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const SESSIONS = [
  { page: 'voile', start: Date.UTC(2026, 9, 5, 13), type: 'wingfoil', seconds: 900, speed: 7 },
  { page: 'course', start: Date.UTC(2026, 9, 6, 8), type: 'running', seconds: 1200, speed: 3 },
  { page: 'velo', start: Date.UTC(2026, 9, 7, 8), type: 'cycling', seconds: 900, speed: 7 },
  { page: 'surf', start: Date.UTC(2026, 9, 8, 8), type: 'surf', seconds: 600, speed: 2 },
];
const paths = {};
const gpxs = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.page} :`, await importGpx(loopGpx(s.type, s.seconds, s.speed, s.start), `${s.page}.gpx`));
  const rec = await waitFor(async () => (await records())?.find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000), { timeout: 6000, label: `fiche ${s.page}` });
  await settle({ max: 2000, label: `import ${s.page}` });
  paths[s.page] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  gpxs[s.page] = rec?.gpx;
  check(`${s.page} rangée`, Boolean(rec));
}

// --- 2. Chaque analyse ---
for (const s of SESSIONS) {
  await go(paths[s.page], 6000);
  check(`${s.page} : un bouton « Fond de carte », choix fermé`, (await buttons()) === 1 && !(await menuOpen()));
  check(`${s.page} : mention OSM`, (await attribution()).includes('OpenStreetMap'), await attribution());
  const corner = await evaluate(`document.querySelector('.map-base-switch')?.closest('.leaflet-top.leaflet-left')?.querySelector('.leaflet-control-zoom') ? 'sous le zoom' : 'ailleurs'`);
  check(`${s.page} : bouton dans le coin du + et du −`, corner === 'sous le zoom', corner);
  const textPlan = await pageText();
  const lines = await openMenu();
  check(`${s.page} : un toucher ouvre Plan · Satellite, Plan coché, rien changé`,
    JSON.stringify(lines) === JSON.stringify([{ label: 'Plan', checked: true }, { label: 'Satellite', checked: false }])
    && (await attribution()).includes('OpenStreetMap'), JSON.stringify(lines));
  if (s.page === 'voile') {
    // Un toucher ailleurs ferme le choix sans rien changer ; Échap aussi.
    await evaluate(`document.querySelector('.leaflet-container').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await wait(300);
    check('voile : un toucher ailleurs ferme le choix', !(await menuOpen()) && (await attribution()).includes('OpenStreetMap'));
    await openMenu();
    await closeMenu();
    check('voile : Échap ferme le choix', !(await menuOpen()));
  }
  await choose('Satellite', '', 4000);
  check(`${s.page} : « Satellite » ferme le choix`, !(await menuOpen()));
  check(`${s.page} : mention Esri`, (await attribution()).includes('Esri'), await attribution());
  check(`${s.page} : texte de la page inchangé hors mention`, (await pageText()) === textPlan);
  const tiles = await loadedTiles();
  check(`${s.page} : tuiles satellite affichées`, tiles > 0, tiles);
  check(`${s.page} : Satellite coché`, (await current()) === 'Satellite');
  const stored = await storedBases();
  // Lot 193 (07/11) : le choix fait dans une analyse va dans la fiche de la session ; le fond de la famille
  // (`tracker.fondCarte`) ne bouge pas, il ne se change plus que depuis la planification ou le direct.
  const fiche = (await records())?.find((r) => r.gpx === gpxs[s.page]);
  check(`${s.page} : fond rangé dans la fiche, pas pour la famille`, fiche?.mapBase === 'satellite' && stored[s.page] !== 'satellite', JSON.stringify({ fiche: fiche?.mapBase ?? null, stored }));
  await shoot(`satellite-${s.page}`);
  await go(paths[s.page], 5000);
  check(`${s.page} : satellite retrouvé après rechargement`, (await current()) === 'Satellite' && (await attribution()).includes('Esri'));
  if (s.page !== 'voile') {
    // Retour au plan : seule la voile reste en satellite pour la suite.
    await choose('Plan');
    check(`${s.page} : retour au plan`, (await current()) === 'Plan' && (await attribution()).includes('OpenStreetMap'));
  }
  if (s.page === 'voile') {
    await go(paths.course, 5000);
    check('voile en satellite, course en plan', (await current()) === 'Plan' && (await attribution()).includes('OpenStreetMap'));
  }
}
console.log('fonds rangés :', JSON.stringify(await storedBases()));

// --- 3. Bibliothèque et planification ---
await go('/voile', 5000);
const libButtons = await buttons();
// Vignettes en image fixe depuis le lot 74 : plus de carte Leaflet, la mention OSM est posée sur l'image.
await waitFor(() => evaluate(`document.querySelectorAll('.lib-row__preview-image').length > 0`), { timeout: 5000, label: 'vignettes' }).catch(() => {});
const libMaps = await evaluate(`document.querySelectorAll('.lib-row__preview-image').length`);
const libCredit = await evaluate(`document.querySelector('.lib-row__preview-credit')?.textContent ?? ''`);
check('bibliothèque de voile : vignettes sans bouton, en plan', libMaps > 0 && libButtons === 0 && libCredit.includes('OpenStreetMap'), `${libMaps} vignettes, ${libButtons} boutons`);
await go('/itineraires', 4000);
// La planification suit la famille de son activité : la Voile (première proposée sur un profil neuf), dont le fond
// est resté en plan (les analyses ne l'écrivent plus, lot 193) ; c'est ici que le fond de la famille se change.
const planFamily = await evaluate(`document.querySelector('.plan-map') ? 'ok' : 'absent'`);
check('planification : un bouton, fond de la famille (voile en plan)', planFamily === 'ok' && (await buttons()) === 1 && (await current()) === 'Plan' && (await attribution()).includes('OpenStreetMap'));
const markers = () => evaluate(`document.querySelectorAll('.plan-map .leaflet-marker-icon').length`);
const markersBefore = await markers();
await choose('Satellite');
check('planification : « Satellite » sans poser de point', (await current()) === 'Satellite' && (await markers()) === markersBefore && (await attribution()).includes('Esri'));
check('planification : satellite rangé pour la voile', (await storedBases()).voile === 'satellite');
// Deux points posés au toucher, pour voir le tracé sur la photo.
const box = await evaluate(`(() => { const r = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
for (const [fx, fy] of [[0.3, 0.5], [0.7, 0.6]]) {
  const x = box[0] + box[2] * fx;
  const y = box[1] + box[3] * fy;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await settle({ max: 800 });
}
await wait(3000);
check('planification : deux points posés', (await markers()) >= markersBefore + 2, await markers());
await shoot('satellite-planification');

// --- 4. Image de partage de la voile ---
await go(paths.voile, 6000);
await evaluate(`document.querySelector('.an-sheet__head .ui-more__button')?.click()`);
await wait(300);
await evaluate(`[...document.querySelectorAll('.an-sheet__head .ui-more__panel button')].find((x) => x.textContent.trim() === 'Partager')?.click()`);
let shareReady = false;
for (let t = 0; t < 20000 && !shareReady; t += 250) {
  shareReady = await evaluate(`(() => { const i = document.querySelector('.share-dialog__preview img'); return Boolean(i && i.complete && i.naturalWidth > 0); })()`);
  if (!shareReady) await wait(250);
}
check('partage : aperçu dessiné', shareReady);
await shoot('satellite-partage');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

// --- 5. Hors ligne ---
const kept = await cachedSatTiles();
check('tuiles satellite gardées (sat_…)', kept > 0, kept);
await blockNetwork([...BLOCKED, '*://server.arcgisonline.com/*']);
await go(paths.voile, 6000);
const offlineTiles = await loadedTiles();
check('sans Esri : tuiles satellite réaffichées depuis la mémoire', offlineTiles > 0, offlineTiles);
await blockNetwork(BLOCKED);

// --- 6. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.voile, 6000);
check('390 : bouton présent', (await buttons()) === 1);
check('390 : rien ne déborde', (await overflow()) <= 0, await overflow());
await openMenu();
check('390 : choix ouvert, rien ne déborde', (await menuOpen()) && (await overflow()) <= 0, await overflow());
await shoot('satellite-390-choix');
const fullscreen = () => evaluate(`document.querySelector('.an-map-overlay') !== null && getComputedStyle(document.querySelector('.an-map-overlay')).display !== 'none'`);
check("390 : le bouton n'ouvre pas le plein écran", !(await fullscreen()));
await choose('Plan');
check("390 : le choix n'ouvre pas le plein écran", !(await fullscreen()));
check('390 : voile repassée au plan', (await current()) === 'Plan');
await choose('Satellite');
await evaluate(`document.querySelector('.an-map-frame .leaflet-container').click()`);
await settle({ max: 2000 });
check('390 : vue agrandie avec son bouton', (await buttons('.an-map-overlay')) === 1);
check('390 : vue agrandie en satellite', (await current('.an-map-overlay')) === 'Satellite');
await shoot('satellite-390-agrandie');

// --- 7. Mentions sur téléphone (lot 195) ---
const mention = () => evaluate(`(() => {
  const el = document.querySelector('.an-map-frame .leaflet-control-attribution') ?? document.querySelector('.leaflet-control-attribution');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { h: r.height, w: r.width, font: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight), clipped: el.scrollWidth > el.clientWidth + 1,
    open: el.classList.contains('is-open'), foldable: el.classList.contains('is-foldable'), role: el.getAttribute('role'),
    expanded: el.getAttribute('aria-expanded'), text: el.textContent, visibleText: el.innerText, mapW: el.closest('.leaflet-container').getBoundingClientRect().width, style: el.style.maxWidth };
})()`);
const tap = () => evaluate(`document.querySelector('.an-map-frame .leaflet-control-attribution, .leaflet-control-attribution').click()`);
for (const [w, h] of [[390, 844], [320, 640]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await go(paths.voile, 6000);
  const closed = await mention();
  check(`${w} : satellite, une ligne de 12 px`, closed.foldable && closed.font === 12 && closed.h <= closed.line + 2, JSON.stringify(closed));
  check(`${w} : satellite, « Powered by Esri » en tête, bouton accessible replié`, closed.text.startsWith('Powered by Esri') && closed.role === 'button' && closed.expanded === 'false' && !closed.open, closed.text);
  check(`${w} : satellite, cadre borné à 65 % de la carte`, closed.w <= closed.mapW * 0.65 + 1, `${closed.w} / ${closed.mapW}`);
  await tap();
  await wait(300);
  const opened = await mention();
  check(`${w} : un toucher déplie (is-open, hauteur qui grandit, tous les noms)`, opened.open && opened.expanded === 'true' && opened.h > closed.h && !opened.clipped && opened.visibleText.includes('GIS User Community'), JSON.stringify(opened));
  await shoot(`satellite-${w}-mention-ouverte`);
  await tap();
  await wait(300);
  const again = await mention();
  check(`${w} : un second toucher replie`, !again.open && again.expanded === 'false' && again.h <= again.line + 2, JSON.stringify(again));
  check(`${w} : le toucher sur la mention ne déplace pas la carte ni n'ouvre le plein écran`, !(await fullscreen()));
  await go(paths.course, 5000);
  const plan = await mention();
  check(`${w} : plan, « © OpenStreetMap » entier sur une ligne, sans bouton`, plan.visibleText.includes('OpenStreetMap') && !plan.clipped && plan.h <= plan.line + 2 && !plan.foldable && plan.role === null, JSON.stringify(plan));
}
// Ordinateur : rien de replié, pas d'aria sur la mention satellite.
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go(paths.voile, 6000);
const wide = await mention();
check('1400 : satellite, mention entière, rien de replié, pas d\'aria', wide.role === null && wide.expanded === null && !wide.clipped && wide.visibleText.startsWith('Powered by Esri'), JSON.stringify(wide));
await tap();
check('1400 : un clic sur la mention ne la change pas', !(await mention()).open);

console.log('\nconsole :', logs.length ? `\n  ${logs.slice(0, 15).join('\n  ')}` : 'rien');
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await close();
process.exit(0);
