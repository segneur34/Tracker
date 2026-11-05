# 145 · Plan d'exécution (agent Plan, Opus high, 05/11), arbitré par l'orchestrateur

Le lot repart de l'arbre du 165, qui touche `SailingModule` (manœuvres, 970-981), `analysisTabs` (surcouche des sauts), `RecordingPage` (case des sauts), `TopsPanel`, `notes.ts` (`RATINGS` sans emoji). Partir du résultat du 165 pour `RATINGS`, la surcouche des onglets de sauts et les cases de RecordingPage.

Arbitrages de l'orchestrateur (05/11), qui priment sur le plan :
- Bornes de la « course à bornes » : chaque borne se choisit par `SegmentedControl` « aucune · Z1 … Z5 · S1 · S2 · BPM » : une zone remplit le BPM de son bord (mini : bas de la zone ; maxi : haut), S1 et S2 remplissent le BPM du seuil de l'activité (Pratiquant, décalé), BPM se saisit ; le champ reste modifiable. (Q54 : « en BPM ou seuil ».)
- Conversion mécanique des scripts du banc (138) : acceptée, par `data-tab` et `outils/banc/lib/onglets.mjs` ; les textes relevés doivent rester identiques.
- Flèches de sens (133) sur les trois modules, espacement 80 px, plafond 400 : acceptés.
- Mode « bornes » proposé en famille Entraînement seulement, remis à « aucun » à chaque ouverture, dernières bornes pré-remplies : accepté.
- Pumping, vent et puissance écrits dans le résumé par l'analyse (patch), pas par `summarizeSession` : accepté ; meilleur kilomètre et meilleures 5 min par `summarizeSession`, `SUMMARY_CALC_VERSION` augmenté d'un cran (lire sa valeur dans l'arbre).

## 137 · « Tout fermer »
- `src/components/CollapsibleSectionTabs.tsx` : prop `onCloseAll` ; bouton `ui-tab` « tout fermer » après la flèche « Cacher les onglets » (`an-tabs-hide`), dans le `trailing` de la première rangée.
- `src/hooks/useAnalysisTabs.ts` : `closeAll` ferme toutes les clés de `defaults`, « général » compris ; `advanced.open` ne change pas ; rendu aux quatre modules (Land, Sailing, Surf, Muscu).
- La surbrillance s'efface d'elle-même (`useMapHighlight(open)`).

## 138 · « Général » seul à chaque ouverture
- `useAnalysisTabs.ts` : `useOpenSections(storageId, defaults)` remplacé par un `useState(defaults)` en mémoire vive, remis à `defaults` quand `sessionKey` change (schéma du `fresh` actuel). Défauts par `tabDefaults` (`core/analysisTabs.ts`) : « général », plus « fractionné » en famille Fractionné (DECISIONS §2).
- `src/hooks/useAdvancedTabs.ts` : clé `analyses-avance` et `useStoredRecord` retirés ; `useState(false)` remis à faux à chaque session ; garder `generalOpenAfterAdvanced` ; retirer `isNewAnalysisSession` et son test s'il n'a plus d'appelant.
- Nettoyage unique au démarrage : effacer de `tracker.sections` les clés `analyses-avance`, `sailing-onglets`, `running`, `cycling`, `intervals`, `muscu` et la clé `STORAGE_ID` du surf, seulement celles-là (`running.graphes`, `analyses-barre` et les replis des graphes restent). Par `platform/storage` (règle 12).
- Tailles des `ResizablePanel` inchangées ; `storageId` reste le préfixe des replis.
- Banc : 56 scripts écrivent `localStorage.setItem('tracker.sections', …)` et 55 injectent `analyses-avance`. Remède : `data-tab={section.key}` sur les boutons de `src/components/SectionTabs.tsx` (aucun texte ne change) ; `outils/banc/lib/onglets.mjs` fournit un script pour `addScriptToEvaluateOnNewDocument` qui clique une fois, à chaque nouvelle `.an-tabs`, sur `[data-tab=k][aria-pressed=false]` pour les clés données ; conversion mécanique des 56 scripts ; les autres clés restent en `localStorage` ; retirer la partie `analyses-avance` de l'observateur, qui clique déjà « avancé ».

## 133 · Flèches de sens selon le zoom
- Aujourd'hui, seule la voile a des flèches (`SailingModule` 153-165 `createArrowIcon`, 454 `arrowLayers` ; `arrowIndices`/`ARROW_EVERY_S` dans `core/displayConfig.ts`). Les ajouter à LandModule et SurfModule (`TrackPoint.bearing` existe).
- `src/core/displayConfig.ts` : `arrowIndicesBySpacing(track, spacingM, maxCount)` : une flèche dès que la corde depuis la précédente atteint `spacingM` (m, `haversineDistance` de `core/geo.ts`), saute le pas qui reprend une pause (`segmentStart`), plafond `ARROW_MAX`. Constantes `ARROW_SPACING_PX = 80`, `ARROW_MAX = 400`, passées en paramètre (règle 3).
- `src/components/TrackArrows.tsx` dans la carte : `useMap()`, recalcul à `zoomend` (`useMapEvents`), `spacingM = ARROW_SPACING_PX × mètres par pixel(zoom, latitude moyenne)` ; reprend `createArrowIcon` déplacé depuis SailingModule ; mémoïsé par trace et zoom arrondi.
- Garder ou retirer `arrowIndices`/`ARROW_EVERY_S` selon les appelants (test à adapter). Aucun chiffre ne change.

## 139 · Image de partage
Une clé = la même ligne dans `summaryShareStats` (`src/library/shareStats.ts`) et dans `generalStats` de chaque module ; lignes ajoutées à la fin ; valeur absente « — ».
- Voile : `maneuverSuccess` « Manœuvres réussies : 83 % (10/12) » (résumé : `summary.maneuverResults`, écrit par l'analyse, SailingModule 279 ; module : `maneuverSummary`) ; `flightRatio` « Temps de vol » en % du temps actif, foil seulement (`movingTimeS / inMotionS` du résumé ; module `stats.activeRatio`) ; `pumpingShare` « Pumping », foil seulement, depuis le `.imu` : le module le calcule (`FlightPumpingPanel`/hook), le résumé le reçoit par `RecordPatch` (`library/record.ts` ~1053 et ~1132), champ `pumpingShare?` ; `wind` « Vent : 230° · 14 nd » si `estimateWind` est fiable, sinon le vent saisi (`analysis.windDeg`, `notes.windLevel`, libellé `WIND_LEVELS`), écrit dans le résumé par l'analyse (`windEstimate?`).
- Course : `top-1km` (vérifier la clé dans `OVERVIEW_TOP_KEYS`), meilleur kilomètre en temps, par `summarizeSession` et `computeAllTopSegments`, `SUMMARY_CALC_VERSION` +1 (commentaire daté).
- Vélo : `top-5min` (vitesse), même chemin ; `puissance` « Puissance moyenne » (`cycling/energyView.ts`, clé `puissance`) écrite par patch (`avgPowerW?`), « — » à la fin d'un enregistrement.
- Partout : `rating` « Appréciation : Bien » (libellé de `RATINGS`, sans icône) ; `summaryShareStats` prend `rating` optionnel, passé par `SavedSessionShare.tsx` depuis la fiche.
- LandModule : `overviewTops` n'est calculé que si « général » est ouvert (ligne 487) : calcul pour le partage indépendant de l'onglet.
- Lecture et contrôle des nouveaux champs dans `readSummary` (record.ts ~435), modèle `maneuverResults`.
- Test de parité : clés de `summaryShareStats` = `SHARE_KEYS[treatment]` exporté, dont les modules se servent (`withShareKeys`).

## 134 · Zones de BPM et course à bornes
A, lignes des zones : `src/settings/activitySettings.ts` : `hrZoneLines?: ByActivity<boolean>`, `SettingField`/`SETTING_FIELDS` (`plain`), `effectiveHrZoneLines` (décoché par défaut), relecture de fichier ; `src/components/HeartRateChart.tsx` : prop `zoneLines`, `ReferenceLine` fines pointillées à chaque borne de `zones`, en plus des bandes et des traits S1/S2 ; `CardioTab`/`HeartRatePanel` (`CardioCurve`, `CardioCompanion`) : case « Zones » si `zones` est connu ; LandModule : courbe de « cardio » et FC de « graphiques » (ligne 865) ; course, vélo, fractionné.
B, course à bornes : `src/recording/zoneAlert.ts` : la condition `bandIndex` vs `target` devient une bande `{ minBpm: number|null; maxBpm: number|null }` ; `zoneBand(target, bounds)` (Zn : min `bounds[n-1]`, max `bounds[n] - 1`, Z5 sans max ; comparaison sur `Math.round(lissée)`, tests existants verts tels quels) ; `boundBpm(choice, bounds, side)` (zone → BPM du bord ; S1/S2 → BPM du seuil ; BPM borné à la plage plausible) ; `validBand` exige min ≤ max, une seule borne permise ; mêmes délais (`ZONE_ALERT_DEFAULTS`) et sons : `trop` au-dessus, `accelere` en dessous, `bien` au retour. `src/hooks/useZoneAlert.ts` : `armZoneAlert` accepte zone ou bande ; `setLiveBand(band)` pendant l'enregistrement remet l'état à `startZoneAlert()` ; `STORAGE_KEY` range la bande (ancien format, un nombre, relu) ; expose `band`. `src/pages/RecordingPage.tsx` (repartir du 165) : en famille Entraînement, hors tests, ceinture connectée (conditions de `zoneOffered`), bouton glissant « Guidage cardio : aucun · zone · bornes » ; « zone » = zone visée actuelle ; hors Entraînement, seule la zone visée, inchangée ; « bornes » : lignes « Mini » et « Maxi » (voir l'arbitrage) ; pendant l'enregistrement, sous la tuile BPM : « Bornes 140–160 bpm · Modifier », `ui/Dialog` avec les mêmes contrôles (`setLiveBand`). Composant commun `src/components/HeartBandPicker.tsx`. Dernières bornes proposées pré-remplies (`heartBands?: ByActivity<…>` dans StoredSettings). Pas de tuile nouvelle sur la page Entraînement : une mention dans le sous-titre de la tuile « Fractionné et tests » (`TrainingHub.tsx`). `recording/intervalTimer.ts` intact.

## Ordre
1. 138, puis 137 (même hook), `data-tab` et conversion du banc tout de suite. 2. 133. 3. 134 A puis B. 4. 139 en dernier, avec la version du résumé. `node outils/verif.mjs --rapide` après chaque partie.

## Règles
1 (bpm, m) ; 2 (flèches et tops en distance ou temps, 1 Hz = 5 Hz) ; 3 (espacement et délais en paramètre) ; 6 (meilleur kilomètre sur `segmentDistanceM`) ; 11 (`pathOptions`) ; 12 (`platform/beeper`, `platform/storage`) ; « donnée propre à une session » (`summary`, version) ; « réglage utilisateur » (`StoredSettings` par activité) ; pas d'emoji ; jetons. CLAUDE.md, MISE_EN_PAGE et DECISIONS changent à la passe doc, pas dans ce lot.

## Tests synthétiques
`analysisTabs.test.ts` (`closeAll`, retour aux défauts ; extraire `initialOpen(defaults)` si besoin) ; `displayConfig.test.ts` (`arrowIndicesBySpacing` : ligne droite, 1 Hz = 5 Hz à un pas près, reprise de pause, plafond, trace vide) ; `zoneAlert.test.ts` (cas actuels inchangés ; mini seule, maxi seule ; mini > maxi refusée ; `boundBpm` zone, S1/S2, BPM ; bande changée en direct, compte remis à zéro) ; `shareStats.test.ts` (parité `SHARE_KEYS`, « — », « 83 % (10/12) », « Appréciation : Bien », pumping et vol sur foil seulement) ; `summary.test.ts` (meilleur kilomètre, meilleures 5 min sur ligne droite) ; `record.test.ts` (relecture des champs neufs, valeurs absurdes écartées) ; `activitySettings.test.ts` (`hrZoneLines` décoché par défaut).

## Banc (textes attendus)
- `onglets` : « tout fermer » après la flèche ; après un clic, aucun `aria-pressed=true`, « avancé » inchangé ; réouverture de la même session : « général » seul.
- `general`, `brouillon-voile` : identiques, une fois les scripts passés à `lib/onglets.mjs`.
- `partage` : voile « Manœuvres réussies », « Temps de vol », « Pumping », « Vent », « Appréciation » ; course « Meilleur 1 km » ; vélo « Puissance moyenne », « Meilleures 5 min » ; « — » quand la valeur manque.
- `cardio` : case « Zones » décochée par défaut ; cochée, lignes en plus (`.recharts-reference-line`), retenue au rechargement.
- `entrainement` : « Guidage cardio », « Mini », « Maxi » ; console `[zone] trop` / `[zone] accelere` sur FC simulée si le banc sait la simuler (sinon le dire dans `SCRIPTS.md`).
- `zoom-carte` : `.custom-arrow` moins nombreuses au zoom − 2, plus au zoom + 2, en voile, course et surf.
- Les 56 scripts convertis : texte relevé identique.

## Au téléphone (3)
1. Image de partage d'une séance de voile sur foil : lignes ajoutées lisibles, sans emoji.
2. Course à bornes avec la ceinture (« Ça attend une occasion ») : bips au-dessus et en dessous, bornes changées pendant la course.
3. Flèches en pinçant la carte : ni saccade ni trop-plein.
