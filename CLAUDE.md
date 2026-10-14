# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Tracker : analyse de sessions sportives à partir de traces GPX

Application 100 % client (React 19, TypeScript, Vite 8, Recharts, Leaflet), sans backend. Modules voile (`/voile` : wingfoil, planche, kite, bateau), course (`/course`), vélo (`/velo`) et fractionné (`/fractionne`), ces trois derniers sur un module d'analyse commun (`LandModule`), surf (`/surf`), pages `/enregistrer`, `/itineraires` et `/parametres`. Interface et commentaires en français. Application Android via Capacitor, avec enregistrement GPS natif et mémoire en dossier portable.

Chaque information a une seule place :
- `docs/ETAT_DU_PROJET.md` : pipeline, persistance, dette, chantiers, et **l'avancement du plan mobile (§12), tenu là seulement**. Le lire avant de toucher au noyau ou aux analyses voile.
- `docs/DECISIONS.md` : les décisions de l'utilisateur propres à un domaine (voile, course et vélo, sauts, surf, fractionné, enregistrement, planification, mémoire) ; les transverses restent ici. Lire la section du domaine avant d'y toucher (table plus bas).
- `docs/HISTORIQUE.md` : décisions et pièges, en points numérotés (« §10, point N ») ; le consulter par recherche sur le sujet, pas en entier.
- `docs/INVENTAIRE.md` : carte des fichiers ; les signatures se lisent dans le code.
- `docs/MISE_EN_PAGE.md` : patron commun des pages d'analyse (structure, règles ordinateur et téléphone, pièces partagées). Le suivre pour toute page d'analyse, existante ou nouvelle.

## Commandes

```
npm run dev          serveur de développement
npx tsc -b --force   typecheck (strict, noUnusedLocals, verbatimModuleSyntax)
npm run lint         oxlint
npx vitest run       tests, fonctions pures uniquement, environnement node
npx vitest run src/sailing/wind.test.ts -t "nom"   un fichier, un test
npm run build        tsc -b && vite build
```

