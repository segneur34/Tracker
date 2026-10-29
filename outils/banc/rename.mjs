// Banc du renommage d'une session (lot II) : nom saisi dans la bibliothèque, écrit dans la fiche,
// relu après rechargement, affiché en tête de l'analyse, effacé par un nom vide, puis donné depuis
// l'en-tête de l'analyse et relu dans la bibliothèque. Profil Chrome neuf.
// Usage : node rename.mjs <port> <gpx de voile, produit par make-gpx.mjs>
import { connect } from './lib/cdp.mjs';

const [port, gpx] = process.argv.slice(2);

// --- Protocole (lib/cdp.mjs) ---
const lib = await connect({ port });
const { send, settle, waitFor, wait, importFiles, close, logs } = lib;
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return `ERREUR: ${res.result.exceptionDetails.exception?.description?.split('\n')[0]}`;
  return res.result?.result?.value;
};
const go = (path, ms = 2500) => lib.go(path, ms);
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const rows = () => evaluate(`JSON.stringify([...document.querySelectorAll('.lib-row__main')].map((r) => r.innerText.replace(/\\n/g, ' / ')))`);
const record = () => evaluate(`(async () => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'); for await (const [n, h] of d.entries()) if (n.endsWith('.json')) { const r = JSON.parse(await (await h.getFile()).text()); return JSON.stringify({ name: r.name, title: r.title, gpx: r.gpx }); } return 'aucune fiche'; })()`);
const files = () => evaluate(`(async () => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort().join(', '); })()`);
const typeName = async (value, key) => {
  await evaluate(`(() => { const i = document.querySelector('.lib-row__rename'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  await wait(200);
  if (key) await evaluate(`document.querySelector('.lib-row__rename').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })), 'ok'`);
};
/** La bibliothèque est lue depuis la mémoire (OPFS) après le chargement : on attend sa première ligne. */
const listReady = async () => { await waitFor(async () => (await rows()) !== '[]', { timeout: 4000, label: 'liste' }); await settle({ max: 1000, label: 'liste' }); };
const step = (title) => console.log(`\n== ${title}`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });

step('1. Import du GPX dans la bibliothèque voile');
await go('/voile');
await importFiles([gpx]);
await waitFor(async () => (await record()) !== 'aucune fiche' && (await rows()) !== '[]', { timeout: 4000, label: 'fiche et ligne' });
await settle({ max: 4000, label: 'import' });
console.log('lignes :', await rows());
console.log('fiche :', await record());

step('2. Renommer, Annuler (Échap) : rien ne change');
console.log('Renommer :', await clickText('Renommer'));
await typeName('Brouillon abandonné', 'Escape');
console.log('lignes :', await rows());

step('3. Renommer, Entrée');
await clickText('Renommer');
await typeName('  Sortie du soir  ', 'Enter');
await waitFor(async () => (await record()).includes('Sortie du soir'), { timeout: 1500, label: 'fiche renommée' });
await settle({ max: 1500, label: 'renommage' });
console.log('lignes :', await rows());
console.log('fiche :', await record());
console.log('fichiers :', await files());

step('4. Rechargement');
await go('/voile');
await listReady();
console.log('lignes :', await rows());

step('5. Analyse : sous-titre de l\'en-tête');
await evaluate(`document.querySelector('.lib-row__main').click(), 'ok'`);
await waitFor(`location.pathname.includes('/analyse')`, { timeout: 6000, label: 'analyse ouverte' });
await settle({ max: 6000, label: 'analyse' });
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| sous-titre :', await evaluate(`document.querySelector('.ui-page-header__subtitle')?.textContent ?? 'aucun'`));

step('6. Nom vide, bouton Valider : plus de nom');
await go('/voile');
await listReady();
await clickText('Renommer');
await typeName('   ');
console.log('Valider :', await clickText('Valider'));
await waitFor(async () => JSON.parse(await record()).name === null, { timeout: 1500, label: 'nom effacé' });
await settle({ max: 1500, label: 'renommage' });
console.log('lignes :', await rows());
console.log('fiche :', await record());

step('7. Renommer depuis l\'en-tête de l\'analyse');
await evaluate(`document.querySelector('.lib-row__main').click(), 'ok'`);
await waitFor(`location.pathname.includes('/analyse')`, { timeout: 6000, label: 'analyse ouverte' });
await settle({ max: 6000, label: 'analyse' });
const subtitle = () => evaluate(`document.querySelector('.ui-page-header__subtitle')?.innerText.split('\\n').join(' / ')`);
console.log('en-tête avant :', await subtitle());
console.log('Renommer :', await clickText('Renommer'));
await wait(300);
await evaluate(`(() => { const i = document.querySelector('input[aria-label="Nom de la session"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Bord au Grand Travers'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
await wait(1500);
console.log('en-tête après :', await subtitle());
console.log('fiche :', await record());
await go('/voile');
await listReady();
console.log('lignes :', await rows());

console.log('\n== Console :', logs.some((l) => !l.startsWith('warning')) ? logs.filter((l) => !l.startsWith('warning')).join('\n') : 'rien');
await close();
process.exit(0);
