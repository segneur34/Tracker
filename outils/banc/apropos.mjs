// Banc de test : le bloc « À propos » de Réglages et la liste des licences (lot 151).
// Usage : node apropos.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 30 s. `fetch` est remplacé avant le chargement par une liste synthétique,
// sauf au point 7. Il vérifie :
//  1. le bloc, dernier de la page, replié au départ : aucune liste demandée au chargement ni à son ouverture ;
//  2. ouvert : logo centré en police du logo à 34 px, version, paragraphe, filet, ligne « Licences… » repliée ;
//  3. dépliée : les deux listes demandées, la phrase, les deux groupes, trois composants puis « Voir les N autres »,
//     lignes de 44 px au moins sur le fond de page, rayon `--radius-s`, le doublon JS et complément une seule fois ;
//  4. un composant : son texte complet dans une zone qui défile (320 px au plus), un seul ouvert à la fois, notice et
//     lien du greffon GPS, composants d'une famille native ;
//  5. à 390×844, puis tourné : aucun débordement, composant ouvert compris, zone à la moitié de l'écran au plus ;
//  6. thème sombre : lignes sur le fond de page sombre ; « Tout réduire » replie le bloc, rechargement compris ;
//  7. sans `licences.json` (le serveur de développement répond par la page HTML) : le complément réel et « Liste
//     complète dans la version construite. » ; les deux fichiers en échec : « Liste des licences indisponible. ».
// Il finit par « Tout passe. » ou le nombre d'échecs.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node apropos.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { send, evaluate, go, settle, waitFor, wait, blockNetwork, shoot, clickText, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

// --- Listes synthétiques ---
const LONG_TEXT = Array.from({ length: 200 }, (_, i) => `Ligne ${i + 1} de la licence, assez longue pour que la zone défile.`).join('\n');
const row = (name, identifier, extra = {}) => ({ name, version: '1.2.3', identifier, text: `Texte de ${name}`, ...extra });
const BUILT = [
  row('alpha', 'MIT', { text: LONG_TEXT }),
  row('bravo', 'ISC'),
  row('charlie', 'BSD-2-Clause'),
  row('delta', 'BSD-3-Clause'),
  row('echo', '0BSD'),
  row('victory-vendor', 'MIT AND ISC AND BSD-3-Clause'),
  row('un-nom-de-paquet-tres-long-qui-ne-tient-pas-sur-une-ligne-de-telephone', 'MIT'),
  row('react-leaflet', 'Hippocratic-2.1'),
  row('@capgo/background-geolocation', 'MPL-2.0'),
];
const EXTRA = [
  row('@fontsource/shrikhand', 'OFL-1.1'),
  row('@capgo/background-geolocation', 'MPL-2.0', { notice: 'Utilisé sans modification. Sources :', url: 'https://github.com/Cap-go/capacitor-background-geolocation', text: 'Texte MPL' }),
  { name: 'AndroidX', version: '2 composants', identifier: 'Apache-2.0', text: 'Texte Apache', components: ['androidx.core:core:1.17.0', 'androidx.activity:activity:1.11.0'] },
];
/** Réponses données à `fetch` : une liste, ou 'échec' pour un refus. */
const stubSource = (built, extra) => `(() => {
  const real = window.fetch;
  window.__licenceFetches = [];
  const answer = (value) => value === 'échec'
    ? Promise.reject(new TypeError('Failed to fetch'))
    : Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    if (url.endsWith('/licences.json')) { window.__licenceFetches.push(url); return answer(${JSON.stringify(built)}); }
    if (url.endsWith('/licences-hors-js.json')) { window.__licenceFetches.push(url); return answer(${JSON.stringify(extra)}); }
    return real(input, init);
  };
})();`;
let stub = null;
const setStub = async (source) => {
  if (stub) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stub });
  stub = source ? (await send('Page.addScriptToEvaluateOnNewDocument', { source })).result.identifier : null;
};

await blockNetwork();
await setStub(stubSource(BUILT, EXTRA));

