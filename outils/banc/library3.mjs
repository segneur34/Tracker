// Banc : module course ouvert depuis la bibliothèque, puis rechargé. Usage : node library3.mjs <port> <dossier des GPX>
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
const win = (name) => `${workDir.replace(/\//g, '\\')}\\${name}`;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, importFiles, logs, close } = await connect({ port });
/** Navigation, puis attente du premier rendu de l'application : sous charge, `settle` seul peut rendre la main avant. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
const setFiles = (selector, paths) => importFiles(paths, selector);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await go('/course');
console.log('import :', await setFiles('input[type=file][accept=".gpx"][multiple]', [win('course.gpx')]));
// L'écriture en mémoire (OPFS) ne touche ni au DOM ni au réseau : on attend la ligne de la liste, puis sa réécriture différée.
await waitFor(`Boolean(document.querySelector('.lib-row__main'))`, { timeout: 5000, label: 'ligne de la liste' });
await settle({ max: 3000 });
console.log('Ouvrir :', await evaluate(`(() => { const b = document.querySelector('.lib-row__main'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await settle({ max: 4000 });
console.log('url :', await evaluate('location.pathname + location.search'));
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`), '| graphes :', await evaluate(`document.querySelectorAll('.recharts-surface').length`));
console.log(await evaluate(`document.body.innerText.split('\n').filter((l) => /Distance|D\\+|Sessions course/.test(l)).slice(0, 5).join(' | ')`));
await go(await evaluate('location.pathname + location.search'), 4000); // rechargement
console.log('après rechargement, segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`));
console.log('--- console ---'); [...new Set(logs)].forEach((l) => console.log(l));
await close();
