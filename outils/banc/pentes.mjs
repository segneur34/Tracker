// Banc de test : pentes sur la carte et onglet énergie (§10, point 85).
// Usage : node pentes.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, avec réseau (data.geopf.fr pour l'altitude, brouter.de pour l'itinéraire). Le script :
//  1. importe une course synthétique au nord de Montpellier et l'ouvre, onglets graphiques et énergie ouverts ;
//  2. « Voir sur la carte » sous le graphe d'altitude : trace en couleurs de pente, légende de pente sur la carte ;
//     « Masquer de la carte » : retour à la vitesse ;
//  3. énergie : colonne Puissance du tableau des zones, repli « Énergie par zone de pente » gardé après rechargement ;
//  4. surface (Overpass, si elle répond en 3 min) : son « Voir sur la carte » éteint la pente, et inversement ;
//  5. planification : deux points en Course, « Voir sur la carte » du bloc Général colore le tracé ;
//  6. captures à 1400×1000 et à 390×844.
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node pentes.mjs <port> <dossier de travail> [<dossier des captures>]');
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
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
/** Clique le premier bouton de `scope` dont le texte vaut `text`. */
const clickButton = (text, scope = 'body') => evaluate(`(() => {
  const root = document.querySelector(${JSON.stringify(scope)});
  const b = root && [...root.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(300); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const listOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);
/** Traits de la carte (`frame` : son cadre) : nombre, couleurs distinctes, et légende posée dessus. */
const mapInfo = (frame) => evaluate(`(() => {
  const paths = [...document.querySelectorAll(${JSON.stringify(`${frame} .leaflet-overlay-pane path`)})].filter((p) => p.getAttribute('stroke-opacity') !== '0');
  const colors = new Set(paths.map((p) => p.getAttribute('stroke')));
  const legend = document.querySelector(${JSON.stringify(`${frame} .an-map-legend`)})?.textContent.trim() ?? '(aucune)';
  return JSON.stringify({ traits: paths.length, couleurs: colors.size, legende: legend });
})()`);
const buttonTexts = (scope) => evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].map((b) => b.textContent.trim()).filter((t) => /carte/.test(t)).join(' | ')`);
const energyTable = () => evaluate(`(() => {
  const t = [...document.querySelectorAll('table')].find((x) => [...x.querySelectorAll('th')].some((th) => th.textContent === 'Énergie'));
  if (!t) return '(replié)';
  return [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()).join(' ; ')).join('\\n    ');
})()`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Course synthétique vers le nord, de Grabels vers Saint-Gély-du-Fesc : l'IGN en donne le relief.
const t0 = Date.UTC(2026, 9, 7, 8, 0, 0);
const fixes = [];
for (let k = 0; k <= 1200; k++) fixes.push([43.655 + (3 * k) / 111_195, 3.8, 150]);
const runPath = `${workDir}\\course-pentes.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course pentes</name><type>running</type><trkseg>\n${
  fixes.map(([lat, lon, ele], k) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
await go('/course');
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ running: { general: true, tops: true, zones: true, surface: false, energie: true, graphiques: true, reglages: false } })); 'ok'`);
await setFile('input[type=file][accept=".gpx"][multiple]', runPath);
await wait(4000);
const gpxName = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx'));
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 1500);
for (let k = 0; k < 60; k++) {
  if (await evaluate(`/Source : IGN|hors de la couverture|Réessayer/.test(document.body.innerText)`)) break;
  await wait(500);
}
console.log('analyse ouverte :', gpxName);
console.log('carte, vitesse     :', await mapInfo('.an-map-frame'));

// 2. Pente sur la carte.
console.log('Voir (pente)       :', await clickButton('Voir sur la carte'));
await wait(800);
console.log('carte, pente       :', await mapInfo('.an-map-frame'), '| boutons', await buttonTexts('.an-page'));
await shoot('pentes-analyse');
console.log('Masquer (pente)    :', await clickButton('Masquer de la carte'));
await wait(800);
console.log('carte, vitesse     :', await mapInfo('.an-map-frame'));

// 3. Énergie : tableau, repli gardé.
console.log('tableau énergie    :\n    ' + await energyTable());
console.log('Zones (replier)    :', await clickButton('Énergie par zone de pente'));
await wait(300);
console.log('après repli        :', await energyTable());
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 4000);
console.log('après rechargement :', await energyTable());
console.log('Zones (déplier)    :', await clickButton('Énergie par zone de pente'));
await wait(300);
console.log('déplié             :', (await energyTable()).split('\n')[0]);

// 4. Surface et pente exclusives (Overpass, si elle répond).
console.log('Voir (pente)       :', await clickButton('Voir sur la carte'));
console.log('onglet surface     :', await evaluate(`(() => { const t = [...document.querySelectorAll('.ui-tab')].find((x) => x.textContent === 'surface'); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true') t.click(); return 'ok'; })()`));
let surfaceReady = false;
for (let k = 0; k < 180 && !surfaceReady; k++) {
  surfaceReady = await evaluate(`!!document.querySelector('.surface-bar')`);
  if (!surfaceReady) await wait(1000);
}
if (surfaceReady) {
  console.log('Voir (surface)     :', await evaluate(`(() => { const b = document.querySelector('.surface-bar button'); b.click(); return b.textContent; })()`));
  await wait(800);
  console.log('après surface      :', await mapInfo('.an-map-frame'), '| boutons', await buttonTexts('.an-page'));
  console.log('Voir (pente)       :', await clickButton('Voir sur la carte', '.an-page'));
  await wait(800);
  console.log('pente de nouveau   :', await mapInfo('.an-map-frame'), '| boutons', await buttonTexts('.an-page'));
} else {
  console.log('surface            : Overpass sans réponse en 3 min, exclusion non vérifiée');
}

// Téléphone : la même analyse, pente sur la carte.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 4000);
console.log('téléphone, Voir    :', await clickButton('Voir sur la carte'));
await wait(800);
console.log('téléphone, carte   :', await mapInfo('.an-map-frame'));
await shoot('pentes-telephone');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 5. Planification : deux points en Course sur le même relief.
await go('/itineraires');
await evaluate(`localStorage.setItem('tracker.planning', JSON.stringify({ activityId: 'running', view: { lat: 43.67, lon: 3.80, zoom: 14 } }));
  localStorage.setItem('tracker.sections', JSON.stringify({ planning: { profil: true, surface: false, trace: false, points: false, ranger: false, liste: false } })); 'ok'`);
await go('/itineraires');
const rect = await evaluate(`(() => { const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
await clickAt(rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.8);
await clickAt(rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.2);
for (let k = 0; k < 40; k++) {
  if (!(await evaluate(`document.body.innerText.includes('Calcul du tracé')`))) break;
  await wait(500);
}
console.log('itinéraire         :', await evaluate(`[...document.querySelectorAll('.plan-stat')].map((x) => x.innerText.replace(/\\n/g, ' ')).join(' | ')`));
console.log('carte, bleu        :', await mapInfo('.plan-map'));
console.log('Voir (pente)       :', await clickButton('Voir sur la carte', '.plan-legend'));
await wait(800);
console.log('carte, pente       :', await mapInfo('.plan-map'));
await shoot('pentes-planification');
console.log('Masquer (pente)    :', await clickButton('Masquer de la carte', '.plan-legend'));
await wait(500);
console.log('carte, bleu        :', await mapInfo('.plan-map'));

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
ws.close();
