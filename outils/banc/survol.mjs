// Banc de test : coût du survol des graphes et des clics « Voir » sur une longue trace (lot B de l'audit, §10, point 93).
// Usage : node survol.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf. L'IGN, Overpass et BRouter sont bloqués, pour un résultat sans réseau et toujours le même ;
// seules les tuiles OSM passent, pour les captures. Le script :
//  1. écrit une course synthétique de 3 h à 1 Hz (10 800 points) et une session de voile (celle de `make-gpx.mjs`) ;
//  2. importe la course, ouvre son analyse (onglets général et « vitesse et altitude ») ;
//     compte les traits SVG de la carte et les canevas de la trace, puis mesure 50 survols du graphe de vitesse ;
//  3. importe la voile, ouvre son analyse (tous les onglets) et mesure 10 clics « Voir (Carte) » d'un top ;
//  4. avec `DUMP=x`, relève le texte des deux pages dans `x-course.txt` et `x-voile.txt`, avant tout survol ;
//  5. avec un dossier de captures : les deux cartes à 1400×1000, puis la course à 390×844 et sa carte en plein écran.
// Comparer deux versions : le lancer sur chacune, chaque fois sur un profil neuf, et `diff` les relevés.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node survol.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';
const DUMP = process.env.DUMP;

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
/** Importe un GPX par la page, dans un `File` : le Chrome sans fenêtre peut refuser de lire le dossier de travail. */
const importGpx = (name, text) => evaluate(`(async () => {
  let input = null;
  for (let k = 0; k < 40 && !input; k++) {
    input = document.querySelector('input[type=file][accept=".gpx"][multiple]:not([disabled])');
    if (!input) await new Promise((r) => setTimeout(r, 250));
  }
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
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
/** Carte de la page : traits SVG, canevas de la trace colorée, légende. */
const mapInfo = () => evaluate(`JSON.stringify({
  traitsSvg: document.querySelectorAll('.an-map-frame .leaflet-overlay-pane path').length,
  canevasTrace: document.querySelectorAll('.an-map-frame .leaflet-trace-pane canvas').length,
  legende: document.querySelector('.an-map-frame .an-map-legend')?.textContent.trim() ?? '(aucune)',
})`);
/** Médiane et maximum d'une liste de durées, en ms. */
const timing = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return `médiane ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms (${list.length} mesures)`;
};
/** Attend l'image suivante : le rendu de React et le travail de Leaflet sont faits. */
const NEXT_FRAME = 'new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))';

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['https://data.geopf.fr/*', 'https://overpass-api.de/*', 'https://brouter.de/*', 'https://photon.komoot.io/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Traces. Course : boucles de 1 km de rayon autour de Montpellier, vitesse de 2 à 4,5 m/s, altitude ondulée.
const t0 = Date.UTC(2026, 9, 1, 7, 0, 0);
const R = 6_371_000;
const run = [];
let angle = 0;
for (let k = 0; k < 10_800; k++) {
  const speed = 3.25 + 1.25 * Math.sin(k / 300) + 0.3 * Math.sin(k / 17);
  angle += speed / 1000;
  const radius = 1000 + 150 * Math.sin(k / 900);
  const lat = 43.62 + ((radius * Math.cos(angle)) / R) * (180 / Math.PI);
  const lon = 3.86 + ((radius * Math.sin(angle)) / (R * Math.cos((43.62 * Math.PI) / 180))) * (180 / Math.PI);
  run.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(80 + 30 * Math.sin(k / 400)).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const runPath = `${workDir}\\survol-course.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course longue</name><type>running</type><trkseg>\n${run.join('\n')}\n</trkseg></trk></gpx>\n`);
const sailPath = `${workDir}\\survol-voile.gpx`;
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), sailPath]);

// 2. Course.
await go('/course');
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({
  running: { general: true, tops: false, zones: false, surface: false, energie: false, graphiques: true, reglages: false },
  'sailing-onglets': { general: true, tops: true, manoeuvres: true, graphiques: true, vmg: true, vent: true, matos: true, reglages: true },
})); 'ok'`);
console.log('import course      :', await importGpx('survol-course.gpx', readFileSync(runPath, 'utf8')));
await wait(6000);
const runName = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx'));
await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 8000);
console.log('course ouverte     :', runName, '|', await evaluate(`document.querySelector('h1')?.textContent`));
console.log('carte              :', await mapInfo());
if (DUMP) writeFileSync(`${DUMP}-course.txt`, await evaluate('document.body.innerText'));
await shoot('survol-course');

