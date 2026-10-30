// Diagnostic du pumping d'une session de voile sur foil (lot 22) : la trace est
// relue par la chaîne de l'application (lecture du GPX, filtres accordés à
// l'allure, seuil de la session), les vols sont ceux de l'onglet « pumping »
// (`sailingFlights`), et le pumping de chacun est mesuré sur la capture des
// capteurs (`.imu`) par le calcul de l'application (`core/pumping.ts`). Sert à
// régler `SAILING_PUMP_DETECTION` sur de vraies séances.
//
//   node outils/banc/pumping-diagnostic.mjs <gpx> <imu> [--support=wingfoil] [--seuil=7] [--min-vol=10] [--coups]
//
// Node 22.18 ou plus : le TypeScript de l'application est chargé tel quel, par
// le crochet de `charge-ts.mjs`. Les vraies séances restent hors du dépôt
// (dossier mémoire de l'utilisateur) : les chemins se donnent en argument.
//
// `--seuil` est le seuil d'activité de la session (sa fiche), sinon la
// suggestion de l'application ; `--min-vol` la durée minimale d'un vol listé,
// sinon celle du profil. Sont imprimés : l'état de la capture (fenêtres
// gardées, si elle est élaguée), puis par vol l'heure, la durée, la part
// couverte par la capture, le décollage et sa vitesse, les coups, la
// fréquence, le temps pompé et la distance par coup ; enfin les coups trouvés
// autour de chaque saut (faux coups possibles : les chocs d'un saut font
// osciller l'accélération comme une pompe). Avec `--coups`, l'accélération
// verticale lissée, privée de sa dérive, crête à crête par tranche de 5 s dans
// les vols couverts, à comparer à `strokeMinG` (un coup : de −strokeMinG à
// +strokeMinG, soit un crête à crête d'au moins 2 × strokeMinG).

import './charge-ts.mjs';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DOMParser = require('@xmldom/xmldom').DOMParser;

const src = new URL('../../src/', import.meta.url);
const load = (path) => import(new URL(path, src).href);
const { parseGpx } = await load('core/gpxParser.ts');
const { computeKinematics } = await load('core/kinematics.ts');
const { referenceSpeedMs, sessionFilterThresholds } = await load('core/sessionSpeed.ts');
const { SPORT_PROFILES } = await load('core/sportProfiles.ts');
const { buildCumulativeTrack } = await load('core/sessionStats.ts');
const { decodeImu, imuCaptureStats } = await load('core/imuFile.ts');
const { centredMean, fileUsOf, verticalAcceleration, wallMsOf } = await load('core/imuVertical.ts');
const { capturedWindows, measureFlightPumping, pumpSeries, pumpStrokes, summarizePumping } = await load('core/pumping.ts');
const { measureJumps } = await load('core/jumps.ts');
const { msToKnots } = await load('core/units.ts');
const { suggestActiveThresholdKn } = await load('sailing/sailingConfig.ts');
const { sailingFlights } = await load('sailing/sailingStats.ts');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [key, value] = a.slice(2).split('=');
  return [key, value ?? true];
}));
const [gpxPath, imuPath] = args.filter((a) => !a.startsWith('--'));
if (!gpxPath || !imuPath) {
  console.error('Usage : node outils/banc/pumping-diagnostic.mjs <gpx> <imu> [--support=wingfoil] [--seuil=7] [--min-vol=10] [--coups]');
  process.exit(1);
}
const support = typeof flags.support === 'string' ? flags.support : 'wingfoil';
const profile = SPORT_PROFILES[support];
if (!profile?.pump) {
  console.error(`Support sans pumping : ${support}`);
  process.exit(1);
}
const P = profile.pump;

