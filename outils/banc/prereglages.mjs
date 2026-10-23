// Banc de test : pré-réglages du bateau, puis de tous les sports hors surf (demandes du 21/10).
// Usage : node prereglages.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min. Vérifie :
//  1. mise à jour : les réglages d'avant d'une activité sur Bateau (couleurs, pause, seuil, chiffres) et de la Voile
//     (wingfoil) sont effacés une fois, l'unité du bateau et ceux du kite restent, `presetsVersion` rangée ; rechargée,
//     rien ne bouge ;
//  2. Réglages : le bateau colore de 1 à 15 nd (« défaut »), pause sous 0,2 km/h pendant 60 s, chiffres vitesse,
//     moyenne, distance et cap, notification vitesse et distance, pas de ligne « Seuil d'activité », sans « · modifié » ;
//     la Voile à 8 nd (seuil, couleurs de 8 à 24) ; Course, Route, Gravel, VTT et fractionnés sans seuil, Marche à
//     0,5 km/h ; couleurs, pause et poids du vélo pré-réglés ; plus de ligne « Terrain » ; aucune carte « modifié » ;
//  3. analyse d'une session bateau : « général » sans distance, temps, ratio ni moyenne actifs, onglet réglages sans
//     seuil ; une session Voile les garde ;
//  4. une course de deux `<trkseg>` séparés par 10 min de pause, vitesse Doppler comprise : ni la distance ni le temps
//     en mouvement de la pause ne sont comptés (bug du 17/10), dans le résumé comme dans l'analyse ;
//  5. un réglage du bateau fait après la mise à jour reste au rechargement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node prereglages.mjs <port> [<dossier des captures>]');
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
// Rangée « avancé » des analyses ouverte d'office (22/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {}` });
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://*.openstreetmap.org/*', '*://server.arcgisonline.com/*', '*://data.geopf.fr/*', '*://overpass-api.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
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
const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? 'null')`);
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

const SAIL = { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: '#1976d2' };
const RUN = { id: 'running', name: 'Course', base: 'running', color: '#d42a3c' };
const BOAT = { id: 'a-voilier', name: 'Voilier', base: 'bateau', color: '#014e86' };
// Les autres activités de départ, toutes pré-réglées.
const OTHERS = [
  { id: 'a-marche', name: 'Marche', base: 'running', color: '#970029' },
  { id: 'cycling', name: 'Route', base: 'cycling', color: '#1e7a3c' },
  { id: 'a-gravel', name: 'Gravel', base: 'cycling', color: '#015215' },
  { id: 'a-vtt', name: 'VTT', base: 'cycling', color: '#6f9a3a' },
  { id: 'run-intervals', name: 'Fractionné à pied', base: 'run-intervals', color: '#c25700' },
  { id: 'bike-intervals', name: 'Fractionné vélo', base: 'bike-intervals', color: '#873e04' },
];

// 1. Réglages d'avant les pré-réglages, puis rechargement : la mise à jour se fait au démarrage.
await go('/');
await evaluate(`(() => {
  localStorage.clear();
  localStorage.setItem('tracker.sportSettings', JSON.stringify({
    activities: ${JSON.stringify([SAIL, RUN, ...OTHERS, BOAT])}, activitiesVersion: 6,
    speedRanges: { 'a-voilier': { minMs: 1.5, maxMs: 6 }, wingfoil: { minMs: 3, maxMs: 12 }, kite: { minMs: 3, maxMs: 12 } },
    thresholds: { 'a-voilier': 3, wingfoil: 9, running: 2, kite: 9 },
    terrains: { running: 'trail' },
    autoPause: { 'a-voilier': { speedMs: 0.3, delayS: 60 } },
    liveFields: { 'a-voilier': ['speed', 'max'] },
    notificationFields: { 'a-voilier': ['speed', 'max'] },
    speedUnits: { 'a-voilier': 'kmh' },
  }));
  return 'ok';
})()`);
await go('/');
const after = await stored();
check('bateau : couleurs, seuil, pause et chiffres d\'avant effacés',
  !after?.speedRanges?.['a-voilier'] && !after?.thresholds?.['a-voilier'] && !after?.autoPause?.['a-voilier']
  && !after?.liveFields?.['a-voilier'] && !after?.notificationFields?.['a-voilier'], JSON.stringify(after));
check('Voile et Course : couleurs et seuil d\'avant effacés', !after?.speedRanges?.wingfoil && !after?.thresholds?.wingfoil && !after?.thresholds?.running);
check('kite : couleurs et seuil gardés', after?.speedRanges?.kite?.maxMs === 12 && after?.thresholds?.kite === 9);
check('bateau : unité gardée', after?.speedUnits?.['a-voilier'] === 'kmh');
check('presetsVersion rangée', after?.presetsVersion === 2, String(after?.presetsVersion));
await go('/');
check('rechargée : rien ne bouge', JSON.stringify(await stored()) === JSON.stringify(after));
// L'unité remise aux nœuds pour lire les bornes en nœuds.
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings'));
  delete s.speedUnits['a-voilier'];
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
  return 'ok';
})()`);

