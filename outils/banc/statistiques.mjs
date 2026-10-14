// Banc de test : la page des statistiques (lot 5 des demandes du 10-13/10).
// Usage : node statistiques.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même douze sessions synthétiques (cinq courses, deux sorties
// à vélo, une de wingfoil, une de kite sans activité créée pour lui, une de surf, un fractionné à pied et un à vélo),
// datées en jours avant aujourd'hui,
// les importe par la page Course, et vérifie :
//  1. l'accès : « Statistiques » dans la barre du haut, la carte de l'accueil qui ouvre la page ;
//  2. la vue d'ensemble : 12 sessions, une ligne par famille, ni vitesse max ni records ;
//  3. la descente : Course (5 sessions, vitesse max et records), 30 jours (2 sessions), le retour arrière
//     qui remonte à la vue d'ensemble ; Fractionné puis « Fractionné vélo » (1 session) ; les pastilles
//     d'activité de chaque famille (Vélo : ses trois activités ; Voile : « Kite », de base, avec sa session) ;
//  4. le graphe de la vitesse max : un point cliqué donne sa session, « Ouvrir » mène à son analyse ;
//  5. une famille cachée (Surf) : absente des pastilles et des totaux, sa page ouverte par l'adresse le dit ;
//  6. à 390×844 : rien ne déborde, « Statistiques » choisi en case secondaire dans Réglages puis dans le menu
//     de l'appui long, la case allumée sur la page.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node statistiques.mjs <port> [<dossier des captures>]');
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

// --- Sessions synthétiques : 20 min en ligne droite vers l'est, à 1 Hz, à 10 h du jour voulu ---
const day = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
};
const gpxOf = (type, daysAgo, speedMs) => {
  const t0 = day(daysAgo);
  const points = [];
  for (let k = 0; k <= 1200; k++) {
    points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * speedMs) / 80500).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${type} ${daysAgo}</name><type>${type}</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const SESSIONS = [
  ['running', 345, 3.0], ['running', 226, 3.2], ['running', 219, 3.5], ['running', 16, 3.4], ['running', 2, 3.6],
  ['cycling', 135, 6], ['cycling', 9, 7],
  ['wingfoil', 92, 9], ['kite', 40, 10],
  ['surf', 55, 4],
  ['run-intervals', 7, 4], ['bike-intervals', 6, 8],
];

/** Clique l'élément dont le texte (ou l'étiquette) commence par `text`. */
const click = (selector, text) => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => (el.getAttribute('aria-label') ?? el.textContent).trim().startsWith(${JSON.stringify(text)}));
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`);
/** Valeur d'un chiffre du panneau Général (`an-sheet__stat`) par son libellé. */
const stat = (label) => evaluate(`(() => {
  const s = [...document.querySelectorAll('.an-sheet__stat')].find((el) => el.querySelector('.an-sheet__stat-label')?.textContent === ${JSON.stringify(label)});
  return s?.querySelector('.an-sheet__stat-value')?.textContent ?? null;
})()`);
const tabs = () => evaluate(`[...document.querySelectorAll('.stats-col > .ui-tabs .ui-tab')].map((b) => b.textContent).join(', ')`);
const chips = (label) => evaluate(`[...document.querySelectorAll('.stats-chips[aria-label=${JSON.stringify(label)}] .ui-tab')].map((b) => b.textContent).join(', ')`);
const search = () => evaluate('location.pathname + location.search');
const overflow = () => evaluate('document.documentElement.scrollWidth > window.innerWidth');
/** Ouvre un onglet de la page s'il est fermé. */
const openTab = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.stats-col > .ui-tabs .ui-tab')].find((el) => el.textContent === ${JSON.stringify(label)});
  if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  return !!b;
})()`);

