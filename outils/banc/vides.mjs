// Banc de test : lot 1 des demandes du 20/10 (retouches et défauts).
// Usage : node vides.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau (IGN, Overpass, tuiles bloqués). Dure environ 1 min. Le script :
//  1. importe une voile en aller simple (vent impossible à estimer), une course sans altitude et une session de surf ;
//  2. voile : « manœuvres », « vmg » et « vent » ouverts disent « Vent inconnu », avec « Régler le vent », qui ouvre
//     la boussole sur la carte (22/10 ; « Ouvrir l'onglet général » avant) ;
//  3. course : « zones de pente » dit pourquoi elle est vide (pas d'altitude, IGN injoignable) et propose « Réessayer » ;
//  4. surf : la légende de la répartition ne redit pas le pourcentage « sur la vague » ; la rame garde le sien ;
//  5. à 360×800 : accueil sans lien Profil ni Statistiques, barre du bas Accueil · Profil · rond · Statistiques ·
//     Réglages ; Réglages, carte Voile ouverte : le nom en texte, qui replie la carte, « Renommer » à droite, sur la
//     ligne du nom ; Échap n'enregistre rien, Entrée renomme, le nom est relu ; rien ne déborde.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node vides.mjs <port> [<dossier des captures>]');
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
/** Met un onglet de l'analyse dans l'état voulu (ouvert ou fermé). */
const setTab = (label, wanted) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if ((t.getAttribute('aria-pressed') === 'true') !== ${wanted}) t.click();
  return 'ok';
})()`);
/** Texte du panneau d'analyse dont le titre commence ainsi. */
const panelOf = (title) => `[...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *')`;
const panel = async (title) => (await evaluate(`${panelOf(title)}?.innerText.replace(/\\n+/g, ' / ') ?? '(absent)'`));
const clickIn = (title, text) => evaluate(`(() => {
  const b = [...(${panelOf(title)})?.querySelectorAll('button') ?? []].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false;
  b.click();
  return true;
})()`);
let failures = 0;
const check = (what, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
// Rangée « avancé » des analyses ouverte d'office (22/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {}` });
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions synthétiques ---
/** Trace droite vers l'est, vitesse constante, altitude seulement si `ele`. */
const lineGpx = (type, seconds, speed, t0, ele) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= seconds; k++) {
    const m = k * speed;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}">${ele ? `<ele>${(50 + 0.02 * m).toFixed(1)}</ele>` : ''}<time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
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
const T_VOILE = Date.UTC(2026, 9, 5, 13, 0, 0);
const T_RUN = Date.UTC(2026, 9, 6, 8, 0, 0);
const T_SURF = Date.UTC(2026, 9, 7, 7, 0, 0);
const SESSIONS = [
  // Voile : 20 min droit devant à 8 m/s, aucune manœuvre, vent impossible à estimer.
  { page: 'voile', start: T_VOILE, gpx: lineGpx('wingfoil', 1200, 8, T_VOILE, true) },
  // Course : 30 min à 3 m/s, sans <ele>.
  { page: 'course', start: T_RUN, gpx: lineGpx('running', 1800, 3, T_RUN, false) },
  { page: 'surf', start: T_SURF, gpx: surfGpx(T_SURF, MORNING) },
];

const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.page} :`, await importGpx(s.gpx, `${s.page}.gpx`));
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.page] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.page} rangée`, Boolean(rec));
}

// --- 2. Voile sans vent ---
await go(paths.voile, 6000);
for (const tab of ['manœuvres', 'vmg', 'vent']) await setTab(tab, true);
await setTab('général', false);
await wait(1000);
for (const [title, word] of [['Manœuvres', 'virements et empannages'], ['Analyse VMG', 'la VMG'], ['Variations du Vent', 'ses variations']]) {
  const text = await panel(title);
  check(`voile, « ${title} » : « Vent inconnu », ${word}`, text.includes('Vent inconnu') && text.includes(word) && text.toLowerCase().includes('régler le vent'), text);
}
await shoot('vides-voile');
check('« Régler le vent » ouvre la boussole sur la carte', (await clickIn('Manœuvres', 'Régler le vent')) && (await wait(800), await evaluate(`Boolean(document.querySelector('.an-map-panel .an-wind__dial'))`)));
check('boussole ouverte : plus de bouton', !(await panel('Manœuvres')).toLowerCase().includes('régler le vent'));

// --- 3. Course sans altitude ---
await go(paths.course, 8000);
await setTab('zones de pente', true);
await wait(1000);
const zones = await panel('Allure par zone de pente');
check('course, zones de pente : pourquoi elle est vide', zones.includes("Pas d'altitude dans le fichier") && zones.includes('IGN'), zones);
check('course, zones de pente : « Réessayer »', zones.toLowerCase().includes('réessayer'), zones);
await shoot('vides-course');

