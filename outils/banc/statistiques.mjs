// Banc de test : la page des statistiques (lot 5 des demandes du 10-13/10).
// Usage : node statistiques.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même douze sessions synthétiques (cinq courses, deux sorties
// à vélo, une de wingfoil, une de kite sans activité créée pour lui, une de surf, un fractionné à pied et un à vélo),
// datées en jours avant aujourd'hui,
// les importe par la page Course, et vérifie :
//  1. l'accès : « Statistiques » dans la barre du haut, qui ouvre la page ; plus de lien sur l'accueil ;
//  2. la vue d'ensemble : 12 sessions, une ligne par famille, pas de records, le graphique de la durée seule ;
//  1 bis. les boutons glissants (demande du 20/10), repliés sous « Sélection » (23/10) : replié au départ, le choix
//     en cours affiché, ouvert et retenu après rechargement ; pas de rangée d'activités sur « Tout » ; la flèche
//     droite du clavier passe à la famille suivante ;
//  3. la descente : Course (5 sessions, graphique et records), 30 jours (2 sessions), le retour arrière
//     qui remonte à la vue d'ensemble ; Fractionné puis « Fractionné vélo » (1 session) ; les boutons
//     d'activité de chaque famille (Vélo : ses trois activités ; Voile : « Kite », de base, avec sa session) ;
//  4. le graphique (lot 2 des demandes du 16/10) : un point cliqué donne sa session, « Ouvrir » mène à son
//     analyse ; les données proposées par famille (course, voile : % de vol du wingfoil seul, surf), chacune
//     tracée ; le choix retenu après rechargement, la vitesse max à sa place là où il n'existe pas ; les fiches
//     en version 5 du résumé (distance en action) ;
//  5. une famille cachée (Surf) : absente des pastilles et des totaux, sa page ouverte par l'adresse le dit ;
//  5b. une session de voile de `make-gpx.mjs`, ouverte dans son analyse : la réussite de ses manœuvres rangée
//     dans sa fiche, et « % de manœuvres réussies » tracé en deux séries, avec sa légende (empannage en rond,
//     virement en triangle, 23/10) ;
//  6. à 390×844 : rien ne déborde ; la case « Statistiques » de la barre du bas ouvre la page, allumée.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
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
/** Choix d'une rangée : pastilles de la donnée du graphique, boutons glissants de la sélection. */
const rowButtons = (label) => label === 'Donnée'
  ? `.stats-chips[aria-label=${JSON.stringify(label)}] .ui-tab`
  : `.ui-segmented[aria-label=${JSON.stringify(label)}] [role=radio]`;
