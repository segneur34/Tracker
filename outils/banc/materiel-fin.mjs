// Banc de test : matériel choisi à la fin de la session, juste avant « Analyser » (lot 143, 131).
// Usage : node materiel-fin.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 40 s, 15 s avec `TEMPS=10`. La liste de matériel de Course est écrite dans
// les réglages, puis des sessions sont enregistrées en rejeu. Le script vérifie :
//  1. Course, liste présente : rangée « Matériel » sur « Session terminée », vide d'office ; la pièce choisie entre
//     dans la fiche à « Analyser » et se retrouve dans l'onglet « matériel et notes » ;
//  2. Course de nouveau : rangée vide, rien de repris de la session d'avant ; sans choix, pas de matériel dans la fiche ;
//  3. Voile, sans liste : pas de rangée.
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

/** Enregistre une session en rejeu jusqu'à l'écran « Session terminée ». `offsetMin` : deux sessions ne partagent pas le même nom de fichier. */
const recordUntilEnd = async (family, type, tag, offsetMin) => {
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
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Analyser')`, { timeout: 8000, label: 'Session terminée' });
};
const analyze = async (tag) => {
  console.log(`[${tag}] Analyser :`, await clickText('Analyser'));
  await waitFor(`location.pathname.endsWith('/analyse')`, { timeout: 6000, label: 'analyse' });
  await settle({ max: 6000, label: 'analyse' });
};
const gearRow = () => evaluate(`document.querySelector('[data-testid="rec-end-gear"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? '(pas de rangée)'`);
const allRecords = async () => (await records()).map((r) => r.record ?? r);

// Liste de matériel de Course, écrite dans les réglages.
await go('/');
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}');
  s.gearGroups = { ...s.gearGroups, running: [{ id: 'g1', name: 'Chaussures', items: [{ id: 'i1', name: 'Trail rouge' }, { id: 'i2', name: 'Route blanche' }] }] };
  localStorage.setItem('tracker.sportSettings', JSON.stringify(s));
  return 'ok';
})()`);

// 1. Course, liste présente.
await recordUntilEnd('À pied', 'running', 'choix', -30);
const empty = await gearRow();
check("Course : rangée « Matériel », vide d'office", empty.includes('Chaussures') && empty.includes('Aucun'), empty);
await evaluate(`document.querySelector('[data-testid="gear-picker-g1"]').click(); 'ok'`);
await wait(300);
console.log('[choix] pièce :', await clickText('Trail rouge', '[data-testid="gear-sheet"] button'));
await wait(300);
const chosen = await gearRow();
check("Course : la pièce choisie s'affiche", chosen.includes('Trail rouge'), chosen);
await shoot('materiel-fin');
await analyze('choix');
const first = (await allRecords()).find((r) => r.notes?.gear);
check('Course : le choix est dans la fiche', first?.notes?.gear?.[0]?.itemName === 'Trail rouge' && first?.notes?.gear?.[0]?.groupName === 'Chaussures', JSON.stringify(first?.notes?.gear ?? null));
console.log('[choix] avancé :', await clickText('avancé', '.ui-tab'));
await wait(300);
console.log('[choix] onglet :', await clickText('matériel et notes', '.ui-tab'));
await settle({ max: 1500, label: 'onglet matériel' });
const shown = await evaluate(`document.querySelector('[data-testid="gear-picker-g1"]')?.innerText.trim() ?? '(absent)'`);
check("Course : retrouvé dans l'onglet « matériel et notes »", shown === 'Trail rouge', shown);

// 2. Course de nouveau : rien de repris.
await recordUntilEnd('À pied', 'running', 'vide', -10);
const again = await gearRow();
check('Course, session suivante : rangée vide, rien de repris', again.includes('Aucun') && !again.includes('Trail rouge'), again);
await analyze('vide');
const all = await allRecords();
check('Course, session suivante : pas de matériel dans sa fiche', all.length === 2 && all.filter((r) => r.notes?.gear?.length).length === 1, JSON.stringify(all.map((r) => r.notes?.gear ?? null)));

// 3. Voile, sans liste.
await recordUntilEnd('Voile', 'wingfoil', 'voile', -50);
const none = await gearRow();
check('Voile, sans liste : pas de rangée', none === '(pas de rangée)', none);

await finish('Tout passe.');
