# 02 · Pages et modules d'analyse

Audit en lecture seule de `src/pages/` et de `src/components/ui/`, au 28/10 (HEAD 86b3f8d). Toutes les références sont `fichier:lignes`, relevées sur le code lu. Rien ici ne change l'écran : chaque proposition est faite pour être prouvée neutre au banc (`outils/banc/`, texte de la page relevé avant et après), sauf celles de la section F, qui attendent l'utilisateur.

Abréviations : **S** = `src/pages/SailingModule.tsx`, **L** = `src/pages/LandModule.tsx`, **U** = `src/pages/SurfModule.tsx`, **M** = `src/pages/MuscuModule.tsx`.

---

## Carte des trois modules

(Muscu ajouté en 4e colonne quand le bloc existe chez lui : c'est la 4e copie de plusieurs blocs.)

| Bloc fonctionnel | Sailing | Land | Surf | Muscu | Pièce partagée existante | Verdict |
|---|---|---|---|---|---|---|
| Lecture de la session depuis l'URL et activité de la fiche reprise (`receiveSession`) | 220-225 | 286-296 | 175-185 | 94-105 | `useSessionFromUrl` (la lecture seulement) | **recopié** ×4 (seul le chargeur diffère) |
| Garde « fichier affiché = fichier de l'URL » | 244 (`loadedFromMemory`) | 299, 304, 335, 392, 429 (5 fois en ligne) | 187 (`shownFile`) | 106 | aucune | **recopié**, et **divergent non voulu** en voile (brouillon sur l'URL, voir D1) |
| Brouillon de session et « Enregistrer la session », avertissement en quittant | 161-162, 974 | 299, 1190 | 188, 525 | 108, 195 | `useSessionDraft` (+ `useLeaveWarning`), `SessionSaveBar` | **partagé** (seul l'appel est répété) |
| Liste des activités et changement d'activité | 233-234 | 318-319 | 189-190 | 180-181 | `useChangeSessionActivity` | **recopié** (2 lignes ×4) |
| Onglets : sections ouvertes, choix de l'activité, « avancé », masque | 275, 279, 299-301 | 321-328 | 202-209 | 122-129 | `useOpenSections`, `useAdvancedTabs`, `maskAdvancedTabs`, `maskHiddenTabs` | **recopié** à l'identique (6 lignes ×4) |
| Onglets montrés selon la session | 308-312 | 344-348 | 214-217 | 130-133 | `shownTabs` | recopié (filtre propre à chacun : voulu) |
| `*_SECTION_DEFAULTS` | 110-122 (`SAILING_PANEL_DEFAULTS`) | 152-166 | 91-101 | 63 | `core/analysisTabs.ts` (`primary`) | **recopié** et **dérivable** : vrai exactement pour les onglets `primary` (voir A3) |
| Surbrillance unique, repères « Note » | 314, 352-355 | 351, 380-383 | 218, 226-229 | 136-138 (état local, sans carte) | `useMapHighlight`, `useSessionMarks` | partagé, 3 lignes de sélection recopiées |
| FC : profil, FC de la session, zones | 270-273 | 268, 276-277 | 211-213 | 88, 114, 119 | `useRunnerProfile`, `useSessionHeartRate`, `runnerHeartRateZones` | **recopié** (useMemo identique ×4) |
| Zone cardiaque montrée sur la carte (`hrZonePaths`) | 343-351 | 358-360, 486-492 | 230-238 | — | `heartRateZonePaths` | **recopié** à l'identique ×3 |
| Sauts montrés et leur surbrillance | 256-264, 319-322 | 335-343, 366-369 | — | — | `useSessionJumps` | **recopié** ×2 (conversion du seuil seule différente) |
| Pumping des vols (`flightPumping`, `pumpSummary`, podium) | 323-331 | — | 300-310 | — | `measureFlightPumping`, `summarizePumping` | **recopié** ×2, à l'identique |
| Trace colorée, emprise, bornes de couleur | 358, 383-386, 500 | 636, 737-743 | 258-264 | — | `trackColorSegments`, `trackBounds` | recopié (traitement : constante en voile, `sportTreatment(sport)` à terre, `sportTreatment(activity.base)` en surf) |
| En-tête (`an-sheet`, `PageHeader`, `SessionNameEditor`, partage, erreur) | 962-971 | 1179-1188 | 514-523 | 184-193 | `PageHeader`, `SessionNameEditor` | **recopié** ×4 (10 lignes) |
| Alerte d'erreur de lecture, « Aucune session ouverte » | 976-980, 994-998 | 1192-1202 | 527-535 | 197-204 | aucune | **recopié** ×4 |
| Carte (`AnalysisMap`) et sa fermeture qui ferme les graphes compagnons | 1001-1027 | 1204-1222 | 537-553 | — (sans carte) | `AnalysisMap` | partagé ; `onExpandedChange` recopié ×3 |
| Couches communes : fond, trace, zone FC, tronçon zoomé, repères, survol | 941-957 | 1152-1174 | 493-504 | — | `BaseTileLayer`, `TrackSegmentsLayer`, `SessionMarksLayer`, `HoveredTrackMarker` | **recopié** (5 couches ×3) |
| Légende sur la carte | 1023-1026 | 1219-1221 | 552 | — | `SpeedGradientLegend`, `GradeGradientLegend` | partagé |
| Plein écran : `mapExpanded` + `useZoomOnMap` | 370, 550-562 | 660-677 | 412-425 | — | `useZoomOnMap` | partagé, appel recopié ×3 ; ancre `'map-view'` en dur 3 fois en voile (559, 686, 1004), constante recopiée L 125 / U 115 |
| Axe du temps, minutes de chaque point, lecture « heure » et FC | 512-517, 538-544, 564-573 | 522-525 (minutes) | 368-369, 387-393, 399-408 | 141-145, 156-163 | `niceTicks`, `HoverReadout`, `inChartView` | **recopié** (voile ≡ surf ligne à ligne pour `timeAxis`, `readAt`, `heartReadout`) |
| Zoom de la courbe « cardio » | 548 | 650-653 | 410 | 145 | `useChartZoom` | recopié ×4 |
| Survol : `onChartHover`, `clearHover`, `hoverIndex` | 503-508 | 782-799 (3 variantes) | 384-397 | 233 | `hoveredTrackIndex`, `setHoveredIndex` | **recopié** : le même corps de 3 lignes 5 fois |
| Aide du zoom (« Écartez deux doigts… ») | 579-581 | 122-123 | 778 | 219 (variante) | aucune | **recopié** ×4 |
| Repli des graphes de « graphiques » | 285-297 (`graphTitle`, `foldedGraph`) | 950-955 (`graphFold`) | 780-794 (en ligne) | — | `ChartFold`, `useOpenSections` | **divergent non voulu** : 3 écritures, 3 façons de bâtir « Replier le graphe de FC » |
| Graphes compagnons « cardio » (plein écran) | 655-659 | 1133-1137 | 481-485 | — | `CardioCurve` | **recopié** ×3 à l'identique |
| Onglet « général » (titre, date, `GeneralStats`, repères) | 1034-1060 | 1229-1242 | 559-600 | 211-267 | `PanelTitle`, `SessionDate`, `GeneralStats`, `SessionMarksList` | coquille recopiée ×4, contenu propre (voulu) |
| Onglet « tops » | 1062-1067 | 1274-1279 | 756-761 | — | `TopsPanel` | partagé ; enveloppe recopiée |
| Onglet « cardio » | 1111-1120 | 1305-1313 | 803-812 | 270-281 | `HeartRatePanel` | partagé ; 9 props recopiées ×4 (`onRetainHrMax`, `onSelectZone`, …) |
| Onglet matériel et notes | 1220-1227 | 1526-1531 | 814-819 | 283-288 | `SessionNotesPanel` | partagé ; `gearFields()` recopié L 225-228 / U 133-136 / M 74-77 |
| Onglet réglages : champ « Activité » | 1236-1245 | 1546-1555 | 833-842 | 298-306 | `ActivitySelect` | **recopié** ×4 (10 lignes) |
| Réglages : cases Foil et Pumping | 1261-1275 | — | 843-856 | — | aucune | **recopié** ×2, à l'identique |
| Réglages : bornes de couleur | 1291-1299 | 1580-1588 | 881-887 | — | `SpeedRangeEditor` | enveloppe recopiée ×3 (`isValidSpeedRange` dans le `onChange`) |
| Réglages : aide « Vitesse : fournie par l'appareil… » | 1234 (variante courte) | 1539-1541 | 827-829 | — | aucune | recopié ×2 |
| Chiffres de « général » et de l'image de partage | 393-435 | 746-779 | 267-290 | 167-177 | `GeneralStats`, `shareableStats` | propre à chaque sport (voulu) ; mécanisme « liste complète / liste réduite » écrit 3 fois différemment |
| Tableaux de données (style en ligne) | 718, 758-767 | 1397-1405, 1451-1460 | 137-139 (`tableStyle`) | — | aucune | **recopié** |
| Bascules en pastilles faites à la main | 855-859 | 1287-1292, 1355-1360 | — | — | `SegmentedControl` (non utilisé ici) | divergent (voir C7 et F1) |

---

## Verdict sur la « coquille d'analyse »

**Réaliste, mais en pièces plutôt qu'en un seul composant géant.** Le cœur de chaque module (vent et manœuvres en nœuds sur `PointData`, règle 5 ; énergie et pente à terre ; vagues en surf) est trop différent pour un module unique. En revanche, tout ce qui entoure ce cœur est le même dans les quatre fichiers et tient en :

1. trois **hooks d'état** : `useAnalysisSession`, `useAnalysisTabs`, `useAnalysisHeart` (A1, A2, A4) ;
2. quelques **pièces de carte et de graphes** : `AnalysisBaseLayers`, `useTimeChartAxis`, `hoverRowsHandler` (A5, A6, A8) ;
3. de **petits panneaux communs** : `SessionActivityField`, `FoilPumpingFields`, `SessionColorRangeField`, `CardioTab` (A9-A12) ;
4. enfin une **`AnalysisShell`** de pure mise en page (en-tête, barre du brouillon, alertes, rangée de la carte, colonne d'onglets), à emplacements (`layers`, `legend`, `overlay`, `companion`, `children`), que le muscu prend sans carte (A13).

**Étapes sûres, chacune neutre au banc** (même texte de page, mêmes tailles avec `tailles.mjs`) :

| Étape | Contenu | Taille | Garde-fou |
|---|---|---|---|
| 0 | Constantes et dérivations sans risque : `*_SECTION_DEFAULTS` dérivés (A3), ancre de carte et aides du zoom en constantes (A7), couleurs de données nommées (C9), `editSpeedUnit` (A20) | petit | tests de `analysisTabs` ; banc `general.mjs` |
| 1 | `useAnalysisSession` puis `useAnalysisTabs`, adoptés module par module (surf d'abord, le plus simple, puis muscu, terre, voile) | petit à moyen | clés mémorisées inchangées (`sailing-onglets`, `running`/`cycling`/`intervals`, `surf`, `muscu`) |
| 2 | `useAnalysisHeart`, `useHeartRateZoneHighlight`, `useShownJumps`, `useFlightPumping`, `AnalysisBaseLayers`, `useTimeChartAxis` | moyen | `vitest --changed` ; banc par sport, survol et « +carte » |
| 3 | Panneaux communs (activité, foil/pumping, couleurs, cardio, notes, en-tête « général ») | moyen | `id` des `ResizablePanel` inchangés (clés des tailles) |
| 4 | `AnalysisShell` (mise en page seule) | moyen | banc ordinateur, 390×844 et tourné 834×375 |
| 5 | Découpage des panneaux propres à chaque sport dans `components/<sport>/` (C1) | gros, plusieurs lots | un module par lot |

Lignes récupérables par la coquille seule : environ **450 à 550** sur les 4 125 lignes des quatre modules (voir G).

---

## A. Doublons

Classés par importance (gain × fréquence de lecture du code).

### A1. Lecture de la session, garde du fichier affiché, activités — `useAnalysisSession`
- Copies : S 159-161, 220-225, 233-234, 244 ; L 286-299, 304, 318-319, 335, 392, 429 ; U 175-190 ; M 91-111, 180-181.
- Identique, sauf le chargeur (`loadGpxContent` ou `parseGpx` en muscu) et la famille. L fait 5 fois en ligne `sessionFile !== null && gpx.fileName === sessionFile ? sessionFile : null`.
- Pièce unique : `src/hooks/useAnalysisSession.ts`
  ```ts
  useAnalysisSession({ family, activity, setActivity, load: (content, session) => void, loadedFile: string | null })
    => { requested, sessionFile, shownFile, error, draft, allActivities, changeActivity: (next: Activity) => void }
  ```
  `shownFile` est le fichier de l'URL quand c'est lui qui est affiché ; `draft = useSessionDraft(shownFile)`.
- Risque : faible ; en voile, aligner le brouillon sur `shownFile` corrige D1 (changement de comportement voulu, invisible sauf pendant un chargement).
- Taille : petit. Confiance : sûr.

### A2. Barre d'onglets, « avancé », masque — `useAnalysisTabs`
- Copies : S 275, 279, 299-301 ; L 321-328 ; U 202-209 ; M 122-129. Les 6 lignes sont identiques (au nom de la liste près).
- Pièce unique : `src/hooks/useAnalysisTabs.ts`
  ```ts
  useAnalysisTabs<K extends string>(storageId: string, tabs: readonly AnalysisTab<K>[], activity: Activity, sessionKey: string | null)
    => { open: Record<K, boolean>, toggle, tabChoices, advanced, shown: (keep: (key: K) => boolean) => AnalysisTab<K>[] }
  ```
  Les défauts viennent de A3 ; le filtre propre au module reste dans le module (`shown`).
- Risque : la clé `storageId` doit rester exactement celle d'aujourd'hui. Taille : petit. Confiance : sûr.

### A3. `*_SECTION_DEFAULTS` dérivables de `core/analysisTabs.ts`
- Copies : S 110-122, L 152-166, U 91-101, M 63.
- Constat : chaque valeur vaut `true` exactement pour les onglets marqués `primary` (`general` partout ; `fractionne` et `test` à terre) et `false` pour les autres. Le typage `Record<…Tab, boolean>` force à recopier chaque clé à chaque onglet ajouté (consigne de `CLAUDE.md`, « Où ajouter quoi »).
- Pièce unique : dans `core/analysisTabs.ts`, `export const tabDefaults = <K extends string>(tabs: readonly AnalysisTab<K>[]): Record<K, boolean>` ; pour la terre, l'union des deux listes (`cadence` n'est qu'à pied).
- Risque : nul (mêmes valeurs) ; mettre à jour la ligne de `CLAUDE.md` « Où ajouter quoi » et `MISE_EN_PAGE.md` § « Brancher un nouveau sport », point 3. Taille : petit. Confiance : sûr.

### A4. FC de la session, zones, zone montrée sur la carte — `useAnalysisHeart` et `useHeartRateZoneHighlight`
- Copies : `useRunnerProfile` + `useSessionHeartRate` + `useMemo(runnerHeartRateZones…)` en S 270-273, L 268/276-277, U 211-213, M 88/114/119 ; sélection de la zone et `hrZonePaths` en S 343-351, L 358-360 + 486-492, U 230-238 (identiques) ; Polylines des zones en S 948-950, L 1158-1160, U 497-499.
- Pièce unique : `src/hooks/useAnalysisHeart.ts` → `{ runner, retainHr, heart, hrZones }` ; `useHeartRateZoneHighlight(highlight, open, heart, hrZones, track, gapS) => { selectedZone, select, paths }`.
- Risque : faible. Taille : petit. Confiance : sûr.

### A5. Couches communes de la carte — `AnalysisBaseLayers`
- Copies : S 941-957, L 1152-1174, U 493-504 : `BaseTileLayer`, zone FC en violet, tronçon zoomé (`zoomOnMap.path`, même `pathOptions` ×3), `SessionMarksLayer`, `HoveredTrackMarker`.
- Pièce unique : `src/components/AnalysisBaseLayers.tsx`, props `{ family, track, zonePaths, zonePathsKey, zoomPath, marks, shownMark, children }` ; les couches propres au sport passent en `children`, dans l'ordre actuel (l'ordre de pose compte pour le dessus/dessous).
- Risque : moyen (ordre des couches) ; banc avec surbrillance. Taille : petit. Confiance : sûr.

### A6. Axe du temps, minutes, lectures « heure » et FC — `useTimeChartAxis`
- Copies : `trackMinutes` S 512-515, L 522-525, U 368, M 142 ; `timeAxis` S 538-544 ≡ U 387-393 ; `readable`/`readAt`/`heartReadout` S 564-573 ≡ U 399-408 ; zoom cardio S 548, L 650-653, U 410, M 145 ; graphe compagnon `CardioCurve` S 655-659 ≡ L 1133-1137 ≡ U 481-485.
- Pièce unique : `src/hooks/useTimeChartAxis.tsx` → `{ minutes, zoom, cardioZoom, axis: ReactNode, readAt(i), heartReadout(i) }` ; `CardioCompanion` (3 lignes) dans `HeartRatePanel.tsx`.
- Risque : faible. Taille : petit. Confiance : sûr.

### A7. Constantes recopiées : ancre de la carte et aides du zoom
- `'map-view'` : S 559, 686, 1004 (en dur) ; `MAP_ANCHOR_ID` recopié L 125, U 115.
- Aide du zoom : S 579-581, L 122-123, U 778, M 219 (variante « la courbe »).
- Pièce unique : `export const ANALYSIS_MAP_ANCHOR = 'map-view'` dans `components/AnalysisMap.tsx` ; `zoomHint(narrow)` dans `components/ZoomableChart.tsx`.
- Risque : nul (mêmes chaînes). Taille : petit. Confiance : sûr.

### A8. Gestionnaire de survol écrit 5 fois
- S 503-506, L 784-787, L 791-794, L 796-799, U 394-397 : `const index = hoveredTrackIndex(e, rows); if (index !== null) setHoveredIndex(index);`.
- Pièce unique : `export const hoverRows = (rows: ReadonlyArray<{ index: number }>) => (e: ChartHoverEvent) => …` dans `components/chartHover.ts` (S l'a déjà sous ce nom, en local). Supprimer aussi les alias `hoverIndex = setHoveredIndex` (S 508, L 783, U 385).
- Taille : petit. Confiance : sûr.

### A9. Champ « Activité » de l'onglet réglages — `SessionActivityField`
- Copies : S 1236-1245, L 1546-1555, U 833-842, M 298-306 (M filtre l'inverse : sans positions).
- Pièce unique : `src/components/SessionActivityField.tsx`, `{ activities, activity, family, file, withPositions: boolean, onChange }`.
- Taille : petit. Confiance : sûr.

### A10. Cases Foil et Pumping de la session — `FoilPumpingFields`
- Copies : S 1261-1275 ≡ U 843-856 (mêmes titres au mot près, même logique `e.target.checked === activityPumping ? null : …`).
- Pièce unique : `src/components/FoilPumpingFields.tsx`, `{ foil, foilEdited, pumping, pumpingEdited, activityPumping, showPumping, foilTitle, onChange: (patch) => void }`.
- Taille : petit. Confiance : sûr.

### A11. Bornes de couleur de la trace dans réglages
- Copies : S 1291-1299, L 1580-1588, U 881-887 ; même `onChange={(next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); }}`.
- Pièce unique : un `SessionColorRangeField({ unit, range, draft })` dans `SpeedRangeEditor.tsx`, qui garde la validation.
- Taille : petit. Confiance : sûr.

### A12. Panneaux « cardio » et « matériel et notes »
- `HeartRatePanel` avec 9 props recopiées : S 1111-1120, L 1305-1313, U 803-812, M 270-281. `SessionNotesPanel` : S 1220-1227, L 1526-1531, U 814-819, M 283-288 ; `gearFields()` recopié L 225-228, U 133-136, M 74-77.
- Pièce unique : `CardioTab` (enveloppe `ResizablePanel` + `HeartRatePanel`, rappel `retainHr` compris) et `NotesTab` ; `gearFieldsFor(labels, placeholders?)` exporté de `SessionNotesPanel.tsx`.
- Risque : `id` des panneaux (`sailing.cardio`, `${storageId}.cardio`…) passés tels quels. Taille : petit. Confiance : sûr.

### A13. En-tête, barre du brouillon, alertes, « Aucune session ouverte » — `AnalysisShell`
- Copies : S 961-998, L 1178-1202, U 513-535, M 183-204 ; rangée de la carte S 1001-1027, L 1204-1222, U 537-553 ; colonne d'onglets S 1030-1033, L 1225-1228, U 555-558, M 207-210.
- Différences : titre, retour, famille de l'image de partage ; S n'affiche la barre que `loadedFromMemory` (les autres l'affichent toujours, `SessionSaveBar` se cache seule) ; la voile ajoute l'alerte « Vent non fiable » (S 982-992), qui passe en emplacement `alerts`.
- Pièce unique : `src/components/AnalysisShell.tsx`, `{ title, back, family, file, share, error, loadError, emptyHint, draft, map?: { panelId, sessionKey, bounds, layers, legend, overlay?, companion, expanded, onExpandedChange, focus }, tabs: { sections, open, onToggle, advanced, accent }, alerts?, children }`.
- Risque : moyen (structure des `div` dont dépend `analysisMobile.css` : `.an-page`, `.an-sheet`, `.an-map-row`, `.an-carte-col`) ; à faire en dernier. Taille : moyen. Confiance : probable.

### A14. Sauts montrés et pumping des vols
- Sauts : S 256-264 + 319-322 + 1127-1145 ; L 335-343 + 366-369 + 1502-1523 (seule la conversion du seuil diffère).
- Pumping : S 323-331 ≡ U 303-310 (`flightPumping`, `pumpSummary`, `podiumFlights`), libellés des vols S 335-342 ≈ U 329-346.
- Pièces uniques : `useShownJumps({ file, track, profile, activity, thresholdMs, highlight })` ; `useFlightPumping(sensors, detection, track, cumulative, flights)` dans `hooks/useSessionPumping.ts`.
- Taille : petit. Confiance : sûr.

### A15. Repli des graphes de « graphiques », écrit trois fois
- S 285-297 (`graphTitle`, `foldedGraph`), L 950-955 (`graphFold`), U 780-794 (en ligne). Trois titres d'aide construits différemment (`'Replier ce graphe'` en voile, `` `Replier le graphe ${…}` `` à terre, en dur en surf).
- Pièce unique : `GraphFoldHead({ label, color, open, onToggle, read? })` dans `components/ChartFold.tsx`, qui fait le titre et la lecture à droite.
- Risque : le texte d'aide (`title`) change en voile : à garder identique si on veut la neutralité. Taille : petit. Confiance : sûr.

### A16. Renommage d'une session écrit deux fois
- `pages/SessionLibrary.tsx:393-409` et `components/SessionNameEditor.tsx:77-97` : même champ (maxLength 80, mêmes libellés, Entrée/Échap), mêmes boutons Valider/Annuler, même `updateSessionRecord(file, { name })`.
- Pièce unique : `SessionRenameField({ initial, onSave, onCancel, className? })` dans `components/`.
- Taille : petit. Confiance : sûr.

### A17. Onglets de filtre par activité (bibliothèque, itinéraires)
- `pages/SessionLibrary.tsx:579-590` ≈ `pages/RoutesPage.tsx:78-95` : « tous (n) », puis une pastille par activité avec icône et compte ; mêmes classes `ui-tabs`/`ui-tab`. Variantes à choix unique proches : `StatisticsPage.tsx:136-153` (`Chips`), `SettingsPage.tsx:155-163`.
- Pièce unique : `components/ActivityFilterTabs.tsx` `{ counts, total, value, onChange, extra?, accent? }` ; `Chips` peut devenir un `PillChoice` générique dans `components/ui/`.
- Taille : petit. Confiance : sûr.

### A18. Options de capture d'Enregistrer, quatre fois le même bloc
- `pages/RecordingPage.tsx:655-669` (sauts), 671-684 (cadence), 686-714 (ceinture), 716-731 (pumping) : `div` colonne, `label` + case, ligne grise décalée de 26 px. Et l'état « choix pour cette activité » recopié 4 fois : 427-429, 432-433, 436-438, 446-448 (`{ activityId, measure } | null`).
- Pièces uniques : `CaptureOption({ label, checked, disabled, onChange, hint, children })` (local à la page ou `components/recording/`) ; `usePerActivityChoice(activityId, fallback) => [value, set]`.
- Taille : petit. Confiance : sûr.

### A19. Tables de familles recopiées
- `FAMILY` de `SessionLibrary.tsx:62-68` (titre, couleur), `FAMILY_NOUN` de `RecordingPage.tsx:136`, `accent` de `landModules.tsx:295-309`, `PAGE.accent` de `MuscuModule.tsx:62`, `ACCENT` de `SurfModule.tsx:117`, et hors zone `AppShell.tsx:50-54` : tous redisent `FAMILY_LABEL` / `FAMILY_ACCENT` (`core/activities.ts:172-179`).
- Proposition : lire `FAMILY_LABEL`/`FAMILY_ACCENT` ; ajouter `FAMILY_OF` (« de voile », « à pied »…) à côté s'il sert à deux pages. Attention : `FAMILY_NOUN.voile = 'voile'` et `FAMILY.of.voile = 'de voile'` ne sont pas la même tournure (deux phrases différentes).
- Taille : petit. Confiance : sûr.

### A20. Petits utilitaires réécrits
- `speedUnit === 'minkm' ? 'kmh' : speedUnit` : L 554, 624, 1508, 1592 (et `IntervalAnalysis.tsx:272`), alors que `editSpeedUnit` existe (`core/units.ts:98`, déjà employé par Réglages).
- Comptage des répétitions : `SessionLibrary.tsx:116` recopie `repsDone` (`core/heartRateSession.ts:68`), que la même fonction emploie déjà 28 lignes plus haut (l. 88) ; 3e copie dans `library/stats.ts:105`.
- Distance à 2 décimales sous 10 unités : `SessionLibrary.tsx:93-95` ≡ `StatisticsPage.tsx:132-133` (le commentaire le dit : « comme la bibliothèque »).
- « Dernière activité enregistrée de la liste, sinon la première » : `TrainingSessionsPage.tsx:56-59`, `61-65`, `FitnessTestPage.tsx` (calcul de `activity`), `RecordingPage.tsx:398-402`.
- Adresse « Enregistrer sur une activité » : `TrainingSessionsPage.tsx:66, 78`, `FitnessTestPage.tsx` (`launch`) → `recordPath(activityId, test?)` à côté de `TIMER_RECORD_PATH` (`workoutLists.ts:55`).
- Observateur d'approche de l'écran : `SessionLibrary.tsx:154-162` ≡ 232-240 → `useNearViewport(ref)`.
- Message éphémère avec minuterie : `RecordingPage.tsx:319-324`, `SessionNameEditor.tsx:43-48`, `ui/HoldButton.tsx:32-36` → `useTransientValue(ms)`.
- `formatMeters` : `RecordingPage.tsx:138` ≡ `PlanningPage.tsx:226`.
- Regroupement par activité dans une `Map` : `StatisticsPage.tsx:376-384` ≡ 440-445.
- Taille : petit (une session). Confiance : sûr.

### A21. Légende de la pente et « Voir sur la carte »
- `LandModule.tsx:907-923` (styles en ligne) ≡ `PlanningPage.tsx:1074-1088` (classes `plan-legend*`) ; bascule exclusive pente/revêtement `LandModule.tsx:438-455` ≡ `PlanningPage.tsx:430-439`.
- Pièce unique : `components/GradeLegendRow.tsx` `{ range, onMap, onToggleMap, label }` ; `useExclusiveToggles()` pour la bascule.
- Taille : petit. Confiance : sûr.

### A22. Pastille de couleur et barre de répartition
- Pastille 10×10 arrondie 2 px : L 912, U 589, M 250, `StatisticsPage.tsx:802` (9 px), plus `CadencePanel.tsx:123`, `FlightPumpingPanel.tsx:130`, `HeartRatePanel.tsx:211`, et la classe `.plan-legend__swatch`.
- Barre de répartition + légende : U 572-594 (phases du surf) ≈ `StatisticsPage.tsx:794-806` (zones FC).
- Pièce unique : `ui/Swatch.tsx` (ou classe `.ui-swatch` dans `ui.css`) ; `ShareBar({ parts: { key, value, color, label }[] })`.
- Taille : petit. Confiance : sûr.

### A23. Tableaux des analyses en style en ligne
- S 718-724 et 758-767, L 1397-1405 et 1451-1460, U 137-139 et 635/696 : mêmes `width 100%`, `borderCollapse`, `fontSize var(--text-s)`, fond `--surface`, bord `--line`, en-tête `--surface-sunken`, lignes `--line-soft`.
- Pièce unique : classes `.an-table`, `.an-table__head`, `.an-table__row` dans `analysisMobile.css` (le surf a déjà ses objets `tableStyle/thStyle/tdStyle`).
- Risque : spécificité CSS contre les `!important` du panneau Manœuvres au téléphone (`analysisMobile.css:428-447`). Taille : petit. Confiance : probable.

### A24. Champs numériques à brouillon local, cinq écritures
- `SettingsPage.tsx:220-275` (`NumberField`, effet + `useRef`), et hors zone mais employés par les pages : `SessionThresholdField.tsx:34-36`, `SessionWeightField.tsx:27-28`, `EffortThresholdEditor.tsx:28-30`, `SpeedRangeEditor.tsx:47-55` (état dérivé pendant le rendu).
- Pièce unique : `useNumberDraft(value, format, parse) => { text, onChange, onBlur }` dans `hooks/`, puis `NumberField` déplacé dans `components/ui/`.
- Risque : moyen (comportement de saisie : virgule, valeur hors bornes pendant la frappe) ; tests de la fonction de lecture. Taille : moyen. Confiance : probable.

### A25. Chaînes d'interface recopiées
- « Aucune session ouverte : choisissez-en une dans … » : S 995-997, L 1199-1201, U 532-534, M 198-200 (dans `AnalysisShell`, A13).
- « Aucune activité de … visible : ajoutez-en une, ou ré-affichez-la, dans Réglages » : `TrainingSessionsPage.tsx:107, 112`, `FitnessTestPage.tsx` (alerte du haut).
- « Aucune ceinture cardio choisie : … Réglages, bloc « Capteurs » » : `RecordingPage.tsx:696`, `RestingHrTestPage.tsx` (alerte du haut).
- « Poids non renseigné » : `landModules.tsx:124, 231`, `LandModule.tsx:1600` (trois tournures).
- Proposition : petits composants `MissingActivityAlert`, `NoBeltHint` ; constantes pour le reste. Taille : petit. Confiance : sûr.

### A26. CSS recopiée entre pages
- Aides grises : `.stats-hint` (`StatisticsPage.css:46-50`) ≡ `.train-hint` (`TrainingPages.css:74-78`) ; `.plan-note` (`PlanningPage.css:476-480`, marge en plus) ; `.lib-hint` (`SessionLibrary.css:3-8`, `--text-m`). → `.ui-hint` (+ `.ui-hint--m`) dans `ui.css`.
- Bandeau photo : `.home-header` (`Home.css:10-22`) et `.lib-banner` (`SessionLibrary.css:159-172`) partagent 8 déclarations (colonne `space-between`, marges qui débordent, fond `cover`, texte `--on-accent`, ombre du texte) → `.ui-photo-banner`.
- Carte fixe du téléphone tourné : `analysisMobile.css:484-491` (`.an-map-panel`) ≈ `PlanningPage.css:557-566` (`.plan-map`), même calcul `top/bottom/left/width` → une classe commune ; `RecordingPage.css:19-26` est la version à droite.
- Taille : petit. Confiance : sûr.

---

## B. Optimisations

### B1. Planification : le survol du profil redessine toute la page
- `PlanningPage.tsx:388` : `const [hoveredIndex, setHoveredIndex] = useState`, passé à `ElevationProfileMini` (l. 1072) ; chaque mouvement de souris sur le profil refait le rendu des 1 323 lignes de la page (carte, tronçons, marqueurs, panneaux). Les modules d'analyse, eux, passent par le magasin du survol (`hooks/useChartHover.ts`) et ne se redessinent pas.
- Proposition : `setHoveredIndex` du magasin, `HoverMarker` abonné (`useHoveredIndex`), lecture par `HoverReadout` ; `ElevationProfileMini` peut alors perdre sa prop `readout` (deux API aujourd'hui : `read` à terre, `readout` en planification).
- Gain : fort sur la planification (survol fluide sur une longue trace). Mesure : profileur de React (rendus de `PlanningPage` pendant un survol : N → 0) ; banc `planification` avant/après pour la neutralité du texte.
- Taille : petit. Confiance : sûr.

### B2. Réglages : chaque frappe redessine toutes les cartes d'activité ouvertes
- `SettingsPage.tsx:441-913` : tout le corps d'une carte d'activité est dans le `map` de la page ; une frappe dans un `NumberField` (`onCommit` à chaque caractère, l. 242-248) appelle `setFor`, qui refait le rendu de toute la page et recalcule pour chaque activité montée `overridden` (464-468), `summary` (518-532) et tous ses champs.
- Proposition : extraire `ActivityCard` mémoïsé (C3), rappels stables par activité.
- Gain : moyen (sensible au téléphone avec plusieurs familles dépliées). Mesure : profileur React, rendus par frappe. Taille : moyen. Confiance : probable.

### B3. Surf : capteurs lus dès l'ouverture, même onglet « vols » fermé
- `SurfModule.tsx:301` : `useSessionPumping(shownFile, pumping)` ; la voile les lit seulement onglet ouvert (`SailingModule.tsx:303-304`, « une capture entière pèse plusieurs Mo »). En surf, `flightPumping` ne sert qu'au panneau « vols » (U 730-754).
- Proposition : `pumping && open.vols`, comme en voile. Le commentaire de `hooks/useSessionPumping.ts` décrit l'écart comme voulu (« à l'ouverture de l'analyse (de l'onglet « pumping » en voile) ») : voir F2.
- Gain : mémoire et temps d'ouverture d'une session de surf foil (capture décodée de « dizaines de Mo »). Mesure : temps d'ouverture au banc. Taille : petit. Confiance : sûr (sur le code), à trancher (F2).

### B4. Panneaux non mémoïsés et rappels recréés à chaque rendu
- `HeartRatePanel`, `JumpsPanel`, `TopsPanel`, `IntervalAnalysis`, `FlightPumpingPanel` ne sont pas `memo` et reçoivent à chaque rendu des fonctions neuves (`onToggle={() => toggle('…')}`, `onSelectZone`, `onRetainHrMax`) et des styles neufs (`{ ...CARD_STYLE, ...HALF_PANEL_STYLE }`). Un zoom, une surbrillance ou l'ouverture d'un onglet redessinent tous les panneaux ouverts.
- Proposition : avec A12 et `useAnalysisTabs`, exposer `toggleOf(key)` stable ; styles de panneau en constantes de module (le surf le fait déjà : `panelStyle`, U 130) ; `memo` sur les panneaux lourds (cardio, fractionné).
- Gain : moyen, à mesurer d'abord (profileur React sur un zoom du graphe de vitesse). Taille : moyen. Confiance : à vérifier.

### B5. Terre : séries des graphes calculées onglets fermés
- `LandModule.tsx:684-703` (`chartData`) n'est conditionné qu'à une trace non vide ; il ne sert qu'à « graphiques », « zones de pente » et aux graphes compagnons. Le surf le conditionne (`SurfModule.tsx:372`).
- Proposition : `open.graphiques || open.zones` en tête du `useMemo` ; même chose pour `gradeStops` (708-711).
- Gain : faible (au plus 500 lignes), mais à chaque changement d'unité et à l'ouverture. Taille : petit. Confiance : sûr.

### B6. Voile : une icône Leaflet par flèche de cap
- `SailingModule.tsx:144-153, 436-442` : `L.divIcon` neuf pour chaque flèche, à chaque trace. La planification met déjà ses icônes en cache (`PlanningPage.tsx:190`).
- Proposition : cache par cap arrondi au degré. Gain : faible (chargement d'une longue session). Taille : petit. Confiance : sûr.

### B7. Petits calculs refaits à chaque rendu
- `generalStats`/`overviewStats` (S 393-435, L 746-779, U 267-290) et `shareableStats(generalStats)` passé à `SessionNameEditor` à chaque rendu ; `graphCharts`/`shownGraphs` (L 874-884) ; `sections` (`StatisticsPage.tsx:390`). Coût faible ; à mettre en `useMemo` au passage seulement.
- Confiance : sûr ; gain négligeable.

---

## C. Architecture

### C1. Gros fichiers (> 800 lignes) et découpage proposé
| Fichier | Lignes | Découpage proposé |
|---|---|---|
| `LandModule.tsx` | 1 611 | `hooks/useLandAnalysis.ts` (stats, pentes, zones, énergie, fractionné : 379-633) ; `components/land/LandGraphsPanel.tsx` (axes, `altitudeChart`, `separateChart`, `graphStack` : 845-1073) ; `EnergyPanel` (1349-1421) ; `GradeZonesPanel` (1423-1499) ; `LandSettingsPanel` (1533-1603) |
| `PlanningPage.tsx` | 1 323 | recherche de lieu, liste des points (1210-…), panneau du profil, couches de la carte, `PlanBlock`/`WayPicker` déjà locaux à sortir dans `components/planning/` |
| `SettingsPage.tsx` | 1 322 | dossier `pages/settings/` : `ActivityCard` (441-913) et ses parties (`DisplayPart`, `AnalysisPart`, `GearPart`, `RecordingPart`, `PlanningPart`), `PractitionerBlock` (876-922), et les sous-composants déjà séparés (`FieldsSetting`, `PaceSettings`, `BikeSettings`, `AddActivityForm`, `OfflineMapsSettings`) ; `NumberField` vers `components/ui/` |
| `SailingModule.tsx` | 1 308 | `components/sailing/ManeuversPanel.tsx` (750-933), `VmgPanel` (665-680, 713-748), `WindPanel` (1175-1218), `SailingSettingsPanel` (1229-1301), `useSailingMapLayers` (436-498) |
| `RecordingPage.tsx` | 1 058 | `components/recording/` : `MarkGuideCard`, `LegCard`, `LiveSummary`, `CaptureOption` (A18), `NoteButton`, `StopButton` ; `liveStatItems` (193-231) vers `recording/liveFields.ts`, où il redit en partie le catalogue `liveFieldLabel/liveFieldValue` |
| `StatisticsPage.tsx` | 908 | `metricText`, `axisLabel`, `toAxis` (404-436) vers `library/stats.ts` (purs, testables) ; panneaux Graphique, Régularité, Cardio, Records en composants |
| `SurfModule.tsx` | 898 | `WavesPanel` (602-671), `PaddlePanel` (673-728), `SurfSettingsPanel` (821-890) |

### C2. Mise en forme de l'énergie rangée dans `pages/`
- `pages/landModules.tsx:123-288` : `runningEnergy` et `cyclingEnergy` font des calculs et tout le texte des notes, avec du JSX (`warning`). Rien n'est testé (aucun `*.test` sous `pages/`), alors que `CLAUDE.md` veut chaque calcul pur avec son test.
- Proposition : `running/energyView.ts` et `cycling/energyView.ts` purs, `warning` rendu par un code (`'sans-poids' | 'sans-poids-charge' | 'revetement-…'`) que le module met en phrase ; tests sur trace synthétique.
- Taille : moyen. Confiance : sûr.

### C3. Dépense totale retrouvée par son libellé
- `LandModule.tsx:761` : `energy?.stats.find((stat) => stat.label === TOTAL_ENERGY_LABEL …)` : renommer le libellé casserait « général » sans erreur de compilation.
- Proposition : `key` dans `EnergyStat` (`landModules.tsx:40-44`), recherche par clé. Taille : petit. Confiance : sûr.

### C4. « Activité modifiée » calculée dans la page
- `SettingsPage.tsx:464-468` : une expression de 25 termes décide du « · modifié » et du bouton « Par défaut ». Chaque nouveau réglage doit y être ajouté à la main ; rien ne le vérifie (voir D3).
- Proposition : `isActivityOverridden(view, activity)` pur dans `hooks/useSportSettings.ts` ou `core/`, avec un test qui parcourt les champs de `StoredSettings`. Taille : petit. Confiance : sûr.

### C5. Voile : brouillon et nom lus sur l'URL, pas sur le fichier affiché
- `SailingModule.tsx:159-161, 965-966` lisent `useSearchParams` en direct alors que `useSessionFromUrl` rend déjà `requested` (et que les trois autres modules s'en servent). Corrigé par A1 ; voir D1.

### C6. Le module voile refait le défilement vers la carte
- `SailingModule.tsx:683-687` (`startWindAdjust`) refait à la main, ancre en dur, ce que `useZoomOnMap.show` fait (`hooks/useZoomOnMap.ts:101-112`, marge de la barre du haut comprise, que la voile ignore : `block: 'center'` au lieu de `'nearest'`).
- Proposition : exposer `scrollToMap()` depuis `useZoomOnMap` ou `AnalysisMap`. Taille : petit. Confiance : probable.

### C7. Bascules faites à la main au lieu du bouton glissant
- `LandModule.tsx:1287-1292` (Séparés / Superposés), `1355-1360` (Puissance / Cumulée), `SailingModule.tsx:855-859` (Détails des manœuvres) : boutons à styles en ligne. La décision transverse de `CLAUDE.md` dit « Choix parmi quelques options : bouton glissant (`SegmentedControl`) ». Passer au bouton glissant change l'écran : F1.

### C8. Boutons écrits en classes au lieu de `Button`
- `SettingsPage.tsx:1277, 1315`, `RecordingPage.tsx:710`, `RoutesPage.tsx:73` (un `Link`, légitime), `PlanningPage.tsx:1196` (un `label` de fichier, légitime). Les trois premiers sont de vrais `<button>` : `Button size="s"`. Taille : petit. Confiance : sûr.

### C9. Couleurs de données sans nom
- `#e64a19` (altitude, énergie) : 13 fois dans `LandModule.tsx`, 1 dans `PlanningPage.tsx` ; bleu de vitesse `#1e88e5` : 6 fois L, 8 fois U, 1 fois M ; `#9aa0a6` (« Autres ») dans `StatisticsPage.tsx` et `ProfilePage.tsx`. `CLAUDE.md` les laisse en dur (attributs SVG), mais `heartRateColors.ts` et `cadenceColors.ts` montrent la voie : `components/chartColors.ts` avec `SPEED_COLOR`, `ALTITUDE_COLOR`, `OTHERS_COLOR`.
- À noter : la voile trace sa vitesse en `#1976d2` (S 567, 597, 636), les autres en `#1e88e5` (F3).
- Taille : petit. Confiance : sûr.

### C10. Valeurs en dur dans l'interface (hors données)
- Espacements en px partout dans les styles en ligne des modules (`'10px'`, `'12px'`, `'15px'`, `'20px'`, `gap: '6px'`…), largeur de libellé `'190px'` répétée 6 fois dans `SettingsPage.tsx` (252, 299, 883, 895, 1302, 1309) ; `analysisMobile.css:480` garde `350px` en dur là où Enregistrer et la planification lisent `--land-side-min` (380 px, `tokens.css:83`) : la différence est voulue (`MISE_EN_PAGE.md`, « gardé à 350 px »), mais mérite son jeton `--an-side-min`.
- `CLAUDE.md` n'impose les variables qu'aux écrans neufs : à corriger au fil des découpages (C1), pas en lot à part. Confiance : sûr.

### C11. Casts non vérifiés de la surbrillance
- `LandModule.tsx:353, 361` : `highlight.shownIn('zones') as GradeZoneKey | null`, `… as SurfaceCategory | null`. `useMapHighlight` ne range que des `string` ; un typage par onglet (`MapHighlight<{ zones: GradeZoneKey; surface: SurfaceCategory; … }>`) supprimerait les casts.
- Taille : petit. Confiance : sûr.

### C12. En-tête de `analysisMobile.css` périmé
- `analysisMobile.css:1` ne cite que `SailingModule` et `LandModule` ; le fichier sert aussi au surf, au muscu et à Statistiques. Taille : nul. Confiance : sûr.

---

## D. Bugs probables

### D1. Voile : le brouillon de la session suivante s'applique à la trace précédente pendant le chargement
- `SailingModule.tsx:160-161` : `useSessionDraft(requestedFile)`, fichier lu dans l'URL, alors que la trace affichée (`trackData`) est encore celle de la session d'avant tant que le GPX de la nouvelle n'est pas lu (`useSessionFromUrl`, chargement asynchrone). Les trois autres modules gardent le brouillon sur le fichier affiché (`LandModule.tsx:299`, `SurfModule.tsx:187-188`, `MuscuModule.tsx:106-108`).
- Scénario : analyse voile de la session A ouverte ; on passe à la session B sans quitter le module (lien, retour d'Android vers une autre adresse d'analyse, image partagée ouverte). Pendant la lecture du GPX de B, le vent saisi, le seuil, l'allure, les couleurs et les repères de B sont appliqués à la trace de A : vent et manœuvres recalculés pour rien sur A (de 15 à 150 ms sur une trace de 3 h), éclair de chiffres faux, repères de B posés sur la trace de A.
- Correction : A1. Confiance : probable (dépend de la conservation du composant entre deux adresses, ce que fait React Router quand seule la recherche change).

### D2. Profil : couleur de l'activité préférée non adaptée au thème
- `ProfilePage.tsx:193, 236` : `favorite.color` brut, alors que les parts de l'anneau passent par `shown(a.color)` (`useThemedShade`, l. 138, 143), comme la bibliothèque et les statistiques.
- Scénario : thème sombre ; l'illustration de l'activité préférée et sa part de l'anneau n'ont pas la même nuance. Confiance : à vérifier (peut être voulu pour le dessin).

### D3. Réglages : « Par défaut » grisé quand seule la liste de matériel est réglée
- `SettingsPage.tsx:464-468` : l'expression `overridden` ne compte pas `s.gearGroups`. Si `resetActivity` efface la liste de matériel, une activité dont seule la liste est réglée ne peut pas revenir au défaut (bouton grisé, l. 567), et son résumé ne dit pas « · modifié ».
- Confiance : à vérifier (l'exclusion peut être voulue pour ne pas effacer une liste par mégarde ; alors la documenter dans le code).

### D4. Surf : `unitLabel` lu avant sa déclaration
- `SurfModule.tsx:439` (dans `speedChart`) lit `unitLabel`, déclaré l. 508. Ça marche aujourd'hui parce que `speedChart` n'est appelé qu'après (l. 547, 787) ; déplacer un appel au-dessus de la l. 508 donnerait une `ReferenceError` au rendu. Correction : remonter la déclaration. Confiance : sûr (fragilité, pas de bug actuel).

### D5. Surf : deux définitions du « point de trace d'un instant »
- `SurfModule.tsx:319-327, 350-351` cherchent le premier point à `timeMs >= cible` par boucle ; la voile et la terre emploient `trackIndexAtTime` (`core/jumps.ts`, point le plus proche). Sur une trace clairsemée (règle 10), la remontée commence ou finit un point plus loin qu'ailleurs. Confiance : à vérifier (effet d'un point au plus).

---

## E. Code mort

Vérifié par recherche sur tout `src/`.

- **Aucune classe CSS morte** dans les CSS des pages et de `ui/` : les seules sans occurrence littérale sont bâties à l'exécution (`page-backdrop--${variant}`, `ui-btn--${variant}`, `ui-help--${size}`) ou viennent de Recharts.
- **Exports sans autre lecteur** (types seulement, exportés pour rien) : `WorkoutList` (`workoutLists.ts:11`), `EnergyStat`, `EnergyZoneRow`, `EnergyInputs`, `LandPageConfig`, `LandTreatmentConfig` (`landModules.tsx`), `ButtonVariant` (`ui/Button.tsx:3`).
- **Alias inutiles** : `cardStyle = CARD_STYLE` (L 219, U 129) ; `type SailingPanel = SailingTab` (S 104), `LandSection = LandTab` (L 150), `SurfSection = SurfTab` (U 89) ; `hoverIndex = setHoveredIndex` (S 508, L 783, U 385).
- **Commentaires orphelins ou périmés** : S 155 (« Parties d'une session modifiées, en clair. » au-dessus de `SailingModule`) ; S 387-391 (deux blocs de doc à la suite, le premier sans objet) ; L 221 (« Champs du matériel hors voile » au-dessus de `positiveSpeed`) ; L 925 et L 1110 (doc sans objet avant une autre doc) ; `SettingsPage.tsx:452-453` (deux docs pour une ligne) ; `useAdvancedTabs.ts:26` (« `setGeneral` est refait à chaque rendu » : faux, tous les modules le passent en `useCallback`).
- **Écritures sans effet** : `['sans GPS, ceinture cardio'].join(' · ')` (`SettingsPage.tsx:518`) ; `.lib-banner__count` redéclare `font-size` et `font-weight` déjà posés par le sélecteur groupé juste au-dessus (`SessionLibrary.css:205-216`) ; deux `import` sur une ligne (`SessionLibrary.tsx:7`).
- **Gardé exprès, pas mort** : `TestsPage` (redirection d'une ancienne adresse, `App.tsx:31`) ; `HelpButton` (un seul lecteur, `Help.tsx`, normal).

---

## F. Questions à poser à l'utilisateur

1. **Bascules en boutons à la main ou bouton glissant ?** À terre, « Séparés / Superposés » et « Puissance / Cumulée », et en voile « Détails des manœuvres », sont des boutons dessinés à la main, alors que la règle générale est le bouton glissant pour un choix entre quelques options. On les passe au bouton glissant (petit changement visuel), ou on les laisse tels quels ? *Par défaut : on les laisse, on range seulement le code.*
2. **Surf foil : lire les capteurs à l'ouverture de l'onglet « vols » seulement, comme en voile ?** Aujourd'hui le surf les charge dès qu'on ouvre la session (plusieurs dizaines de Mo en mémoire), même sans regarder les vols. *Par défaut : oui, comme en voile ; rien ne change à l'écran, seulement l'onglet « vols » qui met un instant à se remplir.*
3. **Une seule couleur pour la courbe de vitesse ?** La voile la trace dans un bleu un peu plus foncé que la course, le vélo et le surf. *Par défaut : on garde les deux bleus.*

---

## G. Chiffres

- Fichiers lus en entier : `SailingModule.tsx`, `LandModule.tsx`, `SurfModule.tsx`, `MuscuModule.tsx`, `landModules.tsx`, `SessionLibrary.tsx`, `Home.tsx`, `workoutLists.ts`, `TestsPage.tsx`, `TrainingSessionEditPage.tsx`, `RoutesPage.tsx` (40-110), `analysisMobile.css`, les 13 fichiers de `components/ui/` (sauf la fin de `SegmentedControl.tsx` et `ui.css`, parcourus) ; lus en grande partie ou parcourus : `SettingsPage.tsx`, `StatisticsPage.tsx`, `RecordingPage.tsx`, `PlanningPage.tsx`, `TrainingSessionsPage.tsx`, `FitnessTestPage.tsx`, `RestingHrTestPage.tsx`, `ProfilePage.tsx`, et les CSS des pages ; plus les pièces partagées citées (`useSessionDraft`, `useLibraryNavigation`, `useAdvancedTabs`, `useOpenSections`, `useMapHighlight`, `useZoomOnMap`, `useChartZoom`, `AnalysisMap` (tête), `SessionNameEditor`, `SectionTabs`, `core/analysisTabs.ts`).
- Volume : `src/pages/` 10 996 lignes de TS/TSX et 2 831 de CSS ; `src/components/ui/` 1 365 lignes.
- Taille des modules : `LandModule.tsx` 1 611 ; `SailingModule.tsx` 1 308 ; `SurfModule.tsx` 898 ; `MuscuModule.tsx` 316 ; `landModules.tsx` 333. Autres gros fichiers : `PlanningPage.tsx` 1 323, `SettingsPage.tsx` 1 322, `RecordingPage.tsx` 1 058, `StatisticsPage.tsx` 908.
- Constats : A 26, B 7, C 12, D 5, E 6 rubriques, F 3 questions.
- Lignes récupérables (estimation) :
  - coquille d'analyse (A1-A15, A23) : 450 à 550 lignes sur les quatre modules ;
  - reste des pages (A16-A22, A24-A26) : 250 à 300 lignes, dont environ 80 dans les champs numériques hors zone ;
  - au total, de 700 à 850 lignes, soit 6 à 7 % du TSX des pages ; les découpages de C1 ne retirent rien mais ramènent chaque gros fichier sous 800 lignes.
