// Banc de test : sauts en voile, étape 1 (réglages, foil, capteurs rangés avec la session).
// Usage : node sauts.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script fabrique lui-même, dans la page, une session de voile et ses
// capteurs (`.imu`, par l'encodeur de l'application), et vérifie :
//  1. Réglages, carte de l'activité « Voile » (familles, carte et parties ouvertes, sans refermer ce que la mémoire a ouvert) :
//     « Foil » (coché d'office en wingfoil, partie Onglet analyse) puis « Sauts » (cochés d'office depuis les pré-réglages du
//     21/10, partie Enregistrement) et leurs sous-options (poitrine, 0,5 m) ; emplacement au bras, hauteur minimale 1,5 m,
//     foil décoché ; tout relu après rechargement, résumé de la carte repliée compris ;
//  2. l'import d'une session avec ses capteurs : `.imu` rangé à côté du GPX, relisible ;
//  3. l'analyse, foil décoché pour l'activité : « Ratio de navigation », matériel sans « Foil » ni « Mât » ; foil coché
//     pour la session : « Ratio de vol », champs revenus, `analysis.foil` dans la fiche après « Enregistrer la session » ;
//  3 bis. l'onglet « sauts » : les deux sauts de la capture (vol libre de 1,3 s, 2,07 m, au-dessus de la hauteur minimale de 1,5 m réglée en 1), podium, tableau, courbe,
//     « Voir », sauts rangés dans la fiche ; captures sur ordinateur et à 390×844 ;
//  4. Enregistrer, dans le navigateur : pas de case « Mesurer les sauts » (téléphone seulement) ;
//  5. la suppression de la session : GPX, fiche et `.imu` effacés ;
//  6. à pied et au VTT (n° 174) : Course par défaut, case « Sauts » et onglet décochés, onglet absent d'une analyse à capture ;
//     cocher la case enfonce le bouton et montre l'onglet sous « avancé » ; chaque clic sur le bouton (souris, puis toucher à
//     390 px) change son état, la marque « défaut » revenant avec le pré-réglage ; décocher la case garde le choix ; « tops » du VTT répond.
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node sauts.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, shoot, close, logs } = await connect({ port, shotDir });

// Rangée « avancé » des analyses ouverte d'office, onglets posés dans `tracker.sections` rejoués à chaque analyse (`lib/onglets.mjs`, 05/11) ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
const sessionsDir = `(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'))`;
const sessionFiles = () => evaluate(`(async () => {
  const names = [];
  for await (const [name] of ${sessionsDir}.entries()) names.push(name);
  return names.sort();
})()`);
const check = (label, ok, detail = '') => console.log(`${ok ? 'ok ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);

// --- 1. Réglages ---
await go('/parametres', 4000);
/** Ouvre la carte d'une activité (et le bloc Activités s'il est replié). */
const openCard = (name) => evaluate(`(() => {
  if (!document.querySelector('.settings-activity')) {
    const title = [...document.querySelectorAll('[role=button], button')].find((b) => b.textContent.trim() === 'Activités');
    title?.click();
  }
  return new Promise((r) => setTimeout(() => {
    // Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
    document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click());
    setTimeout(() => {
      const card = [...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent.trim() === ${JSON.stringify(name)});
      if (!card) return r('carte absente');
      if (card.querySelector('.settings-activity__toggle').getAttribute('aria-expanded') !== 'true') card.querySelector('.settings-activity__toggle').click();
      // Parties de la carte (affichage, onglet analyse…) repliées au départ (21/10) : toutes ouvertes.
      setTimeout(() => {
        card.querySelectorAll('.settings-part__toggle[aria-expanded="false"]').forEach((b) => b.click());
        setTimeout(() => r('ok'), 300);
      }, 300);
    }, 300);
  }, 300));
})()`);
const openVoile = () => openCard('Voile');
const voileCard = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent.trim() === 'Voile' && c.querySelector('.settings-activity__body'))`;
/** Lignes de la carte ouverte : libellé, état de la case éventuelle, sous-option. */
const rows = () => evaluate(`(() => {
  const card = ${voileCard};
  if (!card) return null;
  return [...card.querySelectorAll('.settings-row')].map((r) => ({
    label: r.querySelector('.settings-row__label')?.textContent.trim(),
    checked: r.querySelector('input[type=checkbox]')?.checked ?? null,
    sub: r.classList.contains('settings-row--sub'),
    text: r.innerText.replace(/\\n+/g, ' ').slice(0, 120),
  }));
})()`);
const clickBox = (label) => evaluate(`(() => {
  const row = [...(${voileCard}).querySelectorAll('.settings-row')].find((r) => r.querySelector('.settings-row__label')?.textContent.trim() === ${JSON.stringify(label)});
  const box = row?.querySelector('input[type=checkbox]');
  if (!box) return 'absent';
  box.click();
  return box.checked;
})()`);

