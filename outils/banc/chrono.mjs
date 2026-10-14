// Banc de test : chronomètre de la carte du compteur (lot 2 des demandes du 10-14/10).
// Usage : node chrono.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, à 390×844 puis à 1400×1000. Dure environ 30 s. Le script vérifie :
//  1. Enregistrer, onglet Fractionné : la bascule « Compteur | Chrono », le chrono à zéro ;
//  2. Départ, deux tours, Arrêt : temps, tours (le dernier en haut), Reprendre et Remise à zéro ;
//  3. la vue Compteur : la pastille du chrono sur son bouton ;
//  4. un rechargement chrono lancé : il reprend juste, la carte s'ouvre sur lui ;
//  5. en Course, chrono lancé : la carte reste visible ; Remise à zéro : elle disparaît ;
//  6. la page sans débordement à 390 px, puis à 1400 px.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node chrono.mjs <port> [<dossier des captures>]');
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
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.trim().startsWith(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const card = () => evaluate(`(() => { const c = document.querySelector('.ivl'); return c ? c.innerText.replace(/\\n+/g, ' / ') : '(pas de carte)'; })()`);
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const stored = () => evaluate(`localStorage.getItem('tracker.stopwatch')`);

await send('Runtime.enable'); await send('Page.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });

for (const [width, height, mobile] of [[390, 844, true], [1400, 1000, false]]) {
  console.log(`\n=== ${width}×${height} ===`);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

  // 1. Enregistrer, Fractionné : la bascule.
  await go('/enregistrer');
  console.log('onglet Fractionné :', await clickText('Fractionné'));
  await wait(300);
  console.log('bascule :', await evaluate(`[...document.querySelectorAll('.ivl-switch__pick')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' (choisi)' : '')).join(' | ')`));
  console.log('Chrono :', await clickText('Chrono', '.ivl-switch__pick'));
  await wait(200);
  console.log('carte :', await card());

  // 2. Départ, deux tours, Arrêt.
  console.log('Départ :', await clickText('Départ'));
  await wait(1200);
  console.log('Tour :', await clickText('Tour'));
  await wait(700);
  console.log('Tour :', await clickText('Tour'));
  await wait(400);
  console.log('carte en marche :', await card());
  await shoot(`chrono-${width}-marche`);
  console.log('Arrêt :', await clickText('Arrêt'));
  await wait(300);
  const pausedText = await card();
  console.log('carte à l\'arrêt :', pausedText);
  await wait(1000);
  console.log('figé à l\'arrêt :', (await card()) === pausedText);
  console.log('Reprendre :', await clickText('Reprendre'));
  await wait(200);

  // 3. Vue Compteur : pastille du chrono.
  console.log('Compteur :', await clickText('Compteur', '.ivl-switch__pick'));
  await wait(300);
  console.log('pastille :', await evaluate(`document.querySelector('.ivl-switch__badge')?.textContent ?? '(aucune)'`));
  await shoot(`chrono-${width}-pastille`);

  // 4. Rechargement, chrono lancé.
  console.log('gardé :', await stored());
  await go('/enregistrer');
  console.log('après rechargement :', await card());

  // 5. En Course : la carte reste tant que le chrono est lancé.
  console.log('onglet Course :', await clickText('Course'));
  await wait(300);
  console.log('carte en Course :', await card());
  console.log('Arrêt :', await clickText('Arrêt'));
  await wait(200);
  console.log('Remise à zéro :', await clickText('Remise à zéro'));
  await wait(300);
  console.log('carte après remise à zéro :', await card(), '; gardé :', await stored());

  // 6. Débordement.
  console.log('débordement horizontal (px) :', await overflow());
}

console.log('\nconsole :', logs.length ? logs.join('\n  ') : 'rien');
await send('Browser.close').catch(() => {});
process.exit(0);
