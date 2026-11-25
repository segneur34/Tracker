# 233 · Plan (agent Plan, 25/11) et choix tranchés

Brief : `docs/backlog/233-surf-chiffres-justes.md`. Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), commits cités par sous-lot.

## Contexte

Le code surf de Tracker est identique au point de départ des commits de Gtracker, aux commentaires près (`surfAnalysis.ts`, `gpsTurns.ts`, `gyroTurns.ts`, `surfSession.ts`, `TrackSpanLayer`, `HighlightSpan`, `map/paths.tsx`) : la reprise suit les diffs de près, sans les traductions `t()`, textes en français direct. `SurfModule.tsx` a divergé (environ 600 lignes de diff) : il se reprend à la main. `SUMMARY_CALC_VERSION` vaut 23 (`src/library/record.ts`).

## Seuils (règle 3 : écart voulu avec Gtracker)

Gtracker a laissé ses seuils en constantes de module. Ici ils vont dans `SurfProfile` (`src/core/sportProfiles.ts`, bloc `surf`, à côté de `gyroTurns`), en sous-blocs, passés par `...profile.surf` dans `runSurfSession`, surchargeables par les tests, absents de Réglages (comme `gyroTurns`). Valeurs de Gtracker :
- `rise` : 10 s, fenêtre 4 s, rapport 0,95 ;
- `depart` : 15 s, gain minimal 0,3 m/s ;
- `turnRules` : plancher du cap 2 m/s (7,2 km/h), 3 s de glisse après le virage, 2 s de mise en vitesse non lues, pause sous 15°/s sur 1 s, corde du cap 0,9 s ;
- `waveSense` : fenêtre 5 s, 4 mesures, concentration minimale 0,5, 120° pour une remontée à contre-sens, 3 départs pour la ligne ;
- `peakZone` : marge 15 m, 5 m côté plage, allongement 1,5, départ de l'intérieur à 40 m, ligne d'au moins 30 m, inclinaison 45° au plus.

Les tailles de flèche en pixels (`waveSenseMarks`) sont du dessin : constantes.

## 233a · Étape 1 : vagues et virages (un commit)

