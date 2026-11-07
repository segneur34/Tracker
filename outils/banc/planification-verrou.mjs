// Banc de test : verrou de la carte de planification (crayon sur la carte).
// Usage : node planification-verrou.mjs <port> [<dossier des captures>]
// Sur un profil neuf, en Voile (balises en ligne droite : aucun calcul, aucun réseau). Le script :
//  1. pose trois balises (nouvel itinéraire : modifiable, bouton « Verrouiller l'itinéraire ») ;
//  2. verrouille : le bandeau d'une balise ouverte se ferme ; un clic sur la carte ne pose rien, toucher une balise
//     ou le tronçon n'ouvre aucun bandeau ni n'insère rien, un glisser sur une balise ne la bouge pas seule ;
//     un glisser sur le fond déplace bien la carte ;
//  3. déverrouille : un clic pose une quatrième balise ;
//  4. range l'itinéraire, le rouvre par son adresse : il part verrouillé (clic et glisser sans effet), puis modifiable
//     après le crayon ;
//  5. « Nouvel itinéraire » (après l'avoir verrouillé) : modifiable de nouveau.
// Verdicts par `check` ; fin par « Tout passe. » ou le nombre d'échecs, code 0 ou 1.
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node planification-verrou.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { send, evaluate, go, waitFor, wait, mouse, shoot, check, finish } = await connect({ port, shotDir });

const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(400); };
const dragFrom = async (x, y, dx, dy) => {
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', x + (dx * k) / 8, y + (dy * k) / 8);
  await mouse('mouseReleased', x + dx, y + dy);
  await wait(500);
};
const mapBox = () => evaluate(`(() => { const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
const tapMap = async (fx, fy) => {
  const r = await mapBox();
  await clickAt(r[0] + r[2] * fx, r[1] + r[3] * fy);
};
const dragMap = async (fx, fy, dx, dy) => {
  const r = await mapBox();
  await dragFrom(r[0] + r[2] * fx, r[1] + r[3] * fy, dx, dy);
};
/** Centres écran des repères, dans l'ordre de la carte (arrondis au pixel). */
const markers = async () => JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.plan-marker')].map((m) => { const r = m.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }))`));
const count = async () => (await markers()).length;
const LOCK_BUTTON = `.plan-map-tools button[aria-label$="l'itinéraire"]`;
const lockLabel = () => evaluate(`document.querySelector(${JSON.stringify(LOCK_BUTTON)})?.getAttribute('aria-label') ?? 'absent'`);
const toggleLock = () => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(LOCK_BUTTON)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const overlay = () => evaluate(`document.querySelector('.plan-overlay') !== null`);
const clickButton = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const ready = () => waitFor(`document.querySelector('.plan-map .leaflet-container') !== null && document.querySelector('.plan-map-tools') !== null`, { timeout: 5000, label: 'carte de planification' });
const chooseVoile = () => evaluate(`(async () => {
  for (const button of document.querySelectorAll('button.activity-select:not(:disabled)')) {
    button.click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...document.querySelectorAll('.activity-select__option')].find((o) => o.textContent.trim() === 'Voile');
    if (item) { item.click(); return 'ok'; }
    document.querySelector('.activity-select__backdrop')?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'absent';
})()`);
/** Les repères ont-ils tous bougé du même pas (0 compris) ? Un glisser de carte, pas d'une balise seule. */
const movedTogether = (a, b) => {
  const shifts = b.map((p, i) => [p[0] - a[i][0], p[1] - a[i][1]]);
  return shifts.every((s) => Math.abs(s[0] - shifts[0][0]) <= 1 && Math.abs(s[1] - shifts[0][1]) <= 1);
};

