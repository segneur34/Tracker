// Banc de test : pilote un Chrome sans fenêtre par le protocole DevTools.
// Usage : node bench.mjs <port> analyse <gpx>
// Scénario : rejeu du GPX à ×600 → Arrêter → Analyser, puis relevé de la page d'analyse voile.
// L'ancien scénario « fichier » (ouverture dans /voile) est retiré : depuis le lot 3a, /voile est la bibliothèque.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, scenario = 'analyse', gpxPath] = process.argv.slice(2);
if (scenario !== 'analyse' || !gpxPath) {
  console.error('Usage : node bench.mjs <port> analyse <gpx, chemin Windows>');
  process.exit(1);
}
const SHOT = process.env.SHOT;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, importFiles, records, logs, close } = await connect({ port });
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
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const snapshot = () => evaluate(`JSON.stringify({ url: location.pathname, h1: document.querySelector('h1')?.textContent ?? null, text: document.body.innerText.length, segments: document.querySelectorAll('path.leaflet-interactive').length, traceCanvas: document.querySelectorAll('.leaflet-trace-pane canvas').length, charts: document.querySelectorAll('.recharts-surface').length })`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await go('/', 2500);
// Onglets de la colonne de la carte tous ouverts, comme chez l'utilisateur.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ 'sailing-onglets': { tops: true, manoeuvres: true, graphiques: true, vmg: true, vent: true, matos: true, reglages: true } })); 'ok'`);

await go('/enregistrer', 2500);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await importFiles(gpxPath, 'input[type=file]');
await settle({ max: 800 });
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(8000); // rejeu en temps réel (×600) : un vrai délai
console.log('Arrêter :', await holdStop());
// La session est rangée en mémoire (OPFS) : ni DOM ni réseau, d'où l'attente de la fiche avant `settle`.
await waitFor(async () => (await records())?.length >= 1, { timeout: 6000, label: 'fiche rangée' });
await settle({ max: 2000 });
console.log('page enregistrement :', await evaluate(`document.body.innerText.split('\\n').filter((l) => /points|Rangée|Session/.test(l)).join(' | ')`));
console.log('Analyser :', await clickText('Analyser'));
await settle({ max: 5000 });

console.log('résultat :', await snapshot());
if (process.env.DUMP) writeFileSync(process.env.DUMP, await evaluate('document.body.innerText'));
if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
}
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
