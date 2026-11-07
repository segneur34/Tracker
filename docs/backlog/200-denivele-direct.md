# 200 · Graphe de dénivelé pendant le suivi d'un itinéraire

Maquette validée par l'utilisateur le 07/11 : bouton « Dénivelé » sur la ligne « Trace suivie », graphe sous la carte, courbe colorée par la pente, repère de position, tout l'itinéraire avec le zoom des graphes des analyses (même pièce), ligne « reste … m D+ », état ouvert ou fermé retenu. Dépend du 196. Opus/high.

## Deux pièges du dépôt

- `gradeGradientStops` est dans `land/grade` : RecordingPage et une pièce neuve ne peuvent pas l'importer (règle 13). Passer par `profileGradeStops`, à créer dans `planning/route.ts`, dont le fil existe déjà.
- Un hook de `hooks/` ne lit pas `components/` : la pièce extraite va dans `components/`.

## Fichiers

Créés :
- `src/recording/followedProfile.ts` et son test : calcul pur, `hasFollowedElevation`, `followedProfile(trace)` (lignes et distances, cache par trace), `followedAltitudeAt`, `remainingGainM` ;
- `src/components/routeProfileChart.ts` : `useRouteProfileChart`, sorti de `PlanningPage.tsx:517-555` ;
- `src/components/FollowedElevation.tsx` : le panneau, seul nouvel abonné à `useLiveRecording` ;
- `outils/banc/denivele-direct.mjs`.

Modifiés :
- `src/recording/followedTrace.ts` et son test : type `FollowedPoint`, `usable`, `thinFollowedTrace`, `followedTraceFromSession`, sans toucher au suivi ;
- `src/core/simplify.ts` et son test : `simplifyAlongElevation` ;
- `src/planning/route.ts` et son test : `profileGradeStops` ;
- `src/components/ElevationProfileMini.tsx` : prop facultative `front` ;
- `src/components/LiveMap.tsx` : prop facultative `hoverPoints` ;
- `src/components/FollowTracePicker.tsx` : `pickSession` passe par `followedTraceFromSession` ;
- `src/pages/PlanningPage.tsx` : lignes 517-555 seulement ;
- `src/pages/RecordingPage.tsx` et `.css` : `RECORDING_SECTION_DEFAULTS`, bouton, `RecordingMap`, panneau ;
- `outils/banc/scripts.mjs`, `outils/banc/SCRIPTS.md`, `docs/INVENTAIRE.md` (fichiers neufs, sinon `npm run verif` échoue).

Non touchés : `useFollowedTrace.ts` (sa relecture passe par `usable`), `useLiveRecording.ts`, `TrackChart.tsx`, `architecture.test.ts`, `library/*`.

Réutilisés : `routeProfileRows`, `routePoints`, `DEFAULT_IMPORT_SMOOTHING_M` ; `accumulateElevation`, `smoothElevationAlong` ; `simplifyLatLon`, `simplifyPlane` ; `cumulativeDistancesM` ; `partitionPoint` ; `visibleIndexRange`, `sampledIndices` ; `HoveredTrackMarker`, `useResetChartHover` ; `effectiveGradeRange`, `effectiveDistanceUnit` ; `isLandTreatment`, `sportTreatment`, `ELEVATION_PRESETS.route.minGainM` ; `MapAutoResize` ; `usePhoneLandscape`.

## Points tranchés

**Altitude.** L'amincissement en 2D perd les sommets (route droite qui monte puis descend). On ajoute aux points gardés un second amincissement sur (distance, altitude), à 1 m près (`FOLLOWED_TRACE_ELEVATION_TOLERANCE_M`, passé en paramètre) ; une série d'altitudes est traitée par morceaux continus. `routePoints` porte l'altitude, seul `usable` la perd. Session suivie : lissage sur 100 m comme `routeFromTrack`, sur la distance (règle 2) ; `ele` du GPX devient `eleM`, gardée seulement pour une activité à terre. Poids estimé +40 %, à borner par un test. Ancienne trace sans altitude : relue à l'identique, sans bouton. Altitude illisible : écartée. Pas de demande de relief pour une session suivie.

