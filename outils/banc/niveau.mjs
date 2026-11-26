// Banc de test : la ligne « Niveau » du Profil (lot 230, note de niveau sportif), premier cadre que la racine entoure.
// Usage : node niveau.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 3 min. Deux sportifs synthétiques de l'étude (`docs/backlog/230-etude.md`, §6),
// chacun dans un contexte de navigation neuf, importés par la page Course, l'heure de la page fixée à un jeudi midi :
//  - le coureur de 28 ans : 3 courses de 45 min à 15 km/h par semaine depuis 12 semaines ; sa forme vient de son
//    meilleur 10 km (40 min 02, VO2max 52, rang 73) plutôt que du 5 km de l'étude (rang 65) : note 80, « Très sportif » ; puis le même sans année de naissance : l'invite vers Réglages › Pratiquant ;
//  - la marcheuse de 62 ans : 1 h de marche à 4,8 km/h chaque jour depuis 6 semaines, 3 par semaine avant, sans
//    forme mesurée : note 74 au plafond, « Sportif ».
// Pour chacun, à 390×844, 844×390 et 1400×1000 : le chiffre et le palier de la ligne repliée, sa hauteur, la longueur de
// la racine (`data-longueur`) repliée puis dépliée (elle ne doit pas changer), les parts dépliées, aucun débordement.
// Avec un dossier, une capture par taille, repliée et dépliée.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node niveau.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Historique synthétique : semaines comptées depuis un lundi, 50 semaines avant celle d'aujourd'hui ---
const today = new Date();
const dow = (today.getDay() + 6) % 7;
const mon0 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 50 * 7);
const W = 50;
const dayAt = (w, d = 0, h = 12) => new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + w * 7 + d, h).getTime();
/** Jeudi midi de la semaine `W` : l'heure de la page. */
const NOW = dayAt(W, 3, 12);
const gpxOf = (t0, minutes, kmh, name) => {
  const step = (kmh / 3.6) * 10;
  const points = [];
  for (let k = 0; k <= minutes * 6; k++) {
    points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * step) / 80470).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 10_000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>running</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};

/** Coureur : lundi, mercredi, vendredi des `weeks` semaines passées, lundi et mercredi de la semaine en cours. */
const runnerFiles = (weeks) => {
  const files = [];
  for (let w = W - weeks; w < W; w++) for (const d of [0, 2, 4]) files.push([`course-s${w}-j${d}.gpx`, gpxOf(dayAt(w, d, 8), 45, 15, `course ${w}.${d}`)]);
  for (const d of [0, 2]) files.push([`course-s${W}-j${d}.gpx`, gpxOf(dayAt(W, d, 8), 45, 15, `course ${W}.${d}`)]);
  return files;
};

/** Marcheuse : 1 h chaque jour des 42 derniers jours (aujourd'hui compris), lundi, mercredi et vendredi des 6 semaines d'avant. */
const walkerFiles = () => {
  const files = [];
  const first = new Date(NOW);
  for (let k = 0; k < 42; k++) {
    const t = new Date(first.getFullYear(), first.getMonth(), first.getDate() - k, 8).getTime();
    files.push([`marche-j${k}.gpx`, gpxOf(t, 60, 4.8, `marche ${k}`)]);
  }
  for (let w = W - 12; w < W - 6; w++) for (const d of [0, 2, 4]) files.push([`marche-s${w}-j${d}.gpx`, gpxOf(dayAt(w, d, 8), 60, 4.8, `marche ${w}.${d}`)]);
  return files;
};

const clockSource = (fakeMs) => `(() => {
  const off = ${fakeMs - Date.now()};
  const R = Date;
  class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
  window.Date = D;
})();`;

const SIZES = [
  { name: '390x844', w: 390, h: 844, mobile: true },
  { name: '844x390', w: 844, h: 390, mobile: true },
  { name: '1400x1000', w: 1400, h: 1000, mobile: false },
];

