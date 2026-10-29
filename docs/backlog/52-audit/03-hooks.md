# 03 · Hooks

Périmètre : `src/hooks/` (49 fichiers de code, 8 978 lignes ; 8 fichiers de test, 1 155 lignes), `src/App.tsx`, `src/main.tsx`. Tous les fichiers de code lus en entier ; pour suivre les entrées des hooks, lu aussi les passages d'appel de `LandModule`, `SailingModule`, `SurfModule`, `MuscuModule`, `AppShell`, `RecordingPage`, `PlanningPage`, `RestingHrTestPage`, `SettingsPage`, et `library/record.ts` (`dedupeSessions`), `platform/storage.ts`, `platform/memoryFolder.ts`, `platform/heartRate.ts`.

Constat d'ensemble : la couche est saine sur les points qui comptent le plus (aucune couche pure n'importe `hooks/` ; règle 12 respectée ; les magasins hors React passent par `useSyncExternalStore` ; les dépendances des `useMemo` lourds de la voile sont des primitives ou des objets stables). Les défauts sont surtout de **structure** (trois « hooks » de 900 à 2 000 lignes qui sont en fait des services, beaucoup de calcul pur logé dans `hooks/`), de **copies** (ossature des modules d'analyse ×4, cache de calcul asynchrone par session ×3, suivi de la ceinture ×3, petits utilitaires ×5 à ×8), et de **rendus** (la page Enregistrer redessinée à chaque position, les pages Statistiques et Profil recalculées à chaque fiche pendant le balayage du dossier).

## Carte des hooks

« Extractible » : une part notable du fichier est du calcul pur qui irait dans `core/`, `recording/`, `running/`, `planning/` ou `library/` avec son test.

| Fichier | Lignes | Appelants (import) | Rôle | Calcul pur extractible ? | Remarque |
|---|---|---|---|---|---|
| useSessionLibrary.ts | 1973 | 26 fichiers (App, main, Home, modules, Statistiques, Profil, Réglages…) | Service mémoire : dossier, fiches, résumés, réglages par appareil, import, cache | Oui : `describeImport`, `summaryOptions`, `analyzeGpx`, `prunedMotion`, `newRecord`, `withSummary` | Service, pas un hook (1 900 lignes hors React) ; voir C1, B2 |
| useSportSettings.ts | 1593 | 45 fichiers | Réglages par activité : lecture, défauts, écriture, migration, visibilité, séances, tests | Oui, ~1 000 lignes : tous les `resolve*`, `default*`, `sanitizeGear*`, `withGearItem`, `PRESET_RESETS`, `resetStoredPresets`, `resolvePace`, `effectiveDurationSettings` | Voir C2, A5, A6 ; deux hooks à `useState` + abonnement maison |
| useRecorder.ts | 933 | 12 fichiers | Enregistreur hors React (GPS, ceinture, capteurs, journal, attente) | Partiel : `journalActivity`, `nothingToKeep`, la fin commune de `receiveFix`/`receiveHeartSample` | Course possible arrêt/pause (D2) ; rendu à chaque position (B1) |
| useSailingSession.ts | 286 | SailingModule | Chaîne voile : trace → nœuds → stats, vent, manœuvres, VMG, polaire | Non (orchestration de `sailing/`) | Bonne mémoïsation ; seuil = recalcul lourd (B3) ; retours morts (E) |
| usePlannedRoute.ts | 285 | PlanningPage | Itinéraire planifié, annulation, calcul des tronçons | Oui : `plannedRouteReducer` (déjà testé dans `hooks/`) | C4 |
| useRunnerProfile.ts | 264 | 24 fichiers | Profil du pratiquant + validations + règles du pop-up | Oui : `runnerName`, `runnerAvatar`, `runnerRootGoalMin`, `missingProfileFields`, `shouldPromptProfile`, `profilePromptGate`, `runnerHrSource`, `runnerAge`, `BOUNDS` | C3, A6 |
| useIntervalTimer.ts | 231 | 6 fichiers | Compteur du fractionné hors React | Peu (déjà dans `recording/intervalTimer.ts`) | `commandListeners` maison (A9) |
| useMarkGuide.ts | 226 | 3 fichiers | Guidage vers les balises hors React | Oui : la vue publiée (`remainingM`, `finished`) | `isCourseFinished` calculé deux fois (l. 89-92) |
| useFitnessTest.ts | 208 | 5 fichiers | Guidage du test FC max hors React | Oui : `fixSpeedMs` (l. 119-125) | Seuil en dur (C6) ; prédicat « enregistrement en cours » copié (A7) |
| useLiveRecording.ts | 199 | 3 fichiers | Statistiques du direct, rythme de recalcul | Peu | `backgroundListeners` maison (A9) |
| useRestingHrTest.ts | 174 | RestingHrTestPage | Déroulé du test FC repos | Non (déjà `recording/restingHrTest.ts`) | Suivi ceinture copié (A4) ; `errorMessage` copié (A8) |
| recordingNotification.ts | 159 | main | Notification Android de l'enregistrement | Partiel : `stateKeyNow` et la construction du contexte | Pas un hook (service) |
| useTerrainElevation.ts | 155 | LandModule | Altitude IGN, cache par trace, rangement dans la fiche | Non | Copie du motif « recherche par trace » (A2) |
| useGpxSession.ts | 140 | useSailingSession, LandModule, SurfModule | Lecture GPX → cinématique | Non | Ne rend pas `cumulative`, recalculée par chaque module (A1) |
| useLibraryNavigation.ts | 127 | 10 fichiers | Chemins, ouverture d'une session, chargement par l'URL | Oui : `libraryPath`, `analysisPath`, `sessionFamily` | Promesse sans `catch` (D1) |
| useRouteLibrary.ts | 135 | 7 fichiers | Itinéraires du dossier | Non | — |
| useZoomOnMap.ts | 122 | 4 fichiers | Tronçon de graphe montré sur la carte | Non | `show` et `closeCompanion` refaits à chaque rendu (mineur) |
| useSessionDraft.ts | 120 | 6 fichiers | Brouillon des saisies d'une session | Non | `update` lit un `edits` figé (D3) |
| useLongPress.ts | 117 | AppShell, HoldButton | Appui long | Non | Propre (minuteur nettoyé) |
| createStore.ts | 109 | 9 hooks | Abonnés, magasin, magasin à minuterie | — | En-tête inexact : `useRecorder`, `useSessionLibrary` n'utilisent que `createListeners` |
| useSessionSurfaces.ts | 107 | LandModule, landModules | Revêtement OSM, cache par trace | Non | Copie du motif (A2) |
| useSessionJumps.ts | 94 | 3 fichiers | Sauts depuis le `.imu`, rangés dans la fiche | Non | Copie du motif (A2) ; décodage `.imu` en double avec le pumping (B4) |
| useStopwatch.ts | 90 | 3 fichiers | Chronomètre libre hors React | Non | Propre |
| useTheme.ts | 90 | 11 fichiers | Thème posé sur `<html>`, réglage par appareil | Non | Troisième style de cache de lecture (A5) |
| useTileCache.ts | 81 | mapTiles, SettingsPage | Plafond du cache de tuiles | Non | `capMb` en `useState` sans abonnement (A5) |
| useSessionPumping.ts | 79 | 3 fichiers | `.imu` décodé pour le pumping, un seul en mémoire | Non | B4, D5 |
| leaveGuard.ts | 73 | 4 fichiers | Avertissement avant de quitter un brouillon | Non | Pas un hook sauf `useLeaveWarning` |
| useBeltWarmup.ts | 68 | RecordingPage | Ceinture prise avant le départ | Non | `errorText` copié (A8) |
| useVisibleStatSessions.ts | 68 | 4 fichiers | Sessions classées et visibles (Stats, Profil, fond) | Non | Recalcul complet à chaque publication de la bibliothèque (B2) |
| useStoredRecord.ts | 60 | 7 fichiers | Enregistrement par espace de noms et clé, abonné | Non | Le bon modèle, à généraliser (A5) |
| useFollowedTrace.ts | 60 | 5 fichiers | Trace suivie hors React | Non | — |
| useChartZoom.ts | 54 | 14 fichiers | Zoom d'un graphe | Non | Bonne stabilisation par primitives |
| useNarrowScreen.ts | 43 | 9 fichiers | Requêtes média | Non | `WIDE_QUERY`, `PHONE_LANDSCAPE_QUERY` exportés pour le test seulement |
| useChartHover.ts | 41 | 6 fichiers | Point survolé hors React | Non | `listeners` maison (A9) |
| useNow.ts | 38 | ProfilePage, StatisticsPage | « Maintenant », relu à minuit et au retour | Non | `visibilitychange` en direct (C7) |
| useSessionMarks.ts | 38 | 5 fichiers | Repères « Note » placés sur la trace | Non | `cumDist` factice en muscu (`MuscuModule` l. 136) |
| useAdvancedTabs.ts | 36 | 5 fichiers | Rangée « avancé » | Non | — |
| useMapHighlight.ts | 36 | 4 fichiers | Surbrillance unique de la carte | Non | Objet rendu neuf à chaque rendu (mineur) |
| useSessionHeartRate.ts | 19 | 5 fichiers | FC lissée et stats | Non | Bon (entrées stables) |
| useOpenSections.ts | 28 | 11 fichiers | Sections ouvertes mémorisées | Non | — |
| useMapBase.ts | 29 | 5 fichiers | Fond de carte par famille | Non | `readMapBase` exporté sans usage |
| useRestingHrResults.ts | 35 | RestingHrTestPage | Résultats FC repos sur l'appareil | Non | Sans abonnement (A5) |
| useBeltLive.ts | 31 | 2 fichiers | État ceinture et FC en direct | Non | Pièce à réutiliser (A4) |
| usePermissions.ts | 25 | 2 fichiers | Autorisations, relues au retour | Non | — |
| useGoOnRoute.ts | 25 | RouteList, PlanningPage | « Partir » sur un itinéraire | Non | — |
| useCompassHeading.ts | 19 | LiveMap | Boussole | Non | — |
| useSatellites.ts | 19 | RecordingPage | Satellites | Non | — |
| useFavoriteBackdrop.ts | 18 | 4 fichiers | Fond des pages hors sport | Non | — |
| useProfileRoot.ts | 18 | ProfilePage | Racine du Profil | Non | — |
| App.tsx | 142 | — | Routes, pages paresseuses, préchargement | — | Propre |
| main.tsx | 74 | — | Démarrage | — | Rendu suspendu à des mises à jour non protégées (D7) |

Tous les 69 hooks exportés (`use…`) ont au moins un appelant : aucun hook mort. Aucune couche pure (`core`, `library`, `recording`, `running`, `cycling`, `surfing`, `planning`, `sailing`, `platform`, `utils`, `theme`) n'importe `hooks/` : la stratification est respectée.

---

## A. Doublons

### A1. Ossature des modules d'analyse, recopiée quatre fois — important
- Copies :
  - `receiveSession` identique : `pages/LandModule.tsx:288-294`, `pages/SurfModule.tsx:177-185`, `pages/SailingModule.tsx:220-224`, `pages/MuscuModule.tsx:94` (lire l'activité de la fiche, `setActivity` si elle diffère, `loadGpxContent`).
  - Fichier « montré » `sessionFile !== null && gpx.fileName === sessionFile ? sessionFile : null` : 5 fois dans `LandModule.tsx` (l. 299, 304, 335, 392, 429), une fois nommé `shownFile` dans `SurfModule.tsx:187`, variante `loadedFromMemory` (avec `trackData.length > 0`) dans `SailingModule.tsx:244`, `shownFile` dans `MuscuModule.tsx:108`.
  - `const [allActivities] = useState(readStoredActivities)` : Land 318, Surf 189, Sailing 233, Muscu 180.
  - Onglets : `tabChoices = useMemo(effectiveTabChoices(activity))`, `setGeneral`, `useAdvancedTabs`, `open = maskAdvancedTabs(maskHiddenTabs(...))` : Land 324-328, Surf 205-209, Sailing 275-301, Muscu 123-127.
  - Cardio : `useRunnerProfile` + `useSessionHeartRate` + `hrZones = runnerHeartRateZones(runner, profile.heartRate, hrOffsetBpm)` : Land 268-277, Surf 211-213, Sailing 270-273, Muscu 88-119.
  - `cumulative = buildCumulativeTrack(track)` + `useSessionMarks(draft, track, cumulative.cumDist)` : Land 379-381, Surf 225-227 ; la voile la calcule dans `useSailingSession.ts:86`.
  - `useResetChartHover(sessionKey)` : Land 373, Surf 221, Sailing 367, Muscu 112.
- Identique ou différent : identique au nom de la constante d'onglets près ; seule la voile garde son brouillon sur `requestedFile` (`SailingModule.tsx:159-161`) au lieu du fichier montré (voir B8).
- Pièce unique proposée, deux hooks dans `src/hooks/useAnalysisSession.ts` :
  - `useAnalysisSession(family: SportFamily, kinematics?: Partial<GpxSessionOptions>)` → `{ settings, gpx, cumulative, file /* montré */, requested, error, draft, allActivities, changeSessionActivity, heart, hrZones, runner, retainHr, marks }` ; `useGpxSession` rendrait lui-même `cumulative` (une seule `buildCumulativeTrack` par trace, voile comprise).
  - `useAnalysisTabs<K>(storageId: string, tabs: readonly TabDef<K>[], activity: Activity, sessionKey: string | null)` → `{ open, toggle, set, closeAll, advanced, highlight }` (fait aussi `useResetChartHover`).
  - La voile garde `useSailingSession` par-dessus, branchée sur le `gpx` rendu.
- Risque : moyen. Changement neutre attendu ; à prouver par le banc (`general.mjs` avant/après, texte de la page identique) sur les quatre modules, et la question du brouillon de la voile (B8) à trancher avant.
- Taille : gros (4 modules, ~4 100 lignes touchées en surface ; un lot, deux ou trois étapes).
- Confiance : sûr (lignes lues).

### A2. « Recherche par trace, rangée dans la fiche », écrite trois fois — important
- Copies : `useSessionSurfaces.ts:24-49` (Maps `found`/`searching`, promesse unique par clé), `useTerrainElevation.ts:24-57` (même chose, clé `startMs|stepM`), `useSessionJumps.ts:19-57` (même chose, clé `file|startMs`, plus `nextFrame`).
  - `store(file, value)` identique : `useSessionSurfaces.ts:52-55`, `useTerrainElevation.ts:60-63`, en ligne dans `useSessionJumps.ts:46-50`.
  - Effet « trouvé avant que la bibliothèque connaisse la session : rangé dès qu'elle la connaît » identique : `useSessionSurfaces.ts:76-78`, `useTerrainElevation.ts:105-107`.
  - Compteur factice pour forcer un rendu : `useSessionSurfaces.ts:68` (`setFoundCount(found.size)`), `useTerrainElevation.ts:91`, `useSessionJumps.ts:69`.
  - Erreur rangée avec sa clé, `retry = () => setError(null)` : Surfaces 69-91, Terrain 93-120, Jumps 68-70 (sans `retry`).
  - Garde « fiche allégée, pas encore relue » (`session.partial`) : Surfaces 67, Terrain 90, Jumps 73.
- Différences : clé, fonction de calcul, champ de la fiche, test « à jour » (`matchVersion`, `version`+`stepM`+`startMs`, `version`+`measured`).
- Pièce unique proposée : `src/hooks/sessionAsset.ts`
  - `createSessionAssetCache<V>(compute: (key: string) => Promise<V>)` → `{ get(key), run(key): Promise<V> }` (Maps trouvées et en cours, dédoublonnage) ;
  - `useSessionAsset<V>({ file, key, stored, isCurrent, active, compute, field })` → `{ value, status: 'idle'|'running'|'ready'|'error', error, retry }`, qui range dans la fiche (`updateSessionRecord(file, { [field]: value })` si la session est inscriptible et entière), gère le report « avant que la bibliothèque la connaisse », et force le rendu par `useSyncExternalStore` sur le cache (plus de compteur factice).
- Risque : faible à moyen (trois onglets : surface, altitude, sauts) ; tests synthétiques possibles en injectant `compute`.
- Taille : petit à moyen (une session Opus).
- Confiance : sûr.

### A3. Lecture des réglages d'activité : `useState` + abonnement maison, deux fois, alors que `useStoredRecord` fait mieux
- Copies : `useSportSettings.ts:1481` + `1494-1503` et `useAllSportSettings` `useSportSettings.ts:1079` + `1082-1091` : `useState(readStoredSettings)`, `persist` qui écrit, `useEffect(() => jsonStore.subscribe(key => key === STORAGE_KEY && setStored(readStoredSettings())))`.
- Différent de `useStoredRecord.ts:43` (`useSyncExternalStore`), de `useThemeSettings` (`useTheme.ts:84-89`) et de `useMapBase.ts:24` qui font la même chose correctement.
- Défauts du motif : une écriture faite entre le premier rendu et l'effet est perdue (D4) ; chaque écriture des réglages, même d'une autre activité, remplace `stored` et refait `activity` (B6) ; `setFor`, `addActivity`… écrivent depuis un `stored` figé au dernier rendu (D3).
- Pièce unique proposée : `useSyncExternalStore(jsonStore.subscribe, readStoredSettings)` avec un `readStoredSettings` mémoïsé sur l'objet brut du magasin (le magasin rend le même objet tant que le texte ne change pas, `platform/storage.ts:75-76`) ; les écritures relisent toujours `readStoredSettings()` au moment d'écrire (comme le fait déjà `setActivity`, `useSportSettings.ts:1511`).
- Risque : faible. Taille : petit. Confiance : sûr.

### A4. Suivi de la ceinture (état + FC lisible), trois fois
- Copies :
  - `useBeltLive.ts:5-6` (`readableBpm`) et `13-31` (abonnements état + mesures) ;
  - `useRecorder.ts:554-564` dans `takeBelt` (même prédicat l. 557, même règle « FC effacée hors connexion » l. 563) ;
  - `useRestingHrTest.ts:47-48` (`bpmOf`, arrondi en plus) et `58`, `98-104` (même double abonnement).
  - Le même prédicat existe aussi dans `recording/session.ts:35` (`keepHeartRateSample`).
- Pièce unique proposée : `readableBpm(sample: HeartRateSample | null): number | null` exporté de `recording/heartRate.ts` (fonction pure, testée) ; `useRestingHrTest` lit `useBeltLive()` au lieu de son `beltInfo` ; l'enregistreur garde son état (hors React) mais appelle `readableBpm`.
- Risque : faible (l'arrondi de `useRestingHrTest` reste chez lui). Taille : petit. Confiance : sûr.

### A5. Trois façons de mettre en cache une lecture du magasin JSON
- Clé JSON.stringify : `readVisibility` `useSportSettings.ts:644-674`, `readIntervalSettings` `704-715`, `readAllFitnessTestSettings` `744-756`.
- Référence brute : `useTheme.ts:23-30` (`lastRead.raw === raw`), `useStoredRecord.ts:32-40`.
- Sans cache ni abonnement : `useRestingHrResults.ts:16` (`useState(readResults)`), `useTileCache.ts:49` (`useState(tileCapMb)`).
- Pourquoi la clé JSON : `writeStored` récrit tout `tracker.sportSettings`, donc toutes les sous-références changent à chaque écriture d'un seul champ. C'est voulu, mais trois copies.
- Pièce unique proposée : dans `hooks/createStore.ts`, `createJsonSelector<T>(key: string, select: (raw: unknown) => T, equal?: (a: T, b: T) => boolean): { read(): T; use(): T }` qui garde le dernier résultat tant que le brut est le même objet, puis compare par `equal` (défaut : texte JSON de la partie lue). `readVisibility`, `readIntervalSettings`, `readAllFitnessTestSettings`, `readSettings` du thème, `readMapBase`, `useRestingHrResults`, `useTileCache` s'y ramènent.
- Risque : faible. Taille : petit. Confiance : sûr.

### A6. Validateurs « nombre fini dans une plage », huit fois
- Copies : `useRunnerProfile.ts:125`, `135`, `191`, `216-217` ; `useSportSettings.ts:243-244`, `247-248`, `397-398`, `1150` ; `useTileCache.ts:21-22` ; `useSessionLibrary.ts:525`.
- `core/basics.ts:15` a déjà `isFiniteNumber`, utilisé par `core/sessionMarks`, `library/record`, `planning/routeRecord`, `recording/fitnessTest`, `running/restingHrResults`, jamais par les hooks.
- Pièce unique proposée : `inRange(value: unknown, min: number, max: number): value is number` dans `core/basics.ts` (avec son test), et `isFiniteNumber` pour les autres.
- Dans le même fichier, `setNumber` (`useRunnerProfile.ts:213-218`) refait `validNumber` (l. 133-136) à la main.
- Risque : nul. Taille : petit. Confiance : sûr.

### A7. Prédicats d'état de l'enregistreur recopiés
- « Enregistrement en cours » (`starting` | `recording` | `paused`) : `useFitnessTest.ts:163`, `useMarkGuide.ts:143` ; variante acceptante dans `useRecorder.ts:278-279`.
- « Pause manuelle » (`status === 'paused' && pausedReason === 'manual'`) : 8 occurrences, dont `useMarkGuide.ts:101` (avec deux `getRecorderState()`), `174`, `useFitnessTest.ts:177`, `useRecorder.ts:714`, `719`, `819`.
- Pièce unique proposée : `isRecordingSession(state)`, `isManualPause(state)`, `isAutoPause(state)` dans `recording/session.ts` (purs, sur `{ status, pausedReason }`).
- Risque : nul. Taille : petit. Confiance : sûr.

### A8. `errorMessage(err, repli)` réécrit cinq fois, en ligne une dizaine
- Définitions : `useRecorder.ts:207-208`, `useSessionLibrary.ts:204-205`, `useRestingHrTest.ts:45`, `useBeltWarmup.ts:7` (`errorText`), `components/HeartRateBeltSettings.tsx:18` (`errorText`).
- En ligne : `useIntervalTimer.ts:82`, `useSessionPumping.ts:66`, `useSessionJumps.ts:83`, `useSessionSurfaces.ts:87`, `useTerrainElevation.ts:116`, `useRouteLibrary.ts:81`, `useGpxSession.ts:125`, et `useSessionLibrary.ts:1605` qui fait `String(err)` (incohérent avec le reste).
- Pièce unique proposée : `errorMessage(err: unknown, fallback = 'erreur inconnue'): string` dans `core/basics.ts`.
- Risque : nul (textes identiques). Taille : petit. Confiance : sûr.

### A9. Ensembles d'abonnés maison alors que `createListeners` existe
- `useChartHover.ts:14-30`, `useLiveRecording.ts:93`+`184-189` (`backgroundListeners`), `useIntervalTimer.ts:55`+`216-221` (`commandListeners`), `useRecorder.ts:193-205` (`fixListeners`, avec argument).
- Différence : deux appellent leurs abonnés dans un `try/catch` (`useLiveRecording.ts:97-103`, `useRecorder.ts:293-299`), un passe un argument.
- Pièce unique proposée : `createListeners<A extends unknown[] = []>({ safe?: boolean })` dans `createStore.ts`, `notify(...args)`.
- Risque : nul. Taille : petit. Confiance : sûr.

### A10. Doublons internes de `useSportSettings.ts`
- Unité de distance résolue trois fois : `864-867` (`effectiveDistanceUnit`), `1115-1116` (`view`), `1536-1537` (`useSportSettings`) → `resolveDistanceUnit(stored, activity)`, comme `resolveSpeedUnit`.
- Poids du vélo : `892-893` et `1546-1547` → `resolveBikeKg(stored, activity)`.
- Chiffres de la notification assainis avec les mêmes cinq arguments : `794`, `1108`, `1219` → `sanitizeNotificationFields(value, activity)`.
- Les 27 cas de `setFor` (`1160-1331`) et les champs de `view` (`1093-1157`) répètent pour chaque clé « valider, ranger, comparer au défaut » : une table `SETTING_FIELDS: Record<Field, { key: PerActivityKey; valid(v, activity): boolean; normalize?(v, activity) }>` réduirait les deux de moitié.
- Risque : faible pour les trois premiers, moyen pour la table (tests de `useSportSettings.test.ts` à garder verts). Taille : petit, puis moyen. Confiance : sûr.

### A11. Résolution de l'activité d'une session, deux fois dans la bibliothèque
- `useSessionLibrary.ts:360` et `1334` : `sessionActivity(readStoredActivities(), activityId, sport) ?? baseActivity(sport)`. Et `all.find((s) => s.record.summary.startMs === startMs)` deux fois de suite (`1359`, `1363`).
- Pièce unique : `activityOfSession(sport, activityId)` locale. Taille : petit. Confiance : sûr.

### A12. Décodage du `.imu` en trois endroits
- `useSessionJumps.ts:38-41`, `useSessionPumping.ts:30-33`, `useRecorder.ts:369-370` (accéléromètre seul). Les deux premiers lisent et décodent le même fichier de la même session sans partager le résultat (voir B4).
- Pièce unique proposée : `loadSessionMotion(file): Promise<ImuRecording>` dans `useSessionPumping.ts` (renommé `sessionMotion.ts`), avec le cache à un seul fichier déjà écrit l. 22-41, utilisé aussi par `useSessionJumps`.
- Taille : petit. Confiance : sûr.

---

## B. Optimisations

### B1. Page Enregistrer redessinée à chaque position GPS (et à chaque mesure de ceinture)
- Cause : `receiveFix` fait `setState({ stats: addFixToStats(...) })` à chaque position (`useRecorder.ts:324`), `receiveHeartSample` de même (l. 348), et la ceinture met à jour `heartRate` à chaque FC changée (l. 558-560). `useRecorder()` rend l'état entier (`useRecorder.ts:905`).
- Appelants concernés : `RecordingPage.tsx:364` (`const recorder = useRecorder()`, page de 1 058 lignes avec `LiveMap`) ; `useRecordingClock` (`useRecorder.ts:917-918`) appelle `useRecorder()` : `AppShell.tsx:105` est donc redessiné à chaque position sur toutes les pages, alors qu'il n'affiche que la durée du bandeau (le contenu de la page, lui, n'est pas redessiné : l'`Outlet` garde son élément).
- Ce que la page lit vraiment : `status` (12 fois), `heartRate` (4), `pausedReason` (3), `sourceLabel`, `measuringMotion`, `error` (2), `pending`, `motionSetup`, `marks`, `activity`, et `stats` (l. 461).
- Proposition : `useRecorderSelector<T>(select: (s: RecorderState) => T): T` (comme `useLibrarySelector`, `useSessionLibrary.ts:1951`) ; isoler les chiffres qui bougent à chaque position dans un composant à part (`RecordingFigures`, comme `IntervalBanner` l'est déjà, `AppShell.tsx:67`) ; dans `AppShell`, un `RecordingBanner` à part qui seul appelle `useRecordingClock`.
- Gain attendu : à 1 Hz, une page entière redessinée par seconde en moins, écran allumé ; à 5 Hz, cinq. Mesure : React Profiler sur le banc avec un rejeu (nombre de rendus de `RecordingPage` et `AppShell` sur 60 s) avant/après. Neutralité : texte de la page identique au banc.
- Risque : moyen (page centrale, écran éteint). Taille : moyen. Confiance : sûr.

### B2. Statistiques, Profil et accueil recalculés à chaque fiche pendant le balayage du dossier
- Cause : chaque fiche créée ou recalculée publie la liste (`runJob` → `replaceSession`, `useSessionLibrary.ts:1029`, `1046` ; `replaceSession` 257-261 ; `publish` 236-239 refait `dedupeSessions`, qui trie deux fois toute la liste, `library/record.ts:723`, `736`). Chaque publication donne un nouveau `sessions`, donc `useVisibleStatSessions` refait `statSessionOf` pour toutes les sessions (`useVisibleStatSessions.ts:57-60`), et Statistiques, Profil, le graphe d'activités et le fond (`useFavoriteBackdrop`) se recalculent ; balayage de n fiches = n recalculs complets (O(n² log n) pour le tri seul).
- En plus, plusieurs pages lisent l'état entier, et sont redessinées par le compteur du balayage (toutes les 250 ms, l. 1074-1077) et par chaque message : `Home.tsx:45` (lit `status`, `error`), `ProfilePage.tsx:106`, `StatisticsPage.tsx:231` (lisent `status`, `sessions`, `scanning`), `FollowTracePicker.tsx:49`, `MemoryStatus.tsx:51`.
- Proposition : (1) pendant `runCompleteScan`, regrouper les `replaceSession` et publier au même rythme que le compteur (250 ms) puis une fois à la fin ; (2) `useLibraryFields('status', 'error')` dans `Home`, `useLibraryFields('status', 'sessions', 'scanning')` ailleurs ; (3) tenir dans `publish` une `Map` fichier → session pour `findSession` (`useSessionLibrary.ts:241`, linéaire, appelé à chaque écriture) et `useLibrarySession` (`1958-1959`, linéaire, appelé par ~7 hooks par rendu d'une analyse).
- Gain attendu : à la première ouverture d'un dossier de quelques centaines de sessions, des centaines de recalculs de Statistiques en moins. Mesure : script jetable (`console.time` autour de `runCompleteScan` sur 300 fiches synthétiques avec `useSessionLibrary.memoire.test.ts` comme base) et React Profiler sur Statistiques ouvert pendant « Mettre à jour ».
- Risque : faible à moyen (l'ordre de publication compte pour `keptInMemory`). Taille : moyen. Confiance : sûr pour le mécanisme, le gain réel à mesurer.

### B3. Seuil d'activité de la voile : tout le calcul refait à chaque cran du curseur
- `useSailingSession.ts` : `stats` (109-112), `flights` (115-118), `windEstimate` (154-167), `maneuverStats` deux passes (182-196), `windStats` (202-204), `vmgStats` (215-217) dépendent tous de `activeThresholdKn`, qui vient du brouillon (`SailingModule.tsx:1257`, `draft.update({ activeThreshold })` à chaque changement). C'est assumé (commentaire l. 150-153) et allégé par le lot 30 (142 + 2 ms pour 3 h à 5 Hz), mais un curseur tiré produit des dizaines d'événements.
- Proposition : `useDeferredValue(activeThresholdKn)` dans le hook (le curseur reste fluide, le calcul suit), ou n'écrire le brouillon qu'au relâcher. Même remarque pour l'allure imposée (`referenceSpeedOverrideMs`, qui refait `computeKinematics`, `useGpxSession.ts:74-98`).
- Gain : fluidité du curseur sur téléphone. Mesure : `console.time` autour du bloc dans un script jetable sur la trace de 3 h à 5 Hz du banc, et nombre de rendus lors d'un glissé (Profiler). Risque : faible (valeur finale identique). Taille : petit. Confiance : probable (le gain ressenti dépend du téléphone).

### B4. Le même `.imu` lu et décodé deux fois en voile
- `SailingModule.tsx:256` (`useSessionJumps`) et `:304` (`useSessionPumping`) : à la première ouverture d'une session à sauts non rangés, onglet « pumping » ouvert, `readSessionMotion` + `decodeImu` tournent deux fois (`useSessionJumps.ts:38-41`, `useSessionPumping.ts:30-33`) ; une capture décodée pèse des dizaines de Mo (commentaire `useSessionPumping.ts:11-12`).
- Proposition : A12 (un seul cache décodé partagé).
- Gain : moitié du temps et de la mémoire de ce cas. Mesure : `console.time` sur un `.imu` synthétique de 2 h (`core/imuSynthetic.fixture.ts`). Risque : faible. Taille : petit. Confiance : sûr pour le double travail, cas peu fréquent.

### B5. Tous les abonnés du magasin JSON réévalués à chaque écriture de n'importe quelle clé
- `jsonStore.subscribe` passe la clé (`platform/storage.ts:42`), mais les `useSyncExternalStore` l'ignorent : `useStoredRecord.ts:43`, `useMapBase.ts:24`, `useThemeSettings` (`useTheme.ts:85`), `useVisibility` (`useSportSettings.ts:677`), `useGearGroups` (378), `useIntervalSettings` (722, refait un `JSON.stringify` à chaque fois, 709), `useFitnessTestSettings` (763, idem 748). Chaque écriture du cache de la bibliothèque (`tracker.libraryCache`, `useSessionLibrary.ts:300`) ou d'un réglage déclenche tous ces `getSnapshot`.
- Proposition : `jsonStore.subscribeKey(key, listener)` dans `platform/storage.ts`, et l'utiliser dans A5.
- Gain : faible (lectures en cache), surtout de la propreté. Mesure : compteur d'appels de `getSnapshot` sur le banc. Risque : faible. Taille : petit. Confiance : sûr.

### B6. Une écriture de réglage, même d'une autre activité, recrée l'activité courante des modules
- `useSportSettings.ts:1481-1483` : `stored` remplacé à chaque écriture (abonnement l. 1501-1503) ; `writeStored` récrit tout l'objet, donc `stored.activities` est une nouvelle référence, `activities` et `activity` sont refaits ; dans les modules, `tabChoices` (`LandModule.tsx:324`), `receiveSession` (dépend de `activity.id`, stable), `effectiveJumpSettings(activity)` suivent. Rien de lourd ne dépend aujourd'hui de l'identité de `activity`, mais `speedRange` (référence rangée) change aussi, et avec lui la coloration de la trace.
- Proposition : avec A3, comparer `activities` par texte (comme `readVisibility`) avant de les refaire.
- Gain : faible. Taille : petit. Confiance : sûr.

### B7. Retours d'objets neufs à chaque rendu dans les hooks d'écran
- `useMapHighlight.ts:30-35` rend un objet et quatre fonctions neufs à chaque rendu ; `useZoomOnMap.ts:76-121` refait `show` et `closeCompanion` ; `useAllSportSettings` rend `hiddenFamilies: readHiddenFamilies(stored)` neuf (`useSportSettings.ts:1455`). Sans effet tant que les consommateurs ne sont pas mémoïsés ; à faire avec A1 (`useCallback`/`useMemo` aux bons endroits).
- Gain : faible. Taille : petit. Confiance : sûr.

### B8. Brouillon de la voile attaché au fichier demandé, pas au fichier montré
- `SailingModule.tsx:159-161` : `useSessionDraft(requestedFile)`, alors que les trois autres modules attendent que la trace du fichier soit chargée (`LandModule.tsx:299`, `SurfModule.tsx:187-188`, `MuscuModule.tsx:108`). Si l'adresse passe de A à B sans démonter le module, vent saisi, seuil et allure de B s'appliquent un instant à la trace de A : tout `useSailingSession` tourne pour rien. Probablement voulu (le brouillon alimente `useSailingSession` dès le premier rendu), mais à unifier avec A1.
- Gain : un calcul complet de la voile évité par changement de session. Mesure : Profiler. Risque : faible. Taille : petit. Confiance : à vérifier (le cas d'un changement d'adresse sans démontage est rare).

---

## C. Architecture

### C1. `hooks/` contient des services hors React — important
- `useSessionLibrary.ts` (1 973 lignes, dont ~1 900 hors React), `useRecorder.ts` (933, dont ~900 hors React), `recordingNotification.ts` (aucun hook), `useLiveRecording.ts`, `useMarkGuide.ts`, `useFitnessTest.ts`, `useIntervalTimer.ts`, `useStopwatch.ts`, `useFollowedTrace.ts`, `leaveGuard.ts`, `useTheme.ts` : des magasins à état de module, démarrés par `main.tsx:54-73`, avec un hook de lecture d'une ligne à la fin. `useSportSettings.ts` est importé par 45 fichiers, `useRunnerProfile.ts` par 24, surtout pour leurs fonctions hors composant (`effective*`, `read*`).
- Conséquence : on ne voit pas la frontière « état de l'application / React » ; les tests de ces services vivent dans `hooks/*.test.ts` alors que CLAUDE.md range les calculs purs ailleurs.
- Proposition : un dossier `src/stores/` (services avec état, hors React : bibliothèque, enregistreur, direct, notification, guidages, compteur, chrono, trace suivie, thème, avertissement de sortie, réglages) et `src/hooks/` réduit aux hooks React (souvent une ligne `useSyncExternalStore`). Découper `useSessionLibrary.ts` en `stores/library/{state,records,settingsSync,scan,import}.ts`. Pas de changement de comportement ; INVENTAIRE à revoir.
- Taille : gros (plusieurs lots, beaucoup d'imports). Risque : faible fonctionnellement, fort en volume. Confiance : sûr. Voir F, question 1.

### C2. ~1 000 lignes de calcul pur dans `useSportSettings.ts`
- Fonctions sans React : `defaultSpeedRangeOf`, `rangeFollowsPace`, `thresholdFollowsPace`, `defaultGradeRange`, `defaultThresholdOf`, `defaultSpeedUnitOf`, `defaultAutoPauseOf`, `defaultLiveFieldsFor`, `defaultNotificationFieldsFor`, `defaultMarkGuideOf`, `defaultHeartRateOf`, `defaultTerrainStepOf`, `resolve*` (l. 254-292, 306-309, 365-368, 410-424, 555-567, 806-836, 901-910), `sanitizeGearLabels`, `cleanGearName`, `sameGearName`, `sanitizeGearGroups`, `withGearItem` (299-362), `PRESET_RESETS`, `resetStoredPresets` (474-536), `resolvePace` (926-934), `effectiveDurationSettings` (950-966), `withoutOverrides`, `resetOverrides` (1055-1070), `moduleActivity` (1465-1472).
- Proposition : `core/activitySettings.ts` (purs, sur un `StoredSettings` passé en argument), `core/gear.ts` pour le matériel ; le fichier de hook ne garde que la lecture du magasin et les trois hooks. Déplacer `useSportSettings.test.ts` avec.
- Taille : moyen (déplacement + imports dans 45 fichiers). Risque : faible. Confiance : sûr.

### C3. Règles du Profil et du pop-up dans `useRunnerProfile.ts`
- `runnerName` (88-93), `runnerAvatar` (96-104), `runnerRootGoalMin` (122-126), `missingProfileFields` (139-146), `shouldPromptProfile` (153-158), `profilePromptGate` (165-172), `runnerAge` (181-182), `runnerHrSource` (185-195), `runnerHeartRateZones` (202-203), `BOUNDS` (106-114) : purs, testés dans `hooks/useRunnerProfile.test.ts`.
- Proposition : `running/runnerProfile.ts` (validation, âge, zones) et `library/profile.ts` (règles du pop-up, déjà là pour `favoriteFamily`).
- Taille : petit. Confiance : sûr.

### C4. Réducteur de l'itinéraire dans le hook
- `usePlannedRoute.ts:75-111` (`remember`, `settle`, `plannedRouteReducer`), exporté pour `usePlannedRoute.test.ts`.
- Proposition : `planning/plannedRouteReducer.ts`. Taille : petit. Confiance : sûr.

### C5. Morceaux purs des services d'enregistrement
- `useFitnessTest.ts:119-125` `fixSpeedMs` → `recording/fitnessTest.ts`, testé à 1 Hz et 5 Hz.
- `useMarkGuide.ts:80-97` : la vue (`remainingM`, `finished`, appel double de `isCourseFinished` l. 89 et 92) → `markGuideView(state, marks, distanceM, settings)` dans `recording/markGuide.ts`.
- `recordingNotification.ts:55-62` (`stateKeyNow`) et `89-103` (contexte) → `recording/liveNotification.ts`, qui a déjà `liveNotification` et `liveNotificationKey`.
- `useRecorder.ts:481-485` (`journalActivity`) → `recording/journal.ts` ; `430-431` (`nothingToKeep`) → `recording/session.ts` ; la fin commune de `receiveFix` (317-328) et `receiveHeartSample` (341-352) → une fonction locale `keepPoint(fix, line)`.
- `useSessionLibrary.ts:1506-1521` (`describeImport`) → `library/`.
- `useLibraryNavigation.ts:18-27` (`libraryPath`, `analysisPath`, `sessionFamily`) → `core/parentPage.ts`, qui connaît déjà les chemins.
- Taille : petit (chacun). Confiance : sûr.

### C6. Seuil de calcul en dur dans un hook (règle 3)
- `useFitnessTest.ts:69` `DERIVED_SPEED_MAX_GAP_MS = 5000` : seuil d'un calcul (vitesse tirée de deux positions), ni dans un profil ni en paramètre. À passer dans le protocole du test (`FITNESS_TESTS`) ou dans `SPORT_PROFILES['run-test']`, avec C5.
- Les autres constantes des hooks sont des rythmes d'affichage, des délais d'écriture ou des bornes de saisie (`PAGE_REFRESH_MS`, `RECORD_WRITE_DELAY_MS`, `BOUNDS`…) : hors de la règle 3.
- Taille : petit. Confiance : sûr.

### C7. Deux façons de détecter le retour au premier plan
- `platform/permissions.ts:89` `onAppResume` (événement Capacitor) dans `usePermissions.ts:16` ; `visibilitychange` en direct dans `useNow.ts:27-34`, `useSessionLibrary.ts:1267-1270` et `platform/screen.ts:55`. La règle 12 ne cite pas cet événement, mais la logique « l'application revient » mériterait une seule entrée dans `platform/` (`onAppVisible`, `onAppHidden`). `useSessionLibrary.ts:1207` fait aussi `window.location.reload()` en direct.
- Taille : petit. Confiance : sûr (choix, pas un défaut).

### C8. Asymétrie voile / terre
- La voile a son hook d'orchestration (`useSailingSession`), la course, le vélo et le surf calculent tout dans la page (`LandModule.tsx:379-760`, 1 611 lignes). Avec A1, un `useLandSession` / `useSurfSession` sur le modèle de `useSailingSession` sortirait la chaîne de calcul des pages (statistiques, pentes, énergie, zones), testable sans React.
- Taille : gros. Confiance : sûr. (Recoupe l'audit des pages.)

### C9. Petites incohérences de contrat
- `createStore.ts:3-6` annonce que `useRecorder` et `useSessionLibrary` s'appuient sur le magasin : ils n'utilisent que `createListeners`.
- `useSessionMarks.ts:5` et `components/SessionSaveBar.tsx:5` typent le brouillon par `ReturnType<typeof useSessionDraft>` : exporter `type SessionDraft`.
- `useSessionMarks` exige `cumDist` ; la muscu fabrique un tableau de zéros (`MuscuModule.tsx:136`) : paramètre optionnel.
- `useRestingHrTest` accepte `options.protocol` : passé en objet neuf à chaque rendu, il relancerait l'effet de la ceinture à chaque rendu (`useRestingHrTest.ts:76`, `91`, `115`) ; aujourd'hui l'appelant ne le passe pas (`RestingHrTestPage.tsx:75`), mais le contrat est fragile.

---

## D. Bugs probables

### D1. Analyse bloquée sur « chargement » si la lecture du GPX lève — probable
- `useLibraryNavigation.ts:99-109` : `void loadSessionGpx(requested).then(...)` sans `catch`. `loadSessionGpx` → `readSessionGpx` (`useSessionLibrary.ts:1623-1626`) → `folder.readText`, qui lève sur le téléphone si le greffon échoue (`platform/memoryFolder.ts:320`, autorisation du dossier retirée, carte mémoire retirée) et dans le navigateur si l'autorisation du dossier est perdue (`memoryFolder.ts:140-142`). Scénario : ouvrir une session après avoir retiré l'accès au dossier ; la promesse est rejetée sans être traitée, `readError` reste `null`, `loadedFor.current` vaut déjà le fichier : l'analyse reste vide sans message, et ne réessaie pas.
- Correction : `.catch((err) => { loadedFor.current = null; setReadError(errorMessage(err, 'GPX illisible.')); })`. Petit.

### D2. Arrêt pendant une pause ou une reprise en cours — à vérifier
- `stopRecording` (`useRecorder.ts:821-884`) n'est pas protégé par `exclusive`, contrairement à `pauseRecording` et `resumeRecording` (693, 712).
- Scénario 1 : pause manuelle lancée (appui long sur le bouton rond), `await stopSource?.()` / `flushJournal` / `pauseMotionCapture` en cours ; l'utilisateur termine la session (« Arrêter ») : `stopRecording` passe (statut encore `recording`), range la session et met `idle` ; puis la pause finit et pose `status: 'paused'` (l. 708) : l'enregistreur se croit occupé (`isBusy`), la touche retour reste bloquée, aucun nouvel enregistrement ne peut démarrer, jusqu'au redémarrage.
- Scénario 2 : reprise en cours (`await source.start(...)`, l. 728) et arrêt : l'arrêt ne coupe aucune source (`stopSource` est nul), puis la reprise pose une source GPS neuve et `status: 'recording'` (l. 731) après l'arrêt : service GPS orphelin, notification qui reste.
- Correction : `stopRecording` attend la commande en cours (une file au lieu du refus de `exclusive`), ou refuse tant que `commandBusy`. Petit. Essai au téléphone utile (enchaîner vite appui long et Arrêter).

### D3. Mises à jour qui s'écrasent (fermeture sur un état figé) — sûr pour le motif, pas d'appelant fautif aujourd'hui
- `useSessionDraft.ts:62-69` : `update` part de `edits` du dernier rendu ; deux `update` dans le même gestionnaire perdent le premier. `updateNotes` (71-74) idem sur `edits.notes`.
- `useAllSportSettings` : `setFor` (1160-1331), `resetActivity`, `addActivity`, `updateActivity`, `removeActivity`, `setActivityHidden`, `setFamilyHidden`, `setLongPressMs`, `setStopHoldMs`, `setBeepSound` partent tous de `stored` figé au dernier rendu ; deux appels dans un même gestionnaire, ou une écriture d'ailleurs entre le rendu et le clic (compteur du fractionné, `rememberIntervalWorkout`), sont écrasés. `setActivity` (1511) et `useStoredRecord.update` (49) relisent, eux, au moment d'écrire.
- Appels relevés : aucun double appel aujourd'hui (`SettingsPage.tsx:381-392`, modules l. 1572-1596, 1020-1297, 845-886). Correction : relire au moment d'écrire (`readStoredSettings()`, `drafts.get(file) ?? …`). Petit.

### D4. Écriture des réglages perdue entre le premier rendu et l'abonnement — à vérifier
- `useSportSettings.ts:1481` et `1501-1503` (même motif `1079`, `1089-1091`) : l'état initial est lu au rendu, l'abonnement posé dans l'effet. Une écriture entre les deux (réglages repris du dossier pendant le montage, `rememberIntervalWorkout`) n'est jamais vue tant qu'une autre écriture ne suit pas ; le module affiche alors des réglages périmés et, au prochain `persist` de `useAllSportSettings`, les remet sur l'appareil. Fenêtre courte. Correction : A3.

### D5. Capteurs ajoutés pendant que l'analyse est ouverte : onglets « sauts » et « pumping » absents — probable, gêne faible
- `hasSessionMotion` lit `knownNames`, un `Set` de module non réactif (`useSessionLibrary.ts:1671`), pendant le rendu (`useSessionJumps.ts:67`, `useSessionPumping.ts:45`). Un import qui apporte le `.imu` d'une session déjà présente l'écrit sans publier (`useSessionLibrary.ts:1383-1391`, chemin `motionAdded`) : l'analyse ouverte ne le voit qu'au rendu suivant provoqué par autre chose. Correction : publier (ou incrémenter `revision`) quand des capteurs sont ajoutés.

### D6. Repère « Note » à l'heure de l'horloge pendant un rejeu — à vérifier
- `useRecorder.ts:809` : `timeMs: Date.now()`, alors que la position jointe (`lastReceivedFix`) porte l'heure du GPS. En rejeu (banc, vitesse ×60), le repère est daté hors de la trace et `locateMarks` le place mal. Sans effet sur le téléphone en vrai (horloges proches). Correction : `fix?.timeMs ?? Date.now()` hors muscu.

### D7. Démarrage : un réglage abîmé empêcherait tout affichage — à vérifier
- `main.tsx:41-53` : le rendu est dans le même `.then` que `upgradeStoredActivities()` et `upgradeStoredPresets()` ; une exception là (fichier de réglages repris d'un autre appareil, forme inattendue) laisse l'écran blanc, sans la limite d'erreur (pas encore montée). Les deux fonctions semblent robustes (`readActivities`, `Object.keys` sur des tables), d'où « à vérifier ». Correction : `try/catch` autour des mises à jour, rendu toujours fait.

### D8. Recherche de voies ou d'altitude : résultat rangé deux fois si la trace est recalculée pendant la demande — sûr, sans gravité
- `useSessionSurfaces.ts:80-89`, `useTerrainElevation.ts:109-118` : l'effet dépend de `track` ; une trace recalculée (réglage de filtrage) pendant la demande relance l'effet, qui reçoit la même promesse et ajoute un second `.then` : deux `updateSessionRecord` et deux écritures différées. Pas d'annulation non plus (état posé après démontage, sans effet en React 19). Réglé par A2.

---

## E. Code mort (vérifié par grep sur `src/`, tests exclus sauf mention)

Champs rendus jamais lus :
- `useSportSettings` → `activityOptions` (`useSportSettings.ts:1489-1492`, rendu l. 1560) : relayé par `useSailingSession.ts:56`, `255`, jamais lu par une page ni un composant. Calcul mémoïsé inutile à chaque rendu de module.
- `useSportSettings` → `isBikeWeightOverridden` (`useSportSettings.ts:1579`) : 0 lecture.
- `useSailingSession` → `trackName` (`useSailingSession.ts:243`) : 0 lecture.

Exports sans usage hors de leur fichier (retirer le mot `export`) :
- `getHoveredIndex` (`useChartHover.ts:23`), `readMapBase` (`useMapBase.ts:17`), `tileCapMb` (`useTileCache.ts:24`), `analysisPath`, `sessionFamily` (`useLibraryNavigation.ts:22`, `26`), `findLibrarySession` (`useSessionLibrary.ts:1942`).
- `useSportSettings.ts` : `SAILING_UNITS`, `RUNNING_UNITS`, `CYCLING_UNITS`, `SURF_UNITS` (47-50), `DEFAULT_LONG_PRESS_MS`, `DEFAULT_STOP_HOLD_MS` (239, 241), `isTerrainStep` (250), `isValidLoopReturnRatio` (397), `isValidHrOffset` (403), `isKnownSpeedUnit`, `isKnownDistanceUnit` (426-430), `readVisibility` (647), `resolvePace` (926).

Exports utilisés seulement par les tests (normal, mais signe de calcul pur à déplacer, C2-C4) :
- `useSessionLibrary.ts` : `readLibraryState` (1920, seulement `useSessionLibrary.memoire.test.ts`), `importEntries` (1533 ; utilisé en interne par `importFiles` et `importFromFolder`).
- `useSportSettings.ts` : `defaultThresholdOf`, `defaultSpeedUnitOf`, `defaultAutoPauseOf`, `defaultHeartRateOf`, `sanitizeGearGroups`, `resolveGearGroups`, `readStoredSettings`, `PRESETS_VERSION`, `resetStoredPresets`, `resetOverrides`.
- `useRunnerProfile.ts` : `EMPTY_RUNNER_PROFILE`, `PROFILE_PROMPT_FIELDS`.
- `usePlannedRoute.ts` : `plannedRouteReducer`, `PlannedRouteState`, `PlannedRouteAction`.
- `useNarrowScreen.ts` : `WIDE_QUERY`, `PHONE_LANDSCAPE_QUERY` (`mediaQueries.test.ts`).

Types exportés jamais importés (sans gravité, ce sont des signatures publiques) : `Listeners`, `Store`, `TickingStore`, `GpxSessionOptions`, `GpxSessionState`, `LiveRecording`, `Snapshot`, `PlannedRouteOptions`, `RecorderStatus`, `PendingSession`, `SavedSession`, `RestingRun`, `RestingBelt`, `SailingSessionInput`, `LibraryStatus`, `LibraryState`, `AddStatus`, `AddResult`, `ImportReport`, `Visibility`, `IntervalSettings`, `ElevationSource`, `VisibleStatSessions`, `ZoomedChart`, `ZoomOnMap`, `ProfilePromptField`.

Aucun hook jamais appelé, aucun fichier mort.

---

## F. Questions à poser à l'utilisateur

1. **Ranger les « services » à part des hooks (C1) ?** Gros déplacement de fichiers, sans rien changer à l'usage, qui rend le code plus lisible pour la suite. Réponse par défaut : oui, mais en dernier, après les lots qui corrigent ou accélèrent quelque chose (D, B1, B2, A1, A2), pour ne pas mélanger un grand déménagement et des corrections.
2. **Curseur du seuil en voile (B3) : le calcul doit-il suivre le doigt, ou seulement au relâcher ?** Réponse par défaut : il suit le doigt, avec un léger retard (le curseur reste fluide, les chiffres arrivent juste après).
3. **Brouillon de la voile (B8) : attendre que la trace soit chargée, comme les autres sports ?** Réponse par défaut : oui, même règle partout.

---

## G. Chiffres

- Fichiers lus en entier : 49 fichiers de code de `src/hooks/` + `App.tsx` + `main.tsx` = 51 ; lus en partie pour les entrées et sorties : `LandModule`, `SailingModule`, `SurfModule`, `MuscuModule`, `AppShell`, `RecordingPage`, `PlanningPage`, `RestingHrTestPage`, `SettingsPage`, `library/record.ts`, `platform/storage.ts`, `platform/memoryFolder.ts`, `platform/heartRate.ts`, `platform/permissions.ts`.
- Lignes : 8 978 (hooks, hors tests) + 216 (`App.tsx`, `main.tsx`) ; tests de `hooks/` : 1 155 lignes, 8 fichiers (non audités en détail).
- Hooks : 49 fichiers de code, 69 hooks exportés (`use…`), tous appelés ; 11 fichiers sont des services hors React (C1).
- Constats : A 12 · B 8 · C 9 · D 8 · E 4 groupes (3 champs rendus morts, 22 exports inutiles, 21 exports pour tests seulement, 26 types non importés) · F 3 questions.
- Plan suggéré, par ordre : (1) petit lot de corrections D1, D2, D3, D6 + utilitaires A6, A7, A8 ; (2) B1 (page Enregistrer) ; (3) B2 (balayage et pages Statistiques/Profil) ; (4) A2 + A12 + B4 (cache par trace et `.imu`) ; (5) A3 + A5 + A10 + B5 + B6 (réglages) ; (6) A1 (+ B8, B7) ossature des modules ; (7) C2 à C6 (calcul pur sorti des hooks) ; (8) C1 (déménagement), si accepté.
