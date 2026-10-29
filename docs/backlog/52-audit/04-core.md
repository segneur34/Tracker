# 04 · Noyau (core)

Audit en lecture seule de `src/core/` (38 fichiers de code, 34 fichiers de test), `src/utils/kinematics.ts` et `src/types/sailing.ts`. Chaque constat cite les lignes lues. Les mesures de la section B viennent d'un banc jetable (trace synthétique de 3 h à 5 Hz, 54 000 points, Node 26 sur le poste, bundle rolldown) : `C:\Users\segne\AppData\Local\Temp\claude\c--Users-segne-tracker\313d82af-3070-414e-a45d-107cdc2d0e56\scratchpad\audit\bench.ts`, `bench2.ts` (prototypes et comparaison exacte), `bench3.ts`. Sur téléphone, compter 3 à 5 fois plus.

## Carte

| Fichier | Lignes | Rôle | Appelants principaux (fichiers hors test) | Testé |
|---|---|---|---|---|
| `kinematics.ts` | 580 | Haversine, cap, dates réparties, unité du Doppler, sauts de position, cinématique entière et reprise (direct) | recording 5, planning 3, core 4, hooks 2 | oui (37) |
| `speedFilter.ts` | 313 | Médiane, écrêtage par accélération, médiane / moyenne / droite glissantes en secondes | core 6, running 2, sailing 1, pages 1 | oui (24) |
| `sessionSpeed.ts` | 141 | Allure de la session (P90 pondéré), cadence médiane, seuils de filtrage accordés | hooks, library, components | oui (13) |
| `sessionStats.ts` | 267 | Distance d'un pas, cumuls, masque d'activité, suites actives, statistiques de base | 16 fichiers (tous les sports) | oui (16) |
| `topSegments.ts` | 139 | Meilleurs segments en temps ou distance, sans chevauchement | sailing 2, recording 2, pages 2 | oui (27) |
| `elevation.ts` | 182 | Lissage d'altitude, cumul à seuil, stats de dénivelé | pages, library, recording, planning | oui (16) |
| `terrainElevation.ts` | 140 | Échantillons IGN le long de la distance, altitude du terrain appliquée | library 2, hooks 1 | oui (10) |
| `trackColor.ts` | 72 | Vitesse de couleur (moyenne 15 s à pied et vélo), traits colorés | pages 4, components 2 | oui (5) |
| `speedGradient.ts` | 61 | Dégradé de couleur de vitesse, bornes valides | 18 fichiers | non (indirect) |
| `gpxParser.ts` | 210 | Lecteur GPX maison (extensions Doppler, FC, cadence), parcours | pages 4, hooks 2, components 2 | oui (16) |
| `geoPlane.ts` | 72 | Plan local, projection sur segment | planning 3, recording 2, core | oui (8) |
| `simplify.ts` | 60 | Douglas-Peucker | recording 1, planning 1 | oui (4) |
| `search.ts` | 36 | Dichotomies | core 5, running 2, sailing 1 | oui (5) |
| `basics.ts` | 24 | clamp, isObject, isFiniteNumber, plural, newId | 24 fichiers | oui (4) |
| `units.ts` | 234 | Conversions et formatages (vitesse, allure, distance, durées, dates) | 66 fichiers | oui (16) |
| `types.ts` | 152 | Types du noyau (points, tops, stats de base, cumuls) | 52 fichiers | non (types) |
| `sportProfiles.ts` | 903 | Profils de calcul, familles, traitements, seuils | 74 fichiers | non (table) |
| `activities.ts` | 446 | Activités de l'utilisateur, couleurs, montée de version | 42 fichiers | oui (46) |
| `activityPresets.ts` | 182 | Pré-réglages par calcul et activité de départ | hooks/useSportSettings seul | oui (10) |
| `activityIcons.ts` | 86 | Icône d'activité devinée | components, pages, hooks | oui (6) |
| `analysisTabs.ts` | 208 | Onglets des analyses, choix, masques | pages 5, hooks 2 | oui (27) |
| `heartRate.ts` | 442 | FC lissée, zones, charge, dérive, histogramme, passages | 20 fichiers | oui (31) |
| `heartRateSession.ts` | 146 | Session sans trace (muscu), vignette FC | pages 2, library 1 | oui (6) |
| `imuFile.ts` | 494 | Format `.imu` : lecture, écriture, élagage, stats | core 5, hooks 4, banc | oui (10) |
| `imuVertical.ts` | 259 | Verticale du monde (filtre complémentaire), moyenne centrée | core 2, surfing 1 | oui (10) |
| `imuPrune.ts` | 17 | Élagage d'un `.imu` à l'entrée en mémoire | hooks 1 | non (par jumps.test) |
| `jumps.ts` | 434 | Vols, sauts, fenêtres d'élagage, place sur la trace | pages, hooks, components, library | oui (19) |
| `pumping.ts` | 310 | Coups, séries, décollage, pumping par vol | pages 2, sailing, hooks, components | oui (13) |
| `chartZoom.ts` | 243 | Zoom des graphes, sous-échantillonnage aux extrêmes, graduations | components 7, pages 6 | oui (22) |
| `displayConfig.ts` | 68 | Constantes d'affichage, emprise, flèches de cap | pages 6, components 6 | oui (7) |
| `sessionMarks.ts` | 84 | Repères « Note » : lecture, placement | library, hooks, components | oui (6) |
| `shareImage.ts` | 209 | Cadrage Mercator et grille de l'image de partage | components 5, pages 4 | oui (20) |
| `mapBase.ts` | 72 | Fonds de carte (plan, satellite) | components 3, hooks 2 | oui (5) |
| `tiles.ts` | 82 | Cache des tuiles (clé, parent, éviction) | components, platform, hooks | oui (6) |
| `patternTiles.ts` | 365 | Dessins des fonds de page | components, hooks | oui (5) |
| `rootPath.ts` | 524 | Géométrie de la racine du Profil | components 2 | oui (18) |
| `parentPage.ts` | 38 | Page au-dessus (retour Android) | components 1 | oui (8) |
| `beepDurations.ts` | 13 | Durées des bips | recording, platform, components | non (constantes) |
| `imuSynthetic.fixture.ts` | 95 | Captures synthétiques des tests | tests seulement | — |
| `utils/kinematics.ts` | 39 | Vue en nœuds `PointData` (héritage voile, règle 5) | sailing 3, hooks 1 | non |
| `types/sailing.ts` | 17 | `SessionStats` de la voile (tops en dur) | sailing, hooks, pages | non |