// --- Mise en place ---
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/course', 5000);
console.log('import :', await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  for (const [name, text] of ${JSON.stringify(SESSIONS.map(([type, d, v]) => [`${type}-${d}.gpx`, gpxOf(type, d, v)]))}) {
    dt.items.add(new File([text], name, { type: 'application/gpx+xml' }));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(12000);

// 1. Accès.
await go('/');
check('lien dans la barre du haut', (await evaluate(`document.querySelector('.shell-toplinks')?.textContent`))?.includes('Statistiques'));
check('carte de l\'accueil', await click('.shell-main a', 'Statistiques'));
await wait(1500);
check('la carte ouvre la page', (await search()) === '/statistiques', await search());

// 2. Vue d'ensemble.
check('12 sessions', (await stat('Sessions')) === '12', await stat('Sessions'));
check('onglets de la vue d\'ensemble', (await tabs()) === 'général, régularité', await tabs());
const familyRows = await evaluate(`[...document.querySelectorAll('.stats-rows .stats-row__name')].map((e) => e.textContent).join(', ')`);
check('une ligne par famille', familyRows === 'Course à pied, Vélo, Voile, Fractionné, Surf' || familyRows?.split(', ').length === 5, familyRows);
check('pas de distance mêlée', (await stat('Distance')) === null);
check('régularité', (await stat('Semaines actives')) !== null && (await evaluate(`!!document.querySelector('.recharts-bar')`)));
await shoot('stats-ensemble');

// 3. Descente.
await click('.stats-chips[aria-label="Famille"] .ui-tab', 'Course');
await wait(800);
check('famille dans l\'adresse', (await search()) === '/statistiques?famille=course', await search());
check('Course : 5 sessions', (await stat('Sessions')) === '5', await stat('Sessions'));
check('onglets d\'une famille', (await tabs()) === 'général, vitesse max, régularité, records', await tabs());
check('vitesse max et D+', (await stat('Vitesse max')) !== null && (await stat('Vitesse moyenne en action')) !== null, `${await stat('Vitesse max')} ; ${await stat('Vitesse moyenne en action')}`);
check('graphe de la vitesse max : 5 points', (await evaluate(`document.querySelectorAll('.recharts-scatter-symbol').length`)) === 5,
  String(await evaluate(`document.querySelectorAll('.recharts-scatter-symbol').length`)));
await openTab('records');
await wait(500);
const records = await evaluate(`[...document.querySelectorAll('.stats-records__title')].map((e) => e.textContent).join(', ')`);
check('records de la course', records === 'Vitesse max, Distance, Durée', records);
check('trois par record', (await evaluate(`document.querySelector('.stats-records ol')?.children.length`)) === 3);
await shoot('stats-course');

await click('.stats-chips[aria-label="Période"] .ui-tab', '30 jours');
await wait(800);
check('30 jours : 2 sessions', (await stat('Sessions')) === '2', await stat('Sessions'));
check('période dans l\'adresse', (await search()) === '/statistiques?famille=course&periode=trente', await search());
await evaluate('history.back()');
await wait(1000);
check('retour arrière : vue d\'ensemble', (await search()) === '/statistiques' && (await stat('Sessions')) === '12', `${await search()} ; ${await stat('Sessions')}`);

await click('.stats-chips[aria-label="Famille"] .ui-tab', 'Fractionné');
await wait(800);
check('activités du fractionné', (await chips('Activité')) === 'Toute la famille, Fractionné à pied, Fractionné vélo', await chips('Activité'));
await click('.stats-chips[aria-label="Activité"] .ui-tab', 'Fractionné vélo');
await wait(800);
check('Fractionné vélo : 1 session', (await stat('Sessions')) === '1' && (await search())?.includes('activite='), `${await stat('Sessions')} ; ${await search()}`);

await click('.stats-chips[aria-label="Famille"] .ui-tab', 'Vélo');
await wait(800);
check('activités du vélo, sessions ou non', (await chips('Activité')) === 'Toute la famille, Route, Gravel, VTT', await chips('Activité'));
await click('.stats-chips[aria-label="Famille"] .ui-tab', 'Voile');
await wait(800);
const voile = await chips('Activité');
check('activité de base de la voile', voile?.startsWith('Toute la famille, Voile') && voile.includes('Kite'), voile);
await click('.stats-chips[aria-label="Activité"] .ui-tab', 'Kite');
await wait(800);
check('Kite : 1 session', (await stat('Sessions')) === '1', await stat('Sessions'));

// 4. Un point du graphe.
await go('/statistiques?famille=course');
await openTab('vitesse max');
await wait(500);
const clicked = await evaluate(`(() => {
  const pts = document.querySelectorAll('.recharts-scatter-symbol');
  const last = pts[pts.length - 1];
  if (!last) return false;
  (last.querySelector('path') ?? last).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await wait(500);
const picked = await evaluate(`document.querySelector('.stats-picked .stats-row')?.textContent ?? null`);
check('point cliqué : sa session', clicked && picked?.includes('Ouvrir'), picked);
if (picked) {
  await click('.stats-picked .stats-row', '');
  await wait(2500);
  check('« Ouvrir » mène à l\'analyse', (await search())?.startsWith('/course/analyse?session='), await search());
}

// 5. Famille cachée : Surf, par les réglages de l'appareil.
await go('/statistiques');
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}');
  s.hiddenFamilies = ['surf'];
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
})()`);
await go('/statistiques');
check('Surf caché : 11 sessions', (await stat('Sessions')) === '11', await stat('Sessions'));
check('Surf absent des pastilles', !(await chips('Famille'))?.includes('Surf'), await chips('Famille'));
await go('/statistiques?famille=surf');
check('Surf par l\'adresse', (await stat('Sessions')) === '1' && (await evaluate(`document.querySelector('.shell-main').innerText.includes('cachée dans Réglages')`)),
  await stat('Sessions'));
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}');
  delete s.hiddenFamilies;
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
})()`);

// 6. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/statistiques?famille=course');
for (const t of ['vitesse max', 'régularité', 'records']) await openTab(t);
await wait(800);
check('390 px : rien ne déborde (famille)', !(await overflow()));
await shoot('stats-telephone');
await go('/statistiques');
check('390 px : rien ne déborde (ensemble)', !(await overflow()));

await go('/parametres');
await evaluate(`(() => {
  if (document.querySelector('.settings-row select')) return;
  [...document.querySelectorAll('[role=button]')].find((el) => el.textContent.trim() === 'Barre du bas')?.click();
})()`);
await wait(300);
const options = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.settings-row')].find((r) => r.textContent.startsWith('Sport secondaire'));
  const select = row?.querySelector('select');
  if (!select) return null;
  const list = [...select.options].map((o) => o.textContent).join(', ');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'statistiques');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return list;
})()`);
check('Réglages : Statistiques proposé en case secondaire', options?.includes('Statistiques'), options);
await wait(300);
const second = await evaluate(`document.querySelector('.shell-tab--menu')?.textContent.trim()`);
check('case secondaire : Statistiques', second === 'Statistiques', second);
await evaluate(`document.querySelector('.shell-tab--menu').click()`);
await wait(1500);
check('la case ouvre la page, allumée', (await search()) === '/statistiques' && (await evaluate(`document.querySelector('.shell-tab--menu').classList.contains('active')`)));

