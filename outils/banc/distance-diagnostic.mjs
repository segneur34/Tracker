// Diagnostic de la distance à pied (lot 184) : la distance de Tracker (intégrale de la vitesse retenue,
// `segmentDistanceM`, règle 6) est-elle plus courte que celle des positions, et de combien, course par course ?
//
//   node outils/banc/distance-diagnostic.mjs <fichier .gpx ou dossier> [--fit <fichier .fit>] [--tranche=300]
//        [--support=running] [--min-tranche=120] [--nom=running] [--min-km=0.5]
//
// `--nom=running` ne garde, dans un dossier, que les GPX dont le nom contient ce texte (une course : `_running`).
//
// Node 22.18 ou plus : la lecture du GPX, la cinématique, le masque d'activité et la distance sont ceux de
// l'application, enchaînés comme le résumé de fiche (`library/summary.ts` : `analysisTrack`, seuil d'activité de
// la fiche sinon celui du profil, `thresholdActivityMask`, `buildCumulativeTrack`, `computeActiveDistanceM`).
// Les vraies courses restent hors du dépôt (dossier mémoire de l'utilisateur) : chemins en argument, jamais copiés.
//
// Pour chaque course : distance de Tracker (total, comme `summary.distanceM`, et en mouvement), son écart à la
// fiche `.json` voisine, distance par les positions (brute, un point toutes les 5 s, toutes les 10 s, sur les
// mêmes pas en mouvement), rapport Tracker / positions, tranches de `--tranche` secondes depuis le départ
// (rapport à 5 s, minimum, maximum, part au-delà de 5 %, vitesses moyennes), puis une synthèse de toutes les
// courses : écart par date, par allure, par tranche de temps depuis le départ. Une tranche n'entre dans les
// statistiques qu'avec `--min-tranche` secondes de mouvement.
//
// `--fit` : lit le FIT d'une montre (lecteur maison, sans dépendance), prend la fenêtre de temps commune avec la
// course qui la recoupe et compare distance du champ `distance`, positions de la montre, vitesse de Tracker et
// positions de Tracker, au total puis par tranche. Fenêtre sans masque de mouvement (la montre compte tout) ;
// les pas qui franchissent une reprise de pause sont exclus.

import './charge-ts.mjs';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const { parseGpx } = await import('../../src/core/gpxParser.ts');
const { analysisTrack } = await import('../../src/library/summary.ts');
const { buildCumulativeTrack, thresholdActivityMask, computeActiveDistanceM, computeActiveTimeMs, segmentDistanceM } = await import('../../src/core/sessionStats.ts');
const { getSportProfile, defaultActiveThresholdOf } = await import('../../src/core/sportProfiles.ts');
const { haversineDistance } = await import('../../src/core/geo.ts');

const USAGE = 'Usage : node outils/banc/distance-diagnostic.mjs <fichier .gpx ou dossier> [--fit <fichier .fit>] [--tranche=300] [--support=running] [--min-tranche=120]';

// --- Arguments ---
const args = process.argv.slice(2);
const flags = {};
const paths = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { paths.push(a); continue; }
  const eq = a.indexOf('=');
  const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
  flags[key] = eq < 0 ? (key === 'fit' ? args[++i] : true) : a.slice(eq + 1);
}
if (paths.length === 0) { console.error(USAGE); process.exit(1); }
const trancheS = Number(flags.tranche ?? 300);
const minTrancheS = Number(flags['min-tranche'] ?? 120);
const supportFlag = typeof flags.support === 'string' ? flags.support : null;

// --- Mise en forme ---
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;
const fr = (x, n = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : round(x, n).toFixed(n).replace('.', ','));
const km = (m) => fr(m / 1000, 3);
const ratioPct = (r) => (r === null || !Number.isFinite(r) ? '–' : `${fr((r - 1) * 100)} %`);
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 19) + 'Z';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sumBy = (steps, f) => steps.reduce((a, s) => a + f(s), 0);

