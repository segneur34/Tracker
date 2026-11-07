// Banc de test : graphe de dénivelé de la trace suivie, sur la page Enregistrer.
// Usage : node denivele-direct.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 5 min en temps réel (cinq rejeux à ×10 d'une course de 3 km à 5 m/s). Trace
// posée dans `tracker.followedTrace`, en ligne droite vers le nord, deux bosses connues : 100 → 160 → 120 → 170 → 110 m,
// un sommet ou un creux tous les 750 m, donc 110 m de D+. Le script vérifie :
//  1. au repos : bouton, graphe fermé d'office puis sous la carte, total exact, pas de repère de position, état retenu
//     après rechargement, survol (un rond sur la carte, retiré à la sortie) ;
//  2. sans bouton : trace sans altitude, altitude isolée, voile avec balises, surf ;
//  3. rejeu, graphe ouvert : le repère avance et colle à l'avancement, « reste » descend à 0 selon le calcul à la main,
//     courbe inchangée et jamais redessinée (seuls le repère et « reste » changent dans le panneau), carte qui suit,
//     jamais de « Recentrer » ;
//  4. à la fin du rejeu : survol sans décrocher la carte ; zoom au double-clic, « Tout voir », repère absent hors de la
//     plage ; carte réduite ; 390×844 et 844×390 tactile, sans débordement ni chevauchement, « Réduire la carte » visible,
//     zoom aux doigts (double toucher, deux doigts) et repère laissé par un doigt ; téléphone debout, page en haut, carte
//     et graphe à l'écran, carte au moins à son minimum, tuiles sans case vide à l'ouverture et à la fermeture du graphe ;
//     graphe fermé, et au repos, carte à 45 % de la hauteur ; 360×640 : carte au minimum, le graphe passe sous la barre ;
//  5. rejeu, graphe fermé : chiffres identiques en fin de rejeu ;
//  6. processeur ralenti six fois : temps de tâches, graphe ouvert au plus 1,15 × fermé ; tâches longues sur la sortie
//     d'erreur, pour information (elles comptent en entier dès 50 ms : trop de bruit pour un verdict) ;
//  7. rejeu zoomé : le zoom tient pendant que la position avance, le repère entre puis sort de la plage ;
//  8. au repos, téléphone debout, graphe ouvert : carte à 45 % de la hauteur, sous-titre gardé.
// Le graphe peut être sous le bas de la fenêtre : on le ramène à l'écran avant tout geste (`chartOnScreen`).
// Verdicts : fin par « Tout passe. » ou le nombre d'échecs, code 0 ou 1.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, diag, wait } from './lib/cdp.mjs';
import { BLOCKED_EXCEPT_TILES, fakeTiles } from './lib/tuiles.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node denivele-direct.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

const b = await connect({ port, shotDir, width: 1400, height: 1000 });
const { send, evaluate, go, settle, waitFor, blockNetwork, importFiles, clickText, shoot, check, finish } = b;
await fakeTiles(b);
await blockNetwork(BLOCKED_EXCEPT_TILES);

// --- Trace ---
const R = 6371000;
const O = { lat: 43.7, lon: 3.85 };
const north = (m) => ({ lat: O.lat + (m / R) * (180 / Math.PI), lon: O.lon });
/** Sommets et creux : distance en mètres, altitude en mètres. */
const HILLS = [[0, 100], [750, 160], [1500, 120], [2250, 170], [3000, 110]];
const TOTAL_GAIN_M = 110;
const LENGTH_M = 3000;
const eleAt = (d) => {
  for (let k = 1; k < HILLS.length; k++) {
    const [d0, e0] = HILLS[k - 1];
    const [d1, e1] = HILLS[k];
    if (d <= d1) return e0 + ((e1 - e0) * (d - d0)) / (d1 - d0);
  }
  return HILLS.at(-1)[1];
};
/** Montée restante après `d` mètres, calculée à la main sur les bosses. */
const gainAfter = (d) => {
  let gain = 0;
  for (let k = 1; k < HILLS.length; k++) {
    const [d0, e0] = HILLS[k - 1];
    const [d1, e1] = HILLS[k];
    if (e1 > e0 && d1 > d) gain += e1 - eleAt(Math.max(d, d0));
  }
  return gain;
};
/** Un point tous les 50 m : l'amincissement n'en garde que les sommets et les creux. */
const hillPoints = Array.from({ length: 61 }, (_, i) => ({ ...north(i * 50), eleM: eleAt(i * 50) }));
const flatPoints = hillPoints.map(({ lat, lon }) => ({ lat, lon }));
const TRACES = {
  bosses: { name: 'Deux bosses', source: 'route', activityId: 'running', points: hillPoints },
  sansAltitude: { name: 'Plat', source: 'route', activityId: 'running', points: flatPoints },
  altitudeIsolee: { name: 'Une altitude', source: 'route', activityId: 'running', points: [{ ...flatPoints[0], eleM: 100 }, ...flatPoints.slice(1)] },
  voile: { name: 'Parcours', source: 'route', activityId: 'wingfoil', points: hillPoints, marks: [flatPoints[0], flatPoints[30], flatPoints[60]] },
  surf: { name: 'Vagues', source: 'route', activityId: 'surf', points: hillPoints },
};

