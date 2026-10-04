# Carte des fichiers

Une ligne par fichier : son rôle et ses points d'entrée principaux. Les signatures se lisent dans le code, commenté en français ; l'architecture et les dépendances entre couches sont au §3 de `docs/ETAT_DU_PROJET.md`, les tests au §8.

## Amorce

- `main.tsx` : stockage natif chargé, mémoire ouverte (1,5 s au plus), puis rendu ; garde en quittant, touche retour, reprise d'un enregistrement interrompu.
- `App.tsx` : routes, toutes dans `AppShell` ; `/` (accueil), `/voile`, `/course` et `/velo` (bibliothèques), `/voile/analyse`, `/course/analyse` et `/velo/analyse` (`?session=`), `/enregistrer`, `/itineraires` (`?itineraire=`), `/itineraires/liste`, `/parametres`.
- `env.d.ts` : `__APP_VERSION__`, types de `showDirectoryPicker` et des autorisations de dossier.

## `core/` : noyau, SI, sans notion de sport

- `types.ts` : `SportType`, `RawTrackPoint`, `TrackPoint`, `TopSegment`, `BaseSessionStats`, `CumulativeTrack`.
- `units.ts` : conversions (`msToKnots`, `knotsToMs`…), `SpeedUnit`, `toDisplaySpeed`, `formatSpeed`, `formatKnots` (nœuds des analyses voile vers l'unité affichée), `DistanceUnit` (km, milles nautiques), `formatDistance`, `formatDuration`, `formatClock`.
- `sportProfiles.ts` : `SPORT_PROFILES` (seuils, hystérésis, filtres, plafond, cibles de tops, `recording`), `SAILING_SPORTS`, `CYCLING_SPORTS`, les familles (`SportFamily`, `SPORT_FAMILIES`, `sportFamily`), `getActiveThresholds`, `ELEVATION_PRESETS`.
- `gpxParser.ts` : `parseGpx`, lecteur maison par nom local (vitesse, FC, cadence, `trk/type`) ; `parseGpxPath`, le tracé d'un parcours téléchargé, sans heure (`trkpt`, à défaut `rtept`).
- `kinematics.ts` : Haversine, cap, détection de l'unité de la vitesse appareil, `computeKinematics` (vitesse retenue et lissée).
- `speedFilter.ts` : `clampByAcceleration` (écrêtage avec recherche du retour), filtres médian, linéaire et moyen en fenêtre de temps.
- `sessionSpeed.ts` : allure de la session (`referenceSpeedMs`), cadence (`samplingIntervalS`), `sessionFilterThresholds`.
- `sessionStats.ts` : `segmentDistanceM`, cumuls, masque d'activité (trigger de Schmitt), `buildBaseSessionStats`.
- `elevation.ts` : lissage de l'altitude et dénivelé à seuil, `computeElevationStats`.
- `activities.ts` : activités de l'utilisateur sur un calcul de base (`Activity`, `DEFAULT_ACTIVITIES`, `readActivities`, `sessionActivity`, `findActivity`, `newActivityId`), noms, couleurs et calcul par défaut des familles (`FAMILY_LABEL`, `FAMILY_ACCENT`, `FAMILY_BASE`), onglets d'une liste par activité (`activityCounts`).
- `topSegments.ts` : meilleurs segments en temps et en distance, sans chevauchement.
- `speedGradient.ts` : dégradé de couleur de la trace, `speedGradientColor`.
- `displayConfig.ts` : `CHART_MAX_POINTS`, `PREVIEW_MAX_POINTS` (vignettes de la bibliothèque), `CHART_ZOOM_MIN_FRACTION`, `DEFAULT_MAP_CENTER`, `trackBounds` (emprise d'une trace, où la carte se cadre).
- `chartZoom.ts` : zoom horizontal d'un graphe, calculs purs (`clampRange`, `pinchRange` pour deux doigts, `pxSelectionRange` pour une zone tirée à la souris, `visibleIndexRange`, `sampledIndices`, `niceTicks`).
- `tiles.ts` : cartes gardées, calculs purs (`tileKey`, `ancestorTile` pour l'agrandissement, `isStale`, `tilesToEvict`, `TILE_CACHE_DEFAULTS`).

## `sailing/` : voile, en nœuds sur `PointData`

- `sailingConfig.ts` : toutes les constantes de la voile, `sessionManeuverThresholds`, `suggestActiveThresholdKn`, `suggestSpeedRangeMs` (§10, point 29).
- `wind.ts` : statistiques circulaires, interpolation des directions, polaire et centre de l'angle mort, `observeTurns` (orientation), `estimateWindPolar`.
- `maneuvers.ts` : `analyzeManeuvers` (détection, classement), `measureManeuver` (métriques affichées), `estimateWind` (polaire + manœuvres), `selectWindCandidate`, `windSamplesFrom`.
- `sailingAnalytics.ts` : `calculateWindStats` (courbe et stats du vent, pondération par symétrie), `summarizeManeuvers`, `MANEUVER_METRICS`, `calculateVmgStats`.
- `sailingStats.ts` : `buildSailingSessionStats` (base + tops voile).
- `sessionNotes.ts` : forme des notes (`SailingSessionNotes`), niveaux de vent, plan d'eau, appréciation.

Hors de `sailing/`, à son service : `utils/kinematics.ts` (`PointData` et `trackToPointData`, vue en nœuds de la trace, règle 5) et `types/sailing.ts` (`SessionStats`).

## `running/`

- `runningAnalytics.ts` : pente (`computeGrades`), zones (`computeZoneStats`), `averagePace`, `DEFAULT_SPEED_RANGE_MS`, couleur de pente de la courbe d'altitude (`DEFAULT_GRADE_RANGE`, `gradeGradientColor`, `gradeGradientStops`, §10 point 57), passages d'une zone de pente pour la carte (`gradeZonePaths`). `types.ts` : `RunningSessionStats`.
- `energy.ts` : énergie de la course (§10, point 71) : coût de Minetti selon la pente, à l'économie du coureur (`minettiCost`, `runningCostJkgM`), repos (`restingPowerWkg`, aussi pour le vélo), `computeEnergy` (puissance, cumul, zones de pente), `smoothMovingPower`.

## `cycling/` : vélo, en SI (§10, point 72)

- `energy.ts` : types de vélo (`BIKE_TYPES` : roulement, traînée, poids, plafond en descente), `cyclingEnergyParams`, `resistiveForceN` (aussi pour le temps estimé), `computeCyclingEnergy`, `REFERENCE_RIDER_KG`.
- `cyclingConfig.ts` : bornes de couleur par défaut de la trace et de la pente.

## `recording/` : enregistrement, logique pure

- `session.ts` : `isNewerFix` (seul filtre), `roundFix`, compteurs de l'enregistrement, `splitIntoSegments`, `evaluateAutoPause`, `shouldFlushJournal`, `sessionFileName`, `sessionTitle`, `isSportType`.
- `journal.ts` : journal JSON par ligne, relisible même abîmé (`parseJournal`), marques de pause (`journalBreakLine`), activité dans l'en-tête et ses changements en route (`journalActivityLine`, `activityChange`).
- `gpxWriter.ts` : `buildGpx`, GPX 1.1, un `<trkseg>` par segment, vitesse seule en extension.
- `liveStats.ts` : statistiques en direct par segment (`computeLiveStats`, `LIVE_STATS_DEFAULTS`), puissance et énergie par le modèle de l'analyse (`LiveEnergySetup`).
- `liveFields.ts` : chiffres de la carte réduite, choisis par activité (`LiveFieldKey`, `liveFieldsOfFamily`, `DEFAULT_LIVE_FIELDS`, `sanitizeLiveFields`), libellés et valeurs formatés (`liveFieldLabel`, `liveFieldValue`).
- `liveLegs.ts` : bords de voile en direct, repérés par leur cap moyen (`computeLiveLegs`, `LIVE_LEG_DEFAULTS`).
- `followedTrace.ts` : trace suivie pendant l'enregistrement, tirée d'un itinéraire rangé (avec ses points en balises et ses bips propres) ou des points d'une session, avec son activité ; avancement le long de la trace (`followProgress`, `FOLLOW_DEFAULTS`), découpe faite / reste (`splitFollowedTrace`).
- `markGuide.ts` : balises d'un parcours de voile (§10, point 77) : courbe des bips (`MARK_GUIDE_DEFAULTS`, `sanitizeMarkGuide`, `beepIntervalMs`, `validationRadiusM`, `beepStartM`), avance du guidage à chaque position (`stepMarkGuide`, validation sur le segment parcouru), `skipMark`, `remainingCourseM`, balises à dessiner (`courseMarks`, `markName`).
- `heading.ts` : cap de la flèche de position (`travelHeading`, `displayHeading`) : marche en mouvement, boussole à l'arrêt.

## `library/` : mémoire en dossier, logique pure

- `activityChart.ts` : barres et totaux du graphe d'activités de l'accueil (`buildActivityChart`, semaines ISO).
- `record.ts` : la fiche (`SessionRecord` avec `activityId`, `SessionSummary`, `SessionAnalysis`, `SessionSurfaces`), `parseRecord` tolérante, `SUMMARY_CALC_VERSION`, changement d'une fiche (`applyRecordPatch`), `dedupeSessions`, `findLegacyNotes`.
- `summary.ts` : `summarizeSession`, le résumé calculé par le pipeline du module qui analysera la session.
- `sessionEdits.ts` : brouillon d'une session (`SessionEdits`), `savedEdits`, `changedParts`, `editsPatch`.
- `reconcile.ts` : `planReconcile`, rapprochement de `sessions/` et du cache des fiches.
- `settingsFile.ts` : `reglages.json`, `TRAVELLING_KEYS`, `chooseSettings` (le plus récent l'emporte), `settingsSignature` (empreinte qui date un vrai changement, sans les choix retenus).
- `naming.ts` : `uniqueSessionFileName`, `guessSport` (types d'autres applications).
- `folderLayout.ts` : noms des fichiers du dossier, marqueur, `LISEZMOI.txt`.

## `planning/` : itinéraires planifiés, logique pure (point 59)

- `route.ts` : itinéraire (points, tronçons, modes : types de voie, ligne droite, trace importée gardée telle quelle), anciens modes relus (`readRouteMode`), règles d'accès de l'activité (`routeVehicle`), opérations d'édition pures, itinéraire tiré d'une trace chargée (`routeFromTrack`), totaux, profil d'altitude rééchantillonné.
- `brouter.ts` : calcul d'un tronçon par le serveur BRouter (`fetchLeg`, seuls appels réseau du calcul), avec envoi du profil maison une fois par lancement et renvoi sur un HTTP 500 ; voies suivies tirées de ses `messages`. `brouterProfile.ts` : texte de ce profil, coûts des types de voie (`WAY_PREFERENCE_COST`, §10 point 74). `geocoding.ts` : recherche de lieux (Photon).
- `duration.ts` : temps estimé d'un itinéraire (§10, point 73) : niveaux (`LEVEL_FLAT_SPEED_MS`, `LEVEL_CLIMB_POWER_WKG`), km-effort en course, vitesse pente par pente à vélo, `estimateRouteDurationS`.
- `routeRecord.ts` : fiche JSON `tracker-itineraire`, bips propres à un parcours de voile compris (`routeMarkGuide`), voies des tronçons calculés. `routeGpx.ts` : GPX d'export, points nommés A, B… ou 1, 2… en voile (`markLabel`).
- `surface.ts` : revêtement à la Komoot (§10, point 78) : étiquettes OSM gardées (`SURFACE_TAG_KEYS`, `wayTagsText`), `classifySurface`, morceaux de voies (`SurfaceRuns`, `buildSurfaceRuns`, `readSurfaceRuns`), longueurs par catégorie d'un itinéraire (`routeSurfaces`) ou d'une session (`trackSurfaceStretches`, `summarizeSurfaces`).
- `overpass.ts` : voies d'OpenStreetMap le long d'une trace, demandées au serveur Overpass (`fetchWays`, seul appel réseau ; requêtes par paquets de `OVERPASS_MAX_COORDS`). `wayMatch.ts` : chaque point rattaché à la voie la plus proche, sans sauter du trottoir à la route (`matchTrackToWays`, `trackSurfaceRuns`, `WAY_MATCH_DEFAULTS`, `WAY_MATCH_VERSION`).
- `routeList.ts` : listes d'itinéraires enregistrés (`routeActivity`, `routesOfFamily`, `routeDistanceM`, `routeDurationS`, `ROUTE_SORTS`, `sortRoutes`).

## `platform/` : seul accès au stockage, aux fichiers, à la position, au son et au vibreur (règle 12)

- `runtime.ts` : `isNativeApp`.
- `storage.ts` : `jsonStore` (synchrone), `initStorage` (Preferences natives chargées en mémoire au démarrage).
- `files.ts` : `recordingJournal` (dossier privé), `downloadTextFile`, `readPickedFile`.
- `compass.ts` : `watchCompassHeading`, boussole par `deviceorientationabsolute` (rien sur ordinateur).
- `location.ts` : `deviceLocationSource` (plugin natif ou `watchPosition`), `createReplaySource` (rejeu accéléré), `stopOrphanedDeviceLocation`, `currentPosition` (lecture unique), `locationPermissionGranted` (autorisation déjà accordée, sans la demander).
- `memoryFolder.ts` : le dossier mémoire, OPFS ou dossier choisi dans le navigateur, dossier SAF sur le téléphone (`openMemoryFolder`, `chooseMemoryFolder`, `pickFolderToImport`, `pendingFolder`, `shouldDescendIntoMemory`).
- `backButton.ts` : touche retour d'Android (brouillon, enregistrement en cours).
- `tileCache.ts` : `tileStore`, les tuiles de carte gardées (dossier privé `tuiles/` et index en mémoire sur le téléphone, Cache API dans le navigateur).
- `beeper.ts` : bips et vibrations du guidage vers les balises (`getBeeper` : `setInterval`, `validated`, `finished`, `stop`) ; greffon natif sur le téléphone, Web Audio dans le navigateur, qui consigne chaque son (`[bips]`) pour le banc.
- Plugin Android maison `MemoryFolder` (`android/app/src/main/java/io/github/segneur/tracker/MemoryFolderPlugin.java`, déclaré dans `MainActivity`) : `pickFolder`, `hasAccess`, `list`, `readText`, `writeText`, `remove` sur `DocumentsContract`.
- Plugin Android maison `Beeper` (`BeeperPlugin.java`, même dossier, déclaré dans `MainActivity`) : rythme des bips sur un fil à lui, sons synthétisés sur le flux des alarmes, vibration d'usage alarme (§10, point 77).

## `hooks/`

- `useSessionLibrary.ts` : la bibliothèque, store hors des composants (ouverture du dossier, rapprochement, réglages qui voyagent, import, écritures différées des fiches, suppression) ; `updateSessionRecord`, `saveRecordedSession`, `importFiles`.
- `useRecorder.ts` : l'enregistreur, hors des composants (`startRecording`, `pauseRecording`, `resumeRecording`, `stopRecording`, session en attente `analyzePendingSession`/`discardPendingSession`, `recoverInterruptedRecording`, pause automatique, `togglePauseRecording` pour l'appui long, `changeRecordingActivity`).
- `useLongPress.ts` : appui long sur un élément, clic court préservé (bouton rond).
- `useLiveRecording.ts` : trace et statistiques en direct pour la page affichée, recalculées au plus toutes les 2 s.
- `useGpxSession.ts` : ingestion générique, `loadGpxContent` (entrée unique), trace dérivée des points bruts.
- `useSailingSession.ts` : orchestration de la voile ; c'est ici que les seuils s'accordent à l'allure (règle 4).
- `useSessionDraft.ts` : brouillon d'une session, écrit dans la fiche par `save`. `leaveGuard.ts` : avertissement en quittant.
- `useLibraryNavigation.ts` : passage de la liste à l'analyse (`?session=`), `useSessionFromUrl` (chargement unique, §10 point 39 ; rend aussi `requested`, la session demandée), `useChangeSessionActivity` (changement d'activité depuis une analyse, vers l'autre module s'il le faut).
- `useSportSettings.ts` : réglages par activité et liste des activités (`tracker.sportSettings`), `useSportSettings(family)` pour un module, `useAllSportSettings` pour Réglages, et hors composant `readStoredActivities`, `effectiveRecordingProfile`, `effectiveSpeedUnit`, `effectiveDistanceUnit`, `effectiveLongPressMs`, `effectiveBikeSetup`, `effectiveDurationSettings` ; `useNavFamily` et `useNavSecondFamily`, les deux sports de la barre du bas, suivis en direct, `rememberNavSecondFamily`, `effectiveNavHoldMs`.
- `usePlannedRoute.ts` : itinéraire en cours, annulation, calcul des tronçons un à un. `useRouteLibrary.ts` : itinéraires de `itineraires/`. `useFollowedTrace.ts` : trace suivie, gardée sur l'appareil jusqu'à « Retirer » (`tracker.followedTrace`, hors de `reglages.json`). `useMarkGuide.ts` : guidage vers les balises pendant un enregistrement de voile, hors des composants (`startMarkGuide`, `skipMark`, `setBeepsMuted`, `useMarkGuide`). `useCompassHeading.ts` : cap de la boussole tant qu'il est demandé. `useSessionSurfaces.ts` : revêtement d'une session (onglet « surface »), demandé une fois par trace puis rangé dans sa fiche. `useGoOnRoute.ts` : « Partir » sur un itinéraire (trace suivie, page Enregistrer).
- `useStoredRecord.ts`, `useOpenSections.ts`, `useRunnerProfile.ts` : enregistrements de l'appareil (sections ouvertes, profil du pratiquant, économie de course comprise).
- `useChartZoom.ts` : plage visible d'un graphe zoomé, ramenée dans l'étendue quand elle change, remise à zéro à l'ouverture d'une autre session.
- `useNarrowScreen.ts` : rupture téléphone (768 px), `NARROW_QUERY`.
- `useTileCache.ts` : plafond des cartes gardées (`tracker.tileCache`), contrôle du plafond après chaque tuile gardée (`noteTileSaved`), `useTileCache` pour Réglages.

## `pages/`

- `Home.tsx` : accueil (Enregistrer, graphe d'activités, Voile, Course, Vélo, les 3 derniers itinéraires et le lien vers leur liste).
- `SessionLibrary.tsx` (+ `.css`) : bibliothèque d'une famille, vues « Réalisées » et « Planifiées » (`?vue=planifiees`, ses itinéraires), import, sessions à classer, suppression, vignette carte toujours affichée à droite des chiffres (`SessionPreviewMap` : GPX relu quand la ligne approche de l'écran, `PREVIEW_MAX_POINTS` points sur canevas, figée, un toucher ouvre l'analyse ; bornes de couleur comme le module d'analyse).
- `SailingModule.tsx` : analyse voile (en-tête ; barre d'enregistrement ; carte et sa colonne d'onglets, `SAILING_PANELS` : « général » avec la synthèse et le vent en premier, réglages de la session en dernier).
- `LandModule.tsx` : analyse course et vélo, un module monté deux fois (en-tête, onglets : général avec la synthèse, tops pour le vélo, zones, surface, énergie, graphes zoomables avec altitude colorée par la pente, réglages de la session ; carte). `landModules.tsx` : ce qui diffère d'une famille à l'autre (titres, couleur, identifiants mémorisés, modèle d'énergie ramené à `EnergyView`).
- `analysisMobile.css` : disposition des modules d'analyse sous 768 px (en-tête sur une ligne au-dessus de la carte, carte pleine largeur, onglets en petites pastilles, vue plein écran au tap, colonne d'onglets de la voile bornée à l'écran, panneau Manœuvres resserré) ; classes `an-*`.
- `RecordingPage.tsx` : enregistrement (famille puis activité, celle de la trace suivie proposée), source GPS ou rejeu, pause, activité changée en route, carte (réductible, grands chiffres à sa place) et statistiques en direct.
- `PlanningPage.tsx` (+ `.css`) : planification d'un itinéraire (activité et type de voie au-dessus de la carte, carte et son « Précédent », tracé bleu, départ vert et arrivée rouge ; dessous, onglets `SectionTabs` : Général avec le temps estimé et la courbe zoomable, Surface (hors voile), Tracé avec les types de voie et le chargement d'un GPX, Points, Enregistrer et « Partir », Mes itinéraires) ; `?itineraire=<base>` ouvre un itinéraire enregistré ; sinon, la carte se centre sur soi si la position est déjà permise.
- `RoutesPage.tsx` : tous les itinéraires planifiés, tri retenu (`tracker.routeList`), onglets d'activité.
- `SettingsPage.tsx` : mémoire, activités (ajouter, renommer, recolorer, supprimer) et leurs réglages (unités, texte, seuil, couleurs de trace, couleur de pente, pause automatique, terrain, type et poids du vélo, niveau du temps estimé, carte réduite, bips), enregistrement (appui long), barre du bas (sport favori, sport secondaire, appui long qui le change), cartes hors ligne (place, plafond, vider), pratiquant ; blocs et activités repliables (`useOpenSections`) ; `settingsPage.css` : une carte par activité, un réglage par ligne.

## `components/` et thème

- `AppShell.tsx` (+ `.css`) : cadre, navigation (barre basse sous 768 px, en cinq cases avec le sport favori et le sport secondaire, dont l'appui long déplie le menu des autres sports ; barre haute au-delà), bandeau d'enregistrement, bouton rond (appui long : pause ou reprise) ; grand cadran d'appui long au milieu de l'écran (`HoldDial`), commun aux deux.
- `ActivityChart.tsx` (+ `.css`) : graphe d'activités de l'accueil, période, détail d'une barre, totaux repliables d'un geste.
- `MemoryStatus.tsx` : état de la mémoire et l'action qui convient ; repliable par `collapse` (Réglages). `PanelTitle.tsx` : titre de panneau d'analyse qui le replie. `SessionNameEditor.tsx` : nom d'une session et « Renommer », en tête de l'analyse. `LiveMap.tsx` : carte de l'enregistrement en cours, qui suit la position (flèche au cap), trace suivie en pointillé, partie faite en gris. `ActivitySelect.tsx` (+ `.css`) : choix d'une activité, liste dessinée par famille (famille à gauche, activités décalées, trait entre familles), au lieu du menu natif d'Android. `FollowTracePicker.tsx` : choix de la trace à suivre (itinéraires, sessions filtrées par activité). `SectionTabs.tsx` : rangée d'onglets. `ResizablePanel.tsx` : bloc redimensionnable, taille mémorisée par `id` (§10, point 17) ; sur téléphone, pleine largeur et sans poignée (point 56).
- `OsmTileLayer.tsx` : fond OpenStreetMap et sa mention, commun à toutes les cartes ; tuiles gardées et relues sans réseau, agrandissement d'une tuile gardée des zooms inférieurs (point 67). `gradeGradientDefs.tsx` : dégradé de pente d'une courbe d'altitude (course, itinéraire).
- `ZoomableChart.tsx` (+ `.css`) : enveloppe d'un graphe Recharts qui zoome (deux doigts, zone tirée à la souris, double-clic et « Tout voir ») ; `ChartZoomProbe` lit la zone de tracé par `usePlotArea`.
- `RouteList.tsx` (+ `.css`) : liste d'itinéraires enregistrés (activité, distance, temps estimé, date, « Partir »), commune à l'accueil, aux bibliothèques et aux pages Itinéraires.
- `SessionSaveBar.tsx` : barre « Enregistrer la session » du brouillon, commune aux modules.
- `AnalysisMap.tsx` : carte d'une page d'analyse, cadrée sur la trace, sa légende posée dessus (contrôle Leaflet à gauche de la mention OSM) et sa vue plein écran au tap (`docs/MISE_EN_PAGE.md`).
- `SpeedGradientLegend.tsx` (+ `.css`) : légende de couleur, une ligne compacte, en lecture seule. `SpeedRangeEditor.tsx` : saisie des bornes, dans l'onglet réglages des modules (§10, points 30 et 57). `SurfaceBar.tsx` : barre du revêtement et sa légende, en longueurs (Itinéraires, onglet surface des analyses). `BeepCurveEditor.tsx` : courbe des bips d'approche, points tirés au doigt, « Écouter » (Réglages par activité, Itinéraires par parcours ; §10, point 77). `MapAutoResize.tsx` : `invalidateSize` de la carte. `chartHover.ts` : survol d'un graphe vers la carte.
- `ui/` : `Button`, `Card`, `PageHeader`, `HelpButton` (« ? » qui déplie une explication : bibliothèque, Manœuvres, Vent), `ui.css`. `icons.tsx` : icônes SVG. `styles.ts` : `CARD_STYLE`.
- `theme/tokens.css` : toutes les variables de la DA. `theme/base.css` : police, fond, focus.

## Hors de `src/`

- `outils/lancer-tracker.bat` : lance le serveur de développement s'il ne tourne pas et ouvre l'application ; cible du raccourci « Tracker » du bureau, icône `outils/icone-tracker.ico` (`outils/LISEZMOI.md`).
- `assets/` : sources du logo. `logo.png`, le logo complet (écran de démarrage, `splash.png`) ; `icone.svg`, sa version simplifiée pour les petites tailles.
- `outils/logo/icones-android.mjs` : tire d'`assets/icone.svg` l'icône Android, `public/favicon.png` et `outils/icone-tracker.ico`.
- `docs/INSTALLATION.md` : fiche d'installation de l'APK, écrite pour les testeurs.
- `outils/banc/` : banc de test, des scripts Node qui pilotent un Chrome sans fenêtre ou la WebView du téléphone ; mode d'emploi dans son `LISEZMOI.md`.
- `.gitattributes` : fins de ligne (LF, CRLF pour les `.bat`).
