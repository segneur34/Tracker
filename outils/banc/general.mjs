// Banc de test : onglet « général » complet et rangée « avancé » (demande du 22/10).
// Usage : node general.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau (IGN, Overpass, tuiles bloqués). Dure environ 1 min 30. Le script :
//  1. importe une wing (bords et manœuvres, vent du nord), une course et une sortie à vélo en côte, une session de surf ;
//  2. voile, à 1400×1000 : la première rangée « général · avancé », les chiffres du nouveau général (distance en vol,
//     virements et empannages réussis, top 2 s et 100 m), la mini-boussole et « Régler » ; « avancé » déplie les
//     onglets, « tops » ouvert, « avancé » refermé replie rangée et panneau, rouvert les rend ; la flèche qui cache
//     la barre ne touche à aucun panneau ;
//  3. réglage du vent sur la carte : la flèche tirée à l'est donne 90°, écrit dans le brouillon ; « Inverser »,
//     « Polaire » (dessinée), « Terminé » ;
//  4. course et vélo : chiffres du général, meilleurs segments, profil d'altitude compact ; surf : chiffres réduits ;
//  5. à 390×844 : voile sans débordement, « Régler » ouvre la carte en plein écran avec la boussole, « Terminé » la ferme.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node general.mjs <port> [<dossier des captures>]');
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
/** Libellés d'une rangée d'onglets : 0 la première, 1 la rangée « avancé ». */
const row = (k) => evaluate(`[...(document.querySelectorAll('.an-carte-col .an-tabs > .ui-tabs')[${k}]?.querySelectorAll('.ui-tab') ?? [])].map((t) => t.textContent.trim()).join(' | ')`);
const clickTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return false;
  t.click();
  return true;
})()`);
const advancedOpen = () => evaluate(`document.querySelector('.an-tabs-advanced-toggle')?.getAttribute('aria-expanded') === 'true'`);
const setAdvanced = async (wanted) => {
  if ((await advancedOpen()) !== wanted) await clickTab('avancé');
  await wait(400);
};
const setTab = (label, wanted) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if ((t.getAttribute('aria-pressed') === 'true') !== ${wanted}) t.click();
  return 'ok';
})()`);
const panelOf = (title) => `[...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *')`;
const panel = async (title) => (await evaluate(`${panelOf(title)}?.innerText.replace(/\\n+/g, ' / ') ?? '(absent)'`));
const panelCount = () => evaluate(`document.querySelectorAll('.an-carte-panels > *').length`);
const clickButton = (scope, text) => evaluate(`(() => {
  const b = [...(${scope})?.querySelectorAll('button') ?? []].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false;
  b.click();
  return true;
})()`);
let failures = 0;
const check = (what, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*', '*://server.arcgisonline.com/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions synthétiques ---
const gpxOf = (type, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Banc</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
/** Wing : la trace de `make-gpx.mjs` (bords de près et de portant, virements et empannages, vent du nord), 8 m/s et plus. */
const wingGpx = (t0) => {
  let lat = 43.5, lon = 3.95, t = 0;
  const R = 6371000;
  const pts = [];
  const step = (heading, speed) => {
    lat += (speed * Math.cos(heading * Math.PI / 180)) / R * 180 / Math.PI;
    lon += (speed * Math.sin(heading * Math.PI / 180)) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t0 + t * 1000).toISOString()}</time><extensions><speed>${speed.toFixed(2)}</speed></extensions></trkpt>`);
    t++;
  };
  const leg = (h, s, n) => { for (let i = 0; i < n; i++) step(h + Math.sin(i / 7) * 3, s + Math.sin(i / 5) * 0.5); };
  const turn = (from, to, sMin, sMax, n) => {
    const diff = ((to - from + 540) % 360) - 180;
    for (let i = 1; i <= n; i++) step((from + diff * (i / n) + 360) % 360, sMax - (sMax - sMin) * Math.sin(Math.PI * (i / n)));
  };
  for (let k = 0; k < 6; k++) { leg(45, 7, 150); turn(45, 315, 5, 7, 6); leg(315, 7, 150); turn(315, 45, 5, 7, 6); }
  turn(45, 135, 6, 9, 5);
  for (let k = 0; k < 6; k++) { leg(135, 9, 150); turn(135, 225, 6, 9, 6); leg(225, 9, 150); turn(225, 135, 6, 9, 6); }
  return gpxOf('wingfoil', pts);
};
/** Aller et retour vers l'est, en côte de `grade` à l'aller, à vitesse constante, avec altitude. */
const hillGpx = (type, seconds, speed, grade, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  const half = seconds / 2;
  for (let k = 0; k <= seconds; k++) {
    const m = (k <= half ? k : seconds - k) * speed;
    pts.push(`<trkpt lat="${(lat + (k > half ? 0.0002 : 0)).toFixed(7)}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + grade * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
  }
  return gpxOf(type, pts);
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
  return gpxOf('surf', pts);
};
const MORNING = [
  [60, 0], [60, 1.2], [50, 1], [4, 0.1], [40, 1], [4, 0.1], [26, 1], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1],
  [5, 1.6, 180], [8, 4.5, 190], [80, 1], [30, 0.1],
];
const T_VOILE = Date.UTC(2026, 9, 5, 13, 0, 0);
const T_RUN = Date.UTC(2026, 9, 6, 8, 0, 0);
const T_BIKE = Date.UTC(2026, 9, 6, 14, 0, 0);
const T_SURF = Date.UTC(2026, 9, 7, 7, 0, 0);
const SESSIONS = [
  { key: 'voile', page: 'voile', start: T_VOILE, gpx: wingGpx(T_VOILE) },
  // Course : 40 min à 3 m/s, 3 % à l'aller.
  { key: 'course', page: 'course', start: T_RUN, gpx: hillGpx('running', 2400, 3, 0.03, T_RUN) },
  // Vélo : 50 min à 7 m/s, 2 % à l'aller.
  { key: 'velo', page: 'velo', start: T_BIKE, gpx: hillGpx('cycling', 3000, 7, 0.02, T_BIKE) },
  { key: 'surf', page: 'surf', start: T_SURF, gpx: surfGpx(T_SURF, MORNING) },
];

