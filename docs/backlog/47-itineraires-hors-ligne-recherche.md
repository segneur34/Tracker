# Idée 47 : itinéraires hors ligne (recherche du 12/11/2026)

Légende : [F] fait vérifié (source citée), [S] supposition à vérifier.

## 1. Ce que fait Tracker aujourd'hui

- [F] Décision d'origine : `docs/HISTORIQUE.md` point 59 (l. 239-246). Calcul par le serveur public BRouter, recherche de lieux par Photon ; « le hors ligne passera plus tard par l'application BRouter pour Android ». `docs/ETAT_DU_PROJET.md` l. 446 : « Suite possible : calcul des itinéraires hors ligne ».
- [F] `src/planning/brouter.ts` : `BROUTER_URL = https://brouter.de/brouter` (l. 25). Requête GET (l. 66-76) :
  `?lonlats=lon,lat|lon,lat&profile=<id>&profile:calcul=<entier>&alternativeidx=<n>&format=geojson[&polygons=...]`.
- [F] Le profil maison (`src/planning/brouterProfile.ts`, 341 lignes, `buildBrouterProfile`, `BROUTER_PROFILE_TEXT` l. 341, coûts `WAY_COSTS` l. 154 fixés avec l'utilisateur) est envoyé en POST au serveur (`uploadProfile`, l. 168-177), qui rend un id `custom_xxx` retenu sur l'appareil (clé `tracker.brouterProfile`, `usePlannedRoute.ts` l. 39). Les types de voie cochés et l'accès vélo/pied passent dans une seule variable `profile:calcul` (`profileCombination`, brouterProfile.ts l. 105). Si le serveur oublie le profil : 500 à corps vide, renvoi (l. 190-225).
- [F] Réponse lue (`parseBrouterGeojson`, l. 137) : première ligne GeoJSON, coordonnées `[lon, lat, altitude]` (d'où le dénivelé) et tableau `messages` (colonnes Longitude, Latitude, WayTags) d'où le revêtement par morceau (`parseBrouterMessages`, l. 105 ; `surface.ts`). Erreurs reconnues par texte (`NO_PATH`, l. 159).
- [F] Autres appels réseau de la planification : Photon (recherche de lieu, `planning/geocoding.ts` l. 12), Overpass (voies d'une trace enregistrée pour le revêtement de Course/Vélo, `planning/overpass.ts` l. 20, via `useSessionSurfaces`), IGN (altitude du terrain, `planning/ignAltimetry.ts`, `hooks/useTerrainElevation.ts`), tuiles de fond (cache `platform/tileCache.ts`, « Cartes hors ligne » = tuiles déjà vues, pas de téléchargement à l'avance : exclu par les règles d'OSM, ETAT l. 450).
- [F] `fetchLeg` est injecté en paramètre dans `planning/legCalculation.ts` (l. 16) : le calcul d'un tronçon est déjà une couture facile à remplacer. Option `polygons` (zones à éviter des boucles, `loopReturn.ts`) et `alternativeidx` en font partie.
- [F] Plateforme : `isNativeApp()` (`src/platform/runtime.ts` l. 8) ; 12 plugins Capacitor maison en Java dans `android/app/src/main/java/io/github/segneur/tracker/` (ex. `GnssPlugin`, `MemoryFolderPlugin`, `ShareFilePlugin`), enregistrés dans `MainActivity.java` l. 45-54 ; wrappers TypeScript dans `src/platform/`. Ajouter un plugin = une classe Java + un `registerPlugin` + un wrapper. minSdk 24, targetSdk 36 (`android/variables.gradle`).
- [F] Le manifeste n'a ni `<queries>` ni service lié aujourd'hui.

## 2. Faits sur BRouter (web)

- [F] Dépôt `github.com/abrensch/brouter`, licence MIT, dernière version v1.7.10 (17/07/2026), dernier commit le 06/11/2026, ~750 étoiles : projet vivant. App Android : F-Droid `btools.routingapp`, Play Store `btools.routingapp`.
- [F] Service Android exporté (`AndroidManifest.xml` : `BRouterService`, `exported=true`, processus `:brouter_service`), interface AIDL `btools.routingapp.IBRouterService` : une seule méthode `String getTrackFromParams(in Bundle params)` (fichier `brouter-routing-app/src/main/aidl/btools/routingapp/IBRouterService.aidl`, doc `docs/developers/android_service.md`).
- [F] Paramètres du Bundle : `lonlats` (« lon,lat|lon,lat », points `d` = ligne droite), `profile` (nom de .brf installé) ou `remoteProfile` (texte complet d'un profil, écrit par l'app sous `profiles2/remote.brf`), `extraParams` (« cle=val&cle=val », équivalent des `profile:` du serveur, donc `calcul=19`), `alternativeidx`, `polygons`, `polylines`, `nogos`, `maxRunningTime` (60 s par défaut), `trackFormat` = gpx | kml | json (défaut gpx), `pathToFileResult` null = le résultat revient en chaîne (recommandé depuis Android Q), `engineMode`, etc. Retour : le texte du tracé, ou un message d'erreur en chaîne. À appeler hors du fil principal.
- [F] Données : segments `.rd5` de 5° × 5°, nommés par le coin sud-ouest, générés chaque semaine sur `brouter.de/brouter/segments4/` (listage relevé le 12/11/2026). Tailles : E0_N40 120 Mo, E0_N45 128 Mo, E0_N50 80 Mo, E5_N40 69 Mo, E5_N45 253 Mo, E5_N50 183 Mo, W5_N40 92 Mo, W5_N45 65 Mo, W5_N50 140 Mo. Rangés dans `<dossier de base>/brouter/segments4/`; depuis Android 11 le dossier de base ne peut être que `Android/media/btools.routingapp/` (`docs/users/android_quickstart.md`). L'app a son propre écran de téléchargement et de mise à jour des segments.
- [F] `brouter-core` (module Gradle, `brouter-core/build.gradle`) dépend de `brouter-mapaccess`, `-util`, `-expressions`, `-codec` : bibliothèques Java pures, MIT. Aucune doc d'usage « en bibliothèque » trouvée ; le code de l'app (`BRouterWorker.java`, `BRouterService.java`) montre l'appel de `RoutingEngine` à reproduire.
- [S] Le tracé `json` du service est du GeoJSON comme celui du serveur (le worker a bien un format JSON, `BRouterWorker.java` l. 27 et 177-192), mais je n'ai pas vérifié qu'il contient le tableau `messages` (WayTags) ni l'altitude de chaque point. À vérifier sur un téléphone avant tout engagement : c'est le point qui décide si le revêtement du tracé reste fourni par le calcul. Le GPX, lui, porte l'altitude (`<ele>`) ; les étiquettes de voie y sont des « messages » seulement en mode instructions de virage [S].
- [S] Le profil maison doit se compiler avec le `lookups.dat` de l'app installée : le serveur public et l'app sont sur la même version v1.7.x, donc probable, mais un écart de version entre l'app et les segments casserait le calcul (le serveur public évolue avec les segments).

## 3. Autres moteurs (une ligne)

- GraphHopper (Apache 2) : embarquable sur Android, mais profils en YAML/Java à réécrire, graphe à construire ou à télécharger ; le profil maison (coûts par `highway`/`surface`/`tracktype`) serait à retraduire, donc risque de tracés différents.
- Valhalla (MIT) : moteur C++ avec tuiles routage ; build natif Android lourd, aucune raison de préférer à BRouter ici.
- [S] Aucun des deux ne fournit un profil équivalent au `.brf` maison : c'est l'argument décisif pour rester sur BRouter.

## 4. Voie A : application BRouter à côté

Ce que l'utilisateur ferait : installer BRouter (F-Droid ou Play, ~quelques dizaines de Mo [S]), l'ouvrir une fois, choisir le dossier, télécharger ses dalles (France métropolitaine : environ 1 Go [S], d'après les neuf dalles ci-dessus ; la liste exacte des dalles de la France, Bretagne comprise, W10_N45, n'a pas été relevée), les remettre à jour de temps en temps, puis régler Tracker sur « calcul sur le téléphone ».

Marche sans réseau : le calcul des tronçons, boucles et variantes (`polygons`, `alternativeidx` pris en charge par l'AIDL), la même courbe d'altitude si la sortie la donne [S].
Reste dépendant du réseau : fond de carte (sauf tuiles déjà vues), recherche de lieux (Photon : on pose les points à la main ou on ajoute une recherche locale, hors sujet), altitude IGN d'un enregistrement, revêtement par Overpass d'une trace enregistrée (hors planification), envoi du profil inutile.

Travail :
1. [petit] Plugin Capacitor `BrouterPlugin.java` : `bindService` sur `btools.routingapp`, appel de `getTrackFromParams` hors fil principal, déclaration `<queries><package android:name="btools.routingapp"/></queries>` (obligatoire depuis Android 11 pour voir un autre paquet, [S] à confirmer sur le téléphone) ; wrapper `platform/brouterLocal.ts`.
2. [petit] Dans `planning/` : un `fetchLeg` local qui bâtit les paramètres (mêmes `lonlats`, `extraParams=calcul=…`, `remoteProfile=BROUTER_PROFILE_TEXT`), lit le GeoJSON avec `parseBrouterGeojson`, mêmes erreurs en clair. Réglage « calcul : serveur / téléphone / automatique si pas de réseau ».
3. [moyen] Comparer serveur et téléphone sur de vrais itinéraires (même tracé attendu), essais au téléphone, message guidé si l'app ou les dalles manquent (« installer BRouter », « télécharger la zone »).
Risques : sortie sans `messages` (perte du revêtement en planification) ; service tué par Android pendant un long calcul ; limite de 60 s ; l'utilisateur doit gérer deux applications et leurs mises à jour ; données dans `Android/media/btools.routingapp/`, hors du dossier mémoire de Tracker.

## 5. Voie B : moteur embarqué dans l'APK

Ce que l'utilisateur ferait : rien à installer ; dans Tracker, « Cartes de routage » : choisir une région, télécharger ses dalles `.rd5` (même poids, ~1 Go pour la France [S]) dans le dossier de Tracker.

Marche sans réseau : comme la voie A, avec en plus le même `lookups.dat` que le profil maison, donc aucun écart de version, et une sortie sur mesure (altitude et WayTags garantis, on écrit le format). Même dépendance réseau restante.

Travail :
1. [gros] Intégrer `brouter-core`/`mapaccess`/`codec`/`expressions`/`util` (MIT) au projet Gradle d'`android/` (copie de sources ou sous-module), refaire l'appel du `RoutingEngine` comme `BRouterWorker` (profil, `polygons`, alternatives, délais), sortir un GeoJSON identique au serveur, plugin `BrouterEnginePlugin`.
2. [gros] Gestion des dalles par Tracker : liste des dalles par région, téléchargement long en arrière-plan (service de premier plan, reprise, somme de contrôle [S]), stockage (dossier privé ou dossier mémoire), mise à jour hebdomadaire, interface dans Réglages.
3. [moyen] Compiler le profil et les `lookups.dat` embarqués, tests de comparaison avec le serveur, essais au téléphone (mémoire, durée de calcul sur 100 km).
Risques : poids de l'APK (quelques Mo de code [S]) sans les dalles ; mémoire du moteur sur un vieux téléphone ; maintenance du code copié (suivre les versions de BRouter à la main) ; la diffusion de Tracker doit conserver la mention de licence MIT.

## 6. Recommandation

- Ne pas se précipiter : l'idée est en « Plus tard » et personne ne dépend encore du hors ligne pour planifier ; la planification se fait d'ordinaire chez soi, avec du réseau, et les tracés se rangent ensuite (hors ligne une fois calculés).
- Si l'utilisateur veut quand même la voie A d'abord : c'est la moins chère (2 petits lots + essais), elle garde le profil maison exactement (même texte envoyé en `remoteProfile`) et son seul vrai risque se lève en un essai d'une heure : la sortie `json` du service donne-t-elle altitude et étiquettes de voie ?
- Voie B seulement si la voie A est jugée pénible (deux applications, 1 Go géré dans BRouter) : elle ne se justifie que par la maîtrise des dalles et de la sortie. Les moteurs GraphHopper et Valhalla sont écartés (profil à réécrire, tracés différents).
- Étape de décision peu coûteuse avant tout code : un « essai 0 » demandé à l'utilisateur (installer BRouter, télécharger une dalle, brancher le téléphone), ou plus simplement lui poser les questions ci-dessous.

## 7. Questions à l'utilisateur (3 au plus)

1. Veux-tu planifier hors réseau (en montagne, en voyage), ou seulement pouvoir recalculer un tronçon sur place ? Défaut : planifier à l'avance suffit, donc rien à faire pour l'instant.
2. Es-tu d'accord pour installer BRouter à côté de Tracker et y télécharger environ 1 Go de cartes de routage (France) ? Défaut : oui pour essayer (voie A) ; sinon voie B plus tard.
3. Le fond de carte, la recherche de lieux et l'altitude IGN doivent-ils aussi marcher sans réseau (ce qui est un autre chantier, plus gros) ? Défaut : non, seul le calcul du tracé compte.

## Sources

- https://github.com/abrensch/brouter (README, licence MIT)
- https://api.github.com/repos/abrensch/brouter (dernier commit, v1.7.10)
- https://raw.githubusercontent.com/abrensch/brouter/master/brouter-routing-app/src/main/aidl/btools/routingapp/IBRouterService.aidl
- https://raw.githubusercontent.com/abrensch/brouter/master/docs/developers/android_service.md
- https://raw.githubusercontent.com/abrensch/brouter/master/docs/users/android_quickstart.md
- https://raw.githubusercontent.com/abrensch/brouter/master/brouter-routing-app/src/main/AndroidManifest.xml
- https://raw.githubusercontent.com/abrensch/brouter/master/brouter-routing-app/src/main/java/btools/routingapp/BRouterService.java et BRouterWorker.java
- https://raw.githubusercontent.com/abrensch/brouter/master/brouter-core/build.gradle
- https://brouter.de/brouter/segments4/ (liste et tailles des dalles, 12/11/2026)
