# État du projet Tracker

Document de passation, tenu à jour à chaque lot validé ; dernière passe le 26 septembre 2026 (§10, point 65). Il complète `CLAUDE.md`, qui donne les règles et les décisions de l'utilisateur, sans les répéter. On y trouve l'architecture, le pipeline, la persistance, les tests, la dette, les chantiers et la cible mobile, dont **l'avancement n'est tenu qu'au §12**. L'historique des décisions (§10) est dans `docs/HISTORIQUE.md`, la carte des fichiers (§5) dans `docs/INVENTAIRE.md`. Les numéros de section ne changent pas : le code y renvoie.

Pour que ce document reste léger :
- les seuils, fenêtres et formules se lisent dans le code, où ils sont nommés et commentés ;
- l'Avancement ne tient que les phases et le reste à faire ; le détail de chaque lot est dans HISTORIQUE.

## 1. Résumé

Tracker est une application web 100 % client qui lit une trace GPX et en tire des analyses. Capacitor l'emballe pour Android, où elle enregistre aussi les sessions : un GPX par session, analysé par les mêmes modules.

- **Voile, abouti** : carte colorée par la vitesse, statistiques, tops, virements et empannages et leur qualité, vent et ses variations, VMG, notes. Les seuils s'accordent à l'allure de la session, d'un bateau lent à un kite rapide, et tiennent sur les traces en cadence économique.
- **Course, plus jeune** : carte, graphes de vitesse et d'altitude (zoom), zones de pente, dénivelé, allures, énergie dépensée (point 71).
- **Vélo, depuis le 01/10** (point 72) : le module d'analyse de la course (`LandModule`), plus les tops et une énergie par modèle physique.
- **Fractionné, depuis le 08/10** (point 89) : une famille de deux calculs, à pied et à vélo, analysés comme la course et le vélo, plus un onglet « fractionné » (répétitions du compteur, ou retrouvées dans la vitesse) ; le compteur d'intervalles est dans Enregistrer.
- **Autour** : accueil et graphe d'activités, bibliothèque des sessions par famille (`/voile`, `/course`, `/velo`, `/fractionne`), enregistrement avec trace à suivre (`/enregistrer`), planification d'itinéraires (`/itineraires`) et leur liste (`/itineraires/liste`, point 68), cartes hors ligne (point 67), Réglages (`/parametres`), mémoire en dossier portable (§6).

## 2. Environnement et outillage

Ce que les fichiers de configuration ne disent pas :

- **TypeScript 6** active `strict` par défaut, même si `tsconfig.app.json` ne l'écrit pas. Avec `noUnusedLocals` et `noUnusedParameters`, un import ou un paramètre inutile casse le build.
- **Vitest** tourne sans configuration, en environnement node, sans jsdom : rien de ce qui touche au DOM n'est testé (§8).
- **oxlint** n'a pas de règle sur `any`. L'absence de `any` dans `src/` est une discipline, pas une contrainte de l'outil.
- **Git** :
  - `main` suit `origin/main` (`segneur34/Tracker`, dépôt privé), identifiants mémorisés ;
  - auteur Tom Briere, `core.autocrlf=false` ;
  - fins de ligne fixées par `.gitattributes` (§10, point 45) ;
  - pas de `.github/` ; `dist/` est ignoré.
- **Terminal** de l'utilisateur : `cmd` sous Windows 11.
- **Android** (JDK, SDK, signature) : voir le §12.

## 3. Architecture

Les couches, de bas en haut. Tous les imports sont relatifs, sans alias de chemin.

- **Noyau `core/`** : sans notion de sport, en unités SI, du parseur GPX aux profils de support, en passant par la cinématique, les filtres, l'allure de la session, les cumuls, le masque d'activité, le dénivelé et les tops.
- **Famille et traitement** (`core/sportProfiles.ts`, point 89) : la famille d'un calcul range ses sessions (bibliothèque, accueil, barre, listes d'activités, Réglages : `sportFamily`) ; son traitement dit comment elles se calculent et s'affichent (unités, énergie, vélo, altitude du terrain, revêtement, chiffres du direct : `sportTreatment`). Les deux se confondent, sauf pour le fractionné, rangé à part et traité comme la course ou le vélo.
- **Sports** : `sailing/` en nœuds sur `PointData` (adaptateur `utils/kinematics.ts`, règle 5), `running/` et `cycling/` en SI.
- **Logique pure de l'application**, testée en node : `recording/` (positions, journal, GPX, direct, trace suivie), `library/` (fiche, résumé, rapprochement, réglages qui voyagent) et `planning/` (itinéraires).
- **Plateforme `platform/`** : seul accès au stockage, aux fichiers, à la position, au son et au vibreur (règle 12). `isNativeApp()` choisit la version navigateur ou téléphone de chaque module ; les hooks et les pages ne voient pas la différence. Exception : `compass`, la boussole, n'existe que dans le navigateur.
- **Hooks** :
  - le pipeline : `useGpxSession`, `useSailingSession` (§4) ;
  - trois stores hors des composants, qui survivent aux changements de page : l'enregistreur (`useRecorder`), la bibliothèque (`useSessionLibrary`) et le compteur du fractionné (`useIntervalTimer`, qui confie à l'enregistreur la séance courant pendant un enregistrement) ;
  - le brouillon d'une session : `useSessionDraft`, `leaveGuard` ;
  - les réglages : `useSportSettings` lit `jsonStore` directement, les autres enregistrements de l'appareil passent par `useStoredRecord` ;
  - les autres sont dans `docs/INVENTAIRE.md`.
