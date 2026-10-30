// Banc de test : le surf (§10, point 97).
// Usage : node surf.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même deux sessions synthétiques et les importe par la page,
// dans un `File`. Il vérifie :
//  1. la famille Surf sur l'accueil, dans la barre du haut, et ses deux activités dans Réglages (carte d'activité :
//     « Seuil de vague », « Seuil de vol » pour Surf foil, ni pente ni terrain) ;
//  2. une matinée (trois vagues, la troisième enchaînée) : la ligne de la bibliothèque, puis l'analyse, onglets
//     général, vagues (tableau, tri, « Voir », podium), rame (retours, première sortie), graphiques ;
//  3. les réglages de la session : seuil de vague imposé (une vague en moins), enregistré dans la fiche, relu après
//     rechargement, puis « Défaut » et « Annuler » ;
//  4. une session de surf foil (un vol de trois vagues reliées en pompant, puis un vol court) : case Foil de la
//     session, onglet « vols », plus long vol, ligne de la bibliothèque ;
//  5. la page à 390 × 844, sans débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node surf.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Sessions synthétiques : phases à vitesse et cap constants, nord = le large ---
const M_PER_DEG_LAT = 111_195;
const buildGpx = (name, startMs, phases) => {
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const pts = [];
  const push = (speed, heading) => pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(startMs + t * 1000).toISOString()}</time>`
    + `<extensions><speed>${speed}</speed>${speed > 0 ? `<course>${heading}</course>` : ''}</extensions></trkpt>`);
  push(0, 0);
  for (const [s, speed, heading = 0] of phases) {
    for (let k = 0; k < s; k++) {
      lat += (speed * Math.cos((heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (speed * Math.sin((heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += 1;
      push(speed, heading);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>surf</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
// [durée en s, vitesse en m/s, cap]
const MORNING = [
  [60, 0], [60, 1.2], [50, 1], [4, 0.1], [40, 1], [4, 0.1], [26, 1], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1],
  [5, 1.6, 180], [8, 4.5, 190], [80, 1], [30, 0.1],
];
const FOIL = [
  [60, 1], [30, 0.1], [5, 2, 180], [15, 6.5, 200], [20, 4, 20], [15, 6.5, 190], [20, 4, 10], [10, 6.5, 200],
  [40, 0.8], [30, 0.1], [5, 2, 180], [12, 6.5, 200], [30, 0.8],
];
const T_MORNING = Date.UTC(2026, 9, 10, 7, 0, 0);
const T_FOIL = Date.UTC(2026, 9, 9, 15, 0, 0);

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    ?? [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const tab = (label) => clickText(label, '.an-carte-col .ui-tab');
/** Ouvre un onglet s'il est fermé : les onglets ouverts sont mémorisés d'une ouverture à l'autre. */
const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent'; if (t.getAttribute('aria-pressed') === 'true') return 'déjà ouvert'; t.click(); return 'ok';
})()`);
/** Texte du panneau d'analyse dont le titre commence ainsi. */
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ').slice(0, 900) : '(absent)';
})()`);
const recordAt = async (startMs) => (await records()).find((r) => r.summary?.startMs === startMs);
/** Champ d'un seuil de la session, par son libellé. */
const field = (label) => `document.querySelector('input[aria-label=${JSON.stringify(label)}]')`;
const setField = (label, value) => evaluate(`(() => {
  const i = ${field(label)};
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork();

// 1. Accueil, barre, Réglages.
await go('/');
console.log('accueil :', await evaluate(`[...document.querySelectorAll('.shell-main a')].map((a) => a.innerText.split('\\n')[0]).filter((t) => /Voile|Course|Vélo|Fractionné|Surf/.test(t)).join(', ')`),
  '| barre :', await evaluate(`[...document.querySelectorAll('.shell-toplink')].map((a) => a.textContent).join(', ')`));
await go('/parametres');
await clickText('Activités', '[role=button]');
await wait(400);
// Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
await wait(300);
console.log('Réglages, familles :', await evaluate(`[...document.querySelectorAll('.settings-activities__family')].map((f) => f.textContent).join(', ')`));
console.log('Réglages, résumés surf :', await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => /Surf/.test(c.innerText)).map((c) => c.innerText.replace(/\\n+/g, ' ')).join(' | ')`));
for (const name of ['Surf foil', 'Surf']) {
  await evaluate(`[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === ${JSON.stringify(name)})?.querySelector('.settings-activity__toggle').click()`);
  await wait(300);
}
for (const part of ['Affichage', 'Onglet analyse']) await clickText(part, '.settings-activity button');
await wait(300);
console.log('carte Surf ouverte :', await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => c.querySelector('.settings-activity__body')).map((c) => [...c.querySelectorAll('.settings-row__label')].map((l) => l.textContent).join(', ')).join(' || ')`));
await shoot('surf-reglages');

