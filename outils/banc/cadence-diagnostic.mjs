// Diagnostic de la cadence à pied sur une capture des capteurs (`.imu`) : état
// de la capture, puis la cadence telle que l'application la calcule
// (`src/running/cadence.ts`, `cadenceWindows`), fenêtre par fenêtre, rapprochée
// du GPX de la séance. Sert à régler les seuils de `CADENCE` sur de vraies
// sorties (lot 26).
//
//   node outils/banc/cadence-diagnostic.mjs <fichier .imu> [<fichier .gpx>] [--support=running]
//        [--seuil cle=valeur]… [--mouvement=3] [--lissage=5] [--par-minute]
//
// Node 22.18 ou plus : le lecteur du format, le calcul et les constantes sont
// ceux de l'application, chargés tels quels. Les vraies séances restent hors du
// dépôt (dossier mémoire de l'utilisateur) : leur chemin se donne en argument.
//
// Avec le GPX, chaque fenêtre (une par seconde) prend l'état de la trace à son
// instant : en mouvement si la vitesse du GPX (`gpxtpx:speed`), lissée sur
// `--lissage` secondes, atteint `--mouvement` km/h ; à l'arrêt en dessous ; en
// pause entre deux segments ou dans un trou de plus de `gapS` ; hors trace avant
// le premier point ou après le dernier. Il donne :
// - la couverture : part du temps en mouvement où une cadence est trouvée, et
//   part du temps à l'arrêt (et en pause) où une cadence est trouvée à tort ;
// - la distribution des cadences trouvées en mouvement ;
// - les comptes par motif (rejet, ou façon dont la période a été retenue) ;
// - l'écart à la cadence écrite dans le GPX (`gpxtpx:cad`, foulées par minute
//   × 2), celle que l'application a calculée le jour de la séance.
// `--seuil minCorrelation=0.4` (répétable, aussi `--seuil=cle=valeur`) surcharge
// une constante numérique de `CADENCE` pour rejouer sans toucher au code.

import './charge-ts.mjs';
import { readFileSync, statSync } from 'node:fs';

const t0 = performance.now();
const { decodeImu, imuCaptureStats } = await import('../../src/core/imuFile.ts');
const { cadenceWindows, cadenceAt } = await import('../../src/running/cadence.ts');
const { SPORT_PROFILES } = await import('../../src/core/sportProfiles.ts');

const USAGE = 'Usage : node outils/banc/cadence-diagnostic.mjs <fichier .imu> [<fichier .gpx>] [--support=running] [--seuil cle=valeur]… [--mouvement=3] [--lissage=5] [--par-minute]';

// --- Arguments : `--cle=valeur`, `--cle valeur` pour `--seuil`, chemins ---
const args = process.argv.slice(2);
const flags = {};
const seuils = [];
const paths = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { paths.push(a); continue; }
  const eq = a.indexOf('=');
  const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
  let value = eq < 0 ? undefined : a.slice(eq + 1);
  if (key === 'seuil') {
    if (value === undefined) value = args[++i];
    if (!value || !value.includes('=')) { console.error(`--seuil attend cle=valeur\n${USAGE}`); process.exit(1); }
    seuils.push(value);
  } else {
    flags[key] = value ?? true;
  }
}
const [imuPath, gpxPath] = paths;
if (!imuPath) { console.error(USAGE); process.exit(1); }
const support = typeof flags.support === 'string' ? flags.support : 'running';
const base = SPORT_PROFILES[support]?.cadence;
if (!base) { console.error(`Support sans cadence : ${support}`); process.exit(1); }
const params = { ...base };
for (const s of seuils) {
  const [key, raw] = s.split('=');
  const value = Number(raw.replace(',', '.'));
  if (typeof base[key] !== 'number') {
    console.error(`Seuil inconnu ou non numérique : ${key}. Possibles : ${Object.keys(base).filter((k) => typeof base[k] === 'number').join(', ')}`);
    process.exit(1);
  }
  if (!Number.isFinite(value)) { console.error(`Valeur illisible pour ${key} : ${raw}`); process.exit(1); }
  params[key] = value;
}
const movingKmh = Number(flags.mouvement ?? 3);
const smoothingS = Number(flags.lissage ?? 5);

