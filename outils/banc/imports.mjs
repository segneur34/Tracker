// Banc de test : imports anciens sans artefact (lot 5 des demandes du 10-14/10).
// Usage : node imports.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, poids du pratiquant non renseigné. Dure environ 1 min 30. Le script :
//  1. importe une wing avec une fiche notée (Axis 900), puis une wing seule : pas de matériel prérempli ;
//     une wing avec une fiche enregistrée sans notes : matériel de la dernière session notée ;
//  2. importe une wing avec une fiche de la première version (24/09) : notes gardées, réglages nuls, modifiable ;
//  3. importe une wing dont la fiche a un résumé abîmé, puis en pose une autre dans sessions/ et « Mettre à jour » :
//     nom gardé, résumé refait, pas de lecture seule ;
//  4. importe une course seule, puis la même avec sa fiche (nom, voies) : la fiche est complétée ;
//  5. une sortie à vélo : énergie non calculée sans poids ;
//  6. une session de surf : foil supposé dans « Général » et dans l'onglet réglages ; à 390×844, pas de débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node imports.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, blockNetwork, records, shoot, close, logs, clickText } = await connect({ port, width: 1400, height: 1000, shotDir });
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
/** La barre d'onglets de l'analyse n'est montée qu'une fois la session relue (OPFS), ce que `settle` ne voit pas. */
const tabsReady = async () => { await waitFor(`document.querySelectorAll('.an-carte-col .ui-tab').length > 0`, { timeout: 10000, label: 'onglets' }); await settle({ max: 1000, label: 'onglets' }); };
const recordOf = async (startMs) => (await records()).find((r) => r.summary?.startMs === startMs);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true' && t.getAttribute('aria-selected') !== 'true') t.click(); return 'ok'; })()`);
/** Ligne de texte de la page qui suit `label` (valeur d'une case de chiffres). */
const figure = (label) => evaluate(`(() => { const lines = document.body.innerText.split('\\n').map((l) => l.trim()).filter(Boolean); const k = lines.indexOf(${JSON.stringify(label)}); return k < 0 ? '(absent)' : lines[k + 1]; })()`);
const textWith = (re) => evaluate(`document.body.innerText.match(${re})?.[0] ?? '(absent)'`);
/** Valeur du champ de matériel qui suit l'étiquette `label` (onglet « matos et conditions »). */
const gearField = (label) => evaluate(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)}); return l ? JSON.stringify(l.querySelector('input')?.value ?? null) : '(absent)'; })()`);
/** Fichiers posés dans le sélecteur « Importer des GPX », comme un choix de l'utilisateur. */
const importFiles = (files) => evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  for (const [name, text] of ${JSON.stringify(files)}) dt.items.add(new File([text], name, { type: name.endsWith('.gpx') ? 'application/gpx+xml' : 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
const libraryMessage = () => evaluate(`document.body.innerText.match(/[^\\n]*(importée|déjà|complétée|ajoutée)[^\\n]*/)?.[0] ?? '(aucun)'`);
const warnings = () => evaluate(`document.body.innerText.match(/[^\\n]*(illisible|lecture seule|abîmée|plus récente)[^\\n]*/g)?.join(' | ') ?? '(aucun)'`);
const analysisPath = (family, record) => `/${family}/analyse?session=${encodeURIComponent(record?.gpx ?? '')}`;

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

/** Trace en zigzag à `speedMs`, 600 points à 1 Hz, `type` lu par l'import. */
const trackGpx = (type, speedMs, t0, name = 'Trace') => {
  const lat0 = 43.4;
  const pts = [];
  let lat = lat0;
  let lon = 3.6;
  for (let k = 0; k <= 600; k++) {
    const heading = (Math.floor(k / 60) % 2 === 0 ? 45 : 135) * (Math.PI / 180);
    lat += (speedMs * Math.cos(heading)) / 111_195;
    lon += (speedMs * Math.sin(heading)) / (111_195 * Math.cos((lat0 * Math.PI) / 180));
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>5</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speedMs}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const summaryFor = (t0) => ({ calcVersion: 2, startMs: t0, endMs: t0 + 600_000, distanceM: 4800, movingTimeS: 600, elevationGainM: null, maxSpeedMs: 8, pointCount: 601, samplingS: 1 });
const notesWith = (patch) => ({ foil: '', mast: '', wing: '', comment: '', windLevel: null, waterState: null, rating: null, savedAt: 1, ...patch });
/** Fiche du jour, réduite à ce qui compte ici. */
const fiche = (gpx, t0, patch = {}) => JSON.stringify({
  format: 'tracker-session', version: 1, gpx, sport: 'wingfoil', activityId: null, source: 'import',
  addedAt: new Date(t0).toISOString(), title: 'Trace', name: null, summary: summaryFor(t0), notes: null, analysis: null, ...patch,
});
const at = (day) => Date.parse(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`);

