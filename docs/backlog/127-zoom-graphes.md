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
- Au passage (lot 157, décision 1 du 04/11) : ajouter dans `SurfModule.tsx` la prop `reading` d'`AnalysisShell` (texte « Lecture de la session… »), comme en voile et à pied.
