# 01 · Graphes et composants

Audit en lecture seule du 28/10 : `src/components/` (hors `ui/`) et la fabrication des graphiques, modules compris. Les numéros de ligne sont relevés sur `main` (86b3f8d).

**Réponse à la question centrale.** Les graphiques ne passent pas par une fonction unique appelée avec des paramètres.

- **Ce qui est partagé, et bien partagé** : la coque commune.
  - `ZoomableChart` et `ChartZoomProbe` : zoom, « Tout voir », « Afficher » et « +carte ».
  - `useChartZoom`, et `core/chartZoom.ts` (`visibleIndexRange`, `sampledIndices`, `niceTicks`, `axisRangePath`).
  - Le magasin du survol (`useChartHover`, `HoverReadout`, `HoveredTrackMarker`) et `chartHover.ts`.
  - `ChartFold`, `markReferenceLines`, `gradeGradientDefs`.
- **Deux graphes complets sont partagés** : `HeartRateChart` (6 appelants) et `ElevationProfileMini` (2 appelants), plus trois enveloppes, `CardioCurve`, `SpeedPolarChart` et `FitnessTestCurves`.
- **Ce qui est réécrit à chaque fois** : l'intérieur du graphe Recharts, c'est-à-dire `ResponsiveContainer > ComposedChart > ChartZoomProbe > CartesianGrid > XAxis zoomé > YAxis colorée > Tooltip vide > séries`.
  - Ce squelette revient 15 fois sur les graphes reliés à la trace, dans 8 fichiers.
  - Les copies ont dérivé : animation laissée active, grille, couleurs, `syncId` présent ou non, unité absente.
  - Chaque module refabrique aussi ses lignes de données, son axe, ses lectures et ses gestionnaires de survol.

Il reste donc à mettre en commun deux choses : le graphe relié à la trace lui-même (A1) et la mécanique des graphes en temps (A2).

## Inventaire des graphes

La colonne « Composant » donne la fonction ou le composant qui pose le graphe Recharts. « Survol carte » : le survol déplace le repère sur la carte (`setHoveredIndex`). « Pliage » : `ChartFold` ou un repli équivalent.

| Graphe | Composant (fichier:lignes) | Appelants | Zoom | Survol carte | Pliage | Remarques |
|---|---|---|---|---|---|---|
| Vitesse (voile, en temps) | `speedChart`, SailingModule:584-601 (`LineChart`) | graphiques, plein écran (`companionCharts`) | `chartZoom`, commun avec vent et FC | oui | oui (`graphTitle`) | `#1976d2` (ailleurs `#1e88e5`), axe sans unité, marge gauche −25, animation active |
| FC (voile, graphiques) | `HeartRateChart` via `heartChart`, SailingModule:622-627 | graphiques, plein écran | `chartZoom` | oui | oui | lignes refaites dans le module (`heartRows`, 529-532) |
| Polaire de vitesse | `SpeedPolarChart.tsx` (`RadarChart`) | SailingModule:1104, `WindAdjustOverlay` | non | non | oui | bulle de Recharts ; couleurs en dur |
| Vent (voile) | `windChart`, SailingModule:603-620 (`LineChart`) | onglet vent, plein écran | `chartZoom` | oui | non | points des manœuvres (`maneuverDot`) ; animation active |
| Courbe cardio | `CardioCurve`, HeartRatePanel.tsx:72-115, puis `HeartRateChart` | panneau cardio des 4 modules, plein écran de 3 modules | `cardioZoom` de chaque module | oui | non | refait ses `minutes` à chaque instance |
| Nuage FC / vitesse | HeartRatePanel.tsx:257-271 (`ScatterChart`) | cardio, à pied et à vélo | non | non | non | bulle de Recharts ; `#1e88e5` et `#fb8c00` en dur |
| Vitesse (à pied et à vélo, Séparés) | `separateChart('vitesse')`, LandModule:964-977 | graphiques, plein écran | `zoom` (en distance) | oui | oui | animation active ; `syncId` |
| Altitude colorée par la pente | `altitudeChart`, LandModule:889-904 | graphiques, zones de pente, plein écran | `zoom` | oui | oui | animation active |
| FC (à pied et à vélo) | `HeartRateChart`, LandModule:987-992 | graphiques | `zoom` | oui | oui | |
| Cadence | `separateChart('cadence')`, LandModule:995-1010 | graphiques | `zoom` | oui | oui | |
| Superposés (4 séries) | `graphStack`, LandModule:1031-1060 | graphiques, plein écran | `zoom` | oui | séries repliables | 2 séries animées sur 4 |
| Énergie (puissance ou cumulée) | `energyChart`, LandModule:1075-1100 | énergie, plein écran | `energyZoom` (en temps) | oui | non | |
| Profil d'altitude compact (« général ») | `ElevationProfileMini.tsx` | LandModule:1111-1115, PlanningPage:1071 | `profileZoom`, ou celui de la page | oui (la planification passe par un état à elle) | non | deux façons de lire la valeur (`read` et `readout`) |
| Test guidé : vitesse et cible, puis FC | `FitnessTestCurves`, FitnessTestPanel.tsx:63-180 (2 `ComposedChart`) | onglet test, plein écran | `testZoom` | oui | non | le graphe de FC n'a pas « +carte » |
| Protocole du test | `FitnessTestPlanChart.tsx` (2 `ComposedChart`) | FitnessTestPage:110 | non | non | non | bulles de Recharts ; pas des paliers en dur (D3) |
| FC de repos | `RestingHrChart.tsx` | RestingHrTestPage (3 fois) | non | non | non | |
| Vitesse (surf) | `speedChart`, SurfModule:429-451 | graphiques, plein écran | `zoom` (en temps) | oui | oui s'il y a la FC | bandes des vagues et des vols |
| FC (surf) | `HeartRateChart` via `heartChart`, SurfModule:453-458 | graphiques | `zoom` | oui | oui | pas de `syncId` avec la vitesse |
| FC (muscu) | `HeartRateChart`, MuscuModule:230-246 | général | `zoom` | magasin du survol (pas de carte) | non | recopie de `CardioCurve` (A3) |
| Courbe d'un saut | `JumpCurveChart`, JumpsPanel.tsx:107-161 (`LineChart`) | onglet sauts des 3 modules | zoom à lui | oui | non | survol dans un état à lui (B4) ; grille `--line-soft` |
| Évolution des répétitions | IntervalAnalysis.tsx:491-509 | onglet fractionné | non | un clic montre la répétition sur la carte | la séance se replie | bulle de Recharts |
| Profil d'une répétition | `IntervalProfileChart`, IntervalAnalysis.tsx:143-190 | onglet fractionné | zoom à lui | non (les lignes ne sont pas des points de la trace) | la séance se replie | survol dans un état à lui (B4) |
| Mini-courbes des répétitions | `Sparkline`, IntervalAnalysis.tsx:233-252 (SVG fait main) | tableau des répétitions | non | non | non | |
| Statistiques : un point par session | StatisticsPage:658-708 | Statistiques | oui | non | non | hors zone, cité pour l'inventaire |
| Statistiques : barres de régularité et de charge | StatisticsPage:752-765, 814-822 (`BarChart`) | Statistiques | non | non | non | `loadBars.map` refait à chaque rendu |
| Statistiques : FC moyenne par session | StatisticsPage:832-850 | Statistiques | non | non | non | |
| Activités du Profil | `ActivityChart.tsx` (barres HTML et CSS) | ProfilePage | non | non | les totaux se replient | pas de Recharts, rien à mettre en commun |