// Rangée « avancé » des analyses ouverte d'office (`lib/onglets.mjs`, 05/11).
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await go('/itineraires', 3000);
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ planning: { profil: true, parcours: true, trace: true, points: true, ranger: true, liste: true } })); 'ok'`);
await go('/itineraires', 3000);
await ready();
console.log('activité Voile :', await chooseVoile());
await wait(300);

// 1. Nouvel itinéraire : modifiable.
check('nouvel itinéraire : bouton « Verrouiller l\'itinéraire »', (await lockLabel()) === "Verrouiller l'itinéraire", await lockLabel());
await tapMap(0.3, 0.3);
await tapMap(0.7, 0.35);
await tapMap(0.5, 0.55);
check('trois balises posées', (await count()) === 3, JSON.stringify(await markers()));

// 2. Verrouillé.
await clickAt(...(await markers())[0]);
check('modifiable : toucher une balise ouvre son bandeau', await overlay(), 'bandeau absent');
console.log('Verrouiller :', await toggleLock());
await wait(300);
check('verrouillage : le bandeau de la balise se ferme', !(await overlay()), 'bandeau encore ouvert');
check('verrouillé : bouton « Modifier l\'itinéraire »', (await lockLabel()) === "Modifier l'itinéraire", await lockLabel());
const locked = await markers();
await tapMap(0.2, 0.8);
check('verrouillé : un clic sur la carte ne pose rien', (await count()) === 3, `3 -> ${await count()}`);
await clickAt(...locked[0]);
check('verrouillé : toucher une balise n\'ouvre aucun bandeau', !(await overlay()), 'bandeau ouvert');
await clickAt(Math.round((locked[0][0] + locked[1][0]) / 2), Math.round((locked[0][1] + locked[1][1]) / 2));
check('verrouillé : toucher le tronçon n\'insère rien et n\'ouvre rien', (await count()) === 3 && !(await overlay()), `${await count()} balises`);
await dragFrom(locked[0][0], locked[0][1], 70, 50);
check('verrouillé : une balise glissée ne bouge pas seule', movedTogether(locked, await markers()), JSON.stringify(await markers()));
const beforePan = await markers();
await dragMap(0.15, 0.85, 40, -30);
const afterPan = await markers();
check('verrouillé : on déplace la carte librement', JSON.stringify(afterPan) !== JSON.stringify(beforePan) && movedTogether(beforePan, afterPan), JSON.stringify(afterPan));
await shoot('verrou-verrouille');

// 3. Déverrouillé : un clic pose.
console.log('Modifier :', await toggleLock());
await wait(300);
check('déverrouillé : bouton « Verrouiller l\'itinéraire »', (await lockLabel()) === "Verrouiller l'itinéraire", await lockLabel());
await tapMap(0.2, 0.8);
check('déverrouillé : un clic pose une balise', (await count()) === 4, `3 -> ${await count()}`);

// 4. Rangé, rouvert : verrouillé.
await evaluate(`(() => { const i = document.querySelector('.plan-form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Verrou banc'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
console.log('Enregistrer :', await clickButton('Enregistrer'));
await wait(1500);
await go('/itineraires?itineraire=Verrou%20banc', 3000);
await ready();
await wait(800);
const reopened = await count();
check('itinéraire rouvert : ses quatre balises sont là', reopened === 4, `${reopened}`);
check('itinéraire rouvert : verrouillé (bouton « Modifier l\'itinéraire »)', (await lockLabel()) === "Modifier l'itinéraire", await lockLabel());
await tapMap(0.1, 0.9);
check('rouvert : un clic sur la carte ne pose rien', (await count()) === reopened, `${reopened} -> ${await count()}`);
{
  const before = await markers();
  await dragFrom(before[0][0], before[0][1], 60, 40);
  check('rouvert : une balise glissée ne bouge pas seule', movedTogether(before, await markers()), JSON.stringify(await markers()));
}
console.log('Modifier :', await toggleLock());
await wait(300);
await tapMap(0.1, 0.9);
check('rouvert puis déverrouillé : un clic pose une balise', (await count()) === reopened + 1, `${reopened} -> ${await count()}`);

// 5. Nouvel itinéraire : modifiable, même après avoir verrouillé le précédent.
console.log('verrouiller avant de repartir :', await toggleLock());
console.log('Nouvel itinéraire :', await clickButton('Nouvel itinéraire'));
await wait(800);
check('nouvel itinéraire : modifiable', (await lockLabel()) === "Verrouiller l'itinéraire", await lockLabel());
await tapMap(0.4, 0.4);
check('nouvel itinéraire : un clic pose le départ', (await count()) === 1, `${await count()}`);

await finish();
