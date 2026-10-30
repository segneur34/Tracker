// Banc de test : vue satellite (lot 4 des demandes du 20/10).
// Usage : node satellite.mjs <port> [<dossier des captures>]
// Sur un profil neuf, avec réseau vers server.arcgisonline.com (IGN, Overpass, BRouter et OSM bloqués). Dure environ 1 min 30.
// Le script :
//  1. importe une voile, une course, une sortie à vélo et une session de surf ;
//  2. dans chaque analyse, à 1400×1000 : un bouton « Fond de carte » sous le + et le −, mention OSM ; un toucher ouvre
//     le choix Plan · Satellite sans rien changer, un toucher ailleurs ou Échap le ferme ; « Satellite » passe à la photo
//     (mention Esri) et ferme le choix ; le texte de la page ne change pas hors mention ; le fond est rangé pour la
//     famille seule (`tracker.fondCarte`) et retrouvé après rechargement ; la voile en satellite laisse la course en plan ;
//  3. bibliothèque (vignettes) : pas de bouton, mention OSM ; planification : le fond de la famille de son activité
//     (la Voile, en satellite), son bouton qui ne pose pas de point, deux points posés sur la photo ;
//  4. image de partage de la voile : capture de l'aperçu (photo et mention Esri, à l'œil) ;
//  5. hors ligne : les tuiles satellite vues sont gardées (`sat_…`) et réaffichées après rechargement sans Esri ;
//  6. à 390×844 : bouton présent, rien ne déborde, choix ouvert compris ; ni le bouton ni le choix n'ouvrent la carte
//     en plein écran ; la vue agrandie suit le même fond, avec son bouton.
import { connect } from './lib/cdp.mjs';

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
const pageText = () => evaluate(`document.body.innerText.replace(/(Imagerie © Esri, Vantor, Earthstar Geographics|© OpenStreetMap)/g, '<mention>')`);
const storedBases = () => evaluate(`JSON.parse(localStorage.getItem('tracker.fondCarte') ?? '{}')`);
/** Tuiles de la carte compacte affichées (image chargée). */
const loadedTiles = () => evaluate(`[...document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0).length`);
const cachedSatTiles = () => evaluate(`(async () => {
  const cache = await caches.open('tracker-tuiles');
  return (await cache.keys()).filter((r) => r.url.includes('/sat_')).length;
})()`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
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
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.page} :`, await importGpx(loopGpx(s.type, s.seconds, s.speed, s.start), `${s.page}.gpx`));
  const rec = await waitFor(async () => (await records())?.find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000), { timeout: 6000, label: `fiche ${s.page}` });
  await settle({ max: 2000, label: `import ${s.page}` });
  paths[s.page] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
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
  // La voile reste en satellite (passée la première) ; les autres familles sont revenues au plan.
  const others = Object.entries(stored).every(([f, v]) => f === s.page || f === 'voile' || v === 'plan');
  check(`${s.page} : fond rangé pour la famille seule`, stored[s.page] === 'satellite' && others, JSON.stringify(stored));
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
// La planification suit la famille de son activité : la Voile (première proposée sur un profil neuf), en satellite.
const planFamily = await evaluate(`document.querySelector('.plan-map') ? 'ok' : 'absent'`);
check('planification : un bouton, fond de la famille (voile en satellite)', planFamily === 'ok' && (await buttons()) === 1 && (await current()) === 'Satellite' && (await attribution()).includes('Esri'));
const markers = () => evaluate(`document.querySelectorAll('.plan-map .leaflet-marker-icon').length`);
const markersBefore = await markers();
await choose('Plan');
check('planification : « Plan » sans poser de point', (await current()) === 'Plan' && (await markers()) === markersBefore && (await attribution()).includes('OpenStreetMap'));
await choose('Satellite');
check('planification : retour au satellite, rangé pour la voile', (await current()) === 'Satellite' && (await storedBases()).voile === 'satellite');
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

console.log('\nconsole :', logs.length ? `\n  ${logs.slice(0, 15).join('\n  ')}` : 'rien');
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await close();
process.exit(0);
