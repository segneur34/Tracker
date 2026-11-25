// Banc de test : coût du calcul des chiffres du direct, sous Node, sans navigateur ni serveur (lot 235, mesure M2).
// Usage : node outils/banc/direct-calcul.mjs [--cpu-prof <dossier>] [--duree <secondes>]
// Environ 1 à 2 minutes (Node 22.18 ou plus, qui lit le TypeScript de l'application par `charge-ts.mjs`).
//
// Une sortie de 3 h à 1 Hz par famille, une position de plus toutes les secondes, comme l'enregistreur ; la page recalcule
// toutes les 2 s (`PAGE_REFRESH_MS` de `useLiveRecording.ts`), donc un calcul toutes les 2 positions, AVEC la mémoire du
// direct (`LiveStatsMemory`), sur un tableau de positions neuf à chaque fois mais aux mêmes objets (`getLiveSegments`) :
//  - voile (wingfoil) : vitesse Doppler, FC, un virement toutes les 90 s, un trou de 40 s à 1 h 30 ; seuil d'activité
//    comme la page (allure de la session remesurée toutes les 60 s, `liveActiveThreshold`) ;
//  - voile, seuil alterné toutes les 60 s : le pire cas de la clé de mémoire, pour voir si elle est jetée ;
//  - course (running) : altitude, FC, énergie ;
//  - vélo (cycling) : altitude, FC, énergie.
// Les options sont celles de la page (`liveStatsOptionsFor`, chargé tel quel : les réglages de l'appareil, absents sous
// Node, sont ceux par défaut, et leur lecture à chaque calcul n'est pas comptée).
// Relevé par famille : médiane et 95e centile du temps d'un calcul (ms) dans les 5 min autour de 10 min, 1 h, 2 h et 3 h ;
// temps cumulé de tous les calculs ; nombre de remises à zéro de la mémoire (clé de réglages changée, ou segment refait :
// la cinématique est alors recalculée en entier) ; égalité stricte du dernier résultat avec le calcul sans mémoire.
// `--cpu-prof <dossier>` : un profil `direct-calcul-<famille>.cpuprofile` par famille (le temps relevé est alors gonflé
// par le profileur) et la répartition du temps par fichier source. `--duree` : trace plus courte, pour un essai.
// Sortie 1 si une égalité tombe.
import './charge-ts.mjs';
import inspector from 'node:inspector';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

// Le chargement de `useLiveRecording.ts` lit `localStorage`, que Node annonce absent : l'avertissement n'apprend rien.
const emitWarning = process.emitWarning;
process.emitWarning = () => {};
const { computeLiveStats, createLiveStatsMemory, liveReferenceSpeedMs } = await import('../../src/recording/liveStats.ts');
const { liveStatsOptionsFor } = await import('../../src/hooks/useLiveRecording.ts');
const { DEFAULT_ACTIVITIES } = await import('../../src/core/activities.ts');
const { getSportProfile } = await import('../../src/core/sportProfiles.ts');
const { resolveSailingThresholds } = await import('../../src/sailing/sailingConfig.ts');
const { msToKnots } = await import('../../src/core/units.ts');
process.emitWarning = emitWarning;

// --- Arguments ---
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const profDir = argOf('--cpu-prof');
if (args.includes('--cpu-prof') && !profDir) { console.error('Usage : node direct-calcul.mjs [--cpu-prof <dossier>] [--duree <secondes>]'); process.exit(1); }
const DUREE_S = Math.max(60, Number(argOf('--duree') ?? 3 * 3600) || 3 * 3600);
/** Une fois par calcul de la page : toutes les 2 positions à 1 Hz. */
const STEP = 2;
/** Demi-largeur des fenêtres de relevé, en secondes de trace. */
const HALF_WINDOW_S = 300;
const REFERENCE_REFRESH_S = 60;

// --- Traces synthétiques (1 Hz) ---
const R = 6_371_000;
const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
const noiseFrom = (seed) => {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return (x / 4294967296) * 2 - 1;
  };
};
const toLatLon = (xM, yM) => ({ lat: 43.5 + (yM / R) * (180 / Math.PI), lon: 3.95 + (xM / (R * Math.cos((43.5 * Math.PI) / 180))) * (180 / Math.PI) });

