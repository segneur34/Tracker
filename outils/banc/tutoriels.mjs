// Banc de test : les tutoriels (lot 147, idée 142), une leçon par nouveau jour d'ouverture.
// Usage : node tutoriels.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau ni session, environ 30 s. L'heure de la page est décalée par un script posé avant
// son chargement (`Date` remplacé, comme `racine.mjs`) pour passer d'un jour au suivant. Il vérifie :
//  1. jour 1 : la carte « Aujourd'hui : Enregistrer une session » sur l'accueil, avant les familles, son accroche,
//     « Lire » et la croix ; le jour rangé sur l'appareil (`tracker.tutoriels`) ;
//  2. « Lire » ouvre la leçon (`/tutoriels/enregistrer`) : titre, « Leçon 1 sur 14 », paragraphes, « Essayer » vers
//     Enregistrer, « Leçon suivante » sans « précédente » ; la leçon marquée lue ; le retour d'Android (`trackerBack`)
//     mène à la liste, puis à Réglages ;
//  3. la liste `/tutoriels` : quatorze leçons dans l'ordre, la première cochée seule, « 1 lue sur 14 » ;
//  4. l'accueil du même jour, la leçon lue : plus de carte ;
//  5. jour 2 : « Aujourd'hui : Lire une analyse » ; la croix la ferme, et elle ne revient pas au rechargement du même
//     jour ; un second chargement le même jour ne compte pas un jour de plus ; jour 3 : « La carte » ;
//  6. Réglages : le bloc « Tutoriels » replié au départ, ouvert : « 1 leçon lue sur 14 » et « Voir tous les tutoriels »,
//     qui ouvre la liste ;
//  7. la voile cachée par son œil (Réglages › Activités) : la liste passe à treize leçons, sans « La voile » ;
//  8. à 390×844 : l'accueil avec la carte, et une leçon d'une famille cachée (son adresse s'ouvre toujours), sans
//     débordement.
// Il finit par « Tout passe. » ou le nombre d'échecs.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node tutoriels.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { send, evaluate, go: goRaw, waitFor, wait, shoot, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Navigation, puis attente du premier rendu de l'application. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};

// --- Heure de la page ---
let clockScript = null;
/** Les pages suivantes croient être à `fakeMs`. */
const setClock = async (fakeMs) => {
  if (clockScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScript });
  const source = `(() => {
    const off = ${fakeMs - Date.now()};
    const R = Date;
    class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
    window.Date = D;
  })();`;
  clockScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).result.identifier;
};
const now = new Date();
/** Midi du jour `n` (1 : aujourd'hui). */
const dayAt = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n - 1, 12).getTime();
const keyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.tutoriels') ?? '{}').etat ?? null`);
const path = () => evaluate('location.pathname');
/** La carte du jour : titre, accroche, bouton, croix ; `null` si elle n'est pas là. */
const card = () => evaluate(`(() => {
  const c = document.querySelector('.tutorial-card');
  if (!c) return null;
  return {
    title: c.querySelector('h2')?.textContent ?? null,
    hook: c.querySelector('.tutorial-card__hook')?.textContent ?? null,
    read: c.querySelector('a.tutorial-card__read')?.textContent ?? null,
    href: c.querySelector('a.tutorial-card__read')?.getAttribute('href') ?? null,
    close: !!c.querySelector('button[aria-label="Fermer pour aujourd\\'hui"]'),
    beforeFamilies: !!document.querySelector('.home-families') && !!(c.compareDocumentPosition(document.querySelector('.home-families')) & Node.DOCUMENT_POSITION_FOLLOWING),
  };
})()`);
/** L'accueil posé : la mémoire lue (les familles sont là), puis le temps que la garde décide. */
const homeAt = async (dayMs) => {
  await setClock(dayMs);
  await go('/', 4000);
  await waitFor(`Boolean(document.querySelector('.home-families'))`, { timeout: 4000, label: 'accueil' });
  await waitFor(`Boolean(document.querySelector('.tutorial-card'))`, { timeout: 2000, label: 'carte du jour' });
};
const rows = () => evaluate(`[...document.querySelectorAll('.tutorial-row')].map((r) => ({ title: r.querySelector('.tutorial-row__title')?.textContent, read: !!r.querySelector('.tutorial-row__read') }))`);
const subtitle = () => evaluate(`document.querySelector('.ui-page-header__subtitle')?.textContent ?? null`);
const back = () => evaluate(`window.trackerBack ? window.trackerBack() : 'absent'`);
const overflow = () => evaluate('document.documentElement.scrollWidth > window.innerWidth');

