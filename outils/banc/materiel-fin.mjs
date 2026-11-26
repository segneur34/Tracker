// Banc de test : matériel de la session choisi après « Finir », dans l'analyse (lot 143, 131 ; lot 212 : session
// rangée dès l'arrêt ; lot 220 : plus de rangée « Matériel » sur « Session terminée », l'analyse s'ouvre d'elle-même
// sur l'onglet du matériel, « avancé » déplié, pour cette ouverture seulement).
// Usage : node materiel-fin.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 40 s, 15 s avec `TEMPS=10`. La liste de matériel de Course est écrite dans
// les réglages, puis des sessions sont enregistrées en rejeu. Le script vérifie :
//  1. Course, liste présente : l'analyse s'ouvre d'elle-même, « avancé » déplié, « matériel et notes » ouvert seul,
//     choix vide d'office ; la pièce choisie dans l'onglet puis « Enregistrer la session » entre dans la fiche ;
//     la même adresse rechargée rouvre sur « général » seul, « avancé » fermé ;
//  2. Course de nouveau : de même sur l'onglet du matériel, rien de repris de la session d'avant ; sans choix, pas de
//     matériel dans la fiche ;
//  3. Voile, sans liste : l'analyse s'ouvre d'elle-même sur « général » seul, « avancé » fermé.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node materiel-fin.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

const { evaluate, go, settle, waitFor, wait, vwait, blockNetwork, importFiles, records, shoot, clickText, check, finish } = await connect({ port, width: 1400, height: 1000, shotDir });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

// « Arrêter » se tient (appui long, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await vwait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};

/** Attend la barre d'onglets de l'analyse, puis son calme. */
const tabsReady = async (label) => {
  await waitFor(`document.querySelectorAll('.an-tabs .ui-tab').length > 0`, { timeout: 10000, label: 'onglets' });
  await settle({ max: 2000, label });
};

/**
 * Enregistre une session en rejeu jusqu'à l'analyse, qui s'ouvre d'elle-même (rien à demander sur la carte, lot 220) ;
 * rend l'adresse atteinte. `offsetMin` : deux sessions ne partagent pas le même nom de fichier.
 */
const recordUntilAnalysis = async (family, type, tag, offsetMin) => {
  const t0 = (await evaluate('Date.now()')) + offsetMin * 60000;
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= 30; k++) {
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + (k * 3) / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>3</speed></extensions></trkpt>`);
  }
  const path = join(workDir, `materiel-fin-${tag}.gpx`);
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>${type}</type><trkseg>${pts.join('')}</trkseg></trk></gpx>`);
  await go('/enregistrer');
  console.log(`[${tag}] famille :`, await clickText(family));
  await wait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await importFiles(path, 'input[type=file][accept*=".gpx"]');
  await wait(500);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  console.log(`[${tag}] Démarrer :`, await clickText('Démarrer'));
  await vwait(6000);
  console.log(`[${tag}] Arrêter :`, await holdStop());
  await waitFor(`location.pathname.endsWith('/analyse') || [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Ouvrir l'analyse")`, { timeout: 8000, label: 'fin' });
  const where = await evaluate('location.pathname');
  if (where.endsWith('/analyse')) await tabsReady('analyse');
  return where;
};

/** Onglets ouverts (`aria-pressed`) et rangée « avancé », tels que la barre les montre. */
const tabsState = () => evaluate(`(() => {
  const pressed = [...document.querySelectorAll('.an-tabs .ui-tab[aria-pressed="true"]')].map((t) => t.textContent.trim()).join(' | ');
  const adv = document.querySelector('.an-tabs-advanced-toggle')?.getAttribute('aria-expanded');
  return 'ouverts : ' + (pressed || '(aucun)') + ' ; avancé : ' + (adv === 'true' ? 'déplié' : 'fermé');
})()`);
const ON_GEAR = 'ouverts : matériel et notes ; avancé : déplié';
const ON_GENERAL = 'ouverts : général ; avancé : fermé';
const pickerText = () => evaluate(`document.querySelector('[data-testid="gear-picker-g1"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? '(absent)'`);
const allRecords = async () => (await records()).map((r) => r.record ?? r);

// Liste de matériel de Course, écrite dans les réglages.
await go('/accueil');
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}');
  s.gearGroups = { ...s.gearGroups, running: [{ id: 'g1', name: 'Chaussures', items: [{ id: 'i1', name: 'Trail rouge' }, { id: 'i2', name: 'Route blanche' }] }] };
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
  return 'ok';
})()`);

// 1. Course, liste présente.
const whereChoice = await recordUntilAnalysis('À pied', 'running', 'choix', -30);
check("Course : l'analyse s'ouvre d'elle-même, sans carte « Session terminée »", whereChoice === '/course/analyse', whereChoice);
const tabsChoice = await tabsState();
check('Course : « matériel et notes » ouvert seul, « avancé » déplié', tabsChoice === ON_GEAR, tabsChoice);
const empty = await pickerText();
check("Course : choix du matériel vide d'office", empty !== '(absent)' && !empty.includes('Trail rouge') && !empty.includes('Route blanche'), empty);
await shoot('materiel-fin');
await evaluate(`document.querySelector('[data-testid="gear-picker-g1"]').click(); 'ok'`);
await wait(300);
console.log('[choix] pièce :', await clickText('Trail rouge', '[data-testid="gear-sheet"] button'));
await wait(300);
const chosen = await pickerText();
check("Course : la pièce choisie s'affiche dans l'onglet", chosen.includes('Trail rouge'), chosen);
console.log('[choix] Enregistrer la session :', await clickText('Enregistrer la session'));
const written = await waitFor(async () => (await allRecords()).find((r) => r.notes?.gear), { timeout: 3000, label: 'matériel dans la fiche' });
check('Course : le choix est dans la fiche après « Enregistrer la session »',
  written?.notes?.gear?.[0]?.itemName === 'Trail rouge' && written?.notes?.gear?.[0]?.groupName === 'Chaussures', JSON.stringify(written?.notes?.gear ?? null));
await settle({ max: 1500, label: 'enregistrement' });
// Même adresse rechargée : ouverture ordinaire, « général » seul.
const here = await evaluate('location.pathname + location.search');
await go(here);
await tabsReady('rechargement');
const tabsReload = await tabsState();
check('Course, rechargée : « général » seul, « avancé » fermé', tabsReload === ON_GENERAL, tabsReload);

// 2. Course de nouveau : rien de repris.
const whereAgain = await recordUntilAnalysis('À pied', 'running', 'vide', -10);
const tabsAgain = await tabsState();
check('Course, session suivante : analyse ouverte sur « matériel et notes »', whereAgain === '/course/analyse' && tabsAgain === ON_GEAR, `${whereAgain} | ${tabsAgain}`);
const again = await pickerText();
check('Course, session suivante : choix vide, rien de repris', again !== '(absent)' && !again.includes('Trail rouge'), again);
const all = await allRecords();
check('Course, session suivante : pas de matériel dans sa fiche', all.length === 2 && all.filter((r) => r.notes?.gear?.length).length === 1, JSON.stringify(all.map((r) => r.notes?.gear ?? null)));

// 3. Voile, sans liste.
const whereSail = await recordUntilAnalysis('Voile', 'wingfoil', 'voile', -50);
const tabsSail = await tabsState();
check('Voile, sans liste : analyse ouverte d’elle-même, « général » seul', whereSail === '/voile/analyse' && tabsSail === ON_GENERAL, `${whereSail} | ${tabsSail}`);

await finish('Tout passe.');
