// Diagnostic de l'énergie estimée par la fréquence cardiaque (lot 96) sur une
// session avec la ceinture : la valeur de l'application (Keytel 2005, sans
// VO2max, `src/core/hrEnergy.ts`) et, à côté, celle de la réserve de FC
// (Swain : VO2 = repos + %FC de réserve × (VO2max − repos), VO2max d'Uth =
// 15,3 × FC max / FC repos), pour comparer les deux méthodes sur de vraies
// sorties sur l'eau. Un écart de plus de 25 % signale un cas à regarder.
//
//   node outils/banc/energie-fc-diagnostic.mjs <fichier .gpx> [--poids=75 --age=40 --sexe=m --fcmax=180 --fcrepos=60] [--support=wingfoil]
//
// Node 22.18 ou plus : le lecteur GPX, le lissage de la FC, le calcul et les
// constantes sont ceux de l'application, chargés tels quels. Les vraies
// séances restent hors du dépôt (dossier mémoire de l'utilisateur).
//
// Sans `--sexe`, la moyenne des deux équations, comme l'application ; sans
// `--fcmax`, le plafond tiré de l'âge (et pas de réserve de FC) ; sans
// `--fcrepos`, pas de réserve de FC. La FC est lue sur les points horodatés
// du fichier (avec position, ou sans pour une session sans trace), pauses
// retirées de la durée ; l'application la lit sur la trace après ses filtres,
// à quelques points près la même.

import './charge-ts.mjs';
import { readFileSync } from 'node:fs';

// Modules de l'application après le crochet de `charge-ts.mjs` (imports relatifs sans extension).
const { parseGpx } = await import('../../src/core/gpxParser.ts');
const { forEachCounted, smoothHeartRate, heartRateStats } = await import('../../src/core/heartRate.ts');
const { heartRatePointsFrom } = await import('../../src/core/heartRateSession.ts');
const { estimateHrEnergy, hrEnergyCeilingBpm, hrEnergyKcal } = await import('../../src/core/hrEnergy.ts');
const { SPORT_PROFILES } = await import('../../src/core/sportProfiles.ts');
const { DEFAULT_ENERGY_PARAMS } = await import('../../src/running/energy.ts');
const { J_PER_KCAL } = await import('../../src/core/units.ts');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [key, value] = a.slice(2).split('=');
  return [key, value ?? true];
}));
const [gpxPath] = args.filter((a) => !a.startsWith('--'));
const USAGE = 'Usage : node outils/banc/energie-fc-diagnostic.mjs <fichier .gpx> [--poids=75 --age=40 --sexe=m --fcmax=180 --fcrepos=60] [--support=wingfoil]';
if (!gpxPath) {
  console.error(USAGE);
  process.exit(1);
}
const num = (key, fallback) => {
  if (flags[key] === undefined) return fallback;
  const v = Number(String(flags[key]).replace(',', '.'));
  if (!isFinite(v) || v <= 0) {
    console.error(`--${key} illisible : ${flags[key]}`);
    process.exit(1);
  }
  return v;
};
const support = typeof flags.support === 'string' ? flags.support : 'wingfoil';
const profile = SPORT_PROFILES[support];
if (!profile) {
  console.error(`Support inconnu : ${support}`);
  process.exit(1);
}
// Le calcul est donné en voile et en surf ; ailleurs, les coefficients de la voile, pour comparer.
const energy = profile.hrEnergy ?? SPORT_PROFILES.wingfoil.hrEnergy;
const heart = profile.heartRate;
const weightKg = num('poids', 75);
const age = num('age', 40);
const sex = flags.sexe === 'm' || flags.sexe === 'f' ? flags.sexe : null;
const hrMax = num('fcmax', null);
const hrRest = num('fcrepos', null);

const parsed = parseGpx(readFileSync(gpxPath, 'utf8'));
const points = heartRatePointsFrom(parsed.rawPoints.length > 0 ? parsed.rawPoints : parsed.timedPoints);
const smoothed = smoothHeartRate(points, heart.smoothS, heart.gapS);
const stats = heartRateStats(points, smoothed, heart.gapS);
const round = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
const minutes = (s) => `${round(s / 60, 1)} min`;
const kcal = (j) => `${round(j / J_PER_KCAL)} kcal`;

