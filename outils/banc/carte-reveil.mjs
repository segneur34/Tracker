// Banc de test : le fond de carte revient seul après un déverrouillage (cases de tuiles restées vides, `BaseTileLayer`).
// Usage : node carte-reveil.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau ; tuiles fausses (`lib/tuiles.mjs`), dont `setMode` simule la panne et le 404. Environ
// 3 min en temps réel : les reprises attendent 3, 12 et 30 s de vrai temps de page (le script n'est pas `accelerable`).
// Le script importe une course, ouvre son analyse, puis, à chaque passage, déplace la carte vers des cases jamais vues
// (`panBy`, sans animation) pendant que les tuiles sont coupées : elles restent vides, Leaflet les croit chargées.
//  1. Veille, réseau rendu pendant : page cachée, signaux `online` et `moveend` (rien ne part), page gelée (cachée et
//     JavaScript suspendu par le débogueur, comme un écran éteint, voir `carte-direct.mjs`), réseau rendu, page rendue,
//     sans toucher : zéro case manquante, seules les manquantes redemandées, chacune une fois, rien pendant la veille,
//     cases déjà chargées inchangées (ni image changée, ni case retirée, ni fondu : pas de clignotement).
//  2. Retour sans réseau : trois reprises, pas une de plus ; puis `online` : le fond revient, cases chargées inchangées.
//  3. Déplacements : `moveend` ne reprend pas une case essayée il y a moins d'une minute ; l'horloge de la page
//     avancée d'une minute, une seule reprise, quel que soit le nombre de déplacements.
//  4. Carte sans taille : rien ne part, même une fois l'attente échue.
//  5. Tuiles absentes (404) : ni retour au premier plan ni déplacement ne les redemandent.
// La sortie standard ne porte que les contrôles ; les comptes, qui varient avec la taille de la carte, sont sur la
// sortie d'erreur (`diag`). Le saut d'horloge (`Date.now` décalé dans la page) évite une minute d'attente par passage.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, diag, vwait } from './lib/cdp.mjs';
import { BLOCKED_EXCEPT_TILES, fakeTiles } from './lib/tuiles.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node carte-reveil.mjs <port> <dossier de travail>');
  process.exit(1);
}

const b = await connect({ port, width: 1200, height: 900 });
const { send, evaluate, go, settle, waitFor, blockNetwork, importFiles, records, check, finish, logs } = b;
const tiles = await fakeTiles(b);

// Crochet des cartes de Leaflet, comme `carte-perf.mjs` : chaque carte créée est gardée dans `window.__cartes`.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (() => {
    let stored;
    window.__cartes = [];
    Object.defineProperty(window, 'L', {
      configurable: true,
      get: () => stored,
      set: (value) => {
        stored = value;
        if (value && value.Map && !value.__crochetBanc) {
          value.__crochetBanc = true;
          value.Map.addInitHook(function () { window.__cartes.push(this); });
        }
      },
    });
  })();
