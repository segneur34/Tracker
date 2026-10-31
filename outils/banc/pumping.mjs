// Banc de test : pumping foil en surf (§10, point 104 ; séries validées par leur cadence, lot 50).
// Usage : node pumping.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, serveur de développement (le script importe `/src/...` dans la page).
// Le script fabrique lui-même, dans la page, une session de surf foil de quatre vols et ses capteurs
// (`.imu` synthétique, `core/imuSynthetic.fixture.ts` : chocs de l'eau hors des vols ; pumping à 1,5 Hz sur une partie
// des vols seulement : deux séries dans le vol 1, une dans le vol 2, aucune dans le vol 3, une dans le vol 4), et vérifie :
//  1. Réglages, carte « Surf foil » : la case « Pumping foil » (partie Onglet analyse), cochée, puis le résumé de la carte ;
//     carte « Surf » (sans foil) : pas de case ;
//  2. l'import de la session avec ses capteurs, puis l'analyse : Foil et Pumping cochés pour la session (onglet
//     réglages), onglet « vols » : titre « Pumping (4 séries) », tuiles (cadence vers 90 /min, séries, temps pompé,
//     coups, par coup, part du vol pompée), les 3 plus longues séries, « Toutes les séries (4) », puis les vols à part
//     (tuiles, 3 plus longs, « Tous les vols (4) » replié puis déplié) ; « Voir » d'une série puis d'un vol : une
//     seule surbrillance sur la carte ;
//  3. Pumping décoché pour la session : les vols seuls, colonnes du GPS « Hors vague » ; « Enregistrer la session »
//     range `analysis.pumping` ;
//  4. Enregistrer, dans le navigateur : pas de case « Mesurer le pumping » (téléphone seulement) ;
//  5. la page à 390 × 844, sans débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node pumping.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, go, settle, waitFor, wait, blockNetwork, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
// Ici une exception de la page rend un texte « ERREUR : … » au lieu de `undefined`.
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return `ERREUR : ${r.result.exceptionDetails.exception?.description?.split('\n')[0] ?? r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};

const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    ?? [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent'; if (t.getAttribute('aria-pressed') === 'true') return 'déjà ouvert'; t.click(); return 'ok';
})()`);
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ').slice(0, 4000) : '(absent)';
})()`);
/** Le panneau de l'onglet « vols » : titré « Pumping (N séries) » avec les capteurs, « Vols (N) » sans. */
const pumpPanel = `[...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => /^(Pumping|Vols) \\(/.test(h.textContent.trim()))?.closest('.an-carte-panels > *')`;
/**
 * Capteurs lus : depuis le lot 63, le surf ne lit le `.imu` qu'à l'ouverture de l'onglet « vols ».
 * Attend que « Lecture des capteurs » disparaisse et que la tuile « Cadence » paraisse (plafond 10 s).
 */
const sensorsRead = () => waitFor(`(() => {
  const text = ${pumpPanel}?.innerText ?? '';
  return !text.includes('Lecture des capteurs') && text.includes('Cadence');
})()`, { timeout: 10000, label: 'capteurs lus' });
/** En-têtes des tableaux du panneau, dans l'ordre. */
const flightHeads = () => evaluate(`(() => {
  const p = ${pumpPanel};
  return p ? [...p.querySelectorAll('table')].map((tb) => [...tb.querySelectorAll('th')].map((h) => h.textContent).join(', ')).join(' || ') : '(absent)';
})()`);
/** Lignes du tableau du panneau dont le premier en-tête est `first` (`Cadence` : séries ; `Vol` : vols), le `rank`-ième de ce genre. */
const tableRows = (first, rank = 0) => evaluate(`(() => {
  const tables = [...(${pumpPanel}?.querySelectorAll('table') ?? [])].filter((tb) => tb.querySelector('th')?.textContent === ${JSON.stringify(first)});
  const tb = tables[${rank}];
  return tb ? [...tb.querySelectorAll('tbody tr')].map((r) => [...r.cells].slice(0, -1).map((c) => c.textContent).join(' ')).join(' | ') : '(absent)';
})()`);
/** « Voir » de la ligne `row` du premier tableau dont le premier en-tête est `first`. */
const showRow = (first, row) => evaluate(`(() => {
  const tb = [...(${pumpPanel}?.querySelectorAll('table') ?? [])].find((t) => t.querySelector('th')?.textContent === ${JSON.stringify(first)});
  const b = tb?.querySelectorAll('tbody tr')[${row}]?.querySelector('td:last-child button');
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
/** Traits et points violets (passage montré seul) sur la carte. */
const violetPaths = () => evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#7b1fa2"]').length`);
const sessionBox = (label) => evaluate(`(() => {
  const box = [...document.querySelectorAll('.an-carte-panels label')].find((l) => l.querySelector('strong')?.textContent === ${JSON.stringify(label)})?.querySelector('input[type=checkbox]');
  if (!box) return 'absente'; box.click(); return box.checked ? 'cochée' : 'décochée';
})()`);
const sessionsDir = `(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'))`;
const recordAt = (startMs) => evaluate(`(async () => {
  for await (const [name, h] of ${sessionsDir}.entries()) {
    if (!name.endsWith('.json')) continue;
    const r = JSON.parse(await (await h.getFile()).text());
    if (r.summary?.startMs === ${startMs}) return r;
  }
  return null;
})()`);
/** Ouvre la section « Activités » de Réglages si elle est fermée (son état est mémorisé). */
const openActivities = async () => {
  if (!(await evaluate(`document.querySelector('.settings-activities') !== null`))) await clickText('Activités', '[role=button]');
  await wait(400);
  // Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
  await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
  await wait(300);
};
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork();

// --- 1. Réglages ---
await go('/parametres', 4000);
await openActivities();
// Carte d'une activité, repliée (son nom) ou ouverte (le choix de sa couleur) : l'état ouvert est mémorisé.
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === ${JSON.stringify(name)}
  || c.querySelector('[aria-label="Couleur de ${name}"]'))`;
const setCardOpen = (name, open) => evaluate(`(() => {
  const c = ${card(name)}; if (!c) return 'absente';
  if ((c.querySelector('.settings-activity__body') !== null) !== ${open}) c.querySelector('.settings-activity__toggle').click();
  return 'ok';
})()`);
for (const name of ['Surf foil', 'Surf']) {
  await setCardOpen(name, true);
  await wait(300);
}
await clickText('Onglet analyse', '.settings-activity button');
await wait(300);
const rows = (name) => evaluate(`[...(${card(name)}?.querySelectorAll('.settings-row__label') ?? [])].map((l) => l.textContent).join(', ')`);
const foilRows = await rows('Surf foil');
check('case Pumping sur Surf foil', /Pumping/.test(foilRows ?? ''), foilRows);
const surfRows = await rows('Surf');
check('pas de case Pumping sur Surf (sans foil)', !/Pumping/.test(surfRows ?? ''), surfRows);
// L'aide du seuil est sous son « ? » (lot 3 des demandes du 19/10) : ouverte, lue, refermée.
console.log('aide du seuil de vol :', await evaluate(`(() => {
  const row = [...(${card('Surf foil')}?.querySelectorAll('.settings-row') ?? [])].find((r) => r.textContent.includes('Seuil de vol'));
  const help = row?.querySelector('.ui-help'); if (!help) return '(absente)';
  help.click();
  return new Promise((ok) => setTimeout(() => { const text = row.querySelector('.settings-help')?.textContent ?? '(absente)'; help.click(); ok(text); }, 100));
})()`));
console.log('cocher Pumping foil :', await evaluate(`(() => {
  const row = [...(${card('Surf foil')}?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === 'Pumping');
  const box = row?.querySelector('input[type=checkbox]'); if (!box) return 'absente'; box.click(); return box.checked ? 'cochée' : 'décochée';
})()`));
await wait(300);
await go('/parametres', 3000);
await openActivities();
await setCardOpen('Surf foil', false);
await wait(300);
const summary = await evaluate(`${card('Surf foil')}?.innerText.replace(/\\n+/g, ' ')`);
check('résumé de la carte repliée', /foil · pumping/.test(summary ?? ''), summary);
await shoot('pumping-reglages');

// --- 2. Session de surf foil et ses capteurs ---
// 450 s : quatre vols à 4,5 m/s (16 km/h, sous le seuil de vague en foil), de 60, 30, 20 et 10 s ; rame à 1 m/s
// entre eux, départ à 2 m/s les 4 s qui précèdent chaque vol. Capteurs : chocs de l'eau hors des vols, pumping
// vertical de 0,3 g à 1,5 Hz sur une partie des vols : 15 s puis 20 s dans le vol 1, 12 s dans le vol 2, rien dans
// le vol 3, 7 s dans le vol 4 ; le reste du vol, calme.
await go('/surf', 4000);
const imported = await evaluate(`(async () => {
  const { encodeImu } = await import('/src/core/imuFile.ts');
  const { synthImu, SYNTH_WALL_MS } = await import('/src/core/imuSynthetic.fixture.ts');
  const start = SYNTH_WALL_MS;
  const flights = [[64, 124], [200, 230], [300, 320], [400, 410]];
  const inFlight = (t) => flights.some(([a, b]) => t >= a && t < b);
  const speed = (t) => (inFlight(t) ? 4.5 : flights.some(([a]) => t >= a - 4 && t < a) ? 2 : 1);
  const pts = [];
  let lat = 43.4;
  for (let i = 0; i <= 450; i++) {
    lat += speed(i) / 111195;
    pts.push('<trkpt lat="' + lat.toFixed(7) + '" lon="3.6"><time>' + new Date(start + i * 1000).toISOString() + '</time><extensions><speed>' + speed(i) + '</speed><course>0</course></extensions></trkpt>');
  }
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Pumping</name><type>surf</type><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  const G = 9.80665;
  const water = (t) => 0.4 * G * Math.sin(2 * Math.PI * 5.3 * t) + 0.3 * G * Math.sin(2 * Math.PI * 7.1 * t + 1) + 0.2 * G * Math.sin(2 * Math.PI * 3.3 * t + 2);
  const pumped = [[70, 85], [100, 120], [206, 218], [402, 409]];
  const pump = (t) => (pumped.some(([a, b]) => t >= a && t < b) ? Math.sin(2 * Math.PI * 1.5 * t) : 0);
  const rec = synthImu({ durationS: 450, az: (t) => (inFlight(t) ? 0.3 * G * pump(t) : water(t)), ay: (t) => 0.1 * G * pump(t), tilt: (t) => Math.PI / 6 + 0.1 * pump(t) });
  const imu = await encodeImu(rec.header, rec.series);
  const input = [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept);
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([gpx], 'pumping.gpx', { type: 'application/gpx+xml' }));
  dt.items.add(new File([imu], 'pumping.imu'));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { start, size: imu.length };
})()`);
console.log('import :', JSON.stringify(imported));
const startMs = imported?.start;
const record = await waitFor(() => recordAt(startMs), { timeout: 6000, label: 'fiche' });
await settle({ max: 2000, label: 'import' });
check('session rangée', record !== null, record ? `${record.gpx}, activité ${record.activityId}` : '');
const path = `/surf/analyse?session=${encodeURIComponent(record?.gpx ?? '')}`;
await go(path, 5000);
console.log('réglages :', await openTab('réglages'));
await wait(400);
const foilBox = await sessionBox('Foil');
if (foilBox === 'décochée') await sessionBox('Foil');
await wait(500);
let pumpBox = await evaluate(`[...document.querySelectorAll('.an-carte-panels label')].find((l) => l.querySelector('strong')?.textContent === 'Pumping')?.querySelector('input')?.checked`);
if (pumpBox !== true) pumpBox = await sessionBox('Pumping');
console.log('Foil :', foilBox, '| Pumping :', pumpBox);
await settle({ max: 1500 });
console.log('vols :', await openTab('vols'));
await settle({ max: 2000 });
await sensorsRead();
const vols = await panel('Pumping');
console.log('panneau :', vols);
// Titre en capitales à l'écran (titres de panneau, `--title-*`) : comparé sans la casse.
check('titre « Pumping (4 séries) »', /^Pumping \(4 séries\)/i.test(vols ?? ''), /^[^/]+/.exec(vols ?? '')?.[0]);
// Le texte du panneau, coupé à chaque ligne : une tuile est son libellé, puis sa valeur.
const tokens = (vols ?? '').split(' / ');
const tile = (label) => { const i = tokens.indexOf(label); return i < 0 ? undefined : tokens[i + 1]; };
const cadence = Number(/^(\d+) \/min$/.exec(tile('Cadence') ?? '')?.[1]);
check('tuile Cadence vers 90 coups par minute, en tête', Math.abs(cadence - 90) <= 5 && tokens.indexOf('Cadence') >= 0 && tokens.indexOf('Cadence') < tokens.indexOf('Séries'), tile('Cadence'));
check('tuile Séries', tile('Séries') === '4', tile('Séries'));
console.log('tuiles : temps pompé', tile('Temps pompé'), '| coups', tile('Coups'), '| par coup', tile('Par coup'), '| part du vol pompée', tile('Part du vol pompée'));
// 4,5 m/s à 1,5 coup par seconde : 3 m par coup.
check('distance par coup', /^(2,9|3,\d) m$/.test(tile('Par coup') ?? ''), tile('Par coup'));
check('part du vol pompée entre 30 et 60 %', (() => { const v = Number(/^(\d+) %$/.exec(tile('Part du vol pompée') ?? '')?.[1]); return v >= 30 && v <= 60; })(), tile('Part du vol pompée'));
check('vols à part : tuiles Vols, Temps de vol, Plus long vol', tokens.includes('Vols (4)') && tile('Vols') === '4' && tile('Temps de vol') !== undefined && tile('Plus long vol') !== undefined, `${tile('Vols')} · ${tile('Temps de vol')} · ${tile('Plus long vol')}`);
const heads = await flightHeads();
check('les 3 plus longues séries : cadence d’abord', /^Cadence, Début, Durée, Coups, m\/coup, Vitesse \(km\/h\), Vol, Carte/.test(heads ?? ''), heads);
check('les 3 plus longs vols : décollage, séries, temps pompé', /Vol, Début, Durée, Distance, Décollage \(km\/h\), Séries, Temps pompé, Carte/.test(heads ?? ''));
check('tableaux complets repliés', (heads ?? '').split(' || ').length === 2);
console.log('3 plus longues séries :', await tableRows('Cadence'));
console.log('3 plus longs vols :', await tableRows('Vol'));
console.log('déplier les séries :', await clickText('Toutes les séries (4)'));
console.log('déplier les vols :', await clickText('Tous les vols (4)'));
await wait(400);
const allHeads = await flightHeads();
check('tableaux complets dépliés', (allHeads ?? '').split(' || ').length === 4
  && /Vol, Début, Durée, Distance, Décollage \(km\/h\), Vagues, Séries, Temps pompé, Carte/.test(allHeads ?? ''), allHeads);
const allSeries = await tableRows('Cadence', 1);
console.log('toutes les séries :', allSeries);
check('quatre séries, deux dans le vol 1', (allSeries ?? '').split(' | ').length === 4 && /^(?:[^|]* 1 \| ){2}[^|]* 2 \| [^|]* 4$/.test(allSeries ?? ''), allSeries);
const allFlights = await tableRows('Vol', 1);
console.log('tous les vols :', allFlights);
check('le vol 3, sans pompe, sans série', /Vol 3 [^|]* 0 0 s(?: \||$)/.test(allFlights ?? ''), allFlights);
console.log('Voir la plus longue série :', await showRow('Cadence', 0));
await wait(500);
const seriesPaths = await violetPaths();
check('série sur la carte', seriesPaths > 0, String(seriesPaths));
await shoot('pumping-vols');
console.log('Voir le plus long vol :', await showRow('Vol', 0));
await wait(500);
const flightPaths = await violetPaths();
check('le vol remplace la série : une seule surbrillance', flightPaths === seriesPaths, `${seriesPaths} puis ${flightPaths}`);

// --- 3. Pumping décoché pour la session, puis enregistré ---
console.log('Pumping :', await sessionBox('Pumping'));
await settle({ max: 800 });
console.log('panneau sans pumping :', await panel('Vols'));
const gpsHeads = await flightHeads();
check('les vols seuls, colonnes du GPS « Hors vague »', /Vagues, Hors vague, Vitesse hors vague \(km\/h\)/.test(gpsHeads ?? '')
  && !/Décollage|Cadence|Pompage/.test(gpsHeads ?? ''), gpsHeads);
console.log('Pumping :', await sessionBox('Pumping'));
await settle({ max: 800 });
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await recordAt(startMs))?.analysis?.pumping === true, { timeout: 2500, label: 'fiche enregistrée' });
const saved = await recordAt(startMs);
// Pumping coché pour Surf foil en 1 ; la session, sous Surf, n'a pas le pumping de son activité : le sien est rangé.
check('foil et pumping rangés dans la fiche', saved?.analysis?.foil === true && saved?.analysis?.pumping === true, JSON.stringify({ foil: saved?.analysis?.foil, pumping: saved?.analysis?.pumping }));

// --- 4. Enregistrer ---
await go('/enregistrer', 3000);
await clickText('Surf', '[aria-label=Famille] button');
await wait(300);
// Activité : bouton glissant d'Enregistrer (23/10).
console.log('activité Surf foil :', await clickText('Surf foil', '[aria-label=Activité] button'));
await wait(300);
check('pas de case « Mesurer le pumping » dans le navigateur', !(await evaluate(`document.body.innerText.includes('Mesurer le pumping')`)));

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(path, 5000);
await openTab('vols');
await settle({ max: 1500 });
await sensorsRead();
console.log('Toutes les séries :', await clickText('Toutes les séries (4)'), '| Tous les vols :', await clickText('Tous les vols (4)'));
await wait(400);
console.log('carte d’une série au téléphone :', await evaluate(`(() => {
  const tb = [...(${pumpPanel}?.querySelectorAll('table') ?? [])].find((t) => t.querySelector('th')?.textContent === 'Cadence');
  const r = tb?.querySelector('tbody tr'); if (!r) return '(absent)';
  return getComputedStyle(r).display + ' : ' + r.innerText.replace(/\\s+/g, ' ');
})()`));
await shoot('pumping-telephone');
const width = await evaluate('document.documentElement.scrollWidth');
check('pas de débordement à 390 px', width <= 390, String(width));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'Tout passe.' : `${failures} échec(s).`);
await close();
process.exit(0);
