# Inventaire des exports

Sorti de `docs/ETAT_DU_PROJET.md` (ancien §5) le 23 septembre 2026, pour que l'état tienne en une lecture. Signatures lues dans le code ; les fonctions internes non exportées sont omises sauf mention. Les renvois « §10, point N » mènent à `docs/HISTORIQUE.md`, les autres « §N » à `docs/ETAT_DU_PROJET.md`.

## 1. `src/core/`

**types.ts**
- `SportType = 'wingfoil' | 'windsurf' | 'kite' | 'bateau' | 'running'`
- `RawTrackPoint { lat; lon; time: string | Date; ele?; speedMs?; hr?; cadence? }`
- `SpeedSource = 'doppler' | 'derived'`
- `TrackPoint { lat; lon; time; timeMs; ele?; hr?; cadence?; speedMs; smoothedSpeedMs; bearing; speedSource }`
- `TopSegment { val: string; path: [number, number][] }`, `TopTarget { key; label; value; kind: 'time' | 'distance' }`
- `BaseSessionStats { distance; activeDistance; totalTime; activeTime; activeRatio; speedSource; elevationGain; elevationLoss; elevationMin; elevationMax; hasElevation }` (chaînes formatées sauf `speedSource` et `hasElevation`)
- `CumulativeTrack { cumDist: number[]; cumTime: number[] }`