/** Voile : bords à 45° et 315° à ~7 m/s, un virement de 6 s toutes les 90 s, un trou de 40 s (aucune position) à 1 h 30. */
const sailFixes = (seconds) => {
  const rnd = noiseFrom(11);
  const fixes = [];
  let x = 0, y = 0;
  for (let t = 0; t < seconds; t++) {
    const tack = Math.floor(t / 90);
    const heading0 = tack % 2 === 0 ? 45 : 315;
    const previous = tack === 0 ? heading0 : tack % 2 === 0 ? 315 : 45;
    const inTurn = t % 90 < 6 ? (t % 90) / 6 : null;
    const turn = ((heading0 - previous + 540) % 360) - 180;
    const heading = inTurn === null ? heading0 : (previous + turn * inTurn + 360) % 360;
    const speed = (inTurn === null ? 7 : 7 - 4 * Math.sin(Math.PI * inTurn)) + 0.4 * rnd();
    x += speed * Math.sin((heading * Math.PI) / 180);
    y += speed * Math.cos((heading * Math.PI) / 180);
    if (t >= 5400 && t < 5440) continue;
    fixes.push({ timeMs: T0 + t * 1000, ...toLatLon(x, y), accuracyM: 4, speedMs: speed, bearingDeg: heading, heartRateBpm: Math.round(130 + 20 * Math.sin(t / 600) + 3 * rnd()) });
  }
  return fixes;
};

/** Course ou vélo : tours d'un cercle de rayon `radiusM`, allure qui ondule, altitude ondulée avec un peu de bruit, FC. */
const landFixes = (seconds, { speedMs, radiusM, eleBaseM, eleAmpM, seed }) => {
  const rnd = noiseFrom(seed);
  const fixes = [];
  let angle = 0;
  for (let t = 0; t < seconds; t++) {
    const speed = speedMs * (1 + 0.25 * Math.sin(t / 300) + 0.06 * Math.sin(t / 17)) + 0.2 * rnd();
    angle += speed / radiusM;
    const { lat, lon } = toLatLon(radiusM * Math.cos(angle), radiusM * Math.sin(angle));
    fixes.push({
      timeMs: T0 + t * 1000, lat, lon, accuracyM: 4, speedMs: speed, altitudeM: eleBaseM + eleAmpM * Math.sin(t / 400) + 1.5 * rnd(),
      heartRateBpm: Math.round(135 + 20 * Math.sin(t / 600) + t / 900 + 3 * rnd()),
    });
  }
  return fixes;
};

// --- Profileur ---
const session = new inspector.Session();
const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (err, result) => (err ? reject(err) : resolve(result))));
if (profDir) {
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 250 });
}

/** Groupes de fichiers nommés dans le relevé ; tout autre fichier de `src/` va sous « autres », détaillé dessous. */
const GROUPES = [
  ['kinematics', /\/core\/kinematics\.ts$/],
  ['liveStats', /\/recording\/liveStats\.ts$/],
  ['elevation', /\/core\/elevation\.ts$/],
  ['grade', /\/land\/grade\.ts$/],
  ['energy', /\/(running|cycling)\/energy\.ts$/],
  ['legs', /\/recording\/liveLegs\.ts$/],
];
/** Temps propre de chaque fonction rangé au fichier de `src/` de son plus proche appelant (ou d'elle-même) ; sans fichier de `src/` : « (script, système) ». */
const repartition = (profile) => {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[i]));
  const isSrc = (url) => typeof url === 'string' && url.includes('/src/') && !url.includes('node_modules');
  const fileOf = (id) => {
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const url = nodes.get(cur).callFrame.url;
      if (isSrc(url)) return url;
    }
    return null;
  };
  const byFile = new Map();
  let total = 0;
  for (const [id, us] of self) {
    if (nodes.get(id).callFrame.functionName === '(idle)') continue;
    const file = fileOf(id) ?? '(script, système)';
    byFile.set(file, (byFile.get(file) ?? 0) + us);
    total += us;
  }
  const groups = new Map(GROUPES.map(([name]) => [name, 0]));
  const others = new Map();
  for (const [file, us] of byFile) {
    const g = GROUPES.find(([, re]) => re.test(file));
    if (g) groups.set(g[0], groups.get(g[0]) + us);
    else others.set(file.startsWith('(') ? file : basename(file), us);
  }
  return { total, groups, others };
};
const pct = (us, total) => `${((100 * us) / Math.max(1, total)).toFixed(0).padStart(3)} %`;
const fr = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d).replace('.', ','));

// --- Un passage ---
const median = (list) => { const v = [...list].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const p95 = (list) => { const v = [...list].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)] : null; };
const CENTRES_S = [600, 3600, 7200, 10800].filter((c) => c <= DUREE_S + HALF_WINDOW_S);

