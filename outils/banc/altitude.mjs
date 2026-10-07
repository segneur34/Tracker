// Banc de test : altitude de l'IGN des sessions course et vélo (§10, point 84).
// Usage : node altitude.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, avec réseau (data.geopf.fr). Le script :
//  1. écrit une course synthétique au nord de Montpellier (3 m/s, 1 Hz, 20 min), altitude GPS plate et
//     bruitée, 50 m trop haute ; l'importe : D+ de la liste au GPS ;
//  2. l'ouvre : une requête à l'IGN, altitude rangée dans la fiche, légende « Source : IGN », D+ changé ;
//     recharge : aucune nouvelle requête ;
//  3. passe la session au GPS dans ses réglages, puis revient à l'IGN : D+ et liste suivent ;
//  4. règle un point tous les 20 m dans Réglages : l'altitude est redemandée à la réouverture.
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node altitude.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
let ignRequests = 0;
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.method !== 'OPTIONS' && msg.params.request.url.startsWith('https://data.geopf.fr/altimetrie/')) ignRequests += 1;
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
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
/** Choisit `value` dans la liste qui suit le libellé `label` (texte du `label` ou de la ligne de réglage). */
const chooseIn = (label, value) => evaluate(`(() => {
  const holder = [...document.querySelectorAll('label, .settings-row')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}) && x.querySelector('select'));
  if (!holder) return 'absent';
  const s = holder.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)});
  s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok';
})()`);
/** Ouvre l'onglet réglages de l'analyse, s'il ne l'est pas déjà (son état est mémorisé). */
const openSettingsTab = async () => {
  const already = await evaluate(`[...document.querySelectorAll('label')].some((x) => x.textContent.trim().startsWith('Altitude') && x.querySelector('select'))`);
  return already ? 'déjà ouvert' : clickButton('réglages');
};
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const readOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  const parts = ${JSON.stringify(path)}.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
})()`);
const listOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);
/** Ligne de la source de l'altitude, sous le graphe d'altitude. */
const sourceLine = () => evaluate(`[...document.querySelectorAll('span')].map((x) => x.textContent).find((t) => /^Altitude (du terrain|du GPS|enregistrée)/.test(t)) ?? '(aucune)'`);
const elevationStat = () => evaluate(`[...document.querySelectorAll('.an-sheet__stat')].map((x) => x.innerText.replace(/\\n/g, ' ')).find((t) => t.startsWith('Dénivelé')) ?? '(aucun)'`);
const listGain = () => evaluate(`document.body.innerText.match(/D\\+ \\d+ m/)?.[0] ?? '(aucun)'`);
const waitSource = async (pattern) => {
  for (let k = 0; k < 60; k++) {
    if (pattern.test(await sourceLine())) return;
    await wait(500);
  }
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Course synthétique vers le nord, de Grabels vers Saint-Gély-du-Fesc (garrigue, une centaine de mètres de relief).
const SPEED = 3;
const t0 = Date.UTC(2026, 9, 7, 8, 0, 0);
const start = [43.655, 3.8];
const fixes = [];
for (let k = 0; k <= 1200; k++) {
  const north = (SPEED * k) / 111_195;
  const noise = 1.5 * Math.sin(k / 7) + Math.sin(k * 1.3);
  fixes.push([start[0] + north, start[1], 150 + noise]);
}
const runPath = `${workDir}\\course-altitude.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course altitude</name><type>running</type><trkseg>\n${
  fixes.map(([lat, lon, ele], k) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
console.log(`course synthétique : ${fixes.length} points à ${SPEED} m/s`);
await go('/course');
await setFile('input[type=file][accept=".gpx"][multiple]', runPath);
await wait(4000);
const gpxName = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx'));
const recordPath = `sessions/${gpxName.replace(/\.gpx$/, '.json')}`;
console.log('rangée :', gpxName, '| liste :', await listGain(), '| requêtes IGN', ignRequests);

// 2. Ouverture : altitude demandée, rangée, puis relue sans requête.
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 1500);
console.log('pendant :', await sourceLine());
await waitSource(/IGN\.$|hors|Réessayez|réseau/);
console.log('après :', await sourceLine(), '| dénivelé', await elevationStat(), '| requêtes IGN', ignRequests);
await shoot('altitude-ign');
await wait(1500);
const record = JSON.parse(await readOpfs(recordPath));
const terrain = record.terrainElevation;
console.log('fiche :', terrain
  ? `${terrain.source}, ${terrain.resource}, pas ${terrain.stepM} m, ${terrain.t.length} échantillons, ${terrain.z.filter((z) => z === null).length} hors couverture, de ${Math.min(...terrain.z)} à ${Math.max(...terrain.z)} m`
  : 'sans altitude', '| D+ du résumé', record.summary.elevationGainM?.toFixed(1));
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 4000);
console.log('rechargée :', await sourceLine(), '| dénivelé', await elevationStat(), '| requêtes IGN', ignRequests);

// 3. Retour au GPS, puis à l'IGN, depuis les réglages de la session.
console.log('onglet réglages :', await openSettingsTab());
await wait(500);
console.log('GPS :', await chooseIn('Altitude', 'gps'));
await wait(2000);
console.log('au GPS :', await sourceLine(), '| dénivelé', await elevationStat(), '| fiche', JSON.parse(await readOpfs(recordPath)).elevationSource ?? '(IGN)');
await go('/course', 3000);
console.log('liste au GPS :', await listGain());
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 3000);
await openSettingsTab();
await wait(500);
console.log('IGN :', await chooseIn('Altitude', 'ign'));
await wait(2000);
console.log('à l\'IGN :', await sourceLine(), '| dénivelé', await elevationStat(), '| fiche', JSON.parse(await readOpfs(recordPath)).elevationSource ?? '(IGN)', '| requêtes IGN', ignRequests);
await go('/course', 3000);
console.log('liste à l\'IGN :', await listGain());

// 4. Un point tous les 20 m, réglé pour l'activité : redemandée à la réouverture.
await go('/parametres', 2500);
console.log('panneau Activités :', await evaluate(`(() => { const t = [...document.querySelectorAll('strong[role=button]')].find((x) => x.textContent.trim() === 'Activités'); if (!t) return 'absent'; if (!document.querySelector('.settings-activities')) t.click(); return 'ok'; })()`));
await wait(500);
console.log('carte Course :', await evaluate(`(() => { const b = [...document.querySelectorAll('.settings-activity__toggle')].find((x) => x.textContent.includes('Course')); if (!b) return 'absent'; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 'ok'; })()`));
await wait(500);
console.log('20 m :', await chooseIn('Altitude IGN', '20'));
await wait(500);
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 1500);
await waitSource(/IGN\.$|hors|Réessayez|réseau/);
await wait(1500);
const record20 = JSON.parse(await readOpfs(recordPath));
console.log('à 20 m :', await sourceLine(), '| dénivelé', await elevationStat(), '| requêtes IGN', ignRequests,
  '| fiche', record20.terrainElevation ? `pas ${record20.terrainElevation.stepM} m, ${record20.terrainElevation.t.length} échantillons` : 'sans altitude');

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
ws.close();
