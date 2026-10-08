// Diagnostic d'une capture des capteurs (`.imu`) : état de la capture (cadence,
// trous, taille, horloges), puis les sauts tels que l'application les calcule
// (`src/core/jumps.ts`) et la part qu'en garderait l'élagage. Sert à recaler la
// détection sur de vraies séances.
//
//   node outils/banc/sauts-diagnostic.mjs <fichier .imu> [<fichier .gpx>] [--tous] [--support=wingfoil]
//
// Node 22.18 ou plus : le lecteur du format, le calcul et les constantes sont
// ceux de l'application, chargés tels quels. Les vraies séances restent hors du
// dépôt (dossier mémoire de l'utilisateur).
//
// Sont listés les sauts rangés (durée et hauteur suffisantes), avec la vitesse
// GPS au décollage si le GPX est fourni ; « --tous » ajoute les vols écartés,
// avec leur raison. La hauteur minimale de l'activité et le seuil d'activité
// ne filtrent qu'à l'affichage dans l'application : ils ne sont pas appliqués
// ici.

import { readFileSync, statSync } from 'node:fs';
import { decodeImu, imuCaptureStats } from '../../src/core/imuFile.ts';
import { measureJumps } from '../../src/core/jumps.ts';
import { SPORT_PROFILES } from '../../src/core/sportProfiles.ts';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [key, value] = a.slice(2).split('=');
  return [key, value ?? true];
}));
const [imuPath, gpxPath] = args.filter((a) => !a.startsWith('--'));
if (!imuPath) {
  console.error('Usage : node outils/banc/sauts-diagnostic.mjs <fichier .imu> [<fichier .gpx>] [--tous] [--support=wingfoil]');
  process.exit(1);
}
const support = typeof flags.support === 'string' ? flags.support : 'wingfoil';
const detection = SPORT_PROFILES[support]?.jumps?.detection;
if (!detection) {
  console.error(`Support sans sauts : ${support}`);
  process.exit(1);
}

const rec = await decodeImu(new Uint8Array(readFileSync(imuPath)));
if (!rec) {
  console.error('Fichier illisible : pas un fichier des capteurs de Tracker.');
  process.exit(1);
}

const { header } = rec;
const stats = imuCaptureStats(rec);
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const KNOTS = 1.943844;

console.log(`Fichier : ${imuPath} (${round(statSync(imuPath).size / 1024 / 1024, 2)} Mo)`);
console.log(`Téléphone : ${header.device?.manufacturer ?? '?'} ${header.device?.model ?? '?'}, Android ${header.device?.android ?? '?'}`);
console.log(`Réglages : ${header.setup.placement}, ${header.setup.foil ? 'foil' : 'sans foil'}${header.windows ? `, élagué (${header.windows.length} fenêtres)` : ''}`);
for (const s of header.streams) {
  const sensor = s.sensor ? `${s.sensor.name} (${s.sensor.vendor}), plage ${round(s.sensor.maxRange ?? 0, 1)}, résolution ${s.sensor.resolution}` : '';
  console.log(`  flux ${s.id} ${s.kind} : ${sensor}`);
}
console.log(`Paquets : ${rec.chunks}${rec.truncated ? ', dernier tronqué' : ''}${rec.skippedChunks ? `, ${rec.skippedChunks} illisible(s)` : ''}`);
console.log(`Durée mesurée : ${round(stats.durationS / 60, 1)} min, de ${stats.startMs ? hhmmss(stats.startMs) : '?'}`);
for (const s of stats.streams) {
  const series = rec.series.find((x) => x.info.kind === s.kind);
  let gaps01 = 0;
  let gaps1 = 0;
  for (let i = 1; i < series.t.length; i++) {
    const dt = (series.t[i] - series.t[i - 1]) / 1e6;
    if (dt > 0.1) gaps01 += 1;
    if (dt > 1) gaps1 += 1;
  }
  console.log(`  ${s.kind} : ${s.count} mesures, ${round(s.rateHz, 1)} Hz, plus long trou ${round(s.longestGapS, 2)} s, trous > 0,1 s : ${gaps01}, > 1 s : ${gaps1}`);
}

// --- GPX : instants et vitesse retenue par l'enregistreur (gpxtpx:speed, ou speed) ---
const track = [];
if (gpxPath) {
  const text = readFileSync(gpxPath, 'utf8');
  const re = /<trkpt[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(text))) {
    const time = /<time>([^<]+)<\/time>/.exec(m[1]);
    const speed = /<(?:\w+:)?speed>([^<]+)<\/(?:\w+:)?speed>/.exec(m[1]);
    if (time && speed) track.push({ timeMs: Date.parse(time[1]), speedMs: Number(speed[1]) });
  }
  if (track.length > 0) {
    console.log(`GPX : ${track.length} points avec vitesse, de ${hhmmss(track[0].timeMs)} à ${hhmmss(track[track.length - 1].timeMs)}`);
    const imuEnd = stats.startMs + stats.durationS * 1000;
    console.log(`  écart des débuts : ${round((stats.startMs - track[0].timeMs) / 1000, 1)} s, des fins : ${round((imuEnd - track[track.length - 1].timeMs) / 1000, 1)} s`);
  } else {
    console.log('GPX : aucun point avec vitesse');
  }
}

// --- Sauts, calcul de l'application ---
const started = performance.now();
const { jumps, flights, windows } = measureJumps(rec, detection, track);
const elapsed = performance.now() - started;
const keptS = windows.reduce((s, [a, b]) => s + (b - a) / 1e6, 0);
const share = stats.durationS > 0 ? keptS / stats.durationS : 0;
console.log(`\nCalcul (${support}) : ${Math.round(elapsed)} ms, ${flights.length} vols repérés dans ${windows.length} fenêtres`);
console.log(`Élagage : ${round(100 * share, 1)} % de la séance gardée${share > 0.2 ? ' (plus de 20 % : beaucoup de sauts, ou critères trop larges)' : ''}`);

const line = (f, extra = '') =>
  `  ${hhmmss(f.takeoffMs)}  ${round(f.heightM).toFixed(2)} m  ${round(f.flightS).toFixed(2)} s  v0 ${round(f.takeoffVerticalMs, 1)} m/s` +
  (f.speedMs !== undefined && f.speedMs !== null ? `  ${round(f.speedMs * KNOTS, 1)} nd` : '') +
  (f.lengthM !== undefined && f.lengthM !== null ? `  ${round(f.lengthM, 1)} m` : '') +
  (f.doubts.length ? `  ≈ ${f.doubts.join(', ')}` : '') + extra;

console.log(`\nSauts rangés (vol d'au moins ${detection.keepMinFlightS} s et ${detection.keepMinHeightM} m) : ${jumps.length}`);
console.log('  heure     hauteur  vol     départ vertical  vitesse  longueur');
for (const j of jumps) console.log(line(j));

if (flags.tous) {
  const rejected = flights.filter((f) => !(f.flightS >= detection.keepMinFlightS && f.heightM >= detection.keepMinHeightM));
  console.log(`\nVols écartés : ${rejected.length}`);
  for (const f of rejected) {
    const why = [
      f.flightS < detection.keepMinFlightS ? 'vol trop court' : null,
      f.heightM < detection.keepMinHeightM ? 'trop bas' : null,
    ].filter(Boolean).join(', ');
    console.log(line(f, `  (${why})`));
  }
}
