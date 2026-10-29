// Banc de test : dépense de la marche (Pandolf, descentes par Santee) et réglage « Dépense » (lot 21, 28/10).
// Usage : node depense.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 40 s. Le script :
//  1. pose un poids de 70 kg (bloc Pratiquant) et importe la côte à 5 % de `charge.mjs`, à 1,4 m/s (1 260 m) ;
//  2. passe la session en Marche (onglet réglages de l'analyse) : « Énergie de marche », note de Pandolf,
//     environ 82 kcal (Pandolf à 5 % : 5,39 W/kg nets, 3,85 J/kg/m) ;
//  3. Réglages, carte Marche : « Dépense » sur Marche, « défaut » ; passée sur Course, rangée ;
//  4. l'analyse retrouve Minetti : « Énergie de course », environ 115 kcal (5,44 J/kg/m à 5 %), la marche à 0,6 à 0,8 fois ;
//  5. « Dépense » remise sur Marche : le réglage rangé est effacé (« défaut »).
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node depense.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, close, logs: allLogs } = await connect({ port, width: 1400, height: 1000, shotDir });
// Ce script ne relevait que les erreurs de console, pas les avertissements.
const logs = { get length() { return allLogs.filter((l) => !l.startsWith('warning:')).length; }, join: (sep) => allLogs.filter((l) => !l.startsWith('warning:')).join(sep) };

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};
const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? 'null')`);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true' && t.getAttribute('aria-selected') !== 'true') t.click(); return 'ok'; })()`);
/** Ligne de texte de la page qui suit `label` (valeur d'une case de chiffres). */
const figure = (label) => evaluate(`(() => { const lines = document.body.innerText.split('\\n').map((l) => l.trim()).filter(Boolean); const k = lines.indexOf(${JSON.stringify(label)}); return k < 0 ? '(absent)' : lines[k + 1]; })()`);
const kcalOf = (text) => parseFloat(String(text).replace(/\s/g, '').replace(',', '.'));
const pageText = () => evaluate(`document.body.innerText`);
/** Ouvre le « ? » du panneau Énergie (la note du modèle n'est dans la page qu'ouverte). */
const openEnergyHelp = async () => {
  await evaluate(`(() => {
    if (document.querySelector('.help-note')) return 'déjà';
    const b = [...document.querySelectorAll('button.ui-help')].find((x) => x.getAttribute('aria-label') === 'Aide : Énergie');
    if (!b) return 'absent';
    b.click();
    return 'ok';
  })()`);
  await wait(400);
};
/** Choix d'activité de l'onglet réglages (ActivitySelect) : la liste s'ouvre, l'activité s'y choisit. */
const chooseActivity = (text) => evaluate(`(async () => {
  for (const button of document.querySelectorAll('button.activity-select:not(:disabled)')) {
    button.click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...document.querySelectorAll('.activity-select__option')].find((o) => o.textContent.trim() === ${JSON.stringify(text)});
    if (item) { item.click(); return 'ok'; }
    document.querySelector('.activity-select__backdrop')?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'absent';
})()`);

// Le réseau est déjà activé par connect : le blocage est effectif.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

/** Trace en côte à 5 %, `speedMs` constante, `type` lu par l'import (celle de `charge.mjs`). */
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

