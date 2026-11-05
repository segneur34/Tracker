# Tracker

Analyse de sessions sportives à partir de traces GPX, et enregistrement GPS sur le téléphone. Application 100 % client, sans backend à nous : les traces et les sessions ne partent jamais sur internet, mais l'application interroge des services publics (liste plus bas). Elle tourne dans le navigateur et, emballée par Capacitor, sur Android, avec enregistrement GPS natif, ceinture cardio Bluetooth et mémoire en dossier portable.

Cinq familles d'activités, chacune avec sa bibliothèque et sa page d'analyse (carte, graphes, meilleurs segments, notes) : **Voile** (wingfoil, planche, kite, bateau), **À pied** (course, marche), **Vélo** (route, gravel, VTT), **Surf**, **Entraînement** (fractionné, tests). Autour : **Enregistrer**, **Planifier** (itinéraires, export GPX), **Statistiques** (onglets général, graphique, régularité, records, cardio), **Profil** et **Réglages**.

## Mémoire

Les sessions vivent dans un dossier ordinaire, `Tracker/` : un GPX et une fiche JSON par session dans `sessions/`, et un fichier de réglages par appareil dans `reglages/`. On le copie pour sauvegarder ou pour passer du téléphone au PC. Sur Android, il se désigne une fois (en principe `Documents/Tracker`) ; dans le navigateur, c'est la mémoire privée du navigateur ou un dossier choisi (Chrome, Edge).

Planifier propose des types de voie : Sentier, Piste, Route, Grande route (serveur BRouter).

## Services appelés

Aucune clé, aucun compte, aucune télémétrie ; seuls ces services reçoivent des requêtes, et seulement dans ces cas :

| Service | Quand | Ce qui part |
|---|---|---|
| Tuiles OpenStreetMap (`tile.openstreetmap.org`) | à chaque carte affichée en vue « plan », sauf tuile déjà gardée sur l'appareil | la position de la tuile (zoom, colonne, ligne), donc la zone regardée |
| Tuiles Esri (`server.arcgisonline.com`) | carte en vue satellite | idem |
| Photon (`photon.komoot.io`) | recherche d'un lieu dans Planifier | le texte tapé et le centre de la carte |
| BRouter (`brouter.de`) | calcul d'un itinéraire dans Planifier | les points de passage, le profil de voies choisi (envoyé aussi une fois au serveur) |
| IGN, Géoplateforme (`data.geopf.fr`) | altitude du terrain pour la course et le vélo, et pour un GPX importé en planification | les coordonnées des points de la trace, par paquets |
| Overpass (`overpass-api.de`) | revêtement (sentier, route…) d'un itinéraire ou d'une session à pied ou à vélo | les coordonnées du tracé, pour en lire les voies voisines |

Ouvrir un GPX, l'analyser, enregistrer et lire les Statistiques n'appellent rien d'autre que les tuiles de la carte.

## Commandes

```
npm run dev          serveur de développement
npx tsc -b           typecheck incrémental (strict, noUnusedLocals, verbatimModuleSyntax) ; --force pour tout revérifier
npm run lint         oxlint
npx vitest run --changed   tests qui importent, même de loin, un fichier modifié non commité
npx vitest run       tous les tests, fonctions pures uniquement, environnement node
npx vitest run src/sailing/wind.test.ts -t "nom"   un fichier, un test
npm run build        tsc -b && vite build
```

## Documentation

- `CLAUDE.md` : règles d'architecture, conventions et décisions transverses.
- `docs/ETAT_DU_PROJET.md` : pipeline, persistance, dette, chantiers, avancement du plan mobile (§12).
- `docs/DECISIONS.md` : décisions de l'utilisateur propres à chaque domaine.
- `docs/HISTORIQUE.md` : décisions et pièges, en points numérotés.
- `docs/INVENTAIRE.md` : carte des fichiers.
- `docs/MISE_EN_PAGE.md` : patron commun des pages d'analyse.
- `docs/MODELES.md` : quel modèle et quel effort pour quelle tâche, sous-agents de `.claude/agents/`.
- `docs/DEVELOPPER.md` : construire l'application (Node, JDK 21, signature, APK, hébergement web).
- `docs/INSTALLATION.md` : installer l'APK sur un téléphone Android, pour les testeurs.
- `outils/banc/LISEZMOI.md` : banc de test dans un Chrome sans fenêtre, mode d'emploi.
