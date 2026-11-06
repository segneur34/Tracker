// Banc de test : virages du surf mesurés par le gyroscope (lot 40).
// Usage : node virages.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, serveur de développement (le script importe `/src/...` dans la page).
// Le script fabrique lui-même, dans la page, une session de surf de deux vagues et ses capteurs (`.imu` synthétique,
// `core/imuSynthetic.fixture.ts`) : la première vague (40 à 50 s, cap GPS constant) a trois virages du buste de 90° à
// 120°/s, vus du seul gyroscope ; la capture s'arrête à 120 s, avant la seconde vague (130 à 140 s), dont le cap GPS
// change. Il vérifie :
//  1. Réglages, cartes « Surf » et « Surf foil » : la ligne « Virages » (partie Onglet analyse), case « Mesurer les
//     virages » cochée, marque « défaut » ; le résumé de la carte repliée dit « virages » ;
//  2. l'import de la session avec ses capteurs, puis l'onglet « vagues » : en-tête « Virages » sans astérisque une fois
//     les capteurs lus, 3 virages pour la première vague, la valeur du GPS marquée « * » pour la seconde, et la note
//     qui le dit ;
//  3. Enregistrer, dans le navigateur : pas de case « Mesurer les virages » (téléphone seulement) ;
//  4. la page à 390 × 844, sans débordement.
// Il finit par « Tout passe. » ou le nombre d'échecs, code 0 ou 1.
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node virages.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { send, evaluate, go, settle, waitFor, wait, blockNetwork, shoot, clickText, check, finish, logs, records } = await connect({ port, width: 1400, height: 1000, shotDir });

const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent'; if (t.getAttribute('aria-pressed') === 'true') return 'déjà ouvert'; t.click(); return 'ok';
})()`);
/** Panneau « Vagues » (son titre peut porter le nombre de vagues). */
const wavesPanel = `[...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => /^Vagues/i.test(h.textContent.trim()))?.closest('.an-carte-panels > *')`;
/** En-têtes du tableau des vagues. */
const waveHeads = () => evaluate(`[...(${wavesPanel}?.querySelectorAll('table th') ?? [])].map((h) => h.textContent).join(', ')`);
/** Cellule « Virages » de chaque ligne, dans l'ordre du tableau (tri par heure d'office). */
const turnCells = () => evaluate(`(() => {
  const table = ${wavesPanel}?.querySelector('table'); if (!table) return '(absent)';
  const col = [...table.querySelectorAll('th')].findIndex((h) => h.textContent.startsWith('Virages'));
  return [...table.querySelectorAll('tbody tr')].map((r) => r.cells[col]?.textContent).join(' | ');
})()`);
/** Ouvre la section « Activités » de Réglages et toutes ses familles. */
const openActivities = async () => {
  if (!(await evaluate(`document.querySelector('.settings-activities') !== null`))) await clickText('Activités', '[role=button]');
  await wait(400);
  await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
  await wait(300);
};
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === ${JSON.stringify(name)}
  || c.querySelector('[aria-label="Couleur de ${name}"]'))`;
const setCardOpen = (name, open) => evaluate(`(() => {
  const c = ${card(name)}; if (!c) return 'absente';
  if ((c.querySelector('.settings-activity__body') !== null) !== ${open}) c.querySelector('.settings-activity__toggle').click();
  return 'ok';
})()`);
/** Ligne « Virages » d'une carte : case cochée, marque « défaut ». */
const turnsRow = (name) => evaluate(`(() => {
  const row = [...(${card(name)}?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === 'Virages');
  if (!row) return '(absente)';
  const box = row.querySelector('input[type=checkbox]');
  return row.innerText.replace(/\\s+/g, ' ').trim() + (box?.checked ? ' [cochée]' : ' [décochée]');
})()`);

await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await blockNetwork();

// --- 1. Réglages ---
await go('/parametres', 4000);
await openActivities();
for (const name of ['Surf', 'Surf foil']) {
  await setCardOpen(name, true);
  await wait(300);
}
await clickText('Onglet analyse', '.settings-activity button');
await wait(300);
for (const name of ['Surf', 'Surf foil']) {
  const row = await turnsRow(name);
  check(`ligne « Virages » de ${name}, cochée d'office`, /Mesurer les virages/.test(row ?? '') && /défaut/.test(row ?? '') && /\[cochée\]$/.test(row ?? ''), row);
}
await setCardOpen('Surf', false);
await wait(300);
const summary = await evaluate(`${card('Surf')}?.innerText.replace(/\\n+/g, ' ')`);
check('résumé de la carte repliée : « virages »', /virages/.test(summary ?? ''), summary);
await shoot('virages-reglages');

