// Banc de test : planification d'un itinéraire (page /itineraires).
// Usage : node planning.mjs <port> <dossier des GPX, chemin Windows> [<dossier des captures>]
// Le dossier contient `sans-heure.gpx` (trace sans horodatage, avec altitude et <type>hiking</type>),
// `route-rte.gpx` (des <rtept> seulement), `boucle.gpx` (trace qui revient près de son départ)
// et `pas-un-gpx.gpx` (aucun point de trace ni de route).
// Scénario : points posés en ligne droite, « Précédent », boucle en ligne droite, chargement des GPX,
// point inséré sur la trace importée, point déplacé, rangement puis réouverture après rechargement.
// `DUMP=fichier` relève le texte de la page rouverte.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, gpxDir, shotDir] = process.argv.slice(2);
if (!port || !gpxDir) {
  console.error('Usage : node planning.mjs <port> <dossier des GPX> [<dossier des captures>]');
  process.exit(1);
}
const sep = gpxDir.includes('\\') ? '\\' : '/';
const gpx = (name) => `${gpxDir}${sep}${name}`;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, importFiles, mouse, onMessage, logs, close } = await connect({ port, shotDir });
/** Navigation, puis attente du premier rendu de l'application : sous charge, `settle` seul peut rendre la main avant. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
const dialogs = [];
// Les confirmations (itinéraire non rangé) sont acceptées par la bibliothèque, et notées ici.
onMessage((msg) => { if (msg.method === 'Page.javascriptDialogOpening') dialogs.push(msg.params.message); });
const clickText = (text, scope = 'button') => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)}) && !x.disabled); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const setFile = (selector, path) => importFiles(path, selector);
const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(300); };
/** Toucher de la carte, à la fraction (fx, fy) de son cadre. */
const tapMap = async (fx, fy) => {
  const r = await evaluate(`(() => { const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
  await clickAt(r[0] + r[2] * fx, r[1] + r[3] * fy);
};
const state = () => evaluate(`(() => {
  const title = [...document.querySelectorAll('button, h2, h3, span, strong')].map((x) => x.textContent.trim()).find((t) => /^Points \\(\\d+\\)$/.test(t)) ?? null;
  const stats = [...document.querySelectorAll('.plan-stat strong')].map((x) => x.textContent);
  const modes = [...document.querySelectorAll('.plan-point__mode')].map((x) => x.textContent);
  const ways = [...document.querySelectorAll('.plan-modes button[aria-pressed="true"]')].map((x) => x.textContent);
  const labels = [...document.querySelectorAll('.plan-point__text strong')].map((x) => x.textContent);
  const name = document.querySelector('.plan-form input')?.value ?? null;
  const activity = document.querySelector('.plan-toolbar .activity-select')?.textContent ?? null;
  const alert = [...document.querySelectorAll('.ui-alert')].map((x) => x.textContent).join(' | ');
  const pendingText = document.body.innerText.includes('Calcul du tracé');
  return JSON.stringify({ title, stats, ways, modes, labels, name, activity, alert, pendingText });
})()`);
const log = async (label) => console.log(label.padEnd(34), await state());

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await go('/itineraires', 3000);
// En Course (sur un profil neuf, la première activité est la voile, sans chemins), tous les onglets ouverts.
await evaluate(`localStorage.setItem('tracker.planning', JSON.stringify({ activityId: 'running' }));
  localStorage.setItem('tracker.sections', JSON.stringify({ planning: { profil: true, surface: true, trace: true, points: true, ranger: true, liste: true } })); 'ok'`);
await go('/itineraires', 3000);

// 1. Trois points en ligne droite, « Précédent », boucle en ligne droite depuis un autre mode.
console.log('mode ligne droite :', await clickText('Ligne droite', '.plan-modes button'));
await tapMap(0.3, 0.3);
await tapMap(0.6, 0.35);
await tapMap(0.55, 0.7);
await log('trois points');
console.log('Précédent (carte) :', await clickText('Précédent', '.plan-map-tools button'));
await log('après Précédent');
console.log('mode sentier :', await clickText('Sentier', '.plan-modes button'));
// Plusieurs types cochés, puis décochés : le dernier coché reste.
console.log('+ route :', await clickText('Route', '.plan-modes button'));
console.log('+ grande route :', await clickText('Grande route', '.plan-modes button'));
await log('sentier, route, grande route');
console.log('- sentier :', await clickText('Sentier', '.plan-modes button'));
console.log('- route :', await clickText('Route', '.plan-modes button'));
console.log('- grande route (dernier) :', await clickText('Grande route', '.plan-modes button'));
await log('grande route seule');
console.log('mode sentier seul :', await clickText('Ligne droite', '.plan-modes button'), await clickText('Sentier', '.plan-modes button'));
console.log('Boucler en ligne droite :', await clickText('Boucler en ligne droite'));
await log('boucle en ligne droite');
console.log('Tout effacer :', await clickText('Tout effacer'));

// 1b. Ligne droite d'un seul point, en sentier : elle s'allume et s'éteint dans son panneau, et part avec lui quand on le retire.
const tapMarker = async (i) => {
  const m = await evaluate(`(() => { const r = document.querySelectorAll('.plan-marker')[${i}]?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
  if (m) await clickAt(m[0], m[1]);
  return m ? 'ok' : 'absent';
};
const overlayWays = () => evaluate(`[...document.querySelectorAll('.plan-overlay button[aria-pressed="true"]')].map((x) => x.textContent).join(', ') || '(aucun)'`);
const overlayStraight = () => clickText('Ligne droite', '.plan-overlay button');
await tapMap(0.3, 0.3);
await tapMap(0.6, 0.35);
await tapMap(0.55, 0.7);
console.log('panneau de B :', await tapMarker(1), await overlayWays());
console.log('B en ligne droite :', await overlayStraight(), await overlayWays());
console.log('B ligne droite éteinte :', await overlayStraight(), await overlayWays());
console.log('B en ligne droite :', await overlayStraight(), await overlayWays());
await log('B en ligne droite');
console.log('Retirer B :', await clickText('Retirer', '.plan-overlay button'));
await log('B retiré');
console.log('panneau du point d\'après :', await tapMarker(1), await overlayWays());
console.log('Tout effacer :', await clickText('Tout effacer'));

// 2. GPX qui n'en est pas un, route <rte>, trace sans heure, boucle.
await setFile('.plan-actions input[type=file]', gpx('pas-un-gpx.gpx'));
await settle({ max: 800 });
await log('pas un GPX');
await setFile('.plan-actions input[type=file]', gpx('route-rte.gpx'));
await settle({ max: 800 });
await log('route <rte>');
await setFile('.plan-actions input[type=file]', gpx('boucle.gpx'));
await settle({ max: 800 });
await log('boucle');
await setFile('.plan-actions input[type=file]', gpx('sans-heure.gpx'));
await settle({ max: 800 });
await log('trace sans heure');
if (shotDir) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/planning-trace.png`, Buffer.from(shot.result.data, 'base64'));
}

// 3. Toucher la trace importée en son milieu : un point posé dessus, distance inchangée.
const mid = await evaluate(`(() => {
  const path = [...document.querySelectorAll('.plan-map path.leaflet-interactive')].find((p) => p.getAttribute('stroke-width') === '24');
  if (!path) return null;
  const p = path.getPointAtLength(path.getTotalLength() * 0.5).matrixTransform(path.getScreenCTM());
  return [p.x, p.y];
})()`);
if (mid) await clickAt(mid[0], mid[1]);
await log('point inséré sur la trace');

// 4. Glisser l'arrivée, en ligne droite : seul son tronçon est refait, dans ce mode.
console.log('mode ligne droite :', await clickText('Ligne droite', '.plan-modes button'));
const end = await evaluate(`(() => { const m = [...document.querySelectorAll('.plan-marker')].pop()?.getBoundingClientRect(); return m ? [m.left + m.width / 2, m.top + m.height / 2] : null; })()`);
if (end) {
  await mouse('mousePressed', end[0], end[1]);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', end[0] + 6 * k, end[1] + 4 * k);
  await mouse('mouseReleased', end[0] + 48, end[1] + 32);
  await wait(500);
}
await log('arrivée déplacée');
console.log('Précédent :', await clickText('Précédent', '.plan-map-tools button'));
await log('après Précédent');
console.log('Inverser :', await clickText('Inverser'));
await log('inversé');
console.log('Inverser :', await clickText('Inverser'));

// 5. Enregistrer, recharger, rouvrir.
// Depuis le lot 7 (27/10), « Enregistrer » est grisé pendant « Calcul du tracé… » : on attend la fin du calcul (60 s au plus) avant de cliquer.
const calculDeadline = Date.now() + 60_000;
while (Date.now() < calculDeadline && await evaluate(`document.body.innerText.includes('Calcul du tracé') || document.body.innerText.includes('Calcul du retour')`)) await wait(500);
console.log('calcul terminé :', !(await evaluate(`document.body.innerText.includes('Calcul du tracé')`)));
await wait(500);
console.log('Enregistrer :', await clickText('Enregistrer'));
await settle({ max: 1500 });
console.log('message :', await evaluate(`[...document.querySelectorAll('.plan-note')].map((x) => x.textContent).join(' | ')`));
await go('/itineraires', 3000);
// Rouvrir (n° 89) : la liste des itinéraires est relue de la mémoire (OPFS), puis l'itinéraire rouvert relit son GPX ; ni l'un
// ni l'autre ne touche au DOM ou au réseau avant la fin, et un sommeil fixe pouvait relever « Points (0) ». On attend donc
// le bouton de la liste, puis les points de l'itinéraire rouvert.
await waitFor(`[...document.querySelectorAll('.route-list__open')].some((x) => x.textContent.includes('Sentier des crêtes'))`, { timeout: 5000, label: 'liste des itinéraires' });
console.log('rouvrir :', await clickText('Sentier des crêtes', '.route-list__open'));
await waitFor(async () => /^Points \((?!0\))\d+\)$/.test(JSON.parse(await state()).title ?? ''), { timeout: 5000, label: 'points rouverts' });
await settle({ max: 800 });
await log('rouvert');

// Texte de la page rouverte, relevé pour comparer deux versions (DUMP=fichier, relatif au dossier courant).
if (process.env.DUMP) writeFileSync(process.env.DUMP, await evaluate('document.body.innerText'));

// 6. Téléphone : outils de la carte.
if (shotDir) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await settle({ max: 1200 });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/planning-telephone.png`, Buffer.from(shot.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
}

console.log('--- confirmations ---');
dialogs.forEach((d) => console.log(d));
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
