# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Tracker : analyse de sessions sportives à partir de traces GPX

Application 100 % client (React 19, TypeScript, Vite 8, Recharts, Leaflet), sans backend. Modules voile (`/voile` : wingfoil, planche, kite, bateau) et course (`/course`), pages `/enregistrer` et `/parametres`. Interface et commentaires en français. Application Android via Capacitor, avec enregistrement GPS natif : plan en six lots au §12 de `docs/ETAT_DU_PROJET.md` (« Cible mobile »), lots 1 et 3 (mémoire en dossier, 3a navigateur et 3b téléphone) faits ; prochain : lot 2.

`docs/ETAT_DU_PROJET.md` décrit le code, le pipeline et les chantiers : le lire avant de toucher au noyau ou aux analyses voile. `docs/INVENTAIRE.md` donne les signatures exportées, module par module. `docs/HISTORIQUE.md` garde les décisions passées et les pièges : le consulter sur le sujet qu'on touche.

## Commandes

```
npm run dev          serveur de développement
npx tsc -b --force   typecheck (strict, noUnusedLocals, verbatimModuleSyntax)
npm run lint         oxlint
npx vitest run       tests, fonctions pures uniquement, environnement node
npx vitest run src/sailing/wind.test.ts -t "nom"   un fichier, un test
npm run build        tsc -b && vite build
```

Android (JDK 21 obligatoire, détails dans `docs/ETAT_DU_PROJET.md` §2 et §12) : `npm run build`, `npx cap sync android`, puis `npx cap run android`. Dans le shell de Claude, la CLI ne trouve pas `gradlew` : passer par `android\gradlew.bat assembleRelease` (`JAVA_HOME` et `ANDROID_HOME` à poser) et `adb install -r`. APK signé par une clé dédiée, hors du dépôt (`android/keystore.properties`, ignoré) : ne jamais la régénérer ni la versionner. Version unique dans `package.json`, à augmenter avant chaque APK diffusé.

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
12. Stockage, fichiers, position : uniquement via `src/platform/` (`storage.ts`, `files.ts`, `memoryFolder.ts`, `location.ts` ; jamais `localStorage`, `Filesystem`, `showDirectoryPicker` ni `navigator.geolocation` en direct). Chaque module y choisit sa version navigateur ou téléphone par `isNativeApp()`.

## Où ajouter quoi

- Support à voile : `SPORT_PROFILES` et `SAILING_SPORTS` (`core/sportProfiles.ts`).
- Réglage utilisateur : `StoredSettings` (`hooks/useSportSettings.ts`), `useAllSportSettings`, `pages/SettingsPage.tsx`.
- Section de module : `*_SECTIONS` et `*_SECTION_DEFAULTS` de la page, et un bloc `{open.cle && ...}` dans un `ResizablePanel` d'`id` unique. En voile : `SAILING_SECTIONS` en haut, `SAILING_CARTE_PANELS` dans la colonne de la carte.
- Graphe relié à la carte : chaque ligne porte l'`index` du point de trace, et le survol passe par `hoveredTrackIndex` (`components/chartHover.ts`). Pas de `any`.
- Métrique de manœuvre : `ManeuverLocation` (`sailing/maneuvers.ts`), puis `MANEUVER_METRICS` et `summarizeManeuvers` (`sailing/sailingAnalytics.ts`).
- Donnée propre à une session (notes, vent saisi, seuil d'activité, support) : dans sa fiche (`library/record.ts`), écrite par `updateSessionRecord` ; dans le module, par le brouillon (`useSessionDraft`, `library/sessionEdits.ts`) et « Enregistrer la session » ; jamais dans une clé de l'appareil. Une donnée recalculable depuis le GPX va dans `summary`, avec `SUMMARY_CALC_VERSION` augmenté si son calcul change.
- Calcul pur : dans `core/`, `sailing/`, `running/`, `recording/` ou `library/`, avec son `*.test.ts` sur trace synthétique.
- Couleur, police, rayon, espacement : une variable de `src/theme/tokens.css`, jamais une valeur en dur dans un écran neuf. Composants communs dans `components/ui`, icônes dans `components/icons.tsx` (pas d'emoji). Les couleurs de données des graphes et de la carte restent en dur (attributs SVG).

## Décisions de l'utilisateur

- Couleur de trace : dégradé continu sur une échelle absolue (`core/speedGradient.ts`), gris sous la borne basse, bornes réglables par support dans la légende ; ni échelle relative ni paliers. Course : 4 à 15 km/h. Voile : seuil d'activité et bornes suggérés par l'allure (`suggestActiveThresholdKn`, `suggestSpeedRangeMs` : au-dessus de 12 nds, défaut du profil, sauf le bateau à 1 nd ; en dessous, 1 nd ; borne haute = pic sur 2 s + 1 nd ; 8 à 28 nds si la trace est trop courte). La surcharge persistée prime toujours.
- Courbe du vent : toute la session, par toutes les manœuvres sans exception, valeur la plus proche aux bords, coupure au-delà de 30 min sans manœuvre.
- Une seule notion de réussite : le vent est estimé au seuil d'activité effectif, surcharge comprise (bouger le seuil recalcule le vent, c'est accepté).
- Session : vent saisi, seuil d'activité et notes restent en brouillon jusqu'à « Enregistrer la session » (Annuler, avertissement en quittant). Le seuil est propre à chaque session, dans sa fiche, et prime sur celui du support. Le support se change immédiatement.
- Graphes course « superposés » à deux axes, voulus malgré la difficulté de lecture.
- Tout bloc est redimensionnable (`ResizablePanel`), taille mémorisée.
- Voile : manœuvres en petit tableau, détails dépliables. Carte à 60 % de large ; à sa droite, les onglets manœuvres, VMG, graphiques, vent (dans cet ordre, fermés par défaut, côte à côte si la place le permet). En haut : global, matos, tops seulement. Ne rien déplacer ni dupliquer entre les deux groupes sans redemander.
- Enregistrement : brut à 1 Hz, sans autre filtre que les redélivrances ; un GPX par session, analysé par les modules existants via `loadGpxContent`.
- Mémoire : un dossier portable `Tracker/` (GPX + fiche JSON par session dans `sessions/`, `reglages.json`), qu'on copie pour sauvegarder ou changer d'appareil ; pas d'index dans le dossier ; réglages : le plus récent l'emporte. Sur Android, dossier désigné par le sélecteur d'Android (SAF), jamais « accès à tous les fichiers ». Suite de la cible mobile dans l'ordre fixé au §12 de l'état.
- DA de la maquette pour l'instant (Figtree, fond gris chaud, cartes blanches, bleu voile, rouille course, vert Enregistrer), appelée à changer : tout passe par les variables. Navigation : barre d'onglets en bas sur téléphone, barre en haut sur ordinateur.
- Réglages d'affichage (unités, taille du texte) choisis dans Réglages seulement, par famille (voile, course), actifs partout ; par sous-sport plus tard peut-être.
- Diffusion : APK signé partagé par lien d'abord, lien web ensuite.