**Déjà commun et partagé** : le zoom et ses gestes, « Tout voir », « Afficher » et « +carte », la lecture au-dessus du graphe (`ChartReadout`), le survol par le magasin, les repères (`markReferenceLines`), le dégradé de pente, l'échantillonnage (`sampledIndices`), les graduations rondes (`niceTicks`), les couleurs de la FC, de la cadence et des surbrillances.

**Recopié au lieu d'être partagé** :
- le squelette Recharts (A1) ;
- l'axe du temps et les lignes des graphes en temps (A2) ;
- les lectures de la FC (A2) ;
- le gestionnaire de survol (A7) ;
- les couleurs de la vitesse, de l'altitude et de l'énergie (A9) ;
- le texte d'aide du zoom (A10) ;
- la tête « nom + lecture » d'un graphe (A11).

## A. Doublons

### A1. Squelette du graphe relié à la trace, recopié 15 fois

**Copies.**
- ElevationProfileMini.tsx:64-81 ; HeartRateChart.tsx:45-67 ;
- FitnessTestPanel.tsx:144-158 et 161-178 ;
- JumpsPanel.tsx:135-158 ; IntervalAnalysis.tsx:166-187 ;
- LandModule.tsx:889-904, 964-977, 995-1010, 1031-1060, 1079-1098 ;
- SailingModule.tsx:584-601, 603-620 ;
- SurfModule.tsx:429-451 ; StatisticsPage.tsx:658-708.

**Ce qui est identique**, dans cet ordre :
- `ZoomableChart` (`zoom`, `onLeave`, `onShowOnMap`, `style`), puis `ResponsiveContainer` ;
- le graphe, avec `data`, `onMouseMove`, `onTouchMove`, et `margin={{ top: 5, right: 10, left: 0, bottom: 0 }}` ;
- `ChartZoomProbe`, puis `CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)"` ;
- `XAxis type="number" allowDataOverflow`, avec `domain` et `ticks={niceTicks(zoom.shown)}` tirés de `zoom.shown` ;
- `YAxis` à la couleur de la série, `width` 46, unité écrite verticalement ;
- `Tooltip content={NO_TOOLTIP_CONTENT}` ;
- `Line` ou `Area` avec `dot={false}`, `activeDot` et `connectNulls={false}`.

**Ce qui diffère.**
- Voulu : la clé et le format de l'abscisse (distance, minutes, heure, secondes), le type de série (ligne, aire, marches, dégradé), les éléments ajoutés (bandes, seuils, repères), le `syncId` (à pied seulement).
- Non voulu, des dérives :
  - animation laissée active (B2) ;
  - grille `--line-soft` et graduations sans couleur (JumpsPanel:142-146) ;
  - `ticks` tirés de `zoom.view` au lieu de `zoom.shown` (JumpsPanel:144, IntervalAnalysis:172) ;
  - en voile, axe de vitesse sans unité et marge gauche à −25 (SailingModule:591, 595).

**Pièce unique proposée** : `components/TrackChart.tsx`.

```tsx
<TrackChart zoom rows x={{ key, format }}
  yAxes={[{ id, color, unit, domain, reversed, hide }]}
  series={[{ kind: 'line' | 'area' | 'step', key, yAxisId, color, width, gradientId? }]}
  onHover={trackHover(rows)} onLeave onShowOnMap showReset syncId style>
  {bandes, seuils, repères}
</TrackChart>
```

- À côté : `timeOfDayAxis(t0)`, `minutesAxis()`, `distanceAxis(symbol)`.
- `HeartRateChart` ne serait plus qu'une enveloppe de 15 lignes.

**Risques.**
- Recharts ne voit pas un `ReferenceLine` ou un `ReferenceArea` rangé dans un composant à lui (déjà noté dans markReferenceLines.tsx:5-9 et FitnessTestPlanChart.tsx:43). Les ajouts doivent rester des tableaux passés directement en `children`.
- Le banc doit prouver la neutralité : texte des lectures et graduations identiques avant et après.

