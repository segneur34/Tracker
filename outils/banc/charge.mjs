// Banc de test : charge portée en course et poids du vélo par session (lot 4 des demandes du 10-14/10).
// Usage : node charge.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min. Le script :
//  1. pose un poids de 70 kg (bloc Pratiquant) et ouvre, dans Réglages, les cartes Course, Fractionné à pied et
//     Route, partie Onglet analyse : le champ « Charge portée » n'est que dans les deux premières ; 5 kg sur Course ;
//  2. importe une course en côte : énergie avec la charge de l'activité (note), puis 12 kg dans l'onglet réglages,
//     énergie recalculée, partie « charge » dans la barre, « Enregistrer la session », fiche relue, rechargement ;
//  3. importe une sortie à vélo en côte : poids du vélo et des bagages à 20 kg, puissance recalculée, fiche relue ;
//  4. à 390×844 : pas de débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node charge.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, clickText, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

const typeInto = (input, value) => evaluate(`(() => {
  const i = ${input};
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);
const byLabel = (label) => `document.querySelector('input[aria-label=${JSON.stringify(label)}]')`;
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true' && t.getAttribute('aria-selected') !== 'true') t.click(); return 'ok'; })()`);
/** Ligne de texte de la page qui suit `label` (valeur d'une case de chiffres). */
const figure = (label) => evaluate(`(() => { const lines = document.body.innerText.split('\\n').map((l) => l.trim()).filter(Boolean); const k = lines.indexOf(${JSON.stringify(label)}); return k < 0 ? '(absent)' : lines[k + 1]; })()`);
const noteWith = (re) => evaluate(`document.body.innerText.match(${re})?.[0] ?? '(absente)'`);
const saveBar = () => evaluate(`document.body.innerText.match(/Non enregistr[^\\n]*/)?.[0] ?? '(aucune)'`);
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

/** Trace en côte à 5 %, `speedMs` constante, `type` lu par l'import. */
const climbGpx = (type, speedMs, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= 900; k++) {
    const m = k * speedMs;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + 0.05 * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speedMs}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Côte</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};

