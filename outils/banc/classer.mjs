// Banc de test : session à classer, activité demandée avant l'analyse (§10, point 88).
// Usage : node classer.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même un GPX dont la balise <type> ne dit rien
// (« other », comme certaines applications), l'importe depuis la page Course, et vérifie :
//  1. la session est « À classer » ;
//  2. l'ouvrir montre la question « Quelle activité ? » au lieu d'ouvrir l'analyse ; Échap la ferme sans rien changer ;
//  3. choisir Gravel range l'activité dans la fiche et ouvre l'analyse vélo, pas celle de la page Course.
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node classer.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

const t0 = Date.UTC(2026, 9, 2, 8, 0, 0);
const points = [];
for (let k = 0; k <= 900; k++) {
  points.push(`<trkpt lat="43.7700000" lon="${(3.8 + (k * 5) / 80500).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const gpxPath = `${workDir}\\sans-activite.gpx`;
writeFileSync(gpxPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="autre application" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sortie</name><type>other</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`);

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
const readRecord = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) return JSON.parse(await (await h.getFile()).text());
  return null;
})()`);
const sheet = () => evaluate(`(() => {
  const s = document.querySelector('.activity-select__sheet');
  return s ? s.querySelector('.activity-select__heading')?.innerText.replace(/\\n/g, ' / ') ?? '(liste sans question)' : '(pas de liste)';
})()`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Import depuis la page Course.
await go('/course');
await setFile('input[type=file][accept=".gpx"][multiple]', gpxPath);
await wait(3000);
console.log('carte « À classer » :', await evaluate(`[...document.querySelectorAll('h2, h3, .ui-card__heading')].some((h) => h.textContent.trim() === 'À classer')`));
const before = await readRecord();
console.log('fiche :', `support ${before?.sport}, activité ${before?.activityId}`);

// 2. L'ouvrir pose la question ; Échap la ferme.
const openRow = () => evaluate(`(() => { const b = [...document.querySelectorAll('.lib-row__main')].find((x) => /À classer/.test(x.textContent)); if (!b) return 'absente'; b.click(); return 'ok'; })()`);
console.log('ouvrir :', await openRow());
await wait(500);
console.log('question :', await sheet(), '| page :', await evaluate('location.pathname'));
await shoot('classer-question');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(300);
console.log('Échap :', await sheet(), '| page :', await evaluate('location.pathname'), '| support', (await readRecord())?.sport);

// 3. Gravel choisi : fiche rangée, analyse vélo ouverte.
console.log('ouvrir :', await openRow());
await wait(500);
console.log('Gravel :', await evaluate(`(() => { const b = [...document.querySelectorAll('.activity-select__option')].find((x) => x.textContent.trim() === 'Gravel'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(3000);
console.log('page :', await evaluate('location.pathname + location.search'), '| titre :', await evaluate(`document.querySelector('h1')?.textContent ?? ''`));
await wait(1500);
const after = await readRecord();
console.log('fiche :', `support ${after?.sport}, activité ${after?.activityId}`);

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
ws.close();
