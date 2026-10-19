// Banc de test : « Partager » du menu « … » des analyses, image de la trace et des chiffres choisis (18/10).
// Usage : node partage.mjs <port> <dossier de travail> [<dossier des captures>]
// Sur un profil neuf. Réseau : les tuiles d'OpenStreetMap seulement (fond de l'image) ; IGN, Overpass et BRouter
// bloqués. Dure environ 1 min 30. Le script :
//  1. importe une boucle de course et la voile de `make-gpx.mjs` ;
//  2. pour chacune : « Partager » en tête du menu « … », la fenêtre, l'aperçu (carré de 1080 px), les pastilles
//     égales aux chiffres de l'onglet « général » (sans les « — »), les six premières enfoncées ; l'image est
//     gardée dans le dossier des captures (`partage-<page>.png`) ;
//  3. en course : deux pastilles seulement (image toujours carrée), fond de carte décoché, choix rangés sous
//     l'activité de la session (`tracker.partage`) et retrouvés à la réouverture ; « Partager » par le partage du
//     navigateur (simulé : fichier PNG nommé d'après la session), puis sans partage (téléchargement et message) ;
//     Échap ferme ;
//  4. à 390×844 : la fenêtre tient dans l'écran, sans débordement de la page ;
//  5. fin d'enregistrement, à 390×844 : rejeu ×600 de la boucle en À pied, Arrêter, puis « … » › « Partager » de la
//     carte « Session terminée » : aperçu carré, chiffres du résumé, choix de la course repris (même activité).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node partage.mjs <port> <dossier de travail> [<dossier des captures>]');
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
let failures = 0;
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- Sessions ---
/** Boucle de course de 30 min au nord de Montpellier, à 3 m/s. */
const loopGpx = (t0) => {
  const pts = [];
  const seconds = 1800;
  for (let k = 0; k <= seconds; k++) {
    const a = (k / seconds) * 2 * Math.PI;
    const lat = 43.65 + 0.012 * Math.sin(a) + 0.002 * Math.sin(3 * a);
    const lon = 3.86 + 0.016 * Math.cos(a);
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(60 + 20 * Math.sin(a)).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${k % 600 < 120 ? 4.2 : 3}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Boucle</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const voilePath = join(tmpdir(), 'partage-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);
const T_RUN = Date.UTC(2026, 9, 1, 8, 0, 0);
const T_VOILE = Date.UTC(2026, 8, 20, 13, 0, 0);
const SESSIONS = [
  { page: 'course', start: T_RUN, gpx: loopGpx(T_RUN) },
  { page: 'voile', start: T_VOILE, gpx: readFileSync(voilePath, 'utf8') },
];

const paths = {};
/** Activité de chaque session rangée : clé de son choix dans `tracker.partage`. */
const activityIds = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.page} :`, await importGpx(s.gpx, `${s.page}.gpx`));
  await wait(5000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.page] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  activityIds[s.page] = rec?.activityId ?? rec?.sport;
  check(`${s.page} rangée`, Boolean(rec));
}

// --- Outils de la fenêtre ---
const menuItems = () => evaluate(`(() => {
  const b = document.querySelector('.an-sheet__head .ui-more__button');
  if (!b) return null;
  b.click();
  return [...document.querySelectorAll('.an-sheet__head .ui-more__panel button')].map((x) => x.textContent.trim());
})()`);
const openShare = async () => {
  const items = await menuItems();
  await evaluate(`[...document.querySelectorAll('.an-sheet__head .ui-more__panel button')].find((x) => x.textContent.trim() === 'Partager')?.click()`);
  return items;
};
/** Attend l'image à jour : bouton « Partager » de la fenêtre actif. */
const waitImage = async (ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const ready = await evaluate(`(() => {
      const img = document.querySelector('.share-dialog__preview img');
      const btn = [...document.querySelectorAll('.share-dialog__actions button')].find((b) => b.textContent.trim() === 'Partager');
      return Boolean(img && img.complete && img.naturalWidth > 0 && btn && !btn.disabled);
    })()`);
    if (ready) return true;
    await wait(250);
  }
  return false;
};
const imageSize = () => evaluate(`(() => { const i = document.querySelector('.share-dialog__preview img'); return i ? [i.naturalWidth, i.naturalHeight] : null; })()`);
const chips = () => evaluate(`[...document.querySelectorAll('.share-dialog .ui-tab')].map((b) => ({ label: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true' }))`);
const pressChip = (label) => evaluate(`[...document.querySelectorAll('.share-dialog .ui-tab')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click() ?? 'absent'`);
const saveImage = async (name) => {
  const data = await evaluate(`(async () => {
    const i = document.querySelector('.share-dialog__preview img');
    const blob = await (await fetch(i.src)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(s);
  })()`);
  if (shotDir && data) writeFileSync(`${shotDir}/${name}.png`, Buffer.from(data, 'base64'));
};
const generalStats = () => evaluate(`[...document.querySelectorAll('.an-sheet__stats--always .an-sheet__stat')]
  .map((s) => ({ label: s.querySelector('.an-sheet__stat-label').textContent.trim(), value: s.querySelector('.an-sheet__stat-value').textContent.trim() }))`);
/** L'image est carrée quel que soit le nombre de chiffres (`SHARE_IMAGE.sizePx`). */
const isSquare = (size) => size?.[0] === 1080 && size?.[1] === 1080;

// --- 2. Chaque analyse ---
for (const s of SESSIONS) {
  await go(paths[s.page], 7000);
  const items = await openShare();
  check(`${s.page} : « Partager » en tête du menu « … »`, items?.[0] === 'Partager', JSON.stringify(items));
  check(`${s.page} : fenêtre ouverte`, Boolean(await evaluate(`document.querySelector('.share-dialog[role=dialog]') !== null`)));
  check(`${s.page} : aperçu dessiné`, await waitImage());
  // Relu une fois l'image prête : l'altitude (IGN bloqué, repli sur le GPS) arrive après l'ouverture.
  const general = await generalStats();
  const c = await chips();
  const expected = general.filter((g) => g.value !== '—').map((g) => g.label);
  check(`${s.page} : pastilles = chiffres de « général »`, JSON.stringify(c.map((x) => x.label)) === JSON.stringify(expected), c.map((x) => x.label).join(' | '));
  check(`${s.page} : les six premières enfoncées`, c.filter((x) => x.on).length === Math.min(6, c.length) && c.slice(0, 6).every((x) => x.on));
  const size = await imageSize();
  check(`${s.page} : image carrée de 1080 × 1080`, isSquare(size), JSON.stringify(size));
  await saveImage(`partage-${s.page}`);
  await shoot(`partage-fenetre-${s.page}`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await wait(300);
  check(`${s.page} : Échap ferme la fenêtre`, await evaluate(`document.querySelector('.share-dialog') === null`));
}

// --- 3. Choix en course ---
await go(paths.course, 7000);
await openShare();
await waitImage();
let c = await chips();
for (const label of c.filter((x) => x.on).slice(2).map((x) => x.label)) await pressChip(label);
await waitImage();
c = await chips();
check('course : deux pastilles enfoncées', c.filter((x) => x.on).length === 2, c.filter((x) => x.on).map((x) => x.label).join(' | '));
check('course : deux chiffres, image toujours carrée', isSquare(await imageSize()), JSON.stringify(await imageSize()));
await evaluate(`document.querySelector('.share-dialog__check input').click()`);
await waitImage();
await saveImage('partage-course-sans-carte');
const stored = await evaluate(`localStorage.getItem('tracker.partage')`);
console.log('tracker.partage :', stored);
const course = JSON.parse(stored ?? '{}')[activityIds.course] ?? {};
check(`course : choix rangés sous l'activité (${activityIds.course})`, course.stats?.length === 2 && course.map === false);

// Partage du navigateur, simulé : le fichier transmis.
await evaluate(`(() => {
  window.__partage = null;
  navigator.canShare = () => true;
  navigator.share = async (data) => { window.__partage = { name: data.files[0].name, type: data.files[0].type, size: data.files[0].size, title: data.title }; };
})()`);
await evaluate(`[...document.querySelectorAll('.share-dialog__actions button')].find((b) => b.textContent.trim() === 'Partager').click()`);
await wait(500);
const shared = await evaluate('window.__partage');
console.log('partagé :', JSON.stringify(shared));
check('course : PNG transmis au partage, nommé d\'après la session', shared?.type === 'image/png' && /^2026-10-01 .+\.png$/.test(shared?.name ?? '') && shared.size > 10_000);

// Sans partage : téléchargement et message.
await evaluate(`navigator.canShare = () => false`);
await evaluate(`[...document.querySelectorAll('.share-dialog__actions button')].find((b) => b.textContent.trim() === 'Partager').click()`);
await wait(500);
const note = await evaluate(`document.querySelector('.share-dialog [role=status]')?.textContent ?? ''`);
check('course : sans partage, l\'image est téléchargée', note.includes('téléchargée'), note);

// Réouverture : choix retrouvés.
await go(paths.course, 7000);
await openShare();
await waitImage();
c = await chips();
check('course : choix retrouvés à la réouverture', c.filter((x) => x.on).length === 2
  && !(await evaluate(`document.querySelector('.share-dialog__check input').checked`)));

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.voile, 7000);
await openShare();
check('390×844 : aperçu dessiné', await waitImage());
const fit = await evaluate(`(() => {
  const r = document.querySelector('.share-dialog').getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
check('390×844 : la fenêtre tient dans l\'écran', fit.left >= 0 && fit.right <= fit.w && fit.top >= 0 && fit.bottom <= fit.h && fit.over === 0, JSON.stringify(fit));
await shoot('partage-telephone');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

// --- 5. Fin d'enregistrement ---
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const replayPath = join(workDir, 'partage-rejeu.gpx');
writeFileSync(replayPath, loopGpx(Date.now() - 1800 * 1000));
await go('/enregistrer', 4000);
console.log('famille :', await clickText('À pied', '[aria-label=Famille] button'));
await wait(300);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click()`);
await wait(300);
await setFile('input[type=file][accept=".gpx"]', replayPath);
await wait(800);
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(6000);
console.log('Arrêter :', await holdStop());
await wait(2500);
const cardMenu = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.ui-card')].find((c) => c.textContent.includes('Session terminée'));
  const b = card?.querySelector('.ui-more__button');
  if (!b) return null;
  b.click();
  return [...card.querySelectorAll('.ui-more__panel button')].map((x) => x.textContent.trim());
})()`);
check('fin d\'enregistrement : « Partager » dans le « … » de « Session terminée »', Boolean(cardMenu?.includes('Partager')), JSON.stringify(cardMenu));
await evaluate(`[...document.querySelectorAll('.ui-card .ui-more__panel button')].find((x) => x.textContent.trim() === 'Partager')?.click()`);
check('fin d\'enregistrement : aperçu dessiné', await waitImage());
check('fin d\'enregistrement : image carrée de 1080 × 1080', isSquare(await imageSize()), JSON.stringify(await imageSize()));
c = await chips();
console.log('pastilles :', c.map((x) => `${x.label}${x.on ? ' *' : ''}`).join(' | '));
check('fin d\'enregistrement : chiffres du résumé', c.some((x) => x.label === 'Distance') && c.length >= 6, String(c.length));
check('fin d\'enregistrement : choix de la course repris (même activité)', c.filter((x) => x.on).length === course.stats?.length
  && !(await evaluate(`document.querySelector('.share-dialog__check input').checked`)));
await saveImage('partage-enregistrement');
await shoot('partage-enregistrement-fenetre');

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(failures === 0 ? 0 : 1);
