// Diagnostic des virages d'une session de surf (lot 40) : la trace est relue
// par la chaîne de l'application (lecture du GPX, cinématique du calcul, seuil
// de la session), les vagues sont celles de l'onglet « vagues »
// (`runSurfSession`), et chacune reçoit ses virages du GPS (`gpsTurns.ts`) et
// du gyroscope (`gyroTurns.ts`, sur la capture des capteurs `.imu`). Sert à
// régler `SurfProfile.gyroTurns` sur de vraies séances (essai 46).
//
//   node outils/banc/virages-diagnostic.mjs <fichier .imu> <fichier .gpx> [--support=surf] [--foil] [--seuil=9] [--vague=10] [--detail] [--tranches=60]
//
// Node 22.18 ou plus : le TypeScript de l'application est chargé tel quel, par
// le crochet de `charge-ts.mjs`. Les vraies séances restent hors du dépôt
// (dossier mémoire de l'utilisateur) : les chemins se donnent en argument.
//
// `--seuil` est le seuil de la glisse (vague, ou vol sur foil) en km/h, sinon
// celui du profil ; `--vague` le seuil de vague sur foil, sinon celui du
// profil. Sont imprimés : les constantes, l'état de la capture, puis par vague
// l'heure, la durée, la distance, la couverture par la capture, les virages
// du GPS et du gyroscope, la rotation la plus vive et le cap parcouru. Avec
// `--detail`, chaque retournement trouvé (compté ou écarté, le temps le plus
// court où le buste a tourné de `minDeg`). Avec `--tranches=60`, la capture entière découpée en tranches de
// 60 s, traitées comme des vagues : ce que le calcul compterait hors des
// vagues (attente, rame), qui doit rester rare.

import './charge-ts.mjs';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DOMParser = require('@xmldom/xmldom').DOMParser;

const src = new URL('../../src/', import.meta.url);
const load = (path) => import(new URL(path, src).href);
const { parseGpx } = await load('core/gpxParser.ts');
const { computeKinematics } = await load('core/kinematics.ts');
const { kinematicsOptionsOf } = await load('core/sessionSpeed.ts');
const { SPORT_PROFILES } = await load('core/sportProfiles.ts');
const { buildCumulativeTrack } = await load('core/sessionStats.ts');
const { decodeImu, imuCaptureStats } = await load('core/imuFile.ts');
const { capturedWindows } = await load('core/pumping.ts');
const { wallMsOf } = await load('core/imuVertical.ts');
const { runSurfSession, surfProfileOf } = await load('surfing/surfSession.ts');
const { waveTurnTrace } = await load('surfing/gyroTurns.ts');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [key, value] = a.slice(2).split('=');
  return [key, value ?? true];
}));
const [imuPath, gpxPath] = args.filter((a) => !a.startsWith('--'));
const usage = 'Usage : node outils/banc/virages-diagnostic.mjs <fichier .imu> <fichier .gpx> [--support=surf] [--foil] [--seuil=9] [--vague=10] [--detail] [--tranches=60]';
if (!imuPath || !gpxPath) {
  console.error(usage);
  process.exit(1);
}
const support = typeof flags.support === 'string' ? flags.support : 'surf';
const profile = surfProfileOf(SPORT_PROFILES[support] ?? SPORT_PROFILES.surf);
if (!profile || !SPORT_PROFILES[support]) {
  console.error(`Support sans vagues : ${support}`);
  process.exit(1);
}
const D = profile.surf.gyroTurns;
const foil = flags.foil === true;

const r0 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : String(Math.round(x)));
const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (Math.round(x * 10) / 10).toFixed(1));
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });

// --- Capture ---
const rec = await decodeImu(new Uint8Array(readFileSync(imuPath)));
if (!rec) {
  console.error('Fichier illisible : pas un fichier des capteurs de Tracker.');
  process.exit(1);
}
const stats = imuCaptureStats(rec);
const windows = capturedWindows(rec);
console.log(`Capture : ${imuPath} (${r1(statSync(imuPath).size / 1024 / 1024)} Mo), ${rec.header.setup.placement}, ${rec.header.setup.foil ? 'foil' : 'sans foil'}`);
console.log(`  ${r1(stats.durationS / 60)} min de ${stats.startMs ? hhmmss(stats.startMs) : '?'}, ${windows.length} fenêtre(s) mesurée(s)${rec.header.windows ? ' (élaguée)' : ''}`);
for (const s of stats.streams) console.log(`  ${s.kind} : ${s.count} mesures, ${r1(s.rateHz)} Hz, plus long trou ${r1(s.longestGapS)} s`);
for (const [a, b] of windows) console.log(`  fenêtre ${hhmmss(wallMsOf(rec, a))} → ${hhmmss(wallMsOf(rec, b))}`);