// 2. Réglages : familles Voile, À pied, Vélo et Fractionné, leurs cartes ouvertes, toutes leurs parties dépliées.
await evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections.settings = { ...sections.settings, activites: true };
  sections['settings-families'] = { voile: true, course: true, velo: true, fractionne: true };
  sections['settings-activities'] = Object.fromEntries(['wingfoil', 'a-voilier', 'running', 'a-marche', 'cycling', 'a-gravel', 'a-vtt', 'run-intervals', 'bike-intervals'].map((id) => [id, true]));
  sections['settings-activity-parts'] = { affichage: true, analyse: true, enregistrement: true, itineraires: true, balises: true };
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
await go('/parametres');
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === ${JSON.stringify(name)})`;
const rowOf = (name, label) => `[...(${card(name)}?.querySelectorAll('.setting-row, .settings-row, [class*=row]') ?? [])].find((r) => r.textContent.startsWith(${JSON.stringify(label)}))`;
const inputs = (name, label) => evaluate(`[...(${rowOf(name, label)}?.querySelectorAll('input') ?? [])].map((i) => ({ value: i.value, placeholder: i.placeholder }))`);
const selects = (name, label) => evaluate(`[...(${rowOf(name, label)}?.querySelectorAll('select') ?? [])].map((s) => s.value).filter(Boolean)`);
const rowText = (name, label) => evaluate(`(${rowOf(name, label)})?.textContent ?? null`);

const boatColors = await inputs('Voilier', 'Colorisation de la trace');
check('bateau : couleurs de 1 à 15 nd, affichées', JSON.stringify(boatColors.map((i) => i.value)) === '["1","15"]', JSON.stringify(boatColors));
check('bateau : couleurs « défaut »', (await rowText('Voilier', 'Colorisation de la trace'))?.includes('défaut') === true);
const pause = await inputs('Voilier', 'Pause automatique');
check('bateau : pause sous 0,2 km/h pendant 60 s', JSON.stringify(pause.map((i) => i.value)) === '["0.2","60"]', JSON.stringify(pause));
const live = await selects('Voilier', "Carte réduite à l'enregistrement");
check('bateau : vitesse, moyenne, distance, cap', JSON.stringify(live) === '["speed","average","distance","heading"]', JSON.stringify(live));
const notif = await selects('Voilier', 'Chiffres de la notification');
check('bateau : notification vitesse et distance', JSON.stringify(notif) === '["speed","distance"]', JSON.stringify(notif));
check('bateau : pas de seuil d\'activité', (await rowText('Voilier', "Seuil d'activité")) === null);
const boatHead = await evaluate(`${card('Voilier')}?.querySelector('.settings-activity__head')?.textContent ?? ''`);
check('bateau : sans « · modifié »', !boatHead.includes('modifié'), boatHead);
const values = async (name, label) => (await inputs(name, label)).map((i) => i.value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('Voile : seuil 8 nd, « défaut »', same(await values('Voile', "Seuil d'activité"), ['8']) && (await rowText('Voile', "Seuil d'activité"))?.includes('défaut') === true,
  JSON.stringify(await values('Voile', "Seuil d'activité")));
check('Voile : couleurs de 8 à 24 nd', same(await values('Voile', 'Colorisation de la trace'), ['8', '24']), JSON.stringify(await values('Voile', 'Colorisation de la trace')));
check('Voile : pause sous 1,5 km/h pendant 60 s', same(await values('Voile', 'Pause automatique'), ['1.5', '60']));
const EXPECTED = [
  { name: 'Course', threshold: '0', colors: ['1', '13'], pause: ['0.5', '20'] },
  { name: 'Marche', threshold: '0.5', colors: ['1', '8'], pause: ['0.5', '20'] },
  { name: 'Route', threshold: '0', colors: ['8', '45'], pause: ['1.1', '30'], bikeKg: '12' },
  { name: 'Gravel', threshold: '0', colors: ['5', '40'], pause: ['1.1', '20'], bikeKg: '13' },
  { name: 'VTT', threshold: '0', colors: ['10', '40'], pause: ['1.1', '20'], bikeKg: '13' },
  { name: 'Fractionné à pied', threshold: '0', colors: ['4', '20'], pause: ['0', '60'] },
  { name: 'Fractionné vélo', threshold: '0', colors: ['10', '30'], pause: ['0', '60'] },
];
for (const e of EXPECTED) {
  const threshold = await values(e.name, "Seuil d'activité");
  const thresholdText = await rowText(e.name, "Seuil d'activité");
  check(`${e.name} : seuil ${e.threshold === '0' ? 'aucun' : e.threshold}`, same(threshold, [e.threshold])
    && (e.threshold !== '0' || thresholdText?.includes('aucun seuil') === true), `${JSON.stringify(threshold)} ${thresholdText}`);
  check(`${e.name} : couleurs ${e.colors.join(' à ')}`, same(await values(e.name, 'Colorisation de la trace'), e.colors), JSON.stringify(await values(e.name, 'Colorisation de la trace')));
  check(`${e.name} : pause ${e.pause.join(' / ')}`, same(await values(e.name, 'Pause automatique'), e.pause), JSON.stringify(await values(e.name, 'Pause automatique')));
  if (e.bikeKg) {
    const weight = await inputs(e.name, 'Poids du vélo');
    check(`${e.name} : vélo de ${e.bikeKg} kg`, weight[0]?.placeholder === e.bikeKg, JSON.stringify(weight));
  }
  check(`${e.name} : plus de ligne « Terrain »`, (await rowText(e.name, 'Terrain')) === null);
}
const modified = await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => c.querySelector('.settings-activity__head')?.textContent.includes('modifié')).map((c) => c.querySelector('.settings-activity__name')?.textContent)`);
check('aucune carte « modifié »', modified?.length === 0, JSON.stringify(modified));
await shoot('prereglages-reglages');

