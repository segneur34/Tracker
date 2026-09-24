// Captures d'écran de pages de l'application dans un Chrome sans fenêtre.
// Usage : node shots.mjs <port> <dossier> <largeur>x<hauteur>[m] <chemin> [chemin...]
//   « m » après la taille : émulation téléphone (écran tactile, densité 2).
// Variables : BASE (serveur, défaut http://localhost:5173), FULL=1 (page entière),
// SETUP (code exécuté dans la page avant les captures, ex. remplir localStorage),
// WAIT (ms d'attente après chargement, défaut 2500).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [port, outDir, size, ...paths] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const WAIT = Number(process.env.WAIT ?? 2500);
const mobile = size.endsWith('m');
const [width, height] = size.replace('m', '').split('x').map(Number);
mkdirSync(outDir, { recursive: true });

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

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

if (process.env.SETUP) {
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(1500);
  console.log('préparation :', await evaluate(process.env.SETUP));
}

for (const path of paths) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await wait(WAIT);
  const name = `${size}${path.replace(/\//g, '_') || '_'}.png`.replace(/^_/, '');
  let params = { format: 'png' };
  if (process.env.FULL) {
    const metrics = await send('Page.getLayoutMetrics');
    const content = metrics.result.cssContentSize ?? metrics.result.contentSize;
    params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(content.height), scale: 1 } };
  }
  const shot = await send('Page.captureScreenshot', params);
  writeFileSync(join(outDir, name), Buffer.from(shot.result.data, 'base64'));
  console.log(`${path} → ${name} (h1 : ${await evaluate("document.querySelector('h1')?.textContent ?? '—'")})`);
}

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 15).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