const results = [];
let failures = 0;

/**
 * Un passage : un calcul toutes les `STEP` positions, avec mémoire. `seuil` : 'aucun' (pas de seuil d'activité), 'allure'
 * (celui de la page : allure de la session remesurée toutes les 60 s) ou 'alterne' (change toutes les 60 s).
 */
const run = async ({ nom, activityId, fixes, seuil }) => {
  const activity = DEFAULT_ACTIVITIES.find((a) => a.id === activityId);
  const profile = getSportProfile(activity.base);
  const base = liveStatsOptionsFor(activity);
  const startMs = fixes[0].timeMs;
  let reference = null;
  /** Durée des mesures de l'allure (voile), à part : elles ne sont pas le calcul du direct. */
  const referenceCosts = [];
  let referenceMs = 0; // durée de la mesure de l'allure faite pour le calcul en cours
  const optionsAt = (segments, nowMs) => {
    referenceMs = 0;
    if (seuil === 'aucun' || base.activeAverage !== true) return { ...base };
    if (seuil === 'alterne') return { ...base, activeThreshold: 8 + (Math.floor((nowMs - startMs) / 60_000) % 2) };
    if (reference === null || nowMs - reference.atMs >= REFERENCE_REFRESH_S * 1000) {
      const t = performance.now();
      reference = { atMs: nowMs, ms: liveReferenceSpeedMs(segments, profile.maxGapS) };
      referenceMs = performance.now() - t;
      referenceCosts.push(referenceMs);
    }
    return { ...base, activeThreshold: resolveSailingThresholds(profile, null, null, msToKnots(reference.ms)).activeKn };
  };

  // Chauffe : les 10 premières minutes sur une mémoire jetée, pour que le premier relevé ne paie pas la compilation.
  {
    const warmMemory = createLiveStatsMemory();
    for (let n = STEP; n <= Math.min(fixes.length, 600); n += STEP) {
      const segments = [fixes.slice(0, n)];
      computeLiveStats(segments, profile, optionsAt(segments, fixes[n - 1].timeMs), warmMemory);
    }
    reference = null;
    referenceCosts.length = 0;
  }

  if (profDir) await post('Profiler.start');
  const memory = createLiveStatsMemory();
  const samples = []; // { n, ms }
  const resets = { reglages: 0, segment: 0 };
  let last = null;
  let lastOptions = null;
  let lastSegments = null;
  const calls = [];
  for (let n = STEP; n <= fixes.length; n += STEP) calls.push(n);
  if (calls[calls.length - 1] !== fixes.length) calls.push(fixes.length);
  const wallStart = performance.now();
  for (const n of calls) {
    const t0 = performance.now();
    const segments = [fixes.slice(0, n)];
    const options = optionsAt(segments, fixes[n - 1].timeMs);
    const before = { key: memory.key, entries: memory.entries.slice() };
    last = computeLiveStats(segments, profile, options, memory);
    const ms = performance.now() - t0 - referenceMs;
    if (before.entries.length > 0) {
      if (memory.key !== before.key) resets.reglages++;
      else if (before.entries.some((e, k) => memory.entries[k] !== e)) resets.segment++;
    }
    samples.push({ n, ms });
    lastOptions = options;
    lastSegments = segments;
  }
  const wallMs = performance.now() - wallStart;
  const profileOut = profDir ? (await post('Profiler.stop')).profile : null;

  // Égalité stricte avec le calcul sans mémoire (mêmes positions, mêmes options), et son coût : celui d'avant la mémoire.
  const fresh = [];
  let without = null;
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    without = computeLiveStats(lastSegments, profile, lastOptions);
    fresh.push(performance.now() - t);
  }
  const equal = isDeepStrictEqual(last, without);
  if (!equal) {
    failures++;
    const diff = Object.keys(without).filter((k) => !isDeepStrictEqual(last[k], without[k]));
    console.log(`ÉCHEC ${nom} : le résultat avec mémoire diffère du calcul sans mémoire (${diff.join(', ')})`);
  }

  const windows = CENTRES_S.map((centre) => {
    const inside = samples.filter((s) => Math.abs(s.n - centre) <= HALF_WINDOW_S).map((s) => s.ms);
    return { centre, median: median(inside), p95: p95(inside), max: inside.length ? Math.max(...inside) : null };
  });
  results.push({
    nom, windows, cumulMs: samples.reduce((a, s) => a + s.ms, 0), calls: samples.length, resets, equal, withoutMs: median(fresh),
    referenceCosts, repartition: profileOut ? repartition(profileOut) : null,
  });
  if (profileOut) {
    mkdirSync(profDir, { recursive: true });
    writeFileSync(join(profDir, `direct-calcul-${nom.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.cpuprofile`), JSON.stringify(profileOut));
  }
  console.error(`[direct-calcul] ${nom} : ${samples.length} calculs en ${fr(wallMs / 1000)} s`);
};

