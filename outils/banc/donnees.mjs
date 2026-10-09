// Banc de test : données sûres (lot A, §10, point 92).
// Usage : node donnees.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf (mémoire du navigateur), avec le serveur de développement (le script importe `/src/...`).
// Aucun réseau n'est attendu : les demandes à l'IGN et à Overpass sont relevées, et il ne doit y en avoir aucune.
// Le script écrit lui-même ses GPX. Il vérifie :
//  1. le cache allégé : une sortie à vélo avec son altitude IGN et ses voies rangées dans la fiche ; après deux
//     lancements, `tracker.libraryCache` ne les contient plus ; un renommage depuis la bibliothèque les laisse
//     intacts dans la fiche ; l'analyse s'ouvre sans demande à l'IGN ni à Overpass, altitude « IGN » ;
//  2. le recalcul de fond : 30 fiches au résumé périmé (`calcVersion` 1) ; la dernière, renommée pendant le
//     balayage, garde son nom et reçoit son nouveau résumé ;
//  3. « Mettre à jour » : une session renommée pendant la relecture garde son nom, dans la liste et la fiche ;
//  4. l'import : trois GPX, dont un illisible et un dont la fiche ne peut s'écrire ; le troisième est rangé,
//     l'échec est nommé, et le GPX à moitié rangé est retiré ; importé de nouveau avec des capteurs, il les reçoit ;
//  5. le stockage plein : un réglage refusé reste en place pour la session, et le bandeau le dit.
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node donnees.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Traces ---
/** Sortie à vélo en ligne droite vers l'est, 1 Hz, 5 m/s, à partir de l'instant donné. */
const rideGpx = (name, t0, count = 900) => {
  const points = [];
  for (let k = 0; k <= count; k++) {
    points.push(`<trkpt lat="43.7700000" lon="${(3.8 + (k * 5) / 80500).toFixed(7)}"><ele>${(50 + k * 0.01).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>cycling</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const T0 = Date.UTC(2026, 9, 5, 8, 0, 0);
const firstPath = `${workDir}\\sortie-ign.gpx`;
writeFileSync(firstPath, rideGpx('Sortie avec altitude', T0));

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const requests = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Network.requestWillBeSent' && /geopf|overpass/i.test(msg.params.request.url) && !msg.params.request.url.startsWith(BASE)) requests.push(msg.params.request.url.slice(0, 80));
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return `ERREUR : ${res.result.exceptionDetails.exception?.description?.split('\n')[0] ?? res.result.exceptionDetails.text}`;
  return res.result?.result?.value;
};
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const setFiles = async (selector, files) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files });
};
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
/** Dossier `Tracker` de la mémoire du navigateur, ou un de ses sous-dossiers. */
const dirJs = (path) => `(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
  return dir;
})()`;
const listOpfs = (path) => evaluate(`(async () => { const dir = await ${dirJs(path)}; const names = []; for await (const [n, h] of dir.entries()) names.push(h.kind === 'directory' ? n + '/' : n); return names.sort(); })()`);
const readOpfs = (path, name) => evaluate(`(async () => (await (await (await ${dirJs(path)}).getFileHandle(${JSON.stringify(name)})).getFile()).text())()`);
const writeOpfs = (path, name, text) => evaluate(`(async () => {
  const w = await (await (await ${dirJs(path)}).getFileHandle(${JSON.stringify(name)}, { create: true })).createWritable();
  await w.write(${JSON.stringify(text)}); await w.close(); return 'ok';
})()`);
const alerts = () => evaluate(`[...document.querySelectorAll('.ui-alert')].map((a) => a.textContent.replace(/Fermer$/, '').trim()).join(' || ') || '(aucun bandeau)'`);
const LIB = `await import('/src/hooks/useSessionLibrary.ts')`;
/** Attend la fin du balayage de fond (plus de « Lecture des traces sans fiche »). */
const waitScan = async (maxS = 60) => {
  for (let k = 0; k < maxS * 4; k++) {
    if (!(await evaluate(`/Lecture des traces sans fiche/.test(document.body.innerText)`))) return;
    await wait(250);
  }
};
const fiche = async (gpx) => JSON.parse(await readOpfs('sessions', gpx.replace(/\.gpx$/, '.json')));

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Cache allégé.
console.log('— 1. cache allégé');
await go('/velo');
await setFiles('input[type=file][accept=".gpx"][multiple]', [firstPath]);
await wait(3000);
const gpx = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx'));
const base = await fiche(gpx);
const t = [];
const z = [];
for (let s = 0; s <= 900; s += 2) { t.push(s * 1000); z.push(Math.round((120 + 20 * Math.sin(s / 60)) * 100) / 100); }
const terrainElevation = { source: 'ign', resource: 'ign_rge_alti_wld', version: 1, stepM: 10, fetchedAt: '2026-10-09T08:00:00.000Z', startMs: T0, t, z };
const surfaces = { source: 'overpass', fetchedAt: '2026-10-09T08:00:00.000Z', matchVersion: 1, startMs: T0, tags: ['highway=residential', 'highway=track tracktype=grade2'], runs: [[0, 0], [300000, 1]] };
await writeOpfs('sessions', gpx.replace(/\.gpx$/, '.json'), JSON.stringify({ ...base, terrainElevation, surfaces }, null, 2));
const ficheSize = JSON.stringify({ ...base, terrainElevation, surfaces }).length;
await go('/velo');
await waitScan();
await go('/velo');
await waitScan();
const cache = await evaluate(`localStorage.getItem('tracker.libraryCache') ?? ''`);
console.log(`fiche : ${ficheSize} car. | cache : ${cache.length} car., allégé : ${cache.includes('"light":true')}, altitude dedans : ${cache.includes('terrainElevation')}, voies dedans : ${cache.includes('"surfaces"')}`);
console.log('session partielle :', await evaluate(`(async () => (${LIB}).librarySession(${JSON.stringify(gpx)})?.partial === true)()`));
console.log('Renommer :', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Renommer'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(300);
await evaluate(`(() => { const i = document.querySelector('.lib-row__rename'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Renommée depuis la liste'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
await wait(2000);
const renamed = await fiche(gpx);
console.log(`fiche après renommage : nom « ${renamed.name} », altitude ${renamed.terrainElevation?.t?.length ?? 'ABSENTE'} points, voies ${renamed.surfaces ? 'gardées' : 'ABSENTES'}`);
await go('/velo');
await waitScan();
requests.length = 0;
await go(`/velo/analyse?session=${encodeURIComponent(gpx)}`, 5000);
const altitudeLine = await evaluate(`(document.body.innerText.match(/Altitude (du terrain|du GPS)[^\\n]*/) ?? ['(ligne absente)'])[0]`);
console.log(`analyse : ${altitudeLine} | demandes IGN ou Overpass : ${requests.length}${requests.length ? ' (' + requests.join(', ') + ')' : ''}`);
await shoot('donnees-analyse');

// 2. Recalcul de fond pendant une saisie.
console.log('— 2. recalcul de fond');
const STALE = 30;
const staleName = (k) => `banc-recalcul-${String(k).padStart(2, '0')}.gpx`;
for (let k = 0; k < STALE; k++) {
  const t0 = Date.UTC(2026, 8, 1 + k, 7, 0, 0);
  await writeOpfs('sessions', staleName(k), rideGpx(`Recalcul ${k}`, t0, 3600));
  const { terrainElevation: _a, surfaces: _b, ...plain } = base;
  await writeOpfs('sessions', staleName(k).replace(/\.gpx$/, '.json'), JSON.stringify({
    ...plain, gpx: staleName(k), title: `Recalcul ${k}`, name: null,
    summary: { ...base.summary, calcVersion: 1, startMs: t0, endMs: t0 + 3600_000 },
  }, null, 2));
}
const LAST = staleName(STALE - 1);
await send('Page.navigate', { url: `${BASE}/velo` });
let known = false;
for (let k = 0; k < 80 && !known; k++) {
  await wait(100);
  known = await evaluate(`(async () => !!(${LIB}).librarySession(${JSON.stringify(LAST)}))()`) === true;
}
const progress = await evaluate(`(document.body.innerText.match(/Lecture des traces sans fiche : \\d+ \\/ \\d+/) ?? ['(balayage non visible)'])[0]`);
await evaluate(`(async () => { (${LIB}).updateSessionRecord(${JSON.stringify(LAST)}, { name: 'Renommée pendant le balayage' }); return 'ok'; })()`);
console.log(`renommée pendant : ${progress}`);
await waitScan(120);
await wait(1500);
const last = await fiche(LAST);
const first = await fiche(staleName(0));
console.log(`fiche de la dernière : nom « ${last.name} », calcVersion ${last.summary.calcVersion} | première : calcVersion ${first.summary.calcVersion}`);
console.log('en mémoire :', await evaluate(`(async () => (${LIB}).librarySession(${JSON.stringify(LAST)})?.record.name ?? '(sans nom)')()`));

// 3. « Mettre à jour » pendant une saisie.
console.log('— 3. Mettre à jour');
const EDITED = staleName(5);
for (let k = 0; k < STALE; k++) {
  const name = staleName(k).replace(/\.gpx$/, '.json');
  await writeOpfs('sessions', name, `${await readOpfs('sessions', name)}\n`);
}
const during = await evaluate(`(async () => {
  const lib = ${LIB};
  const start = performance.now();
  const done = lib.refreshLibrary();
  await new Promise((r) => setTimeout(r, 30));
  lib.updateSessionRecord(${JSON.stringify(EDITED)}, { name: 'Renommée pendant la relecture' });
  const editedAt = Math.round(performance.now() - start);
  await done;
  return \`renommée à \${editedAt} ms, relecture finie à \${Math.round(performance.now() - start)} ms\`;
})()`);
await wait(1500);
console.log(`${during} | en mémoire : « ${await evaluate(`(async () => (${LIB}).librarySession(${JSON.stringify(EDITED)})?.record.name ?? '(sans nom)')()`)} » | fiche : « ${(await fiche(EDITED)).name} »`);

// 4. Import : un illisible, un dont la fiche ne peut s'écrire.
console.log('— 4. import');
const okPath = `${workDir}\\import-ok.gpx`;
const brokenPath = `${workDir}\\import-illisible.gpx`;
const blockedPath = `${workDir}\\import-bloque.gpx`;
const T_BLOCKED = Date.UTC(2026, 9, 8, 8, 0, 0);
writeFileSync(okPath, rideGpx('Import rangé', Date.UTC(2026, 9, 7, 8, 0, 0)));
writeFileSync(brokenPath, '<gpx><trk><trkseg><trkpt lat="43"');
writeFileSync(blockedPath, rideGpx('Import bloqué', T_BLOCKED));
const blockedGpx = await evaluate(`(async () => (await import('/src/recording/session.ts')).sessionFileName(${T_BLOCKED}, 'cycling'))()`);
const blockedJson = blockedGpx.replace(/\.gpx$/, '.json');
await go('/velo');
await waitScan();
// Un dossier au nom de la fiche, posé après la lecture du dossier : l'application ne le connaît pas, et l'écriture de la fiche échoue.
await evaluate(`(async () => { await (await ${dirJs('sessions')}).getDirectoryHandle(${JSON.stringify(blockedJson)}, { create: true }); return 'ok'; })()`);
await setFiles('input[type=file][accept=".gpx"][multiple]', [okPath, brokenPath, blockedPath]);
await wait(4000);
console.log('bandeaux :', await alerts());
const after = await listOpfs('sessions');
console.log(`sessions/ : ${blockedGpx} ${after.includes(blockedGpx) ? 'RESTÉ' : 'retiré'}, autre nom du bloqué : ${after.filter((n) => n.startsWith(blockedGpx.slice(0, 19)) && n !== blockedGpx && n !== blockedJson + '/').join(', ') || 'aucun'}, rangé : ${after.some((n) => n.startsWith('2026-10-07')) ? 'oui' : 'NON'}`);
await evaluate(`(async () => { await (await ${dirJs('sessions')}).removeEntry(${JSON.stringify(blockedJson)}); return 'ok'; })()`);
// La session rangée, importée de nouveau avec des capteurs : ils la rejoignent.
const okImu = `${workDir}\\import-ok.imu`;
writeFileSync(okImu, Buffer.from('capteurs du banc'));
await evaluate(`(async () => { (${LIB}).dismissLibraryMessage(); return 'ok'; })()`);
await setFiles('input[type=file][accept=".gpx"][multiple]', [okPath, okImu]);
await wait(3000);
const okGpx = (await listOpfs('sessions')).find((n) => n.startsWith('2026-10-07') && n.endsWith('.gpx'));
console.log(`réimport avec capteurs : ${await alerts()} | .imu rangé : ${(await listOpfs('sessions')).includes(okGpx.replace(/\.gpx$/, '.imu'))}`);

// 5. Stockage plein.
console.log('— 5. stockage plein');
await go('/');
const filled = await evaluate(`(() => {
  let n = 0;
  for (let size = 1 << 20; size >= 1; size = Math.floor(size / 2)) {
    for (;;) { try { localStorage.setItem('banc.remplissage.' + n, 'x'.repeat(size)); n += 1; } catch { break; } }
  }
  return n;
})()`);
const before = await evaluate(`localStorage.getItem('tracker.sections') ?? '(rien)'`);
const toggled = await evaluate(`(() => { const b = document.querySelector('.actchart__fold'); if (!b) return 'bouton absent'; b.click(); return 'totaux du graphe ' + (b.getAttribute('aria-expanded') === 'true' ? 'repliés' : 'dépliés'); })()`);
await wait(500);
const stored = await evaluate(`localStorage.getItem('tracker.sections') ?? '(rien)'`);
const inMemory = await evaluate(`(async () => JSON.stringify((await import('/src/platform/storage.ts')).jsonStore.read('tracker.sections')))()`);
console.log(`${filled} clés de remplissage | ${toggled} | stockage inchangé : ${stored === before} | valeur relue nouvelle : ${inMemory !== (stored === '(rien)' ? 'null' : stored)}`);
console.log('bandeaux :', await alerts());
await shoot('donnees-stockage-plein');
await evaluate(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('banc.remplissage.')) localStorage.removeItem(k); return 'ok'; })()`);

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
ws.close();