// 1. Jour 1.
await homeAt(dayAt(1));
let c = await card();
console.log('jour 1 :', JSON.stringify(c));
check("jour 1 : la carte « Aujourd'hui : Enregistrer une session »", c?.title === "Aujourd'hui : Enregistrer une session", c?.title);
check('… son accroche', c?.hook === "Le bouton rond, le choix de l'activité, puis « Analyser » à la fin.", c?.hook);
check('… « Lire » vers la leçon, une croix', c?.read === 'Lire' && c?.href === '/tutoriels/enregistrer' && c?.close === true, JSON.stringify(c));
check('… avant les familles', c?.beforeFamilies === true);
const s1 = await stored();
check('le jour rangé sur l\'appareil', JSON.stringify(s1?.days) === JSON.stringify([keyOf(dayAt(1))]), JSON.stringify(s1));
await shoot('tutoriels-accueil');

// 2. La leçon.
await evaluate(`document.querySelector('a.tutorial-card__read').click()`);
await waitFor(`location.pathname === '/tutoriels/enregistrer' && Boolean(document.querySelector('.tutorial-lesson'))`, { timeout: 4000, label: 'leçon' });
const lesson = await evaluate(`(() => ({
  title: document.querySelector('.ui-page-header h1')?.textContent ?? null,
  paragraphs: document.querySelectorAll('.tutorial-lesson > p').length,
  essayer: [...document.querySelectorAll('a')].find((a) => a.textContent === 'Essayer')?.getAttribute('href') ?? null,
  links: [...document.querySelectorAll('.tutorial-nav a')].map((a) => a.textContent),
  back: document.querySelector('.ui-back')?.textContent ?? null,
}))()`);
console.log('leçon :', JSON.stringify(lesson));
check('« Lire » ouvre la leçon : son titre', lesson?.title === 'Enregistrer une session', lesson?.title);
check('… « Leçon 1 sur 14 »', (await subtitle()) === 'Leçon 1 sur 14', await subtitle());
check('… 3 à 6 paragraphes', lesson?.paragraphs >= 3 && lesson?.paragraphs <= 6, lesson?.paragraphs);
check('… « Essayer » vers Enregistrer', lesson?.essayer === '/enregistrer', lesson?.essayer);
check('… « Leçon suivante » seule', JSON.stringify(lesson?.links) === JSON.stringify(['Leçon suivante']), JSON.stringify(lesson?.links));
check('… « Toutes les leçons » en tête', lesson?.back === 'Toutes les leçons', lesson?.back);
check('la leçon est marquée lue', (await stored())?.read?.includes('enregistrer') === true, JSON.stringify(await stored()));
await shoot('tutoriels-lecon');
check('retour : de la leçon à la liste', (await back()) === 'page' && (await waitFor(`location.pathname === '/tutoriels'`, { timeout: 3000 })) === true, await path());

// 3. La liste.
await waitFor(`document.querySelectorAll('.tutorial-row').length > 0`, { timeout: 3000, label: 'liste' });
const list = await rows();
check('la liste : quatorze leçons, « Enregistrer une session » en tête', list.length === 14 && list[0]?.title === 'Enregistrer une session', `${list.length} : ${list.map((r) => r.title).join(', ')}`);
check('… seule la première cochée', list[0]?.read === true && list.slice(1).every((r) => !r.read), JSON.stringify(list.map((r) => r.read)));
check('… « 1 lue sur 14 »', (await subtitle()) === '1 lue sur 14', await subtitle());
await shoot('tutoriels-liste');
check('retour : de la liste à Réglages', (await back()) === 'page' && (await waitFor(`location.pathname === '/parametres'`, { timeout: 3000 })) === true, await path());

// 4. L'accueil du même jour : la leçon lue, plus de carte.
await homeAt(dayAt(1));
check('même jour, leçon lue : plus de carte', (await card()) === null, JSON.stringify(await card()));

