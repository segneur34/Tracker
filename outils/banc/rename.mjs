// Banc du renommage d'une session (lot II) : nom saisi dans la bibliothèque, écrit dans la fiche,
// relu après rechargement, affiché en tête de l'analyse, effacé par un nom vide, puis donné depuis
// l'en-tête de l'analyse et relu dans la bibliothèque. Profil Chrome neuf.
// Usage : node rename.mjs <port> <gpx de voile, produit par make-gpx.mjs>
const [port, gpx] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push(`error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
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
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const rows = () => evaluate(`JSON.stringify([...document.querySelectorAll('.lib-row__main')].map((r) => r.innerText.replace(/\\n/g, ' / ')))`);
const record = () => evaluate(`(async () => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'); for await (const [n, h] of d.entries()) if (n.endsWith('.json')) { const r = JSON.parse(await (await h.getFile()).text()); return JSON.stringify({ name: r.name, title: r.title, gpx: r.gpx }); } return 'aucune fiche'; })()`);
const files = () => evaluate(`(async () => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort().join(', '); })()`);
const typeName = async (value, key) => {
  await evaluate(`(() => { const i = document.querySelector('.lib-row__rename'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  await wait(200);
  if (key) await evaluate(`document.querySelector('.lib-row__rename').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })), 'ok'`);
};
const step = (title) => console.log(`\n== ${title}`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');

step('1. Import du GPX dans la bibliothèque voile');
await go('/voile');
const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept=".gpx"]' });
await send('DOM.setFileInputFiles', { nodeId, files: [gpx] });
await wait(4000);
console.log('lignes :', await rows());
console.log('fiche :', await record());

step('2. Renommer, Annuler (Échap) : rien ne change');
console.log('Renommer :', await clickText('Renommer'));
await typeName('Brouillon abandonné', 'Escape');
console.log('lignes :', await rows());

step('3. Renommer, Entrée');
await clickText('Renommer');
await typeName('  Sortie du soir  ', 'Enter');
await wait(1500);
console.log('lignes :', await rows());
console.log('fiche :', await record());
console.log('fichiers :', await files());

step('4. Rechargement');
await go('/voile');
console.log('lignes :', await rows());

step('5. Analyse : sous-titre de l\'en-tête');
await evaluate(`document.querySelector('.lib-row__main').click(), 'ok'`);
await wait(6000);
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| sous-titre :', await evaluate(`document.querySelector('.ui-page-header__subtitle')?.textContent ?? 'aucun'`));

step('6. Nom vide, bouton Valider : plus de nom');
await go('/voile');
await clickText('Renommer');
await typeName('   ');
console.log('Valider :', await clickText('Valider'));
await wait(1500);
console.log('lignes :', await rows());
console.log('fiche :', await record());

step('7. Renommer depuis l\'en-tête de l\'analyse');
await evaluate(`document.querySelector('.lib-row__main').click(), 'ok'`);
await wait(6000);
const subtitle = () => evaluate(`document.querySelector('.ui-page-header__subtitle')?.innerText.split('\\n').join(' / ')`);
console.log('en-tête avant :', await subtitle());
console.log('Renommer :', await clickText('Renommer'));
await wait(300);
await evaluate(`(() => { const i = document.querySelector('input[aria-label="Nom de la session"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Bord au Grand Travers'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
await wait(1500);
console.log('en-tête après :', await subtitle());
console.log('fiche :', await record());
await go('/voile');
console.log('lignes :', await rows());

console.log('\n== Console :', logs.length ? logs.join('\n') : 'rien');
await send('Browser.close').catch(() => {});
process.exit(0);