// --- 1. Réglages ---
await go('/parametres', 4000);
await evaluate(`(() => {
  localStorage.setItem('tracker.runnerProfile', JSON.stringify({ me: { weightKg: 70 } }));
  localStorage.setItem('tracker.sections', JSON.stringify({
    settings: { activites: true },
    'settings-activities': { running: true, 'run-intervals': true, cycling: true },
    'settings-families': { voile: true, course: true, velo: true, fractionne: true, surf: true },
    'settings-activity-parts': { analyse: true },
  }));
  return 'ok';
})()`);
await go('/parametres', 3000);
const loadFields = () => evaluate(`[...document.querySelectorAll('.settings-row')].filter((r) => r.querySelector('.settings-row__label')?.textContent.startsWith('Charge portée')).length`);
console.log('champs « Charge portée » (Course, Fractionné à pied attendus, pas Route) :', await loadFields());
console.log('cartes ouvertes :', await evaluate(`[...document.querySelectorAll('.settings-activity__toggle[aria-expanded="true"] .settings-activity__name')].map((i) => i.textContent).join(', ')`));
console.log('charge Course à 5 kg :', await typeInto(`[...document.querySelectorAll('.settings-row')].find((r) => r.querySelector('.settings-row__label')?.textContent.startsWith('Charge portée'))?.querySelector('input')`, '5'));
await wait(500);
console.log('rangée :', await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').carriedLoads)`));
await shoot('charge-reglages');

// --- 2. Course ---
const runStart = Date.parse('2026-10-01T08:00:00Z');
await go('/course', 3000);
console.log('\nimport course :', await importGpx(climbGpx('running', 2.8, runStart), 'cote-course.gpx'));
const run = await waitFor(async () => (await records())?.find((r) => r.summary?.startMs === runStart), { timeout: 6000, label: 'fiche course' });
await settle({ max: 2000, label: 'import course' });
const runPath = `/course/analyse?session=${encodeURIComponent(run?.gpx ?? '')}`;
await go(runPath, 6000);
console.log('onglets :', await openTab('énergie'), await openTab('réglages'));
await settle({ max: 1000 });
console.log('activité seule (5 kg) — énergie :', await figure('Énergie de course'), '| dépense :', await figure('Dépense totale, repos compris'));
console.log('note :', await noteWith('/Charge portée : [^.]*\\./'));
console.log('champ de la session :', await evaluate(`${byLabel('Charge portée')}?.placeholder ?? '(absent)'`), '(proposé)');
console.log('session à 12 kg :', await typeInto(byLabel('Charge portée'), '12'));
await settle({ max: 1000 });
console.log('énergie :', await figure('Énergie de course'), '| dépense :', await figure('Dépense totale, repos compris'));
console.log('note :', await noteWith('/Charge portée : [^.]*\\./'), '| barre :', await saveBar());
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await records())?.find((r) => r.summary?.startMs === runStart)?.analysis?.loadKg !== undefined, { timeout: 1500, label: 'fiche charge' });
console.log('fiche :', JSON.stringify((await records()).find((r) => r.summary?.startMs === runStart)?.analysis?.loadKg));
await go(runPath, 6000);
await openTab('énergie'); await openTab('réglages'); await settle({ max: 1000 });
console.log('après rechargement : champ', await evaluate(`${byLabel('Charge portée')}?.value`), '| énergie :', await figure('Énergie de course'));
await shoot('charge-course');
console.log('« Revenir à l\'activité » :', await clickText("Revenir à l'activité"));
await settle({ max: 800 });
console.log('énergie :', await figure('Énergie de course'), '| barre :', await saveBar());
console.log('Annuler :', await clickText('Annuler'));
await settle({ max: 800 });

// --- 3. Vélo ---
const bikeStart = Date.parse('2026-10-02T08:00:00Z');
await go('/velo', 3000);
console.log('\nimport vélo :', await importGpx(climbGpx('cycling', 5, bikeStart), 'cote-velo.gpx'));
const bike = await waitFor(async () => (await records())?.find((r) => r.summary?.startMs === bikeStart), { timeout: 6000, label: 'fiche vélo' });
await settle({ max: 2000, label: 'import vélo' });
const bikePath = `/velo/analyse?session=${encodeURIComponent(bike?.gpx ?? '')}`;
await go(bikePath, 6000);
console.log('onglets :', await openTab('énergie'), await openTab('réglages'));
await settle({ max: 1000 });
console.log('ligne en lecture seule :', await noteWith('/Vélo : [^·\\n]*/'));
console.log('vélo de l\'activité — puissance :', await figure('Puissance moyenne en mouvement'), '| note :', await noteWith('/masse totale [^)]*/'));
console.log('session à 20 kg :', await typeInto(byLabel('Poids du vélo et des bagages'), '20'));
await settle({ max: 1000 });
console.log('puissance :', await figure('Puissance moyenne en mouvement'), '| note :', await noteWith('/masse totale [^)]*/'), '| barre :', await saveBar());
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await records())?.find((r) => r.summary?.startMs === bikeStart)?.analysis?.bikeWeightKg !== undefined, { timeout: 1500, label: 'fiche vélo' });
console.log('fiche :', JSON.stringify((await records()).find((r) => r.summary?.startMs === bikeStart)?.analysis?.bikeWeightKg));
await shoot('charge-velo');

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go(bikePath, 5000);
await openTab('réglages'); await settle({ max: 800 });
console.log('\nà 390 px, vélo : débordement', await overflow());
await shoot('charge-velo-telephone');
await go(runPath, 5000);
await openTab('réglages'); await settle({ max: 800 });
console.log('à 390 px, course : débordement', await overflow());

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
await close();
process.exit(0);
