// Banc de test : cadence à pied (demande du 16/10, 09:17) — courbe, onglet « cadence », fractionné, statistiques, Réglages.
// Usage : node cadence.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min 30. La mesure elle-même (accéléromètre du téléphone, à l'arrêt
// de l'enregistrement) ne se joue pas dans le navigateur : ses tests sont dans `running/cadence.test.ts`. Le script :
//  1. importe une course de 30 min dont le GPX porte `gpxtpx:cad` en foulées par minute (comme Garmin, Strava et
//     Tracker) : 80 puis 88 foulées (160 puis 176 pas/min) avec la vitesse, et une côte au milieu ; une marche
//     (55 foulées, 110 pas/min) ; un fractionné à pied (cadence plus haute dans les efforts) ; une sortie à vélo dont
//     `cad` est en tours de pédale ; une course sans cadence ;
//  2. course : onglet « cadence » juste après « graphiques » (pas de cardio ici), courbe « Cadence » repliable dans
//     « graphiques » ; chiffres (moyenne, max, pas, longueur de pas), tranches de la course, « Voir » qui trace les
//     passages en violet, effacés à la fermeture de l'onglet ; selon la vitesse (deux tranches), selon la pente ;
//  3. marche : tranches de la marche ; vélo : ni onglet ni courbe ; course sans cadence : ni l'un ni l'autre ;
//  4. fractionné : colonnes « Cadence » et « Pas » des répétitions ;
//  5. statistiques de la course : la donnée « Cadence moyenne », un point par session qui en a ;
//  6. Réglages : « Mesurer la cadence » coché d'office à pied, absent à vélo ; le décocher le range, « cadence »
//     quitte le résumé de la carte ;
//  7. à 390×844 : l'onglet « cadence » et le fractionné sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node cadence.mjs <port> [<dossier des captures>]');
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
const tabLabels = () => evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent.trim()).join(' | ')`);
const clickTab = (label, close = false) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  const isOpen = t.getAttribute('aria-pressed') === 'true';
  if (isOpen !== ${close}) return isOpen ? 'déjà ouvert' : 'déjà fermé';
  t.click(); return 'ok';
})()`);
const SCOPE = (title) => `([...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *') ?? null)`;
const chartsIn = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? s.querySelectorAll('.recharts-surface').length : -1; })()`);
const textIn = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? s.innerText : ''; })()`);
const folds = (title) => evaluate(`(() => { const s = ${SCOPE(title)}; return s ? [...s.querySelectorAll('[data-chart-fold]')].map((b) => b.textContent.trim() + (b.getAttribute('aria-expanded') === 'true' ? '+' : '-')).join(' ') : '(absent)'; })()`);
const fold = (title, label) => evaluate(`(() => {
  const s = ${SCOPE(title)};
  const b = s ? [...s.querySelectorAll('[data-chart-fold]')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}) : null;
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
/** Clique le n-ième bouton « Voir » du panneau. */
const clickVoir = (title, nth) => evaluate(`(() => {
  const s = ${SCOPE(title)};
  const b = s ? [...s.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'Voir' && !x.disabled)[${nth}] : null;
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const violetPaths = () => evaluate(`document.querySelectorAll('.an-map-row path[stroke="#7b1fa2"]').length`);
/** Lignes d'un tableau du panneau, repéré par une de ses têtes de colonne. */
const tableRows = (title, head) => evaluate(`(() => {
  const s = ${SCOPE(title)};
  const t = s ? [...s.querySelectorAll('table')].find((x) => [...x.querySelectorAll('th')].some((th) => th.textContent.trim() === ${JSON.stringify(head)})) : null;
  return t ? [...t.querySelectorAll('tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()) : null;
})()`);
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions synthétiques ---
/**
 * Ligne droite à 1 Hz : vitesse `speedAt(k)`, foulées par minute `cadAt(k)` (`null` : pas de `cad`), altitude qui
 * monte de 6 % entre `climb[0]` et `climb[1]` secondes.
 */
const lineGpx = (type, seconds, speedAt, cadAt, t0, climb = null) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  let m = 0;
  let ele = 50;
  for (let k = 0; k <= seconds; k++) {
    const v = speedAt(k);
    if (k > 0) { m += v; if (climb && k >= climb[0] && k < climb[1]) ele += 0.06 * v; }
    const cad = cadAt(k);
    const ext = cad === null ? '' : `<gpxtpx:TrackPointExtension><gpxtpx:cad>${cad}</gpxtpx:cad></gpxtpx:TrackPointExtension>`;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${v}</speed>${ext}</extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><name>Ligne</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const T_RUN = Date.UTC(2026, 9, 1, 8, 0, 0);
const T_WALK = Date.UTC(2026, 9, 2, 8, 0, 0);
const T_IVL = Date.UTC(2026, 9, 3, 8, 0, 0);
const T_BIKE = Date.UTC(2026, 9, 4, 8, 0, 0);
const T_PLAIN = Date.UTC(2026, 9, 5, 8, 0, 0);
// Fractionné sans compteur : 10 min d'échauffement, 8 × (1 min d'effort, 1 min de repos), 5 min de retour.
const effortAt = (s) => {
  if (s < 600) return 2.8 + 0.1 * Math.sin(s / 13);
  const u = s - 600;
  if (u >= 8 * 120 - 60) return 2.5;
  const k = u % 120;
  return k < 60 ? Math.min(1.5 + (k + 1) * 1.2, 5.2 - 0.05 * Math.floor(u / 120) - 0.004 * k) : 1.5;
};
const SESSIONS = [
  // 15 min à 2,6 m/s et 80 foulées, puis 15 min à 3,6 m/s et 88 foulées ; une côte de la 5e à la 10e minute.
  { key: 'course', page: 'course', start: T_RUN, gpx: lineGpx('running', 1800, (k) => (k < 900 ? 2.6 : 3.6), (k) => (k < 900 ? 80 : 88), T_RUN, [300, 600]) },
  { key: 'marche', page: 'course', start: T_WALK, gpx: lineGpx('running', 900, () => 1.4, () => 55, T_WALK) },
  { key: 'fractionne', page: 'fractionne', start: T_IVL, gpx: lineGpx('run-intervals', 600 + 8 * 120 - 60 + 300, effortAt, (k) => (effortAt(k) > 4 ? 94 : 82), T_IVL) },
  { key: 'velo', page: 'velo', start: T_BIKE, gpx: lineGpx('cycling', 1200, () => 7, () => 85, T_BIKE) },
  { key: 'sanscad', page: 'course', start: T_PLAIN, gpx: lineGpx('running', 900, () => 3, () => null, T_PLAIN) },
];

// --- 1. Import ---
const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `${s.key}.gpx`));
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.key] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.key} rangée`, Boolean(rec));
  if (s.key === 'course') check(`course : cadence dans le résumé de la fiche (${JSON.stringify(rec?.summary?.cadence)})`, Math.abs((rec?.summary?.cadence?.avgSpm ?? 0) - 168) < 1);
  if (s.key === 'velo') check('vélo : pas de cadence dans le résumé', rec?.summary?.cadence === undefined);
}

// --- 2. Course ---
await go(paths.course, 6000);
const labels = (await tabLabels()).split(' | ');
check(`course : « cadence » juste après « graphiques » (${labels.join(', ')})`, labels.indexOf('cadence') === labels.indexOf('graphiques') + 1);
await clickTab('graphiques');
await wait(1500);
check(`course : courbe de cadence repliable dans « graphiques » (${await folds('Graphiques')}, ${await chartsIn('Graphiques')} graphes)`,
  (await folds('Graphiques')) === 'Vitesse+ Altitude+ Cadence+' && (await chartsIn('Graphiques')) === 3);
await fold('Graphiques', 'Cadence');
await wait(600);
check(`course : cadence repliée (${await chartsIn('Graphiques')} graphes)`, (await chartsIn('Graphiques')) === 2);
await fold('Graphiques', 'Cadence');
await clickTab('graphiques', true);
console.log('  cadence :', await clickTab('cadence'));
await wait(1500);
const panelText = await textIn('Cadence');
console.log('  ' + panelText.split('\n').slice(0, 14).join(' / '));
check('course : cadence moyenne 168 pas/min', panelText.includes('168 pas/min'));
check('course : cadence max (30 s) 176 pas/min', /Cadence max \(30 s\)\s*176 pas\/min/.test(panelText));
check('course : nombre de pas (environ 5 040)', /Pas\s*5\s?0[34]\d/.test(panelText.replace(/ /g, ' ')));
check('course : tranches de la course', panelText.includes('Tranches (course)'));
const bands = await tableRows('Cadence', 'Pas/min');
console.log('  tranches :', bands?.join(' | '));
check('course : environ 15 min dans 160-169 et dans 170-179', /^160-169 1[45] min/.test(bands?.[2] ?? '') && /^170-179 1[45] min/.test(bands?.[3] ?? ''));
check(`pas de violet avant « Voir » (${await violetPaths()})`, (await violetPaths()) === 0);
console.log('  Voir :', await clickVoir('Cadence', 0));
await wait(800);
check(`« Voir » trace les passages d'une tranche (${await violetPaths()})`, (await violetPaths()) >= 1);
await shoot('cadence-course');
const speeds = await tableRows('Cadence', 'min/km');
console.log('  selon la vitesse :', speeds?.join(' | '));
check('selon la vitesse : deux tranches, cadence et pas plus grands à la plus rapide',
  speeds?.length === 2 && speeds[0].includes('160 pas/min') && speeds[1].includes('176 pas/min') && speeds[0].includes('0.97 m') && speeds[1].includes('1.23 m'));
