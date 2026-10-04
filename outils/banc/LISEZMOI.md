# Banc de test

Scripts Node qui pilotent un Chrome sans fenêtre (ou la WebView du téléphone) par le protocole DevTools, pour éprouver l'application sans la manipuler à la main. Ils complètent les tests unitaires, qui ne couvrent ni les hooks, ni les pages, ni la mémoire (§8 de `docs/ETAT_DU_PROJET.md`). Aucune dépendance : Node 22 ou plus (`fetch` et `WebSocket` natifs).

## Mise en place

1. Un serveur, sur un port à part pour ne pas gêner celui de l'utilisateur : `npx vite --port 4190 --strictPort --host 127.0.0.1` (ou le build : `npx vite preview --port 4199 --strictPort --host 127.0.0.1`). Chaque script lit `BASE` (par exemple `BASE=http://127.0.0.1:4190`).
2. Un Chrome sans fenêtre, sur un **profil neuf** (mémoire du navigateur vide) :
   `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=9400 --user-data-dir=<dossier de brouillon>/chrome-profil --window-size=1400,1000 --no-first-run about:blank`, en arrière-plan. On le ferme par `Browser.close` du protocole. Le Chrome de l'utilisateur n'est pas touché.
3. Les chemins de fichiers passés aux scripts sont au format Windows (`DOM.setFileInputFiles`). Sous Git Bash, préfixer par `MSYS_NO_PATHCONV=1`.

## Scripts

- `make-gpx.mjs <sortie> [décalage en heures]` : trace de voile synthétique à 1 Hz, environ 3 750 points. Elle comporte des bords de près et de portant, des virements et des empannages, avec un vent du nord. Le décalage produit une autre session, avec un autre instant de départ.
- `bench.mjs <port> analyse <gpx>` : rejeu du GPX à ×600, Arrêter, Analyser. Les onglets de la colonne de la carte sont forcés ouverts. Le script affiche le titre, le nombre de segments et de graphes, et les erreurs de console. `DUMP=x.txt` relève le texte de la page, `SHOT=x.png` fait une capture.
- `session-save.mjs <port> <gpx>` et, sur le même profil, `session-save-resume.mjs <port>` : brouillon et « Enregistrer la session » (lot 3b). Ils éprouvent le vent, le seuil, les notes, l'avertissement en quittant, la relecture après rechargement et Annuler.
- `allure-session.mjs <port> <gpx 1> <gpx 2>` : l'allure imposée propre à chaque session. Les deux GPX viennent de `make-gpx.mjs`, sans décalage puis avec 1 h de décalage. Le script vérifie le brouillon, l'écriture dans la fiche, le recalcul du résumé et la relecture. Il vérifie aussi que la seconde session n'est pas touchée et que l'ancienne allure par support est effacée.
- `rename.mjs <port> <gpx>` : renommage d'une session (lot II), depuis la bibliothèque puis depuis l'en-tête de l'analyse. Il vérifie Échap, Entrée, la fiche, la relecture après rechargement et l'effacement par un nom vide.
- `library.mjs <port> <dossier des GPX> <dossier des captures>`, puis `library2.mjs` et `library3.mjs` : la bibliothèque (lot 3a). Il faut dans le dossier `voile.gpx` (produit par `make-gpx.mjs`), `course.gpx` (une trace avec `<type>Trail Running</type>`) et `sans-type.gpx` (une trace sans `<type>`). Ces deux derniers sont à fabriquer à la main.
- `planning.mjs <port> <dossier des GPX> [<dossier des captures>]` : la page Itinéraires. Il faut dans le dossier `sans-heure.gpx` (une trace sans horodatage, avec altitude et un `<type>`), `route-rte.gpx` (des `<rtept>` seulement), `boucle.gpx` (une trace qui revient à quelques mètres de son départ) et `pas-un-gpx.gpx` (aucun point de trace ni de route), tous à fabriquer à la main. Le script pose des points et vérifie « Précédent » et la boucle en ligne droite. Il charge ensuite les GPX, insère un point sur la trace importée, déplace l'arrivée, inverse, range l'itinéraire et le rouvre après rechargement. Les confirmations sont acceptées et affichées.
- `activite.mjs <port> <gpx de voile> [<dossier des captures>]` : l'activité d'une session. Le GPX vient de `make-gpx.mjs`. Le script vérifie :
  - que suivre un itinéraire propose son activité (sur un profil où `planning.mjs` a rangé des itinéraires) ;
  - le passage de Voile à Course pendant un rejeu à ×10 ;
  - la carte réduite et ses grands chiffres ;
  - le rangement sous la nouvelle activité ;
  - la bascule course ↔ voile depuis l'analyse, avec confirmation quand un brouillon est ouvert.
- `balises.mjs <port> <dossier de travail> [<dossier des captures>]` : parcours de voile et bips d'approche (point 77), à 390×844, sur un profil neuf. Le script écrit lui-même son GPX dans le dossier de travail. Il vérifie :
  - le parcours sur la page Itinéraires : balises numérotées, bloc « Parcours », bips propres au parcours rangés dans la fiche, puis « Partir » ;
  - un rejeu ×1 d'un parcours de trois balises, avec le relevé des bips : la version navigateur de `platform/beeper.ts` consigne chaque son en `console.debug` (« [bips] ») ;
  - un rejeu ×10 avec les bips du parcours, « Passer » et « Bips » coupés ;
  - l'éditeur de la courbe dans Réglages : glisser, ajouter un point, vibration, « Écouter », « Par défaut ».
  
  Il dure environ 2 min 30.
- `surface.mjs <port> <dossier de travail> [<dossier des captures>]` : revêtement (point 78), sur un profil neuf, avec réseau (brouter.de et overpass-api.de). Le script écrit lui-même ses GPX. Il vérifie :
  - un itinéraire de deux points en Course : bloc « Surface » rempli par le calcul, voies rangées dans la fiche ; une fiche sans voies, rouverte, montre « Inconnu » et « Calculer », qui les rend ;
  - un GPX sans horodatage chargé en itinéraire : tout « Inconnu » ;
  - une course synthétique le long du tracé, importée puis ouverte : l'onglet « surface » fait une requête à Overpass et range les voies ; après rechargement, mêmes chiffres, sans nouvelle requête.

  Overpass peut mettre plus d'une minute : ne pas le relancer en rafale.
- `shots.mjs <port> <dossier> <L>x<H>[m] <chemins…>` : captures d'écran ; `m` émule un téléphone (par exemple `390x844m`). Variables : `FULL=1` pour la page entière, `SETUP` pour du code à exécuter avant (par exemple remplir `localStorage`), `WAIT` en millisecondes.
- `cdp.mjs <ws> <chemins…>` : charge des routes dans la WebView de debug du téléphone et lit la page. On y accède par `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.

## Prouver qu'un changement est neutre

1. Avant le changement : `bench.mjs` avec `DUMP=avant.txt`, sur un profil neuf.
2. Après le changement : la même chose sur un autre profil neuf, avec `DUMP=apres.txt`.
3. Comparer les deux par `diff`. Pour un nettoyage ou une conversion, le texte doit être identique au caractère près (§10, point 44).