// --- Mise en forme ---
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;
const fr = (x, n = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : round(x, n).toFixed(n).replace('.', ','));
const pct = (a, b) => (b > 0 ? `${fr((100 * a) / b)} %` : '–');
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
const duree = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
const quantile = (sorted, q) => {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const median = (values) => quantile([...values].sort((a, b) => a - b), 0.5);

// --- Capture ---
const rec = await decodeImu(new Uint8Array(readFileSync(imuPath)));
if (!rec) { console.error('Fichier illisible : pas un fichier des capteurs de Tracker.'); process.exit(1); }
const { header } = rec;
const stats = imuCaptureStats(rec);
console.log(`Fichier : ${imuPath} (${fr(statSync(imuPath).size / 1024 / 1024, 2)} Mo)`);
console.log(`Téléphone : ${header.device?.manufacturer ?? '?'} ${header.device?.model ?? '?'}, Android ${header.device?.android ?? '?'}`);
console.log(`Réglages : ${header.setup?.placement ?? '?'}${header.windows ? `, élagué (${header.windows.length} fenêtres)` : ''}`);
console.log(`Paquets : ${rec.chunks}${rec.truncated ? ', dernier tronqué' : ''}${rec.skippedChunks ? `, ${rec.skippedChunks} illisible(s)` : ''}`);
console.log(`Durée mesurée : ${duree(stats.durationS)}, de ${stats.startMs ? hhmmss(stats.startMs) : '?'}`);
for (const s of stats.streams) console.log(`  ${s.kind} : ${s.count} mesures, ${fr(s.rateHz)} Hz, plus long trou ${fr(s.longestGapS, 2)} s`);

// --- GPX : segments, instants, vitesse de l'enregistreur, cadence écrite ---
const segments = [];
if (gpxPath) {
  const text = readFileSync(gpxPath, 'utf8');
  const segRe = /<trkseg[^>]*>([\s\S]*?)<\/trkseg>/g;
  const ptRe = /<trkpt[^>]*>([\s\S]*?)<\/trkpt>/g;
  let sm;
  while ((sm = segRe.exec(text))) {
    const pts = [];
    let m;
    ptRe.lastIndex = 0;
    while ((m = ptRe.exec(sm[1]))) {
      const time = /<time>([^<]+)<\/time>/.exec(m[1]);
      if (!time) continue;
      const speed = /<(?:\w+:)?speed>([^<]+)<\/(?:\w+:)?speed>/.exec(m[1]);
      const cad = /<(?:\w+:)?cad>([^<]+)<\/(?:\w+:)?cad>/.exec(m[1]);
      pts.push({ timeMs: Date.parse(time[1]), speedMs: speed ? Number(speed[1]) : null, cad: cad ? Number(cad[1]) : null });
    }
    if (pts.length > 0) segments.push(pts);
  }
}
const points = segments.flat();
// Vitesse lissée : moyenne centrée sur `smoothingS`, dans le segment, des vitesses connues.
for (const seg of segments) {
  const half = (smoothingS * 1000) / 2;
  let a = 0;
  let b = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < seg.length; i++) {
    while (b < seg.length && seg[b].timeMs <= seg[i].timeMs + half) { if (seg[b].speedMs !== null) { sum += seg[b].speedMs; count++; } b++; }
    while (seg[a].timeMs < seg[i].timeMs - half) { if (seg[a].speedMs !== null) { sum -= seg[a].speedMs; count--; } a++; }
    seg[i].smoothedMs = count > 0 ? sum / count : null;
  }
}
if (gpxPath) {
  if (points.length === 0) console.log('GPX : aucun point daté');
  else {
    const imuEnd = stats.startMs + stats.durationS * 1000;
    console.log(`GPX : ${points.length} points en ${segments.length} segment(s), de ${hhmmss(points[0].timeMs)} à ${hhmmss(points[points.length - 1].timeMs)} ; écart des débuts ${fr((stats.startMs - points[0].timeMs) / 1000)} s, des fins ${fr((imuEnd - points[points.length - 1].timeMs) / 1000)} s`);
  }
}

