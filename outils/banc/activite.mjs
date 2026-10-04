// Banc de test : activité de la trace suivie, changement d'activité pendant l'enregistrement,
// carte réduite, changement d'activité depuis l'analyse (voile ↔ course).
// Usage : node activite.mjs <port> <gpx de voile, chemin Windows> [<dossier des captures>]
// Le GPX vient de `make-gpx.mjs`. Sur un profil où deux itinéraires sont rangés, l'un en Voile et
// l'autre en Course (`planning.mjs` deux fois, le second avec un GPX de type course), le script
// vérifie aussi que suivre un itinéraire propose son activité.
import { writeFileSync } from 'node:fs';

const [port, gpxPath, shotDir] = process.argv.slice(2);
if (!port || !gpxPath) {
  console.error('Usage : node activite.mjs <port> <gpx de voile> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const dialogs = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    void send('Page.handleJavaScriptDialog', { accept: true });
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const clickText = (text, scope = 'button') => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)}) && !x.disabled); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
/** Choisit une option, par son texte : dans le menu natif qui la contient (le premier trouvé), sinon dans un choix d'activité. */
const chooseOption = (text) => evaluate(`(async () => {
  const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === ${JSON.stringify(text)} && !o.disabled));
  if (select) {
    const option = [...select.options].find((o) => o.textContent === ${JSON.stringify(text)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }
  // Choix d'activité (ActivitySelect) : le bouton ouvre la liste, puis l'activité s'y choisit.
  for (const button of document.querySelectorAll('button.activity-select:not(:disabled)')) {
    button.click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...document.querySelectorAll('.activity-select__option')].find((o) => o.textContent.trim() === ${JSON.stringify(text)});
    if (item) { item.click(); return 'ok'; }
    document.querySelector('.activity-select__backdrop')?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'absent';
})()`);
const lines = (pattern) => evaluate(`document.body.innerText.split('\\n').filter((l) => ${pattern}.test(l)).join(' | ')`);
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
/** Famille et activité choisies sur la page Enregistrer, au repos. */
const recordChoice = () => evaluate(`JSON.stringify({
  famille: document.querySelector('[aria-label=Famille] [aria-pressed=true]')?.textContent ?? null,
  activite: [...document.querySelectorAll('select')].find((s) => s.closest('label')?.textContent.includes('Activité'))?.selectedOptions[0]?.textContent ?? null,
})`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.navigate', { url: `${BASE}/` });
await wait(2500);
// Onglets réglages ouverts dans les deux modules.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ 'sailing-onglets': { reglages: true }, running: { reglages: true } })); 'ok'`);

// 1. Suivre un itinéraire propose son activité.
await send('Page.navigate', { url: `${BASE}/enregistrer` });
await wait(2500);
console.log('au départ :', await recordChoice());
const routeCount = await evaluate(`(async () => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Suivre une trace')).click();
  await new Promise((r) => setTimeout(r, 800));
  return document.querySelectorAll('ul li button').length;
})()`);
console.log('itinéraires :', routeCount);
for (let i = 0; i < Math.min(routeCount, 3); i++) {
  await evaluate(`(async () => {
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Suivre une trace'));
    if (!document.querySelector('ul li button')) { open.click(); await new Promise((r) => setTimeout(r, 800)); }
    document.querySelectorAll('ul li button')[${i}].click();
  })()`);
  await wait(800);
  console.log(`itinéraire ${i + 1} suivi :`, await recordChoice(), await lines('/Trace suivie/'));
}
console.log('Retirer :', await clickText('Retirer'));
await wait(300);

// 2. Enregistrement en rejeu à ×10 : Voile, puis Course en route ; carte réduite.
console.log('famille Voile :', await clickText('Voile', '[aria-label=Famille] button'));
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await setFile('input[type=file]', gpxPath);
await wait(800);
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(12000);
console.log('en voile :', await lines('/^(Top|Bord|Distance)/'));
console.log('vers Course :', await chooseOption('Course'));
await wait(4000);
console.log('en course :', await lines('/^(Allure|Dernier|D\\+|D−|Distance)/'));
await shoot('enregistrement-course');
console.log('Réduire la carte :', await clickText('Réduire la carte'));
await wait(2500);
console.log('carte montée :', await evaluate(`document.querySelectorAll('.leaflet-container').length`));
console.log('résumé :', await lines('/^(Allure|Allure moyenne|Meilleure allure)/'));
console.log('mémorisé :', await evaluate(`localStorage.getItem('tracker.sections')`));
await shoot('carte-reduite');
if (shotDir) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(2500);
  await shoot('carte-reduite-telephone');
  await send('Emulation.clearDeviceMetricsOverride');
}
console.log('retour en Voile :', await chooseOption('Voile'));
await wait(3000);
console.log('résumé en voile :', await lines('/^(Vitesse|Moyenne|Max)/'));
console.log('vers Course :', await chooseOption('Course'));
await wait(1000);
console.log('Afficher la carte :', await clickText('Afficher la carte'));
await wait(1000);
console.log('carte montée :', await evaluate(`document.querySelectorAll('.leaflet-container').length`));
console.log('Arrêter :', await clickText('Arrêter'));
await wait(2500);
console.log('attente :', await lines('/points\\./'));
console.log('Analyser :', await clickText('Analyser'));
await wait(5000);
console.log('ouverte :', await evaluate(`location.pathname + location.search`), await evaluate(`document.querySelector('h1')?.textContent`));

// 3. Depuis l'analyse course, vers Voile : la session change de module.
console.log('vers Voile :', await chooseOption('Voile'));
await wait(4000);
console.log('ouverte :', await evaluate(`location.pathname + location.search`), await evaluate(`document.querySelector('h1')?.textContent`));

// 4. Depuis l'analyse voile, avec un brouillon, vers Course : confirmation, puis bascule.
const draft = await evaluate(`(() => {
  const input = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Seuil d\\'activité'))?.querySelector('input');
  if (!input) return 'absent';
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, '4');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await wait(1500);
console.log('brouillon :', draft, await lines('/Non enregistr/'));
console.log('vers Course :', await chooseOption('Course'));
await wait(4000);
console.log('ouverte :', await evaluate(`location.pathname + location.search`), await evaluate(`document.querySelector('h1')?.textContent`));
console.log('brouillon en course :', await lines('/Non enregistr/') || 'aucun');

// 5. Bibliothèques : la session est rangée en course.
await send('Page.navigate', { url: `${BASE}/course` });
await wait(2500);
console.log('bibliothèque course :', await lines('/sessions? *$|Course ·|^Course$/'));

console.log('--- confirmations ---');
dialogs.forEach((d) => console.log(d));
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