// Planifier en secondaire par Réglages, puis Statistiques repris par le menu de l'appui long.
await go('/parametres');
await evaluate(`(() => {
  if (document.querySelector('.settings-row select')) return;
  [...document.querySelectorAll('[role=button]')].find((el) => el.textContent.trim() === 'Barre du bas')?.click();
})()`);
await wait(300);
await evaluate(`(() => {
  const select = [...document.querySelectorAll('.settings-row')].find((r) => r.textContent.startsWith('Sport secondaire'))?.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'planifier');
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await wait(300);
await evaluate(`document.querySelector('.shell-tab--menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true }))`);
await wait(1600);
const menu = await evaluate(`[...document.querySelectorAll('.shell-sports-menu__item')].map((e) => e.textContent.trim()).join(', ')`);
check('menu de l\'appui long : Statistiques après Planifier', menu?.endsWith('Planifier, Statistiques'), menu);
await click('.shell-sports-menu__item', 'Statistiques');
await wait(1500);
check('choisi dans le menu : retenu et ouvert', (await search()) === '/statistiques'
  && (await evaluate(`document.querySelector('.shell-tab--menu')?.textContent.trim()`)) === 'Statistiques');

console.log(logs.length ? `Console :\n${logs.join('\n')}` : 'Console : aucune erreur');
console.log(failures === 0 ? 'Tout est bon.' : `${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
