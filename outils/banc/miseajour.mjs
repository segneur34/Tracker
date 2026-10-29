// Banc de test : « Mettre à jour », relecture du dossier mémoire sans relancer (§10, point 88).
// Usage : node miseajour.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf (mémoire du navigateur), sans réseau. Le script écrit lui-même ses GPX. Il :
//  1. importe une sortie à vélo, garde son GPX et sa fiche, les retire du dossier pendant que la page
//     est ouverte : la liste ne change pas ; « Mettre à jour » la retire ;
//  2. pose ce GPX et sa fiche (renommée, activité Gravel) à la racine du dossier, et un second GPX sans
//     fiche dans sessions/ : « Mettre à jour » fait apparaître les deux, range la fiche avec son GPX,
//     garde son nom et son activité, et crée la fiche du second ;
//  3. relit une fois de plus : « rien de nouveau » ; enfin, le bouton est là dans Réglages › Mémoire, carte repliée comprise.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node miseajour.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

// --- Traces ---
/** Sortie à vélo en ligne droite vers l'est, 1 Hz, 5 m/s, à partir de l'instant donné. */
const rideGpx = (name, t0) => {
  const points = [];
  for (let k = 0; k <= 900; k++) {
    points.push(`<trkpt lat="43.7700000" lon="${(3.8 + (k * 5) / 80500).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>cycling</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const firstPath = `${workDir}\\sortie-copiee.gpx`;
writeFileSync(firstPath, rideGpx('Sortie copiée', Date.UTC(2026, 9, 5, 8, 0, 0)));
const secondGpx = rideGpx('Seconde sortie', Date.UTC(2026, 9, 6, 8, 0, 0));
const SECOND_NAME = '2026-10-06_10-00-00_cycling.gpx';

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, importFiles, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Dossier `Tracker` de la mémoire du navigateur, ou un de ses sous-dossiers. */
const dirJs = (path) => `(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
  return dir;
})()`;
const listOpfs = (path) => evaluate(`(async () => { const dir = await ${dirJs(path)}; const names = []; for await (const [n] of dir.entries()) names.push(n); return names.sort(); })()`);
const readOpfs = (path, name) => evaluate(`(async () => (await (await (await ${dirJs(path)}).getFileHandle(${JSON.stringify(name)})).getFile()).text())()`);
const writeOpfs = (path, name, text) => evaluate(`(async () => {
  const w = await (await (await ${dirJs(path)}).getFileHandle(${JSON.stringify(name)}, { create: true })).createWritable();
  await w.write(${JSON.stringify(text)}); await w.close(); return 'ok';
})()`);
const removeOpfs = (path, name) => evaluate(`(async () => { await (await ${dirJs(path)}).removeEntry(${JSON.stringify(name)}); return 'ok'; })()`);
/** Ligne d'état de la mémoire, son bouton, et le compte rendu. */
const memory = () => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^(Mettre à jour|Mise à jour…)$/.test(x.textContent.trim()));
  const line = [...document.querySelectorAll('p')].map((p) => p.textContent).find((t) => /^\\d+ sessions? · /.test(t)) ?? '(pas de ligne)';
  const alert = document.querySelector('.ui-alert--success, .ui-alert--danger')?.textContent.replace(/Fermer$/, '').trim() ?? '';
  return \`\${line} | bouton : \${b ? (b.disabled ? b.textContent.trim() + ' (grisé)' : b.textContent.trim()) : 'absent'}\${alert ? ' | ' + alert : ''}\`;
})()`);
/** Appuie sur « Mettre à jour » et attend la fin de la relecture. */
const refresh = async () => {
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Mettre à jour' && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  if (!clicked) return 'bouton absent ou grisé';
  await wait(200);
  const during = await memory();
  await waitFor(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Mettre à jour' && !x.disabled)`, { timeout: 30000, every: 100, label: 'relecture finie' });
  await settle({ max: 500, label: 'relecture' });
  return `pendant : ${during}`;
};
const sessionNames = () => evaluate(`[...document.querySelectorAll('.lib-row__name')].map((x) => x.textContent.trim()).join(' | ') || '(aucune nommée)'`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });

// 1. Une session importée, puis retirée du dossier derrière le dos de l'application.
await go('/velo');
console.log('au départ :', await memory());
await importFiles(firstPath, 'input[type=file][accept=".gpx"][multiple]');
await waitFor(async () => (await listOpfs('sessions')).some((n) => n.endsWith('.json')), { timeout: 3000, label: 'fiche' });
await settle({ max: 3000, label: 'import' });
const gpx = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx'));
const recordName = gpx.replace(/\.gpx$/, '.json');
const gpxText = await readOpfs('sessions', gpx);
const record = JSON.parse(await readOpfs('sessions', recordName));
console.log('importée :', gpx, '|', await memory());
await removeOpfs('sessions', gpx);
await removeOpfs('sessions', recordName);
console.log('fichiers retirés, sans relire :', await memory());
console.log('Mettre à jour :', await refresh());
console.log('après :', await memory());

// 2. Fiche et GPX posés à la racine, second GPX sans fiche dans sessions/.
await writeOpfs('', gpx, gpxText);
await writeOpfs('', recordName, JSON.stringify({ ...record, name: 'Sortie copiée du téléphone', activityId: 'a-gravel' }, null, 2));
await writeOpfs('sessions', SECOND_NAME, secondGpx);
console.log('racine avant :', (await listOpfs('')).join(', '));
console.log('Mettre à jour :', await refresh());
console.log('après :', await memory());
console.log('racine après :', (await listOpfs('')).join(', '));
console.log('sessions/ :', (await listOpfs('sessions')).join(', '));
const moved = JSON.parse(await readOpfs('sessions', recordName));
console.log('fiche rangée :', `nom « ${moved.name} », activité ${moved.activityId}`);
const created = JSON.parse(await readOpfs('sessions', SECOND_NAME.replace(/\.gpx$/, '.json')));
console.log('fiche créée :', `${created.sport}, activité ${created.activityId}, ${Math.round(created.summary.distanceM)} m`);
console.log('liste :', await sessionNames());
await shoot('miseajour-velo');

// 3. Rien de nouveau ; le bouton dans Réglages › Mémoire.
console.log('Mettre à jour :', await refresh());
console.log('après :', await memory());
await go('/parametres');
console.log('Réglages :', await memory(), '| import d\'un dossier :',
  await evaluate(`[...document.querySelectorAll('label, button')].some((x) => x.textContent.trim() === "Ajouter les sessions d'un dossier")`));

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
await close();