// 2. La matinée : import, bibliothèque, analyse.
await go('/surf');
console.log('import matinée :', await importGpx(buildGpx('Matinée', T_MORNING, MORNING), 'matinee.gpx'));
const morning = await waitFor(() => recordAt(T_MORNING), { timeout: 6000, label: 'fiche matinée' });
await settle({ max: 2000, label: 'import matinée' });
console.log('fiche :', morning ? `${morning.gpx}, ${morning.sport}, activité ${morning.activityId}, vagues ${morning.summary.waveCount}, plus longue ${Math.round(morning.summary.longestWaveM)} m, glisse ${Math.round(morning.summary.movingTimeS)} s` : '(absente)');
console.log('bibliothèque :', await evaluate(`document.querySelector('.lib-list')?.innerText.replace(/\\n+/g, ' / ').slice(0, 300) ?? '(vide)'`),
  '| vue planifiées :', await evaluate(`[...document.querySelectorAll('.ui-tab')].some((t) => /planifi/.test(t.textContent))`));
const morningPath = `/surf/analyse?session=${encodeURIComponent(morning?.gpx ?? '')}`;
await go(morningPath, 5000);
console.log('titre :', await evaluate(`document.querySelector('h1')?.textContent`), '| onglets :', await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`));
console.log('légende :', await evaluate(`document.querySelector('.speed-legend')?.getAttribute('title') ?? document.querySelector('.speed-legend')?.textContent ?? '(absente)'`));
console.log('général :', await panel('Général'));
console.log('vagues :', await openTab('vagues'));
await wait(500);
console.log('panneau :', await panel('Vagues'));
console.log('Voir la vague 2 :', await evaluate(`(() => {
  const row = [...document.querySelectorAll('.an-carte-panels tr')].find((r) => r.cells[0]?.textContent === '2');
  const b = row?.querySelector('button'); if (!b) return 'absent'; b.click(); return 'ok';
})()`));
await wait(500);
console.log('surbrillance :', await evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#7b1fa2"]').length`), 'trait(s) violet(s)');
await shoot('surf-vague');
console.log('podium :', await clickText('Les 3 plus longues'));
await wait(500);
console.log('surbrillance :', await evaluate(`['#d32f2f', '#f57c00', '#388e3c'].map((c) => document.querySelectorAll('.leaflet-overlay-pane path[stroke="' + c + '"]').length).join('/')`), 'traits du podium');
console.log('tri par distance :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('.an-carte-panels [role=radiogroup] button')].find((x) => x.textContent.trim() === 'Distance');
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(300);
console.log('ordre :', await evaluate(`[...document.querySelectorAll('.an-carte-panels tbody tr')].map((r) => r.cells[0].textContent + ':' + r.cells[3].textContent).join(' ')`));
console.log('rame :', await openTab('rame'));
await wait(500);
console.log('panneau :', await panel('Rame'));
console.log('fermer vagues :', await tab('vagues'), '| surbrillance restante :', await evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#d32f2f"]').length`));
console.log('graphiques :', await openTab('graphiques'));
await settle({ max: 800 });
console.log('graphe :', await evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim() === 'Vitesse');
  const p = t?.closest('.an-carte-panels > *');
  return p ? p.querySelectorAll('.recharts-surface').length + ' graphe, ' + p.querySelectorAll('.recharts-reference-area').length + ' bandes' : 'absent';
})()`));
await shoot('surf-onglets');

// 3. Réglages de la session : seuil de vague.
console.log('réglages :', await openTab('réglages'));
await wait(500);
console.log('panneau :', await panel('Réglages de la session'));
console.log('seuil de vague 20 km/h :', await setField('Seuil de vague', '20'));
await settle({ max: 800 });
console.log('vagues :', await evaluate(`document.querySelector('.an-carte-panels')?.innerText.match(/Vagues\\n?([^\\n]+)/)?.[1]`), '| barre :', await evaluate(`document.body.innerText.match(/Non enregistr[^\\n]*/)?.[0] ?? '(aucune)'`));
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await recordAt(T_MORNING))?.analysis?.activeThreshold !== undefined, { timeout: 2500, label: 'fiche seuil' });
const saved = await recordAt(T_MORNING);
console.log('fiche : seuil', saved?.analysis?.activeThreshold, '| vagues du résumé', saved?.summary?.waveCount);
await go(morningPath, 5000);
await openTab('réglages');
await wait(400);
console.log('après rechargement, seuil :', await evaluate(`${field('Seuil de vague')}?.value`), '| Défaut :', await clickText('Défaut', '.an-carte-panels button'));
await wait(600);
console.log('seuil :', await evaluate(`${field('Seuil de vague')}?.value`), '| général :', (await panel('Général')).slice(0, 200));
console.log('Annuler :', await clickText('Annuler'));
await wait(400);

// 4. Surf foil : case de la session, onglet vols.
await go('/surf');
console.log('import foil :', await importGpx(buildGpx('Foil', T_FOIL, FOIL), 'foil.gpx'));
const foil = await waitFor(() => recordAt(T_FOIL), { timeout: 6000, label: 'fiche foil' });
await settle({ max: 2000, label: 'import foil' });
const foilPath = `/surf/analyse?session=${encodeURIComponent(foil?.gpx ?? '')}`;
await go(foilPath, 5000);
await openTab('réglages');
await wait(400);
console.log('case Foil :', await evaluate(`(() => {
  const box = [...document.querySelectorAll('.an-carte-panels label')].find((l) => l.textContent.includes('Foil'))?.querySelector('input[type=checkbox]');
  if (!box) return 'absente'; box.click(); return box.checked ? 'cochée' : 'décochée';
})()`));
await settle({ max: 800 });
console.log('champs :', await evaluate(`[...document.querySelectorAll('.an-carte-panels input[type=number]')].map((i) => i.getAttribute('aria-label') + ' = ' + i.value).join(' | ')`));
console.log('onglets :', await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`));
console.log('vols :', await openTab('vols'));
await wait(500);
console.log('panneau :', await panel('Vols'));
console.log('général :', await panel('Général'));
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await recordAt(T_FOIL))?.analysis?.foil !== undefined, { timeout: 2500, label: 'fiche foil enregistrée' });
const foilSaved = await recordAt(T_FOIL);
console.log('fiche : foil', foilSaved?.analysis?.foil, '| plus long vol', foilSaved?.summary?.longestFlightS, 's | vagues', foilSaved?.summary?.waveCount);
await go('/surf');
console.log('bibliothèque :', await evaluate(`document.querySelector('.lib-list')?.innerText.replace(/\\n+/g, ' / ').slice(0, 400) ?? '(vide)'`));

// 5. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(foilPath, 5000);
await openTab('vagues');
await wait(500);
await shoot('surf-telephone');
console.log('largeur au téléphone :', await evaluate('document.documentElement.scrollWidth'));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
await close();
process.exit(0);