// --- 1. Poids et import ---
await go('/', 3000);
await evaluate(`(() => { localStorage.setItem('tracker.runnerProfile', JSON.stringify({ me: { weightKg: 70 } })); return 'ok'; })()`);
const start = Date.parse('2026-10-03T08:00:00Z');
await go('/course', 3000);
console.log('import :', await importGpx(climbGpx('running', 1.4, start), 'cote-marche.gpx'));
const rec = await waitFor(async () => (await records())?.find((r) => r.summary?.startMs === start), { timeout: 6000, label: 'fiche' });
await settle({ max: 2000, label: 'import' });
check('session rangée', Boolean(rec));
const path = `/course/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;

// --- 2. En Marche ---
await go(path, 6000);
await openTab('réglages');
await settle({ max: 800 });
console.log('vers Marche :', await chooseActivity('Marche'));
await settle({ max: 4000 });
await openTab('énergie');
await settle({ max: 1500 });
await openEnergyHelp();
const terrain = (await records()).find((r) => r.summary?.startMs === start)?.terrainElevation;
check("altitude du GPS, sans celle de l'IGN (bloquée)", terrain === undefined, terrain ? `${terrain.stepM} m, ${terrain.fetchedAt}` : '');
const walkKcal = kcalOf(await figure('Énergie de marche'));
const walkText = (await pageText()) ?? '';
check('Marche : « Énergie de marche » vers 82 kcal', Math.abs(walkKcal - 82) <= 4, String(walkKcal));
check('Marche : « Coût de marche par km »', walkText.includes('Coût de marche par km'));
check('Marche : note de Pandolf et Santee', /Pandolf \(1977\), descentes corrigées par Santee \(2001\)/.test(walkText),
  walkText.match(/Coût[^.]*\./)?.[0] ?? '(absente)');
check('Marche : plus de Minetti', !walkText.includes('Minetti'));
await shoot('depense-marche');

// --- 3. Réglages : carte Marche, « Dépense » ---
await evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections.settings = { ...sections.settings, activites: true };
  sections['settings-families'] = { ...sections['settings-families'], course: true };
  sections['settings-activities'] = { ...sections['settings-activities'], 'a-marche': true };
  sections['settings-activity-parts'] = { ...sections['settings-activity-parts'], analyse: true };
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
await go('/parametres', 3000);
const row = `[...([...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === 'Marche')?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent.startsWith('Dépense'))`;
const spending = () => evaluate(`(() => { const r = ${row}; return r ? { value: r.querySelector('[role=radio][aria-checked=true]')?.textContent ?? '', mark: r.textContent.includes('défaut') } : null; })()`);
const pick = (label) => evaluate(`(() => { const b = [...(${row}?.querySelectorAll('[role=radio]') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const before = await spending();
check('Réglages : Marche sur « Marche », défaut', before?.value === 'Marche' && before.mark === true, JSON.stringify(before));
console.log('vers Course :', await pick('Course'));
await wait(600);
const changed = await spending();
check('Réglages : « Course » choisi, plus « défaut »', changed?.value === 'Course' && changed.mark === false, JSON.stringify(changed));
check('rangé : energyModels', (await stored())?.energyModels?.['a-marche'] === 'course', JSON.stringify((await stored())?.energyModels));
await shoot('depense-reglages');

// --- 4. L'analyse retrouve Minetti ---
await go(path, 6000);
await openTab('énergie');
await settle({ max: 1500 });
await openEnergyHelp();
const runKcal = kcalOf(await figure('Énergie de course'));
const runText = (await pageText()) ?? '';
check('Course : « Énergie de course » vers 115 kcal', Math.abs(runKcal - 115) <= 5, String(runKcal));
check('Course : note de Minetti', runText.includes('Minetti (2002)') && !runText.includes('Pandolf'));
check('marche : 0,6 à 0,8 fois la course à 5 %', walkKcal / runKcal > 0.6 && walkKcal / runKcal < 0.8, (walkKcal / runKcal).toFixed(2));

// --- 5. Retour au défaut ---
await go('/parametres', 3000);
console.log('vers Marche :', await pick('Marche'));
await wait(600);
const back = await spending();
check('Réglages : retour sur Marche, défaut, rien de rangé', back?.value === 'Marche' && back.mark === true
  && (await stored())?.energyModels?.['a-marche'] === undefined, JSON.stringify(back));

console.log(logs.length ? `--- console ---\n${logs.join('\n')}` : 'console : rien');
console.log(failures ? `${failures} échec(s)` : 'tout est passé');
await close();
process.exit(0);
