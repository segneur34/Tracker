// Banc de test : roulement selon le revêtement, à vélo (§10, point 88).
// Usage : node roulement.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, avec réseau (brouter.de, overpass-api.de, data.geopf.fr). Le script :
//  1. demande à BRouter un tracé mêlant routes et chemins au nord de Montpellier, et en tire une sortie
//     synthétique à 6 m/s (1 Hz), rangée comme vélo ; l'activité Route y prend un vélo gravel ;
//  2. ouvre l'analyse sans toucher à l'onglet « surface » : une requête à Overpass part quand même ;
//  3. ouvre l'onglet « énergie » : roulement moyen pendant la recherche, puis roulement selon le
//     revêtement, puissance moyenne changée, voies rangées dans la fiche ;
//  4. recharge : mêmes chiffres, aucune nouvelle requête ; nom de l'onglet « vitesse et altitude ».
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node roulement.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Tracé ---
const A = [3.8, 43.768];
const B = [3.822, 43.781];
const brouter = await (await fetch(`https://brouter.de/brouter?lonlats=${A.join(',')}|${B.join(',')}&profile=trekking&alternativeidx=0&format=geojson`)).json();
const path = brouter.features[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2));
const SPEED = 6;
const t0 = Date.UTC(2026, 9, 7, 9, 0, 0);
const fixes = [path[0]];
for (let k = 1; k < path.length; k++) {
  const d = dist(path[k - 1], path[k]);
  const steps = Math.max(1, Math.round(d / SPEED));
  for (let j = 1; j <= steps; j++) fixes.push([path[k - 1][0] + ((path[k][0] - path[k - 1][0]) * j) / steps, path[k - 1][1] + ((path[k][1] - path[k - 1][1]) * j) / steps]);
}
const ridePath = `${workDir}\\sortie-roulement.gpx`;
writeFileSync(ridePath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sortie roulement</name><type>cycling</type><trkseg>\n${
  fixes.map(([lat, lon], k) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
console.log(`sortie synthétique : ${fixes.length} points à ${SPEED} m/s`);

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const requests = { overpass: 0 };
/** Réponses d'Overpass : code HTTP, ou motif d'échec du réseau. */
const overpassIds = new Set();
const overpassAnswers = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.method !== 'OPTIONS' && msg.params.request.url.startsWith('https://overpass-api.de/')) {
    requests.overpass += 1;
    overpassIds.add(msg.params.requestId);
  }
  if (msg.method === 'Network.responseReceived' && overpassIds.has(msg.params.requestId)) overpassAnswers.push(String(msg.params.response.status));
  if (msg.method === 'Network.loadingFailed' && overpassIds.has(msg.params.requestId)) overpassAnswers.push(`échec : ${msg.params.errorText}`);
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickButton = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const readOpfs = (file) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  const parts = ${JSON.stringify(file)}.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
})()`);
const listOpfs = (dirPath) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(dirPath)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);
/** Chiffre du panneau Énergie, par son libellé. */
const energyStat = (label) => evaluate(`[...document.querySelectorAll('.an-sheet__stat')].find((s) => s.querySelector('.an-sheet__stat-label')?.textContent === ${JSON.stringify(label)})?.querySelector('.an-sheet__stat-value')?.textContent ?? '(absent)'`);
const energyWarning = () => evaluate(`[...document.querySelectorAll('.ui-alert--warning')].map((a) => a.textContent).filter((t) => /Revêtement|Poids/.test(t)).join(' | ') || '(aucun)'`);
const energyNote = () => evaluate(`[...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /^Pesanteur, roulement et air/.test(t)) ?? '(absente)'`);
const rollingPart = (note) => note.match(/(Roulement selon le revêtement|Revêtement inconnu)[^]*?(?= Énergie de pédalage)/)?.[0] ?? note;

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. L'activité Route prend un vélo gravel ; la sortie est rangée.
await go('/velo', 2000);
await evaluate(`localStorage.setItem('tracker.sportSettings', JSON.stringify({ bikeTypes: { cycling: 'gravel' } })); 'ok'`);
await go('/velo');
await setFile('input[type=file][accept=".gpx"][multiple]', ridePath);
await wait(4000);
const gpxName = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx'));
console.log('rangée :', gpxName);

// 2. Analyse ouverte, onglet surface fermé : la recherche part quand même.
await go(`/velo/analyse?session=${encodeURIComponent(gpxName)}`, 4000);
console.log('onglets :', await evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(général|tops|zones de pente|surface|énergie|vitesse et altitude|graphiques|réglages)$/.test(t)).join(' | ')`));
console.log('requêtes Overpass à l\'ouverture :', requests.overpass);

// 3. Onglet énergie : roulement moyen en attendant, puis selon le revêtement.
await clickButton('énergie');
await wait(800);
const searchingPower = await energyStat('Puissance moyenne en mouvement');
console.log('pendant la recherche :', searchingPower, '|', await energyWarning());
console.log('  note :', rollingPart(await energyNote()));
const searchStart = Date.now();
for (let k = 0; k < 180 && !/selon le revêtement/.test(await energyNote()) && !/introuvable/.test(await energyWarning()); k++) await wait(1000);
const knownPower = await energyStat('Puissance moyenne en mouvement');
console.log(`revêtement connu (${Math.round((Date.now() - searchStart) / 1000)} s) :`, knownPower, '|', await energyWarning());
console.log('  note :', rollingPart(await energyNote()));
console.log('  énergie de pédalage :', await energyStat('Énergie de pédalage'));
await shoot('roulement-energie');
await wait(1500);
const record = JSON.parse(await readOpfs(`sessions/${gpxName.replace(/\.gpx$/, '.json')}`));
console.log('fiche :', record.surfaces ? `${record.surfaces.runs.length} morceaux, ${record.surfaces.tags.length} étiquettes` : 'sans voies');

// 4. Rechargée : mêmes chiffres, aucune nouvelle requête (une seule si la première recherche a échoué).
for (let k = 1; k <= 2; k++) {
  const before = requests.overpass;
  await go(`/velo/analyse?session=${encodeURIComponent(gpxName)}`, 5000);
  for (let j = 0; j < 180 && !/selon le revêtement/.test(await energyNote()) && !/introuvable/.test(await energyWarning()); j++) await wait(1000);
  console.log(`rechargée (${k}) :`, await energyStat('Puissance moyenne en mouvement'), '| nouvelles requêtes Overpass', requests.overpass - before);
  console.log('  note :', rollingPart(await energyNote()));
}

console.log('réponses d\'Overpass :', overpassAnswers.join(', ') || '(aucune)');
console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
ws.close();
