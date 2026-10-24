// Banc de test : barre d'onglets repliable des analyses, régularité depuis la plus vieille session, et dernier
// affichage des statistiques retenu (lot 1 des demandes du 16/10).
// Usage : node barre.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 1 min. Le script :
//  1. importe une course (10 jours avant aujourd'hui) et une session de voile (`make-gpx.mjs`, 20 jours avant) ;
//  2. dans l'analyse de la course : la flèche en fin de barre, qui cache la barre seule (panneaux ouverts gardés) et
//     laisse le bouton fin « onglets » ; caché après rechargement et dans l'analyse de voile ; le bouton fin rend la
//     barre et disparaît ; à 390×844, sans débordement ;
//  3. statistiques : Course sur « Année », « Semaines actives » comptées depuis la course, pas sur 52 semaines ;
//  4. le dernier affichage repris à l'ouverture sans paramètre, une adresse avec paramètres qui l'emporte, « Tout »
//     retenu aussi.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node barre.mjs <port> [<dossier des captures>]');
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
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push(JSON.parse(await (await h.getFile()).text()));
  return list;
})()`);
const importGpx = (gpx, name) => evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(gpx)}], ${JSON.stringify(name)}, { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
let failures = 0;
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
const desktop = () => send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await desktop();

// --- 1. Sessions ---
const DAY = 86_400_000;
const lineGpx = (type, seconds, speed, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= seconds; k++) {
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + (k * speed) / mPerDegLon).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Ligne</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const today = new Date();
const T_RUN = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8).getTime() - 10 * DAY;
const voilePath = join(tmpdir(), 'barre-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);
// Décale la voile à 20 jours avant aujourd'hui.
const voileRaw = readFileSync(voilePath, 'utf8');
const firstTime = Date.parse(voileRaw.match(/<time>([^<]+)<\/time>/)[1]);
const shift = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14).getTime() - 20 * DAY - firstTime;
const voileGpx = voileRaw.replace(/<time>([^<]+)<\/time>/g, (_, t) => `<time>${new Date(Date.parse(t) + shift).toISOString()}</time>`);
const T_VOILE = firstTime + shift;

const paths = {};
for (const [page, start, gpx] of [['course', T_RUN, lineGpx('running', 1800, 3, T_RUN)], ['voile', T_VOILE, voileGpx]]) {
  await go(`/${page}`, 3000);
  await importGpx(gpx, `${page}.gpx`);
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - start) < 2000);
  paths[page] = `/${page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${page} rangée`, Boolean(rec));
}

// --- 2. Barre repliable ---
const bar = () => evaluate(`(() => {
  const col = document.querySelector('.an-carte-col');
  return {
    tabs: col ? col.querySelectorAll('.ui-tab').length : -1,
    arrow: Boolean(col?.querySelector('.an-tabs-hide')),
    reveal: Boolean(col?.querySelector('.an-tabs-reveal')),
    revealHeight: col?.querySelector('.an-tabs-reveal')?.getBoundingClientRect().height ?? 0,
    panels: document.querySelectorAll('.an-carte-panels > *').length,
    arrowLast: col?.querySelector('.ui-tabs')?.lastElementChild?.classList.contains('an-tabs-hide') ?? false,
  };
})()`);
const click = (selector) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);

await go(paths.course, 6000);
let b = await bar();
check('course : barre visible, flèche en fin de rangée, pas de bouton fin', b.tabs > 0 && b.arrow && b.arrowLast && !b.reveal, JSON.stringify(b));
const panelsBefore = b.panels;
await click('.an-tabs-hide');
await wait(500);
b = await bar();
check('flèche : barre cachée, bouton fin seul, panneaux gardés', b.tabs === 0 && !b.arrow && b.reveal && b.panels === panelsBefore, JSON.stringify(b));
await shoot('barre-cachee-ordinateur');
await go(paths.course, 6000);
b = await bar();
check('cachée après rechargement', b.tabs === 0 && b.reveal, JSON.stringify(b));
await go(paths.voile, 8000);
b = await bar();
check('cachée aussi dans la voile', b.tabs === 0 && b.reveal, JSON.stringify(b));
await click('.an-tabs-reveal');
await wait(500);
b = await bar();
check('bouton fin : barre rendue, bouton disparu', b.tabs > 0 && b.arrow && !b.reveal, JSON.stringify(b));
await go(paths.course, 6000);
b = await bar();
check('rendue aussi dans la course', b.tabs > 0 && !b.reveal, JSON.stringify(b));

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.course, 6000);
check('390 px, barre visible : pas de débordement', (await overflow()) <= 0);
await shoot('barre-visible-390');
await click('.an-tabs-hide');
await wait(500);
b = await bar();
check('390 px, barre cachée : bouton fin, sans débordement', b.reveal && b.revealHeight > 0 && b.revealHeight <= 26 && (await overflow()) <= 0, `hauteur ${b.revealHeight}`);
await shoot('barre-cachee-390');
await click('.an-tabs-reveal');
await wait(300);
await desktop();

// --- 3. Régularité ---
// Pastilles repliées sous « Sélection » depuis le 17/10 : déplier d'abord.
const chip = (group, label) => evaluate(`(() => {
  const fold = document.querySelector('.stats-choice > button[data-chart-fold][aria-expanded=false]');
  if (fold) fold.click();
  return new Promise((r) => setTimeout(r, 300));
})()`).then(() => evaluate(`(() => {
  const g = document.querySelector('[role=group][aria-label=${JSON.stringify(group)}], [role=radiogroup][aria-label=${JSON.stringify(group)}]');
  const b = g && [...g.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent'; b.click(); return 'ok';
})()`));
const stat =(label) => evaluate(`(() => {
  const s = [...document.querySelectorAll('.an-sheet__stat')].find((x) => x.querySelector('.an-sheet__stat-label')?.textContent.trim() === ${JSON.stringify(label)});
  return s?.querySelector('.an-sheet__stat-value')?.textContent.trim() ?? '(absent)';
})()`);
const search = () => evaluate('location.search');
await go('/statistiques', 4000);
await chip('Famille', 'À pied');
await wait(800);
await chip('Période', 'Année');
await wait(800);
const active = await stat('Semaines actives');
const weeks = Number(active.split('/')[1]);
check('Course sur « Année » : semaines comptées depuis la course', weeks >= 1 && weeks <= 3, active);

// --- 4. Dernier affichage ---
await go('/', 3000);
await go('/statistiques', 4000);
check('reprise sans paramètre : Course, Année', (await search()) === '?famille=course&periode=annee', await search());
check('sous-titre de Course', (await evaluate(`document.querySelector('.ui-page-header')?.innerText ?? ''`)).includes('À pied'));
await go('/statistiques?famille=voile', 4000);
check('une adresse avec paramètres l’emporte', (await search()) === '?famille=voile', await search());
await chip('Famille', 'Tout');
await wait(500);
await chip('Période', 'Tout');
await wait(500);
await go('/', 3000);
await go('/statistiques', 4000);
check('« Tout » retenu : pas de paramètre', (await search()) === '', await search());

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(failures === 0 ? 0 : 1);
