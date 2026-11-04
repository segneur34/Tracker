// Banc de test : la carte du direct pendant un enregistrement à pied (lot 104, carte figée en pause manuelle).
// Usage : node carte-direct.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau, environ 8 min en temps réel, 1 min avec `TEMPS=10` (horloge de la page accélérée).
// Deux passages en rejeu ×1 d'une course à 3 m/s vers l'est, 1 Hz, vitesse du capteur sur chaque point, chacun fini
// par l'arrêt tenu puis « Jeter » :
//  1. pause manuelle (« Pause » de la page) de 60 à 90 s pendant laquelle le rejeu avance (le coureur continue, le
//     GPS reste allumé), puis « Reprendre » : la flèche suit pendant la pause, sans trace dessinée ni distance qui
//     monte, et après la reprise aucun trait entre le point de la pause et celui de la reprise, ni passager (relevés
//     serrés juste après la reprise) ni durable ;
//  2. deux trous de position (60 à 86 s, 250 à 265 s) pendant lesquels la page est cachée (le premier par
//     `visibilityState` forcé et `visibilitychange`, le second cachée et son JavaScript suspendu par le débogueur,
//     comme un écran éteint : au réveil, le rejeu rend d'un coup ce qui est échu ; `Page.setWebLifecycleState`
//     ne convient pas, le Chrome sans fenêtre jette la page gelée et en recharge une autre), et une immobilité de
//     150 à 195 s (pause automatique du pré-réglage de la course, 0,5 km/h sur 20 s).
// La course n'a pas de « Moyenne active » (lot 150 : voile et surf seulement).
// Toutes les 2 s de page, un relevé : « Points » de la partie GPS (les positions arrivent), distance de la carte « En
// cours », déplacement de la carte (`.leaflet-map-pane`), place de la flèche dans la carte, longueur des tracés de la
// trace (leur `d` : Leaflet réduit une ligne droite à ses deux bouts), « Recentrer », bandeau de pause automatique. Une phase dit « figée » sur trois relevés de suite où les points
// montent d'au moins 4, pause exclue, et la carte immobile, le tracé ou la distance immobiles. Relevés détaillés sur la
// sortie d'erreur (ils varient d'un passage à l'autre) ; la sortie standard ne porte que les contrôles.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, diag, TEMPS } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node carte-direct.mjs <port> <dossier de travail>');
  process.exit(1);
}

const { send, evaluate, go, settle, waitFor, vwait, blockNetwork, importFiles, clickText, check, finish, logs } =
  await connect({ port, width: 1400, height: 1000, logEntries: true });
await blockNetwork();

