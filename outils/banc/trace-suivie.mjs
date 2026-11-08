// Banc de test : la trace suivie pendant un enregistrement à pied, sur la carte du direct.
// Usage : node trace-suivie.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 20 s. Le script écrit lui-même deux GPX dans le dossier de travail :
// un itinéraire sans heure à deux branches distantes de 100 m (500 m vers le nord, 100 m vers l'est, 500 m vers le
// sud), et un rejeu à 5 m/s et 1 Hz qui fait 250 m sur la première branche, 70 m hors piste vers la seconde, revient,
// puis va jusqu'à 400 m. Le script :
//  1. importe l'itinéraire sur la page Itinéraires, « Partir », et relève le tracé de l'aperçu avant départ ;
//  2. rejoue à ×10 : « Fait » jamais au-delà de ce qui est couru (pas de saut sur la seconde branche), et « Restant »
//     juste à la fin ;
//  3. relève les attributs SVG des tracés, en plan : reste en pointillé foncé et épais, partie faite en gris, sous le
//     calque de la trace enregistrée ;
//  4. passe en satellite par le bouton de la carte : liseré blanc sous les deux tracés, à leur épaisseur, calque
//     sous ceux des tracés ; retour au plan : plus de liseré.
// Verdicts ; fin par « Tout passe. » ou le nombre d'échecs, code 0 ou 1.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node trace-suivie.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

