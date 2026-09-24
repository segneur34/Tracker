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
- `library.mjs <port> <dossier des GPX> <dossier des captures>`, puis `library2.mjs` et `library3.mjs` : la bibliothèque (lot 3a). Il faut dans le dossier `voile.gpx` (produit par `make-gpx.mjs`), `course.gpx` (une trace avec `<type>Trail Running</type>`) et `sans-type.gpx` (une trace sans `<type>`). Ces deux derniers sont à fabriquer à la main.
- `shots.mjs <port> <dossier> <L>x<H>[m] <chemins…>` : captures d'écran ; `m` émule un téléphone (par exemple `390x844m`). Variables : `FULL=1` pour la page entière, `SETUP` pour du code à exécuter avant (par exemple remplir `localStorage`), `WAIT` en millisecondes.
- `cdp.mjs <ws> <chemins…>` : charge des routes dans la WebView de debug du téléphone et lit la page. On y accède par `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.

## Prouver qu'un changement est neutre

1. Avant le changement : `bench.mjs` avec `DUMP=avant.txt`, sur un profil neuf.
2. Après le changement : la même chose sur un autre profil neuf, avec `DUMP=apres.txt`.
3. Comparer les deux par `diff`. Pour un nettoyage ou une conversion, le texte doit être identique au caractère près (§10, point 44).
