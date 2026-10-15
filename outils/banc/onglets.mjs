// Banc de test : onglets choisis par activité, et « tops » à pied et en surf (lot 3 des demandes du 14/10, seconde série).
// Usage : node onglets.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 2 min. Le script :
//  1. importe une course, une sortie à vélo, une session de surf et une session de voile (`make-gpx.mjs`), ouvre
//     tous les onglets de chaque analyse et, avec `DUMP=x`, relève leur texte dans `x-course.txt`, `x-velo.txt`,
//     `x-surf.txt` et `x-voile.txt` ; avec `RELEVE_SEUL=1`, il s'arrête là (pour la version d'avant le lot) ;
//  2. dans Réglages, partie Onglet analyse : la ligne « Onglets » de Voile, Course, Route, Fractionné à pied, Surf et
//     Surf foil, ses défauts (« tops » coché à vélo et en voile, pas à pied ni en surf ; « vols » sur foil seulement ;
//     pas de « sauts » en fractionné) ;
//  3. « tops » coché et « vagues » caché en surf, « tops » coché en course, « vmg » caché en voile, rangés ;
//  4. le surf : « tops » entre « rame » et « graphiques », « vagues » absent même laissé ouvert, le tableau,
//     « Voir » puis « Masquer », surbrillance effacée quand l'onglet se ferme ; la course : « tops » et ses
//     distances ; la voile : ni onglet ni panneau VMG ;
//  5. à 390×844 : Réglages et l'analyse de surf sans débordement ;
//  6. « Défaut » de la carte Surf : choix effacés, « tops » de nouveau caché.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node onglets.mjs <port> [<dossier des captures>]');
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
const tabLabels = () => evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent.trim()).join(' | ')`);
/** Ouvre un onglet s'il est fermé, le ferme s'il est ouvert et que `close` le demande. */
const clickTab = (label, close = false) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  const isOpen = t.getAttribute('aria-pressed') === 'true';
  if (isOpen !== ${close}) return isOpen ? 'déjà ouvert' : 'déjà fermé';
  t.click(); return 'ok';
})()`);
const openAllTabs = () => evaluate(`(() => {
  const tabs = [...document.querySelectorAll('.an-carte-col .ui-tab')].filter((t) => t.getAttribute('aria-pressed') !== 'true');
  tabs.forEach((t) => t.click());
  return tabs.length;
})()`);
/** Texte du panneau d'analyse dont le titre commence ainsi. */
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ') : '(absent)';
})()`);
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}`); if (!ok) failures++; };

