# 05 · Domaines sportifs (voile, course, vélo, surf)

Audit en lecture seule du 28/10, sur `main` propre (86b3f8d). Zone : `src/sailing/`, `src/running/`, `src/cycling/`, `src/surfing/`. Les 21 fichiers hors tests ont été lus en entier (6 095 lignes) ; les 16 fichiers de tests (4 574 lignes) en diagonale. Pour le contexte, lus aussi : `core/sessionStats.ts`, `core/pumping.ts`, `core/topSegments.ts`, `utils/kinematics.ts`, `hooks/useSailingSession.ts`, une partie de `core/heartRate.ts`, `core/speedFilter.ts` et `core/elevation.ts`, et les appels dans `SailingModule`, `SurfModule`, `LandModule`, `landModules`, `library/summary.ts`, `recording/liveStats.ts` et `recording/liveLegs.ts`.

Le projet exige que toute retouche du noyau voile laisse les chiffres exactement identiques (DECISIONS §1, « mêmes `ManeuverStats` »). Chaque constat dit donc s'il est **neutre** (chiffres identiques, prouvables par `toEqual`) ou s'il **change des chiffres** ; ce second cas demande l'accord de l'utilisateur (section F).

---

## Carte

| Fichier | Lignes | Rôle | Appelants (hors tests) | Testé |
|---|---|---|---|---|
| sailing/maneuvers.ts | 1 516 | Détection des virages (préparée une fois), classement par vent, mesure des manœuvres, estimation du vent par aller-retour polaire ↔ manœuvres | hooks/useSailingSession, sailing/sailingAnalytics | oui (74 tests) |
| sailing/wind.ts | 689 | Angles, moyennes circulaires, courbe du vent, polaire de la trace, `scanTurnWindow`, `observeTurns`, `estimateWindPolar` | useSailingSession, SailingModule, SpeedPolarChart, WindAdjustOverlay, recording/liveLegs, maneuvers, sailingAnalytics | oui (34) |
| sailing/sailingAnalytics.ts | 534 | Statistiques du vent (`calculateWindStats`), graphe du vent, résumé et podiums des manœuvres, VMG | useSailingSession, SailingModule | oui (8) |
| sailing/sailingConfig.ts | 242 | Constantes des manœuvres et du vent, seuils accordés à l'allure de la session, suggestions de seuil et de couleurs | 9 fichiers (hooks, library/summary, recording/liveLegs, components/sessionTrack…) | oui (12) |
| sailing/sailingStats.ts | 92 | Statistiques de session voile (base du noyau + tops), vols pour le pumping | useSailingSession | oui (5) |
| sailing/sessionNotes.ts | 90 | Types et listes des notes de session (matériel, vent, plan d'eau, appréciation) | **toutes familles** : library/record, sessionEdits, stats, GearPicker, SessionNotesPanel, useSessionDraft, useSportSettings | non |
| running/runningAnalytics.ts | 319 | Pente (`computeGrades`), zones de pente, couleurs de pente, `averagePace` | 14 fichiers : vélo, planning, recording, core/activityPresets, composants | oui (31) |
| running/cadence.ts | 598 | Cadence par l'accéléromètre (autocorrélation), unité du GPX, analyse de l'onglet « cadence » | useRecorder, LandModule, library/summary, gpxWriter, CadencePanel, IntervalAnalysis, **core/sportProfiles** (type) | oui (31) |
| running/energy.ts | 381 | Énergie à pied (Minetti, Pandolf + Santee), puissance lissée | landModules, liveStats, useLiveRecording, record, Settings, **core/activityPresets** | oui (28) |
| running/intervalDetection.ts | 273 | Répétitions retrouvées dans la vitesse (Otsu) | LandModule | oui (14) |
| running/intervalStats.ts | 261 | Phases du compteur mesurées sur la trace, profil par répétition, synthèse | LandModule, IntervalAnalysis, intervalDetection | oui (13) |
| running/fitnessTestResults.ts | 131 | Résultats du test de FC max | FitnessTestPanel, library/record, library/summary | oui (5) |
| running/restingHrResults.ts | 146 | Résultat du test de FC repos et sa **relecture du stockage** | useRestingHrResults, useRestingHrTest, RestingHrTestPage | oui (16) |
| running/types.ts | 10 | `RunningSessionStats = BaseSessionStats` | LandModule | — |
| cycling/energy.ts | 276 | Énergie à vélo (Martin 1998), types de vélo, roulement par revêtement | landModules, liveStats, planning/duration, planning/route, record, Settings, **core/activityPresets** | oui (20) |
| cycling/cyclingConfig.ts | 14 | Bornes de couleur par défaut du vélo | useSportSettings | non |
| surfing/surfAnalysis.ts | 352 | Découpage du surf (glisse, rame, attente, trou), vagues, vols, remontées, résumé | SurfModule, surfSession, surfing/pumping | oui (16) |
| surfing/surfSession.ts | 56 | Masques aux seuils de la session, puis analyse et résumé | SurfModule, library/summary | non |
| surfing/gpsTurns.ts | 69 | Changements de direction d'une vague (hystérésis) | surfAnalysis | oui (4) |
| surfing/pumping.ts | 39 | Élagage du `.imu` du surf autour des glisses | useSessionLibrary | oui (2) |
| surfing/surfConfig.ts | 7 | Bornes de couleur par défaut du surf | useSportSettings | non |

---

## Notions réécrites par domaine

| Notion | Voile | Course / vélo | Surf | core / ailleurs | Verdict |
|---|---|---|---|---|---|
| Distance d'un tronçon | `maneuvers.distanceBetween` l. 813-821 et `distanceAlongBetween` 831-846 (vitesse **lissée** en nœuds, sans `gapDistanceM`) | `segmentDistanceM` partout (energy 274, cycling 239, cadence 308/448, runningAnalytics 158) | `cum.cumDist` | `core/sessionStats.segmentDistanceM` l. 24 | La voile s'écarte de la règle 6 (C3, D2) |
| Découpage en tronçons (vol, vague, répétition) | `sailingFlights` → `activeRuns` + `flightSpans` (sailingStats 85-92) | répétitions : `intervalDetection` 219-243 (grille de 1 s, à part) | `keptRuns` + `spanOf` (surfAnalysis 114-128) | `core/sessionStats.activeRuns`, `core/pumping.flightSpans` | `spanOf` et `flightSpans` font le même travail (A3) |
| Type « tronçon » | `FlightSpan` (core/pumping 77) | `IntervalPhaseSpan`/`Stats` (intervalStats 14-29), `Effort` (intervalDetection 47) | `SurfSpan` (surfAnalysis 40-54) | `ActiveRun` (sessionStats 161) | Il faut un type de base commun (A3, C9) |
| Meilleure fenêtre sur une durée | tops `computeSailingTops` (core), podium VMG `getTopVmg` (sailingAnalytics 505-524) | cadence max `analyzeCadence` 476-495 | — | `core/topSegments` 47-124 ; FC repos `restingHrResult` 194-209 | Le podium de la VMG copie celui des tops (A2) |
| Vitesse max | top 2 s (distance ÷ durée) | tops (LandModule) | max de la vitesse lissée d'un point, sur les vagues (`spanOf` 118) | library/summary 185-186 : max de la vitesse lissée d'un point | **3 définitions** (F3) |
| Masque d'activité au seuil | `thresholdActivityMask` (core) ×3 par mouvement du seuil (B2) | `thresholdActivityMask` | `surfSession.maskAt` 29-39 | `core/sessionStats.thresholdActivityMask` 135-152 | `maskAt` copie la branche « avec seuil » (A6) |
| Arrêt, attente | plancher `stillThreshold` (1 nd) | `stillThreshold` | `SurfProfile.stillMs` (0,5 m/s) **et** `stillThreshold` (2 km/h) | — | Deux planchers d'arrêt en surf (C8, F6) |
| Pumping | `measureFlightPumping` (core) ; colle dans SailingModule 323-331 | — | même calcul ; colle dans SurfModule 302-311 | `core/pumping.ts` | Le calcul est déjà commun ; la colle de l'interface est copiée (A7) |
| Énergie | — | `computeEnergy` (energy 240-308) et `computeCyclingEnergy` (cycling 204-276) | — | — | Même squelette, deux fois (A1) |
| Zones de pente | — | `computeZoneStats` 138-178, `computeEnergy` byZone 252-287, `computeCyclingEnergy` byZone 215-255, `analyzeCadence` byGrade 517-526 | — | — | 4 accumulateurs ; la pente manquante n'est pas traitée pareil (D6) |
| Tracé à montrer sur la carte (suite de pas qui vérifient une condition) | — | `gradeZonePaths` 187-208, `cadenceBandPaths` 577-598 | — | `heartRateZonePaths` (core/heartRate 408-427) | 3 copies (A4) |
| Statistique sur une plage de temps (une répétition) | — | `timeSpanCadence` 557-570 (parcourt toute la trace) | — | `timeSpanHeartRate` (core/heartRate 431, par dichotomie) | Deux façons de faire (A5, B4) |
| Valeur à un instant (interpolée ou point le plus proche) | — | `intervalStats.sampleAt` 32-43, `fitnessTestResults.valueAt` 41-54, `cadence.cadenceAt` 271-274 | — | `core/pumping.trackValueAt` 208-222, `core/jumps.trackIndexAtTime` 404 | 3 à 5 variantes (A8) |
| Moyenne glissante | — | `cadence.removeMovingMean` 156-173, `cadence.smoothByTime` 349-368, lissage en ligne `intervalDetection` 186-195 | — | `core/imuVertical.centredMean` 206, `core/speedFilter.meanFilterByTime` 281 | 3 copies, avec ou sans trous (A9) |
| Angles | `angleDiff`, `normalizeAngle` (wind 24-30) | — | `gpsTurns.signedDelta` 19-22 | `library/record.normalizeDeg` 443 | 3 copies ; le domaine voile est importé par recording (C2) |
| Cap d'un pas | `bearing` seul (`toPointData` jette `courseDeg`) | — | `courseDeg ?? bearing` (gpsTurns 24) | — | Les deux domaines ne lisent pas le cap pareil (C10, F5) |
| Bandes (zones) | — | `zoneOf` de core/heartRate repris pour la cadence (cadence 501, 589) | — | core/heartRate 221 | Un nom trompeur ; la fonction devrait être générique (A10) |
| Moyenne, nombre ou null | — | `intervalStats.average` 182, `holdRatioOf.mean` 140 | `surfAnalysis.mean` 303 | — | Petites copies (A10) |
| Splits kilométriques | — | aucun calcul dans `running/` | — | — | Rien à fusionner |
| Zones de FC | — | ni recopiées ni recalculées dans `running/` (tout passe par core/heartRate) | — | core/heartRate | Rien à fusionner |

---

## A. Doublons

Classés du plus important au moins important.

### A1. Énergie à pied et à vélo : même boucle, deux fois
- **Copies** : `running/energy.ts:240-308` (`computeEnergy`) et `cycling/energy.ts:204-276` (`computeCyclingEnergy`).
- **Identique ou différent** : le squelette est le même : 5 accumulateurs par zone écrits à la main (252-258 / 215-221), repos × dt, `cumulativeTotal`, puissance mécanique = travail / dt, zone de pente avec `classifyGrade(...) ?? 'flat'`, et `zones: gradeZones(...).map(...)` à la fin. Seuls changent le coût d'un pas et l'unité du résultat : par kilo à pied (`netJkg`, `mechanicalPowerWkg`), en absolu à vélo (`netJ`, `mechanicalPowerW`). Les appelants recollent les deux formes : `recording/liveStats.ts:254-261` multiplie par la masse à pied, `pages/landModules.tsx:140-143` et `245-246` font de même.
- **Pièce unique proposée** : `core/energy.ts` (ou `core/grade.ts`, voir C1) :
  `integrateEnergy(track: TrackPoint[], grades: number[], mask: boolean[], restRate: number, stepCost: (i: number, distanceM: number, dtS: number, grade: number) => { net: number; mechanical: number }, zones: GradeProfile): EnergyIntegration`
  Elle rend `{ mechanicalPower[], cumulativeTotal[], net, mechanical, rest, total, movingTimeS, movingDistanceM, zones[] }` dans une unité unique (J ou J/kg, au choix de l'appelant). `computeEnergy` et `computeCyclingEnergy` ne gardent que leur `stepCost` (Minetti ou Pandolf, Martin) ; le vélo ajoute son `surfaceDistanceM` dans son `stepCost`.
- **Risque** : faible. Les deux fonctions ont 48 tests (`running/energy.test.ts`, `cycling/energy.test.ts`) ; la neutralité se prouve par `toEqual` sur leurs sorties, avant et après.
- **Taille** : petit à moyen. **Confiance** : sûr.

### A2. Podium des meilleures fenêtres : la VMG recopie les tops
- **Copies** : `sailing/sailingAnalytics.ts:505-524` (`getTopVmg`) et `core/topSegments.ts:110-122`.
- **Identique ou différent** : identique ligne pour ligne : tri décroissant, rejet des fenêtres qui en chevauchent une retenue (`Math.max(start) <= Math.min(end)`), tracé par `track.slice(...).map(...)`, et complément par `{ val: '-', path: [] }` jusqu'à 3. La seule différence est le champ `speed`, absent côté VMG.
- **Pièce unique proposée** : dans `core/topSegments.ts`, `pickNonOverlapping<W extends { start: number; end: number; val: number }>(windows: W[], count: number): W[]`, avec un tri stable inchangé. `computeTopSegments` et `getTopVmg` l'appellent, puis chacun construit ses tracés.
- **Risque** : nul si le tri reste stable (`Array.prototype.sort` l'est). **Taille** : petit. **Confiance** : sûr.

### A3. Tronçons : `spanOf` (surf) et `flightSpans` (core) font la même mesure ; quatre types voisins
- **Copies** : `surfing/surfAnalysis.ts:114-123` (`spanOf`) et `125-128` (`keptRuns`) d'un côté ; `core/pumping.ts:93-104` (`flightSpans`) de l'autre.
- **Identique ou différent** : les deux calculent `n, start, end, startMs, endMs, durationS = Δt, distanceM = Δ cumDist` depuis un `ActiveRun`. Le surf ajoute `maxSpeedMs` et `avgSpeedMs` et filtre sur durée **et** distance ; le core filtre sur la durée seule.
- **Types quasi identiques** : `FlightSpan` (core/pumping 77-86), `SurfSpan` (surfAnalysis 40-54 : les mêmes champs + vitesses), `IntervalPhaseStats` (intervalStats 21-29 : `startMs/endMs/durationS/distanceM`, sans indices), `Effort` (intervalDetection 47), `ActiveRun` (core/sessionStats 161).
- **Pièce unique proposée** : dans `core/sessionStats.ts`, `interface TrackSpan { start: number; end: number; startMs: number; endMs: number; durationS: number; distanceM: number }` et `spanOfRun(track: TrackPoint[], cum: CumulativeTrack, run: ActiveRun): TrackSpan`. Ensuite `FlightSpan = TrackSpan & { n: number }` et `SurfSpan extends FlightSpan { maxSpeedMs; avgSpeedMs }` ; `flightSpans` et `spanOf` s'appuient sur `spanOfRun`.
- **Risque** : faible (types et calcul identiques). **Taille** : petit. **Confiance** : sûr.

### A4. « Tracés d'une zone sur la carte » : trois copies
- **Copies** : `running/runningAnalytics.ts:187-208` (`gradeZonePaths`), `running/cadence.ts:577-598` (`cadenceBandPaths`), `core/heartRate.ts:408-427` (`heartRateZonePaths`).
- **Identique ou différent** : même motif. Pour chaque pas `i` retenu, on ouvre un tracé en `[i-1]` s'il ne prolonge pas le précédent, puis on pousse `[i]`. Seuls changent le prédicat et la façon d'énumérer : pas par pas, segments mesurés, ou intervalles comptés de la FC avec `from`.
- **Pièce unique proposée** : dans `core/trackPaths.ts`, `pathsWhere(points: ReadonlyArray<{ lat: number; lon: number }>, steps: Iterable<{ from: number; to: number }>, keep: (from: number, to: number) => boolean): [number, number][][]`.
- **Risque** : faible ; les trois fonctions ont des tests. **Taille** : petit. **Confiance** : sûr.

### A5. Statistique d'une plage de temps (répétition) : cadence et FC ne le font pas pareil
- **Copies** : `running/cadence.ts:557-570` (`timeSpanCadence`) et `core/heartRate.ts:431-442` (`timeSpanHeartRate`).
- **Différent** : la FC borne la plage par dichotomie (`firstIndexAtOrAfterTime`). La cadence reconstruit à **chaque appel** `measuredSegments` sur **toute** la trace (441-451 : un objet par pas), puis filtre. Le coût est en B4.
- **Pièce unique proposée** : `measuredSegments` calculé une fois dans `sessionCadence` (ou mémorisé), et `timeSpanCadence(segments, track, startMs, endMs)` qui borne par dichotomie, comme la FC.
- **Risque** : nul (mêmes segments, même ordre de sommation). **Taille** : petit. **Confiance** : sûr.

### A6. Masque d'activité du surf recopié
- **Copies** : `surfing/surfSession.ts:29-39` (`maskAt`) et `core/sessionStats.ts:143-151` (`thresholdActivityMask`, branche avec seuil).
- **Différent** : la seule différence est que `thresholdActivityMask` remplace un seuil ≤ 0 par `stillThreshold`. `maskAt` ne le fait pas : un seuil de 0 en surf rend toute la trace « en glisse ».
- **Pièce unique proposée** : `thresholdActivityMask(track, profile, threshold)` pour la vague et le vol. Le surf a toujours un seuil > 0, donc les chiffres ne bougent pas. À vérifier : un seuil de vague à 0 est-il saisissable ?
- **Risque** : faible. **Taille** : petit. **Confiance** : probable.

### A7. Pumping : le calcul est commun, la colle de l'interface est copiée
- **Copies** : `pages/SailingModule.tsx:323-331` et `pages/SurfModule.tsx:302-311`.
- **Identique** : `flightPumping` (un `useMemo` qui appelle `measureFlightPumping`, puis une `Map` par `n`), `pumpSummary` et `podiumFlights` (tri par durée, 3 premiers) sont les mêmes lignes. Le calcul lui-même est déjà dans `core/pumping.ts` (DECISIONS §1 : « la mesure du surf »), donc la copie du calcul signalée par la consigne n'existe plus.
- **Pièce unique proposée** : `hooks/useFlightPumping(recording, detection, track, cum, flights): { byFlight: Map<number, FlightPumping> | null; summary: PumpingSummary | null; podium: FlightSpan[] }`.
- **Risque** : nul. **Taille** : petit. **Confiance** : sûr (hors de la zone, mais demandé au point a).

### A8. Lire une valeur de la trace à un instant : 3 à 5 variantes
- **Copies** : `running/intervalStats.ts:32-43` (`sampleAt` : distance cumulée et position interpolées), `core/pumping.ts:208-222` (`trackValueAt` : interpolation, avec sa propre dichotomie), `running/fitnessTestResults.ts:41-54` (`valueAt` : point le plus proche, à moins de `gapMs`), `core/jumps.ts:404-415` (`trackIndexAtTime` : indice le plus proche, avec sa propre dichotomie), `running/cadence.ts:271-274` (`cadenceAt` : grille régulière).
- **Différent** : interpolation ou point le plus proche ; deux dichotomies écrites à la main alors que `core/search.ts` en fournit (`lastIndexAtOrBeforeTime`).
- **Pièce unique proposée** : dans `core/search.ts`, `interpolateAtTime(points, value: (i: number) => number, ms: number): number` et `nearestIndexAtTime(points, ms: number, maxGapMs?: number): number`, toutes deux sur `lastIndexAtOrBeforeTime`. `sampleAt` devient deux appels à `interpolateAtTime` (distance, lat/lon).
- **Risque** : aux bords. `sampleAt` ramène `t` dans la trace, `trackValueAt` aussi ; à garder à l'identique. **Taille** : petit. **Confiance** : sûr.

### A9. Moyennes glissantes recopiées
- **Copies** : `running/cadence.ts:156-173` (`removeMovingMean`, sommes cumulées, sans les NaN), `core/imuVertical.ts:206-227` (`centredMean`, fenêtre glissante, sans traitement des NaN), `running/cadence.ts:349-368` (`smoothByTime`, par le temps, sans les `null`), `core/speedFilter.ts:281-312` (`meanFilterByTime`, par le temps, sans `null`), `running/intervalDetection.ts:186-195` (moyenne centrée en O(n·w), écrite en ligne). Le lissage de la FC (`core/heartRate.smoothHeartRate` 31-50) suit le même motif que `smoothByTime`, mais coupe aux trous de plus de `gapS`.
- **Pièce unique proposée** : dans `core/speedFilter.ts`, `meanByTime(values: readonly (number | null)[], timesMs: readonly number[], windowS: number, gapS = Infinity): (number | null)[]`, qui ignore les `null` et peut couper aux trous ; et, pour les grilles régulières, `centredMean(a, half, { skipNaN })`.
- **Risque** : ordre de sommation. Pour une neutralité exacte, les sommes cumulées et la fenêtre glissante ne donnent pas les mêmes bits : garder l'algorithme de chaque appelant tant que les tests de neutralité ne passent pas. **Taille** : moyen. **Confiance** : probable.

### A10. Petites copies
- Angles : `sailing/wind.ts:24-30` (`angleDiff`, `normalizeAngle`) ; `surfing/gpsTurns.ts:19-22` (`signedDelta`, qui rend ]−180, 180] au lieu de [−180, 180[) ; `library/record.ts:443` (`normalizeDeg`). À regrouper dans `core/angles.ts` (voir C2).
- `zoneOf` (core/heartRate 221) sert aux tranches de cadence (cadence 501, 589) : à renommer `bandIndex` dans `core/basics.ts`.
- Moyenne d'une liste : `surfAnalysis.ts:303`, `intervalStats.ts:140` et `182`. À remplacer par `meanOf(values): number | null` dans `core/basics.ts`.
- `numOrNull` : `running/restingHrResults.ts:110` et `recording/fitnessTest.ts:235`, identiques. À déplacer dans `core/basics.ts`.
- `windAt` (`sailing/maneuvers.ts:218-219`) et `resolveWind` (`sailing/sailingAnalytics.ts:80-81`) sont identiques ; à exporter une seule fois, de `maneuvers.ts`.
- Couleur de pente : `gradeGradientColor` (runningAnalytics 245-249) et `gradeStepColor` (258-263) dupliquent le calcul de `steepness` ; la première vaut la seconde sans arrondi au palier.
- Bornes de couleur par défaut, une par famille, réparties dans 4 fichiers : `sailingConfig.ts:32`, `runningAnalytics.ts:221`, `cyclingConfig.ts:11`, `surfConfig.ts:7` (ce dernier écrit `5 / 3.6` au lieu de `kmhToMs`). À regrouper dans `core/speedGradient.ts` ou dans le traitement (`sportTreatment`).
- Tests : un `buildTrack` synthétique dans 6 fichiers de tests (maneuvers, sailingConfig, sailingStats, energy, intervalDetection, fitnessTestResults). Une fixture commune (`core/trackSynthetic.fixture.ts`, sur le modèle d'`imuSynthetic.fixture.ts`) éviterait les écarts.
- **Taille** : petit. **Confiance** : sûr.

---

## B. Optimisations

Coûts estimés pour une session de 3 h à 5 Hz (54 000 points). Le cas critique est le mouvement du seuil d'activité dans l'analyse voile : `useSailingSession` y relance les statistiques, les vols, le vent et les manœuvres.

### B1. Vent : la partie « polaire » est refaite 3 fois et à chaque mouvement du seuil
- **Où** : `maneuvers.estimateWind` 462-520 appelle `estimateWindPolar` (wind 660), qui appelle `estimateWindFromPolar` puis `polarWindCandidates` (wind 345-365). Elle appelle ensuite `selectWindCandidate` (maneuvers 390-443), qui rappelle `polarWindCandidates` (408) et `describeWindCandidate` (412, wind 373-380). Cela fait **3 passes** `buildMaxSpeedsByBearing` sur toute la trace et **2** balayages 360 × 360 de `scoreWindCandidate`. S'y ajoutent `observeTurns` (wind 521-599, une passe O(n × points par fenêtre), soit environ 3 M d'`angleDiff` à 5 Hz) quand le contraste polaire est faible, et `polarSampling` (une passe).
- **Pourquoi c'est inutile** : rien de tout cela ne dépend du seuil d'activité. Seuls entrent la trace et `polarMinSpeedKn`, qui suit l'allure de la session. Pourtant le `useMemo` du hook (`useSailingSession.ts:154-167`) dépend de `activeThresholdKn`.
- **Proposition** : couper `estimateWind` en `prepareWindPolar(points, minSpeedKn): { polar: WindEstimate; candidates: PolarWindEstimate[]; sampling: number }` et `estimateWind(points, options & { polarStage })`. Le hook mémorise la première sur `[trackData, polarMinSpeedKn]`. Dans `polarWindCandidates`, `buildMaxSpeedsByBearing` est calculé une fois et passé à `describeCandidate`.
- **Coût évité** : 3 passes de 54 000 points, 2 × 129 600 évaluations du score, et `observeTurns`, à chaque cran du seuil. L'ordre de grandeur est de 20 à 60 ms ; c'est à mesurer.
- **Mesure** : `performance.now()` autour du `useMemo` du hook, avec le banc (`outils/banc/`) sur la trace de 3 h rééchantillonnée à 5 Hz du lot 30. On peut aussi écrire un test chronométré non bloquant, comme ceux du lot 30.
- **Test de neutralité** : pour 20 sessions × 7 vents, comme au lot 30, `expect(estimateWind(points, { ...opts, polarStage: prepareWindPolar(points, m) })).toEqual(estimateWind(points, opts))`, plus une vérification que `JSON.stringify` est identique.
- **Taille** : moyen. **Confiance** : sûr.

### B2. Statistiques voile : altitude, masque du ratio et masque d'activité recalculés à chaque mouvement du seuil
- **Où** : `sailingStats.buildSailingSessionStats` 46-76 appelle `buildBaseSessionStats` sans `elevationStats` (core/sessionStats 240-241). Il refait donc `computeElevationStats` → `smoothElevation` → `linearSmoothByTime` (core/speedFilter 240-275), soit une régression **non incrémentale** sur une fenêtre de 20 s : environ 100 points × 54 000, plus de 5 M d'opérations. Or l'altitude n'est **pas affichée en voile** (DECISIONS §2 : « Rien en voile » ; `SailingModule` ne lit aucun champ `elevation*`). Le `ratioMask` (sailingStats 64, seuil 0) ne dépend pas du seuil. Enfin, `sailingFlights` (sailingStats 90) recalcule le **même** `thresholdActivityMask` que les statistiques (59).
- **Proposition** : `buildSailingSessionStats(track, { ..., elevationStats: EMPTY_ELEVATION, ratioMask })`, avec `ratioMask` mémorisé sur la trace dans le hook. `sailingFlights(track, cum, profile, mask, minFlightS)` reçoit le masque des statistiques, que `buildBaseSessionStats` peut renvoyer, ou que le hook mémorise.
- **Coût évité** : 2 passes de masque et un lissage d'altitude en O(n·w) par cran du seuil.
- **Neutralité** : exacte sur tout ce que la voile affiche. Les champs `elevation*` de `SessionStats` passeraient de valeurs calculées à « - », sans lecteur en voile ; à vérifier pour l'image de partage (`library/shareStats.ts:70` lit `summary.elevationGainM`, qui vient de la fiche, pas de ces statistiques). Test : `toEqual` sur `stats` sans les champs `elevation*`, et sur `flights`.
- **Taille** : petit. **Confiance** : sûr.

### B3. VMG : un objet par fenêtre et deux tris complets pour garder 3 fenêtres
- **Où** : `sailingAnalytics.calculateVmgStats` 472-524. `windows.push({...})` crée jusqu'à 54 000 objets ; `getTopVmg` (505-509) filtre, recopie (`map`) et **trie toute la liste** deux fois (près et portant), soit environ 2 × 54 000 log 54 000 comparaisons. Le calcul repart à chaque changement de `windAt`, donc à chaque cran du seuil, puisque le vent est recalculé.
- **Proposition** : ranger les fenêtres dans des `Float64Array`/`Int32Array` (`start`, `end`, `avgVmg`, `allAboveMin`), puis prendre les 3 meilleures sans chevauchement par sélection répétée : max, retrait de ce qui chevauche, max… Il faut 3 passes au lieu d'un tri.
- **Neutralité** : à égalité de valeur, le tri stable garde la première fenêtre ; la sélection doit faire de même (premier maximum strict). Test : `toEqual` sur `VmgStats` pour les sessions de `sailingAnalytics.test.ts` et des traces bruitées à 1 et 5 Hz, plus `legacyVmgStats` (le test garde déjà une version de référence, l. 73).
- **Coût évité** : environ 1,7 M de comparaisons et 54 000 objets par calcul ; de l'ordre de 10 ms, à mesurer.
- **Taille** : petit. **Confiance** : sûr.

### B4. Cadence d'une répétition : toute la trace reparcourue à chaque répétition
- **Où** : `cadence.timeSpanCadence` 557-570 appelle `measuredSegments` (441-451), qui alloue un objet par pas de **toute** la trace, à chaque appel. L'appelant `LandModule.tsx:610` le fait pour chaque répétition de chaque séance : 3 séances × 10 répétitions × 54 000 = 1,6 M d'objets créés à chaque ouverture ou modification de l'onglet « fractionné ».
- **Proposition** : A5. Segments calculés une fois, plage bornée par dichotomie.
- **Neutralité** : exacte (mêmes segments, même ordre). Test : `toEqual` entre l'ancienne et la nouvelle `timeSpanCadence` sur `cadence.test.ts` et une trace de fractionné synthétique.
- **Taille** : petit. **Confiance** : sûr.

### B5. Partager le balayage de fenêtre entre `observeTurns` et la détection des manœuvres
- **Où** : `wind.observeTurns` 531 et `maneuvers.readWindow` 1147 appellent tous deux `scanTurnWindow(points, i, 12 s, 30 s)` : `ORIENTATION_WINDOW_S` = `MANEUVER_WINDOW_S` = 12 et `MANEUVER_MAX_STEP_S` = 30. Le résultat (`j`, `cumulativeTurn`, `totalRotation`) est **le même** pour un même `i`. Le lot 30 a gardé leurs règles séparées (cohérence 0,6 contre 0,5), à raison, mais rien n'empêche de partager le balayage brut.
- **Proposition** : `ManeuverDetection.scanAt(i): TurnWindowScan`, mémorisé ; `observeTurns(points, minEntry, scanAt?)` l'utilise quand il le reçoit.
- **Neutralité** : exacte, la fonction est pure. Test : `observeTurns` avec et sans `scanAt`, en `toEqual`. Le gain n'apparaît que si B1 n'a pas déjà mis `observeTurns` hors du chemin du seuil. **Taille** : petit. **Confiance** : probable.

### B6. Profil de vitesse d'une répétition : deux dichotomies par pas, dont une en double
- **Où** : `intervalStats.repSpeedProfile` 85-93. Pour chaque pas, `sampleAt(t1)` et `sampleAt(t0)` font chacun une dichotomie et allouent un tableau `at`. Le `t0` du pas k+1 vaut le `t1` du pas k, qui vient d'être calculé. `detectIntervals` l'appelle sur **toute** la session (178) : 10 800 pas pour 3 h.
- **Proposition** : reprendre la distance du pas précédent, et ne lire que la distance (sans `at`).
- **Neutralité** : exacte si `startMs + k·stepMs + stepMs === startMs + (k+1)·stepMs`, ce qui tient pour des millisecondes entières et `stepS` entier ; à vérifier par test pour `stepS = 1`. **Taille** : petit. **Confiance** : probable.

### B7. Allocations dans la boucle de classement des manœuvres
- **Où** : `maneuvers.classifyManeuvers` 1461-1493. Le tracé `path` (`points.slice(...).map(...)`) et tout l'objet `ManeuverLocation` sont construits à **chaque** classement : 4 candidats de vent, 2 passes d'estimation, 2 passes du hook, soit environ 8 classements par cran du seuil. Seul le dernier est affiché.
- **Proposition** : un `path` paresseux (accesseur), ou le tracé calculé par l'appelant à partir de `entryIndex`/`exitIndex`.
- **Coût** : faible (environ 100 manœuvres × 20 points × 8). **Neutralité** : exacte, mais `ManeuverLocation` change de forme (le lot 30 compare par `toEqual`, qui doit continuer de passer). **Taille** : petit. **Confiance** : sûr. **Priorité** : basse.

### B8. Le résumé de bibliothèque analyse deux fois une session de surf
- **Où** : `library/summary.ts:108` (`surfRides`) et `142` (`analyze`) appellent chacun `runSurfSession(track, buildCumulativeTrack(track), ...)` sur la même trace (hors de la zone, mais c'est du surf).
- **Proposition** : une seule analyse, partagée. **Neutralité** : exacte. **Taille** : petit. **Confiance** : probable : il faut vérifier que les deux appels portent sur les mêmes réglages au même moment.

### B9. Pour mémoire : la cadence par autocorrélation
- `cadence.cadenceSeries` 236-268 : une autocorrélation par seconde de capture (87 décalages × 301 échantillons), soit environ 94 M de multiplications-additions par heure. Le calcul n'a lieu qu'une fois, à l'arrêt de l'enregistrement (`useRecorder.ts:372`). Rien à faire tant qu'aucune attente n'est ressentie au téléphone.

---

## C. Architecture

### C1. Dépendances à l'envers : le noyau importe les domaines, et « pente » vit dans `running/`
- `core/sportProfiles.ts:4` importe `CadenceDetection` de `running/cadence`. `core/activityPresets.ts:4,11,12` importe `BikeType` (cycling), `EnergyModel` et `GradeRange` (running).
- La pente (`computeGrades`, `gradeZones`, `classifyGrade`, `GradeRange`, `gradeGradientStops`, `gradeColorPaths`) est dans `running/runningAnalytics.ts`. Elle sert pourtant au vélo (`cycling/energy.ts:6`, `cyclingConfig.ts:3`), à la planification (`planning/route.ts:6`), au direct (`recording/liveStats.ts:11`) et à 4 composants.
- **Proposition** : créer `core/grade.ts` (pente, zones, `GradeRange`), et mettre les couleurs de pente dans `core/trackColor.ts` ou dans un module de couleurs. Les types `CadenceDetection`, `BikeType` et `EnergyModel` vont dans `core/sportProfiles.ts` ou `core/types.ts`, et les domaines les réexportent. C'est neutre.

### C2. Les angles sont dans `sailing/wind.ts` et d'autres domaines les importent
- `recording/liveLegs.ts:5` importe `angleDiff` et `normalizeAngle` de `sailing/wind` ; `liveLegs.ts:4` importe aussi les constantes de manœuvre de `sailing/sailingConfig`. S'y ajoutent les copies d'A10.
- **Proposition** : créer `core/angles.ts` (`angleDiff`, `normalizeAngle`, `circularMean`, `circularStats`) ; `sailing/wind.ts` les réexporte. C'est neutre.

### C3. Règle 6 : la distance d'une manœuvre n'est pas celle de la trace
- `sailing/maneuvers.ts:813-821` (`distanceBetween`) et `831-846` (`distanceAlongBetween`) intègrent la vitesse **lissée** (`smoothedSpeed`), alors que la règle 6 et `segmentDistanceM` prennent la vitesse **retenue** (`speedMs`). Elles ignorent aussi `gapDistanceM`, que `PointData` ne porte pas (`utils/kinematics.ts:11-24`). Le commentaire de la ligne 811 cite pourtant la règle 6.
- Cette distance sert au rejet `tooShort` (l. 1179), à `distanceM` affichée (999) et au gain au vent (1484).
- **Proposition** : faire porter à `PointData` la distance du pas (`stepM`, prise de `segmentDistanceM`), et intégrer cette distance, au prorata pour `distanceAlongBetween`. **Cela change des chiffres** : distances, gains, et peut-être le décompte via `tooShort`. Question F1.

### C4. Règle 2 : deux lectures de cap échappent aux pas d'au moins 0,9 s
- `maneuvers.stableSegment` 590-593 calcule la vitesse de rotation **d'un point au suivant**. À 5 Hz, 1° de bruit sur un pas de 0,2 s fait 5°/s, au-dessus de `STABLE_MAX_RATE_DEG_S` (3°/s), et le segment s'arrête (voir D1).
- `maneuvers.turnCoreStart` 659 prend des pas « d'au moins 1 s » (`< 1000` ms), alors que tout le reste de la détection prend `TURN_STRIDE_MIN_S` = 0,9 s. Or `sailingConfig.ts:88-90` explique justement qu'à 1 s strict, un pas de 998 ms en avale deux. Le lot 30 a laissé `turnCoreStart` inchangé, pour garder la neutralité.
- **Proposition** : passer les deux à `strideEnd`. **Cela change des chiffres** ; HISTORIQUE point 21 rappelle que retoucher `stableSegment` déplace la bissectrice, donc le classement. Question F2.

### C5. Règle 1 : des textes déjà formatés sortent des calculs
- `sailingAnalytics.ts:15-20` : `VmgStats` est fait de chaînes `toFixed(1)` en nœuds ; `296-298` : `vminAvg`, `vminMax` et `averages` sont des chaînes. `SailingModule.tsx:730, 778-779, 875` les relit par `formatKnots` (`core/units.ts:137-142`), qui fait `parseFloat` puis convertit : **double arrondi** dans une autre unité que le nœud (0,05 nd ≈ 0,09 km/h).
- `runningAnalytics.ts:128-130, 173-175` : `ZoneStats.time`, `pace` et `speedKmh` sont des chaînes, `speedKmh` toujours en km/h quelle que soit l'unité réglée. `pace` et `speedKmh` ne sont pas lues (E2).
- **Proposition** : rendre des nombres (nœuds en voile, règle 5) et formater dans la page. C'est neutre à l'affichage en nœuds et légèrement plus juste dans les autres unités.

### C6. Règle 3 : seuils en dur, non surchargeables
- En voile, ces seuils sont des constantes de module. Certains se surchargent par `ManeuverOptions` ; aucun n'est dans `SPORT_PROFILES` ni persisté :
  - `maneuvers.ts` : 222 (`CLASSIFICATION_TOLERANCE_DEG`), 244-252 (poids et itérations de la fusion), 527-553 (`STABLE_*`), 613-636 (relance, fenêtres d'approche et de sortie, bords de rotation), 1167 (`windowMs * 0.5`), 1189 (`2 * windowMs`), 1277 (150°).
  - `wind.ts` : 57, 207-211, 282, 312-315 (12 secteurs), 397-417, 652.
  - `sailingAnalytics.ts` : 104-106, 480 (`0.8`).
- `MANEUVER_MIN_TURN_DEG` est lu en direct (`maneuvers.ts:1168, 1263`), contrairement aux autres réglages de détection, qui passent par `resolveDetectionSettings` (1028-1037) : c'est le seul réglage de détection qu'on ne peut pas surcharger.
- Ailleurs : `cadence.ts:216` (`0.15`), `223` (`/ 2`), `491` (`0.95`, `0.8`) ; `restingHrResults.ts:183` (`500` ms).
- **Proposition** : au minimum, faire passer `MANEUVER_MIN_TURN_DEG` par `DetectionSettings` (neutre) ; pour le reste, demander s'il s'agit d'une exception assumée, constantes d'algorithme et non réglages de l'utilisateur (F7).

### C7. Des fichiers rangés au mauvais endroit
- `sailing/sessionNotes.ts` sert à **toutes** les familles (`library/record.ts:15`, `library/stats.ts:13`, `GearPicker`). Il irait mieux dans `library/notes.ts`. Il contient en plus des emoji (`RATINGS`, l. 84-90, affichés par `SessionNotesPanel.tsx:154`), alors que CLAUDE.md les proscrit (« icônes dans `components/icons.tsx` (pas d'emoji) »).
- `running/restingHrResults.ts:225-277` relit et réécrit le stockage (`readStoredRestingResults`, `toStoredRestingResult`) : c'est de la persistance, pas un calcul de course. À déplacer dans `library/` ou à côté de `useRestingHrResults`.
- `running/types.ts` n'est qu'un alias de `BaseSessionStats`, avec un seul utilisateur (`LandModule.tsx:95`).
- `running/intervalDetection.ts:4` importe `INTERVAL_LIMITS` de `recording/intervalTimer` : le calcul dépend de l'enregistreur. Mineur.

### C8. Des champs en double dans les profils
- `SurfProfile.maxGapS` (`core/sportProfiles.ts:361-362`, commenté « le même que `SportProfile.maxGapS` ») double `SportProfile.maxGapS`.
- `SurfProfile.stillMs` (0,5 m/s, l. 685) coexiste avec `stillThreshold` du surf (2 km/h, 0,56 m/s, l. 622/662). Il y a donc deux planchers d'arrêt pour la même famille : `surfAnalysis` prend le premier, `thresholdActivityMask` le second (voir F6).

### C9. Signatures incohérentes pour la même notion
- Énergie : `EnergyResult` (par kilo : `netJkg`, `mechanicalPowerWkg`) contre `CyclingEnergyResult` (absolu : `netJ`, `mechanicalPowerW`) ; le temps d'une zone s'appelle `ZoneStats.timeMs` (en **ms**) mais `EnergyZone.timeS` et `CyclingEnergyZone.timeS` (en s).
- Vitesse en voile sans unité dans le nom : `entrySpeed`, `vmin`, `meanSpeed` et `smoothedSpeed` sont en nœuds, alors que `RejectedTurn.speedKn` porte son suffixe. Ailleurs on trouve `avgSpeedMs` (surf), `averageSpeedMs` (liveLegs), `meanSpeedMs` (intervalles), `speedMs` (`IntervalPhaseStats`).
- Le mot « Flight » désigne trois choses : `core/jumps.Flight` (temps en l'air d'un saut), `core/pumping.FlightSpan` (vol sur foil en voile) et `SurfFlight`.
- **Proposition** : suffixe d'unité obligatoire, `durationS` et `timeS` en secondes partout, et le type de base `TrackSpan` (A3). C'est neutre.

### C10. Le cap de l'appareil (Doppler) est jeté en voile
- `utils/kinematics.toPointData` (27-36) ne recopie pas `courseDeg`, que `core/types.ts:75` présente comme « plus juste que `bearing` à 1 Hz ». Le surf, lui, l'utilise (`gpsTurns.ts:24`). C'est peut-être un choix ; à poser à l'utilisateur (F5), parce que l'adopter changerait tout le vent.

---

## D. Bugs probables

### D1. Caps stabilisés presque introuvables à 5 Hz sous bruit de cap (règle 2) : probable
- `sailing/maneuvers.ts:584-601`. Avec une trace à 5 Hz et un cap qui bruite de ±1° d'un point à l'autre, `rate = |Δcap| / 0,2 s` vaut 5°/s, au-dessus de `STABLE_MAX_RATE_DEG_S` (3), et la boucle s'arrête au premier ou deuxième point après la marge de 4 s. Il reste moins de 5 s, et `stableSegment` rend `null`. Le repli `medianStableSegment` (761-764 : fenêtre ≥ 4 s, écart ≤ 25°) rattrape une partie des cas.
- **Effet** : moins de manœuvres à `stableHeadings`, donc moins d'échantillons dans `windSamplesFrom` (255-258) et une confiance du vent plus basse à 5 Hz qu'à 1 Hz sur la même sortie. La bissectrice et le classement peuvent aussi changer (HISTORIQUE point 21).
- Les tests 1 Hz / 5 Hz existants (maneuvers.test 604, 843, 1505) portent sur des bruits lisses (sinus, l. 1373) ou ne comparent pas `stableHeadings`.
- **Test à écrire** : la session de `maneuvers.test.ts:847`, à bruit indépendant, à 1 et 5 Hz, en comparant la part de `stableHeadings` et `windSamplesFrom(...).length`.

### D2. Distance de manœuvre et rejet `tooShort` à travers un trou de trace (règle 6) : probable
- `sailing/maneuvers.ts:1179` avec `distanceBetween` (813-821). Prenons un enregistreur économique : un pas unique de 25 s (autorisé jusqu'à `MANEUVER_MAX_STEP_S` = 30 s), avec à la reprise une vitesse lissée de 5 nd. La distance comptée vaut 5 × 0,514 × 25 = 64 m, même si la corde réelle du pas fait 3 m (planche dérivant après une chute). Le noyau l'aurait bornée à 4,5 m (`gapDistanceM`, corde × 1,5). Le garde-fou `tooShort` (10 m) laisse donc passer un « virage » sur place. Le filtre `STILL` (1261) en écarte une partie, mais seulement si la vitesse moyenne d'approche ou de sortie est sous le plancher.
- Le même écart touche `distanceM` et `windwardGainM` des manœuvres qui enjambent un trou.

### D3. Cadence comptée à travers une reprise après pause : à vérifier
- `running/cadence.ts:441-451` (`measuredSegments`) n'écarte pas le pas `segmentStart`. `cadenceFactor` (307) et `sessionCadence` (378) l'écartent, et le commentaire de la ligne 374 dit pourtant « comme `measuredSegments` ».
- **Scénario** : une pause manuelle de moins de `gapS` (10 s), avec une cadence aux deux bouts. Son temps compte dans `analyzeCadence` (pas, tranches, maximum), dans `timeSpanCadence` et dans `cadenceBandPaths`, alors que la distance du pas vaut 0 : la longueur de pas baisse un peu.
- **Correctif neutre hors pause** : ajouter `|| track[i].segmentStart` à la ligne 447.

### D4. Énergie : sur un trou de trace, distance bornée mais vitesse de reprise : probable, effet faible
- `running/energy.ts:274-279`, `cycling/energy.ts:239-243`. `d = segmentDistanceM` vaut `gapDistanceM` (bornée) pour un trou, mais la traînée, le coût de Pandolf et la force à vélo lisent `track[i].speedMs`, qui est la vitesse au point de reprise et pas `d / dt`. La puissance (`net / dt`) et le coût par mètre de la marche sont alors calculés à une vitesse qui n'est pas celle du pas.
- **Proposition** : prendre `v = d / dt` pour les pas qui portent `gapDistanceM`. Cela change des chiffres, mais seulement sur les trous.

### D5. `turnCoreStart` à 1 Hz avec gigue d'horloge : probable, effet faible
- `sailing/maneuvers.ts:659`. Un pas de 998 ms (gigue d'une vraie trace à 1 Hz) n'atteint pas 1 000 ms et fusionne avec le suivant : le cœur du virage est lu par pas de 2 s par endroits, et son départ (`turnStart`) peut reculer d'un point. C'est le piège même que décrit `sailingConfig.ts:86-90`. Voir C4 et F2.

### D6. Zones de pente : le tableau et l'énergie ne comptent pas la pente manquante pareil (incohérence voulue ?)
- `runningAnalytics.ts:156-157` écarte un pas sans pente du tableau « zones de pente ». `running/energy.ts:284` et `cycling/energy.ts:251` le rangent en zone « plat » (`?? 'flat'`, voulu d'après le commentaire de la ligne 231). Sur une trace à altitude incomplète, le temps « plat » du tableau des zones et celui de l'énergie par zone diffèrent dans le même onglet. Question F4.

### D7. Surf : une pause de l'enregistrement est comptée comme rame ou attente : à vérifier
- `surfing/surfAnalysis.ts:142-155` et `311-319` ne regardent que `stepS > maxGapS`. Le pas `segmentStart` d'une pause manuelle de moins de 10 s est donc compté dans la phase « rame » ou « attente », et sa durée entre dans `rameS` ou `attenteS`. La pause automatique est coupée en surf (DECISIONS §4), mais la pause manuelle existe.

### D8. Diagnostic des virages écartés : « planche arrêtée » rangée sous « incohérent » : à vérifier
- `sailing/maneuvers.ts:1412-1414`. Le verdict `still` (caps lus sous le plancher d'arrêt) est compté avec le motif `incoherent`, que `ManeuverRejections` définit ainsi (169) : « rotation trop dispersée : chute, hésitation ». Seul le décompte des rejets est en jeu, pas les manœuvres comptées. Un motif `still` propre rendrait le diagnostic exact. Neutre pour les `locations`, mais `rejected` change.

---

## E. Code mort

Vérifié par grep sur tout `src/`, tests exclus, puis tests inclus.

1. `running/runningAnalytics.ts:210-215` : `averagePace` n'est appelé que par `runningAnalytics.test.ts`.
2. `running/runningAnalytics.ts:128-130` et `173-175` : les champs `ZoneStats.pace` et `speedKmh` sont calculés mais jamais lus (`LandModule.tsx:1463-1476` n'utilise que `distanceM`, `distanceShare`, `time`, `timeMs` et `avgSpeedMs`, formatée par `formatSpeed`). Le paramètre `distanceUnit` de `computeZoneStats` ne sert qu'à eux, et force un recalcul à chaque changement d'unité (`LandModule.tsx:471`).
3. `utils/kinematics.ts:14-18` et `30-32` : les champs `PointData.time` et `PointData.speed` sont recopiés sur 54 000 points sans jamais être lus. `grep "\.speed\b"` et `"\.time\b"` ne donnent rien dans `sailing/`, `useSailingSession` ni `SailingModule`.
4. `sailing/maneuvers.ts:1512-1516` (`analyzeManeuvers`) et `879-884` (`measureManeuver`, avec les types `DetectedTurn` et `ManeuverMeasure`) ne sont appelés que par les tests ; en production, seuls `prepareManeuverDetection` et `classifyManeuvers` servent. Ce sont des commodités de test : à garder, en le disant dans leur commentaire, ou à déplacer dans un module d'aide aux tests.
5. `running/types.ts` : un alias `RunningSessionStats = BaseSessionStats` pour un seul utilisateur.
6. Exports sans lecteur extérieur (utilisés dans leur fichier ou par les tests seulement : ce n'est pas du code mort, mais une surface d'export inutile). Dans `maneuvers` : `maneuverAgreement`, `measureRotation`, `DetectionSettings`, `WindowReading`, `TurnReading`, `ManeuverDetectionOptions`, `ManeuverClassificationOptions`. Dans `wind` : `buildMaxSpeedsByBearing`, `scoreWindCandidate`, `orientationVotes`, `NO_GO_HALF_ANGLE`, `UPWIND_SECTOR`, `POLAR_SUPPORT_INTERVAL_S`, `TURNING_RATE_MIN_DEG_S`. Dans `sailingConfig` : `MANEUVER_ENTRY_SPEED_RATIO`, `POLAR_MIN_SPEED_RATIO`, `FAST_SESSION_REFERENCE_KN`, `SPEED_RANGE_MAX_MARGIN_KN`. Dans `sailingAnalytics` : `formatMetric`. Dans `cycling/energy` : `DEFAULT_CYCLING_PARAMS`, `rollingCoefficient`. Dans `restingHrResults` : `readStoredRestingResult`. Dans `intervalStats` : `summarizeIntervals`, `intervalPhaseStats`. Dans `cadence` : `stepPeriod`, `cadenceAt`, `cadenceFactor`, `stepCadenceSpm`. Dans `running/energy` : `minettiCost`, `flatCostJkgM`, `runningCostJkgM`, `walkingGrossWkg`, `walkingCostJkgM`. Dans `runningAnalytics` : `gradeGradientColor`, `gradeStepColor`, `GRADE_COLOR_STEPS`. Dans `surfing/pumping` : `surfPruneWindows`. Priorité basse.

---

## F. Questions à poser à l'utilisateur

Chaque question porte sa réponse par défaut.

1. **Distance des manœuvres** (C3, D2). Faut-il calculer distance, gain au vent et garde-fou des 10 m comme toutes les autres distances de l'application (vitesse retenue, trous bornés) ? Les chiffres des manœuvres bougeraient un peu. *Par défaut : oui, dans un lot à part, chiffres avant et après relevés sur les 12 sessions réelles du lot 30.*
2. **Lecture du cap à 5 Hz** (C4, D1, D5). Faut-il lire les caps stabilisés et le début du virage par pas d'au moins 0,9 s, comme le reste de la détection ? Les sessions à 5 Hz retrouveraient des caps stables ; les chiffres changeraient. *Par défaut : oui, après un test qui mesure l'écart 1 Hz / 5 Hz.*
3. **« Vitesse max »** a trois sens : meilleure moyenne sur 2 s en voile, point le plus rapide d'une vague en surf, point le plus rapide dans la bibliothèque. Faut-il le même partout ? *Par défaut : meilleure moyenne sur 2 s partout, la règle des records GPS.*
4. **Pente manquante** (D6). Le tableau des zones l'écarte, l'énergie la compte comme du plat. Faut-il garder cette différence ? *Par défaut : la garder, mais le dire sous le tableau.*
5. **Cap de l'appareil en voile** (C10). Faut-il essayer le cap Doppler, quand le fichier l'a, pour les manœuvres et le vent ? Tout le vent changerait. *Par défaut : non, ou plus tard, à essayer sur le banc d'abord.*
6. **Surf, plancher d'arrêt** (C8). Il y en a deux, 1,8 km/h pour l'attente et 2 km/h pour le temps en mouvement. Faut-il n'en garder qu'un ? *Par défaut : un seul, 2 km/h, si les chiffres de vos sessions bougent peu.*
7. **Constantes de la voile** (C6). Faut-il les laisser comme constantes de l'algorithme (exception à la règle 3, à écrire dans DECISIONS §1) ? *Par défaut : oui, sauf `MANEUVER_MIN_TURN_DEG`, à rendre réglable comme les autres réglages de détection.*

---

## G. Chiffres

- **Fichiers lus en entier** : 21 hors tests (6 095 lignes) dans la zone ; 16 fichiers de tests (4 574 lignes) en diagonale ; 12 fichiers de contexte en partie (environ 2 000 lignes).
- **Constats** :
  - **A. Doublons** : 10 sections ; 9 grands doublons, plus 7 petites copies en A10.
  - **B. Optimisations** : 9, dont 4 à fort effet sur le chemin du seuil en voile (B1, B2, B3) ou du fractionné (B4).
  - **C. Architecture** : 10 ; règles enfreintes : 1 (C5), 2 (C4), 3 (C6), 6 (C3), plus des emplacements et nommages.
  - **D. Bugs probables** : 8 ; 3 probables à effet réel (D1, D2, D4), 1 piège déjà décrit dans le code (D5), 4 à vérifier.
  - **E. Code mort** : 6 entrées (5 éléments morts, plus une liste d'exports inutiles).
  - **F. Questions** : 7.
- **Pour l'ordre des lots**, du plus sûr au plus délicat :
  1. Les changements neutres et rapides d'abord : B1, B2, B3, B4, A1, A2, A3, A5, C1, C2, E. Neutralité exacte par `toEqual`, comme au lot 30.
  2. Ensuite, ce qui change des chiffres, après accord (F1, F2) : C3/D2, puis C4/D1/D5.