// --- Distance par les positions, pas retenus ---
// `pts` : { timeMs, lat, lon }. `use[i]` : le pas (i-1 → i) compte. Un point toutes les `everyS` secondes
// (0 = tous) au sein de chaque suite de pas retenus ; le reste de fin de suite est gardé (somme complète).
// Rend des pas { endMs, dist, dtS }.
const positionSteps = (pts, use, everyS) => {
  const out = [];
  let anchor = -1;
  const close = (j) => {
    out.push({ endMs: pts[j].timeMs, dist: haversineDistance(pts[anchor].lat, pts[anchor].lon, pts[j].lat, pts[j].lon), dtS: (pts[j].timeMs - pts[anchor].timeMs) / 1000 });
    anchor = j;
  };
  for (let i = 1; i < pts.length; i++) {
    if (!use[i]) { if (anchor >= 0 && anchor !== i - 1) close(i - 1); anchor = -1; continue; }
    if (anchor < 0) anchor = i - 1;
    if (everyS === 0 || (pts[i].timeMs - pts[anchor].timeMs) / 1000 >= everyS) close(i);
  }
  if (anchor >= 0 && anchor !== pts.length - 1 && use[pts.length - 1]) close(pts.length - 1);
  return out;
};

// Tranches d'une liste de pas { endMs, dist, dtS } depuis `t0Ms`.
const byTranche = (steps, t0Ms) => {
  const m = new Map();
  for (const s of steps) {
    const k = Math.floor((s.endMs - t0Ms - 1) / 1000 / trancheS);
    const t = m.get(k) ?? { dist: 0, dtS: 0 };
    t.dist += s.dist; t.dtS += s.dtS; m.set(k, t);
  }
  return m;
};

// --- Lecture d'une course de l'application ---
const loadRun = (gpxPath) => {
  const jsonPath = gpxPath.replace(/\.gpx$/i, '.json');
  const fiche = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : null;
  const sport = supportFlag ?? fiche?.sport ?? 'running';
  const { rawPoints } = parseGpx(readFileSync(gpxPath, 'utf8'));
  const track = analysisTrack(rawPoints, sport);
  const profile = getSportProfile(sport);
  const threshold = fiche?.summary?.activitySettings?.threshold ?? defaultActiveThresholdOf(profile, false);
  const mask = thresholdActivityMask(track, profile, threshold);
  return { gpxPath, fiche, sport, rawPoints, track, mask };
};

const analyseRun = (run) => {
  const { track, mask, fiche } = run;
  const n = track.length;
  const cum = buildCumulativeTrack(track);
  const totalM = cum.cumDist[n - 1];
  const movingM = computeActiveDistanceM(track, mask);
  const movingS = computeActiveTimeMs(track, mask) / 1000;
  // Pas de Tracker en mouvement.
  const trackerSteps = [];
  for (let i = 1; i < n; i++) if (mask[i]) trackerSteps.push({ endMs: track[i].timeMs, dist: segmentDistanceM(track, i), dtS: (track[i].timeMs - track[i - 1].timeMs) / 1000 });
  const raw = positionSteps(track, mask, 0);
  const p5 = positionSteps(track, mask, 5);
  const p10 = positionSteps(track, mask, 10);
  const t0 = track[0].timeMs;
  const tr = byTranche(trackerSteps, t0), tp = byTranche(p5, t0);
  const tranches = [...tr.keys()].sort((a, b) => a - b).map((k) => {
    const a = tr.get(k), b = tp.get(k) ?? { dist: 0, dtS: 0 };
    return { k, activeS: a.dtS, trackerM: a.dist, posM: b.dist, ratio: b.dist > 0 ? a.dist / b.dist : null, trackerMs: a.dtS > 0 ? a.dist / a.dtS : null, posMs: b.dtS > 0 ? b.dist / b.dtS : null };
  });
  const usable = tranches.filter((t) => t.activeS >= minTrancheS && t.ratio !== null);
  const dts = []; for (let i = 1; i < n; i++) dts.push((track[i].timeMs - track[i - 1].timeMs) / 1000);
  const gaps = []; for (let i = 1; i < n; i++) if (track[i].gapDistanceM !== undefined) gaps.push(dts[i - 1]);
  const segments = 1 + track.slice(1).filter((p) => p.segmentStart).length;
  return {
    name: basename(run.gpxPath), t0, durS: (track[n - 1].timeMs - t0) / 1000, movingS, totalM, movingM,
    ficheM: fiche?.summary?.distanceM ?? null, ficheMovingM: fiche?.summary?.movingDistanceM ?? null, ficheVersion: fiche?.summary?.calcVersion ?? null,
    rawM: sumBy(raw, (s) => s.dist), p5M: sumBy(p5, (s) => s.dist), p10M: sumBy(p10, (s) => s.dist), sumT: sumBy(trackerSteps, (s) => s.dist),
    tranches, usable, source: track[0].speedSource, medianDt: median(dts), gapCount: gaps.length, gapS: gaps.reduce((a, b) => a + b, 0), segments,
    avgMs: movingS > 0 ? movingM / movingS : null,
  };
};