// État de la trace à un instant : 'mouvement', 'arret', 'pause', 'hors' (ou 'sans' sans GPX).
const STATES = points.length > 0 ? ['mouvement', 'arret', 'pause', 'hors'] : ['sans'];
const STATE_LABEL = { mouvement: 'en mouvement', arret: "à l'arrêt", pause: 'en pause ou trou', hors: 'hors trace', sans: 'sans GPX' };
const indexed = segments.flatMap((seg, s) => seg.map((p) => ({ ...p, seg: s })));
let cursor = 0;
const stateAt = (timeMs) => {
  if (indexed.length === 0) return { state: 'sans', speedMs: null };
  if (timeMs < indexed[0].timeMs || timeMs > indexed[indexed.length - 1].timeMs) return { state: 'hors', speedMs: null };
  while (cursor < indexed.length - 1 && indexed[cursor + 1].timeMs < timeMs) cursor++;
  while (cursor > 0 && indexed[cursor].timeMs > timeMs) cursor--;
  const a = indexed[cursor];
  const b = indexed[Math.min(cursor + 1, indexed.length - 1)];
  if (b === a || b.seg !== a.seg || b.timeMs - a.timeMs > params.gapS * 1000) return { state: 'pause', speedMs: null };
  const va = a.smoothedMs;
  const vb = b.smoothedMs;
  if (va === null && vb === null) return { state: 'pause', speedMs: null };
  const f = b.timeMs > a.timeMs ? (timeMs - a.timeMs) / (b.timeMs - a.timeMs) : 0;
  const v = va === null ? vb : vb === null ? va : va + (vb - va) * f;
  return { state: v * 3.6 >= movingKmh ? 'mouvement' : 'arret', speedMs: v };
};

// --- Cadence, calcul de l'application ---
const started = performance.now();
const scan = cadenceWindows(rec, params);
const calcMs = performance.now() - started;
if (!scan) { console.error('Capture sans accéléromètre : pas de cadence.'); process.exit(1); }
const changed = seuils.length ? `, seuils changés : ${seuils.join(', ')}` : '';
console.log(`\nCalcul (${support}${changed}) : ${Math.round(calcMs)} ms, ${scan.windows.length} fenêtres de ${fr(params.windowS, 0)} s, une toutes les ${fr(scan.stepS, 2)} s`);
console.log(`Seuils : corrélation ${params.minCorrelation}, crête ${params.peakFraction}, demi-période ${params.halfPeriodFraction}, énergie ${params.minRmsMs2} m/s², foulée ${params.strideRmsMs2} m/s², ${params.minSpm} à ${params.maxSpm} pas/min, couverture ${params.minCoverage}`);
console.log(`Mouvement : vitesse du GPX lissée sur ${smoothingS} s, au moins ${movingKmh} km/h`);

const rows = scan.windows.map((w, k) => {
  const timeMs = scan.startMs + k * scan.stepS * 1000;
  return { ...w, timeMs, ...stateAt(timeMs) };
});
const byState = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.state === s)]));

// --- Couverture ---
console.log('\nCouverture (part des fenêtres avec une cadence) :');
for (const s of STATES) {
  const list = byState[s];
  const found = list.filter((r) => r.spm !== null).length;
  const note = s === 'mouvement' ? '' : s === 'hors' ? '' : ' (à tort)';
  console.log(`  ${STATE_LABEL[s].padEnd(17)} ${duree(list.length * scan.stepS).padStart(12)}  cadence trouvée ${pct(found, list.length)}${list.length && note ? note : ''}`);
}

// --- Distribution en mouvement (ou partout sans GPX) ---
const distState = STATES[0];
const spmMoving = byState[distState].filter((r) => r.spm !== null).map((r) => r.spm).sort((a, b) => a - b);
console.log(`\nCadences trouvées ${STATE_LABEL[distState]} : ${spmMoving.length}`);
if (spmMoving.length > 0) {
  const n = spmMoving.length;
  console.log(`  min ${fr(spmMoving[0])}, quartile ${fr(quantile(spmMoving, 0.25))}, médiane ${fr(quantile(spmMoving, 0.5))}, quartile ${fr(quantile(spmMoving, 0.75))}, max ${fr(spmMoving[n - 1])}`);
  console.log(`  sous 120 : ${pct(spmMoving.filter((v) => v < 120).length, n)}, 150 à 190 : ${pct(spmMoving.filter((v) => v >= 150 && v <= 190).length, n)}, au-dessus de 200 : ${pct(spmMoving.filter((v) => v > 200).length, n)}`);
  const bins = new Map();
  for (const v of spmMoving) { const b = Math.floor(v / 10) * 10; bins.set(b, (bins.get(b) ?? 0) + 1); }
  const hist = [...bins.entries()].sort((a, b) => a[0] - b[0]).filter(([, c]) => c / n >= 0.005).map(([b, c]) => `${b}:${fr((100 * c) / n, 0)}`);
  console.log(`  par tranche de 10 (%) : ${hist.join('  ')}`);
}