const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `${s.key}.gpx`));
  await wait(6000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.key] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.key} rangée`, Boolean(rec));
}

// --- 2. Voile : général et « avancé » ---
await go(paths.voile, 7000);
check('voile : première rangée « général · avancé »', (await row(0)) === 'général | avancé', await row(0));
check('voile : « avancé » fermé au départ, pas de seconde rangée', !(await advancedOpen()) && (await row(1)) === '', await row(1));
let general = await panel('Général');
console.log('général voile :', general);
for (const label of ['Distance en vol', 'Temps total', 'Temps actif', 'Ratio de vol', 'Moyenne en vol', 'Virements réussis', 'Empannages réussis', 'Top 2 s', 'Top 100 m', 'Vent', 'Régler']) {
  // Sans casse : les boutons et les titres sont en capitales (typographie de l'accueil, 22/10).
  check(`voile, général : « ${label} »`, general.toLowerCase().includes(label.toLowerCase()), general.slice(0, 200));
}
check('voile, général : des manœuvres comptées', /Virements réussis \/ \d+ \/ \d+ \(\d+ %\)/.test(general), general);
check('voile, général : ni distance totale ni saisie du vent', !general.includes('Distance /') && !general.includes('Saisie'), general);
await shoot('general-voile');

await setAdvanced(true);
const adv = await row(1);
check('« avancé » déplie les onglets', adv.startsWith('tops | manœuvres | graphiques') && adv.endsWith('réglages'), adv);
check('« avancé » ouvert ferme « général » (23/10)', (await panel('Général')) === '(absent)');
await setTab('tops', true);
await wait(600);
check('« tops » ouvert', (await panel('Tops Temps')) !== '(absent)');
await setAdvanced(false);
check('« avancé » refermé : rangée et panneau repliés, « général » rouvert', (await row(1)) === '' && (await panel('Tops Temps')) === '(absent)' && (await panel('Général')) !== '(absent)');
await setAdvanced(true);
check('« avancé » rouvert : « tops » revient', (await panel('Tops Temps')) !== '(absent)');
const before = await panelCount();
await evaluate(`document.querySelector('.an-tabs-hide')?.click()`);
await wait(400);
check('flèche : la barre se cache, les panneaux restent', (await evaluate(`Boolean(document.querySelector('.an-tabs-reveal'))`)) && (await panelCount()) === before);
await evaluate(`document.querySelector('.an-tabs-reveal')?.click()`);
await wait(400);
check('« onglets » rend la barre, « avancé » toujours ouvert', (await advancedOpen()) && (await row(1)) !== '');
await setTab('tops', false);
await setAdvanced(false);

// --- 3. Réglage du vent sur la carte ---
check('« Régler » ouvre la boussole sur la carte', (await clickButton(panelOf('Général'), 'Régler')) && (await wait(1200), await evaluate(`Boolean(document.querySelector('.an-map-panel .an-wind__dial'))`)));
const dial = await evaluate(`(() => { const r = document.querySelector('.an-map-panel .an-wind__dial').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
const windText = () => evaluate(`document.querySelector('.an-map-panel .an-wind__value')?.textContent ?? ''`);
console.log('boussole :', JSON.stringify(dial), await windText());
await shoot('general-vent');
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
await mouse('mousePressed', dial.x, dial.y - dial.w * 0.35);
await mouse('mouseMoved', dial.x + dial.w * 0.25, dial.y - dial.w * 0.25);
await mouse('mouseMoved', dial.x + dial.w * 0.35, dial.y);
await wait(200);
check('la flèche suit le pointeur avant le lâcher', (await windText()) === 'Vent 90°', await windText());
await mouse('mouseReleased', dial.x + dial.w * 0.35, dial.y);
await wait(1500);
general = await panel('Général');
check('lâchée : vent saisi à 90° dans le général', general.includes('Vent 90°') && general.includes('saisi'), general);
check('vent dans le brouillon : « Enregistrer la session »', await evaluate(`document.body.textContent.includes('Enregistrer la session')`));
await clickButton(`document.querySelector('.an-map-panel .an-wind')`, 'Inverser');
await wait(1200);
check('« Inverser » : 270°', (await windText()) === 'Vent 270°', await windText());
await clickButton(`document.querySelector('.an-map-panel .an-wind')`, 'Polaire');
await wait(1200);
check('« Polaire » : la polaire est dessinée', await evaluate(`Boolean(document.querySelector('.an-map-panel .an-wind__polar .recharts-polar-grid'))`));
await shoot('general-polaire');
await clickButton(`document.querySelector('.an-map-panel .an-wind')`, 'Calculé');
await wait(1200);
check('« Calculé » : retour au vent calculé', (await panel('Général')).includes('calculé'), await panel('Général'));
await clickButton(`document.querySelector('.an-map-panel .an-wind')`, 'Terminé');
await wait(500);
check('« Terminé » ferme la boussole', !(await evaluate(`Boolean(document.querySelector('.an-wind'))`)));

// --- 4. Course, vélo, surf ---
const profileShown = () => evaluate(`Boolean((${panelOf('Général')})?.querySelector('.recharts-area'))`);
// Une session neuve s'ouvre sur « général », « avancé » fermé, quel que soit l'état laissé (23/10).
await setAdvanced(true);
await go(paths.course, 8000);
check('session neuve : « général » ouvert, « avancé » fermé', !(await advancedOpen()) && (await panel('Général')) !== '(absent)');
general = await panel('Général');
console.log('général course :', general);
for (const label of ['Distance', 'Temps de parcours', 'Temps en mouvement', 'Moyenne en mouvement', 'Dénivelé', 'Meilleur 1 km']) {
  check(`course, général : « ${label} »`, general.includes(label), general.slice(0, 200));
}
check('course, général : ni moyenne sur le temps total ni altitude min–max', !general.includes('Moyenne sur le temps total') && !general.includes('Altitude /'), general);
check('course : profil d\'altitude compact', await profileShown());
check('course : première rangée « général · avancé »', (await row(0)) === 'général | avancé', await row(0));
await shoot('general-course');
// La même session rouverte après une autre page garde son état.
await setAdvanced(true);
await go('/statistiques', 2000);
await go(paths.course, 8000);
check('même session rouverte : « avancé » gardé ouvert, « général » fermé', (await advancedOpen()) && (await panel('Général')) === '(absent)');
await setAdvanced(false);

await go(paths.velo, 8000);
general = await panel('Général');
console.log('général vélo :', general);
for (const label of ['Moyenne en mouvement', 'Dénivelé', 'Meilleures 5 min', 'Meilleur 10 km']) {
  check(`vélo, général : « ${label} »`, general.includes(label), general.slice(0, 200));
}
check('vélo : profil d\'altitude compact', await profileShown());

await go(paths.surf, 6000);
general = await panel('Général');
console.log('général surf :', general);
for (const label of ['Durée de la session', 'Vagues', 'Sur la vague', 'Plus longue vague', 'Vitesse max']) {
  check(`surf, général : « ${label} »`, general.includes(label), general.slice(0, 200));
}
check('surf, général : sans rame, retour au pic ni distance totale', !/Vitesse de rame|Retour au pic|Distance totale/.test(general), general);

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.voile, 7000);
check('390 px : voile sans débordement', (await overflow()) <= 0);
await setAdvanced(true);
check('390 px : « avancé » ouvert, sans débordement', (await overflow()) <= 0);
await shoot('general-voile-390');
await setAdvanced(false);
await clickButton(panelOf('Général'), 'Régler');
await wait(1200);
check('390 px : « Régler » ouvre la carte en plein écran avec la boussole', await evaluate(`Boolean(document.querySelector('.an-map-overlay .an-wind__dial'))`));
await shoot('general-vent-390');
await clickButton(`document.querySelector('.an-map-overlay .an-wind')`, 'Terminé');
await wait(500);
check('390 px : « Terminé » ferme la carte agrandie', !(await evaluate(`Boolean(document.querySelector('.an-map-overlay'))`)));

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? 'Tout passe.' : `${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(failures === 0 ? 0 : 1);