` });
await blockNetwork(BLOCKED_EXCEPT_TILES);

// --- Trace : une course d'une demi-heure vers l'est, autour de Montpellier ---
const POINTS = 1800;
const t0 = Date.UTC(2026, 9, 1, 7, 0, 0);
const run = [];
for (let k = 0; k < POINTS; k++) {
  run.push(`<trkpt lat="${(43.62 + k * 2e-6).toFixed(7)}" lon="${(3.86 + k * 4e-5).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const runPath = join(workDir, 'carte-reveil.gpx');
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course</name><type>running</type><trkseg>\n${run.join('\n')}\n</trkseg></trk></gpx>\n`);

const listSessions = () => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  dir = await dir.getDirectoryHandle('sessions');
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);

const MAP = `(window.__cartes ?? []).filter((m) => m._container?.isConnected && m._container.closest('.an-map-frame')).at(-1)`;

/** Cases de la carte visibles dans son cadre : vides, agrandies (URL de données), vraies, en cours de chargement. */
const probe = () => evaluate(`(() => {
  const map = ${MAP};
  if (!map) return null;
  const box = map.getContainer().getBoundingClientRect();
  const shown = [...map.getContainer().querySelectorAll('img.leaflet-tile')].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
  });
  const loading = shown.filter((img) => !img.complete).length;
  const empty = shown.filter((img) => img.complete && img.naturalWidth === 0).length;
  const enlarged = shown.filter((img) => img.complete && img.naturalWidth > 0 && (img.getAttribute('src') ?? '').startsWith('data:')).length;
  return { total: shown.length, loading, empty, enlarged, real: shown.length - loading - empty - enlarged };
})()`);
const missingOf = (p) => (p ? p.empty + p.enlarged + p.loading : -1);
const show = (p) => (p ? `${p.total} cases : ${p.real} vraies, ${p.empty} vides, ${p.enlarged} agrandies, ${p.loading} en route` : 'carte absente');

/** Déplace la carte de 60 % de sa largeur vers l'est : des cases jamais vues. */
const panToNewTiles = () => evaluate(`(() => { const map = ${MAP}; map.panBy([Math.round(map.getSize().x * 0.6), 0], { animate: false }); return 'ok'; })()`);
const fireMoveEnd = () => evaluate(`(() => { ${MAP}.fire('moveend'); return 'ok'; })()`);
const fireOnline = () => evaluate(`(() => { window.dispatchEvent(new Event('online')); return 'ok'; })()`);
/** Avance l'horloge de la page (`Date.now`) sans attendre. */
const jumpClock = (ms) => evaluate(`(() => {
  window.__bancDecalage = (window.__bancDecalage ?? 0) + ${Number(ms)};
  if (!window.__bancHorlogeReelle) {
    const real = Date.now.bind(Date);
    window.__bancHorlogeReelle = real;
    Date.now = () => real() + window.__bancDecalage;
  }
  return 'ok';
})()`);

/**
 * Marque les vraies cases visibles, et compte dès lors ce qui leur arrive : image changée, case retirée, opacité
 * retombée (un fondu rejoué). Rend le nombre de cases marquées.
 */
const watchLoaded = () => evaluate(`(() => {
  const map = ${MAP};
  const box = map.getContainer().getBoundingClientRect();
  window.__bancGardees = { src: 0, removed: 0, faded: 0 };
  window.__bancObservateur?.disconnect();
  let marked = 0;
  for (const img of map.getContainer().querySelectorAll('img.leaflet-tile')) {
    const r = img.getBoundingClientRect();
    const visible = r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
    delete img.dataset.bancGardee;
    if (visible && img.complete && img.naturalWidth > 0) {
      img.dataset.bancGardee = '1';
      marked++;
    }
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) if (node.dataset?.bancGardee) window.__bancGardees.removed++;
      if (record.type !== 'attributes' || !record.target.dataset?.bancGardee) continue;
      if (record.attributeName === 'src') window.__bancGardees.src++;
      else if (Number(record.target.style.opacity || 1) < 1) window.__bancGardees.faded++;
    }
  });
  observer.observe(map.getPane('tilePane'), { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style'] });
  window.__bancObservateur = observer;
  return marked;
})()`);
const loadedChanges = () => evaluate(`window.__bancGardees`);
const checkLoadedUnchanged = async (pass, marked) => {
  const changes = await loadedChanges();
  check(`${pass} : des cases étaient déjà chargées`, marked > 0, marked);
  check(`${pass} : cases déjà chargées inchangées, sans clignotement`, changes?.src === 0 && changes?.removed === 0 && changes?.faded === 0, JSON.stringify(changes));
};

// --- Page cachée : les mêmes gestes que `carte-direct.mjs` ---
const hide = () => evaluate(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; })()`);
const unhide = () => evaluate(`(() => { delete document.visibilityState; delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; })()`);
/** Écran éteint : la page déjà cachée, JavaScript suspendu (les minuteries attendent le réveil). */
const suspend = async () => {
  await send('Debugger.enable');
  await send('Debugger.pause');
};
const resume = async () => {
  await send('Debugger.resume');
  await send('Debugger.disable');
};