- **Pages** : sept, routées dans `App.tsx`, toutes dans `AppShell` (navigation, bandeau d'enregistrement, bouton rond). La session analysée est dans l'URL (`/voile/analyse?session=<fichier>`) et se charge par `loadGpxContent`. Le patron des analyses est dans `docs/MISE_EN_PAGE.md`.
- **DA** : toutes les valeurs visuelles sont dans `theme/tokens.css`, seul fichier à changer pour une autre DA. `theme/base.css` pose la police, le fond et le focus. Les couleurs de données restent en dur : Recharts et Leaflet les posent en attributs SVG, où une variable CSS ne passe pas de façon sûre.

Dépendances entre dossiers :

| Dossier | Dépend de |
|---|---|
| `core` | `core` seulement |
| `sailing` | `core`, `types/sailing`, le type `PointData` |
| `running` | `core`, `recording/intervalTimer` (séance déduite des répétitions détectées) |
| `cycling` | `core`, `running/runningAnalytics` (zones de pente) |
| `platform` | Capacitor et ses plugins seulement |
| `recording` | `core`, `sailing` (`liveLegs`), `planning` (`followedTrace`), le type `LocationFix` de `platform/location` |
| `planning` | `core`, `running/runningAnalytics` (pente), `cycling/energy` (temps estimé), `recording/gpxWriter`, `recording/markGuide` (bips d'un parcours), `platform/storage` (id du profil BRouter) |
| `library` | `core`, `sailing/sailingConfig`, `sailing/sessionNotes`, `recording/session`, le type `FolderEntry` de `platform/memoryFolder` |
| hooks | toutes les couches ci-dessus |
| composants | `platform`, pour `ResizablePanel`, `LiveMap` et `MemoryStatus` |
| pages | tout |

`planning` et `recording` dépendent l'un de l'autre, mais aucun fichier n'entre dans un cycle.

## 4. Pipeline de données

Ordre et orchestration seulement. Les seuils, fenêtres et formules sont nommés et commentés dans les fichiers cités.

### 4.1 Ingestion, commune aux modules (`useGpxSession`)

1. `loadGpxContent` reçoit le texte du GPX, lu dans la mémoire ou dans un fichier choisi (`readPickedFile`). `parseGpx` (`core/gpxParser.ts`) en tire :
   - les points bruts ;
   - le nom (`trk/name`) ;
   - le type d'activité (`trk/type`), qui sert à deviner le support d'un import.
2. `core/sessionSpeed.ts` calcule l'allure de la session (`referenceSpeedMs`, neuvième décile des vitesses brutes, pondéré par la durée) et la cadence (`samplingIntervalS`).
   - Le module voile en tire ses seuils de filtrage (`sessionFilterThresholds`, option `scaleFiltersToSession`). L'accélération plausible vaut max(2 ; 0,8 × allure) par seconde ; le plafond de vitesse est resserré, jamais au-dessus de celui du profil.
   - Sans allure (en course, ou sur une trace trop courte) : 10 m/s² et le plafond du profil.
   - L'allure peut être imposée pour une session, ce qui recalcule toute la chaîne (§10, point 46).
3. `computeKinematics` (`core/kinematics.ts`), dans l'ordre :
   - vitesse dérivée des positions ;
   - vitesse de l'appareil, convertie après détection de son unité ;
   - écrêtage (`clampByAcceleration`, `core/speedFilter.ts`) ;
   - médiane temporelle, qui donne `smoothedSpeedMs`, la vitesse de toutes les analyses.
4. Puis, dans `core/sessionStats.ts` et `core/elevation.ts` :
   - `buildCumulativeTrack` ;
   - `computeActivityMask`, un trigger de Schmitt autour du seuil d'activité ;
   - `computeElevationStats` ;
   - `buildBaseSessionStats`.

### 4.2 Voile (`useSailingSession`)

1. `trackToPointData` : la vue en nœuds.
2. Le seuil d'activité effectif est celui de la session, sinon la surcharge de l'activité, sinon la suggestion accordée à l'allure (`suggestActiveThresholdKn`) ; jamais le défaut fixe du profil (§10, point 29). Les seuils de manœuvre s'accordent à l'allure par `sessionManeuverThresholds`.
3. `buildSailingSessionStats` : la base, plus les tops de la voile (`core/topSegments.ts`).
4. `estimateWind` (`sailing/maneuvers.ts`, polaire dans `sailing/wind.ts`) donne l'estimation globale : la polaire, puis les manœuvres à caps stabilisés (`windSamplesFrom`).
   - Confiance = max(polaire ; manœuvres × 0,9).
   - L'estimation est fiable à partir de 0,4 (`WIND_CONFIDENCE_MIN`). En dessous, l'interface exige une saisie, et suspend manœuvres, VMG et polaire.
5. Vent retenu : celui saisi pour la session, sinon l'estimation fiable, sinon `null`.
6. `analyzeManeuvers` tourne en deux passes, dans le hook :
   - d'abord avec le vent global ;
   - puis avec le vent local (`buildWindTimeline`), interpolé entre les manœuvres à caps stabilisés de la première passe.

   Les virages écartés sont comptés par motif (`ManeuverRejections`), sans jamais poser de temps mort. Détection et classement ne changent pas ; chaque virage classé est ensuite mesuré à part par `measureManeuver` (point 70) :
   - la rotation est bornée sur le cap déroulé, entre le cap d'approche et le cap de sortie ;
   - la vitesse d'approche est la médiane de 12 s à 2 s avant la rotation ; le creux se cherche de son début jusqu'à 10 s après sa fin ; conservation, réussite et relance en découlent ;
   - le gain au vent d'une manœuvre réussie est le chemin de la seule rotation, projeté sur le vent retenu : vers le vent au virement, sous le vent à l'empannage.

   L'estimation du vent (`windSamplesFrom`, `maneuverAgreement`) lit encore la conservation et la réussite de la détection (`windCriteria`), et non celles de la mesure. `summarizeManeuvers` en tire le tableau : un podium par métrique et par type, sauf le changement de cap des empannages ; égalités départagées par la conservation ; manœuvres sans relance comptées à part.
7. `calculateWindStats` (`sailing/sailingAnalytics.ts`) : statistiques et courbe du vent sur toutes les manœuvres classées (règle 7). Elles sont pondérées par la symétrie du virage, jugée contre le vent global (§10, point 24). Elle fournit aussi `windAt(t)` ; les lignes du graphe, sur la plage du zoom, viennent de `windChartRows` (point 94).
8. `calculateVmgStats` : VMG = vitesse × cos(cap − vent local, sinon vent global).
   - Fenêtres de 10 s.
   - Par allure et par bord.
   - Trois tops au près et trois au portant.
9. Graphes :
   - vitesse sous-échantillonnée à `CHART_MAX_POINTS` ;
   - polaire en 36 secteurs relatifs au vent.
10. Sauts (point 91), si la session a ses capteurs (`.imu`) : `useSessionJumps` reprend ceux de la fiche, sinon les calcule à l'ouverture de l'analyse (`measureJumps`, `core/jumps.ts`, en SI sur la trace `track` que rend `useSailingSession`) et les range. La hauteur minimale de l'activité et le seuil d'activité effectif (vitesse au décollage) ne filtrent qu'à l'affichage : les changer ne recalcule rien.

### 4.3 Course, vélo et fractionné (`LandModule`)

Un seul module pour les trois familles, monté trois fois (`/course/analyse`, `/velo/analyse`, `/fractionne/analyse`). Ce qui diffère tient dans `pages/landModules.tsx`, en deux parts : selon la famille, la page (titres, couleur, préfixe des identifiants mémorisés : `running`, `cycling`, `intervals`) ; selon le traitement du calcul de l'activité, le modèle (énergie, revêtement à l'ouverture, libellés ; points 72 et 89).

Pas de hook d'orchestration : la page compose elle-même `useGpxSession`, `useSportSettings(family)`, `useRunnerProfile`, `useOpenSections`, `useSessionDraft`, `useSessionFromUrl` et `useChangeSessionActivity`. Elle calcule ensuite, avec `running/runningAnalytics.ts` (lissages en tête de la page) :
- les allures (`averagePace`) ;
- l'altitude des points : celle du terrain (IGN), rangée dans la fiche, sinon celle du GPS (`useTerrainElevation`, `applyTerrainElevation`, point 84). Tout ce qui suit en dépend ;
- les pentes (`computeGrades`) et les zones (`computeZoneStats`) ;
- les tops, quand le profil en a (le vélo seulement) ;
- l'énergie, par `running/energy.ts` ou `cycling/energy.ts` selon le descripteur, avec le temps et la puissance moyenne en mouvement de chaque zone de pente (point 85) ; à vélo, le roulement suit le revêtement de chaque segment (`useSessionSurfaces`, demandé dès l'ouverture, point 88), le Crr moyen du vélo là où il est inconnu ;
- la trace colorée par la pente, pour « Voir sur la carte » sous le graphe d'altitude (`gradeColorPaths`, point 85), comme en planification ;
- les séries des graphes, sur la plage du zoom (`useChartZoom`, point 73) ;
- l'onglet « fractionné » (point 89), quand la fiche porte des séances du compteur, ou en famille Fractionné. Sans compteur, `detectIntervals` (`running/intervalDetection.ts`) retrouve les efforts : vitesse lue seconde par seconde sur la distance cumulée, seuil d'Otsu recherché parmi les plus rapides, séances découpées par un repos long, au seuil d'effort de la session s'il est imposé. `analyzeIntervals` (`running/intervalStats.ts`) mesure ensuite chaque répétition sur la trace (distance, profil de vitesse, lancé, maintien) et la séance (moyenne, extrêmes, régularité, dérive, profil moyen) ; `components/IntervalAnalysis.tsx` l'affiche.