const hover = await evaluate(`(async () => {
  const el = document.querySelector('.recharts-wrapper');
  if (!el) return 'graphe absent';
  el.scrollIntoView({ block: 'center' });
  await ${NEXT_FRAME};
  const r = el.getBoundingClientRect();
  const times = [];
  for (let k = 0; k < 50; k++) {
    const x = r.left + 60 + ((r.width - 120) * k) / 49;
    const t = performance.now();
    el.querySelector('.recharts-surface').dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: r.top + r.height / 2, bubbles: true }));
    await ${NEXT_FRAME};
    times.push(performance.now() - t);
  }
  const marker = document.querySelectorAll('.an-map-frame .leaflet-overlay-pane path').length;
  return JSON.stringify({ times, marker });
})()`);
if (hover.startsWith('{')) {
  const { times, marker } = JSON.parse(hover);
  console.log('survol (50)        :', timing(times.slice(1)), '| traits SVG après survol :', marker);
} else console.log('survol             :', hover);

// 3. Voile.
const before = new Set(await listOpfs('sessions'));
await go('/voile');
console.log('import voile       :', await importGpx('survol-voile.gpx', readFileSync(sailPath, 'utf8')));
await wait(6000);
const sailName = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx') && !before.has(n));
await go(`/voile/analyse?session=${encodeURIComponent(sailName)}`, 8000);
console.log('voile ouverte      :', sailName, '|', await evaluate(`document.querySelector('h1')?.textContent`));
console.log('carte              :', await mapInfo());
if (DUMP) writeFileSync(`${DUMP}-voile.txt`, await evaluate('document.body.innerText'));

const tops = await evaluate(`(async () => {
  const times = [];
  for (let k = 0; k < 10; k++) {
    const b = [...document.querySelectorAll('button')].find((x) => /(Voir|Masquer) \\(Carte\\)/.test(x.textContent));
    if (!b) return 'bouton absent';
    const t = performance.now();
    b.click();
    await ${NEXT_FRAME};
    times.push(performance.now() - t);
  }
  return JSON.stringify(times);
})()`);
console.log('clic « Voir » (10) :', tops.startsWith('[') ? timing(JSON.parse(tops)) : tops);
await evaluate(`[...document.querySelectorAll('button')].find((x) => /Voir \\(Carte\\)/.test(x.textContent))?.click(); 'ok'`);
await wait(500);
console.log('carte, top montré  :', await mapInfo());
await evaluate(`document.querySelector('.an-map-frame').scrollIntoView({ block: 'start' }); 'ok'`);
await wait(500);
await shoot('survol-voile-top');

// 4. Téléphone : la course, puis sa carte en plein écran.
if (shotDir) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 8000);
  await shoot('survol-course-390');
  await evaluate(`document.querySelector('.an-map-frame .leaflet-container').click(); 'ok'`);
  await wait(3000);
  console.log('plein écran        :', await evaluate(`JSON.stringify({
    traitsSvg: document.querySelectorAll('.an-map-overlay .leaflet-overlay-pane path').length,
    canevasTrace: document.querySelectorAll('.an-map-overlay .leaflet-trace-pane canvas').length,
  })`));
  await shoot('survol-course-390-plein-ecran');
}

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