// --- 2. Session de surf et ses capteurs ---
await go('/surf', 4000);
const imported = await evaluate(`(async () => {
  const { encodeImu } = await import('/src/core/imuFile.ts');
  const { synthImu, SYNTH_WALL_MS } = await import('/src/core/imuSynthetic.fixture.ts');
  const start = SYNTH_WALL_MS;
  // [durée en s, vitesse en m/s, cap GPS]
  const phases = [[30, 0, 0], [10, 1.2, 0], [10, 5, 0], [30, 1.2, 180], [40, 0, 0], [10, 1.2, 0], [4, 6, 160], [2, 6, 250], [4, 6, 120], [30, 1.2, 180], [20, 0, 0]];
  const pts = [];
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const push = (speed, heading) => pts.push('<trkpt lat="' + lat.toFixed(7) + '" lon="' + lon.toFixed(7) + '"><time>' + new Date(start + t * 1000).toISOString()
    + '</time><extensions><speed>' + speed + '</speed>' + (speed > 0 ? '<course>' + heading + '</course>' : '') + '</extensions></trkpt>');
  push(0, 0);
  for (const [s, speed, heading] of phases) {
    for (let k = 0; k < s; k++) {
      lat += (speed * Math.cos((heading * Math.PI) / 180)) / 111195;
      lon += (speed * Math.sin((heading * Math.PI) / 180)) / (111195 * Math.cos((lat * Math.PI) / 180));
      t += 1;
      push(speed, heading);
    }
  }
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Virages</name><type>surf</type><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  // Trois virages du buste de 90° à 120°/s, alternés, dans la première vague.
  const turns = [[42, 90], [45, -90], [48, 90]];
  const yaw = (x) => turns.reduce((deg, [at, angle]) => deg + angle * Math.min(1, Math.max(0, (x - at) / 0.75)), 0) * Math.PI / 180;
  const rec = synthImu({ durationS: 120, az: () => 0, yaw });
  const imu = await encodeImu(rec.header, rec.series);
  const input = [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept);
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([gpx], 'virages.gpx', { type: 'application/gpx+xml' }));
  dt.items.add(new File([imu], 'virages.imu'));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { start, size: imu.length };
})()`);
console.log('import :', JSON.stringify(imported));
const record = await waitFor(async () => (await records()).find((r) => r.summary?.startMs === imported?.start) ?? null, { timeout: 20000, label: 'fiche' });
await settle({ max: 2000, label: 'import' });
check('session rangée', Boolean(record), record ? `${record.gpx}, activité ${record.activityId}` : '');
const path = `/surf/analyse?session=${encodeURIComponent(record?.gpx ?? '')}`;
await go(path, 5000);
console.log('vagues :', await openTab('vagues'));
// Capteurs lus à l'ouverture de l'onglet : l'en-tête passe de « Virages* » à « Virages ».
const read = await waitFor(async () => /(^|, )Virages(,|$)/.test((await waveHeads()) ?? ''), { timeout: 10000, label: 'capteurs lus' });
const heads = await waveHeads();
check('en-tête « Virages » sans astérisque, capteurs lus', Boolean(read), heads);
const cells = (await turnCells()) ?? '';
console.log('virages des vagues :', cells);
const [first, second] = cells.split(' | ');
check('première vague : 3 virages du gyroscope', first === '3', first);
check('seconde vague, hors capture : valeur du GPS marquée « * »', /^\d+\*$/.test(second ?? ''), second);
// La note est sous le « ? » du panneau (aide fermée par défaut) : ouverte, lue, refermée.
const note = await evaluate(`(() => {
  const panel = ${wavesPanel}; const help = panel?.querySelector('button.ui-help'); if (!help) return '(aide absente)';
  help.click();
  return new Promise((ok) => setTimeout(() => { const text = panel.querySelector('.help-note')?.textContent ?? '(note absente)'; help.click(); ok(text); }, 150));
})()`);
check('la note dit gyroscope et vague sans capture', /gyroscope/.test(note ?? '') && /Vague sans capture/.test(note ?? ''), note);
await shoot('virages-vagues');

// --- 3. Enregistrer ---
await go('/enregistrer', 3000);
await clickText('Surf', '[aria-label=Famille] button');
await wait(300);
console.log('activité Surf :', await clickText('Surf', '[aria-label=Activité] button'));
await wait(300);
check('pas de case « Mesurer les virages » dans le navigateur', !(await evaluate(`document.body.innerText.includes('Mesurer les virages')`)));

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(path, 5000);
await openTab('vagues');
await waitFor(async () => /(^|, )Virages(,|$)/.test((await waveHeads()) ?? ''), { timeout: 10000, label: 'capteurs lus' });
await shoot('virages-telephone');
const width = await evaluate('document.documentElement.scrollWidth');
check('pas de débordement à 390 px', width <= 390, String(width));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
await finish();