const SPEED_MS = 5;
const t0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const FIX_COUNT = LENGTH_M / SPEED_MS + 1;
const gpxPath = join(workDir, 'denivele-direct.gpx');
writeFileSync(gpxPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>running</type><trkseg>\n${
  Array.from({ length: FIX_COUNT }, (_, k) => {
    const d = k * SPEED_MS;
    const p = north(d);
    return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${eleAt(d).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${SPEED_MS}</speed></extensions></trkpt>`;
  }).join('\n')
}\n</trkseg></trk></gpx>\n`);
console.log(`trace : ${hillPoints.length} points, ${LENGTH_M} m, ${TOTAL_GAIN_M} m de D+ ; rejeu : ${FIX_COUNT} positions`);

// --- Relevés ---
/** Tout ce que regardent les contrôles, lu d'un coup dans la page. */
const state = () => evaluate(`(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text) ?? null;
  const card = document.querySelector('.rec-elevation');
  const map = document.querySelector('.rec-map');
  const line = card?.querySelector('.rec-elevation__position-line') ?? null;
  const dot = card?.querySelector('.rec-elevation__position-dot') ?? null;
  const area = card?.querySelector('.recharts-area-area') ?? null;
  const curve = card?.querySelector('.recharts-area-curve') ?? null;
  let fraction = null;
  if (line && area) {
    const a = area.getBBox();
    fraction = (line.getBBox().x - a.x) / a.width;
  }
  const stats = Object.fromEntries([...document.querySelectorAll('.rec-stat')].map((s) => [s.children[0]?.textContent.trim(), s.children[1]?.textContent.trim()]));
  const done = Object.entries(stats).find(([k]) => k.startsWith('Fait, sur'));
  const enCours = [...document.querySelectorAll('.ui-card')].find((c) => c.querySelector('.ui-card__title')?.textContent.trim() === 'En cours');
  const chart = card?.querySelector('.zoom-chart') ?? null;
  return {
    hasButton: button('Dénivelé') !== null,
    pressed: button('Dénivelé')?.getAttribute('aria-pressed') ?? null,
    followLine: [...document.querySelectorAll('.ui-alert')].some((a) => a.textContent.includes('Trace suivie')),
    card: rect(card),
    map: rect(map),
    text: card?.querySelector('.rec-elevation__gain')?.textContent.trim() ?? null,
    gainRect: rect(card?.querySelector('.rec-elevation__gain')),
    readout: card?.querySelector('.chart-readout')?.textContent.trim() ?? null,
    cardText: card?.textContent ?? '',
    chart: rect(chart),
    hasLine: line !== null,
    hasDot: dot !== null,
    fraction,
    curve: curve?.getAttribute('d') ?? null,
    stops: card?.querySelectorAll('linearGradient stop').length ?? 0,
    donePct: done ? Number.parseInt(done[1], 10) : null,
    stats,
    points: Number(stats.Points ?? NaN),
    pane: document.querySelector('.leaflet-map-pane')?.style.transform ?? null,
    recenter: button('Recentrer') !== null,
    reduce: rect(button('Réduire la carte')),
    showMap: rect(button('Afficher la carte')),
    fullView: rect(button('Tout voir')),
    enCours: rect(enCours),
    hoverRings: [...document.querySelectorAll('.leaflet-container path')].filter((p) => p.getAttribute('stroke') === '#1b1f24').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    width: window.innerWidth,
    height: window.innerHeight,
    coarse: matchMedia('(pointer: coarse)').matches,
    fixed: card ? getComputedStyle(card).position === 'fixed' : false,
  };
})()`);

/** Ramène la page en haut et relit tout. */
const pageTop = async () => {
  await evaluate(`window.scrollTo(0, 0); 'ok'`);
  await wait(300);
  return state();
};
/** Hauteur minimale de la carte (feuille de style) et haut de la barre du bas. */
const fitLimits = () => evaluate(`(() => ({
  minH: Number.parseFloat(getComputedStyle(document.querySelector('.rec-page')).getPropertyValue('--rec-map-min-h')),
  barTop: document.querySelector('.shell-tabbar').getBoundingClientRect().top,
  layersBottom: Math.max(...[...document.querySelectorAll('.rec-map .leaflet-top .leaflet-control')].map((c) => c.getBoundingClientRect().bottom)),
}))()`);
/** Attend que les tuiles couvrent la carte, puis compte les points de son cadre sans tuile chargée (grille de 7 × 7). */
const emptyTilePoints = async () => {
  const expression = `(() => {
    const box = document.querySelector('.rec-map').getBoundingClientRect();
    const points = [];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) points.push([box.left + 3 + ((box.width - 6) * i) / 6, box.top + 3 + ((box.height - 6) * j) / 6]);
    const inView = points.filter(([, y]) => y >= 0 && y < innerHeight);
    // Par les rectangles : Leaflet coupe le pointeur sur ses tuiles, elementsFromPoint ne les rend pas.
    const loaded = [...document.querySelectorAll('.rec-map img.leaflet-tile')].filter((t) => t.complete && t.naturalWidth > 0).map((t) => t.getBoundingClientRect());
    return inView.filter(([x, y]) => !loaded.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)).length;
  })()`;
  await waitFor(`${expression} === 0`, { timeout: 4000, every: 200, label: 'tuiles' });
  return evaluate(expression);
};
const setTrace = async (trace) => {
  await evaluate(`localStorage.setItem('tracker.followedTrace', JSON.stringify(${JSON.stringify(trace)})); 'ok'`);
  await go('/enregistrer');
  await settle({ max: 3000 });
};
const pickFamily = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('[aria-label=Famille] button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`);
const moveMouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
/** Point du graphe, à `fx` de sa largeur, à mi-hauteur. */
const chartPoint = (s, fx) => [s.chart.l + s.chart.w * fx, s.chart.t + s.chart.h / 2];
/** Ramène le graphe à l'écran et relit sa place : souris et doigts visent des coordonnées de la fenêtre. */
const chartOnScreen = async () => {
  await evaluate(`document.querySelector('.rec-elevation').scrollIntoView({ block: 'center' }); 'ok'`);
  await wait(200);
  return state();
};
/** Survol à `fx` de la largeur du graphe : deux mouvements, Recharts lit le déplacement. */
const hoverChart = async (s, fx) => {
  const [x, y] = chartPoint(s, fx);
  await moveMouse(x - 4, y);
  await moveMouse(x, y);
  await settle({ max: 1000 });
};
/** Double toucher daté comme un vrai geste (le second moins de 300 ms après le premier). */
const doubleTap = async (x, y) => {
  const start = Date.now() / 1000;
  for (const [type, dt] of [['touchStart', 0], ['touchEnd', 0.04], ['touchStart', 0.13], ['touchEnd', 0.17]]) {
    await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchStart' ? [{ x, y }] : [], timestamp: start + dt });
  }
  await settle({ max: 1000 });
};
/** Deux doigts à mi-hauteur du graphe, de `from` à `to` (fractions de sa largeur). */
const pinch = async (s, from, to) => {
  const fingers = (f) => [0, 1].map((id) => ({ id, x: s.chart.l + s.chart.w * (from[id] + (to[id] - from[id]) * f), y: s.chart.t + s.chart.h / 2 }));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0) });
  for (let k = 1; k <= 6; k++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(k / 6) });
    await wait(40);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle({ max: 1000 });
};
/** Un doigt posé, glissé, levé sur le graphe. */
const fingerSlide = async (s, fromFx, toFx) => {
  const at = (fx) => [{ x: s.chart.l + s.chart.w * fx, y: s.chart.t + s.chart.h / 2 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromFx) });
  for (let k = 1; k <= 6; k++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(fromFx + ((toFx - fromFx) * k) / 6) });
    await wait(40);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle({ max: 1000 });
};
const doubleClick = async (x, y) => {
  for (const clickCount of [1, 2]) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount });
  }
  await settle({ max: 1500 });
};
const setSize = async (width, height, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
  await settle({ max: 1500 });
};

