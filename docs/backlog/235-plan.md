# 235 · Plan (agent Plan, 25/11 au soir) et choix tranchés

Brief : `docs/backlog/235-fluidite.md`. Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lots 402, 399 partie 2, 400. Règle : mesurer d'abord, ne coder que ce que la mesure montre.

## Où en est Tracker

- A. Chiffres du direct (Gtracker 402 : f8b6324, e83fc66) : fait à moitié. Tracker garde déjà les segments fermés et reprend la cinématique (`src/recording/liveStats.ts` l. 376-417, `LiveStatsMemory` ; HISTORIQUE point 167 : 7 ms à 4 h contre 31). Mais le segment en cours est refait en entier à chaque calcul (l. 391-411 et 453-484 : `buildCumulativeTrack`, distance, `thresholdActivityMask`, `heartPart`, `bestWindowSpeedMs`, `splitLiveLegs`, `computeElevationStats`, `computeGrades`, `segmentEnergy`, et le `filter` de `bestRecentTop` l. 305), et `src/core/kinematics.ts` l. 314-508 recopie ses tableaux et repasse sur toute la trace. Dénivelé, pentes et énergie sont propres à Tracker. Piste : la clé de mémoire (l. 365) contient `activeThreshold` ; en voile sans seuil propre il vient de l'allure, remesurée toutes les 60 s (`useLiveRecording.ts` l. 151-161) : s'il change, toute la cinématique est refaite.
- B. Carte du direct par blocs (Gtracker 040b7b1) : absent. `src/components/LiveMap.tsx` l. 257-268 et 288 recrée par `concat` tout le segment en cours toutes les 2 s puis `setLatLngs` : Leaflet reprojette tout, deux fois en satellite.
- C. Analyse en arrière-plan (Gtracker 99b156e, 944f8c0, bf0b304) : absent, sauf la lecture. Seules la lecture du GPX et la cinématique passent en fond (`useGpxSession.ts` l. 117-131, un seul calcul de fond dans `trackWorkerClient.ts`). Sur le fil de l'affichage : voile (`useSailingSession.ts` l. 93-132, `trackColorSegments` dans `SailingModule.tsx` l. 331), surf (`SurfModule.tsx` l. 242, 266), à pied et à vélo une vingtaine de `useMemo` (`LandModule.tsx` l. 338-710).
- Correction de la fiche : les vignettes ne passent PAS par le calcul de fond (`sessionColorTrack` dans `SessionLibrary.tsx` l. 305 et `SavedSessionShare.tsx` l. 60 ; seul le dessin est en cache).

## Mesures (version compilée, durée dite avant, poste au calme)

- M1, existant : `set FLUIDITE_MESURES=ouverture,quitter,seuil&& node outils/banc/fluidite-compile.mjs avant235`, 8 à 10 min ; relevé dans `%TEMP%\tracker-banc\compile\releves\prod-avant235.txt`.
- M2, à écrire : `outils/banc/direct-calcul.mjs`, sous Node (`import './charge-ts.mjs'`), sans navigateur, 1 à 2 min : traces synthétiques de 3 h à 1 Hz (voile, course, vélo), `computeLiveStats` avec mémoire toutes les 2 positions ; médiane par calcul à 1, 2 et 3 h, cumul, égalité stricte avec le calcul sans mémoire, nombre de remises à zéro de la mémoire ; option `--cpu-prof`.
- M3, à écrire : `outils/banc/direct-long.mjs`, voile puis course, 15 min, plafond 25 : rejeu à ×100 jusqu'à 2 h 55 puis ×1 (3 min) et ralenti ×6 (3 min) ; tâches longues et profileur regroupé par fichier (leaflet, liveStats et kinematics, react). `lib/horloge.mjs` étendu par une option neuve seulement.
- M4 : `fluidite.mjs` étendu, `FLUIDITE_OUVERTURE=voile,surf,course`, environ +6 min.
- `charge.mjs`, `charge-ts.mjs`, `bench.mjs`, `carte-perf.mjs` et `carte-direct.mjs` ne mesurent pas cela.

Seuils (ralenti ×6, version compilée) :