const chips = (label) => evaluate(`[...document.querySelectorAll(${JSON.stringify(rowButtons(label))})].map((b) => b.textContent).join(', ')`);
const search = () => evaluate('location.pathname + location.search');
const points = () => evaluate(`document.querySelectorAll('.recharts-scatter-symbol').length`);
const pressed = (label) => evaluate(`[...document.querySelectorAll(${JSON.stringify(rowButtons(label))})].find((b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true')?.textContent ?? null`);
// Seul l'axe vertical a une étiquette ; Recharts la pose dans une couche à part, hors du groupe de l'axe.
const yLabel = () => evaluate(`document.querySelector('.recharts-label')?.textContent ?? null`);
const sessionRecords = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push(JSON.parse(await (await h.getFile()).text()));
  return list;
})()`);
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
check('plus de lien sur l\'accueil (demande du 19/10)', !(await evaluate(`[...document.querySelectorAll('.shell-main a')].some((a) => a.textContent.trim().startsWith('Statistiques'))`)));
check('lien de la barre du haut', await click('.shell-toplinks a', 'Statistiques'));
await wait(1500);
check('le lien ouvre la page', (await search()) === '/statistiques', await search());

// 1 bis. Boutons glissants, sous « Sélection ».
const selection = `document.querySelector('.stats-choice button[data-chart-fold]')`;
check('« Sélection » replié au départ, le choix en cours affiché', (await evaluate(`${selection}?.getAttribute('aria-expanded')`)) === 'false'
  && (await evaluate(`${selection}?.textContent`))?.includes('Toutes les familles · depuis le début')
  && (await chips('Famille')) === '', await evaluate(`${selection}?.textContent`));
await evaluate(`${selection}.click()`);
await wait(400);
await go('/statistiques');
check('« Sélection » ouvert, retenu après rechargement', (await evaluate(`${selection}?.getAttribute('aria-expanded')`)) === 'true');
check('rangée des familles', (await chips('Famille')) === 'Tout, À pied, Vélo, Voile, Entraînement, Surf' || (await chips('Famille'))?.startsWith('Tout, '), await chips('Famille'));
check('« Tout » choisi, pas de rangée d\'activités', (await pressed('Famille')) === 'Tout' && (await chips('Activité')) === '', `${await pressed('Famille')} ; ${await chips('Activité')}`);
check('rangée des périodes, « Tout » choisi', (await chips('Période')) === 'Semaine, 30 jours, 6 mois, Année, Tout' && (await pressed('Période')) === 'Tout', await chips('Période'));
check('case blanche sous le choix', await evaluate(`(() => {
  const row = document.querySelector('.ui-segmented[aria-label="Famille"]');
  const thumb = row?.querySelector('.ui-segmented__thumb')?.getBoundingClientRect();
  const on = row?.querySelector('[aria-checked=true]')?.getBoundingClientRect();
  return !!thumb && !!on && Math.abs(thumb.left - on.left) < 1 && Math.abs(thumb.width - on.width) < 1;
})()`));
await evaluate(`document.querySelector('.ui-segmented[aria-label="Famille"] [aria-checked=true]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await wait(800);
const keyed = await pressed('Famille');
check('flèche droite : famille suivante, rangée d\'activités', keyed !== 'Tout' && (await chips('Activité'))?.startsWith('Toutes, ')
  && (await evaluate(`document.activeElement?.getAttribute('aria-checked')`)) === 'true', `${keyed} ; ${await chips('Activité')}`);
await evaluate('history.back()');
await wait(800);

// 2. Vue d'ensemble.
check('12 sessions', (await stat('Sessions')) === '12', await stat('Sessions'));
const backdrop = () => evaluate(`document.querySelector('.page-backdrop')?.getAttribute('class')`);
// Fond (lot 3 du 23/10) : dans « Tout », le motif du sport préféré ; dans une famille, celui de la famille choisie.
check('« Tout » : fond d’une famille, celle du sport préféré', /^page-backdrop page-backdrop--(voile|course|velo|surf|fractionne)$/.test((await backdrop()) ?? ''), await backdrop());
check('onglets de la vue d\'ensemble', (await tabs()) === 'général, graphique, régularité', await tabs());
check('graphique de la vue d\'ensemble : la durée seule, sans pastilles', (await chips('Donnée')) === '' && (await points()) === 12 && (await yLabel()) === 'min',
  `${await chips('Donnée')} ; ${await points()} ; ${await yLabel()}`);
const familyRows = await evaluate(`[...document.querySelectorAll('.stats-rows .stats-row__name')].map((e) => e.textContent).join(', ')`);
check('une ligne par famille', familyRows === 'À pied, Vélo, Voile, Entraînement, Surf' || familyRows?.split(', ').length === 5, familyRows);
check('pas de distance mêlée', (await stat('Distance')) === null);
check('régularité', (await stat('Semaines actives')) !== null && (await evaluate(`!!document.querySelector('.recharts-bar')`)));
await shoot('stats-ensemble');

// 3. Descente.
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'À pied');
await wait(800);
check('famille dans l\'adresse', (await search()) === '/statistiques?famille=course', await search());
check('Course : 5 sessions', (await stat('Sessions')) === '5', await stat('Sessions'));
check('À pied : fond de la famille', (await backdrop()) === 'page-backdrop page-backdrop--course', await backdrop());
check('onglets d\'une famille', (await tabs()) === 'général, graphique, régularité, records', await tabs());
check('vitesse max et D+', (await stat('Vitesse max')) !== null && (await stat('Vitesse moyenne en action')) !== null, `${await stat('Vitesse max')} ; ${await stat('Vitesse moyenne en action')}`);
check('graphique : la vitesse max par défaut, 5 points', (await pressed('Donnée')) === 'Vitesse max' && (await points()) === 5, `${await pressed('Donnée')} ; ${await points()}`);
await openTab('records');
await wait(500);
const records = await evaluate(`[...document.querySelectorAll('.stats-records__title')].map((e) => e.textContent).join(', ')`);
check('records de la course', records === 'Vitesse max, Distance, Durée', records);
check('trois par record', (await evaluate(`document.querySelector('.stats-records ol')?.children.length`)) === 3);
await shoot('stats-course');