// --- 1. Matériel emprunté ---
await go('/voile', 4000);
const t1 = at(10); const t2 = at(11); const t3 = at(12);
console.log('wing avec fiche notée :', await importFiles([
  ['w1.gpx', trackGpx('wingfoil', 8, t1)],
  ['w1.json', fiche('w1.gpx', t1, { source: 'enregistrement', name: 'Notée', notes: notesWith({ foil: 'Axis 900', wing: '5 m', savedAt: t1 }) })],
]));
await waitFor(() => recordOf(t1), { timeout: 3000, label: 'w1' });
await settle({ max: 3000, label: 'w1' });
console.log('wing seule :', await importFiles([['w2.gpx', trackGpx('wingfoil', 8, t2)]]));
await waitFor(() => recordOf(t2), { timeout: 3000, label: 'w2' });
await settle({ max: 3000, label: 'w2' });
console.log('wing enregistrée sans notes :', await importFiles([['w3.gpx', trackGpx('wingfoil', 8, t3)], ['w3.json', fiche('w3.gpx', t3, { source: 'enregistrement' })]]));
await waitFor(() => recordOf(t3), { timeout: 3000, label: 'w3' });
await settle({ max: 3000, label: 'w3' });
for (const [label, t0, expected] of [['wing seule', t2, '"" (rien d\'emprunté)'], ['wing enregistrée sans notes', t3, '"Axis 900"']]) {
  await go(analysisPath('voile', await recordOf(t0)), 5000);
  await tabsReady();
  await openTab('matos et conditions');
  await settle({ max: 800, label: 'onglet matos' });
  console.log(`${label} — foil :`, await gearField('Foil'), '| aile :', await gearField('Aile / voile'), `(attendu ${expected})`);
}
await shoot('imports-materiel');

// --- 2. Fiche de la première version ---
const t4 = at(13);
const first = JSON.parse(fiche('w4.gpx', t4));
delete first.activityId; delete first.name; delete first.analysis;
first.notes = notesWith({ wing: '6 m', comment: 'Ancienne', savedAt: t4 });
await go('/voile', 3000);
console.log('\nwing avec fiche du 24/09 :', await importFiles([['w4.gpx', trackGpx('wingfoil', 8, t4)], ['w4.json', JSON.stringify(first)]]));
await waitFor(() => recordOf(t4), { timeout: 3000, label: 'w4' });
await settle({ max: 3000, label: 'w4' });
const r4 = await recordOf(t4);
console.log('fiche : notes', JSON.stringify(r4?.notes?.wing), '| analysis', JSON.stringify(r4?.analysis), '| activityId', JSON.stringify(r4?.activityId), '| name', JSON.stringify(r4?.name), '| résumé v', r4?.summary?.calcVersion);
await go(analysisPath('voile', r4), 5000);
await tabsReady();
await openTab('matos et conditions');
await settle({ max: 800, label: 'onglet matos' });
console.log('avertissements :', await warnings(), '| aile :', await gearField('Aile / voile'), '| commentaire :', await evaluate(`[...document.querySelectorAll('textarea')].map((t) => t.value).join(' ') || '(vide)'`));
console.log('modifiable (« Renommer ») :', await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Renommer')`));

// --- 3. Résumé abîmé ---
const t5 = at(14); const t6 = at(15);
await go('/voile', 3000);
console.log('\nwing avec fiche au résumé abîmé :', await importFiles([
  ['w5.gpx', trackGpx('wingfoil', 8, t5)],
  ['w5.json', fiche('w5.gpx', t5, { name: 'Résumé abîmé', summary: { ...summaryFor(t5), maxSpeedMs: null } })],
]));
await waitFor(() => recordOf(t5), { timeout: 3000, label: 'w5' });
await settle({ max: 3000, label: 'w5' });
const r5 = await recordOf(t5);
console.log('fiche : nom', JSON.stringify(r5?.name), '| vitesse max', r5?.summary?.maxSpeedMs?.toFixed(2));
console.log('fiche abîmée posée dans sessions/ :', await evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const put = async (name, text) => { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); };
  await put('w6.gpx', ${JSON.stringify(trackGpx('wingfoil', 8, t6))});
  await put('w6.json', ${JSON.stringify(fiche('w6.gpx', t6, { name: 'Dans le dossier', notes: notesWith({ comment: 'gardé', savedAt: t6 }), summary: { ...summaryFor(t6), samplingS: null } }))});
  return 'ok';
})()`));
console.log('Mettre à jour :', await clickText('Mettre à jour'));
await waitFor(() => recordOf(t6), { timeout: 4000, label: 'w6' });
await settle({ max: 4000, label: 'mise à jour' });
const r6 = await recordOf(t6);
console.log('fiche : nom', JSON.stringify(r6?.name), '| commentaire', JSON.stringify(r6?.notes?.comment), '| cadence', r6?.summary?.samplingS);
console.log('bibliothèque :', await textWith('/Dans le dossier/'), '| avertissements :', await warnings());
await go(analysisPath('voile', r6), 5000);
await tabsReady();
console.log('analyse : avertissements', await warnings(), '| modifiable (« Renommer ») :', await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Renommer')`));