| Partie | On la code si… |
|---|---|
| A | une position reçue bloque plus de 100 ms à 3 h, ou les calculs du direct dépassent 20 % de cette tâche, ou M2 montre plus de 10 ms par calcul sur PC à 3 h (sinon rien, sauf la clé de seuil si M2 montre des remises à zéro) |
| B | la part de Leaflet dépasse 30 ms par calcul à 3 h |
| C | plus longue tâche à l'ouverture au-delà de 1 s, ou plus de 1,5 s figé en tout ; une famille sous le seuil n'est pas branchée |

## Plan par partie, si la mesure le justifie (Opus/high pour A et C, Sonnet pour B et les scripts)

- A1 (petit) : clé de la cinématique séparée de celle des statistiques ; tops récents par dichotomie. A2 : calculs repris là où ils s'étaient arrêtés (masque, vitesse max, FC, bords), d'après f8b6324 : `core/sessionStats.ts`, `topSegments.ts`, `heartRate.ts`, `speedFilter.ts`, `recording/liveLegs.ts`, nouveau `recording/liveSegment.ts`. A3 : `kinematics.ts` sans recopie (e83fc66, avec ses deux corrections : départ immobile, longue suite de trous). A4, seulement si M2 montre que dénivelé ou énergie dominent : `core/elevation.ts`, `land/grade.ts`, `running/energy.ts`, `cycling/energy.ts`.
- Tests de A : « repris à un indice au hasard = calcul entier », égalité stricte, 1 Hz et 5 Hz, pause et reprise, GPS perdu 40 s, cadence de 1 à 15 s avec un virage en un pas, dates égales. `SUMMARY_CALC_VERSION` ne bouge pas.
- B (petit, un commit) : `liveBlocks` (blocs de 300 points qui partagent leur point de jonction) dans `recording/livePath.ts`, `blockPath` dans `LiveMap.tsx`.
- C1 : deux calculs de fond (`trackWorkerClient.ts`), tâche `colorTrack` (`trackWorkerProtocol.ts`) pour vignettes et image de partage. C2, sans brancher la page : `library/analysisStore.ts`, `library/latestRequest.ts`, tâches `analyzeSailing`, `analyzeSurf`, `release` ; `withWindAt` exporté (`windAt` et `detection` portent des fonctions, qui ne passent pas dans un message). C3 : `hooks/useTrackAnalysis.ts`, `useGpxSession.ts`, `useSailingSession.ts`, `SailingModule.tsx`, `SurfModule.tsx` ; seuil, vent saisi et allure résolus dans le hook (règle 4) ; `thresholdPending` devient `analysisPending` ; les anciens chiffres restent affichés pendant un recalcul. C4 : `LandModule`, regroupé dans une fonction pure `land/landAnalysis.ts` puis en tâche de fond ; gros.
- Neutralité au banc : A et B : `carte-direct`, `trace-suivie`, `denivele-direct`, `notification`, `bench`, `balises` ; C : `general`, `graphes`, `virages`, `allure-session`, `brouillon-voile`, `library`, `session-save`, `surf`, `pumping`, `sauts`, et pour C4 `pentes`, `depense`, `cardio`, `fractionne`, `charge`, `altitude`, `surface`. Remesurer après chaque partie.
- Aucun fichier commun avec `useRecorder.ts`, `platform/location.ts`, `android/`, `bureau/`, `memoryFolder.ts`.

## Tranché par l'orchestrateur le 25/11

- A, B et C se mesurent séparément ; une partie sous son seuil n'est pas codée, son chiffre ira dans HISTORIQUE.
- Les blocs de 300 points sont un découpage du dessin, pas une fenêtre de calcul (règle 2 non concernée) ; un point un peu plus foncé à chaque jonction est accepté ; pas de texte neuf pendant un recalcul.
- `LandModule` (C4) : seulement si M4 dépasse le seuil de C sur la course de 2 h. A4 : seulement si M2 montre à pied ou à vélo plus de 15 ms par calcul sur PC à 3 h.

## Non vérifié par le plan

L'arrondi de la suggestion de seuil en voile (`suggestActiveThresholdKn`, `src/sailing/sailingConfig.ts` l. 187) ; le chargement de `liveStats.ts` sous Node par `charge-ts` ; `liveLegs.ts`, `sessionStats.ts`, `topSegments.ts`, `heartRate.ts`, `speedFilter.ts`, `surfSession.ts`, `sessionTrack.ts` ; si une ouverture attend vraiment derrière la file des résumés (`summaryQueue.ts`) ; si `PerformanceObserver` voit le travail de `setLatLngs` ; les durées, à ±50 %.