const t0All = performance.now();
const PASSAGES = [
  { nom: 'course', activityId: 'running', seuil: 'aucun', fixes: landFixes(DUREE_S, { speedMs: 3.3, radiusM: 1500, eleBaseM: 80, eleAmpM: 30, seed: 21 }) },
  { nom: 'vélo', activityId: 'cycling', seuil: 'aucun', fixes: landFixes(DUREE_S, { speedMs: 8, radiusM: 4000, eleBaseM: 100, eleAmpM: 60, seed: 31 }) },
  { nom: 'voile', activityId: 'wingfoil', seuil: 'allure', fixes: sailFixes(DUREE_S) },
  { nom: 'voile, seuil alterné/60 s', activityId: 'wingfoil', seuil: 'alterne', fixes: sailFixes(DUREE_S) },
];
for (const p of PASSAGES) await run(p);

// --- Tableau ---
const heures = (s) => (s < 3600 ? `${s / 60} min` : `${s / 3600} h`);
console.log(`Coût d'un calcul du direct, avec mémoire, un calcul toutes les ${STEP} positions à 1 Hz, trace de ${heures(DUREE_S)} (ms : médiane / 95e centile, fenêtres de ±${HALF_WINDOW_S / 60} min).`);
console.log(`| Famille | ${CENTRES_S.map((c) => `autour de ${heures(Math.min(c, DUREE_S))}`).join(' | ')} | cumul | calculs | remises à zéro | égalité | sans mémoire |`);
console.log(`|---|${CENTRES_S.map(() => '---').join('|')}|---|---|---|---|---|`);
for (const r of results) {
  const cells = r.windows.map((w) => `${fr(w.median)} / ${fr(w.p95)}`);
  console.log(`| ${r.nom} | ${cells.join(' | ')} | ${fr(r.cumulMs / 1000)} s | ${r.calls} | ${r.resets.reglages + r.resets.segment} (réglages ${r.resets.reglages}, segment ${r.resets.segment}) | ${r.equal ? 'oui' : 'NON'} | ${fr(r.withoutMs)} ms |`);
}
for (const r of results) {
  const w = r.windows.at(-1);
  const seuilA = w.median !== null && w.median > 10 ? 'dépasse 10 ms' : 'sous 10 ms';
  console.log(`${r.nom} : plus long calcul de la dernière fenêtre ${fr(w.max)} ms ; médiane ${seuilA} (seuil de la partie A)${r.referenceCosts.length ? ` ; allure remesurée ${r.referenceCosts.length} fois, ${fr(median(r.referenceCosts))} ms (médiane), ${fr(r.referenceCosts.reduce((a, x) => a + x, 0) / 1000)} s en tout, hors des temps ci-dessus` : ''}`);
}
if (profDir) {
  if (!results.some((r) => r.repartition)) console.log('(aucun profil)');
  for (const r of results) {
    if (!r.repartition) continue;
    const { total, groups, others } = r.repartition;
    console.log(`\nRépartition du temps par fichier source, ${r.nom} (temps gonflé par le profileur) :`);
    const line = ([name, us]) => `${pct(us, total)} ${fr(us / 1000, 0).padStart(7)} ms  ${name}`;
    for (const entry of groups) console.log(`  ${line(entry)}`);
    const othersTotal = [...others.values()].reduce((a, x) => a + x, 0);
    console.log(`  ${line(['autres', othersTotal])}`);
    for (const entry of [...others].sort((x, y) => y[1] - x[1]).slice(0, 6)) console.log(`      ${line(entry)}`);
  }
  console.log(`\nProfils écrits dans ${profDir}`);
}
console.error(`[direct-calcul] durée totale ${fr((performance.now() - t0All) / 1000)} s`);
if (failures > 0) { console.log(`${failures} égalité(s) en échec.`); process.exit(1); }
console.log('Tout est passé : le résultat avec mémoire égale celui sans mémoire.');
process.exit(0);