// --- Traces ---
const SPEED_MS = 3;
const t0 = Date.parse('2026-01-15T09:00:00Z');
const lat = 43.7;
const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
/** Course de `endS` s : immobile sur `still` (secondes, bornes [a, b]), sans point dans les trous `holes`. */
const writeTrack = (name, endS, { still = null, holes = [] } = {}) => {
  const pts = [];
  let meters = 0;
  for (let k = 0; k <= endS; k++) {
    const isStill = still !== null && k > still[0] && k <= still[1];
    if (k > 0 && !isStill) meters += SPEED_MS;
    if (holes.some(([a, b]) => k > a && k < b)) continue;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 1000).toISOString()}</time>`
      + `<extensions><speed>${isStill ? 0 : SPEED_MS}</speed></extensions></trkpt>`);
  }
  const path = join(workDir, name);
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  return { path, count: pts.length };
};
const PAUSE = [60, 90];
const PAUSE_END_S = 150;
const pauseTrack = writeTrack('carte-direct-pause.gpx', PAUSE_END_S);
const HOLE_1 = [60, 86];
const STILL = [150, 195];
const HOLE_2 = [250, 265];
const HOLES_END_S = 300;
const holesTrack = writeTrack('carte-direct-trous.gpx', HOLES_END_S, { still: STILL, holes: [HOLE_1, HOLE_2] });
console.log(`traces : ${pauseTrack.count} points sans trou ; ${holesTrack.count} points, trous de ${HOLE_1[1] - HOLE_1[0]} s et ${HOLE_2[1] - HOLE_2[0]} s`);

// --- Relevés ---
const COLOR = '#d11a1a';
/**
 * Relevé de la page ; avec `gap` ({ from, to } : places de la flèche, en points du calque de la carte, au point de
 * la pause et à celui de la reprise), le nombre d'endroits des tracés de la trace tombés dans le trou entre les deux.
 */
const probe = (gap = null) => `(() => {
  const value = (label) => {
    const s = [...document.querySelectorAll('span.num')].find((v) => v.previousElementSibling?.textContent.trim() === label);
    return s ? s.textContent.trim() : null;
  };
  const container = document.querySelector('.leaflet-container');
  const out = {
    points: Number(value('Points') ?? NaN),
    distance: value('Distance'),
    pause: document.body.innerText.includes('En pause automatique'),
    manual: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Reprendre'),
    recentrer: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Recentrer'),
    map: Boolean(container),
    pane: null, at: null, marker: null, track: '', paths: 0, inGap: null,
    visible: document.visibilityState,
  };
  if (!container) return out;
  out.pane = document.querySelector('.leaflet-map-pane')?.style.transform ?? null;
  // Place de la flèche (ou du rond), en points du calque : la même mesure que les tracés.
  const arrow = container.querySelector('.live-arrow')?.parentElement;
  const dot = [...container.querySelectorAll('path')].find((p) => p.getAttribute('stroke') === '#ffffff' && p.getAttribute('fill') === '${COLOR}');
  if (arrow) {
    const m = /translate3d\\((-?[\\d.]+)px, (-?[\\d.]+)px/.exec(arrow.style.transform);
    if (m) { out.marker = 'flèche'; out.at = { x: Number(m[1]), y: Number(m[2]) }; }
  } else if (dot) {
    const m = /M(-?[\\d.]+),(-?[\\d.]+)/.exec(dot.getAttribute('d') ?? '');
    if (m) { out.marker = 'rond'; out.at = { x: Number(m[1]) + 8, y: Number(m[2]) }; }
  }
  const paths = [...container.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '${COLOR}');
  out.paths = paths.length;
  out.track = paths.map((p) => p.getAttribute('d') ?? '').join(' ');
  const gap = ${JSON.stringify(gap)};
  if (gap) {
    // Le trou : entre les deux places, à 8 px de chacune, à 6 px de part et d'autre de la ligne qui les joint.
    const [a, b] = [gap.from, gap.to];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let hits = 0;
    for (const p of paths) {
      const total = p.getTotalLength();
      for (let l = 0; l <= total; l += 2) {
        const q = p.getPointAtLength(l);
        const along = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / len;
        const across = Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / len;
        if (along > 8 && along < len - 8 && across < 6) hits++;
      }
    }
    out.inGap = hits;
  }
  return out;
})()`;

let samples = [];
let startedAt = 0;
const pageSeconds = () => ((Date.now() - startedAt) * TEMPS) / 1000;
/** Relève toutes les `everyMs` de page jusqu'à l'instant `untilS` (depuis le départ), sous la phase `phase`. */
const sampleUntil = async (phase, untilS, { everyMs = 2000, gap = null } = {}) => {
  while (pageSeconds() < untilS) {
    const s = await evaluate(probe(gap));
    if (s) samples.push({ phase, t: Math.round(pageSeconds() * 10) / 10, ...s });
    await vwait(everyMs);
  }
};
/** Attend l'instant `untilS` de page sans relever. */
const waitUntil = async (untilS) => {
  const left = untilS - pageSeconds();
  if (left > 0) await vwait(left * 1000);
};

/**
 * Verdict d'une phase : sur chaque fenêtre de trois relevés de suite où les points montent d'au moins 4, sans pause
 * ni carte absente, la carte doit bouger (suivi) et le tracé s'allonger ; la distance, affichée à 10 m près et
 * recalculée toutes les 2 s, doit monter sur cinq relevés de suite (8 points de plus au moins).
 */
const verdict = (phase) => {
  const list = samples.filter((s) => s.phase === phase);
  const windows = [];
  for (let i = 0; i + 2 < list.length; i++) {
    const trio = list.slice(i, i + 3);
    const [a, c] = [trio[0], trio[2]];
    if (!(c.points - a.points >= 4) || trio.some((s) => s.pause || s.manual || !s.map)) continue;
    const e = list[i + 4];
    const counted = !e || e.points - a.points < 8 || [list[i + 3], e].some((s) => s.pause || s.manual) || a.distance !== e.distance;
    windows.push({ a, c, moved: a.pane !== c.pane, drawn: a.track !== c.track, counted });
  }
  const at = (w) => `${Math.round(w.a.t)}-${Math.round(w.c.t)} s`;
  return {
    windows: windows.length,
    stuckMap: windows.filter((w) => !w.moved).map(at),
    stuckTrack: windows.filter((w) => !w.drawn).map(at),
    stuckFigures: windows.filter((w) => !w.counted).map(at),
  };
};
const report = (pass, phase) => {
  const v = verdict(phase);
  const label = `${pass}, ${phase}`;
  check(`${label} : des positions arrivent`, v.windows > 0, 'aucune fenêtre de 3 relevés avec 4 points de plus');
  if (v.windows === 0) return;
  check(`${label} : la carte suit la position`, v.stuckMap.length === 0, `figée sur ${v.stuckMap.join(', ')}`);
  check(`${label} : le tracé s'allonge`, v.stuckTrack.length === 0, `figé sur ${v.stuckTrack.join(', ')}`);
  check(`${label} : la distance monte`, v.stuckFigures.length === 0, `figée sur ${v.stuckFigures.join(', ')}`);
};
const dumpSamples = (pass) => {
  for (const s of samples) {
    diag(`${pass} ${String(s.t).padStart(5)} s ${s.phase.padEnd(14)} pts ${String(s.points).padStart(3)} dist ${s.distance ?? '—'} `
      + `${s.map ? `${s.marker ?? 'sans repère'} ${s.at ? `${s.at.x},${s.at.y}` : '—'} tracés ${s.paths} (${s.track.length} car.)`
        + `${s.inGap !== null ? ` dans le trou ${s.inGap}` : ''} carte ${s.pane}` : 'carte absente'}`
      + `${s.recentrer ? ' [Recentrer]' : ''}${s.pause ? ' [pause auto]' : ''}${s.manual ? ' [pause]' : ''} ${s.visible}`);
  }
};

