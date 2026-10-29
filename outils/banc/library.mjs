// Banc de la bibliothèque (lot 3a) : mémoire du navigateur (OPFS), enregistrement rangé, notes dans la fiche,
// import, doublon, à classer, suppression, relance, fichier de réglages de l'appareil. Profil Chrome neuf : OPFS vide au départ.
// Usage : node library.mjs <port> <dossier des GPX : voile.gpx, course.gpx, sans-type.gpx> <dossier des captures>
import { connect } from './lib/cdp.mjs';

const [port, gpxDir, shotDir] = process.argv.slice(2);
const win = (name) => `${gpxDir.replace(/\//g, '\\')}\\${name}`;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, importFiles, records, shoot, logs, close } = await connect({ port, shotDir });
/** Navigation, puis attente du premier rendu de l'application : sous charge, `settle` seul peut rendre la main avant. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
// « Arrêter » se tient (appui long réglable, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const clickText = (text, selector = 'button') => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFiles = (selector, paths) => importFiles(paths, selector);
const lines = (re) => evaluate(`document.body.innerText.split('\\n').filter((l) => ${re}.test(l)).join(' | ')`);
const rows = () => evaluate(`JSON.stringify([...document.querySelectorAll('.lib-row__main')].map((r) => r.innerText.replace(/\\n/g, ' / ')))`);
const opfsTree = () => evaluate(`(async () => { const t = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const out = {}; const walk = async (d, p) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out[p + n] = (await h.getFile()).size; } }; await walk(t, ''); return JSON.stringify(out); })()`);
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const shot = async (name, width, height, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await settle({ max: 800 });
  await shoot(name);
  await send('Emulation.clearDeviceMetricsOverride');
};
const step = (title) => console.log(`\n== ${title}`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });

step('1. Bibliothèque vide');
await go('/voile');
console.log(await lines(/session|mémoire|Aucune/));
await shot('voile-vide-mobile', 390, 844, true);

step('2. Rejeu ×600, Arrêter, Analyser');
await go('/enregistrer');
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
console.log('fichier rejeu :', await setFiles('input[type=file]', [win('voile.gpx')]));
await settle({ max: 800 });
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(9000);
console.log('Arrêter :', await holdStop());
// La session est rangée en mémoire (OPFS) : ni DOM ni réseau, d'où l'attente de la fiche avant `settle`.
await waitFor(async () => (await records())?.length >= 1, { timeout: 6000, label: 'fiche rangée' });
await settle({ max: 3000 });
console.log(await lines(/points|Rangée|Session/));
console.log('Analyser :', await clickText('Analyser'));
await settle({ max: 6000 });
console.log('url :', await evaluate('location.pathname + location.search'));
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`));
console.log('dossier :', await opfsTree());

step('3. Notes : saisie, rechargement');
console.log('onglet matos :', await clickText('matos'));
await wait(500);
await evaluate(`(() => { const i = document.querySelector('input[placeholder^="ex. 1100"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Axis 900 banc'); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
// L'écriture de la fiche (OPFS) est différée : on attend son message.
await waitFor(`/Enregistré dans|Notes indisponibles/.test(document.body.innerText)`, { timeout: 1500, label: 'message de la fiche' });
console.log(await lines(/Enregistré dans|Notes indisponibles|seront enregistrées/));
await go(await evaluate('location.pathname + location.search'), 6000); // rechargement
await clickText('matos'); await wait(500);
console.log('foil après rechargement :', await evaluate(`document.querySelector('input[placeholder^="ex. 1100"]')?.value`));
const tree = JSON.parse(await opfsTree());
const fiche = Object.keys(tree).find((k) => k.startsWith('sessions/') && k.endsWith('.json'));
const record = JSON.parse(await readOpfs(fiche));
console.log('fiche :', fiche, '| sport', record.sport, '| source', record.source, '| manœuvres', record.summary.maneuverCount, '| notes.foil', record.notes?.foil, '| distance', Math.round(record.summary.distanceM), 'm');

step('4. Import : doublon, course typée, trace sans type');
await go('/voile');
console.log('import :', await setFiles('input[type=file][accept=".gpx"][multiple]', [win('voile.gpx'), win('course.gpx'), win('sans-type.gpx')]));
await waitFor(`/ajoutée|déjà|illisible/.test(document.body.innerText)`, { timeout: 8000, label: 'messages d import' });
await settle({ max: 1500 });
console.log(await lines(/ajoutée|déjà|illisible/));
console.log('lignes voile :', await rows());
await go('/course');
console.log('lignes course :', await rows());

step('5. Classer la trace sans type en kite');
await evaluate(`(() => { const s = document.querySelector('select[aria-label="Classer la session"]'); if (!s) return 'absent'; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'kite'); s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
await settle({ max: 2000 });
await go('/voile');
console.log('lignes voile :', await rows());

step('6. Supprimer la course');
await go('/course');
console.log('Supprimer :', await clickText('Supprimer'));
await wait(300);
console.log('Confirmer :', await clickText('Confirmer'));
await settle({ max: 1500 });
console.log('lignes course :', await rows(), '|', await lines(/Aucune session/));

step('7. Réglages : seuil changé, fichier de l\'appareil (reglages/pc.json)');
await go('/parametres');
await evaluate(`(() => { const i = document.querySelector('table input[type=number]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '9.5'); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
await settle({ max: 3000 });
const settings = JSON.parse(await readOpfs('reglages/pc.json'));
console.log('reglages/pc.json :', JSON.stringify(settings.values['tracker.sportSettings']?.thresholds), '| appareil', settings.device?.name, '| savedAt', new Date(settings.savedAt).toISOString());
console.log(await lines(/cet appareil|Nom de cet appareil/));
await shot('reglages-desktop', 1400, 1000, false);
await shot('reglages-mobile', 390, 844, true);

step('8. Relance : liste relue du cache');
await go('/voile', 3500);
console.log('lignes voile :', await rows());
console.log('dossier :', await opfsTree());
console.log('LISEZMOI :', (await readOpfs('LISEZMOI.txt')).split('\r\n')[0]);
await shot('voile-mobile', 390, 844, true);
await shot('voile-desktop', 1400, 1000, false);

console.log('\n--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 15).forEach((l) => console.log(l));
await close();