**Repère.** `front`, déjà porté par `TrackChart` (modèle `IntervalAnalysis`) : `ReferenceLine` et `ReferenceDot`, en tableau, couleurs de `HoverMarker`, absents hors de la plage zoomée. Sans cette prop, analyses et planification ne changent pas. `LiveMap` : `{hoverPoints && <HoveredTrackMarker points={hoverPoints} />}`. `FollowPosition` ne décroche qu'au `dragstart`. `useResetChartHover(followed)`. Au doigt, le repère reste où on l'a laissé (§2).

**Distance.** `routeProfileRows(trace.points)` utilise le même calcul de longueur que le suivi : repère = `toDisplayDistance(progressM, unit)`.

**Performances.** Profil en cache par objet trace. Le panneau ramène `live.progress` à la ligne de 10 m ; le graphe est en `memo` sur cette ligne ; panneau fermé non monté ; la page ne se redessine pas.

**Affichage.** Condition : `followed && !pending && !courseMarksOf && liveActivity && isLandTreatment(sportTreatment(liveActivity.base)) && hasFollowedElevation(followed)`. Portrait et ordinateur : dans le flux après la carte, ou après « Afficher la carte » si réduite, avant les chiffres. Téléphone tourné : fixé en bas de la colonne de droite, carte raccourcie par `:has`, graphe à 96 px. Au repos : avec l'aperçu, sans repère.

**Retenu.** Clé `denivele: false` dans `RECORDING_SECTION_DEFAULTS`, par `toggleShown`. Zoom remis à zéro à chaque trace.

**Texte.** En enregistrement : « reste 640 m D+ », par `formatMeters`, sous le graphe ; avant d'avoir rejoint la trace, le total. Au repos : « 850 m D+ au total ». `remainingGainM` : altitude interpolée à `progressM`, puis points suivants, par `accumulateElevation(…, minGainM)`. Rien dans `summary`, `SUMMARY_CALC_VERSION` non concerné.

## Étapes

1. `simplifyAlongElevation` et tests.
2. `followedTrace.ts`, puis `FollowTracePicker`.
3. `followedProfile.ts`, `profileGradeStops`.
4. `routeProfileChart.ts`, bascule de PlanningPage, neutralité vérifiée avant de continuer.
5. Props `front` et `hoverPoints`.
6. `FollowedElevation.tsx`, RecordingPage, CSS.
7. Banc, registre, `SCRIPTS.md`, INVENTAIRE.

## Tests

- `simplify` : sommet sur ligne droite perdu en 2D, gardé ici ; sans altitude, identique à `simplifyLatLon` ; bouts de morceaux.
- `followedTrace` : altitude de route gardée ; sans altitude, points identiques ; amincir deux fois garde le D+ à 1 m près ; borne de poids sur 3 h à 1 Hz ; session bruitée lissée, même D+ à 1 Hz et 5 Hz.
- `followedProfile` : dernière ligne égale à `followedTraceLengthM` ; altitude interpolée ; reste à 0 égal à `accumulateElevation`, 0 à l'arrivée ; trous d'altitude ; moins de 2 altitudes = pas de bouton ; cache.
- `route` : `profileGradeStops`. `architecture.test.ts` inchangé doit passer.

## Banc

`denivele-direct.mjs`, sans réseau, trace posée dans `tracker.followedTrace` comme `balises.mjs`, deux bosses connues, rejeu :
- repos : bouton, graphe sous la carte, total exact, état retenu après rechargement ;
- sans bouton : trace sans altitude, voile avec balises, surf ;
- rejeu : le repère avance et colle à la distance, « reste » descend à 0, courbe inchangée, carte qui suit, pas de « Recentrer » ;
- survol : un rond sur la carte, retiré à la sortie ; zoom : double-clic, « Tout voir », repère absent hors plage ;
- chiffres identiques en fin de rejeu, graphe ouvert ou fermé ;
- carte réduite ; 390×844 et 844×390 tactile : pas de débordement ni de chevauchement, « Réduire la carte » visible ;
- tâches longues à processeur ×6, ouvert contre fermé.

Neutralité : `node outils/banc/passe.mjs altitude graphes balises carte-direct activite`, et `planning` nommé pour l'extraction de PlanningPage.

## Essai au téléphone

Essai 147 : une sortie réelle sur un itinéraire avec montées. Le rond blanc laissé sur la carte après avoir touché le graphe gêne-t-il en direct ? Par défaut, on garde la règle §2 ; s'il gêne, il s'efface au lever du doigt dans ce seul panneau.
