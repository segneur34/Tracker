// Banc de test : onglet « matériel et notes » dans toutes les activités (lot 2 des demandes du 14/10, seconde série).
// Usage : node materiel.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min. Le script :
//  1. ouvre dans Réglages les cartes Voile, Course, Route et Surf, partie Matériel : la ligne « Matériel » n'est
//     pas en Voile ; intitulés « Chaussures » et « Sac » rangés pour Course ;
//  2. importe une course : onglet « matériel et notes » juste avant « réglages », champs sous les intitulés de
//     Course, saisie du matériel, des conditions et de l'appréciation, partie « notes » dans la barre,
//     « Enregistrer la session », fiche relue, rechargement ;
//  3. la même chose pour une sortie à vélo et une session de surf, sous les intitulés par défaut ;
//  4. à 390×844 : pas de débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node materiel.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, clickText, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Saisit un texte dans un champ ou une zone de texte, puis le quitte (`focusout`, l'`onBlur` de React). */
const setText = (input, value) => evaluate(`(() => {
  const i = ${input};
  if (!i) return 'absent';
  const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return i.value;
})()`);
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true' && t.getAttribute('aria-selected') !== 'true') t.click(); return 'ok'; })()`);
const tabLabels = () => evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent.trim()).join(' | ')`);
const saveBar = () => evaluate(`document.body.innerText.match(/Non enregistr[^\\n]*/)?.[0] ?? '(aucune)'`);
/** Champ du matériel de l'onglet, par son intitulé. */
const gearInput = (label) => `[...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)})?.querySelector('input[type=text]')`;
const gearLabels = () => evaluate(`[...document.querySelectorAll('label')].filter((l) => l.querySelector('input[type=text]') && l.querySelector('span')).map((l) => l.querySelector('span').textContent.trim()).join(', ')`);
const conditionsArea = `document.querySelector('textarea[aria-label="Conditions"]')`;
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

/** Trace droite à `speedMs` constante, `type` lu par l'import. */
const lineGpx = (type, speedMs, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= 900; k++) {
    const m = k * speedMs;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + 0.02 * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speedMs}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Ligne</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};

// --- 1. Réglages ---
await go('/parametres', 4000);
await evaluate(`(() => {
  localStorage.setItem('tracker.sections', JSON.stringify({
    settings: { activites: true },
    'settings-activities': { wingfoil: true, running: true, cycling: true, surf: true },
    'settings-families': { voile: true, course: true, velo: true, fractionne: true, surf: true },
    'settings-activity-parts': { analyse: true, materiel: true },
  }));
  return 'ok';
})()`);
await go('/parametres', 3000);
const nameSelector = '.settings-activity__name';
const rows = await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => [...c.querySelectorAll('.settings-row__label')].some((l) => l.textContent.trim() === 'Matériel')).map((c) => c.querySelector(${JSON.stringify(nameSelector)})?.textContent).join(', ')`);
console.log('cartes ouvertes :', await evaluate(`[...document.querySelectorAll('.settings-activity__toggle[aria-expanded="true"] .settings-activity__name')].map((i) => i.textContent).join(', ')`));
console.log('cartes avec « Matériel » :', rows);
check('pas de ligne « Matériel » en Voile, une en Course', !rows.split(', ').includes('Voile') && rows.split(', ').includes('Course'));
const courseCard = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector(${JSON.stringify(nameSelector)})?.textContent === 'Course')`;
console.log('intitulé 1 :', await setText(`${courseCard}?.querySelector('input[aria-label="Intitulé du matériel 1"]')`, ' Chaussures '));
await wait(300);
console.log('intitulé 2 :', await setText(`${courseCard}?.querySelector('input[aria-label="Intitulé du matériel 2"]')`, 'Sac'));
await wait(500);
const stored = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').gearLabels)`);
console.log('rangés :', stored);
check('intitulés de Course rangés, rognés', stored === JSON.stringify({ running: ['Chaussures', 'Sac'] }));
await shoot('materiel-reglages');

/** La barre d'onglets de l'analyse n'est montée qu'une fois la session relue (OPFS), ce que `settle` ne voit pas. */
const tabsReady = async () => { await waitFor(`document.querySelectorAll('.an-carte-col .ui-tab').length > 0`, { timeout: 10000, label: 'onglets' }); await settle({ max: 1000, label: 'onglets' }); };