## A. Doublons

Classés par importance (gain de lisibilité et risque de divergence).

### A1. Recherche dichotomique « encadrer un instant » réécrite 8 fois
- Pièce existante : `core/search.ts:11-36` (`partitionPoint`, `firstIndexAtOrAfterTime`, `lastIndexAtOrBeforeTime`).
- Copies : `core/pumping.ts:208-222` (`trackValueAt`, interpolation bornée), `core/jumps.ts:345-358` (`speedAt`, interpolation, `null` hors trace), `core/jumps.ts:404-414` (`trackIndexAtTime`, point le plus proche), `core/chartZoom.ts:94-100` (`axisRangePath.at`, interpolation sur un axe), `core/kinematics.ts:303-312` (`insertSorted`), `recording/followedTrace.ts:150-158`, `running/energy.ts:358-368` (`firstFrom`), `sailing/wind.ts:166-171` (vent interpolé, angles).
- Identique / différent : même boucle `(lo + hi) >> 1` ; trois sémantiques aux bords (bornée, `null`, plus proche). Les deux `jumps.ts` et `pumping.ts` font la même interpolation linéaire sur `timeMs`.
- Pièce unique proposée, dans `core/search.ts` :
  - `bracketAt(values: ArrayLike<number>, x: number): { lo: number; hi: number; w: number }` (encadrement et poids, bornes rognées) ;
  - `valueAtTime(track: ArrayLike<{ timeMs: number }>, value: (i: number) => number, ms: number, outside: 'clamp' | 'null'): number | null` ;
  - `nearestIndexAtTime(track, ms): number` (remplace `trackIndexAtTime`).
- Risque : faible, chaque copie a ses tests ; `axisRangePath` et le vent (angles) gardent leur interpolation propre mais prennent `bracketAt`.
- Taille : petit. Confiance : sûr.

### A2. Choix des trois meilleurs segments sans chevauchement écrit deux fois
- `core/topSegments.ts:97-122` (tri décroissant, sélection gloutonne, chemin `slice().map()`, complétion à « - ») et `sailing/sailingAnalytics.ts:505-525` (`getTopVmg`, même code, même test de chevauchement `Math.max(w.start, s.start) <= Math.min(w.end, s.end)`).
- Identique au mot près, hors du nom des champs.
- Pièce unique : `pickTopWindows<W extends { start: number; end: number }>(windows: W[], value: (w: W) => number, count: number): W[]` dans `core/topSegments.ts`, plus `windowPath(track, w)`. À faire en même temps que B2 (balayage sans tri).
- Risque : faible (ordre des égalités : le tri est stable, le balayage « strictement plus grand » garde le premier, prouvé identique en B2). Taille : petit. Confiance : sûr.

### A3. Distance entre deux instants : quatre définitions
- `core/pumping.ts:240` (cumul `cumDist` interpolé par `trackValueAt`, trous compris : règle 6), `core/sessionMarks.ts:78-83` (même interpolation de `cumDist`, recherche par `search.ts`), `core/terrainElevation.ts:91-101` (même interpolation, boucle à deux curseurs), `core/jumps.ts:361-370` (`distanceBetween` : trapèzes sur la vitesse `speedMs` interpolée par pas de `gridStepS`, sans `gapDistanceM` ni `segmentStart`).
- Hors zone, même famille : `sailing/maneuvers.ts:818` et `:843` intègrent `smoothedSpeed` × dt (voir D10).
- Différent : `jumps.ts` ne donne pas le même chiffre que l'interpolation de `cumDist` (trapèze contre vitesse du point d'arrivée sur le pas).
- Pièce unique : `distanceAtTime(track, cum, ms)` dans `core/sessionStats.ts` (sur `valueAtTime` de A1) ; `jumps` et `pumping` lisent `distanceAtTime(b) − distanceAtTime(a)`.
- Risque : moyen, les longueurs de saut rangées dans les fiches changent légèrement (`JUMPS_CALC_VERSION` à augmenter). Taille : petit. Confiance : sûr pour le doublon, décision pour le changement de chiffre (question F).

### A4. Médiane écrite 6 fois, avec deux définitions
- `core/speedFilter.ts:26-33` (copie, tri, moyenne des deux centrales), `core/kinematics.ts:326-330` (`sortedMedian`, même formule sur tableau trié), `core/sessionSpeed.ts:118-120` (même formule en ligne, tri en place), `core/imuVertical.ts:72-75` (médiane haute, `Float64Array`), `core/imuFile.ts:485-486` (médiane haute en ligne), `running/cadence.ts:319` (médiane haute en ligne).
- Différent : deux conventions (moyenne des centrales / valeur haute).
- Pièce unique, `core/speedFilter.ts` (ou un `core/stats.ts`) : `medianOfSorted(sorted: ArrayLike<number>): number`, `median(values)` qui l'appelle, `upperMedian(values)` nommée pour les deux usages capteurs.
- Risque : nul si chaque convention est gardée. Taille : petit. Confiance : sûr.

### A5. Unité du Doppler : la boucle de choix écrite deux fois dans le même fichier
- `core/kinematics.ts:128-139` (dans `detectDeviceSpeedUnit`) et `core/kinematics.ts:333-344` (`unitFromRatio`), identiques ; `detectDeviceSpeedUnit` peut appeler `unitFromRatio(median(ratios))`, et `unitRatio` (346-348) remplacer le test de 122.
- Taille : petit. Confiance : sûr.