**Taille** : gros, en deux lots (la pièce et la course et le vélo ; puis la voile, le surf, le test et les sauts). **Confiance** : sûr.

### A2. Mécanique des graphes en temps, recopiée en voile, en surf, en muscu et dans le cardio

**Copies.**
- **Minutes depuis le premier point** : SailingModule:512-515, SurfModule:368, LandModule:522-525, MuscuModule:141, HeartRatePanel.tsx:84-85 (`CardioCurve`).
- **Zoom de 0 à la dernière minute** : SailingModule:517 et 548, SurfModule:369 et 410, LandModule:527-530 et 649-657 (deux fois), MuscuModule:143-145.
- **Axe des heures**, identique au caractère près : SailingModule:538-543 = SurfModule:387-392.
- **Lectures** (`readable`, `readAt`, `speedReadout`, `heartReadout`) : SailingModule:564-576 ≈ SurfModule:399-409.
  - La lecture de la FC est identique à 5 endroits : SailingModule:569-573, SurfModule:405-409, HeartRatePanel.tsx:97-101, MuscuModule:156-162, LandModule:814-817.
- **Graphe de FC de l'onglet** (`heartChart`) : SailingModule:622-627 ≈ SurfModule:453-458.
- **Plein écran**, cas « graphiques » et « cardio » de `companionCharts` : SailingModule:629-662, SurfModule:460-490, LandModule:1117-1145.
- **Valeur de FC des lignes** (`Math.round(smoothed[i])`) : SailingModule:529-532, SurfModule:379, LandModule:699, HeartRatePanel.tsx:92, MuscuModule:153, FitnessTestPanel.tsx:97.
  - Le cas `undefined` n'est testé qu'à pied et en surf ; la voile, le cardio, la muscu et le test ne le testent pas.

**Ce qui diffère** : le nom de la série de vitesse (`vitesse` en voile, `speed` ailleurs), son unité (en voile, conversion par une chaîne, voir B9), les bandes du surf.

**Pièces proposées.**
- `hooks/useTimeChartAxis.ts` : `useTimeChartAxis(track, sessionKey)` rend `{ minutes, fullRange, zoom, cardioZoom, timeAxis(zoom), readable(zoom, i), readAt(i) }`.
- `components/chartReadouts.ts` : `heartRateReadout(smoothed, minutes, zoom, at)` et `speedReadout(...)`, fonctions pures avec leurs tests.
- `CardioCurve` reçoit `minutes` au lieu de les recalculer.

**Risque** : faible, à condition que le banc montre des lectures identiques au caractère près. **Taille** : petit à moyen, une session Opus. **Confiance** : sûr.

### A3. La courbe de FC de la muscu recopie `CardioCurve`
- **Copies** : MuscuModule.tsx:141-162 et 230-246, contre HeartRatePanel.tsx:72-115.
- **Identique** :
  - les minutes, `visibleIndexRange` puis `sampledIndices(…, smoothed)`, les lignes `{ index, minutes, hr }` ;
  - la lecture des bpm avec l'heure (`formatClock(minutes × 60 000)`, c'est-à-dire `minutesLabel`) ;
  - l'axe des minutes à graduations rondes, et `HeartRateChart`.
- **Différent** : la muscu ajoute ses bandes de phases et ses repères (en `children`) ; sa hauteur est 220.
- **Pièce unique** : `CardioCurve` accepte des `children` et les passe à `HeartRateChart`, qui les accepte déjà.
- **Risque** : aucun. **Taille** : petit. **Confiance** : sûr.