// --- Itinéraire et rejeu synthétiques ---
const R = 6371000;
const O = { lat: 43.6, lon: 3.8 };
const at = (east, north) => ({
  lat: O.lat + (north / R) * (180 / Math.PI),
  lon: O.lon + (east / (R * Math.cos((O.lat * Math.PI) / 180))) * (180 / Math.PI),
});
const SPEED = 5;
const along = (pts) => {
  const out = [at(...pts[0])];
  for (let k = 1; k < pts.length; k++) {
    const [e0, n0] = pts[k - 1];
    const [e1, n1] = pts[k];
    const steps = Math.round(Math.hypot(e1 - e0, n1 - n0) / SPEED);
    for (let j = 1; j <= steps; j++) out.push(at(e0 + ((e1 - e0) * j) / steps, n0 + ((n1 - n0) * j) / steps));
  }
  return out;
};
const t0 = Date.UTC(2026, 10, 7, 10, 0, 0);
const routePath = join(workDir, 'trace-suivie-itineraire.gpx');
writeFileSync(routePath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Deux branches</name><type>running</type><trkseg>\n${
  along([[0, 0], [0, 500], [100, 500], [100, 0]]).map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
const replay = along([[0, 0], [0, 250], [70, 250], [0, 250], [0, 400]]);
const replayPath = join(workDir, 'trace-suivie-rejeu.gpx');
writeFileSync(replayPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>running</type><trkseg>\n${
  replay.map((p, i) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(t0 + i * 1000).toISOString()}</time><extensions><speed>${SPEED}</speed></extensions></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);

// --- Protocole (lib/cdp.mjs) ---
const { evaluate, go, settle, wait, waitFor, blockNetwork, importFiles, clickText, shoot, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
await blockNetwork();

/** Attributs SVG des tracés d'un calque de la carte, dans l'ordre du dessin. */
const pathsIn = (pane) => evaluate(`[...document.querySelectorAll('.leaflet-${pane}-pane svg path')].map((p) => ({
  couleur: p.getAttribute('stroke'),
  opacite: p.getAttribute('stroke-opacity'),
  epaisseur: p.getAttribute('stroke-width'),
  pointille: p.getAttribute('stroke-dasharray'),
  bout: p.getAttribute('stroke-linecap'),
  interactif: p.classList.contains('leaflet-interactive'),
}))`);
const paneOrder = (pane) => evaluate(`Number(getComputedStyle(document.querySelector('.leaflet-${pane}-pane')).zIndex)`);
const statValue = (label) => evaluate(`(() => {
  const line = document.body.innerText.split('\\n').map((l) => l.trim());
  const at = line.findIndex((l) => l.toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}));
  return at < 0 ? null : line[at + 1];
})()`);
const donePercent = () => evaluate(`(() => {
  const m = /(\\d+) %\\s*FAIT, SUR/i.exec(document.body.innerText) ?? /FAIT, SUR[^\\n]*\\n+\\s*(\\d+) %/i.exec(document.body.innerText);
  return m ? Number(m[1]) : null;
})()`);
const REMAINDER = { couleur: '#263238', opacite: '1', epaisseur: '6', pointille: '12 8', bout: 'butt', interactif: false };
const DONE = { couleur: '#757575', opacite: '0.85', epaisseur: '4', pointille: null, bout: 'round', interactif: false };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. « Partir » depuis la page Itinéraires : l'aperçu avant départ.
await go('/itineraires/liste', 2500);
await waitFor(`Boolean(document.querySelector('input[type=file][accept=".gpx"]'))`, { timeout: 8000, label: 'import possible' });
await importFiles(routePath, 'input[type=file][accept=".gpx"]');
await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Partir')`, { timeout: 8000, label: 'itinéraire rangé' });
await settle({ max: 800 });
check('« Partir » depuis la liste', await clickText('Partir') === 'ok');
await waitFor(`location.pathname === '/enregistrer' && Boolean(document.querySelector('.leaflet-traceSuivie-pane svg path'))`, { timeout: 8000, label: 'aperçu de la trace' });
const preview = await pathsIn('traceSuivie');
console.log('aperçu :', JSON.stringify(preview));
check('aperçu : le tracé en pointillé seul', preview.length === 1 && same(preview[0], REMAINDER), JSON.stringify(preview));
check('aperçu : pas de liseré en plan', (await pathsIn('traceSuivieLisere').catch(() => [])).length === 0);
await shoot('trace-suivie-apercu');

// 2. Rejeu à ×10, hors-piste compris.
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await importFiles(replayPath, 'input[type=file]');
await waitFor(`document.body.innerText.includes('${replay.length} points')`, { timeout: 5000, label: 'rejeu chargé' });
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '10')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
check('Démarrer', await clickText('Démarrer') === 'ok');
const durationMs = (replay.length / 10) * 1000 + 4000;
const seen = [];
const startedAt = Date.now();
while (Date.now() - startedAt < durationMs) {
  const v = await donePercent();
  if (v !== null) seen.push(v);
  await wait(400);
}
const most = Math.max(...seen);
const last = seen[seen.length - 1];
// 400 m sur 1100 m : 36 %. Un saut sur la seconde branche donnerait 77 %.
// Relevé sur la sortie d'erreur : ses paliers dépendent du moment de la lecture.
console.error('Fait, en % :', [...new Set(seen)].join(' '));
check('« Fait » ne passe jamais au-delà de ce qui est couru', most <= 37, `au plus ${most} %`);
check('« Fait » juste à la fin', last >= 35 && last <= 37, `${last} %`);
console.log('Restant :', await statValue('Restant'));

// 3. Les deux tracés en plan.
const inPlan = await pathsIn('traceSuivie');
console.log('en plan :', JSON.stringify(inPlan));
// La partie faite naît en route : elle vient après le reste dans le dessin, ils ne se touchent qu'au point de coupe.
check('plan : reste et partie faite, attributs attendus', inPlan.length === 2 && inPlan.some((p) => same(p, REMAINDER)) && inPlan.some((p) => same(p, DONE)), JSON.stringify(inPlan));
const orderPlan = { suivie: await paneOrder('traceSuivie'), traces: await paneOrder('overlay') };
check('plan : trace suivie sous la trace enregistrée', orderPlan.suivie < orderPlan.traces, JSON.stringify(orderPlan));
await shoot('trace-suivie-plan');

// 4. En satellite, par le bouton de la carte.
await evaluate(`document.querySelector('[aria-label="Fond de carte"]').click(); 'ok'`);
await wait(200);
check('passage en satellite', await clickText('Satellite', '.map-base-switch__menu button') === 'ok');
await waitFor(`Boolean(document.querySelector('.leaflet-traceSuivieLisere-pane svg path'))`, { timeout: 5000, label: 'liseré posé' });
await wait(300);
const overlay = await pathsIn('overlay');
console.log('trace enregistrée, dans son ordre :', overlay.map((p) => `${p.couleur}/${p.epaisseur}`).join(' '));
const halos = await pathsIn('traceSuivieLisere');
console.log('liseré :', JSON.stringify(halos));
check('satellite : liseré blanc sous chaque tracé, à son épaisseur + 3',
  halos.length === 2 && halos.every((h) => h.couleur === '#ffffff' && h.opacite === '0.85' && h.interactif === false)
  && halos[0].epaisseur === '7' && halos[1].epaisseur === '9', JSON.stringify(halos));
const inSat = await pathsIn('traceSuivie');
check('satellite : les deux tracés inchangés', same(inSat, inPlan), JSON.stringify(inSat));
const orderSat = { lisere: await paneOrder('traceSuivieLisere'), suivie: await paneOrder('traceSuivie'), traces: await paneOrder('overlay') };
check('satellite : liseré, puis trace suivie, puis trace enregistrée', orderSat.lisere < orderSat.suivie && orderSat.suivie < orderSat.traces, JSON.stringify(orderSat));
// Le liseré de la trace enregistrée naît après elle (satellite activé après le départ) : il doit rester dessous.
const trackHalos = await pathsIn('traceLisere');
const orderTrack = { lisereTrace: await paneOrder('traceLisere'), suivie: await paneOrder('traceSuivie'), traces: await paneOrder('overlay') };
check('satellite activé après le départ : le liseré de la trace est dans un calque sous la trace',
  trackHalos.length > 0 && trackHalos.every((h) => h.couleur === '#ffffff') && orderTrack.suivie < orderTrack.lisereTrace && orderTrack.lisereTrace < orderTrack.traces, JSON.stringify(orderTrack));
await shoot('trace-suivie-satellite');

await evaluate(`document.querySelector('[aria-label="Fond de carte"]').click(); 'ok'`);
await wait(200);
check('retour au plan', await clickText('Plan', '.map-base-switch__menu button') === 'ok');
await wait(500);
check('plan : plus de liseré', await evaluate(`document.querySelectorAll('.leaflet-traceSuivieLisere-pane svg path').length`) === 0);

// Arrêt tenu puis « Jeter » : le profil reste propre.
const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
await wait(2300);
await evaluate(`(() => { const b = window.__stopButton; b?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b?.click(); return 'ok'; })()`);
await settle({ max: 3000 });
check('arrêt tenu puis « Jeter »', down === 'ok' && await clickText('Jeter') === 'ok');
await settle({ max: 2000 });

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await finish('Tout passe.');
