// Banc de l'allure imposée propre à chaque session (lot D de l'audit, 24/09/2026). Deux sessions
// enregistrées par rejeu ; l'allure imposée à la première passe par le brouillon, s'écrit dans sa
// fiche, recalcule son résumé, et ne touche pas la seconde. Une ancienne allure par support, posée
// d'avance dans les réglages de l'appareil, doit être ignorée puis effacée à la première écriture.
// Profil Chrome neuf. Usage : node allure-session.mjs <port> <GPX 1> <GPX 2>, chemins Windows ;
// les deux GPX : make-gpx.mjs sans décalage, puis avec un décalage d'une heure.
const [port, gpx1, gpx2] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const dialogs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
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
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return 'absent';
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
  return 'ok';
};
// Saisie dans un champ contrôlé par React : setter natif, puis événement `input`.
const typeInto = (selector, value) => evaluate(`(() => { const el = ${selector}; if (!el) return 'absent'; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const setSelect = (selector, value) => evaluate(`(() => { const el = ${selector}; if (!el) return 'absent'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
const ALLURE_LABEL = `[...document.querySelectorAll('label')].find((l) => l.textContent.includes('Allure de la session'))`;
const ALLURE_INPUT = `${ALLURE_LABEL}?.querySelector('input')`;
const SPORT_SELECT = `[...document.querySelectorAll('label')].find((l) => l.textContent.includes('Support'))?.querySelector('select')`;
const allure = () => evaluate(`(() => { const l = ${ALLURE_LABEL}; if (!l) return 'pas de champ'; return l.querySelector('input').value + ' nds, ' + (l.textContent.includes('déduite') ? 'déduite' : l.textContent.includes('Défaut') ? 'imposée (bouton Défaut)' : '?'); })()`);
const bar = () => evaluate(`document.querySelector('.ui-savebar')?.innerText.replace(/\\n/g, ' ') ?? 'pas de barre'`);
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const fiche = async (file) => {
  const r = JSON.parse(await readOpfs(`sessions/${file.replace(/\.gpx$/, '.json')}`));
  return JSON.stringify({ sport: r.sport, analysis: r.analysis, movingTimeS: r.summary.movingTimeS === null ? null : Math.round(r.summary.movingTimeS), calcVersion: r.summary.calcVersion });
};
const sportSettings = () => evaluate(`localStorage.getItem('tracker.sportSettings')`);
const step = (title) => console.log(`\n== ${title}`);

/** Enregistre une session par rejeu à ×600, puis l'ouvre dans l'analyse ; rend son nom de fichier. */
const recordAndAnalyse = async (gpx) => {
  await go('/enregistrer');
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file]', gpx);
  await wait(800);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
  await clickText('Démarrer');
  await wait(8000);
  await clickText('Arrêter');
  await wait(2500);
  console.log('Analyser :', await clickText('Analyser'));
  await wait(6000);
  const url = await evaluate('location.pathname + location.search');
  return { url, file: decodeURIComponent(url.split('session=')[1] ?? '') };
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');

step('0. Ancienne allure par support posée dans les réglages de l\'appareil (1 m/s en wingfoil)');
await go('/');
await evaluate(`localStorage.setItem('tracker.sportSettings', JSON.stringify({ referenceSpeeds: { wingfoil: 1 } })); 'ok'`);
console.log('réglages :', await sportSettings());

step('1. Session 1 : allure déduite, l\'ancienne allure par support ignorée');
const s1 = await recordAndAnalyse(gpx1);
console.log('url :', s1.url);
console.log('allure :', await allure(), '| barre :', await bar());
console.log('fiche :', await fiche(s1.file));

step('2. Allure imposée à 6 nds : brouillon, fiche intacte');
console.log('saisie :', await typeInto(ALLURE_INPUT, '6'));
await wait(3000);
console.log('allure :', await allure(), '| barre :', await bar());
console.log('fiche :', await fiche(s1.file));

step('3. Enregistrer la session : allure dans la fiche, résumé recalculé');
console.log('clic :', await clickText('Enregistrer la session'));
await wait(4000);
console.log('barre :', await bar());
console.log('fiche :', await fiche(s1.file));

step('4. Rechargement : allure relue depuis la fiche');
await go(s1.url, 7000);
console.log('allure :', await allure(), '| barre :', await bar());

step('5. Session 2 : allure déduite de sa trace, pas celle de la session 1');
const s2 = await recordAndAnalyse(gpx2);
console.log('url :', s2.url);
console.log('allure :', await allure(), '| barre :', await bar());
console.log('fiche :', await fiche(s2.file));

step('6. Une écriture des réglages (support changé puis rétabli) efface l\'ancienne allure par support');
console.log('kite :', await setSelect(SPORT_SELECT, 'kite'));
await wait(2500);
console.log('wingfoil :', await setSelect(SPORT_SELECT, 'wingfoil'));
await wait(2500);
console.log('réglages :', await sportSettings());

step('Console');
console.log('dialogues :', dialogs.length ? dialogs.join(' / ') : 'aucun');
console.log(logs.length ? logs.join('\n') : 'aucune erreur');
ws.close();