// --- 4. Fiche complétée ---
const t7 = at(16);
const run = trackGpx('running', 3, t7, 'Course');
await go('/course', 3000);
console.log('\ncourse seule :', await importFiles([['c1.gpx', run]]));
await waitFor(() => recordOf(t7), { timeout: 3000, label: 'c1' });
await settle({ max: 3000, label: 'c1' });
const surfaces = { source: 'overpass', fetchedAt: '2026-09-16T12:00:00.000Z', matchVersion: 1, startMs: t7, tags: ['highway=track'], runs: [[0, 0]] };
console.log('même course avec sa fiche :', await importFiles([['c1.gpx', run], ['c1.json', fiche('c1.gpx', t7, { sport: 'running', name: 'Complétée', surfaces })]]));
await waitFor(async () => (await recordOf(t7))?.name === 'Complétée', { timeout: 3000, label: 'c1 complétée' });
await settle({ max: 3000, label: 'c1 complétée' });
console.log('message :', await libraryMessage());
const r7 = await recordOf(t7);
console.log('fiche : nom', JSON.stringify(r7?.name), '| voies', r7?.surfaces ? 'reçues' : 'absentes');

// --- 5. Énergie à vélo sans poids ---
const t8 = at(17);
await go('/velo', 3000);
console.log('\nvélo seul :', await importFiles([['v1.gpx', trackGpx('cycling', 7, t8, 'Vélo')]]));
await waitFor(() => recordOf(t8), { timeout: 3000, label: 'v1' });
await settle({ max: 3000, label: 'v1' });
await go(analysisPath('velo', await recordOf(t8)), 6000);
await tabsReady();
console.log('onglet :', await openTab('énergie'));
await settle({ max: 1000, label: 'onglet énergie' });
console.log('puissance :', await figure('Puissance moyenne en mouvement'), '| pédalage :', await figure('Énergie de pédalage'), '| dépense :', await figure('Dépense totale, repos compris'));
console.log('avertissement :', await textWith('/Poids non renseigné[^\\n]*/'));
console.log('graphe :', await evaluate(`document.querySelectorAll('.recharts-surface').length`), 'surface(s) Recharts sur la page');
await shoot('imports-velo');

// --- 6. Surf, foil supposé ---
const t9 = at(18);
await go('/surf', 3000);
console.log('\nsurf seul :', await importFiles([['s1.gpx', trackGpx('surf', 4, t9, 'Surf')]]));
await waitFor(() => recordOf(t9), { timeout: 3000, label: 's1' });
await settle({ max: 3000, label: 's1' });
const surfPath = analysisPath('surf', await recordOf(t9));
await go(surfPath, 6000);
await tabsReady();
console.log('général :', await textWith('/[^\\n]*supposé d\'après l\'activité[^\\n]*/'));
console.log('onglet réglages :', await openTab('réglages'));
await settle({ max: 800, label: 'onglet réglages' });
console.log('case Foil :', await textWith('/\\(supposé : celui de l\'activité\\)/'));
await shoot('imports-surf');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(surfPath, 5000);
await tabsReady();
console.log('390×844 surf : débordement', await overflow(), 'px');
await go(analysisPath('velo', await recordOf(t8)), 5000);
await tabsReady();
console.log('390×844 vélo : débordement', await overflow(), 'px');

console.log('\n--- console ---');
logs.forEach((l) => console.log(l));
await close();
process.exit(0);
