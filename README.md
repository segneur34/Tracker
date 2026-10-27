# Tracker

Analyse de sessions sportives à partir de traces GPX, et enregistrement GPS sur le téléphone. Application 100 % client, sans backend : les traces ne partent pas sur internet (seule la planification d'itinéraires interroge un serveur). Elle tourne dans le navigateur et, emballée par Capacitor, sur Android, avec enregistrement GPS natif, ceinture cardio Bluetooth et mémoire en dossier portable.

Cinq familles d'activités, chacune avec sa bibliothèque et sa page d'analyse (carte, graphes, meilleurs segments, notes) : **Voile** (wingfoil, planche, kite, bateau), **À pied** (course, marche), **Vélo** (route, gravel, VTT), **Surf**, **Entraînement** (fractionné, tests). Autour : **Enregistrer**, **Planifier** (itinéraires, export GPX), **Statistiques** (onglets général, graphique, régularité, records, cardio), **Profil** et **Réglages**.

## Mémoire

Les sessions vivent dans un dossier ordinaire, `Tracker/` : un GPX et une fiche JSON par session dans `sessions/`, et un fichier de réglages par appareil dans `reglages/`. On le copie pour sauvegarder ou pour passer du téléphone au PC. Sur Android, il se désigne une fois (en principe `Documents/Tracker`) ; dans le navigateur, c'est la mémoire privée du navigateur ou un dossier choisi (Chrome, Edge).

Planifier propose des types de voie : Sentier, Piste, Route, Grande route (serveur BRouter).

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
- `docs/INSTALLATION.md` : installer l'APK sur un téléphone Android, pour les testeurs.
- `outils/banc/LISEZMOI.md` : banc de test dans un Chrome sans fenêtre, mode d'emploi.