// --- Lecteur FIT ---
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const readFit = (buf) => {
  const headerSize = buf[0];
  if (headerSize !== 12 && headerSize !== 14) throw new Error(`En-tête FIT inattendu (${headerSize} octets)`);
  if (String.fromCharCode(...buf.subarray(8, 12)) !== '.FIT') throw new Error('Signature .FIT absente');
  const dataSize = buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] * 2 ** 24);
  const end = Math.min(buf.length - 2, headerSize + dataSize);
  const defs = new Map();
  const records = [];
  let messages = 0, p = headerSize;
  const readUint = (o, size, le) => {
    let v = 0;
    for (let b = 0; b < size; b++) v = v * 256 + buf[o + (le ? size - 1 - b : b)];
    return v;
  };
  const readSigned = (o, size, le) => { const u = readUint(o, size, le); return u >= 2 ** (size * 8 - 1) ? u - 2 ** (size * 8) : u; };
  const WANTED = new Set([253, 0, 1, 2, 5, 6, 73]);
  const parseData = (d) => {
    const msg = {};
    let o = p;
    for (const f of d.fields) {
      if (WANTED.has(f.num) && (f.size === 4 || f.size === 2)) {
        const signed = f.base === 5 || f.base === 3;
        const v = signed ? readSigned(o, f.size, d.le) : readUint(o, f.size, d.le);
        const invalid = f.size === 4 ? (signed ? 0x7fffffff : 0xffffffff) : (signed ? 0x7fff : 0xffff);
        msg[f.num] = v === invalid ? null : v;
      }
      o += f.size;
    }
    p += d.size + d.devSize; // champs développeur sautés
    return msg;
  };
  while (p < end) {
    const h = buf[p++];
    if (h & 0x80) { // en-tête compressé : type local sur 2 bits, pas de définition
      const d = defs.get((h >> 5) & 3);
      if (!d) throw new Error('Message compressé sans définition');
      const msg = parseData(d); messages++;
      if (d.global === 20) records.push(msg);
    } else if (h & 0x40) { // définition
      const hasDev = (h & 0x20) !== 0, local = h & 0x0f;
      const le = buf[p + 1] === 0;
      const global = le ? buf[p + 2] | (buf[p + 3] << 8) : (buf[p + 2] << 8) | buf[p + 3];
      const nf = buf[p + 4]; p += 5;
      const fields = [];
      let size = 0;
      for (let f = 0; f < nf; f++) { fields.push({ num: buf[p], size: buf[p + 1], base: buf[p + 2] & 0x1f }); size += buf[p + 1]; p += 3; }
      let devSize = 0;
      if (hasDev) { const nd = buf[p++]; for (let f = 0; f < nd; f++) { devSize += buf[p + 1]; p += 3; } }
      defs.set(local, { le, global, fields, size, devSize });
    } else { // données
      const d = defs.get(h & 0x0f);
      if (!d) throw new Error('Données sans définition');
      const msg = parseData(d); messages++;
      if (d.global === 20) records.push(msg);
    }
  }
  const rec = records.filter((m) => m[253] != null).map((m) => ({
    timeMs: FIT_EPOCH_MS + m[253] * 1000,
    lat: m[0] != null ? (m[0] * 180) / 2 ** 31 : null, lon: m[1] != null ? (m[1] * 180) / 2 ** 31 : null,
    distM: m[5] != null ? m[5] / 100 : null, speedMs: m[73] != null ? m[73] / 1000 : m[6] != null ? m[6] / 1000 : null,
  }));
  return { records: rec, messages };
};

