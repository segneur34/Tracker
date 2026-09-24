# Carte des fichiers

Une ligne par fichier : son rôle et ses points d'entrée. Les signatures se lisent dans le code, commenté en français ; l'architecture et les dépendances entre couches sont au §3 de `docs/ETAT_DU_PROJET.md`. Réduit le 24 septembre 2026 (§10, point 44) : l'ancien inventaire des signatures doublait le code et se périmait à chaque lot. Chaque fichier de calcul a son `*.test.ts` à côté de lui.

## Amorce

- `main.tsx` : stockage natif chargé, mémoire ouverte (1,5 s au plus), puis rendu ; garde en quittant, touche retour, reprise d'un enregistrement interrompu.
- `App.tsx` : routes, toutes dans `AppShell` ; `/voile` et `/course` (bibliothèques), `/voile/analyse` et `/course/analyse` (`?session=`), `/enregistrer`, `/parametres`.
- `env.d.ts` : `__APP_VERSION__`, types de `showDirectoryPicker` et des autorisations de dossier.

## `core/` : noyau, SI, sans notion de sport

- `types.ts` : `SportType`, `RawTrackPoint`, `TrackPoint`, `TopSegment`, `BaseSessionStats`, `CumulativeTrack`.
- `units.ts` : conversions (`msToKnots`, `knotsToMs`…), `SpeedUnit`, `toDisplaySpeed`, `formatSpeed`, `formatDuration`, `formatClock`.
- `sportProfiles.ts` : `SPORT_PROFILES` (seuils, hystérésis, filtres, plafond, cibles de tops, `recording`), `SAILING_SPORTS`, `getActiveThresholds`, `sportFamily`, `ELEVATION_PRESETS`.
- `gpxParser.ts` : `parseGpx`, lecteur maison par nom local (vitesse, FC, cadence, `trk/type`).
- `kinematics.ts` : Haversine, cap, détection de l'unité de la vitesse appareil, `computeKinematics` (vitesse retenue et lissée).
- `speedFilter.ts` : `clampByAcceleration` (écrêtage avec recherche du retour), filtres médian, linéaire et moyen en fenêtre de temps.
- `sessionSpeed.ts` : allure de la session (`referenceSpeedMs`), cadence (`samplingIntervalS`), `sessionFilterThresholds`.
- `sessionStats.ts` : `segmentDistanceM`, cumuls, masque d'activité (trigger de Schmitt), `buildBaseSessionStats`.
- `elevation.ts` : lissage de l'altitude et dénivelé à seuil, `computeElevationStats`.
- `topSegments.ts` : meilleurs segments en temps et en distance, sans chevauchement.
- `speedGradient.ts` : dégradé de couleur de la trace, `speedGradientColor`.
- `displayConfig.ts` : `CHART_MAX_POINTS`, `DEFAULT_MAP_CENTER`.

## `sailing/` : voile, en nœuds sur `PointData`

- `sailingConfig.ts` : toutes les constantes de la voile, `sessionManeuverThresholds`, `suggestActiveThresholdKn`, `suggestSpeedRangeMs` (§10, point 29).
- `wind.ts` : statistiques circulaires, interpolation des directions, polaire et centre de l'angle mort, `observeTurns` (orientation), `estimateWindPolar`.
- `maneuvers.ts` : `analyzeManeuvers` (détection, classement, métriques), `estimateWind` (polaire + manœuvres), `selectWindCandidate`, `windSamplesFrom`.
- `sailingAnalytics.ts` : `calculateWindStats` (courbe et stats du vent, pondération par symétrie), `summarizeManeuvers`, `MANEUVER_METRICS`, `calculateVmgStats`.
- `sailingStats.ts` : `buildSailingSessionStats` (base + tops voile).
- `sessionNotes.ts` : forme des notes (`SailingSessionNotes`), niveaux de vent, plan d'eau, appréciation.
- `utils/kinematics.ts` : `PointData` et `trackToPointData`, vue en nœuds de la trace (règle 5). `types/sailing.ts` : `SessionStats`.

## `running/`

- `runningAnalytics.ts` : pente (`computeGrades`), zones (`computeZoneStats`), `averagePace`, `DEFAULT_SPEED_RANGE_MS`. `types.ts` : `RunningSessionStats`.

## `recording/` : enregistrement, logique pure

- `session.ts` : `isNewerFix` (seul filtre), `roundFix`, statistiques en direct, `shouldFlushJournal`, `sessionFileName`, `sessionTitle`, `isSportType`.
- `journal.ts` : journal JSON par ligne, relisible même abîmé (`parseJournal`).
- `gpxWriter.ts` : `buildGpx`, GPX 1.1 avec vitesse, cap et précision en extension.

## `library/` : mémoire en dossier, logique pure