- `src/surfing/surfAnalysis.ts` et son test : `riseStartOf` (e3d3d81), `departStartOf` et sur `SurfWave` les champs `rideStart`, `rideStartMs`, `departS`, `turnRideEndMs` (60a0ba2). Vitesse max, virages et sens se lisent depuis `rideStart`. Le retour se mesure encore si on entre dans la zone pendant le départ.
- `src/surfing/gpsTurns.ts` et son test : règles des virages `TurnRules`, `rotationEnds`, `rideEndMsOf`, `gpsTurnsOf` (7076761) ; cap lu sur une corde de 0,9 s qui saute les points écartés par `detourSpikes` (`src/core/kinematics.ts`, existe déjà ; 5f1c363) ; on garde `directionChanges` et `signedDeltaHalfOpen` (`core/angles.ts`).
- `src/surfing/gyroTurns.ts` et son test : `rideAfterS`, `TurnWave.turnRideEndMs`.
- `src/surfing/surfSession.ts` : passe `rideExitMs` et `waveExitMs` (`thresholdMaskOptions(...).exitThresholdMs` existe dans `core/sessionStats.ts`).
- `core/sportProfiles.ts` : blocs `rise`, `depart`, `turnRules`.
- `library/record.ts` : version 24, avec sa note.
- Hors `src/surfing/` : `components/highlightColors.ts` (`WAVE_DEPART_COLOR`) ; `components/HighlightSpan.tsx` et `TrackSpanLayer.tsx` (la tête du passage dans une autre couleur, `lead` ; la voile s'en sert aussi, par le pumping) ; `pages/SurfModule.tsx` (départ en orange sur la carte et sur la courbe, règles passées à `gyroWaveTurns`).
- Tests (traces synthétiques) : vague molle et planche à pagaie à 1 Hz, 5 Hz et avec un pas de 6 s, avec et sans vitesse du GPS ; même compte de virages GPS à 1 Hz, 5 Hz et en cadence irrégulière, avec et sans `courseDeg`, sous 1,2 m de bruit ; sortie de vague écartée, frontières à 2,5 s et 3,5 s, sortie dans le même sens, pas de 4 s ; au gyroscope, rotation de sortie écartée.
- Banc : `surf.mjs` (ajouter une vague molle et un départ orange : 02a758a, 4a40843) ; `virages.mjs` (vague allongée, rotation de sortie, vague sans capture attendue « 0* » : b5c09b4) ; `virages-diagnostic.mjs` (capture facultative, détail de la glisse restante) ; neutralité par `passe.mjs --avant` : `general`, `pumping`, `statistiques`, `library`.

## 233b · Étape 2 : sens des vagues et zone du pic, calcul et saisie (un commit)

- À créer : `src/surfing/waveSense.ts` et son test (2cedaa0, 008ad35, 54f2fb4) ; `src/surfing/peakZone.ts` et son test (008a197, 7692843, 54f2fb4) ; `src/components/CompassAdjustOverlay.tsx` (dee4fa8, poignée sur le cercle d'ac46858) ; `src/components/surf/WaveSenseField.tsx`, `WaveSenseOverlay.tsx`, `waveSenseView.ts` et son test (dee4fa8, 089c367, 9d31d1d, 4aa3d6e).
- À réutiliser : `planeProjection` (`core/geo.ts`), `circularMean`, `normalizeDeg`, `angleDiff` (`core/angles.ts`), `median` (`core/basics.ts`).
- `surfAnalysis.ts` : retour mesuré jusqu'à l'entrée dans la zone (`zoneEntry`), avec `entryMs` ; sur foil, remontée pompée écartée par `isAgainstWaveSense` ; `waveSense`, `estimatedWaveSense` et `peakZone` dans le résultat.
- `surfSession.ts` : `waveDirectionDeg?: number | null` **optionnel** (ainsi `src/recording/liveStats.test.ts`, côté lot 232, n'est pas touché).
- Fiche et brouillon (9535822) : `library/record.ts` (`waveDirectionDeg` dans `SessionAnalysis` et `ANALYSIS_FIELDS`, partie `'sensVagues'` ; `applyRecordPatch` le garde d'une activité de surf à l'autre et l'efface si la famille change ; version 25) ; `library/sessionEdits.ts` (`EDITED_PART_LABEL`) ; `library/summary.ts` et `summaryOptions.ts` (l'empreinte ne change que si un sens est saisi) ; tests `record.test.ts`, `sessionEdits.test.ts`, `summaryOptions.test.ts`.
- Boussole commune avec la voile : `WindAdjustOverlay.tsx` devient une enveloppe de `CompassAdjustOverlay` ; `WindCompass.tsx` (flèche des vagues, aucune flèche sans sens : 00de95f) ; tests à créer.
- Barre « Non enregistré » dans la carte agrandie au téléphone (6fa0005, 00de95f) : `AnalysisMap.tsx`, `AnalysisShell.tsx`, `analysisMobile.css`.
- `SurfModule.tsx` : sens dans « général » et dans « réglages » avec « Régler », aides de l'onglet rame réécrites.
- Tests : sens à 1 Hz, 5 Hz et avec un pas de 4 s ; gauches et droites mêlées ; foil à cinq vols (dix vagues deviennent six) ; entrée dans la zone à 1 Hz, 5 Hz et par un pas de 8 s ; trou, pause, vague finie dans la zone ; zone à deux vagues jamais ronde.
- Banc : `surf.mjs` (nouveaux retours recalculés à la main, tirage de la poignée, boussole entière à 390 px : bd0b525) ; `general.mjs` et `brouillon-voile.mjs` pour la voile (poignée sur le cercle, polaire au-dessus de la barre de navigation).
- À surveiller : Gtracker a noté un écart non élucidé entre le banc et le test unitaire du même scénario (15,6 s).

## 233c · Étape 3 : dessins sur la carte et cadres au téléphone (un commit, après celui du lot 225)

- `components/map/paths.tsx` gagne `Polygon`, au patron de `Polyline` (9128482) : seul fichier commun avec le lot 225.
- À créer : `components/PeakZoneLayer.tsx`, `components/WaveSenseLayer.tsx` (c92cf3f, qui sert `metersPerPixel` et `useMapEvents`), `surfing/waveSenseMarks.ts` et son test. Styles en constantes (règle 11).
- `SurfModule.tsx` : une vague ou une remontée par cadre (dessin D, ba2e52b seul). `analysisMobile.css` : classes des cadres.
- Banc : `surf.mjs` (première case lue au texte visible), relevés à 390, 360 et 320 px, de jour et de nuit.

## Recouvrements

- 225 : seulement `components/map/paths.tsx`, en 233c, d'où l'ordre.
- 232 : aucun fichier commun si `waveDirectionDeg` reste optionnel ; `library/record.ts` à surveiller si 232 y écrit (heure d'interruption).
- 234 touche aussi `SurfModule.tsx`, `analysisMobile.css`, `AnalysisShell`, `useSessionDraft`, `sessionEdits` : avant ou après 233, jamais en même temps.

## Règles en jeu

2 et 10 (corde du cap, montée, entrée dans la zone et sens jugés en secondes, long pas toléré) ; 3 (seuils dans le profil) ; 6 (distance par `cumDist`) ; 11 (`pathOptions` stables) ; sens saisi dans la fiche par le brouillon ; `SUMMARY_CALC_VERSION` augmenté à chaque sous-lot qui change un chiffre ; surbrillance par `useMapHighlight`, couleurs de `highlightColors`.

## Tranché par l'orchestrateur le 25/11

L'utilisateur a demandé « tout Surf : chiffres plus justes » d'après Gtracker, où ces règles ont été réglées avec lui : les réponses suivantes en découlent, sans nouvelle question.
- Seuils neufs : valeurs de Gtracker, dans le profil, absents de Réglages.
- Le départ de la vague compte dans sa durée, sa distance et sa moyenne : vagues plus longues et rame plus courte dans toutes les sessions recalculées, Statistiques comprises.
- Sur foil, une remontée pompée sort des vagues : le nombre de vagues baisse sur les sessions existantes.
- Poignée de la boussole sur le cercle, vent de la voile compris ; barre « Non enregistré » dans la carte agrandie, voile comprise ; sens des vagues dans « général » (DECISIONS §4 à la passe de doc) ; version 24 en 233a, 25 en 233b ; le seuil de vague par défaut du paddle reste hors du lot.

## Essais sur données réelles

- Session de paddle du 16/11 : début et fin des deux vagues, 0 virage sur chacune, retour après la vague 1 proche de « un peu moins d'1 min 30 » (Gtracker trouvait 55 s).
- Tirer la poignée de la boussole au doigt, en voile et en surf.