/** Importe, ouvre l'onglet, saisit, enregistre, relit ; rend l'adresse de l'analyse. */
const scenario = async ({ page, type, startIso, labels, values }) => {
  const start = Date.parse(startIso);
  await go(`/${page}`, 3000);
  console.log(`\nimport ${page} :`, await importGpx(lineGpx(type, 2.8, start), `${page}.gpx`));
  await waitFor(async () => (await records())?.find((r) => r.summary?.startMs === start), { timeout: 4000, label: 'fiche' });
  await settle({ max: 2000, label: 'import' });
  const rec = (await records()).find((r) => r.summary?.startMs === start);
  const path = `/${page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  await go(path, 6000);
  await tabsReady();
  const tabs = await tabLabels();
  console.log('onglets :', tabs);
  check('« matériel et notes » juste avant « réglages »', / matériel et notes \| réglages$/.test(tabs));
  console.log('ouvrir :', await openTab('matériel et notes'));
  await settle({ max: 800, label: 'onglet matériel' });
  const shown = await gearLabels();
  console.log('champs :', shown);
  check(`intitulés ${labels.join(', ')}`, shown === labels.join(', '));
  check('ni vent ni plan d\'eau', !(await evaluate(`document.body.innerText.includes("Plan d'eau")`)));
  console.log('matériel :', await setText(gearInput(labels[0]), values[0]), '/', await setText(gearInput(labels[1]), values[1]));
  console.log('conditions :', await setText(conditionsArea, values[2]));
  console.log('appréciation :', await evaluate(`(() => { const b = document.querySelector('button[aria-label="Bien"]'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
  await wait(500);
  const bar = await saveBar();
  console.log('barre :', bar);
  check('partie « notes » à enregistrer', /notes/.test(bar));
  console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
  await waitFor(async () => { const all = await records(); return Array.isArray(all) && all.find((r) => r.summary?.startMs === start)?.notes?.gear1 === values[0]; }, { timeout: 1500, label: 'fiche écrite' });
  await settle({ max: 1500, label: 'enregistrement' });
  const notes = (await records()).find((r) => r.summary?.startMs === start)?.notes;
  console.log('fiche :', JSON.stringify({ gear1: notes?.gear1, gear2: notes?.gear2, conditions: notes?.conditions, rating: notes?.rating }));
  check('fiche écrite', notes?.gear1 === values[0] && notes?.gear2 === values[1] && notes?.conditions === values[2] && notes?.rating === 4);
  await go(path, 6000);
  await tabsReady();
  await openTab('matériel et notes'); await settle({ max: 800, label: 'onglet matériel' });
  const again = await evaluate(`[${gearInput(labels[0])}?.value, ${gearInput(labels[1])}?.value, ${conditionsArea}?.value].join(' / ')`);
  console.log('après rechargement :', again);
  check('relu après rechargement', again === values.join(' / '));
  check('rien à enregistrer', (await saveBar()) === '(aucune)');
  await shoot(`materiel-${page}`);
  return path;
};

// --- 2. et 3. Course, vélo, surf ---
const runPath = await scenario({ page: 'course', type: 'running', startIso: '2026-10-01T08:00:00Z', labels: ['Chaussures', 'Sac'], values: ['Pegasus 41', 'Gilet 5 L', 'Chaud, boue'] });
await scenario({ page: 'velo', type: 'cycling', startIso: '2026-10-02T08:00:00Z', labels: ['Matériel 1', 'Matériel 2'], values: ['Gravel', 'Sacoches', 'Vent de face'] });
const surfPath = await scenario({ page: 'surf', type: 'surf', startIso: '2026-10-03T08:00:00Z', labels: ['Matériel 1', 'Matériel 2'], values: ['Planche 6 pieds 2', 'Combinaison 4/3', 'Houle 1 m'] });

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const path of [runPath, surfPath]) {
  await go(path, 5000);
  await tabsReady();
  await openTab('matériel et notes'); await settle({ max: 800, label: 'onglet matériel' });
  const o = await overflow();
  check(`à 390 px, ${path.split('/')[1]} : débordement ${o}`, o === 0);
}
await shoot('materiel-telephone');

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
await finish('\nTout passe.', { ko: (n) => `\n${n} échec(s).` });
