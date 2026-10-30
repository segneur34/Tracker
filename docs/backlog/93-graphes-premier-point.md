# 93 · Graphes : le repère de la carte saute au premier point après un clic

Sonnet | high (la vérification compte : le défaut ne se voit qu'à la souris, au banc). Changement neutre pour le texte des pages. Brief écrit le 30/10 par l'orchestrateur d'après la ligne 93 de `docs/BACKLOG.md`.

## Le défaut

Recharts pose une « couche d'accessibilité » sur chaque graphe : après un clic, le graphe prend le focus et cette couche active le premier point de la série (comme une flèche du clavier). La souris sortie du tracé, le dernier point « actif » reste le premier : le survol commun (`components/chartHover.ts`, `hoveredTrackIndex`) ramène alors le repère de la carte (`components/HoverMarker.tsx`) au premier point affiché, au lieu de l'effacer. Vu sur l'évolution des répétitions et corrigé là au lot 61 par `accessibilityLayer={false}` (`src/components/IntervalAnalysis.tsx:452`). Les autres graphes n'ont pas été vérifiés.

## Ce qui existe

Graphes Recharts de `src/`, tous `ComposedChart`, `BarChart` ou `ScatterChart`, sans `accessibilityLayer` :
- `src/components/TrackChart.tsx:105` : le graphe commun des analyses, relié à la carte (`trackHover`, `clearTrackHover`), dans `ZoomableChart` ; c'est lui qui porte le défaut visible sur la carte (vitesse, altitude, FC, pente… à pied, à vélo, en voile, en surf).
- `src/components/HeartRatePanel.tsx:234` (`ScatterChart`), `src/components/RestingHrChart.tsx:36`, `src/components/FitnessTestPlanChart.tsx:54` et `:71`, `src/pages/StatisticsPage.tsx:642`, `:735`, `:795`, `:813` : pas forcément reliés à la carte, mais la même couche clavier peut y laisser un point « actif » après un clic (info-bulle ou repère figé sur le premier point).

## À faire

1. Reproduire au banc, à la souris, sur `TrackChart` : ouvrir une analyse course (ou voile), survoler le graphe (le repère suit), cliquer dessus, sortir la souris du tracé ; relever `hoveredTrackIndex` (ou la position du repère) : s'il vaut le premier point affiché au lieu d'être effacé, le défaut est confirmé. Le faire dans un contrôle ajouté à `outils/banc/graphes.mjs` (script déjà sur `lib/cdp.mjs`, `mouse`, `evaluate`), qui dit `ok` ou `ÉCHEC`, et qui doit échouer avant la correction et passer après. Si le défaut ne se reproduit pas sur `TrackChart`, le dire et chercher pourquoi (le `onMouseLeave` de `ZoomableChart` suffit peut-être déjà) avant de conclure.
2. Corriger une seule fois là où c'est commun : `accessibilityLayer={false}` sur le `ComposedChart` de `TrackChart.tsx`. Puis le poser aussi sur les autres graphes de la liste, pour que le clavier n'y active plus un point à l'insu de la souris (même raison : aucune navigation au clavier n'est voulue sur ces graphes, décision du lot 61). Si Recharts offre un réglage global plus simple (propriété par défaut), le préférer ; sinon la propriété graphe par graphe.
3. Vérifier que le clavier ne servait à rien de voulu sur ces graphes (Tab vers le graphe, flèches) : rien dans `DECISIONS.md` ne le demande.

## Garde-fous

- Pas de `any` ; le survol passe toujours par `hoveredTrackIndex` (`chartHover.ts`), un seul repère sur la carte.
- Ne rien changer au comportement au survol ni au zoom ; texte des pages identique avant et après.
- Pas de `docs/`, pas de commit, pas de version.

## Preuve

- `node outils/verif.mjs --rapide`.
- `node outils/banc/passe.mjs graphes --avant HEAD --scripts-par-cote` : le nouveau contrôle échoue côté « avant » et passe côté « après » ; le reste du relevé identique. Si le contrôle ne peut pas être écrit à la souris (CDP), expliquer pourquoi dans le rapport et relever à la main ce que `hoveredTrackIndex` vaut après clic et sortie.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; graphes où le défaut se reproduisait, correction posée, résultat du script avant/après, fichiers touchés.