console.log('carte Voile :', await openVoile());
await wait(500);
let list = await rows();
const labels = list.map((r) => r.label);
// « Taille du texte » retirée le 09/10 : Foil, puis Sauts plus bas.
check('Foil puis Sauts', labels.indexOf('Foil') >= 0 && labels.indexOf('Sauts') > labels.indexOf('Foil'), labels.join(' | '));
check('Foil coché d\'office (wingfoil)', list.find((r) => r.label === 'Foil')?.checked === true);
// Pré-réglages du 21/10 : les sauts de la Voile sont cochés d'office (poitrine, 0,5 m), avec leurs deux sous-options.
check('Sauts cochés d\'office, avec leurs deux sous-options', list.find((r) => r.label === 'Sauts')?.checked === true && list.filter((r) => r.sub).length === 2);
const subs = list.filter((r) => r.sub);
const subValues = await evaluate(`[...(${voileCard}).querySelectorAll('.settings-row--sub')].map((r) => (r.querySelector('select') ?? r.querySelector('input'))?.value).join(' | ')`);
check('sous-options : poitrine, 0,5 m', subs.length === 2 && subValues === 'poitrine | 0.5', subValues);
console.log('emplacement → bras :', await evaluate(`(() => {
  const row = [...(${voileCard}).querySelectorAll('.settings-row--sub')].find((r) => r.textContent.includes('Emplacement'));
  const s = row?.querySelector('select');
  if (!s) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'bras');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return row.innerText.replace(/\\n+/g, ' ');
})()`));
console.log('hauteur minimale → 1,5 :', await evaluate(`(() => {
  const row = [...(${voileCard}).querySelectorAll('.settings-row--sub')].find((r) => r.textContent.includes('Hauteur minimale'));
  const i = row?.querySelector('input');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '1.5');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`));
console.log('décocher Foil :', await clickBox('Foil'));
await wait(300);
await shoot('sauts-reglages');

await go('/parametres', 4000);
await openVoile();
await wait(500);
list = await rows();
check('relu : foil décoché, sauts cochés', list.find((r) => r.label === 'Foil')?.checked === false && list.find((r) => r.label === 'Sauts')?.checked === true);
check('relu : bras, 1,5 m', list.some((r) => r.sub && r.text.includes('Bras')) && await evaluate(`[...(${voileCard}).querySelectorAll('.settings-row--sub input')].some((i) => i.value === '1.5')`));
const stored = await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}')`);
check('rangé par activité', stored.foils?.wingfoil === false && stored.jumps?.wingfoil?.placement === 'bras', JSON.stringify({ foils: stored.foils, jumps: stored.jumps }));
// Carte repliée : le résumé dit « sauts », plus « foil ».
await evaluate(`(${voileCard}).querySelector('.settings-activity__toggle').click()`);
await wait(300);
const summary = await evaluate(`[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent.trim() === 'Voile')?.querySelector('.settings-activity__summary')?.textContent`);
check('résumé de la carte repliée', /sauts/.test(summary ?? '') && !/foil/.test(summary ?? ''), summary);

