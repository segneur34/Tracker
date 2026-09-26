// Banc de test : planification d'un itinéraire (page /itineraires).
// Usage : node planning.mjs <port> <dossier des GPX, chemin Windows> [<dossier des captures>]
// Le dossier contient `sans-heure.gpx` (trace sans horodatage, avec altitude et <type>hiking</type>),
// `route-rte.gpx` (des <rtept> seulement), `boucle.gpx` (trace qui revient près de son départ)
// et `pas-un-gpx.gpx` (aucun point de trace ni de route).
// Scénario : points posés en ligne droite, « Précédent », boucle en ligne droite, chargement des GPX,
// point inséré sur la trace importée, point déplacé, rangement puis réouverture après rechargement.
import { writeFileSync } from 'node:fs';

const [port, gpxDir, shotDir] = process.argv.slice(2);
if (!port || !gpxDir) {
  console.error('Usage : node planning.mjs <port> <dossier des GPX> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';
const sep = gpxDir.includes('\\') ? '\\' : '/';
const gpx = (name) => `${gpxDir}${sep}${name}`;

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const dialogs = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  // Les confirmations (itinéraire non rangé) sont acceptées, et notées.
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    void send('Page.handleJavaScriptDialog', { accept: true });
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const clickText = (text, scope = 'button') => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)}) && !x.disabled); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(300); };
/** Toucher de la carte, à la fraction (fx, fy) de son cadre. */
const tapMap = async (fx, fy) => {
  const r = await evaluate(`(() => { const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
  await clickAt(r[0] + r[2] * fx, r[1] + r[3] * fy);
};
const state = () => evaluate(`(() => {
  const title = [...document.querySelectorAll('button, h2, h3, span, strong')].map((x) => x.textContent.trim()).find((t) => /^Points \\(\\d+\\)$/.test(t)) ?? null;
  const stats = [...document.querySelectorAll('.plan-stat strong')].map((x) => x.textContent);
  const modes = [...document.querySelectorAll('.plan-points select')].map((s) => s.value);
  const labels = [...document.querySelectorAll('.plan-point__text strong')].map((x) => x.textContent);
  const name = document.querySelector('.plan-form input')?.value ?? null;
  const activity = document.querySelector('.plan-form select')?.selectedOptions[0]?.textContent ?? null;
  const alert = [...document.querySelectorAll('.ui-alert')].map((x) => x.textContent).join(' | ');
  const pendingText = document.body.innerText.includes('Calcul du tracé');
  return JSON.stringify({ title, stats, modes, labels, name, activity, alert, pendingText });
})()`);
const log = async (label) => console.log(label.padEnd(34), await state());

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.navigate', { url: `${BASE}/itineraires` });
await wait(3000);

// 1. Trois points en ligne droite, « Précédent », boucle en ligne droite depuis un autre mode.
console.log('mode ligne droite :', await clickText('Ligne droite', '.plan-modes button'));
await tapMap(0.3, 0.3);
await tapMap(0.6, 0.35);
await tapMap(0.55, 0.7);
await log('trois points');
console.log('Précédent (carte) :', await clickText('Précédent', '.plan-map-tools button'));
await log('après Précédent');
console.log('mode à pied :', await clickText('À pied', '.plan-modes button'));
console.log('Boucler en ligne droite :', await clickText('Boucler en ligne droite'));
await log('boucle en ligne droite');
console.log('Tout effacer :', await clickText('Tout effacer'));

// 2. GPX qui n'en est pas un, route <rte>, trace sans heure, boucle.
await setFile('.plan-actions input[type=file]', gpx('pas-un-gpx.gpx'));
await wait(800);
await log('pas un GPX');
await setFile('.plan-actions input[type=file]', gpx('route-rte.gpx'));
await wait(800);
await log('route <rte>');
await setFile('.plan-actions input[type=file]', gpx('boucle.gpx'));
await wait(800);
await log('boucle');
await setFile('.plan-actions input[type=file]', gpx('sans-heure.gpx'));
await wait(800);
await log('trace sans heure');
if (shotDir) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/planning-trace.png`, Buffer.from(shot.result.data, 'base64'));
}

// 3. Toucher la trace importée en son milieu : un point posé dessus, distance inchangée.
const mid = await evaluate(`(() => {
  const path = [...document.querySelectorAll('.plan-map path.leaflet-interactive')].find((p) => p.getAttribute('stroke-width') === '24');
  if (!path) return null;
  const p = path.getPointAtLength(path.getTotalLength() * 0.5).matrixTransform(path.getScreenCTM());
  return [p.x, p.y];
})()`);
if (mid) await clickAt(mid[0], mid[1]);
await log('point inséré sur la trace');

// 4. Glisser l'arrivée, en ligne droite : seul son tronçon est refait, dans ce mode.
console.log('mode ligne droite :', await clickText('Ligne droite', '.plan-modes button'));
const end = await evaluate(`(() => { const m = [...document.querySelectorAll('.plan-marker')].pop()?.getBoundingClientRect(); return m ? [m.left + m.width / 2, m.top + m.height / 2] : null; })()`);
if (end) {
  await mouse('mousePressed', end[0], end[1]);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', end[0] + 6 * k, end[1] + 4 * k);
  await mouse('mouseReleased', end[0] + 48, end[1] + 32);
  await wait(500);
}
await log('arrivée déplacée');
console.log('Précédent :', await clickText('Précédent', '.plan-map-tools button'));
await log('après Précédent');
console.log('Inverser :', await clickText('Inverser'));
await log('inversé');
console.log('Inverser :', await clickText('Inverser'));

// 5. Ranger, recharger, rouvrir.
await wait(1500);
console.log('Ranger :', await clickText('Ranger'));
await wait(1500);
console.log('message :', await evaluate(`[...document.querySelectorAll('.plan-note')].map((x) => x.textContent).join(' | ')`));
await send('Page.navigate', { url: `${BASE}/itineraires` });
await wait(3000);
console.log('rouvrir :', await clickText('Sentier des crêtes', '.plan-saved__open'));
await wait(800);
await log('rouvert');

// 6. Téléphone : outils de la carte.
if (shotDir) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/planning-telephone.png`, Buffer.from(shot.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
}

console.log('--- confirmations ---');
dialogs.forEach((d) => console.log(d));
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