/** Relevé de la ligne et de la racine. */
const MEASURE = `(() => {
  const line = document.querySelector('.profile-level');
  const c = document.querySelector('canvas.profile-root');
  const toggle = line?.querySelector('.profile-level__toggle');
  return {
    note: line?.querySelector('.profile-level__note')?.textContent ?? null,
    palier: line?.querySelector('.profile-level__caption')?.textContent ?? null,
    pas: [...(line?.querySelectorAll('.profile-level__step.is-on') ?? [])].length,
    hauteur: Math.round(line?.getBoundingClientRect().height ?? -1),
    ouvert: toggle?.getAttribute('aria-expanded'),
    longueur: Number(c?.dataset.longueur), niveau: c?.dataset.niveau,
    premier: document.querySelector('.profile-level') === document.querySelector('.profile-head')?.nextElementSibling,
    avantPeriode: Boolean(line && document.querySelector('.profile-periods') && (line.compareDocumentPosition(document.querySelector('.profile-periods')) & Node.DOCUMENT_POSITION_FOLLOWING)),
    parts: [...(line?.querySelectorAll('.profile-level__part') ?? [])].map((p) => [
      p.querySelector('.profile-level__part-name')?.textContent, p.querySelector('.profile-level__part-points')?.textContent,
      p.querySelector('.profile-level__weight')?.textContent, p.querySelector('.profile-level__proof')?.textContent,
    ].join(' | ')),
    corps: [...(line?.querySelectorAll('.profile-level__body > .ui-hint') ?? [])].map((p) => p.textContent),
    debordement: document.documentElement.scrollWidth > window.innerWidth,
    colonnes: line?.querySelector('.profile-level__parts') ? getComputedStyle(line.querySelector('.profile-level__parts')).gridTemplateColumns.split(' ').length : 0,
  };
})()`;

/** Capture de toute la page en JPEG. */
const capture = async (b, name, size) => {
  const page = await b.evaluate(`document.querySelector('canvas.profile-root')?.parentElement?.offsetHeight ?? ${size.h}`);
  const shot = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: page, scale: 1 } });
  writeFileSync(`${shotDir}/${name}.jpg`, Buffer.from(shot.result.data, 'base64'));
};

/** Un sportif : contexte neuf, import, profil du pratiquant, puis les trois tailles. Rend la hauteur repliée à 390 px. */
const scenario = async (label, files, profile, expected) => {
  console.log(`\n--- ${label} ---`);
  const b = await connect({ port, width: 1400, height: 1000, isolated: true });
  await b.go('/course', 5000);
  await b.waitFor(`Boolean(document.querySelector('input[type=file][accept*=".gpx"]'))`, { timeout: 8000, every: 50, label: 'champ de fichier' });
  console.log('import :', await b.evaluate(`(() => {
    const input = document.querySelector('input[type=file][accept*=".gpx"]');
    if (!input) return 'absent';
    const dt = new DataTransfer();
    for (const [name, text] of ${JSON.stringify(files)}) dt.items.add(new File([text], name, { type: 'application/gpx+xml' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`), `${files.length} fichiers`);
  await b.waitFor(async () => ((await b.records())?.length ?? 0) >= files.length, { timeout: 60000, every: 500, label: 'fiches importées' });
  await b.settle({ max: 3000, label: 'import' });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: clockSource(NOW) });
  const setProfile = (p) => b.evaluate(`(() => {
    localStorage.setItem('tracker.runnerProfile', JSON.stringify({ me: ${JSON.stringify(p)} }));
    const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); delete s.profil; localStorage.setItem('tracker.sections', JSON.stringify(s));
    return 'ok';
  })()`);
  await setProfile(profile);

  let collapsed390 = null;
  for (const size of SIZES) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.mobile });
    // Toucher émulé au téléphone : pointeur grossier, donc barre du bas, ou rail à gauche une fois tourné.
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: size.mobile, maxTouchPoints: size.mobile ? 5 : 1 });
    await b.evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); delete s.profil; localStorage.setItem('tracker.sections', JSON.stringify(s)); })()`);
    await b.go('/', 6000);
    await b.waitFor(`Number(document.querySelector('canvas.profile-root')?.dataset.longueur) > 0`, { timeout: 8000, label: 'racine dessinée' });
    await b.settle({ max: 1500, label: 'racine' });
    const shut = await b.evaluate(MEASURE);
    console.log(`${size.name} repliée : niveau ${shut.note} · ${shut.palier} (${shut.pas} pas de l'échelle) | hauteur ${shut.hauteur} px | racine niveau ${shut.niveau}, longueur ${shut.longueur} px | débordement ${shut.debordement}`);
    if (size.name === '390x844') collapsed390 = shut.hauteur;
    check(`${size.name} : ligne repliée, premier cadre sous l'en-tête, avant la période`, shut.ouvert === 'false' && shut.premier && shut.avantPeriode);
    check(`${size.name} : chiffre et palier`, shut.note === expected.note && shut.palier === expected.palier, `${shut.note} · ${shut.palier}`);
    if (shotDir) await capture(b, `niveau-${expected.id}-${size.name}-repliee`, size);
    await b.click('.profile-level__toggle');
    await b.settle({ max: 1500, label: 'dépliée' });
    // La racine se redessine sur la page allongée : sa longueur ne doit pas bouger.
    await b.waitFor(`document.querySelector('canvas.profile-root')?.dataset.longueur !== undefined`, { timeout: 2000 });
    const open = await b.evaluate(MEASURE);
    console.log(`${size.name} dépliée : hauteur ${open.hauteur} px | longueur ${open.longueur} px | ${open.colonnes} colonne(s) | débordement ${open.debordement}`);
    for (const p of open.parts) console.log(`  ${p}`);
    for (const p of open.corps) console.log(`  « ${p} »`);
    check(`${size.name} : dépliée`, open.ouvert === 'true' && open.parts.length === expected.parts);
    check(`${size.name} : longueur de la racine identique repliée et dépliée`, shut.longueur > 0 && open.longueur === shut.longueur, `${shut.longueur} / ${open.longueur}`);
    check(`${size.name} : rien ne déborde`, !shut.debordement && !open.debordement);
    if (expected.parts > 0) check(`${size.name} : parts ${size.w >= 600 ? 'en trois colonnes' : 'empilées'}`, open.colonnes === (size.w >= 600 ? 3 : 1), String(open.colonnes));
    if (shotDir) await capture(b, `niveau-${expected.id}-${size.name}-depliee`, size);
  }
  return { b, collapsed390, setProfile };
};

