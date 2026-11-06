// Banc : module course ouvert depuis la bibliothèque, puis rechargé. Usage : node library3.mjs <port> <dossier des GPX>
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, workDir] = process.argv.slice(2);
const win = (name) => join(workDir, name);

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, importFiles, logs, close } = await connect({ port });
/** Navigation, puis attente du premier rendu de l'application : sous charge, `settle` seul peut rendre la main avant. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
const setFiles = (selector, paths) => importFiles(paths, selector);

// Rangée « avancé » des analyses ouverte d'office, onglets posés dans `tracker.sections` rejoués à chaque analyse (`lib/onglets.mjs`, 05/11) ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await go('/course');
console.log('import :', await setFiles('input[type=file][accept*=".gpx"][multiple]', [win('course.gpx')]));
// L'écriture en mémoire (OPFS) ne touche ni au DOM ni au réseau : on attend la ligne de la liste, puis sa réécriture différée.
await waitFor(`Boolean(document.querySelector('.lib-row__main'))`, { timeout: 5000, label: 'ligne de la liste' });
await settle({ max: 3000 });
console.log('Ouvrir :', await evaluate(`(() => { const b = document.querySelector('.lib-row__main'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await settle({ max: 4000 });
console.log('url :', await evaluate('location.pathname + location.search'));
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`), '| graphes :', await evaluate(`document.querySelectorAll('.recharts-surface').length`));
console.log(await evaluate(`document.body.innerText.split('\\n').filter((l) => /Distance|D\\+|Sessions course/.test(l)).slice(0, 5).join(' | ')`));
await go(await evaluate('location.pathname + location.search'), 4000); // rechargement
console.log('après rechargement, segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`));
console.log('--- console ---'); [...new Set(logs)].forEach((l) => console.log(l));
await close();
