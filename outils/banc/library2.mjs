// Banc de la bibliothèque, suite (à lancer après library.mjs, même profil Chrome) :
// 1. une paire GPX + fiche exportée, la session supprimée, puis la paire réimportée : les notes reviennent ;
// 2. reglages.json plus récent que l'appareil : ses réglages sont repris au lancement.
// Usage : node library2.mjs <port> <dossier de travail>
import { writeFileSync } from 'node:fs';

const [port, workDir] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const win = (name) => `${workDir.replace(/\//g, '\\')}\\${name}`;

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
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFiles = async (selector, paths) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return 'absent';
  await send('DOM.setFileInputFiles', { nodeId, files: paths });
  return 'ok';
};
const rows = () => evaluate(`JSON.stringify([...document.querySelectorAll('.lib-row__main')].map((r) => r.innerText.replace(/\\n/g, ' / ')))`);
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const writeOpfs = (path, text) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(${JSON.stringify(text)}); await w.close(); return 'ok'; })()`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const NAME = '2026-09-20_15-00-00_wingfoil';

console.log('== 1. Export de la paire, suppression, réimport');
await go('/voile');
writeFileSync(`${workDir}/${NAME}.gpx`, await readOpfs(`sessions/${NAME}.gpx`));
writeFileSync(`${workDir}/${NAME}.json`, await readOpfs(`sessions/${NAME}.json`));
console.log('avant :', await rows());
await evaluate(`(() => { const row = [...document.querySelectorAll('.lib-row')].find((r) => r.innerText.startsWith('Wingfoil')); [...row.querySelectorAll('button')].find((b) => b.textContent === 'Supprimer').click(); return 'ok'; })()`);
await wait(300);
console.log('Confirmer :', await clickText('Confirmer'));
await wait(1500);
console.log('après suppression :', await rows());
console.log('import de la paire :', await setFiles('input[type=file][accept=".gpx"][multiple]', [win(`${NAME}.gpx`), win(`${NAME}.json`)]));
await wait(4000);
console.log('après import :', await rows());
const record = JSON.parse(await readOpfs(`sessions/${NAME}.json`));
console.log('fiche réimportée : notes.foil =', record.notes?.foil, '| manœuvres =', record.summary.maneuverCount, '| source =', record.source);

console.log('\n== 2. reglages.json plus récent que l\'appareil');
const settings = JSON.parse(await readOpfs('reglages.json'));
settings.savedAt = Date.now() + 60_000;
settings.values['tracker.sportSettings'] = { ...settings.values['tracker.sportSettings'], thresholds: { wingfoil: 11 } };
console.log('écriture :', await writeOpfs('reglages.json', JSON.stringify(settings)));
await go('/parametres', 3500);
console.log('seuil wingfoil affiché :', await evaluate(`document.querySelector('table input[type=number]')?.value`));
console.log('stockage de l\'appareil :', await evaluate(`localStorage.getItem('tracker.sportSettings')`));
console.log(await evaluate(`document.body.innerText.split('\\n').filter((l) => /Réglages (repris|de cet|identiques)/.test(l)).join(' | ')`));

console.log('\n--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 15).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
