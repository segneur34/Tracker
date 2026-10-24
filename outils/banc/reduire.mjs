// Banc de test : « Tout réduire » et nom ou pseudo de Réglages (demandes du 19/10 au soir).
// Usage : node reduire.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 20 s. Le script :
//  1. ouvre tous les blocs, familles, activités et parties, un choix d'icône et une aide, puis appuie sur
//     « Tout réduire » : plus rien d'ouvert sur la page, et après rechargement non plus ;
//  2. saisit un pseudo dans Pratiquant : il devient le titre du Profil ; effacé, le titre redevient « Profil » ;
//  3. à 390×844 : l'en-tête et son bouton sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node reduire.mjs <port> [<dossier des captures>]');
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
  if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
let failures = 0;
const check = (what, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures++; };
const finish = async () => {
  console.log('\n--- console (erreurs, avertissements) ---');
  logs.forEach((l) => console.log(l));
  await send('Page.close').catch(() => undefined);
  ws.close();
};

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

/** Tout ouvert : blocs, familles, parties des activités (mémoire des blocs), puis chaque carte d'activité. */
const openAll = async () => {
  await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
    s.settings = { memoire: true, autorisations: true, activites: true, enregistrement: true, capteurs: true, cartes: true, coureur: true };
    s['settings-families'] = { voile: true, course: true, velo: true, fractionne: true, surf: true };
    s['settings-activity-parts'] = { affichage: true, analyse: true, enregistrement: true, itineraires: true, balises: true };
    localStorage.setItem('tracker.sections', JSON.stringify(s));
    return 'ok';
  })()`);
  await go('/parametres', 3000);
  await evaluate(`(() => { document.querySelectorAll('.settings-activity__toggle[aria-expanded="false"]').forEach((b) => b.click()); return 'ok'; })()`);
  await wait(800);
};
const openCount = () => evaluate(`document.querySelectorAll('[aria-expanded="true"]').length`);
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);

// --- 1. Tout réduire ---
await go('/parametres', 3000);
await openAll();
await evaluate(`(() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Changer')?.click(); return 'ok'; })()`);
await wait(200);
await evaluate(`(() => { document.querySelector('button.ui-help')?.click(); return 'ok'; })()`);
await wait(200);
const before = await openCount();
const grids = await evaluate(`document.querySelectorAll('.icon-picker__grid').length`);
const helpsOpen = await evaluate(`document.querySelectorAll('.settings-help').length`);
console.log('ouverts avant :', before, '; grille d icônes :', grids, '; aides :', helpsOpen);
check('avant : beaucoup d ouverts, une grille d icônes, une aide', before > 20 && grids === 1 && helpsOpen === 1, before);
await shoot('reduire-avant');
check('bouton « Tout réduire » présent', await clickText('Tout réduire'));
await wait(500);
check('après : plus rien d ouvert', (await openCount()) === 0, await openCount());
check('après : ni grille d icônes ni aide', (await evaluate(`document.querySelectorAll('.icon-picker__grid, .settings-help').length`)) === 0);
const mem = await evaluate(`JSON.parse(localStorage.getItem('tracker.sections') ?? '{}')`);
const anyTrue = ['settings', 'settings-families', 'settings-activity-parts', 'settings-activities'].some((k) => Object.values(mem[k] ?? {}).some(Boolean));
check('mémoire : tout à false', !anyTrue);
await shoot('reduire-apres');
await go('/parametres', 3000);
check('après rechargement : toujours tout replié', (await openCount()) === 0, await openCount());
// Rouvrir une activité puis un choix d'icône, après un « Tout réduire » : ça s'ouvre de nouveau.
await openAll();
await evaluate(`(() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Changer')?.click(); return 'ok'; })()`);
await wait(200);
check('le choix d icône se rouvre après un « Tout réduire »', (await evaluate(`document.querySelectorAll('.icon-picker__grid').length`)) === 1);
await clickText('Tout réduire');
await wait(300);

// --- 2. Pseudo ---
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); s.settings = { ...s.settings, coureur: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); return 'ok'; })()`);
await go('/parametres', 3000);
const setPseudo = (v) => evaluate(`(() => {
  const input = document.querySelector('input[autocomplete="nickname"]');
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(v)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
check('champ « Nom ou pseudo » dans Pratiquant', (await setPseudo('Tom le rider ')) === true);
await wait(300);
check('le libellé est là', (await evaluate(`document.body.innerText`)).includes('Nom ou pseudo'));
await shoot('pseudo-reglages');
await go('/profil', 3000);
check('Profil : le pseudo en titre', (await evaluate(`document.querySelector('h1')?.textContent`)) === 'Tom le rider', await evaluate(`document.querySelector('h1')?.textContent`));
await go('/parametres', 3000);
await setPseudo('');
await wait(300);
await go('/profil', 3000);
check('Profil : sans pseudo, « Profil »', (await evaluate(`document.querySelector('h1')?.textContent`)) === 'Profil');

// --- 3. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/parametres', 3000);
check('390×844 : aucun débordement', (await overflow()) === 0, await overflow());
await shoot('reduire-telephone');

console.log(`
${failures === 0 ? 'Tout est passé.' : `${failures} échec(s).`}`);
await finish();
process.exit(failures === 0 ? 0 : 1);