/** Coupe les tuiles selon `mode`, déplace la carte, attend les réponses : rend le relevé et les tuiles demandées. */
const failNewTiles = async (mode, pass) => {
  tiles.setMode(mode);
  tiles.reset();
  check(`${pass} : carte déplacée`, (await panToNewTiles()) === 'ok');
  await settle({ max: 3000, label: 'cases en échec' });
  await vwait(500);
  const asked = tiles.list();
  const state = await probe();
  diag(`${pass} : ${asked.length} tuiles demandées en échec ; ${show(state)}`);
  check(`${pass} : des cases neuves sont restées manquantes`, state && state.empty + state.enlarged > 0, show(state));
  return { asked: new Set(asked), missing: state ? state.empty + state.enlarged : 0 };
};

// --- Ouverture ---
await go('/course');
check('import', (await importFiles(runPath, 'input[type=file][accept*=".gpx"][multiple]:not([disabled])')) === 'ok');
const runName = await waitFor(async () => (await listSessions())?.find((n) => n.endsWith('.gpx')), { timeout: 20000, label: 'fiche course' });
await waitFor(async () => (await records()).length > 0, { timeout: 30000, label: 'fiche JSON' });
await settle({ max: 3000, label: 'import' });
await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 20000);
const opened = await waitFor(async () => {
  const p = await probe();
  return p && p.total > 0 && p.real === p.total ? p : null;
}, { timeout: 20000, label: 'carte chargée' });
check('carte chargée, toutes ses cases pleines', Boolean(opened), show(await probe()));
diag(`ouverture : ${show(opened)}`);
await settle({ max: 3000, label: 'analyse' });

// 1. Veille pendant laquelle le réseau revient.
{
  const pass = '1. veille';
  const { asked, missing } = await failNewTiles('panne', pass);
  const marked = await watchLoaded();
  tiles.reset();
  // Page cachée, JavaScript vivant (l'enregistrement tourne) : les signaux n'y font rien, l'attente de la minute échue.
  check(`${pass} : page cachée`, (await hide()) === 'hidden');
  await jumpClock(61_000);
  await fireOnline();
  await fireMoveEnd();
  await vwait(12_000);
  check(`${pass} : page cachée, aucune requête malgré « online » et un déplacement`, tiles.stats().requests === 0, tiles.stats().requests);
  // Écran éteint : JavaScript suspendu ; le réseau revient pendant.
  await suspend();
  tiles.setMode('normal');
  await vwait(5000);
  check(`${pass} : aucune requête pendant la veille`, tiles.stats().requests === 0, tiles.stats().requests);
  await resume();
  const startMs = Date.now();
  check(`${pass} : page rendue`, (await unhide()) === 'visible');
  const back = await waitFor(async () => missingOf(await probe()) === 0, { timeout: 14_000, every: 200, label: 'fond revenu' });
  const backMs = Date.now() - startMs;
  diag(`${pass} : fond revenu en ${backMs} ms ; ${show(await probe())}`);
  check(`${pass} : zéro case manquante au retour, sans toucher`, back === true, show(await probe()));
  check(`${pass} : revenu dès la première reprise`, backMs < 9000, backMs);
  // Laisse passer les reprises suivantes : elles n'ont plus rien à faire.
  await vwait(Math.max(0, 32_000 - backMs));
  const list = tiles.list();
  diag(`${pass} : ${list.length} requêtes au retour, ${missing} cases manquantes`);
  check(`${pass} : seules les manquantes redemandées`, list.every((t) => asked.has(t)), list.filter((t) => !asked.has(t)).join(', '));
  check(`${pass} : chacune une seule fois`, list.length === missing && new Set(list).size === list.length, `${list.length} requêtes pour ${missing} cases`);
  await checkLoadedUnchanged(pass, marked);
}