// --- 4. Surf : légende de la répartition ---
await go(paths.surf, 6000);
await setTab('général', true);
await wait(800);
const legend = await evaluate(`document.querySelector('[title="Répartition du temps de la session"]')?.nextElementSibling?.innerText.replace(/\\n+/g, ' | ') ?? '(absente)'`);
const general = await panel('Général');
console.log('légende :', legend);
check('surf : « Sur la vague (x %) » dans les chiffres', /Sur la vague \(\d+[.,]\d %\)/.test(general), general.slice(0, 300));
check('surf : « sur la vague » sans pourcentage dans la légende', /sur la vague/.test(legend) && !/sur la vague\s*\d/.test(legend), legend);
check('surf : la rame garde le sien', /rame \d+ %/.test(legend), legend);

// --- 5. Téléphone : accueil, barre, Renommer ---
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
await go('/', 3000);
const homeLinks = await evaluate(`[...document.querySelectorAll('.home-link, .home-action')].map((a) => a.textContent.trim()).join(' | ')`);
check('accueil : ni Profil ni Statistiques', !/Profil|Statistiques/.test(homeLinks), homeLinks);
check('accueil : itinéraires planifiés gardés', homeLinks.includes('Itinéraires planifiés'), homeLinks);
const bar = await evaluate(`[...document.querySelectorAll('.shell-tabbar .shell-tab')].map((t) => t.textContent.trim()).join(' | ')`);
check('barre du bas : Accueil, Profil, Statistiques, Réglages', bar === 'Accueil | Profil | Statistiques | Réglages', bar);

await go('/parametres', 2000);
await evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections.settings = { ...sections.settings, activites: true };
  sections['settings-activities'] = { wingfoil: true };
  sections['settings-families'] = { voile: true };
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
await go('/parametres', 3000);
const card = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === NAME)`;
const voile = (name) => card.replace('NAME', JSON.stringify(name));
const head = (name) => evaluate(`(() => {
  const c = ${voile(name)};
  if (!c) return null;
  const toggle = c.querySelector('.settings-activity__toggle');
  const nameEl = c.querySelector('.settings-activity__name');
  const rename = [...c.querySelectorAll('.settings-activity__head > button')].find((b) => b.textContent.trim() === 'Renommer');
  const box = (el) => el?.getBoundingClientRect();
  return {
    open: toggle?.getAttribute('aria-expanded') === 'true',
    nameInToggle: Boolean(nameEl && toggle?.contains(nameEl)),
    input: Boolean(c.querySelector('input[aria-label="Nom de l\\'activité"]')),
    rename: Boolean(rename),
    sameLine: rename && nameEl ? Math.abs(box(rename).top + box(rename).height / 2 - (box(nameEl).top + box(nameEl).height / 2)) < 12 : false,
    eyeSameLine: nameEl && c.querySelector('.settings-eye') ? Math.abs(box(c.querySelector('.settings-eye')).top + box(c.querySelector('.settings-eye')).height / 2 - (box(nameEl).top + box(nameEl).height / 2)) < 12 : false,
  };
})()`);
let h = await head('Voile');
check('carte Voile ouverte : nom en texte dans le bouton, pas de champ', h?.open && h.nameInToggle && !h.input, JSON.stringify(h));
check('« Renommer » à droite, sur la ligne du nom', h?.rename && h.sameLine, JSON.stringify(h));
check('l\'œil au bout de la même ligne', h?.eyeSameLine, JSON.stringify(h));
check('360 px : rien ne déborde', (await overflow()) <= 0);
await shoot('vides-renommer');
await evaluate(`${voile('Voile')}.querySelector('.settings-activity__name').click(); 'ok'`);
await wait(300);
check('un toucher sur le nom replie la carte', (await head('Voile'))?.open === false);
await evaluate(`${voile('Voile')}.querySelector('.settings-activity__toggle').click(); 'ok'`);
await wait(300);

const startRename = () => evaluate(`(() => {
  const b = [...(${voile('Voile')})?.querySelectorAll('.settings-activity__head > button') ?? []].find((x) => x.textContent.trim() === 'Renommer');
  if (!b) return false;
  b.click();
  return true;
})()`);
const typeName = (value, key) => evaluate(`(() => {
  const i = document.querySelector('input[aria-label="Nom de l\\'activité"]');
  if (!i) return 'pas de champ';
  const focused = document.activeElement === i;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
  return focused ? 'focus' : 'sans focus';
})()`);
check('« Renommer » ouvre le champ, curseur dedans', (await startRename()) && (await wait(300), (await typeName('Voile bis', 'Escape')) === 'focus'));
await wait(300);
h = await head('Voile');
check('Échap : nom inchangé, champ refermé', h !== null && !h.input && h.rename, JSON.stringify(h));
await startRename();
await wait(300);
await typeName('Wing', 'Enter');
await wait(500);
h = await head('Wing');
check('Entrée : nouveau nom, champ refermé, carte ouverte', h !== null && !h.input && h.open, JSON.stringify(h));
await go('/parametres', 3000);
check('nom relu après rechargement', (await head('Wing')) !== null);

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? 'Tout est bon.' : `${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(failures === 0 ? 0 : 1);