const grades = await tableRows('Cadence', 'Zone');
console.log('  selon la pente :', grades?.join(' | '));
check('selon la pente : la côte en « Montée », le reste à plat', grades?.some((r) => r.startsWith('Montée 3 à 10 % 5 min')) && grades?.some((r) => r.startsWith('À peu près plat')));
check('dérive donnée (30 min)', panelText.includes('Dérive, du premier au dernier tiers'));
await clickTab('cadence', true);
await wait(600);
check(`onglet fermé : surbrillance effacée (${await violetPaths()})`, (await violetPaths()) === 0);
await clickTab('cadence');
await wait(800);
check(`rouvert : surbrillance pas ramenée (${await violetPaths()})`, (await violetPaths()) === 0);

// --- 3. Marche, vélo, course sans cadence ---
await go(paths.marche, 6000);
await clickTab('cadence');
await wait(1200);
const walkText = await textIn('Cadence');
check('marche : 110 pas/min, tranches de la marche', walkText.includes('110 pas/min') && walkText.includes('Tranches (marche)'));
await go(paths.velo, 6000);
check(`vélo : pas d'onglet « cadence » (${await tabLabels()})`, !(await tabLabels()).includes('cadence'));
await clickTab('graphiques');
await wait(1000);
check(`vélo : pas de courbe de cadence (${await folds('Graphiques')})`, !(await folds('Graphiques')).includes('Cadence'));
await go(paths.sanscad, 6000);
check(`course sans cadence : pas d'onglet (${await tabLabels()})`, !(await tabLabels()).includes('cadence'));