await click('.ui-segmented[aria-label="Période"] [role=radio]', '30 jours');
await wait(800);
check('30 jours : 2 sessions', (await stat('Sessions')) === '2', await stat('Sessions'));
check('période dans l\'adresse', (await search()) === '/statistiques?famille=course&periode=trente', await search());
check('le sous-titre porte le choix', (await evaluate(`document.querySelector('.ui-page-header')?.textContent`))?.includes('À pied · 30 jours'),
  await evaluate(`document.querySelector('.ui-page-header')?.textContent`));
await evaluate('history.back()');
await wait(1000);
check('retour arrière : vue d\'ensemble', (await search()) === '/statistiques' && (await stat('Sessions')) === '12', `${await search()} ; ${await stat('Sessions')}`);

await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'Entraînement');
await wait(800);
check('Fractionné : fond de la famille', (await backdrop()) === 'page-backdrop page-backdrop--fractionne', await backdrop());
check('activités du fractionné', (await chips('Activité')) === 'Toutes, Fractionné à pied, Fractionné vélo, Tests', await chips('Activité'));
await click('.ui-segmented[aria-label="Activité"] [role=radio]', 'Fractionné vélo');
await wait(800);
check('Fractionné vélo : 1 session', (await stat('Sessions')) === '1' && (await search())?.includes('activite='), `${await stat('Sessions')} ; ${await search()}`);

await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'Vélo');
await wait(800);
check('activités du vélo, sessions ou non', (await chips('Activité')) === 'Toutes, Route, Gravel, VTT', await chips('Activité'));
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'Voile');
await wait(800);
const voile = await chips('Activité');
check('activité de base de la voile', voile?.startsWith('Toutes, Voile') && voile.includes('Kite'), voile);
await click('.ui-segmented[aria-label="Activité"] [role=radio]', 'Kite');
await wait(800);
check('Kite : 1 session', (await stat('Sessions')) === '1', await stat('Sessions'));

// 4. Un point du graphe.
await go('/statistiques?famille=course');
await openTab('graphique');
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

// 4b. Les données du graphique.
const fiches = await sessionRecords();
check('fiches en version 5 ou plus, distance en action', fiches.length === 12 && fiches.every((r) => r.summary.calcVersion >= 5 && typeof r.summary.movingDistanceM === 'number'),
  fiches.map((r) => `${r.summary.calcVersion}/${r.summary.movingDistanceM}`).join(' '));