// 3. Analyses : une session bateau et une session Voile, même trace (aller-retour lent à Palavas, 2 m/s).
const loopGpx = (type, t0) => {
  const lat0 = 43.515;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat0 * Math.PI) / 180);
  const pts = [];
  const seconds = 900;
  const half = seconds / 2;
  let m = 0;
  for (let k = 0; k <= seconds; k++) {
    // Un bord lent à 0,3 m/s au milieu de l'aller, 2 m/s ailleurs ; retour 200 m plus au sud.
    const speed = k > 150 && k < 300 ? 0.3 : 2;
    if (k > 0) m += (k <= half ? 1 : -1) * speed;
    const lat = lat0 - (k <= half ? 0 : 0.002);
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${(3.9 + m / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Bords</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const SESSIONS = [
  { name: 'bateau', type: 'bateau', start: Date.UTC(2026, 9, 10, 13) },
  { name: 'voile', type: 'wingfoil', start: Date.UTC(2026, 9, 11, 13) },
];
const paths = {};
for (const s of SESSIONS) {
  await go('/voile', 3000);
  console.log(`import ${s.name} :`, await importGpx(loopGpx(s.type, s.start), `${s.name}.gpx`));
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  check(`${s.name} rangée`, Boolean(rec));
  paths[s.name] = `/voile/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  if (s.name === 'bateau') {
    const sum = rec?.summary;
    check('bateau : résumé, toute la session en navigation', sum && Math.abs(sum.movingTimeS - (sum.endMs - sum.startMs) / 1000) < 1, JSON.stringify({ moving: sum?.movingTimeS, total: sum && (sum.endMs - sum.startMs) / 1000 }));
  }
}
// Onglets général et réglages ouverts.
await evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections['sailing-onglets'] = { ...sections['sailing-onglets'], general: true, reglages: true };
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
for (const s of SESSIONS) {
  await go(paths[s.name], 6000);
  const text = await evaluate(`document.body.innerText`);
  const has = (word) => text.includes(word);
  // « Distance en vol » et « Moyenne en vol » en foil, dans le « général » du 22/10.
  const shown = ['Distance active', 'Distance en vol', 'Temps actif', 'Ratio de navigation', 'Moyenne active', 'Moyenne en vol', "Seuil d'activité"].filter(has);
  if (s.name === 'bateau') {
    check('analyse bateau : ni distance, temps, ratio, moyenne actifs, ni seuil', shown.length === 0, JSON.stringify(shown));
    check('analyse bateau : distance, temps total et moyenne', has('Temps total') && has('Vitesse moyenne'));
    await shoot('prereglages-analyse-bateau');
  } else {
    check('analyse Voile : chiffres actifs et seuil gardés', ['Distance en vol', 'Temps actif', 'Moyenne en vol', "Seuil d'activité"].every(has), JSON.stringify(shown));
  }
}

// 4. Une course de deux `<trkseg>` : 5 min à 3 m/s, 10 min de pause, 5 min à 3 m/s, vitesse Doppler sur chaque point.
const pausedGpx = (t0) => {
  const lat0 = 43.62;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat0 * Math.PI) / 180);
  const seg = (fromS, toS, fromM) => {
    const pts = [];
    for (let k = fromS; k <= toS; k++) {
      const m = fromM + (k - fromS) * 3;
      pts.push(`<trkpt lat="${lat0}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>3</speed></extensions></trkpt>`);
    }
    return `<trkseg>\n${pts.join('\n')}\n</trkseg>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Pause</name><type>running</type>${seg(0, 300, 0)}${seg(900, 1200, 900)}</trk></gpx>\n`;
};
const runStart = Date.UTC(2026, 9, 12, 8);
await go('/course', 3000);
console.log('import course :', await importGpx(pausedGpx(runStart), 'pause.gpx'));
await wait(5000);
const runRec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - runStart) < 2000);
const runSum = runRec?.summary;
check('course en pause : 1 800 m, pas 3 600', runSum && Math.abs(runSum.distanceM - 1800) < 20, String(runSum?.distanceM));
check('course en pause : 10 min en mouvement, sur 20', runSum && Math.abs(runSum.movingTimeS - 600) < 5 && runSum.endMs - runSum.startMs === 1_200_000,
  JSON.stringify({ moving: runSum?.movingTimeS, total: runSum && (runSum.endMs - runSum.startMs) / 1000 }));
