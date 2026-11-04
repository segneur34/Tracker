# 113 · Mémoire des sessions : `useSessionLibrary.ts` découpé par sujet, comportement inchangé

Noté le 01/11 (audit, fichier de 2 957 lignes et 42 exports). Modèle | Réflexion : Opus | high. Brief écrit le 04/11 (paquet « Fluidité »). Passe après 159 A, qui remet d'aplomb les tests de la bibliothèque (simulations sans état) ; avant 126 B, qui déplacera la file des résumés vers un worker.

## Tel que noté

- « `hooks/useSessionLibrary.ts` (2 957 lignes, environ 140 déclarations) mêle ouverture de la mémoire et dossier, fichier de réglages, import, fiches et file de mise à jour des résumés ; le découper par sujet sans rien changer au comportement, chaque partie avec ses tests, banc avant/après sur la bibliothèque. »

## Où, aujourd'hui (relevé du 04/11)

- `scan` (≈ 1351), `runJob` (≈ 1493, `analyzeGpx` à 1526), `completeScan` (≈ 1585), `runCompleteScan` (≈ 1602), `queueOutdatedRefresh` (≈ 2863), `addGpx` (≈ 2174), `updateSessionRecord` (≈ 2558), `summarizeGpxText` (≈ 571), `parseGpx` appelé en 2124.
- Tests : `useSessionLibrary.{balayage,deuxappareils,memoire,perte,resumes}.test.ts` et `useSessionLibrary.test.ts` (tous remis d'aplomb par 159 A, à relire avant de couper).

## Voulu

- Un découpage par sujet, chaque fichier sous `hooks/sessionLibrary/` (ou `library/`, au choix du plan, selon que la pièce est pure ou tient un état React) : ouverture de la mémoire et dossier ; fichier de réglages de l'appareil ; import de GPX et de dossiers ; fiches (`updateSessionRecord`, écriture) ; file de mise à jour des résumés (`scan`, `runJob`, `completeScan`, `queueOutdatedRefresh`). `hooks/useSessionLibrary.ts` reste le point d'entrée avec les mêmes exports et les mêmes signatures : aucun appelant ne change.
- Fonctions pures sorties en premier, chacune avec son `*.test.ts` sur données synthétiques ; les tests existants continuent de passer sans réécriture autre que les chemins d'import.
- Règle 12 respectée : la plateforme reste derrière `src/platform/`.
- Rien ne change de visible : mêmes fiches, même ordre de balayage, même file, mêmes messages.

## Ne pas toucher

- `core/gpxParser.ts` et ses tests (lot 126 A, en parallèle), `pages/*Module.tsx`, `hooks/useChartZoom.ts`, `hooks/useTimeChartAxis.ts`, `components/ZoomableChart.tsx` (lot 127, en parallèle), `outils/banc/` (lot 159 B).

## Vérification

- `node outils/verif.mjs --rapide` ; `npx vitest run --sequence.shuffle` vert (graine 3 comprise).
- Banc : scripts `library*` et `vignettes`, textes identiques avant et après ; relevé des fiches (version `SUMMARY_CALC_VERSION` inchangée, 16).
- Rien à essayer au téléphone.

## Pourquoi

Un fichier de 3 000 lignes ne se relit ni ne se teste ; le worker du 126 B a besoin d'une file des résumés isolée pour l'appeler.

## Plan (agent Plan, 04/11, sur le commit c1c5d6d qui porte le 159 A)

**Nature du fichier** : pas un hook à état, un magasin hors des composants fait d'une vingtaine de `let` de module (`state`, `folder`, `all`, `knownNames`, `generation`, `opening`, `publishPending`, `editCount`, `diskStamps`, `heldUnwritten`, `scanCompletion`, `scanPass`, `refreshing`…) partagés par tous les sujets. Un `let` importé ne se réaffecte pas : c'est le nœud du découpage, résolu par un objet mutable unique `lib`.

**Carte (lignes au commit)** : état publié et messages 145-253 (`LibraryStatus`, `SettingsFileInfo`, `LibraryState`, `state`/`setState`/`subscribe`, `reportError`, `pause`) ; mémoire ouverte 255-397 (`folder`, `all`, `knownNames`, `generation`, `opening`, `publishPending`, `publish`, index `byFile`/`byStart`, `findSession(At)`, `removing`, `unwritten`/`hold`/`takeUnwritten`, `unreadableByFolder`, `replaceSession`) ; cache des fiches 399-500 et `hydrateSession` 502-549 ; réglages des résumés et gestes 551-683 (`summarizeGpxText`, `sessionSummarySettings`, `summaryOutdatedTest`, `refreshFailed`, `settleSettingsGestures`, `newRecord`) ; écriture des fiches 685-906 (minuteries, `editCount`/`lastEdit`, `diskStamps`, `recordEdits`, `reconcileWithDisk`, `writeRecordOnce`/`Now`, `flushWrites`) ; fichier de réglages de l'appareil 908-1265 ; ouverture du dossier 1267-1283, `attach`/`detach` 1841-1927, `openLibrary`, `startLibraryUi` 1929-2038 ; file des résumés `scan` 1285-1473, `runJob`, `completeScan`, `runCompleteScan` 1475-1638, `queueOutdatedRefresh` 2850-2896 ; sessions en attente 1640-1839 ; import 2040-2460 (`addGpx`, `prunedMotion`, `recordFor`, `importEntries`, `saveRecordedSession`) ; fiches 2462-2681 (`updateSessionRecord`, `resummarize`, `removeSession`, `recordToCopy`, `carryUnwritten`) ; choix du dossier et relecture 2683-2848 ; sélecteurs React 2898-2957. Partagé : `state`/`setState`, `folder`/`all`/`generation`/`opening`, `findSession`/`replaceSession` partout ; `cacheDirty` entre mémoire, écritures et cache ; `unwritten`, `editCount`, `diskStamps` entre écritures, balayage et relecture ; `scanCompletion` entre file, import et `carryUnwritten`.

**Découpage** (sous `src/hooks/sessionLibrary/`, en couches : chaque fichier n'importe que les précédents) :
1. `store.ts` (~110) : état publié, `libraryState()`, `setState`, `reportError`, `pause`, `reportStartupError`, `dismissLibraryMessage`, `dismissSettingsOffer`, `readLibraryState`, types d'état (`SettingsFileInfo` va dans `library/settingsFile.ts`).
2. `memory.ts` (~230) : objet mutable unique `lib` (`folder`, `all`, `knownNames`, `generation`, `opening`, `publishPending`, `editCount`, `lastEdit`, `diskStamps`, `heldUnwritten`, `scanCompletion`, `scanPass`, `refreshing`), index, `replaceSession`, `cacheDirty`, `hydrateSession`, `hasSessionMotion`, crochet tardif `lib.onOutdated` (risque 1).
3. `summarySettings.ts` (~130) : réglages des résumés et gestes, `summarizeGpxText`.
4. `recordWrites.ts` (~300) : écritures différées, rapprochement avec le disque, `resummarize`, `carryUnwritten`.
5. `cache.ts` (~90) : cache des fiches.
6. `scan.ts` (~150) et `summaryQueue.ts` (~220) : `SummaryJob`, `runJob`, `completeScan`, `queueOutdatedRefresh`, calcul injectable `setSummaryRunner(run)` (défaut `analyzeGpx`, même signature, synchrone ; le 126 B l'élargira).
7. `deviceSettings.ts` (~400) : `settingsUpgraded`, `adoptSettingsFile`, `renameDevice`, `importSettingsFile`, `watchDeviceSettings()`, `flushWrites`, `applySettingsChange`.
8. `addSession.ts` (~260 : `addGpx`, `AddStatus`, `AddResult`, `countPending`), `pending.ts` (~200, `flushPending`), `importer.ts` (~150 : `saveRecordedSession`, `importEntries`, `importFiles`, `importFromFolder`, `canImportSessions`).
9. `sessionRecords.ts` (~190) : `readSessionGpx`, `loadFullSession`, `loadSessionGpx`, `readSessionExport`, `readSessionMotion`, `updateSessionRecord`, `removeSession`, `recordToCopy`.
10. `lifecycle.ts` (~380) : `openLibrary`, `startLibraryUi`, `canChooseMemoryFolder`, `chooseFolder`, `reconnectFolder`, `switchToBrowserMemory`, `refreshLibrary`, `currentMemoryFolder`.
`src/hooks/useSessionLibrary.ts` (~90) garde `useLibraryFields`, `useLibrarySelector`, `useLibrarySession`, `useSessionName`, `librarySession`, `findLibrarySession` et réexporte les 36 autres (`export { … } from`, `export type { … } from`) : 42 au total. Aucun appelant ne change d'import (liste relevée : `main.tsx`, `useSportSettings`, `ProfilePage`, `SettingsFiles`, `SavedSessionShare`, `useRecorder`, `ImportButtons`, `MemoryStatus`, `RefreshLibraryButton`, `useRouteLibrary`, `FollowTracePicker`, `SessionLibrary`, `useLibraryNavigation`, `SessionNameEditor`, `useSessionJumps`, `useSessionPumping`, `hooks/sessionMotion`, 8 appelants d'`updateSessionRecord` dont `SailingModule`, 10 de `useLibraryFields`, 10 de `useLibrarySession` ; le banc importe `/src/hooks/useSessionLibrary.ts` dans `donnees.mjs` et `sauts.mjs`). Sans appelant hors tests mais gardés : `LibraryStatus`, `LibraryState`, `AddStatus`, `AddResult`, `importEntries`, `queueOutdatedRefresh`, `findLibrarySession`.

**Fonctions pures sorties en premier** (dans `src/library/`, chacune avec son test) : `sessionIndex.ts` (`indexed`) ; `libraryCache.ts` (`folderId`, `storedCacheFor(raw, id)`, `nextCacheEntries(...)` avec prédicat « écriture en attente ») ; `recordText.ts` (`isBlankRecordText`, les 5 avertissements, `recordToKeep`) ; `newRecord.ts` (`newRecord`, `recordFor`, horloge et notes anciennes en paramètres, `now: () => number`) ; dans des fichiers existants : `recordMerge.ts` (`sameStamp`), `reconcile.ts` (`oddRecordExtensions`), `importReport.ts` (`describeRefresh(before, after)`), `summaryGestures.ts` (`waitingGestureActivities`), `settingsFile.ts` (`settingsFileInfo`, `sortedSettingsFiles`), `importEntry.ts` neuf (`importRecordChoice(recordText, bundle)`).

**Étapes** (après chacune : `node outils/verif.mjs --rapide` et `npx vitest run src/hooks src/library`) : 0 noter le nombre de tests ; 1 fonctions pures et tests, le monolithe les appelle ; 2 `store.ts` et `memory.ts` (chaque lecture de `folder`, `all`… devient `lib.folder`, `lib.all`, au même endroit ; les `const f = folder` restent des copies) ; 3 `summarySettings`, `recordWrites`, `cache` ; 4 `scan` et `summaryQueue`, calcul injectable, test qui injecte un faux calcul (même ordre, même pause) ; 5 `deviceSettings` ; 6 `addSession`, `pending`, `importer` ; 7 `sessionRecords`, `lifecycle`, point d'entrée réduit ; 8 test neuf `hooks/sessionLibrary/couches.test.ts` (ordre des couches sans import à rebours, exports du point d'entrée égaux à la liste des 35 valeurs) ; 9 `npm run verif`, `npx vitest run --sequence.shuffle --sequence.seed=3`.

**Risques** : (1) un seul import à rebours, `reconcileWithDisk` → `queueOutdatedRefresh`, levé par le crochet `lib.onOutdated` posé par `summaryQueue.ts` à son chargement (toujours chargé par le point d'entrée) ; (2) `all` toujours remplacé, jamais modifié en place (index en `WeakMap`) ; `diskStamps` réaffecté par `attach`, `detach`, `scan` ; `settingsEntries` vidé par `detach` via `forgetSettingsEntries()` ; (3) `vi.doMock` vise le module résolu : `record`, `createStore`, `gpxParser`, `memoryFolder`, `storage` restent simulés quel que soit le sous-fichier ; `balayage` compte les notifications et les appels à `dedupeSessions` : ni fusionner ni scinder un `setState` ; (4) pour le 126 B : un calcul asynchrone casserait l'invariant de `runJob` (l. 1486-1490, une saisie faite pendant le calcul est gardée) : `current` à relire après l'`await`, `sessionSummarySettings` rend une fonction, à résoudre avant l'envoi ; (5) doc : ETAT §6.1 (l. 220, 226, 227), §6.2 (tableau des clés, l. 263-267), INVENTAIRE l. 202.

**Banc** : `node outils/banc/passe.mjs library library3 imports miseajour donnees vignettes rename session-save sauts` : textes identiques ; relevé des fiches à 16.

## Décisions de l'orchestrateur (04/11)

Quatre questions mineures, réponses par défaut du plan retenues : crochet tardif pour l'unique import à rebours, avec le test des couches ; `scan` à part de la file ; fonctions pures dans les fichiers `library/` existants quand le sujet y est ; `SettingsFileInfo` dans `library/settingsFile.ts`, réexporté par le point d'entrée.
