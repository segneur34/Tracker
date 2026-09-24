# État du projet Tracker

Document de passation, écrit le 21 septembre 2026 à partir d'une lecture complète du code et tenu à jour depuis ; dernière passe le 24 septembre 2026 (§10, point 43). Complète `CLAUDE.md`, qui donne les règles ; ici, le pipeline, les chantiers et la cible mobile (§12). L'historique des décisions (§10) vit dans `docs/HISTORIQUE.md`.

## 1. Résumé

Application web client-only qui lit une trace GPX et en tire des analyses. Les seuils de l'analyse voile s'accordent à l'allure de la session, ce qui la rend exploitable d'un bateau lent à un kite rapide, et lisible sur les traces enregistrées en cadence économique. Module voile abouti : carte colorée par la vitesse, statistiques globales, tops de vitesse, détection et qualité des virements et empannages, estimation du vent et de ses variations, VMG, notes de session. Module course opérationnel mais plus jeune : carte, graphes vitesse et altitude, zones de pente, dénivelé. Page Paramètres commune. Page Enregistrer : enregistrement GPS sur le téléphone Android (Capacitor), un GPX par session, analysé par les mêmes modules (§12). Les onglets Voile et Course sont la bibliothèque des sessions ; ce qu'on change sur une session (vent saisi, seuil d'activité, notes) reste en brouillon jusqu'à « Enregistrer la session ». Sa mémoire est un dossier portable (§6), désigné une fois sur le téléphone comme sur le PC : les GPX, une fiche JSON par session (résumé, support, notes) et les réglages, qu'on copie pour sauvegarder ou changer d'appareil. Interface dans la DA de la maquette (variables dans `src/theme/tokens.css`), barre d'onglets en bas sur téléphone, barre en haut sur ordinateur.

État des contrôles au moment de la passation : typecheck, lint, 270 tests et build production passent.

## 2. Environnement et outillage

