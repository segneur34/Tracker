// Banc de test : sauts en voile, étape 1 (réglages, foil, capteurs rangés avec la session).
// Usage : node sauts.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script fabrique lui-même, dans la page, une session de voile et ses
// capteurs (`.imu`, par l'encodeur de l'application), et vérifie :
//  1. Réglages, carte de l'activité « Voile » : « Foil » (coché d'office en wingfoil) et « Sauts » sous « Taille du
//     texte » ; sauts cochés, leurs sous-options (emplacement, hauteur minimale) ; foil décoché ; tout relu après
//     rechargement, résumé de la carte repliée compris ;
//  2. l'import d'une session avec ses capteurs : `.imu` rangé à côté du GPX, relisible ;
//  3. l'analyse, foil décoché pour l'activité : « Ratio de navigation », matériel sans « Foil » ni « Mât » ; foil coché
//     pour la session : « Ratio de vol », champs revenus, `analysis.foil` dans la fiche après « Enregistrer la session » ;
//  3 bis. l'onglet « sauts » : les deux sauts de la capture (vol libre de 1,3 s, 2,07 m, au-dessus de la hauteur minimale de 1,5 m réglée en 1), podium, tableau, courbe,
//     « Voir », sauts rangés dans la fiche ; captures sur ordinateur et à 390×844 ;
//  4. Enregistrer, dans le navigateur : pas de case « Mesurer les sauts » (téléphone seulement) ;
//  5. la suppression de la session : GPX, fiche et `.imu` effacés.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node sauts.mjs <port> [<dossier des captures>]');
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
await send('Runtime.enable');
await send('Page.enable');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const sessionsDir = `(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'))`;
const sessionFiles = () => evaluate(`(async () => {
  const names = [];
  for await (const [name] of ${sessionsDir}.entries()) names.push(name);
  return names.sort();
})()`);
const check = (label, ok, detail = '') => console.log(`${ok ? 'ok ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);

// --- 1. Réglages ---
await go('/parametres', 4000);
/** Ouvre la carte de l'activité « Voile » (et le bloc Activités s'il est replié). */
const openVoile = () => evaluate(`(() => {
  if (!document.querySelector('.settings-activity')) {
    const title = [...document.querySelectorAll('[role=button], button')].find((b) => b.textContent.trim() === 'Activités');
    title?.click();
  }
  return new Promise((r) => setTimeout(() => {
    const card = [...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent.trim() === 'Voile');
    if (!card) return r('carte absente');
    card.querySelector('.settings-activity__toggle').click();
    r('ok');
  }, 300));
})()`);
const voileCard = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__body') && c.querySelector('[value]'))`;
/** Lignes de la carte ouverte : libellé, état de la case éventuelle, sous-option. */
const rows = () => evaluate(`(() => {
  const card = ${voileCard};
  if (!card) return null;
  return [...card.querySelectorAll('.settings-row')].map((r) => ({
    label: r.querySelector('.settings-row__label')?.textContent.trim(),
    checked: r.querySelector('input[type=checkbox]')?.checked ?? null,
    sub: r.classList.contains('settings-row--sub'),
    text: r.innerText.replace(/\\n+/g, ' ').slice(0, 120),
  }));
})()`);
const clickBox = (label) => evaluate(`(() => {
  const row = [...(${voileCard}).querySelectorAll('.settings-row')].find((r) => r.querySelector('.settings-row__label')?.textContent.trim() === ${JSON.stringify(label)});
  const box = row?.querySelector('input[type=checkbox]');
  if (!box) return 'absent';
  box.click();
  return box.checked;
})()`);

console.log('carte Voile :', await openVoile());
await wait(500);
let list = await rows();
const labels = list.map((r) => r.label);
const scaleAt = labels.indexOf('Taille du texte');
check('Foil puis Sauts sous « Taille du texte »', labels[scaleAt + 1] === 'Foil' && labels[scaleAt + 2] === 'Sauts', labels.slice(scaleAt, scaleAt + 4).join(' | '));
check('Foil coché d\'office (wingfoil)', list.find((r) => r.label === 'Foil')?.checked === true);
check('Sauts décochés, sans sous-option', list.find((r) => r.label === 'Sauts')?.checked === false && !list.some((r) => r.sub));

console.log('cocher Sauts :', await clickBox('Sauts'));
await wait(400);
list = await rows();
const subs = list.filter((r) => r.sub);
check('sous-options visibles', subs.length === 2, subs.map((r) => r.text).join(' | '));
console.log('emplacement → bras :', await evaluate(`(() => {
  const row = [...(${voileCard}).querySelectorAll('.settings-row--sub')].find((r) => r.textContent.includes('Emplacement'));
  const s = row?.querySelector('select');
  if (!s) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'bras');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return row.innerText.replace(/\\n+/g, ' ');
})()`));
console.log('hauteur minimale → 1,5 :', await evaluate(`(() => {
  const row = [...(${voileCard}).querySelectorAll('.settings-row--sub')].find((r) => r.textContent.includes('Hauteur minimale'));
  const i = row?.querySelector('input');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '1.5');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`));
console.log('décocher Foil :', await clickBox('Foil'));
await wait(300);
await shoot('sauts-reglages');

await go('/parametres', 4000);
await openVoile();
await wait(500);
list = await rows();
check('relu : foil décoché, sauts cochés', list.find((r) => r.label === 'Foil')?.checked === false && list.find((r) => r.label === 'Sauts')?.checked === true);
check('relu : bras, 1,5 m', list.some((r) => r.sub && r.text.includes('Bras')) && await evaluate(`[...(${voileCard}).querySelectorAll('.settings-row--sub input')].some((i) => i.value === '1.5')`));
const stored = await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}')`);
check('rangé par activité', stored.foils?.wingfoil === false && stored.jumps?.wingfoil?.placement === 'bras', JSON.stringify({ foils: stored.foils, jumps: stored.jumps }));
// Carte repliée : le résumé dit « sauts », plus « foil ».
await evaluate(`(${voileCard}).querySelector('.settings-activity__toggle').click()`);
await wait(300);
const summary = await evaluate(`[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent.trim() === 'Voile')?.querySelector('.settings-activity__summary')?.textContent`);
check('résumé de la carte repliée', /sauts/.test(summary ?? '') && !/foil/.test(summary ?? ''), summary);

