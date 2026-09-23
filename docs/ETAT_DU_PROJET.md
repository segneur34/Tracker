# État du projet Tracker

Document de passation, écrit le 21 septembre 2026 à partir d'une lecture complète du code et tenu à jour depuis ; dernière passe le 23 septembre 2026 (§10, point 37). Complète `CLAUDE.md`, qui donne les règles ; ici, l'inventaire, le pipeline, les chantiers et la cible mobile (§12). L'historique des décisions (§10) vit dans `docs/HISTORIQUE.md`.

## 1. Résumé

Application web client-only qui lit une trace GPX et en tire des analyses. Les seuils de l'analyse voile s'accordent à l'allure de la session, ce qui la rend exploitable d'un bateau lent à un kite rapide, et lisible sur les traces enregistrées en cadence économique. Module voile abouti : carte colorée par la vitesse, statistiques globales, tops de vitesse, détection et qualité des virements et empannages, estimation du vent et de ses variations, VMG, notes de session. Module course opérationnel mais plus jeune : carte, graphes vitesse et altitude, zones de pente, dénivelé. Page Paramètres commune. Tout est persisté dans le navigateur, rien n'est exporté.

État des contrôles au moment de la passation : typecheck, lint, 192 tests et build production passent.

## 2. Environnement et outillage

