// Suite de session-save.mjs (24/09/2026), sur le même profil Chrome : la session déjà importée est
// classée en wingfoil (le seuil de la session est effacé), puis son seuil est enregistré à 4 et 12 nœuds ;
// le résumé de la fiche doit suivre.
// Usage : node session-save-resume.mjs <port>
const [port] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const dialogs = [];
let acceptDialogs = false;
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: acceptDialogs } }));
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
// Saisie dans un champ contrôlé par React : setter natif, puis événement `input`.
const typeInto = (selector, value) => evaluate(`(() => { const el = ${selector}; if (!el) return 'absent'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const THRESHOLD_INPUT = `[...document.querySelectorAll('label')].find((l) => l.textContent.includes("Seuil d'activité"))?.querySelector('input')`;
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const step = (title) => console.log(`\n== ${title}`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const setSelect = (value) => evaluate(`(() => { const el = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
const fiche = async (file) => { const r = JSON.parse(await readOpfs(`sessions/${file.replace(/\.gpx$/, '.json')}`)); return JSON.stringify({ sport: r.sport, analysis: r.analysis, movingTimeS: r.summary.movingTimeS === null ? null : Math.round(r.summary.movingTimeS) }); };
await go('/voile');
await evaluate(`document.querySelector('.lib-row__main').click()`);
await wait(6000);
const url = await evaluate('location.pathname + location.search');
const file = decodeURIComponent(url.split('session=')[1]);
step('Support wingfoil : le seuil de la session est effacé, résumé recalculé');
console.log(await setSelect('wingfoil'));
await wait(4000);
console.log('fiche :', await fiche(file), '| seuil affiché :', await evaluate(`${THRESHOLD_INPUT}?.value`));
for (const seuil of ['4', '12']) {
  step(`Seuil ${seuil} nds enregistré`);
  await typeInto(THRESHOLD_INPUT, seuil);
  await wait(3000);
  const actif = await evaluate(`[...document.querySelectorAll('li')].find((l) => l.textContent.startsWith('Temps actif'))?.textContent`);
  await clickText('Enregistrer la session');
  await wait(4000);
  console.log('page :', actif, '| fiche :', await fiche(file));
}
step('Console');
console.log(logs.length ? logs.join('\n') : 'aucune erreur');
ws.close();
