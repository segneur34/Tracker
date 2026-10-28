// Diagnostic des manœuvres et des vols d'une session de voile : la trace est
// relue par la chaîne de l'application (lecture du GPX, filtres accordés à
// l'allure, seuils de la session, estimation du vent, deux passes de
// détection), pour recaler la détection sur de vraies séances.
//
//   node outils/banc/manoeuvres-diagnostic.mjs <gpx> [--support=wingfoil] [--seuil=7] [--vent=321] [--ecartes]
//
// Node 22.18 ou plus : le TypeScript de l'application est chargé tel quel,
// par le crochet de `charge-ts.mjs`. Les vraies séances restent hors du dépôt
// (dossier mémoire de l'utilisateur) : le chemin se donne en argument.
//
// `--seuil` est le seuil d'activité de la session (sa fiche), sinon la
// suggestion de l'application ; `--vent` le vent saisi, sinon le vent estimé.
// Sont imprimés : allure et seuils, ratio de l'application, part de vol par
// seuil de 5 à 10 nd, chronologie des vols, vent estimé, chaque manœuvre
// comptée, les demi-tours hors vol et les tours complets écartés ; avec
// `--ecartes`, tous les virages écartés, par motif. Les caps « de contrôle »
// d'une manœuvre sont relus par l'outil (médianes de 10 à 2 s avant la
// rotation et de 1 à 8 s après la sortie) : ils ne viennent pas de la
// détection et servent à la vérifier.

import './charge-ts.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DOMParser = require('@xmldom/xmldom').DOMParser;

const src = new URL('../../src/', import.meta.url);
const load = (path) => import(new URL(path, src).href);
const { parseGpx } = await load('core/gpxParser.ts');
const { computeKinematics } = await load('core/kinematics.ts');
const { referenceSpeedMs, sessionFilterThresholds } = await load('core/sessionSpeed.ts');
const { SPORT_PROFILES, hasActiveThreshold } = await load('core/sportProfiles.ts');
const { thresholdActivityMask } = await load('core/sessionStats.ts');
const { median } = await load('core/speedFilter.ts');
const { msToKnots } = await load('core/units.ts');
const { trackToPointData } = await load('utils/kinematics.ts');
const { sessionManeuverThresholds, suggestActiveThresholdKn } = await load('sailing/sailingConfig.ts');
const { analyzeManeuvers, estimateWind, windSamplesFrom, WIND_LOCAL_MAX_GAP_MIN } = await load('sailing/maneuvers.ts');
const { buildSailingSessionStats } = await load('sailing/sailingStats.ts');
const { angleDiff, buildWindTimeline, normalizeAngle } = await load('sailing/wind.ts');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [key, value] = a.slice(2).split('=');
  return [key, value ?? true];
}));
const [gpxPath] = args.filter((a) => !a.startsWith('--'));
if (!gpxPath) {
  console.error('Usage : node outils/banc/manoeuvres-diagnostic.mjs <gpx> [--support=wingfoil] [--seuil=7] [--vent=321] [--ecartes]');
  process.exit(1);
}
const support = typeof flags.support === 'string' ? flags.support : 'wingfoil';
const profile = SPORT_PROFILES[support];
if (!profile) {
  console.error(`Support inconnu : ${support}`);
  process.exit(1);
}

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
const pts = trackToPointData(track);
if (pts.length < 2) {
  console.error('Trace vide ou illisible.');
  process.exit(1);
}
const refKn = msToKnots(refMs);
const withThreshold = hasActiveThreshold(profile);
const fixedKn = profile.withoutActiveThreshold?.maneuverSuccess ?? null;
const seuil = fixedKn ?? (flags.seuil !== undefined ? Number(flags.seuil) : suggestActiveThresholdKn(support, refKn));
const mt = sessionManeuverThresholds(support, refKn);