// --- 2. Import d'une session avec ses capteurs ---
// Trace de voile de 10 min à 1 Hz, et 10 min de capteurs à 100 Hz, fabriqués dans la page.
const startMs = Date.UTC(2026, 9, 1, 10, 0, 0);
await go('/voile', 4000);
console.log('import :', await evaluate(`(async () => {
  const { encodeImu, PHONE_STREAMS, IMU_FORMAT, IMU_VERSION } = await import('/src/core/imuFile.ts');
  const start = ${startMs};
  const pts = [];
  for (let i = 0; i < 600; i++) {
    const lat = 43.5 + i * 0.00003 * Math.cos(i / 120);
    const lon = 3.9 + i * 0.00003 * Math.sin(i / 120);
    pts.push('<trkpt lat="' + lat.toFixed(6) + '" lon="' + lon.toFixed(6) + '"><time>' + new Date(start + i * 1000).toISOString() + '</time><extensions><speed>' + (6 + Math.sin(i / 30)).toFixed(2) + '</speed></extensions></trkpt>');
  }
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sauts</name><type>wingfoil</type><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  const n = 60000;
  const t = Float64Array.from({ length: n }, (_, i) => i * 10000);
  // Deux sauts sans portance, à 200 s et 400 s : poussée de 0,3 s, vol de 1,3 s (2,07 m), atterrissage de 0,3 s.
  const jumpZ = (ti) => {
    const s = ti / 1e6;
    for (const at of [200, 400]) {
      if (s >= at - 0.3 && s < at) return 9.81 + 18;
      if (s >= at && s < at + 1.3) return 0;
      if (s >= at + 1.3 && s < at + 1.6) return 9.81 + 18;
    }
    return null;
  };
  const accel = { info: PHONE_STREAMS[0], t, values: [0, 1, 2].map((a) => Float32Array.from(t, (ti) => {
    const z = jumpZ(ti);
    return z !== null ? (a === 2 ? z : 0) : (a === 2 ? 9.81 : 0) + 0.3 * Math.sin(ti / 1e5 + a);
  })) };
  const gyro = { info: PHONE_STREAMS[1], t, values: [0, 1, 2].map((a) => Float32Array.from(t, (ti) => 0.2 * Math.cos(ti / 2e5 + a))) };
  const header = { format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: start, clock: { elapsedUs: 1e9, wallMs: start }, setup: { placement: 'bras', foil: false }, streams: PHONE_STREAMS.slice(0, 2) };
  const imu = await encodeImu(header, [accel, gyro]);
  window.__imuSize = imu.length;
  const input = [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept);
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([gpx], 'sauts.gpx', { type: 'application/gpx+xml' }));
  dt.items.add(new File([imu], 'sauts.imu'));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok, ' + imu.length + ' octets';
})()`));
await wait(5000);
let files = await sessionFiles();
// La session importée, par l'instant de son premier point (le profil peut en compter d'autres).
const gpxName = await evaluate(`(async () => {
  for await (const [name, h] of ${sessionsDir}.entries()) {
    if (!name.endsWith('.json')) continue;
    const r = JSON.parse(await (await h.getFile()).text());
    if (r.summary?.startMs === ${startMs}) return r.gpx;
  }
  return null;
})()`);
const imuName = gpxName?.replace(/\.gpx$/, '.imu');
check('.imu rangé à côté du GPX', files.includes(imuName), files.join(', '));
const relu = await evaluate(`(async () => {
  const { decodeImu, imuCaptureStats } = await import('/src/core/imuFile.ts');
  const f = await (await ${sessionsDir}.getFileHandle(${JSON.stringify(imuName ?? '')})).getFile();
  const rec = await decodeImu(new Uint8Array(await f.arrayBuffer()));
  const s = imuCaptureStats(rec);
  return { taille: f.size, attendue: window.__imuSize ?? null, duree: s.durationS, placement: rec.header.setup.placement };
})()`);
check('.imu relisible', relu?.duree > 599 && relu?.placement === 'bras', JSON.stringify(relu));