// Par la pastille de la famille, pour que l'affichage soit retenu (la dernière vue retenue est Kite).
await go('/statistiques');
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'À pied');
await wait(800);
await openTab('graphique');
const courseChips = await chips('Donnée');
check('données de la course', courseChips === 'Vitesse max, Moyenne en action, Durée, Distance, Dénivelé positif', courseChips);
// Course en km/h depuis les pré-réglages du 21/10.
for (const [chip, label] of [['Moyenne en action', 'km/h'], ['Durée', 'min'], ['Distance', 'km'], ['Dénivelé positif', 'm']]) {
  await click('.stats-chips[aria-label="Donnée"] .ui-tab', chip);
  await wait(500);
  check(`course, ${chip} : 5 points, axe en ${label}`, (await points()) === 5 && (await yLabel()) === label, `${await points()} ; ${await yLabel()}`);
}
await go('/statistiques', 3000);
check('choix retenu après rechargement', (await search()) === '/statistiques?famille=course' && (await pressed('Donnée')) === 'Dénivelé positif',
  `${await search()} ; ${await pressed('Donnée')}`);
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'Voile');
await wait(800);
check('voile : pas de D+, la vitesse max à sa place', (await pressed('Donnée')) === 'Vitesse max', await pressed('Donnée'));
const voileChips = await chips('Donnée');
check('données de la voile', voileChips === 'Vitesse max, Moyenne en action, Durée, Distance, % de vol', voileChips);
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'À pied');
await wait(800);
check('retour en course : le choix retrouvé', (await pressed('Donnée')) === 'Dénivelé positif', await pressed('Donnée'));
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'Voile');
await wait(800);
await click('.stats-chips[aria-label="Donnée"] .ui-tab', '% de vol');
await wait(500);
check('% de vol : le wingfoil seul (kite sans foil), axe en %', (await points()) === 1 && (await yLabel()) === '%', `${await points()} ; ${await yLabel()}`);
await shoot('stats-graphique');
await click('.ui-segmented[aria-label="Famille"] [role=radio]', 'Surf');
await wait(800);
const surfChips = await chips('Donnée');
check('données du surf (sans foil)', surfChips === 'Vitesse max, Moyenne en action, Durée, Distance, Vagues, Plus longue vague', surfChips);
await click('.stats-chips[aria-label="Donnée"] .ui-tab', 'Vagues');
await wait(500);
check('surf, Vagues : 1 point', (await points()) === 1, String(await points()));
await click('.stats-chips[aria-label="Donnée"] .ui-tab', 'Vitesse max');
await wait(300);

// 5. Famille cachée : Surf, par les réglages de l'appareil.
await go('/statistiques');
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}');
  s.hiddenFamilies = ['surf'];
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
  // Sans paramètre, la page reprend le dernier affichage (Fractionné vélo) : on repart de la vue d'ensemble.
  localStorage.removeItem('tracker.statistiques');
})()`);
await go('/statistiques');
check('Surf caché : 11 sessions', (await stat('Sessions')) === '11', await stat('Sessions'));
check('Surf absent de la rangée des familles', !(await chips('Famille'))?.includes('Surf'), await chips('Famille'));
await go('/statistiques?famille=surf');
check('Surf par l\'adresse', (await stat('Sessions')) === '1' && (await evaluate(`document.querySelector('.shell-main').innerText.includes('cachée dans Réglages')`)),
  await stat('Sessions'));
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}');
  delete s.hiddenFamilies;
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
})()`);