const t0 = pts[0].timeMs;
const totalS = (pts[pts.length - 1].timeMs - t0) / 1000;
const clock = (ms) => {
  const s = Math.round((ms - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(3)}:${String(s % 60).padStart(2, '0')}`;
};
const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (Math.round(x * 10) / 10).toFixed(1));
const deg = (x) => (x === null || x === undefined ? '—' : String(Math.round(normalizeAngle(x))).padStart(3));
const pct = (part, whole) => (whole > 0 ? `${Math.round((100 * part) / whole)} %` : '—');
const stepS = (i) => (pts[i].timeMs - pts[i - 1].timeMs) / 1000;
const minutes = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`;

console.log(`Fichier : ${gpxPath}`);
console.log(`Points ${pts.length}, durée ${minutes(totalS)}, support ${support}`);
console.log(`Allure ${r1(refKn)} nd ; seuil ${r1(seuil)} nd${fixedKn !== null ? ' (fixe, sans seuil d\'activité)' : flags.seuil !== undefined ? ' (donné)' : ' (suggestion)'} ; entrée minimale ${r1(mt.minEntrySpeedKn)} nd ; polaire dès ${r1(mt.polarMinSpeedKn)} nd`);

// --- Ratio de l'application, et ce qu'il vaudrait sur d'autres dénominateurs ---
const stats = buildSailingSessionStats(track, { sport: support, activeThresholdKn: seuil });
const motionMask = thresholdActivityMask(track, profile, 0);
let motionS = 0;
for (let i = 1; i < pts.length; i++) if (motionMask[i]) motionS += stepS(i);
console.log(`Ratio de l'application : ${stats.activeRatio} % (temps actif ${stats.activeTime}, total ${stats.totalTime}${stats.inMotionTimeS !== undefined ? `, en mouvement ${minutes(stats.inMotionTimeS)}` : ''})`);
console.log(`En mouvement (plancher d'arrêt) : ${minutes(motionS)} ; à l'arrêt : ${minutes(totalS - motionS)}`);

if (withThreshold) {
  console.log('Part active par seuil (sur le total / sur le temps en mouvement) :');
  for (const kn of [5, 6, 7, 8, 9, 10]) {
    const m = thresholdActivityMask(track, profile, kn);
    let s = 0;
    for (let i = 1; i < pts.length; i++) if (m[i]) s += stepS(i);
    console.log(`  ${String(kn).padStart(2)} nd : ${pct(s, totalS).padStart(5)} / ${pct(s, motionS).padStart(5)}`);
  }

  // Chronologie des vols, au seuil de la session.
  const mask = thresholdActivityMask(track, profile, seuil);
  const flights = [];
  let current = null;
  for (let i = 0; i < pts.length; i++) {
    if (mask[i] && !current) current = { from: i, to: i };
    else if (mask[i] && current) current.to = i;
    else if (!mask[i] && current) { flights.push(current); current = null; }
  }
  if (current) flights.push(current);
  console.log(`Suites au-dessus du seuil : ${flights.length}`);
  for (const f of flights) {
    console.log(`  ${clock(pts[f.from].timeMs)} → ${clock(pts[f.to].timeMs)}  ${Math.round((pts[f.to].timeMs - pts[f.from].timeMs) / 1000)} s`);
  }
}

// --- Vent, comme `useSailingSession` ---
const flightThresholdKn = withThreshold ? seuil : undefined;
const estimate = estimateWind(pts, {
  minSpeedKn: mt.polarMinSpeedKn,
  successThresholdKn: seuil,
  minEntrySpeedKn: mt.minEntrySpeedKn,
  flightThresholdKn,
});
console.log(`Vent estimé ${estimate.direction}° (confiance ${r1(estimate.confidence)}, ${estimate.reliable ? 'fiable' : 'peu fiable'}, orienté par ${estimate.orientedBy}, ${estimate.maneuverCount} manœuvre(s) à caps stabilisés)`);
const wind = flags.vent !== undefined ? Number(flags.vent) : estimate.direction;
console.log(`Vent retenu ${wind}°${flags.vent !== undefined ? ' (donné)' : ' (estimé)'}`);

const options = { successThresholdKn: seuil, minEntrySpeedKn: mt.minEntrySpeedKn, flightThresholdKn };
const firstPass = analyzeManeuvers(pts, wind, options);
const timeline = buildWindTimeline(
  windSamplesFrom(firstPass).map((m) => ({ timeMs: m.timeMs, direction: m.localWind })),
  wind,
  WIND_LOCAL_MAX_GAP_MIN * 60 * 1000
);
const result = analyzeManeuvers(pts, timeline, options);
const counted = result.locations.length;
const failed = result.tackFail + result.jibeFail;
console.log(`\nManœuvres : ${counted} (virements ${result.tackSuccess} ok / ${result.tackFail} ratés, empannages ${result.jibeSuccess} ok / ${result.jibeFail} ratés ; ${pct(counted - failed, counted)} réussies)`);
console.log(`Écartés : ${JSON.stringify(result.rejected)}`);

// Caps de contrôle, relus par l'outil : médiane des caps déroulés entre deux instants.
const medianHeading = (fromMs, toMs) => {
  const headings = [];
  for (const p of pts) if (p.timeMs >= fromMs && p.timeMs <= toMs) headings.push(p.bearing);
  if (headings.length === 0) return null;
  const ref = headings[0];
  return normalizeAngle(ref + median(headings.map((h) => angleDiff(h, ref))));
};
const side = (heading, windDeg) => (angleDiff(heading, windDeg) < 0 ? 'G' : 'D');

console.log('  n   début  repère  type  ok   entrée  vmin  cons  relance  cap°  ctrl avant→après  côtés  bissectrice  vent loc  stab  vol avant/après');
const mask = withThreshold ? thresholdActivityMask(track, profile, seuil) : null;
const flyingAt = (index) => (mask ? (mask[Math.max(0, Math.min(mask.length - 1, index))] ? 'vol' : 'non') : '—');
result.locations.forEach((m, n) => {
  const windDeg = typeof timeline === 'function' ? timeline(m.timeMs) : timeline;
  const entryMs = pts[m.entryIndex].timeMs;
  const exitMs = pts[m.exitIndex].timeMs;
  const before = medianHeading(entryMs - 10000, entryMs - 2000);
  const after = medianHeading(exitMs + 1000, exitMs + 8000);
  const sides = before === null || after === null ? '—' : `${side(before, windDeg)}→${side(after, windDeg)}`;
  const bisector = m.type === 'tack' ? m.localWind : m.localWind + 180;
  let k = m.entryIndex;
  while (k > 0 && pts[k].timeMs > entryMs - 6000) k--;
  console.log(
    `${String(n + 1).padStart(3)}  ${clock(entryMs)}  ${clock(m.timeMs)}  ${m.type.padEnd(4)}  ${m.success ? 'ok' : 'KO'}  ${r1(m.entrySpeed).padStart(6)}  ${r1(m.vmin).padStart(4)}  ${r1(m.conservation).padStart(4)}  ${String(m.relaunchS === null ? '—' : Math.round(m.relaunchS)).padStart(7)}  ${String(Math.round(m.headingChange)).padStart(4)}  ${deg(before)} → ${deg(after)}          ${sides.padEnd(5)}  ${deg(bisector)}          ${deg(m.localWind)}       ${m.stableHeadings ? 'oui' : 'non'}   ${flyingAt(k)}/${flyingAt(m.exitIndex)}`
  );
});

// --- Demi-tours hors vol et tours complets, puis tous les écartés ---
const rejectedTurns = result.rejectedTurns;
const label = { noFlight: 'demi-tour hors vol', fullTurn: 'tour complet', unclassified: 'non classé', incoherent: 'incohérent', slowEntry: 'entrée lente', tooShort: 'sur place' };
const describe = (r) =>
  `  ${clock(r.timeMs)}  ${(label[r.motif] ?? r.motif).padEnd(18)}  virage ${String(Math.round(r.turnDeg)).padStart(4)}°  vitesse ${r1(r.speedKn).padStart(5)} nd${r.type ? `  (${r.type === 'tack' ? 'virement' : 'empannage'})` : ''}`;
if (!rejectedTurns) {
  console.log('\nDemi-tours hors vol, tours complets, écartés : non disponibles dans cette version de l\'application.');
} else {
  const noFlight = rejectedTurns.filter((r) => r.motif === 'noFlight');
  const fullTurns = rejectedTurns.filter((r) => r.motif === 'fullTurn');
  console.log(`\nDemi-tours hors vol : ${noFlight.length}`);
  noFlight.forEach((r) => console.log(describe(r)));
  console.log(`Tours complets écartés : ${fullTurns.length}`);
  fullTurns.forEach((r) => console.log(describe(r)));
  if (flags.ecartes) {
    console.log('\nVirages écartés, par motif (un par virage compté dans les rejets) :');
    for (const motif of ['unclassified', 'incoherent', 'slowEntry', 'tooShort']) {
      const list = rejectedTurns.filter((r) => r.motif === motif);
      console.log(`${label[motif]} : ${list.length}`);
      list.forEach((r) => console.log(describe(r)));
    }
  }
}
