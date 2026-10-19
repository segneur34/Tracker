// Banc de test : pumping foil en surf (§10, point 104).
// Usage : node pumping.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, serveur de développement (le script importe `/src/...` dans la page).
// Le script fabrique lui-même, dans la page, une session de surf foil de quatre vols et ses capteurs
// (`.imu` synthétique, `core/imuSynthetic.ts` : chocs de l'eau hors des vols, pumping à 1,5 Hz en vol), et vérifie :
//  1. Réglages, carte « Surf foil » : la case « Pumping foil » (partie Onglet analyse), cochée, puis le résumé de la carte ;
//     carte « Surf » (sans foil) : pas de case ;
//  2. l'import de la session avec ses capteurs, puis l'analyse : Foil et Pumping cochés pour la session (onglet
//     réglages), onglet « vols » : coups, fréquence (vers 90 /min), distance par coup, podium des 3 plus longs vols avec
//     décollage, « Tous les vols (4) » replié puis déplié, « Voir » d'un vol sur la carte ;
//  3. Pumping décoché pour la session : colonnes du GPS revenues ; « Enregistrer la session » range `analysis.pumping` ;
//  4. Enregistrer, dans le navigateur : pas de case « Mesurer le pumping » (téléphone seulement) ;
//  5. la page à 390 × 844, sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node pumping.mjs <port> [<dossier des captures>]');
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
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return `ERREUR : ${r.result.exceptionDetails.exception?.description?.split('\n')[0] ?? r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    ?? [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent'; if (t.getAttribute('aria-pressed') === 'true') return 'déjà ouvert'; t.click(); return 'ok';
})()`);
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ').slice(0, 1400) : '(absent)';
})()`);
/** En-têtes des tableaux du panneau « Vols ». */
const flightHeads = () => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith('Vols'));
  const p = t?.closest('.an-carte-panels > *');
  return p ? [...p.querySelectorAll('table')].map((tb) => [...tb.querySelectorAll('th')].map((h) => h.textContent).join(', ')).join(' || ') : '(absent)';
})()`);
const sessionBox = (label) => evaluate(`(() => {
  const box = [...document.querySelectorAll('.an-carte-panels label')].find((l) => l.querySelector('strong')?.textContent === ${JSON.stringify(label)})?.querySelector('input[type=checkbox]');
  if (!box) return 'absente'; box.click(); return box.checked ? 'cochée' : 'décochée';
})()`);
const sessionsDir = `(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'))`;
const recordAt = (startMs) => evaluate(`(async () => {
  for await (const [name, h] of ${sessionsDir}.entries()) {
    if (!name.endsWith('.json')) continue;
    const r = JSON.parse(await (await h.getFile()).text());
    if (r.summary?.startMs === ${startMs}) return r;
  }
  return null;
})()`);
/** Ouvre la section « Activités » de Réglages si elle est fermée (son état est mémorisé). */
const openActivities = async () => {
  if (!(await evaluate(`document.querySelector('.settings-activities') !== null`))) await clickText('Activités', '[role=button]');
  await wait(400);
  // Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
  await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
  await wait(300);
};
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- 1. Réglages ---
await go('/parametres', 4000);
await openActivities();
// Carte d'une activité, repliée (son nom) ou ouverte (le choix de sa couleur) : l'état ouvert est mémorisé.
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === ${JSON.stringify(name)}
  || c.querySelector('[aria-label="Couleur de ${name}"]'))`;
const setCardOpen = (name, open) => evaluate(`(() => {
  const c = ${card(name)}; if (!c) return 'absente';
  if ((c.querySelector('.settings-activity__body') !== null) !== ${open}) c.querySelector('.settings-activity__toggle').click();
  return 'ok';
})()`);
for (const name of ['Surf foil', 'Surf']) {
  await setCardOpen(name, true);
  await wait(300);
}
await clickText('Onglet analyse', '.settings-activity button');
await wait(300);
const rows = (name) => evaluate(`[...(${card(name)}?.querySelectorAll('.settings-row__label') ?? [])].map((l) => l.textContent).join(', ')`);
const foilRows = await rows('Surf foil');
check('case Pumping sur Surf foil', /Pumping/.test(foilRows ?? ''), foilRows);
const surfRows = await rows('Surf');
check('pas de case Pumping sur Surf (sans foil)', !/Pumping/.test(surfRows ?? ''), surfRows);
// L'aide du seuil est sous son « ? » (lot 3 des demandes du 19/10) : ouverte, lue, refermée.
console.log('aide du seuil de vol :', await evaluate(`(() => {
  const row = [...(${card('Surf foil')}?.querySelectorAll('.settings-row') ?? [])].find((r) => r.textContent.includes('Seuil de vol'));
  const help = row?.querySelector('.ui-help'); if (!help) return '(absente)';
  help.click();
  return new Promise((ok) => setTimeout(() => { const text = row.querySelector('.settings-help')?.textContent ?? '(absente)'; help.click(); ok(text); }, 100));
})()`));
console.log('cocher Pumping foil :', await evaluate(`(() => {
  const row = [...(${card('Surf foil')}?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === 'Pumping');
  const box = row?.querySelector('input[type=checkbox]'); if (!box) return 'absente'; box.click(); return box.checked ? 'cochée' : 'décochée';
})()`));
await wait(300);
await go('/parametres', 3000);
await openActivities();
await setCardOpen('Surf foil', false);
await wait(300);
const summary = await evaluate(`${card('Surf foil')}?.innerText.replace(/\\n+/g, ' ')`);
check('résumé de la carte repliée', /foil · pumping/.test(summary ?? ''), summary);
await shoot('pumping-reglages');

// --- 2. Session de surf foil et ses capteurs ---
// 450 s : quatre vols à 4,5 m/s (16 km/h, sous le seuil de vague en foil), de 60, 30, 20 et 10 s ; rame à 1 m/s
// entre eux, départ à 2 m/s les 4 s qui précèdent chaque vol. Capteurs : chocs de l'eau hors des vols, pumping
// vertical de 0,3 g à 1,5 Hz en vol.
await go('/surf', 4000);
const imported = await evaluate(`(async () => {
  const { encodeImu } = await import('/src/core/imuFile.ts');
  const { synthImu, SYNTH_WALL_MS } = await import('/src/core/imuSynthetic.ts');
  const start = SYNTH_WALL_MS;
  const flights = [[64, 124], [200, 230], [300, 320], [400, 410]];
  const inFlight = (t) => flights.some(([a, b]) => t >= a && t < b);
  const speed = (t) => (inFlight(t) ? 4.5 : flights.some(([a]) => t >= a - 4 && t < a) ? 2 : 1);
  const pts = [];
  let lat = 43.4;
  for (let i = 0; i <= 450; i++) {
    lat += speed(i) / 111195;
    pts.push('<trkpt lat="' + lat.toFixed(7) + '" lon="3.6"><time>' + new Date(start + i * 1000).toISOString() + '</time><extensions><speed>' + speed(i) + '</speed><course>0</course></extensions></trkpt>');
  }
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Pumping</name><type>surf</type><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  const G = 9.80665;
  const water = (t) => 0.4 * G * Math.sin(2 * Math.PI * 5.3 * t) + 0.3 * G * Math.sin(2 * Math.PI * 7.1 * t + 1) + 0.2 * G * Math.sin(2 * Math.PI * 3.3 * t + 2);
  const pump = (t) => (inFlight(t) ? Math.sin(2 * Math.PI * 1.5 * t) : 0);
  const rec = synthImu({ durationS: 450, az: (t) => (inFlight(t) ? 0.3 * G * pump(t) : water(t)), ay: (t) => 0.1 * G * pump(t), tilt: (t) => Math.PI / 6 + 0.1 * pump(t) });
  const imu = await encodeImu(rec.header, rec.series);
  const input = [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept);
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([gpx], 'pumping.gpx', { type: 'application/gpx+xml' }));
  dt.items.add(new File([imu], 'pumping.imu'));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { start, size: imu.length };
})()`);
console.log('import :', JSON.stringify(imported));
await wait(6000);
const startMs = imported?.start;
const record = await recordAt(startMs);
check('session rangée', record !== null, record ? `${record.gpx}, activité ${record.activityId}` : '');
const path = `/surf/analyse?session=${encodeURIComponent(record?.gpx ?? '')}`;
await go(path, 5000);
console.log('réglages :', await openTab('réglages'));
await wait(400);
const foilBox = await sessionBox('Foil');
if (foilBox === 'décochée') await sessionBox('Foil');
await wait(500);
let pumpBox = await evaluate(`[...document.querySelectorAll('.an-carte-panels label')].find((l) => l.querySelector('strong')?.textContent === 'Pumping')?.querySelector('input')?.checked`);
if (pumpBox !== true) pumpBox = await sessionBox('Pumping');
console.log('Foil :', foilBox, '| Pumping :', pumpBox);
await wait(1500);
console.log('vols :', await openTab('vols'));
await wait(2000);
const vols = await panel('Vols');
console.log('panneau :', vols);
check('quatre vols', /Vols \(4\)/.test(vols ?? ''));
const freq = Number(/Fréquence \/ (\d+) \/min/.exec(vols ?? '')?.[1]);
check('fréquence vers 90 coups par minute', Math.abs(freq - 90) <= 5, String(freq));
check('distance par coup', /Par coup \/ 3\.\d m/.test(vols ?? ''), /Par coup \/ [^/]+/.exec(vols ?? '')?.[0]);
const heads = await flightHeads();
check('podium avec décollage, fréquence et m/coup', /Plus longs, Durée, Distance, Décollage \(km\/h\), Fréquence, m\/coup, Carte/.test(heads ?? ''), heads);
check('tableau complet replié', !/N°/.test(heads ?? ''));
console.log('déplier :', await clickText('Tous les vols (4)'));
await wait(400);
const allHeads = await flightHeads();
check('tableau complet déplié', /N°, Heure, Durée, Distance, Décollage \(km\/h\), Vagues, Pompage, Distance pompée, Coups, Fréquence, m\/coup, Carte/.test(allHeads ?? ''), allHeads);
console.log('lignes :', await evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith('Vols'));
  const tables = t?.closest('.an-carte-panels > *').querySelectorAll('table');
  return tables ? [...tables[tables.length - 1].querySelectorAll('tbody tr')].map((r) => [...r.cells].slice(0, -1).map((c) => c.textContent).join(' ')).join(' | ') : '(absent)';
})()`));
console.log('Voir le vol 2 :', await evaluate(`(() => {
  const row = [...document.querySelectorAll('.an-carte-panels tr')].find((r) => r.cells[0]?.textContent === '2');
  const b = row?.querySelector('button'); if (!b) return 'absent'; b.click(); return 'ok';
})()`));
await wait(500);
check('vol 2 sur la carte', (await evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#7b1fa2"]').length`)) > 0);
await shoot('pumping-vols');

// --- 3. Pumping décoché pour la session, puis enregistré ---
console.log('Pumping :', await sessionBox('Pumping'));
await wait(800);
const gpsHeads = await flightHeads();
check('colonnes du GPS sans pumping', /Vagues, Pompage, Pompe \(km\/h\)/.test(gpsHeads ?? '') && !/Décollage/.test(gpsHeads ?? ''), gpsHeads);
console.log('Pumping :', await sessionBox('Pumping'));
await wait(800);
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await wait(2500);
const saved = await recordAt(startMs);
// Pumping coché pour Surf foil en 1 ; la session, sous Surf, n'a pas le pumping de son activité : le sien est rangé.
check('foil et pumping rangés dans la fiche', saved?.analysis?.foil === true && saved?.analysis?.pumping === true, JSON.stringify({ foil: saved?.analysis?.foil, pumping: saved?.analysis?.pumping }));

// --- 4. Enregistrer ---
await go('/enregistrer', 3000);
await clickText('Surf', '.ui-tab');
await wait(300);
console.log('activité Surf foil :', await evaluate(`(() => {
  const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent === 'Surf foil'));
  if (!s) return 'absent';
  const o = [...s.options].find((x) => x.textContent === 'Surf foil');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(300);
check('pas de case « Mesurer le pumping » dans le navigateur', !(await evaluate(`document.body.innerText.includes('Mesurer le pumping')`)));

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(path, 5000);
await openTab('vols');
await wait(1500);
await shoot('pumping-telephone');
const width = await evaluate('document.documentElement.scrollWidth');
check('pas de débordement à 390 px', width <= 390, String(width));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'Tout passe.' : `${failures} échec(s).`);
ws.close();
