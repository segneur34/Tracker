// Banc de la bibliothèque (lot 3a) : mémoire du navigateur (OPFS), enregistrement rangé, notes dans la fiche,
// import, doublon, à classer, suppression, relance, reglages.json. Profil Chrome neuf : OPFS vide au départ.
// Usage : node library.mjs <port> <dossier des GPX : voile.gpx, course.gpx, sans-type.gpx> <dossier des captures>
import { writeFileSync } from 'node:fs';

const [port, gpxDir, shotDir] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const win = (name) => `${gpxDir.replace(/\//g, '\\')}\\${name}`;

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
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return `ERREUR: ${res.result.exceptionDetails.exception?.description?.split('\n')[0]}`;
  return res.result?.result?.value;
};
const go = async (path, ms = 2500) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text, selector = 'button') => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFiles = async (selector, paths) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return 'absent';
  await send('DOM.setFileInputFiles', { nodeId, files: paths });
  return 'ok';
};
const lines = (re) => evaluate(`document.body.innerText.split('\\n').filter((l) => ${re}.test(l)).join(' | ')`);
const rows = () => evaluate(`JSON.stringify([...document.querySelectorAll('.lib-row__main')].map((r) => r.innerText.replace(/\\n/g, ' / ')))`);
const opfsTree = () => evaluate(`(async () => { const t = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const out = {}; const walk = async (d, p) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out[p + n] = (await h.getFile()).size; } }; await walk(t, ''); return JSON.stringify(out); })()`);
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const shot = async (name, width, height, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await wait(800);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(s.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
};
const step = (title) => console.log(`\n== ${title}`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');

step('1. Bibliothèque vide');
await go('/voile');
console.log(await lines(/session|mémoire|Aucune/));
await shot('voile-vide-mobile', 390, 844, true);

step('2. Rejeu ×600, Arrêter, Analyser');
await go('/enregistrer');
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
console.log('fichier rejeu :', await setFiles('input[type=file]', [win('voile.gpx')]));
await wait(800);
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(9000);
console.log('Arrêter :', await clickText('Arrêter'));
await wait(3000);
console.log(await lines(/points|Rangée|Session/));
console.log('Analyser :', await clickText('Analyser'));
await wait(6000);
console.log('url :', await evaluate('location.pathname + location.search'));
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`));
console.log('dossier :', await opfsTree());

step('3. Notes : saisie, rechargement');
console.log('onglet matos :', await clickText('matos'));
await wait(500);
await evaluate(`(() => { const i = document.querySelector('input[placeholder^="ex. 1100"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Axis 900 banc'); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
await wait(1500);
console.log(await lines(/Enregistré dans|Notes indisponibles|seront enregistrées/));
await send('Page.reload'); await wait(6000);
await clickText('matos'); await wait(500);
console.log('foil après rechargement :', await evaluate(`document.querySelector('input[placeholder^="ex. 1100"]')?.value`));
const tree = JSON.parse(await opfsTree());
const fiche = Object.keys(tree).find((k) => k.startsWith('sessions/') && k.endsWith('.json'));
const record = JSON.parse(await readOpfs(fiche));
console.log('fiche :', fiche, '| sport', record.sport, '| source', record.source, '| manœuvres', record.summary.maneuverCount, '| notes.foil', record.notes?.foil, '| distance', Math.round(record.summary.distanceM), 'm');

step('4. Import : doublon, course typée, trace sans type');
await go('/voile');
console.log('import :', await setFiles('input[type=file][accept=".gpx"][multiple]', [win('voile.gpx'), win('course.gpx'), win('sans-type.gpx')]));
await wait(5000);
console.log(await lines(/ajoutée|déjà|illisible/));
console.log('lignes voile :', await rows());
await go('/course');
console.log('lignes course :', await rows());

step('5. Classer la trace sans type en kite');
await evaluate(`(() => { const s = document.querySelector('select[aria-label="Classer la session"]'); if (!s) return 'absent'; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'kite'); s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
await wait(2000);
await go('/voile');
console.log('lignes voile :', await rows());

step('6. Supprimer la course');
await go('/course');
console.log('Supprimer :', await clickText('Supprimer'));
await wait(300);
console.log('Confirmer :', await clickText('Confirmer'));
await wait(1500);
console.log('lignes course :', await rows(), '|', await lines(/Aucune session/));

step('7. Réglages : seuil changé, reglages.json');
await go('/parametres');
await evaluate(`(() => { const i = document.querySelector('table input[type=number]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '9.5'); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
await wait(3000);
const settings = JSON.parse(await readOpfs('reglages.json'));
console.log('reglages.json :', JSON.stringify(settings.values['tracker.sportSettings']?.thresholds), '| savedAt', new Date(settings.savedAt).toISOString());
console.log(await lines(/Réglages de cet appareil|Réglages repris|identiques/));
await shot('reglages-desktop', 1400, 1000, false);
await shot('reglages-mobile', 390, 844, true);

step('8. Relance : liste relue du cache');
await go('/voile', 3500);
console.log('lignes voile :', await rows());
console.log('dossier :', await opfsTree());
console.log('LISEZMOI :', (await readOpfs('LISEZMOI.txt')).split('\r\n')[0]);
await shot('voile-mobile', 390, 844, true);
await shot('voile-desktop', 1400, 1000, false);

console.log('\n--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 15).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
