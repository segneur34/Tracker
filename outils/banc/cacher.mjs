// Banc de test : cacher une famille et une activité (§10, point 100).
// Usage : node cacher.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même une sortie à vélo, l'importe par la page Vélo
// (rangée sous Route, la première activité de vélo), et vérifie :
//  1. le relevé de départ : barre du haut, barre du bas, accueil, bibliothèque Vélo, Enregistrer ;
//  2. Surf caché puis Route caché, depuis leur œil dans Réglages : Surf absent des barres, de l'accueil et
//     d'Enregistrer, la barre du bas inchangée (sans sport) ; la session de Route retirée de la bibliothèque, une ligne
//     le dit ; Route absente d'Enregistrer ; tous deux toujours listés dans Réglages, grisés ;
//  3. la dernière famille visible ne se cache pas : son œil est désactivé ;
//  4. tout ré-affiché : chaque relevé redevient celui du départ, à la lettre.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node cacher.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

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
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push(`error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable');
await send('Runtime.enable');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Sortie à vélo synthétique : 20 min à 6 m/s vers l'est ---
const t0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const points = [];
for (let k = 0; k <= 1200; k++) {
  points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * 6) / 80500).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sortie</name><type>cycling</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;

/** Clique le bouton dont le texte ou l'étiquette est donné ; rend vrai s'il existe et n'est pas désactivé. */
const click = (selector, text) => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => (el.getAttribute('aria-label') ?? el.textContent).trim().startsWith(${JSON.stringify(text)}));
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`);

/** Ouvre un bloc de Réglages par son titre (`PanelTitle`), si `probe` (un sélecteur de son contenu) n'y est pas encore. */
const openBlock = (label, probe) => evaluate(`(() => {
  if (document.querySelector(${JSON.stringify(probe)})) return true;
  const b = [...document.querySelectorAll('[role=button]')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
  b?.click();
  return !!b;
})()`);

/** Relevé de l'application : les deux barres, puis le texte de chaque page. */
const snapshot = async () => {
  const out = {};
  await go('/');
  out.barreHaut = await evaluate(`document.querySelector('.shell-toplinks')?.textContent`);
  out.barreBas = await evaluate(`[...document.querySelectorAll('.shell-tabbar .shell-tab')].map((t) => t.textContent.trim()).join(' | ')`);
  out.accueil = await evaluate('document.querySelector(".shell-main").innerText');
  await go('/velo', 4000);
  out.velo = await evaluate('document.querySelector(".shell-main").innerText');
  await go('/enregistrer');
  out.enregistrer = await evaluate('document.querySelector(".shell-main").innerText');
  await click('.ui-tab', 'Vélo');
  await wait(300);
  out.enregistrerVelo = await evaluate(`[...document.querySelectorAll('.shell-main select option')].map((o) => o.textContent).join(', ')`);
  return out;
};

// --- Mise en place ---
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/velo', 5000);
console.log('import :', await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(gpx)}], 'sortie.gpx', { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(5000);

await go('/parametres');
await openBlock('Activités', '.settings-activities');
await wait(300);
// Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
await wait(300);
// --- 1. Départ ---
const before = await snapshot();
console.log('\n--- départ ---');
for (const [k, v] of Object.entries(before)) console.log(`${k} : ${String(v).replace(/\s+/g, ' ').slice(0, 220)}`);
check('la session est sous Route', before.velo.includes('Route'));
check('barre du bas : Accueil, Profil, Statistiques, Réglages', before.barreBas === 'Accueil | Profil | Statistiques | Réglages', before.barreBas);

// --- 2. Surf, puis Route, cachés ---
await go('/parametres');
check('œil « Cacher Surf »', await click('.settings-eye', 'Cacher Surf'));
await wait(300);
check('œil « Cacher Route »', await click('.settings-eye', 'Cacher Route'));
await wait(300);
const settingsText = await evaluate('document.querySelector(".shell-main").innerText');
const greyed = await evaluate(`[...document.querySelectorAll('.settings-activity--hidden .settings-activity__name')].map((n) => n.textContent).join(', ')`);
check('Surf et Route toujours listés dans Réglages', settingsText.includes('Surf foil') && settingsText.includes('Route'));
check('grisés : Route, Surf, Surf foil', greyed === 'Route, Surf, Surf foil', greyed);
await shoot('cacher-reglages');

const hidden = await snapshot();
console.log('\n--- caché ---');
for (const [k, v] of Object.entries(hidden)) console.log(`${k} : ${String(v).replace(/\s+/g, ' ').slice(0, 220)}`);
check('barre du haut sans Surf', !hidden.barreHaut.includes('Surf'), hidden.barreHaut);
check('barre du bas inchangée', hidden.barreBas === before.barreBas, hidden.barreBas);
check("accueil sans la carte Surf", !hidden.accueil.includes('Vagues, temps sur la vague'));
check('bibliothèque Vélo : session retirée et signalée', hidden.velo.includes('Activités cachées : 1 session') && hidden.velo.includes('0 session'));
check("Enregistrer sans l'onglet Surf", !/\bSurf\b/.test(hidden.enregistrer));
check('Enregistrer › Vélo sans Route', hidden.enregistrerVelo === 'Gravel, VTT', hidden.enregistrerVelo);
await go('/surf', 4000);
check('/surf s’ouvre toujours, et dit qu’il est caché', (await evaluate('document.querySelector(".shell-main").innerText')).includes('est caché dans'));

// --- 3. Dernière famille ---
await go('/parametres');
for (const f of ['Voile', 'À pied', 'Fractionné']) await click('.settings-eye', `Cacher ${f}`);
await wait(300);
const lastDisabled = await evaluate(`[...document.querySelectorAll('.settings-eye')].find((b) => b.getAttribute('aria-label').startsWith('Vélo'))?.disabled`);
check('le Vélo, dernière famille visible, ne se cache pas', lastDisabled === true);
await shoot('cacher-derniere');
for (const f of ['Voile', 'À pied', 'Fractionné']) await click('.settings-eye', `Afficher ${f}`);

// --- 4. Tout ré-affiché ---
check('œil « Afficher Surf »', await click('.settings-eye', 'Afficher Surf'));
await wait(300);
check('œil « Afficher Route »', await click('.settings-eye', 'Afficher Route'));
await wait(300);
const after = await snapshot();
for (const k of Object.keys(before)) check(`ré-affiché, ${k} identique au départ`, before[k] === after[k], before[k] === after[k] ? '' : String(after[k]).replace(/\s+/g, ' ').slice(0, 220));

console.log(`\n${failures === 0 ? 'Tout passe' : `${failures} échec(s)`}`);
if (logs.length) console.log('Console :\n' + logs.join('\n'));
ws.close();
process.exit(failures === 0 ? 0 : 1);
