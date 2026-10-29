# 08 · Transverse : thème, tests, qualité, docs

Audit en lecture seule du 28/10/2026, dépôt au commit `86b3f8d`. Méthode : scripts Node de lecture (dans le dossier de travail de la session, hors dépôt) sur les 459 fichiers de `src/`, puis lecture des lignes citées. Aucune commande n'a écrit dans le dépôt (ni build, ni vitest, ni git). Les numéros de ligne valent pour ce commit.

Vue d'ensemble : la base est **propre sur les marqueurs classiques** (aucun `any`, aucun `@ts-ignore`, aucun `TODO`, aucun `debugger`, aucun `console.log` oublié, aucun `catch {}` vide, aucun import circulaire, aucune classe CSS morte, règle 12 respectée hors de `platform/`). La dette est ailleurs : **petites fonctions recopiées** (messages d'erreur, arrondis, angles, formats de durée), **générateurs de traces synthétiques recopiés dans 26 fichiers de test**, **styles en ligne des tableaux et graphes** recopiés dans les modules d'analyse, et quelques **valeurs visuelles hors des variables** (z-index, ombres, couleurs de données).

---

## A. Doublons

Classés par importance (gain de cohérence × nombre de copies).

### A1. Message d'une erreur inconnue : 5 définitions, 23 recopies en ligne, 35 « erreur inconnue »
- Définitions identiques : `hooks/useRecorder.ts:207`, `hooks/useSessionLibrary.ts:204`, `hooks/useRestingHrTest.ts:45` (`errorMessage(err, fallback)`), `components/HeartRateBeltSettings.tsx:18`, `hooks/useBeltWarmup.ts:7` (`errorText(err)`, même corps, repli figé).
- Recopies en ligne `err instanceof Error ? err.message : …` (23) : `components/FollowTracePicker.tsx`, `SavedSessionShare.tsx:73`, `SessionNameEditor.tsx:73`, `ShareDialog.tsx:119` (+1), `hooks/useGpxSession.ts`, `useRouteLibrary.ts`, `useSessionJumps.ts`, `useSessionLibrary.ts`, `useSessionPumping.ts`, `useSessionSurfaces.ts`, `useTerrainElevation.ts`, `pages/MuscuModule.tsx`, `pages/PlanningPage.tsx` (×5), `pages/RecordingPage.tsx`, `planning/legCalculation.ts` (×2), `platform/location.ts` (×2).
- Nuance qui diverge : les uns testent `err.message` non vide (`&& err.message`), les autres non (`SavedSessionShare.tsx:73` affiche « Partage impossible :  » si le message est vide).
- Pièce unique : `core/basics.ts` → `export const errorMessage = (err: unknown, fallback = 'erreur inconnue'): string => (err instanceof Error && err.message ? err.message : fallback);`
- Risque : nul (texte identique, sauf le cas du message vide, corrigé). Taille : petit (≈ 30 sites, mécanique). Confiance : haute.