const prepareReplay = async () => {
  await evaluate(`[...document.querySelectorAll('label')].find((l) => l.textContent.includes('Rejeu')).querySelector('input').click(); 'ok'`);
  await waitFor(`Boolean(document.querySelector('input[type=file][accept*=".gpx"]'))`, { timeout: 3000, label: 'champ du rejeu' });
  await importFiles(gpxPath, 'input[type=file][accept*=".gpx"]');
  await waitFor(`document.querySelector('.rec-replay-row')?.textContent.includes('${FIX_COUNT} points') === true`, { timeout: 5000, label: 'rejeu lu' });
  await evaluate(`(() => {
    const select = document.querySelector('.rec-replay-row select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '10');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await wait(200);
};
// « Arrêter » se tient (appui long réglable, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const endRecording = async (label) => {
  const stop = await holdStop();
  await settle({ max: 3000 });
  const thrown = await clickText('Jeter');
  await settle({ max: 2000 });
  check(`${label} : arrêt tenu puis « Jeter »`, stop === 'ok' && thrown === 'ok', `${stop} / ${thrown}`);
};
const waitReplayEnd = () => waitFor(`(() => {
  const s = [...document.querySelectorAll('.rec-stat')].find((x) => x.children[0]?.textContent.trim() === 'Points');
  return Number(s?.children[1]?.textContent) >= ${FIX_COUNT};
})()`, { timeout: 90000, every: 500, label: 'fin du rejeu' });
/** Chiffres de fin de rejeu : la durée à l'horloge tourne encore, le reste ne bouge plus. */
const lastFigures = async () => {
  await waitReplayEnd();
  await wait(3000);
  const { stats } = await state();
  delete stats['Durée'];
  return JSON.stringify(stats);
};

// --- 1. Au repos ---
await go('/enregistrer');
await setTrace(TRACES.bosses);
await waitFor(`[...document.querySelectorAll('.ui-alert')].some((a) => a.textContent.includes('Trace suivie'))`, { label: 'ligne de la trace suivie' });
let s = await state();
check('repos : bouton « Dénivelé » sur la ligne de la trace suivie', s.hasButton && s.followLine, JSON.stringify([s.hasButton, s.followLine]));
check('repos : graphe fermé d\'office', s.card === null && s.pressed === 'false', `${s.pressed}`);
await clickText('Dénivelé');
await waitFor(`Boolean(document.querySelector('.rec-elevation .recharts-area-curve'))`, { label: 'courbe du dénivelé' });
await settle({ max: 1500 });
s = await state();
check('repos : graphe sous la carte', s.card !== null && s.map !== null && s.card.t >= s.map.b, JSON.stringify([s.card, s.map]));
check(`repos : ${TOTAL_GAIN_M} m D+ au total`, s.text === `${TOTAL_GAIN_M} m D+ au total`, s.text);
check('repos : courbe colorée par la pente', s.stops >= 2, `${s.stops} arrêts`);
check('repos : pas de repère de position', !s.hasLine && !s.hasDot);
check('rien au-delà de la maquette : ni « +carte », ni « Afficher », ni « Voir sur la carte », ni légende',
  !/\+carte|Afficher|Voir sur la carte|Pente,/.test(s.cardText), s.cardText);
await shoot('denivele-repos');

s = await chartOnScreen();
await hoverChart(s, 0.5);
let hovered = await state();
check('survol au repos : un rond sur la carte, lecture de l\'altitude', hovered.hoverRings === 1 && /\d+ m/.test(hovered.readout ?? ''), `${hovered.hoverRings}, ${hovered.readout}`);
await moveMouse(2, 2);
await settle({ max: 1000 });
hovered = await state();
check('survol au repos : rond retiré à la sortie', hovered.hoverRings === 0, `${hovered.hoverRings}`);

await go('/enregistrer');
await settle({ max: 3000 });
s = await state();
check('état retenu après rechargement', s.card !== null && s.pressed === 'true', `${s.pressed}`);
const sections = await evaluate(`JSON.parse(localStorage.getItem('tracker.sections') ?? '{}').recording ?? null`);
check('état rangé dans tracker.sections', sections?.denivele === true && sections?.carte === true, JSON.stringify(sections));

// --- 2. Sans bouton ---
await setTrace(TRACES.sansAltitude);
s = await state();
check('sans altitude : ni bouton ni graphe, trace suivie gardée', !s.hasButton && s.card === null && s.followLine, JSON.stringify([s.hasButton, s.followLine]));
await setTrace(TRACES.altitudeIsolee);
s = await state();
check('une altitude isolée : ni bouton ni graphe', !s.hasButton && s.card === null, `${s.hasButton}`);
await setTrace(TRACES.voile);
check('voile avec balises : famille choisie', (await pickFamily('Voile')) === 'ok');
await settle({ max: 1000 });
s = await state();
check('voile avec balises : ni bouton ni graphe', !s.hasButton && s.card === null, `${s.hasButton}`);
await setTrace(TRACES.surf);
check('surf : famille choisie', (await pickFamily('Surf')) === 'ok');
await settle({ max: 1000 });
s = await state();
check('surf : ni bouton ni graphe', !s.hasButton && s.card === null, `${s.hasButton}`);

// --- 3. Rejeu, graphe ouvert ---
await setTrace(TRACES.bosses);
await prepareReplay();
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Démarrer'))?.click(); 'ok'`);
await waitFor(`Boolean(document.querySelector('.rec-elevation .rec-elevation__position-line'))`, { timeout: 15000, label: 'repère de position' });
await evaluate(`(() => {
  window.__redessins = [];
  const own = '.rec-elevation__position-line, .rec-elevation__position-dot, .rec-elevation__gain';
  new MutationObserver((list) => {
    for (const m of list) {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!el.closest(own)) window.__redessins.push(el.getAttribute('class') ?? el.tagName);
    }
  }).observe(document.querySelector('.rec-elevation'), { subtree: true, childList: true, attributes: true, characterData: true });
  return 'ok';
})()`);
const samples = [];
for (;;) {
  const now = await state();
  samples.push(now);
  if (now.points >= FIX_COUNT) break;
  await wait(1500);
}
await wait(3000);
const end = await state();
samples.push(end);
diag(samples.map((x) => `${x.points} pts · ${x.donePct} % · repère ${(x.fraction * 100).toFixed(1)} % · ${x.text}`).join('\n'));
const reading = samples.filter((x) => x.fraction !== null && x.donePct !== null);
check('rejeu : assez de relevés', reading.length >= 15, `${reading.length}`);
const offPosition = reading.filter((x) => Math.abs(x.fraction * 100 - x.donePct) > 2);
check('rejeu : le repère colle à l\'avancement (±2 %)', offPosition.length === 0,
  offPosition.map((x) => `${(x.fraction * 100).toFixed(1)} contre ${x.donePct}`).slice(0, 5).join(', '));
check('rejeu : le repère ne recule pas', reading.every((x, i) => i === 0 || x.fraction >= reading[i - 1].fraction - 1e-6));
check('rejeu : le rond suit la courbe', reading.every((x) => x.hasDot));
const remaining = reading.map((x) => Number.parseInt(/reste (\d+) m D\+/.exec(x.text ?? '')?.[1] ?? 'NaN', 10));
check('rejeu : « reste … m D+ » lu à chaque relevé', remaining.every(Number.isFinite), reading.map((x) => x.text).slice(0, 5).join(' | '));
check('rejeu : « reste » ne remonte pas', remaining.every((v, i) => i === 0 || v <= remaining[i - 1]), remaining.join(' '));
// « Fait » est arrondi au pour cent (30 m, 2,4 m d'altitude dans la pente la plus raide).
const offGain = reading.filter((x, i) => Math.abs(remaining[i] - gainAfter((x.donePct / 100) * LENGTH_M)) > 5);
check('rejeu : « reste » suit le calcul à la main (±5 m)', offGain.length === 0,
  offGain.map((x) => `${x.donePct} % : ${x.text}, attendu ${Math.round(gainAfter((x.donePct / 100) * LENGTH_M))}`).slice(0, 5).join(', '));
check('rejeu : fin à « reste 0 m D+ », repère au bout', end.text === 'reste 0 m D+' && end.fraction > 0.99, `${end.text}, ${end.fraction}`);
check('rejeu : courbe inchangée', new Set(samples.map((x) => x.curve)).size === 1, `${new Set(samples.map((x) => x.curve)).size} formes`);
check('rejeu : la carte suit', new Set(samples.map((x) => x.pane)).size >= 5, `${new Set(samples.map((x) => x.pane)).size} places`);
check('rejeu : jamais de « Recentrer »', samples.every((x) => !x.recenter));
const figuresOpen = await lastFigures();
await shoot('denivele-fin');

// --- 4. Fin de rejeu : survol, zoom, carte réduite, téléphone ---
const redrawn = await evaluate(`window.__redessins`);
check('rejeu : le graphe ne se redessine pas, seuls le repère et « reste » changent', redrawn.length === 0, [...new Set(redrawn)].slice(0, 5).join(', '));
s = await chartOnScreen();
const paneBefore = s.pane;
await hoverChart(s, 0.5);
hovered = await state();
check('survol : un rond sur la carte, la carte ne décroche pas', hovered.hoverRings === 1 && !hovered.recenter && hovered.pane === paneBefore, `${hovered.hoverRings}, ${hovered.recenter}`);
await moveMouse(2, 2);
await settle({ max: 1000 });
hovered = await state();
check('survol : rond retiré à la sortie', hovered.hoverRings === 0, `${hovered.hoverRings}`);

await doubleClick(...chartPoint(s, 0.12));
let zoomed = await state();
check('zoom : double-clic au début, « Tout voir » paraît, repère absent hors de la plage', zoomed.fullView !== null && !zoomed.hasLine && !zoomed.hasDot, JSON.stringify([zoomed.fullView, zoomed.hasLine]));
check('zoom : la courbe change', zoomed.curve !== s.curve);
await clickText('Tout voir');
await settle({ max: 1000 });
zoomed = await state();
check('« Tout voir » : repère revenu, courbe d\'origine', zoomed.fullView === null && zoomed.hasLine && zoomed.curve === s.curve, JSON.stringify([zoomed.fullView, zoomed.hasLine]));
// Le point visé reste sous le pointeur (`zoomAtRange`) : à 95 % de la largeur, la plage finirait vers 97 %, avant la position.
// D'où le bord droit, dans la marge du graphe, qui garde la fin de la trace dans la plage : le repère y est, au bout.
await doubleClick(...chartPoint(s, 0.999));
zoomed = await state();
check('zoom sur la fin : repère dans la plage, au bout', zoomed.fullView !== null && zoomed.hasLine && zoomed.fraction > 0.99, JSON.stringify([zoomed.fullView, zoomed.hasLine, zoomed.fraction]));
await clickText('Tout voir');
await settle({ max: 1000 });
await moveMouse(2, 2);
await settle({ max: 500 });

await clickText('Réduire la carte');
await settle({ max: 1500 });
s = await state();
check('carte réduite : graphe après « Afficher la carte », avant les chiffres',
  s.map === null && s.showMap !== null && s.card !== null && s.enCours !== null && s.card.t >= s.showMap.b && s.card.b <= s.enCours.t,
  JSON.stringify([s.showMap, s.card, s.enCours]));
await shoot('denivele-carte-reduite');
await clickText('Afficher la carte');
await settle({ max: 1500 });

await setSize(390, 844, true);
s = await pageTop();
const fit = await fitLimits();
process.stderr.write(`390×844, page en haut : carte de ${Math.round(s.map.t)} à ${Math.round(s.map.b)} px (${Math.round(s.map.h)} de haut, minimum ${fit.minH}), graphe de ${Math.round(s.card.t)} à ${Math.round(s.card.b)} px, barre à ${Math.round(fit.barTop)}\n`);
check('390×844 : graphe entièrement à l\'écran, au-dessus de la barre, page en haut', s.card.t >= 0 && s.card.b <= fit.barTop, JSON.stringify([s.card, fit.barTop]));
check('390×844 : carte au moins à son minimum', fit.minH > 0 && s.map.h >= fit.minH - 0.5, `${s.map.h} contre ${fit.minH}`);
check('390×844 : zoom et choix du fond dans la carte', fit.layersBottom <= s.map.b, `${fit.layersBottom} contre ${s.map.b}`);
check('390×844 : les chiffres passent sous le graphe', s.enCours !== null && s.enCours.t >= s.card.b, JSON.stringify([s.card, s.enCours]));
const emptyOpen = await emptyTilePoints();
check('390×844 : tuiles sans case vide, graphe ouvert', emptyOpen === 0, `${emptyOpen} points`);
await shoot('denivele-390-haut');
await clickText('Dénivelé');
await settle({ max: 1500 });
const shut = await pageTop();
process.stderr.write(`390×844, graphe fermé : carte de ${Math.round(shut.map.t)} à ${Math.round(shut.map.b)} px (${Math.round(shut.map.h)} de haut)\n`);
check('390×844 : graphe fermé, carte à 45 % de la hauteur', Math.abs(shut.map.h - (shut.height * 0.45 + 2)) <= 1, `${shut.map.h}`);
const emptyShut = await emptyTilePoints();
check('390×844 : tuiles sans case vide après la fermeture du graphe', emptyShut === 0, `${emptyShut} points`);
await clickText('Dénivelé');
await settle({ max: 1500 });
const reopened = await pageTop();
check('390×844 : graphe rouvert, même carte', Math.abs(reopened.map.h - s.map.h) <= 1, `${reopened.map.h} contre ${s.map.h}`);
const emptyReopen = await emptyTilePoints();
check('390×844 : tuiles sans case vide après la réouverture', emptyReopen === 0, `${emptyReopen} points`);

// Petit téléphone : tout ne tient pas, la carte s'arrête à son minimum, le graphe passe sous la barre et se rejoint en défilant.
await setSize(360, 640, true);
const small = await pageTop();
const smallFit = await fitLimits();
const seen = Math.round(Math.max(0, Math.min(small.card.b, smallFit.barTop) - small.card.t));
process.stderr.write(`360×640, page en haut : carte de ${Math.round(small.map.t)} à ${Math.round(small.map.b)} px (${Math.round(small.map.h)} de haut), graphe de ${Math.round(small.card.t)} à ${Math.round(small.card.b)} px, ${seen} px visibles, barre à ${Math.round(smallFit.barTop)}\n`);
check('360×640 : carte à son minimum', Math.abs(small.map.h - smallFit.minH) <= 1, `${small.map.h} contre ${smallFit.minH}`);
check('360×640 : pas de débordement', small.overflow <= 0, `${small.overflow} px`);
await shoot('denivele-360');
const smallOn = await chartOnScreen();
check('360×640 : le graphe se rejoint en défilant', smallOn.card.t >= 0 && smallOn.card.b <= smallFit.barTop, JSON.stringify([smallOn.card, smallFit.barTop]));

await setSize(390, 844, true);
s = await pageTop();
check('390×844 : pas de débordement', s.overflow <= 0, `${s.overflow} px`);
check('390×844 : graphe sous la carte, avant les chiffres', s.card !== null && s.map !== null && s.enCours !== null && s.card.t >= s.map.b && s.card.b <= s.enCours.t, JSON.stringify([s.map, s.card, s.enCours]));
check('390×844 : graphe à 130 px', s.chart !== null && Math.abs(s.chart.h - 130) <= 1, `${s.chart?.h}`);
check('390×844 : « Réduire la carte » visible', s.reduce !== null && s.map !== null && s.reduce.t >= s.map.t && s.reduce.b <= s.map.b && s.reduce.r <= s.map.r, JSON.stringify([s.reduce, s.map]));
await shoot('denivele-390');
s = await chartOnScreen();
const curve390 = s.curve;
await doubleTap(...chartPoint(s, 0.5));
zoomed = await state();
check('390×844 : double toucher, zoom et « Tout voir »', zoomed.fullView !== null && zoomed.curve !== curve390, JSON.stringify([zoomed.fullView]));
await shoot('denivele-390-zoom');
await clickText('Tout voir');
await settle({ max: 1000 });
s = await state();
check('390×844 : « Tout voir » rend la courbe', s.fullView === null && s.curve === curve390);
await pinch(s, [0.4, 0.6], [0.15, 0.85]);
zoomed = await state();
check('390×844 : deux doigts écartés, zoom et « Tout voir »', zoomed.fullView !== null && zoomed.curve !== curve390, JSON.stringify([zoomed.fullView]));
await clickText('Tout voir');
await settle({ max: 1000 });
s = await state();
await fingerSlide(s, 0.3, 0.6);
hovered = await state();
check('390×844 : un doigt déplace le rond de la carte, qui reste où on l\'a laissé', hovered.hoverRings === 1 && hovered.fullView === null, `${hovered.hoverRings}, ${hovered.readout}`);

await setSize(844, 390, true);
s = await state();
check('844×390 : écran tactile tourné', s.coarse && s.width === 844 && s.height === 390, JSON.stringify([s.coarse, s.width, s.height]));
check('844×390 : pas de débordement', s.overflow <= 0, `${s.overflow} px`);
check('844×390 : graphe fixé en bas à droite, à 96 px', s.fixed && s.chart !== null && Math.abs(s.chart.h - 96) <= 1 && s.card.b <= s.height && s.card.r <= s.width, JSON.stringify([s.fixed, s.chart, s.card]));
check('844×390 : carte raccourcie au-dessus du graphe', s.map !== null && s.map.b <= s.card.t && s.map.h >= 120, JSON.stringify([s.map, s.card]));
check('844×390 : texte « reste » entier dans le cadre', s.gainRect !== null && s.gainRect.b <= s.card.b && s.chart.t >= s.card.t, JSON.stringify([s.gainRect, s.chart, s.card]));
check('844×390 : « Réduire la carte » visible', s.reduce !== null && s.reduce.t >= s.map.t && s.reduce.b <= s.map.b && s.reduce.r <= s.map.r, JSON.stringify([s.reduce, s.map]));
check('844×390 : pas de chevauchement avec la colonne de gauche', s.enCours !== null && s.enCours.r <= s.card.l && s.enCours.r <= s.map.l, JSON.stringify([s.enCours, s.card, s.map]));
await shoot('denivele-844');
const curve844 = s.curve;
await doubleTap(...chartPoint(s, 0.5));
zoomed = await state();
check('844×390 : double toucher, zoom, « Tout voir » dans le graphe', zoomed.fullView !== null && zoomed.curve !== curve844
  && zoomed.fullView.t >= zoomed.chart.t && zoomed.fullView.b <= zoomed.chart.b && zoomed.fullView.r <= zoomed.chart.r, JSON.stringify([zoomed.fullView, zoomed.chart]));
await shoot('denivele-844-zoom');
await clickText('Tout voir');
await settle({ max: 1000 });

await setSize(1400, 1000, false);
await endRecording('graphe ouvert');

// --- 5. Rejeu, graphe fermé ---
await clickText('Dénivelé');
await settle({ max: 1000 });
s = await state();
check('bouton : referme le graphe', s.card === null && s.pressed === 'false', `${s.pressed}`);
await prepareReplay();
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Démarrer'))?.click(); 'ok'`);
const figuresClosed = await lastFigures();
check('chiffres identiques en fin de rejeu, graphe ouvert ou fermé', figuresOpen === figuresClosed, `${figuresOpen} / ${figuresClosed}`);
await endRecording('graphe fermé');

// --- 6. Temps de tâches, processeur ralenti six fois ---
const taskSeconds = async () => (await send('Performance.getMetrics')).result.metrics.find((m) => m.name === 'TaskDuration').value;
/** Pendant trente secondes de rejeu à ×10 : temps de tâches du navigateur, et total des tâches de plus de 50 ms, en ms. */
const replayCost = async () => {
  await prepareReplay();
  const before = await taskSeconds();
  await evaluate(`(() => {
    window.__longues = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longues.push(e.duration); }).observe({ type: 'longtask' });
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Démarrer'))?.click();
    return 'ok';
  })()`);
  await wait(30000);
  const taskMs = Math.round((await taskSeconds() - before) * 1000);
  const list = (await evaluate(`window.__longues`)) ?? [];
  return { taskMs, total: Math.round(list.reduce((a, b) => a + b, 0)), count: list.length, longest: Math.round(Math.max(0, ...list)) };
};
await send('Performance.enable');
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
const closed = await replayCost();
await endRecording('×6, graphe fermé');
await clickText('Dénivelé');
await settle({ max: 1500 });
const opened = await replayCost();
await endRecording('×6, graphe ouvert');
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
process.stderr.write(`×6, temps de tâches et tâches longues, fermé : ${JSON.stringify(closed)} ; ouvert : ${JSON.stringify(opened)}\n`);
check('×6 : graphe ouvert, temps de tâches au plus 1,15 × fermé', opened.taskMs <= closed.taskMs * 1.15, `${opened.taskMs} contre ${closed.taskMs} ms`);

// --- 7. Rejeu zoomé ---
await prepareReplay();
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Démarrer'))?.click(); 'ok'`);
await waitFor(`Boolean(document.querySelector('.rec-elevation .rec-elevation__position-line'))`, { timeout: 15000, label: 'repère de position' });
s = await chartOnScreen();
await doubleClick(...chartPoint(s, 0.5));
await moveMouse(2, 2);
const zoomSamples = [];
for (;;) {
  const now = await state();
  zoomSamples.push(now);
  if (now.points >= FIX_COUNT) break;
  await wait(1500);
}
diag(zoomSamples.map((x) => `${x.donePct} % · repère ${x.hasLine ? (x.fraction * 100).toFixed(1) : 'absent'} · ${x.fullView ? 'zoomé' : 'tout'}`).join('\n'));
check('rejeu zoomé : le zoom tient à chaque relevé', zoomSamples.every((x) => x.fullView !== null));
check('rejeu zoomé : courbe inchangée', new Set(zoomSamples.map((x) => x.curve)).size === 1, `${new Set(zoomSamples.map((x) => x.curve)).size} formes`);
// Zoom ×2 au milieu : à peu près le quart central de part et d'autre ; marges pour l'arrondi et la colonne de l'axe.
const inside = zoomSamples.filter((x) => x.donePct >= 35 && x.donePct <= 65);
const outside = zoomSamples.filter((x) => x.donePct >= 85);
check('rejeu zoomé : repère et rond dans la plage', inside.length >= 3 && inside.every((x) => x.hasLine && x.hasDot), `${inside.length} relevés`);
check('rejeu zoomé : repère absent une fois sorti de la plage', outside.length >= 3 && outside.every((x) => !x.hasLine && !x.hasDot), `${outside.length} relevés`);
check('rejeu zoomé : le repère avance dans la plage', inside.every((x, i) => i === 0 || x.fraction >= inside[i - 1].fraction - 1e-6));
await clickText('Tout voir');
await settle({ max: 1000 });
await endRecording('rejeu zoomé');

// --- 8. Au repos, téléphone debout : rien ne change, graphe ouvert ---
await setSize(390, 844, true);
s = await pageTop();
process.stderr.write(`390×844, au repos, graphe ouvert : carte de ${s.map ? Math.round(s.map.h) : '?'} px de haut\n`);
check('390×844, au repos : graphe ouvert, carte à 45 % de la hauteur', s.card !== null && s.map !== null && Math.abs(s.map.h - (s.height * 0.45 + 2)) <= 1, `${s.map?.h}`);
check('390×844, au repos : sous-titre gardé', await evaluate(`Boolean(document.querySelector('.ui-page-header__subtitle')?.getBoundingClientRect().height)`));
await setSize(1400, 1000, false);

await finish();