// --- Lectures ---
const overflow = () => evaluate('document.documentElement.scrollWidth > window.innerWidth');
const fetches = () => evaluate('window.__licenceFetches.length');
const openBlock = () => clickText('À propos', 'strong[role="button"]');
const openLicenses = () => clickText('Licences des composants utilisés');
const rows = () => evaluate(`[...document.querySelectorAll('.about-license__row')].map((b) => {
  const box = b.closest('.about-license'), style = getComputedStyle(box);
  return { name: b.querySelector('.about-license__name').textContent.trim(), id: b.querySelector('.about-license__id').textContent.trim(), h: b.getBoundingClientRect().height, bg: style.backgroundColor, radius: style.borderTopLeftRadius };
})`);
/** Couleur d'une variable du thème, calculée par le navigateur. */
const tokenColor = (name) => evaluate(`(() => { const d = document.createElement('div'); d.style.backgroundColor = 'var(${name})'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
const textZone = () => evaluate(`(() => {
  const all = document.querySelectorAll('.about-license__text');
  const z = all[0];
  return z ? { count: all.length, client: z.clientHeight, scroll: z.scrollHeight, text: z.textContent, link: z.querySelector('a')?.href ?? null } : { count: 0 };
})()`);
const clickRow = (start) => evaluate(`(() => { const b = [...document.querySelectorAll('.about-license__row')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(start)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);

// --- 1. Replié, rien de demandé ---
await go('/parametres', 3000);
const titles = await evaluate(`[...document.querySelectorAll('strong[role="button"]')].map((t) => t.textContent.trim())`);
check('le bloc « À propos » vient en dernier, après « Tutoriels »', titles.at(-1) === 'À propos' && titles.at(-2) === 'Tutoriels', titles.join(', '));
check('replié au départ', (await evaluate(`document.querySelector('.about') === null`)) === true);
check('aucune liste demandée au chargement', (await fetches()) === 0, await fetches());

// --- 2. Ouvert ---
check('« À propos » s\'ouvre', (await openBlock()) === 'ok');
await settle({ max: 500 });
const logo = await evaluate(`(() => { const l = document.querySelector('.about__logo'); const s = getComputedStyle(l); return { text: l.textContent, font: s.fontFamily, size: s.fontSize, align: s.textAlign }; })()`);
check('logo « Tracker » en police du logo', logo.text === 'Tracker' && logo.font.includes('Shrikhand'), JSON.stringify(logo));
check('logo à 34 px, centré', logo.size === '34px' && logo.align === 'center', JSON.stringify(logo));
const version = await evaluate(`document.querySelector('.about__version').textContent`);
check('version', /^Version \d+\.\d+\.\d+$/.test(version), version);
const paragraph = await evaluate(`document.querySelector('.about__text').textContent.trim()`);
check('le paragraphe', paragraph === "Vos sessions restent sur cet appareil et dans votre dossier mémoire, sans compte. Les fonds de carte, la recherche de lieux, les itinéraires, ainsi que l'altitude et le revêtement des parcours à pied et à vélo, passent par des services en ligne.", paragraph);
check('un filet au-dessus de la ligne des licences', (await evaluate(`getComputedStyle(document.querySelector('.about .settings-part')).borderTopWidth`)) === '1px');
check('la ligne des licences, repliée', (await evaluate(`document.querySelector('.about .settings-part__toggle').getAttribute('aria-expanded')`)) === 'false');
check('toujours aucune liste demandée', (await fetches()) === 0, await fetches());
await shoot('apropos-ouvert');

// --- 3. Licences dépliées ---
check('les licences se déplient', (await openLicenses()) === 'ok');
await waitFor(`document.querySelectorAll('.about-license__row').length > 0`, { timeout: 3000, label: 'lignes' });
// Mode strict de React, sur le serveur de développement : l'effet part deux fois, le premier chargement annulé.
check('les deux listes demandées, une fois chacune', (await fetches()) === 4, await fetches());
const intro = await evaluate(`[...document.querySelectorAll('.about-licenses__intro')].map((p) => p.textContent)`);
check('la phrase d\'introduction, seule', intro.length === 1 && intro[0] === "Tracker s'appuie sur ces composants. Touchez-en un pour lire sa licence.", intro.join(' | '));
const groups = await evaluate(`[...document.querySelectorAll('.about-licenses__group')].map((p) => p.textContent)`);
check('deux groupes', groups.join(' | ') === 'MIT, ISC, BSD | Autres licences', groups.join(' | '));
const before = await rows();
const firstGroup = await evaluate(`document.querySelectorAll('.about-licenses__list')[0].querySelectorAll('.about-license').length`);
check('trois composants dans le premier groupe', firstGroup === 3, firstGroup);
const others = before.slice(3).map((r) => r.id);
check('Hippocratic, MPL, OFL et Apache dans les autres licences', ['Hippocratic-2.1', 'MPL-2.0', 'OFL-1.1', 'Apache-2.0'].every((id) => others.includes(id)), others.join(', '));
check('le greffon GPS, présent dans les deux listes, une seule fois', before.filter((r) => r.name.startsWith('@capgo/')).length === 1);
check('lignes de 44 px au moins', before.every((r) => r.h >= 44), before.map((r) => r.h).join(', '));
const pageBg = await tokenColor('--bg');
check('lignes sur le fond de page', before.every((r) => r.bg === pageBg), `${before[0].bg} / ${pageBg}`);
check('rayon --radius-s', before.every((r) => r.radius === '8px'), before[0].radius);
check('« Voir les 4 autres »', (await clickText('Voir les 4 autres')) === 'ok');
await settle({ max: 500 });
const firstGroupAll = await evaluate(`document.querySelectorAll('.about-licenses__list')[0].querySelectorAll('.about-license').length`);
check('les sept composants, plus de bouton', firstGroupAll === 7 && (await evaluate(`document.querySelector('.about-licenses__more') === null`)) === true, firstGroupAll);
check('victory-vendor, expression composée, avec MIT, ISC, BSD', (await evaluate(`[...document.querySelectorAll('.about-licenses__list')[0].querySelectorAll('.about-license__name')].some((n) => n.textContent.startsWith('victory-vendor'))`)) === true);
await shoot('apropos-licences');

// --- 4. Un composant ---
check('alpha s\'ouvre', (await clickRow('alpha')) === 'ok');
await settle({ max: 500 });
const long = await textZone();
check('son texte complet', long.count === 1 && long.text.includes('Ligne 200 de la licence'), long.count);
check('dans une zone qui défile, 320 px au plus', long.client <= 320 && long.scroll > long.client, `${long.client} / ${long.scroll}`);
check('un seul ouvert à la fois', (await clickRow('bravo')) === 'ok' && (await settle({ max: 500 }), (await textZone()).text === 'Texte de bravo'), (await textZone()).text);
await clickRow('@capgo/');
await settle({ max: 500 });
const gps = await textZone();
check('greffon GPS : non modifié, lien, texte du complément', gps.text.includes('Utilisé sans modification') && gps.link === 'https://github.com/Cap-go/capacitor-background-geolocation' && gps.text.includes('Texte MPL'), gps.text);
await clickRow('AndroidX');
await settle({ max: 500 });
const androidx = await textZone();
check('famille native : ses composants et sa licence', androidx.text.includes('androidx.core:core:1.17.0') && androidx.text.includes('Texte Apache'), androidx.text);
await clickRow('AndroidX');
await settle({ max: 500 });
check('un second appui referme', (await textZone()).count === 0);

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await clickRow('alpha');
await wait(300);
check('390 px : rien ne déborde, composant ouvert', (await overflow()) === false);
check('390 px : zone de 320 px au plus', (await textZone()).client <= 320, (await textZone()).client);
check('390 px : le nom très long reste dans sa ligne', (await evaluate(`[...document.querySelectorAll('.about-license__row')].every((b) => b.scrollWidth <= b.clientWidth)`)) === true);
check('390 px : lignes de 44 px au moins', (await rows()).every((r) => r.h >= 44));
await shoot('apropos-390');
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await wait(300);
check('tourné : rien ne déborde', (await overflow()) === false);
check('tourné : zone à la moitié de l\'écran au plus', (await textZone()).client <= 195, (await textZone()).client);
await shoot('apropos-tourne');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- 6. Thème sombre, puis « Tout réduire » ---
await evaluate(`localStorage.setItem('tracker.theme', JSON.stringify({ choice: 'sombre', eco: false }))`);
await go('/parametres', 3000);
check('thème sombre posé', (await evaluate(`document.documentElement.dataset.theme`)) === 'dark');
await openLicenses();
await waitFor(`document.querySelectorAll('.about-license__row').length > 0`, { timeout: 3000, label: 'lignes' });
await clickRow('bravo');
await settle({ max: 500 });
const darkRows = await rows();
const darkBg = await tokenColor('--bg');
check('sombre : lignes sur le fond de page sombre', darkBg !== pageBg && darkRows.every((r) => r.bg === darkBg), `${darkRows[0].bg} / ${darkBg}`);
await shoot('apropos-sombre');
await evaluate(`localStorage.removeItem('tracker.theme')`);
check('« Tout réduire »', (await clickText('Tout réduire')) === 'ok');
await settle({ max: 500 });
check('le bloc est replié', (await evaluate(`document.querySelector('.about') === null`)) === true);
await go('/parametres', 3000);
check('et le reste au rechargement', (await evaluate(`document.querySelector('.about') === null`)) === true);

// --- 7. Sans liste construite, puis sans rien ---
await setStub(null);
await go('/parametres', 3000);
await openBlock();
await settle({ max: 500 });
await openLicenses();
await waitFor(`document.querySelectorAll('.about-license__row').length > 0`, { timeout: 5000, label: 'complément' });
const devIntro = await evaluate(`[...document.querySelectorAll('.about-licenses__intro')].map((p) => p.textContent)`);
check('sans licences.json : la mention', devIntro.includes('Liste complète dans la version construite.'), devIntro.join(' | '));
const devRows = await rows();
check('… et le complément réel', ['@fontsource/shrikhand', '@capgo/background-geolocation', 'AndroidX', 'Services Google Play'].every((n) => devRows.some((r) => r.name.startsWith(n))), devRows.map((r) => r.name).join(', '));
await shoot('apropos-sans-liste');

await setStub(stubSource('échec', 'échec'));
await go('/parametres', 3000);
await openLicenses();
await waitFor(`document.querySelector('.about-licenses__intro')?.textContent !== 'Chargement…'`, { timeout: 3000, label: 'échec' });
check('les deux en échec : le message', (await evaluate(`document.querySelector('.about-licenses__intro')?.textContent`)) === 'Liste des licences indisponible.');
check('… et pas de ligne', (await evaluate(`document.querySelectorAll('.about-license__row').length`)) === 0);

const errors = logs.filter((l) => !l.startsWith('warning'));
console.log(errors.length ? `Console :\n${errors.join('\n')}` : 'Console : rien');
check('aucune erreur de console', errors.length === 0);
await finish();