### 4.4 Couleur de la trace

Dégradé continu `speedGradientColor` (`core/speedGradient.ts`), sur la vitesse de couleur de `core/trackColor.ts` (`trackColorSpeedsMs`, `trackColorSegments`), commune aux modules et à l'aperçu de la liste (point 94) : vitesse lissée du noyau en voile, moyenne de 15 s en plus à pied et à vélo (`TRACK_COLOR_SMOOTHING_S`). La vignette part de la trace d'analyse (`analysisTrack`, `library/summary.ts`, filtres du support et allure de la session), lisse sur la trace entière, puis échantillonne. L'ordre des bornes effectives est dans `CLAUDE.md`. La suggestion vient de `suggestSpeedRangeMs` en voile, mesurée sur la trace entière, dans l'analyse comme dans la vignette. Ailleurs, le défaut du traitement est dans `TREATMENT_SPEED_RANGE_MS` (`hooks/useSportSettings.ts`). La carte se cadre sur l'emprise de la trace (`trackBounds`). La trace colorée, un trait par paire de points, est dessinée sur un canevas à elle par `components/TrackSegmentsLayer.tsx` (analyses et vignettes, point 93), dans un volet sous les autres tracés ; surbrillances, marqueurs et manœuvres restent en SVG. Ses traits ne sont redessinés que si leur tableau change : l'appelant le mémorise.

## 5. Carte des fichiers

Dans `docs/INVENTAIRE.md` : une ligne par fichier, son rôle et ses points d'entrée.

## 6. Persistance

### 6.1 Le dossier mémoire

Le principe est dans `CLAUDE.md` (Décisions, « Mémoire ») ; décidé aux points 42 et 43 du §10.

```
Tracker/
  tracker.json      marqueur { format: "tracker-memoire", version: 1 }
  reglages/         un fichier de réglages par appareil, `<appareil>.json` (point 90) ;
                    avant lui, un seul reglages.json à la racine
  LISEZMOI.txt      mode d'emploi, pour qui ouvre le dossier à la main
  itineraires/      une fiche .json (fait foi) et son .gpx par itinéraire (point 59) ; la fiche
                    d'un parcours de voile peut porter ses bips propres (`markGuide`, point 77),
                    un tronçon calculé ses voies (`surfaces`, point 78) ; version 3 : plusieurs
                    types de voie par tronçon (`sentier+piste`, point 80)
  sessions/
    2026-09-23_14-05-12_wingfoil.gpx    la trace, jamais réécrite
    2026-09-23_14-05-12_wingfoil.json   sa fiche
    2026-09-23_14-05-12_wingfoil.imu    ses capteurs, si les sauts ont été mesurés (point 91)
```

- **Le GPX fait foi.** La fiche (`library/record.ts`) garde :
  - le support (le calcul) et l'activité (`activityId`, `null` pour l'activité de base du calcul) ;
  - un résumé en SI pour la liste (`summarizeSession`, qui reprend le pipeline du module) ;
  - le nombre de manœuvres de la dernière analyse ;
  - le nom donné (`name`) et les notes ;
  - les saisies de la session (`analysis { windDeg; activeThreshold; referenceSpeedMs; speedRange; effortThresholdMs; foil; terrain; savedAt }`, `null` pour le défaut ; `effortThresholdMs` : seuil d'effort du fractionné sans compteur, point 89 ; `foil` : support sur foil de la session, point 91, gardé si l'activité change ; `terrain` : terrain du dénivelé de la session, point 94, qui prime sur celui de l'activité dans l'analyse et le résumé) ;
  - en voile, les sauts mesurés (`jumps`, point 91) : calculés depuis le `.imu` à l'ouverture de l'analyse, écrits hors brouillon, refaits si `JUMPS_CALC_VERSION` a augmenté et que le `.imu` est là ;
  - les séances du compteur faites pendant l'enregistrement (`intervals`, point 89) : la séance, et ses phases (travail, repos) datées par l'horloge du téléphone, bornées au début et à la fin de l'enregistrement ; écrites à l'enregistrement, jamais recalculées ;
  - en course et à vélo, les voies suivies (`surfaces`, point 78) : demandées à OpenStreetMap à la première ouverture de l'onglet « surface », dès l'ouverture de l'analyse à vélo (point 88), écrites hors brouillon, refaites si `WAY_MATCH_VERSION` a augmenté ;
  - en course et à vélo, l'altitude du terrain (`terrainElevation`, point 84) : échantillons de l'IGN, un tous les 5, 10 ou 20 m, repérés par leur instant (`t`, en ms depuis `startMs`) avec leur altitude (`z`, `null` hors couverture). Demandée à l'ouverture de l'analyse, écrite hors brouillon, redemandée si le pas réglé ou `TERRAIN_ELEVATION_VERSION` change ; `elevationSource: 'gps'` quand la session garde l'altitude du GPS. Changer l'un ou l'autre recalcule le résumé.

  Tout le reste se recalcule : une fiche dont `calcVersion` est dépassé est recalculée, saisies intactes. Le résumé suit le seuil de la session. `applyRecordPatch` efface le seuil quand le support change, et les bornes de couleur quand la famille change (point 64).
- **Compatibilité** :
  - les champs inconnus sont conservés à la réécriture ;
  - une fiche d'une version future est lue, jamais réécrite ;
  - une fiche illisible n'est jamais écrasée.
- **Capteurs** (`.imu`, point 91 ; format en tête de `core/imuFile.ts`) : accéléromètre et gyroscope d'un enregistrement dont on a mesuré les sauts, à côté du GPX, écrits une fois. Un enregistrement est élagué à son entrée dans la mémoire (« Analyser », ou sortie de l'attente) : seules restent les fenêtres de ±15 s autour des vols, listées dans l'en-tête (`pruneImuFile`) ; en cas d'échec, la capture complète est rangée. Un `.imu` importé est rangé tel quel. Tout ce qui range, copie, nomme ou efface une session traite aussi son `.imu` : rangement, attente, suppression, import d'un dossier, recopie vers un dossier choisi, nom unique.
- **Identité** : l'instant du premier point. Réimporter une trace ne la duplique pas, et deux fichiers de la même trace n'en font qu'une dans la liste (`dedupeSessions`).
- **Rapprochement** :
  - un GPX déposé dans `sessions/` reçoit sa fiche au lancement suivant, ou à « Mettre à jour » (`refreshLibrary`, point 88), qui relit le dossier sans le refermer : sessions, itinéraires et réglages ;
  - un GPX posé à la racine est rangé dans `sessions/`, avec la fiche posée à côté de lui ;
  - le cache des fiches vit hors du dossier (`tracker.libraryCache`), allégé depuis le point 92 : il ne garde que les champs légers de chaque fiche (`RECORD_LIGHT_FIELDS`, `lightRecord`), sans altitude du terrain, voies ni sauts. Une session tirée de ce cache est `partial` : sa fiche entière est relue sur le disque (`hydrateSession`) avant toute écriture, tout recalcul de résumé, et avant de rendre son GPX à l'analyse (`loadSessionGpx`) ; d'ici là, altitude, revêtement et sauts ne demandent rien au réseau. La fusion (`mergeLightRecord`) prend les saisies de la mémoire et le reste du disque ;
  - une saisie n'est jamais écrasée : le recalcul de fond prend la session courante juste avant d'écrire, et « Mettre à jour » garde la version en mémoire d'une session saisie pendant la relecture (`lastEdit`).
