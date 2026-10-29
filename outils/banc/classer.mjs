// Banc de test : session à classer, activité demandée avant l'analyse (§10, point 88).
// Usage : node classer.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même un GPX dont la balise <type> ne dit rien
// (« other », comme certaines applications), l'importe depuis la page Course, et vérifie :
//  1. la session est « À classer » ;
//  2. l'ouvrir montre la question « Quelle activité ? » au lieu d'ouvrir l'analyse ; Échap la ferme sans rien changer ;
//  3. choisir Gravel range l'activité dans la fiche et ouvre l'analyse vélo, pas celle de la page Course.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node classer.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

const t0 = Date.UTC(2026, 9, 2, 8, 0, 0);
const points = [];
for (let k = 0; k <= 900; k++) {
  points.push(`<trkpt lat="43.7700000" lon="${(3.8 + (k * 5) / 80500).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const gpxPath = `${workDir}\\sans-activite.gpx`;
writeFileSync(gpxPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="autre application" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sortie</name><type>other</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`);

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, importFiles, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
const readRecord = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) return JSON.parse(await (await h.getFile()).text());
  return null;
})()`);
const sheet = () => evaluate(`(() => {
  const s = document.querySelector('.activity-select__sheet');
  return s ? s.querySelector('.activity-select__heading')?.innerText.replace(/\\n/g, ' / ') ?? '(liste sans question)' : '(pas de liste)';
})()`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });

// 1. Import depuis la page Course.
await go('/course');
await importFiles(gpxPath, 'input[type=file][accept=".gpx"][multiple]');
await waitFor(async () => (await readRecord()) !== null, { timeout: 3000, label: 'fiche' });
await settle({ max: 3000, label: 'import' });
console.log('carte « À classer » :', await evaluate(`[...document.querySelectorAll('h2, h3, .ui-card__heading')].some((h) => h.textContent.trim() === 'À classer')`));
const before = await readRecord();
console.log('fiche :', `support ${before?.sport}, activité ${before?.activityId}`);

// 2. L'ouvrir pose la question ; Échap la ferme.
const openRow = () => evaluate(`(() => { const b = [...document.querySelectorAll('.lib-row__main')].find((x) => /À classer/.test(x.textContent)); if (!b) return 'absente'; b.click(); return 'ok'; })()`);
console.log('ouvrir :', await openRow());
await wait(500);
console.log('question :', await sheet(), '| page :', await evaluate('location.pathname'));
await shoot('classer-question');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(300);
console.log('Échap :', await sheet(), '| page :', await evaluate('location.pathname'), '| support', (await readRecord())?.sport);

// 3. Gravel choisi : fiche rangée, analyse vélo ouverte.
console.log('ouvrir :', await openRow());
await wait(500);
console.log('Gravel :', await evaluate(`(() => { const b = [...document.querySelectorAll('.activity-select__option')].find((x) => x.textContent.trim() === 'Gravel'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await waitFor(`location.pathname.includes('/analyse')`, { timeout: 3000, label: 'analyse ouverte' });
await settle({ max: 3000, label: 'analyse' });
console.log('page :', await evaluate('location.pathname + location.search'), '| titre :', await evaluate(`document.querySelector('h1')?.textContent ?? ''`));
await waitFor(async () => (await readRecord())?.activityId !== before?.activityId, { timeout: 1500, label: 'fiche classée' });
const after = await readRecord();
console.log('fiche :', `support ${after?.sport}, activité ${after?.activityId}`);

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
await close();