const runner = await scenario('coureur de 28 ans', runnerFiles(12), { birthYear: 1998, sex: 'm', weightKg: 70 },
  { id: 'coureur', note: '80', palier: 'Très sportif', parts: 3 });
// Le même sans année de naissance : l'invite, à la même hauteur repliée.
await runner.b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await runner.b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await runner.setProfile({ sex: 'm', weightKg: 70 });
await runner.b.go('/', 6000);
await runner.b.waitFor(`Number(document.querySelector('canvas.profile-root')?.dataset.longueur) > 0`, { timeout: 8000, label: 'racine dessinée' });
await runner.b.settle({ max: 1500, label: 'sans âge' });
const anonymous = await runner.b.evaluate(MEASURE);
console.log(`\nsans année de naissance : niveau ${anonymous.note} · ${anonymous.palier} | hauteur ${anonymous.hauteur} px`);
check('sans année de naissance : invite, même hauteur repliée', anonymous.note === '—' && anonymous.palier === 'Profil à compléter' && anonymous.hauteur === runner.collapsed390,
  `${anonymous.hauteur} / ${runner.collapsed390}`);
await runner.b.click('.profile-level__toggle');
await runner.b.settle({ max: 1500, label: 'invite dépliée' });
console.log('  dépliée :', (await runner.b.evaluate(MEASURE)).corps.join(' / '));
const runnerLogs = runner.b.logs;
await runner.b.close();

const walker = await scenario('marcheuse de 62 ans', walkerFiles(), { birthYear: 1964, sex: 'f', weightKg: 60 },
  { id: 'marcheuse', note: '74', palier: 'Sportif', parts: 3 });
check('hauteur repliée identique pour les deux sportifs (390 px)', walker.collapsed390 === runner.collapsed390, `${walker.collapsed390} / ${runner.collapsed390}`);
const walkerLogs = walker.b.logs;
await walker.b.close();

console.log('\n--- console (erreurs) ---');
[...runnerLogs, ...walkerLogs].filter((l) => !l.startsWith('warning')).forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
