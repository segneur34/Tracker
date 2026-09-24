# Tracker

Analyse de sessions sportives à partir de traces GPX, et enregistrement GPS sur le téléphone. Application 100 % client : rien ne part sur internet. Elle tourne dans le navigateur du PC et, emballée par Capacitor, sur Android.

- **Voile** (`/voile`) : wingfoil, planche à voile, kite, bateau. Bibliothèque des sessions, puis analyse (`/voile/analyse`) : carte colorée par la vitesse, statistiques, meilleurs segments (2 s à 1 mille), virements et empannages et leur qualité, estimation du vent et de ses variations, VMG, notes de session.
- **Course à pied** (`/course`, `/course/analyse`) : carte en dégradé de vitesse, graphes vitesse et altitude, zones de pente, dénivelé, allures.
- **Enregistrer** (`/enregistrer`) : une position par seconde, gardée brute, un GPX par session.
- **Réglages** (`/parametres`) : dossier mémoire, unités, seuils d'activité, terrain, profil du coureur.

## Mémoire

Les sessions et les réglages vivent dans un dossier ordinaire, `Tracker/` : un GPX et une fiche JSON par session dans `sessions/`, plus `reglages.json`. On le copie pour sauvegarder ou pour passer du téléphone au PC. Sur Android, il se désigne une fois (en principe `Documents/Tracker`) ; dans le navigateur, c'est la mémoire privée du navigateur ou un dossier choisi (Chrome, Edge).

## Commandes

```
npm install
npm run dev          serveur de développement
npx tsc -b --force   typecheck
npm run lint         oxlint
npx vitest run       tests unitaires
npm run build        build de production dans dist/
```

Android : JDK 21, puis `npm run build`, `npx cap sync android`, `npx cap run android` (détails au §12 de `docs/ETAT_DU_PROJET.md`).

## Documentation

- `CLAUDE.md` : règles d'architecture, conventions et décisions.
- `docs/ETAT_DU_PROJET.md` : pipeline de calcul, persistance, dette, chantiers, cible mobile et son avancement.
- `docs/HISTORIQUE.md` : décisions prises et pièges rencontrés, dans l'ordre chronologique.
- `docs/INVENTAIRE.md` : carte des fichiers.