// « général » est ouvert d'office.
await go(`/course/analyse?session=${encodeURIComponent(runRec?.gpx ?? '')}`, 6000);
const runText = await evaluate(`document.body.innerText`);
check('analyse de la course : 1,80 km, 10 min en mouvement sur 20', /Distance\n1[,.]80\s*km/.test(runText ?? '')
  && /Temps de parcours\n20 min/.test(runText ?? '') && /Temps en mouvement \(50[,.]0 %\)\n10 min/.test(runText ?? ''),
  (runText ?? '').split('\n').filter((l) => /km|min/.test(l)).slice(0, 12).join(' | '));
await shoot('prereglages-course-pause');

// 5. Un réglage du bateau fait après la mise à jour reste.
await go('/parametres');
await evaluate(`(() => {
  const input = ${rowOf('Voilier', 'Pause automatique')}?.querySelector('input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, '0.5');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'ok';
})()`);
await wait(500);
const set = (await stored())?.autoPause?.['a-voilier'];
check('bateau : pause réglée à 0,5 km/h rangée', set && Math.abs(set.speedMs * 3.6 - 0.5) < 1e-6, JSON.stringify(set));
await go('/');
const kept = (await stored())?.autoPause?.['a-voilier'];
check('rechargée : réglage gardé', kept && Math.abs(kept.speedMs * 3.6 - 0.5) < 1e-6, JSON.stringify(kept));

console.log(logs.length ? `--- console ---\n${logs.join('\n')}` : 'console : rien');
console.log(failures ? `${failures} échec(s)` : 'tout est passé');
await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
ws.close();