- `record.ts` : la fiche (`SessionRecord`, `SessionSummary`, `SessionAnalysis`), `parseRecord` tolérante, `SUMMARY_CALC_VERSION`, `dedupeSessions`, `findLegacyNotes`.
- `summary.ts` : `summarizeSession`, le résumé calculé par le pipeline du module qui analysera la session.
- `sessionEdits.ts` : brouillon d'une session (`SessionEdits`), `savedEdits`, `changedParts`, `editsPatch`.
- `reconcile.ts` : `planReconcile`, rapprochement de `sessions/` et du cache des fiches.
- `settingsFile.ts` : `reglages.json`, `TRAVELLING_KEYS`, `chooseSettings` (le plus récent l'emporte).
- `naming.ts` : `uniqueSessionFileName`, `guessSport` (types d'autres applications).
- `folderLayout.ts` : noms des fichiers du dossier, marqueur, `LISEZMOI.txt`.

## `platform/` : seul accès au stockage, aux fichiers et à la position (règle 12)

- `runtime.ts` : `isNativeApp`.
- `storage.ts` : `jsonStore` (synchrone), `initStorage` (Preferences natives chargées en mémoire au démarrage).
- `files.ts` : `recordingJournal` (dossier privé), `downloadTextFile`, `readPickedFile`.
- `location.ts` : `deviceLocationSource` (plugin natif ou `watchPosition`), `createReplaySource` (rejeu accéléré), `stopOrphanedDeviceLocation`.
- `memoryFolder.ts` : le dossier mémoire, OPFS ou dossier choisi dans le navigateur, dossier SAF sur le téléphone (`openMemoryFolder`, `chooseMemoryFolder`, `pickFolderToImport`, `pendingFolder`, `shouldDescendIntoMemory`).
- `backButton.ts` : touche retour d'Android (brouillon, enregistrement en cours).
- Plugin Android maison `MemoryFolder` (`android/app/src/main/java/io/github/segneur/tracker/MemoryFolderPlugin.java`, déclaré dans `MainActivity`) : `pickFolder`, `hasAccess`, `list`, `readText`, `writeText`, `remove` sur `DocumentsContract`.

## `hooks/`

- `useSessionLibrary.ts` : la bibliothèque, store hors des composants (ouverture du dossier, rapprochement, réglages qui voyagent, import, écritures différées des fiches, suppression) ; `updateSessionRecord`, `saveRecordedSession`, `importFiles`.
- `useRecorder.ts` : l'enregistreur, hors des composants (`startRecording`, `stopRecording`, `recoverInterruptedRecording`).
- `useGpxSession.ts` : ingestion générique, `loadGpxContent` (entrée unique), trace dérivée des points bruts.
- `useSailingSession.ts` : orchestration de la voile ; c'est ici que les seuils s'accordent à l'allure (règle 4).
- `useSessionDraft.ts` : brouillon d'une session, écrit dans la fiche par `save`. `leaveGuard.ts` : avertissement en quittant.
- `useLibraryNavigation.ts` : passage de la liste à l'analyse (`?session=`), `useSessionFromUrl` (chargement unique, §10 point 39), `useImportAndOpen`.
- `useSportSettings.ts` : réglages par support (`tracker.sportSettings`), `useAllSportSettings` pour Réglages, `readStoredSettings`.
- `useStoredRecord.ts`, `useOpenSections.ts`, `useRunnerProfile.ts` : enregistrements de l'appareil (sections ouvertes, profil du coureur).

## `pages/`

- `Home.tsx` : accueil d'attente (Enregistrer, Voile, Course), tableau de bord au lot 4.
- `SessionLibrary.tsx` (+ `.css`) : bibliothèque d'une famille, import, sessions à classer, suppression, aperçu carte d'une session à la demande (`SessionPreviewMap`, GPX relu, bornes de couleur comme le module d'analyse).
- `SailingModule.tsx` (+ `.css`) : analyse voile (en-tête, barre d'enregistrement, onglets du haut, carte et sa colonne d'onglets) ; sous 768 px, carte pleine largeur en haut et vue plein écran au tap (`SailingModule.css`).
- `RunningModule.tsx` : analyse course (synthèse, zones, graphes, carte).
- `RecordingPage.tsx` : enregistrement, source GPS ou rejeu.
- `SettingsPage.tsx` : mémoire, réglages par support, course, coureur.

## `components/` et thème

- `AppShell.tsx` (+ `.css`) : cadre, navigation (barre basse sous 768 px, haute au-delà), bandeau d'enregistrement.
- `MemoryStatus.tsx` : état de la mémoire et l'action qui convient. `SectionTabs.tsx` : rangée d'onglets. `ResizablePanel.tsx` : bloc redimensionnable, taille mémorisée par `id` (§10, point 17).
- `SpeedGradientLegend.tsx` : légende et bornes de couleur (§10, point 30). `MapAutoResize.tsx` : `invalidateSize` de la carte. `chartHover.ts` : survol d'un graphe vers la carte.
- `ui/` : `Button`, `Card`, `PageHeader`, `ui.css`. `icons.tsx` : icônes SVG. `styles.ts` : `CARD_STYLE`.
- `theme/tokens.css` : toutes les variables de la DA. `theme/base.css` : police, fond, focus.

## Hors de `src/`

- `outils/banc/` : banc de test, des scripts Node qui pilotent un Chrome sans fenêtre ou la WebView du téléphone ; mode d'emploi dans son `LISEZMOI.md`.
- `.gitattributes` : fins de ligne (LF, CRLF pour les `.bat`).