### A6. Projection équirectangulaire écrite 4 fois
- `core/geoPlane.ts:47-49` (`projectOnSegment`), `core/geoPlane.ts:65-72` (`planeProjection`), `core/simplify.ts:53-60` (`kx`, `ky` recopiés de `planeProjection`), `planning/wayMatch.ts:92-94`.
- Pièce unique : `planeProjection(refLat)` de `geoPlane.ts`, appelée par `simplifyLatLon` et `wayMatch`.
- Risque : nul (mêmes formules ; vérifier l'ordre des opérations pour l'égalité exacte). Taille : petit. Confiance : sûr.

### A7. Angles : normalisation, écart signé, moyenne vectorielle hors du noyau
- `sailing/wind.ts:24-30` (`angleDiff`, `normalizeAngle`), `library/record.ts:443` (`normalizeDeg`, identique à `normalizeAngle`), `surfing/gpsTurns.ts:19-22` (`signedDelta`, écart dans ]−180 ; 180], alors qu'`angleDiff` rend [−180 ; 180[), `platform/compass.ts:23` (normalisation en ligne), `sailing/wind.ts:96-113` (`circularMean`) et `recording/liveLegs.ts:75-96` (moyenne vectorielle pondérée par la distance, en sommes cumulées).
- Conversions degrés/radians en ligne au lieu de `toRad`/`toDeg` (`core/kinematics.ts:14-15`) : `recording/liveLegs.ts:79` et `:93`, `sailing/wind.ts:38`, `:102`, `:111`, `:123`, `:618`, `:621`, `sailing/maneuvers.ts:843`, `sailing/sailingAnalytics.ts:460`, `core/shareImage.ts:93`.
- Pièce unique : `core/angles.ts` avec `normalizeDeg`, `signedAngleDeg(a, b)` (une seule convention de bord, à choisir), `circularMean`, et `toRad`/`toDeg` déplacés de `kinematics.ts`. `sailing/wind.ts` réexporte pour ne pas toucher ses appelants.
- Risque : faible ; la convention de bord ±180 de `gpsTurns` doit être gardée telle quelle (un virage de 180° pile). Taille : petit. Confiance : sûr.

