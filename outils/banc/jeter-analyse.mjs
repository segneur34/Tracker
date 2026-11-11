// Banc de test : « Jeter la session » du menu « … » des analyses (lot 212, 11/11).
// Usage : node jeter-analyse.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min 30. Le script importe une session par famille (voile, course,
// vélo, surf, fractionné ; la musculation n'a pas de GPX à importer, elle passe par la même pièce commune) et, pour
// chacune, ouvre son analyse puis vérifie :
//  1. « Jeter la session » est la dernière entrée du menu « … », après un séparateur, en bouton de danger ;
//  2. un appui court ne supprime rien : le menu reste ouvert, le bouton rappelle « Maintenir 1 s pour jeter », aucune
//     fenêtre, la fiche est toujours là ;
//  3. un appui long d'une seconde ouvre la confirmation (« Jeter cette session ? », « sans retour possible ») ;
//  4. « Garder » ferme la fenêtre : même adresse, même fiche ;
//  5. un nouvel appui long puis « Jeter définitivement » ramène à la bibliothèque de la famille, la fiche a disparu,
//     aucune alerte de brouillon (`window.confirm` jamais appelé), l'entrée d'historique est remplacée
//     (`history.length` inchangé) ;
//  6. pour la course, avec un brouillon non enregistré (conditions saisies dans « matos et conditions ») : même
//     chemin, sans alerte de brouillon (l'historique n'est pas comparé : la garde du navigateur y ajoute une entrée).
// Un appui est simulé par des `pointerdown` / `pointerup` posés sur le bouton, comme les scripts d'« Arrêter ».
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node jeter-analyse.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, clickText, check, finish, shoot } = await connect({ port, width: 1400, height: 1000, shotDir });

// Rangée « avancé » des analyses ouverte d'office (`lib/onglets.mjs`).
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