// --- Trace, comme `useGpxSession` (filtres accordés à l'allure) et `useSailingSession` ---
const { rawPoints } = parseGpx(readFileSync(gpxPath, 'utf8'));
const refMs = referenceSpeedMs(rawPoints);
const scaled = sessionFilterThresholds(refMs, profile.maxPlausibleSpeedMs ?? Infinity);
const track = computeKinematics(rawPoints, {
  medianWindowSeconds: profile.medianWindowSeconds,
  maxDetourRatio: profile.maxDetourRatio,
  maxAcceleration: scaled.maxAcceleration,
  maxSpeedMs: scaled.maxSpeedMs,
  maxGapS: profile.maxGapS,
});
if (track.length < 2) {
  console.error('Trace vide ou illisible.');
  process.exit(1);
}
const cum = buildCumulativeTrack(track);
const seuil = flags.seuil !== undefined ? Number(flags.seuil) : suggestActiveThresholdKn(support, msToKnots(refMs));
const minVol = flags['min-vol'] !== undefined ? Number(flags['min-vol']) : P.minFlightS;

const t0 = track[0].timeMs;
const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (Math.round(x * 10) / 10).toFixed(1));
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (Math.round(x * 100) / 100).toFixed(2));
const clock = (ms) => {
  const s = Math.round((ms - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(3)}:${String(s % 60).padStart(2, '0')}`;
};
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
const minutes = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`;
const pct = (part, whole) => (whole > 0 ? `${Math.round((100 * part) / whole)} %` : '—');

console.log(`GPX : ${gpxPath}`);
console.log(`Points ${track.length}, de ${hhmmss(t0)}, durée ${minutes((track[track.length - 1].timeMs - t0) / 1000)}, support ${support}`);
console.log(`Seuil d'activité ${r1(seuil)} nd${flags.seuil !== undefined ? ' (donné)' : ' (suggestion)'} ; vols listés dès ${minVol} s`);
console.log(`Seuils du pumping : coup à ±${P.strokeMinG} g (lissage ${P.strokeSmoothingS} s, dérive ${P.strokeBaselineS} s), ${P.strokeMinPeriodS} à ${P.strokeMaxGapS} s entre deux coups, série dès ${P.minSeriesStrokes} coups ; décollage : calme sous ${P.liftoffCalmG} g pendant ${P.liftoffCalmS} s, cherché de −${P.liftoffSearchBeforeS} à +${P.liftoffSearchAfterS} s`);

// --- Capture ---
const rec = await decodeImu(new Uint8Array(readFileSync(imuPath)));
if (!rec) {
  console.error('Fichier des capteurs illisible.');
  process.exit(1);
}
const stats = imuCaptureStats(rec);
const windows = capturedWindows(rec);
const keptS = windows.reduce((s, [a, b]) => s + (b - a) / 1e6, 0);
console.log(`\nCapteurs : ${imuPath} (${r2(statSync(imuPath).size / 1024 / 1024)} Mo)`);
console.log(`Réglages : ${rec.header.setup.placement}, ${rec.header.setup.foil ? 'foil' : 'sans foil'}, sauts ${rec.header.setup.jumps === false ? 'non' : 'oui'}${rec.header.windows ? `, élaguée (${rec.header.windows.length} fenêtres)` : ', entière'}`);
for (const s of stats.streams) console.log(`  ${s.kind} : ${s.count} mesures, ${r1(s.rateHz)} Hz, plus long trou ${r2(s.longestGapS)} s`);
console.log(`Mesuré : ${minutes(keptS)}${rec.header.windows ? ` sur ${minutes(stats.durationS)} d'enregistrement` : ''}`);
for (const [a, b] of windows) console.log(`  fenêtre ${clock(wallMsOf(rec, a))} → ${clock(wallMsOf(rec, b))} (${r1((b - a) / 1e6)} s)`);

// --- Vols et pumping ---
const flights = sailingFlights(track, cum, support, seuil, minVol);
const pumping = measureFlightPumping(rec, P, track, cum, flights);
const flightS = flights.reduce((s, f) => s + f.durationS, 0);
const coveredOf = (f) => {
  const from = fileUsOf(rec, f.startMs);
  const to = fileUsOf(rec, f.endMs);
  return windows.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0) / 1e6;
};
const coveredS = flights.reduce((s, f) => s + coveredOf(f), 0);
console.log(`\nVols : ${flights.length}, ${minutes(flightS)} en vol ; capteurs sur ${minutes(coveredS)} (${pct(coveredS, flightS)}) ; vols touchés : ${pumping.filter((x) => x !== null).length}`);
console.log('    n  début    heure     durée  couvert   décollage      coups  /min  pompé   m/coup');
flights.forEach((f, k) => {
  const p = pumping[k];
  const cov = coveredOf(f);
  if (cov === 0 && !flags.tous) return;
  const lift = p?.liftoffMs != null ? `${clock(p.liftoffMs)} ${r1(msToKnots(p.takeoffSpeedMs))} nd` : '—';
  console.log(
    `  ${String(f.n).padStart(3)}  ${clock(f.startMs)}  ${hhmmss(f.startMs)}  ${r1(f.durationS).padStart(5)} s  ${pct(cov, f.durationS).padStart(5)}${p && !p.covered ? ' *' : '  '}  ${lift.padEnd(14)}`
    + `  ${p ? String(p.strokes).padStart(5) : '    —'}  ${p ? r1(p.strokesPerMin).padStart(4) : '   —'}  ${p ? r1(p.pumpS).padStart(5) : '    —'} s  ${p ? r1(p.perStrokeM) : '—'}`,
  );
});
const sum = summarizePumping(pumping);
console.log(`Total sur les vols touchés : ${sum.strokes} coups, ${r1(sum.pumpS)} s pompées, ${r1(sum.strokesPerMin)} /min, ${r1(sum.perStrokeM)} m par coup`);
if (!flags.tous) console.log('(vols hors capture omis : --tous pour les lister)');

// --- Coups autour des sauts : faux coups possibles ---
const jumpDetection = profile.jumps?.detection;
if (jumpDetection) {
  const { jumps } = measureJumps(rec, jumpDetection, track, cum.cumDist);
  console.log(`\nSauts rangés : ${jumps.length} ; coups trouvés de 3 s avant le décollage à 3 s après l'arrivée`);
  for (const j of jumps) {
    const v = verticalAcceleration(rec, P, fileUsOf(rec, j.takeoffMs - 13_000), fileUsOf(rec, j.landingMs + 13_000));
    if (!v) continue;
    const at = (ms) => Math.round((fileUsOf(rec, ms) - v.startUs) / v.stepUs);
    const strokes = pumpStrokes(v, at(j.takeoffMs - 3000), at(j.landingMs + 3000), P);
    const series = pumpSeries(strokes.map((i) => i * v.dt), P);
    const inSeries = series.reduce((s, x) => s + x.strokes, 0);
    const flight = flights.find((f) => j.takeoffMs >= f.startMs && j.takeoffMs <= f.endMs);
    console.log(`  ${clock(j.takeoffMs)}  ${r2(j.heightM)} m  ${r2(j.flightS)} s  ${flight ? `vol ${flight.n}` : 'hors vol'}  coups ${strokes.length}, en série ${inSeries}`);
  }
}

// --- Crête à crête de l'accélération lissée, par tranche de 5 s dans les vols couverts ---
if (flags.coups) {
  const sliceS = 5;
  console.log(`\nAccélération verticale lissée, sans dérive, crête à crête (g) par tranche de ${sliceS} s ; coups au seuil actuel`);
  for (const f of flights) {
    for (const [a, b] of windows) {
      const from = Math.max(a, fileUsOf(rec, f.startMs));
      const to = Math.min(b, fileUsOf(rec, f.endMs));
      if (to - from < sliceS * 1e6) continue;
      const v = verticalAcceleration(rec, P, from, to);
      if (!v) continue;
      const smooth = centredMean(v.aUp, Math.max(0, Math.round(P.strokeSmoothingS / v.dt / 2)));
      const base = centredMean(smooth, Math.max(0, Math.round(P.strokeBaselineS / v.dt / 2)));
      const step = Math.round(sliceS / v.dt);
      const cells = [];
      for (let i = 0; i + step <= v.n; i += step) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = i; k < i + step; k++) {
          const x = (smooth[k] - base[k]) / v.gLocal;
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        cells.push(`${r2(hi - lo)}/${pumpStrokes(v, i, i + step, P).length}`);
      }
      console.log(`  vol ${String(f.n).padStart(3)} ${clock(wallMsOf(rec, from))} : ${cells.join('  ')}`);
    }
  }
}