### A2. Générateurs de traces synthétiques recopiés dans 26 fichiers de test
- Constante « mètres par degré » recopiée, **avec trois valeurs différentes** : `(Math.PI/180) * 6371e3` (= 111 194,9) dans `core/kinematics.test.ts:26,146,196,259,345`, `core/sessionSpeed.test.ts:8`, `core/sessionStats.test.ts:9`, `core/topSegments.test.ts:22,322`, `core/trackColor.test.ts:9`, `library/summary.test.ts:10`, `running/intervalDetection.test.ts:13`, `running/intervalStats.test.ts:11`, `running/runningAnalytics.test.ts:33`, `sailing/sailingStats.test.ts:10`, `recording/liveLegs.test.ts:8`, `recording/liveStats.test.ts:9` ; `111195` dans `core/geoPlane.test.ts:12`, `planning/duration.test.ts:30`, `planning/surface.test.ts:134,181`, `planning/wayMatch.test.ts:9`, `recording/followedTrace.test.ts:50`, `recording/heading.test.ts:5`, `recording/markGuide.test.ts:8` ; `111320` dans `core/terrainElevation.test.ts:14,84`, `sailing/maneuvers.test.ts:129,253,389` ; `6371000` en ligne dans `sailing/maneuvers.test.ts:1014`. Le code, lui, n'a qu'une constante : `EARTH_RADIUS_M` (`core/kinematics.ts:12`).
- Générateur « vers l'est, vitesses données » (même corps : départ `2026-01-01T10:00:00Z`, lat 43,6, lon 3,8, `bearing: 90`, `speedSource: 'derived'`) : `core/topSegments.test.ts:19`, `sailing/sailingConfig.test.ts:18` (variante à pas fixe de 0,0001°, vitesses incohérentes avec les positions), `core/sessionSpeed.test.ts:14`, `running/intervalStats.test.ts:9`, `running/intervalDetection.test.ts:21,38`, `running/runningAnalytics.test.ts:26`, `core/kinematics.test.ts:18`.
- Générateur « phases [durée, vitesse] à `hz` » : `core/trackColor.test.ts:6`, `sailing/sailingStats.test.ts:13`, `library/summary.test.ts:17`, `core/sessionStats.test.ts:25`, `surfing/surfAnalysis.test.ts:27`.
- Générateurs de `LocationFix` : `recording/session.test.ts:22` (`fixAt`), `recording/heading.test.ts:8` (`northward`), `recording/liveStats.test.ts:16` (`trace`), `recording/liveLegs.test.ts:24` (`sail`), `recording/markGuide.test.ts:12-15` (`at`, `sail`), `recording/followedTrace.test.ts:54-59` (`at`, `walk`).
- Repère local est/nord → lat/lon (`at(east, north)`) : `core/geoPlane.test.ts:15`, `recording/followedTrace.test.ts:54`, `recording/markGuide.test.ts:12`, `planning/wayMatch.test.ts:14`, `planning/loopReturn.test.ts:15`, `core/kinematics.test.ts:347`.
- Fiche de session (`record(patch)`) recopiée à l'identique : `library/record.test.ts:31`, `library/sessionBundle.test.ts:10`, `library/sessionEdits.test.ts:8`, `library/reconcile.test.ts:8`. `StatSession` : `library/stats.test.ts:14`, `library/profile.test.ts:8`.
- Faux dossier mémoire (`files` Map, `entriesOf`, `fakeFolder`) : `hooks/useSessionLibrary.test.ts:9-38` et `hooks/useSessionLibrary.memoire.test.ts:16-60`.
- Pièce unique : `src/test/` (aujourd'hui il ne contient que `setup.ts`), sur le modèle déjà admis de `core/imuSynthetic.fixture.ts` :
  - `src/test/geo.fixture.ts` : `M_PER_DEG_LAT` dérivé d'`EARTH_RADIUS_M`, `mPerDegLon(lat)`, `ORIGIN = { lat: 43.6, lon: 3.8 }`, `at(eastM, northM, origin?)`, `T0`.
  - `src/test/track.fixture.ts` : `eastwardTrack(speedsMs, stepS?)`, `phasesTrack(phases: [durationS, speedMs][], hz?)` (rendu brut `RawTrackPoint[]` ou passé par `computeKinematics`), `headingTrack(pieces, hz)` pour la voile, `fixesAlong(...)` pour `LocationFix`.
  - `src/test/record.fixture.ts` : `sessionRecord(patch)`, `statSession(startMs, patch)`.
  - `src/test/memoryFolder.fixture.ts` : faux dossier (`createFakeFolder()` qui rend `files`, `log`, `folder`).
- Risque : moyen. Changer la constante (111 320 → 111 194,9) décale de 0,1 % les positions des traces de `maneuvers.test.ts` et `terrainElevation.test.ts` ; des attendus au mètre près peuvent bouger. Migrer fichier par fichier, attendus inchangés, `vitest run` à chaque pas. Taille : gros (26 fichiers), mais découpable. Confiance : haute.

### A3. Styles en ligne des tableaux d'analyse : 11 copies du même tableau
- `{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }` : `components/CadencePanel.tsx:30`, `FlightPumpingPanel.tsx:57`, `HeartRatePanel.tsx:193`, `IntervalAnalysis.tsx:199`, `JumpsPanel.tsx:76`, `TopsPanel.tsx:39`, `pages/LandModule.tsx:1397,1451`, `pages/SailingModule.tsx:718,758`, `pages/SurfModule.tsx:137`.
- Ligne grisée d'une valeur nulle (`opacity: … ? 1 : 0.45`) : 8 sites (`CadencePanel.tsx:54,121`, `HeartRatePanel.tsx:209`, `IntervalAnalysis.tsx:395`, `TopsPanel.tsx:57`, …). Trait de ligne `borderTop: '1px solid var(--line-soft)'` : 9 sites (mêmes fichiers, `FlightPumpingPanel.tsx:128,182`, `JumpsPanel.tsx:281`, `SettingsFiles.tsx:104`).
- Cellules : `thStyle` local (`FlightPumpingPanel.tsx:58`), `padding: '7px 14px'` ×10 dans `SailingModule.tsx:761-779` ; 33 `<th style={{`.
- Bascule tableau → cartes sur téléphone recopiée en CSS : `components/IntervalAnalysis.css:19-45` et `components/JumpsPanel.css:76-109` (même grille `2em minmax(0,1fr) minmax(0,1fr) auto`, mêmes `padding: 4px 0` et `2px 4px !important`, même `::before { content: attr(data-label) ' ' }`).
- Pièce unique : classes `ui-table`, `ui-table__row--empty`, `ui-table--cards` (bascule téléphone, zones de grille données par la page) dans `components/ui/ui.css` ; à défaut, `TABLE_STYLE`, `TH_STYLE`, `ROW_LINE_STYLE` dans `components/styles.ts` (qui porte déjà `CARD_STYLE`).
- Risque : faible (rendu visuel ; à prouver par le banc, texte identique et capture). Taille : moyen. Confiance : haute.

### A4. Réglages des graphes Recharts recopiés
- `<CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />` : 23 copies ; une seule diverge, `components/JumpsPanel.tsx:142` (`stroke="var(--line-soft)"`).
- `tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}` : 24 copies ; `fontSize: 11` : 62 occurrences dans 15 fichiers (`LandModule.tsx` 12, `StatisticsPage.tsx` 9, `FitnessTestPlanChart.tsx` 6, `FitnessTestPanel.tsx` 6…). `JumpsPanel.tsx:145-146` pose `tick={{ fontSize: 11 }}` sans couleur (rattrapé par `ui.css:662`).
- Libellé d'axe vertical `{ angle: -90, position: 'insideLeft', fill, fontSize: 11 }` : 7 copies dans 6 fichiers.
- Couleurs de données redéfinies : vitesse `#1e88e5` en constante dans `FitnessTestPanel.tsx:22`, `FitnessTestPlanChart.tsx:10`, `IntervalAnalysis.tsx:79`, `SurfModule.tsx:123` (`WAVE_BAND_COLOR`) et en dur dans `LandModule.tsx:808,852,853,875`, `SurfModule.tsx:402,438,439`, `HeartRatePanel.tsx:273`, `MuscuModule.tsx:70` (14 en tout) ; altitude `#e64a19` en constante dans `ElevationProfileMini.tsx:21` et en dur dans `LandModule.tsx:812,839,856,856,876,1088,1089`, `PlanningPage.tsx:542` (9) ; `SHOWN_COLOR` (`IntervalAnalysis.tsx:77`) = `HIGHLIGHT_SHOWN_COLOR` (`highlightColors.ts:11`) ; `MARK_COLOR = 'var(--chart-mark)'` ×3 (`FitnessTestPanel.tsx:25`, `FitnessTestPlanChart.tsx:12`, `RestingHrChart.tsx:6`).
- Pièce unique : `components/chartStyle.ts` : `CHART_GRID_PROPS`, `CHART_TICK`, `chartTick(color)`, `yAxisLabel(value, color)`, `SPEED_COLOR`, `ALTITUDE_COLOR`, `CHART_MARK_COLOR` (les couleurs de données restent en dur, mais à un seul endroit, comme `heartRateColors.ts` et `cadenceColors.ts`).
- Risque : nul. Taille : moyen. Confiance : haute.

### A5. Angles : deux normalisations, deux écarts signés, sept arrondis d'affichage
- Normalisation `((d % 360) + 360) % 360` : `sailing/wind.ts:30` (`normalizeAngle`) et `library/record.ts:443` (`normalizeDeg`, identique) ; en ligne dans `platform/compass.ts:23` et `core/kinematics.ts:44` (`(toDeg(atan2) + 360) % 360`).
- Écart signé : `sailing/wind.ts:24` (`angleDiff`) et `surfing/gpsTurns.ts:19-22` (`signedDelta`, même formule sous une autre forme).
- `atan2 * 180 / Math.PI` au lieu de `toDeg` : `recording/liveLegs.ts:93`, `sailing/wind.ts:38`, `sailing/wind.ts:111` ; `Math.PI / 180` au lieu de `toRad` : `sailing/sailingAnalytics.ts:460`.
- Cap affiché `Math.round(x) % 360` : `pages/RecordingPage.tsx:170,246`, `pages/PlanningPage.tsx:1021`, `recording/liveFields.ts:285,288`, `hooks/useCompassHeading.ts:12`, `sailing/maneuvers.ts:514`.
- `recording/liveLegs.ts:5` importe ces outils géométriques de `sailing/wind` (dépendance enregistrement → voile pour de la géométrie pure).
- Pièce unique : `core/angles.ts` (ou `core/kinematics.ts`, qui a déjà `toRad`/`toDeg`) : `normalizeDeg(deg)`, `signedAngleDiff(a, b)`, `roundBearingDeg(deg)` ; `sailing/wind.ts` réexporte pour ne rien casser.
- Risque : faible (formules équivalentes ; `signedDelta` rend 180 pour −180, à garder). Taille : petit. Confiance : haute.

### A6. Formats de durée et d'heure : six `pad` locaux, trois écritures d'« h mm »
- `const pad = (n) => String(n).padStart(2, '0')` : `core/units.ts:193,223,232` (trois fois dans le même fichier), `components/heartRateOrigin.ts:9`, `library/naming.ts:32`, `recording/session.ts:218`.
- `m:ss` avec report à 60 : `core/units.ts:33-36` (`formatPace`) et `core/units.ts:118-121` (`formatSpeedValue`), même bloc.
- « 1 h 24 » : `components/ProfileRoot.tsx:51-54` et `pages/ProfilePage.tsx:84-89` ; « 1h24 » : `core/units.ts:175-180` (`formatDuration`) — écritures différentes (voir D2).
- `hh:mm` : `sailing/sailingAnalytics.ts:208` à la main, alors que `formatTimeOfDay` (`core/units.ts:221`) fait `hh:mm:ss`.
- Pièce unique : dans `core/units.ts`, un `pad2` exporté, `formatMinSecRounded(min)` pour les deux `m:ss`, `formatHoursMinutes(s, { spaced, grouped })` ; `formatTimeOfDay(ms, { seconds })`.
- Risque : faible. Taille : petit. Confiance : haute.

### A7. Arrondis à 1 ou 2 décimales et `parseFloat(x.toFixed(n))`
- `Math.round(x * 10) / 10` : `core/jumps.ts:146` (`toTenth`), `core/patternTiles.ts:42` (`r1`), `components/JumpsPanel.tsx:146`, `library/summary.ts:240`, `pages/LandModule.tsx:545,836`, `pages/landModules.tsx:195,283`, `pages/SailingModule.tsx:212`.
- `Math.round(x * 100) / 100` : `core/jumps.ts:145` (`toHundredth`), `core/jumps.ts:284`, `core/terrainElevation.ts:140`, `components/JumpsPanel.tsx:127,151`, `pages/FitnessTestPage.tsx:27`, `running/restingHrResults.ts:144`.
- `parseFloat(x.toFixed(3))` (12) : `components/ElevationProfileMini.tsx:73`, `FitnessTestPanel.tsx:94`, `HeartRatePanel.tsx:91`, `JumpsPanel.tsx:145`, `pages/LandModule.tsx:544,694,720,866`, `pages/MuscuModule.tsx:152`, `pages/PlanningPage.tsx:517,544`, `sailing/wind.ts:71`.
- Pièce unique : `core/basics.ts` → `roundTo(x: number, decimals: number): number`.
- Risque : nul (à 1e-15 près ; `toFixed` arrondit 1.005 différemment de `Math.round` : vérifier les attendus des tests de `jumps`). Taille : petit. Confiance : haute.

### A8. Bornes de couleur d'une trace résolues à quatre endroits
- `components/sessionTrack.ts:65-77` (`sessionSpeedRange`, vignettes et partage), `pages/SailingModule.tsx:358`, `pages/LandModule.tsx:636`, `pages/SurfModule.tsx:258`. L'ordre fixé par `CLAUDE.md` (trace › support › pré-réglage/suggestion › traitement) est réécrit dans chacun ; la règle « même coloration dans l'analyse et la vignette » ne tient que parce que les quatre copies concordent.
- Pièce unique : `core/trackColor.ts` → `resolveColorRange({ session, activity, suggested, fallback })`, appelée par les trois modules et par `sessionTrack.ts`, avec un test (voir F).
- Risque : moyen (décision de l'utilisateur ; prouver la neutralité au banc sur une vignette et une analyse). Taille : petit. Confiance : moyenne (la lecture des trois modules n'a pas été exhaustive).

### A9. Projection locale degrés → mètres refaite trois fois
- `core/geoPlane.ts:65-72` (`planeProjection`) ; même calcul de `kx`, `ky` dans `core/simplify.ts:56-58` ; variante centrée dans `planning/wayMatch.ts:92-94` et `core/geoPlane.ts:47-49` (`projectOnSegment`).
- Pièce unique : `planeProjection(refLat)` (existe) ; ajouter `localPlane(origin)` centré pour `wayMatch` et `projectOnSegment`.
- Risque : nul. Taille : petit. Confiance : haute.

### A10. Élagage des capteurs : deux enveloppes identiques
- `core/imuPrune.ts:12-17` (`pruneImuFile`, sauts) et `surfing/pumping.ts:34-39` (`pruneSurfImu`) : décoder, sortir si déjà élagué, `selectImuWindows`, `encodeImu`. Seule la fonction de fenêtres change (`pruneWindows` de `core/jumps.ts:326` ou `surfPruneWindows`).
- Pièce unique : `core/imuPrune.ts` → `pruneImu(bytes, windowsOf: (rec: ImuRecording) => ImuWindow[])`. Au passage, `surfing/pumping.ts` porte mal son nom (il élague, il ne mesure pas le pumping, qui est dans `core/pumping.ts`) : `surfing/imuPrune.ts`.
- Risque : nul. Taille : petit. Confiance : haute.

### A11. Règles CSS recopiées entre feuilles (relevé par script, corps identiques d'au moins trois déclarations)
- Masquage accessible (`position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap`) : `components/AppShell.css:98`, `AppShell.css:244`, `pages/analysisMobile.css:306` → classe utilitaire `.visually-hidden` dans `theme/base.css`.
- Fond de fenêtre modale (8 déclarations identiques, `z-index: 1300` compris) : `components/ActivitySelect.css:41` et `components/ui/Dialog.css:4` → `ActivitySelect` reprend `.ui-dialog__backdrop`.
- Texte d'aide gris (`color: var(--muted); font-size: var(--text-s); margin: 0`) : `pages/ProfilePage.css:4` (`.profile-hint`), `StatisticsPage.css:46` (`.stats-hint`), `TrainingPages.css:74` (`.train-hint`) → `.ui-hint`.
- Sous-titre en capitales (5 déclarations) : `components/ui/ui.css:177` (`.ui-subtitle`) et `pages/TrainingPages.css:48` (`.train-tile__title`).
- Carte blanche en colonne : `components/ActivityChart.css:4` (`.actchart`) et `pages/ProfilePage.css:135` (`.profile-split`).
- Pastille de couleur 10 × 10 : `ActivityChart.css:170` et `StatisticsPage.css:83` ; rond de légende : `StatusLine.css:9`, `ProfilePage.css:255`.
- Onglets resserrés (`border-bottom: none; gap; margin-bottom: 0; padding-bottom: 0`) : `ui.css:340` (`.ui-tabs--compact`), `analysisMobile.css:320`, `PlanningPage.css:30` → poser la classe `ui-tabs--compact` au lieu de recopier.
- Carte fixe sur le côté en téléphone tourné : `pages/analysisMobile.css:477-490`, `pages/PlanningPage.css:551-567`, `pages/RecordingPage.css:10-24` (même `clamp(calc(var(--land-w) * 0.4…))`, mêmes `top/bottom/left/width`) → `.side-map` et `--side-map-w` dans `tokens.css` ou `ui.css`.
- Rangées flex utilitaires (`display:flex; flex-wrap:wrap; gap:var(--space-2)` ×5, colonnes `gap: var(--space-1)` ×5, `gap: var(--space-3)` ×5…) : acceptables, mais un `.ui-row`, `.ui-stack` en éviterait une vingtaine.
- Risque : faible (banc, capture avant/après). Taille : moyen. Confiance : haute.

### A12. Petits doublons divers
- Précision de distance « 2 décimales sous 10, 1 au-delà » : `pages/SessionLibrary.tsx:94` et `pages/StatisticsPage.tsx:132-133` → `formatDistanceAuto(m, unit)` dans `core/units.ts`.
- `components/ActivityChart.tsx:39` définit un `formatDistance(m, activity)` local qui **porte le nom** de `core/units.ts:167` avec une autre signature et une virgule décimale (voir D1).
- `formatSpeed` (`core/units.ts:101-113`) recopie les symboles au lieu de lire `SPEED_UNIT_SYMBOL` (`units.ts:83`).
- Format de date locale `{ day, month, year }` recopié : `components/SettingsFiles.tsx:23`, `library/activityChart.ts:106,112`, `library/stats.ts:449,528,646`, `pages/RestingHrTestPage.tsx:31`, `pages/StatisticsPage.tsx:129`, `pages/SessionLibrary.tsx:75` → formateurs `Intl.DateTimeFormat` nommés dans `core/units.ts`.
- Libellés d'interface tapés plusieurs fois : « Réglages de la session » et « Activité : » (`LandModule.tsx:1536,1547`, `MuscuModule.tsx:293,299`, `SailingModule.tsx:1232,1237`, `SurfModule.tsx:824,834`) → une pièce `SessionSettingsHeader` ; « Vitesse max » ×9, « Plus long vol » ×8, « FC moyenne » ×7, « Plus longue vague » ×5, « Dénivelé positif » ×4 entre `library/shareStats.ts`, `library/stats.ts`, `StatisticsPage.tsx` et les modules → un `STAT_LABEL` dans `library/shareStats.ts` ; « Aucune session sur la période. » ×4 dans `StatisticsPage.tsx:572,643,741,870` ; « Localisation indisponible. » ×4 dans `platform/location.ts:164,176,179,334`.
- Tests recopiés : `completeRecord` testé dans `library/record.test.ts:684` et `library/sessionBundle.test.ts:178` (« n'écrase rien » deux fois) ; `calculateWindStats` (fonction de `sailingAnalytics.ts`) testé dans `sailing/maneuvers.test.ts:1202` et `sailing/sailingAnalytics.test.ts:236` ; nommage des points A, B… testé dans `planning/routeRecord.test.ts:131` et `planning/routeGpx.test.ts:13` ; `planning/geocoding.ts` testé dans `planning/brouter.test.ts:7` (à déplacer dans `geocoding.test.ts`).

---

## B. Optimisations

1. **Tests : traces reconstruites à chaque cas.** `sailing/maneuvers.test.ts:1526-1558` refait, pour chaque test, une quinzaine de sessions bruitées à 1 et 5 Hz puis les analyse sous 7 vents ; `recording/followedTrace.test.ts:183` boucle sur 10 800 points ; `platform/base64.test.ts:6` sur 100 000 octets. Gain attendu : traces mises en commun (`beforeAll`, ou mémoïsées dans `src/test/track.fixture.ts`). **Mesure non faite** (vitesse écrit son cache dans `node_modules/.vite`, interdit ici) : à demander à `verif` avec `npx vitest run --reporter=verbose` et tri des durées, avant tout travail.
2. **Test chronométré fragile** : `planning/loopReturn.test.ts:149-151` exige moins de 200 ms ; voir D4.
3. **Styles en ligne** : 689 `style={{…}}` dans les `.tsx` (`SailingModule.tsx` 106, `LandModule.tsx` 83, `RecordingPage.tsx` 66, `SurfModule.tsx` 41, `SettingsPage.tsx` 37). Chaque rendu recrée les objets et React les compare propriété par propriété ; le passage en classes (A3, A4) allège surtout les tableaux longs (manœuvres, vols, répétitions). Gain modeste, non mesuré ; à faire pour la cohérence plus que pour la vitesse.
4. **CSS** : 37 feuilles, 6 256 lignes, aucune lourde. 15 sélecteurs `:has()` (`RecordingPage.css` 8, `IntervalCard.css`, `ZoomableChart.css`, `analysisMobile.css` 2 chacun, `settingsPage.css` 1) : coût de recalcul réel mais faible à cette échelle ; rien à faire sauf mesure au banc qui dirait le contraire.

---

## C. Architecture

Classées par importance.

1. **Géométrie générique rangée dans la voile.** `recording/liveLegs.ts:5` importe `angleDiff`, `normalizeAngle` de `sailing/wind` ; `hooks/useSailingSession.ts:17` et `pages/SailingModule.tsx:46` aussi, et `library/record.ts:443` a recréé sa propre copie. Règle 5 (`sailing/` en nœuds, héritage) : ces outils d'angle n'ont rien de voile. Proposition : A5 (`core/angles.ts`).
2. **Logique pure dans `components/`.** `components/sessionTrack.ts` (bornes de couleur d'une trace, décision transverse de `CLAUDE.md`) importe `hooks/useSportSettings` ; `components/mapTiles.ts` (126 l., résolution et agrandissement des tuiles), `components/drawRoot.ts` (382 l.), `components/drawShareImage.ts` (278 l.), `components/heartRateOrigin.ts` (testé). « Calcul pur : dans `core/` … avec son `*.test.ts` » : `sessionSpeedRange` et la partie calcul de `mapTiles.ts` vont dans `core/trackColor.ts` et `core/tiles.ts`.
3. **Module de données dans `pages/`, importé par des composants.** `pages/workoutLists.ts` est lu par `components/AppShell.tsx`, `components/IntervalCard.tsx`, `components/TrainingHub.tsx` (sens composants → pages). Proposition : `recording/workoutLists.ts`.
4. **Stockage dans un dossier de « logique pure ».** `planning/brouter.ts:1,165,171` lit et écrit `jsonStore` (l'identifiant de profil BRouter), alors que `INVENTAIRE.md:118` présente `planning/` comme « logique pure ». Règle 12 respectée (passage par `platform/storage`), mais le fichier n'est plus testable sans maquette du stockage. Proposition : passer l'identifiant en paramètre, la lecture/écriture dans `hooks/usePlannedRoute.ts`.
5. **`platform/base64.ts` n'est pas une plateforme.** `library/sessionBundle.ts:2` l'importe pour une conversion pure. Proposition : `core/base64.ts` (garde son test).
6. **`core/` dépend (en types) des domaines.** `core/activityPresets.ts:4-12` importe des types de `cycling/`, `planning/`, `recording/`, `running/` ; `core/heartRateSession.ts:6` de `recording/intervalTimer` ; `core/sportProfiles.ts:4` de `running/cadence`. Pas de cycle (imports `type`), mais le sens est inversé par rapport à « noyau, sans notion de sport » (`INVENTAIRE.md:11`). Proposition : accepter et l'écrire dans ETAT §3, ou déplacer `activityPresets.ts` hors de `core/` (c'est un agrégat de réglages de domaine).
7. **Valeurs visuelles hors des variables** (« Couleur, police, rayon, espacement : une variable de `tokens.css` ») :
   - z-index en dur, échelle implicite : 900 (`analysisMobile.css:145`), 1000 (×5 : `analysisMobile.css:346`, `PlanningPage.css:116,165`, `LiveMap.tsx:209,213`), 1001, 1050 (`ui.css:613`), 1100 (`AppShell.css:29,65,203`), 1150 (`ui.css:520`), 1200 (`HoldDial.css:10`), 1300 (`Dialog.css:7`, `ActivitySelect.css:44`) → `--z-map-overlay`, `--z-bars`, `--z-menu`, `--z-dial`, `--z-dialog`.
   - Ombres : 12 recettes différentes de `box-shadow` (de `0 1px 4px … 20 %` à `0 8px 32px … 25 %`) → `--shadow-s`, `--shadow-m`, `--shadow-l`.
   - TSX : 395 longueurs en `'Npx'` (`SailingModule.tsx` 79, `LandModule.tsx` 50, `SurfModule.tsx` 34, `SettingsPage.tsx` 32, `RecordingPage.tsx` 27, `SessionNotesPanel.tsx` 23, `StatisticsPage.tsx` 21, `HeartRatePanel.tsx` 19, `MuscuModule.tsx` 17…), dont `'10px'` ×99, `'6px'` ×60, `'8px'` ×42 ; contre 44 `var(--space-*)` et 4 `var(--radius-*)`. 27 `borderRadius` en dur (`'4px'` ×12). `CARD_STYLE.padding: '15px'` (`components/styles.ts:5`), hors de l'échelle 4/8/12/16.
   - Couleurs d'état tapées en dur dans un tableau d'interface : réussis `#388e3c` et ratés `#d32f2f` (`SailingModule.tsx:462,722-723,776-777,872-874`) ; ce sont `--success` / `--danger` (sauf si l'utilisateur les veut « couleurs de données »).
   - CSS : peu d'écarts (`font-size: 10px` dans `BeepCurveEditor.css:29` au lieu de `--text-2xs`, 13 `border-radius: 2px/3px/4px`, 51 `gap/padding/margin` en px, `ZoomableChart.css:30-32` en `rgba(30, 136, 229, …)` : la couleur de vitesse, à passer par une variable).
   - « Jamais une valeur en dur dans un écran neuf » : `pages/MuscuModule.tsx` (récent, point 182) porte 17 longueurs en px, 3 couleurs et 20 `style={{`. Infraction probable (confiance moyenne : l'âge exact du fichier n'a pas été vérifié par git).
8. **Ruptures d'écran secondaires hors de `useNarrowScreen`.** Seules les ruptures de 768 px et du téléphone tourné sont gardées par `hooks/mediaQueries.test.ts`. Hors de lui : `max-width: 599px` ×4 (`ProfileAvatar.css:72`, `ProfileRoot.css:52`, `ProfilePage.css:151,282`), `359px` (`ProfilePage.css:336`), `339.98px` (`AppShell.css:97`), `699.98px` (`RecordingPage.css:63`), `1199.98px`/`1200px` (`AppShell.css:309`, `PlanningPage.css:535`). Convention `.98` suivie à moitié (599 et 359 sans). Proposition : constantes nommées dans `useNarrowScreen.ts` et extension du test.
9. **`window.matchMedia` en direct** : `components/AnalysisMap.tsx:139` (lit `NARROW_QUERY` à la main) et `components/ProfileRoot.tsx:285` (mouvement réduit). Non couvert par la règle 12, mais `useMediaQuery` (`hooks/useNarrowScreen.ts:21`) existe et n'est pas exporté. Proposition : l'exporter, ajouter `usePrefersReducedMotion`.
10. **Gros fichiers** (plus de 600 lignes, tests compris) : `hooks/useSessionLibrary.ts` 1 973 ; `pages/LandModule.tsx` 1 611 ; `hooks/useSportSettings.ts` 1 593 ; `sailing/maneuvers.test.ts` 1 579 ; `sailing/maneuvers.ts` 1 516 ; `pages/PlanningPage.tsx` 1 323 ; `pages/SettingsPage.tsx` 1 322 ; `pages/SailingModule.tsx` 1 308 ; `pages/RecordingPage.tsx` 1 058 ; `planning/route.ts` 964 ; `hooks/useRecorder.ts` 933 ; `pages/StatisticsPage.tsx` 908 ; `core/sportProfiles.ts` 903 ; `pages/SurfModule.tsx` 898 ; `library/record.ts` 851 ; `library/record.test.ts` 729 ; `planning/route.test.ts` 723 ; `library/stats.ts` 713 ; `sailing/wind.ts` 689 ; `components/ui/ui.css` 671 ; `recording/fitnessTest.ts` 665 ; `recording/intervalTimer.ts` 662 ; `pages/SessionLibrary.tsx` 638 ; `platform/memoryFolder.ts` 610. Les quatre premiers se découpent naturellement : `useSessionLibrary` (dossier, import, cache, réglages voyageurs), `useSportSettings` (validateurs purs → `core/settingsValidation.ts`, testables sans React), modules d'analyse (tableaux et graphes en pièces de `components/`).
11. **Imports circulaires** : aucun cycle d'imports de valeur (composantes fortement connexes calculées sur les 459 fichiers). Imports interdits par sens : aucun `core/` ou domaine pur → `hooks/`, `components/`, `pages/`.
12. **Noms incohérents** : `surfing/pumping.ts` (élagage, pas pumping) contre `core/pumping.ts` ; `pages/settingsPage.css` (minuscule) contre `SettingsPage.tsx` ; tests de `geocoding.ts` dans `brouter.test.ts` ; `hooks/useSessionLibrary.memoire.test.ts` (seul fichier de test à suffixe français) ; `RATINGS[].emoji`. Le mélange français (identifiants de domaine `fractionne`, `seance`, routes) / anglais (code) est cohérent par ailleurs : fonctions en anglais, valeurs persistées en français.
13. **Directives `eslint-disable-next-line react-hooks/exhaustive-deps`** (10) : toutes justifiées par un commentaire lu (`AnalysisMap.tsx:122`, `useAdvancedTabs.ts:27`, `useOpenSections.ts:23`, `useStoredRecord.ts:55`, `PlanningPage.tsx:792,815`, `RestingHrTestPage.tsx:82`, `StatisticsPage.tsx:258,300,449`) ; `useOpenSections` et `useStoredRecord` reposent sur « `defaults` est une constante de module chez tous les appelants », invariant non vérifié (un appelant qui passerait un objet neuf aurait un `update` figé sur l'ancien). Rien à corriger, mais à garder en tête.

---

## D. Bugs probables

1. **Virgule ou point décimal selon la page.** La même distance s'écrit « 12,4 km » dans le graphe d'activités du Profil (`components/ActivityChart.tsx:41`), les Statistiques (`pages/StatisticsPage.tsx:126`), le plan du test FC max (`components/FitnessTestPlanChart.tsx:15`) et l'aide de la charge cardio (`CardioLoadHelp.tsx:12`), mais « 12.40 km » dans la bibliothèque et les analyses (`core/units.ts:167-168`, `formatSpeed` `units.ts:105-109`, 102 `toFixed` ailleurs). Scénario : l'utilisateur compare une session dans la bibliothèque et dans Statistiques et voit deux écritures. Confiance : haute sur l'incohérence ; reste à trancher laquelle (H1).
2. **Durées écrites de deux façons.** « 1h24 » (`core/units.ts:179`, bibliothèque, analyses, graphe d'activités) et « 1 h 24 » (`components/ProfileRoot.tsx:54`, `pages/ProfilePage.tsx:88`), sur la même page Profil (l'anneau et le graphe d'activités). Confiance : haute (H2).
3. **Couleur de vitesse et altitude hors de leur constante.** Si l'utilisateur demande un autre bleu pour la vitesse, `FitnessTestPanel.tsx:22` changera mais pas `LandModule.tsx:808,852,853,875` ni `ZoomableChart.css:30-32` (sélection du zoom, bleu en `rgba`). Pas un bug aujourd'hui, un piège pour la prochaine retouche. Confiance : haute.
4. **Test chronométré** : `planning/loopReturn.test.ts:149-151` (`performance.now() - t0 < 200`) peut échouer sur une machine chargée (verif en parallèle d'un build, portable sur batterie) sans que le code ait changé. Confiance : moyenne.
5. **Constantes géodésiques des tests divergentes** (A2) : `maneuvers.test.ts` et `terrainElevation.test.ts` placent leurs points avec 111 320 m/°, le code les relit avec `EARTH_RADIUS_M` (111 194,9 m/°) : les vitesses recalculées sont 0,11 % plus basses que celles annoncées par le test. Sans effet aujourd'hui (tolérances larges), trompeur pour un futur attendu serré. Confiance : haute sur le fait, faible sur l'effet.
6. **Promesse rejetée gardée à vie** : `platform/heartRate.ts:167-181` mémorise `listening ??= Promise.all([...addListener])` ; si un `addListener` échoue une fois (greffon pas prêt), chaque `holdBelt` suivant relance la même promesse rejetée et la ceinture reste injoignable jusqu'au redémarrage de l'application. Confiance : faible (dépend du greffon natif).
7. **Grille et graduations du graphe des sauts hors thème** : `components/JumpsPanel.tsx:142` (`--line-soft` au lieu de `--chart-grid`) et `:145-146` (graduations sans `fill`, rattrapées seulement par le sélecteur `ui.css:662` `[fill='#666']`, qui casse si Recharts change sa couleur par défaut). Confiance : moyenne.
8. **Carte du téléphone tourné : 350 px contre 380 px.** `pages/analysisMobile.css:480` réserve 350 px aux panneaux, `PlanningPage.css:553` et `RecordingPage.css:11` lisent `--land-side-min` (380 px, `tokens.css:84`). Le commentaire de `analysisMobile.css:479` le dit voulu ; à confirmer que la variable n'a pas simplement été oubliée. Confiance : faible.

Vérifiés et écartés : `JSON.parse` sans `try` dans `platform/storage.ts:77` (appelant `read` sous `try`, `storage.ts:86-91`) et `components/ShareDialog.tsx:86` (clé construite localement par `JSON.stringify`) ; `setTimeout` sans `clearTimeout` (`MoreMenu.tsx:58`, `useSessionJumps.ts:31`, `files.ts:95`, `main.tsx:39`) : délais de 0 ou course bornée, sans effet après démontage ; `addEventListener` sans retrait (`hooks/leaveGuard.ts:45,56`, `hooks/useSessionLibrary.ts:1267,1270`) : installés une fois au démarrage (`main.tsx:55`) ; `Math.random` seulement dans `newId` (`core/basics.ts:24`) ; `Date.now()` dans un calcul pur seulement en repli de lecture (`library/record.ts:574`).

---

## E. Code mort

Vérifié par recherche du nom dans tout `src/` (et `outils/` pour les exports).

- **Variable CSS jamais lue** : `--radius-xl` (`theme/tokens.css:44`). Les `--course-soft`, `--velo-soft`, `--surf-soft` semblent inutilisées mais sont lues par nom construit (`components/SessionNotesPanel.tsx:67`, `var(--${family}-soft)`) ; les `--root-*` par le canevas (`components/drawRoot.ts:35`). Neuf variables n'ont pas de valeur sombre (`--on-accent`, `--backdrop-surf`, `--backdrop-velo`, `--root-edge`, `--root-fresh`, `--root-seed`, `--root-flower*`) : voulu (« fleur gardée », `tokens.css:220`).
- **Variables référencées jamais définies** : seulement `--safe-area-inset-*` (`tokens.css:63-66`), posées par Capacitor, avec repli `env()` : normal.
- **Classes CSS sans référence** : aucune (les classes à suffixe construit, `ui-btn--${variant}`, `page-backdrop__${kind}`, `ivl--${phase}`, `ivl-block--${kind}`, `ui-help--${size}`, ont toutes leur valeur dans le code).
- **Exports utilisés seulement par les tests** : `averagePace` (`running/runningAnalytics.ts:201`), `isRouteMode` (`planning/route.ts:130`, même pas utilisé dans son fichier), `computeLiveLegs` (`recording/liveLegs.ts:202` ; la production passe par `splitLiveLegs`/`combineLiveLegs`, `recording/liveStats.ts:12`). À garder si ce sont des références de test assumées, sinon à retirer avec leurs tests. `readLibraryState` (`hooks/useSessionLibrary.ts:1920`) sert aux tests et `imuCaptureStats` (`core/imuFile.ts:469`) au banc (`outils/banc/sauts.mjs`, `sauts-diagnostic.mjs`, `pumping-diagnostic.mjs`) : à garder.
- **Exports superflus** : environ 450 exports (surtout des types et constantes) ne servent que dans leur fichier ou ses tests (ex. `core/units.ts` `msToPace`, `core/pumping.ts` `pumpStrokes`, `hooks/useSportSettings.ts` `isTerrainStep`…). Sans effet sur le paquet (Vite élimine) ; ne pas en faire un lot.
- **Dépendances** : toutes utilisées (`@xmldom/xmldom` par `core/gpxParser.test.ts:2`, `@types/node` par `tsconfig.node.json`, les greffons Capacitor par `platform/`).
- **Marqueurs** : aucun `TODO`, `FIXME`, `XXX`, `debugger`, `@ts-ignore`, `@ts-expect-error`, `any` ; `as unknown as` : 4 en code (`library/record.ts:681`, `library/sessionEdits.ts:78,152,159`, filtrage de champs par liste), le reste en tests ; `console.*` : seulement `console.error` (`ErrorBoundary.tsx:31`) et des `console.debug` voulus pour le banc (`beeper.ts`, `notification.ts`, `useFitnessTest.ts`).
- **Emoji** : `sailing/sessionNotes.ts:85-89` (`RATINGS[].emoji`, affichés par `SessionNotesPanel.tsx:154`), contraire à « pas d'emoji » ; déjà au reste à faire (n° 41). Les flèches `▲ ▼` (`FlightPumpingPanel.tsx:152`, `SailingModule.tsx:858`) et `↺` (`ResizablePanel.tsx:180`) sont des caractères typographiques, pas des emoji, mais remplaçables par des icônes de `icons.tsx` pour l'homogénéité.

---

## F. Couverture des tests

Mesurée par graphe d'imports (imports statiques et `import()` des tests, passage indirect compris). Domaines purs : `core/` 36 fichiers sur 38 testés directement, `sailing/` 6/6, `running/` 7/8, `cycling/` 1/2, `surfing/` 4/5, `recording/` 16/18, `library/` 12/13, `planning/` 15/15. Les manques ne sont donc pas là ; ils sont dans la logique restée hors des dossiers purs.

| Fichier non testé | Risque | Test à écrire |
|---|---|---|
| `hooks/useSailingSession.ts` (287 l.) : seuil effectif `fixed ?? session ?? (surchargé ? réglé : suggéré)` (l. 95-99), seuils de manœuvre, vol | Haut : c'est ici que la règle 4 s'applique (mise à l'échelle dans les hooks), et aucun test ne la voit | Extraire `resolveSailingThresholds(profile, settings, session, referenceKn)` dans `sailing/sailingConfig.ts` ; tester les quatre priorités et le bateau sans seuil |
| `components/sessionTrack.ts` (78 l.) : `sessionSpeedRange`, `sessionColorTrack` | Haut : ordre des bornes fixé par `CLAUDE.md`, recopié dans trois modules (A8) | Les quatre étages de priorité, voile avec suggestion, session à classer sans activité |
| `pages/landModules.tsx` : `LAND_TREATMENTS`, textes d'énergie (l. 195, 283) | Moyen : libellés calculés (masse, rendement) | Libellé d'énergie pour course et vélo, profil complet ou non |
| `components/mapTiles.ts` (126 l.) : `resolveTile` (agrandissement d'une tuile de zoom inférieur) | Moyen : carte hors ligne vide si faux | Tuile absente → ancêtre trouvé et découpé ; aucune → `null` (avec un faux `tileStore`) |
| `platform/tileCache.ts` (182 l.) et `hooks/useTileCache.ts` (`noteTileSaved`, plafond) | Moyen : place disque | Plafond dépassé → plus anciennes tuiles retirées d'abord |
| `platform/heartRate.ts` (291 l.) : détenteurs de la ceinture (`holdBelt`, `releaseBelt`) | Moyen : ceinture gardée ou lâchée à tort (D6) | Deux détenteurs, l'un rend → connexion gardée ; les deux → coupée ; échec d'`addListener` puis réessai |
| `hooks/useSessionDraft.ts` (121 l.) | Moyen : brouillon et « Enregistrer la session » (décision transverse) ; `library/sessionEdits.ts` est testé, pas la colle | Modifier, annuler, enregistrer : fiche écrite une fois, brouillon vidé |
| `hooks/useMarkGuide.ts` (227 l.), `hooks/useIntervalTimer.ts` (232 l.), `hooks/recordingNotification.ts` (160 l.) | Faible à moyen : calculs testés (`markGuide`, `intervalTimer`, `liveNotification`), colle non | Un test par magasin sur plateformes simulées, comme `useRecorder.test.ts` |
| `hooks/useTerrainElevation.ts` (156 l.), `hooks/useSessionSurfaces.ts` (108 l.) | Faible : cache et version de calcul | Version changée → recalcul ; réseau en échec → message |
| `components/drawRoot.ts` (382 l.), `components/drawShareImage.ts` (278 l.) | Faible : dessin sur canevas, calculs déjà dans `core/rootPath.ts` et `core/shareImage.ts` | Rien, ou un test de `readRootColors` avec repli |
| `theme/lightToken.ts`, `platform/motion.ts`, `screen.ts`, `notification.ts`, `compass.ts`, `share.ts`, `systemBars.ts`, `permissions.ts` | Faible : accès natifs, vus au téléphone | Rien (essais au téléphone) |
| `core/types.ts`, `running/types.ts`, `cycling/cyclingConfig.ts`, `surfing/surfConfig.ts`, `library/folderLayout.ts`, `core/beepDurations.ts`, `recording/beepSound.ts` | Nul : types et constantes | Rien |

Autres constats sur les tests :
- `src/test/` ne contient que `setup.ts` (fuseau `Europe/Paris`) : voir A2 pour le contenu à y mettre.
- Tests en double : A12 (dernier point).
- Aucun `it.only`, `it.skip`, `describe.skip`, `.todo`.

---

## G. Docs

Comparaison par script de la liste des fichiers de `src/` (459) et des noms cités dans `docs/INVENTAIRE.md` (266 lignes).

- **Fichier cité qui n'existe plus** : `SurfSpanLayer.tsx` (`INVENTAIRE.md:218`, « la vague, le vol ou la remontée choisis… sur la carte du surf »). Il a été renommé `components/TrackSpanLayer.tsx`, que la ligne 233 décrit déjà (« ex-`SurfSpanLayer` ») : retirer la mention de la ligne 218.
- **Fichiers de `src/` absents de la carte** : aucun (tout fichier `.ts`/`.tsx` hors test y est nommé ; les `.css` le sont par « (+ `.css`) » ; `components/ui/*` par la ligne 245).
- Écarts de fond, à reprendre à la prochaine passe `doc` :
  - `INVENTAIRE.md:11` titre « `core/` : noyau, SI, sans notion de sport », alors que `core/` porte `sportProfiles.ts`, `activities.ts`, `activityPresets.ts` (et importe des types de domaine, C6).
  - `INVENTAIRE.md:118` « `planning/` … logique pure » : `planning/brouter.ts` écrit dans le stockage (C4).
  - Les tests de `planning/geocoding.ts` sont dans `brouter.test.ts` : la carte ne le dit pas.
  - Après les lots issus de cet audit : `src/test/*.fixture.ts`, `core/angles.ts`, `components/chartStyle.ts` à ajouter.

---

## H. Questions à poser à l'utilisateur

Une réponse par défaut pour chacune.

1. **Chiffres à virgule ou à point ?** Aujourd'hui « 12,4 km » dans Profil et Statistiques, « 12.40 km » dans la bibliothèque et les analyses. Par défaut : la virgule partout (interface en français), par un seul formateur.
2. **Durées : « 1h24 » ou « 1 h 24 » ?** Les deux se voient sur la page Profil. Par défaut : « 1 h 24 » partout.
3. **Réussis en vert et ratés en rouge dans le tableau des manœuvres** : les couleurs de l'interface (qui foncent ou s'éclaircissent avec le thème sombre) ou des couleurs fixes de données ? Par défaut : celles de l'interface.
4. **Le test qui chronomètre le retour d'une boucle (moins de 0,2 s)** : le garder tel quel ? Par défaut : le relâcher à 1 s, pour qu'il ne casse que sur un vrai ralentissement.
5. **Anciens écrans d'analyse aux valeurs en dur** (voile, course, surf, réglages) : les migrer vers les variables en un lot à part, ou seulement quand on y touche ? Par défaut : seulement quand on y touche, sauf les tableaux et graphes (A3, A4), migrés d'un coup parce que communs.

---

## I. Chiffres

- **Fichiers lus** : 459 fichiers de `src/` parcourus par script (dont 37 `.css`, 108 `*.test.ts`, 6 256 lignes de CSS, 84 679 lignes en tout) ; une soixantaine lus en partie à la main pour vérifier chaque constat ; `docs/INVENTAIRE.md` en entier, `CLAUDE.md`, `package.json`, `vite.config.ts`.
- **Occurrences par formule** (code hors tests) :
  - `Math.round(x * 10) / 10` : 9 (dont 2 fonctions nommées, `toTenth`, `r1`) ; `Math.round(x * 100) / 100` : 7 (dont `toHundredth`, `roundTerrainZ`) ; `parseFloat(x.toFixed(n))` : 12 ; `toFixed(` : 102 lignes dans 25 fichiers ; `.replace('.', ',')` : 4.
  - `padStart(2, '0')` : 18 lignes, 6 fonctions `pad` locales ; `/ 3600` : 4.
  - Nœuds `1.94384` : 1 (seulement `core/units.ts:5`, bien) ; `1852` : 2 (`units.ts:160`, `sportProfiles.ts:492`) ; `3.6` littéral : 1 (`surfing/surfConfig.ts:7`, au lieu de `kmhToMs`).
  - Rayon terrestre `6371` : 1 en code (`EARTH_RADIUS_M`), 20 en tests, avec 111 195 (×8) et 111 320 (×5) à côté.
  - `Math.atan2` : 5 (3 avec conversion à la main) ; normalisation 0–360 : 4 ; écart signé : 2 ; `Math.round(cap) % 360` : 7 ; `Math.hypot` : 25 (sain, aucun doublon de formule) ; `Math.PI / 180` : 1.
  - Message d'erreur : 5 fonctions, 23 recopies, 35 « erreur inconnue ».
- **Thème** : 97 variables distinctes dans `tokens.css` ; 1 jamais lue (`--radius-xl`) ; 0 définie deux fois par erreur (redéfinitions sombre et économe voulues) ; 20 variables locales posées par les composants (`--tab-accent`, `--help-accent`…), toutes lues ; couleurs en dur dans les `.css` hors `tokens.css` : 3 hex, 7 `rgb()`, toutes justifiables sauf `ZoomableChart.css:30-32` ; dans les `.tsx` : 86 hex (dont 60 dans `core/activities.ts`, nuances voulues), 395 longueurs en px, 689 `style={{`, 62 `fontSize: 11`, 27 `borderRadius` en dur ; 15 valeurs de z-index en dur ; 12 recettes d'ombre ; 10 `@media` hors des requêtes partagées de `useNarrowScreen` (sur 30).
- **Qualité** : `any` 0 ; `@ts-ignore`/`@ts-expect-error` 0 ; `eslint-disable` 10 (toutes commentées) ; `as unknown as` 4 en code ; `console.log` 0 ; `TODO`/`FIXME` 0 ; `catch {}` vide 0 ; `.catch(() => {})` volontaires 45 (appels natifs « au mieux ») ; imports circulaires 0 ; imports de couche à revoir 6 (C2 à C6) ; fichiers de plus de 600 lignes : 24.
- **Tests** : 108 fichiers, 18 903 lignes ; 26 fichiers recréent leur géodésie ; 28 générateurs de trace ; 4 fabriques de fiche identiques ; 3 groupes de tests en double ; 1 test chronométré.
- **Constats par section** : A 12 (dont 4 gros ou moyens : A2, A3, A4, A11) ; B 4 ; C 13 ; D 8 (+ 6 écartés) ; E 6 ; F 12 lignes de tableau ; G 1 écart de fichier + 3 de fond ; H 5 questions.

### Ordre proposé pour un lot d'assainissement (sans rien trancher)
1. Petits doublons sans risque, en un passage : A1, A5, A6, A7, A9, A10, `--radius-xl`, exports morts (E). Tests et `vitest run` suffisent.
2. Fixtures de test (A2) : `src/test/` d'abord, puis migration par dossier, attendus inchangés.
3. Tableaux et graphes communs (A3, A4) puis règles CSS (A11) et variables z-index/ombres (C7) : banc avant/après.
4. Après réponse aux questions H1 et H2 : un seul formateur de nombres et de durées.
5. Extraction des priorités non testées (F, deux premières lignes ; A8) : petit, mais touche des décisions de l'utilisateur, donc relecture.
