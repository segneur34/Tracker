// Banc du bouton « Enregistrer la session » (24/09/2026) : brouillon du vent, du seuil et des notes,
// avertissement en quittant, écriture dans la fiche, relecture après rechargement, Annuler.
// Profil Chrome neuf : OPFS vide au départ.
// Usage : node session-save.mjs <port> <GPX de voile, chemin Windows>
const [port, gpxPath] = process.argv.slice(2);
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
const setFiles = async (selector, paths) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return 'absent';
  await send('DOM.setFileInputFiles', { nodeId, files: paths });
  return 'ok';
};
// Saisie dans un champ contrôlé par React : setter natif, puis événement `input`.
const typeInto = (selector, value) => evaluate(`(() => { const el = ${selector}; if (!el) return 'absent'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const WIND_INPUT = `[...document.querySelectorAll('input[type=number]')].find((i) => i.parentElement?.textContent.includes('Saisie'))`;
const THRESHOLD_INPUT = `[...document.querySelectorAll('label')].find((l) => l.textContent.includes("Seuil d'activité"))?.querySelector('input')`;
const bar = () => evaluate(`document.querySelector('.ui-savebar')?.innerText.replace(/\\n/g, ' ') ?? 'pas de barre'`);
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const fiche = async (file) => {
  const text = await readOpfs(`sessions/${file.replace(/\.gpx$/, '.json')}`);
  try {
    const r = JSON.parse(text);
    return JSON.stringify({ analysis: r.analysis ?? null, rating: r.notes?.rating ?? null, comment: r.notes?.comment ?? null, movingTimeS: Math.round(r.summary.movingTimeS) });
  } catch { return `illisible : ${String(text).slice(0, 80)}`; }
};
const step = (title) => console.log(`\n== ${title}`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');

step('1. Import du GPX, ouverture de la session');
await go('/voile');
console.log('import :', await setFiles('input[type=file][accept=".gpx"]', [gpxPath]));
await wait(4000);
console.log('ouverture :', await evaluate(`(() => { const r = document.querySelector('.lib-row__main'); if (!r) return 'absent'; r.click(); return 'ok'; })()`));
await wait(6000);
const url = await evaluate('location.pathname + location.search');
const file = decodeURIComponent(url.split('session=')[1] ?? '');
console.log('url :', url);
console.log('barre :', await bar());
console.log('fiche :', await fiche(file));

step('2. Vent saisi : brouillon, fiche intacte');
console.log('saisie :', await typeInto(WIND_INPUT, '90'));
await wait(3000);
console.log('barre :', await bar());
console.log('fiche :', await fiche(file));

step('3. Retour à la liste refusé : on reste sur la page');
acceptDialogs = false;
console.log('clic retour :', await clickText('Sessions voile', 'a'));
await wait(1000);
console.log('dialogue :', dialogs.at(-1));
console.log('url :', await evaluate('location.pathname + location.search'));

step('4. Enregistrer la session');
console.log('clic :', await clickText('Enregistrer la session'));
await wait(2500);
console.log('barre :', await bar());
console.log('fiche :', await fiche(file));

step('5. Seuil propre à la session, puis Enregistrer : résumé recalculé');
console.log('saisie :', await typeInto(THRESHOLD_INPUT, '4'));
await wait(3000);
console.log('barre :', await bar());
console.log('clic :', await clickText('Enregistrer la session'));
await wait(4000);
console.log('fiche :', await fiche(file));

step('6. Rechargement : vent et seuil relus depuis la fiche');
await go(url, 7000);
console.log('vent :', await evaluate(`${WIND_INPUT}?.value`), '| seuil :', await evaluate(`${THRESHOLD_INPUT}?.value`));
console.log('barre :', await bar());

step('7. Notes puis Annuler : retour à l\'état enregistré');
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('matos et conditions')); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
await wait(800);
console.log('commentaire :', await typeInto(`document.querySelector('textarea')`, 'Essai du banc'));
await wait(800);
console.log('barre :', await bar());
console.log('clic Annuler :', await clickText('Annuler'));
await wait(800);
console.log('commentaire après Annuler :', JSON.stringify(await evaluate(`document.querySelector('textarea')?.value`)));
console.log('barre :', await bar());

step('8. Brouillon gardé après un retour arrière du navigateur');
await typeInto(`document.querySelector('textarea')`, 'Brouillon gardé');
await wait(800);
await evaluate('history.back()');
await wait(2000);
console.log('url :', await evaluate('location.pathname'));
await evaluate('history.forward()');
await wait(6000);
console.log('commentaire :', JSON.stringify(await evaluate(`document.querySelector('textarea')?.value`)), '| barre :', await bar());

step('9. Retour à la liste accepté : brouillon abandonné');
acceptDialogs = true;
console.log('clic retour :', await clickText('Sessions voile', 'a'));
await wait(1500);
console.log('url :', await evaluate('location.pathname'));
console.log('fiche :', await fiche(file));

step('Console');
console.log(logs.length ? logs.join('\n') : 'aucune erreur');
ws.close();
