// Banc de test : aides de Réglages sous des « ? » (lot 3 des demandes du 19/10).
// Usage : node reglages-aide.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 40 s. Le script :
//  1. ouvre tous les blocs, toutes les familles, activités et parties : plus aucun `title` sur une ligne de
//     réglage, plus de grande note sous les activités, aucune aide dépliée au départ ;
//  2. ouvre chaque « ? » de la page, un par un : son texte, court, apparaît seul, et le suivant referme le
//     précédent ; un second appui referme ;
//  3. le « ? » d'un bloc (Activités) ne replie pas le bloc, son texte se déplie sous le titre ;
//  4. à 390×844 : aucun débordement, une aide ouverte comprise ;
//  5. hors de Réglages, rien ne change : l'éditeur des bips d'un parcours (Itinéraires) garde son mode d'emploi.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node reglages-aide.mjs <port> [<dossier des captures>]');
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
const helps = `[...document.querySelectorAll('button.ui-help')]`;
const openTexts = () => evaluate(`[...document.querySelectorAll('.settings-help')].map((p) => p.textContent.trim())`);

// --- 1. Tout ouvert, aucune aide dépliée ---
await go('/parametres', 3000);
await openAll();
const count = await evaluate(`${helps}.length`);
console.log('« ? » sur la page :', count);
check('des « ? » partout (plus de 100, neuf activités ouvertes)', count > 100, count);
check('plus aucun title sur une ligne de réglage', (await evaluate(`document.querySelectorAll('.settings-row[title]').length`)) === 0);
check('plus de grande note sous les activités', (await evaluate(`document.querySelectorAll('.settings-block__note').length`)) === 0);
check('aucune aide dépliée au départ', (await openTexts()).length === 0);
check('chaque « ? » nommé « Aide : … »', await evaluate(`${helps}.every((b) => b.getAttribute('aria-label')?.startsWith('Aide : '))`));

// --- 2. Chaque « ? », un par un ---
const sweep = await evaluate(`(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 30));
  const buttons = [...document.querySelectorAll('button.ui-help')];
  const bad = [];
  let longest = 0;
  for (const [k, b] of buttons.entries()) {
    b.click();
    await pause();
    const texts = [...document.querySelectorAll('.settings-help')].map((p) => p.textContent.trim());
    if (texts.length !== 1 || texts[0] === '' || b.getAttribute('aria-expanded') !== 'true') bad.push(k + ' ' + b.getAttribute('aria-label') + ' : ' + texts.length);
    longest = Math.max(longest, texts[0]?.length ?? 0);
  }
  const last = buttons[buttons.length - 1];
  last.click();
  await pause();
  return { bad, longest, closed: document.querySelectorAll('.settings-help').length === 0 };
})()`);
check('chaque « ? » déplie un texte, seul (le suivant referme le précédent)', sweep.bad.length === 0, sweep.bad.slice(0, 5).join(' | '));
check('textes courts (moins de 260 signes)', sweep.longest < 260, sweep.longest);
check('un second appui referme', sweep.closed === true);

// Le « ? » du seuil de Voile : son texte, sous sa ligne.
const seuil = await evaluate(`(async () => {
  const card = [...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('[aria-label="Couleur de Voile"]'));
  const row = [...(card?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === "Seuil d'activité");
  row?.querySelector('.ui-help')?.click();
  await new Promise((r) => setTimeout(r, 50));
  return { label: row?.querySelector('.settings-row__label')?.textContent, text: row?.querySelector('.settings-help')?.textContent ?? '(absente)' };
})()`);
check('seuil de Voile : le libellé garde son texte seul', seuil.label === "Seuil d'activité", seuil.label);
check('seuil de Voile : aide sous la ligne', seuil.text.includes('en action'), seuil.text);
await shoot('aide-seuil');

// --- 3. Le « ? » d'un bloc ne le replie pas ---
const block = await evaluate(`(async () => {
  const b = document.querySelector('button.ui-help[aria-label="Aide : Activités"]');
  if (!b) return null;
  b.click();
  await new Promise((r) => setTimeout(r, 50));
  return { open: document.querySelector('.settings-activities') !== null, texts: [...document.querySelectorAll('.settings-help')].map((p) => p.textContent) };
})()`);
check('bloc Activités : toujours ouvert après son « ? »', block?.open === true);
check('bloc Activités : son aide seule, le seuil refermé', block?.texts.length === 1 && block.texts[0].includes("L'œil"), block?.texts.join(' | '));

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await openAll();
check('390×844, tout ouvert : aucun débordement', (await overflow()) === 0, await overflow());
await evaluate(`(() => {
  const card = [...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('[aria-label="Couleur de Route"]'));
  const row = [...(card?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === 'Type de vélo');
  row?.querySelector('.ui-help')?.click();
  row?.scrollIntoView({ block: 'center' });
  return 'ok';
})()`);
await wait(300);
check('390×844, aide du type de vélo ouverte : aucun débordement', (await overflow()) === 0 && (await openTexts()).length === 1, await overflow());
await shoot('aide-telephone');

// --- 5. Hors de Réglages ---
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/itineraires', 3000);
console.log('Régler pour ce parcours :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Régler pour ce parcours');
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(500);
const routes = await evaluate(`document.body.innerText`);
const routeHelps = await evaluate(`${helps}.filter((b) => b.getAttribute('aria-label')?.startsWith('Aide : ')).length`);
check("Itinéraires : les bips du parcours gardent leur mode d'emploi, sans « ? » d'aide", routes.includes('Tirez un point') && routeHelps === 0, routeHelps);

console.log(`\n${failures === 0 ? 'Tout est passé.' : `${failures} échec(s).`}`);
await finish();
process.exit(failures === 0 ? 0 : 1);