// --- Programme ---
const collect = (p) => {
  if (statSync(p).isFile()) return [p];
  const nom = typeof flags.nom === 'string' ? flags.nom : '';
  return readdirSync(p).filter((f) => /\.gpx$/i.test(f) && f.includes(nom)).sort().map((f) => join(p, f));
};
const results = [];
for (const f of collect(paths[0])) {
  let run;
  try { run = loadRun(f); } catch (e) { console.log(`${basename(f)} : illisible (${e.message})`); continue; }
  if (run.track.length < 2) continue;
  results.push({ run, a: analyseRun(run) });
}

for (const { a } of results) {
  console.log(`\n== ${a.name} (${new Date(a.t0).toISOString().slice(0, 10)}, ${mmss(a.durS)}, mouvement ${mmss(a.movingS)}) ==`);
  console.log(`  source de vitesse ${a.source}, intervalle médian ${fr(a.medianDt, 2)} s, trous ${a.gapCount} (${fr(a.gapS)} s), segments ${a.segments}`);
  const ecart = a.ficheM === null ? 'pas de fiche' : `fiche ${km(a.ficheM)} km (v${a.ficheVersion}), écart ${fr(a.totalM - a.ficheM, 2)} m ; mouvement fiche ${km(a.ficheMovingM)} km, écart ${fr(a.movingM - a.ficheMovingM, 2)} m`;
  console.log(`  Tracker total ${km(a.totalM)} km, en mouvement ${km(a.movingM)} km ; ${ecart}`);
  console.log(`  Positions (en mouvement) : brut ${km(a.rawM)} km, 5 s ${km(a.p5M)} km, 10 s ${km(a.p10M)} km`);
  console.log(`  Tracker / positions : brut ${ratioPct(a.sumT / a.rawM)}, 5 s ${ratioPct(a.sumT / a.p5M)}, 10 s ${ratioPct(a.sumT / a.p10M)}`);
  const rs = a.usable.map((t) => t.ratio);
  const over = rs.filter((r) => Math.abs(r - 1) > 0.05).length;
  console.log(`  Tranches de ${trancheS} s (au moins ${minTrancheS} s de mouvement : ${rs.length}) : min ${ratioPct(Math.min(...rs))}, max ${ratioPct(Math.max(...rs))}, au-delà de 5 % ${over}/${rs.length} (${fr((100 * over) / (rs.length || 1), 0)} %)`);
  console.log('   tranche  mouv.s  Tracker m  positions5s m  rapport   v Tracker  v positions (m/s)');
  for (const t of a.tranches) console.log(`   ${String(t.k).padStart(5)}  ${fr(t.activeS, 0).padStart(6)}  ${fr(t.trackerM, 0).padStart(9)}  ${fr(t.posM, 0).padStart(13)}  ${ratioPct(t.ratio).padStart(8)}  ${fr(t.trackerMs, 2).padStart(9)}  ${fr(t.posMs, 2).padStart(9)}`);
}

