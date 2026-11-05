# 164 · Graphes plus rapides au zoom : lignes plafonnées à la largeur du tracé

Brief écrit le 05/11 (paquet A « Analyses : défauts et fluidité », plan approuvé : `~/.claude/plans/fait-les-lot-a-abstract-pizza.md`). Suite du 127 (`docs/backlog/127-zoom-graphes.md`, HISTORIQUE point 272). Modèle | Réflexion : Opus | high. Passe après 167, pour plafonner aussi le graphique de VMG.

## Le fait

À ×6, l'image la plus longue d'un zoom reste à 1,5 s (1,9 s avant le 127). Le module n'est plus redessiné ; le reste vient du dessin Recharts des 4 graphes de « graphiques », jusqu'à 1 700 lignes chacun : `CHART_MAX_POINTS` vaut 500, mais `keepExtremes` (`core/chartZoom.ts`) ajoute les extrêmes sans autre plafond que sa tolérance.

## Voulu

- Image la plus longue sous 1 s à ×6.
- Lignes dessinées plafonnées à la largeur du tracé en pixels (min-max par pixel) dans `sampledIndicesKeeping`, pour tous les appelants (`core/chartRows.ts`, voile, surf, énergie, `HeartRatePanel`, `FitnessTestPanel`).
- À trancher par le plan : largeur mesurée ou plafond fixe ; plusieurs séries sur un même graphe.
- Mesure du zoom de `outils/banc/fluidite.mjs` étendue à la voile, au surf, au vrai pincement, et à largeur de téléphone (le banc mesure à 1 400 px, où un plafond à la largeur ne gagnerait presque rien). Relevé « avant » d'abord.

## À garder

Pics visibles (décision du 27/10, `CHART_EXTREME_TOLERANCE`), `index` de trace sur chaque ligne (survol, `hoveredTrackIndex`), zoom commun, 1 Hz = 5 Hz (testé), chiffres inchangés. Rien de visible sinon la fluidité.

## Vérification

`node outils/verif.mjs --rapide`. Relevé « après » noté ci-dessous. Banc : `graphes survol cardio surf general onglets coquille vides zoom-carte` (`zoom-carte` échoue déjà, n° 163 : même échec attendu). Si l'objectif n'est pas atteint, le dire avec les chiffres et proposer la suite ; remplacer Recharts n'est pas dans ce lot.

Essai au téléphone, un seul : pincement sur une course de 2 h, fluide.

## Plan (agent Plan, 05/11, lecture de Recharts 3.10.1 ; retenu par l'orchestrateur)

**Écart au brief, retenu.** Un min-max par pixel sur des lignes partagées ne plafonne rien : 4 séries × 2 × ~334 px = 2 672 lignes, plus que les 1 700 d'aujourd'hui. D'où des lignes par graphe et un garde-fou fixe.

**Décisions.**
1. Plafond fixe, sans largeur mesurée : la largeur n'est connue qu'après le rendu, alors que les lignes sont partagées par `lastByRange` entre panneau et plein écran. 500 réguliers + 300 extrêmes par série au plus (`Math.ceil(maxPoints × 0,6)`, en paramètre, règle 3, à côté de `CHART_EXTREME_TOLERANCE`).
2. Chaque graphe a ses lignes, jugées sur sa seule série : ~3 200 points contre 6 800, à confirmer. « Superposés » garde l'union (un seul graphe). Condition : un `syncMethod` fonction (`syncNearestTick`, pur, dans `components/chartHover.ts`), car Recharts synchronise par numéro de ligne (`useChartSynchronisation.js:83-107`). Avant de coder, vérifier que `activeLabel` est bien la valeur de l'axe.
3. Le plafond s'ajoute à la tolérance sans la remplacer : sous la limite, sortie identique à aujourd'hui ; au-delà, les plus grands écarts à la corde, min et max de la plage d'abord.
4. Coût lu : pas de nœud par ligne (`dot={false}`) ; un objet par point et la chaîne du tracé ; `getTotalLength()` à chaque rendu (`Line.js:313`) ; le dégradé d'altitude pose un `<stop>` par ligne (`gradeGradientDefs.tsx`), vrai DOM proportionnel. Essai : `type="linear"` si `rows.length >= CHART_MAX_POINTS` (espacement ≤ 2,6 px), gardé seulement si le gain mesuré est net et les captures sans différence à l'œil.
5. Si l'objectif n'est pas atteint : chiffres, puis limiter les `<stop>` d'altitude à ~200 d'abord.

**Fichiers.** `core/chartZoom.ts`, `core/chartRows.ts` (`keep?` optionnel ; absent, comportement actuel), `components/chartHover.ts`, `components/TrackChart.tsx`, `pages/LandModule.tsx` (`chartDataAt`, `gradeStopsAt`, `graphViewOf`), `pages/SurfModule.tsx` (`chartDataAt`), `pages/SailingModule.tsx` (`chartIndicesAt`, séparé en vitesse et FC ; VMG), `components/FitnessTestPanel.tsx`, `outils/banc/fluidite.mjs`, `outils/banc/lib/graphes.mjs`, `outils/banc/SCRIPTS.md`. Aucun fichier créé dans `src/`.

**Étapes.**
1. Banc sans toucher `src/` : `mesureZoom(variante)` à la place du bloc `fluidite.mjs:449-498`, `FLUIDITE_ZOOM=course-pc,course-tel,voile-tel,surf-tel` ; `pinch` dans `graphGestures` (`Input.dispatchTouchEvent`, deux doigts datés) ; téléphone 390×844 comme `activite.mjs:109` ; segments des `d` et `<stop>` relevés par graphe. Relevé « avant » noté ci-dessous (`course-pc` doit retrouver ~1,5 s).
2. Essai `linear` seul, mesuré.
3. `chartZoom.ts` et tests, puis `keep` de `chartRows.ts` : aucun test existant ne change, sauf au besoin la copie gelée (`Infinity`).
4. `syncNearestTick` et `TrackChart`.
5. Lignes par graphe : `LandModule`, surf, voile, `FitnessTestPanel`, mesure après chacune.
6. Relevé « après » et neutralité.

**Tests.** `core/chartZoom.test.ts` : trace bruitée de 3 600 s à 1 et 5 Hz, taille ≤ 500 + limite, pic de 3 s au même temps ; cadence saturée + pic de FC ; min et max gardés ; croissants sans doublon ; sous la limite, identique. `core/chartRows.test.ts` : `keep: ['hr']` mêmes lignes à `index` égal que la copie gelée. `syncNearestTick` : plus proche, égalité, libellé non numérique, abscisses à 1 et 5 Hz.

**Banc.** `FLUIDITE_MESURES=zoom node outils/banc/passe.mjs fluidite` avant et après ; `graphes survol cardio surf general onglets coquille vides zoom-carte` ; `survol` complété : point actif des graphes liés à la même abscisse, à un pas de ligne près.

**Écarts acceptés, à signaler s'ils apparaissent.** Axes `dataMin`/`dataMax` calculés sur les lignes du graphe (écart de moins de 5 % de l'étendue, une graduation peut bouger) ; sur ordinateur, le repère du survol avance par pas de 2,7 px.