### A4. Graphes du test guidé : protocole et séance
- **Copies** : FitnessTestPlanChart.tsx:9-13, 44-50 et 55-87, contre FitnessTestPanel.tsx:21-25, 105-121 et 144-178.
- **Identique** :
  - les constantes `PHASE_FILL '#90a4ae'`, `MARK_COLOR` et `SPEED_COLOR` ;
  - les bandes des phases (opacité 0,12 puis 0,04 en alternance, nom en haut à l'intérieur) ;
  - `xAxis(hide)`, et deux graphes empilés, vitesse puis FC ;
  - les noms « Échauffement », « Rampe », « Récup. ».
- En plus, le graphe de FC de `FitnessTestCurves` (161-178) refait `HeartRateChart` : axe en bpm, ligne de FC, bande.
- **Pièce unique** :
  - `components/fitnessTestChartParts.tsx`, avec les constantes, `phaseAreas(phases, toX, labelled)` et `phaseLabel` ;
  - le graphe de FC passe par `HeartRateChart` (`zones={null}`, la bande en `children`).
- **Risque** : faible. **Taille** : petit. **Confiance** : sûr.

### A5. Tableau des tranches, avec barre de part et « Voir »
- **Copies** : CadencePanel.tsx:106-142, contre HeartRatePanel.tsx:193-233.
- **Identique** :
  - le libellé d'une tranche est la même expression : CadencePanel.tsx:119 = HeartRatePanel.tsx:207 (`band === 0 ? '< …' : band === bounds.length ? '≥ …' : 'a-b'`) ;
  - la barre de part de 8 px, le pourcentage, et `MapToggle` en `HIGHLIGHT_SHOWN_COLOR`.
- Le tableau des zones de pente (LandModule:1451-1477) suit le même patron, sans barre.
- **Pièce unique** :
  - `components/BandShareTable.tsx`, avec `rows: { key, swatch, label, extra?, timeS, share, shown, disabled }`, `onShow` et `mapless` ;
  - `bandRangeLabel(bounds, band)`, fonction pure dans `core/` avec son test.
- **Risque** : les règles du téléphone pour les tableaux (`analysisMobile.css`), à vérifier au banc. **Taille** : petit. **Confiance** : sûr.

### A6. Styles de tableau, de note, de panneau, et titre de panneau

**Copies.**
- **Style de tableau** `{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }`, 12 copies :
  - composants : CadencePanel:30, FlightPumpingPanel:57, HeartRatePanel:193, IntervalAnalysis:199, JumpsPanel:76, TopsPanel:39 ;
  - modules : LandModule:1397 et 1451, SailingModule:718, 758 et 883, SurfModule:137.
- **Cellule** `{ padding: '0.4em 0.6em', textAlign: 'center' }` : dans la plupart des mêmes fichiers.
- `tableStyle`, `cellStyle` et `noteStyle` sont identiques dans JumpsPanel:76-78 et IntervalAnalysis:199-201.
- **Style de panneau** `{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }` : 20 fois, plus 13 fois sous l'alias `cardStyle` (LandModule:219 et SurfModule:129 font `const cardStyle = CARD_STYLE`).
- **Fonction `heading`**, identique : JumpsPanel:179-183 = IntervalAnalysis:300-304.
- **Style de bulle** `{ fontSize: 'var(--text-xs)' }` : HeartRatePanel:66, IntervalAnalysis:202, StatisticsPage (trois fois).

**Pièce unique.**
- Dans `styles.ts` : `ANALYSIS_PANEL_STYLE`, `TABLE_STYLE`, `CELL_STYLE`, `NOTE_STYLE`. Mieux encore : une classe `.an-table` dans `analysisMobile.css`.
- Un composant `PanelHeading({ label, helpKey, open, onToggle, extra })`.

**Risque** : `MapToggle` garde son style en ligne pour passer devant les règles de boutons des tableaux du téléphone (ui/MapToggle.tsx:20). Un passage aux classes doit garder cette priorité. **Taille** : moyen (mécanique, mais beaucoup de fichiers). **Confiance** : sûr.

### A7. Le gestionnaire de survol, recopié 8 fois
- **Copies** : ElevationProfileMini:55-58, FitnessTestPanel:123-126, HeartRateChart:40-43, LandModule:784-787, 791-794 et 796-799, SailingModule:503-506, SurfModule:394-397.
  - Partout le même code : `(e) => { const index = hoveredTrackIndex(e, data); if (index !== null) onIndex(index); }`.
- Les alias `clearHover` et `hoverIndex = setHoveredIndex` reviennent dans LandModule:782-783, SailingModule:507-508 et SurfModule:384-385.
- **Pièce unique** : `trackHover(data, onIndex = setHoveredIndex)` dans `chartHover.ts`, testée dans `chartHover.test.ts`.
- **Taille** : petit. **Confiance** : sûr.

### A8. « Une allure se lit en km/h », écrit 8 fois alors que `editSpeedUnit` existe
- `editSpeedUnit` (core/units.ts:98) fait exactement `isInverseUnit(u) ? 'kmh' : u`.
  - Recopié dans FitnessTestPanel:80 et 211, HeartRatePanel:137, IntervalAnalysis:272, LandModule:554, 624, 1508 et 1592.
- La vitesse sous laquelle une allure n'est plus montrée (0,3 m/s) est écrite trois fois : IntervalAnalysis:100 (`MIN_PACE_SPEED_MS`), et en dur dans LandModule:691 et 808.
- **Pièce unique** : `editSpeedUnit` partout, et `MIN_PACE_SPEED_MS` dans `core/units.ts`.
- **Taille** : petit. **Confiance** : sûr.

### A9. Couleurs de données recopiées
- **`#1e88e5`, la vitesse** : 20 fois dans 8 fichiers.
  - `SPEED_COLOR` est déclarée trois fois (FitnessTestPanel:22, FitnessTestPlanChart:10, IntervalAnalysis:79).
  - Le reste est en dur : LandModule:808, 852-853, 875, 973, 1046 ; SurfModule:402, 438-439, 447, 468, 782 ; HeartRatePanel:266 et 273 ; MuscuModule:70.
- **`#e64a19`, l'altitude et l'énergie** : 14 fois. `ALTITUDE_COLOR` dans ElevationProfileMini:21 ; en dur dans LandModule (839, 856, 876, 1078, 1088-1094, 1127, 1486) et SpeedPolarChart:25.
- **`#1976d2`** : la vitesse en voile seulement (SailingModule:567, 597, 636), une teinte différente du reste.
- **Autres** :
  - `SHOWN_COLOR = '#7b1fa2'` (IntervalAnalysis:77) double `HIGHLIGHT_SHOWN_COLOR` (voir C3) ;
  - `PHASE_FILL` est déclarée deux fois, `MARK_COLOR` trois fois, `#757575` deux fois.
- **Pièce unique** : `components/chartColors.ts` (`SPEED_COLOR`, `ALTITUDE_COLOR`, `ENERGY_COLOR`, `TREND_COLOR`, `PHASE_FILL`, `MARK_COLOR`), sur le modèle de `heartRateColors.ts` et `cadenceColors.ts`. Les couleurs restent en dur, comme le veut CLAUDE.md, mais à un seul endroit.
- **Taille** : petit. **Confiance** : sûr.

### A10. L'aide du zoom, recopiée
- Les constantes `ZOOM_HINT_NARROW` et `ZOOM_HINT_WIDE` sont dans LandModule:122-123.
- Le même texte est réécrit dans SailingModule:579-581 et SurfModule:778, et en variante dans MuscuModule:219.
- **Pièce unique** : un export depuis `ZoomableChart.tsx`, puisque le texte décrit son comportement.
- **Taille** : petit. **Confiance** : sûr.

### A11. Tête de graphe : nom repliable et lecture
- **Copies** : LandModule:1066-1070 et 1485-1489, SurfModule:781-785 et 789-793, SailingModule:286-292 (`graphTitle`).
- L'infobulle « Replier le graphe de … » est construite de quatre façons (LandModule:952-954, SurfModule:783 et 791, SailingModule:289).
- **Pièce unique** : `ChartHead({ label, color, open, onToggle, read })`, à côté de `ChartFold`.
- **Taille** : petit. **Confiance** : probable.

### A12. Podium des tops, sur la carte et dans les panneaux
- SailingModule:472-483 trace le podium sur la carte (épaisseur 10, opacité 0,8) : c'est une recopie de `TopsHighlight` (TopsPanel.tsx:77-83).
- `renderTop3` (SailingModule:666-681) refait l'en-tête « 1er / 2e / 3e » de TopsPanel:44-46 ; JumpsPanel:82 a son propre `rank(k)`.
- **Proposition** : `TopsHighlight` accepte aussi les tops de VMG ; un `PODIUM_RANKS` commun.
- **Taille** : petit. **Confiance** : sûr pour le tracé sur la carte.

### A13. `signedPercent`, écrit deux fois et différemment
- CadencePanel:34-37 écrit « +0,0 % » pour zéro ; IntervalAnalysis:193-197 écrit « 0 % ».
- **Proposition** : une seule fonction, dans `core/units.ts`.
- **Taille** : petit. **Confiance** : sûr.

## B. Optimisations

### B1. Le zoom est tenu par le module : chaque image d'un zoom redessine toute la page d'analyse

**Où.**
- `useChartZoom` est appelé dans le module : LandModule:646-657, SailingModule:517 et 548, SurfModule:369 et 410, MuscuModule:144-145.
- `ZoomableChart.schedule` appelle `zoom.set` à chaque image d'un pincement (ZoomableChart.tsx:126-133).
- Seul `TrackSegmentsLayer` est mémoïsé dans toute la zone : la recherche de `memo(` ne trouve que 2 résultats dans `src/`.

**Effet.** Pendant un pincement, toute la page se redessine environ 60 fois par seconde. Pour la course, c'est LandModule entier (1 611 lignes) :
- tous les panneaux ouverts, tableaux compris, et `IntervalAnalysis` qui recalcule tout (B5) ;
- tous les autres graphes Recharts, dont les axes et `tick` sont des objets neufs à chaque rendu ;
- la carte (`AnalysisMap`).

**Propositions.**
- (a) Envelopper les graphes dans `memo`, avec des propriétés stables. A1 y conduit naturellement.
- (b) Ou bien tenir la plage zoomée dans un petit magasin par clé, sur le modèle du survol (`useSyncExternalStore`), lu par le graphe, sa lecture et « Afficher ».

**Gain attendu** : pendant le geste, seuls les 1 à 3 graphes qui partagent ce zoom se redessinent, au lieu de toute la page.

**Comment mesurer** : le profileur de React (nombre et durée des rendus pendant un pincement simulé au banc), ou `performance.mark` autour de `zoom.set`.

**Taille** : gros. **Confiance** : probable. Le mécanisme est sûr ; le coût réel au téléphone reste à mesurer.

### B2. Animations Recharts restées actives sur 6 séries
- **Où** : LandModule:900, 973, 1043 et 1046 ; SailingModule:597 et 616. Ces séries n'ont pas `isAnimationActive={false}`, que les 20 autres ont.
- **Pourquoi elles animent** : dans Recharts 3.10.1, la valeur par défaut est `'auto'`, c'est-à-dire animé dans le navigateur, sauf si l'appareil demande moins d'animations (`node_modules/recharts/lib/animation/JavascriptAnimate.js:45`).
- **Effet** : à chaque changement de plage (chaque image d'un pincement, chaque double toucher), la courbe de vitesse ou d'altitude rejoue son animation depuis l'ancien tracé. Elle traîne derrière le doigt et consomme du calcul pour rien.
- **Proposition** : ajouter `isAnimationActive={false}` ; A1 le réglera une fois pour toutes.
- **Gain** : un seul dessin par plage, au lieu d'une animation d'environ 1,5 s.
- **Mesure** : au banc, capture pendant un zoom, ou profileur de performance.
- **Taille** : petit. **Confiance** : sûr pour le code, probable pour l'effet ressenti.

### B3. La planification garde le point survolé dans son propre état
- **Où** : PlanningPage:388 (`useState` du point survolé), 526-546 (lecture), 1072 (`onHoverIndex={setHoveredIndex}` vers cet état).
- **Effet** : chaque mouvement de la souris ou du doigt sur le profil redessine toute la page de planification, carte comprise. C'est exactement ce que le magasin du survol (27/10) a supprimé dans les analyses.
- **Proposition** : passer au magasin (`setHoveredIndex`, `HoverReadout`, `HoveredTrackMarker` sur les points du profil). La propriété `readout` d'`ElevationProfileMini` n'aura alors plus d'appelant (E3).
- **Gain** : seuls le repère et la lecture se redessinent, pas la page.
- **Mesure** : profileur, avec un survol qui balaie le profil au banc.
- **Taille** : petit. **Confiance** : sûr pour le mécanisme.

### B4. Deux graphes gardent le survol dans leur propre état
- **Où** : `IntervalProfileChart` (IntervalAnalysis:156-157) et `JumpCurveChart` (JumpsPanel:118-122) appellent `setHovered` à chaque mouvement.
- **Effet** : tout le graphe Recharts se redessine à chaque mouvement. Pour le profil, c'est une ligne par répétition plus la moyenne : 21 `Line` pour une séance de 20 répétitions.
- **Proposition** : séparer la lecture, seule abonnée à un petit magasin local, du graphe, qui ne bouge plus.
- **Gain** : par exemple, ne plus redessiner 21 courbes à chaque mouvement du doigt.
- **Mesure** : profileur. **Taille** : petit. **Confiance** : probable.

### B5. `IntervalAnalysis` refait tout à chaque rendu, et calcule deux fois les mini-courbes
- **Où** :
  - `sparkPoints` est calculé pour chaque répétition dans le panneau des répétitions (346), puis de nouveau dans le panneau du profil (543) ;
  - les lignes de l'évolution (470-480) et du profil (531-540) sont refaites à chaque fois ; le profil crée un objet par seconde, avec deux clés par répétition ;
  - `Math.min(...valeurs)` est appliqué à des tableaux étalés (352, 546-547) ;
  - rien n'est sous `useMemo`, et le composant se redessine à chaque rendu du module, donc à chaque image d'un zoom ailleurs dans la page (B1).
- **Proposition** : une fonction pure `intervalChartData(series, stepS)` dans `running/`, avec son test (voir C1), appelée une fois sous `useMemo`. Seule la conversion d'unité reste au rendu.
- **Taille** : petit. **Confiance** : sûr.

### B6. Les lignes de la courbe des sauts sont refaites à chaque rendu
- **Où** : JumpsPanel:311-319. À chaque rendu : une `Map`, un `flatMap`, un `Set`, un tri, puis `trackIndexAt` (une recherche dans la trace) pour chaque ligne. `onCurveHover(rows)` crée en plus une fonction neuve à chaque fois.
- **Proposition** : `useMemo` sur `[first, second, trackIndexAt]`.
- **Gain** : faible (quelques centaines de lignes), mais c'est refait à chaque rendu du module.
- **Taille** : petit. **Confiance** : sûr.

### B7. Lignes des graphes calculées même quand l'onglet est fermé
- **Où** :
  - LandModule:684-702 : `chartData` est calculé sans regarder si l'onglet est ouvert. `sampledIndices` parcourt toute la plage, puis fabrique 500 lignes ou plus. Le surf, lui, ne le fait que si l'onglet est ouvert (`open.graphiques`, SurfModule:372).
  - Même chose en voile pour `chartIndices`, `speedRows` et `heartRows` (SailingModule:520-532).
- **Proposition** : ne calculer que si « graphiques », « zones » ou le plein écran sont ouverts. Attention : la FC de « graphiques » et `gradeStops` en dépendent.
- **Gain** : modeste (un parcours de la trace à chaque zoom ou changement de session).
- **Taille** : petit. **Confiance** : probable.

### B8. `CardioCurve` recalcule ses minutes
- **Où** : HeartRatePanel:84-85. Chaque instance (le panneau et le plein écran) recalcule les minutes de toute la trace, alors que le module les a déjà (`trackMinutes`).
- **Proposition** : une propriété `minutes`, comme `FitnessTestCurves`.
- **Taille** : petit. **Confiance** : sûr.

### B9. En voile, la vitesse des graphes passe par une chaîne de caractères
- **Où** : SailingModule:525-527 et 215 font `parseFloat(formatKnots(v, unit))` : on formate en texte pour relire un nombre. C'est lent et fragile :
  - si une allure était un jour permise en voile, « 5:30 » deviendrait 5 ;
  - le tiret `'-'` donne `NaN`.
- Rien n'est faux aujourd'hui : `SAILING_UNITS` exclut `minkm` (useSportSettings.ts:47).
- **Proposition** : une conversion numérique (`knotsToDisplay`), arrondie.
- **Taille** : petit. **Confiance** : sûr (pour la fragilité).

### B10. Image de partage : un tracé par segment
- **Où** : drawShareImage.ts:131-139 fait un `beginPath` et un `stroke` par segment, soit environ 10 000 pour une trace de 3 h à 1 Hz.
- **Proposition** : regrouper les segments consécutifs de même couleur. L'image n'est dessinée qu'une fois par partage.
- **Taille** : petit. **Confiance** : à vérifier (le gain).

## C. Architecture

### C1. Des calculs mêlés au rendu, sans test
- **Où** :
  - `IntervalAnalysis.tsx` : lissage des mini-courbes (210-227), dégradé de couleur des répétitions (86, 111-117), droite de tendance (469), échelle du profil (543-551), lignes de l'évolution et du profil ;
  - `JumpsPanel.tsx:87-91` et `311-319` : fusion des courbes de deux sauts ;
  - LandModule:680-1145, SailingModule:503-662, SurfModule:366-490 : lignes, lectures, axes.
- **Règle** : CLAUDE.md place un calcul pur « dans `core/`, `sailing/`, `running/`… avec son `*.test.ts` ».
- **Proposition** : `running/intervalCharts.ts`, `jumpCurveRows` dans `core/jumps.ts`, `trackChartRows` dans `core/chartRows.ts`, chacun avec son test. Le rendu ne garde que l'affichage.
- **Taille** : moyen. **Confiance** : sûr.

### C2. Onglet « graphiques » de la voile : noms de graphes hors de la règle commune
- **Où** : SailingModule:288-289 force `fontSize: 'var(--text-s)', fontWeight: 700` sur `ChartFold`. Le titre du graphe du vent est un `<strong>` en `--text-s` (vers la ligne 1207).
- **Règle** : MISE_EN_PAGE.md:38 fixe les noms des graphes à 10 px (`--chart-name-size`). Le nom n'a pas non plus la couleur de sa série, qu'il a à pied et en surf.
- **Autre écart** : la disposition elle-même diffère. Sous-panneaux en pointillés de largeur fixe (500 et 350 px), et une case réservée à un graphe replié (SailingModule:293-297, 1081-1105).
- **Proposition** : aligner les noms sur la règle. La disposition est une question pour l'utilisateur (F1).
- **Confiance** : sûr pour l'écart, à vérifier pour l'intention.

### C3. Le violet de surbrillance est redéclaré
- **Où** : IntervalAnalysis:77 déclare `SHOWN_COLOR = '#7b1fa2'` au lieu d'utiliser `HIGHLIGHT_SHOWN_COLOR`.
- **Règle** : CLAUDE.md fait venir les couleurs de surbrillance de `components/highlightColors.ts`.
- **Taille** : petit. **Confiance** : sûr.

### C4. Des choix entre quelques options faits avec des boutons maison
- **Où** :
  - LandModule:1287-1292 (Séparés / Superposés) et 1355-1360 (Puissance / Cumulée) ;
  - JumpsPanel:254-261 (tri par hauteur, vol ou longueur) ;
  - SurfModule:611 (tri des vagues, par une liste déroulante).
- **Règle** : la DA de CLAUDE.md dit « Choix parmi quelques options : bouton glissant (`SegmentedControl`) ».
- Dans JumpsPanel, `buttonStyle` (175-178) est une copie exacte du style de `MapToggle`, et le bouton « Voir / Masquer » (293-295) devrait être `MapToggle`.
- **Proposition** : `SegmentedControl` pour les choix, `MapToggle` pour « Voir / Masquer ».
- **Taille** : petit. **Confiance** : à vérifier ; la règle est peut-être plus récente que ces écrans (F4).

### C5. `components/sessionTrack.ts` est un calcul pur rangé dans `components/`
- **Où** : sessionTrack.ts:34-55 et 65-77 lit le GPX et calcule les vitesses de couleur, l'emprise et les bornes suggérées. Il n'a pas de test et importe `hooks/useSportSettings`.
- **Proposition** : le déplacer dans `library/` (il sert à la vignette et au partage), avec un test.
- **Taille** : petit. **Confiance** : probable.

### C6. Des commentaires périmés contredisent MISE_EN_PAGE
- HeartRateChart.tsx:32 et ElevationProfileMini.tsx:28-29 disent « +carte une fois zoomé ». Le bouton est maintenant toujours là (ZoomableChart.tsx:20-22, MISE_EN_PAGE.md:37).
- ZoomableChart.css:1 dit « planification et analyses course et vélo », alors que la pièce sert partout.
- **Taille** : petit. **Confiance** : sûr.

### C7. Les graphes reliés à la trace ne se comportent pas tous pareil
- `syncId` (le curseur commun aux graphes empilés) n'existe qu'à pied (LandModule:892, 966, 997, 1033). En voile et en surf, la vitesse et la FC partagent leur axe mais pas leur curseur.
- Le graphe de FC de `FitnessTestCurves` (FitnessTestPanel:161) n'a pas « +carte », alors que ZoomableChart.tsx:85 dit que « +carte » reste sur chaque graphe.
- Graduations, grille et marges : voir A1.
- A1 réglera tout cela d'un coup. Seul `syncId` est un choix à faire (F5).
- **Confiance** : sûr pour les constats.

### C8. Deux façons de poser un panneau partagé
- `TopsPanel`, `HeartRatePanel`, `CadencePanel` et `FlightPumpingPanel` sont posés dans le `ResizablePanel` du module.
- `JumpsPanel` et `IntervalAnalysis` créent eux-mêmes leurs `ResizablePanel` (identifiants tirés de `panelPrefix` ou `panelId`) et leur titre.
- Aucune règle n'est enfreinte, mais c'est incohérent. Si on unifie, ne pas renommer les `id`, qui gardent la taille mémorisée.
- **Confiance** : sûr. **Priorité** : basse.

### C9. Des propriétés de survol traversent 5 composants pour une seule valeur
- `onHoverIndex` et `onLeave` traversent `HeartRateChart`, `ElevationProfileMini`, `CardioCurve`, `HeartRatePanel` et `FitnessTestCurves`.
- Toutes les analyses y passent `setHoveredIndex`, le magasin ; seule la planification passe son propre état (B3).
- Après B3, ces composants peuvent écrire directement dans le magasin.
- **Confiance** : probable.

## D. Bugs probables

### D1. Le zoom du profil des répétitions survit au changement de session
- **Où** : IntervalAnalysis:557 construit la clé de remise à zéro avec `` `${seriesIndex}-${reps.length}-${length}` ``. `IntervalAnalysis` n'est pas remonté à chaque session : LandModule:1245 ne lui donne pas de `key` de session.
- **Scénario** :
  - on zoome sur le profil d'une séance de 10 × 400 m ;
  - on ouvre la séance de 10 × 400 m de la semaine suivante ;
  - la clé est la même, donc la plage zoomée de l'ancienne séance s'applique à la nouvelle. Le point survolé (`hovered`) reste aussi.
- **Correctif** : mettre la clé de la session dans la clé de remise à zéro.
- **Confiance** : probable.

### D2. Les pics de FC et de cadence peuvent disparaître dans « graphiques »
- **Cause** : les lignes sont choisies pour garder les extrêmes de la vitesse seulement (LandModule:687 avec `sampledIndices(…, chartSpeed)`, SailingModule:523, SurfModule:374). La FC et la cadence sont tracées sur ces mêmes lignes et perdent leurs extrêmes brefs. `CardioCurve`, lui, garde les extrêmes de la FC (HeartRatePanel:89).
- **Scénario** :
  - sortie de 3 h à 1 Hz, soit à peu près une ligne toutes les 22 s ;
  - un sprint fait culminer la FC 15 s entre deux lignes ;
  - le maximum se voit dans l'onglet cardio, pas sur la courbe de FC de « graphiques ».
- **Correctif** : garder les extrêmes de chaque série tracée (`sampledIndices` sur plusieurs séries).
- **Confiance** : probable. L'effet est seulement visuel.

### D3. Graphe du protocole : paliers à +0,6 km/h écrits en dur
- **Où** : FitnessTestPlanChart:65 place les points à `msToKmh(v0Ms) + 0.6 * k`. Le plan, lui, suit `params.protocol.stepMs` (recording/fitnessTest.ts:50, 95, 645).
- **Conséquence** : si le pas du protocole change ou devient réglable, les points ne tombent plus sur la courbe. C'est aussi un seuil en dur (règle 3).
- **Correctif** : prendre la cible du plan à l'instant du bip.
- **Confiance** : sûr. Le bug est latent : il apparaît dès que le pas change.

### D4. Un clic sur le graphe d'évolution peut choisir une répétition sans en viser une
- **Où** : IntervalAnalysis:481-486. `pick` lit `activeTooltipIndex` sans vérifier `isTooltipActive`, contrairement à `hoveredRow` (chartHover.ts:31-38).
- **Conséquence possible** : un clic hors des données sélectionnerait la dernière répétition survolée.
- **Confiance** : à vérifier au banc.

## E. Code mort

Chaque point est vérifié par une recherche dans tout `src/`.

1. **Propriété `className` de `ZoomableChart`** (ZoomableChart.tsx:81, 93, 228) : aucun des 15 `<ZoomableChart>` ne la passe. Sûr.
2. **Champs `timeLabel` et `display` de `WindGraphPoint`** (sailing/sailingAnalytics.ts:28, 36, 208-210) : calculés pour chaque ligne du graphe du vent, avec un `Date` et une chaîne par ligne, mais jamais lus. Sûr.
3. **Propriété `readout` d'`ElevationProfileMini`** (ElevationProfileMini.tsx:43, 63) : seule PlanningPage l'utilise. Elle sera morte après B3. Sûr, sous cette condition.
4. **Exports utilisés seulement dans leur propre fichier** : `getHoveredIndex` (useChartHover.ts:23), `hrMaxOriginLabel` (heartRateOrigin.ts:21), `DurationField` (WorkoutBlocksEditor.tsx:26), et les types `FlightPumpingPanelProps`, `JumpsPanelProps`, `ShareImageContent`, `TileImageLoader`, `SessionShare`, `HelpState`. Le mot `export` est de trop, sans autre effet. Sûr.
5. **Alias inutiles** : `const cardStyle = CARD_STYLE` (LandModule:219, SurfModule:129) et `hoverIndex = setHoveredIndex` (LandModule:783, SailingModule:508, SurfModule:385). Sûr.

## F. Questions à poser à l'utilisateur

1. **Onglet « graphiques » de la voile.** Faut-il le passer sur la pile de la course et du surf : graphes empilés, noms en petit et à la couleur de leur courbe, repli à leur place, polaire comprise ? *Réponse par défaut* : garder sa disposition, et n'aligner que les noms (C2) et la pièce commune (A1).
2. **Bleu de la vitesse.** La voile trace la vitesse en `#1976d2`, tout le reste en `#1e88e5`. Faut-il un seul bleu ? *Réponse par défaut* : `#1e88e5` partout.
3. **Bulles au survol.** Il en reste sur les graphes qui ne sont pas reliés à la trace : évolution des répétitions, nuage FC / vitesse, polaire, protocole du test, FC de repos, Statistiques. Faut-il les remplacer par la lecture au-dessus du graphe, pour un seul comportement partout ? *Réponse par défaut* : les laisser, car MISE_EN_PAGE ne vise que les graphes reliés à la carte.
4. **Séparés / Superposés, Puissance / Cumulée, tri des sauts et des vagues.** Faut-il les passer au bouton glissant ? *Réponse par défaut* : oui, c'est la règle de DA de CLAUDE.md.
5. **Curseur commun en voile et en surf.** Faut-il, comme à pied, que le curseur se déplace ensemble sur la vitesse et la FC ? *Réponse par défaut* : oui.

## G. Chiffres

- **Fichiers lus en entier : 31**, environ 3 300 lignes.
  - Les 23 fichiers de la liste demandée. Parmi eux, `drawShareImage.ts` (277 lignes) dessine l'image de partage sur canevas, pas un graphe.
  - Plus : `useChartHover.ts`, `useChartZoom.ts`, `core/chartZoom.ts`, `HoverMarker.tsx`, `ZoomableChart.css`, `PanelTitle.tsx`, `ui/MapToggle.tsx`, et la partie graphes de `FitnessTestPanel.tsx` (185 lignes sur 263).
- **Extraits lus**, environ 1 450 lignes : les passages des graphes de LandModule (environ 520 lignes), SailingModule (environ 330), SurfModule (environ 210), MuscuModule (environ 135), StatisticsPage (environ 120), et des passages de PlanningPage, `sessionTrack.ts`, `sailingAnalytics.ts`, `units.ts`, `fitnessTest.ts`.
- **Graphes** :
  - 27 graphes distincts à l'écran : 25 en Recharts, plus les barres HTML du Profil et les mini-courbes en SVG ;
  - ils sont posés par 24 racines Recharts (`ComposedChart`, `LineChart`…) dans 14 fichiers ;
  - 15 utilisations de `ZoomableChart`.
- **Recharts**, version 3.10.1 :
  - 6 types de graphe : `ComposedChart`, `LineChart`, `AreaChart`, `BarChart`, `ScatterChart`, `RadarChart` ;
  - 23 pièces distinctes en tout. En plus des 6 types : `Line`, `Area`, `Bar`, `Scatter`, `Radar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ReferenceLine`, `ReferenceArea`, `ReferenceDot`, `ResponsiveContainer`, `PolarGrid`, `PolarAngleAxis`, `PolarRadiusAxis`, `usePlotArea`.
- **Constats par section** : A 13, B 10, C 9, D 4, E 5, F 5.
