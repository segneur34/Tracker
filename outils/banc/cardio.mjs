// Banc de test : onglet « cardio » et FC dans toutes les analyses (lot 7 des demandes du 10-13/10, étape analyse).
// Usage : node cardio.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 2 min. Le script :
//  1. importe une course, une session de voile (`make-gpx.mjs`) et une session de surf, toutes avec la FC
//     (`gpxtpx:hr`), et une course sans FC ;
//  2. sans FC max ni âge : l'onglet « cardio » juste après celui des graphes, FC moyenne et max, pas de zones,
//     « La retenir » qui range la FC max de la sortie ; la course sans FC n'a pas l'onglet ;
//  3. FC max et FC de repos saisies : le tableau des zones (réserve cardiaque), « Voir » qui trace les passages
//     d'une zone sur la carte, effacés à la fermeture de l'onglet ; dérive et nuage FC / vitesse en course ;
//  4. la courbe de FC dans l'onglet des graphes des trois modules ;
//  5. Réglages : « Zones cardiaques » (Personnaliser, Revenir au calcul), la case « Ceinture cardio » en voile et
//     en surf, les chiffres « FC moyenne » et « Zone cardiaque » proposés en voile ;
//  6. une séance de fractionné sans compteur, avec la FC : colonnes « FC » et « Récup. » des répétitions ;
//  7. la FC dans le résumé des fiches, et l'onglet « cardio » des statistiques ;
//  8. à 390×844 : l'analyse de course, onglet cardio ouvert, et le fractionné, sans débordement.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node cardio.mjs <port> [<dossier des captures>]');
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
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ') : '(absent)';
})()`);
/** Graphes Recharts dans le panneau dont le titre commence ainsi. */
const chartsIn = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').querySelectorAll('.recharts-surface').length : -1;
})()`);
/** Traits violets de surbrillance sur la carte. */
const violetPaths = () => evaluate(`document.querySelectorAll('.an-map-row path[stroke="#7b1fa2"]').length`);
const clickButton = (scopeTitle, label, nth = 0) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(scopeTitle)}));
  const scope = t ? t.closest('.an-carte-panels > *') : null;
  const b = scope ? [...scope.querySelectorAll('button')].filter((x) => x.textContent.trim() === ${JSON.stringify(label)})[${nth}] : null;
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const setRunner = (profile) => evaluate(`(() => { localStorage.setItem('tracker.runnerProfile', ${JSON.stringify(JSON.stringify({ me: profile }))}); return 'ok'; })()`);
const runner = () => evaluate(`JSON.parse(localStorage.getItem('tracker.runnerProfile') ?? '{}').me ?? null`);
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions synthétiques ---
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
/** La FC `hrAt(k)` ajoutée au k-ième point, comme l'écrit l'enregistreur (`gpxtpx:hr`). */
const withHr = (gpx, hrAt) => {
  let k = 0;
  return gpx
    .replace('xmlns="http://www.topografix.com/GPX/1/1"', 'xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"')
    .replace(/<\/extensions><\/trkpt>/g, () => `<gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(k++))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
};
const voilePath = join(tmpdir(), 'cardio-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);

const T_RUN = Date.UTC(2026, 9, 1, 8, 0, 0);
const T_PLAIN = Date.UTC(2026, 9, 4, 8, 0, 0);
const T_SURF = Date.UTC(2026, 9, 3, 7, 0, 0);
const T_VOILE = Date.UTC(2026, 8, 20, 13, 0, 0);
const T_IVL = Date.UTC(2026, 9, 5, 8, 0, 0);
// Fractionné sans compteur (celui de `fractionne.mjs`) : 10 min d'échauffement, 8 × (1 min d'effort, 1 min de repos).
const effortAt = (s) => {
  if (s < 600) return 2.8 + 0.1 * Math.sin(s / 13);
  const u = s - 600;
  if (u >= 8 * 120 - 60) return 2.5;
  const k = u % 120;
  return k < 60 ? Math.min(1.5 + (k + 1) * 1.2, 5.2 - 0.05 * Math.floor(u / 120) - 0.004 * k) : 1.5;
};
// FC qui monte pendant l'effort et redescend pendant le repos, en retard sur la vitesse.
const ivlHr = (s) => {
  if (s < 600) return 135;
  const u = s - 600;
  if (u >= 8 * 120 - 60) return 140;
  const k = u % 120;
  return k < 60 ? 145 + 0.5 * k : 175 - 0.6 * (k - 60);
};
// Course de 40 min à 3 m/s, FC de 130 à 172 : dérive nette, montée jusqu'en Z4 et Z5 (réserve 50-190).
const runHr = (k) => 130 + (k / 2400) * 42;
const SESSIONS = [
  { key: 'course', page: 'course', start: T_RUN, gpx: withHr(lineGpx('running', 2400, () => 3, T_RUN), runHr) },
  { key: 'sansfc', page: 'course', start: T_PLAIN, gpx: lineGpx('running', 1200, () => 3, T_PLAIN) },
  { key: 'surf', page: 'surf', start: T_SURF, gpx: withHr(surfGpx(T_SURF, MORNING), (k) => 110 + 20 * Math.sin(k / 120)) },
  { key: 'voile', page: 'voile', start: T_VOILE, gpx: withHr(readFileSync(voilePath, 'utf8'), (k) => 120 + 25 * Math.sin(k / 300)) },
  { key: 'fractionne', page: 'fractionne', start: T_IVL, gpx: withHr(lineGpx('run-intervals', 600 + 8 * 120 - 60 + 300, effortAt, T_IVL), ivlHr) },
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
}

// --- 2. Sans FC max ni âge ---
const GRAPH_TAB = { course: 'vitesse et altitude', surf: 'graphiques', voile: 'graphiques' };
for (const key of ['course', 'surf', 'voile']) {
  await go(paths[key], 6000);
  const labels = (await tabLabels()).split(' | ');
  const at = labels.indexOf('cardio');
  check(`${key} : « cardio » juste après « ${GRAPH_TAB[key]} » (${labels.join(', ')})`, at > 0 && labels[at - 1] === GRAPH_TAB[key]);
  console.log('  ouvre cardio :', await clickTab('cardio'));
  await wait(1500);
  const text = await panel('Cardio');
  check(`${key} : FC moyenne et max`, /FC moyenne \/ \d+ bpm/.test(text) && /FC max \/ \d+ bpm/.test(text));
  check(`${key} : pas de zones, et la raison`, text.includes('Pour les zones d\'effort'));
  check(`${key} : courbe de FC`, (await chartsIn('Cardio')) >= 1);
}
await go(paths.course, 6000);
const before = await panel('Cardio');
check('course : FC max de la sortie proposée', before.includes('Aucune FC max') && before.includes('La retenir'));
console.log('  La retenir :', await clickButton('Cardio', 'La retenir'));
await wait(800);
const kept = await runner();
console.log('  pratiquant :', JSON.stringify(kept));
check('FC max rangée dans le profil (170 environ)', kept?.hrMax >= 165 && kept?.hrMax <= 175);
await go(paths.course, 6000);
check('course : la proposition disparaît', !(await panel('Cardio')).includes('La retenir'));
await go(paths.sansfc, 6000);
check(`course sans FC : pas d'onglet cardio (${await tabLabels()})`, !(await tabLabels()).split(' | ').includes('cardio'));

// --- 3. Zones ---
await setRunner({ hrMax: 190, hrRest: 50 });
await go(paths.course, 6000);
const zones = await panel('Cardio');
console.log('  cardio :', zones.slice(0, 600));
check('course : tableau des zones', ['sous Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'].every((z) => zones.includes(z)) && zones.includes('réserve cardiaque'));
check('course : charge', /Charge \/ \d+/.test(zones));
check('course : dérive mesurée', /Dérive cardiaque de \d+[.,]\d %/.test(zones));
check('course : nuage FC / vitesse', (await chartsIn('Cardio')) >= 2);
const violetBefore = await violetPaths();
console.log('  Voir Z3 :', await clickButton('Cardio', 'Voir', 3));
await wait(1000);
const violetShown = await violetPaths();
check(`course : passages de Z3 sur la carte (${violetBefore} → ${violetShown})`, violetShown > violetBefore);
await shoot('cardio-course');
console.log('  ferme cardio :', await clickTab('cardio', true));
await wait(800);
check('course : surbrillance effacée à la fermeture', (await violetPaths()) === violetBefore);
console.log('  rouvre cardio :', await clickTab('cardio'));
await wait(800);
check('course : surbrillance pas ramenée', (await violetPaths()) === violetBefore);

// --- 4. Courbe dans les graphes ---
await go(paths.course, 6000);
console.log('  vitesse et altitude :', await clickTab('vitesse et altitude'));
await wait(1500);
check(`course : trois graphes, vitesse, altitude et FC (${await chartsIn('Vitesse et altitude')})`, (await chartsIn('Vitesse et altitude')) === 3);
await go(paths.sansfc, 6000);
await clickTab('vitesse et altitude');
await wait(1500);
check(`course sans FC : deux graphes (${await chartsIn('Vitesse et altitude')})`, (await chartsIn('Vitesse et altitude')) === 2);
await go(paths.surf, 6000);
await clickTab('graphiques');
await wait(1500);
check(`surf : vitesse et FC (${await chartsIn('Vitesse')})`, (await chartsIn('Vitesse')) === 2);
await go(paths.voile, 8000);
await clickTab('graphiques');
await wait(1500);
check('voile : « Fréquence cardiaque » dans graphiques', (await panel('Graphiques')).includes('Fréquence cardiaque'));
await shoot('cardio-voile');

// --- 5. Réglages ---
const openSettings = async () => {
  await go('/parametres', 3000);
  await evaluate(`(() => {
    const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
    sections.settings = { ...sections.settings, activites: true, coureur: true };
    sections['settings-activities'] = { wingfoil: true, surf: true };
    sections['settings-activity-parts'] = { enregistrement: true };
    localStorage.setItem('tracker.sections', JSON.stringify(sections));
    return 'ok';
  })()`);
  await go('/parametres', 3000);
};
await openSettings();
const zonesRow = () => evaluate(`(() => {
  const l = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Zones cardiaques');
  return l ? l.parentElement.parentElement.innerText.replace(/\\n+/g, ' / ') : '(absent)';
})()`);
const row = await zonesRow();
console.log('  zones :', row);
check('Réglages : zones calculées en réserve cardiaque', row.includes('Z1 ≥ 120') && row.includes('Z5 ≥ 176') && row.includes('réserve cardiaque'));
console.log('  Personnaliser :', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Personnaliser'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(500);
check('Réglages : cinq champs, zones rangées', (await evaluate(`[...document.querySelectorAll('label span')].filter((s) => s.textContent.startsWith('Début de Z')).length`)) === 5
  && JSON.stringify((await runner())?.hrZones) === JSON.stringify([120, 134, 148, 162, 176]));
console.log('  Revenir au calcul :', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Revenir au calcul'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(500);
check('Réglages : zones de nouveau calculées', (await runner())?.hrZones === null);
const nameSelector = `input[aria-label="Nom de l\\'activité"]`;
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector(${JSON.stringify(nameSelector)})?.value === ${JSON.stringify(name)})`;
for (const name of ['Voile', 'Surf']) {
  check(`Réglages, ${name} : case « Ceinture cardio »`, Boolean(await evaluate(`[...(${card(name)}?.querySelectorAll('.settings-row__label') ?? [])].some((l) => l.textContent.trim() === 'Ceinture cardio')`)));
}
const voileOptions = await evaluate(`[...(${card('Voile')}?.querySelectorAll('select[aria-label="Ligne 1"] option') ?? [])].map((o) => o.textContent.trim())`);
check('Réglages, Voile : « Fréquence cardiaque », « FC moyenne » et « Zone cardiaque » proposés', ['Fréquence cardiaque', 'FC moyenne', 'Zone cardiaque'].every((o) => voileOptions?.includes(o)));

// --- 6. FC par répétition ---
await go(paths.fractionne, 6000);
console.log('  fractionné, onglets :', await tabLabels());
await clickTab('fractionné');
await wait(2000);
const ivlText = await evaluate('document.body.innerText');
const ivlCells = await evaluate(`[...document.querySelectorAll('.an-ivl-hr')].map((c) => c.textContent.trim())`);
const recCells = await evaluate(`[...document.querySelectorAll('.an-ivl-rec')].map((c) => c.textContent.trim())`);
console.log('  FC :', ivlCells?.join(' | '), '\n  récup :', recCells?.join(' | '));
check('fractionné : colonnes « FC » et « Récup. »', ivlText.includes('Récup.') && ivlCells?.length >= 6);
check('fractionné : FC moyenne / max de chaque effort', ivlCells?.every((c) => /^\d{3} \/ \d{3}$/.test(c)));
check('fractionné : récupération mesurée', recCells?.filter((c) => /^−\d+ bpm$/.test(c)).length >= 6);
await shoot('cardio-fractionne');

// --- 7. Résumé et statistiques ---
const recs = await records();
const courseRec = recs.find((r) => Math.abs((r.summary?.startMs ?? 0) - T_RUN) < 2000);
const plainRec = recs.find((r) => Math.abs((r.summary?.startMs ?? 0) - T_PLAIN) < 2000);
console.log('  résumé de la course :', JSON.stringify({ ...courseRec?.summary?.heartRate, histogram: undefined }));
check('résumé : FC de la course (calcVersion 4)', courseRec?.summary?.calcVersion === 4 && courseRec?.summary?.heartRate?.avgBpm > 140);
check('résumé : rien pour la course sans FC', plainRec && plainRec.summary.heartRate === undefined);
await go('/statistiques', 5000);
console.log('  statistiques, onglets :', await evaluate(`[...document.querySelectorAll('.stats-col .ui-tab')].map((t) => t.textContent.trim()).join(' | ')`));
console.log('  ouvre cardio :', await evaluate(`(() => { const t = [...document.querySelectorAll('.stats-col .ui-tab')].find((x) => x.textContent.trim() === 'cardio'); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true') t.click(); return 'ok'; })()`));
await wait(1500);
const statsText = await evaluate(`(() => {
  const t = [...document.querySelectorAll('.stats-panels [role=button]')].find((h) => h.textContent.trim().startsWith('Cardio'));
  return t ? t.closest('.stats-panels > *').innerText.replace(/\\n+/g, ' / ') : '(absent)';
})()`);
console.log('  cardio :', statsText.slice(0, 400));
// La voile de `make-gpx.mjs` n'a pas de `<type>` : à classer, elle n'entre pas dans les statistiques.
check('statistiques : 3 sessions avec FC sur 4 (la voile est à classer)', statsText.includes('Sessions avec FC / 3 / 4'));
check('statistiques : charge, temps par zone, charge par semaine, FC par session',
  statsText.includes('Charge') && statsText.includes('Temps par zone') && statsText.includes('Charge par') && statsText.includes('FC moyenne par session'));
check('statistiques : deux graphes', (await evaluate(`(() => {
  const t = [...document.querySelectorAll('.stats-panels [role=button]')].find((h) => h.textContent.trim().startsWith('Cardio'));
  return t ? t.closest('.stats-panels > *').querySelectorAll('.recharts-surface').length : -1;
})()`)) === 2);
await shoot('cardio-statistiques');

// --- 8. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go(paths.course, 6000);
await clickTab('cardio');
await wait(1500);
check(`à 390 px, course onglet cardio : débordement ${await overflow()}`, (await overflow()) === 0);
await shoot('cardio-telephone');
await go(paths.fractionne, 6000);
await wait(1500);
check(`à 390 px, fractionné : débordement ${await overflow()}`, (await overflow()) === 0);
await shoot('cardio-fractionne-telephone');

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(failures === 0 ? 0 : 1);