// 5. Jour 2, la croix ; jour 3.
await homeAt(dayAt(2));
c = await card();
check("jour 2 : « Aujourd'hui : Lire une analyse »", c?.title === "Aujourd'hui : Lire une analyse", c?.title);
await evaluate(`document.querySelector('.tutorial-card__close').click()`);
await wait(300);
check('la croix ferme la carte', (await card()) === null);
check('… rangée fermée pour la journée', (await stored())?.dismissed === keyOf(dayAt(2)), JSON.stringify(await stored()));
await homeAt(dayAt(2));
check('… et elle ne revient pas au rechargement du même jour', (await card()) === null, JSON.stringify(await card()));
check('deux chargements le même jour : deux jours comptés', (await stored())?.days?.length === 2, JSON.stringify((await stored())?.days));
await homeAt(dayAt(3));
c = await card();
check("jour 3 : « Aujourd'hui : La carte »", c?.title === "Aujourd'hui : La carte", c?.title);

// 6. Réglages.
await go('/parametres', 3000);
const blockTitle = `[...document.querySelectorAll('[role=button]')].find((b) => b.textContent.trim() === 'Tutoriels')`;
await waitFor(`Boolean(${blockTitle})`, { timeout: 3000, label: 'bloc' });
check('Réglages : le bloc « Tutoriels », replié', (await evaluate(`Boolean(${blockTitle}) && !document.querySelector('a[href="/tutoriels"]')`)) === true);
await evaluate(`${blockTitle}.click()`);
await wait(300);
const block = await evaluate(`(() => { const a = document.querySelector('a[href="/tutoriels"]'); return a ? { link: a.textContent, text: a.parentElement.textContent } : null; })()`);
check('… ouvert : « 1 leçon lue sur 14 » et « Voir tous les tutoriels »', block?.link === 'Voir tous les tutoriels' && block?.text.includes('1 leçon lue sur 14'), JSON.stringify(block));
await shoot('tutoriels-reglages');
await evaluate(`document.querySelector('a[href="/tutoriels"]').click()`);
check('… qui ouvre la liste', (await waitFor(`location.pathname === '/tutoriels' && document.querySelectorAll('.tutorial-row').length > 0`, { timeout: 3000 })) === true, await path());

// 7. La voile cachée par son œil dans Réglages › Activités : sa leçon retirée de la liste.
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); s.settings = { ...s.settings, activites: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); })()`);
await go('/parametres', 3000);
const eye = `[...document.querySelectorAll('.settings-eye')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Cacher Voile'))`;
await waitFor(`Boolean(${eye})`, { timeout: 3000, label: 'œil' });
check('Réglages : l\'œil « Cacher Voile »', (await evaluate(`(() => { const b = ${eye}; if (!b) return false; b.click(); return true; })()`)) === true);
await wait(300);
await go('/tutoriels', 3000);
await waitFor(`document.querySelectorAll('.tutorial-row').length > 0`, { timeout: 3000, label: 'liste' });
const hidden = await rows();
check('la voile cachée : treize leçons, sans « La voile »', hidden.length === 13 && !hidden.some((r) => r.title === 'La voile'), `${hidden.length} : ${hidden.map((r) => r.title).join(', ')}`);
check('… « 1 lue sur 13 »', (await subtitle()) === '1 lue sur 13', await subtitle());

// 8. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await homeAt(dayAt(3));
check('390 px : la carte du jour sur l\'accueil', (await card())?.title === "Aujourd'hui : La carte", JSON.stringify(await card()));
check('390 px : rien ne déborde sur l\'accueil', (await overflow()) === false);
await shoot('tutoriels-accueil-390');
await go('/tutoriels/voile', 3000);
await waitFor(`Boolean(document.querySelector('.tutorial-lesson'))`, { timeout: 3000, label: 'leçon' });
check('390 px : une leçon, sans débordement', (await overflow()) === false);
await shoot('tutoriels-lecon-390');

const errors = logs.filter((l) => !l.startsWith('warning'));
console.log(errors.length ? `Console :\n${errors.join('\n')}` : 'Console : rien');
check('aucune erreur de console', errors.length === 0);
await finish();
