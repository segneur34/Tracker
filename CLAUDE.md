# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Tracker : analyse de sessions sportives à partir de traces GPX

Application 100 % client (React 19, TypeScript, Vite 8, Recharts, Leaflet), sans backend. Modules voile (`/voile` : wingfoil, planche, kite, bateau), course (`/course`), vélo (`/velo`) et fractionné (`/fractionne`), ces trois derniers sur un module d'analyse commun (`LandModule`), surf (`/surf`), pages `/enregistrer`, `/itineraires`, `/statistiques` et `/parametres`. Interface et commentaires en français. Application Android via Capacitor, avec enregistrement GPS natif et mémoire en dossier portable.

Chaque information a une seule place :
- `docs/ETAT_DU_PROJET.md` : pipeline, persistance, dette et limites connues, et **l'avancement du plan mobile (§12), tenu là seulement**. Le lire avant de toucher au noyau ou aux analyses voile.
- `docs/DECISIONS.md` : les décisions de l'utilisateur propres à un domaine, en sections 1 à 11 (voile, course et vélo, sauts, surf, fractionné, enregistrement, planification, mémoire, Profil, Statistiques, Réglages et accueil) ; les transverses restent ici. Lire la section du domaine avant d'y toucher (table plus bas).
- `docs/HISTORIQUE.md` : décisions et pièges, en points numérotés (« §10, point N ») ; le consulter par recherche sur le sujet, pas en entier.
- `docs/INVENTAIRE.md` : carte des fichiers ; les signatures se lisent dans le code.
- `docs/MISE_EN_PAGE.md` : patron commun des pages d'analyse (structure, règles ordinateur et téléphone, pièces partagées). Le suivre pour toute page d'analyse, existante ou nouvelle.
- `docs/BACKLOG.md` : le seul reste à faire : lots, idées, dette, essais au téléphone, questions ; `docs/backlog/` pour les détails ; `node outils/backlog.mjs` pour le tableau de bord.
- `docs/MODELES.md` : quel modèle (Fable, Opus, Sonnet, Haiku) et quel effort pour quelle tâche, et les sous-agents de `.claude/agents/`.

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

Android (JDK 21) : procédure, signature et version au §12 de l'état ; clé hors dépôt, jamais régénérée ni versionnée ; version unique dans `package.json`, à augmenter avant chaque APK diffusé.

Vérifications, toutes doivent passer :
- pendant le travail, après une modification du code : typecheck, lint, `vitest run --changed` ;
- à la fin de chaque étape rendue à l'utilisateur, et avant tout commit, banc ou APK : lint, tous les tests, build (qui fait le typecheck) ;
- rien pour une modification de la seule documentation.

Vérifications, banc et passe de doc passent par les sous-agents `verif`, `banc` et `doc` (`.claude/agents/`, modèles légers), sauf une commande seule dont la sortie tient en quelques lignes.

## Documentation

- Une passe après chaque lot que l'utilisateur a validé sur données réelles, jamais entre deux modifications, sans attendre la fin de session : sections touchées d'ETAT (jamais le récit du lot, qui va dans HISTORIQUE), un point daté de quelques lignes dans HISTORIQUE (décision, pourquoi, piège ; ni fichiers touchés ni récit de livraison, que git garde), la carte d'INVENTAIRE si un fichier apparaît ou change de rôle.
- `CLAUDE.md` : seulement si une règle ou une décision transverse de l'utilisateur a changé ; une décision propre à un domaine va dans la section de `docs/DECISIONS.md`. Ni état d'avancement, ni procédure détaillée, dans l'un comme dans l'autre.

## Environnement

