# Tracker

Analyse de sessions sportives à partir d'une trace GPX. Application web 100 % client : rien ne quitte le navigateur, les réglages et les notes sont conservés dans `localStorage`.

Deux modules :

- **Voile** (`/voile`) : wingfoil, planche à voile, kite, bateau. Carte colorée par la vitesse, statistiques, meilleurs segments (2 s à 1 mille), détection et qualité des virements et empannages, estimation du vent et de ses variations, VMG, notes de session.
- **Course à pied** (`/course`) : carte en dégradé de vitesse, graphes vitesse et altitude, zones de pente, dénivelé, allures.

Une page **Paramètres** (`/parametres`) règle unités, seuils d'activité, terrain et profil du coureur.

## Commandes

```
npm install
npm run dev          serveur de développement
npx tsc -b --force   typecheck
npm run lint         oxlint
npx vitest run       tests unitaires
npm run build        build de production dans dist/
```

## Documentation

- `CLAUDE.md` : règles d'architecture et conventions du projet.
- `docs/ETAT_DU_PROJET.md` : inventaire du code, pipeline de calcul, décisions prises, chantiers en attente.