Android (JDK 21, procédure au §12 de l'état) : `npm run build`, `npx cap sync android`, puis, dans le shell de Claude, `android\gradlew.bat assembleRelease` et `adb install -r`. APK signé par une clé dédiée, hors du dépôt (`android/keystore.properties`, ignoré) : ne jamais la régénérer ni la versionner. Version unique dans `package.json`, à augmenter avant chaque APK diffusé.

Après toute modification, dans cet ordre : typecheck, lint, tests, build. Tous doivent passer.

## Documentation

- Une passe après chaque lot que l'utilisateur a validé sur données réelles, jamais entre deux modifications, sans attendre la fin de session : sections touchées d'ETAT (jamais le récit du lot, qui va dans HISTORIQUE), un point daté de quelques lignes dans HISTORIQUE (décision, pourquoi, piège ; ni fichiers touchés ni récit de livraison, que git garde), la carte d'INVENTAIRE si un fichier apparaît ou change de rôle.
- `CLAUDE.md` : seulement si une règle ou une décision transverse de l'utilisateur a changé ; une décision propre à un domaine va dans la section de `docs/DECISIONS.md`. Ni état d'avancement, ni procédure détaillée, dans l'un comme dans l'autre.

## Environnement

- Dépôt git, doublé d'un dépôt GitHub privé (`segneur34/Tracker`) : un commit par lot validé, un envoi après accord de l'utilisateur. Un lot couvre un sujet entier (plusieurs étapes), pas une petite étape isolée : peu de lots, donc peu de commits. Fins de ligne fixées par `.gitattributes` : LF partout, CRLF pour les `.bat`.
- Banc de test dans `outils/banc/` (mode d'emploi dans son `LISEZMOI.md`) : Claude y éprouve lui-même l'application dans un Chrome sans fenêtre ; il prouve la neutralité d'un changement par le texte de la page relevé avant et après.
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
9. Un module ne reprend que les activités de sa famille : `useSportSettings(family)`.
10. Cadence variable : une application économique peut compresser un virage entier dans un seul intervalle. Ne jamais supposer plusieurs points dans une fenêtre de quelques secondes.
11. react-leaflet : le style d'un `Polyline` passe toujours par `pathOptions`, sinon il n'est pas réappliqué.
12. Stockage, fichiers, position, son, vibreur, capteurs et notification : uniquement via `src/platform/` (`storage.ts`, `files.ts`, `memoryFolder.ts`, `location.ts`, `beeper.ts`, `motion.ts`, `notification.ts` ; jamais `localStorage`, `Filesystem`, `showDirectoryPicker`, `navigator.geolocation`, Web Audio, `navigator.vibrate` ni `DeviceMotionEvent` en direct). Chaque module y choisit sa version navigateur ou téléphone par `isNativeApp()`.

## Où ajouter quoi

- Nouveau calcul de support : `SPORT_PROFILES` et `SAILING_SPORTS` (`core/sportProfiles.ts`). Une activité (moth, trail…) n'est jamais en dur : l'utilisateur la crée dans Réglages sur un de ces calculs (`core/activities.ts`).
- Famille et traitement d'un calcul : la famille range ses sessions (bibliothèque, accueil, barre, listes d'activités, Réglages : `sportFamily`), le traitement dit comment elles se calculent et s'affichent (unités, énergie, vélo, altitude, revêtement, chiffres du direct : `sportTreatment`). Ranger par la famille, calculer par le traitement ; le fractionné les distingue.
- Réglage utilisateur : `StoredSettings` (`hooks/useSportSettings.ts`), rangé par identifiant d'activité, `useAllSportSettings`, `pages/SettingsPage.tsx`.
- Page d'analyse d'un nouveau sport : suivre `docs/MISE_EN_PAGE.md` (`AnalysisMap`, `analysisMobile.css`, `PanelTitle`, `SessionNameEditor`) ; ce qui devient commun à deux modules va dans une pièce partagée, pas dans une copie.
- Section de module : `*_SECTIONS` et `*_SECTION_DEFAULTS` de la page, et un bloc `{open.cle && ...}` dans un `ResizablePanel` d'`id` unique (l'`id` est la clé de la taille mémorisée : ne pas le renommer). En voile : `SAILING_PANELS`, une seule barre d'onglets, dans la colonne de la carte.
- Graphe relié à la carte : chaque ligne porte l'`index` du point de trace, et le survol passe par `hoveredTrackIndex` (`components/chartHover.ts`), un seul repère sur la carte (`components/HoverMarker.tsx`). Pas de `any`.
- Surbrillance sur la carte d'une analyse (top, podium, zone de pente, répétition, saut) : par `useMapHighlight`, rattachée à son onglet, couleurs de `components/highlightColors.ts`.
- Métrique de manœuvre : `ManeuverLocation` (`sailing/maneuvers.ts`), puis `MANEUVER_METRICS` et `summarizeManeuvers` (`sailing/sailingAnalytics.ts`).
- Donnée propre à une session (notes, vent saisi, seuil d'activité, allure imposée, foil, terrain, support et activité) : dans sa fiche (`library/record.ts`), écrite par `updateSessionRecord` ; dans le module, par le brouillon (`useSessionDraft`, `library/sessionEdits.ts`) et « Enregistrer la session » ; jamais dans une clé de l'appareil. Une donnée recalculable depuis le GPX va dans `summary`, avec `SUMMARY_CALC_VERSION` augmenté si son calcul change.
- Calcul pur : dans `core/`, `sailing/`, `running/`, `cycling/`, `surfing/`, `planning/`, `recording/` ou `library/`, avec son `*.test.ts` sur trace synthétique.
- Couleur, police, rayon, espacement : une variable de `src/theme/tokens.css`, jamais une valeur en dur dans un écran neuf. Composants communs dans `components/ui`, icônes dans `components/icons.tsx` (pas d'emoji). Les couleurs de données des graphes et de la carte restent en dur (attributs SVG).

## Décisions de l'utilisateur

Celles d'un domaine sont dans `docs/DECISIONS.md`, qui a la même autorité que ce fichier. Avant de toucher à un domaine, lire sa section :

| Avant de toucher à | Section de `DECISIONS.md` |
|---|---|
| `sailing/`, `SailingModule`, vent, manœuvres, foil, balises (`markGuide`, `useMarkGuide`) | 1. Voile |
| `running/`, `cycling/`, `LandModule`, graphes et leur zoom, pente, énergie, altitude (`useTerrainElevation`), revêtement (`planning/surface.ts`, `useSessionSurfaces`) | 2. Course et vélo |
| sauts (`core/jumps.ts`, `platform/motion.ts`, `useSessionJumps`, `JumpsPanel`) | 3. Sauts |
| `surfing/`, `SurfModule` | 4. Surf |
| compteur d'intervalles et répétitions (`recording/intervalTimer.ts`, `useIntervalTimer`, onglet « fractionné ») | 5. Fractionné |
| `recording/`, `useRecorder`, `RecordingPage`, pause, journal | 6. Enregistrement |
| `planning/`, `PlanningPage`, `RoutesPage`, `usePlannedRoute`, profil BRouter (coûts des types de voie fixés avec l'utilisateur : ne pas les retoucher sans lui) | 7. Planification et itinéraires |
| `library/`, `useSessionLibrary`, `platform/memoryFolder.ts`, `platform/tileCache.ts`, réglages par appareil, GPX téléchargé | 8. Mémoire et fichiers |

Décisions transverses :

- Couleur de trace : dégradé continu sur une échelle absolue (`core/speedGradient.ts`), gris sous la borne basse, bornes réglables par support dans Réglages et par trace dans son analyse ; ni échelle relative ni paliers ; une seule coloration d'une session, la même dans son analyse et sa vignette (`core/trackColor.ts`), lissée sur 15 s à pied et à vélo, pas en voile ni en surf. Course : 4 à 15 km/h ; vélo : 10 à 40 km/h ; surf : 5 à 30 km/h. Voile : seuil d'activité et bornes suggérés par l'allure de la session, selon des règles fixées par l'utilisateur (`suggestActiveThresholdKn`, `suggestSpeedRangeMs` dans `sailing/sailingConfig.ts`, HISTORIQUE point 29) : ne pas les retoucher sans lui. Bornes effectives : celles de la trace (sa fiche, réglées dans l'onglet réglages de son analyse), sinon celles du support dans Réglages, sinon la suggestion ou le défaut ; la légende, compacte et posée sur la carte à gauche de la mention OSM, ne fait qu'afficher.
- Session : vent saisi, seuil d'activité, allure imposée, couleurs de la trace, terrain (course, vélo) et notes restent en brouillon jusqu'à « Enregistrer la session » (Annuler, avertissement en quittant). Le seuil est propre à chaque session, dans sa fiche, et prime sur celui du support ; de même le terrain, dont Réglages donne celui par défaut de l'activité. Le support se change immédiatement.
- Tout bloc est redimensionnable (`ResizablePanel`), taille mémorisée.
- Analyses sur ordinateur, même disposition en voile, course et vélo : carte en haut, centrée, plus étroite que la page (80 %) pour faire défiler la page à la souris à côté d'elle (la molette zoome toujours la carte) ; onglets dessous ; panneaux deux par ligne.
- Voile : manœuvres en petit tableau, détails dépliables. Une seule barre d'onglets : général, tops, manœuvres, graphiques, VMG, sauts (si la session a ses capteurs), vent, matos et conditions, réglages (dans cet ordre). « Général » porte les chiffres globaux (vitesse moyenne et moyenne active comprises) et le vent ; seul ouvert par défaut, il se replie pour comparer tableaux et carte. La course et le vélo ont aussi leur onglet « général » en tête, seul ouvert au départ avec « fractionné » quand il existe, et leurs graphes sous l'onglet « vitesse et altitude ». Les onglets ouverts sont ensuite mémorisés par module. Sur téléphone, l'en-tête des analyses tient sur une ligne au-dessus de la carte, onglets en petites pastilles. Ne rien déplacer ni dupliquer sans redemander.
- Activités : l'utilisateur crée les siennes (nom, couleur prise parmi les nuances de sa famille, calcul de base), au départ « Voile », « Course », à vélo « Route », « Gravel » et « VTT », en fractionné « Fractionné à pied » et « Fractionné vélo » ; elles seules sont proposées partout (Enregistrer, analyses, bibliothèque, accueil). Dans Réglages, rangées par famille. Une activité supprimée garde ses sessions, sous le nom de leur calcul. Un œil dans Réglages cache une famille ou une activité : absente partout, sessions et itinéraires compris, rien d'effacé ; une famille sans activité visible est cachée ; une adresse s'ouvre toujours, et l'analyse d'une session cachée garde son activité.
- Activité d'une session : celle de la trace suivie est proposée à l'enregistrement ; elle se change pendant l'enregistrement et dans l'onglet réglages de l'analyse, d'une famille à l'autre comprise (recalcul complet, la session change de module).
- DA de la maquette pour l'instant (Figtree, fond gris chaud, cartes blanches, vert Enregistrer), appelée à changer : tout passe par les variables. Une couleur par famille (bleu voile, rouge course, vert vélo, orange fractionné, gris surf), qui porte du texte blanc ; chaque activité prend une des six nuances de sa famille. Le bouton rond garde son vert et son rouge, le tracé de la planification son bleu. Mode daltonien prévu plus tard.
- Navigation : barre en haut sur ordinateur, avec toutes les destinations (familles cachées exceptées ; le favori ou le secondaire caché retombe sur une famille visible, le choix gardé). Sur téléphone, une barre en bas de cinq cases, le bouton rond au milieu :
  - Accueil ;
  - le sport favori, choisi dans Réglages (voile par défaut) ;
  - le bouton rond ;
  - le sport secondaire, ou « Planifier », choisi dans Réglages et retenu ; un appui long (1 s par défaut, réglable) montre un grand cadran puis le menu des autres sports et de « Planifier », et le choix devient le secondaire ;
  - Réglages.
- Réglages d'affichage (unités de vitesse et de distance) choisis dans Réglages seulement, par activité (donc par support : bateau et wing peuvent différer), actifs partout ; distance en km par défaut, milles nautiques au choix. Pas de réglage de la taille du texte : retiré le 09/10, jugé inutile. La pause automatique, les chiffres de la carte réduite à l'enregistrement (quatre au plus), ceux de la notification lisible écran verrouillé (trois au plus : vitesse, moyenne, distance par défaut ; avec le compteur du fractionné, la phase et son décompte en plus ; « en pause », chiffres figés, en pause manuelle), le terrain par défaut des sessions, le type et le poids du vélo, le niveau du temps estimé et les types de voie cochés d'office se règlent aussi par activité, dans sa carte de Réglages, rangés en parties repliables (affichage, analyse, enregistrement, notification, itinéraires, balises sonores), fermées au départ, état retenu pour toutes les activités.
- Choix d'une activité : une liste dessinée par l'application (famille à gauche, activités décalées dessous, un trait entre familles), jamais le menu natif d'Android.
- Surbrillances sur la carte des analyses : une seule à la fois (top, podium de manœuvres, zone de pente, répétition, saut, revêtement), effacée quand son onglet se ferme et pas ramenée à sa réouverture ; les virements et empannages de la voile restent des cases à part, cumulables. Podiums aux couleurs rouge, orange, vert ; passage seul en violet.
- Diffusion : APK signé partagé par lien d'abord, lien web ensuite.
- Bibliothèques : vignette carte toujours affichée, à droite des chiffres de chaque session.