- Dépôt git, doublé d'un dépôt GitHub privé (`segneur34/Tracker`) : un commit par lot vérifié, marqué « à valider » ; validation par paquets en mode chaîne (`docs/MODELES.md`, `docs/BACKLOG.md` fait foi) ; un envoi après accord de l'utilisateur. Un lot couvre un sujet entier (plusieurs étapes), pas une petite étape isolée : peu de lots, donc peu de commits. Fins de ligne fixées par `.gitattributes` : LF partout, CRLF pour les `.bat`.
- Banc de test dans `outils/banc/` (mode d'emploi dans son `LISEZMOI.md`) : Claude y éprouve lui-même l'application dans un Chrome sans fenêtre ; il prouve la neutralité d'un changement par le texte de la page relevé avant et après.
- Essais au téléphone : n'en demander que peu, les vraiment critiques (ce que ni les tests ni le banc ne peuvent voir : GPS, capteurs, ceinture, notification, écran éteint, rendu tactile) et ceux où Claude a un vrai doute ; une question à trancher par l'utilisateur en fait partie. Tout ce que le banc ou les tests prouvent (changement neutre, chiffres identiques, mise en page relevée) n'y va pas. Quelques essais par paquet, jamais une longue liste. Ils vont dans `docs/BACKLOG.md`, en sous-lignes de leur lot.
- Windows 11, terminal `cmd` : ne jamais donner de commande PowerShell à recopier. L'utilisateur colle parfois lui-même la sortie.
- Aucun GPX réel dans le projet : les tests sont synthétiques, la validation sur données réelles revient à l'utilisateur.
- Une question d'algorithmique peut partir chez Gemini : la formuler de façon autonome et complète.
- Choix du modèle et de l'effort par tâche : `docs/MODELES.md` ; la colonne « Modèle | Réflexion » des briefs s'en déduit. Si le modèle de la session est nettement inadapté à la demande (gros décalage, dans les deux sens), le dire dans le premier message, avant tout travail, et proposer le modèle adapté.

## Règles d'architecture

1. `src/core/` en unités SI (m/s, m, s ou ms, caps en degrés). Conversion en sortie seulement (`core/units.ts`, profil du support).
2. Fenêtres en secondes, jamais en nombre de points : une trace à 1 Hz et à 5 Hz donne le même résultat (testé).
3. Aucun seuil en dur dans un calcul : il vient de `SPORT_PROFILES`, est passé en paramètre, surchargeable, et la surcharge est persistée.
4. En voile, un seuil de vitesse s'accorde à l'allure de la session (`core/sessionSpeed.ts`), surchargeable. Les valeurs du profil sont des plafonds : la mise à l'échelle ne fait qu'abaisser. Elle est appliquée dans les hooks, jamais par défaut dans les calculs (tests neutres). Préférer un rapport sans dimension à des nœuds absolus (vol perdu : conservation de vitesse sous 0,5).
5. `sailing/*` travaille en nœuds sur `PointData` (`utils/kinematics.ts`) : héritage assumé, pas de conversion sans plan dédié.
6. Distance = intégrale de la vitesse retenue (`segmentDistanceM`), ni celle du fichier ni une somme de Haversine ; seule exception, le trou de trace (pas plus long que `maxGapS`, 10 s), borné par la corde × 1,5 et hors du mouvement s'il est immobile (`gapDistanceM`, posé par `computeKinematics`).
7. Vent : lu à la bissectrice de chaque manœuvre classée, toutes comprises ; statistiques pondérées par la symétrie du virage, jamais filtrées (`calculateWindStats`). L'estimation globale (`estimateWind`) repose sur la polaire et les manœuvres à caps stabilisés (`windSamplesFrom`). Polaire glissante et corde entrée → sortie ont été essayées puis retirées : ne pas les réintroduire.
8. Lecteur GPX maison (`core/gpxParser.ts`) : ne pas réinstaller `gpxparser`, qui ignore les extensions (Doppler, FC, cadence).
9. Un module ne reprend que les activités de sa famille : `useSportSettings(family)`.
10. Cadence variable : une application économique peut compresser un virage entier dans un seul intervalle. Ne jamais supposer plusieurs points dans une fenêtre de quelques secondes.
11. react-leaflet : le style d'un `Polyline` passe toujours par `pathOptions`, sinon il n'est pas réappliqué.
12. Stockage, fichiers, position, son, vibreur, capteurs, ceinture cardio, autorisations, notification, écran allumé et orientation figée : uniquement via `src/platform/` (`storage.ts`, `files.ts`, `memoryFolder.ts`, `location.ts`, `beeper.ts`, `motion.ts`, `notification.ts`, `screen.ts`, `heartRate.ts`, `permissions.ts` ; jamais `localStorage`, `Filesystem`, `showDirectoryPicker`, `navigator.geolocation`, Web Audio, `navigator.vibrate`, `navigator.wakeLock`, `screen.orientation` ni `DeviceMotionEvent` en direct). Chaque module y choisit sa version navigateur ou téléphone par `isNativeApp()`.

## Où ajouter quoi

- Nouveau calcul de support : `SPORT_PROFILES` et `SAILING_SPORTS` (`core/sportProfiles.ts`). Une activité (moth, trail…) n'est jamais en dur : l'utilisateur la crée dans Réglages sur un de ces calculs (`core/activities.ts`).
- Famille et traitement d'un calcul : la famille range ses sessions (bibliothèque, accueil, barre, listes d'activités, Réglages : `sportFamily`), le traitement dit comment elles se calculent et s'affichent (unités, énergie, vélo, altitude, revêtement, chiffres du direct : `sportTreatment`). Ranger par la famille, calculer par le traitement ; le fractionné les distingue.
- Réglage utilisateur : `StoredSettings` (`hooks/useSportSettings.ts`), rangé par identifiant d'activité, `useAllSportSettings`, `pages/SettingsPage.tsx` ; son pré-réglage dans `core/activityPresets.ts`, lu par la fonction de défaut du hook.
- Page d'analyse d'un nouveau sport : suivre `docs/MISE_EN_PAGE.md` (`AnalysisMap`, `analysisMobile.css`, `PanelTitle`, `SessionNameEditor`) ; ce qui devient commun à deux modules va dans une pièce partagée, pas dans une copie.
- Section de module : une entrée dans la liste du module (`core/analysisTabs.ts`), puis `*_SECTION_DEFAULTS` de la page et un bloc `{open.cle && ...}` dans un `ResizablePanel` d'`id` unique (l'`id` est la clé de la taille mémorisée : ne pas le renommer). Un onglet repris d'un autre module porte `generic` et sa pièce est partagée (`TopsPanel`). En voile : une seule barre d'onglets, dans la colonne de la carte.
- Graphe relié à la carte : chaque ligne porte l'`index` du point de trace, et le survol passe par `hoveredTrackIndex` (`components/chartHover.ts`), un seul repère sur la carte (`components/HoverMarker.tsx`). Pas de `any`.
- Surbrillance sur la carte d'une analyse (top, podium, zone de pente, répétition, saut) : par `useMapHighlight`, rattachée à son onglet, couleurs de `components/highlightColors.ts`.
- Métrique de manœuvre : `ManeuverLocation` (`sailing/maneuvers.ts`), puis `MANEUVER_METRICS` et `summarizeManeuvers` (`sailing/sailingAnalytics.ts`).
- Donnée propre à une session (notes, vent saisi, seuil d'activité, allure imposée, foil, pumping, poids du vélo, charge portée, repères du bouton « Note », support et activité) : dans sa fiche (`library/record.ts`), écrite par `updateSessionRecord` ; dans le module, par le brouillon (`useSessionDraft`, `library/sessionEdits.ts`) et « Enregistrer la session » ; jamais dans une clé de l'appareil. Une donnée recalculable depuis le GPX va dans `summary`, avec `SUMMARY_CALC_VERSION` augmenté si son calcul change.
- Test guidé (FC max, plus tard VMA) : un protocole dans `FITNESS_TESTS` (`recording/fitnessTest.ts`), ses résultats dans `running/fitnessTestResults.ts`, sa case dans la rangée « Test » d'Enregistrer et sa tuile dans `TestsPage`.
- Calcul pur : dans `core/`, `sailing/`, `running/`, `cycling/`, `surfing/`, `planning/`, `recording/` ou `library/`, avec son `*.test.ts` sur trace synthétique.
- Couleur, police, rayon, espacement : une variable de `src/theme/tokens.css`, jamais une valeur en dur dans un écran neuf. Composants communs dans `components/ui`, icônes dans `components/icons.tsx` (pas d'emoji). Les couleurs de données des graphes et de la carte restent en dur (attributs SVG).

## Décisions de l'utilisateur

Celles d'un domaine sont dans `docs/DECISIONS.md`, celles de la disposition des analyses dans `docs/MISE_EN_PAGE.md`, de même autorité que ce fichier. Avant de toucher à un domaine, lire sa section :

| Avant de toucher à | Section de `DECISIONS.md` |
|---|---|
| `sailing/`, `SailingModule`, vent, manœuvres, foil, balises (`markGuide`, `useMarkGuide`) | 1. Voile |
| `running/`, `cycling/`, `LandModule`, graphes et leur zoom, pente, énergie, altitude (`useTerrainElevation`), revêtement (`planning/surface.ts`, `useSessionSurfaces`) | 2. Course et vélo |
| sauts (`core/jumps.ts`, `platform/motion.ts`, `useSessionJumps`, `JumpsPanel`) | 3. Sauts |
| `surfing/`, `SurfModule` | 4. Surf |
| compteur d'intervalles et répétitions (`recording/intervalTimer.ts`, `useIntervalTimer`, onglet « fractionné »), page Entraînement, tests (`fitnessTest`, `restingHrTest`, onglet « test ») | 5. Fractionné |
| `recording/`, `useRecorder`, `RecordingPage`, pause, journal | 6. Enregistrement |
| `planning/`, `PlanningPage`, `RoutesPage`, `usePlannedRoute`, profil BRouter (coûts des types de voie fixés avec l'utilisateur : ne pas les retoucher sans lui) | 7. Planification et itinéraires |
| `library/`, `useSessionLibrary`, `SessionLibrary`, `platform/memoryFolder.ts`, `platform/tileCache.ts`, fond des cartes (`BaseTileLayer`), réglages par appareil, GPX téléchargé | 8. Mémoire et fichiers |
| `pages/ProfilePage`, `library/rootGrowth`, `ProfileRoot`, `ProfileAvatar`, `ProfilePrompt` | 9. Profil |
| `pages/StatisticsPage` | 10. Statistiques |
| `pages/SettingsPage`, `pages/Home`, `core/activities`, `core/activityPresets` | 11. Réglages et accueil |

Décisions transverses (un « § » renvoie ici à une section de `DECISIONS.md`) :

- Disposition des analyses (carte, onglets, panneaux redimensionnables à taille mémorisée, téléphone et téléphone tourné, aides « ? », surbrillance unique sur la carte) : `docs/MISE_EN_PAGE.md`.
- Couleur de trace : dégradé continu sur une échelle absolue (`core/speedGradient.ts`), gris sous la borne basse, bornes réglables par support dans Réglages et par trace dans son analyse ; ni échelle relative ni paliers ; une seule coloration d'une session, la même dans son analyse et sa vignette (`core/trackColor.ts`), lissée sur 15 s à pied et à vélo, pas en voile ni en surf. Bornes effectives : celles de la trace (sa fiche, réglées dans l'onglet réglages de son analyse), sinon celles du support dans Réglages, sinon le pré-réglage de l'activité, la suggestion du kite en voile, ou celles du traitement (valeurs aux §1, §2, §4) ; la légende, compacte et posée sur la carte à gauche de la mention OSM, ne fait qu'afficher.
- Session : vent saisi, seuil, allure imposée, couleurs de la trace, poids du vélo, charge portée, repères et notes restent en brouillon jusqu'à « Enregistrer la session » (Annuler, avertissement en quittant). Le seuil est propre à chaque session, dans sa fiche, et prime sur celui du support ; de même le poids du vélo et la charge portée, dont Réglages donne ceux par défaut de l'activité. Le support se change immédiatement.
- « Général » et « avancé », dans toutes les analyses : la barre commence par « général » (et « fractionné » en famille Fractionné), puis une pastille « avancé » qui déplie dessous les autres onglets, dans leur ordre ; refermée, elle replie ses onglets et leurs panneaux, rendus tels quels à sa réouverture ; l'ouvrir ferme « général », la refermer le rouvre ; une session autre que la dernière analysée s'ouvre sur « général » seul, « avancé » fermé. « Général » porte l'essentiel des chiffres (liste par sport aux §1, §2, §4), le reste est sous « avancé » ; l'image de partage garde la liste entière.
- Onglets des analyses : ordre par sport aux §1, §2, §4, onglets montrés choisis par activité (§11). Chaque graphe se replie à sa place, partout (voile et surf compris), dès qu'un panneau en a plusieurs. Les onglets avancés ouverts sont mémorisés par module et rendus à la réouverture d'« avancé ». Sur téléphone, l'en-tête des analyses tient sur une ligne au-dessus de la carte, onglets en petites pastilles. Ne rien déplacer ni dupliquer sans redemander.
- Matériel et notes : un onglet dans toutes les analyses, juste avant « réglages » (« matos et conditions » en voile), avec partout l'appréciation et le commentaire ; champs hors voile au §2 ; aucun matériel repris d'une autre session, vide si pas donné (§8).
- Activités : l'utilisateur crée les siennes (nom, couleur prise parmi les nuances de sa famille, calcul de base), au départ « Voile », à pied « Course » et « Marche », à vélo « Route », « Gravel » et « VTT », en surf « Surf » et « Surf foil », en Entraînement (identifiant `fractionne`) « Fractionné à pied », « Fractionné vélo » et « Tests » ; elles seules sont proposées partout (Enregistrer, analyses, bibliothèque, accueil), dans une liste dessinée par l'application, jamais le menu natif d'Android. Cette liste, leur rangement dans Réglages et l'œil qui les cache : §11. Une activité supprimée garde ses sessions, sous le nom de leur calcul. Une adresse s'ouvre toujours, même d'une famille ou d'une activité cachée, et l'analyse d'une session cachée garde son activité.
- Activité d'une session : celle de la trace suivie est proposée à l'enregistrement ; elle se change pendant l'enregistrement et dans l'onglet réglages de l'analyse, d'une famille à l'autre comprise (recalcul complet, la session change de module).
- Pré-réglages : chaque activité de départ démarre sur les réglages du téléphone de l'utilisateur, sa référence en cas de doute (`core/activityPresets.ts`) ; ils sont le « défaut » de Réglages, et une activité créée prend ceux de son calcul. Des pré-réglages changés effacent une fois les anciens réglages qu'ils couvrent (`PRESET_RESETS`). Valeurs par sport aux §1, §2.
- Réglages d'affichage (unités de vitesse et de distance) choisis dans Réglages seulement, par activité (donc par support : bateau et wing peuvent différer), actifs partout ; distance en km par défaut, milles nautiques au choix. Les autres réglages par activité sont dans la section de leur domaine.
- DA de la maquette Canva : Montserrat, logo en Shrikhand, fond gris bleuté, cartes blanches, vert Enregistrer ; tout passe par les variables. Typographie de l'accueil partout : titres en capitales légères espacées, boutons d'action en capitales grasses (`--title-*`, `--action-*`), onglets et pastilles dans leur casse. Une couleur par famille (bleu voile #004aad, rouge à pied #d11a1a, vert vélo #2c7231, orange fractionné, gris surf), qui porte du texte blanc ; chaque activité prend une des six nuances de sa famille ; familles dans l'ordre Voile, À pied, Vélo, Surf, Fractionné. Accueil, bibliothèques et fonds de page : §11. Choix parmi quelques options : bouton glissant (`SegmentedControl`), dont la case s'attrape et glisse. Le bouton rond garde son vert et son rouge, le tracé de la planification son bleu.
- Navigation : barre en haut sur ordinateur, avec toutes les destinations, « Statistiques » puis « Profil » avant Réglages (familles cachées exceptées) ; l'accueil par le logo « Tracker », sans lien « Accueil » en haut ; la barre tient sur une ligne dès 1000 px. Sur téléphone, une barre en bas fixe de cinq cases : Accueil, Profil, le bouton rond au milieu, Statistiques, Réglages, en rail à gauche sur téléphone tourné ; les sports et « Planifier » s'ouvrent depuis l'accueil, qui n'a pas de lien vers Profil ni Statistiques. Ni sport favori ni case secondaire. Le retour d'Android ferme d'abord une vue posée sur la page (carte en plein écran, avec ou sans graphes), puis mène à la page au-dessus, pas dans l'historique (analyse, bibliothèque, accueil ; Statistiques remonte d'un cran à chaque fois) ; un brouillon non enregistré demande toujours confirmation.
- Reste à faire (`docs/BACKLOG.md`, tenu par Claude, jamais ouvert par l'utilisateur) : quatre zones, Maintenant (3 lots avec essais au téléphone au plus), Ensuite (l'ordre est la priorité, 7 au plus), Ça attend une occasion, Plus tard (90 jours, puis proposé à l'abandon) ; 5 questions au plus, chacune avec sa réponse par défaut.
  - Rangement d'une idée en trois questions posées en clair : un chiffre faux ou un usage cassé (tête d'Ensuite) ; servira-t-elle à la prochaine sortie (Ensuite, sinon Plus tard) ; petit ou gros (petit et utile d'abord). Pas de note de priorité.
  - Les essais au téléphone sont des sous-lignes de leur lot ; fait = ligne supprimée après la passe `doc`. Revue de la semaine par `/todo` sans argument.
  - Simple pour un néophyte : ce que l'utilisateur lit (tableau de bord, comptes rendus, questions) ne porte aucun jargon.