// --- 2. Import d'une session avec ses capteurs ---
// Trace de voile de 10 min à 1 Hz, et 10 min de capteurs à 100 Hz, fabriqués dans la page.
const startMs = Date.UTC(2026, 9, 1, 10, 0, 0);
await go('/voile', 4000);
console.log('import :', await evaluate(`(async () => {
  const { encodeImu, PHONE_STREAMS, IMU_FORMAT, IMU_VERSION } = await import('/src/core/imuFile.ts');
  const start = ${startMs};
  const pts = [];
  for (let i = 0; i < 600; i++) {
    const lat = 43.5 + i * 0.00003 * Math.cos(i / 120);
    const lon = 3.9 + i * 0.00003 * Math.sin(i / 120);
    pts.push('<trkpt lat="' + lat.toFixed(6) + '" lon="' + lon.toFixed(6) + '"><time>' + new Date(start + i * 1000).toISOString() + '</time><extensions><speed>' + (6 + Math.sin(i / 30)).toFixed(2) + '</speed></extensions></trkpt>');
  }
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sauts</name><type>wingfoil</type><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  const n = 60000;
  const t = Float64Array.from({ length: n }, (_, i) => i * 10000);
  // Deux sauts sans portance, à 200 s et 400 s : poussée de 0,3 s, vol de 1,3 s (2,07 m), atterrissage de 0,3 s.
  const jumpZ = (ti) => {
    const s = ti / 1e6;
    for (const at of [200, 400]) {
      if (s >= at - 0.3 && s < at) return 9.81 + 18;
      if (s >= at && s < at + 1.3) return 0;
      if (s >= at + 1.3 && s < at + 1.6) return 9.81 + 18;
    }
    return null;
  };
  const accel = { info: PHONE_STREAMS[0], t, values: [0, 1, 2].map((a) => Float32Array.from(t, (ti) => {
    const z = jumpZ(ti);
    return z !== null ? (a === 2 ? z : 0) : (a === 2 ? 9.81 : 0) + 0.3 * Math.sin(ti / 1e5 + a);
  })) };
  const gyro = { info: PHONE_STREAMS[1], t, values: [0, 1, 2].map((a) => Float32Array.from(t, (ti) => 0.2 * Math.cos(ti / 2e5 + a))) };
  const header = { format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: start, clock: { elapsedUs: 1e9, wallMs: start }, setup: { placement: 'bras', foil: false }, streams: PHONE_STREAMS.slice(0, 2) };
  const imu = await encodeImu(header, [accel, gyro]);
  window.__imuSize = imu.length;
  const input = [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept);
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([gpx], 'sauts.gpx', { type: 'application/gpx+xml' }));
  dt.items.add(new File([imu], 'sauts.imu'));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok, ' + imu.length + ' octets';
})()`));
// Le dossier n'existe qu'à la première écriture, après le calcul dans le worker (lot 161) : pas de liste avant.
await waitFor(async () => { const f = await sessionFiles(); return Array.isArray(f) && f.some((n) => n.endsWith('.imu')) && f.some((n) => n.endsWith('.json')) && f.some((n) => n.endsWith('.gpx')); }, { timeout: 6000, label: 'fichiers rangés' });
await settle({ max: 2000, label: 'import' });
let files = await sessionFiles();
// La session importée, par l'instant de son premier point (le profil peut en compter d'autres).
const gpxName = await evaluate(`(async () => {
  for await (const [name, h] of ${sessionsDir}.entries()) {
    if (!name.endsWith('.json')) continue;
    const r = JSON.parse(await (await h.getFile()).text());
    if (r.summary?.startMs === ${startMs}) return r.gpx;
  }
  return null;
})()`);
const imuName = gpxName?.replace(/\.gpx$/, '.imu');
check('.imu rangé à côté du GPX', files.includes(imuName), files.join(', '));
const relu = await evaluate(`(async () => {
  const { decodeImu, imuCaptureStats } = await import('/src/core/imuFile.ts');
  const f = await (await ${sessionsDir}.getFileHandle(${JSON.stringify(imuName ?? '')})).getFile();
  const rec = await decodeImu(new Uint8Array(await f.arrayBuffer()));
  const s = imuCaptureStats(rec);
  return { taille: f.size, attendue: window.__imuSize ?? null, duree: s.durationS, placement: rec.header.setup.placement };
})()`);
check('.imu relisible', relu?.duree > 599 && relu?.placement === 'bras', JSON.stringify(relu));