- `package.json` : `dev` (vite), `build` (`tsc -b && vite build`), `lint` (oxlint), `test` (`vitest run`), `test:watch`, `preview`.
- Dépendances : react et react-dom 19, react-router-dom 7, recharts 3, leaflet 1.9 et react-leaflet 5. Dev : typescript 6.0, vite 8.3, vitest 5, oxlint 1.8, @vitejs/plugin-react 6.
- `tsconfig.app.json` : `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`. `strict` n'est pas écrit mais TypeScript 6 l'active par défaut. Conséquence pratique : un import inutilisé ou un paramètre inutilisé casse le build.
- `.oxlintrc.json` : plugins react, typescript, oxc ; règles `react/rules-of-hooks` (erreur) et `react/only-export-components` (avertissement). Pas de règle sur `any`.
- Vitest sans fichier de configuration : environnement node, pas de jsdom. Les tests importent `describe`, `it`, `expect` depuis `vitest`. Tout ce qui touche au DOM (parseur GPX, hooks, composants) n'est donc pas testé.
- Git depuis le 23 septembre 2026 (Git pour Windows 2.55), branche `main` qui suit `origin/main`, dépôt privé `https://github.com/segneur34/Tracker.git`, identifiants mémorisés. Réglages locaux : auteur Tom Briere, `core.autocrlf=false` (sources en LF, trois fichiers en CRLF, rien n'est converti). `.github/` vide. `dist/`, sortie de `npm run build`, est ignoré.
- Terminal de l'utilisateur : `cmd` sous Windows 11.

## 3. Architecture

Quatre couches, de bas en haut, plus une couche d'accès à la plateforme.

**Noyau `src/core/`.** Sans notion de sport, en unités SI. Types, conversions, profils de support, parseur GPX, kinématique, filtres, allure et cadence d'une session (`sessionSpeed.ts`), cumuls, masque d'activité, dénivelé, meilleurs segments.

**Extensions par sport.** `src/sailing/` travaille en nœuds sur `PointData` (adaptateur `src/utils/kinematics.ts`) : estimation du vent, manœuvres, VMG, stats, notes. `src/running/` travaille en m/s sur `TrackPoint` : pente, zones, allures. Le dégradé de couleur de la trace est commun aux deux (`core/speedGradient.ts`).

**Hooks `src/hooks/`.** `useGpxSession` (ingestion générique), `useSailingSession` (orchestration voile complète), `useSportSettings` et `useAllSportSettings` (réglages persistés), `useSessionNotes`, `useRunnerProfile`, `useOpenSections`, tous sur `useStoredRecord` (enregistrement persistant générique).

**Plateforme `src/platform/`.** Seule couche autorisée à toucher au stockage, et demain aux fichiers et à la position (règle 12 de `CLAUDE.md`, §12). Aujourd'hui `storage.ts` seul, sur `localStorage` ; la version Android le remplacera sans que les hooks changent.

**Pages et composants.** `Home`, `SailingModule`, `RunningModule`, `SettingsPage`, routes dans `App.tsx`. Composants partagés : `ModuleNav`, `SectionTabs`, `ResizablePanel`, `MapAutoResize`, `SpeedGradientLegend`, plus deux modules sans JSX : `chartHover.ts` (survol d'un graphe vers la carte) et `styles.ts` (`CARD_STYLE`).

Graphe de dépendances résumé : `core/*` ne dépend que de `core/*`. `sailing/*` dépend de `core/*` et du type `PointData` de `utils/kinematics`. `running/*` dépend de `core/*`. `platform/*` ne dépend de rien. Les hooks dépendent de `core`, `sailing`, `utils/kinematics` et `platform` ; `ResizablePanel` dépend de `platform`. Les pages dépendent des hooks, de `core`, `sailing`, `running` et des composants. Aucun alias de chemin : tous les imports sont relatifs.

## 4. Pipeline de données

### 4.1 Ingestion, commune aux deux modules

1. `useGpxSession` lit le fichier (`FileReader`) et appelle `parseGpx` (`core/gpxParser.ts`) : `DOMParser`, un `RawTrackPoint` par `trkpt` avec `lat`, `lon`, `time` (obligatoire), `ele`, `speed`, `hr`, `cad`, recherche par nom local pour tolérer les préfixes d'extension (`gpxtpx`, `gpxdata`, `ns3`). Le nom de la trace vient de `trk/name`. Une vitesse appareil hors [0, 100] est ignorée.
2. `referenceSpeedMs` et `samplingIntervalS` (`core/sessionSpeed.ts`), sur les points bruts. L'allure de la session est le **neuvième décile des vitesses brutes, pondéré par la durée de chaque point** et non par leur nombre, pour rester identique à 1 Hz et à 5 Hz ; la durée d'un échantillon est plafonnée à 10 s, sans quoi le point qui précède une coupure d'un quart d'heure pèserait plus que toute la session. Le module voile s'en sert pour accorder les seuils de filtrage (`sessionFilterThresholds`, `scaleFiltersToSession` de `useGpxSession`) : accélération plausible proportionnelle à l'allure, plafond de vitesse resserré sans jamais dépasser celui du profil. L'utilisateur peut imposer l'allure, ce qui recalcule toute la chaîne (§10, point 26).
3. `computeKinematics` (`core/kinematics.ts`), mémoïsé sur les points bruts et les options du profil :
   - vitesse dérivée des positions (Haversine / dt) et cap initial pour chaque point ;
   - si le fichier porte une vitesse appareil : détection de son unité (`detectDeviceSpeedUnit`, médiane du rapport appareil/dérivée, choix entre m/s, km/h, nœuds au plus proche en logarithme, au moins 10 échantillons) et conversion ; repli point par point sur la vitesse dérivée si l'appareil n'a rien fourni ;
   - sans vitesse appareil, le premier point reçoit la vitesse du second, sinon un faux démarrage brutal serait pris pour une aberration ;
   - écrêtage `clampByAcceleration` (`core/speedFilter.ts`) : amorce = médiane des 10 premières secondes ; un point est suspect si son accélération depuis la dernière valeur retenue dépasse 10 m/s² ou s'il dépasse le plafond du support ; on cherche alors un retour plausible dans les 3 s : trouvé, les points intermédiaires sont neutralisés ; non trouvé, le changement est réel et accepté sauf au-dessus du plafond ;
   - filtre médian temporel `medianFilterByTime` (3 s en voile, 5 s en course) qui donne `smoothedSpeedMs`, la vitesse de toutes les analyses.
4. `buildCumulativeTrack` (`core/sessionStats.ts`) : `cumDist` par intégration de `speedMs × dt` (`segmentDistanceM`), `cumTime` en secondes.
5. `computeActivityMask` : trigger de Schmitt sur `smoothedSpeedMs`, seuil haut à l'entrée et seuil bas à la sortie, avec durée de confirmation optionnelle. Seuils dérivés du seuil d'activité du profil par `getActiveThresholds` (wingfoil : 8 + 0,5 à l'entrée, 8 − 1 à la sortie ; course : 3 + 1 et 3 − 1 km/h, confirmés sur 3 s).
6. `computeElevationStats` (`core/elevation.ts`) : lissage de l'altitude par ajustement linéaire local sur fenêtre temporelle (`linearSmoothByTime`, 20 s route ou 30 s trail), puis accumulateur à seuil qui ne compte une montée ou une descente qu'après un renversement de pente supérieur à `minGainM` (3 m route, 5 m trail). Résultat publié seulement si au moins la moitié des points ont une altitude.
7. `buildBaseSessionStats` : distance totale et active, temps total et actif, ratio, source de vitesse, dénivelé, altitudes, tout formaté en chaînes.

### 4.2 Voile (`useSailingSession`)

1. `trackData = trackToPointData(track)` : vue en nœuds.
2. `stats = buildSailingSessionStats(track, { sport, activeThresholdKn })` (`sailing/sailingStats.ts`) : base générique plus `flightRatio` (alias de `activeRatio`) et `tops` sur les sept cibles voile (2 s, 5 s, 10 s, 100 m, 500 m, 1000 m, 1 mille), calculés par `computeTopSegments` (`core/topSegments.ts`) : vitesse d'un segment = distance sur durée, borne de fin interpolée, segments sans chevauchement, trois par cible.
3. `windEstimate = estimateWind(trackData, { minSpeedKn, successThresholdKn, minEntrySpeedKn })` (`sailing/maneuvers.ts`), l'estimation globale. Les seuils viennent du profil du support, de la surcharge de l'utilisateur et de l'allure de la session (`sessionManeuverThresholds`), jamais du code : c'est ce qui permet à un bateau de ne pas être analysé avec les valeurs d'un wingfoil (§10, points 23, 26 et 27).
   - `estimateWindPolar` (`sailing/wind.ts`) cherche le centre de l'angle mort : pour chaque direction candidate, pénalité des vitesses max dans le cône de ±35°, récompense des secteurs de près [40°, 85°] des deux côtés, pénalité du déséquilibre ; score = gauche + droite − 4 × cône − |gauche − droite|. L'orientation, angle mort ou son jumeau au vent arrière, est fixée par le contraste polaire, sinon par les virages (vol perdu = virement, face au vent), sinon par une référence ;
   - `selectWindCandidate` retient, parmi trois candidats maximaux séparés d'au moins 45° plus le jumeau du meilleur, celui dont le classement des manœuvres colle à la physique (`maneuverAgreement` : virement si la **conservation** de vitesse tombe sous 0,5, critère sans dimension et donc valable à toutes les échelles de support), un classement incohérent comptant double en négatif. Chaque direction testée porte son propre descripteur, jumeau compris (`describeWindCandidate`), de sorte que la confiance renvoyée est toujours celle de la direction renvoyée ;
   - deux allers-retours : les bissectrices des manœuvres à caps stabilisés sont fusionnées avec l'ancre polaire (moyenne vectorielle, poids 2 pour les manœuvres), puis chaque manœuvre est reclassée avec le vent local de son instant (`buildWindTimeline`).
   - Confiance = max(confiance polaire, confiance manœuvres × 0,9) ; fiable si ≥ 0,4. Sous ce seuil l'interface exige une saisie manuelle et suspend manœuvres, VMG et polaire.
4. `currentWindValue` : saisie manuelle si présente, sinon estimation fiable, sinon `null`.
5. `maneuverStats = analyzeManeuvers(trackData, wind, { successThresholdKn, minEntrySpeedKn })`, en deux passes (vent global, puis vent local interpolé entre les manœuvres de la première passe, trou maximal 30 min) :
   - fenêtre de 12 s ; virage retenu si cumul > 60°, cohérence (virage net / rotation totale) ≥ 0,6, vitesse d'entrée au-dessus du seuil accordé à la session, et **au moins 10 m parcourus** ; observation prolongée tant que le cap tourne dans le même sens, jusqu'à 24 s ;
   - si la fenêtre ne contient **aucun** point, un pas unique de moins de 30 s est lu à sa place : les enregistreurs économiques se taisent pendant le virage, quand le bateau ralentit, et y compriment toute la rotation (§10, point 27). La branche ne peut pas s'armer sur une trace dense ;
   - les virages écartés sont comptés par motif (`ManeuverRejections` : `slowEntry`, `incoherent`, `unclassified`, `tooShort`) et affichés, sans quoi « aucune manœuvre » ne dit pas lequel des murs a été touché. Le comptage est dédupliqué, mais ne pose **jamais** de temps mort : un virage écarté peut être classé quelques points plus loin ;
   - caps stabilisés avant et après (`stableSegment` : au-delà d'une marge de 4 s, jusqu'à 20 s, rotation < 3°/s, au moins 5 s) ; bissectrice parcourue dans le sens du virage, ce qui règle le cas dégénéré du virage de 180° ;
   - classification par la bissectrice avec tolérance de 60° ou la moitié du virage : proche du vent, virement ; proche du vent arrière, empannage ; au travers, rien ;
   - réussite si Vmin ≥ seuil d'activité ; temps mort de 10 s après la fin du virage ;
   - métriques de qualité : vitesse d'entrée (moyenne du bord stabilisé avant), conservation = Vmin / entrée, temps de relance jusqu'au retour à 90 % de l'entrée dans la minute, changement de cap entre caps stabilisés, distance intégrée de l'entrée à la relance, tracé pour la carte ;
   - `entryHeading` et `exitHeading`, caps instantanés aux deux bouts de la rotation : bruités, donc impropres à mesurer un angle fin, mais définis pour toutes les manœuvres, y compris celles sans cap stabilisé. Ils servent à juger la symétrie du virage, donc la confiance à accorder à sa mesure du vent.
6. `maneuverSummary = summarizeManeuvers(maneuverStats)` : par type, réussis, ratés, Vmin moyenne et max, moyenne et podium de chaque métrique (conservation la plus haute, les trois autres les plus faibles).
7. `windStats = calculateWindStats(trackData, maneuverStats, currentWindValue)` : statistiques circulaires (moyenne vectorielle, écarts à la moyenne, écart-type circulaire, tendance en degrés par heure) sur **toutes** les manœuvres classées, courbe interpolée entre manœuvres, valeur la plus proche conservée avant la première et après la dernière, interrompue au-delà de 30 min sans manœuvre (`interpolateDirection`), `windAt(t)`.
   - Le troisième argument est le vent global. Il sert à juger l'angle au vent d'entrée et de sortie de chaque manœuvre, donc sa symétrie : `poids = max(0,2 ; 1 − |TWA entrée| − |TWA sortie| / 90)`. Une manœuvre où l'on entre au largue pour ressortir au près a son milieu décalé et pèse moins, sans jamais être exclue. Sans ce vent de référence, la fonction se rabat sur la moyenne brute des mesures, ce qui revient à juger une série biaisée par son propre biais (§10, point 24).
   - Les poids s'appliquent à la moyenne, l'écart-type, la plage et la tendance, qui est une régression pondérée. L'interpolation, elle, ne pondère pas : la courbe passe par tous les points.
   - `stableShare` n'est plus une part retenue mais un indicateur de qualité : la part des manœuvres dont les caps sont stabilisés des deux côtés.
   - chaque point de `graphData` porte `isManeuver`, vrai sur le point d'échantillonnage le plus proche d'une manœuvre : le graphe y pose un point visible, pour distinguer la mesure de l'interpolation.
8. `vmgStats = calculateVmgStats(trackData, windAt ?? vent global, activeThresholdKn)` : fenêtres de 10 s, VMG = vitesse × cos(cap − vent local), par allure et par bord, trois tops au près et au portant.
9. Données de graphes : vitesse sous-échantillonnée à `CHART_MAX_POINTS` (500, `core/displayConfig.ts`), polaire de vitesse en 36 secteurs de 10° relatifs au vent.

### 4.3 Course (`RunningModule`)

Pas de hook dédié : le module compose directement `useGpxSession`, `useSportSettings('running')`, `useRunnerProfile`, `useOpenSections`. Il calcule cumuls, masque, dénivelé, stats de base, allures moyennes (`averagePace`, sur le temps total et sur le temps en mouvement), pentes (`computeGrades`, fenêtre de ±25 m sur l'altitude lissée), zones (`computeZoneStats`, cinq zones : montée raide ≥ 10 %, montée 3 à 10 %, plat ± 3 %, descente, descente raide ; pauses exclues), séries de graphes (vitesse lissée 10 s, altitude, distance en km), et couleur de trace par dégradé continu (`speedGradientColor` de `core/speedGradient.ts`, gris sous la borne basse, bleu à rouge entre les bornes, 4 et 15 km/h par défaut, vitesse lissée 15 s). Le module voile utilise le même dégradé sur `smoothedSpeed`, bornes suggérées par l'allure (`suggestSpeedRangeMs`, repli 8 à 28 nœuds).

## 5. Inventaire des exports

Signatures lues dans le code. Les fonctions internes non exportées sont omises sauf mention.

### 5.1 `src/core/`

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
- `formatSpeed(ms | null, unit): string` avec symbole ; `formatSpeedValue(value, unit): string` pour les axes ; `formatDuration(ms): string` (`1h24` ou `37 min`)

**sportProfiles.ts**
- `ElevationProfile { smoothingSeconds; minGainM }`, `ELEVATION_PRESETS = { route: {20, 3}, trail: {30, 5} }`
- `SportProfile { id; label; speedUnit; thresholdUnit; defaultActiveThreshold; activeHysteresis { enterOffset; exitOffset }; minStateDurationS; medianWindowSeconds; maxPlausibleSpeedMs; defaultPolarMinSpeed; activeRatioLabel; elevation; topTargets }`
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

### 5.2 `src/sailing/`

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

### 5.3 `src/running/`

**runningAnalytics.ts** : `GRADE_HALF_WINDOW_M = 25`, `FLAT_MAX_GRADE = 0.03`, `STEEP_MIN_GRADE = 0.1`, `GradeZoneKey`, `GradeZone { key; label; range }`, `GRADE_ZONES`, `classifyGrade(grade)`, `computeGrades(smoothedEle, cum, halfWindowM?)`, `ZoneStats { zone; distanceM; timeMs; avgSpeedMs; distanceShare; distance; time; pace; speedKmh }`, `computeZoneStats(track, grades, activityMask)`, `averagePace(distanceM, timeMs) → { pace; speedKmh; speedMs }`, `DEFAULT_SPEED_RANGE_MS = { minMs: 4/3.6, maxMs: 15/3.6 }`.

**types.ts** : `RunningSessionStats = BaseSessionStats`.

### 5.4 `src/hooks/`

- `useStoredRecord<T>(namespace, key | null, defaults) → { value; update(patch); loaded; readLatest() }` : enregistrement persistant générique, par `jsonStore` (`platform/storage.ts`), un espace de noms par clé de stockage, un enregistrement par sous-clé.
- `useGpxSession(options?) → { fileName; trackName; rawPoints; hasDeviceSpeed; error; track; referenceSpeedMs; samplingS; sessionKey; deviceSpeedUnit; hasTrack; handleFileUpload; loadGpxContent; reset }`. Seuls les points bruts sont en état, la trace est dérivée par `useMemo`. `GpxSessionOptions` étend `KinematicsOptions` de `scaleFiltersToSession` (faux par défaut, donc sans effet en course) et `referenceSpeedOverrideMs`. `sessionKey` (nom de trace et instant du premier point) rattache les notes et sert de clé de remontage à la carte (§10, point 28). `loadGpxContent(texte, nom)` est l'entrée qu'utilisera l'enregistrement natif (§12).
- `useSportSettings.ts` exporte aussi `TEXT_SCALE_FACTOR`, `TEXT_SCALE_LABEL`, `TERRAIN_LABEL`, `SAILING_UNITS = ['kn', 'kmh', 'ms']`, `RUNNING_UNITS = ['kmh', 'ms', 'minkm']`.
- `useSportSettings(defaultSport, allowedSports = [defaultSport]) → { sport; setSport; profile; activeThreshold; setActiveThreshold; resetActiveThreshold; isThresholdOverridden; terrain; setTerrain; elevationProfile; speedUnit; setSpeedUnit; textScale; setTextScale; speedRange; setSpeedRange; referenceSpeed; setReferenceSpeed }`. Le support mémorisé n'est repris que s'il est dans `allowedSports`. `referenceSpeed` est l'allure imposée en m/s, `null` quand elle est déduite de la trace.
- `useAllSportSettings() → { view(sport): SportSettingsView; setFor(sport, champ, valeur | null) }` pour la page Paramètres.
- `useSailingSession()` : rend la trace en nœuds (`trackData`), les statistiques, le vent (estimé, saisi, retenu : `windEstimate`, `manualWind`, `currentWindValue`), manœuvres et leur résumé, VMG, vent local (`windStats`), données de graphes, cadence et nombre de points, et les réglages du support avec leurs suggestions (`suggestedActiveThresholdKn`, `suggestedSpeedRangeMs`, `maneuverThresholds`, allure). C'est ici, et non dans les fonctions de calcul, que les seuils sont accordés à l'allure de la session : les fonctions gardent leurs valeurs par défaut, et les tests qui les appellent sans options restent donc neutres. `activeThresholdKn` est la surcharge de l'utilisateur si elle existe (`isThresholdOverridden`), sinon `suggestedActiveThresholdKn` ; de même `speedRange` (surcharge ou `null`) prime sur `suggestedSpeedRangeMs` dans les pages (§10, point 29). `manualWind` se réinitialise à `''` quand `gpx.sessionKey` change (nouvelle trace), pas à chaque recalcul du vent sur la trace courante : une saisie manuelle ne vaut que pour la trace où elle a été faite (§10, point 31).
- `useSessionNotes(sessionKey | null) → { notes; setNotes(patch); isSaved }`. Préremplit foil, mât et aile depuis la dernière session notée.
- `useRunnerProfile() → { profile; setNumber(field, value | null); setSex; setWeightKg; age }`. Champs : `weightKg`, `heightCm`, `birthYear`, `sex`, `hrMax`, `hrRest`, bornes de validation dans `BOUNDS`.
- `useOpenSections<K>(moduleId, defaults) → { open; toggle(key) }`. Utilisé par les deux modules (`running`, `sailing`).

### 5.5 `src/components/`

- `ModuleNav` : liens Accueil, Voile, Course, Paramètres, lien actif en surbrillance.
- `SectionTabs<K>({ sections; open; onToggle; accent? })` : rangée de boutons indépendants.
- `ResizablePanel({ id; children; defaultHeight?; minWidth = 240; minHeight = 120; direction = 'both'; style? })` : `resize` CSS, taille enregistrée dans `tracker.panelSizes` à la fin d'un glisser, bouton ↺ de retour au défaut. Sans taille mémorisée, le `style` de la page fait la mise en page ; dès qu'un glisser commence sur la poignée (20 px du coin bas-droit), le panneau passe en taille fixe (`flex: '0 0 auto'`, `width`, `height`), appliquée après le `style` (§10, point 17). Si `id` change (manœuvres compact ↔ détails), la taille du nouvel identifiant est relue.
- `SpeedGradientLegend({ unit; range; isOverridden; onChange; slowLabel })` : barre de dégradé à cinq graduations, bornes en `type="number"` (pas 0,5) appliquées dès qu'elles sont valides ; une saisie qui inverserait l'ordre est refusée. Chaque champ garde un texte local (`minText`/`maxText`), resynchronisé pendant le rendu et non par un effet, sans quoi une frappe intermédiaire refusée coupait la saisie (§10, point 30). Bouton Défaut. Partagée par les deux modules.
- `MapAutoResize` : enfant de `MapContainer`, appelle `map.invalidateSize()` quand le conteneur change de taille.
- `chartHover.ts` : `ChartHoverEvent { isTooltipActive?; activeTooltipIndex? }` (sous-ensemble de l'événement Recharts), `hoveredTrackIndex(e, data): number | null` qui relit l'`index` de trace porté par la ligne survolée. Un seul handler pour les trois graphes reliés à la carte.
- `styles.ts` : `CARD_STYLE`, le bloc gris arrondi des sections.

### 5.6 `src/pages/`

- `Home` : deux cartes cliquables vers `/voile` et `/course`. Pas de `ModuleNav`.
- `SailingModule` : en-tête (fichier, sélecteur de support, seuil d'activité), bandeaux d'erreur et de vent non fiable, `SectionTabs` sur `global`, `matos`, `tops` (`SAILING_SECTIONS`, persisté sous `tracker.sections` / `sailing`, seul `global` ouvert par défaut), légende de couleurs, puis la zone carte : carte à `flex: '0 1 60%'` (redimensionnable en largeur comme tout le reste, `direction` par défaut) et, à côté, une colonne avec un second groupe d'onglets indépendant — `SAILING_CARTE_PANELS` : manœuvres, vmg, graphiques, vent, dans cet ordre, tous fermés par défaut, persisté sous `tracker.sections` / `sailing-carte`. Ces quatre onglets n'existent que là (§10, points 32 à 35). Manœuvres et vmg sont rendus par deux fonctions locales (`renderManeuversPanel`, `renderVmgPanel`, paramétrées par l'`id` du `ResizablePanel`), graphiques et vent en JSX direct. Zone des panneaux en `flex-wrap` : plusieurs panneaux ouverts se placent côte à côte selon la largeur. Identifiants `ResizablePanel` : `sailing.global`, `sailing.matos`, `sailing.tops`, `sailing.carte`, `sailing.carte.vmg`, `sailing.carte.manoeuvres` (`.details` en suffixe si `showManeuverDetails`), `sailing.graph.vitesse`, `sailing.graph.polaire`, `sailing.graph.vent` (ids inchangés depuis leur déplacement, tailles mémorisées conservées). États locaux : `showTacksOnMap`, `showJibesOnMap`, `selectedTopMap` (clé de top ou `vmgUpwind` / `vmgDownwind`), `selectedManeuverTop` (`type:metrique`), `showManeuverDetails`, `hoveredIndex`. Couleur de la trace par le dégradé commun, bornes `speedRange` du support ou `suggestedSpeedRangeMs`, légende `SpeedGradientLegend` en nœuds.
- `RunningModule` : en-tête (fichier, unité, terrain, taille du texte), `SectionTabs` sur `synthese`, `zones`, `graphiques` (persisté sous `tracker.sections` / `running`), légende `SpeedGradientLegend`, carte. La carte n'est pas une section : comme en voile, elle est rendue sans condition `open.*`, visible dès l'ouverture du module (centrée sur `DEFAULT_MAP_CENTER` tant qu'aucune trace n'est chargée). Identifiants `ResizablePanel` : `running.synthese`, `running.zones`, `running.graphiques`, `running.carte`. Constantes locales : `CHART_SPEED_SMOOTHING_S = 10`, `MAP_SPEED_SMOOTHING_S = 15` ; type `ChartRow` pour les lignes des graphes. Mode graphes `separate` (deux graphes empilés, `syncId="running"`) ou `overlay` (un graphe à deux axes).
- `SettingsPage` : bloc « Réglages par support » (unité, seuil d'activité dans l'unité du profil, taille du texte, bouton Défaut par ligne), bloc « Course à pied » (terrain par défaut, bornes de couleur), bloc « Coureur » (poids, taille, année de naissance et âge, sexe, FC max, FC repos). Champs numériques (`NumberField`) en `type="number"` avec flèches ↕, valeur appliquée immédiatement ; bornes `min`/`max` posées sur les champs du coureur à partir de `BOUNDS` (`hooks/useRunnerProfile.ts`).

### 5.7 `src/utils/` et `src/types/`

- `utils/kinematics.ts` : `PointData { lat; lon; time; timeMs; speed; smoothedSpeed; bearing }` en nœuds, `toPointData`, `trackToPointData`. Utilisé par `sailing/*` (type) et `useSailingSession` (`trackToPointData`).
- `types/sailing.ts` : `TopRun = TopSegment`, `SessionStats extends BaseSessionStats { flightRatio; tops: { t2s; t5s; t10s; d100m; d500m; d1000m; d1NM } }`.

### 5.8 `src/platform/`

- `storage.ts` : `StorageBackend { getItem; setItem }`, `JsonStore { read<T>(key): T | null; write(key, value) }`, `createJsonStore(getBackend)`, `jsonStore` (sur `localStorage`, obtenu à chaque appel dans le `try`). Aucune erreur ne remonte : lecture impossible → `null`, écriture refusée → ignorée. Synchrone exprès : la version Android chargera les Preferences en mémoire au démarrage (§12).

## 6. Persistance navigateur

Cinq clés, toutes lues et écrites par `jsonStore` (`platform/storage.ts`), aujourd'hui dans `localStorage`. Les clés et le format JSON sont ceux d'avant ce module (§10, point 37) : les données déjà enregistrées sont relues telles quelles.

| Clé | Fichier | Forme |
|---|---|---|
| `tracker.sportSettings` | `hooks/useSportSettings.ts` | `StoredSettings { sport?; thresholds?; terrains?; speedUnits?; textScales?; speedRanges?; referenceSpeeds? }`, chaque champ indexé par support ; objet unique réécrit en entier à chaque changement. `speedRanges` sert aux deux modules, en m/s ; `referenceSpeeds` est l'allure imposée, en m/s, absente quand elle est déduite |
| `tracker.sailingNotes` | `hooks/useSessionNotes.ts` | `Record<sessionKey, SailingSessionNotes & { savedAt? }>` ; `sessionKey` = nom de trace ou de fichier, suivi de l'instant du premier point |
| `tracker.runnerProfile` | `hooks/useRunnerProfile.ts` | `Record<'me', RunnerProfile>` |
| `tracker.sections` | `hooks/useOpenSections.ts` | `Record<moduleId, Record<section, boolean>>` ; identifiants `running`, `sailing` et `sailing-carte` (colonne à droite de la carte, voile) |
| `tracker.panelSizes` | `components/ResizablePanel.tsx` | `Record<panelId, { width?; height? }>` |

Tout est local à un navigateur. Rien n'est exporté ni synchronisé.

## 7. Réglages et constantes

Profils (`core/sportProfiles.ts`) :

| Support | Unité | Seuil d'activité | Hystérésis | Confirmation | Médiane | Plafond | Polaire min |
|---|---|---|---|---|---|---|---|
| wingfoil | nœuds | 8 | +0,5 / −1 | 0 s | 3 s | 30 m/s | 5 |
| windsurf | nœuds | 10 | +0,5 / −1 | 0 s | 3 s | 30 m/s | 5 |
| kite | nœuds | 8 | +0,5 / −1 | 0 s | 3 s | 30 m/s | 5 |
| bateau | nœuds | 3 | +0,5 / −1 | 0 s | 3 s | 30 m/s | 2 |
| running | min/km, seuil en km/h | 3 | +1 / −1 | 3 s | 5 s | 12 m/s | 0 |

Les valeurs des seuils par support sont des défauts provisoires, jamais validés sur données réelles autres que le wingfoil.

Les valeurs en nœuds du tableau ci-dessus sont des **plafonds** : en voile, `sessionManeuverThresholds` et `sessionFilterThresholds` les abaissent quand l'allure de la session est basse, jamais l'inverse.

Autres réglages : filtres (`speedFilter.ts`, accélération max 10 m/s², aberration max 3 s, médiane 3 s, amorce 10 s) ; allure de session (`sessionSpeed.ts` : neuvième décile, échantillon plafonné à 10 s, accélération 0,8 × allure avec plancher de 2 m/s², plafond 3 × allure) ; seuils de manœuvre et seuils suggérés accordés à la session (voir `sailingConfig.ts` au §5.2) ; détection d'unité (10 échantillons, vitesse dérivée ≥ 1 m/s) ; dénivelé (route 20 s et 3 m, trail 30 s et 5 m, couverture minimale 50 %) ; manœuvres (`sailingConfig.ts` et `maneuvers.ts` : virage 60°, fenêtre 12 s, temps mort 10 s, entrée 4 nœuds, tolérance de classification 60°, caps stabilisés 4 à 20 s à moins de 3°/s pendant 5 s, relance 90 % dans 60 s) ; vent (`wind.ts` : cône ±35°, près [40°, 85°], pénalité ×4, candidats séparés de 45°, contraste minimal 0,15, cohérence 0,6, sortie stable 5 s à moins de 45° par pas, vol perdu sous 5 nœuds, confiance minimale 0,4, trou d'interpolation 30 min, deux itérations, poids polaire minimal 0,3, poids manœuvres 2, plein poids à 4 manœuvres ; `sailingAnalytics.ts` : poids de symétrie entre 0,2 et 1, nul au-delà de 90° d'écart, `MIN_SYMMETRY_WEIGHT` et `SYMMETRY_SPAN_DEG`) ; VMG (10 s) ; course (pente sur ±25 m, plat sous 3 %, raide dès 10 %) ; couleur de trace (course 4 à 15 km/h, voile 8 à 28 nœuds, réglables par support) ; affichage (500 points par graphe, lissage 10 s pour le graphe et 15 s pour la carte en course, texte 0,85 / 1 / 1,25).

## 8. Tests

192 tests dans 10 fichiers, `npx vitest run`, tous sur des fonctions pures avec des traces synthétiques ou un stockage simulé.

- `core/speedFilter.test.ts` (24) : médiane, écrêtage (pic, aller-retour de deux points, aberration au démarrage, plafond, non-verrouillage à 5 Hz), filtres médian, linéaire, moyenne.
- `core/kinematics.test.ts` (22) : Haversine, cap, m/s, Doppler prioritaire, `forceDerivedSpeed`, saut de 500 m écrêté, détection km/h, m/s, nœuds, invariance 1 Hz / 5 Hz.
- `core/elevation.test.ts` (16) : bruit sous seuil, montée continue, bosses, route contre trail, NaN, couverture, montée intacte aux bords.
- `core/topSegments.test.ts` (20) : tops temps et distance, interpolation, invariance de fréquence, non-chevauchement, cumul par intégration, trigger de Schmitt.
- `sailing/wind.test.ts` (20) : statistiques circulaires, interpolation des directions (entre mesures, aux bords, trou maximal), score de l'angle mort, estimation polaire sur polaire réaliste, virages et chutes, `describeWindCandidate` (direction imposée, séparation du vent et de son jumeau, normalisation).
- `core/sessionSpeed.test.ts` (13) : neuvième décile insensible à un pic isolé, invariance 1 Hz / 5 Hz de l'allure, coupure d'enregistrement qui ne doit pas peser plus que la session, cadence médiane, seuils de filtrage resserrés sur une session lente et jamais ouverts au-delà du support.
- `sailing/maneuvers.test.ts` (49) : détection, classification et métriques ; 1 Hz contre 5 Hz ; estimation du vent sur quatre protocoles synthétiques (rider asymétrique, session sans largue, courant traversier, bascule de 60°) ; chute ; réglages du support et neutralité des défauts ; `selectWindCandidate` ; `calculateWindStats` (pondération par symétrie, repli sans vent de référence) ; enregistrement économique (virage dans un pas de 22 s, coupure de 60 s écartée) ; seuils accordés à la session.
- `running/runningAnalytics.test.ts` (13) : zones, pente sur 50 m robuste au bruit, allures par zone, dégradé (fonctions de `core/speedGradient.ts`, testées ici avec les bornes course).
- `sailing/sailingConfig.test.ts` (9) : `suggestActiveThresholdKn` (régime rapide par support, exception bateau, borne à 12 nds, allure nulle) ; `suggestSpeedRangeMs` (borne basse alignée sur le seuil suggéré, borne haute au pic 2 s plus marge, repli sur trace vide ou trop courte).
- `platform/storage.test.ts` (6) : clé absente, aller-retour, JSON identique à l'ancien accès direct (compatibilité des données déjà enregistrées), JSON illisible, stockage qui refuse de lire ou d'écrire, erreur levée dès l'accès au stockage. Sur un stockage simulé par une `Map`, en node.

Générateurs réutilisables dans les tests : `buildEastwardTrack` (kinematics), `buildTrack` (plusieurs variantes selon le fichier), `realisticPolar` (wind), et dans `maneuvers.test.ts` `buildLegSession` avec `upwindDownwindLegs`, `downwindLegs` (portant pur, que des empannages), courant optionnel, `polar` optionnelle (`slowPolar`, la polaire du wingfoil divisée par 2,5, pour simuler un support lent) et `integratePosition`.

**`integratePosition` mérite un mot** : par défaut les générateurs font avancer la position le long d'une ligne arbitraire, indépendante des caps imposés. C'est sans conséquence tant qu'un calcul ne lit que les caps et les vitesses, mais toute analyse qui touche aux positions — distance d'une manœuvre, tracé, et toute mesure géométrique du virage — doit être testée avec cette option active, faute de quoi elle mesure une trajectoire qui n'a rien à voir avec la session simulée.

Non testé : `gpxParser` (DOM), `buildBaseSessionStats`, `buildSailingSessionStats`, `calculateVmgStats`, `buildWindTimeline`, tous les hooks, composants et pages.

## 9. Dette et code mort

Nettoyage du 21 septembre 2026 (§10, point 15) : plus de fichier mort, plus d'export inutilisé, plus de `any` dans `src/`, duplications résorbées. Ce qui reste :

- **Sens de rotation d'un virage vu en un seul pas** : quand l'enregistreur s'est tu pendant la manœuvre, on connaît le cap avant et le cap après, mais pas le chemin suivi entre les deux. `angleDiff` retient l'arc court, et un virement pris en passant par le lit du vent est alors nommé empannage. La géométrie seule ne peut pas trancher ; il faudra un critère physique, ou l'aveu que le fichier ne le dit pas. Voir §11.
- Le module voile lit son unité dans les réglages mais affiche toujours en nœuds : choisir km/h pour le bateau est enregistré sans effet.
- `Payload.payload` de Recharts est typé `any` par la librairie : les `formatter` d'infobulle relisent la ligne de données en l'annotant du type attendu (`ChartRow`, `WindGraphPoint`). C'est une confiance accordée à Recharts, pas une vérification.
- Les tests ne couvrent toujours ni le parseur GPX, ni les hooks, ni les pages (§8).

## 10. Historique des décisions et pièges rencontrés

Déplacé dans `docs/HISTORIQUE.md` le 23 septembre 2026, numérotation inchangée : les renvois « §10, point N » du code et de ce document y mènent. Le consulter sur le sujet qu'on touche, avant de retenter ce qui a déjà été essayé.

## 11. Chantiers en attente

Exprimés par l'utilisateur ou découverts pendant le travail.

- Coût énergétique en course, à partir du poids et des caractéristiques du coureur déjà saisies dans Paramètres. Rien n'est calculé aujourd'hui.
- Zones d'effort cardiaque : `hr` est lu du GPX et FC max et repos sont saisies, aucun calcul ne les utilise.
- Cibles de tops pour la course (`topTargets: []` dans le profil running), splits kilométriques, allure par kilomètre.
- Affichage du module voile dans l'unité choisie (km/h, m/s), aujourd'hui toujours en nœuds.
- Notes de session pour la course (matériel, conditions, appréciation), sur le modèle de `useSessionNotes`.
- Export et sauvegarde des notes et réglages, aujourd'hui prisonniers du navigateur.
- Validation des seuils par support sur des sessions réelles de planche, kite, bateau et course.
- Application Android via Capacitor et enregistrement GPS natif : feuille de route au §12.
- Coût du recalcul du vent sur trace 5 Hz (§10 point 23) : environ 0,5 s à chaque mouvement du seuil d'activité sur 3 h à 5 Hz, contre 28 ms à 1 Hz. Mitigation identifiée et non faite, parce qu'elle demande un vrai refactor : `analyzeManeuvers` refait toute la détection des virages pour chaque candidat de vent, alors que seule la classification dépend du vent. Détecter une fois puis classer par candidat diviserait le coût par quatre environ.
- **Nommer un virage vu en un seul pas** (§9, §10 point 27). Sur une trace d'enregistreur économique, le cap avant et le cap après sont connus, mais pas le chemin entre les deux : `angleDiff` retient l'arc court, et un virement pris en passant par le lit du vent ressort en empannage. Pistes évoquées et non tranchées : la perte de vitesse (inopérante ici, la session est lente de bout en bout), le déplacement latéral par rapport à l'axe du vent (calculable, mais ténu sur quelques mètres), ou assumer que le fichier ne le dit pas et l'afficher comme tel. C'est le premier geste de la prochaine session sur ce sujet, et il demandera le souvenir de l'utilisateur pour être validé.
- Estimation du vent sur trace lente et peu échantillonnée : la polaire annonce une confiance élevée sur une direction fausse de 180° (§10 point 27). L'utilisateur corrige par « Inverser » et s'en satisfait pour l'instant ; la confiance affichée mériterait d'être rabattue quand la couverture polaire est maigre.
- Valider les seuils d'un enregistrement dense sur une session de planche rapide : toute la calibration récente s'est faite sur une trace lente et une trace wingfoil, sans cas intermédiaire.

## 12. Cible mobile (Capacitor)

Décidé le 23 septembre 2026 : proposition de Gemini, analysée et retenue. Téléphone de l'utilisateur : Android. Rien n'est encore installé côté mobile (ni Android Studio, ni Capacitor) ; seule la couche `src/platform/` est en place (phase 0).

**Pourquoi Capacitor.** L'application est 100 % client : Capacitor emballe `dist/` dans une WebView Android, avec React, Leaflet et Recharts tels quels. Le code qui touche au navigateur tient en trois endroits (`platform/storage.ts`, `FileReader` dans `useGpxSession`, `DOMParser`, qui fonctionne en WebView) ; `core/`, `sailing/` et `running/` ne bougent pas. Écartés : PWA (géolocalisation coupée écran éteint), React Native (ni DOM, ni Leaflet, ni Recharts : réécriture des pages), natif (réécriture complète), Tauri mobile (géolocalisation en arrière-plan trop pauvre). iOS est hors de portée depuis Windows (Mac et compte Apple requis).

**Ce qui coûtera : l'interface, pas Capacitor.** Carte à 60 % avec une colonne à droite, graphes à largeur fixe (500 et 350 px), survol souris (graphe → carte, définitions en `title`), poignée `resize` de 20 px (absente sur iOS), et un `Polyline` par segment, soit 10 800 pour 3 h à 1 Hz. Premier remède pour la carte : `preferCanvas`. Regrouper les segments par couleur toucherait à la décision « pas de paliers » : à redemander.

**Risque à lever en premier.** Un enregistrement de 2 à 3 h écran éteint : Android le permet par un service de premier plan, mais certains constructeurs tuent quand même les applications. À vérifier sur une vraie session avant tout travail d'interface ; la cadence médiane et le nombre de points affichés par le module voile servent d'instrument de mesure.

**Plugin GPS** (état de septembre 2026). `@capgo/background-geolocation` : MPL-2.0, Capacitor 8, `distanceFilter` et `minIntervalMs` réglables, renvoie vitesse, cap, précision, altitude et heure. Poser `android.useLegacyBridge: true`, sans quoi les positions s'arrêtent après 5 min en arrière-plan. `@capacitor-community/background-geolocation` s'arrête à Capacitor 7. Repli si des points se perdent : Capawesome, payant, qui garde les positions dans une file SQLite native.

**Principe : enregistrer brut, analyser ensuite.** L'enregistreur ne filtre rien, ni distance, ni pause automatique, ni lissage : 1 Hz, vitesse fournie par le système (Doppler sur la plupart des puces), précision. L'intelligence reste dans le pipeline existant. Les paramètres iront dans `SportProfile.recording` (règle 3), identiques pour tous au départ (1 s, 0 m). Le 1 Hz tient aussi le coût du recalcul du vent (§10, point 23).

**Format pivot : un GPX par session.** Un journal écrit par paquets pendant l'enregistrement, qui résiste à un arrêt brutal, puis un GPX complet à l'arrêt, avec `<speed>` en m/s en extension, que `parseGpx` lit déjà par nom local. Ouvrir une session enregistrée revient à appeler `loadGpxContent` : l'ingestion ne change pas, et les fichiers s'exportent vers d'autres applications.

**Architecture.** `src/platform/` est la seule couche qui touche au stockage, aux fichiers et à la position. Chaque module y a une version navigateur et une version téléphone, choisies au démarrage (`Capacitor.isNativePlatform()`) : sur le PC, l'application ne voit jamais le téléphone.
- `storage.ts` (phase 0) : JSON clé/valeur synchrone. En natif, `@capacitor/preferences`, chargé en mémoire au démarrage, parce que le système peut vider le `localStorage` d'une WebView.
- `location.ts` (phase 1) : le plugin en natif, `watchPosition` dans le navigateur, et une source « rejeu » qui lit un GPX en accéléré pour tester tout l'enregistrement sur le PC.
- `files.ts` (phase 1) : journal et GPX via `@capacitor/filesystem`.
- `src/recording/` (phase 1) : logique pure testable en node (position → `RawTrackPoint`, journal, écriture GPX). `android/`, généré par Capacitor, sera versionné.

**Boucle de développement.** Inchangée : `npm run dev` et le navigateur du PC ; mise en page mobile au mode appareil de Chrome. Vers le téléphone, sans Wi-Fi commun, par câble USB : `npx cap run android` installe, `--live-reload --host localhost --port 5173 --forwardPorts 5173:5173` charge l'application depuis le serveur du PC (à confirmer au premier essai), `chrome://inspect` montre la console. En option, un APK compilé par GitHub Actions : il exige **une clé de signature fixe** (secrets du dépôt), sinon Android refuse la mise à jour et la désinstallation efface les sessions.

**Feuille de route.**
- Phase 0, **faite le 23 septembre 2026** et validée par l'utilisateur (§10, points 36 et 37) : git et GitHub, `CLAUDE.md` allégé, historique sorti dans `docs/HISTORIQUE.md`, `src/platform/storage.ts`.
- Phase 1 : Android Studio ; coquille Capacitor 8 ; stockage natif ; page d'enregistrement minimale (démarrer, arrêter, durée, points, précision) avec le plugin, le journal, l'écriture GPX et la source « rejeu » ; une vraie session de 2 h écran éteint.
- Phase 2 : interface mobile (disposition empilée en écran étroit, décisions de disposition sur ordinateur inchangées ; toucher au lieu du survol ; `preferCanvas` ; `accept=".gpx"`, qui grise parfois les GPX sous Android) ; liste des sessions.
- Phase 3 : partage et export GPX, réception d'un GPX partagé depuis Komoot, cartes hors ligne (pas de réseau en mer), capteur cardiaque Bluetooth.
- À vérifier en phase 1 : `BrowserRouter` dans la WebView, avec `HashRouter` en repli.
