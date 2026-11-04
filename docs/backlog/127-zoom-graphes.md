# 127 · Graphes : le zoom isolé dans le panneau des graphes, pas de décimation

Noté le 01/11 (fiche 114 § Relevés : zoom d'un graphe de la course de 2 h avec cardio, 3,4 s par image à ×6), réorienté le 03/11 par l'audit (`~/.claude/plans/audit-vente-0111/angle-C7a.md`, C7a-3 et C7a-4). Modèle | Réflexion : Opus | high. Brief écrit le 04/11 (paquet « Fluidité »). Passe après 157 et 125, qui touchent `SailingModule` et `SurfModule`.

## Tel que noté

- « Zoom d'un graphe (pincement, double toucher, zone tirée) : tout le module redessiné à chaque image, en voile comme en surf. `useTimeChartAxis.ts:237-238` (zoom tenu par le module) ; `SailingModule.tsx:489-518` ; `SurfModule.tsx:307-321` ; `ZoomableChart.tsx:126-133` (un `zoom.set` par image pendant le pincement). »
- « Les graphes sont déjà décimés (`CHART_MAX_POINTS = 500` dans `core/displayConfig.ts`, `core/chartZoom.ts`) : 1 189 lignes pour 54 750 points. Le figement vient du rendu de toute la page et de cinq graphes Recharts à chaque image, non du nombre de points. »

## Où, aujourd'hui (relevé du 04/11)

- L'état du zoom est un `useState` dans `hooks/useChartZoom.ts:26`, tenu par le module : `SailingModule.tsx` (`timeChart` 514, `chartZoom` 515, `cardioZoom` ; props `zoom` vers `TrackChart` 581 et 588, `HeartRateChart` 595, `CardioCompanion` 628) ; `LandModule.tsx` (`energyZoom` 437, `zoom`, `profileZoom`, `testZoom` 560-564) ; `SurfModule.tsx` (`timeChart` 312, `zoom` 313, `TrackChart` 357, `HeartRateChart` 371).
- Chaque image du pincement passe par `zoom.set`, qui rend tout le module : carte, panneaux, listes.

## Voulu

- Le zoom vit dans le panneau des graphes (ou dans un magasin externe lu par `useSyncExternalStore`, comme le survol `hoveredTrackIndex` de `components/chartHover.ts`) : une image de pincement ne rend que les graphes qui partagent l'axe des temps, jamais le module entier. Les graphes liés (vitesse, FC, cardio, énergie, profil) gardent leur zoom commun quand ils l'ont aujourd'hui.
- Panneaux hors graphes (carte, listes, chiffres de « général », tops) mémoïsés ou hors du chemin de rendu du zoom ; la couche carte (`AnalysisMap`, trace, surbrillance) ne se remonte pas pendant un zoom.
- `timeChart.timeX` (et ce que `useTimeChartAxis` recalcule) mémorisé sur ses vraies dépendances.
- Même comportement partout : voile, course et vélo, fractionné (`LandModule`), surf. Double toucher, pincement, zone tirée, bouton de remise à zéro, survol relié à la carte (`HoverMarker`) : inchangés. Aucun chiffre affiché ne change.
- Pas de décimation nouvelle ; si le plan tente un plafond à la largeur en pixels, le dire d'abord dans le rapport (choix d'implémentation, pas de produit).

## Ne pas toucher

- `hooks/useSessionLibrary.ts` et ses tests (lot 113), `core/gpxParser.ts` (lot 126 A), `outils/banc/` (lot 159 B).

## Vérification

- `node outils/verif.mjs --rapide` ; banc : `zoom-carte` (échoue déjà avant, n° 163 : relever, ne pas corriger ici), le script le plus proche des graphes en course, `surf`, `voile` : textes identiques avant et après.
- `outils/banc/fluidite.mjs` : la mesure « Zoom d'un graphe de la course de 2 h » de la fiche 114 (0,30 s script / 3,4 s image la plus longue à ×6) refaite après : l'image la plus longue doit chuter nettement (ordre de grandeur attendu : sous 1 s à ×6) ; chiffres notés dans le rapport.
- Essai au téléphone (un seul, à la fin du paquet) : zoom par pincement sur le graphe d'une course de 2 h avec cardio, fluide.

