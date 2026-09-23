# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Tracker : analyse de sessions sportives à partir de traces GPX

Application 100 % client (React 19, TypeScript, Vite 8, Recharts, Leaflet), sans backend. Modules voile (`/voile` : wingfoil, planche, kite, bateau) et course (`/course`), page `/parametres`. Interface et commentaires en français. Cible à venir : application Android via Capacitor, avec enregistrement GPS natif (`docs/ETAT_DU_PROJET.md`, « Cible mobile »).

`docs/ETAT_DU_PROJET.md` décrit le code, le pipeline et les chantiers : le lire avant de toucher au noyau ou aux analyses voile. `docs/HISTORIQUE.md` garde les décisions passées et les pièges : le consulter sur le sujet qu'on touche.

## Commandes

```
npm run dev          serveur de développement
npx tsc -b --force   typecheck (strict, noUnusedLocals, verbatimModuleSyntax)
npm run lint         oxlint
npx vitest run       tests, fonctions pures uniquement, environnement node
npx vitest run src/sailing/wind.test.ts -t "nom"   un fichier, un test
npm run build        tsc -b && vite build
```

Android (JDK 21 obligatoire, détails dans `docs/ETAT_DU_PROJET.md` §2 et §12) : `npm run build`, `npx cap sync android`, puis `npx cap run android`. Dans le shell de Claude, la CLI ne trouve pas `gradlew` : passer par `android\gradlew.bat assembleDebug` et `adb install -r`.

Après toute modification, dans cet ordre : typecheck, lint, tests, build. Tous doivent passer.

## Documentation

- `docs/ETAT_DU_PROJET.md` : une passe après chaque lot que l'utilisateur a validé sur données réelles, jamais entre deux modifications, sans attendre la fin de session (git garde le code, pas le pourquoi). Une passe = sections touchées à jour, plus un point daté dans `docs/HISTORIQUE.md`.
- `CLAUDE.md` : en fin de session, seulement si une règle ou une décision de l'utilisateur a changé. Il doit rester court.

## Environnement

- Dépôt git, doublé d'un dépôt GitHub privé (`segneur34/Tracker`) : un commit par lot validé, un envoi après accord de l'utilisateur. `core.autocrlf` est à `false` dans ce dépôt : aucune conversion de fin de ligne.
- Windows 11, terminal `cmd` : ne jamais donner de commande PowerShell à recopier. L'utilisateur colle parfois lui-même la sortie.
- Aucun GPX réel dans le projet : les tests sont synthétiques, la validation sur données réelles revient à l'utilisateur.
- Une question d'algorithmique peut partir chez Gemini : la formuler de façon autonome et complète.

## Règles d'architecture

1. `src/core/` en unités SI (m/s, m, s ou ms, caps en degrés). Conversion en sortie seulement (`core/units.ts`, profil du support).
2. Fenêtres en secondes, jamais en nombre de points : une trace à 1 Hz et à 5 Hz donne le même résultat (testé).
3. Aucun seuil en dur dans un calcul : il vient de `SPORT_PROFILES`, est passé en paramètre, surchargeable, et la surcharge est persistée.
4. En voile, un seuil de vitesse s'accorde à l'allure de la session (`core/sessionSpeed.ts`), surchargeable. Les valeurs du profil sont des plafonds : la mise à l'échelle ne fait qu'abaisser. Elle est appliquée dans les hooks, jamais par défaut dans les calculs (tests neutres). Préférer un rapport sans dimension à des nœuds absolus (vol perdu : conservation de vitesse sous 0,5).
5. `sailing/*` travaille en nœuds sur `PointData` (`utils/kinematics.ts`) : héritage assumé, pas de conversion sans plan dédié.
6. Distance = intégrale de la vitesse retenue (`segmentDistanceM`), ni celle du fichier ni une somme de Haversine.
7. Vent : lu à la bissectrice de chaque manœuvre classée, toutes comprises ; statistiques pondérées par la symétrie du virage, jamais filtrées (`calculateWindStats`). L'estimation globale (`estimateWind`) repose sur la polaire et les manœuvres à caps stabilisés (`windSamplesFrom`). Polaire glissante et corde entrée → sortie ont été essayées puis retirées : ne pas les réintroduire.
8. Lecteur GPX maison (`core/gpxParser.ts`) : ne pas réinstaller `gpxparser`, qui ignore les extensions (Doppler, FC, cadence).
9. Un module ne reprend que ses supports : `useSportSettings(defaultSport, allowedSports)`.
10. Cadence variable : une application économique peut compresser un virage entier dans un seul intervalle. Ne jamais supposer plusieurs points dans une fenêtre de quelques secondes.
11. react-leaflet : le style d'un `Polyline` passe toujours par `pathOptions`, sinon il n'est pas réappliqué.
12. Stockage, fichiers, position : uniquement via `src/platform/` (aujourd'hui `storage.ts`, jamais `localStorage` en direct), pour que la version Android n'ait qu'une couche à remplacer.

## Où ajouter quoi

- Support à voile : `SPORT_PROFILES` et `SAILING_SPORTS` (`core/sportProfiles.ts`).
- Réglage utilisateur : `StoredSettings` (`hooks/useSportSettings.ts`), `useAllSportSettings`, `pages/SettingsPage.tsx`.
- Section de module : `*_SECTIONS` et `*_SECTION_DEFAULTS` de la page, et un bloc `{open.cle && ...}` dans un `ResizablePanel` d'`id` unique. En voile : `SAILING_SECTIONS` en haut, `SAILING_CARTE_PANELS` dans la colonne de la carte.
- Graphe relié à la carte : chaque ligne porte l'`index` du point de trace, et le survol passe par `hoveredTrackIndex` (`components/chartHover.ts`). Pas de `any`.
- Métrique de manœuvre : `ManeuverLocation` (`sailing/maneuvers.ts`), puis `MANEUVER_METRICS` et `summarizeManeuvers` (`sailing/sailingAnalytics.ts`).
- Calcul pur : dans `core/`, `sailing/` ou `running/`, avec son `*.test.ts` sur trace synthétique.

## Décisions de l'utilisateur

- Couleur de trace : dégradé continu sur une échelle absolue (`core/speedGradient.ts`), gris sous la borne basse, bornes réglables par support dans la légende ; ni échelle relative ni paliers. Course : 4 à 15 km/h. Voile : seuil d'activité et bornes suggérés par l'allure (`suggestActiveThresholdKn`, `suggestSpeedRangeMs` : au-dessus de 12 nds, défaut du profil, sauf le bateau à 1 nd ; en dessous, 1 nd ; borne haute = pic sur 2 s + 1 nd ; 8 à 28 nds si la trace est trop courte). La surcharge persistée prime toujours.
- Courbe du vent : toute la session, par toutes les manœuvres sans exception, valeur la plus proche aux bords, coupure au-delà de 30 min sans manœuvre.
- Une seule notion de réussite : le vent est estimé au seuil d'activité effectif, surcharge comprise (bouger le seuil recalcule le vent, c'est accepté).
- Graphes course « superposés » à deux axes, voulus malgré la difficulté de lecture.
- Tout bloc est redimensionnable (`ResizablePanel`), taille mémorisée.
- Voile : manœuvres en petit tableau, détails dépliables. Carte à 60 % de large ; à sa droite, les onglets manœuvres, VMG, graphiques, vent (dans cet ordre, fermés par défaut, côte à côte si la place le permet). En haut : global, matos, tops seulement. Ne rien déplacer ni dupliquer entre les deux groupes sans redemander.