// 5b. Réussite des manœuvres : une session de voile ouverte dans son analyse.
const voilePath = join(tmpdir(), 'statistiques-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);
const voileRaw = readFileSync(voilePath, 'utf8');
const firstTime = Date.parse(voileRaw.match(/<time>([^<]+)<\/time>/)[1]);
const shift = day(30) - firstTime;
// Planche à voile : une session classée (sans `<type>`, elle serait à classer), sans foil.
const voileGpx = voileRaw.replace('<trk><name>Synthétique</name>', '<trk><name>Synthétique</name><type>windsurf</type>').replace(/<time>([^<]+)<\/time>/g, (_, t) => `<time>${new Date(Date.parse(t) + shift).toISOString()}</time>`);
await go('/voile', 3000);
await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(voileGpx)}], 'voile.gpx', { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await wait(6000);
const voileRec = (await sessionRecords()).find((r) => Math.abs(r.summary.startMs - (firstTime + shift)) < 2000);
check('voile rangée, sans réussite avant l\'analyse', Boolean(voileRec) && voileRec.summary.maneuverResults === undefined);
await go('/statistiques?famille=voile');
await openTab('graphique');
check('pas de réussite tant que la session n\'est pas ouverte', !(await chips('Donnée'))?.includes('réussies'), await chips('Donnée'));
await go(`/voile/analyse?session=${encodeURIComponent(voileRec?.gpx ?? '')}`, 8000);
await wait(2000);
const results = (await sessionRecords()).find((r) => r.gpx === voileRec?.gpx)?.summary.maneuverResults;
check('réussite rangée dans la fiche par l\'analyse', results && results.tackSuccess + results.tackFail > 0 && results.jibeSuccess + results.jibeFail > 0, JSON.stringify(results));
await go('/statistiques?famille=voile');
await click('.stats-chips[aria-label="Donnée"] .ui-tab', '% de manœuvres réussies');
await wait(600);
const shapes = await evaluate(`[...document.querySelectorAll('.recharts-scatter-symbol path')].map((p) => p.getAttribute('d')?.slice(0, 1)).length`);
const note = await evaluate(`document.querySelector('.stats-picked')?.textContent ?? ''`);
check('réussite : deux points (virements, empannages), wing et kite à rouvrir', (await points()) === 2 && !note.includes('triangles') && note.includes('2 sessions à rouvrir'),
  `${await points()} ; ${shapes} ; ${note}`);
const legend = await evaluate(`[...document.querySelectorAll('.stats-legend__item')].map((i) => (i.querySelector('circle') ? '●' : i.querySelector('path') ? '▲' : '?') + ' ' + i.textContent.trim()).join(' · ')`);
check('légende : ● empannage (jibe) · ▲ virement (tack)', legend === '● empannage (jibe) · ▲ virement (tack)', legend);
// Recharts dessine le rond en arc (« A ») et le triangle en lignes seules : un point de chaque.
const symbols = await evaluate(`[...document.querySelectorAll('.recharts-scatter-symbol path')].map((p) => (p.getAttribute('d') ?? '').includes('A') ? 'rond' : 'triangle').sort().join(',')`);
check('graphe : un rond, un triangle', symbols === 'rond,triangle', symbols);
await click('.stats-chips[aria-label="Donnée"] .ui-tab', 'Durée');
await wait(400);
check('légende absente pour une série seule', !(await evaluate(`!!document.querySelector('.stats-legend')`)));
await click('.stats-chips[aria-label="Donnée"] .ui-tab', '% de manœuvres réussies');
await wait(400);
await shoot('stats-reussite');

// 6. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/statistiques?famille=course');
for (const t of ['graphique', 'régularité', 'records']) await openTab(t);
await wait(800);
check('390 px : rien ne déborde (famille)', !(await overflow()));
await shoot('stats-telephone');
await go('/statistiques');
check('390 px : rien ne déborde (ensemble)', !(await overflow()));
// 320 px : la rangée des familles défile en elle-même si elle ne tient pas, sans élargir la page.
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
await go('/statistiques?famille=surf');
const fit = await evaluate(`(() => {
  const row = document.querySelector('.ui-segmented[aria-label="Famille"]');
  const on = row?.querySelector('[aria-checked=true]')?.getBoundingClientRect();
  const box = row?.getBoundingClientRect();
  return { scroll: row ? row.scrollWidth - row.clientWidth : null, visible: !!on && !!box && on.left >= box.left - 1 && on.right <= box.right + 1 };
})()`);
check('320 px : rien ne déborde, le choix en vue', !(await overflow()) && fit?.visible, JSON.stringify(fit));
await shoot('stats-320');

await go('/');
const tab = (label) => `[...document.querySelectorAll('.shell-tabbar .shell-tab')].find((t) => t.textContent.trim() === ${JSON.stringify(label)})`;
check('barre du bas : case Statistiques', await evaluate(`!!${tab('Statistiques')}`));
await evaluate(`${tab('Statistiques')}.click()`);
await wait(1500);
// La page reprend le dernier affichage : l'adresse peut porter des paramètres.
check('la case ouvre la page, allumée', (await search())?.startsWith('/statistiques')
  && (await evaluate(`${tab('Statistiques')}.classList.contains('active')`)));

console.log(logs.length ? `Console :\n${logs.join('\n')}` : 'Console : aucune erreur');
console.log(failures === 0 ? 'Tout est bon.' : `${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