- **Écriture sûre** : sur le téléphone, un fichier existant s'écrit dans `nom.tmp`, puis remplace `nom` (retrait et renommage, `MemoryFolderPlugin.java`) ; si le fournisseur refuse le renommage, il s'écrit en place. Au listage, un `.tmp` orphelin est renommé, un `.tmp` doublé est retiré ; les `.tmp` ne sont jamais rendus. Dans le navigateur, `createWritable` remplace déjà le fichier en une fois.
- **Erreurs** : un fichier importé qui échoue est compté à part (« non rangées ») sans arrêter les autres ; une fiche non écrite fait retirer son GPX tout juste écrit. Réglages du dossier illisibles ou session en attente non rangée sont dits, et la mémoire s'ouvre quand même : seul l'échec de la lecture de `sessions/` la rend indisponible. Le bandeau de la mémoire se montre sur l'accueil dès qu'il y a une erreur.
- **Réglages, un fichier par appareil** (point 90, `library/settingsFile.ts`) : chaque appareil recopie `tracker.sportSettings` et `tracker.runnerProfile` dans `reglages/<son nom>.json` deux secondes après chaque changement, daté par `tracker.settingsSavedAt`, avec son nom et son identifiant (format version 2, `device`).
  - L'appareil reconnaît son fichier à son identifiant (`tracker.deviceId`, tiré au hasard), pas à son nom : un fichier qui porte son nom avec un autre identifiant est celui d'un autre appareil, et il prend alors un nom libre (« Téléphone 2 »), qu'il annonce. Renommer l'appareil (`tracker.deviceName`, « Téléphone » ou « PC » par défaut) renomme son fichier ; un nom déjà pris est refusé.
  - Il n'adopte jamais de lui-même les réglages d'un autre : « Reprendre », dans Réglages › Mémoire, remplace les siens par ceux du fichier choisi, sauf les choix retenus (`adoptedValues`), récrit son fichier et recharge la page. Seul un appareil neuf, sans réglage daté, reprend tout seul le fichier le plus récent, et le dit.
  - Le fichier d'un autre appareil qu'il n'avait jamais vu (`tracker.seenSettingsFiles`, `unseenSettingsEntries`) lui est proposé une fois, au lancement comme à « Mettre à jour » : bandeau « Nouveau fichier de réglages », avec « Reprendre » et « Fermer », en tête des bibliothèques et dans Réglages › Mémoire. La première fois, les fichiers déjà là sont tenus pour vus.
  - « Importer un fichier de réglages » (Réglages › Mémoire) range un fichier choisi à la main dans `reglages/`, sous le nom de son appareil (celui du même appareil est remplacé), le tient pour vu, puis propose de le reprendre. C'est le seul moyen dans la mémoire du navigateur, où l'on ne peut rien déposer : sur le PC de l'utilisateur, Tracker tourne dans Firefox.
  - Passage depuis l'ancien `reglages.json` : tant que l'appareil n'a pas de fichier à lui, la règle d'avant joue une dernière fois (le plus récent l'emporte, `chooseSettings`), puis `reglages.json` est retiré. `LISEZMOI.txt` est récrit s'il diffère.
  - L'empreinte qui repère un changement (`settingsSignature`, `library/settingsFile.ts`) ignore les choix retenus : activité du module, ancienne clé du support, activité proposée à l'enregistrement (point 65), dernière séance lancée au compteur (point 89).
  - Des réglages repris après le démarrage rechargent la page, sauf pendant un enregistrement.
  - La liste des activités d'une version d'avant est mise à jour au démarrage, après la lecture du dossier (`upgradeStoredActivities`) ; en version 4 (point 90), toute couleur qui n'est pas une nuance de sa famille, ou portée deux fois, est remplacée par la première nuance libre. Le fichier de l'appareil est alors récrit à la même date (`settingsUpgraded`) : ce n'est pas un changement de l'utilisateur.
- **Emplacement** (`platform/memoryFolder.ts`) :
  - navigateur : la mémoire privée (OPFS) par défaut, ou un dossier choisi (Chrome, Edge : `showDirectoryPicker`, poignée dans IndexedDB, autorisation à redonner d'un clic), qui reçoit alors une copie des sessions de la mémoire privée. « Voir ou changer le dossier » est le seul moyen d'en voir le chemin ;
  - téléphone : `Documents/Tracker`, désigné par le sélecteur d'Android (SAF, plugin maison `MemoryFolder`), à redésigner si Android a retiré l'accès ou après une réinstallation ;
  - partout : désigner le dossier parent fait descendre dans `Tracker` (`shouldDescendIntoMemory`) ; un sous-dossier `sessions` ou `itineraires` sans marqueur est refusé, et oublié s'il était retenu (`isMemorySubfolder`, point 88) ; sans dossier accessible, une session enregistrée attend dans le dossier privé `en-attente/`.
- **Import** : des GPX, ou les sessions d'un autre dossier Tracker avec leurs fiches (`webkitdirectory` dans le navigateur, `pickFolderToImport` sur le téléphone), depuis les bibliothèques ou Réglages › Mémoire (`ImportButtons`). Une session dont le GPX ne dit pas l'activité est « à classer » ; l'ouvrir la demande d'abord. Les notes saisies avant le dossier (`tracker.sailingNotes`) sont reprises à la création de la fiche de la même trace.

### 6.2 Les clés de l'appareil

`jsonStore` (`platform/storage.ts`) les lit et les écrit : `localStorage` dans le navigateur, Preferences natives sur le téléphone, chargées en mémoire au démarrage (`initStorage`). Les clés et le format d'avant ce module sont relus tels quels (point 37). Une valeur refusée (stockage plein ou bloqué) est gardée en mémoire et relue jusqu'à la fermeture ; le refus est signalé (`subscribeFailure`) et dit une fois dans le bandeau de la mémoire (point 92).

| Clé | Fichier | Forme |
|---|---|---|
| `tracker.sportSettings` | `hooks/useSportSettings.ts` | `StoredSettings`, réécrit en entier à chaque changement (voir sous le tableau). Voyage dans le fichier de l'appareil (`reglages/`) |
| `tracker.runnerProfile` | `hooks/useRunnerProfile.ts` | `Record<'me', RunnerProfile>`. Voyage dans le fichier de l'appareil (`reglages/`) |
| `tracker.settingsSavedAt` | `hooks/useSessionLibrary.ts` | instant du dernier vrai changement des deux clés qui voyagent, en ms |
| `tracker.deviceId`, `tracker.deviceName` | `hooks/useSessionLibrary.ts` | identifiant tiré au hasard et nom de l'appareil, qui nomme son fichier de réglages (point 90) ; ne voyagent pas |
| `tracker.seenSettingsFiles` | `hooks/useSessionLibrary.ts` | fichiers de réglages déjà vus (`settingsEntryKey` : appareil, sinon nom du fichier), pour ne proposer un nouveau qu'une fois ; ne voyage pas |
| `tracker.memoryFolder` | `platform/memoryFolder.ts` | téléphone : `{ uri; base; label }` (`base` = `Tracker` si l'on a désigné son parent) |
| `tracker.libraryCache` | `hooks/useSessionLibrary.ts` | `{ folder; light: true; entries: Record<fiche, { size; mtimeMs; record }> }`, `record` réduit aux champs légers (point 92) ; un cache sans `light`, d'avant, est lu avec ses fiches entières puis remplacé ; reconstruit à volonté |
| `tracker.intervalRun` | `hooks/useIntervalTimer.ts` | séance du compteur en cours (`IntervalRun` : séance, lancement, commandes datées), reprise si la page est fermée puis rouverte ; effacée à la fermeture du compteur (point 89) |
| `tracker.sections` | `hooks/useOpenSections.ts` | `Record<moduleId, Record<section, boolean>>`. Modules lus : `running` (course), `cycling` (vélo), `intervals` (fractionné, point 89), dont l'onglet `surface` (point 78), `running.energie` et `cycling.energie` (chiffres du panneau Énergie, point 76, et tableau des zones, `zones`, point 85), `sailing-onglets`, `planning` (onglets sous la carte, seuls `profil` et `parcours` ouverts par défaut depuis le point 79 ; dont `surface`), `recording`, `settings`, `settings-activities`, `accueil.graphe` (totaux du graphe d'activités). `sailing` et `sailing-carte`, d'avant, ne sont plus lus |
| `tracker.panelSizes` | `components/ResizablePanel.tsx` | `Record<panelId, { width?; height? }>` |
| `tracker.followedTrace` | `hooks/useFollowedTrace.ts` | `{ name; source; activityId; points; marks?; markGuide? }`, gardée jusqu'à « Retirer » ; `marks` : les points posés d'un itinéraire (balises en voile), `markGuide` : ses bips propres (point 77) ; `points` amincis à la pose (Douglas-Peucker à 2 m, `thinFollowedTrace`, coordonnées au 1e-6°, point 92) |
| `tracker.planning` | `pages/PlanningPage.tsx` | `{ activityId?; view?; loop? }` ; `loop` : dernier état choisi du bouton « Boucle » (point 87) ; un ancien `mode` y reste, ignoré : les cases suivent l'activité depuis le point 81 |
| `tracker.brouterProfile` | `planning/brouter.ts` | `{ id }`, id du profil maison sur brouter.de, renvoyé sur cet id à chaque lancement ; propre à l'appareil |
| `tracker.routeList` | `pages/RoutesPage.tsx` | `{ sort }`, tri de la liste des itinéraires |
| `tracker.tileCache` | `hooks/useTileCache.ts` | `{ capMb? }`, plafond des cartes gardées (500 Mo par défaut), propre à l'appareil |
| `tracker.sailingNotes` | ancienne clé | notes d'avant le dossier, lues seulement pour reprendre celles d'une trace importée |

`StoredSettings` contient :
- la liste des activités et sa version (`activitiesVersion`, point 81 : une liste d'avant est mise à jour une fois au démarrage) ;
- les réglages rangés par identifiant d'activité : seuils, terrains (celui par défaut des sessions), unités, bornes de vitesse (en m/s) et de pente (en fraction), pause automatique, chiffres de la carte réduite (`liveFields`, point 76), bips d'approche des balises (`markGuide`, voile, point 77), type et poids du vélo, niveau du temps estimé et vitesse « Personnalisé », types de voie cochés d'office en planification (`wayTypes`, point 81), pas de l'altitude du terrain (`terrainSteps`, point 84) ;
- l'appui long, et les sports de la barre du bas : favori (`navFamily`, point 75), secondaire et durée de l'appui long qui le change (`navSecondFamily`, `navHoldMs`, point 79) ;
- les séances gardées du compteur (`intervalPresets`, point 89), communes aux activités ;
- en voile, le support sur foil (`foils`, point 91 ; absent : `foilDefault` du calcul, vrai en wingfoil) et la mesure des sauts (`jumps` : case, emplacement du téléphone, hauteur minimale ; ni en bateau ni hors voile) ;
- les choix retenus : `moduleActivity`, `recordActivity`, la dernière séance lancée au compteur (`lastIntervalWorkout`), et `sport`, l'ancienne activité du module voile.

L'ancienne allure par support, `referenceSpeeds`, est écartée à la lecture (point 46).

Hors de ces clés et du dossier :
- le journal de l'enregistrement (`recording-journal.jsonl`), dans le dossier privé de l'application, gardé tant que la session arrêtée attend ; dans le navigateur, il reste en mémoire ;
- la poignée du dossier choisi, dans IndexedDB ;
- les cartes gardées (`platform/tileCache.ts`, point 67) : sur le téléphone, le dossier privé `tuiles/` (`z_x_y.png`, date du fichier) ; dans le navigateur, le Cache API (`tracker-tuiles`). Elles ne voyagent pas avec le dossier mémoire.

## 7. Réglages et constantes

Les profils de support sont dans `core/sportProfiles.ts` (`SPORT_PROFILES`) : seuil d'activité et hystérésis, médiane, plafond de vitesse, polaire, cibles de tops, dénivelé (`ELEVATION_PRESETS`), enregistrement. **Ce sont des défauts provisoires** : seul le wingfoil a été validé sur données réelles. Les activités de l'utilisateur reposent sur ces profils (`core/activities.ts`, point 53).

Les autres constantes vivent, nommées et commentées, là où elles servent :

| Domaine | Fichier |
|---|---|
| Filtres | `core/speedFilter.ts` |
| Allure | `core/sessionSpeed.ts` |
| Unité de la vitesse de l'appareil | `core/kinematics.ts` |
| Manœuvres, vent, VMG, suggestions | `sailing/sailingConfig.ts`, plus les constantes internes de `maneuvers.ts`, `wind.ts` et `sailingAnalytics.ts` |
| Course | `running/runningAnalytics.ts`, `running/energy.ts`, et les lissages en tête de `pages/LandModule.tsx` |
| Vélo | `cycling/energy.ts` (types de vélo, roulement par revêtement `crrBySurface`, rendements), `cycling/cyclingConfig.ts` (couleurs par défaut) |
| Planification | `planning/duration.ts` (niveaux, km-effort, puissance de montée), `planning/brouterProfile.ts` (classement des voies, rangs de difficulté à vélo, coûts des types de voie : `WAY_COSTS`, fixés avec l'utilisateur au point 80), `BIKE_WAY_TYPES` et `TERRAIN_WAY_TYPES` de `planning/route.ts` (types cochés d'office, point 81), `LOOP_RETURN_DEFAULTS` de `planning/loopReturn.ts` (couloir, poids et limite de l'adresse du retour d'une boucle, point 87 ; son rapport à l'aller : `loopReturnMaxRatio` du profil) |
| Altitude du terrain | `core/terrainElevation.ts` (`TERRAIN_ELEVATION_VERSION`), limites du service dans `planning/ignAltimetry.ts`, pas proposés dans `TERRAIN_STEP_CHOICES_M` de `core/sportProfiles.ts` (défaut du profil : `terrainElevationStepM`) |
| Revêtement | `planning/surface.ts` (étiquettes OSM vers catégories), `WAY_MATCH_DEFAULTS` de `planning/wayMatch.ts` (rayon, marge de changement de voie, pas de la requête), `OVERPASS_MAX_COORDS` de `planning/overpass.ts` |
| Direct | `LIVE_STATS_DEFAULTS`, `LIVE_LEG_DEFAULTS`, `FOLLOW_DEFAULTS`, `MARK_GUIDE_DEFAULTS` et `BEEP_CURVE_LIMITS` de `recording/` ; durées et hauteur des bips dans `platform/beeper.ts`, `BeeperPlugin.java` et `TonePlayer.java` |
| Fractionné | bornes de la séance, compte à rebours et sons du compteur dans `recording/intervalTimer.ts` (`INTERVAL_LIMITS`, `INTERVAL_LEAD_IN_S`, `INTERVAL_TONE_MS`) ; analyse et détection des répétitions dans `intervals` du profil (`core/sportProfiles.ts`, point 89 : pas du profil, fraction du lancé, lissage, contrastes, durées minimales, découpe en séances) ; lissage des mini-courbes et seuil de la trace clairsemée dans `components/IntervalAnalysis.tsx` |
| Sauts | bloc `jumps` des profils de voile dans `core/sportProfiles.ts` (hauteur minimale par défaut, `JUMP_DETECTION` : grille, verticale, poussée, atterrissage, durées, plancher rangé, élagage, marques « ≈ »), `JUMPS_CALC_VERSION` de `core/jumps.ts`, format du `.imu` dans `core/imuFile.ts` |
| Affichage | `core/displayConfig.ts`, `TRACK_COLOR_SMOOTHING_S` de `core/trackColor.ts`, `GRADE_COLOR_STEPS` de `running/runningAnalytics.ts` (pente sur la carte) ; mise en page des analyses sur ordinateur : `--analysis-map-width` de `theme/tokens.css` et `HALF_PANEL_STYLE` de `components/styles.ts` (point 86) |

## 8. Tests

Ils portent sur des fonctions pures, avec des traces synthétiques ou un stockage simulé par une `Map`, en node. `npx vitest run` donne le compte : 792 au 8 octobre 2026.

Un calcul a son `*.test.ts` à côté de lui, sauf :
- `core/sessionStats` et `core/speedGradient`, couverts par d'autres fichiers de test (`topSegments`, `runningAnalytics`, `sailingConfig`) ;
- `sailing/sailingAnalytics`, couvert par `maneuvers.test.ts` ;
- `planning/brouterProfile`, couvert par `brouter.test.ts` ;
- `sailing/sailingStats`, `planning/geocoding` et `planning/routeGpx`, sans test.

Deux familles de tests méritent d'être connues :
- l'invariance 1 Hz / 5 Hz : filtres, allure, tops, manœuvres, résumé ;
- les protocoles synthétiques du vent de `sailing/maneuvers.test.ts` : rider asymétrique, session sans largue, courant traversier, bascule de 60°, support lent, enregistrement économique ;
- la mesure des manœuvres (`measureManeuver`), sur `buildNoisySession` : positions intégrées, bruit GPS, de cap et de Doppler à graine fixe, passage par `computeKinematics`.

Générateurs : `buildEastwardTrack` (kinematics), `buildTrack` (plusieurs fichiers), `realisticPolar` (wind) et, dans `maneuvers.test.ts`, `buildLegSession`, avec ses allures, son courant et sa polaire optionnels (`slowPolar` : celle du wingfoil divisée par 2,5).

**Attention à l'option `integratePosition`.** Par défaut, les générateurs font avancer la position le long d'une ligne arbitraire, indépendante des caps imposés. Toute analyse qui lit les positions (distance d'une manœuvre, tracé, géométrie du virage) doit être testée avec cette option, sinon elle mesure une trajectoire sans rapport avec la session simulée.

Non testés :
- `gpxParser` (DOM) ;
- `buildSailingSessionStats`, `calculateVmgStats`, `buildWindTimeline` ;
- `platform/` : `memoryFolder`, `files`, `compass`, `tileCache`, `beeper`, `motion`, et les plugins Java ;
- tous les hooks (`useRecorder`, `useSessionLibrary`, `useSessionDraft`, `leaveGuard`…), les composants et les pages.

Ils se vérifient au banc (`outils/banc/`, voir son `LISEZMOI.md`) et sur le téléphone (§12). Le banc prouve aussi qu'un changement est neutre : texte de la page relevé avant et après, puis comparé (point 44).

## 9. Dette et code mort

Plus de fichier mort, d'export ou de champ inutilisé, ni de `any` dans `src/` (nettoyages des points 15 et 44). Ce qui reste, par ordre d'importance :

- **Allure de la course** : toujours en min/km, même quand l'activité est réglée en milles nautiques (point 54).
- **Résumés de la liste** : le résumé d'une session est calculé à son entrée dans la mémoire.
  - Changer le seuil d'une activité, un terrain ou l'allure imposée ne recalcule pas les résumés, et rien ne le signale.
  - Seuls un changement du support, de l'activité ou du seuil propre de la session, ou de `SUMMARY_CALC_VERSION`, les recalculent.
- **Fiche réécrite à l'ouverture** : ouvrir une session voile réécrit sa fiche si le nombre de manœuvres a changé, et la date du fichier change. Le cache des fiches n'est pas rafraîchi après une écriture : la fiche est relue au lancement suivant, sans autre effet.
- **Doublon possible** : un enregistrement ou un import pendant la première lecture d'un dossier qui contient des GPX sans fiche peut créer un doublon, car `addGpx` ne compare qu'aux sessions déjà publiées. `dedupeSessions` le masque, mais les deux fichiers restent.
- **Écriture en place de repli** : un fournisseur Android qui refuse le renommage d'un document fait écrire la fiche en place, comme avant le point 92 ; une coupure à ce moment la laisserait illisible. Le dossier `Documents` du téléphone renomme : jamais constaté.
- **`useStoredRecord`** relit dans un effet : les onglets s'affichent un instant avec leurs défauts.
- **Brouillon de session** : le retour arrière du navigateur n'est pas intercepté. Le brouillon attend le retour sur la session.
- **Recharts** type `Payload.payload` en `any` : les `formatter` d'infobulle (voile, course, itinéraires) annotent la ligne du type attendu. C'est une confiance accordée à Recharts, pas une vérification.
- **Notification Android** : après un changement d'activité pendant l'enregistrement, elle garde le nom du départ jusqu'à une reprise après pause manuelle (point 64).
- **Statistiques en direct** (`useLiveRecording`) : chaque nouveau point annule le calcul programmé et le reprogramme pour la fin des 2 s. En rejeu très accéléré (×600), les points arrivent plus vite, le calcul n'a jamais lieu et la page reste sur « — ». Sans effet à 1 Hz ; au banc, rejouer à ×10.
- **Détection des virages écrite deux fois**, et sens d'un virage vu en un seul pas : voir le §11.

## 10. Historique des décisions et pièges rencontrés

Déplacé dans `docs/HISTORIQUE.md` le 23 septembre 2026, numérotation inchangée : les renvois « §10, point N » y mènent. À consulter sur le sujet qu'on touche, avant de retenter ce qui a déjà été essayé.

## 11. Chantiers en attente

- **Types de voie** (point 80) :
  - le coût d'un type non coché (3) semble un peu faible à l'utilisateur, gardé « pour voir à l'usage » ;
  - dire simplement la différence entre vélo et pied (proposé : types permis à vélo montrés à demi cochés), non tranché.
- **Énergie** (points 71, 72 et 88) : le k de l'air en course (0,0065, Pugh 1971) et les Crr par revêtement ne sont que des ordres de grandeur, à confirmer. Aucune des deux énergies n'a été comparée à une montre ou à Strava. Pistes et sentiers sans étiquette de revêtement restent « Inconnu » (Crr moyen du vélo) : les compter en « non pavé » est proposé, non tranché.
- **Course** :
  - zones cardiaques : `hr` est lu, FC max et FC de repos sont saisies, mais rien ne les utilise ;
  - tops, splits et allure par kilomètre (`topTargets: []` dans le profil) ;
  - notes de session, sur le modèle du brouillon de la voile.
- **Mode daltonien** (point 90), voulu par l'utilisateur plus tard : rouge, orange et vert des familles ne se séparent que par leur clarté ; aujourd'hui, une famille va toujours avec son icône ou son nom.
- **Valider les seuils par support** sur des sessions réelles de planche, kite, bateau, course et vélo. Valider aussi un enregistrement dense sur une planche rapide : la calibration récente s'est faite sur une trace lente et une trace de wingfoil.
- **Coût du vent à 5 Hz** (point 23) : environ 0,5 s à chaque mouvement du seuil sur 3 h à 5 Hz, contre 28 ms à 1 Hz.
  - Cause : `analyzeManeuvers` refait la détection des virages pour chaque candidat de vent, alors que seule la classification en dépend.
  - Piste : détecter une fois, puis classer par candidat. Le coût serait divisé par quatre environ, et la détection écrite une seconde fois dans `observeTurns` (`wind.ts`) serait fusionnée.
  - C'est un vrai refactor, à ne jamais faire seul (points 21, 26, 27).
- **Nommer un virage vu en un seul pas** (point 27) : on connaît le cap avant et le cap après, pas le chemin entre les deux. `angleDiff` retient l'arc court, si bien qu'un virement passé par le lit du vent ressort en empannage. Pistes :
  - la perte de vitesse, inopérante sur une session lente ;
  - le déplacement latéral, ténu ;
  - ou assumer que le fichier ne le dit pas, et l'afficher.

  À valider avec le souvenir de l'utilisateur.
- **Manœuvres, suites de l'audit du point 70** :
  - **5 Hz bruité** : la cohérence (somme des pas) et les caps stabilisés (3°/s d'un point au suivant) dépendent de la cadence. Avec un bruit réaliste, aucune manœuvre n'est détectée à 5 Hz (toutes « incohérentes ») et aucun cap n'est stabilisé. Le test 1 Hz / 5 Hz passe parce que ses traces sont sans bruit. Le corriger touche détection et classement : lot à part (point 21).
  - **Orientation fragile** : le vent estimé tient aux lectures de la détection (`windCriteria`, qui omet le dernier point de sa fenêtre). Les remplacer par la mesure corrigée a fait tourner le vent du banc de 90°. Toute retouche de la détection doit refaire ce relevé.
  - **Filtre médian de 3 s** : il remonte les creux en V, conservation surestimée de 0,05 à 0,1. Prendre la vitesse non filtrée pour le creux est une décision à part.
  - **Relance après changement d'allure** : la cible reste 90 % de la vitesse d'approche. Ressortir au près après une approche au largue peut ne jamais l'atteindre ; ces manœuvres sont comptées « sans relance ».
- **Vent sur trace lente et peu échantillonnée** : la polaire annonce une confiance élevée sur une direction fausse de 180° (point 27). L'utilisateur corrige par « Inverser ». La confiance mériterait d'être rabattue quand la couverture polaire est maigre.

## 12. Cible mobile (Capacitor)

Décidée le 23 septembre 2026 ; le choix de Capacitor et les options écartées sont au point 36. Téléphone de l'utilisateur : POCO 2412DPC0AG (Xiaomi), Android 16, HyperOS 3.0 ; il faut « Installer via USB » en plus du débogage USB.

### Avancement

C'est le seul endroit où il est tenu : les phases et le reste à faire. Le détail de chaque lot est dans HISTORIQUE.

- **Phases 0 et 1, faites le 23/09** (points 36 à 40) : git, `platform/storage.ts`, coquille Capacitor, enregistrement minimal. Contrôle de 13 min 27 s écran éteint, plus long trou 4 s. **Le test de 2 h écran éteint est reporté par l'utilisateur.**
- **Maquette** de l'accueil et de la navigation, validée le 23/09 : https://claude.ai/artifact/9enXeWAqdyhkqS95RRA4JR (privée).
- **Plan en six lots, terminé le 25/09** :
  - DA et navigation (point 41) ;
  - bibliothèque en dossier mémoire (points 42 et 43) ;
  - réglages d'affichage par activité (point 54) ;
  - accueil (point 53) ;
  - enregistrement en direct et bords (points 50, 53, 62) ;
  - APK des testeurs et `docs/INSTALLATION.md` (points 55, 62).
- **Hors plan** : allure par session (46), bugs et renommage (47 à 49, 51, 52), activités (53), itinéraires et trace suivie (59 à 61, 63), activité changée en route (64), audits de la documentation (44, 65), retouches du 29/09 dont l'onglet « général » des analyses (69), audit et nouvelle mesure des manœuvres (70), énergie de la course (71), vélo (72), planification et zoom des graphes (73), types de voie (74), barre du bas en cinq cases (75), puissance mécanique et chiffres de la carte réduite (76), parcours et balises en voile avec bips d'approche (77), revêtement des itinéraires et des sessions (78), retouches du 03/10 : zones de pente sur la carte, réglages par activité, sport secondaire, onglets et activité en planification, légende sur la carte, vignettes, choix d'activité dessiné, icône de la course (79), types de voie cochés, rangés selon la nature de la voie (80), types de voie cochés d'office par activité et activités Route, Gravel, VTT (81), revêtement sur la carte (82), types de voie appliqués à tout l'itinéraire (83), altitude de l'IGN pour la course et le vélo (84), pentes sur la carte et puissance par zone de pente (85), mise en page commune des analyses sur ordinateur (86), mode « Boucle » en planification (87), roulement selon le revêtement, « Mettre à jour », activités par famille et session à classer demandée avant l'analyse (88), groupe Fractionné, compteur d'intervalles et analyse des répétitions (89 ; commité avant l'essai d'une vraie séance enregistrée par Tracker), couleurs par famille et un fichier de réglages par appareil (90), sauts en voile mesurés par les capteurs du téléphone et case « Foil » (91), données sûres (92), cartes et survol (93), une seule mécanique pour les analyses (94).
- **Audit général du 09/10**, quatre lots avant le surf : A, données sûres, fait (point 92) ; B, cartes et survol, fait (point 93) ; C, une seule mécanique pour les analyses, fait (point 94) ; reste D (documentation).
- **Phase 2, interface mobile** : trois passes faites (points 47 à 49, 52, 56 à 58, 69 ; patron dans `docs/MISE_EN_PAGE.md`). Restent :
  - toucher au lieu du survol : fait pour les graphes de vitesse, d'altitude et du vent (points 73, 94) ; restent la courbe d'un saut et les mini-courbes du fractionné ;
  - `accept=".gpx"` de la bibliothèque, qui grise parfois les GPX sous Android.
- **Suite possible** : calcul des itinéraires hors ligne.
- **Phase 3** :
  - partage et export GPX ;
  - réception d'un GPX partagé depuis Komoot ;
  - cartes hors ligne : faites le 28/09 (point 67), par les tuiles vues en ligne ; le téléchargement d'une zone à l'avance reste exclu par les règles d'OSM ;
  - capteur cardiaque Bluetooth.

### Enregistrement

Les principes sont dans `CLAUDE.md` (Décisions, « Enregistrement ») ; ce qui suit est technique.

- **Positions** : vitesse fournie par le système (Doppler) ; cadence et distance dans `SportProfile.recording` (1 s, 0 m pour tous). Le 1 Hz tient aussi le coût du vent (point 23).
- **Plugin** : `@capgo/background-geolocation` (MPL-2.0, Capacitor 8), avec `android.useLegacyBridge: true`, sans quoi les positions s'arrêtent après 5 min en arrière-plan. Repli si des points se perdent : Capawesome, payant, qui garde les positions dans une file SQLite native.
- **Journal** : écrit par paquets au rythme des positions, il résiste à un arrêt brutal.
  - Chaque reprise après une pause ouvre un `<trkseg>` (marque `break`).
  - Un changement d'activité ajoute une ligne `activity`.
- **GPX** : écrit complet à l'arrêt, avec seulement la vitesse en extension (`<speed>` en m/s). Il est nommé `AAAA-MM-JJ_hh-mm-ss_<support>.gpx`, et ce nom ne change plus ensuite.
- **Pause automatique** : par défaut sous 0,3 m/s pendant 60 s de temps de trace ; 0 la désactive.
- **En direct** : `useLiveRecording` recalcule les statistiques et les bords (`recording/liveStats.ts`, `liveLegs.ts`) au plus toutes les 2 s.
- **Balises en voile** (point 77) : le guidage (`hooks/useMarkGuide.ts`) vit hors React, branché au démarrage dans `main.tsx`, et avance à chaque position reçue (`subscribeToFixes` de l'enregistreur). Le rythme des bips est tenu par le greffon `BeeperPlugin.java`, sur un fil à lui ; le service GPS garde le processeur éveillé. Son sur le flux des alarmes, vibration d'usage alarme (permission `VIBRATE`).
- **Compteur du fractionné** (point 89) : il suit l'horloge, pas les positions, avec ou sans enregistrement. À chaque commande (lancement, pause, reprise, « Passer », arrêt), la page confie tout le programme des sons au service au premier plan `IntervalTimerService.java` (type `specialUse`, verrou partiel, notification de la phase et de son décompte ; permissions `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `WAKE_LOCK`, `POST_NOTIFICATIONS`), qui le joue écran éteint ; sons et vibrations partagés avec les balises (`TonePlayer.java`). Pendant un enregistrement, chaque état de la séance est écrit dans le journal (ligne `['intervals', run]`, ignorée des versions d'avant) et les phases comprises vont dans la fiche à l'arrêt.
- **Capteurs, pour les sauts** (point 91) : quand « Mesurer les sauts » est cochée, le greffon `MotionPlugin.java` écrit accéléromètre et gyroscope bruts à 100 Hz, sur un fil à lui, dans le fichier privé `capteurs/<startedAtMs>.imu`, par paquets compressés indépendants (`ImuWriter.java`) : un arrêt brutal ne perd que le dernier. Pas de service au premier plan à lui : celui du GPS suffit (séance entière écran éteint, plus long trou 0,06 s, 2,8 Mo/h). La capture suit la pause manuelle, continue pendant la pause automatique, et une capture orpheline est arrêtée et retrouvée au lancement suivant. Sans gyroscope, la case est grisée.
- **Réglages du téléphone, avant tout enregistrement** : sur HyperOS, démarrage automatique et batterie « Aucune restriction » pour Tracker.
  - Sans eux, les positions s'arrêtent dès que l'application passe en arrière-plan (trou de 93 s au contrôle 1b).
  - Une désinstallation les remet à zéro, comme les autorisations.
- **Retrouver les fichiers** : les gestionnaires de fichiers ne montrent pas `Tracker` dans leur catégorie « Documents ». Passer par Stockage interne → Documents → Tracker, ou par le câble USB.

### Compiler, installer, signer

- **Développement** : `npm run dev` (ou le raccourci « Tracker » du bureau, `outils/lancer-tracker.bat`) et le navigateur du PC ; mise en page mobile au mode appareil de Chrome. `BrowserRouter` fonctionne dans la WebView, chargement direct de chaque route compris.
- **Outils** :
  - **JDK 21** (Temurin, `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`) : le Java 25 d'Android Studio 2026.1 ne fait pas tourner Gradle 8.14.3 ;
  - SDK dans `%LOCALAPPDATA%\Android\Sdk` ;
  - `android/` est versionné, et `android/app/build.gradle` tire `versionName` et `versionCode` de `package.json`.
- **Vers le téléphone** : `npm run build`, `npx cap sync android`, puis `npx cap run android` (2 min 20 à froid).
  - Dans le shell de Claude, qui définit `NoDefaultCurrentDirectoryInExePath=1`, la CLI ne trouve pas `gradlew`.
  - Y passer par `android\gradlew.bat assembleRelease`, avec `JAVA_HOME` et `ANDROID_HOME` posés.
  - Puis `adb install -r android/app/build/outputs/apk/release/app-release.apk` et `adb shell am start -n io.github.segneur.tracker/.MainActivity`.
  - `assembleDebug` reste possible, signé par la même clé, pour inspecter la WebView.
- **Signature** : clé dédiée `C:\Users\segne\tracker-signing\tracker-release.jks`, **hors du dépôt**, sauvegardée par l'utilisateur.
  - `android/keystore.properties` (ignoré par git, copie dans le même dossier) en donne le chemin et le mot de passe.
  - Debug et release sont signés par cette clé, pour qu'une version s'installe par-dessus l'autre. Sans le fichier, Gradle retombe sur la clé de debug du PC.
  - Android refuse une mise à jour signée d'une autre clé, sauf désinstallation, qui efface les données (point 41).
- **Diffusion** : l'APK par un lien (Drive, WeTransfer), avec la fiche `docs/INSTALLATION.md`. Après une réinstallation, désigner à nouveau le dossier mémoire : le sélecteur d'Android redonne accès aux fichiers déjà écrits.
- **Inspection** :
  - capture d'écran : `adb exec-out screencap -p` ;
  - console : `chrome://inspect` ;
  - pilotage de la WebView de debug : `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` et le protocole DevTools (`outils/banc/cdp.mjs`).

  Pas encore essayés : `--live-reload` sur le serveur du PC ; un APK compilé par GitHub Actions, auquel il faudrait confier la clé.