// --- 4. Fractionné ---
await go(paths.fractionne, 7000);
const reps = await tableRows('Répétitions', 'Cadence');
console.log('  répétitions :', reps?.slice(0, 2).join(' | '));
check(`fractionné : colonnes Cadence et Pas (${reps?.length ?? 0} répétitions)`, (reps?.length ?? 0) >= 7 && /18\d pas\/min/.test(reps[0]) && / \d\.\d\d m /.test(` ${reps[0]} `));

// --- 5. Statistiques ---
await go('/statistiques?famille=course', 4000);
const statsTab = await evaluate(`(() => { const t = [...document.querySelectorAll('.ui-tab')].find((x) => x.textContent.trim() === 'graphique'); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true') t.click(); return 'ok'; })()`);
await wait(1000);
const chips = await evaluate(`[...document.querySelectorAll('.stats-chips[aria-label="Donnée"] .ui-tab')].map((b) => b.textContent).join(', ')`);
check(`statistiques : « Cadence moyenne » parmi les données de la course (${statsTab}, ${chips})`, chips?.includes('Cadence moyenne'));
await evaluate(`(() => { const b = [...document.querySelectorAll('.stats-chips[aria-label="Donnée"] .ui-tab')].find((x) => x.textContent === 'Cadence moyenne'); b?.click(); return 'ok'; })()`);
await wait(1200);
const statPoints = await evaluate(`document.querySelectorAll('.recharts-scatter-symbol').length`);
check(`statistiques : un point par session de course avec cadence (${statPoints})`, statPoints === 2);
await shoot('cadence-statistiques');

// --- 6. Réglages ---
await go('/parametres', 2000);
await evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections.settings = { ...sections.settings, activites: true };
  sections['settings-activities'] = { running: true, cycling: true };
  sections['settings-activity-parts'] = { enregistrement: true };
  sections['settings-families'] = { course: true, velo: true };
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
await go('/parametres', 3000);
const nameSelector = '.settings-activity__name';
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector(${JSON.stringify(nameSelector)})?.textContent === ${JSON.stringify(name)})`;
const cadenceBox = (name) => `[...(${card(name)}?.querySelectorAll('label') ?? [])].find((l) => l.textContent.trim() === 'Mesurer la cadence')?.querySelector('input')`;
check('Réglages : « Mesurer la cadence » coché d\'office en Course', await evaluate(`${cadenceBox('Course')}?.checked === true`));
check('Réglages : rien à vélo (Route)', await evaluate(`${cadenceBox('Route')} === undefined`));
check('Réglages : « cadence » dans le résumé de la carte Course', await evaluate(`${card('Course')}?.innerText.includes('cadence')`));
await evaluate(`(() => { ${cadenceBox('Course')}.click(); return 'ok'; })()`);
await wait(800);
const stored = await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').cadence`);
check(`Réglages : décochée, rangée (${JSON.stringify(stored)})`, stored?.running === false && (await evaluate(`${cadenceBox('Course')}?.checked === false`)));
await evaluate(`(() => { ${cadenceBox('Course')}.click(); return 'ok'; })()`);
await wait(600);
check('Réglages : recochée, plus rien de rangé', (await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').cadence?.running`)) === undefined);

// --- 7. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.course, 6000);
await clickTab('cadence');
await wait(1200);
check(`390 px : onglet « cadence » sans débordement (${await overflow()} px)`, (await overflow()) <= 0);
await shoot('cadence-390');
await go(paths.fractionne, 7000);
check(`390 px : fractionné sans débordement (${await overflow()} px)`, (await overflow()) <= 0);
await shoot('cadence-fractionne-390');

console.log('\n--- console (erreurs, avertissements) ---');
for (const l of logs) console.log(l);
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Browser.close').catch(() => {});
process.exit(failures === 0 ? 0 : 1);