// --- 3. Analyse : foil de l'activité, puis de la session ---
const analysePath = `/voile/analyse?session=${encodeURIComponent(gpxName ?? '')}`;
await go(analysePath, 6000);
const openTab = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent';
  if (b.getAttribute('aria-pressed') !== 'true') b.click();
  return 'ok';
})()`);
await openTab('matos et conditions');
await openTab('réglages');
await wait(800);
const pageText = () => evaluate('document.body.innerText');
let text = await pageText();
check('foil décoché : « Ratio de navigation »', text.includes('Ratio de navigation') && !text.includes('Ratio de vol'));
check('foil décoché : ni « Foil » ni « Mât » au matériel', !/\nMât\n/.test(text) && text.includes('Aile / voile'));
console.log('cocher Foil pour la session :', await evaluate(`(() => {
  const label = [...document.querySelectorAll('label')].find((l) => l.querySelector('strong')?.textContent.trim() === 'Foil');
  const box = label?.querySelector('input[type=checkbox]');
  if (!box) return 'absent';
  box.click();
  return box.checked;
})()`));
await wait(500);
text = await pageText();
check('foil de la session : « Ratio de vol » et « Mât »', text.includes('Ratio de vol') && /Mât/.test(text));
console.log('enregistrer :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Enregistrer la session'));
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(1500);
const record = await evaluate(`(async () => JSON.parse(await (await (await ${sessionsDir}.getFileHandle(${JSON.stringify((gpxName ?? '').replace(/\.gpx$/, '.json'))})).getFile()).text()))()`);
check('fiche : analysis.foil vrai', record?.analysis?.foil === true, JSON.stringify(record?.analysis));
await shoot('sauts-analyse');

// --- 3 bis. Onglet « sauts » ---
await go(analysePath, 6000);
console.log('onglet sauts :', await openTab('sauts'));
await wait(800);
text = await pageText();
const jumpRows = await evaluate(`document.querySelectorAll('.an-jump-table tbody tr').length`);
check('onglet « sauts » : 2 sauts, le plus haut vers 2,07 m', jumpRows === 2 && /2\.0\d m/.test(text), `${jumpRows} lignes, ${(text.match(/2\.0\d m/) ?? ['?'])[0]}`);
check('podium, tableau et courbe', text.includes('Les plus hauts') && text.includes('Longueur') && text.includes('comparer avec'));
console.log('Voir :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('.an-jump-table button')].find((x) => x.textContent.trim() === 'Voir');
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(500);
check('« Voir » : le saut en violet sur la carte', await evaluate(`[...document.querySelectorAll('path.leaflet-interactive')].some((p) => p.getAttribute('stroke') === '#7b1fa2')`));
// Tri : les deux sauts ont même hauteur et même vol ; le second est plus long (vitesse plus grande).
const firstRow = () => evaluate(`document.querySelector('.an-jump-table tbody tr .an-jump-num')?.textContent.trim()`);
const clickButton = (selector, label) => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`);
await clickButton('.an-jump-sort button', 'Longueur');
await wait(300);
const longestFirst = await firstRow();
const lengths = await evaluate(`[...document.querySelectorAll('.an-jump-table tbody tr .an-jump-length')].map((c) => c.textContent.trim()).join(' > ')`);
check('tri par longueur : le plus long en tête', parseFloat(lengths.split(' > ')[0]) >= parseFloat(lengths.split(' > ')[1]), `n° ${longestFirst} en tête, ${lengths}`);
// « Détail » de la dernière ligne : ce saut devient le premier de la courbe.
const lastNum = await evaluate(`[...document.querySelectorAll('.an-jump-table tbody tr .an-jump-num')].at(-1).textContent.trim()`);
await evaluate(`[...document.querySelectorAll('.an-jump-table tbody tr')].at(-1).querySelector('.an-jump-actions button:last-child').click()`);
await wait(600);
const firstCurve = await evaluate(`document.querySelector('.an-jump-compare select')?.selectedOptions[0]?.textContent`);
check('« Détail » : le saut sur la courbe', firstCurve?.startsWith(`n° ${lastNum} `), firstCurve);
// Comparaison : le second menu prend l'autre saut, deux courbes.
console.log('comparer :', await evaluate(`(() => {
  const select = document.querySelectorAll('.an-jump-compare select')[1];
  const other = [...select.options].find((o) => o.value !== '');
  if (!other) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, other.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return other.textContent;
})()`));
await wait(600);
// Seule courbe de la page à ce moment : les onglets à graphes sont fermés.
check('deux courbes comparées', await evaluate(`[...document.querySelectorAll('.recharts-line path')].map((p) => p.getAttribute('stroke')).join(',')`) === '#1565c0,#ef6c00');
const withJumps = await evaluate(`(async () => JSON.parse(await (await (await ${sessionsDir}.getFileHandle(${JSON.stringify((gpxName ?? '').replace(/\.gpx$/, '.json'))})).getFile()).text()))()`);
check('fiche : sauts rangés', withJumps?.jumps?.jumps?.length === 2, JSON.stringify(withJumps?.jumps?.jumps?.map((j) => j.heightM)));
await shoot('sauts-onglet');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await wait(1000);
await evaluate('window.scrollTo(0, document.querySelector(".an-jump-table")?.getBoundingClientRect().top + window.scrollY - 200)');
await wait(500);
check('390 px : pas de défilement horizontal', await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
await shoot('sauts-onglet-telephone');
await send('Emulation.clearDeviceMetricsOverride');

// --- 4. Enregistrer, dans le navigateur ---
await go('/enregistrer', 3000);
text = await pageText();
check('pas de « Mesurer les sauts » dans le navigateur', !text.includes('Mesurer les sauts'));

// --- 5. Suppression ---
await go('/voile', 4000);
console.log('supprimer :', await evaluate(`(async () => {
  const { removeSession } = await import('/src/hooks/useSessionLibrary.ts');
  await removeSession(${JSON.stringify(gpxName ?? '')});
  return 'ok';
})()`));
await wait(1000);
files = await sessionFiles();
check('GPX, fiche et .imu effacés', !files.some((f) => f.startsWith((gpxName ?? '').replace(/\.gpx$/, ''))), files.join(', ') || '(vide)');

console.log('--- console (erreurs, avertissements) ---');
for (const line of logs) console.log(line);
ws.close();
