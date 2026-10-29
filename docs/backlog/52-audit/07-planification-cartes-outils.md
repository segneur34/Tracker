# 07 · Planification, cartes, outils et configuration

Audit en lecture seule du 28/10/2026 (dépôt au commit 86b3f8d). Rien n'a été modifié dans le dépôt. Les seuls fichiers écrits l'ont été dans le brouillon : ce rapport, deux sondes (`tsprobe/`, `oxprobe/`) et un banc de calcul Node (`bench-plan.mjs`, qui charge le TypeScript du projet par `outils/banc/charge-ts.mjs`).

Dans tout le rapport, « fichier:ligne » renvoie au fichier source. Le constat le plus important de chaque section vient en premier.

## Carte

| Fichier | Lignes | Rôle | Appelants (hors tests) | Testé |
|---|---|---|---|---|
| planning/route.ts | 964 | Modèle d'itinéraire : modes et types de voie, libellés, édition, boucle, import d'une trace, distances, D+, profil | 18 fichiers (WayTypeTabs, usePlannedRoute, useRouteLibrary, useSportSettings, PlanningPage, SettingsPage, 11 modules de planning/, recording/followedTrace) | oui (723 l.) |
| planning/surface.ts | 396 | Étiquettes OSM → revêtement, morceaux, longueurs, tracés et surbrillance | 15 (SurfaceBar/Layer/Highlight, cycling/energy, library/record, LandModule, landModules, PlanningPage, useSessionSurfaces, 6 modules de planning/) | oui |
| planning/brouterProfile.ts | 341 | Profil BRouter maison (coûts fixés avec l'utilisateur, **à ne pas toucher**) | 9 | indirect (brouter.test) |
| planning/loopReturn.ts | 287 | Couloir à éviter pour le retour d'une boucle, part commune avec l'aller | usePlannedRoute, legCalculation, route | oui |
| planning/brouter.ts | 218 | Appel BRouter, envoi du profil, lecture GeoJSON et des voies | usePlannedRoute, legCalculation | oui |
| planning/duration.ts | 201 | Temps estimé (km-effort, modèle physique vélo) | activityPresets, useSportSettings, PlanningPage, SettingsPage, routeList | oui |
| planning/routeRecord.ts | 194 | Fiche JSON d'un itinéraire | useRouteLibrary, PlanningPage, routeList, followedTrace | oui |
| planning/wayMatch.ts | 167 | Appariement trace ↔ voies OSM (revêtement d'une session) | useSessionSurfaces, LandModule, overpass | oui |
| planning/overpass.ts | 120 | Client Overpass | useSessionSurfaces | oui |
| planning/legCalculation.ts | 116 | Calcul d'un tronçon et du retour (serveur injecté) | usePlannedRoute | oui |
| planning/routeList.ts | 108 | Listes d'itinéraires, distance et temps mis en cache par fiche | FollowTracePicker, RouteList, Home, PlanningPage, RoutesPage, SessionLibrary | oui |
| planning/ignAltimetry.ts | 97 | Client altimétrie IGN | useTerrainElevation | oui |
| planning/fetchJson.ts | 95 | Appel réseau commun (délai, messages en clair) | brouter, geocoding, ignAltimetry, legCalculation, overpass | oui |
| planning/geocoding.ts | 70 | Recherche de lieux (Photon) | PlanningPage | partiel (photonUrl, parsePhoton) |
| planning/routeGpx.ts | 53 | Export GPX d'un itinéraire | useRouteLibrary, PlanningPage | oui |
| components/LiveMap.tsx | 221 | Carte de l'enregistrement en cours | RecordingPage | non (banc) |
| components/FollowTracePicker.tsx | 190 | Choix de la trace à suivre | RecordingPage | non |
| components/AnalysisMap.tsx | 176 | Carte commune des analyses, vue agrandie, légende | LandModule, SailingModule, SurfModule | non (banc) |
| components/BaseTileLayer.tsx | 156 | Fond plan/satellite, tuiles gardées, bouton de fond | LiveMap, Land/Sailing/SurfModule, PlanningPage, SessionLibrary | non |
| components/WindAdjustOverlay.tsx | 144 | Grande boussole de réglage du vent | SailingModule | non (banc general) |
| components/mapTiles.ts | 125 | Tuiles : cache, réseau, agrandissement d'une parente | BaseTileLayer, drawShareImage | **non** |
| components/RouteList.tsx | 97 | Liste d'itinéraires rangés | PlanningPage, RoutesPage, SessionLibrary | non |
| components/SurfaceBar.tsx | 94 | Barre du revêtement | LandModule, PlanningPage | non |
| components/sessionTrack.ts | 77 | Trace colorée et bornes d'une session hors de son analyse | SavedSessionShare, SessionLibrary | **non** |
| components/TrackSegmentsLayer.tsx | 59 | Trace colorée sur canevas (un trait par paire de points) | Land/Sailing/SurfModule, SessionLibrary ; type importé par drawShareImage, ShareDialog, SavedSessionShare, SessionNameEditor | non |
| components/JumpMapLayer.tsx | 46 | Sauts sur la carte | LandModule, SailingModule | non |
| components/TrackSpanLayer.tsx | 43 | Passages (vague, vol) sur la carte | SailingModule, SurfModule | non |
| components/SpeedGradientLegend.tsx | 39 | Légende vitesse | Land/Sailing/SurfModule | non |
| components/SurfaceLayer.tsx | 37 | Tracé coloré par revêtement | LandModule, PlanningPage | non |
| components/WayTypeTabs.tsx | 32 | Cases des types de voie | PlanningPage, SettingsPage | non |
| components/HoverMarker.tsx | 29 | Repère du survol | Land/Sailing/SurfModule, PlanningPage | non |
| components/SurfaceHighlight.tsx | 29 | Surbrillance d'un revêtement | LandModule, PlanningPage | non |
| components/WindCompass.tsx | 28 | Petite boussole | SailingModule | non |
| components/GradeGradientLegend.tsx | 27 | Légende pente | LandModule | non |
| components/MapAutoResize.tsx | 23 | invalidateSize sur redimensionnement | AnalysisMap, LiveMap, PlanningPage, SessionLibrary | non |
| components/mapOverlayContext.ts | 4 | Contexte « sous la carte agrandie » | AnalysisMap, ZoomableChart | non |
| core/patternTiles.ts | 365 | **Fonds de page** (motifs), pas des tuiles de carte | PageBackdrop, useFavoriteBackdrop | oui |
| platform/tileCache.ts | 181 | Stockage des tuiles (fichiers natifs / Cache API) | mapTiles, useTileCache | **non** |
| core/tiles.ts | 82 | Calculs purs du cache de tuiles | drawShareImage, mapTiles, mapBase, shareImage, useTileCache, tileCache | oui |
| core/mapBase.ts | 72 | Fonds plan/satellite | BaseTileLayer, drawShareImage, mapTiles, useMapBase, useTileCache | oui |
| core/geoPlane.ts | 72 | Plan local, projection sur un segment | simplify, loopReturn, route, wayMatch, followedTrace, markGuide | oui |
| core/trackColor.ts | 72 | Vitesse de couleur, traits colorés | SavedSessionShare, sessionTrack, Land/Sailing/SurfModule, SessionLibrary | oui |
| core/speedGradient.ts | 61 | Dégradé de couleur | 18 fichiers | indirect (runningAnalytics.test) |
| core/simplify.ts | 60 | Douglas-Peucker | loopReturn, followedTrace | oui |
| Hooks liés (lus) : usePlannedRoute 285, useTerrainElevation 155, useSessionSurfaces 107, useTileCache 81, useMapBase 29 | | | | usePlannedRoute.test |
| outils/banc/*.mjs | 69 scripts, 14 001 l. | Banc Chrome sans fenêtre (DevTools) | — | — |
| outils/backlog.mjs | 374 | Tableau de bord du reste à faire | npm run backlog | backlog.test.mjs (pris par vitest) |

## Qui dessine une trace sur une carte

| Écran | Composant | Source des positions | Simplification | Couleur | Règle 11 |
|---|---|---|---|---|---|
| Analyses voile, course/vélo/fractionné, surf | `TrackSegmentsLayer` (canevas, `L.polyline` impératif, TrackSegmentsLayer.tsx:43-55) | `trackColorSegments(track…)` (LandModule.tsx:738, SailingModule.tsx:383, SurfModule.tsx:260), un trait par paire de points | **aucune** : 11 000 traits à 1 Hz sur 3 h, 54 000 à 5 Hz | `speedGradient` via `trackColor` (lissage 15 s à pied et à vélo) | sans objet (options passées à la création, couche recréée quand `segments` change) |
| Analyse course/vélo, pente | `TrackSegmentsLayer` | `gradeColorPaths` (LandModule.tsx:459-461), suites de même palier | par palier de couleur | dégradé de pente | idem |
| Analyse course/vélo et planification, revêtement | `SurfaceLayer` (react-leaflet) | `surfacePaths` | suites de même revêtement | `SURFACE_COLOR` | respectée (styles mémorisés, SurfaceLayer.tsx:17-25) |
| Vignette de bibliothèque | `TrackSegmentsLayer` dans un `MapContainer` par ligne (SessionLibrary.tsx:290-306) | `sessionColorTrack` (sessionTrack.ts:34-54), puis **300 points pris à pas d'indice régulier** (`sampledIndices`, SessionLibrary.tsx:260) | échantillonnage par indice, pas Douglas-Peucker | même chaîne que l'analyse, bornes par `sessionSpeedRange` (sessionTrack.ts:65-77) | sans objet |
| Image de partage (analyse et fin d'enregistrement) | `drawShareImage` (canevas 2D, projection Mercator de core/shareImage.ts:93-96) | `mapSegments` du module, ou `coloredSegments(sessionColorTrack…)` (SavedSessionShare.tsx:62) | aucune ; un `stroke()` par trait (drawShareImage.ts:130-139) | identique à l'analyse | sans objet |
| Enregistrement en cours | `LiveMap` (react-leaflet, une `Polyline` par segment, LiveMap.tsx:192-199) | `segments` du direct, positions gardées par `pathCache` (LiveMap.tsx:138-149) | aucune (inutile à 1 Hz) | une seule couleur, celle de la famille | respectée (styles en constantes ou mémorisés) |
| Planification | `PlanningPage` (une `Polyline` par tronçon, PlanningPage.tsx:893-910), `SurfaceLayer`, pente par `gradeColorPaths` | tracés BRouter, positions mémorisées par `WeakMap` (PlanningPage.tsx:159-168) | aucune (BRouter rend déjà peu de points) | bleu fixe `ROUTE_COLOR` (décision §7) | respectée (styles constants, PlanningPage.tsx:136-152) |
| Surbrillances (tops, zones, sauts, passages, zoom) | `TopsHighlight`, `JumpMapLayer`, `TrackSpanLayer`, `SurfaceHighlight`, `<Polyline>` en ligne dans les trois modules | tranches de la trace | aucune | `highlightColors.ts` | respectée, mais objets `pathOptions` recréés à chaque rendu |

En résumé, la trace colorée passe par une seule fonction de couleur (`core/trackColor.ts`) pour l'analyse, la vignette et l'image de partage. Elle est dessinée par deux pièces : `TrackSegmentsLayer` (Leaflet) et `drawShareImage` (canevas 2D). Le direct et la planification ont chacun leur tracé, d'une seule couleur, ce qui suit les décisions. La règle 11 est respectée partout : aucun style n'est passé hors de `pathOptions` (vérifié par recherche).

## A. Doublons

**A1. Mise en route du protocole DevTools recopiée dans 63 scripts du banc**
- Où : `outils/banc/*.mjs`. 63 scripts réécrivent `send`, `ws.onmessage` et la collecte des erreurs de console ; 62 ouvrent leur onglet par `/json/new` ; 62 ont leur propre `evaluate`. 41 réécrivent l'import d'un GPX par `DOM.setFileInputFiles` (exemples : general.mjs:23-39, bench.mjs:15-30, cdp.mjs:1-24).
- Identique ou différent : identique à quelques détails près (filtre des messages de console, réponse aux dialogues), et c'est d'ailleurs l'origine des écarts de D2.
- Pièce unique proposée : `outils/banc/lib/cdp.mjs`, avec `connect(port)`, `evaluate`, `wait`, `blockNetwork(urls)` (qui lance `Network.enable` d'office), `importGpx`, `dumpText`, `closeTab` et une seule valeur par défaut de `BASE`.
- Risque : nul pour l'application ; on reprend les scripts un par un en vérifiant que leur sortie ne change pas.
- Taille : gros (mécanique, environ 2 000 lignes en moins). Confiance : haute.

**A2. Ordre de choix des bornes de couleur écrit quatre fois**
- Où : LandModule.tsx:636, SurfModule.tsx:258, SailingModule.tsx:358 (`edits.speedRange ?? speedRange ?? défaut ou suggestion`) et sessionTrack.ts:65-77 (`sessionSpeedRange`, qui recopie l'ordre « comme le module d'analyse » pour la vignette et le partage).
- Identique ou différent : l'intention est la même, mais l'équivalence n'est prouvée par aucun test. `sessionSpeedRange` n'a pas de test, alors qu'elle porte une décision transverse : « une seule coloration d'une session, la même dans son analyse et sa vignette ».
- Pièce unique proposée : `effectiveSpeedRange({ sessionRange, activity, suggested, treatment })` dans `core/trackColor.ts` ou `library/`, appelée par les trois modules et la vignette, avec un test par famille.
- Risque : moyen, car une vignette pourrait changer de couleur ; le neutraliser par un relevé du banc avant et après.
- Taille : petit. Confiance : moyenne.

**A3. Plan local équirectangulaire écrit trois fois, alors que geoPlane se dit « la seule écriture »**
- Où : geoPlane.ts:65-72 (`planeProjection`) ; simplify.ts:53-60 (recopie `kx`, `ky`) ; wayMatch.ts:90-94 (son propre `k = cos(lat0)·R`, centré sur le premier point).
- Identique ou différent : la formule est identique ; seule l'origine change (0° ou premier point), ce qui ne change pas les distances.
- Pièce unique proposée : `planeProjection(refLat)`, avec une origine en option.
- Risque : très faible (tests de simplify et de wayMatch). Taille : petit. Confiance : haute.

**A4. Grille spatiale de segments écrite deux fois**
- Où : wayMatch.ts:96-132 (cellule = rayon, segment entier rangé dans les cases de sa boîte, recherche dans les 9 cases voisines) ; loopReturn.ts:240-272 (cellule = tolérance, segment découpé en bouts avec une marge).
- Identique ou différent : même structure, deux variantes.
- Pièce unique proposée : `core/segmentGrid.ts`, avec `build(segments, cell, margin)` et `near(point)`.
- Risque : faible (les deux modules sont testés). Taille : moyen. Confiance : haute.

**A5. Longueur et distance cumulée par Haversine écrites quatre fois, et rangées dans planning/**
- Où : route.ts:859-865 (`cumulativeDistances`, importée par recording/followedTrace.ts:4) ; surface.ts:307-328 (`lineLengthM`, `midpoint`, sur des couples `[lat, lon]`) ; legCalculation.ts:236-239 (`lengthM`, au-dessus de `cumulativeDistances`) ; markGuide.ts:209.
- Identique ou différent : identique.
- Pièce unique proposée : `pathLengthM` et `cumulativeDistancesM` dans `core/geoPlane.ts` ou `core/kinematics.ts`, en gardant l'exception de la règle 6 (un itinéraire n'a pas de vitesse).
- Taille : petit. Confiance : haute.

**A6. Recollage des tronçons et prédicat « tronçon calculé » écrits plusieurs fois**
- Où : route.ts:842-849 (`legsPoints`) contre loopReturn.ts:116-133 (`corridorPaths`, même recollage au point commun, avec un filtre en plus). Le prédicat existe trois fois : route.ts:87 et 178 (`isWaysMode`, `isFixedMode`), surface.ts:355 (`isComputedLeg`, qui réécrit `isWaysMode`), loopReturn.ts:110 (`formsCorridor`, différent : il compte aussi les traces importées).
- Pièce unique proposée : `isComputedLeg = isWaysMode(leg.mode)`, et `joinLegs(legs, keep?)` partagé par les deux recollages.
- Taille : petit. Confiance : haute.

**A7. Surbrillance d'un passage sur la carte recopiée**
- Où : JumpMapLayer.tsx:27-39 et TrackSpanLayer.tsx:26-37 sont presque identiques (trait de 10 px sur la trace, `CircleMarker` au départ, `Popup`, le tout dans une `<span>`). Le style `{ color, weight: 10, opacity: 0.8 }` revient **15 fois dans 7 fichiers** (LandModule.tsx:1156-1169, SailingModule.tsx:476-493, 949 et 953, SurfModule.tsx:498 et 501, TopsPanel.tsx:80, SurfaceHighlight.tsx:18-19). SailingModule.tsx:470-482 redessine aussi les podiums de tops au lieu de reprendre `TopsHighlight` (TopsPanel.tsx:76-82).
- Identique ou différent : presque identique ; l'opacité vaut 0,8 à certains endroits et 0,85 à d'autres (JumpMapLayer:34, TrackSpanLayer:32, SailingModule:491).
- Pièce unique proposée : `HighlightPath` (et `HighlightSpan`, trait plus point) dans `components/`, avec les styles en constantes dans `highlightColors.ts`.
- Risque : faible, mais il faut trancher entre 0,8 et 0,85. Taille : petit à moyen. Confiance : haute.

**A8. Liseré blanc du fond satellite défini trois fois, avec trois épaisseurs**
- Où : TrackSegmentsLayer.tsx:21 et 48 (épaisseur du trait + 3, soit 8) ; LiveMap.tsx:46 (7) ; PlanningPage.tsx:130 (9). Opacité 0,85 partout.
- Pièce unique proposée : `HALO_STYLE(weight)` dans un module de styles de carte.
- Taille : petit. Confiance : haute. Question F3.

**A9. Repères numérotés en `divIcon`, mis en cache deux fois**
- Où : LiveMap.tsx:60-77 (`markIcon`, balises) et PlanningPage.tsx:191-205 (`waypointIcon`), plus SessionMarks.
- Identique ou différent : différent par le style, identique par le mécanisme (cache par clé).
- Pièce unique proposée : `cachedDivIcon(key, build)`. Taille : petit. Confiance : moyenne.

**A10. Deux enrichissements réseau d'une session recopiés**
- Où : useSessionSurfaces.ts:23-106 et useTerrainElevation.ts:24-155. On y retrouve les mêmes pièces : `found` et `searching` au niveau du module, `store` dans la fiche, l'effet « trouvé avant que la bibliothèque connaisse la session », `error` + `retry`, et le statut.
- Pièce unique proposée : `useSessionEnrichment({ key, isCurrent, fetch, recordField })`.
- Risque : moyen (écriture dans la fiche) ; neutraliser par les bancs surface.mjs et altitude.mjs. Taille : moyen. Confiance : haute.

**A11. Deux classements du revêtement OSM qui divergent**
- Où : brouterProfile.ts:72-78 (`PAVED_SURFACES`, `UNPAVED_SURFACES`, `ROLLING_PATH_SURFACES`, qui reclassent une voie pour le calcul) et surface.ts:74-94 (`SURFACE_VALUES`, `TRACKTYPE_VALUES`, pour l'affichage).
- Différences relevées : `chipseal`, `cement`, `bricks` et `unhewn_cobblestone` sont revêtus à l'affichage mais absents de `PAVED_SURFACES` ; `grass_paver` est revêtu pour le calcul mais classé « Herbe » à l'affichage ; `soil`, `rocks`, `rocky` et `unpaved_minor` sont non revêtus à l'affichage mais absents de `UNPAVED_SURFACES`. Une piste en `surface=chipseal` reste donc une piste pour BRouter alors que la barre l'affiche « Asphalte ».
- Proposition : une table unique des valeurs `surface` (revêtu ou non, catégorie d'affichage), d'où l'on tire les deux.
- Risque : cela change le calcul des itinéraires. Ce ne sont pas les coûts, mais il faut l'accord de l'utilisateur (F2). Taille : petit. Confiance : haute.

**A12. Petites copies hors cartes**
- Lecture d'un Blob en image : mapTiles.ts:39-46 (`loadImage`) et drawShareImage.ts:35-43 (`blobImage`).
- `escapeXml` : recording/gpxWriter.ts:28 (échappe aussi `"`) et library/sessionBundle.ts:23 (n'échappe pas `"`).
- En-tête GPX : routeGpx.ts:40-41 et gpxWriter.ts:81-82.
- Légendes : SpeedGradientLegend.tsx et GradeGradientLegend.tsx reprennent le même gabarit.
- Conversion en `[lat, lon]` : 11 occurrences dans 8 fichiers ; seule PlanningPage.tsx:159-168 la met en cache.
- Taille : petit. Confiance : haute.

## B. Optimisations

**B1. Trace colorée : une couche Leaflet par paire de points, sans simplification**
- Où : TrackSegmentsLayer.tsx:46 crée un `L.polyline` par trait, soit 54 000 couches pour 3 h à 5 Hz (11 000 à 1 Hz). Le moteur canevas les reparcourt toutes à chaque déplacement ou zoom de la carte, et chacune garde ses points projetés et ses limites.
- Mesuré (brouillon, `bench-plan.mjs`) : fusionner les traits consécutifs de même couleur ne fait passer que de 54 000 à 42 400 tracés (202 couleurs distinctes), ce qui ne suffit pas.
- Deux voies possibles :
  - (a) une couche canevas maison (`L.Layer`) qui dessine tous les traits en une passe, regroupés par couleur, comme `drawShareImage` : couleurs inchangées ;
  - (b) arrondir le dégradé à environ 64 teintes puis fusionner. C'est moins de travail, mais cela touche à la décision « dégradé continu » (F1).
- Gain attendu : on passe de 54 000 couches à une seule ; mémoire et fluidité au doigt sur téléphone.
- Mesure : banc `zoom-carte.mjs`, avec `Performance.getMetrics` (ScriptDuration, TaskDuration) autour de dix zooms et déplacements, et le nombre de `map._layers`, avant et après.
- Taille : gros. Confiance : moyenne à haute.

**B2. Vignettes de bibliothèque : une vraie carte Leaflet par ligne, jamais démontée**
- Où : SessionLibrary.tsx:232-241. L'observateur passe `near` à vrai et ne le remet jamais à faux. Chaque ligne garde ensuite son `MapContainer` (SessionLibrary.tsx:290-306), avec couche de tuiles, canevas et écouteurs. Après défilement de 150 sessions, il y a 150 cartes vivantes.
- Proposition : une image fixe, dessinée une fois sur un canevas (projection de `core/shareImage.ts`, tuiles par `loadMapTile`, comme l'image de partage) et mise en cache avec la trace ; à défaut, démonter les vignettes sorties de l'écran. Au passage, réduire la trace par `simplifyLatLon` (forme fidèle à nombre de points égal) plutôt qu'à pas d'indice régulier (SessionLibrary.tsx:260).
- Gain : mémoire et défilement sur téléphone.
- Mesure : banc `library.mjs` ; `Memory.getDOMCounters` et `Performance.getMetrics` (JSHeapUsedSize) après défilement complet.
- Taille : moyen à gros. Confiance : moyenne.

**B3. Survol du profil en planification : toute la page se redessine**
- Où : le survol passe par un état local, PlanningPage.tsx:388 (`setHoveredIndex`) et 927 (`HoverMarker`). Chaque mouvement de la souris ou du doigt sur le profil redessine la page (1 323 lignes, carte et toutes ses couches comprises). Les analyses, elles, passent par le magasin `useChartHover` et `HoveredTrackMarker` (HoverMarker.tsx:23-27), qui ne redessine que le repère.
- Proposition : le même magasin en planification.
- Gain : des centaines de rendus de page en moins par geste.
- Mesure : React Profiler, ou un compteur de rendus dans une copie de `survol.mjs`.
- Taille : petit. Confiance : haute.

**B4. Tuiles : requêtes identiques en double, et jamais annulées**
- Où : mapTiles.ts:98-118 (`resolveTile`). Seules les parentes sont dédoublonnées (53-73). Deux vignettes voisines ou les deux cartes d'une analyse demandent la même tuile en même temps ; chaque tuile vieillie est redemandée à chaque affichage tant que la première réponse n'est pas écrite. De plus, `createTile` (BaseTileLayer.tsx:45-62) n'annule rien quand Leaflet retire une tuile : un zoom rapide laisse partir des requêtes qui durent jusqu'à 8 s (`fetchTimeoutMs`). C'est une charge inutile sur les serveurs d'OSM, dont la politique d'usage demande la sobriété.
- Proposition : une `Map` des promesses en cours par clé (comme `ancestorRequests`), et un `AbortController` par tuile, déclenché sur l'événement `tileunload`.
- Mesure : banc `zoom-carte.mjs` ou `satellite.mjs`, en comptant les `Network.requestWillBeSent` par adresse.
- Taille : petit à moyen. Confiance : moyenne à haute.
- Au passage : mapBase.ts:34 utilise encore les sous-domaines `{s}` (`a.`, `b.`, `c.tile.openstreetmap.org`), qu'OSM déconseille depuis 2023 au profit de `tile.openstreetmap.org` (HTTP/2). Les clés du cache n'en dépendent pas (mapBase.ts:57-62). Confiance : moyenne.

**B5. Contrôle de la place des tuiles dans le navigateur : une lecture de cache par tuile, chaque minute**
- Où : platform/tileCache.ts:153-167. `list()` fait un `cache.match` par entrée, l'une après l'autre. `noteTileSaved` (useTileCache.ts:29-42) l'appelle au plus une fois par minute tant que des tuiles arrivent. Avec le plafond de 500 Mo (des dizaines de milliers de tuiles) sur le Firefox du PC, cela fait plusieurs secondes de travail chaque minute pendant qu'on navigue sur une carte. Le téléphone tient, lui, un index en mémoire (tileCache.ts:47-62).
- Proposition : le même index en mémoire côté navigateur, ou la taille et la date tenues dans une seule entrée.
- Mesure : chronométrer `tileStore.list()` sur un profil Chrome rempli, depuis le banc.
- Taille : moyen. Confiance : moyenne.

**B6. Revêtement d'une session : parcours quadratique, et étiquettes relues à chaque point**
- Où : `tagsAt` reparcourt tous les morceaux pour chaque point, et `classifySurface` relit le texte des étiquettes à chaque point (surface.ts:181-188, 250-259, 137-150).
- Mesuré : 74 ms sur PC pour 54 000 points et 500 morceaux, donc plusieurs centaines de ms sur téléphone, à chaque calcul de `split` (useSessionSurfaces.ts:97-101).
- Proposition : un curseur, puisque les points sont dans l'ordre, et une catégorie calculée une fois par indice d'étiquette.
- Taille : petit. Confiance : haute.

**B7. Image de partage : un `stroke()` par trait**
- Où : drawShareImage.ts:130-139 trace et peint chaque trait séparément (54 000 sur une longue trace), et l'image est redessinée à chaque case cochée.
- Proposition : regrouper les traits par couleur en un seul chemin.
- Taille : petit. Confiance : haute.

**B8. Temps estimé à vélo : une dichotomie de 40 pas par ligne de profil**
- Où : duration.ts:128-170, avec une ligne de profil tous les 10 m.
- Mesuré : 21 ms pour 100 km sur PC. C'est payé une fois par fiche dans `RouteList` (RouteList.tsx:46-50, cache routeList.ts:72-78) et à chaque modification en planification.
- Proposition : retenir la vitesse par pente arrondie au dixième de pour cent.
- Gain : faible. Taille : petit. Confiance : haute sur la mesure.

**B9. Code de planification dans le paquet chargé au démarrage**
- Où : Home.tsx:23 importe `planning/routeList` ; avec `useRouteLibrary`, cela tire route.ts (964 l.), duration, cycling/energy, running/runningAnalytics, loopReturn, surface et brouterProfile dans le paquet du démarrage. Les pages sont pourtant bien chargées à la demande (App.tsx:36-51), et Recharts et Leaflet sont mis à part (vite.config.ts).
- Proposition : sortir `shownRoutes` et `routeActivity` dans un petit module sans dépendance.
- Gain : faible, à mesurer par un build vers un dossier de brouillon (`--outDir`) si l'on s'y autorise, ou avec `rollup-plugin-visualizer`.
- Confiance : basse sur l'ampleur du gain.

**B10. Styles de surbrillance recréés à chaque rendu**
- Où : SurfaceHighlight.tsx:18-23 ; les `<Polyline>` de surbrillance des trois modules ; `PositionMarker` (LiveMap.tsx:108-109), à chaque position GPS. react-leaflet rappelle `setStyle` dès que l'objet change. Va avec A7.
- Taille : petit. Confiance : haute.

## C. Architecture

**C1. Fichiers rangés au mauvais endroit (« Où ajouter quoi »)**
- `planning/` porte des services qui servent à l'analyse des sessions, pas à la planification : overpass.ts, wayMatch.ts et ignAltimetry.ts (pour useSessionSurfaces et useTerrainElevation) ; surface.ts, importé par cycling/energy.ts, library/record.ts et LandModule ; fetchJson.ts, qui est générique.
- `cumulativeDistances` (route.ts:859) est importée par recording/followedTrace.ts.
- Proposition : un dossier `src/geo/`, avec les clients réseau (brouter, overpass, ign, photon, fetchJson), l'appariement des voies et le revêtement ; les distances dans `core/`. Taille : moyen (déplacements et imports seulement).

**C2. Des modules non visuels dans `components/`**
- `mapTiles.ts` mêle réseau et stockage, et importe un hook (`noteTileSaved`, de useTileCache.ts:37-42, qui est une règle d'éviction et non un hook).
- `sessionTrack.ts` est du calcul pur mais dépend de `hooks/useSportSettings`, et n'a pas de test.
- `drawShareImage.ts` est dans le même cas.
- Proposition : `platform/mapTiles.ts`, une règle d'éviction dans `core/tiles.ts` et le déclenchement dans `platform/`, `library/sessionTrack.ts` avec ses tests. Taille : petit à moyen.

**C3. route.ts (964 lignes) mêle six sujets**
- Modes et libellés d'interface (`WAY_TYPE_LABEL`, `WAY_TYPE_HINT`, route.ts:30-43), édition, boucle (route.ts:400-560), import d'une trace (634-680), distances et D+ (859-930), profil (937-964). PlanningPage.tsx fait 1 323 lignes.
- Proposition : `routeModes`, `routeEdit`, `routeLoop`, `routeImport` et `routeMetrics` ; les libellés vers l'interface. Taille : gros, mais mécanique et bien couvert par route.test.ts (723 lignes).

**C4. Règle 3 appliquée à moitié en planification**
- Ces constantes sont passées en paramètre avec une valeur par défaut, mais elles ne viennent ni de `SPORT_PROFILES` ni d'un réglage : `LOOP_RETURN_DEFAULTS` (loopReturn.ts:44-52), `WAY_MATCH_DEFAULTS` (wayMatch.ts:31), `DEFAULT_MAX_SNAP_M` (route.ts:803), `DEFAULT_IMPORT_SMOOTHING_M` (100 m, fixé par la décision §7), `PROFILE_STEP_M`, et `SHARED_STEP_M` (loopReturn.ts:214, qui n'est même pas un paramètre).
- `minGainM` est figé sur le préréglage « route » (PlanningPage.tsx:333, RouteList.tsx:49). C'est cohérent avec le retrait du choix du terrain le 21/10 (sportProfiles.ts:50-53), mais le commentaire de `routeTotals` (route.ts:893-898) parle encore du « terrain de l'activité ». Il faut corriger le commentaire. Question F4.

**C5. Décisions transverses non suivies dans FollowTracePicker**
- FollowTracePicker.tsx:151-159 filtre les activités par un `<select>` natif. Or CLAUDE.md demande que les activités soient proposées « dans une liste dessinée par l'application, jamais le menu natif d'Android ».
- Le choix Itinéraires / Sessions (FollowTracePicker.tsx:111-118) est fait de boutons `ui-tab` et non du `SegmentedControl` demandé pour un « choix parmi quelques options ».
- Des valeurs sont en dur (`10px 12px`, `12px`) dans les styles en ligne.
- Confiance : haute pour le `<select>`, moyenne pour les onglets. Taille : petit.

**C6. Nom trompeur**
- `core/patternTiles.ts` dessine les fonds de page, pas des tuiles de carte, ce qui prête à confusion avec `core/tiles.ts`. Proposition : le renommer `core/backdropPattern.ts`. Taille : petit.

**C7. Configuration**
- tsconfig.app.json ne déclare pas `strict`. TypeScript 7 l'active par défaut (vérifié par une sonde : `implicit any` et `null` refusés sans configuration). Il faut l'écrire en clair, puisque CLAUDE.md s'appuie dessus.
- Options à envisager : `noImplicitOverride` (CachedTileLayer redéfinit `createTile`, BaseTileLayer.tsx:45) et, plus lourde, `noUncheckedIndexedAccess`, qui toucherait de très nombreux accès `points[i]`.
- vite.config.ts : `chunkSizeWarningLimit: 700` fait taire l'avertissement de taille (choix motivé) ; le découpage des pages et des paquets Recharts et Leaflet est en place.
- .oxlintrc.json : `react/exhaustive-deps` est déjà actif en avertissement par défaut (vérifié par une sonde dans le brouillon) et ne relève aujourd'hui aucun cas dans `components/`, `pages/` et `hooks/`. On pourrait le passer en erreur.
- Règle 11 : respectée partout. Règle 12 : respectée dans la zone (seul `navigator.onLine`, dans mapTiles.ts:13, que la règle ne vise pas).

## D. Bugs probables

**D1. Overpass et IGN sans délai : la recherche peut rester bloquée jusqu'à la relance de l'application**
- Où : `fetchWays` (overpass.ts:112-116) et `fetchIgnElevations` (ignAltimetry.ts:88-93) appellent `fetchJson` sans `timeoutMs`, alors que BRouter (60 s) et Photon (20 s) en ont un.
- Scénario : au téléphone, le réseau tombe au milieu d'une réponse d'Overpass ou de l'IGN et la connexion reste ouverte. La promesse ne se termine jamais. Comme elle est gardée dans `searching` (useSessionSurfaces.ts:26-49, useTerrainElevation.ts:24-57), rouvrir l'onglet reprend la même promesse. L'onglet « surface » reste sur la recherche et l'altitude sur « searching », sans bouton « Réessayer » (qui n'apparaît qu'après une erreur), jusqu'à la relance de l'application.
- Correction : `timeoutMs` à environ 120 s pour Overpass (le serveur annonce 90 s) et 30 s par paquet IGN.
- Confiance : moyenne. Ce point peut aller à l'essai au téléphone (mode avion pendant la recherche).

**D2. Banc : réseau non coupé dans quatre scripts, adresse par défaut inutilisable dans treize**
- Réseau : chrono.mjs:54, imports.mjs:80, materiel.mjs:87 et notes.mjs:85 appellent `Network.setBlockedURLs` sans `Network.enable`. Rien n'est donc bloqué ; c'est le défaut que LISEZMOI signale pour charge.mjs seul. Leurs relevés dépendent alors de l'IGN, d'Overpass et des tuiles, et une « preuve de neutralité » par ces scripts peut varier d'un passage à l'autre.
- Adresse : 13 scripts prennent `http://127.0.0.1:4190` par défaut, port que LISEZMOI dit refusé par Chrome et Node. Les autres valeurs par défaut : 43 scripts sur 5173, 5 sur 4199, 1 sur 4191.
- Confiance : haute (constat fait dans le code, appuyé sur ce que dit LISEZMOI).

**D3. Écart de couleur possible entre une vignette et son analyse**
- Voir A2. Si l'ordre de `sessionSpeedRange` s'écarte de celui d'un module (par exemple pour une activité voile avec des bornes préréglées), la vignette et l'image de partage prises en fin d'enregistrement n'ont pas les couleurs de l'analyse. Aucun test ne le garde.
- Confiance : basse à moyenne, à vérifier par un test.

**D4. Envoi du profil BRouter en double**
- Où : brouter.ts:211-214.
- Scénario : quand plusieurs tronçons reçoivent « profil absent » en même temps (le serveur a effacé le profil pendant un calcul de boucle), chacun remet `profileUpload` à nul et renvoie le profil. Le profil part deux ou trois fois et l'identifiant retenu est le dernier. Sans conséquence visible ; un léger excès de requêtes.
- Confiance : moyenne.

**D5. Recherche de lieux en concurrence**
- Où : PlanningPage.tsx:602-619. `onSearch` n'a pas d'`AbortController` et ne vérifie pas que la réponse correspond à la dernière demande. Deux recherches lancées l'une après l'autre (si le formulaire peut être renvoyé pendant `searching`) : la réponse lente de la première peut écraser la seconde.
- Confiance : basse (dépend de l'état du bouton pendant la recherche).

**D6. Balises `<span>` vides dans le conteneur de la carte**
- Où : JumpMapLayer.tsx:33 et TrackSpanLayer.tsx:31. `MapContainer` rend ses enfants dans son `div` : chaque surbrillance y ajoute une `<span>` vide à côté des volets de Leaflet. Sans effet aujourd'hui, mais fragile face au CSS de `.leaflet-container`. Un `Fragment` avec clé suffit.
- Confiance : haute sur le constat, impact faible.

**D7. Fond satellite au large : attente longue**
- Où : `overzoomedTile` (mapTiles.ts:76-95) remonte jusqu'à 6 zooms, l'un après l'autre. Chaque parente absente du cache est demandée au serveur, avec un délai de 8 s. Sur un réseau lent au large, une case peut attendre 48 s, et les cases s'accumulent.
- Confiance : basse ; c'est surtout un cas d'usage à éprouver en mer.

## E. Code mort et dépendances inutilisées

Tout ce qui suit a été vérifié par recherche dans `src/`, `outils/`, la configuration et `index.html`.

- **Code mort** : `isRouteMode` (route.ts:130) n'est appelé que par route.test.ts ; dans le code, c'est `readRouteMode` qui sert. On peut le retirer, ou le garder comme garde-fou de type sous un commentaire.
- **Exportés sans usage extérieur ni test** (le `export` est superflu, ce n'est pas du code mort) :
  - BROUTER_URL ; PAVED_SURFACES, UNPAVED_SURFACES, ROLLING_PATH_SURFACES, WAY_TYPE_BIT, VELO_BIT, PROFILE_PENALTY, WayCosts ;
  - FetchJsonMessages ; PHOTON_URL, PHOTON_TIMEOUT_MS ; IGN_ALTI_URL, IGN_MAX_POINTS ; OVERPASS_URL, OVERPASS_MAX_COORDS ;
  - BIKE_WAY_TYPES, LegStatus, LoopReturn, CourseLeg, PROFILE_STEP_M ; ROUTE_FORMAT ; SURFACE_TAG_KEYS, SURFACE_MARK_MAX_SHARE, RouteSurfaces ; WayMatchOptions ; LegOutcome, ReturnOutcome ;
  - AncestorTile, MapBaseSource, SegmentProjection, ColoredSegment, StoredTile, TileStore, TilePath, BackdropTile, reliefOf.
  - Priorité basse : ils documentent l'interface du module.
- Beaucoup d'autres ne sont exportés que pour les tests (parseBrouterGeojson, overpassQuery, ignRequestBody…). C'est voulu.
- **Dépendances** : les 14 dépendances et dépendances de développement servent toutes.
  - `@capacitor/android` sert à Gradle, sans import, ce qui est normal ; `@types/node` sert à tsconfig.node ; `@xmldom/xmldom` sert aux tests seuls, et c'est bien une dépendance de développement.
  - Pas de bibliothèque en double : une seule pour les cartes, les graphes et la navigation.
  - Aucun `import * as`, ni bibliothèque utilitaire entière.
  - Les outils d'icônes (`outils/icones/vectoriser.cjs`, `outils/logo/icones-android.mjs`) demandent jimp, potrace et sharp, installés à part dans un brouillon : c'est documenté dans leur en-tête.
- **Couverture** : aucun test pour mapTiles.ts, platform/tileCache.ts, sessionTrack.ts ni speedGradient.ts (ce dernier n'est éprouvé qu'indirectement). `sessionSpeedRange` et `gradientColor` méritent un test : ce sont des fonctions pures qui portent une décision.

## F. Questions à poser à l'utilisateur

1. **Trace colorée (B1)** : pour alléger la carte sur une longue session, acceptez-vous un dégradé en une soixantaine de teintes, à l'œil sans différence, au lieu d'un dégradé exactement continu ? Sinon, on écrit une couche de dessin maison, plus longue à faire. Réponse par défaut : couche maison, couleurs inchangées.
2. **Revêtement (A11)** : la carte de calcul des itinéraires et la barre du revêtement ne rangent pas toutes les surfaces de la même façon (une piste en « chipseal » est une piste pour le calcul et de l'« Asphalte » à l'affichage). On aligne les deux listes ? Cela change un peu le calcul, mais aucun de vos coûts. Réponse par défaut : on aligne l'affichage sur le calcul, sans toucher au calcul.
3. **Liseré satellite (A8)** : il fait 7, 8 ou 9 px selon l'écran (direct, analyse, planification). C'est voulu ? Réponse par défaut : une seule épaisseur, celle de l'analyse.
4. **Réglages de planification (C4)** : couloir du retour de boucle, distance maximale d'accrochage à un chemin (500 m), recherche des voies (25 m)… Faut-il pouvoir les régler par activité, ou est-ce qu'ils restent fixes ? Réponse par défaut : fixes, rangés avec les autres réglages de calcul.
5. **Suivre une trace (C5)** : le filtre d'activité ouvre le menu d'Android. On le remplace par la liste de l'application ? Réponse par défaut : oui.

## G. Chiffres

- **Fichiers lus** :
  - en entier : 47 (les 15 sources de `planning/`, 21 composants de carte, 8 modules de `core/` et `platform/`, 5 hooks, la configuration) ;
  - en partie : 14 (PlanningPage, LandModule, SailingModule, SurfModule, SessionLibrary, SavedSessionShare, drawShareImage, TopsPanel, Home, App, `outils/banc/` : cdp, bench, general, charge-ts, LISEZMOI ; android/app/build.gradle, AndroidManifest).
- **Lignes lues** : environ 7 500 (planning 3 200, composants 1 700, core et platform 900, hooks 660, extraits de pages 500, configuration et outils 550).
- **Constats par section** : A = 12, B = 10, C = 7, D = 7, E = 1 code mort + 37 exports superflus + 0 dépendance inutile, F = 5 questions.
- **Mesures** (brouillon, `bench-plan.mjs`, PC) :
  - profil de 100 km : 15 ms ; temps à vélo : 21 ms ;
  - revêtement de 54 000 points sur 500 morceaux : 74 ms ;
  - 53 999 traits colorés construits en 33 ms, réductibles seulement à 42 396 tracés en fusionnant les couleurs égales.
