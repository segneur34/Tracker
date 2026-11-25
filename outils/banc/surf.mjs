// Banc de test : le surf (§10, point 97).
// Usage : node surf.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même deux sessions synthétiques et les importe par la page,
// dans un `File`. Il vérifie :
//  1. la famille Surf sur l'accueil, dans la barre du haut, et ses deux activités dans Réglages (carte d'activité :
//     « Seuil de vague », « Seuil de vol » pour Surf foil, ni pente ni terrain) ;
//  2. une matinée (trois vagues, la troisième prise en remontant) : la ligne de la bibliothèque, puis l'analyse, onglets
//     général, vagues (tableau, tri, « Voir », podium), rame (retours jusqu'à la zone du pic, première sortie), graphiques ;
//  2 bis. le sens des vagues (lot 233) : la ligne des réglages, la boussole sur la carte (poignée tirée sur le cercle,
//     « Inverser », angle tapé, « Terminé »), le brouillon, la fiche, « Calculé » et « Annuler » ;
//  3. les réglages de la session : seuil de vague imposé (une vague en moins), enregistré dans la fiche, relu après
//     rechargement, puis « Défaut » et « Annuler » ;
//  4. une session de surf foil (un vol de trois vagues reliées en pompant, puis un vol court) : case Foil de la
//     session, onglet « vols », plus long vol, ligne de la bibliothèque ;
//  5. la vitesse max (lot 150) : celle de la page et celle de la fiche, une vague ; une rame sans vague n'en a pas (« — », 0 dans la fiche) ;
//  5 bis. une vague molle (lot 233) : montée en marches depuis une rame à 1,2 m/s, début remonté à la borne basse, départ compris ;
//  5 ter. le départ des vagues (sans foil, lot 233) : deux vagues à vraie mise en vitesse, l'une depuis 1 km/h, l'autre après une
//     rame plate à 4 km/h ; durée et heure de début avec le départ, vitesse max et nombre de vagues inchangés, carte (vague
//     montrée seule), courbe (bandes et série orange) et les deux phrases d'aide ;
//  6. la page à 390 × 844, sans débordement ; le sens des vagues en plein écran (boussole entière, poignée sous le
//     bandeau et la barre « Non enregistré », passée dans la carte agrandie).
// Verdicts (lot 159) : les chiffres attendus par construction des phases (MORNING, FOIL) sont contrôlés (`check`), le
// script finit par « Tout passe. » ou le nombre d'échecs, code 0 ou 1. Les heures des vagues (fuseau du poste) ne le sont pas.
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node surf.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Sessions synthétiques : phases à vitesse et cap constants, nord = le large ---
const M_PER_DEG_LAT = 111_195;
const buildGpx = (name, startMs, phases) => {
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const pts = [];
  const push = (speed, heading) => pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(startMs + t * 1000).toISOString()}</time>`
    + `<extensions><speed>${speed}</speed>${speed > 0 ? `<course>${heading}</course>` : ''}</extensions></trkpt>`);
  push(0, 0);
  for (const [s, speed, heading = 0] of phases) {
    for (let k = 0; k < s; k++) {
      lat += (speed * Math.cos((heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (speed * Math.sin((heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += 1;
      push(speed, heading);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>surf</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
// [durée en s, vitesse en m/s, cap]
const MORNING = [
  [60, 0], [60, 1.2], [50, 1], [4, 0.1], [40, 1], [4, 0.1], [26, 1], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1],
  [5, 1.6, 180], [8, 4.5, 190], [80, 1], [30, 0.1],
];
const FOIL = [
  [60, 1], [30, 0.1], [5, 2, 180], [15, 6.5, 200], [20, 4, 20], [15, 6.5, 190], [20, 4, 10], [10, 6.5, 200],
  [40, 0.8], [30, 0.1], [5, 2, 180], [12, 6.5, 200], [30, 0.8],
];
const T_MORNING = Date.UTC(2026, 9, 10, 7, 0, 0);
const T_FOIL = Date.UTC(2026, 9, 9, 15, 0, 0);
const PADDLE = [[1800, 2.2], [20, 2.4]];
const T_PADDLE = Date.UTC(2026, 9, 8, 15, 0, 0);
const SOFT = [[60, 0], [58, 1.2], [2, 1.7], [2, 2.1], [2, 2.5], [2, 2.9], [6, 3], [60, 1]];
// Deux secondes après la minute : l'heure affichée (à la minute) bascule entre t = 117 s et t = 118 s, dernier point de la rame
// à 1,2 m/s et début de la vague molle avec son départ.
const T_SOFT = Date.UTC(2026, 9, 7, 15, 0, 2);
/** Montée en marches de 1 s, de `de` à `a` m/s en `s` secondes (au cap donné). */
const rampe = (de, a, s, cap = 180) => Array.from({ length: s }, (_, k) => [1, Number((de + ((a - de) * (k + 1)) / s).toFixed(3)), cap]);
// Deux vagues avec une vraie mise en vitesse, sans foil. Vague 1 : rame à 1 km/h (sous le plancher d'arrêt de 2 km/h), puis
// 8 s de rampe de 0,28 à 1,9 m/s (le départ), 4 s jusqu'à 5 m/s, 8 s à 5 m/s, retour. Vague 2 : une rame plate à 4 km/h
// pendant 30 s (qui ne doit pas être avalée), 8 s de rampe de 1,11 à 6 m/s, 8 s à 6 m/s, retour. Instants (points) : rampe 1 de
// t = 96 à 103 s, vague 1 comptée dès t = 104 s (2,7 m/s : borne basse de 1,94 m/s franchie), plateau 108 à 115 s ; rame plate 2 de
// 190 à 219 s, rampe 2 de 220 à 227 s (1,7 m/s à t = 220, 2,3 à 221), plateau 228 à 235 s.
const DEPART = [
  [65, 0], [30, 0.28],
  ...rampe(0.28, 1.9, 8), ...rampe(1.9, 5, 4), [8, 5, 180], ...rampe(5, 1, 4), [40, 1], [30, 0.1],
  [30, 1.11], ...rampe(1.11, 6, 8), [8, 6, 180], ...rampe(6, 1, 4), [40, 1], [30, 0.1],
];
// 35 s après la minute : le début de la vague 1 (t = 96 s) tombe à 2 min 11 s, celui de la vague 2 (t = 219 s) à 4 min 14 s ;
// une rame plate de 15 s avalée avant la vague 2 la ferait partir à 3 min 59 s, minute d'avant.
const T_DEPART = Date.UTC(2026, 9, 6, 15, 0, 35);

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, mouse, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Contrôle qu'un texte relevé contient `attendu` (chaîne ou expression régulière). */
const contient = (quoi, texte, attendu) => check(quoi, typeof attendu === 'string' ? String(texte).includes(attendu) : attendu.test(String(texte)), String(texte).slice(0, 300));

const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    ?? [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const tab = (label) => clickText(label, '.an-carte-col .ui-tab');
/** Ouvre un onglet s'il est fermé : les onglets ouverts sont mémorisés d'une ouverture à l'autre. */
const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent'; if (t.getAttribute('aria-pressed') === 'true') return 'déjà ouvert'; t.click(); return 'ok';
})()`);
/** Texte du panneau d'analyse dont le titre commence ainsi. */
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ').slice(0, 900) : '(absent)';
})()`);
const recordAt = async (startMs) => (await records()).find((r) => r.summary?.startMs === startMs);
/** Champ d'un seuil de la session, par son libellé. */
const field = (label) => `document.querySelector('input[aria-label=${JSON.stringify(label)}]')`;
const setField = (label, value) => evaluate(`(() => {
  const i = ${field(label)};
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);

// Rangée « avancé » des analyses ouverte d'office, onglets posés dans `tracker.sections` rejoués à chaque analyse (`lib/onglets.mjs`, 05/11) ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await blockNetwork();

// 1. Accueil, barre, Réglages.
await go('/');
// Tuiles des familles de l'accueil (`.home-family__name`, le sélecteur `.shell-main a` d'avant ne trouvait plus rien).
const accueil = await evaluate(`[...document.querySelectorAll('.home-family__name')].map((n) => n.textContent.trim()).join(', ')`);
const barre = await evaluate(`[...document.querySelectorAll('.shell-toplink')].map((a) => a.textContent).join(', ')`);
console.log('accueil :', accueil, '| barre :', barre);
check('accueil et barre : la famille Surf', /\bSurf\b/.test(accueil ?? '') && /\bSurf\b/.test(barre ?? ''), `${accueil} | ${barre}`);
await go('/parametres');
await clickText('Activités', '[role=button]');
await wait(400);
// Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
await wait(300);
console.log('Réglages, familles :', await evaluate(`[...document.querySelectorAll('.settings-activities__family')].map((f) => f.textContent).join(', ')`));
console.log('Réglages, résumés surf :', await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => /Surf/.test(c.innerText)).map((c) => c.innerText.replace(/\\n+/g, ' ')).join(' | ')`));
for (const name of ['Surf foil', 'Surf']) {
  await evaluate(`[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === ${JSON.stringify(name)})?.querySelector('.settings-activity__toggle').click()`);
  await wait(300);
}
for (const part of ['Affichage', 'Onglet analyse']) await clickText(part, '.settings-activity button');
await wait(300);
const cartes = await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => c.querySelector('.settings-activity__body')).map((c) => [...c.querySelectorAll('.settings-row__label')].map((l) => l.textContent).join(', ')).join(' || ')`);
console.log('carte Surf ouverte :', cartes);
check('Réglages : « Seuil de vague » (Surf) et « Seuil de vol » (Surf foil)', /Seuil de vague/.test(cartes ?? '') && /Seuil de vol/.test(cartes ?? ''), cartes);
await shoot('surf-reglages');