// 2. Retour au premier plan alors que le réseau dort encore, puis retour du réseau.
{
  const pass = '2. retour sans réseau';
  const { missing } = await failNewTiles('panne', pass);
  const marked = await watchLoaded();
  tiles.reset();
  await hide();
  await vwait(2500);
  check(`${pass} : page rendue`, (await unhide()) === 'visible');
  await vwait(40_000);
  const { requests } = tiles.stats();
  diag(`${pass} : ${requests} requêtes en 40 s pour ${missing} cases`);
  check(`${pass} : trois reprises, pas une de plus`, requests === 3 * missing, `${requests} requêtes pour ${missing} cases`);
  tiles.setMode('normal');
  await fireOnline();
  const back = await waitFor(async () => missingOf(await probe()) === 0, { timeout: 8000, every: 200, label: 'fond revenu' });
  check(`${pass} : le fond revient au retour du réseau`, back === true, show(await probe()));
  // Les reprises de ce retour du réseau finies : elles fausseraient le passage suivant.
  await vwait(31_000);
  await checkLoadedUnchanged(pass, marked);
}

// 3. Une reprise par minute au plus, au déplacement.
{
  const pass = '3. déplacements';
  const { missing } = await failNewTiles('panne', pass);
  tiles.reset();
  for (let k = 0; k < 3; k++) await fireMoveEnd();
  await vwait(500);
  check(`${pass} : aucune reprise avant la minute`, tiles.stats().requests === 0, tiles.stats().requests);
  await jumpClock(61_000);
  for (let k = 0; k < 3; k++) await fireMoveEnd();
  await settle({ max: 2000, label: 'reprise' });
  const { requests } = tiles.stats();
  diag(`${pass} : ${requests} requêtes pour ${missing} cases`);
  check(`${pass} : la minute passée, une reprise par case`, requests === missing, `${requests} requêtes pour ${missing} cases`);
  tiles.setMode('normal');
  await jumpClock(61_000);
  await fireMoveEnd();
  const back = await waitFor(async () => missingOf(await probe()) === 0, { timeout: 5000, every: 200, label: 'fond revenu' });
  check(`${pass} : le réseau revenu, le déplacement suivant rend le fond`, back === true, show(await probe()));
}

// 4. Carte sans taille.
{
  const pass = '4. carte sans taille';
  await failNewTiles('panne', pass);
  tiles.reset();
  await evaluate(`(() => { ${MAP}.getContainer().style.display = 'none'; return 'ok'; })()`);
  await jumpClock(61_000);
  await fireMoveEnd();
  await settle({ max: 1000, label: 'carte cachée' });
  check(`${pass} : rien ne part`, tiles.stats().requests === 0, tiles.stats().requests);
  await evaluate(`(() => { ${MAP}.getContainer().style.display = ''; return 'ok'; })()`);
  tiles.setMode('normal');
  await jumpClock(61_000);
  await fireMoveEnd();
  await settle({ max: 2000, label: 'carte rendue' });
  check(`${pass} : rendue, elle reprend ses cases`, tiles.stats().requests > 0, tiles.stats().requests);
}

// 5. Tuiles que le serveur n'a pas.
{
  const pass = '5. tuiles absentes';
  await failNewTiles('absent', pass);
  tiles.setMode('normal');
  tiles.reset();
  await hide();
  await vwait(1500);
  await unhide();
  await vwait(31_000);
  await jumpClock(61_000);
  await fireMoveEnd();
  await settle({ max: 2000, label: 'reprise' });
  check(`${pass} : jamais redemandées`, tiles.stats().requests === 0, tiles.stats().requests);
}

console.log('--- console ---');
for (const l of logs) console.log(l);
await finish();
