# Outils

- `lancer-tracker.bat` : ouvre Tracker dans le navigateur. Il démarre d'abord le serveur de développement (`npm run dev`, port 5173) dans une fenêtre réduite « Tracker - serveur » si celui-ci ne tourne pas déjà. Fermer cette fenêtre arrête le serveur. Le raccourci « Tracker » du bureau pointe vers ce fichier, avec l'icône `icone-tracker.ico`, tirée comme l'icône Android de `assets/icone.svg`.
- `logo/icones-android.mjs` : refait depuis `assets/icone.svg` l'icône Android, la favicon et `icone-tracker.ico` ; mode d'emploi en tête du fichier.
- `banc/` : banc de test dans un Chrome sans fenêtre (son `LISEZMOI.md`).