// --- Trace, comme `useGpxSession` hors voile (filtres du calcul, sans mise à l'allure) ---
const { rawPoints } = parseGpx(readFileSync(gpxPath, 'utf8'));
const track = computeKinematics(rawPoints, kinematicsOptionsOf(profile, { scaleToSession: false, referenceMs: 0 }));
if (track.length < 2) {
  console.error('Trace vide ou illisible.');
  process.exit(1);
}
const cum = buildCumulativeTrack(track);
const threshold = flags.seuil !== undefined ? Number(flags.seuil) : foil ? profile.surf.foilActiveThreshold : profile.defaultActiveThreshold;
const waveThreshold = flags.vague !== undefined ? Number(flags.vague) : null;
const { analysis } = runSurfSession(track, cum, profile, { threshold, foil, waveThreshold });
console.log(`GPX : ${gpxPath}, ${track.length} points, de ${hhmmss(track[0].timeMs)} à ${hhmmss(track[track.length - 1].timeMs)}`);
console.log(`  écart des débuts capture − GPX : ${r1((stats.startMs - track[0].timeMs) / 1000)} s`);
console.log(`Réglages (${support}${foil ? ', foil' : ''}) : seuil ${threshold} km/h${foil ? `, vague ${waveThreshold ?? profile.surf.foilWaveThreshold} km/h` : ''} ; GPS ${profile.surf.turnMinDeg}° ;`
  + ` gyroscope ${D.minDeg}° à ${D.minRateDegS}°/s de moyenne au moins, lissage ${D.smoothingS} s, marge ${D.leadS} s`);

/** Une ligne par passage : virages du gyroscope, rotation la plus vive, cap parcouru. */
const describe = (span) => {
  const trace = waveTurnTrace(rec, D, span, windows);
  if (!trace) return { trace, text: 'hors capture' };
  let peak = 0;
  let travel = 0;
  for (let k = 0; k < trace.rateDeg.length; k++) {
    peak = Math.max(peak, Math.abs(trace.rateDeg[k]));
    if (k > 0) travel += Math.abs(trace.heading[k] - trace.heading[k - 1]);
  }
  const counted = trace.changes.filter((c) => c.counted).length;
  return { trace, counted, text: `gyro ${counted}  (${trace.changes.length - counted} écarté(s), pointe ${r0(peak)}°/s, cap parcouru ${r0(travel)}°)` };
};
const detail = (trace) => {
  if (!flags.detail || !trace) return;
  for (const c of trace.changes) {
    const turned = trace.heading[c.until] - trace.heading[c.from];
    console.log(`      ${hhmmss(trace.startMs + c.from * trace.dt * 1000)}  ${c.direction > 0 ? 'gauche' : 'droite'} ${r0(Math.abs(turned))}° en ${r1((c.until - c.from) * trace.dt)} s,`
      + ` ${c.counted ? `${D.minDeg}° en ${r1(c.fastestS)} s : compté` : `jamais ${D.minDeg}° en ${r1(D.minDeg / D.minRateDegS)} s : écarté (rotation lente)`}`);
  }
};

const waves = analysis.waves;
console.log(`\nVagues : ${waves.length}`);
if (waves.length > 0) console.log('  n°  heure     durée  distance  GPS  gyroscope');
let gyroTotal = 0;
let gpsTotal = 0;
for (const w of waves) {
  const { trace, counted, text } = describe(w);
  gpsTotal += w.turns;
  if (trace) gyroTotal += counted;
  console.log(`  ${String(w.n).padStart(3)} ${hhmmss(w.startMs)}  ${r0(w.durationS).padStart(4)} s  ${r0(w.distanceM).padStart(5)} m  ${String(w.turns).padStart(3)}  ${text}`);
  detail(trace);
}
if (waves.length > 0) console.log(`  total : GPS ${gpsTotal}, gyroscope ${gyroTotal} (vagues couvertes seulement)`);

const sliceS = flags.tranches === true ? 60 : Number(flags.tranches);
if (flags.tranches !== undefined && sliceS > 0) {
  console.log(`\nCapture entière par tranches de ${sliceS} s (hors vagues comprises) :`);
  let total = 0;
  for (const [a, b] of windows) {
    // Au millième près : l'aller-retour entre heure et instant du fichier ne doit pas sortir de la fenêtre.
    const from = Math.ceil(wallMsOf(rec, a));
    const to = Math.floor(wallMsOf(rec, b));
    for (let t = from; t < to; t += sliceS * 1000) {
      const span = { startMs: t, endMs: Math.min(to, t + sliceS * 1000) };
      const { trace, counted, text } = describe(span);
      if (trace) total += counted;
      if (!trace || counted > 0 || flags.detail) {
        console.log(`  ${hhmmss(span.startMs)}  ${text}`);
        detail(trace);
      }
    }
  }
  console.log(`  total : ${total} virage(s) du gyroscope sur la capture entière (tranches sans virage tues, sauf --detail)`);
}
