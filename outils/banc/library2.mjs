// Banc de la bibliothèque, suite (à lancer après library.mjs, même profil Chrome) :
// 1. une paire GPX + fiche exportée, la session supprimée, puis la paire réimportée : les notes reviennent ;
// 2. le fichier de réglages d'un autre appareil, plus récent : il paraît dans Réglages › Mémoire, mais n'est
//    pas repris de lui-même (§10, point 90 ; « Reprendre » est éprouvé par reglages.mjs).
// Usage : node library2.mjs <port> <dossier de travail>
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
const win = (name) => `${workDir.replace(/\//g, '\\')}\\${name}`;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, importFiles, logs, close } = await connect({ port });
/** Navigation, puis attente du premier rendu de l'application : sous charge, `settle` seul peut rendre la main avant. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFiles = (selector, paths) => importFiles(paths, selector);
const rows = () => evaluate(`JSON.stringify([...document.querySelectorAll('.lib-row__main')].map((r) => r.innerText.replace(/\\n/g, ' / ')))`);
const readOpfs = (path) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); })()`);
const writeOpfs = (path, text) => evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(${JSON.stringify(text)}); await w.close(); return 'ok'; })()`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
const NAME = '2026-09-20_15-00-00_wingfoil';

console.log('== 1. Export de la paire, suppression, réimport');
await go('/voile');
writeFileSync(`${workDir}/${NAME}.gpx`, await readOpfs(`sessions/${NAME}.gpx`));
writeFileSync(`${workDir}/${NAME}.json`, await readOpfs(`sessions/${NAME}.json`));
console.log('avant :', await rows());
await evaluate(`(() => { const row = [...document.querySelectorAll('.lib-row')].find((r) => r.innerText.startsWith('Wingfoil')); [...row.querySelectorAll('button')].find((b) => b.textContent === 'Supprimer').click(); return 'ok'; })()`);
await wait(300);
console.log('Confirmer :', await clickText('Confirmer'));
await settle({ max: 1500 });
console.log('après suppression :', await rows());
console.log('import de la paire :', await setFiles('input[type=file][accept=".gpx"][multiple]', [win(`${NAME}.gpx`), win(`${NAME}.json`)]));
// L'écriture en mémoire (OPFS) ne touche ni au DOM ni au réseau : on attend la ligne de la liste, puis sa réécriture différée.
await waitFor(`[...document.querySelectorAll('.lib-row')].some((r) => r.innerText.startsWith('Wingfoil'))`, { timeout: 6000, label: 'session réimportée' });
await settle({ max: 2000 });
console.log('après import :', await rows());
const record = JSON.parse(await readOpfs(`sessions/${NAME}.json`));
console.log('fiche réimportée : notes.foil =', record.notes?.foil, '| manœuvres =', record.summary.maneuverCount, '| source =', record.source);

console.log('\n== 2. fichier d\'un autre appareil, plus récent');
const settings = JSON.parse(await readOpfs('reglages/pc.json'));
settings.savedAt = Date.now() + 60_000;
settings.device = { id: 'autre-appareil', name: 'Téléphone' };
settings.values['tracker.sportSettings'] = { ...settings.values['tracker.sportSettings'], thresholds: { wingfoil: 11 } };
console.log('écriture :', await writeOpfs('reglages/telephone.json', JSON.stringify(settings)));
await go('/parametres', 3500);
console.log('seuil wingfoil affiché (inchangé attendu) :', await evaluate(`document.querySelector('table input[type=number]')?.value`));
console.log('stockage de l\'appareil :', await evaluate(`localStorage.getItem('tracker.sportSettings')`));
console.log(await evaluate(`document.body.innerText.split('\\n').filter((l) => /^(Téléphone|PC|cet appareil|Reprendre)$/.test(l)).join(' | ')`));

console.log('\n--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 15).forEach((l) => console.log(l));
await close();
