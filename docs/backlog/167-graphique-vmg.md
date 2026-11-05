# 167 · Voile : graphique de VMG, et manœuvres écartées du graphique et des chiffres

Brief écrit le 05/11 (paquet A « Analyses : défauts et fluidité », plan approuvé : `~/.claude/plans/fait-les-lot-a-abstract-pizza.md`). Modèle | Réflexion : Opus | medium.

## Tel que décidé (05/11, réponses de l'utilisateur)

- Le graphique va dans l'onglet « vmg », sous le tableau et les podiums.
- Une seule courbe autour de zéro : au-dessus le près, en dessous le portant, un trou à chaque manœuvre.
- Les moments de manœuvre (virements, empannages) sont écartés du graphique ET des chiffres de l'onglet (moyennes par bord, max, tops). Les chiffres de VMG des anciennes sessions changent : voulu, à signaler au compte rendu.

## Calcul

`src/sailing/sailingAnalytics.ts`, tests à côté :

- `calculateVmgStats` reçoit un paramètre de plus, les manœuvres (`entryIndex`, `exitIndex` de `ManeuverLocation`, tous types confondus), vide par défaut : les tests existants restent neutres.
- Une somme cumulée de plus, le temps en manœuvre : une fenêtre qui en touche une ne compte ni dans les moyennes par bord, ni dans les max, ni dans les podiums. Le moment de manœuvre va du début de la rotation à la relance, telle que le noyau la définit (`exitIndex`). Aucun seuil neuf (règle 3).
- Règle 10 : une manœuvre tenue dans un seul intervalle est écartée aussi, `entryIndex === exitIndex` compris.
- Nouvelle fonction pure `vmgSeries` : VMG signée en nœuds par point, moyenne sur `VMG_WINDOW_S` centrée (règle 2, en temps), `null` dans une manœuvre, sous le seuil d'activité ou à travers un trou, avec les mêmes règles que les chiffres (trou pesé par `stepDistanceM`, règle 6 ; pas de reprise de pause `segmentStart` à durée nulle). Réutilise les sommes cumulées : extraire une aide commune plutôt que les recopier.
- `src/sailing/sailingSession.ts`, `analyzeSailingWind` : passe `maneuverStats.locations`, et rend la série. `src/hooks/useSailingSession.ts` la remonte comme `vmgStats`.
- Tests synthétiques (`*.test.ts`, environnement node) : fenêtre touchant une manœuvre écartée, 1 Hz = 5 Hz, trou, signe près et portant, sans manœuvre = résultat d'avant.

Pas de `SUMMARY_CALC_VERSION` : la VMG n'est pas dans les résumés.

## Écran

`src/pages/SailingModule.tsx`, `renderVmgPanel` :

- Courbe sous les podiums, dans l'unité de vitesse de l'activité (`knotsToChartValue`), trait de référence à 0.
- Sur le patron de `speedChart` et `windChart` : `TrackChart`, `ZoomView`, lignes par `lastByRange` et `sampledIndices`, `HoverReadout`, zoom commun `chartZoom`, sans `syncId` comme `windChart` (tranché par l'orchestrateur le 05/11 : Recharts synchronise par numéro de ligne, ses lignes diffèrent de celles de la vitesse ; survol relié à la carte par `trackHover`), repères (`markLines`), « +carte » (`charts.vmg` passé à `useZoomOnMap`, `case 'vmg'` de `companionCharts`). Pas de `any`.
- Attention, `renderVmgPanel` n'est pas un bloc de zoom aujourd'hui : seul le `ZoomView` du graphique suit le zoom, le tableau et les podiums ne se redessinent pas au zoom.
- Le panneau `ResizablePanel` garde son `id` (`sailing.carte.vmg` : clé de la taille mémorisée).
- Suivre `docs/MISE_EN_PAGE.md`. Couleurs de données en dur permises (attributs SVG).
- Aide « ? » de l'onglet (`helpKey` de `PanelHeading`, sur le modèle de `voile:manoeuvres`) : dit en clair ce que montre la courbe, et que les manœuvres sont écartées des chiffres et du graphique.

## Ne pas toucher

`src/hooks/useZoomOnMap.ts` et `outils/banc/zoom-carte.mjs` (lot 166, en parallèle) ; `src/core/chartZoom.ts` (lot 164, ensuite). Si le lot le doit, le dire dans le rapport au lieu de le faire.

## Vérification

`node outils/verif.mjs --rapide` dans le worktree. Banc lancé par l'orchestrateur après rapatriement (`graphes`, `survol`, `general`, `onglets`) ; ajouter à `outils/banc/graphes.mjs` un contrôle court du graphique neuf (présent dans l'onglet « vmg », lignes tracées), sans lancer le banc dans le worktree.

Essai au téléphone, un seul, posé par l'orchestrateur : une vraie session de voile, forme de la courbe et chiffres crédibles.