// --- 3. Analyse : foil de l'activité, puis de la session ---
const analysePath = `/voile/analyse?session=${encodeURIComponent(gpxName ?? '')}`;
await go(analysePath, 6000);
const openTab = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent';
  if (b.getAttribute('aria-pressed') !== 'true') b.click();
  return 'ok';
})()`);
await openTab('matos et conditions');
await openTab('réglages');
await settle({ max: 800 });
const pageText = () => evaluate('document.body.innerText');
let text = await pageText();
check('foil décoché : « Ratio de navigation »', text.includes('Ratio de navigation') && !text.includes('Ratio de vol'));
check('foil décoché : ni « Foil » ni « Mât » au matériel', !/\nMât\n/.test(text) && text.includes('Aile / voile'));
console.log('cocher Foil pour la session :', await evaluate(`(() => {
  const label = [...document.querySelectorAll('label')].find((l) => l.querySelector('strong')?.textContent.trim() === 'Foil');
  const box = label?.querySelector('input[type=checkbox]');
  if (!box) return 'absent';
  box.click();
  return box.checked;
})()`));
await wait(500);
text = await pageText();
check('foil de la session : « Ratio de vol » et « Mât »', text.includes('Ratio de vol') && /Mât/.test(text));
console.log('enregistrer :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Enregistrer la session'));
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await waitFor(async () => (await evaluate(`(async () => JSON.parse(await (await (await ${sessionsDir}.getFileHandle(${JSON.stringify((gpxName ?? '').slice(0, -4) + '.json')})).getFile()).text()))()`))?.analysis?.foil === true, { timeout: 1500, label: 'fiche foil' });
const record = await evaluate(`(async () => JSON.parse(await (await (await ${sessionsDir}.getFileHandle(${JSON.stringify((gpxName ?? '').replace(/\.gpx$/, '.json'))})).getFile()).text()))()`);
check('fiche : analysis.foil vrai', record?.analysis?.foil === true, JSON.stringify(record?.analysis));
await shoot('sauts-analyse');

// --- 3 bis. Onglet « sauts » ---
await go(analysePath, 6000);
console.log('onglet sauts :', await openTab('sauts'));
await settle({ max: 800 });
text = await pageText();
const jumpRows = await evaluate(`document.querySelectorAll('.an-jump-table tbody tr').length`);
check('onglet « sauts » : 2 sauts, le plus haut vers 2,07 m', jumpRows === 2 && /2[.,]0\d m/.test(text), `${jumpRows} lignes, ${(text.match(/2[.,]0\d m/) ?? ['?'])[0]}`);
check('podium, tableau et courbe', text.includes('Les plus hauts') && text.includes('Longueur') && text.includes('comparer avec'));
console.log('Voir :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('.an-jump-table button')].find((x) => x.textContent.trim() === 'Voir');
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(500);
check('« Voir » : le saut en violet sur la carte', await evaluate(`[...document.querySelectorAll('path.leaflet-interactive')].some((p) => p.getAttribute('stroke') === '#7b1fa2')`));
// Tri : les deux sauts ont même hauteur et même vol ; le second est plus long (vitesse plus grande).
const firstRow = () => evaluate(`document.querySelector('.an-jump-table tbody tr .an-jump-num')?.textContent.trim()`);
const clickButton = (selector, label) => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`);
await clickButton('.an-jump-sort button', 'Longueur');
await wait(300);
const longestFirst = await firstRow();
const lengths = await evaluate(`[...document.querySelectorAll('.an-jump-table tbody tr .an-jump-length')].map((c) => c.textContent.trim()).join(' > ')`);
check('tri par longueur : le plus long en tête', parseFloat(lengths.split(' > ')[0].replace(',', '.')) >= parseFloat(lengths.split(' > ')[1].replace(',', '.')), `n° ${longestFirst} en tête, ${lengths}`);
// « Détail » de la dernière ligne : ce saut devient le premier de la courbe.
const lastNum = await evaluate(`[...document.querySelectorAll('.an-jump-table tbody tr .an-jump-num')].at(-1).textContent.trim()`);
await evaluate(`[...document.querySelectorAll('.an-jump-table tbody tr')].at(-1).querySelector('.an-jump-actions button:last-child').click()`);
await wait(600);
const firstCurve = await evaluate(`document.querySelector('.an-jump-compare select')?.selectedOptions[0]?.textContent`);
check('« Détail » : le saut sur la courbe', firstCurve?.startsWith(`n° ${lastNum} `), firstCurve);
// Comparaison : le second menu prend l'autre saut, deux courbes.
console.log('comparer :', await evaluate(`(() => {
  const select = document.querySelectorAll('.an-jump-compare select')[1];
  const other = [...select.options].find((o) => o.value !== '');
  if (!other) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, other.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return other.textContent;
})()`));
await wait(600);
// Seule courbe de la page à ce moment : les onglets à graphes sont fermés.
check('deux courbes comparées', await evaluate(`[...document.querySelectorAll('.recharts-line path')].map((p) => p.getAttribute('stroke')).join(',')`) === '#1565c0,#ef6c00');
// Courbe zoomable et lue au-dessus (lot 2 des demandes du 24/10) : survol, puis double-clic.
const curvePoint = await evaluate(`(async () => {
  const c = document.getElementById('sailing-jump-curve')?.closest('.an-carte-panels > *')?.querySelector('.zoom-chart');
  if (!c) return null;
  c.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 300));
  const r = (c.querySelector('.recharts-cartesian-grid') ?? c).getBoundingClientRect();
  return { x: r.left + r.width * 0.4, y: r.top + r.height / 2 };
})()`);
const curveMouse = (type, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x: curvePoint.x, y: curvePoint.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount });
if (curvePoint) {
  await curveMouse('mouseMoved');
  await wait(300);
  const curveRead = await evaluate(`document.getElementById('sailing-jump-curve')?.closest('.an-carte-panels > *')?.querySelector('[data-chart-readout]')?.textContent.trim()`);
  check('courbe : lecture au-dessus, sans bulle', /^n° \d : [\d,—]+( m)? · n° \d : [\d,—]+( m)? · [\d,]+ s depuis le décollage$/.test(curveRead ?? '')
    && await evaluate(`[...document.querySelectorAll('.recharts-tooltip-wrapper')].every((w) => w.textContent.trim() === '')`), curveRead);
  for (const n of [1, 2]) { await curveMouse('mousePressed', n); await curveMouse('mouseReleased', n); }
  await wait(600);
  const curveButtons = await evaluate(`[...(document.getElementById('sailing-jump-curve')?.closest('.an-carte-panels > *')?.querySelectorAll('.zoom-chart__actions button') ?? [])].map((b) => b.textContent.trim()).join(' | ')`);
  check('courbe : double-clic qui zoome, « Tout voir » sans « Sur la carte »', curveButtons === 'Tout voir', curveButtons);
} else check('courbe zoomable', false, 'absente');
const withJumps = await evaluate(`(async () => JSON.parse(await (await (await ${sessionsDir}.getFileHandle(${JSON.stringify((gpxName ?? '').replace(/\.gpx$/, '.json'))})).getFile()).text()))()`);
check('fiche : sauts rangés', withJumps?.jumps?.jumps?.length === 2, JSON.stringify(withJumps?.jumps?.jumps?.map((j) => j.heightM)));
await shoot('sauts-onglet');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle({ max: 1000 });
await evaluate('window.scrollTo(0, document.querySelector(".an-jump-table")?.getBoundingClientRect().top + window.scrollY - 200)');
await wait(500);
check('390 px : pas de défilement horizontal', await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
await shoot('sauts-onglet-telephone');
await send('Emulation.clearDeviceMetricsOverride');

// --- 4. Enregistrer, dans le navigateur ---
await go('/enregistrer', 3000);
text = await pageText();
check('pas de « Mesurer les sauts » dans le navigateur', !text.includes('Mesurer les sauts'));

// --- 5. Suppression ---
await go('/voile', 4000);
console.log('supprimer :', await evaluate(`(async () => {
  const { removeSession } = await import('/src/hooks/useSessionLibrary.ts');
  await removeSession(${JSON.stringify(gpxName ?? '')});
  return 'ok';
})()`));
await waitFor(async () => !(await sessionFiles()).some((f) => f.startsWith((gpxName ?? '').slice(0, -4))), { timeout: 1000, label: 'fichiers effacés' });
files = await sessionFiles();
check('GPX, fiche et .imu effacés', !files.some((f) => f.startsWith((gpxName ?? '').replace(/\.gpx$/, ''))), files.join(', ') || '(vide)');

// --- 6. À pied et VTT : la case « Sauts » montre l'onglet, chaque clic change le bouton (n° 174) ---
const cardOf = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent.trim() === ${JSON.stringify(name)} && c.querySelector('.settings-activity__body'))`;
const tabButton = (name, label) => `[...((${cardOf(name)})?.querySelectorAll('[aria-label^="Onglets des analyses"] .ui-tab') ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
const jumpsBox = (name) => `[...((${cardOf(name)})?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent.trim() === 'Sauts')?.querySelector('input[type=checkbox]')`;
/** État du bouton d'un onglet dans Réglages : 'true', 'false', ou 'absent'. */
const tabPressed = (name, label) => evaluate(`${tabButton(name, label)}?.getAttribute('aria-pressed') ?? 'absent'`);
/** Vrai si la ligne « Onglets » porte la marque « défaut ». */
const tabsAtDefault = (name) => evaluate(`[...((${cardOf(name)})?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent.trim() === 'Onglets')?.querySelector('.settings-sports__mark')?.textContent.trim() === 'défaut'`);
const jumpsChecked = (name) => evaluate(`${jumpsBox(name)}?.checked ?? 'absent'`);
const tabsStored = (id) => evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').tabs?.[${JSON.stringify(id)}] ?? null`);
const buttonCentre = (name, label) => evaluate(`(async () => {
  const b = ${tabButton(name, label)};
  if (!b) return null;
  b.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 200));
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
/** Un vrai clic de souris au centre du bouton, passé par le test de ce qui se trouve sous le pointeur. */
const mouseClick = async (name, label) => {
  const at = await buttonCentre(name, label);
  if (!at) return;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(150);
};
/**
 * Un toucher du doigt au centre du bouton. Par `dispatchTouchEvent`, qui suit jusqu'au clic :
 * `Input.synthesizeTapGesture`, essayé, s'arrête à `touchend` en Chrome sans fenêtre, sans `click` (05/11).
 */
const tapButton = async (name, label) => {
  const at = await buttonCentre(name, label);
  if (!at) return;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
  await wait(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(200);
};
/** `count` gestes de suite : la suite d'états relevée après chacun, 'true' et 'false' en alternance si chacun a porté. */
const pressesInARow = async (gesture, name, label, count) => {
  const states = [await tabPressed(name, label)];
  for (let i = 0; i < count; i++) {
    await gesture(name, label);
    states.push(await tabPressed(name, label));
  }
  return states;
};
const alternates = (states) => states.every((v, i) => (v === 'true' || v === 'false') && (i === 0 || v !== states[i - 1]));

// Une course de 5 min avec ses capteurs : l'onglet ne dépend plus que du choix de l'activité.
const courseStartMs = startMs + 86_400_000;
await go('/course', 4000);
console.log('import course :', await evaluate(`(async () => {
  const { encodeImu, PHONE_STREAMS, IMU_FORMAT, IMU_VERSION } = await import('/src/core/imuFile.ts');
  const start = ${courseStartMs};
  const pts = [];
  for (let i = 0; i < 300; i++) {
    pts.push('<trkpt lat="' + (43.5 + i * 0.00002).toFixed(6) + '" lon="3.9"><time>' + new Date(start + i * 1000).toISOString() + '</time><extensions><speed>3</speed></extensions></trkpt>');
  }
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course</name><type>running</type><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  const t = Float64Array.from({ length: 15000 }, (_, i) => i * 20000);
  const accel = { info: PHONE_STREAMS[0], t, values: [0, 1, 2].map((a) => Float32Array.from(t, (ti) => (a === 2 ? 9.81 : 0) + 0.3 * Math.sin(ti / 1e5 + a))) };
  const gyro = { info: PHONE_STREAMS[1], t, values: [0, 1, 2].map((a) => Float32Array.from(t, (ti) => 0.2 * Math.cos(ti / 2e5 + a))) };
  const header = { format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: start, clock: { elapsedUs: 1e9, wallMs: start }, setup: { placement: 'poitrine', foil: false }, streams: PHONE_STREAMS.slice(0, 2) };
  const imu = await encodeImu(header, [accel, gyro]);
  const input = [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept);
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([gpx], 'course.gpx', { type: 'application/gpx+xml' }));
  dt.items.add(new File([imu], 'course.imu'));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
const findCourseGpx = () => evaluate(`(async () => {
  for await (const [name, h] of ${sessionsDir}.entries()) {
    if (!name.endsWith('.json')) continue;
    const r = JSON.parse(await (await h.getFile()).text());
    if (r.summary?.startMs === ${courseStartMs}) return r.gpx;
  }
  return null;
})()`);
await waitFor(async () => { const name = await findCourseGpx(); return name && (await sessionFiles()).includes(name.replace(/\.gpx$/, '.imu')); }, { timeout: 6000, label: 'course rangée' });
await settle({ max: 2000, label: 'import course' });
const courseGpx = await findCourseGpx();
const courseAnalyse = `/course/analyse?session=${encodeURIComponent(courseGpx ?? '')}`;
/** Libellés de la rangée « avancé » de l'analyse de la course, une fois affichée. */
const courseAdvancedRow = async () => {
  await go(courseAnalyse, 5000);
  const row = () => evaluate(`[...(document.querySelectorAll('.an-tabs > .ui-tabs')[1]?.querySelectorAll('.ui-tab') ?? [])].map((t) => t.textContent.trim())`);
  await waitFor(async () => (await row()).includes('réglages'), { timeout: 4000, label: 'rangée avancé' });
  await settle({ max: 800 });
  return row();
};
const openCourseSettings = async () => {
  await go('/parametres', 4000);
  await openCard('Course');
  await wait(500);
};

await openCourseSettings();
check('Course par défaut : case « Sauts » décochée', (await jumpsChecked('Course')) === false);
check('Course par défaut : pas de bouton « sauts », la case décochée', (await tabPressed('Course', 'sauts')) === 'absent');
check('Course par défaut : marque « défaut » sur les onglets', await tabsAtDefault('Course'));
check('Course par défaut : rien de rangé pour les onglets', (await tabsStored('running')) === null);
let advanced = await courseAdvancedRow();
check('Course par défaut : pas d\'onglet « sauts » malgré la capture', advanced.length > 0 && !advanced.includes('sauts'), advanced.join(' | '));

await openCourseSettings();
await evaluate(`${jumpsBox('Course')}.click()`);
await wait(300);
check('case cochée : bouton « sauts » enfoncé', (await tabPressed('Course', 'sauts')) === 'true', await tabPressed('Course', 'sauts'));
let storedTabs = await tabsStored('running');
check('case cochée : l\'onglet écrit en clair, la marque « défaut » retirée', JSON.stringify(storedTabs) === '{"sauts":true}' && !(await tabsAtDefault('Course')), JSON.stringify(storedTabs));
const storedJumps = await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').jumps?.running ?? null`);
check('case cochée : les deux écritures gardées', storedJumps?.enabled === true, JSON.stringify(storedJumps));
advanced = await courseAdvancedRow();
check('case cochée : onglet « sauts » sous « avancé »', advanced.includes('sauts'), advanced.join(' | '));

await openCourseSettings();
const byMouse = await pressesInARow(mouseClick, 'Course', 'sauts', 6);
check('Course : chaque clic de souris change le bouton', alternates(byMouse), byMouse.join(' '));
await mouseClick('Course', 'sauts');
check('Course : bouton relâché, retour au pré-réglage et à la marque « défaut »', (await tabPressed('Course', 'sauts')) === 'false' && (await tabsStored('running')) === null && await tabsAtDefault('Course'));
await mouseClick('Course', 'sauts');
check('Course : bouton enfoncé, sans marque « défaut »', (await tabPressed('Course', 'sauts')) === 'true' && !(await tabsAtDefault('Course')));

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await settle({ max: 800 });
const byTouch = await pressesInARow(tapButton, 'Course', 'sauts', 6);
check('Course à 390 px : chaque toucher change le bouton', alternates(byTouch), byTouch.join(' '));
await shoot('sauts-course-onglets');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await send('Emulation.clearDeviceMetricsOverride');
await settle({ max: 800 });

// Décocher la case garde le choix ; le bouton disparaît ; recocher, déjà montré, n'écrit rien.
await evaluate(`${jumpsBox('Course')}.click()`);
await wait(300);
check('case décochée : bouton disparu, choix gardé', (await tabPressed('Course', 'sauts')) === 'absent' && JSON.stringify(await tabsStored('running')) === '{"sauts":true}', JSON.stringify(await tabsStored('running')));
advanced = await courseAdvancedRow();
check('case décochée : la session garde son onglet', advanced.includes('sauts'), advanced.join(' | '));
await openCourseSettings();
await evaluate(`${jumpsBox('Course')}.click()`);
await wait(300);
check('case recochée, onglet déjà montré : choix inchangé', JSON.stringify(await tabsStored('running')) === '{"sauts":true}', JSON.stringify(await tabsStored('running')));
// L'onglet se décoche seul, la case cochée : le choix est respecté.
await mouseClick('Course', 'sauts');
advanced = await courseAdvancedRow();
check('case cochée, onglet décoché : pas d\'onglet', !advanced.includes('sauts'), advanced.join(' | '));

// VTT : même défaut, sur « tops ».
await go('/parametres', 4000);
await openCard('VTT');
await wait(500);
check('VTT par défaut : « tops » relâché, « sauts » enfoncé, marque « défaut »', (await tabPressed('VTT', 'tops')) === 'false' && (await tabPressed('VTT', 'sauts')) === 'true' && await tabsAtDefault('VTT'));
const vttTops = await pressesInARow(mouseClick, 'VTT', 'tops', 4);
check('VTT : chaque clic change « tops »', alternates(vttTops), vttTops.join(' '));
check('VTT : retour au pré-réglage et à la marque « défaut »', (await tabsStored('a-vtt')) === null && await tabsAtDefault('VTT'));
await evaluate(`${jumpsBox('VTT')}.click()`);
await wait(200);
await evaluate(`${jumpsBox('VTT')}.click()`);
await wait(200);
check('VTT : case décochée puis recochée, « sauts » déjà montré, rien d\'écrit aux onglets', (await tabsStored('a-vtt')) === null, JSON.stringify(await tabsStored('a-vtt')));

await go('/course', 4000);
await evaluate(`(async () => {
  const { removeSession } = await import('/src/hooks/useSessionLibrary.ts');
  await removeSession(${JSON.stringify(courseGpx ?? '')});
})()`);

console.log('--- console (erreurs, avertissements) ---');
for (const line of logs) console.log(line);
await close();
process.exit(0);