### A8. Formatage des durées et du « m:ss »
- Dans `core/units.ts` : `m:ss` avec report de 60 écrit trois fois (`formatPace` 34-36, `formatSpeedValue` 119-121, `formatMinSec` 215-218, et une quatrième variante dans `formatMinSecHours` 204-209) ; `formatClock` 191-195 et `formatMinSecHours` se recouvrent (h:mm:ss) ; `pad` redéfini trois fois (193, 223, 232).
- Hors noyau : `components/ProfileRoot.tsx:54` et `pages/ProfilePage.tsx:88` (« 1 h 05 », variante de `formatDuration` avec espaces), `sailing/sailingAnalytics.ts:208` (« hh:mm » de l'heure, variante de `formatTimeOfDay`), `pad` dans `components/heartRateOrigin.ts:9`, `library/naming.ts:32`, `recording/session.ts:218`.
- Pièce unique : `minutesSeconds(totalMinutes: number): string` (avec report) et `pad2` dans `units.ts`, appelés par les quatre ; `formatDuration(ms, { spaced?: boolean })` pour le Profil ; `formatTimeOfDay(ms, { seconds?: boolean })`.
- Risque : nul si les sorties sont figées par test avant. Taille : petit. Confiance : sûr.

### A9. Bornes de couleur par défaut réparties en 7 endroits
- `sailing/sailingConfig.ts:32`, `running/runningAnalytics.ts:211`, `cycling/cyclingConfig.ts:11`, `surfing/surfConfig.ts:7` (écrit `5 / 3.6` au lieu de `kmhToMs`), `core/sportProfiles.ts:730` (`speedRange` du bateau seul), la table `hooks/useSportSettings.ts:62-69` (`TREATMENT_SPEED_RANGE_MS`), et `speedRangeMs` de huit pré-réglages (`core/activityPresets.ts:59`, `76`, `87`, `98`, `107`, `115`, `135`, `149`).
- Le champ `SportProfile.speedRange` existe (`sportProfiles.ts:431`) mais vaut `null` partout sauf au bateau.
- Pièce unique : `SportProfile.speedRange` rempli pour chaque profil (règle 3 : la valeur vient du profil), la table du hook et les quatre constantes de sport supprimées ; `rangeFollowsPace` (`useSportSettings.ts:83`) teste alors un drapeau `speedRangeFollowsPace` du profil de voile. Question F5.
- Risque : moyen (l'ordre des bornes effectives est une décision de l'utilisateur, à garder exactement). Taille : moyen. Confiance : sûr.

### A10. Valeurs de profil recopiées
- `maxDetourRatio: 3` écrit dans `SAILING_DEFAULTS` (`sportProfiles.ts:555`), `RUNNING_PROFILE` (591), `CYCLING_PROFILE` (626), `SURF_PROFILE` (666) et `DEFAULT_MAX_DETOUR_RATIO = 3` (`kinematics.ts:162`).
- Bloc `AttitudeParams` recopié entre `JUMP_DETECTION` (`sportProfiles.ts:257-259`) et `PUMP_DETECTION` (274-276) : huit valeurs identiques. Proposition : `const ATTITUDE: AttitudeParams = {...}` étalé dans les deux.
- `SurfProfile.maxGapS` (`sportProfiles.ts:362`, valeur 685) double `SportProfile.maxGapS` (le commentaire le dit) ; `surfing/surfAnalysis.ts:143`, `217`, `232` lisent le premier. Proposition : supprimer le champ du bloc surf, passer `profile.maxGapS`.
- `MAX_SAMPLE_S = 10` (`sessionSpeed.ts:32`) est la même notion de trou que `maxGapS` (10 s) sans en venir.
- `recording` du surf (`sportProfiles.ts:679`) égal à `INTERVAL_RECORDING` (121).
- `pauseAfter` (`activityPresets.ts:54`) écrit `0.3`, la valeur de `DEFAULT_RECORDING.autoPauseSpeedMs` (`sportProfiles.ts:113`) ; les pré-réglages `'run-intervals'` (95-103) et `'run-test'` (104-112) sont identiques.
- `RUNNING_PROFILE`, `CYCLING_PROFILE`, `SURF_PROFILE` répètent une dizaine de champs communs (`withoutActiveThreshold`, `speedRange`, `elevation`, `grade`, `maxGapS`, `maxDetourRatio`, `defaultPolarMinSpeed`, `foilDefault`…) que `SAILING_DEFAULTS` factorise pour la voile seulement : un `COMMON_DEFAULTS` étalé dans les quatre.
- `1852` en dur dans la cible « 1 mille » (`sportProfiles.ts:492`) au lieu de `METERS_PER_DISTANCE_UNIT.nm`.
- Risque : nul (mêmes valeurs ; un test qui fige `SPORT_PROFILES` par `toEqual` avant/après le prouve). Taille : petit. Confiance : sûr.

### A11. Garde `isObject` réécrite
- `core/sessionMarks.ts:24`, `core/activities.ts:196`, `core/analysisTabs.ts:143` réécrivent `isObject` de `core/basics.ts:11-12` (une note d'ETAT §3 dit qu'une copie d'une brique commune est une dette).
- Taille : petit. Confiance : sûr.

### A12. Type `LatLon` déclaré 5 fois, `{ lat: number; lon: number }` en ligne 20 fois
- `core/geoPlane.ts:11`, `core/simplify.ts:13`, `recording/followedTrace.ts:17`, `recording/markGuide.ts:22` (exporté), `planning/ignAltimetry.ts:36`.
- Pièce unique : `export interface LatLon` dans `core/types.ts`. Taille : petit. Confiance : sûr.

### A13. Longueur d'un tracé (somme de haversines) écrite 4 fois
- `planning/route.ts:862` (cumul), `planning/surface.ts:310`, `planning/wayMatch.ts:55`, `recording/markGuide.ts:209`. Ce sont des parcours sans temps (la règle 6 ne s'y applique pas).
- Pièce unique : `pathLengthM(points)` et `cumulativeChordsM(points)` dans un `core/geo.ts` (voir C9). Taille : petit. Confiance : sûr.

### A14. Seuil d'arrêt de l'allure écrit trois fois
- `core/units.ts:25` (`minSpeedMs = 0.1`), `pages/LandModule.tsx:691` (`0.3`), `components/IntervalAnalysis.tsx:275` (`MIN_PACE_SPEED_MS`). Trois valeurs différentes pour « trop lent pour une allure ».
- Pièce unique : `PACE_MIN_SPEED_MS` nommé dans `units.ts`, passé à `msToPace`. Risque : les graphes changent si les valeurs s'alignent (question à l'utilisateur, ou garder les trois nommées). Taille : petit. Confiance : sûr.

### A15. Petits doublons internes
- `heartRate.ts:375-388` (`spanHeartRate`) recopie la boucle de `forEachCounted` (55-72), le commentaire le dit ; une version `forEachCounted(points, smoothed, gapS, visit, from, to)` bornée suffit.
- `getSportProfile(sport)` (`sportProfiles.ts:765`, 36 appels) et `SPORT_PROFILES[sport]` (12 appels) : deux chemins pour la même lecture.
- `types/sailing.ts:6-15` recopie les sept clés de `SAILING_TOP_TARGETS` (`sportProfiles.ts:485-493`), et `sailing/sailingStats.ts:29-39` les recopie une troisième fois : `Record<(typeof SAILING_TOP_TARGETS)[number]['key'], TopSegment[]>` avec les cibles en `as const`.
- `simplify.ts` et `geoPlane.ts` déclarent chacun leur `LatLon` (A12).
- Deux générateurs pseudo-aléatoires : `patternTiles.ts:60-63` (`jitter`) et `rootPath.ts:121-130` (`seededRandom`).

## B. Optimisations

Coût mesuré sur 54 000 points (3 h à 5 Hz), poste de l'utilisateur, Node 26. À l'ouverture d'une session de voile avec Doppler, le noyau seul coûte environ 600 ms sur ordinateur (2 à 3 s sur téléphone) : allure 75 + unité 66, cinématique 135 à 212, cadence 22, unité encore 66 (hook), tops 193, statistiques de base 36. Après B1 à B5, environ 200 ms.

### B1. Médiane glissante : une recopie, une copie et un tri par point
- `core/speedFilter.ts:224` : `out[i] = median(values.slice(start, end + 1))`, et `median` (26-33) recopie encore (`[...values]`) puis trie. O(n·w log w) et deux tableaux par point.
- Mesure : 65 ms (fenêtre de 3 s, voile, vélo, surf) et 138 ms (5 s, à pied) ; c'est un tiers de `computeKinematics` (212 ms sans Doppler).
- Proposition : fenêtre triée tenue à jour (insertion et retrait dichotomiques, `splice` sur une vingtaine de valeurs), même parcours à deux curseurs. Prototype (`bench2.ts`) : 7 ms (3 s) et 9 ms (5 s), **0 écart sur 54 000 valeurs** (comparaison `Object.is`), puisque la médiane d'un même multiensemble ne dépend pas de l'ordre d'arrivée. `medianFilterByTimeFrom` garde sa reprise (`from`, `prefix`) : la fenêtre se remplit depuis `start`.
- Le même gain profite au résumé de chaque session à l'import (`library/summary.ts:78-83` refait la cinématique) et au direct (`resumeKinematics`).
- Test de neutralité : copie gelée de l'ancienne fonction dans `speedFilter.test.ts`, comparée par `toEqual` à la nouvelle sur traces 1 Hz, 5 Hz, dates tronquées, trous, valeurs égales, fenêtre de 0 ; les tests de reprise de `kinematics.test.ts` (calcul repris = calcul entier) doivent rester verts ; banc `general.mjs`, texte de la page identique.
- Taille : petit. Confiance : sûr (mesuré).

### B2. Tops : un tableau de 54 000 objets et un tri complet par cible
- `core/topSegments.ts:60-110` : `windows.push({ start, end, val })` pour chaque point, puis `windows.sort` ; `gapCount` (64-67) refait pour chaque cible ; `toDisplaySpeed` appelé 54 000 fois par cible.
- Mesure : 193 ms pour les 7 cibles de la voile, 161 ms pour les 9 du vélo. `pages/LandModule.tsx:557` et `:569` appellent `computeAllTopSegments` deux fois sur la même trace (unités différentes) ; `recording/liveStats.ts:266` l'appelle à chaque mise à jour du direct.
- Proposition : valeurs et fins dans deux `Float64Array`/`Int32Array`, puis sélection par balayages successifs (le meilleur qui ne chevauche pas les choisis, premier à égalité), soit O(count·n) sans tri ; `gapCount` calculé une fois dans `computeAllTopSegments` ; classement en m/s, conversion seulement des trois retenus (corrige D2 en passant). Prototype : 129 → 27 ms pour la voile, **0 écart** de vitesse sur les 16 cibles voile et vélo.
- Test de neutralité : pour chaque profil et chaque cible, `toEqual` sur `val`, `speed` et `path` entre copie gelée et nouvelle version ; trace à vitesse constante (égalités partout) pour l'ordre ; `count` 1 et 3 ; trace avec trous et pauses.
- Taille : petit. Confiance : sûr (mesuré). À faire avec A2.

### B3. Les dates relues 4 à 5 fois à l'ouverture
- `pointTimeMs` (`kinematics.ts:48-49`, `new Date(iso)`) coûte 32 ms par passage. Passages à l'ouverture : `referenceSpeedMs` (`sessionSpeed.ts:67`), `detectTrackDeviceSpeedUnit` appelé par lui (`kinematics.ts:145`, si Doppler), `samplingIntervalS` (`sessionSpeed.ts:110-112`), `runKinematics` (`kinematics.ts:393`), et `detectTrackDeviceSpeedUnit` encore depuis `hooks/useGpxSession.ts:110`. Environ 130 à 160 ms de lecture de dates.
- Proposition : `parseGpx` pose `timeMs` sur chaque `RawTrackPoint` (champ facultatif, lu par `pointTimeMs` s'il existe) ; `recording/` (`toRawPoint`) le pose aussi. Gain ≈ 100 ms.
- Risque : une date illisible doit donner le même `NaN` qu'avant ; le direct construit ses points ailleurs.
- Test de neutralité : `computeKinematics`, `referenceSpeedMs`, `samplingIntervalS` sur les mêmes points avec et sans `timeMs` → `toEqual`.
- Taille : petit. Confiance : sûr.

### B4. Unité du Doppler détectée trois fois, de deux façons
- `referenceSpeedMs` l'appelle (`sessionSpeed.ts:62`), le hook aussi (`useGpxSession.ts:110`), et `runKinematics` refait sa propre détection (`kinematics.ts:454-475`). 66 ms par détection (dates, répartition, haversines, tri des rapports).
- Proposition : une détection, passée en option à `referenceSpeedMs(points, unit?)` et à `computeKinematics` (`deviceSpeedUnit?`) ; le hook la mémorise. Voir D6 : les deux détections ne lisent pas les mêmes vitesses dérivées, donc le changement n'est neutre que si l'on garde celle de la cinématique pour la cinématique.
- Test : les trois appelants donnent les mêmes chiffres avec et sans unité passée, sur des traces en m/s, km/h et nœuds.
- Taille : petit. Confiance : sûr.

### B5. `referenceSpeedMs` et `samplingIntervalS` : tris d'objets
- `sessionSpeed.ts:65-84` : 54 000 objets `{ speed, weight }` triés (75 ms en tout avec les dates) ; `samplingIntervalS` (106-121) trie un tableau de nombres (22 ms avec les dates).
- Proposition : deux `Float64Array` et un tri d'indices (`Uint32Array`), ou une sélection pondérée ; dates partagées (B3). Gain estimé : 75 → 25 ms, 22 → 5 ms.
- Test : `toBe` exact sur 1 Hz, 5 Hz, dates égales, trous (les tests 1 Hz / 5 Hz existants couvrent l'invariance).
- Taille : petit. Confiance : probable (non prototypé).

### B6. Sauts de position : deux haversines déjà calculées
- `kinematics.ts:207-208` recalcule `inM` et `outM`, déjà dans `chordsM` (`kinematics.ts:405`). Mesure : `detourSpikes` 13 ms, dont deux tiers évitables.
- Proposition : passer `chordsM` à `detourSpikesFrom`. Test : `toEqual` des sauts et de la trace. Taille : petit. Confiance : sûr. Gain faible.

### B7. Altitude de la voile calculée pour rien
- `sailing/sailingStats.ts:66-73` appelle `buildBaseSessionStats` sans `elevationStats` : `computeElevationStats` (`sessionStats.ts:240-241`) tourne (25 ms) alors que la voile n'affiche pas le dénivelé (`elevationGain` n'est lu que par `LandModule.tsx:753`, `:767`).
- Proposition : passer `EMPTY_ELEVATION` en voile. Test : textes de l'analyse de voile identiques au banc. Taille : petit. Confiance : à vérifier (`hasElevation` lu ailleurs ?).

### B8. Lissage d'altitude en O(n·w)
- `speedFilter.ts:259-268` refait les sommes de la droite pour chaque point : 19 ms à 20 s et 5 Hz (100 points par fenêtre), 30 ms en « trail » (30 s).
- Proposition : sommes cumulées de x, x², y, xy (x relatif à une origine fixe, en secondes) : O(n). Les résultats diffèrent au dernier chiffre (arrondis), donc **pas de neutralité exacte** : tolérance 1e-9 m et dénivelé arrondi au mètre identique sur les traces de test. Question F4.
- Taille : petit. Confiance : sûr pour le gain, décision pour la tolérance.

### B9. Couleur de chaque trait recalculée en texte
- `speedGradient.ts:44` alloue un tableau et une chaîne par point (`a.rgb.map`, gabarit `rgb(...)`) ; `trackColorSegments` (`trackColor.ts:65-72`) : 40 ms à pied (moyenne de 15 s comprise).
- Proposition : table de 256 ou 1024 couleurs précalculées. Changerait l'arrondi d'une composante sur certaines vitesses : pas neutre au pixel près. Gain faible, à garder pour plus tard.

### B10. Masque d'activité recalculé
- `sailing/sailingStats.ts:59` et `:90` (`sailingFlights`) recalculent le même masque au même seuil ; `library/summary.ts:157` et `:160` en calculent deux. 7,5 ms chacun : mémoriser dans le hook. Gain faible.

### B11. Direct de l'enregistrement (hors zone, pour mémoire)
- `recording/liveStats.ts:366-368` recalcule les cumuls du segment ouvert puis refait la même somme de `segmentDistanceM` (la distance est déjà `cum.cumDist` au dernier point) ; `bestRecentTop` (275-283) filtre et recalcule les cumuls à chaque mise à jour. `resumeKinematics` recopie une dizaine de tableaux à chaque appel (`kinematics.ts:387-400`, `518`) : O(n) par mise à jour, acceptable à 1 Hz.

### B12. Lecteur GPX : recherche de tous les descendants pour chaque champ absent
- `gpxParser.ts:38-47` : quand un champ manque (`speed`, `course`, `cad`, souvent `hr`), `getElementsByTagName('*')` parcourt tous les descendants du point ; avec un espace de noms (`gpxtpx:hr`), la recherche directe échoue toujours. Six recherches par point.
- Proposition : un seul parcours des descendants par point, rangés par nom local. Gain à mesurer au banc (DOM du navigateur, non mesurable en Node).

### Comment mesurer
Un script de banc (sur le modèle de `bench.ts`, compilé par rolldown dans un dossier temporaire) qui chronomètre chaque étape sur une trace synthétique de 54 000 points, avant et après ; et `outils/banc/general.mjs` pour le texte de la page.

## C. Architecture

### C1. Le noyau importe d'autres dossiers (table de l'ETAT §3 : `core` dépend de `core` seulement)
- `core/activityPresets.ts:4-12` : huit imports de types depuis `cycling/energy`, `planning/duration`, `planning/brouterProfile`, `recording/intervalTimer`, `recording/jumpSettings`, `recording/liveFields`, `recording/markGuide`, `running/energy`, `running/runningAnalytics`. Son seul appelant est `hooks/useSportSettings.ts` : sa place est à côté de lui (ou dans un dossier `settings/`).
- `core/sportProfiles.ts:4` : `CadenceDetection` vient de `running/cadence.ts`, alors que `JumpDetection` et `PumpDetection` vivent dans le noyau. Proposition : déplacer l'interface dans le noyau.
- `core/heartRateSession.ts:6` : `IntervalSeries` vient de `recording/intervalTimer.ts`. Proposition : déplacer le type, ou le fichier dans `running/`.
- Tous sont des `import type` : pas de cycle à l'exécution, mais la règle de dépendance est fausse. Taille : petit.

### C2. Règle 1 : le noyau rend du texte formaté
- `types.ts:89-95` (`TopSegment.val`, texte dans l'unité d'affichage) et `types.ts:109-144` (`BaseSessionStats` : `totalTime`, `activeTime`, `activeRatio`, `elevationGain`… en chaînes, à côté de champs SI).
- `topSegments.ts:93` classe les fenêtres **en unité d'affichage** (`toDisplaySpeed` passé par l'appelant) : voir D2.
- Conséquence : `LandModule.tsx:557` et `:569` calculent deux fois les tops pour avoir deux unités ; `library/summary.ts` recalcule ses propres nombres.
- Proposition (gros, décision de l'utilisateur, question F2) : le noyau rend des m/s, des secondes et des mètres ; un `formatBaseStats(stats, units)` en sortie.

### C3. Pièces d'interface dans le noyau
- `patternTiles.ts` (365 lignes, dessins des fonds de page), `rootPath.ts` (524, racine du Profil), `shareImage.ts` (mise en page de l'image), `mapBase.ts` et `tiles.ts` (adresses de tuiles, cache), `parentPage.ts` (routage), `analysisTabs.ts`, `activityIcons.ts`, `displayConfig.ts`, et `FAMILY_ACCENT` (variables CSS, `activities.ts:177-179`).
- Elles sont pures et testées, mais l'ETAT décrit le noyau comme « du parseur GPX aux profils de support ». Proposition : un dossier `src/ui/` (pur, testé en node) ; déplacement mécanique. Question F3. Taille : moyen (imports à réécrire), risque nul.

### C4. Règle 3 : seuils dupliqués ou hors profil
- Voir A10 (`MAX_SAMPLE_S`, `DEFAULT_MAX_DETOUR_RATIO`, `SurfProfile.maxGapS`, `pauseAfter`) et A9 (bornes de couleur hors de `SportProfile`).
- `TRACK_COLOR_SMOOTHING_S` (`trackColor.ts:19-26`) est une table par traitement hors du profil, ni surchargeable ni persistée ; c'est une décision d'affichage (CLAUDE.md), à laisser, mais elle irait naturellement dans `SportProfile`.
- `gpxParser.ts:84` (`speed > 100`) : borne en dur avant la détection d'unité ; un fichier en km/h au-delà de 100 km/h perd sa vitesse appareil. Sans conséquence aujourd'hui.

### C5. Règle 6 : la vue en nœuds perd la distance d'un trou
- `utils/kinematics.ts:27-36` (`toPointData`) ne recopie ni `gapDistanceM`, ni `speedSource`, ni `courseDeg` : la voile ne peut pas appliquer `segmentDistanceM` et intègre elle-même (`sailing/maneuvers.ts:818`, `:843`, avec `smoothedSpeed`). Proposition : porter `gapDistanceM` dans `PointData` ; aucune conversion globale (règle 5).
- `utils/` ne contient que cet adaptateur et `types/` que `sailing.ts` : les deux vont naturellement dans `sailing/` (`sailing/pointData.ts`, `sailing/types.ts`), quatre importeurs. Petit, mécanique.

### C6. Géométrie rangée dans la cinématique
- `EARTH_RADIUS_M`, `toRad`, `toDeg`, `haversineDistance`, `initialBearing` sont dans `kinematics.ts:11-45` ; `geoPlane.ts:1`, `simplify.ts:1`, `planning/*`, `recording/*` importent la cinématique pour de la géométrie. Proposition : `core/geo.ts` (géodésie, plan local, longueur d'un tracé : A6, A13), `kinematics.ts` réexporte le temps de la migration.

### C7. Angles du noyau dans la voile
- `normalizeAngle`, `angleDiff`, `circularMean` vivent dans `sailing/wind.ts:24-113` et servent hors voile (`recording/liveLegs.ts`) ; voir A7.

### C8. `units.ts` : un défaut qui cache les oublis
- `toDisplaySpeed`, `formatPace`, `msToPace` prennent `distanceUnit = 'km'` par défaut (`units.ts:25`, `31`, `40`) : un appel qui oublie l'unité de distance affiche une allure au kilomètre pour une activité en milles (voir D9). Proposition : paramètre obligatoire quand l'unité est `minkm` (surcharge de types), ou un objet `DisplayUnits` passé partout.

### C9. Hors zone, relevé au passage
- `platform/` importe le noyau (`heartRate`, `tiles`, `units`, `beepDurations`) alors que l'ETAT §3 le dit dépendant de Capacitor seulement : la table de l'ETAT est à corriger ou la règle à préciser.

## D. Bugs probables

### D1. Cadence affichée fausse sur un fichier à 5 Hz aux dates tronquées
- `sessionSpeed.ts:106-121` (`samplingIntervalS`) ignore les écarts nuls (`timeMs > previousMs`) et ne répartit pas les dates égales, contrairement à toute la cinématique (`spreadEqualTimes`). Trace à 5 Hz dont les dates sont tronquées à la seconde : écarts retenus de 1 s, médiane 1 s ; `SailingModule.tsx:792` affiche « un toutes les 1.0 s » au lieu de 0,2 s, et `summary.samplingS` range 1 (`library/summary.ts:203`). Le seuil de trace clairsemée d'`IntervalAnalysis.tsx:330` lit la même valeur.
- Correction : passer par `spreadEqualTimes`. Test : trace 5 Hz tronquée, attendu 0,2.
- Confiance : sûr (lecture) ; impact : un chiffre d'information, aucun calcul.

### D2. Tops classés dans l'unité d'affichage
- `topSegments.ts:93` et `:110` : la meilleure fenêtre est celle de plus grande valeur **convertie**. Avec une unité inverse (`minkm`, allure), la « meilleure » serait la plus lente. Aujourd'hui `LandModule.tsx:554` remplace l'allure par des km/h avant l'appel : bug latent, qui ressortira au premier appelant qui passe `toDisplaySpeed(ms, 'minkm')`.
- Correction : classer en m/s, convertir les retenus (B2). Confiance : sûr (latent).

### D3. Vitesse au décollage : brute pour les sauts, lissée pour le pumping
- `jumps.ts:345-358` et `:395` lisent `speedMs` (vitesse retenue, non lissée) ; `pumping.ts:267` lit `smoothedSpeedMs`. Le filtre d'affichage des sauts compare cette vitesse au seuil d'activité, lui-même jugé sur la vitesse lissée (`sessionStats.ts:101`). Un saut pris dans un pic de vitesse brute passe le seuil alors que le masque dit « hors action », et l'inverse. Question F1.
- Confiance : probable (incohérence certaine, intention à confirmer).

### D4. Longueur d'un saut hors de la règle 6
- `jumps.ts:361-370` intègre la vitesse interpolée en trapèzes, sans `gapDistanceM` ni `segmentStart`, au lieu de lire `cumDist` comme le pumping (A3). Écart faible sur un vol de 1 s ; plus grand si le vol tombe sur un trou de trace (téléphone sous l'eau après la réception).
- Confiance : sûr pour l'écart de méthode, faible pour l'impact.

### D5. Fin de plage FC décalée d'une milliseconde
- `heartRate.ts:440` : `firstIndexAtOrAfterTime(points, endMs + 1) - 1` prend aussi les points datés dans ]endMs ; endMs + 1[, or `spreadEqualTimes` produit des dates fractionnaires (1000/3 ms). `lastIndexAtOrBeforeTime` (`search.ts:35-36`) existe pour ça.
- Confiance : sûr ; impact très faible.

### D6. Deux détections de l'unité du Doppler qui peuvent diverger
- `referenceSpeedMs` et le hook lisent `detectTrackDeviceSpeedUnit` (`kinematics.ts:143-156`, vitesses dérivées brutes), la cinématique sa propre détection (`kinematics.ts:454-475`, vitesses dérivées après reprise de pause et correction des sauts de position). Sur un fichier limite, l'allure de la session (donc les seuils de filtrage, `sessionFilterThresholds`) serait calculée dans une unité et la cinématique dans l'autre.
- Confiance : à vérifier (la médiane des rapports rend le cas rare).

### D7. Allure de la session tirée vers le bas par les pauses
- `sessionSpeed.ts:69-80` : le pas qui enjambe une pause (`segmentStart`) et le pas d'un trou entrent dans le neuvième décile avec un poids de 10 s et une vitesse dérivée presque nulle. Une session à nombreuses pauses automatiques sous-estime un peu son allure, donc ses seuils accordés (voile).
- Confiance : à vérifier ; impact faible.

### D8. `Math.min(...tableau)` sur une série entière
- `heartRateSession.ts:130-131` (toutes les FC d'une session sans trace) et `heartRate.ts:262-263` (clés de l'histogramme, au plus 226). `elevation.ts:164-165` met justement en garde contre ce motif. Une séance de plusieurs heures à mesures rapprochées approche la limite d'arguments du moteur.
- Confiance : faible (1 Hz : 36 000 valeurs pour 10 h, sous la limite).

### D9. Allure au kilomètre pour une activité en milles
- Appels de `toDisplaySpeed` sans `distanceUnit` avec une unité qui peut être `minkm` : `components/SpeedGradientLegend.tsx:25-26`, `components/FitnessTestPanel.tsx:89`, `components/HeartRatePanel.tsx:141` (C8).
- Confiance : à vérifier (combinaison « allure + milles » rare).

### D10. Distances de manœuvre sur la vitesse lissée (hors zone, voile)
- `sailing/maneuvers.ts:818` et `:843` intègrent `smoothedSpeed`, le commentaire (825-826) parle de « vitesse retenue » (`speed` dans `PointData`). La règle 6 désigne la vitesse retenue (`segmentDistanceM`).
- Confiance : à vérifier avec l'audit de la voile (peut être voulu).

### D11. `readActivities` rend le tableau des défauts lui-même
- `activities.ts:192` : sans liste rangée, la fonction rend `DEFAULT_ACTIVITIES`, la constante du module. Un appelant qui la modifierait en place changerait les défauts pour toute la session.
- Confiance : à vérifier (aucune mutation vue au passage).

### D12. Texte d'un doute figé
- `jumps.ts:105` : « plus de 10 cm » en dur, alors que la borne est `attitudeMaxErrorM` (`sportProfiles.ts:264`, 0,1). Changer le réglage laisserait le texte faux. Confiance : sûr ; impact nul aujourd'hui.

## E. Code mort

Vérifié par un balayage de tous les `export` de la zone (461) contre tout `src/`, puis à la main contre `outils/`.
- **Façades réservées aux tests** (la production passe par la version `…From` ou interne) : `medianFilterByTime` (`speedFilter.ts:191-195`), `clampByAcceleration` (`speedFilter.ts:69-80`), `detourSpikes` (`kinematics.ts:180-185`). Ni mortes ni utiles à l'application : garder en les marquant, ou faire porter les tests sur les versions `…From`.
- **Réservés au banc et aux tests** : `imuCaptureStats` (`imuFile.ts:469`, lu par `outils/banc/sauts.mjs`, `sauts-diagnostic.mjs`, `pumping-diagnostic.mjs`), `IMU_VERSION`, `PHONE_STREAMS` (fixture et banc). À garder.
- **Exportés sans raison** (utilisés seulement dans leur fichier, 64 sans aucun test) : entre autres `computeTotalTimeMs` (`sessionStats.ts:48`), `detectDeviceSpeedUnit` (`kinematics.ts:114`), `EMPTY_ELEVATION`, `DEFAULT_MAX_DETOUR_RATIO`, `DEFAULT_MAX_OUTLIER_S`, `SEED_WINDOW_S`, `DEFAULT_TOP_COUNT`, `CHART_EXTREME_TOLERANCE`, `HEART_RATE_ZONE_MODEL`, `FOIL_RATIO_LABEL`, `EXIT_FLOOR_RATIO`, `DEFAULT_RECORDING`, `CYCLING_TOP_TARGETS`, les internes de `pumping.ts` (`pumpStrokes`, `pumpSeries`, `liftoffAt`, `trackValueAt`, `capturedWindows`), `detectFlights`, `REFERENCE_CARD_HEIGHTS`, `REFERENCE_GAP`, `freeSide`, `msToPace`, `toPointData`, et une trentaine de types. Retirer `export` les rend visibles au lint (`noUnusedLocals`).
- **Aucune fonction morte** au sens strict dans la zone.
- Commentaire en retard : `activities.ts:320-336` décrit les versions 2 à 8, `ACTIVITIES_VERSION` vaut 9 (Muscu).

## F. Questions à poser à l'utilisateur

1. Vitesse au décollage d'un saut : la vitesse lissée, comme le pumping et le seuil d'activité, ou la vitesse brute du GPS ? (Défaut : lissée, et la longueur du saut lue sur la distance cumulée ; les sauts déjà rangés sont recalculés.)
2. Faire rendre au noyau des nombres seulement (m/s, s, m) et formater à l'affichage, ce qui touche toutes les pages d'analyse ? (Défaut : oui, mais en lot à part, après les doublons ; les textes affichés restent identiques, prouvé au banc.)
3. Sortir du noyau les pièces d'interface (fonds de page, racine du Profil, image de partage, onglets, retour Android, tuiles) vers un dossier à part ? (Défaut : oui, déplacement sans changement, en fin de plan.)
4. Lissage d'altitude plus rapide, au prix d'écarts au milliardième de mètre (dénivelé affiché inchangé) ? (Défaut : non, le gain est petit ; à revoir si l'ouverture des longues sorties reste lente.)
5. Ranger les couleurs de trace par défaut dans le profil de chaque calcul, à une seule place, en gardant exactement l'ordre actuel des bornes ? (Défaut : oui.)

## G. Chiffres

- Fichiers lus en entier : 41 (38 de `core/` hors tests, la fixture, `utils/kinematics.ts`, `types/sailing.ts`) ; 34 fichiers de test parcourus (comptes de tests dans la carte).
- Lignes : 8 459 de code dans la zone, 4 978 de tests.
- Hors zone lus pour vérifier : `hooks/useGpxSession.ts`, `components/sessionTrack.ts`, `sailing/sailingStats.ts`, `sailing/sailingAnalytics.ts` (VMG), `running/energy.ts` (lissage de la puissance), `recording/liveLegs.ts`, `recording/liveStats.ts`, extraits de `sailing/wind.ts`, `sailing/maneuvers.ts`, `surfing/gpsTurns.ts`, `library/record.ts`.
- Constats : A 15, B 12, C 9, D 12, E 5.
- Mesures (54 000 points) : médiane glissante 65 → 7 ms (3 s) et 138 → 9 ms (5 s), tops voile 129 → 27 ms, tous deux sans écart ; dates 32 ms par passage, 4 à 5 passages à l'ouverture ; détection d'unité 66 ms, 3 fois.
