// Banc de test : onglets des analyses ouverts d'office (lot 145, 05/11). Depuis le 05/11, l'application ne retient
// plus les onglets ouverts : toute ouverture d'une analyse rend « général » seul, « avancé » fermé. Les scripts, qui
// posaient les onglets voulus dans `tracker.sections` (clés `sailing-onglets`, `running`, `cycling`, `intervals`,
// `muscu`, `surf`) et la rangée « avancé » ouverte, continuent de les y poser : ce script, injecté à chaque page
// (`Page.addScriptToEvaluateOnNewDocument`), les relit avant l'application (qui les efface au démarrage), les garde
// sous `banc.onglets` et, à chaque nouvelle analyse montée (`.an-page`), clique une fois sur chaque onglet voulu
// (`[data-tab=clé]`), dès qu'il paraît. Il retient aussi les onglets que le script ouvre ou ferme d'un clic, comme
// l'application le faisait : le relevé d'une page rechargée reste celui d'avant le lot.
// « avancé » : rouvert à chaque fois qu'il se referme, puis « général » rouvert (22/10), comme avant ; `general.mjs`
// éprouve la rangée fermée sans ce script.
// Usage : `await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });` ; `ongletsSource({ memoire: false })`
// pour ne rien rejouer ni retenir (seule la rangée « avancé » est ouverte d'office : `onglets.mjs`, réouverture).

/** Analyse → clés de `tracker.sections` où ses onglets étaient retenus. */
const MODULES = {
  '/voile/analyse': ['sailing-onglets'],
  '/course/analyse': ['running'],
  '/velo/analyse': ['cycling'],
  '/fractionne/analyse': ['intervals', 'muscu'],
  '/surf/analyse': ['surf'],
};

/** Source à injecter ; `memoire` : rejouer et retenir les onglets voulus (défaut). */
export const ongletsSource = ({ memoire = true } = {}) => `(() => {
  const MODULES = ${JSON.stringify(MODULES)};
  const MEMOIRE = ${memoire};
  const KEYS = [...new Set(Object.values(MODULES).flat())];
  const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; } };
  // Onglets posés par le script dans \`tracker.sections\`, relus avant que l'application ne les efface.
  if (MEMOIRE) {
    try {
      const sections = readJson('tracker.sections');
      const wanted = readJson('banc.onglets');
      let moved = false;
      for (const k of KEYS) if (sections[k] && typeof sections[k] === 'object') { wanted[k] = sections[k]; moved = true; }
      if (moved) localStorage.setItem('banc.onglets', JSON.stringify(wanted));
    } catch {}
  }
  const moduleKey = () => (MODULES[location.pathname] ?? [])[0] ?? null;
  const wantedHere = () => {
    const all = readJson('banc.onglets');
    return Object.assign({}, ...(MODULES[location.pathname] ?? []).map((k) => all[k] ?? {}));
  };
  // Un clic du script sur un onglet est retenu, comme l'application le faisait : l'état d'après est l'inverse de celui
  // lu avant que l'application ne traite le clic (lu après, il viendrait d'un bouton peut-être déjà retiré de la page).
  if (MEMOIRE) {
    document.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('.an-tabs [data-tab]') : null;
      const mod = moduleKey();
      if (!b || !mod) return;
      try {
        const all = readJson('banc.onglets');
        all[mod] = { ...(all[mod] ?? {}), [b.dataset.tab]: b.getAttribute('aria-pressed') !== 'true' };
        localStorage.setItem('banc.onglets', JSON.stringify(all));
      } catch {}
    }, true);
  }
  /** Onglets à rejouer, par analyse montée : relus une fois, à son montage. */
  const pending = new WeakMap();
  new MutationObserver(() => {
    const tabs = document.querySelector('.an-tabs');
    if (!tabs) return;
    const t = tabs.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]');
    if (t) {
      t.click();
      setTimeout(() => { const g = tabs.querySelector('[data-tab="general"]'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0);
      return;
    }
    if (!MEMOIRE) return;
    const page = tabs.closest('.an-page') ?? tabs;
    // « général » reste à la rangée « avancé », qui le rouvre ; les autres sont mis comme voulu, une fois chacun.
    if (!pending.has(page)) pending.set(page, Object.entries(wantedHere()).filter(([key, want]) => key !== 'general' && typeof want === 'boolean'));
    const left = pending.get(page);
    if (left.length === 0) return;
    pending.set(page, left.filter(([key, want]) => {
      const b = tabs.querySelector('[data-tab="' + key + '"]');
      if (!b) return true;
      if ((b.getAttribute('aria-pressed') === 'true') !== want) b.click();
      return false;
    }));
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });
})();`;

/** Le script d'usage courant : onglets voulus rejoués et retenus, rangée « avancé » ouverte. */
export const ONGLETS = ongletsSource();