// --- Motifs ---
const REASONS = [
  ['trou', 'trou dans la capture'],
  ['energie', 'énergie trop faible'],
  ['courte', 'fenêtre trop courte'],
  ['correlation', 'corrélation trop faible'],
  ['hors-plage', 'hors plage (trop lent)'],
  ['pas', 'retenue : pas tel quel'],
  ['demi-periode', 'retenue : demi-période'],
  ['foulee-longue', 'retenue : foulée longue'],
  ['foulee-secousses', 'retenue : foulée, secousses'],
];
console.log('\nMotifs par fenêtre (part de chaque état ; en mouvement : corrélation, énergie et cadence médianes) :');
console.log(`  ${'motif'.padEnd(29)}${STATES.map((s) => STATE_LABEL[s].padStart(18)).join('')}   corr.  m/s²   pas/min`);
for (const [key, label] of REASONS) {
  const cells = STATES.map((s) => {
    const c = byState[s].filter((r) => r.reason === key).length;
    return (c ? `${c} (${pct(c, byState[s].length)})` : '·').padStart(18);
  });
  if (cells.every((c) => c.trim() === '·')) continue;
  const mov = byState[distState].filter((r) => r.reason === key);
  const mc = median(mov.map((r) => r.correlation).filter((v) => v !== null));
  const mr = median(mov.map((r) => r.rmsMs2).filter((v) => v !== null));
  const ms = median(mov.map((r) => r.spm).filter((v) => v !== null));
  console.log(`  ${label.padEnd(29)}${cells.join('')}   ${fr(mc, 2).padStart(5)}  ${fr(mr).padStart(5)}  ${fr(ms).padStart(7)}`);
}

// --- Écart à la cadence du GPX ---
const series = { startMs: scan.startMs, stepS: scan.stepS, spm: scan.windows.map((w) => w.spm) };
const withCad = points.filter((p) => p.cad !== null && p.cad > 0);
if (gpxPath) {
  if (withCad.length === 0) console.log('\nGPX : pas de cadence écrite (gpxtpx:cad).');
  else {
    const both = [];
    let gpxOnly = 0;
    let replayOnly = 0;
    for (const p of points) {
      const gpx = p.cad !== null && p.cad > 0 ? p.cad * 2 : null;
      const replay = cadenceAt(series, p.timeMs);
      if (gpx !== null && replay !== null) both.push(replay - gpx);
      else if (gpx !== null) gpxOnly++;
      else if (replay !== null) replayOnly++;
    }
    const abs = both.map(Math.abs);
    console.log(`\nCadence du GPX (cad × 2, ${withCad.length} points sur ${points.length}) : ${both.length} points mesurés des deux côtés, ${gpxOnly} au GPX seul, ${replayOnly} au calcul seul`);
    if (both.length > 0) {
      console.log(`  écart calcul − GPX : médian ${fr(median(both))}, médian absolu ${fr(median(abs))} pas/min ; à 2 près ${pct(abs.filter((v) => v <= 2).length, both.length)}, au-delà de 10 ${pct(abs.filter((v) => v > 10).length, both.length)}`);
    }
  }
}

// --- Par minute ---
if (flags['par-minute']) {
  console.log('\nPar minute : heure, part en mouvement, couverture en mouvement, médiane, premier motif de rejet en mouvement');
  const perMin = Math.max(1, Math.round(60 / scan.stepS));
  for (let k = 0; k < rows.length; k += perMin) {
    const slice = rows.slice(k, k + perMin);
    const mov = slice.filter((r) => r.state === distState);
    const found = mov.filter((r) => r.spm !== null);
    const rejects = new Map();
    for (const r of mov) if (r.spm === null) rejects.set(r.reason, (rejects.get(r.reason) ?? 0) + 1);
    const top = [...rejects.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`  ${hhmmss(slice[0].timeMs)}  ${pct(mov.length, slice.length).padStart(7)}  ${pct(found.length, mov.length).padStart(7)}  ${fr(median(found.map((r) => r.spm))).padStart(6)}  ${top ? `${top[0]} ${top[1]}` : ''}`);
  }
}

console.log(`\nDurée totale : ${fr((performance.now() - t0) / 1000)} s`);