console.log(`Fichier : ${gpxPath}`);
console.log(`Support : ${support}${profile.hrEnergy ? '' : ' (sans énergie par la FC dans l\'application : coefficients de la voile)'}`);
console.log(`Pratiquant : ${weightKg} kg, ${age} ans, ${sex === 'm' ? 'homme' : sex === 'f' ? 'femme' : 'sexe non dit (moyenne des deux équations)'}`
  + `, FC max ${hrMax ?? `non dite (plafond ${hrEnergyCeilingBpm(null, age, energy)} bpm par l'âge)`}, FC repos ${hrRest ?? 'non dite'}`);
if (age < 18 || age > 45) console.log(`  Attention : Keytel est validé de 18 à 45 ans, ${age} ans est hors de cette plage.`);
console.log(`Points horodatés : ${points.length}, dont ${points.filter((p) => p.hr !== undefined).length} avec FC`);
if (stats) console.log(`FC : moyenne ${round(stats.avgBpm)} bpm, max ${stats.maxBpm} bpm (lissée sur ${heart.smoothS} s)`);

const e = estimateHrEnergy(points, smoothed, { weightKg, age, sex, hrMax }, heart, energy);
if (e === null) {
  console.log(`\nMoins de ${heart.minCoverageS} s de FC : pas d'estimation.`);
  process.exit(0);
}
if (e.kind !== 'estimation') {
  console.log(`\nProfil incomplet : ${e.kind}.`);
  process.exit(0);
}
console.log(`\nDurée hors pauses : ${minutes(e.sessionS)} ; avec FC : ${minutes(e.measuredS)} (couverture ${round(e.coverage * 100)} %)`);
console.log(`Sous le plancher de ${energy.floorBpm} bpm (compté au repos) : ${minutes(e.belowFloorS)} (${round((e.belowFloorS / e.measuredS) * 100)} % du temps mesuré)`);
console.log(e.extrapolated
  ? `Couverture d'au moins ${round(energy.coverageForTotal * 100)} % : total porté à la session entière au débit moyen mesuré.`
  : `Couverture sous ${round(energy.coverageForTotal * 100)} % : la part mesurée seule (l'écran dit « sur ${minutes(e.measuredS)} avec FC »).`);

console.log(`\nKeytel (application) : ${kcal(e.totalJ)}, affiché « env. ${hrEnergyKcal(e.totalJ, energy.displayStepKcal)} kcal »`
  + `, dont repos ${kcal(e.restJ)} ; ${round(e.totalJ / J_PER_KCAL / (e.extrapolated ? e.sessionS : e.measuredS) * 60, 1)} kcal/min`);

// --- Réserve de FC (Swain), même découpage du temps et même extrapolation ---
if (hrMax === null || hrRest === null || hrRest >= hrMax) {
  console.log('Réserve de FC : il faut --fcmax et --fcrepos (FC repos sous la FC max).');
} else {
  const { joulesPerMlO2, restingMlKgMin } = DEFAULT_ENERGY_PARAMS;
  const vo2max = (15.3 * hrMax) / hrRest;
  const restW = energy.restWPerKg * weightKg;
  const reserveW = (bpm) => {
    const share = Math.min(1, Math.max(0, (bpm - hrRest) / (hrMax - hrRest)));
    const vo2 = restingMlKgMin + share * (vo2max - restingMlKgMin);
    return Math.max(restW, (vo2 * weightKg * joulesPerMlO2) / 60);
  };
  let measuredJ = 0;
  forEachCounted(points, smoothed, heart.gapS, (_, bpm, dtS, from) => {
    measuredJ += ((reserveW(Math.round(smoothed[from] ?? bpm)) + reserveW(bpm)) / 2) * dtS;
  });
  const reserveJ = e.extrapolated ? (measuredJ * e.sessionS) / e.measuredS : measuredJ;
  const gapPct = ((e.totalJ - reserveJ) / reserveJ) * 100;
  console.log(`Réserve de FC (Swain, VO2max d'Uth ${round(vo2max, 1)} ml/kg/min) : ${kcal(reserveJ)}`);
  console.log(`Écart Keytel / réserve : ${gapPct >= 0 ? '+' : ''}${round(gapPct)} %${Math.abs(gapPct) > 25 ? ' : plus de 25 %, cas à signaler' : ''}`);
}
