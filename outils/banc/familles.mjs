// Banc de test : familles repliables dans Réglages (lot 2 des demandes du 15/10).
// Usage : node familles.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 30 s. Le script :
//  1. avec `DUMP=x.txt`, ouvre toutes les familles, toutes les activités et toutes leurs parties, et relève le texte
//     de la liste des activités ; avec `RELEVE_SEUL=1`, il s'arrête là (pour la version d'avant le lot) ;
//  2. vérifie, sur un profil neuf : les cinq en-têtes de famille, aucune carte d'activité ;
//  3. « Voile » ouverte : ses activités, l'œil qui cache la famille sans la replier, puis la rend ;
//  4. après rechargement : Voile toujours ouverte, les autres fermées ;
//  5. une activité ajoutée en surf : la famille Surf s'ouvre, la carte de l'activité aussi ;
//  6. à 390×844 : aucun débordement, familles fermées puis ouvertes.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node familles.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';
const DUMP = process.env.DUMP;
const RELEVE_SEUL = process.env.RELEVE_SEUL === '1';

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
const check = (what, ok) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}`); if (!ok) failures++; };
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

const FAMILIES = ['voile', 'course', 'velo', 'fractionne', 'surf'];
const PARTS = ['affichage', 'analyse', 'enregistrement', 'notification', 'itineraires', 'balises'];
/** Mémoire des blocs : Activités ouvert, et ce que `extra` y ajoute. */
const seedSections = (extra) => evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections.settings = { ...sections.settings, activites: true };
  Object.assign(sections, ${JSON.stringify(extra)});
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
const familyToggles = `[...document.querySelectorAll('.settings-activities__family-toggle')]`;
const familyToggle = (label) => `${familyToggles}.find((b) => b.querySelector('.settings-activities__family-name')?.textContent.trim() === ${JSON.stringify(label)})`;
const cardCount = () => evaluate(`document.querySelectorAll('.settings-activity').length`);

// --- 1. Relevé du texte des cartes, tout ouvert ---
await go('/parametres', 3000);
if (DUMP) {
  await seedSections({
    'settings-families': Object.fromEntries(FAMILIES.map((f) => [f, true])),
    'settings-activity-parts': Object.fromEntries(PARTS.map((p) => [p, true])),
  });
  await go('/parametres', 3000);
  await evaluate(`(() => { document.querySelectorAll('.settings-activity__toggle[aria-expanded="false"]').forEach((b) => b.click()); return 'ok'; })()`);
  await wait(800);
  const text = await evaluate(`[...document.querySelectorAll('.settings-activity')].map((c) => c.innerText).join('\\n----\\n')`);
  writeFileSync(DUMP, text ?? '');
  console.log(`Relevé : ${await cardCount()} cartes dans ${DUMP}`);
  if (RELEVE_SEUL) { await finish(); process.exit(0); }
  // Profil remis à neuf pour la suite.
  await evaluate(`(() => { localStorage.clear(); return 'ok'; })()`);
  await go('/parametres', 3000);
}

// --- 2. Profil neuf : familles fermées ---
await seedSections({});
await go('/parametres', 3000);
const labels = await evaluate(`${familyToggles}.map((b) => b.querySelector('.settings-activities__family-name')?.textContent.trim()).join(' | ')`);
console.log('Familles :', labels);
check('cinq en-têtes de famille', (await evaluate(`${familyToggles}.length`)) === 5);
check('toutes fermées', (await evaluate(`${familyToggles}.every((b) => b.getAttribute('aria-expanded') === 'false')`)) === true);
check('aucune carte d\'activité', (await cardCount()) === 0);
console.log('Résumé de Voile fermée :', await evaluate(`${familyToggle('Voile')}?.querySelector('.settings-activities__family-summary')?.textContent`));
await shoot('familles-fermees');

// --- 3. Voile ouverte, son œil ---
await evaluate(`${familyToggle('Voile')}?.click()`);
await wait(400);
const voileCards = await cardCount();
check(`Voile ouverte : ${voileCards} carte(s)`, voileCards > 0 && (await evaluate(`${familyToggle('Voile')}?.getAttribute('aria-expanded')`)) === 'true');
const eye = `${familyToggle('Voile')}?.parentElement.querySelector('.settings-eye')`;
await evaluate(`${eye}?.click()`);
await wait(400);
check('l\'œil cache la famille sans la replier',
  (await evaluate(`${familyToggle('Voile')}?.getAttribute('aria-expanded')`)) === 'true' &&
  (await evaluate(`${eye}?.getAttribute('aria-pressed')`)) === 'true' &&
  (await cardCount()) === voileCards);
await evaluate(`${eye}?.click()`);
await wait(400);
check('l\'œil rend la famille', (await evaluate(`${eye}?.getAttribute('aria-pressed')`)) === 'false');

// Menu « … » de la carte d'activité (27/10) : trois entrées, « Par défaut » grisé puis actif après une modification.
const menuCard = `document.querySelector('.settings-activity')`;
const menuState = () => evaluate(`(() => {
  const c = ${menuCard};
  if (!c?.querySelector('.settings-activity__head > .ui-more .ui-more__button')) return null;
  return [...c.querySelectorAll('.ui-more__panel button')].map((b) => b.textContent.trim() + (b.disabled ? ' (grisé)' : '')).join(' | ');
})()`);
check("carte d'activité : menu « … » à trois entrées, « Par défaut » grisé", (await menuState()) === 'Renommer | Supprimer | Par défaut (grisé)', await menuState());
await evaluate(`${menuCard}.querySelector('.settings-activity__toggle[aria-expanded="false"]')?.click()`);
await wait(300);
await evaluate(`[...${menuCard}.querySelectorAll('.settings-part__toggle')].find((b) => b.textContent.trim() === 'Affichage' && b.getAttribute('aria-expanded') === 'false')?.click()`);
await wait(300);
await evaluate(`(() => {
  const sel = ${menuCard}.querySelector('.settings-activity__body select');
  const other = [...sel.options].find((o) => o.value !== sel.value);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, other.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await wait(400);
check('après une modification, « Par défaut » actif', (await menuState()) === 'Renommer | Supprimer | Par défaut', await menuState());

// --- 4. Après rechargement ---
await go('/parametres', 3000);
check('Voile toujours ouverte après rechargement', (await evaluate(`${familyToggle('Voile')}?.getAttribute('aria-expanded')`)) === 'true');
check('les autres toujours fermées', (await evaluate(`${familyToggles}.filter((b) => b.getAttribute('aria-expanded') === 'true').length`)) === 1);
check('mémorisé dans tracker.sections', (await evaluate(`JSON.parse(localStorage.getItem('tracker.sections') ?? '{}')['settings-families']?.voile`)) === true);

// --- 5. Activité ajoutée en surf ---
const added = await evaluate(`(() => {
  const name = document.querySelector('input[aria-label="Nom de la nouvelle activité"]');
  const family = document.querySelector('.settings-add select[aria-label="Famille"]');
  if (!name || !family) return 'formulaire absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(family, 'surf');
  family.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await wait(200);
await evaluate(`(() => {
  const name = document.querySelector('input[aria-label="Nom de la nouvelle activité"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Kayak de mer');
  name.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await wait(200);
await evaluate(`[...document.querySelectorAll('.settings-add button')].find((b) => b.textContent.trim() === 'Ajouter')?.click()`);
await wait(600);
check(`ajout (${added}) : famille Surf ouverte`, (await evaluate(`${familyToggle('Surf')}?.getAttribute('aria-expanded')`)) === 'true');
check('carte de l\'activité ajoutée ouverte',
  (await evaluate(`[...document.querySelectorAll('.settings-activity__toggle[aria-expanded="true"] .settings-activity__name')].some((i) => i.textContent === 'Kayak de mer')`)) === true);
await shoot('familles-ajout');

// --- 6. À 390×844 ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await seedSections({ 'settings-families': {} });
await go('/parametres', 3000);
check('390 px, familles fermées : aucun débordement', (await overflow()) === 0);
await shoot('familles-390-fermees');
await evaluate(`${familyToggles}.forEach((b) => b.click())`);
await wait(500);
check('390 px, familles ouvertes : aucun débordement', (await overflow()) === 0);
await shoot('familles-390-ouvertes');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

await finish();
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