// --- Page cachée ---
const hide = () => evaluate(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; })()`);
const show = () => evaluate(`(() => { delete document.visibilityState; delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; })()`);
/** Écran éteint : page cachée, JavaScript suspendu (les minuteries attendent le réveil). */
const sleep = async () => {
  await hide();
  await send('Debugger.enable');
  await send('Debugger.pause');
};
const wake = async () => {
  await send('Debugger.resume');
  await send('Debugger.disable');
  return show();
};

// --- Un passage ---
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await vwait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};

const startReplay = async (track) => {
  await go('/enregistrer', 6000);
  await clickText('À pied');
  await vwait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await vwait(300);
  await importFiles(track.path);
  const loaded = await waitFor(`document.body.innerText.includes('${track.count} points')`, { timeout: 5000, label: 'rejeu chargé' });
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  const started = await clickText('Démarrer');
  startedAt = Date.now();
  samples = [];
  return Boolean(loaded) && started === 'ok';
};

const endReplay = async (pass) => {
  dumpSamples(pass);
  const stop = await holdStop();
  await settle({ max: 3000 });
  const thrown = await clickText('Jeter');
  await settle({ max: 2000 });
  check(`${pass} : arrêt tenu puis « Jeter »`, stop === 'ok' && thrown === 'ok', `${stop} / ${thrown}`);
};

// 1. Pause manuelle pendant laquelle le coureur avance.
{
  const pass = '1. pause manuelle';
  check(`${pass} : rejeu lancé`, await startReplay(pauseTrack));
  check(`${pass} : course, pas de « Moyenne active »`, !(await evaluate(`document.body.innerText.includes('Moyenne active')`)));
  await sampleUntil('avant pause', PAUSE[0]);
  check(`${pass} : « Pause »`, (await clickText('Pause')) === 'ok');
  // Le dernier calcul du direct, différé, peut suivre la pause de 2 s.
  await vwait(2500);
  await sampleUntil('pause', PAUSE[1]);
  const inPause = samples.filter((s) => s.phase === 'pause' && s.manual);
  const from = inPause[0]?.at ?? null;
  check(`${pass} : la distance reste figée pendant la pause`, inPause.length > 3 && inPause.every((s) => s.distance === inPause[0].distance),
    `${inPause.length} relevés, ${new Set(inPause.map((s) => s.distance)).size} distances`);
  check(`${pass} : la flèche suit la position pendant la pause`, inPause.length > 3 && (inPause.at(-1).pane !== inPause[0].pane
    || inPause.at(-1).at?.x !== from?.x), `flèche ${inPause.at(-1)?.at?.x === from?.x ? 'immobile' : 'déplacée'}, carte ${inPause.at(-1)?.pane === inPause[0]?.pane ? 'immobile' : 'déplacée'}`);
  diag(`${pass} : flèche à ${from?.x} au début de la pause, à ${inPause.at(-1)?.at?.x} à la fin`);
  // Fin de la pause : rien de dessiné entre le point de la pause et la flèche, qui l'a quitté.
  const late = from ? await evaluate(probe(null)) : null;
  if (from && late?.at && Math.abs(late.at.x - from.x) > 20) {
    const atEnd = await evaluate(probe({ from, to: late.at }));
    check(`${pass} : aucune trace dessinée pendant la pause`, atEnd?.inGap === 0, `${atEnd?.inGap} endroits`);
  }
  check(`${pass} : « Reprendre »`, (await clickText('Reprendre')) === 'ok');
  // Point de la reprise : la flèche y saute dès la première position gardée (le GPS est relancé, 1 à 2 s).
  const resumedAt = pageSeconds();
  let to = null;
  while (pageSeconds() < resumedAt + 6 && to === null) {
    const s = await evaluate(probe());
    if (s?.at && from && Math.abs(s.at.x - from.x) > 20) to = s.at;
    else await vwait(100);
  }
  check(`${pass} : la flèche rejoint la position à la reprise`, to !== null, 'flèche restée au point de la pause');
  if (from && to) {
    // Relevés serrés pendant 4 s (deux calculs du direct), puis au rythme habituel.
    await sampleUntil('reprise serrée', pageSeconds() + 4, { everyMs: 200, gap: { from, to } });
    await sampleUntil('reprise', PAUSE_END_S - 2, { gap: { from, to } });
    const crossing = samples.filter((s) => s.phase.startsWith('reprise') && s.inGap > 0);
    check(`${pass} : aucun trait entre le point de la pause et celui de la reprise`, crossing.length === 0,
      `trait vu à ${crossing.map((s) => `${s.t} s`).join(', ')}`);
    diag(`${pass} : trou de ${Math.round(to.x - from.x)} px, de ${from.x},${from.y} à ${to.x},${to.y}`);
  }
  report(pass, 'avant pause');
  report(pass, 'reprise');
  await endReplay(pass);
}

// 2. Trous de position, page cachée puis gelée, pause automatique.
{
  const pass = '2. trous et page cachée';
  check(`${pass} : rejeu lancé`, await startReplay(holesTrack));
  await sampleUntil('avant trou 1', HOLE_1[0] + 1);
  const hidden = await hide();
  await waitUntil(HOLE_1[1] + 2);
  const shown = await show();
  check(`${pass} : page cachée puis rendue`, hidden === 'hidden' && shown === 'visible', `${hidden} / ${shown}`);
  await sampleUntil('réveil 1', STILL[0]);
  await sampleUntil('pause auto', STILL[1] + 3);
  await sampleUntil('reprise', HOLE_2[0] + 1);
  await sleep();
  await waitUntil(HOLE_2[1] + 4);
  check(`${pass} : réveil après le JavaScript suspendu`, (await wake()) === 'visible');
  await sampleUntil('réveil 2', HOLES_END_S - 2);
  for (const phase of ['avant trou 1', 'réveil 1', 'reprise', 'réveil 2']) report(pass, phase);
  check(`${pass} : pause automatique vue`, samples.some((s) => s.phase === 'pause auto' && s.pause));
  await endReplay(pass);
}

console.log('--- console ---');
for (const l of logs) console.log(l);
await finish();