## Mesures

### M2, 25/11 au soir (poste chargé, à rejouer au calme)

Temps d'un calcul des chiffres du direct, médiane puis 95e centile, en ms, sur PC :

| Famille | 10 min | 1 h | 2 h | 3 h | cumul sur 3 h | sans mémoire à 3 h |
|---|---|---|---|---|---|---|
| Course | 0,5 / 0,8 | 2,5 / 3,7 | 4,9 / 6,6 | 8,0 / 10,0 | 26,9 s | 30,0 |
| Vélo | 0,5 / 0,8 | 2,4 / 3,8 | 10,0 / 16,9 | 8,1 / 13,7 | 30,2 s | 17,4 |
| Voile | 0,5 / 0,9 | 3,3 / 5,1 | 4,7 / 5,8 | 13,6 / 20,8 | 26,1 s | 25,4 |
| Voile, seuil changé toutes les 60 s | 0,5 / 1,1 | 2,2 / 3,3 | 4,4 / 7,4 | 7,6 / 13,9 | 22,6 s | 14,1 |

- Le coût grandit avec la durée malgré la mémoire (0,5 ms à 10 min, 8 à 14 ms à 3 h) : le seuil de la partie A (10 ms à 3 h) est dépassé en voile, frôlé à pied et à vélo. Résultat strictement égal au calcul sans mémoire dans les quatre cas.
- Avec l'allure réelle de la page, la mémoire n'est jetée qu'une fois en 3 h en voile ; un seuil qui change la jette à chaque fois (179 fois), sans coût supérieur au nominal ici.
- Répartition : la cinématique reprise ne pèse que 8 à 9 %. Ce qui pèse est refait à chaque calcul : à pied et à vélo `speedFilter` (22 %), `liveStats` (21 %), énergie (12 à 14 %), dénivelé (8 %), FC (7 %) ; en voile les bords (`liveLegs`, 23 %), `sessionStats` (18 %), `liveStats` (14 %), `topSegments` (13 %).
- Décision de l'orchestrateur : A1 et A2 se codent (calculs repris là où ils s'étaient arrêtés) ; A3 (cinématique sans recopie) et A4 (dénivelé et énergie) attendent une nouvelle mesure après A2.

### M3 et M4

Scripts écrits le 25/11, jamais lancés (poste chargé) : `set FLUIDITE_SCRIPT=direct-long&& node outils/banc/fluidite-compile.mjs direct235` (16 min, plafond 25) et `set FLUIDITE_MESURES=ouverture&& set FLUIDITE_OUVERTURE=voile,surf,course&& node outils/banc/fluidite-compile.mjs ouv235` (8 à 10 min). Les parties B et C attendent leurs chiffres.

### Après A1 et A2 (26/11, poste chargé, avant et après dans les mêmes minutes)

| Famille | 1 h | 2 h | 3 h | cumul sur 3 h |
|---|---|---|---|---|
| Course, avant | 2,7 / 4,3 | 5,1 / 7,4 | 8,8 / 12,7 | 24,2 s |
| Course, après | 1,8 / 2,3 | 3,8 / 4,8 | 5,9 / 7,0 | 15,9 s |
| Vélo, avant | 2,4 / 3,7 | 4,7 / 6,1 | 9,0 / 11,7 | 24,0 s |
| Vélo, après | 1,6 / 2,3 | 3,6 / 5,2 | 5,5 / 8,4 | 14,7 s |
| Voile, avant | 1,9 / 3,2 | 5,9 / 12,2 | 9,1 / 11,2 | 25,7 s |
| Voile, après | 0,3 / 0,7 | 0,4 / 1,2 | 1,1 / 2,2 | 2,5 s |
| Voile, seuil changé toutes les 60 s, avant | 2,1 / 3,2 | 12,4 / 21,5 | 6,5 / 10,1 | 39,4 s |
| Voile, seuil changé toutes les 60 s, après | 0,2 / 0,8 | 0,7 / 1,8 | 0,8 / 2,0 | 3,3 s |

Résultat strictement égal au calcul sans mémoire dans tous les cas. Ce qui reste : à pied et à vélo, le lissage de l'altitude et le dénivelé (un tiers), l'énergie (un quart) ; en voile, la cinématique (recopies, 55 % de 1,1 ms). Sous les seuils du plan : A3 et A4 ne se codent pas.