// 2. La matinée : import, bibliothèque, analyse.
await go('/surf');
console.log('import matinée :', await importGpx(buildGpx('Matinée', T_MORNING, MORNING), 'matinee.gpx'));
const morning = await waitFor(() => recordAt(T_MORNING), { timeout: 6000, label: 'fiche matinée' });
await settle({ max: 2000, label: 'import matinée' });
console.log('fiche :', morning ? `${morning.gpx}, ${morning.sport}, activité ${morning.activityId}, vagues ${morning.summary.waveCount}, plus longue ${Math.round(morning.summary.longestWaveM)} m, glisse ${Math.round(morning.summary.movingTimeS)} s` : '(absente)');
// Par construction (MORNING) : vagues de 12, 20 et 8 s sur 60, 120 et 36 m (5, 6 et 4,5 m/s), 40 s sur la vague, 700 s.
check('matinée, fiche : 3 vagues, plus longue 120 m, 40 s sur la vague',
  morning?.summary?.waveCount === 3 && Math.round(morning.summary.longestWaveM) === 120 && Math.round(morning.summary.movingTimeS) === 40, JSON.stringify(morning?.summary));
const ligneMatinee = await evaluate(`document.querySelector('.lib-list')?.innerText.replace(/\\n+/g, ' / ').slice(0, 300) ?? '(vide)'`);
console.log('bibliothèque :', ligneMatinee,
  '| vue planifiées :', await evaluate(`[...document.querySelectorAll('.ui-tab')].some((t) => /planifi/.test(t.textContent))`));