// --- Sessions ---
/** Trace droite à vitesse constante, 15 min à 1 Hz ; `type` est lu par l'import. */
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
const voilePath = join(tmpdir(), 'jeter-voile.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), voilePath]);
const SESSIONS = [
  { famille: 'voile', start: Date.UTC(2026, 8, 20, 13, 0, 0), gpx: readFileSync(voilePath, 'utf8') },
  { famille: 'course', start: Date.UTC(2026, 9, 1, 8, 0, 0), gpx: lineGpx('running', 2.8, Date.UTC(2026, 9, 1, 8, 0, 0)), brouillon: true },
  { famille: 'velo', start: Date.UTC(2026, 9, 2, 8, 0, 0), gpx: lineGpx('cycling', 7, Date.UTC(2026, 9, 2, 8, 0, 0)) },
  { famille: 'surf', start: Date.UTC(2026, 9, 3, 8, 0, 0), gpx: lineGpx('surf', 3, Date.UTC(2026, 9, 3, 8, 0, 0)) },
  { famille: 'fractionne', start: Date.UTC(2026, 9, 4, 8, 0, 0), gpx: lineGpx('run-intervals', 3, Date.UTC(2026, 9, 4, 8, 0, 0)) },
];

const findRecord = async (start) => (await records())?.find((r) => Math.abs((r.summary?.startMs ?? 0) - start) < 2000);

for (const s of SESSIONS) {
  await go(`/${s.famille}`, 3000);
  console.log(`import ${s.famille} :`, await importGpx(s.gpx, `${s.famille}.gpx`));
  const rec = await waitFor(() => findRecord(s.start), { timeout: 8000, label: `fiche ${s.famille}` });
  await settle({ max: 2000, label: `import ${s.famille}` });
  s.file = rec?.gpx ?? '';
  s.analyse = `/${s.famille}/analyse?session=${encodeURIComponent(s.file)}`;
  check(`${s.famille} : session rangée`, Boolean(rec));
}

// --- Outils ---
const MENU = '.an-sheet__head .ui-more';
const menuItems = () => evaluate(`[...document.querySelectorAll('${MENU}__panel button')].map((x) => x.textContent.trim())`);
const menuOpen = () => evaluate(`document.querySelector('${MENU}__button')?.getAttribute('aria-expanded') === 'true'`);
const openMenu = async () => {
  if (await menuOpen()) return;
  await evaluate(`document.querySelector('${MENU}__button')?.click()`);
  await wait(200);
};
const jeterButton = `[...document.querySelectorAll('${MENU}__panel button')].find((x) => x.textContent.includes('Jeter la session') || x.textContent.includes('pour jeter'))`;
/** Appui de `ms` sur « Jeter la session », relâché puis cliqué comme le fait le navigateur. */
const press = async (ms) => {
  const down = await evaluate(`(() => { const b = ${jeterButton}; if (!b) return 'absent'; window.__jeter = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', pointerId: 7 })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(ms);
  return evaluate(`(() => { const b = window.__jeter; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse', pointerId: 7 })); b.click(); return 'ok'; })()`);
};
const dialog = () => evaluate(`(() => { const d = document.querySelector('[role=dialog]'); return d ? d.innerText.replace(/\\s+/g, ' ').trim() : null; })()`);
/** Pose un `confirm` qui note ses appels (l'alerte de brouillon) et dit oui. */
const spyConfirm = () => evaluate(`(() => { window.__confirms = []; window.confirm = (m) => { window.__confirms.push(m); return true; }; return 'ok'; })()`);
const confirms = () => evaluate(`window.__confirms ?? null`);
const where = () => evaluate(`location.pathname + location.search`);
const setConditions = (value) => evaluate(`(() => {
  const i = document.querySelector('textarea[aria-label="Conditions"]');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return i.value;
})()`);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true') t.click(); return 'ok'; })()`);

// --- Une famille après l'autre ---
for (const s of SESSIONS) {
  const f = s.famille;
  console.log(`\n--- ${f} ---`);
  await go(s.analyse, 6000);
  await spyConfirm();
  check(`${f} : l'analyse est ouverte`, (await where()) === s.analyse, await where());

  if (s.brouillon) {
    // Un brouillon non enregistré : c'est lui qui, sans l'abandon, lèverait l'alerte en quittant la page.
    console.log('onglet matériel :', await openTab('matos et conditions'), await openTab('matériel et notes'));
    await wait(500);
    console.log('conditions :', await setConditions('Brouillon du banc'));
    await wait(500);
    check(`${f} : brouillon posé`, /Non enregistr/.test(await evaluate(`document.body.innerText`)));
  }

  // 1. L'entrée, en dernier, séparée, en danger.
  await openMenu();
  const items = await menuItems();
  console.log('menu :', items.join(' | '));
  check(`${f} : « Jeter la session » est la dernière entrée du menu`, items.at(-1) === 'Jeter la session', items.at(-1));
  check(`${f} : séparateur juste avant`, await evaluate(`(() => { const b = ${jeterButton}; const sep = b?.closest('.ui-more__keep')?.previousElementSibling; return sep?.classList.contains('ui-more__sep') === true; })()`));
  check(`${f} : bouton de danger`, await evaluate(`${jeterButton}?.classList.contains('ui-btn--danger') === true`));
  await shoot(`jeter-${f}-menu`);

  // 2. Appui court : rien ne part.
  console.log('appui court :', await press(150));
  await wait(300);
  check(`${f} : appui court, aucune fenêtre`, (await dialog()) === null, await dialog());
  check(`${f} : appui court, le menu reste ouvert`, await menuOpen());
  check(`${f} : appui court, rappel du geste`, (await menuItems()).some((t) => t.includes('Maintenir 1 s pour jeter')), (await menuItems()).at(-1));
  check(`${f} : appui court, la fiche est toujours là`, Boolean(await findRecord(s.start)));

  // 3. Appui long d'une seconde : la confirmation.
  await wait(3200); // le rappel s'efface
  console.log('appui long :', await press(1300));
  const asked = await waitFor(() => dialog(), { timeout: 3000, label: 'confirmation' });
  check(`${f} : appui long, la confirmation s'ouvre`, Boolean(asked) && asked.includes('Jeter cette session ?'), asked);
  check(`${f} : texte de la confirmation`, Boolean(asked) && asked.includes('Son fichier, sa fiche et ses mesures de capteurs seront supprimés de la mémoire, sans retour possible.'), asked);
  await shoot(`jeter-${f}-confirmation`);

  // 4. « Garder ».
  console.log('Garder :', await clickText('Garder', '[role=dialog] button'));
  await wait(400);
  check(`${f} : « Garder » ferme la fenêtre`, (await dialog()) === null);
  check(`${f} : « Garder » laisse la page et la fiche`, (await where()) === s.analyse && Boolean(await findRecord(s.start)), await where());

  // 5. « Jeter définitivement ».
  await openMenu();
  const historyBefore = await evaluate(`history.length`);
  console.log('appui long :', await press(1300));
  await waitFor(() => dialog(), { timeout: 3000, label: 'confirmation 2' });
  console.log('Jeter définitivement :', await clickText('Jeter définitivement', '[role=dialog] button'));
  const arrived = await waitFor(async () => (await where()) === `/${f}`, { timeout: 8000, label: 'retour à la bibliothèque' });
  check(`${f} : retour à la bibliothèque de la famille`, Boolean(arrived), await where());
  await wait(800);
  check(`${f} : la fiche a disparu de la mémoire`, !(await findRecord(s.start)));
  check(`${f} : aucune alerte de brouillon`, JSON.stringify(await confirms()) === '[]', JSON.stringify(await confirms()));
  if (!s.brouillon) {
    const historyAfter = await evaluate(`history.length`);
    check(`${f} : l'entrée d'historique est remplacée`, historyAfter === historyBefore, `${historyBefore} puis ${historyAfter}`);
  }
  await shoot(`jeter-${f}-apres`);
}

await finish('Tout passe.');