## Pourquoi

Un zoom qui fige l'écran trois secondes à chaque image rend les graphes inutilisables au téléphone sur une longue sortie ; la cause est le câblage, pas le nombre de points.

## Au passage

- (lot 157, décision 1 du 04/11) : ajouter dans `SurfModule.tsx` la prop `reading` d'`AnalysisShell` (texte « Lecture de la session… »), tirée d'`useAnalysisSession` (l. 160) et passée à `AnalysisShell` (l. 440), comme en voile et à pied.

## Plan (agent Plan, 04/11, sur le commit 3b6cecf)

- **Aujourd'hui** : chaque image d'un pincement appelle `zoom.set` (`ZoomableChart.tsx:126-133`), un `useState` de `useChartZoom` tenu à la racine du module : carte, panneaux, listes et graphes redessinés à chaque image. Voile : `chartZoom` commun à vitesse, FC et vent, `cardioZoom` à part (`HeartRatePanel`, `CardioCompanion`) ; les lignes (`visibleRange`, `speedRows`, `heartRows`, `windRows`) se calculent dans le module depuis `.view`, lu aussi par `readable`, `graphReadout` (713-719), `useZoomOnMap` (tronçon violet, `show`). À pied : `zoom` (distance) commun à « graphiques » et « zones de pente » ; `profileZoom`, `energyZoom` (`useTimeChartAxis`), `cardioZoom`, `testZoom` à part ; lignes `energyRows` (446), `trackChartRows` (593), `profileRows` (616). Surf : `zoom` commun à vitesse et FC, `chartData` (320). `MuscuModule.tsx:119` passe par `useTimeChartAxis`. Zooms locaux non touchés : `IntervalAnalysis`, `JumpsPanel`, `PlanningPage`, `StatisticsPage` ; `HeartRatePanel` et `FitnessTestPanel` calculent déjà leurs lignes depuis `zoom.view`.
- **Conception** : magasin externe lu par `useSyncExternalStore`, comme le survol (`hooks/useChartHover.ts`, `createHoverStore`), un abonné par bloc de graphes. Pas de composant « panneau des graphes » : un même zoom sert des sous-arbres séparés (en voile « graphiques » et « vent » sont deux `ResizablePanel`, le compagnon plein écran est rendu dans `AnalysisMap`).
  - `hooks/useChartZoom.ts` : `createChartZoomStore()` pur (`get`, `set`, `subscribe`, sur `createListeners` de `hooks/createStore.ts`, ne prévient que si min ou max change) ; `useChartZoomSource(full, resetKey)` → poignée stable `{ full, minSpan, get, subscribe, set (borné par clampRange), reset }`, magasin neuf à chaque `resetKey` ; `useZoomState(source): ChartZoom` (même forme qu'aujourd'hui, vue re-bornée si l'étendue change) ; `useChartZoom = useZoomState(useChartZoomSource(...))`, signature inchangée pour les pages locales.
  - `components/ZoomView.tsx` (nouveau, fichier à part : règle `only-export-components`) : `<ZoomView zoom={source}>{(z) => …}</ZoomView>` ; seul ce bloc se redessine au zoom ; `TrackChart`, `HeartRateChart`, `ZoomableChart`, `chartXAxis` gardent leur API (ils reçoivent l'instantané). Double toucher, pincement, zone tirée, « Tout voir » restent dans `ZoomableChart` (`z.set`, `z.reset`, `z.shown`) ; survol inchangé (`trackHover`, `HoverMarker`).
  - Tronçon violet (§2 « le violet suit le zoom ») : `useZoomOnMap` rend une source stable `{ zoom, axis, points, whole }` à la place de `path` ; un `ZoomPathLayer` abonné, placé dans `AnalysisBaseLayers.tsx:38`, calcule `axisRangePath` ; l'effacement au retour à tout voir passe par un effet abonné (un seul rendu du module, au retour) ; `show` lit `source.get()` au clic.
- **Mémoïsation** : les panneaux `memo` reçoivent la source à la place de l'instantané (`HeartRatePanel`, `CardioCompanion`, `FitnessTestPanel` appellent `useZoomState` eux-mêmes) ; fabriques de lignes `rowsAt = useMemo(() => lastByRange((view) => …), [deps])`, partagées sans double calcul entre « graphiques », « vent », « zones » et le compagnon. `useTimeChartAxis` : `timeX` en `useMemo(() => timeOfDayX(startMs), [startMs])`, `readable` et `readAt` en `useCallback`, objet rendu en `useMemo`, rend des sources (`zoom`, `cardioZoom`).
- **Fonctions pures**, `src/core/chartZoom.ts` : `sameRange`, `zoomViewOf(raw, full, minSpan)` (re-bornage), `zoomPathRange(view, full, whole)`, `lastByRange(fn)` (dernier résultat gardé par égalité min/max).
- **Étapes** : 1 relevé avant (`FLUIDITE_MESURES=zoom node outils/banc/passe.mjs fluidite`) ; 2 `core/chartZoom.ts` ; 3 `hooks/useChartZoom.ts` puis `components/ZoomView.tsx` ; 4 `hooks/useTimeChartAxis.ts`, `hooks/useZoomOnMap.ts`, `components/AnalysisBaseLayers.tsx` ; 5 `components/HeartRatePanel.tsx` (et `CardioCompanion`), `components/FitnessTestPanel.tsx` ; 6 `pages/SurfModule.tsx` (blocs vitesse et FC et compagnon dans `ZoomView`, `HoverReadout` compris ; `reading`) ; 7 `pages/SailingModule.tsx` (517-628 : graphiques, vent, compagnon) ; 8 `pages/LandModule.tsx` (graphiques, zones, énergie, profil de « général » avec `ElevationProfileMini`, compagnon ; `graphReadout(keys, view)`) ; 9 `pages/MuscuModule.tsx` au minimum ; 10 `node outils/verif.mjs --rapide` à chaque étape.
- **Tests** (node, sans DOM) : `hooks/useChartZoom.test.ts` (`set` borné à l'étendue et `minSpan` ; aucune notification pour une plage identique ; `reset` notifie une fois ; deux magasins indépendants) ; `core/chartZoom.test.ts` (`zoomViewOf`, `zoomPathRange` zoomé / entier / revenu, `lastByRange` un seul calcul pour une même plage ; `lastByRange` autour de `trackChartRows` rend les mêmes lignes que l'appel direct à 1 Hz et 5 Hz ; copie gelée de `trackChartRows` comme test de neutralité).
- **Preuve** : après, `FLUIDITE_MESURES=zoom node outils/banc/passe.mjs fluidite` ; référence fiche 114 : ×1 script 0,30 s ; ×6 image la plus longue 3,4 s, tâche max 1,0 s ; attendu : seuls les 4 graphes de « graphiques » se redessinent, script ≈ 0,1 s à ×1, image la plus longue sous 1 s à ×6. Neutralité : `node outils/banc/passe.mjs graphes survol cardio surf general onglets coquille vides zoom-carte` (pas de script `voile` : `graphes`, `survol`, `general` couvrent la voile ; `cardio` le fractionné ; `zoom-carte` échoue déjà, n° 163, même échec relevé).

## Décisions de l'orchestrateur (04/11)

1. Pas de plafond à la largeur en pixels dans ce lot ; si l'image reste au-dessus d'1 s à ×6, le dire dans le rapport (Recharts, 4 graphes d'environ 1 700 lignes), proposition à part.
2. Mesure du zoom de `fluidite.mjs` étendue à la voile, au surf et au vrai pincement : après le 159 B, ligne au reste à faire.
3. `MuscuModule` adapté au minimum, non optimisé.