// Le blocage par hôte ne vaut qu'avec `Network.enable` : sans lui, Overpass répond parfois (504), et le relevé change.
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions synthétiques ---
/** Trace droite, vitesse par seconde donnée par `speedAt`, `type` lu par l'import. */
const lineGpx = (type, seconds, speedAt, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  let m = 0;
  for (let k = 0; k <= seconds; k++) {
    const v = speedAt(k);
    if (k > 0) m += v;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + 0.02 * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${v}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Ligne</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
// Surf : la matinée de `surf.mjs`, phases [durée en s, vitesse en m/s, cap].
const M_PER_DEG_LAT = 111_195;
const surfGpx = (startMs, phases) => {
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const pts = [];
  const push = (speed, heading) => pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(startMs + t * 1000).toISOString()}</time>`
    + `<extensions><speed>${speed}</speed>${speed > 0 ? `<course>${heading}</course>` : ''}</extensions></trkpt>`);
  push(0, 0);
  for (const [s, speed, heading = 0] of phases) {
    for (let k = 0; k < s; k++) {
      lat += (speed * Math.cos((heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (speed * Math.sin((heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += 1;
      push(speed, heading);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Matinée</name><type>surf</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const MORNING = [
  [60, 0], [60, 1.2], [50, 1], [4, 0.1], [40, 1], [4, 0.1], [26, 1], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1],
  [5, 1.6, 180], [8, 4.5, 190], [80, 1], [30, 0.1],
];
const voilePath = join(tmpdir(), 'onglets-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);

const T_RUN = Date.UTC(2026, 9, 1, 8, 0, 0);
const T_BIKE = Date.UTC(2026, 9, 2, 8, 0, 0);
const T_SURF = Date.UTC(2026, 9, 3, 7, 0, 0);
const T_VOILE = Date.UTC(2026, 8, 20, 13, 0, 0);
const SESSIONS = [
  // Course : 40 min à 3 m/s, dont 80 s à 5 m/s (400 m).
  { page: 'course', start: T_RUN, gpx: lineGpx('running', 2400, (k) => (k >= 600 && k < 680 ? 5 : 3), T_RUN) },
  { page: 'velo', start: T_BIKE, gpx: lineGpx('cycling', 1800, (k) => (k >= 300 && k < 400 ? 11 : 7), T_BIKE) },
  { page: 'surf', start: T_SURF, gpx: surfGpx(T_SURF, MORNING) },
  { page: 'voile', start: T_VOILE, gpx: readFileSync(voilePath, 'utf8') },
];

// --- 1. Import et relevé ---
const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.page} :`, await importGpx(s.gpx, `${s.page}.gpx`));
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.page] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.page} rangée`, Boolean(rec));
}
for (const s of SESSIONS) {
  await go(paths[s.page], 6000);
  console.log(`${s.page}, onglets :`, await tabLabels());
  console.log('  ouverts :', await openAllTabs());
  await wait(5000);
  if (DUMP) writeFileSync(`${DUMP}-${s.page}.txt`, await evaluate('document.body.innerText'));
}
if (RELEVE_SEUL) {
  console.log('\n--- console (erreurs, avertissements) ---');
  logs.forEach((l) => console.log(l));
  await send('Page.close').catch(() => undefined);
  ws.close();
  process.exit(0);
}

// --- 2. Réglages : la ligne « Onglets » ---
const CARDS = { Voile: 'wingfoil', Course: 'running', Route: 'cycling', 'Fractionné à pied': 'run-intervals', Surf: 'surf', 'Surf foil': 'a-surf-foil' };
const openSettings = async () => {
  await go('/parametres', 3000);
  await evaluate(`(() => {
    const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
    sections.settings = { ...sections.settings, activites: true };
    sections['settings-activities'] = ${JSON.stringify(Object.fromEntries(Object.values(CARDS).map((k) => [k, true])))};
    sections['settings-activity-parts'] = { analyse: true };
    localStorage.setItem('tracker.sections', JSON.stringify(sections));
    return 'ok';
  })()`);
  await go('/parametres', 3000);
};
const nameSelector = `input[aria-label="Nom de l\\'activité"]`;
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector(${JSON.stringify(nameSelector)})?.value === ${JSON.stringify(name)})`;
const tabsRow = (name) => `[...(${card(name)}?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent.trim() === 'Onglets')`;
/** Pastilles de la ligne « Onglets » : « libellé » enfoncé, « (libellé) » relâché. */
const pills = (name) => evaluate(`(() => {
  const row = ${tabsRow(name)};
  if (!row) return '(pas de ligne)';
  return [...row.querySelectorAll('.ui-tab')].map((b) => b.getAttribute('aria-pressed') === 'true' ? b.textContent.trim() : '(' + b.textContent.trim() + ')').join(' ');
})()`);
const pressPill = (name, label) => evaluate(`(() => {
  const b = [...(${tabsRow(name)}?.querySelectorAll('.ui-tab') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const rowMark = (name) => evaluate(`${tabsRow(name)}?.querySelector('.settings-sports__mark')?.textContent ?? '(aucune)'`);
const storedTabs = () => evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').tabs ?? null)`);

await openSettings();
const shown = {};
for (const name of Object.keys(CARDS)) {
  shown[name] = await pills(name);
  console.log(`${name} :`, shown[name], '·', await rowMark(name));
}
check('Voile : tous montrés, « tops » et « sauts » compris', shown.Voile === 'général tops manœuvres graphiques vmg sauts vent matos et conditions réglages');
check('Course : « tops » relâché', shown.Course.includes('(tops)') && shown.Course.includes(' sauts '));
check('Route : « tops » enfoncé', / tops /.test(` ${shown.Route} `) && !shown.Route.includes('(tops)'));
check('Fractionné à pied : pas de « sauts »', !shown['Fractionné à pied'].includes('sauts') && shown['Fractionné à pied'].includes('fractionné'));
check('Surf : « tops » relâché, pas de « vols »', shown.Surf.includes('(tops)') && !shown.Surf.includes('vols'));
check('Surf foil : « vols »', shown['Surf foil'].includes('vols'));
check('« défaut » sans choix', (await rowMark('Surf')) === 'défaut');

// --- 3. Choix ---
console.log('Surf, tops :', await pressPill('Surf', 'tops')); await wait(300);
console.log('Surf, vagues :', await pressPill('Surf', 'vagues')); await wait(300);
console.log('Course, tops :', await pressPill('Course', 'tops')); await wait(300);
console.log('Voile, vmg :', await pressPill('Voile', 'vmg')); await wait(500);
const stored = await storedTabs();
console.log('rangés :', stored);
check('choix rangés par activité', stored === JSON.stringify({ surf: { tops: true, vagues: false }, running: { tops: true }, wingfoil: { vmg: false } }));
check('Surf : « défaut » retiré', (await rowMark('Surf')) === '(aucune)');
console.log('Surf :', await pills('Surf'));
await shoot('onglets-reglages');

