# Carte des fichiers

Une ligne par fichier : son rôle et ses points d'entrée. Les signatures se lisent dans le code, commenté en français ; l'architecture et les dépendances entre couches sont au §3 de `docs/ETAT_DU_PROJET.md`. Réduit le 24 septembre 2026 (§10, point 44) : l'ancien inventaire des signatures doublait le code et se périmait à chaque lot. Chaque fichier de calcul a son `*.test.ts` à côté de lui.

## Amorce

- `main.tsx` : stockage natif chargé, mémoire ouverte (1,5 s au plus), puis rendu ; garde en quittant, touche retour, reprise d'un enregistrement interrompu.
- `App.tsx` : routes, toutes dans `AppShell` ; `/voile` et `/course` (bibliothèques), `/voile/analyse` et `/course/analyse` (`?session=`), `/enregistrer`, `/parametres`.
- `env.d.ts` : `__APP_VERSION__`, types de `showDirectoryPicker` et des autorisations de dossier.

## `core/` : noyau, SI, sans notion de sport

- `types.ts` : `SportType`, `RawTrackPoint`, `TrackPoint`, `TopSegment`, `BaseSessionStats`, `CumulativeTrack`.
- `units.ts` : conversions (`msToKnots`, `knotsToMs`…), `SpeedUnit`, `toDisplaySpeed`, `formatSpeed`, `formatKnots` (nœuds des analyses voile vers l'unité affichée), `DistanceUnit` (km, milles nautiques), `formatDistance`, `formatDuration`, `formatClock`.
- `sportProfiles.ts` : `SPORT_PROFILES` (seuils, hystérésis, filtres, plafond, cibles de tops, `recording`), `SAILING_SPORTS`, `getActiveThresholds`, `sportFamily`, `ELEVATION_PRESETS`.
- `gpxParser.ts` : `parseGpx`, lecteur maison par nom local (vitesse, FC, cadence, `trk/type`).
- `kinematics.ts` : Haversine, cap, détection de l'unité de la vitesse appareil, `computeKinematics` (vitesse retenue et lissée).
- `speedFilter.ts` : `clampByAcceleration` (écrêtage avec recherche du retour), filtres médian, linéaire et moyen en fenêtre de temps.
- `sessionSpeed.ts` : allure de la session (`referenceSpeedMs`), cadence (`samplingIntervalS`), `sessionFilterThresholds`.
- `sessionStats.ts` : `segmentDistanceM`, cumuls, masque d'activité (trigger de Schmitt), `buildBaseSessionStats`.
- `elevation.ts` : lissage de l'altitude et dénivelé à seuil, `computeElevationStats`.
- `activities.ts` : activités de l'utilisateur sur un calcul de base (`Activity`, `DEFAULT_ACTIVITIES`, `readActivities`, `sessionActivity`, `findActivity`, `newActivityId`).
- `topSegments.ts` : meilleurs segments en temps et en distance, sans chevauchement.
- `speedGradient.ts` : dégradé de couleur de la trace, `speedGradientColor`.
- `displayConfig.ts` : `CHART_MAX_POINTS`, `DEFAULT_MAP_CENTER`, `trackBounds` (emprise d'une trace, où la carte se cadre).

## `sailing/` : voile, en nœuds sur `PointData`

- `sailingConfig.ts` : toutes les constantes de la voile, `sessionManeuverThresholds`, `suggestActiveThresholdKn`, `suggestSpeedRangeMs` (§10, point 29).
- `wind.ts` : statistiques circulaires, interpolation des directions, polaire et centre de l'angle mort, `observeTurns` (orientation), `estimateWindPolar`.
- `maneuvers.ts` : `analyzeManeuvers` (détection, classement, métriques), `estimateWind` (polaire + manœuvres), `selectWindCandidate`, `windSamplesFrom`.
- `sailingAnalytics.ts` : `calculateWindStats` (courbe et stats du vent, pondération par symétrie), `summarizeManeuvers`, `MANEUVER_METRICS`, `calculateVmgStats`.
- `sailingStats.ts` : `buildSailingSessionStats` (base + tops voile).
- `sessionNotes.ts` : forme des notes (`SailingSessionNotes`), niveaux de vent, plan d'eau, appréciation.
- `utils/kinematics.ts` : `PointData` et `trackToPointData`, vue en nœuds de la trace (règle 5). `types/sailing.ts` : `SessionStats`.

## `running/`

- `runningAnalytics.ts` : pente (`computeGrades`), zones (`computeZoneStats`), `averagePace`, `DEFAULT_SPEED_RANGE_MS`, couleur de pente de la courbe d'altitude (`DEFAULT_GRADE_RANGE`, `gradeGradientColor`, `gradeGradientStops`, §10 point 57). `types.ts` : `RunningSessionStats`.

## `recording/` : enregistrement, logique pure

- `session.ts` : `isNewerFix` (seul filtre), `roundFix`, compteurs de l'enregistrement, `splitIntoSegments`, `evaluateAutoPause`, `shouldFlushJournal`, `sessionFileName`, `sessionTitle`, `isSportType`.
- `journal.ts` : journal JSON par ligne, relisible même abîmé (`parseJournal`), marques de pause (`journalBreakLine`), activité dans l'en-tête.
- `gpxWriter.ts` : `buildGpx`, GPX 1.1, un `<trkseg>` par segment, vitesse seule en extension.
- `liveStats.ts` : statistiques en direct par segment (`computeLiveStats`, `LIVE_STATS_DEFAULTS`).

## `library/` : mémoire en dossier, logique pure

- `activityChart.ts` : barres et totaux du graphe d'activités de l'accueil (`buildActivityChart`, semaines ISO).
- `record.ts` : la fiche (`SessionRecord` avec `activityId`, `SessionSummary`, `SessionAnalysis`), `parseRecord` tolérante, `SUMMARY_CALC_VERSION`, `dedupeSessions`, `findLegacyNotes`.
- `summary.ts` : `summarizeSession`, le résumé calculé par le pipeline du module qui analysera la session.
- `sessionEdits.ts` : brouillon d'une session (`SessionEdits`), `savedEdits`, `changedParts`, `editsPatch`.
- `reconcile.ts` : `planReconcile`, rapprochement de `sessions/` et du cache des fiches.
- `settingsFile.ts` : `reglages.json`, `TRAVELLING_KEYS`, `chooseSettings` (le plus récent l'emporte).
- `naming.ts` : `uniqueSessionFileName`, `guessSport` (types d'autres applications).
- `folderLayout.ts` : noms des fichiers du dossier, marqueur, `LISEZMOI.txt`.

## `planning/` : itinéraires planifiés, logique pure (point 59)

- `route.ts` : itinéraire (points, tronçons, modes), opérations d'édition pures, totaux, profil d'altitude rééchantillonné.
- `brouter.ts` : calcul d'un tronçon par le serveur BRouter (`fetchLeg`, seul appel réseau du calcul). `geocoding.ts` : recherche de lieux (Photon).
- `routeRecord.ts` : fiche JSON `tracker-itineraire`. `routeGpx.ts` : GPX d'export.

## `platform/` : seul accès au stockage, aux fichiers et à la position (règle 12)

- `runtime.ts` : `isNativeApp`.
- `storage.ts` : `jsonStore` (synchrone), `initStorage` (Preferences natives chargées en mémoire au démarrage).
- `files.ts` : `recordingJournal` (dossier privé), `downloadTextFile`, `readPickedFile`.
- `location.ts` : `deviceLocationSource` (plugin natif ou `watchPosition`), `createReplaySource` (rejeu accéléré), `stopOrphanedDeviceLocation`, `currentPosition` (lecture unique).
- `memoryFolder.ts` : le dossier mémoire, OPFS ou dossier choisi dans le navigateur, dossier SAF sur le téléphone (`openMemoryFolder`, `chooseMemoryFolder`, `pickFolderToImport`, `pendingFolder`, `shouldDescendIntoMemory`).
- `backButton.ts` : touche retour d'Android (brouillon, enregistrement en cours).
- Plugin Android maison `MemoryFolder` (`android/app/src/main/java/io/github/segneur/tracker/MemoryFolderPlugin.java`, déclaré dans `MainActivity`) : `pickFolder`, `hasAccess`, `list`, `readText`, `writeText`, `remove` sur `DocumentsContract`.

## `hooks/`

- `useSessionLibrary.ts` : la bibliothèque, store hors des composants (ouverture du dossier, rapprochement, réglages qui voyagent, import, écritures différées des fiches, suppression) ; `updateSessionRecord`, `saveRecordedSession`, `importFiles`.
- `useRecorder.ts` : l'enregistreur, hors des composants (`startRecording`, `pauseRecording`, `resumeRecording`, `stopRecording`, session en attente `analyzePendingSession`/`discardPendingSession`, `recoverInterruptedRecording`, pause automatique, `togglePauseRecording` pour l'appui long).
- `useLongPress.ts` : appui long sur un élément, clic court préservé (bouton rond).
- `useLiveRecording.ts` : trace et statistiques en direct pour la page affichée, recalculées au plus toutes les 2 s.
- `useGpxSession.ts` : ingestion générique, `loadGpxContent` (entrée unique), trace dérivée des points bruts.
- `useSailingSession.ts` : orchestration de la voile ; c'est ici que les seuils s'accordent à l'allure (règle 4).
- `useSessionDraft.ts` : brouillon d'une session, écrit dans la fiche par `save`. `leaveGuard.ts` : avertissement en quittant.
- `useLibraryNavigation.ts` : passage de la liste à l'analyse (`?session=`), `useSessionFromUrl` (chargement unique, §10 point 39 ; rend aussi `requested`, la session demandée).
- `useSportSettings.ts` : réglages par activité et liste des activités (`tracker.sportSettings`), `useSportSettings(family)` pour un module, `useAllSportSettings` pour Réglages, et hors composant `readStoredActivities`, `effectiveRecordingProfile`, `effectiveSpeedUnit`, `effectiveDistanceUnit`, `effectiveLongPressMs`.
- `usePlannedRoute.ts` : itinéraire en cours, annulation, calcul des tronçons un à un. `useRouteLibrary.ts` : itinéraires de `itineraires/`.
- `useStoredRecord.ts`, `useOpenSections.ts`, `useRunnerProfile.ts` : enregistrements de l'appareil (sections ouvertes, profil du coureur).

## `pages/`

- `Home.tsx` : accueil (Enregistrer, graphe d'activités, Voile, Course).
- `SessionLibrary.tsx` (+ `.css`) : bibliothèque d'une famille, import, sessions à classer, suppression, aperçu carte d'une session à la demande (`SessionPreviewMap`, GPX relu, bornes de couleur comme le module d'analyse).
- `SailingModule.tsx` : analyse voile (feuille : synthèse et vent ; barre d'enregistrement ; carte et sa colonne d'onglets, `SAILING_PANELS`, réglages de la session en dernier).
- `RunningModule.tsx` : analyse course (feuille et synthèse, zones, graphes avec altitude colorée par la pente, réglages de la session, carte).
- `analysisMobile.css` : disposition des deux modules d'analyse sous 768 px (carte pleine largeur en haut, feuille des chiffres clés, vue plein écran au tap, colonne d'onglets de la voile bornée à l'écran, panneau Manœuvres resserré) ; classes `an-*`.
- `RecordingPage.tsx` : enregistrement (famille puis activité), source GPS ou rejeu, pause, carte et statistiques en direct.
- `PlanningPage.tsx` (+ `.css`) : planification d'un itinéraire (carte, blocs Tracé, Points, Ranger, Mes itinéraires).
- `SettingsPage.tsx` : mémoire, activités (ajouter, renommer, recolorer, supprimer) et leurs réglages (unités, texte, seuil, couleurs de trace, couleur de pente en course, pause automatique), enregistrement (appui long), course, coureur ; blocs et activités repliables (`useOpenSections`) ; `settingsPage.css` : une carte par activité, un réglage par ligne.

## `components/` et thème

- `AppShell.tsx` (+ `.css`) : cadre, navigation (barre basse sous 768 px, haute au-delà), bandeau d'enregistrement, bouton rond (appui long : pause ou reprise).
- `ActivityChart.tsx` (+ `.css`) : graphe d'activités de l'accueil, période, détail d'une barre, totaux.
- `MemoryStatus.tsx` : état de la mémoire et l'action qui convient ; repliable par `collapse` (Réglages). `PanelTitle.tsx` : titre de panneau d'analyse qui le replie. `SessionNameEditor.tsx` : nom d'une session et « Renommer », en tête de l'analyse. `LiveMap.tsx` : carte de l'enregistrement en cours, qui suit la position. `SectionTabs.tsx` : rangée d'onglets. `ResizablePanel.tsx` : bloc redimensionnable, taille mémorisée par `id` (§10, point 17) ; sur téléphone, pleine largeur et sans poignée (point 56). `ui/HelpButton.tsx` : « ? » qui déplie une explication (bibliothèque, Manœuvres, Vent). `hooks/useNarrowScreen.ts` : rupture téléphone (768 px), `NARROW_QUERY`.
- `OsmTileLayer.tsx` : fond OpenStreetMap et sa mention, commun à toutes les cartes. `gradeGradientDefs.tsx` : dégradé de pente d'une courbe d'altitude (course, itinéraire).
- `SessionSaveBar.tsx` : barre « Enregistrer la session » du brouillon, commune aux deux modules.
- `AnalysisMap.tsx` : carte d'une page d'analyse, cadrée sur la trace, sa légende collée dessous et sa vue plein écran au tap (`docs/MISE_EN_PAGE.md`).
- `SpeedGradientLegend.tsx` : légende de couleur, en lecture seule. `SpeedRangeEditor.tsx` : saisie des bornes, dans l'onglet réglages des deux modules (§10, points 30 et 57). `MapAutoResize.tsx` : `invalidateSize` de la carte. `chartHover.ts` : survol d'un graphe vers la carte.
- `ui/` : `Button`, `Card`, `PageHeader`, `ui.css`. `icons.tsx` : icônes SVG. `styles.ts` : `CARD_STYLE`.
- `theme/tokens.css` : toutes les variables de la DA. `theme/base.css` : police, fond, focus.

## Hors de `src/`

- `outils/lancer-tracker.bat` : lance le serveur de développement s'il ne tourne pas et ouvre l'application ; cible du raccourci « Tracker » du bureau, icône `outils/icone-tracker.ico` (`outils/LISEZMOI.md`).
- `assets/` : sources du logo. `logo.png`, le logo complet (écran de démarrage, `splash.png`) ; `icone.svg`, sa version simplifiée pour les petites tailles, dont `outils/logo/icones-android.mjs` tire l'icône Android, `public/favicon.png` et `outils/icone-tracker.ico`.
- `outils/banc/` : banc de test, des scripts Node qui pilotent un Chrome sans fenêtre ou la WebView du téléphone ; mode d'emploi dans son `LISEZMOI.md`.
- `.gitattributes` : fins de ligne (LF, CRLF pour les `.bat`).