// --- Synthèse ---
if (results.length > 1) {
  console.log('\n===== Synthèse =====');
  console.log('date              fiche  mouv. km  pos5s km  total/5s   mouv/5s   mouv/brut  allure m/s');
  // Une course de moins de `--min-km` (0,5) km en mouvement ne dit rien du rapport : exclue des moyennes.
  const minM = Number(flags['min-km'] ?? 0.5) * 1000;
  const rows = results.map(({ a }) => ({ ...a, r5: a.sumT / a.p5M, rraw: a.sumT / a.rawM })).filter((a) => a.movingM >= minM && Number.isFinite(a.r5));
  for (const a of rows) console.log(`${new Date(a.t0).toISOString().slice(0, 16).replace('T', ' ')}  v${a.ficheVersion ?? '?'}   ${km(a.movingM).padStart(8)}  ${km(a.p5M).padStart(8)}  ${ratioPct(a.totalM / a.p5M).padStart(8)}  ${ratioPct(a.r5).padStart(8)}  ${ratioPct(a.rraw).padStart(8)}  ${fr(a.avgMs, 2).padStart(7)}`);
  const devs = rows.map((a) => a.r5 - 1);
  console.log(`\n${rows.length} courses de ${fr(minM / 1000, 1)} km en mouvement ou plus (les autres sont listées plus haut, hors moyennes).`);
  console.log(`Écart mouvement Tracker / positions 5 s : moyen ${ratioPct(1 + mean(devs))}, médian ${ratioPct(1 + median(devs))}, plus grand en valeur absolue ${ratioPct(1 + devs.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0))}, de ${ratioPct(1 + Math.min(...devs))} à ${ratioPct(1 + Math.max(...devs))}`);
  const groupes = (nom, key, noms) => {
    console.log(`\nSelon ${nom} :`);
    for (const g of noms) {
      const sel = rows.filter((a) => key(a) === g);
      if (!sel.length) continue;
      const tot = sel.reduce((s, a) => s + a.sumT, 0) / sel.reduce((s, a) => s + a.p5M, 0);
      console.log(`  ${g.padEnd(24)} ${String(sel.length).padStart(2)} courses, rapport pondéré ${ratioPct(tot)}, médian ${ratioPct(median(sel.map((a) => a.r5)))}`);
    }
  };
  const mois = (a) => new Date(a.t0).toISOString().slice(0, 7);
  groupes('le mois', mois, [...new Set(rows.map(mois))].sort());
  const ver = (a) => `fiche v${a.ficheVersion ?? '?'}`;
  groupes('la version de calcul de la fiche', ver, [...new Set(rows.map(ver))].sort());
  const allure = (a) => (a.avgMs < 2.0 ? 'marche (< 2,0 m/s)' : a.avgMs < 2.8 ? 'trot (2,0 à 2,8 m/s)' : 'course (≥ 2,8 m/s)');
  groupes("l'allure moyenne en mouvement", allure, ['marche (< 2,0 m/s)', 'trot (2,0 à 2,8 m/s)', 'course (≥ 2,8 m/s)']);
  console.log(`\nSelon le temps depuis le départ (tranches de ${trancheS} s avec au moins ${minTrancheS} s de mouvement, toutes courses) :`);
  const groups = new Map();
  for (const a of rows) for (const t of a.usable) { const g = groups.get(t.k) ?? []; g.push(t); groups.set(t.k, g); }
  console.log('  tranche  minutes        n   rapport pondéré  médian   part > 5 %');
  for (const k of [...groups.keys()].sort((x, y) => x - y)) {
    const g = groups.get(k);
    if (g.length < 3) continue;
    const w = sumBy(g, (t) => t.trackerM) / sumBy(g, (t) => t.posM);
    const over = g.filter((t) => Math.abs(t.ratio - 1) > 0.05).length;
    console.log(`  ${String(k).padStart(5)}  ${mmss(k * trancheS)}-${mmss((k + 1) * trancheS)}  ${String(g.length).padStart(4)}  ${ratioPct(w).padStart(14)}  ${ratioPct(median(g.map((t) => t.ratio))).padStart(7)}  ${fr((100 * over) / g.length, 0).padStart(6)} %`);
  }
}

