// Banc de test : pilote un Chrome sans fenêtre par le protocole DevTools.
// Usage : node bench.mjs <port> analyse <gpx>
// Scénario : rejeu du GPX à ×600 → Arrêter → Analyser, puis relevé de la page d'analyse voile.
// L'ancien scénario « fichier » (ouverture dans /voile) est retiré : depuis le lot 3a, /voile est la bibliothèque.
import { writeFileSync } from 'node:fs';

const [port, scenario = 'analyse', gpxPath] = process.argv.slice(2);
if (scenario !== 'analyse' || !gpxPath) {
  console.error('Usage : node bench.mjs <port> analyse <gpx, chemin Windows>');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SHOT = process.env.SHOT;

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
const snapshot = () => evaluate(`JSON.stringify({ url: location.pathname, h1: document.querySelector('h1')?.textContent ?? null, text: document.body.innerText.length, segments: document.querySelectorAll('path.leaflet-interactive').length, charts: document.querySelectorAll('.recharts-surface').length })`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.navigate', { url: `${BASE}/` });
await wait(2500);
// Onglets de la colonne de la carte tous ouverts, comme chez l'utilisateur.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ 'sailing-carte': { manoeuvres: true, vmg: true, graphiques: true, vent: true } })); 'ok'`);

await send('Page.navigate', { url: `${BASE}/enregistrer` });
await wait(2500);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await setFile('input[type=file]', gpxPath);
await wait(800);
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(8000);
console.log('Arrêter :', await clickText('Arrêter'));
await wait(2000);
console.log('page enregistrement :', await evaluate(`document.body.innerText.split('\\n').filter((l) => /points|Rangée|Session/.test(l)).join(' | ')`));
console.log('Analyser :', await clickText('Analyser'));
await wait(5000);

console.log('résultat :', await snapshot());
if (process.env.DUMP) writeFileSync(process.env.DUMP, await evaluate('document.body.innerText'));
if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
}
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