// --- 4. Analyses ---
await go(paths.surf, 6000);
const surfTabs = await tabLabels();
console.log('\nsurf, onglets :', surfTabs);
check('surf : « tops » entre « rame » et « graphiques », sans « vagues »', /rame \| tops \| graphiques/.test(surfTabs) && !/vagues/.test(surfTabs));
const memorized = await evaluate(`JSON.parse(localStorage.getItem('tracker.sections') ?? '{}').surf?.vagues`);
check(`« vagues » laissé ouvert (${memorized}), son panneau absent`, memorized === true && (await panel('Vagues')) === '(absent)');
console.log('tops :', await clickTab('tops'));
await wait(1500);
const surfTops = await panel('Meilleurs segments');
console.log('panneau :', surfTops.slice(0, 400));
check('surf : tableau des tops, 2 s à 10 km', /Sur\s+1er \(km\/h\)/.test(surfTops) && /2 s/.test(surfTops) && /10 km/.test(surfTops));
const voir = () => evaluate(`(() => {
  const p = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith('Meilleurs segments'))?.closest('.an-carte-panels > *');
  const b = [...(p?.querySelectorAll('button') ?? [])].find((x) => !x.disabled && /Voir|Masquer/.test(x.textContent));
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const shownButtons = () => evaluate(`[...document.querySelectorAll('.an-carte-panels button')].filter((b) => b.textContent.trim() === 'Masquer').length`);
const highlightPaths = () => evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke-width="10"]').length`);
const before = await highlightPaths();
console.log('Voir :', await voir()); await wait(800);
const during = await highlightPaths();
console.log(`traits épais sur la carte : ${before} → ${during}`);
check('« Voir » : « Masquer », podium tracé', (await shownButtons()) === 1 && during > before);
await shoot('onglets-surf-tops');
console.log('fermer tops :', await clickTab('tops', true)); await wait(500);
check('onglet fermé : surbrillance effacée', (await highlightPaths()) === before);
console.log('rouvrir tops :', await clickTab('tops')); await wait(800);
check('rouvert : rien de ramené', (await shownButtons()) === 0);

await go(paths.course, 6000);
const runTabs = await tabLabels();
console.log('\ncourse, onglets :', runTabs);
check('course : « tops » après « général »', /^général \| tops \|/.test(runTabs));
console.log('tops :', await clickTab('tops'));
await wait(1500);
const runTops = await panel('Meilleurs segments');
console.log('panneau :', runTops.slice(0, 500));
check('course : 400 m vers 18 km/h, semi et marathon', /400 m\s+18[.,]0/.test(runTops) && /semi/.test(runTops) && /marathon/.test(runTops));

await go(paths.voile, 7000);
const sailTabs = await tabLabels();
console.log('\nvoile, onglets :', sailTabs);
check('voile : ni onglet ni panneau VMG', !/vmg/.test(sailTabs) && (await panel('Analyse VMG')) === '(absent)');
check('voile : « tops » toujours là', /tops/.test(sailTabs));

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await openSettings();
check(`à 390 px, Réglages : débordement ${await overflow()}`, (await overflow()) === 0);
await shoot('onglets-reglages-telephone');
await go(paths.surf, 6000);
await clickTab('tops'); await wait(1000);
check(`à 390 px, surf avec « tops » : débordement ${await overflow()}`, (await overflow()) === 0);
await shoot('onglets-surf-telephone');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- 6. « Défaut » ---
await openSettings();
console.log('\nDéfaut :', await evaluate(`(() => { const b = [...(${card('Surf')}?.querySelectorAll('.settings-activity__actions button') ?? [])].find((x) => x.textContent.trim() === 'Défaut'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(500);
const afterReset = await storedTabs();
console.log('rangés :', afterReset);
check('Surf effacé, les autres gardés', afterReset === JSON.stringify({ running: { tops: true }, wingfoil: { vmg: false } }));
check('Surf : « défaut », « tops » relâché', (await rowMark('Surf')) === 'défaut' && (await pills('Surf')).includes('(tops)'));
await go(paths.surf, 6000);
const resetTabs = await tabLabels();
console.log('surf, onglets :', resetTabs);
check('surf : « vagues » revenu, « tops » parti', /vagues/.test(resetTabs) && !/tops/.test(resetTabs));

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(0);