// --- Montre ---
if (flags.fit) {
  const { records, messages } = readFit(readFileSync(flags.fit));
  const withPos = records.filter((r) => r.lat !== null);
  const fStart = records[0].timeMs, fEnd = records[records.length - 1].timeMs;
  console.log(`\n===== Montre : ${basename(flags.fit)} =====`);
  console.log(`  ${messages} messages, ${records.length} records (${withPos.length} avec position), de ${hhmm(fStart)} à ${hhmm(fEnd)}, durée ${mmss((fEnd - fStart) / 1000)}`);
  // Contrôle de lecture : heures croissantes, distance du champ croissante, dernière distance cohérente avec les positions.
  const backTime = records.filter((r, i) => i > 0 && r.timeMs < records[i - 1].timeMs).length;
  const withDist = records.filter((r) => r.distM !== null);
  const backDist = withDist.filter((r, i) => i > 0 && r.distM < withDist[i - 1].distM - 0.01).length;
  console.log(`  Contrôle de lecture : ${backTime} heure(s) qui recule, ${backDist} distance(s) qui recule, distance finale ${km(withDist[withDist.length - 1].distM)} km, ${records.length} records sur ${mmss((fEnd - fStart) / 1000)} (intervalle médian ${fr(median(records.slice(1).map((r, i) => (r.timeMs - records[i].timeMs) / 1000)), 2)} s)`);
  const target = results.map((r) => r.run).find((r) => r.track[0].timeMs < fEnd && r.track[r.track.length - 1].timeMs > fStart);
  if (!target) { console.log('  Aucune course du dossier ne recoupe la montre.'); process.exit(0); }
  const T = target.track;
  const ws = Math.max(fStart, T[0].timeMs), we = Math.min(fEnd, T[T.length - 1].timeMs);
  console.log(`  Course rapprochée : ${basename(target.gpxPath)} (${hhmm(T[0].timeMs)} à ${hhmm(T[T.length - 1].timeMs)})`);
  console.log(`  Fenêtre commune : ${hhmm(ws)} à ${hhmm(we)} (${mmss((we - ws) / 1000)})`);
  const tUse = T.map((p, i) => i > 0 && !p.segmentStart && T[i - 1].timeMs >= ws && p.timeMs <= we);
  const tSteps = []; for (let i = 1; i < T.length; i++) if (tUse[i]) tSteps.push({ endMs: T[i].timeMs, dist: segmentDistanceM(T, i), dtS: (T[i].timeMs - T[i - 1].timeMs) / 1000 });
  const tRaw = positionSteps(T, tUse, 0), t5 = positionSteps(T, tUse, 5);
  const W = withPos.filter((r) => r.timeMs >= ws && r.timeMs <= we);
  const wUse = W.map((_, i) => i > 0 && (W[i].timeMs - W[i - 1].timeMs) / 1000 <= 10);
  const wRaw = positionSteps(W, wUse, 0), w5 = positionSteps(W, wUse, 5);
  const dist = records.filter((r) => r.distM !== null);
  const at = (t) => { // distance du champ, interpolée à l'instant t
    let lo = 0, hi = dist.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (dist[mid].timeMs <= t) lo = mid; else hi = mid; }
    const a = dist[lo], b = dist[hi];
    return b.timeMs === a.timeMs ? a.distM : a.distM + ((b.distM - a.distM) * (t - a.timeMs)) / (b.timeMs - a.timeMs);
  };
  const wDistM = at(we) - at(ws);
  const sT = sumBy(tSteps, (s) => s.dist), sTraw = sumBy(tRaw, (s) => s.dist), sT5 = sumBy(t5, (s) => s.dist);
  const sWraw = sumBy(wRaw, (s) => s.dist), sW5 = sumBy(w5, (s) => s.dist);
  const durS = (we - ws) / 1000;
  const wSpeed = W.filter((r) => r.speedMs !== null).map((r) => r.speedMs);
  const vT = sT / sumBy(tSteps, (s) => s.dtS);
  console.log('  Distances sur la fenêtre :');
  console.log(`    montre, champ distance      ${km(wDistM)} km`);
  console.log(`    montre, positions brutes    ${km(sWraw)} km ; un point toutes les 5 s ${km(sW5)} km`);
  console.log(`    Tracker, vitesse retenue    ${km(sT)} km`);
  console.log(`    Tracker, positions brutes   ${km(sTraw)} km ; un point toutes les 5 s ${km(sT5)} km`);
  console.log(`  Vitesses moyennes (m/s) : montre champ distance ${fr(wDistM / durS, 3)}, montre champ vitesse ${fr(mean(wSpeed), 3)}, Tracker vitesse ${fr(vT, 3)}, Tracker positions 5 s ${fr(sT5 / sumBy(t5, (s) => s.dtS), 3)} ; écart Tracker - montre ${fr(vT - wDistM / durS, 3)} m/s`);
  console.log(`  Rapports : Tracker vitesse / montre distance ${ratioPct(sT / wDistM)} ; Tracker vitesse / Tracker positions 5 s ${ratioPct(sT / sT5)} ; Tracker positions 5 s / montre positions 5 s ${ratioPct(sT5 / sW5)}`);
  const trT = byTranche(tSteps, ws), tr5 = byTranche(t5, ws), trW5 = byTranche(w5, ws);
  console.log(`  Par tranche de ${trancheS} s depuis ${hhmm(ws)} (m) :`);
  console.log('   tr  début     montre dist  montre pos5  Tracker vit  Tracker pos5  vit/pos5    vit/montre   v Tracker  v montre (m/s)');
  for (const k of [...trT.keys()].sort((x, y) => x - y)) {
    const a = trT.get(k), b = tr5.get(k) ?? { dist: 0, dtS: 0 }, c = trW5.get(k) ?? { dist: 0, dtS: 0 };
    const s0 = ws + k * trancheS * 1000, s1 = Math.min(we, s0 + trancheS * 1000);
    const wd = at(s1) - at(s0);
    console.log(`   ${String(k).padStart(2)}  ${hhmm(s0).slice(0, 8)}  ${fr(wd, 0).padStart(11)}  ${fr(c.dist, 0).padStart(10)}  ${fr(a.dist, 0).padStart(11)}  ${fr(b.dist, 0).padStart(12)}  ${ratioPct(b.dist > 0 ? a.dist / b.dist : null).padStart(8)}  ${ratioPct(wd > 0 ? a.dist / wd : null).padStart(11)}  ${fr(a.dtS > 0 ? a.dist / a.dtS : null, 2).padStart(9)}  ${fr(s1 > s0 ? wd / ((s1 - s0) / 1000) : null, 2).padStart(8)}`);
  }
  // Où l'écart était le plus fort sur la course entière, et la montre le couvre-t-elle ?
  const a = results.find((r) => r.run === target)?.a;
  if (a) {
    const worst = a.usable.filter((t) => Math.abs(t.ratio - 1) > 0.09).map((t) => ({ k: t.k, ratio: t.ratio, from: a.t0 + t.k * trancheS * 1000, to: a.t0 + (t.k + 1) * trancheS * 1000 }));
    const inside = worst.filter((w) => w.from >= ws && w.to <= we).length;
    console.log(`  Course entière : ${worst.length} tranches à plus de 9 % d'écart, ${inside} dans la fenêtre de la montre, ${worst.length - inside} hors fenêtre ; la montre couvre de ${mmss((ws - T[0].timeMs) / 1000)} à ${mmss((we - T[0].timeMs) / 1000)} depuis le départ (${fr((100 * (we - ws)) / (T[T.length - 1].timeMs - T[0].timeMs), 0)} % de la durée)`);
    for (const w of worst) console.log(`    tranche ${w.k} (${mmss((w.from - a.t0) / 1000)}-${mmss((w.to - a.t0) / 1000)} depuis le départ) : Tracker / positions ${ratioPct(w.ratio)} ${w.from >= ws && w.to <= we ? '[couverte par la montre]' : '[hors montre]'}`);
  }
}