**units.ts**
- `MS_TO_KNOTS = 1.94384`, `MS_TO_KMH = 3.6`, `SpeedUnit = 'kn' | 'kmh' | 'ms' | 'minkm'`, `SPEED_UNIT_LABEL`
- `msToKnots`, `knotsToMs`, `msToKmh`, `kmhToMs`, `msToPacePerKm(ms, minSpeedMs = 0.1): number | null`, `formatPace(ms): string` (`m:ss` ou `-`)
- `toDisplaySpeed(ms, unit)`, `fromDisplaySpeed(value, unit)`, `isInverseUnit(unit)` (vrai pour min/km)
- `formatSpeed(ms | null, unit): string` avec symbole ; `formatSpeedValue(value, unit): string` pour les axes ; `formatDuration(ms): string` (`1h24` ou `37 min`) ; `formatClock(ms): string` (`h:mm:ss`, chrono de l'enregistrement)

**sportProfiles.ts**
- `ElevationProfile { smoothingSeconds; minGainM }`, `ELEVATION_PRESETS = { route: {20, 3}, trail: {30, 5} }`
- `SportProfile { id; label; speedUnit; thresholdUnit; defaultActiveThreshold; activeHysteresis { enterOffset; exitOffset }; minStateDurationS; medianWindowSeconds; maxPlausibleSpeedMs; defaultPolarMinSpeed; activeRatioLabel; elevation; topTargets; recording }`
- `RecordingProfile { intervalMs; distanceFilterM; journalFlushS }`, `DEFAULT_RECORDING = { 1000, 0, 10 }`, commun à tous les supports (§12)
- `SAILING_TOP_TARGETS` (7 cibles), `SPORT_PROFILES` (voir tableau §7), `SAILING_SPORTS`, `getSportProfile`, `getActiveThresholds(profile, threshold) → { enter; exit }` dans l'unité du profil

**displayConfig.ts**
- `CHART_MAX_POINTS = 500` (points maximum par graphe), `DEFAULT_MAP_CENTER: [number, number]` (Montpellier, avant chargement d'une trace)

**speedGradient.ts**
- `SpeedRangeMs { minMs; maxMs }`, `SLOW_COLOR` (gris sous la borne basse), `gradientColor(t)` (position 0 à 1), `speedGradientColor(speedMs, minMs, maxMs)`, `gradientCss()` pour la légende

**sessionSpeed.ts**
- `referenceSpeedMs(points): number` : allure de la session en m/s, neuvième décile pondéré par la durée (échantillon plafonné à 10 s), sur les vitesses brutes, avant tout filtrage — puisque c'est le filtrage qui en dépend
- `samplingIntervalS(points): number` : intervalle **médian** entre deux points, la cadence d'enregistrement ; la médiane, pour qu'une coupure ne la déplace pas
- `sessionFilterThresholds(referenceMs, supportMaxSpeedMs) → { maxAcceleration; maxSpeedMs }` : seuils de filtrage accordés à l'allure, bornés par le support

**speedFilter.ts**
- `DEFAULT_MAX_ACCELERATION = 10`, `DEFAULT_MAX_OUTLIER_S = 3`, `DEFAULT_MEDIAN_WINDOW_S = 3`, `ClampOptions`
- `median(values)`, `clampByAcceleration(speedsMs, timesMs, maxAccelOrOptions?, maxOutlierSeconds?)`, `medianFilterByTime(values, timesMs, windowSeconds?)`, `linearSmoothByTime(values, timesMs, windowSeconds)`, `meanFilterByTime(values, timesMs, windowSeconds)`

**kinematics.ts**
- `EARTH_RADIUS_M`, `toRad`, `toDeg`, `haversineDistance(lat1, lon1, lat2, lon2)`, `initialBearing(...)`, `pointTimeMs(time)`
- `DeviceSpeedUnit = 'ms' | 'kmh' | 'kn'`, `DEVICE_SPEED_FACTOR`, `detectDeviceSpeedUnit(deviceSpeeds, derivedSpeeds)`, `detectTrackDeviceSpeedUnit(points): DeviceSpeedUnit | null`
- `KinematicsOptions { medianWindowSeconds?; maxAcceleration?; maxSpeedMs?; forceDerivedSpeed? }`, `computeKinematics(points, options?): TrackPoint[]`

**gpxParser.ts**
- `ParsedGpx { rawPoints; trackName?; hasDeviceSpeed }`, `parseGpx(gpxContent): ParsedGpx` (lève une erreur si le XML est mal formé)

**elevation.ts**
- `ElevationStats { gainM; lossM; minEleM; maxEleM; smoothed: number[]; coverage }`, `EMPTY_ELEVATION`
- `smoothElevation(track, smoothingSeconds)`, `accumulateElevation(altitudes, minGainM)`, `computeElevationStats(track, profile)`

**sessionStats.ts**
- `segmentDistanceM(track, i)`, `buildCumulativeTrack(track)`, `computeTotalTimeMs(track)`
- `ActivityMaskOptions { enterThresholdMs; exitThresholdMs; minStateDurationS? }`, `computeActivityMask(track, options): boolean[]`, `computeActiveTimeMs(track, mask)`, `computeActiveDistanceM(track, mask)`
- `BaseSessionStatsOptions extends ActivityMaskOptions { cumulative?; activityMask?; elevation?; elevationStats? }`, `buildBaseSessionStats(track, options): BaseSessionStats`

**topSegments.ts**
- `DEFAULT_TOP_COUNT = 3`, `TopSegmentOptions { count?; decimals? }`, `computeTopSegments(track, cum, target, toDisplaySpeed, options?)`, `computeAllTopSegments(track, cum, targets, toDisplaySpeed, options?): Record<string, TopSegment[]>`

## 2. `src/sailing/`

**sailingConfig.ts** : `SAILING_TOP_TARGETS` (ré-export), `DEFAULT_SAILING_SPORT = 'wingfoil'`, `getDefaultThresholdKn(sport?)`, `DEFAULT_SAILING_SPEED_RANGE_MS` (8 et 28 nœuds en m/s), `MANEUVER_MIN_TURN_DEG = 60`, `MANEUVER_WINDOW_S = 12`, `MANEUVER_MAX_STEP_S = 30`, `MANEUVER_COOLDOWN_S = 10`, `MANEUVER_MIN_ENTRY_SPEED_KN = 4`, `MANEUVER_MIN_DISTANCE_M = 10`, `MANEUVER_ENTRY_SPEED_RATIO = 0.16`, `POLAR_MIN_SPEED_RATIO = 0.2`, `sessionManeuverThresholds(sport, referenceSpeedKn) → { minEntrySpeedKn; polarMinSpeedKn }` (toujours le minimum entre le profil et la mise à l'échelle : celle-ci ne peut qu'abaisser un seuil), `VMG_WINDOW_S = 10`, `WIND_ESTIMATION_MIN_SPEED_KN = 5`, `ORIENTATION_MAX_CONSERVATION = 0.5`, `WIND_CONFIDENCE_MIN = 0.4`, `FAST_SESSION_REFERENCE_KN = 12`, `SLOW_SESSION_ACTIVE_THRESHOLD_KN = 1`, `SPEED_RANGE_MAX_MARGIN_KN = 1`, `suggestActiveThresholdKn(sport, referenceSpeedKn) → number`, `suggestSpeedRangeMs(sport, referenceSpeedKn, track, cum) → SpeedRangeMs` (règles dans les décisions de `CLAUDE.md` ; le pic sur 2 s réutilise `computeTopSegments` avec `count: 1`) (§10, point 29).

**wind.ts**
- `angleDiff(a, b)` dans [−180, 180[, `normalizeAngle(a)` dans [0, 360[
- `CircularStats`, `circularMean(angles, weights?) → { mean; R }`, `circularStats(angles, weights?)`
- `TimedDirection { timeMs; direction }`, `interpolateDirection(samples, timeMs, reference, maxGapMs): number | null` (valeur la plus proche aux bords dans la limite de `maxGapMs`, `null` au-delà ou dans un trou trop large), `buildWindTimeline(samples, fallback, maxGapMs): (timeMs) => number`
- `NO_GO_HALF_ANGLE = 35`, `UPWIND_SECTOR = [40, 85]`, `CANDIDATE_MIN_SEPARATION = 45`, `buildMaxSpeedsByBearing(points, minSpeedKn)`, `PolarScore`, `scoreWindCandidate(maxSpeeds, w)`, `PolarWindEstimate { direction; symmetry; coverage; clarity; contrast; best; opposite }`, `polarWindCandidates(points, minSpeedKn?, count = 3)`, `estimateWindFromPolar(points, minSpeedKn?)`, `describeWindCandidate(points, direction, minSpeedKn?)` (descripteur d'une direction imposée, nécessaire au jumeau au vent arrière, qui n'est pas un maximum du score)
- `TURN_MIN_COHERENCE = 0.6`, `TurnObservation`, `observeTurns(points, minEntrySpeedKn?)`, `OrientationVote`, `orientationVotes(turns, axis)`. Le vol perdu s'y juge aussi sur la part de vitesse conservée (`ORIENTATION_MAX_CONSERVATION`, dans `sailingConfig`), et la fenêtre s'étire sur un pas unique comme celle de `analyzeManeuvers`
- `WindOrientationSource = 'polaire' | 'virages' | 'référence'`, `WindEstimate { direction; confidence; reliable; orientedBy; maneuverCount }`, `WindEstimateOptions { minSpeedKn?; referenceDirection? }`, `estimateWindPolar(points, options?)`

**maneuvers.ts**
- ré-exporte `angleDiff`, `WindEstimate`
- `ManeuverOptions { successThresholdKn?; minEntrySpeedKn?; windowSeconds?; cooldownSeconds?; maxStepSeconds?; minDistanceM? }`
- `ManeuverRejections { slowEntry; incoherent; unclassified; tooShort }` : virages écartés par motif, pour que « aucune manœuvre » dise pourquoi
- `ManeuverLocation { lat; lon; type: 'tack' | 'jibe'; success; vmin; localWind; timeMs; trackIndex; stableHeadings; entrySpeed; conservation; relaunchS: number | null; headingChange; distanceM; entryIndex; exitIndex; entryHeading; exitHeading; path }`
- `ManeuverStats { tackSuccess; tackFail; jibeSuccess; jibeFail; rejected; tackVmins; jibeVmins; locations }`
- `WindReference = number | ((timeMs) => number)`, `WIND_LOCAL_MAX_GAP_MIN = 30`
- `windSamplesFrom(stats)` : manœuvres à caps stabilisés, virements et empannages réussis. Depuis le point 24 du §10, ce filtre ne sert plus qu'à l'estimation globale et à la timeline de reclassement de `useSailingSession` ; la courbe de l'onglet vent prend toutes les manœuvres.
- `maneuverAgreement(stats) → { agreement; count; consistent; inconsistent }`
- `WindEstimationOptions { minSpeedKn?; successThresholdKn?; minEntrySpeedKn? }`, `CandidateSelection { direction; orientedBy; polarConfidence; agreementScore }`, `selectWindCandidate(points, polar, options?): CandidateSelection`
- `estimateWind(points, options?: WindEstimationOptions): WindEstimate`, `analyzeManeuvers(points, wind, options?): ManeuverStats`

**sailingAnalytics.ts**
- `VmgStats`, `WindGraphPoint { index; timeLabel; angle: number | null; display: number | null; isManeuver }`, `WindStats { avgWind; minWind; maxWind; range; stdDev; slopePerHour; count; stableShare; graphData; windAt }`, `WindSource`
- `calculateWindStats(trackData, maneuverStats, referenceWind?): WindStats | null`
- `ManeuverMetric = 'conservation' | 'relaunch' | 'headingChange' | 'distance'`, `MANEUVER_METRICS` (clé, libellé, aide), `ManeuverTop`, `ManeuverTypeSummary`, `ManeuverSummary`, `formatMetric(metric, value)`, `summarizeManeuvers(stats): ManeuverSummary`
- `calculateVmgStats(trackData, wind, minSpeedKn?, windowSeconds?): VmgStats | null`

**sailingStats.ts** : `SailingStatsOptions { sport?; activeThresholdKn? }`, `buildSailingSessionStats(track, options?): SessionStats | null`.

**sessionNotes.ts** : `WindLevel`, `WaterState`, `Rating = 1..5`, `SailingSessionNotes { foil; mast; wing; windLevel; waterState; rating; comment }`, `EMPTY_NOTES`, `WIND_LEVELS` (très faible à très fort), `WATER_STATES` (plat, clapot, vagues), `RATINGS` (nul à très bien, avec emoji).

## 3. `src/running/`

**runningAnalytics.ts** : `GRADE_HALF_WINDOW_M = 25`, `FLAT_MAX_GRADE = 0.03`, `STEEP_MIN_GRADE = 0.1`, `GradeZoneKey`, `GradeZone { key; label; range }`, `GRADE_ZONES`, `classifyGrade(grade)`, `computeGrades(smoothedEle, cum, halfWindowM?)`, `ZoneStats { zone; distanceM; timeMs; avgSpeedMs; distanceShare; distance; time; pace; speedKmh }`, `computeZoneStats(track, grades, activityMask)`, `averagePace(distanceM, timeMs) → { pace; speedKmh; speedMs }`, `DEFAULT_SPEED_RANGE_MS = { minMs: 4/3.6, maxMs: 15/3.6 }`.

**types.ts** : `RunningSessionStats = BaseSessionStats`.

## 4. `src/hooks/`

- `useStoredRecord<T>(namespace, key | null, defaults) → { value; update(patch); loaded; readLatest() }` : enregistrement persistant générique, par `jsonStore` (`platform/storage.ts`), un espace de noms par clé de stockage, un enregistrement par sous-clé.
- `useGpxSession(options?) → { fileName; trackName; rawPoints; hasDeviceSpeed; error; track; referenceSpeedMs; samplingS; sessionKey; deviceSpeedUnit; hasTrack; handleFileUpload; loadGpxContent; reset }`. Seuls les points bruts sont en état, la trace est dérivée par `useMemo`. `GpxSessionOptions` étend `KinematicsOptions` de `scaleFiltersToSession` (faux par défaut, donc sans effet en course) et `referenceSpeedOverrideMs`. `sessionKey` (nom de trace et instant du premier point) rattache les notes et sert de clé de remontage à la carte (§10, point 28). `loadGpxContent(texte, nom)` est aussi l'entrée d'une session enregistrée (`useIncomingSession`).
- `useSportSettings.ts` exporte aussi `TEXT_SCALE_FACTOR`, `TEXT_SCALE_LABEL`, `TERRAIN_LABEL`, `SAILING_UNITS = ['kn', 'kmh', 'ms']`, `RUNNING_UNITS = ['kmh', 'ms', 'minkm']`.
- `useSportSettings(defaultSport, allowedSports = [defaultSport]) → { sport; setSport; profile; activeThreshold; setActiveThreshold; resetActiveThreshold; isThresholdOverridden; terrain; setTerrain; elevationProfile; speedUnit; setSpeedUnit; textScale; setTextScale; speedRange; setSpeedRange; referenceSpeed; setReferenceSpeed }`. Le support mémorisé n'est repris que s'il est dans `allowedSports`. `referenceSpeed` est l'allure imposée en m/s, `null` quand elle est déduite de la trace.
- `useAllSportSettings() → { view(sport): SportSettingsView; setFor(sport, champ, valeur | null) }` pour la page Paramètres.
- `useSailingSession()` : rend la trace en nœuds (`trackData`), les statistiques, le vent (estimé, saisi, retenu : `windEstimate`, `manualWind`, `currentWindValue`), manœuvres et leur résumé, VMG, vent local (`windStats`), données de graphes, cadence et nombre de points, et les réglages du support avec leurs suggestions (`suggestedActiveThresholdKn`, `suggestedSpeedRangeMs`, `maneuverThresholds`, allure). C'est ici, et non dans les fonctions de calcul, que les seuils sont accordés à l'allure de la session : les fonctions gardent leurs valeurs par défaut, et les tests qui les appellent sans options restent donc neutres. `activeThresholdKn` est la surcharge de l'utilisateur si elle existe (`isThresholdOverridden`), sinon `suggestedActiveThresholdKn` ; de même `speedRange` (surcharge ou `null`) prime sur `suggestedSpeedRangeMs` dans les pages (§10, point 29). `manualWind` se réinitialise à `''` quand `gpx.sessionKey` change (nouvelle trace), pas à chaque recalcul du vent sur la trace courante : une saisie manuelle ne vaut que pour la trace où elle a été faite (§10, point 31).
- `useSessionNotes(sessionKey | null) → { notes; setNotes(patch); isSaved }`. Préremplit foil, mât et aile depuis la dernière session notée.
- `useRunnerProfile() → { profile; setNumber(field, value | null); setSex; setWeightKg; age }`. Champs : `weightKg`, `heightCm`, `birthYear`, `sex`, `hrMax`, `hrRest`, bornes de validation dans `BOUNDS`.
- `useOpenSections<K>(moduleId, defaults) → { open; toggle(key) }`. Utilisé par les deux modules (`running`, `sailing`).
- `useRecorder.ts` : l'enregistreur vit **hors des composants**, dans le module, pour survivre aux changements de page. `RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping'`, `SavedSession { fileName; location; content; sport; pointCount; recovered }`, `RecorderState { status; sport; sourceLabel; stats; saved; error }`. Commandes : `startRecording(sport, source)`, `stopRecording()`, `recoverInterruptedRecording()` (appelée par `main.tsx` au démarrage et avant chaque départ : un journal orphelin devient un GPX), `dismissRecorderResult()`, `isRecordingActive()` (pour la touche retour) ; lecture par `useRecorder()` (`useSyncExternalStore`). Chaîne : position arrondie (`roundFix`) et ignorée si elle n'est pas plus récente (`isNewerFix`), gardée en mémoire, ajoutée au journal par paquets ; à l'arrêt, GPX écrit depuis la mémoire, puis journal effacé. Si l'écriture du GPX échoue, le journal reste et sera repris.
- `useIncomingSession.ts` : `IncomingSession { content; fileName; sport }`, `analysisPath(sport)` (`/voile` ou `/course`), `useOpenSession()` (navigue avec la session dans l'état de navigation), `useIncomingSession(onReceive)` côté module : appelée une seule fois par session (garde par `useRef`), puis l'état de navigation est vidé (§10, point 39).

## 5. `src/components/`

- `AppShell` : cadre de toutes les routes (`<Outlet/>`). Sur téléphone (moins de 768 px, choix en CSS dans `AppShell.css`), barre d'onglets en bas : Accueil, Voile, Enregistrer (bouton central vert, rouge avec un carré pendant l'enregistrement), Course, Réglages ; sur ordinateur, les mêmes destinations en barre haute. Bandeau rouge « Enregistrement en cours » et chrono sur toutes les pages sauf `/enregistrer`. Barres en `z-index` 1100, au-dessus des calques de Leaflet ; marge du bas `--inset-bottom` (variable `--safe-area-inset-bottom` injectée par Capacitor).
- `components/ui` : `Button({ variant: 'primary' | 'record' | 'danger' | 'secondary' | 'ghost'; size: 's' | 'm' | 'l'; block })` (`type="button"` par défaut), `Card({ heading })`, `PageHeader({ title; subtitle?; back?: { to; label }; aside? })`, et `ui.css` (classes `ui-page`, `ui-card`, `ui-btn`, `ui-tab`, `ui-alert`, `ui-field`, `ui-eyebrow`, `ui-record-dot`).
- `icons.tsx` : `IconHome`, `IconSail`, `IconRun`, `IconSettings`, `IconFile`, `IconChevronRight`, `IconBack`, `IconCheck`, SVG en trait à la couleur du texte.
- `SectionTabs<K>({ sections; open; onToggle; accent? })` : rangée de boutons indépendants (classes `ui-tabs`, `ui-tab`), `accent` étant une variable de la DA (`var(--voile)` par défaut, `var(--course)` en course).
- `ResizablePanel({ id; children; defaultHeight?; minWidth = 240; minHeight = 120; direction = 'both'; style? })` : `resize` CSS, taille enregistrée dans `tracker.panelSizes` à la fin d'un glisser, bouton ↺ de retour au défaut. Sans taille mémorisée, le `style` de la page fait la mise en page ; dès qu'un glisser commence sur la poignée (20 px du coin bas-droit), le panneau passe en taille fixe (`flex: '0 0 auto'`, `width`, `height`), appliquée après le `style` (§10, point 17). Si `id` change (manœuvres compact ↔ détails), la taille du nouvel identifiant est relue.
- `SpeedGradientLegend({ unit; range; isOverridden; onChange; slowLabel })` : barre de dégradé à cinq graduations, bornes en `type="number"` (pas 0,5) appliquées dès qu'elles sont valides ; une saisie qui inverserait l'ordre est refusée. Chaque champ garde un texte local (`minText`/`maxText`), resynchronisé pendant le rendu et non par un effet, sans quoi une frappe intermédiaire refusée coupait la saisie (§10, point 30). Bouton Défaut. Partagée par les deux modules.
- `MapAutoResize` : enfant de `MapContainer`, appelle `map.invalidateSize()` quand le conteneur change de taille.
- `chartHover.ts` : `ChartHoverEvent { isTooltipActive?; activeTooltipIndex? }` (sous-ensemble de l'événement Recharts), `hoveredTrackIndex(e, data): number | null` qui relit l'`index` de trace porté par la ligne survolée. Un seul handler pour les trois graphes reliés à la carte.
- `styles.ts` : `CARD_STYLE`, le bloc blanc arrondi des sections, sur les variables de la DA (même rendu que `Card`).

## 6. `src/pages/`

- `Home` : version d'attente, carte Enregistrer et deux cartes vers `/voile` et `/course` ; le tableau de bord arrive avec la bibliothèque (plan, lot 4).
- `RecordingPage` (`/enregistrer`) : support, source (GPS de l'appareil ou, dans le navigateur, rejeu d'un GPX à ×1, ×10, ×60 ou ×600), Démarrer / Arrêter ; en direct, points, durée, plus long trou et précision ; à l'arrêt, lieu du fichier, bouton Analyser (`useOpenSession`) et, dans le navigateur, Télécharger. L'onglet « Enregistrer » de la navigation ; choix en deux temps et statistiques en direct à venir (plan, lot 5).
- `SailingModule` et `RunningModule` reçoivent une session enregistrée par `useIncomingSession`, qui appelle `loadGpxContent`.
- `SailingModule` : en-tête (titre « Analyse voile », bouton « Ouvrir un fichier GPX », sélecteur de support, seuil d'activité), bandeaux d'erreur et de vent non fiable, `SectionTabs` sur `global`, `matos`, `tops` (`SAILING_SECTIONS`, persisté sous `tracker.sections` / `sailing`, seul `global` ouvert par défaut), légende de couleurs, puis la zone carte : carte à `flex: '0 1 60%'` (redimensionnable en largeur comme tout le reste, `direction` par défaut) et, à côté, une colonne avec un second groupe d'onglets indépendant — `SAILING_CARTE_PANELS` : manœuvres, vmg, graphiques, vent, dans cet ordre, tous fermés par défaut, persisté sous `tracker.sections` / `sailing-carte`. Ces quatre onglets n'existent que là (§10, points 32 à 35). Manœuvres et vmg sont rendus par deux fonctions locales (`renderManeuversPanel`, `renderVmgPanel`, paramétrées par l'`id` du `ResizablePanel`), graphiques et vent en JSX direct. Zone des panneaux en `flex-wrap` : plusieurs panneaux ouverts se placent côte à côte selon la largeur. Identifiants `ResizablePanel` : `sailing.global`, `sailing.matos`, `sailing.tops`, `sailing.carte`, `sailing.carte.vmg`, `sailing.carte.manoeuvres` (`.details` en suffixe si `showManeuverDetails`), `sailing.graph.vitesse`, `sailing.graph.polaire`, `sailing.graph.vent` (ids inchangés depuis leur déplacement, tailles mémorisées conservées). États locaux : `showTacksOnMap`, `showJibesOnMap`, `selectedTopMap` (clé de top ou `vmgUpwind` / `vmgDownwind`), `selectedManeuverTop` (`type:metrique`), `showManeuverDetails`, `hoveredIndex`. Couleur de la trace par le dégradé commun, bornes `speedRange` du support ou `suggestedSpeedRangeMs`, légende `SpeedGradientLegend` en nœuds.
- `RunningModule` : en-tête (titre « Analyse course à pied », bouton « Ouvrir un fichier GPX », unité, terrain, taille du texte), `SectionTabs` sur `synthese`, `zones`, `graphiques` (persisté sous `tracker.sections` / `running`), légende `SpeedGradientLegend`, carte. La carte n'est pas une section : comme en voile, elle est rendue sans condition `open.*`, visible dès l'ouverture du module (centrée sur `DEFAULT_MAP_CENTER` tant qu'aucune trace n'est chargée). Identifiants `ResizablePanel` : `running.synthese`, `running.zones`, `running.graphiques`, `running.carte`. Constantes locales : `CHART_SPEED_SMOOTHING_S = 10`, `MAP_SPEED_SMOOTHING_S = 15` ; type `ChartRow` pour les lignes des graphes. Mode graphes `separate` (deux graphes empilés, `syncId="running"`) ou `overlay` (un graphe à deux axes).
- `SettingsPage` (titre « Réglages ») : bloc « Réglages par support » (unité, seuil d'activité dans l'unité du profil, taille du texte, bouton Défaut par ligne), bloc « Course à pied » (terrain par défaut, bornes de couleur), bloc « Coureur » (poids, taille, année de naissance et âge, sexe, FC max, FC repos). Champs numériques (`NumberField`) en `type="number"` avec flèches ↕, valeur appliquée immédiatement ; bornes `min`/`max` posées sur les champs du coureur à partir de `BOUNDS` (`hooks/useRunnerProfile.ts`).

## 7. `src/utils/` et `src/types/`

- `utils/kinematics.ts` : `PointData { lat; lon; time; timeMs; speed; smoothedSpeed; bearing }` en nœuds, `toPointData`, `trackToPointData`. Utilisé par `sailing/*` (type) et `useSailingSession` (`trackToPointData`).
- `types/sailing.ts` : `TopRun = TopSegment`, `SessionStats extends BaseSessionStats { flightRatio; tops: { t2s; t5s; t10s; d100m; d500m; d1000m; d1NM } }`.

## 8. `src/platform/`

Seule couche autorisée à toucher au stockage, aux fichiers et à la position (règle 12 de `CLAUDE.md`). Chaque module choisit sa version au démarrage par `isNativeApp()` ; les plugins Capacitor y sont chargés par `import()` à la demande.

- `runtime.ts` : `isNativeApp()` (`Capacitor.isNativePlatform()`).
- `storage.ts` : `StorageBackend { getItem; setItem }`, `JsonStore { read<T>(key): T | null; write(key, value) }`, `createJsonStore(getBackend)`, `createMirroredBackend(initial, persist)` (mémoire amorcée, écriture recopiée), `jsonStore` (backend natif s'il est chargé, sinon `localStorage`, obtenu à chaque appel dans le `try`), `initStorage()` : à attendre avant le premier rendu (`main.tsx`) ; sur le téléphone, charge toutes les Preferences en mémoire, puis recopie chaque écriture ; échec → `localStorage`. Aucune erreur ne remonte. Synchrone exprès : les hooks lisent pendant le rendu.
- `location.ts` : `LocationFix { timeMs; lat; lon; accuracyM?; altitudeM?; speedMs?; bearingDeg? }` en SI, `LocationWatchOptions { intervalMs; distanceFilterM; notificationTitle; notificationText }`, `StopLocation`, `LocationSource { label; start(options, onFix, onError): Promise<StopLocation> }`. Sources : `deviceLocationSource()` (plugin `@capgo/background-geolocation`, service de premier plan, sur le téléphone ; `watchPosition` dans le navigateur, coupé écran éteint), `createReplaySource(fixes, speedFactor)` (relit une trace en accéléré, heures d'origine conservées), `stopOrphanedDeviceLocation()` (arrête un service GPS relancé seul après un arrêt brutal). Aucune source ne filtre.
- `files.ts` : `TextFile { read; write; append; remove }` (lecture d'un absent → `null`), `createMemoryFile()`, `recordingJournal` (`recording-journal.jsonl` dans le dossier privé de l'application sur le téléphone, en mémoire dans le navigateur), `SESSIONS_FOLDER = 'Tracker'`, `saveSessionFile(nom, contenu)` (écrit `Documents/Tracker/<nom>` sur le téléphone et rend ce chemin en clair ; dans le navigateur, n'écrit rien), `canDownloadFiles()`, `downloadTextFile(nom, contenu, type?)`, `readPickedFile(file)`.
- `backButton.ts` : `installBackButton(keepAlive)` : touche retour d'Android ; à la racine de l'historique, met l'application en arrière-plan au lieu de la fermer tant qu'un enregistrement tourne (fermer l'activité ferait perdre les positions).

## 9. `src/recording/`

Logique pure de l'enregistrement, testée en node, sans accès au téléphone. Principe : enregistrer brut, analyser ensuite (§12).

- `session.ts` : `isNewerFix(lastMs, fix)` (seul filtre : une redélivrance donnerait un intervalle nul), `roundFix(fix)` (7 décimales de degré, cm/s, dm, dixième de degré ; appliqué à la réception pour que le GPX écrit depuis la mémoire et celui reconstruit depuis le journal soient identiques), `fixesFromRawPoints(points)` (entrée du rejeu), `RecordingStats { pointCount; firstMs; lastMs; longestGapS; lastAccuracyM }`, `EMPTY_RECORDING_STATS`, `recordingDurationMs(stats)` (chrono, zéro avant la première position), `addFixToStats`, `shouldFlushJournal(lastFlushMs, fixMs, flushS)` (compté en temps de trace, pas par minuterie, que le système bride écran éteint), `isSportType`, `sessionFileName(startMs, sport)` (`2026-09-23_14-05-07_wingfoil.gpx`, heure locale), `sessionTitle(startMs, sport)` (`Wingfoil, 23/09/2026 14:05`, nom de trace, donc clé des notes).
- `journal.ts` : une ligne JSON par position, écrite par paquets ; relisible même abîmé (dernière ligne tronquée ignorée, en-tête illisible toléré). `JournalHeader { format: 'tracker-journal'; version: 1; sport; startedAtMs }`, `journalHeaderLine`, `journalFixLine` (`[heure, lat, lon, précision, altitude, vitesse, cap]`, `null` si absent), `ParsedJournal { header | null; fixes }`, `parseJournal(texte)`.
- `gpxWriter.ts` : `GpxMeta { name; sport }`, `buildGpx(fixes, meta)` : GPX 1.1, vitesse en `gpxtpx:speed` (m/s) et cap en `gpxtpx:course` (extension Garmin), précision en `tracker:accuracy`, support en `<type>`. `parseGpx` le relit sans cas particulier.
