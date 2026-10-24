// Banc de test : graphes repliables un par un et graphe d'altitude de l'onglet « zones de pente »
// (demandes du 16/10, 16:32 et 16:37).
// Usage : node graphes.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min 30. Le script :
//  1. importe une course (FC et altitude qui monte puis descend), une session de surf avec la FC et une session de
//     voile (`make-gpx.mjs`) avec la FC ;
//  2. course : onglets dans l'ordre voulu (« graphiques » à la place des zones, « cardio » derrière lui), trois
//     replis (Vitesse, Altitude, FC) ; replier l'altitude retire son graphe, sa légende et « Voir sur la carte »,
//     rapetisse le panneau, et reste replié après rechargement ;
//  3. mode superposé : la même rangée de replis ; une série repliée n'est pas tracée ; tout replié, plus de graphe ;
//  4. onglet « zones de pente » : le tableau puis le graphe d'altitude, son repli ; le survol pose le repère sur la
//     carte ; « Voir sur la carte » colore la trace par la pente (légende de pente sur la carte), qui revient à la
//     vitesse quand aucun graphe d'altitude n'est plus montré ;
//  5. surf : replis Vitesse et FC ; voile : replis des trois graphes, titre gardé, état retenu ;
//  6. à 390×844 : la course, graphes et zones ouverts, sans débordement.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node graphes.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push(JSON.parse(await (await h.getFile()).text()));
  return list;
})()`);
const importGpx = (gpx, name) => evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(gpx)}], ${JSON.stringify(name)}, { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
const tabLabels = () => evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent.trim()).join(' | ')`);
const clickTab = (label, close = false) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  const isOpen = t.getAttribute('aria-pressed') === 'true';
  if (isOpen !== ${close}) return isOpen ? 'déjà ouvert' : 'déjà fermé';
  t.click(); return 'ok';
})()`);
/** Le panneau dont le titre commence ainsi. */
const SCOPE = (title) => `([...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *') ?? null)`;
const chartsIn = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? s.querySelectorAll('.recharts-surface').length : -1; })()`);
const areasIn = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? s.querySelectorAll('.recharts-area').length : -1; })()`);
const linesIn = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? s.querySelectorAll('.recharts-line').length : -1; })()`);
/** Texte du panneau tel qu'écrit : `innerText` rendrait les capitales de la refonte (boutons, noms des graphes). */
const textIn = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? s.textContent : ''; })()`);
const heightOf = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? Math.round(s.getBoundingClientRect().height) : -1; })()`);
/** Boutons de repli du panneau : nom et état. */
const folds = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? [...s.querySelectorAll('[data-chart-fold]')].map((b) => b.textContent.trim() + (b.getAttribute('aria-expanded') === 'true' ? '+' : '-')).join(' ') : '(absent)'; })()`);
const fold = (title, label) => evaluate(`(() => {
  const s = ${SCOPE(title)};
  const b = s ? [...s.querySelectorAll('[data-chart-fold]')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}) : null;
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const clickButton = (title, label) => evaluate(`(() => {
  const s = ${SCOPE(title)};
  const b = s ? [...s.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}) : null;
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
/** Légende de pente posée sur la carte (« … % pente »). */
const gradeLegendOnMap = () => evaluate(`[...document.querySelectorAll('.an-map-row .speed-legend')].some((l) => l.textContent.includes('% pente'))`);
const hoverMarkers = () => evaluate(`document.querySelectorAll('.an-map-row path[stroke="#1b1f24"]').length`);
const hoverChart = (title, nth) => evaluate(`(async () => {
  const s = ${SCOPE(title)};
  const el = s ? s.querySelectorAll('.recharts-wrapper')[${nth}] : null;
  if (!el) return 'absent';
  el.scrollIntoView({ block: 'center' });
  await new Promise((r) => requestAnimationFrame(() => r()));
  const r = el.getBoundingClientRect();
  for (let k = 0; k < 5; k++) {
    el.querySelector('.recharts-surface').dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 80 + k * 20, clientY: r.top + r.height / 2, bubbles: true }));
    await new Promise((res) => requestAnimationFrame(() => res()));
  }
  return 'ok';
})()`);
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions synthétiques ---
/** Course en ligne droite, altitude qui monte de 0 à 40 % du temps à 8 %, puis redescend. */
const runGpx = (seconds, speed, t0, hrAt) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  let m = 0;
  let ele = 50;
  for (let k = 0; k <= seconds; k++) {
    if (k > 0) { m += speed; ele += (k < seconds * 0.4 ? 0.08 : -0.05) * speed; }
    const hr = hrAt ? `<gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(k))}</gpxtpx:hr></gpxtpx:TrackPointExtension>` : '';
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed>${hr}</extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Côte</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
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
  [60, 0], [60, 1.2], [50, 1], [4, 0.1], [40, 1], [4, 0.1], [26, 1], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1],
];
const withHr = (gpx, hrAt) => {
  let k = 0;
  return gpx
    .replace('xmlns="http://www.topografix.com/GPX/1/1"', 'xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"')
    .replace(/<\/extensions><\/trkpt>/g, () => `<gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(k++))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
};
const voilePath = join(tmpdir(), 'graphes-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);

const T_RUN = Date.UTC(2026, 9, 1, 8, 0, 0);
const T_SURF = Date.UTC(2026, 9, 3, 7, 0, 0);
const T_VOILE = Date.UTC(2026, 8, 20, 13, 0, 0);
const SESSIONS = [
  { key: 'course', page: 'course', start: T_RUN, gpx: runGpx(1800, 3, T_RUN, (k) => 130 + k / 60) },
  { key: 'surf', page: 'surf', start: T_SURF, gpx: surfGpx(T_SURF, MORNING, (k) => 110 + 20 * Math.sin(k / 120)) },
  { key: 'voile', page: 'voile', start: T_VOILE, gpx: withHr(readFileSync(voilePath, 'utf8'), (k) => 120 + 25 * Math.sin(k / 300)) },
];

// --- 1. Import ---
const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `${s.key}.gpx`));
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.key] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.key} rangée`, Boolean(rec));
}

// --- 2. Course : ordre, replis en mode séparé ---
await go(paths.course, 6000);
const labels = await tabLabels();
check(`course : ordre des onglets (${labels})`, labels.startsWith('général | avancé | graphiques | cardio | surface | énergie | zones de pente'));
console.log('  graphiques :', await clickTab('graphiques'));
await wait(1500);
check(`course : trois replis ouverts (${await folds('Graphiques')})`, (await folds('Graphiques')) === 'Vitesse+ Altitude+ FC+');
check(`course : trois graphes (${await chartsIn('Graphiques')})`, (await chartsIn('Graphiques')) === 3);
check('course : « Voir sur la carte » sous l\'altitude', (await textIn('Graphiques')).includes('Voir sur la carte'));
const tall = await heightOf('Graphiques');
console.log('  replier Altitude :', await fold('Graphiques', 'Altitude'));
await wait(1000);
check(`course : altitude repliée, deux graphes (${await chartsIn('Graphiques')})`, (await chartsIn('Graphiques')) === 2);
check('course : légende de pente et « Voir sur la carte » repliées avec elle', !(await textIn('Graphiques')).includes('Voir sur la carte'));
const short = await heightOf('Graphiques');
check(`course : le panneau rapetisse (${tall} → ${short} px)`, short < tall - 100);
await shoot('graphes-course-replie');
await go(paths.course, 6000);
check(`course : repli retenu après rechargement (${await folds('Graphiques')})`, (await folds('Graphiques')) === 'Vitesse+ Altitude- FC+');

// --- 3. Mode superposé ---
console.log('  Superposés :', await clickButton('Graphiques', 'Superposés'));
await wait(1200);
check(`superposé : un graphe, rangée de replis (${await chartsIn('Graphiques')}, ${await folds('Graphiques')})`, (await chartsIn('Graphiques')) === 1 && (await folds('Graphiques')) === 'Vitesse+ Altitude- FC+');
check(`superposé : altitude repliée, pas d'aire (${await areasIn('Graphiques')}), deux courbes (${await linesIn('Graphiques')})`, (await areasIn('Graphiques')) === 0 && (await linesIn('Graphiques')) === 2);
await fold('Graphiques', 'Altitude');
await wait(800);
check(`superposé : altitude rendue (${await areasIn('Graphiques')} aire)`, (await areasIn('Graphiques')) === 1);
await fold('Graphiques', 'FC');
await wait(800);
check(`superposé : FC repliée, une courbe (${await linesIn('Graphiques')})`, (await linesIn('Graphiques')) === 1);
await fold('Graphiques', 'Vitesse');
await fold('Graphiques', 'Altitude');
await wait(800);
check(`superposé : tout replié, plus de graphe (${await chartsIn('Graphiques')})`, (await chartsIn('Graphiques')) === 0);
await fold('Graphiques', 'Vitesse');
await fold('Graphiques', 'Altitude');
await fold('Graphiques', 'FC');
console.log('  Séparés :', await clickButton('Graphiques', 'Séparés'));
await wait(800);
check(`séparé : tout rouvert (${await folds('Graphiques')}, ${await chartsIn('Graphiques')} graphes)`, (await folds('Graphiques')) === 'Vitesse+ Altitude+ FC+' && (await chartsIn('Graphiques')) === 3);

// --- 4. Zones de pente ---
console.log('  graphiques fermé :', await clickTab('graphiques', true));
console.log('  zones de pente :', await clickTab('zones de pente'));
await wait(1500);
const zonesText = await textIn('Allure par zone de pente');
check('zones : le tableau puis le graphe d\'altitude', zonesText.indexOf('Montée raide') >= 0 && zonesText.indexOf('Montée raide') < zonesText.indexOf('Voir sur la carte'));
check(`zones : un graphe, son repli (${await chartsIn('Allure par zone de pente')}, ${await folds('Allure par zone de pente')})`, (await chartsIn('Allure par zone de pente')) === 1 && (await folds('Allure par zone de pente')) === 'Tableau+ Altitude+');
check(`zones : pas de repère avant le survol (${await hoverMarkers()})`, (await hoverMarkers()) === 0);
console.log('  survol :', await hoverChart('Allure par zone de pente', 0));
await wait(500);
check(`zones : le survol pose le repère sur la carte (${await hoverMarkers()})`, (await hoverMarkers()) === 1);
check('zones : la carte a la légende de vitesse', !(await gradeLegendOnMap()));
console.log('  Voir sur la carte :', await clickButton('Allure par zone de pente', 'Voir sur la carte'));
await wait(1000);
check('zones : « Voir sur la carte » colore la trace par la pente', await gradeLegendOnMap());
await shoot('graphes-zones-pente');
await fold('Allure par zone de pente', 'Tableau');
await wait(500);
check('zones : tableau replié, graphe gardé', !(await textIn('Allure par zone de pente')).includes('Montée raide') && (await chartsIn('Allure par zone de pente')) === 1);
await fold('Allure par zone de pente', 'Tableau');
await wait(500);
check('zones : tableau rendu', (await textIn('Allure par zone de pente')).includes('Montée raide'));
await fold('Allure par zone de pente', 'Altitude');
await wait(800);
check(`zones : graphe replié (${await chartsIn('Allure par zone de pente')}), la carte revient à la vitesse`, (await chartsIn('Allure par zone de pente')) === 0 && !(await gradeLegendOnMap()));
await fold('Allure par zone de pente', 'Altitude');
await wait(800);
check('zones : déplié, la pente revient sur la carte (bouton resté enfoncé)', await gradeLegendOnMap());
console.log('  zones fermé :', await clickTab('zones de pente', true));
await wait(800);
check('zones fermé : la carte revient à la vitesse', !(await gradeLegendOnMap()));
console.log('  graphiques :', await clickTab('graphiques'));
await wait(1200);
check('graphiques ouvert : la pente revient (même bouton, « Masquer de la carte »)', (await gradeLegendOnMap()) && (await textIn('Graphiques')).includes('Masquer de la carte'));
await clickButton('Graphiques', 'Masquer de la carte');
await wait(500);

// --- 5. Surf et voile ---
await go(paths.surf, 6000);
await clickTab('graphiques');
await wait(1500);
check(`surf : replis Vitesse et FC (${await folds('Vitesse')})`, (await folds('Vitesse')) === 'Vitesse+ FC+');
await fold('Vitesse', 'FC');
await wait(800);
check(`surf : FC repliée, un graphe (${await chartsIn('Vitesse')})`, (await chartsIn('Vitesse')) === 1);
await go(paths.surf, 6000);
check(`surf : repli retenu (${await folds('Vitesse')})`, (await folds('Vitesse')) === 'Vitesse+ FC-');
await fold('Vitesse', 'Vitesse');
await wait(800);
check(`surf : tout replié, plus de graphe (${await chartsIn('Vitesse')})`, (await chartsIn('Vitesse')) === 0);
await fold('Vitesse', 'Vitesse');
await fold('Vitesse', 'FC');

await go(paths.voile, 8000);
await clickTab('graphiques');
await wait(2000);
check(`voile : trois replis (${await folds('Graphiques')})`, (await folds('Graphiques')) === 'Historique de Vitesse+ Fréquence cardiaque+ Polaire de Vitesse (TWA)+');
const voileCharts = await chartsIn('Graphiques');
await fold('Graphiques', 'Historique de Vitesse');
await wait(800);
check(`voile : vitesse repliée, un graphe de moins (${voileCharts} → ${await chartsIn('Graphiques')}), titre gardé`,
  (await chartsIn('Graphiques')) === voileCharts - 1 && (await textIn('Graphiques')).includes('Historique de Vitesse'));
await go(paths.voile, 8000);
check(`voile : repli retenu (${await folds('Graphiques')})`, (await folds('Graphiques')) === 'Historique de Vitesse- Fréquence cardiaque+ Polaire de Vitesse (TWA)+');
await fold('Graphiques', 'Historique de Vitesse');
await wait(800);
check(`voile : rouvert (${await chartsIn('Graphiques')})`, (await chartsIn('Graphiques')) === voileCharts);

// --- 6. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.course, 6000);
await clickTab('zones de pente');
await wait(1500);
check(`390 px : course, graphes et zones ouverts, sans débordement (${await overflow()} px)`, (await overflow()) <= 0);
check(`390 px : graphes et zone montrés (${await chartsIn('Graphiques')}, ${await chartsIn('Allure par zone de pente')})`,
  (await chartsIn('Graphiques')) === 3 && (await chartsIn('Allure par zone de pente')) === 1);
await shoot('graphes-390');
await go(paths.voile, 8000);
check(`390 px : voile sans débordement (${await overflow()} px)`, (await overflow()) <= 0);

console.log('\n--- console (erreurs, avertissements) ---');
for (const l of logs) console.log(l);
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Browser.close').catch(() => {});
process.exit(failures === 0 ? 0 : 1);