- `package.json` : `dev` (vite), `build` (`tsc -b && vite build`), `lint` (oxlint), `test` (`vitest run`), `test:watch`, `preview`.
- Dépendances : react et react-dom 19, react-router-dom 7, recharts 3, leaflet 1.9 et react-leaflet 5 ; Capacitor 8 (`@capacitor/core`, `android`, `app`, `filesystem`, `preferences`) et `@capgo/background-geolocation` 8.4 ; `@fontsource/figtree` (police embarquée, pour marcher hors ligne). Dev : typescript 6.0, vite 8.3, vitest 5, oxlint 1.8, @vitejs/plugin-react 6, @capacitor/cli 8.5.
- Version unique dans `package.json` (0.2.0) : Vite l'expose en `__APP_VERSION__` (`vite.config.ts`, déclarée dans `src/env.d.ts`), Gradle en tire `versionName` et `versionCode` (majeur×10000 + mineur×100 + correctif, 200 pour 0.2.0). À augmenter avant chaque APK diffusé.
- Android : `capacitor.config.ts` (vérifié par `tsconfig.node.json`), `android/` versionné (Gradle 8.14.3, AGP 8.13, compileSdk et targetSdk 36, minSdk 24). Compiler avec un **JDK 21** (Temurin, `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`) : le Java 25 d'Android Studio 2026.1 ne fait pas tourner Gradle 8.14.3. SDK dans `%LOCALAPPDATA%\Android\Sdk`. Chaîne : `npm run build`, `npx cap sync android`, puis `npx cap run android` (voir §12).
- Signature : clé dédiée `C:\Users\segne\tracker-signing\tracker-release.jks`, **hors du dépôt**, sauvegardée par l'utilisateur ; `android/keystore.properties` (ignoré par git, copie dans le même dossier) en donne le chemin et le mot de passe. Debug et release sont signés par cette clé, pour qu'une version s'installe par-dessus l'autre. Sans le fichier, Gradle retombe sur la clé de debug du PC.
- `tsconfig.app.json` : `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`. `strict` n'est pas écrit mais TypeScript 6 l'active par défaut. Conséquence pratique : un import inutilisé ou un paramètre inutilisé casse le build.
- `.oxlintrc.json` : plugins react, typescript, oxc ; règles `react/rules-of-hooks` (erreur) et `react/only-export-components` (avertissement). Pas de règle sur `any`.
- Vitest sans fichier de configuration : environnement node, pas de jsdom. Les tests importent `describe`, `it`, `expect` depuis `vitest`. Tout ce qui touche au DOM (parseur GPX, hooks, composants) n'est donc pas testé.
- Git depuis le 23 septembre 2026 (Git pour Windows 2.55), branche `main` qui suit `origin/main`, dépôt privé `https://github.com/segneur34/Tracker.git`, identifiants mémorisés. Réglages locaux : auteur Tom Briere, `core.autocrlf=false` (sources en LF, trois fichiers en CRLF, rien n'est converti). `.github/` vide. `dist/`, sortie de `npm run build`, est ignoré.
- Terminal de l'utilisateur : `cmd` sous Windows 11.

## 3. Architecture

Quatre couches, de bas en haut, plus une couche d'accès à la plateforme.

**Noyau `src/core/`.** Sans notion de sport, en unités SI. Types, conversions, profils de support, parseur GPX, kinématique, filtres, allure et cadence d'une session (`sessionSpeed.ts`), cumuls, masque d'activité, dénivelé, meilleurs segments.

**Extensions par sport.** `src/sailing/` travaille en nœuds sur `PointData` (adaptateur `src/utils/kinematics.ts`) : estimation du vent, manœuvres, VMG, stats, notes. `src/running/` travaille en m/s sur `TrackPoint` : pente, zones, allures. Le dégradé de couleur de la trace est commun aux deux (`core/speedGradient.ts`).

**Hooks `src/hooks/`.** `useGpxSession` (ingestion générique), `useSailingSession` (orchestration voile complète), `useSportSettings` et `useAllSportSettings` (réglages persistés), `useRunnerProfile`, `useOpenSections`, tous sur `useStoredRecord` (enregistrement persistant générique) ; `useSessionDraft` (brouillon d'une session, écrit dans sa fiche par « Enregistrer la session ») et `leaveGuard` (avertissement en quittant avec un brouillon).

**Plateforme `src/platform/`.** Seule couche autorisée à toucher au stockage, aux fichiers et à la position (règle 12 de `CLAUDE.md`, §12) : `storage.ts`, `files.ts`, `memoryFolder.ts`, `location.ts`, plus `runtime.ts` et `backButton.ts`. Chaque module a une version navigateur et une version téléphone, choisies par `isNativeApp()` ; les hooks et les pages ne voient pas la différence.

**Enregistrement.** `src/recording/` (logique pure, testée en node : arrondi et filtre des positions, journal, écriture GPX) et `hooks/useRecorder.ts`, un enregistreur qui vit hors des composants pour survivre aux changements de page. La page `/enregistrer` le pilote ; à l'arrêt, la session entre dans la bibliothèque, et « Analyser » l'ouvre dans le module de sa famille.

**Bibliothèque.** `src/library/` (logique pure, testée : fiche, résumé, rapprochement du dossier et du cache, nommage, fichier de réglages) et `hooks/useSessionLibrary.ts`, un store hors des composants comme l'enregistreur. Les pages `/voile` et `/course` (`SessionLibrary`) listent les sessions ; les modules d'analyse sont en `/voile/analyse` et `/course/analyse`, la session à ouvrir dans l'URL (`?session=<fichier>`, `hooks/useLibraryNavigation.ts`), chargée par `loadGpxContent`.

**Pages et composants.** `Home`, `SessionLibrary`, `SailingModule`, `RunningModule`, `RecordingPage`, `SettingsPage`, routes dans `App.tsx`, toutes imbriquées dans `AppShell` (navigation et bandeau d'enregistrement). Composants partagés : `AppShell`, `MemoryStatus`, `SectionTabs`, `ResizablePanel`, `MapAutoResize`, `SpeedGradientLegend`, `icons.tsx`, les composants d'interface de `components/ui` (`Button`, `Card`, `PageHeader`, styles dans `ui.css`), plus deux modules sans JSX : `chartHover.ts` (survol d'un graphe vers la carte) et `styles.ts` (`CARD_STYLE`).

**DA.** Toutes les valeurs visuelles vivent dans `src/theme/tokens.css` (couleurs, police, rayons, espacements, hauteurs de barres) : c'est le seul fichier à changer pour une autre DA. `theme/base.css` pose la police Figtree, le fond et le focus. Les pages d'analyse gardent leurs styles en ligne, mais leurs gris, traits et accents lisent les variables ; les couleurs de données (podiums, réussite et échec, graphes, carte) restent en dur : Recharts et Leaflet les posent en attributs SVG, où une variable CSS ne passe pas de façon sûre.

Graphe de dépendances résumé : `core/*` ne dépend que de `core/*`. `sailing/*` dépend de `core/*` et du type `PointData` de `utils/kinematics`. `running/*` dépend de `core/*`. `platform/*` ne dépend que de Capacitor et de ses plugins. `recording/*` dépend de `core/*` et du type `LocationFix` de `platform/location`. `library/*` dépend de `core/*`, de `sailing/sailingConfig` et `sailing/sessionNotes`, de `recording/session` et du type `FolderEntry` de `platform/memoryFolder`. Les hooks dépendent de `core`, `sailing`, `recording`, `library`, `utils/kinematics` et `platform` ; `ResizablePanel` dépend de `platform`. Les pages dépendent des hooks, de `core`, `sailing`, `running` et des composants. Aucun alias de chemin : tous les imports sont relatifs.

## 4. Pipeline de données

### 4.1 Ingestion, commune aux deux modules

1. `loadGpxContent` (`useGpxSession`) reçoit le texte du GPX, lu dans la mémoire ou, faute de mémoire, dans le fichier choisi (`readPickedFile`), et appelle `parseGpx` (`core/gpxParser.ts`) : `DOMParser`, un `RawTrackPoint` par `trkpt` avec `lat`, `lon`, `time` (obligatoire), `ele`, `speed`, `hr`, `cad`, recherche par nom local pour tolérer les préfixes d'extension (`gpxtpx`, `gpxdata`, `ns3`). Le nom de la trace vient de `trk/name`, son type d'activité de `trk/type` (pour deviner le support d'un GPX importé). Une vitesse appareil hors [0, 100] est ignorée.
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
4. `currentWindValue` : vent saisi de la session si présent, sinon estimation fiable, sinon `null`. Le vent saisi et le seuil d'activité propre à la session viennent du module (`useSailingSession({ windDeg, activeThresholdKn })`), qui les tient en brouillon puis les garde dans la fiche (§6.1). Seuil effectif : celui de la session, sinon la surcharge du support, sinon la suggestion accordée à l'allure.
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

Dans `docs/INVENTAIRE.md` : signatures de `core/`, `sailing/`, `running/`, `recording/`, hooks, composants, pages et `platform/`. Le lire avant d'appeler une fonction qu'on ne connaît pas.

## 6. Persistance

### 6.1 Le dossier mémoire

Décidé le 24 septembre 2026 (§10, point 42) : la mémoire de l'application est un dossier ordinaire, qu'on copie pour sauvegarder, migrer après une réinstallation ou passer du téléphone au PC.

```
Tracker/
  tracker.json      marqueur { format: "tracker-memoire", version: 1 }
  reglages.json     réglages qui voyagent, datés
  LISEZMOI.txt      mode d'emploi, pour qui ouvre le dossier à la main
  sessions/
    2026-09-23_14-05-12_wingfoil.gpx    la trace, jamais réécrite
    2026-09-23_14-05-12_wingfoil.json   sa fiche
```

- **Le GPX fait foi.** La fiche (`library/record.ts`) en garde le support, un résumé en SI pour afficher la liste sans relire les traces (`summarizeSession`, qui reprend le pipeline du module), le nombre de manœuvres de la dernière analyse, les notes et les réglages d'analyse de la session (`analysis { windDeg; activeThreshold; savedAt }` : vent saisi, seuil d'activité propre à la session, `null` pour la valeur par défaut). Tout se recalcule depuis le GPX, sauf ces saisies. Une fiche dont `calcVersion` est dépassé est recalculée, saisies intactes. Le résumé est calculé avec le seuil de la session s'il y en a un ; changer de support efface ce seuil, exprimé pour l'ancien support.
- **Enregistrement explicite** (§10, point 43) : dans le module voile, vent saisi, seuil et notes restent en brouillon (`useSessionDraft`), signalés par une barre « Non enregistré » ; « Enregistrer la session » les écrit dans la fiche, « Annuler » revient à l'état enregistré. Quitter avec un brouillon demande confirmation (`hooks/leaveGuard.ts`) : liens internes, touche retour d'Android, fermeture de l'onglet ; le retour arrière du navigateur n'est pas intercepté, mais le brouillon est retrouvé en revenant. Le support, lui, s'écrit tout de suite.
- **Compatibilité** : les champs inconnus d'une fiche sont conservés à la réécriture ; une fiche d'une version future est lue, jamais réécrite ; une fiche illisible n'est jamais écrasée.
- **Identité** : l'instant du premier point. Réimporter une trace ne la duplique pas ; deux fichiers de la même trace (fusion de dossiers) n'en font qu'une dans la liste.
- **Pas d'index dans le dossier** : fusionner deux dossiers revient à copier leurs fichiers. Un GPX déposé à la main dans `sessions/` reçoit sa fiche au lancement suivant ; un GPX posé à la racine est rangé dans `sessions/`. Le cache des fiches vit hors du dossier (`tracker.libraryCache`).
- **Réglages** : `reglages.json` recopie `tracker.sportSettings` et `tracker.runnerProfile` deux secondes après chaque changement. À l'ouverture d'un dossier, le plus récent l'emporte, celui du dossier ou celui de l'appareil (`tracker.settingsSavedAt`) ; le dernier support choisi dans un module ne compte pas comme un changement. Des réglages repris après le démarrage rechargent la page, sauf pendant un enregistrement.
- **Emplacement** (`platform/memoryFolder.ts`) : dans le navigateur, la mémoire privée du navigateur (OPFS) par défaut, ou un vrai dossier choisi (Chrome et Edge, `showDirectoryPicker`, poignée gardée dans IndexedDB, autorisation à redonner d'un clic si le navigateur ne l'a pas gardée). Choisir un dossier y recopie les sessions de la mémoire du navigateur. Sur le téléphone, `Documents/Tracker` désigné une fois par le sélecteur d'Android (SAF, plugin maison `MemoryFolder`, `android/…/MemoryFolderPlugin.java`), adresse gardée sous `tracker.memoryFolder` ; si Android a retiré l'accès, il faut désigner le dossier à nouveau. Même garde sur les deux plateformes quand on désigne le dossier parent : on descend dans `Tracker` (`shouldDescendIntoMemory`). Sur le PC, « Voir ou changer le dossier » ouvre la fenêtre de choix sur le dossier en service, seul moyen d'en voir le chemin complet. Tant qu'aucun dossier n'est accessible, une session enregistrée attend dans le dossier privé `en-attente/`, rangée dès qu'un dossier l'est.
- **Import** : des GPX, ou les sessions d'un autre dossier Tracker, « Ajouter les sessions d'un dossier » (chaque fiche accompagne son GPX, notes et réglages compris) : `webkitdirectory` dans le navigateur, sélecteur d'Android sur le téléphone (`pickFolderToImport`, accès non gardé). On peut aussi copier les fichiers dans `sessions/` : ils entrent au lancement suivant. Les notes saisies avant le dossier (`tracker.sailingNotes`) sont reprises à la création de la fiche de la même trace.

### 6.2 Les clés de l'appareil

Lues et écrites par `jsonStore` (`platform/storage.ts`) : `localStorage` dans le navigateur, Preferences natives sur le téléphone (chargées en mémoire au démarrage par `initStorage`). Les clés et le format JSON d'avant ce module sont relus tels quels (§10, point 37).

| Clé | Fichier | Forme |
|---|---|---|
| `tracker.sportSettings` | `hooks/useSportSettings.ts` | `StoredSettings { sport?; thresholds?; terrains?; speedUnits?; textScales?; speedRanges?; referenceSpeeds? }`, chaque champ indexé par support ; objet unique réécrit en entier à chaque changement. `speedRanges` sert aux deux modules, en m/s ; `referenceSpeeds` est l'allure imposée, en m/s, absente quand elle est déduite. Recopié dans `reglages.json` |
| `tracker.runnerProfile` | `hooks/useRunnerProfile.ts` | `Record<'me', RunnerProfile>`. Recopié dans `reglages.json` |
| `tracker.memoryFolder` | `platform/memoryFolder.ts` | téléphone seulement : `{ uri; base; label }`, dossier désigné par le sélecteur d'Android (`base` = `Tracker` si l'on a désigné son parent) |
| `tracker.settingsSavedAt` | `hooks/useSessionLibrary.ts` | instant du dernier changement de ces deux clés, en ms |
| `tracker.libraryCache` | `hooks/useSessionLibrary.ts` | `{ folder; entries: Record<nom de fiche, { size; mtimeMs; record }> }` : copie des fiches, reconstruite à volonté |
| `tracker.sections` | `hooks/useOpenSections.ts` | `Record<moduleId, Record<section, boolean>>` ; identifiants `running`, `sailing` et `sailing-carte` (colonne à droite de la carte, voile) |
| `tracker.panelSizes` | `components/ResizablePanel.tsx` | `Record<panelId, { width?; height? }>` |
| `tracker.sailingNotes` | ancienne clé | `Record<sessionKey, notes>` d'avant le dossier mémoire : plus écrite, lue seulement pour reprendre les notes d'une trace importée |

La disposition (`sections`, `panelSizes`) reste propre à chaque appareil. Hors de ces clés et du dossier mémoire : le journal de l'enregistrement en cours (`recording-journal.jsonl`, dossier privé de l'application, effacé une fois la session rangée) et, dans le navigateur, la poignée du dossier choisi (IndexedDB `tracker-memoire`).

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

Autres réglages : filtres (`speedFilter.ts`, accélération max 10 m/s², aberration max 3 s, médiane 3 s, amorce 10 s) ; allure de session (`sessionSpeed.ts` : neuvième décile, échantillon plafonné à 10 s, accélération 0,8 × allure avec plancher de 2 m/s², plafond 3 × allure) ; seuils de manœuvre et seuils suggérés accordés à la session (voir `sailingConfig.ts` dans `docs/INVENTAIRE.md`, §2) ; détection d'unité (10 échantillons, vitesse dérivée ≥ 1 m/s) ; dénivelé (route 20 s et 3 m, trail 30 s et 5 m, couverture minimale 50 %) ; manœuvres (`sailingConfig.ts` et `maneuvers.ts` : virage 60°, fenêtre 12 s, temps mort 10 s, entrée 4 nœuds, tolérance de classification 60°, caps stabilisés 4 à 20 s à moins de 3°/s pendant 5 s, relance 90 % dans 60 s) ; vent (`wind.ts` : cône ±35°, près [40°, 85°], pénalité ×4, candidats séparés de 45°, contraste minimal 0,15, cohérence 0,6, sortie stable 5 s à moins de 45° par pas, vol perdu sous 5 nœuds, confiance minimale 0,4, trou d'interpolation 30 min, deux itérations, poids polaire minimal 0,3, poids manœuvres 2, plein poids à 4 manœuvres ; `sailingAnalytics.ts` : poids de symétrie entre 0,2 et 1, nul au-delà de 90° d'écart, `MIN_SYMMETRY_WEIGHT` et `SYMMETRY_SPAN_DEG`) ; VMG (10 s) ; course (pente sur ±25 m, plat sous 3 %, raide dès 10 %) ; couleur de trace (course 4 à 15 km/h, voile 8 à 28 nœuds, réglables par support) ; affichage (500 points par graphe, lissage 10 s pour le graphe et 15 s pour la carte en course, texte 0,85 / 1 / 1,25).

## 8. Tests

270 tests dans 21 fichiers, `npx vitest run`, tous sur des fonctions pures avec des traces synthétiques ou un stockage simulé.

- `core/speedFilter.test.ts` (24) : médiane, écrêtage (pic, aller-retour de deux points, aberration au démarrage, plafond, non-verrouillage à 5 Hz), filtres médian, linéaire, moyenne.
- `core/kinematics.test.ts` (22) : Haversine, cap, m/s, Doppler prioritaire, `forceDerivedSpeed`, saut de 500 m écrêté, détection km/h, m/s, nœuds, invariance 1 Hz / 5 Hz.
- `core/elevation.test.ts` (16) : bruit sous seuil, montée continue, bosses, route contre trail, NaN, couverture, montée intacte aux bords.
- `core/topSegments.test.ts` (20) : tops temps et distance, interpolation, invariance de fréquence, non-chevauchement, cumul par intégration, trigger de Schmitt.
- `sailing/wind.test.ts` (20) : statistiques circulaires, interpolation des directions (entre mesures, aux bords, trou maximal), score de l'angle mort, estimation polaire sur polaire réaliste, virages et chutes, `describeWindCandidate` (direction imposée, séparation du vent et de son jumeau, normalisation).
- `core/sessionSpeed.test.ts` (13) : neuvième décile insensible à un pic isolé, invariance 1 Hz / 5 Hz de l'allure, coupure d'enregistrement qui ne doit pas peser plus que la session, cadence médiane, seuils de filtrage resserrés sur une session lente et jamais ouverts au-delà du support.
- `sailing/maneuvers.test.ts` (49) : détection, classification et métriques ; 1 Hz contre 5 Hz ; estimation du vent sur quatre protocoles synthétiques (rider asymétrique, session sans largue, courant traversier, bascule de 60°) ; chute ; réglages du support et neutralité des défauts ; `selectWindCandidate` ; `calculateWindStats` (pondération par symétrie, repli sans vent de référence) ; enregistrement économique (virage dans un pas de 22 s, coupure de 60 s écartée) ; seuils accordés à la session.
- `running/runningAnalytics.test.ts` (13) : zones, pente sur 50 m robuste au bruit, allures par zone, dégradé (fonctions de `core/speedGradient.ts`, testées ici avec les bornes course).
- `sailing/sailingConfig.test.ts` (9) : `suggestActiveThresholdKn` (régime rapide par support, exception bateau, borne à 12 nds, allure nulle) ; `suggestSpeedRangeMs` (borne basse alignée sur le seuil suggéré, borne haute au pic 2 s plus marge, repli sur trace vide ou trop courte).
- `platform/storage.test.ts` (8) : clé absente, aller-retour, JSON identique à l'ancien accès direct (compatibilité des données déjà enregistrées), JSON illisible, stockage qui refuse de lire ou d'écrire, erreur levée dès l'accès au stockage, abonnement aux écritures, stockage en miroir (forme native). Sur un stockage simulé par une `Map`, en node.
- `platform/location.test.ts` (3) : rejeu (chaque position à son heure divisée par le facteur, arrêt, rattrapage d'une minuterie en retard).
- `recording/session.test.ts` (11) : filtre des redélivrances, arrondi, conversion des points lus, statistiques en direct (plus long trou, durée), cadence d'écriture du journal, nommage.
- `recording/journal.test.ts` (6) : aller-retour, dernière ligne tronquée, en-tête illisible, lignes illisibles, et même GPX après un arrêt brutal qu'après un arrêt normal.
- `recording/gpxWriter.test.ts` (4) : GPX 1.1, extensions vitesse, cap, altitude et précision, échappement, trace vide.
- `library/summary.test.ts` (8) : distance intégrée, bornes et cadence, temps en mouvement en course et en voile (seuil accordé à l'allure), seuil imposé, invariance 1 Hz / 5 Hz, D+ ou `null`, trace sans support, trace trop courte.
- `library/record.test.ts` (14) : aller-retour, champs inconnus conservés, fiches illisibles, support inconnu et notes partielles, version future lue sans réécriture, résumé périmé, nom de fiche, notes d'avant le dossier retrouvées par l'instant, doublons, réglages d'analyse (aller-retour, fiche d'avant, vent ramené dans [0, 360), valeurs mal formées).
- `library/sessionEdits.test.ts` (8) : état enregistré (fiche, matériel proposé, défauts), parties changées, écriture des seules parties changées, champs inconnus gardés.
- `platform/memoryFolder.test.ts` (6) : descente dans `Tracker` quand on désigne son parent, fichiers repris d'un dossier importé.
- `library/reconcile.test.ts` (4) : fiche reprise du cache ou relue, GPX sans fiche, fiche orpheline et sous-dossiers, GPX à la racine.
- `library/naming.test.ts` (6) : nom libre pour le GPX et sa fiche, casse ignorée, support deviné ou `null`.
- `library/settingsFile.test.ts` (6) : aller-retour, fichiers illisibles, clés d'une version future gardées, le plus récent l'emporte.

Générateurs réutilisables dans les tests : `buildEastwardTrack` (kinematics), `buildTrack` (plusieurs variantes selon le fichier), `realisticPolar` (wind), et dans `maneuvers.test.ts` `buildLegSession` avec `upwindDownwindLegs`, `downwindLegs` (portant pur, que des empannages), courant optionnel, `polar` optionnelle (`slowPolar`, la polaire du wingfoil divisée par 2,5, pour simuler un support lent) et `integratePosition`.

**`integratePosition` mérite un mot** : par défaut les générateurs font avancer la position le long d'une ligne arbitraire, indépendante des caps imposés. C'est sans conséquence tant qu'un calcul ne lit que les caps et les vitesses, mais toute analyse qui touche aux positions — distance d'une manœuvre, tracé, et toute mesure géométrique du virage — doit être testée avec cette option active, faute de quoi elle mesure une trajectoire qui n'a rien à voir avec la session simulée.

Non testé : `gpxParser` (DOM), `useRecorder`, `useSessionLibrary`, `useSessionDraft`, `leaveGuard`, les accès de `memoryFolder` et le plugin Java (vérifiés au banc Chrome, `bench/session-save.mjs` pour le brouillon, et sur le téléphone, §12), `buildBaseSessionStats`, `buildSailingSessionStats`, `calculateVmgStats`, `buildWindTimeline`, tous les hooks, composants et pages.

## 9. Dette et code mort

Nettoyage du 21 septembre 2026 (§10, point 15) : plus de fichier mort, plus d'export inutilisé, plus de `any` dans `src/`, duplications résorbées. Ce qui reste :

- **Sens de rotation d'un virage vu en un seul pas** : quand l'enregistreur s'est tu pendant la manœuvre, on connaît le cap avant et le cap après, mais pas le chemin suivi entre les deux. `angleDiff` retient l'arc court, et un virement pris en passant par le lit du vent est alors nommé empannage. La géométrie seule ne peut pas trancher ; il faudra un critère physique, ou l'aveu que le fichier ne le dit pas. Voir §11.
- Le module voile lit son unité dans les réglages mais affiche toujours en nœuds : choisir km/h pour le bateau est enregistré sans effet.
- `Payload.payload` de Recharts est typé `any` par la librairie : les `formatter` d'infobulle relisent la ligne de données en l'annotant du type attendu (`ChartRow`, `WindGraphPoint`). C'est une confiance accordée à Recharts, pas une vérification.
- Les tests ne couvrent toujours ni le parseur GPX, ni les hooks, ni les pages (§8).
- Le résumé d'une session est calculé à son entrée dans la mémoire, avec les seuils de ce moment : changer le seuil d'un support ou un terrain ne recalcule pas les résumés de la liste (seuls un changement de support, du seuil propre à la session, ou d'`SUMMARY_CALC_VERSION` le font).
- Brouillon de session : le retour arrière du navigateur n'est pas intercepté (le brouillon attend le retour sur la session) ; le support se change hors brouillon ; l'allure imposée et les bornes de couleur restent réglées par support, pas par session. La liste affiche les distances en km, même en voile, jusqu'au lot 2.

## 10. Historique des décisions et pièges rencontrés

Déplacé dans `docs/HISTORIQUE.md` le 23 septembre 2026, numérotation inchangée : les renvois « §10, point N » du code et de ce document y mènent. Le consulter sur le sujet qu'on touche, avant de retenter ce qui a déjà été essayé.

## 11. Chantiers en attente

Exprimés par l'utilisateur ou découverts pendant le travail.

- Coût énergétique en course, à partir du poids et des caractéristiques du coureur déjà saisies dans Paramètres. Rien n'est calculé aujourd'hui.
- Zones d'effort cardiaque : `hr` est lu du GPX et FC max et repos sont saisies, aucun calcul ne les utilise.
- Cibles de tops pour la course (`topTargets: []` dans le profil running), splits kilométriques, allure par kilomètre.
- Affichage du module voile dans l'unité choisie (km/h, m/s), aujourd'hui toujours en nœuds.
- Notes de session pour la course (matériel, conditions, appréciation), sur le modèle du brouillon de la voile (`useSessionDraft`).
- Validation des seuils par support sur des sessions réelles de planche, kite, bateau et course.
- Application Android via Capacitor et enregistrement GPS natif : feuille de route au §12.
- Coût du recalcul du vent sur trace 5 Hz (§10 point 23) : environ 0,5 s à chaque mouvement du seuil d'activité sur 3 h à 5 Hz, contre 28 ms à 1 Hz. Mitigation identifiée et non faite, parce qu'elle demande un vrai refactor : `analyzeManeuvers` refait toute la détection des virages pour chaque candidat de vent, alors que seule la classification dépend du vent. Détecter une fois puis classer par candidat diviserait le coût par quatre environ.
- **Nommer un virage vu en un seul pas** (§9, §10 point 27). Sur une trace d'enregistreur économique, le cap avant et le cap après sont connus, mais pas le chemin entre les deux : `angleDiff` retient l'arc court, et un virement pris en passant par le lit du vent ressort en empannage. Pistes évoquées et non tranchées : la perte de vitesse (inopérante ici, la session est lente de bout en bout), le déplacement latéral par rapport à l'axe du vent (calculable, mais ténu sur quelques mètres), ou assumer que le fichier ne le dit pas et l'afficher comme tel. C'est le premier geste de la prochaine session sur ce sujet, et il demandera le souvenir de l'utilisateur pour être validé.
- Estimation du vent sur trace lente et peu échantillonnée : la polaire annonce une confiance élevée sur une direction fausse de 180° (§10 point 27). L'utilisateur corrige par « Inverser » et s'en satisfait pour l'instant ; la confiance affichée mériterait d'être rabattue quand la couverture polaire est maigre.
- Valider les seuils d'un enregistrement dense sur une session de planche rapide : toute la calibration récente s'est faite sur une trace lente et une trace wingfoil, sans cas intermédiaire.

## 12. Cible mobile (Capacitor)

Décidé le 23 septembre 2026 : proposition de Gemini, analysée et retenue. Téléphone de l'utilisateur : POCO 2412DPC0AG (Xiaomi), Android 16, HyperOS 3.0 ; il faut « Installer via USB » en plus du débogage USB. La coquille Capacitor y est installée et vérifiée (phase 1, premier lot).

**Pourquoi Capacitor.** L'application est 100 % client : Capacitor emballe `dist/` dans une WebView Android, avec React, Leaflet et Recharts tels quels. Le code qui touche au navigateur tient en trois endroits (`platform/storage.ts`, `FileReader` dans `useGpxSession`, `DOMParser`, qui fonctionne en WebView) ; `core/`, `sailing/` et `running/` ne bougent pas. Écartés : PWA (géolocalisation coupée écran éteint), React Native (ni DOM, ni Leaflet, ni Recharts : réécriture des pages), natif (réécriture complète), Tauri mobile (géolocalisation en arrière-plan trop pauvre). iOS est hors de portée depuis Windows (Mac et compte Apple requis).

**Ce qui coûtera : l'interface, pas Capacitor.** Carte à 60 % avec une colonne à droite, graphes à largeur fixe (500 et 350 px), survol souris (graphe → carte, définitions en `title`), poignée `resize` de 20 px (absente sur iOS), et un `Polyline` par segment, soit 10 800 pour 3 h à 1 Hz. Premier remède pour la carte : `preferCanvas`. Regrouper les segments par couleur toucherait à la décision « pas de paliers » : à redemander.

**Risque à lever en premier.** Un enregistrement de 2 à 3 h écran éteint : Android le permet par un service de premier plan, mais certains constructeurs tuent quand même les applications. À vérifier sur une vraie session avant tout travail d'interface ; la cadence médiane et le nombre de points affichés par le module voile servent d'instrument de mesure. **Premier contrôle réussi le 23 septembre 2026** (§10, point 40) : 13 min 27 s écran éteint à pied, 1 Hz, plus long trou 4 s. Reste la session de 2 h.

**Réglages du téléphone, à faire avant le premier enregistrement.** Sur HyperOS : Démarrage automatique activé et batterie « Aucune restriction » pour Tracker. Tant qu'ils ne sont pas faits, le système coupe les positions dès que l'application passe en arrière-plan (trou de 93 s au contrôle 1b, pendant qu'on les réglait).

**Plugin GPS** (état de septembre 2026). `@capgo/background-geolocation` : MPL-2.0, Capacitor 8, `distanceFilter` et `minIntervalMs` réglables, renvoie vitesse, cap, précision, altitude et heure. Poser `android.useLegacyBridge: true`, sans quoi les positions s'arrêtent après 5 min en arrière-plan. `@capacitor-community/background-geolocation` s'arrête à Capacitor 7. Repli si des points se perdent : Capawesome, payant, qui garde les positions dans une file SQLite native.

**Principe : enregistrer brut, analyser ensuite.** L'enregistreur ne filtre rien, ni distance, ni pause automatique, ni lissage : 1 Hz, vitesse fournie par le système (Doppler sur la plupart des puces), précision. L'intelligence reste dans le pipeline existant. Les paramètres iront dans `SportProfile.recording` (règle 3), identiques pour tous au départ (1 s, 0 m). Le 1 Hz tient aussi le coût du recalcul du vent (§10, point 23).

**Format pivot : un GPX par session.** Un journal écrit par paquets pendant l'enregistrement, qui résiste à un arrêt brutal, puis un GPX complet à l'arrêt, avec `<speed>` en m/s en extension, que `parseGpx` lit déjà par nom local. Ouvrir une session enregistrée revient à appeler `loadGpxContent` : l'ingestion ne change pas, et les fichiers s'exportent vers d'autres applications. Nommage : `AAAA-MM-JJ_hh-mm-ss_<support>.gpx`. Depuis le lot 3, la session entre dans le dossier mémoire (`sessions/`, §6), sur le téléphone comme sur le PC ; faute de dossier accessible, elle attend dans un dossier privé. Les gestionnaires de fichiers ne le montrent probablement pas dans leur catégorie « Documents » (types connus seulement) : il faut passer par Stockage interne → Documents → Tracker, ou par le câble USB. Un bouton de partage réglera cela (phase 3).

**Architecture.** Faite (§3, inventaire au §8 et §9 de `docs/INVENTAIRE.md`). `storage.ts` : Preferences natives chargées en mémoire au démarrage, parce que le système peut vider le `localStorage` d'une WebView. `location.ts` : plugin en natif, `watchPosition` dans le navigateur, source « rejeu » qui relit un GPX en accéléré pour éprouver tout l'enregistrement sur le PC. `files.ts` : journal privé via `@capacitor/filesystem`. `memoryFolder.ts` : le dossier mémoire (§6). `backButton.ts` : la touche retour met l'application en arrière-plan pendant un enregistrement au lieu de la fermer. `src/recording/` : logique pure. `android/`, généré par Capacitor, est versionné.

**Boucle de développement.** Inchangée : `npm run dev` et le navigateur du PC ; mise en page mobile au mode appareil de Chrome. Vers le téléphone, sans Wi-Fi commun, par câble USB : `npm run build`, `npx cap sync android`, `npx cap run android` (compile et installe, 2 min 20 à froid). Dans le shell de Claude, qui définit `NoDefaultCurrentDirectoryInExePath=1`, la CLI ne trouve pas `gradlew` : y passer par `android\gradlew.bat assembleRelease` (APK signé, celui des testeurs ; `assembleDebug` reste possible, signé par la même clé, pour inspecter la WebView), avec `JAVA_HOME` sur le JDK 21 et `ANDROID_HOME` sur `%LOCALAPPDATA%\Android\Sdk`, puis `adb install -r android/app/build/outputs/apk/release/app-release.apk` et `adb shell am start -n io.github.segneur.tracker/.MainActivity`. Capture de l'écran du téléphone : `adb exec-out screencap -p`. `--live-reload --host localhost --port 5173 --forwardPorts 5173:5173` chargerait l'application depuis le serveur du PC (pas encore essayé). `chrome://inspect` montre la console ; Claude peut aussi piloter la WebView de debug par `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` et le protocole DevTools. En option, un APK compilé par GitHub Actions : il faudrait y confier la clé de signature (secrets du dépôt).

**Signature et diffusion.** L'APK se diffuse par un lien (Drive, WeTransfer) ; Android n'installe qu'un APK signé, et une mise à jour doit porter la même clé, sinon il faut désinstaller, ce qui efface les données de l'application. D'où une clé dédiée, créée le 23 septembre 2026 avant que la bibliothèque ne remplisse le téléphone (§2, §10 point 41). Après une désinstallation, HyperOS remet aussi à zéro les autorisations et les réglages de batterie de l'application : les refaire avant d'enregistrer. Une application réinstallée ne peut plus relire les GPX qu'elle avait écrits dans `Documents` (stockage restreint) : ils restent réimportables par le sélecteur de fichier.

**Feuille de route.**
- Phase 0, **faite le 23 septembre 2026** et validée par l'utilisateur (§10, points 36 et 37) : git et GitHub, `CLAUDE.md` allégé, historique sorti dans `docs/HISTORIQUE.md`, `src/platform/storage.ts`.
- Phase 1 : coquille Capacitor 8 (§10, point 38) et enregistrement minimal (§10, points 39 et 40), **faits le 23 septembre 2026** : stockage natif, page `/enregistrer`, plugin, journal, écriture GPX, rejeu, reprise d'un enregistrement interrompu, contrôle de 10 min écran éteint.
- Maquette cliquable de l'accueil et de la navigation, **validée le 23 septembre 2026** « pour le moment » (https://claude.ai/artifact/9enXeWAqdyhkqS95RRA4JR, privée). Retours intégrés : enregistrement en deux temps (famille, puis activité) ; en direct, allure, D+ et D+ sur 5 min en course, bords en voile ; graphe d'activités Semaine · 30 jours · 6 mois · Année avec numéros de semaine ISO, totaux sur le même sélecteur. Le test de 2 h écran éteint est reporté par l'utilisateur.
- Plan en six lots approuvé le 23 septembre 2026, un commit et une validation chacun : 1) clé de signature, DA, navigation, **fait** (§10, point 41) ; 2) réglages d'affichage par famille (voile, course : unité de vitesse, de distance, taille du texte) choisis dans Réglages seulement et actifs partout, module voile enfin dans l'unité choisie ; 3) bibliothèque des sessions, `/voile` et `/course` deviennent les bibliothèques, les modules passent en `/voile/analyse` et `/course/analyse` ; **redéfini le 24 septembre 2026 autour d'un dossier mémoire portable (§6), et passé avant le lot 2**, en deux temps : 3a dans le navigateur, **fait** et validé sur PC (§10, point 42) ; 3b sur le téléphone (sélecteur de dossier d'Android, plugin Java maison, APK 0.2.0), **fait** et validé le 24 septembre 2026 avec l'enregistrement explicite des sessions (§10, point 43) ; prochaine étape, le lot 2 ; 4) accueil (graphe d'activités, totaux, dernières sessions) ; 5) enregistrement : famille puis activité, statistiques en direct (le cap moyen du bord remplace l'amure, le vent étant inconnu pendant l'enregistrement) ; 6) APK pour les testeurs (icône, fiche d'installation). Diffusion : APK d'abord, lien web ensuite. Pages d'analyse adaptées au téléphone ensuite (étape 5).
- Phase 2 : interface mobile (disposition empilée en écran étroit, décisions de disposition sur ordinateur inchangées ; toucher au lieu du survol ; `preferCanvas` ; `accept=".gpx"`, qui grise parfois les GPX sous Android) .
- Phase 3 : partage et export GPX, réception d'un GPX partagé depuis Komoot, cartes hors ligne (pas de réseau en mer), capteur cardiaque Bluetooth.
- `BrowserRouter` fonctionne dans la WebView, chargement direct de chaque route compris : pas besoin de `HashRouter`.
