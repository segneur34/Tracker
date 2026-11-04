# 125 · Relevés de l'audit du 01/11 sans effet visible : tests du direct du test de FC max et de l'âge, fil des capteurs quitté, graphes du surf mémoïsés

Noté le 01/11 (fiche 119 `docs/backlog/119-audit-suite.md`, lignes « Décompte et lectures du test de FC max sans test », « Fil des capteurs jamais arrêté », « Graphes redessinés à chaque rendu du module »). Modèle | Réflexion : Sonnet | medium. Brief écrit le 04/11 (paquet « Fluidité »).

## Tel que noté

- « `recording/fitnessTest.ts` : `phaseRemainingS` et `guideReadings` (temps restant de la phase, vitesse et FC lissées montrées au direct du test) ne sont appelées par aucun test ; `stepFitnessTest`, testé, ne les appelle pas : un chiffre faux passerait sans qu'aucun test ne le voie. »
- « `runnerAge` et `fitnessTestRunner` (âge, donc FC max estimée et zones) sans test. »
- « `MotionPlugin.handleOnDestroy` ferme la capture mais ne quitte pas son `HandlerThread` (`BeeperPlugin`, lui, le quitte) : à chaque recréation de l'activité, un fil de plus garde l'ancien greffon et son contexte. »
- « `pages/SurfModule.tsx` (`speedChart`, `heartChart`) : `TrackChart` n'est pas mémoïsé et reçoit à chaque rendu des axes, un formateur et une `ReferenceArea` par vague et par vol tout neufs ; le moindre changement d'état du module refait tout le dessin Recharts. »

## Voulu

- Tests sur trace synthétique, dans les fichiers `*.test.ts` des fonctions : `phaseRemainingS` (chaque phase, bornes, plancher 0), `guideReadings` (vitesse et FC lissées sur fenêtres en secondes, règle 2 : 1 Hz et 5 Hz donnent le même résultat), `runnerAge` (date de naissance, anniversaire, absence), `fitnessTestRunner` (FC max estimée et zones qui en découlent). Aucun calcul modifié : si un test révèle un chiffre faux, le dire dans le rapport (section « Décision »), ne pas corriger sans brief.
- `MotionPlugin.handleOnDestroy` quitte son `HandlerThread` (`quitSafely`) comme `BeeperPlugin` ; Java compilé (`gradlew.bat` depuis `android/`, chemin complet, procédure au §12 d'ETAT).
- `SurfModule` : `TrackChart` et `HeartRateChart` reçoivent des props stables (`useMemo` sur les lignes, les axes, le formateur et la liste des `ReferenceArea`, `useCallback` sur les gestionnaires) ; mémoïsation du composant si ses props le permettent. Rien de visible : mêmes graphes, même survol, même « Voir ».

## Ne pas toucher

- `hooks/useChartZoom.ts`, `hooks/useTimeChartAxis.ts`, `components/ZoomableChart.tsx`, `pages/SailingModule.tsx`, `pages/LandModule.tsx` : le zoom est le sujet du lot 127, qui passe après celui-ci sur `SurfModule`.
- Fichiers du lot 157 (`hooks/useLibraryNavigation.ts`, `components/AnalysisShell.tsx`, `hooks/useAdvancedTabs.ts`, `hooks/useGpxSession.ts`) et du lot 159 A (tests de `useSessionLibrary`, `src/test/`, `hooks/useSailingSession.ts`, `outils/verif.mjs`, `architecture.test.ts`).

## Vérification

`node outils/verif.mjs --rapide` ; banc : `surf` (texte identique avant et après). Rien à essayer au téléphone.

## Pourquoi

Rien de visible pour l'utilisateur : du code couvert, un fil de moins à chaque rotation d'écran, un module de surf qui ne redessine pas ses graphes pour un clic sur un onglet.