// 668 m : l'intégrale des vitesses (règle 6), 1,2 m/s × 60 s de départ comprises.
contient('matinée, bibliothèque : 11 min, 0,67 km, 3 vagues, plus longue 120 m', ligneMatinee, '11 min · 0,67 km · 3 vagues · plus longue 120 m');
const morningPath = `/surf/analyse?session=${encodeURIComponent(morning?.gpx ?? '')}`;
await go(morningPath, 5000);
console.log('titre :', await evaluate(`document.querySelector('h1')?.textContent`), '| onglets :', await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`));
console.log('légende :', await evaluate(`document.querySelector('.speed-legend')?.getAttribute('title') ?? document.querySelector('.speed-legend')?.textContent ?? '(absente)'`));
const generalMatinee = await panel('Général');
console.log('général :', generalMatinee);
for (const [quoi, attendu] of [['durée 11 min', 'Durée de la session / 11 min'], ['3 vagues', 'Vagues / 3 '], ['40 s sur la vague, 5,7 % de 700 s', 'Sur la vague (5,7 %) / 40 s'],
  ['plus longue vague 120 m', 'Plus longue vague / 120 m'], ['vitesse max 21,6 km/h (6 m/s)', 'Vitesse max / 21,6 km/h']]) contient(`matinée, général : ${quoi}`, generalMatinee, attendu);
console.log('vagues :', await openTab('vagues'));
await wait(500);
const vagues = await panel('Vagues');
console.log('panneau :', vagues);
for (const [n, s, m, v] of [[1, 12, 60, '18,0'], [2, 20, 120, '21,6'], [3, 8, 36, '16,2']]) {
  contient(`matinée, vague ${n} : ${s} s, ${m} m, ${v} km/h`, vagues, new RegExp(`(^|/ )${n}\\t\\d\\d:\\d\\d\\t${s} s\\t${m} m\\t${v}\\t`));
}
console.log('Voir la vague 2 :', await evaluate(`(() => {
  const row = [...document.querySelectorAll('.an-carte-panels tr')].find((r) => r.cells[0]?.textContent === '2');
  const b = row?.querySelector('button'); if (!b) return 'absent'; b.click(); return 'ok';
})()`));
await wait(500);
console.log('surbrillance :', await evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#7b1fa2"]').length`), 'trait(s) violet(s)');
await shoot('surf-vague');
console.log('podium :', await clickText('Les 3 plus longues'));
await wait(500);
console.log('surbrillance :', await evaluate(`['#d32f2f', '#f57c00', '#388e3c'].map((c) => document.querySelectorAll('.leaflet-overlay-pane path[stroke="' + c + '"]').length).join('/')`), 'traits du podium');
console.log('tri par distance :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('.an-carte-panels [role=radiogroup] button')].find((x) => x.textContent.trim() === 'Distance');
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(300);
const ordre = await evaluate(`[...document.querySelectorAll('.an-carte-panels tbody tr')].map((r) => r.cells[0].textContent + ':' + r.cells[3].textContent).join(' ')`);
console.log('ordre :', ordre);
check('matinée, tri par distance : 2, 1, 3', ordre === '2:120 m 1:60 m 3:36 m', ordre);
console.log('rame :', await openTab('rame'));
await wait(500);
const rame = await panel('Rame');
console.log('panneau :', rame);
// Retour au pic (lot 233) : jusqu'à l'entrée dans la zone du pic. Le sens des vagues oriente la zone dès la première
// vague : mince, le long de la ligne des départs, 5 m de marge côté plage (le sens n'est seulement pas jugé fiable avec
// trois vagues, il n'écarte donc aucune remontée pompée). Après la vague 1, rame à 1 m/s : la zone est atteinte vers
// 27 s, 27 m ; la vague 3 part dans la zone, la remontée qui la précède y entre vers 29 s, 29 m, sans être enchaînée.
// Avant le lot : 1 min 40 et 100 m (jusqu'à l'attente), vague 3 enchaînée.
contient('matinée, retour au pic après la vague 1 : 27 s, 27 m', rame, /vague 1\t2[678] s\t2[678] m\t/);
contient('matinée, retour au pic après la vague 2 : 29 s, 29 m', rame, /vague 2\t(?:29|30) s\t(?:29|30) m\t/);
contient('matinée, « Vagues enchaînées 0 »', rame, 'Vagues enchaînées / 0 ');
console.log('fermer vagues :', await tab('vagues'), '| surbrillance restante :', await evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#d32f2f"]').length`));
console.log('graphiques :', await openTab('graphiques'));
await settle({ max: 800 });
console.log('graphe :', await evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim() === 'Vitesse');
  const p = t?.closest('.an-carte-panels > *');
  return p ? p.querySelectorAll('.recharts-surface').length + ' graphe, ' + p.querySelectorAll('.recharts-reference-area').length + ' bandes' : 'absent';
})()`));
await shoot('surf-onglets');

// 2 bis. Sens des vagues : la ligne des réglages, la boussole sur la carte, le brouillon, la fiche.
const ligneSens = () => evaluate(`(() => {
  const s = [...document.querySelectorAll('.an-carte-panels strong')].find((x) => x.textContent.trim().startsWith('Sens des vagues'));
  return s ? s.parentElement.innerText.replace(/\\n+/g, ' ') : '(absente)';
})()`);
const sensText = () => evaluate(`document.querySelector('.an-map-panel .an-wind__value')?.textContent ?? '(absent)'`);
const sensBar = () => evaluate(`document.querySelector('.an-map-panel .an-wind__bar')?.innerText.replace(/\\n+/g, ' ') ?? '(absente)'`);
const boutonSens = (scope, text) => evaluate(`(() => {
  const b = [...(document.querySelector(${JSON.stringify(scope)})?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false; b.click(); return true;
})()`);
const retours = async () => ((await panel('Rame')).match(/vague \d+\t[^\t]+\t[^\t]+\t/g) ?? []).join(' | ');
console.log('réglages :', await openTab('réglages'));
await wait(500);
const retoursAvant = await retours();
const sensAvant = await ligneSens();
console.log('sens des vagues, avant :', sensAvant, '| retours :', retoursAvant);
contient('sens des vagues : « Sens des vagues : » avec un cap, « calculé » ou « calculé · peu sûr », « Régler »', sensAvant, /^Sens des vagues : \d+° calculé( · peu sûr)? ?Régler/i);
const sensCalcule = Number(sensAvant.match(/(\d+)°/)?.[1]);
check('sens des vagues : « Régler » ouvre la boussole sur la carte', (await boutonSens('.an-carte-panels', 'Régler')) && (await settle({ max: 1200 }), await evaluate(`Boolean(document.querySelector('.an-map-panel .an-wind__dial'))`)));
console.log('boussole :', await sensBar());
await shoot('surf-sens-boussole');
// La poignée elle-même : centre, rayon du cercle et recouvrement avec le bandeau et la barre « Non enregistré ».
const poignee = (zone) => evaluate(`(() => {
  const z = document.querySelector(${JSON.stringify(zone)});
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const h = box(z.querySelector('.an-wind__handle')), c = box(z.querySelector('.an-wind__dial circle'));
  const hx = (h.l + h.r) / 2, hy = (h.t + h.b) / 2, cx = (c.l + c.r) / 2, cy = (c.t + c.b) / 2, R = (c.r - c.l) / 2;
  const bandeau = box(z.querySelector('.an-wind__bar')), save = box(document.querySelector('.ui-savebar'));
  const plein = (b) => b !== null && b.r > b.l && b.b > b.t;
  return { hx, hy, cx, cy, R, dist: Math.hypot(hx - cx, hy - cy), h, bandeau, save, valide: R > 50 && plein(h) && plein(bandeau) };
})()`);
const sePose = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const pleine = (b) => b !== null && b.r > b.l && b.b > b.t;
/** Tire la poignée jusqu'à l'angle donné (degrés), sur le cercle, par trois positions. */
const tirer = async (zone, deg) => {
  const p = await poignee(zone);
  const pt = (d) => [p.cx + p.R * Math.sin((d * Math.PI) / 180), p.cy - p.R * Math.cos((d * Math.PI) / 180)];
  await mouse('mousePressed', p.hx, p.hy);
  await mouse('mouseMoved', ...pt(deg / 2));
  await mouse('mouseMoved', ...pt(deg));
  await wait(200);
  return pt(deg);
};
const p0 = await poignee('.an-map-panel');
check('sens des vagues : la poignée est sur le cercle (centre à ± 4 px du rayon)', p0.valide && Math.abs(p0.dist - p0.R) <= 4, JSON.stringify({ dist: p0.dist, R: p0.R }));
const fin = await tirer('.an-map-panel', 90);
check('sens des vagues : la flèche suit la poignée (« Vagues 90° »)', (await sensText()) === 'Vagues 90°', await sensText());
await mouse('mouseReleased', ...fin);
await settle({ max: 1500 });
const sens90 = await ligneSens();
console.log('sens des vagues, tiré à 90° :', sens90, '|', await sensBar());
contient('sens des vagues : « 90° saisi · calculé N° »', sens90, new RegExp(`^Sens des vagues : 90° saisi · calculé ${sensCalcule}° ?Régler`, 'i'));
const retours90 = await retours();
console.log('retours, sens à 90° :', retours90);
check('sens des vagues : le brouillon propose « Enregistrer la session »', await evaluate(`document.body.textContent.includes('Enregistrer la session')`));
check(`sens des vagues : les retours au pic changent avec le sens tourné (avant : ${retoursAvant} ; après : ${retours90})`, retours90 !== retoursAvant, retours90);
await boutonSens('.an-map-panel .an-wind', 'Inverser');
await settle({ max: 1200 });
check('sens des vagues : « Inverser » donne 270°', (await sensText()) === 'Vagues 270°', await sensText());
console.log('retours, sens à 270° :', await retours());
console.log('champ angle 135 :', await setField('Sens des vagues en degrés', '135'));
await evaluate(`(() => { const i = ${field('Sens des vagues en degrés')}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await settle({ max: 1200 });
check('sens des vagues : angle tapé, Entrée : 135°', (await sensText()) === 'Vagues 135°' && (await ligneSens()).includes('135° saisi'), `${await sensText()} | ${await ligneSens()}`);
await boutonSens('.an-map-panel .an-wind', 'Terminé');
await wait(500);
check('sens des vagues : « Terminé » ferme la boussole', !(await evaluate(`Boolean(document.querySelector('.an-wind'))`)));
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await recordAt(T_MORNING))?.analysis?.waveDirectionDeg !== undefined, { timeout: 2500, label: 'fiche sens' }).catch(() => null);
const fSens = (await recordAt(T_MORNING))?.analysis;
console.log('fiche, analyse :', JSON.stringify(fSens));
await go(morningPath, 5000);
await openTab('réglages');
await wait(500);
const sensRelu = await ligneSens();
console.log('sens des vagues, après rechargement :', sensRelu, '| retours :', await retours());
contient('sens des vagues : après rechargement, toujours « 135° saisi »', sensRelu, /^Sens des vagues : 135° saisi/);
await boutonSens('.an-carte-panels', 'Régler');
await settle({ max: 1200 });
await boutonSens('.an-map-panel .an-wind', 'Calculé');
await settle({ max: 1200 });
const sensRevenu = await ligneSens();
console.log('« Calculé » :', sensRevenu, '|', await sensBar());
contient('sens des vagues : « Calculé » revient au sens calculé du départ', sensRevenu, new RegExp(`^Sens des vagues : ${sensCalcule}° calculé`));
check('sens des vagues : les retours reviennent à ceux du départ', (await retours()) === retoursAvant, await retours());
await boutonSens('.an-map-panel .an-wind', 'Terminé');
await wait(400);
console.log('Annuler :', await clickText('Annuler'));
await wait(600);
const sensAnnule = await ligneSens();
console.log('sens des vagues, après « Annuler » :', sensAnnule);
contient('sens des vagues : « Annuler » rend le sens saisi enregistré', sensAnnule, /^Sens des vagues : 135° saisi/);
// Remise à zéro de la fiche : « Calculé » puis « Enregistrer la session ».
await boutonSens('.an-carte-panels', 'Régler');
await settle({ max: 1200 });
await boutonSens('.an-map-panel .an-wind', 'Calculé');
await boutonSens('.an-map-panel .an-wind', 'Terminé');
await wait(400);
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await wait(800);
console.log('sens des vagues, fiche remise :', await ligneSens());
contient('sens des vagues : fiche remise sur le calculé', await ligneSens(), /^Sens des vagues : \d+° calculé/);


// 3. Réglages de la session : seuil de vague.
console.log('réglages :', await openTab('réglages'));
await wait(500);
console.log('panneau :', await panel('Réglages de la session'));
console.log('seuil de vague 20 km/h :', await setField('Seuil de vague', '20'));
await settle({ max: 800 });
const vaguesA20 = await evaluate(`document.querySelector('.an-carte-panels')?.innerText.match(/Vagues\\n?([^\\n]+)/)?.[1]`);
console.log('vagues :', vaguesA20, '| barre :', await evaluate(`document.body.innerText.match(/Non enregistr[^\\n]*/)?.[0] ?? '(aucune)'`));
// À 20 km/h, seule la vague 2 (21,6 km/h) passe le seuil.
check('seuil de vague 20 km/h : 1 vague', /^1 \(/.test(vaguesA20 ?? ''), vaguesA20);
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await recordAt(T_MORNING))?.analysis?.activeThreshold != null, { timeout: 2500, label: 'fiche seuil' });
const saved = await recordAt(T_MORNING);
console.log('fiche : seuil', saved?.analysis?.activeThreshold, '| vagues du résumé', saved?.summary?.waveCount);
check('seuil 20 enregistré : fiche à 20, 1 vague au résumé', saved?.analysis?.activeThreshold === 20 && saved?.summary?.waveCount === 1, `${saved?.analysis?.activeThreshold} / ${saved?.summary?.waveCount}`);
await go(morningPath, 5000);
await openTab('réglages');
await wait(400);
const seuilRelu = await evaluate(`${field('Seuil de vague')}?.value`);
console.log('après rechargement, seuil :', seuilRelu, '| Défaut :', await clickText('Défaut', '.an-carte-panels button'));
check('après rechargement, seuil relu à 20', seuilRelu === '20', seuilRelu);
await wait(600);
const generalDefaut = await panel('Général');
console.log('seuil :', await evaluate(`${field('Seuil de vague')}?.value`), '| général :', generalDefaut.slice(0, 200));
contient('« Défaut » : retour à 3 vagues', generalDefaut, 'Vagues / 3 ');
console.log('Annuler :', await clickText('Annuler'));
await wait(400);

// 4. Surf foil : case de la session, onglet vols.
await go('/surf');
console.log('import foil :', await importGpx(buildGpx('Foil', T_FOIL, FOIL), 'foil.gpx'));
const foil = await waitFor(() => recordAt(T_FOIL), { timeout: 6000, label: 'fiche foil' });
await settle({ max: 2000, label: 'import foil' });
const foilPath = `/surf/analyse?session=${encodeURIComponent(foil?.gpx ?? '')}`;
await go(foilPath, 5000);
await openTab('réglages');
await wait(400);
console.log('case Foil :', await evaluate(`(() => {
  const box = [...document.querySelectorAll('.an-carte-panels label')].find((l) => l.textContent.includes('Foil'))?.querySelector('input[type=checkbox]');
  if (!box) return 'absente'; box.click(); return box.checked ? 'cochée' : 'décochée';
})()`));
await settle({ max: 800 });
console.log('champs :', await evaluate(`[...document.querySelectorAll('.an-carte-panels input[type=number]')].map((i) => i.getAttribute('aria-label') + ' = ' + i.value).join(' | ')`));
console.log('onglets :', await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`));
console.log('vols :', await openTab('vols'));
await wait(500);
const vols = await panel('Vols');
console.log('panneau :', vols);
// Par construction (FOIL) : un vol de 80 s (15 + 20 + 15 + 20 + 10 s) sur 420 m, trois vagues à 6,5 m/s reliées en pompant à
// 4 m/s (40 s hors vague), puis un vol de 12 s sur 78 m ; 92 s de vol sur 292 s.
contient('foil : 2 vols', vols, 'Vols / 2 ');
contient('foil : temps de vol 1 min 32', vols, 'Temps de vol / 1 min 32 ');
contient('foil : plus long vol 80 s, 420 m, 3 vagues, 40 s hors vague', vols, /(^|\/ )1\t[\d:]+\t1 min 20\t420 m\t3\t40 s\t/);
contient('foil : second vol 12 s, 78 m', vols, /(^|\/ )2\t[\d:]+\t12 s\t78 m\t/);
const generalFoil = await panel('Général');
console.log('général :', generalFoil);
for (const [quoi, attendu] of [['4 vagues', 'Vagues / 4 '], ['plus longue vague 98 m', 'Plus longue vague / 98 m'], ['vitesse max 23,4 km/h (6,5 m/s)', 'Vitesse max / 23,4 km/h'],
  ['ratio de vol 31,5 %, 1 min 32', 'Ratio de vol (31,5 %) / 1 min 32']]) contient(`foil, général : ${quoi}`, generalFoil, attendu);
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await waitFor(async () => (await recordAt(T_FOIL))?.analysis?.foil !== undefined, { timeout: 2500, label: 'fiche foil enregistrée' });
const foilSaved = await recordAt(T_FOIL);
console.log('fiche : foil', foilSaved?.analysis?.foil, '| plus long vol', foilSaved?.summary?.longestFlightS, 's | vagues', foilSaved?.summary?.waveCount);
check('foil, fiche : foil vrai, plus long vol 80 s', foilSaved?.analysis?.foil === true && foilSaved?.summary?.longestFlightS === 80, `${foilSaved?.analysis?.foil} / ${foilSaved?.summary?.longestFlightS}`);
await go('/surf');
console.log('bibliothèque :', await evaluate(`document.querySelector('.lib-list')?.innerText.replace(/\\n+/g, ' / ').slice(0, 400) ?? '(vide)'`));

// 5. Vitesse max : la page et la fiche donnent la même, celle d'une vague ; une rame sans vague n'en a pas.
await go(morningPath, 5000);
await openTab('général');
await wait(300);
const morningMax = (await recordAt(T_MORNING))?.summary?.maxSpeedMs ?? 0;
const morningShown = `Vitesse max / ${(morningMax * 3.6).toFixed(1).replace('.', ',')} km/h`;
check(`matinée : la fiche et la page, ${morningShown}`, morningMax > 0 && (await panel('Général')).includes(morningShown), (await panel('Général')).slice(0, 400));
await go('/surf');
console.log('import rame :', await importGpx(buildGpx('Rame', T_PADDLE, PADDLE), 'rame.gpx'));
const paddle = await waitFor(() => recordAt(T_PADDLE), { timeout: 6000, label: 'fiche rame' });
await settle({ max: 2000, label: 'import rame' });
check('rame sans vague : fiche à 0 vague, vitesse max 0', paddle?.summary?.waveCount === 0 && paddle?.summary?.maxSpeedMs === 0, JSON.stringify(paddle?.summary));
await go(`/surf/analyse?session=${encodeURIComponent(paddle?.gpx ?? '')}`, 5000);
await openTab('général');
await wait(300);
check('rame sans vague : « — » sur la page', (await panel('Général')).includes('Vitesse max / —'), (await panel('Général')).slice(0, 400));

// 5 bis. Vague molle : montée en marches de 2 s, le début remonte jusqu'à la borne basse du seuil (9 km/h : sortie sous 7 km/h = 1,94 m/s).
await go('/surf');
console.log('import molle :', await importGpx(buildGpx('Molle', T_SOFT, SOFT), 'molle.gpx'));
const soft = await waitFor(() => recordAt(T_SOFT), { timeout: 6000, label: 'fiche molle' });
await settle({ max: 2000, label: 'import molle' });
await go(`/surf/analyse?session=${encodeURIComponent(soft?.gpx ?? '')}`, 5000);
await openTab('vagues');
await wait(500);
const vaguesMolle = await panel('Vagues');
console.log('vague molle :', vaguesMolle);
// Par construction (SOFT) : rame à 1,2 m/s jusqu'à t = 118 s ; 1,7 m/s en 119-120 s ; la montée franchit la borne basse (2,1 m/s ≥ 1,94)
// en t = 121 s ; 2,1, 2,5, 2,9 m/s (2 s chacun) puis 3,0 m/s (6 s) : la vague compte 12 points (121 à 132 s), puis retour à 1 m/s.
// Le départ ajoute la mise en vitesse à 1,7 m/s, de t = 118 s (dernier point de la rame, qui commence le pas qui gagne) à 120 s,
// sans la rame à 1,2 m/s, plate : 14 s au lieu de 12.
const rangMolle = vaguesMolle.match(/(^|\/ )1\t(\d\d):(\d\d)\t(\d+) s\t/);
const heure = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
check('vague molle : une vague comptée', soft?.summary?.waveCount === 1 && rangMolle !== null, `${soft?.summary?.waveCount} / ${vaguesMolle.slice(0, 200)}`);
check('vague molle : durée 14 s à une seconde près (départ à 1,7 m/s et montée depuis la borne basse comprises, rame à 1,2 m/s non avalée)', rangMolle !== null && Math.abs(Number(rangMolle[4]) - 14) <= 1, rangMolle?.[4]);
check('vague molle : début au pied du départ (t = 118 s), pas une seconde plus tôt dans la rame à 1,2 m/s',
  rangMolle !== null && `${rangMolle[2]}:${rangMolle[3]}` === heure(T_SOFT + 118_000), `${rangMolle?.[2]}:${rangMolle?.[3]} attendu ${heure(T_SOFT + 118_000)}`);

// 5 ter. Départ des vagues : la mise en vitesse depuis presque l'arrêt compte dans la vague, en orange sur la courbe et, vague
// montrée seule, sur la carte ; une rame plate à 4 km/h n'est pas avalée ; ni le nombre de vagues ni la vitesse max ne bougent.
await go('/surf');
console.log('import départ :', await importGpx(buildGpx('Départ', T_DEPART, DEPART), 'depart.gpx'));
const depart = await waitFor(() => recordAt(T_DEPART), { timeout: 6000, label: 'fiche départ' });
await settle({ max: 2000, label: 'import départ' });
console.log('fiche départ :', depart ? `vagues ${depart.summary.waveCount}, plus longue ${Math.round(depart.summary.longestWaveM)} m, glisse ${Math.round(depart.summary.movingTimeS)} s, max ${depart.summary.maxSpeedMs}` : '(absente)');
const departPath = `/surf/analyse?session=${encodeURIComponent(depart?.gpx ?? '')}`;
await go(departPath, 5000);
await openTab('vagues');
await wait(500);
const vaguesDepart = await panel('Vagues');
console.log('vagues départ :', vaguesDepart);
const ligne = (n) => vaguesDepart.match(new RegExp(`(^|/ )${n}\\t(\\d\\d):(\\d\\d)\\t(\\d+) s\\t(\\d+) m\\t([\\d,]+)\\t([\\d,]+)\\t`));
const [l1, l2] = [ligne(1), ligne(2)];
check('départ : deux vagues, comme les glisses (le départ ne fait pas compter une vague)', depart?.summary?.waveCount === 2 && l1 !== null && l2 !== null, `${depart?.summary?.waveCount} / ${vaguesDepart.slice(0, 200)}`);
// Vague 1 : départ de 8 s (t = 96 à 104 s) puis 14 s de vague (104 à 118 s) : 22 s, 73 m dont 12 m de départ (somme des vitesses
// des points 97 à 118 s), moyenne 12,0 km/h ; vague 2 : départ de 2 s (t = 219 à 221 s) puis 17 s (221 à 238 s) : 19 s, 89 m dont 4 m
// de départ. Sans départ : 14 s et 62 m, 17 s et 85 m.
check('départ, vague 1 : durée 22 s à une seconde près (départ de 8 s compris), 73 m à 2 m près (62 m sans le départ)',
  l1 !== null && Math.abs(Number(l1[4]) - 22) <= 1 && Math.abs(Number(l1[5]) - 73) <= 2, `${l1?.[4]} s ${l1?.[5]} m`);
check('départ, vague 2 : durée 19 s à une seconde près (départ de 2 s compris, rame plate à 4 km/h non avalée), 89 m à 2 m près',
  l2 !== null && Math.abs(Number(l2[4]) - 19) <= 1 && Math.abs(Number(l2[5]) - 89) <= 2, `${l2?.[4]} s ${l2?.[5]} m`);
check('départ : moyennes 12,0 et 16,9 km/h, distance sur durée avec le départ', l1?.[7] === '12,0' && l2?.[7] === '16,9', `${l1?.[7]} / ${l2?.[7]}`);
check('départ, vague 1 : début dans la rampe (2 min 11 s : même minute que t = 96 s), pas dans la rame à 1 km/h',
  l1 !== null && `${l1[2]}:${l1[3]}` === heure(T_DEPART + 96_000), `${l1?.[2]}:${l1?.[3]} attendu ${heure(T_DEPART + 96_000)}`);
check('départ, vague 2 : début au pied de la rampe (4 min 14 s), pas 15 s plus tôt dans la rame plate à 4 km/h',
  l2 !== null && `${l2[2]}:${l2[3]}` === heure(T_DEPART + 219_000), `${l2?.[2]}:${l2?.[3]} attendu ${heure(T_DEPART + 219_000)}`);
// Vitesses de la vague, sur sa partie comptée seule : 5 m/s (18,0 km/h) et 6 m/s (21,6 km/h), comme sans départ.
check('départ : vitesses max 18,0 et 21,6 km/h (celles de la partie comptée, pas du départ)', l1?.[6] === '18,0' && l2?.[6] === '21,6', `${l1?.[6]} / ${l2?.[6]}`);
const generalDepart = await panel('Général');
console.log('général départ :', generalDepart);
contient('départ, général : 2 vagues', generalDepart, 'Vagues / 2 ');
contient('départ, général : vitesse max 21,6 km/h', generalDepart, 'Vitesse max / 21,6 km/h');
check('départ, fiche : 6 m/s, plus longue vague 89 m, glisse (départs compris) de 41 s (22 + 19)',
  Math.abs((depart?.summary?.maxSpeedMs ?? 0) - 6) < 0.05 && Math.abs((depart?.summary?.longestWaveM ?? 0) - 89) <= 2 && Math.abs((depart?.summary?.movingTimeS ?? 0) - 41) <= 1, JSON.stringify(depart?.summary));
// Carte : rien d'orange avant qu'une vague soit montrée ; une vague montrée seule a son début et son départ en orange, son reste en violet.
const orangeCarte = () => evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#ff8f00"], .leaflet-overlay-pane path[fill="#ff8f00"]').length`);
const violetCarte = () => evaluate(`document.querySelectorAll('.leaflet-overlay-pane path[stroke="#7b1fa2"]').length`);
check('départ, carte : aucune vague montrée, aucun trait orange', (await orangeCarte()) === 0, await orangeCarte());
const voirVague = (n) => evaluate(`(() => {
  const row = [...document.querySelectorAll('.an-carte-panels tr')].find((r) => r.cells[0]?.innerText.trim() === ${JSON.stringify(String(n))});
  const b = row?.querySelector('button'); if (!b) return 'absent'; b.click(); return 'ok';
})()`);
for (const n of [1, 2]) {
  console.log(`Voir la vague ${n} :`, await voirVague(n));
  await wait(500);
  const [o, v] = [await orangeCarte(), await violetCarte()];
  console.log(`vague ${n} montrée : orange`, o, ', violet', v);
  // Le trait du départ et le point de son début en orange (2 tracés), le reste de la vague en violet.
  check(`départ, carte, vague ${n} montrée seule : trait et point du départ en orange, reste en violet`, o >= 2 && v >= 1, `orange ${o}, violet ${v}`);
}
await shoot('surf-depart-vague');
console.log('podium :', await clickText('Les 3 plus longues'));
await wait(500);
const orangePodium = await orangeCarte();
console.log('podium : orange', orangePodium, '| traits', await evaluate(`['#d32f2f', '#f57c00', '#388e3c'].map((c) => document.querySelectorAll('.leaflet-overlay-pane path[stroke="' + c + '"]').length).join('/')`));
check('départ, carte, podium : pas de départ orange, la vague entière à la couleur de sa marche', orangePodium === 0, orangePodium);
// Aide des vagues : la phrase du départ.
const aide = async (label) => {
  const ouverte = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button.ui-help')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(`Aide : ${label}`)});
    if (!b) return false; b.click(); return true;
  })()`);
  await wait(300);
  return ouverte ? await evaluate(`[...document.querySelectorAll('.help-note')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')` ) : '(« ? » absent)';
};
const aideVagues = await aide('Vagues (2)');
console.log('aide des vagues :', aideVagues);
contient('départ, aide des vagues : la phrase « Départ : la mise en vitesse… »', aideVagues, 'Départ : la mise en vitesse qui précède la vague');
await aide('Vagues (2)');
// Courbe de vitesse : une bande orange avant chaque bande de vague (4 bandes : 2 orange, 2 de vague), la montée tracée en orange.
console.log('fermer vagues :', await tab('vagues'), '| graphiques :', await openTab('graphiques'));
await settle({ max: 1500 });
const graphe = await evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim() === 'Vitesse');
  const p = t?.closest('.an-carte-panels > *');
  if (!p) return null;
  const n = (sel) => p.querySelectorAll(sel).length;
  return { bandes: n('.recharts-reference-area'), orange: n('.recharts-reference-area [fill="#ff8f00"]'), bleues: n('.recharts-reference-area [fill="#1e88e5"]'),
    serieOrange: n('path.recharts-line-curve[stroke="#ff8f00"]') };
})()`);
console.log('graphe départ :', JSON.stringify(graphe));
check('départ, courbe : 2 bandes orange (une par vague) et 2 bandes de vague', graphe?.orange === 2 && graphe?.bleues === 2 && graphe?.bandes === 4, JSON.stringify(graphe));
check('départ, courbe : la montée en vitesse tracée en orange', (graphe?.serieOrange ?? 0) >= 1, JSON.stringify(graphe));
const aideGraphe = await aide('Vitesse');
console.log('aide des graphiques :', aideGraphe);
contient('départ, aide des graphiques : « En bleu, les vagues ; en orange, leur départ. »', aideGraphe, 'En bleu, les vagues ; en orange, leur départ.');
await shoot('surf-depart-courbe');


// 6. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(foilPath, 5000);
await openTab('vagues');
await wait(500);
await shoot('surf-telephone');
const largeur = await evaluate('document.documentElement.scrollWidth');
console.log('largeur au téléphone :', largeur);
check('téléphone : largeur 390, sans débordement', largeur === 390, largeur);
// Sens des vagues au téléphone : « Régler » met la carte en plein écran avec la boussole, la fermer met fin au réglage.
await go(morningPath, 5000);
console.log('réglages (390) :', await openTab('réglages'));
await wait(500);
console.log('sens des vagues (390) :', await ligneSens());
console.log('Régler (390) :', await boutonSens('.an-carte-panels', 'Régler'));
await settle({ max: 1500 });
check('390 px, sens des vagues : « Régler » ouvre la carte en plein écran avec la boussole', await evaluate(`Boolean(document.querySelector('.an-map-overlay .an-wind__dial'))`));
// Le cadran et le bandeau, mesurés eux-mêmes : leur conteneur n'a pas de boîte dans la carte agrandie (`display: contents`).
const cadre = await evaluate(`(() => { const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; }; return { cadran: box('.an-map-overlay .an-wind__dial'), bandeau: box('.an-map-overlay .an-wind__bar') }; })()`);
console.log('boussole (390) :', JSON.stringify(cadre), await evaluate(`document.querySelector('.an-map-overlay .an-wind__bar')?.innerText.replace(/\\n+/g, ' ')`));
const dansEcran = (c) => c.r > c.l && c.b > c.t && c.l >= 0 && c.r <= 390 && c.t >= 0 && c.b <= 844;
check('390 px, sens des vagues : la boussole est entière dans l’écran', dansEcran(cadre.cadran) && dansEcran(cadre.bandeau) && cadre.bandeau.b <= cadre.cadran.t, JSON.stringify(cadre));
// Brouillon en attente (poignée tirée), puis poignée à 0° : sous le bandeau et sous la barre « Non enregistré ».
const fin90 = await tirer('.an-map-overlay', 90);
await mouse('mouseReleased', ...fin90);
await settle({ max: 1200 });
const fin00 = await tirer('.an-map-overlay', 0);
const p390 = await poignee('.an-map-overlay');
check('390 px, sens des vagues : la poignée est sur le cercle', p390.valide && Math.abs(p390.dist - p390.R) <= 4, JSON.stringify({ dist: p390.dist, R: p390.R }));
check('390 px, sens des vagues : poignée à 0° sous le bandeau du réglage, sans recouvrement', p390.valide && !sePose(p390.h, p390.bandeau) && p390.h.t >= p390.bandeau.b - 1, JSON.stringify({ h: p390.h, bandeau: p390.bandeau }));
check('390 px, sens des vagues : poignée à 0° sans recouvrir la barre « Non enregistré »', pleine(p390.save) && !sePose(p390.h, p390.save), JSON.stringify({ h: p390.h, save: p390.save }));
await mouse('mouseReleased', ...fin00);
await settle({ max: 800 });
await shoot('surf-sens-390');
console.log('fermer la carte :', await evaluate(`(() => { const b = document.querySelector('.an-map-overlay__close'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(600);
check('390 px, sens des vagues : fermer le plein écran ferme la carte et la boussole', !(await evaluate(`Boolean(document.querySelector('.an-map-overlay') || document.querySelector('.an-wind'))`)));
check('390 px, sens des vagues : une seule barre « Non enregistré », jamais deux', await evaluate(`document.querySelectorAll('.ui-savebar').length <= 1`));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
await finish();
