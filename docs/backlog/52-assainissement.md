# 52 · Assainissement : doublons, optimisation, architecture (audit du 28/10/2026)

- Audit général en lecture seule du 28/10 (commit 86b3f8d) par huit agents, un par zone ; cette fiche en est la synthèse dédoublonnée. Elle se suffit à elle-même : les rapports d'origine ne sont pas gardés (voir « Sources »).
- But de l'utilisateur : assainir le code avant un gros fork, à poids égal sur trois axes : doublons, vitesse (calculs refaits, rendus inutiles), rangement (architecture). Les bogues trouvés sont notés ici ; ceux qui touchent aux données ont leur lot (54).
- Base saine : aucun `any`, aucun `@ts-ignore`, aucun import circulaire, aucune classe CSS morte, règle 12 respectée hors de `platform/`, règle 11 respectée partout, aucun hook jamais appelé.
- Doublons : la coquille des quatre modules d'analyse (environ 500 lignes recopiées), le squelette des graphes reliés à la trace (15 copies), une trentaine de petites fonctions (message d'erreur, angles, arrondis, dates, recherche dans le temps, médiane), les générateurs de traces des tests (26 fichiers), la mise en route du banc (63 scripts).
- Vitesse, mesurée : ouverture d'une session de 3 h à 5 Hz, environ 600 ms de noyau sur PC (2 à 3 s au téléphone), environ 200 ms visés (lot 56) ; médiane glissante 65 à 138 ms ramenée à 7 à 9 ms, meilleurs segments 129 à 193 ms ramenés à 27 ms, sans aucun écart de chiffre ; trace colorée en 54 000 couches de carte ramenée à une (lot 73).
- Rendus : la page Enregistrer redessinée à chaque position GPS, la planification à chaque survol du profil, les Statistiques à chaque fiche pendant le balayage du dossier, toute une analyse à chaque image d'un zoom.
- Architecture : des « hooks » de 900 à 2 000 lignes qui sont des services, environ 1 000 lignes de calcul pur dans `useSportSettings.ts`, un noyau qui importe des types des domaines, des calculs purs non testés dans `components/` et `pages/`.
- Bogues : 6 risques de perte ou d'écrasement de données, 5 blocages d'usage, une vingtaine de chiffres faux ou fragiles, une trentaine de défauts mineurs ; tous listés et rattachés à un lot.
- Plan : 30 lots numérotés 53 à 82, chacun un sujet entier, exécutables par l'agent `lot` sur Sonnet ou Opus ; Fable seulement pour le lot 79 (chiffres de la voile). Les neutres et les fondations d'abord ; les lots qui changent un chiffre ou l'écran après la réponse à leur question.
- 18 questions pour l'utilisateur (Q32 à Q49), chacune avec sa réponse par défaut ; trois sont posées dans `docs/BACKLOG.md` (Q32 à Q34), les autres sont tranchées par défaut sans réponse.

Numérotation : Q31 a déjà servi (n° 50, pumping en wing, répondue le 28/10) alors que l'en-tête de `docs/BACKLOG.md` l'annonçait libre ; les questions de cette fiche partent donc de Q32.

## Résumé par axe

**Doublons** (113 constats bruts dans les huit rapports, environ 70 après dédoublonnage).
- Le plus gros : la coquille des analyses (lecture de la session, brouillon, onglets, FC, couches de carte, réglages de la session, en-tête), recopiée dans `SailingModule`, `LandModule`, `SurfModule` et `MuscuModule`. Elle se met en commun par pièces, en quatre lots neutres au banc (62 à 65), pas en un composant géant : le cœur de chaque sport (vent et manœuvres en nœuds, énergie et pente, vagues) reste propre au sport.
- Les graphes : le même squelette Recharts reliant un graphe à la trace (zoom, grille, axes, survol) écrit 15 fois dans 8 fichiers, avec des dérives (animations laissées actives, grille d'une autre couleur, graduations tirées de la mauvaise plage). Un seul `TrackChart` (lots 59 à 61).
- Les petites fonctions : message d'erreur (5 définitions, 23 recopies), arrondis (28 sites), `pad` (6), angles (3 à 4 copies, rangées dans la voile alors qu'elles servent ailleurs), « quel point de la trace à cet instant » (8 copies), médiane (6 copies, deux conventions), plan local en mètres (4), longueur d'un tracé (4), bornes de couleur de la trace résolues à 4 endroits, champs d'une fiche de session écrits 6 fois (lots 55, 57, 72, 80).
- Domaines : la boucle de l'énergie à pied et à vélo, les tronçons (vol, vague), les tracés d'une zone sur la carte, le podium de la VMG qui recopie celui des meilleurs segments (lots 56, 70).
- Tests et outils : générateurs de traces dans 26 fichiers de test, avec trois valeurs différentes de « mètres par degré » ; mise en route DevTools recopiée dans 63 scripts du banc, environ 2 000 lignes (lots 75, 76).

**Optimisation** (69 constats bruts).
- Noyau à l'ouverture d'une session (lot 56) : médiane glissante qui recopie et trie la fenêtre à chaque point, meilleurs segments qui trient 54 000 objets par cible, dates relues 4 à 5 fois, unité du Doppler détectée 3 fois. Mesuré : 600 ms → environ 200 ms sur PC pour 3 h à 5 Hz.
- Voile au mouvement du seuil (lot 58) : la polaire du vent (3 passes, 2 balayages de 360 × 360 candidats) et l'altitude (jamais affichée en voile) refaites à chaque cran, alors qu'elles ne dépendent pas du seuil.
- Rendus React : Enregistrer à chaque position (lot 67), planification à chaque survol (lot 59), Statistiques et Profil à chaque fiche pendant le balayage (lot 68), Réglages à chaque frappe (lot 66), toute l'analyse à chaque image d'un zoom (fork).
- Carte : une couche Leaflet par paire de points (54 000 à 5 Hz), une carte Leaflet vivante par vignette de bibliothèque, jamais démontée, tuiles demandées en double et jamais annulées (lots 73, 74).
- Fichiers : fiches JSON indentées deux fois plus grosses que nécessaire (55 558 octets contre 25 802 sur une fiche type), toute la liste republiée et retriée par fiche recalculée (lots 68, 80).

**Architecture** (78 constats bruts).
- Sens des dépendances : `core/` importe des types de `running/`, `cycling/`, `planning/`, `recording/` ; `platform/` importe `recording/` et `theme/` ; des composants importent `pages/workoutLists.ts` ; la géométrie générique vit dans `sailing/wind.ts` et `recording/` l'importe (lot 71, avec un test qui garde le sens).
- Calcul pur mal rangé : environ 1 000 lignes dans `hooks/useSportSettings.ts`, les règles du Profil dans `useRunnerProfile.ts`, le réducteur d'itinéraire dans un hook, la préparation des résumés dans `useSessionLibrary.ts`, `components/sessionTrack.ts` (décision transverse des couleurs) sans test, l'énergie mise en texte dans `pages/landModules.tsx` sans test (lots 70, 72).
- Services hors React rangés dans `hooks/` (`useSessionLibrary.ts` 1 973 lignes, `useRecorder.ts` 933, et neuf autres) : pour le fork (dossier `stores/`).
- Règles de `CLAUDE.md` à moitié tenues : règle 1 (le noyau rend des chaînes formatées : meilleurs segments, statistiques de base, VMG), règle 2 (deux lectures de cap par point à 5 Hz en voile), règle 3 (constantes d'algorithme hors profil, en voile, en direct, en planification), règle 6 (distance des manœuvres et des sauts intégrée à part). Les lots 79, 81 et 72 s'en chargent ; la règle 1 en entier va au fork.

**Bogues** : voir la section « Bogues », triée par gravité, perte de données d'abord.

## Ordre des lots

« Zone » : où le lot est rangé dans `docs/BACKLOG.md`. « Neutre » : aucun chiffre ni texte d'écran ne change, prouvé par test `toEqual` et banc ; « non neutre » : il attend sa question (ou corrige un bogue).

| N | Lot | Axe | Modèle/effort | Taille | Neutre | Dépend de | Zone |
|---|---|---|---|---|---|---|---|
| 53 | Petites retouches et banc fiable | tous | Sonnet/medium | petit | oui | rien | Ensuite |
| 54 | Fiches et enregistrement sûrs | bogues | Opus/high | petit | non (corrections) | rien ; APK | Ensuite |
| 55 | Briques communes 1 : erreurs, nombres, formats, FC lisible, états | doublons | Sonnet/high | petit | oui | 53 | Ensuite |
| 56 | Ouverture d'une session plus rapide (noyau) | vitesse | Opus/high | petit | oui, au bit près | 53 | Ensuite |
| 57 | Briques communes 2 : angles, géométrie, temps, médiane, profils | doublons | Opus/medium | petit | oui | 55 | Plus tard |
| 58 | Voile : au seuil, ne refaire que ce qui en dépend | vitesse | Opus/high | petit | oui, au bit près (Q40) | 56 | Plus tard |
| 59 | Graphes 1 : pièces communes, survol de la planification | doublons, rendus | Sonnet/high | petit | oui | 55 | Plus tard |
| 60 | Graphes 2 : un seul graphe de trace, course et vélo | doublons | Opus/high | petit | oui | 59 | Plus tard |
| 61 | Graphes 3 : voile, surf, test, sauts, fractionné ; pics gardés | doublons, bogues | Opus/high | petit | en partie (Q37, Q38) | 60 | Plus tard |
| 62 | Coquille 1 : session et onglets | doublons | Opus/high | petit | oui | 54 | Plus tard |
| 63 | Coquille 2 : FC, couches de carte, sauts, pumping | doublons | Opus/medium | petit | oui sauf Q39 | 62, 59 | Plus tard |
| 64 | Coquille 3 : panneaux, tableaux et surbrillances communs | doublons | Sonnet/high | petit | oui | 63 | Plus tard |
| 65 | Coquille 4 : mise en page commune `AnalysisShell` | architecture | Opus/high | petit | oui | 64 | Plus tard |
| 66 | Réglages : lecture sûre, un seul cache, moins de recalculs | bogues, rendus | Opus/medium | petit | oui | 55 | Plus tard |
| 67 | Enregistrer : ne redessiner que les chiffres | rendus | Opus/high | petit | oui | 55 | Plus tard |
| 68 | Bibliothèque : balayage et écritures groupés | vitesse | Opus/high | petit | oui | 54 | Plus tard |
| 69 | Recherches par session : un seul mécanisme | doublons, bogues | Opus/medium | petit | oui | 54 | Plus tard |
| 70 | Domaines : énergie commune, pente au noyau, tronçons | doublons | Opus/medium | petit | oui | 57 | Plus tard |
| 71 | Sens des dépendances et test d'architecture | architecture | Sonnet/high | petit | oui | 57, 70 | Plus tard |
| 72 | Calcul pur sorti des hooks ; priorités testées | architecture | Opus/medium | petit | oui | 71 | Plus tard |
| 73 | Carte : trace colorée en une seule couche | vitesse | Opus/high | petit | oui (Q46, Q48) | 72 | Plus tard |
| 74 | Tuiles et vignettes de la bibliothèque | vitesse | Opus/high | petit | oui | 73 | Plus tard |
| 75 | Fixtures de test communes | outils | Sonnet/high | petit | oui | 57 | Plus tard |
| 76 | Banc : une seule mise en route DevTools | outils | Sonnet/medium | petit | oui | 53 | Plus tard |
| 77 | Thème et DA : CSS communes, variables, choix conformes | doublons | Sonnet/medium | petit | non (Q35, Q49) | 64 | Plus tard |
| 78 | Formats d'affichage uniques | bogues | Sonnet/medium | petit | non (Q32) | 55 | Plus tard |
| 79 | Voile : manœuvres mesurées selon les règles 2 et 6 | bogues | Fable/high | gros | non (Q33) | 58, 71 | Plus tard |
| 80 | Fiche de session : une table des champs, fichiers compacts | doublons | Opus/high | petit | oui sauf Q44 | 54, 55 | Plus tard |
| 81 | Chiffres hors voile : vitesse max, sauts, surf, trous | bogues | Opus/high | petit | non (Q34, Q41 à Q43) | 57, 70 | Plus tard |
| 82 | Planification : doublons internes et revêtement | doublons | Sonnet/high | petit | oui sauf Q47 | 57 | Plus tard |

Pourquoi cet ordre : 53 d'abord, parce que quatre scripts du banc ne coupent pas le réseau (leurs relevés avant/après ne prouvent rien) ; 54 ensuite, parce qu'il touche aux données de l'utilisateur ; 55 et 56 sont les fondations et le meilleur rapport gain/risque (neutres, mesurés). Puis les briques du noyau avant les modules qui les consomment, les pièces des graphes avant la coquille, la coquille par étapes neutres, le rangement des dossiers avant l'extraction du calcul pur, et en dernier les lots qui changent un chiffre ou l'écran. Les lots 66 à 69 sont indépendants de la coquille et peuvent passer avant elle si l'utilisateur ressent d'abord la lenteur d'Enregistrer ou de la bibliothèque.

## Règles communes à tous les lots

- Brief : la ligne de la table donne « Modèle | Réflexion » ; l'orchestrateur recopie le bloc du lot dans le brief. Lots Opus high et Fable : plan par l'agent `Plan` d'abord (MODELES). Lots Sonnet : le bloc suffit.
- Lire avant : `CLAUDE.md` (règles 1 à 12, « Où ajouter quoi »), la section de `docs/DECISIONS.md` du domaine touché, `docs/MISE_EN_PAGE.md` pour tout lot qui touche une analyse, `outils/banc/LISEZMOI.md` (« Pièges du poste ») pour tout lot qui passe au banc.
- Les numéros de ligne de cette fiche sont ceux du commit 86b3f8d ; ils glissent d'un lot à l'autre : relocaliser par recherche du nom avant de toucher.
- Neutralité, mode d'emploi :
  - calcul : copier l'ancienne fonction telle quelle dans le fichier de test (copie gelée), puis `expect(nouvelle(x)).toEqual(ancienne(x))` sur traces synthétiques à 1 Hz et 5 Hz, dates tronquées, trous, pauses, valeurs égales ; pour un résultat complexe, comparer aussi `JSON.stringify` ; garder l'ordre des opérations flottantes ; la copie gelée peut rester comme test de non-régression ;
  - écran : l'orchestrateur fait passer l'agent `banc` avant (worktree au commit de départ) et après, sur les scripts nommés par le lot ; texte de la page identique, aucune erreur de console ; `tailles.mjs` quand une mise en page est touchée ; captures à 390 × 844 et 834 × 375 quand le téléphone est concerné ;
  - voile : `node outils/banc/manoeuvres-diagnostic.mjs <brouillon>/voile.gpx` (trace de `outils/banc/make-gpx.mjs`) identique avant et après ; pour les lots 58 et 79, les 12 sessions réelles de `D:\memoire Tracker\Tracker\sessions\` en lecture seule (jamais copiées dans le dépôt), comme au lot 30 (fiche 30, « Données réelles »).
- Rien ne bouge sans le dire : un attendu de test existant qui change rend un lot neutre BLOQUÉ ; dans un lot non neutre, seuls changent les chiffres de sa question, listés dans le rapport.
- Garder : les `id` des `ResizablePanel` (clés des tailles mémorisées), les clés de stockage (`sailing-onglets`, `running`, `cycling`, `intervals`, `surf`, `muscu`, `tracker.*`), les fonctions exportées lues par le banc (`imuCaptureStats`, `analyzeManeuvers`, `measureManeuver`, `estimateWind`).
- Pas de commit, pas de version, aucune décision de l'utilisateur dans le lot : une question imprévue = rapport BLOQUÉ.
- Vérifications pendant le travail : typecheck, lint, `vitest run --changed` (depuis Git Bash : `cmd //c "cd /d C:\Users\segne\tracker && npx vitest run --changed"`) ; à la fin, l'agent `verif` (lint, tous les tests, build).
- Rapport : 40 lignes au plus, FAIT / BLOQUÉ / ÉCHEC, par étape ce qui a changé et sa preuve ; pour un lot de vitesse, la mesure avant/après.
- Au passage, dans les fichiers touchés seulement : retirer un `export` qui ne sert qu'à son fichier (annexe), remplacer une longueur en px par une variable de `tokens.css` dans un style réécrit. Jamais de lot pour ça seul.
- Après chaque lot validé, la passe `doc` met à jour INVENTAIRE (fichiers nouveaux ou déplacés) et ETAT §3 (sens des dépendances) ; `CLAUDE.md` « Où ajouter quoi » seulement si une consigne change (lots 62, 71, 72).

## Lots

### 53 · Petites retouches et banc fiable

Sonnet | medium. Neutre. Sources : 01-C6, 01-E1, 01-E2, 02-D4, 02-E, 03-C9, 03-E, 04-D5, 04-D12, 04-E, 05-E1, 05-E2, 06-D6, 06-D7, 06-D9, 06-E, 07-C4, 07-C7, 07-D2, 07-D6, 07-E, 08-A12, 08-D4, 08-E.

**Ce qui existe**
- Banc : `outils/banc/chrono.mjs:54`, `imports.mjs:80`, `materiel.mjs:87`, `notes.mjs:85` appellent `Network.setBlockedURLs` sans `Network.enable` : rien n'est bloqué, leurs relevés dépendent de l'IGN, d'Overpass et des tuiles (défaut que LISEZMOI ne signale que pour `charge.mjs`). 13 scripts prennent `http://127.0.0.1:4190` par défaut, port que LISEZMOI dit refusé par Chrome et Node (43 sur 5173, 5 sur 4199, 1 sur 4191).
- Code mort : propriété `className` de `ZoomableChart` (`components/ZoomableChart.tsx:81, 93, 228`, aucun des 15 appelants) ; champs `timeLabel` et `display` de `WindGraphPoint` (`sailing/sailingAnalytics.ts:28, 36, 208-210`, un `Date` et une chaîne par ligne du graphe du vent, jamais lus) ; `activityOptions` rendu par `useSportSettings` (`hooks/useSportSettings.ts:1489-1492`, `1560`, relayé par `useSailingSession.ts:56, 255`, jamais lu) ; `isBikeWeightOverridden` (`useSportSettings.ts:1579`) ; `trackName` (`useSailingSession.ts:243`) ; champs `ZoneStats.pace` et `speedKmh` et le paramètre `distanceUnit` de `computeZoneStats` qui ne sert qu'à eux et force un recalcul à chaque changement d'unité (`running/runningAnalytics.ts:128-130, 173-175`, `pages/LandModule.tsx:471`).
- Fonctions appelées seulement par les tests : `averagePace` (`running/runningAnalytics.ts:210-215`), `isRouteMode` (`planning/route.ts:130`), `computeLiveLegs` (`recording/liveLegs.ts:202`) ; `followProgress` (`recording/followedTrace.ts:253`) sert d'oracle à un test d'équivalence : à garder.
- Alias inutiles : `const cardStyle = CARD_STYLE` (`LandModule.tsx:219`, `SurfModule.tsx:129`) ; `hoverIndex = setHoveredIndex` (`SailingModule.tsx:508`, `LandModule.tsx:783`, `SurfModule.tsx:385`) ; types `SailingPanel` (`SailingModule.tsx:104`), `LandSection` (`LandModule.tsx:150`), `SurfSection` (`SurfModule.tsx:89`).
- Variable CSS jamais lue : `--radius-xl` (`theme/tokens.css:44`).
- Commentaires périmés : `HeartRateChart.tsx:32` et `ElevationProfileMini.tsx:28-29` (« +carte une fois zoomé » : le bouton est toujours là, `ZoomableChart.tsx:20-22`, MISE_EN_PAGE:37) ; `ZoomableChart.css:1` et `pages/analysisMobile.css:1` (liste d'appelants incomplète) ; `SailingModule.tsx:155`, `387-391` ; `LandModule.tsx:221`, `925`, `1110` ; `SettingsPage.tsx:452-453` ; `hooks/useAdvancedTabs.ts:26` (faux) ; `hooks/createStore.ts:3-6` ; `core/activities.ts:320-336` (versions 2 à 8, alors qu'`ACTIVITIES_VERSION` vaut 9) ; `planning/route.ts:893-898` (« terrain de l'activité », retiré le 21/10).
- Écritures sans effet : `['sans GPS, ceinture cardio'].join(' · ')` (`SettingsPage.tsx:518`) ; `.lib-banner__count` qui redéclare deux propriétés (`SessionLibrary.css:205-216`) ; deux `import` sur une ligne (`SessionLibrary.tsx:7`).
- Petits défauts sûrs : `unitLabel` lu dans `speedChart` (`SurfModule.tsx:439`) avant sa déclaration (`:508`), une `ReferenceError` dès qu'un appel remonte ; fin de plage FC `firstIndexAtOrAfterTime(points, endMs + 1) - 1` (`core/heartRate.ts:440`) au lieu de `lastIndexAtOrBeforeTime` (`core/search.ts:35-36`), faux d'une milliseconde avec des dates fractionnaires ; texte « plus de 10 cm » en dur (`core/jumps.ts:105`) alors que la borne est `attitudeMaxErrorM` (`core/sportProfiles.ts:264`) ; fiche `X.JSON` jamais gardée en cache (`hooks/useSessionLibrary.ts:296-298` cherche `.json` en minuscules, alors que `library/reconcile.ts:50, 58` rapproche les deux) ; minuteries de `finished` jamais annulées par `stop()` (`platform/beeper.ts:152-166`) ; rejet d'`addListener` non rattrapé (`platform/location.ts:361-367`) ; `<span>` vides dans le conteneur de la carte (`components/JumpMapLayer.tsx:33`, `TrackSpanLayer.tsx:31`).
- Tests : `planning/loopReturn.test.ts:149-151` exige moins de 200 ms (fragile sur machine chargée) ; tests de `planning/geocoding.ts` rangés dans `planning/brouter.test.ts:7` ; tests en double : `completeRecord` (`library/record.test.ts:684` et `library/sessionBundle.test.ts:178`), `calculateWindStats` (`sailing/maneuvers.test.ts:1202` et `sailing/sailingAnalytics.test.ts:236`), nommage des points A, B… (`planning/routeRecord.test.ts:131` et `planning/routeGpx.test.ts:13`).
- Configuration : `tsconfig.app.json` ne déclare pas `strict` (TypeScript 7 l'active par défaut, `CLAUDE.md` s'appuie dessus) ; `react/exhaustive-deps` est en avertissement et ne relève aucun cas ; `CachedTileLayer` redéfinit `createTile` sans `override` (`components/BaseTileLayer.tsx:45`).

**À faire, dans cet ordre**
1. Banc : `Network.enable` avant `Network.setBlockedURLs` dans les quatre scripts ; défaut d'adresse aligné sur celui de LISEZMOI dans les 13 scripts à 4190 ; ligne « Scripts à revoir » de LISEZMOI mise à jour.
2. Code mort et alias ci-dessus ; pour `averagePace`, `isRouteMode`, `computeLiveLegs` : si un test s'en sert comme référence d'équivalence, déplacer la fonction dans le fichier de test, sinon la retirer avec son test.
3. Commentaires et écritures sans effet.
4. Petits défauts sûrs, chacun avec un test quand c'est un calcul (`heartRate.ts:440` : test avec dates fractionnaires ; `.JSON` : test du cache).
5. Tests : seuil de `loopReturn.test.ts` porté à 1 s (tranché, voir « Tranché par la synthèse ») ; tests de géocodage dans `geocoding.test.ts` ; un seul exemplaire de chaque test en double (garder celui du fichier de la fonction).
6. Configuration : `"strict": true` écrit dans `tsconfig.app.json`, `noImplicitOverride` avec `override` sur `createTile`, `react/exhaustive-deps` en erreur dans `.oxlintrc.json` (les 10 exceptions commentées restent).

**Garde-fous**
- Aucun texte d'écran ne change ; `computeZoneStats` garde tous les champs lus par `LandModule.tsx:1463-1476`.
- Ne pas toucher à `utils/kinematics.ts` (lot 58) ni aux exports lus par le banc.

**Preuve de neutralité** : verif complète ; banc `general.mjs` avant/après, texte identique ; les quatre scripts corrigés lancés deux fois de suite après correction, sortie identique d'un passage à l'autre.

**Rapport attendu** : par étape, fichiers touchés et lignes retirées ; la liste des scripts du banc corrigés ; tout test retiré et pourquoi.

### 54 · Fiches et enregistrement sûrs

Opus | high. Non neutre : corrige des bogues (voir « Bogues » : A1, A2, A3, B1 à B5, C1, D10, D11, D13). APK (un fichier Java change). Sources : 02-D1, 03-B8, 03-D1, 03-D2, 03-D5, 03-D6, 03-D7, 06-D1, 06-D3, 06-D4, 06-D5, 07-D1, 08-D6.

**Ce qui existe**
- Fiche relue puis réécrite par une version plus ancienne : `readSessionSurfaces`, `readTerrainElevation`, `readSessionJumps`, `readIntervalSeries`, `readSessionMarks`, `readSessionTest` rendent `null` sur une forme inconnue et le champ disparaît à l'écriture (`library/record.ts:558-587`) ; `readSummary` supprime `maneuverResults`, `heartRate`, `cadence` ou `test` mal formés (`:378-396`) ; `readSessionTest` ramène un `zoneMethod` inconnu à `'max'` (`recording/fitnessTest.ts:259`) ; `readAnalysis` ramène à `null` une valeur d'un type nouveau (`record.ts:452-465`). Seules les clés inconnues sont conservées ; `RECORD_VERSION` reste à 1. Le cas courant : téléphone à jour, PC sur une version plus ancienne, renommage sur le PC.
- Création d'un fichier neuf non atomique : le remplacement passe par `.tracker-tmp`, mais une création écrit en place (`android/.../MemoryFolderPlugin.java`, `writeBytes`, branche `writeTo(create(...))`) ; dans `en-attente/`, `Filesystem.writeFile` écrit en place (`platform/memoryFolder.ts:579-594`). Une fiche neuve tronquée devient « Fiche illisible, laissée telle quelle » (`hooks/useSessionLibrary.ts:964-966`, `readOnly: true`) et la session ne s'enregistre plus ; un GPX tronqué reste « non rangé, illisible ».
- Démarrage du stockage : un seul rejet de `Preferences.get` fait échouer tout le `Promise.all` (`platform/storage.ts:159-161`) et l'application reste sur le `localStorage` de la WebView (`:168-170`), sans le dire ; `tracker.settingsSavedAt` absent, l'appareil se croit neuf et adopte le fichier de réglages le plus récent du dossier, peut-être d'un autre appareil (`useSessionLibrary.ts:700-708`).
- Démarrage de l'interface : le rendu est dans le même `.then` que `upgradeStoredActivities()` et `upgradeStoredPresets()` (`main.tsx:41-53`) : une exception laisse l'écran blanc.
- Lecture du GPX d'une analyse sans `catch` (`hooks/useLibraryNavigation.ts:99-109`) : si `folder.readText` lève (autorisation du dossier perdue, carte retirée : `platform/memoryFolder.ts:140-142, 320`), l'analyse reste vide sans message et ne réessaie pas.
- Overpass et IGN appelés sans délai (`planning/overpass.ts:112-116`, `planning/ignAltimetry.ts:88-93`), alors que BRouter (60 s) et Photon (20 s) en ont un : une connexion qui pend laisse l'onglet « surface » ou l'altitude en recherche jusqu'à la relance de l'application (la promesse est gardée dans `searching`, `useSessionSurfaces.ts:26-49`, `useTerrainElevation.ts:24-57`).
- Arrêt pendant une pause ou une reprise : `stopRecording` (`hooks/useRecorder.ts:821-884`) n'est pas protégé par `exclusive`, contrairement à `pauseRecording` et `resumeRecording` (`:693`, `:712`). Pause en cours puis « Arrêter » : la session est rangée, puis la pause finit et pose `status: 'paused'` (`:708`) ; l'enregistreur se croit occupé jusqu'au redémarrage. Reprise en cours puis « Arrêter » : la reprise pose une source GPS neuve après l'arrêt (`:728-731`), service GPS orphelin et notification qui reste.
- Journal sans en-tête lisible repris en wingfoil : `activityChange?.sport ?? header?.sport ?? 'wingfoil'` (`useRecorder.ts:526`).
- Voile : brouillon pris sur le fichier de l'adresse, pas sur le fichier affiché : `useSessionDraft(requestedFile)` (`pages/SailingModule.tsx:159-161`), alors que les trois autres modules attendent la trace (`LandModule.tsx:299`, `SurfModule.tsx:187-188`, `MuscuModule.tsx:106-108`). En passant de A à B sans quitter le module, le vent, le seuil, l'allure et les repères de B s'appliquent un instant à la trace de A.
- Repère « Note » daté par `Date.now()` (`useRecorder.ts:809`) alors que sa position porte l'heure du GPS : mal placé pendant un rejeu du banc.
- Capteurs ajoutés par un import pendant qu'une analyse est ouverte : écrits sans publication (`useSessionLibrary.ts:1383-1391`, chemin `motionAdded`), `hasSessionMotion` lit un `Set` non réactif (`:1671`) : onglets « sauts » et « pumping » absents jusqu'au rendu suivant.
- Ceinture : `listening ??= Promise.all([...addListener])` (`platform/heartRate.ts:167-181`) garde à vie une promesse rejetée.

**À faire, dans cet ordre**
1. Fiche : tout champ connu jugé illisible garde son brut, réécrit tel quel à l'écriture (au lieu de `null`) ; même chose pour `zoneMethod` inconnu et les valeurs d'un type nouveau de `readAnalysis`. Tests : fiche « d'une version future » (champ connu de forme nouvelle) relue, renommée, réécrite → champ identique au caractère près.
2. Écriture atomique d'un fichier neuf : temporaire puis renommage, dans `MemoryFolderPlugin.java` (branche de création) et dans `en-attente/` (`Filesystem.writeFile` sur un temporaire puis `Filesystem.rename`). Dans le navigateur, vérifier que le chemin OPFS ou dossier choisi fait de même (sinon même correctif).
3. Stockage : lecture clé par clé avec repli ; si Preferences échoue, ne jamais basculer en silence (bandeau, comme `subscribeFailure`) et ne pas adopter seul un fichier de réglages du dossier ce lancement-là.
4. `main.tsx` : `try/catch` autour des mises à niveau, rendu toujours fait, erreur signalée.
5. `useLibraryNavigation.ts` : `.catch((err) => { loadedFor.current = null; setReadError(errorMessage(err, 'GPX illisible.')) })`.
6. Délais : `timeoutMs` d'environ 120 s pour Overpass (le serveur annonce 90 s), 30 s par paquet IGN ; à l'échec, l'erreur et « Réessayer » apparaissent.
7. `stopRecording` attend la commande en cours (file d'attente des commandes) au lieu d'être refusé ou de passer à côté ; test sur plateformes simulées (`useRecorder.test.ts`) : pause lancée puis arrêt, reprise lancée puis arrêt → statut final `idle`, aucune source active.
8. Journal sans en-tête : pas de support deviné ; la session est rangée « à classer » (sans activité), comme les autres sessions sans activité.
9. Voile : le brouillon suit le fichier affiché (la même règle que les trois autres modules) ; décision tranchée par la synthèse (« même règle partout »).
10. Repère « Note » : `fix?.timeMs ?? Date.now()` hors muscu.
11. Capteurs ajoutés : publier (ou augmenter `revision`) quand des capteurs sont ajoutés à une session existante.
12. Ceinture : la promesse d'écoute est oubliée si elle échoue, pour qu'un `holdBelt` suivant réessaie.

**Garde-fous**
- Format des fiches inchangé pour tout champ valide ; `RECORD_VERSION` inchangé ; aucune donnée existante réécrite par le seul fait de la lire.
- Règle 12 : tout passe par `platform/` ; le Java ne change que la branche de création.
- Le journal de l'enregistrement et la reprise après arrêt brutal ne changent pas de forme.

**Preuve** : un test par étape (étapes 1, 3, 5, 6, 7, 8, 10, 11, 12 en test pur ou sur plateforme simulée) ; banc `general.mjs`, `library.mjs`, `surface.mjs`, `altitude.mjs` avant/après, texte identique hors des messages d'erreur ajoutés ; `session-save.mjs` pour le brouillon.

**Essais au téléphone** (dans `docs/BACKLOG.md`) : essai 68 (arrêt pendant une pause) et essai 69 (réseau coupé pendant une recherche). L'écriture atomique ne s'éprouve pas à la main (tuer l'application au bon moment) : relecture du Java par l'agent `relecture`.

**Rapport attendu** : par bogue, le correctif et son test ; ce qui n'a pas pu être prouvé hors du téléphone.

**Tranché par l'orchestrateur le 29/10, sur le plan de l'agent `Plan`**
- Résumé (`summary`) entier illisible : refait depuis le GPX sans garder son brut, comme aujourd'hui (DECISIONS §8 : le résumé se recalcule).
- Brut d'un champ illisible gardé hors de la fiche (table par fichier dans `useSessionLibrary`), réécrit seulement si la valeur n'a pas changé depuis la lecture : un symbole posé sur la fiche serait perdu par le cache allégé.
- Création interrompue avant le renommage : perdue, puis refaite (fiche depuis le GPX, enregistrement par son journal) ; fiche de 0 octet traitée comme absente.
- Champ d'`analysis` illisible remis à vide par l'utilisateur : le brut peut revenir ; accepté (jamais vu par lui).
- Stockage en panne au démarrage : réglages gardés en mémoire seulement, bandeau ; jamais de bascule muette sur `localStorage`.
- Temporaire de création Java nommé `.tracker-new`, distinct de `.tracker-tmp` que `list` promeut.

### 55 · Briques communes 1 : erreurs, nombres, formats, FC lisible, états

Sonnet | high. Neutre. Sources : 01-A8, 01-A13, 02-A20, 03-A4, 03-A6, 03-A7, 03-A8, 04-A8, 04-A11, 04-A14, 05-A10, 06-A3, 06-A5, 06-A6, 06-A7, 06-A8, 06-A10, 06-A11, 07-A12, 08-A1, 08-A6, 08-A7, 08-A12.

**Ce qui existe**
- Message d'une erreur : `errorMessage(err, repli)` défini 5 fois (`hooks/useRecorder.ts:207-208`, `hooks/useSessionLibrary.ts:204-205`, `hooks/useRestingHrTest.ts:45`, `hooks/useBeltWarmup.ts:7` et `components/HeartRateBeltSettings.tsx:18` sous le nom `errorText`) ; 23 recopies en ligne `err instanceof Error ? err.message : …` (`components/FollowTracePicker.tsx`, `SavedSessionShare.tsx:73`, `SessionNameEditor.tsx:73`, `ShareDialog.tsx:119`, `hooks/useGpxSession.ts:125`, `useRouteLibrary.ts:81`, `useSessionJumps.ts:83`, `useSessionLibrary.ts`, `useSessionPumping.ts:66`, `useSessionSurfaces.ts:87`, `useTerrainElevation.ts:116`, `useIntervalTimer.ts:82`, `pages/MuscuModule.tsx`, `pages/PlanningPage.tsx` ×5, `pages/RecordingPage.tsx`, `planning/legCalculation.ts` ×2, `platform/location.ts` ×2) ; `String(err)` à part (`useSessionLibrary.ts:1605`). Nuance : certains testent un message non vide, d'autres non (« Partage impossible :  » si le message est vide, `SavedSessionShare.tsx:73`).
- Nombres : « nombre fini dans une plage » écrit 8 fois (`hooks/useRunnerProfile.ts:125, 135, 191, 216-217` ; `useSportSettings.ts:243-244, 247-248, 397-398, 1150` ; `useTileCache.ts:21-22` ; `useSessionLibrary.ts:525`), alors que `isFiniteNumber` existe (`core/basics.ts:15`) ; « nombre fini sinon null » (`recording/journal.ts:132`, `platform/location.ts:64`, `recording/fitnessTest.ts:235`, `running/restingHrResults.ts:110`, `library/record.ts:144`) ; `JSON.parse` protégé (`library/record.ts:549-554`, `library/settingsFile.ts:55-60`, `planning/routeRecord.ts:143`, `recording/journal.ts:135-141`) ; garde `isObject` réécrite (`core/sessionMarks.ts:24`, `core/activities.ts:196`, `core/analysisTabs.ts:143`) ; moyenne d'une liste (`surfing/surfAnalysis.ts:303`, `running/intervalStats.ts:140, 182`) ; lecture d'un journal de commandes datées (`recording/stopwatch.ts:70-90`, `recording/intervalTimer.ts:404-411, 649-662`).
- Arrondis : `Math.round(x * 10) / 10` 9 fois (`core/jumps.ts:146`, `core/patternTiles.ts:42`, `components/JumpsPanel.tsx:146`, `library/summary.ts:240`, `LandModule.tsx:545, 836`, `landModules.tsx:195, 283`, `SailingModule.tsx:212`) ; `Math.round(x * 100) / 100` 7 fois (`core/jumps.ts:145, 284`, `core/terrainElevation.ts:140`, `JumpsPanel.tsx:127, 151`, `FitnessTestPage.tsx:27`, `running/restingHrResults.ts:144`) ; `parseFloat(x.toFixed(3))` 12 fois (`ElevationProfileMini.tsx:73`, `FitnessTestPanel.tsx:94`, `HeartRatePanel.tsx:91`, `JumpsPanel.tsx:145`, `LandModule.tsx:544, 694, 720, 866`, `MuscuModule.tsx:152`, `PlanningPage.tsx:517, 544`, `sailing/wind.ts:71`). Les deux formules n'arrondissent pas pareil sur certaines valeurs (1,005).
- Formats : `editSpeedUnit` existe (`core/units.ts:98`) mais `speedUnit === 'minkm' ? 'kmh' : speedUnit` est recopié 8 fois (`FitnessTestPanel.tsx:80, 211`, `HeartRatePanel.tsx:137`, `IntervalAnalysis.tsx:272`, `LandModule.tsx:554, 624, 1508, 1592`) ; « trop lent pour une allure » a trois valeurs (`core/units.ts:25` 0,1 m/s ; `LandModule.tsx:691, 808` 0,3 ; `IntervalAnalysis.tsx:100` `MIN_PACE_SPEED_MS`) ; `m:ss` avec report de 60 écrit 4 fois (`core/units.ts:33-36`, `118-121`, `204-209`, `215-218`) ; `pad` défini 6 fois (`core/units.ts:193, 223, 232`, `components/heartRateOrigin.ts:9`, `library/naming.ts:32`, `recording/session.ts:218`) ; distance « 2 décimales sous 10 » (`pages/SessionLibrary.tsx:93-95` ≡ `pages/StatisticsPage.tsx:132-133`) ; `formatSpeed` recopie les symboles au lieu de lire `SPEED_UNIT_SYMBOL` (`core/units.ts:101-113`, `83`) ; `formatMeters` (`RecordingPage.tsx:138` ≡ `PlanningPage.tsx:226`) ; libellé « 5 min » (`recording/liveFields.ts:159` ≡ `RecordingPage.tsx:139`) ; `signedPercent` écrit deux fois et différemment (« +0,0 % » dans `CadencePanel.tsx:34-37`, « 0 % » dans `IntervalAnalysis.tsx:193-197`) ; `1852` en dur (`core/sportProfiles.ts:492`) ; `5 / 3.6` au lieu de `kmhToMs` (`surfing/surfConfig.ts:7`).
- Calendrier : `shortDate` (`library/activityChart.ts:105-106` ≡ `library/stats.ts:449`, variante `StatisticsPage.tsx:128`), `DAY_MS` (`activityChart.ts:66`, `stats.ts:590`, `library/rootGrowth.ts:68`), `startOfMonth`/`addMonths` (`stats.ts:451-459`) à côté de `startOfDay`/`addDays` (`activityChart.ts:77-86`), piles par activité (`activityChart.ts:267-279`, `stats.ts:461-465, 479-481`) ; formats de date `{ day, month, year }` recopiés (`components/SettingsFiles.tsx:23`, `activityChart.ts:106, 112`, `stats.ts:449, 528, 646`, `RestingHrTestPage.tsx:31`, `StatisticsPage.tsx:129`, `SessionLibrary.tsx:75`).
- FC lisible (`contact === false || !(bpm > 0)`) écrite 5 fois : `recording/heartRate.ts:10-11`, `recording/session.ts:35`, `hooks/useRecorder.ts:557-563`, `hooks/useBeltLive.ts:5-6`, `hooks/useRestingHrTest.ts:47-48` (avec arrondi).
- États de l'enregistreur : « en cours » (`starting | recording | paused`) dans `useFitnessTest.ts:163`, `useMarkGuide.ts:143`, variante dans `useRecorder.ts:278-279` ; « pause manuelle » 8 fois (`useMarkGuide.ts:101, 174`, `useFitnessTest.ts:177`, `useRecorder.ts:714, 719, 819`…).
- Sons : types et durées décrits deux fois (`recording/intervalTimer.ts:78-81, 460-477` et `platform/beeper.ts:37-56, 170`) ; `RESTING_SIGNAL_TONES` (`recording/restingHrTest.ts:125-128`) recopie `TEST_SIGNAL_TONES.debut` et `.finTest` (`recording/fitnessTest.ts:589-597`).
- XML : `escapeXml` dans `recording/gpxWriter.ts:28-29` (échappe `"`) et `library/sessionBundle.ts:23-24` (ne l'échappe pas, et doit refaire à l'identique le texte retouché, `undoEdits`, `:146`) ; en-tête GPX dans `gpxWriter.ts:75-94` et `planning/routeGpx.ts:39-45`.
- Tranches : `zoneOf` de `core/heartRate.ts:221` sert aussi aux tranches de cadence (`running/cadence.ts:501, 589`).

**À faire, dans cet ordre**
1. `core/basics.ts` : `errorMessage(err: unknown, fallback = 'erreur inconnue'): string` (message vide → repli) ; `inRange(value: unknown, min: number, max: number): value is number` ; `finiteOr<T>(v: unknown, fallback: T): number | T` ; `parseJson(text: string): unknown | undefined` ; `meanOf(values: readonly number[]): number | null` ; `roundTo(x, decimals)` (formule `Math.round`) et `toFixedNumber(x, decimals)` (formule `parseFloat(toFixed)`) : chaque site garde sa formule ; `readCommands<K>(raw: unknown, kinds: readonly K[])` ; `bandIndex` (ex-`zoneOf`, réexporté sous l'ancien nom le temps du lot). Tests de chaque brique. Puis remplacer toutes les copies listées.
2. `core/units.ts` : `pad2`, `minutesSeconds(totalMinutes)` (avec report), `formatDistanceAuto(m, unit)`, `formatSpeed` sur `SPEED_UNIT_SYMBOL`, `signedPercent(x, { zeroSign })` qui rend exactement les deux écritures actuelles, trois seuils d'allure nommés (`PACE_MIN_SPEED_MS`, `CHART_PACE_MIN_SPEED_MS`, `INTERVAL_PACE_MIN_SPEED_MS`) sans changer leurs valeurs, formateurs de date nommés (`Intl.DateTimeFormat`) ; `editSpeedUnit` partout ; `recentWindowLabel` exporté de `liveFields.ts` ; `formatMeters` en un seul endroit ; `METERS_PER_DISTANCE_UNIT.nm` et `kmhToMs` aux deux endroits. « 1h24 » et « 1 h 24 » restent tels quels (lot 78).
3. `core/calendar.ts` : `DAY_MS`, `startOfDay`, `addDays`, `startOfIsoWeek`, `isoWeek`, `startOfMonth`, `addMonths`, `shortDate`, `formatLocalDate(ms)` (`AAAA-MM-JJ`), `stacksByActivity(sessions, order)` ; `library/activityChart.ts`, `library/stats.ts`, `library/rootGrowth.ts`, `library/naming.ts`, `recording/session.ts` s'y ramènent.
4. `recording/heartRate.ts` : `readableBpm(sample: HeartRateSample | null): number | null` ; l'arrondi de `useRestingHrTest` reste chez lui ; `useRestingHrTest` lit `useBeltLive()` au lieu de son double abonnement (`:58, 98-104`).
5. `recording/session.ts` : `isRecordingSession(state)`, `isManualPause(state)`, `isAutoPause(state)` sur `{ status, pausedReason }`.
6. `core/beepDurations.ts` : types des sons et table des durées, importés de `intervalTimer.ts` et `beeper.ts` ; `RESTING_SIGNAL_TONES` lit `TEST_SIGNAL_TONES`.
7. `core/xml.ts` : `escapeXmlText` (sans guillemets) et `escapeXmlAttr` (avec), `gpxDocument(meta, body)` pour l'enregistreur et les itinéraires ; `sessionBundle` garde `escapeXmlText`.

**Garde-fous**
- Textes affichés identiques au caractère près, sauf « Partage impossible :  » à message vide, qui prend le repli (correction voulue, dite au rapport).
- `sessionBundle.ts` : le texte produit doit rester identique (un paquet ancien doit se défaire) ; test d'aller-retour sur un nom contenant `"`, `&`, `<`.
- Ne pas toucher à `sailing/` au-delà des remplacements mécaniques listés (`wind.ts:71`).

**Preuve de neutralité** : pour chaque brique, un test qui fige la sortie de l'ancienne formule (copie gelée) sur des valeurs limites (0, négatifs, 59,5 s, 1,005, `NaN`, chaîne vide) ; verif complète ; banc `general.mjs`, `library.mjs`, `statistiques.mjs`, `profil.mjs`, `planning.mjs` avant/après, texte identique.

**Rapport attendu** : nombre de copies retirées par brique, lignes en moins, toute sortie qui aurait bougé (il ne doit y en avoir qu'une : le message vide).

### 56 · Ouverture d'une session plus rapide (noyau)

Opus | high. Neutre au bit près. Sources : 04-A2, 04-B1 à B6, 04-B10, 04-B12, 04-D2, 05-A2, 05-A5, 05-B3, 05-B4, 05-B6, 05-B8, 06-B7, 07-B6, 07-B8.

**Ce qui existe** (mesures sur 54 000 points, 3 h à 5 Hz, Node 26, poste de l'utilisateur ; compter 3 à 5 fois plus au téléphone)
- Médiane glissante : `out[i] = median(values.slice(start, end + 1))` (`core/speedFilter.ts:224`) et `median` recopie encore puis trie (`:26-33`) : 65 ms (fenêtre de 3 s : voile, vélo, surf) et 138 ms (5 s, à pied), un tiers de `computeKinematics`. Prototype d'une fenêtre triée tenue à jour : 7 et 9 ms, 0 écart sur 54 000 valeurs (`Object.is`). Le gain profite au résumé de chaque session à l'import (`library/summary.ts:78-83`) et au direct (`resumeKinematics`).
- Meilleurs segments : un objet par point et un tri complet par cible (`core/topSegments.ts:60-110`), `gapCount` refait par cible (`:64-67`), `toDisplaySpeed` appelé 54 000 fois par cible ; 129 à 193 ms pour les 7 cibles de la voile, 161 ms pour les 9 du vélo ; prototype en tableaux typés et sélection gloutonne : 27 ms, 0 écart sur les 16 cibles voile et vélo. `LandModule.tsx:557, 569` l'appelle deux fois (deux unités) ; `recording/liveStats.ts:266` à chaque mise à jour du direct. Les fenêtres sont classées dans l'unité d'affichage (`:93, 110`) : avec une allure, la « meilleure » serait la plus lente (bogue latent, aujourd'hui évité par `LandModule.tsx:554`).
- Podium de la VMG : `getTopVmg` (`sailing/sailingAnalytics.ts:505-525`) recopie ligne pour ligne le choix sans chevauchement des meilleurs segments (`core/topSegments.ts:97-122`) ; `calculateVmgStats` (`:472-524`) crée jusqu'à 54 000 objets et trie deux fois toute la liste (environ 10 ms, à mesurer). Le test garde une version de référence (`sailing/sailingAnalytics.test.ts`, `legacyVmgStats`, vers la ligne 73).
- Dates : `pointTimeMs` (`core/kinematics.ts:48-49`, `new Date(iso)`) coûte 32 ms par passage, et l'ouverture en fait 4 à 5 (`referenceSpeedMs`, `sessionSpeed.ts:67` ; `detectTrackDeviceSpeedUnit`, `kinematics.ts:145` ; `samplingIntervalS`, `sessionSpeed.ts:110-112` ; `runKinematics`, `kinematics.ts:393` ; `useGpxSession.ts:110`).
- Unité du Doppler détectée 3 fois (66 ms chacune) : `sessionSpeed.ts:62`, `hooks/useGpxSession.ts:110`, et la cinématique à sa façon (`kinematics.ts:454-475`). Les deux façons ne lisent pas les mêmes vitesses dérivées (voir bogue C10) : seule la double détection identique (`referenceSpeedMs` et le hook) se partage sans risque.
- `referenceSpeedMs` trie 54 000 objets `{ speed, weight }` (`sessionSpeed.ts:65-84`, 75 ms avec les dates) ; `samplingIntervalS` trie un tableau (`:106-121`, 22 ms).
- Sauts de position : `inM` et `outM` recalculés (`kinematics.ts:207-208`) alors qu'ils sont dans `chordsM` (`:405`) ; 13 ms dont deux tiers évitables.
- Lecteur GPX : `getElementsByTagName('*')` pour chaque champ absent (`core/gpxParser.ts:38-47`), six recherches par point ; non mesurable en Node.
- Cadence d'une répétition : `timeSpanCadence` (`running/cadence.ts:557-570`) refait `measuredSegments` (`:441-451`, un objet par pas de toute la trace) à chaque appel ; `LandModule.tsx:610` l'appelle par répétition : 1,6 M d'objets pour 3 séances de 10 répétitions sur 3 h.
- Profil de vitesse d'une répétition : deux dichotomies par pas dont une en double (`running/intervalStats.ts:85-93`), sur toute la session depuis `detectIntervals` (`:178`).
- Résumé du surf : `runSurfSession` deux fois sur la même trace (`library/summary.ts:106-108` et `:142`, `buildCumulativeTrack` aussi en `:142` et `:181`) ; à l'import, `surfRides` puis `summarizeSession` (`hooks/useSessionLibrary.ts:1330`, `:403`).
- Masques d'activité : deux au même seuil dans le résumé (`library/summary.ts:157, 160`), 7,5 ms chacun.
- Revêtement d'une session : `tagsAt` reparcourt tous les morceaux pour chaque point et `classifySurface` relit les étiquettes à chaque point (`planning/surface.ts:137-150, 181-188, 250-259`) : 74 ms pour 54 000 points et 500 morceaux.
- Temps estimé à vélo : une dichotomie de 40 pas par ligne de profil (`planning/duration.ts:128-170`) : 21 ms pour 100 km.

**À faire, dans cet ordre**
1. Script de mesure jetable dans le brouillon (sur le modèle décrit ici : trace synthétique déterministe de 3 h à 5 Hz et à 1 Hz, bundle rolldown comme `outils/banc/charge-ts.mjs`), qui chronomètre chaque étape de l'ouverture (allure, unité, cinématique, cadence, meilleurs segments, statistiques de base, résumé) ; relevé « avant ».
2. Médiane glissante sur fenêtre triée (insertion et retrait dichotomiques) ; `medianFilterByTimeFrom` garde sa reprise (`from`, `prefix`).
3. `pickTopWindows<W extends { start: number; end: number }>(windows, value, count)` dans `core/topSegments.ts` ; fenêtres en `Float64Array`/`Int32Array` ; sélection : le meilleur qui ne chevauche pas les retenus, premier à égalité (comme le tri stable) ; `gapCount` une fois dans `computeAllTopSegments` ; classement en m/s, conversion des trois retenus seulement ; `getTopVmg` et `calculateVmgStats` sur la même pièce.
4. Dates lues une fois : `parseGpx` pose `timeMs` sur chaque point brut (champ facultatif, lu par `pointTimeMs` s'il existe) ; `recording/` (`toRawPoint`) aussi ; une date illisible donne le même `NaN`.
5. Unité du Doppler : `referenceSpeedMs(points, unit?)` ; le hook la détecte une fois et la passe ; la cinématique garde sa propre détection.
6. `referenceSpeedMs` et `samplingIntervalS` sur tableaux typés et tri d'indices (`Uint32Array`) ; `detourSpikesFrom` reçoit `chordsM`.
7. Lecteur GPX : un seul parcours des descendants par point, rangés par nom local (mesure au banc, dans le navigateur).
8. Cadence : `measuredSegments` calculé une fois par session, `timeSpanCadence(segments, track, startMs, endMs)` bornée par dichotomie ; profil d'une répétition qui reprend la distance du pas précédent (vérifier `startMs + (k+1)·stepMs` exact pour `stepS` entier).
9. Résumé : une seule analyse du surf partagée entre `surfRides` et `summarizeSession` (vérifier qu'elles portent sur les mêmes réglages au même moment) ; un seul masque au même seuil.
10. Revêtement : curseur (points dans l'ordre), catégorie calculée une fois par étiquette ; temps à vélo : vitesse retenue par pente arrondie au dixième de pour cent, seulement si la table rend exactement les mêmes secondes (sinon ne pas le faire).

**Garde-fous**
- Neutralité au bit près partout : aucune tolérance. Une étape qui ne passe pas `toEqual` n'est pas livrée (rapport).
- Pas de seuil nouveau (règle 3) ; fenêtres en secondes (règle 2).
- Ne pas unifier les deux détections de l'unité du Doppler (bogue C10, lot 81).

**Preuve de neutralité** : copies gelées et `toEqual` étape par étape (médiane : 1 Hz, 5 Hz, dates tronquées, trous, valeurs égales, fenêtre de 0 ; meilleurs segments : chaque profil et chaque cible, trace à vitesse constante pour l'ordre des égalités, `count` 1 et 3, trous et pauses ; VMG : `legacyVmgStats` et traces bruitées 1 et 5 Hz ; dates : `computeKinematics`, `referenceSpeedMs`, `samplingIntervalS` avec et sans `timeMs`) ; tests de reprise de `kinematics.test.ts` verts ; `manoeuvres-diagnostic.mjs` identique ; banc `general.mjs`, `surf.mjs`, `cadence.mjs`, `fractionne.mjs`, `surface.mjs` avant/après, texte identique.

**Mesure attendue** : par étape, avant/après ; à l'arrivée, ouverture d'une session de voile avec Doppler de 3 h à 5 Hz de environ 600 ms à environ 200 ms sur PC ; meilleurs segments 129 à 193 → environ 27 ms ; médiane 65/138 → 7/9 ms ; revêtement 74 ms → à relever.

**Rapport attendu** : tableau des mesures avant/après ; étapes non livrées et pourquoi.

**Tranché par l'orchestrateur (29/10, d'après le plan)** : date brute lue une fois dans un champ `rawTimeMs` (et non `timeMs`, déjà pris par la date répartie de `TrackPoint` : un `TrackPoint` passé à `samplingIntervalS` changerait le résultat sans erreur de type) ; meilleurs segments classés dans l'unité d'affichage comme aujourd'hui (le classement en m/s n'est pas neutre : deux vitesses distinctes peuvent devenir égales une fois converties), le bogue latent C17 reste pour un lot non neutre ; non livrés : temps à vélo arrondi (non neutre par construction, hors ouverture), analyse du surf partagée entre `surfRides` et `summarizeSession` (réglages pris à des moments différents), masque unique (seuils égaux seulement si 0), reprise de la distance d'un pas à l'autre (environ 1 ms) ; lecteur GPX livré seulement si le banc navigateur montre un gain.

### 57 · Briques communes 2 : angles, géométrie, temps, médiane, profils

Opus | medium. Neutre. Sources : 04-A1, 04-A4 à A7, 04-A10, 04-A12, 04-A13, 04-A15, 04-C6, 04-C7, 05-A8, 05-A10, 05-C2, 05-C8, 06-A9, 07-A3, 07-A5, 08-A5, 08-A9, 08-C1.

**Ce qui existe**
- Angles : `angleDiff`, `normalizeAngle` (`sailing/wind.ts:24-30`) et `circularMean` (`:96-113`) servent hors voile (`recording/liveLegs.ts:5`, `hooks/useSailingSession.ts:17`, `pages/SailingModule.tsx:46`) ; copies : `normalizeDeg` (`library/record.ts:443`), `signedDelta` (`surfing/gpsTurns.ts:19-22`, rend ]−180 ; 180] au lieu de [−180 ; 180[), normalisation en ligne (`platform/compass.ts:23`, `core/kinematics.ts:44`), moyenne vectorielle pondérée (`recording/liveLegs.ts:75-96`) ; conversions à la main au lieu de `toRad`/`toDeg` (`liveLegs.ts:79, 93`, `wind.ts:38, 102, 111, 123, 618, 621`, `maneuvers.ts:843`, `sailingAnalytics.ts:460`, `core/shareImage.ts:93`) ; cap affiché `Math.round(x) % 360` 7 fois (`RecordingPage.tsx:170, 246`, `PlanningPage.tsx:1021`, `liveFields.ts:285, 288`, `useCompassHeading.ts:12`, `maneuvers.ts:514`).
- Géométrie : `EARTH_RADIUS_M`, `toRad`, `toDeg`, `haversineDistance`, `initialBearing` dans la cinématique (`core/kinematics.ts:11-45`), importés pour de la géométrie par `geoPlane`, `simplify`, `planning/*`, `recording/*` ; plan local recopié (`core/geoPlane.ts:47-49, 65-72`, `core/simplify.ts:53-60`, `planning/wayMatch.ts:90-94`), alors que `geoPlane` se dit « la seule écriture » ; longueur et distance cumulée d'un tracé par Haversine 4 fois (`planning/route.ts:859-865`, importée par `recording/followedTrace.ts:4` ; `planning/surface.ts:307-328` ; `planning/legCalculation.ts:236-239` ; `recording/markGuide.ts:209`) : des parcours sans temps, hors règle 6 ; `LatLon` déclaré 5 fois (`core/geoPlane.ts:11`, `core/simplify.ts:13`, `recording/followedTrace.ts:17`, `recording/markGuide.ts:22`, `planning/ignAltimetry.ts:36`).
- Recherche dans le temps : `core/search.ts:11-36` existe, mais la même dichotomie est réécrite 8 fois avec trois sémantiques aux bords : `core/pumping.ts:208-222` (`trackValueAt`, interpolée, bornée), `core/jumps.ts:345-358` (`speedAt`, `null` hors trace), `core/jumps.ts:404-414` (`trackIndexAtTime`, plus proche), `core/chartZoom.ts:94-100`, `core/kinematics.ts:303-312`, `recording/followedTrace.ts:150-158`, `running/energy.ts:358-368`, `sailing/wind.ts:166-171` (angles) ; et `running/intervalStats.ts:32-43` (`sampleAt`), `running/fitnessTestResults.ts:41-54` (`valueAt`).
- Médiane écrite 6 fois, deux conventions : `core/speedFilter.ts:26-33`, `core/kinematics.ts:326-330`, `core/sessionSpeed.ts:118-120` (moyenne des deux centrales) ; `core/imuVertical.ts:72-75`, `core/imuFile.ts:485-486`, `running/cadence.ts:319` (valeur haute).
- Unité du Doppler : la boucle de choix écrite deux fois dans `core/kinematics.ts` (`:128-139` et `:333-344`).
- Profils : `maxDetourRatio: 3` écrit 5 fois (`core/sportProfiles.ts:555, 591, 626, 666`, `kinematics.ts:162`) ; bloc d'attitude recopié (`sportProfiles.ts:257-259` et `274-276`, huit valeurs) ; `SurfProfile.maxGapS` (`:361-362`, lu par `surfing/surfAnalysis.ts:143, 217, 232`) double `SportProfile.maxGapS` ; `MAX_SAMPLE_S = 10` (`core/sessionSpeed.ts:32`) ; `recording` du surf égal à `INTERVAL_RECORDING` (`:679`, `:121`) ; `pauseAfter` 0,3 (`core/activityPresets.ts:54`) égal à `DEFAULT_RECORDING.autoPauseSpeedMs` (`sportProfiles.ts:113`) ; pré-réglages `run-intervals` et `run-test` identiques (`activityPresets.ts:95-112`) ; une dizaine de champs communs répétés dans `RUNNING_PROFILE`, `CYCLING_PROFILE`, `SURF_PROFILE` ; `getSportProfile(sport)` (36 appels) et `SPORT_PROFILES[sport]` (12) ; clés des cibles de la voile recopiées trois fois (`types/sailing.ts:6-15`, `sportProfiles.ts:485-493`, `sailing/sailingStats.ts:29-39`) ; `spanHeartRate` qui recopie `forEachCounted` (`core/heartRate.ts:375-388`, `55-72`).
- Petites copies de domaine : `windAt` (`sailing/maneuvers.ts:218-219`) ≡ `resolveWind` (`sailing/sailingAnalytics.ts:80-81`) ; `gradeGradientColor` et `gradeStepColor` (`running/runningAnalytics.ts:245-263`) qui dupliquent `steepness`.

**À faire, dans cet ordre**
1. `core/angles.ts` : `normalizeDeg`, `angleDiff` (convention actuelle de `wind.ts`), `signedDeltaHalfOpen` (convention de `gpsTurns`, gardée telle quelle : un virage de 180° pile), `circularMean`, `roundBearingDeg`, `toRad`/`toDeg` déplacés ; `sailing/wind.ts` et `core/kinematics.ts` réexportent pour ne pas toucher leurs appelants d'un coup ; `recording/liveLegs.ts` importe le noyau.
2. `core/geo.ts` : géodésie, `planeProjection(refLat, origin?)`, `pathLengthM(points)`, `cumulativeDistancesM(points)` ; `kinematics.ts` réexporte ; `simplify`, `wayMatch`, `geoPlane`, `route`, `surface`, `legCalculation`, `markGuide`, `followedTrace` s'y ramènent ; `LatLon` dans `core/types.ts`.
3. `core/search.ts` : `bracketAt(values, x)`, `valueAtTime(track, value, ms, outside: 'clamp' | 'null')`, `nearestIndexAtTime(track, ms, maxGapMs?)`, `interpolateAtTime(points, value, ms)`, sur `lastIndexAtOrBeforeTime` ; chaque copie garde exactement sa sémantique aux bords ; le vent garde son interpolation d'angles mais prend `bracketAt`.
4. Médiane : `medianOfSorted`, `median`, `upperMedian` (nommée pour les usages capteurs), chaque convention gardée ; `unitFromRatio` appelé par `detectDeviceSpeedUnit`.
5. Profils : `COMMON_DEFAULTS` et `ATTITUDE` étalés ; `SurfProfile.maxGapS` retiré au profit de `profile.maxGapS` ; `MAX_SAMPLE_S` et `DEFAULT_MAX_DETOUR_RATIO` lus du profil ou d'une seule constante ; types des cibles de la voile tirés de `SAILING_TOP_TARGETS` (`as const`) ; `forEachCounted` borné (`from`, `to`) pour `spanHeartRate` ; `windAt` exporté une fois ; `gradeGradientColor` sur `gradeStepColor`.

**Garde-fous**
- Ordre des opérations flottantes gardé (égalité exacte) ; la convention de bord de `gpsTurns` ne change pas.
- `sailing/*` reste en nœuds (règle 5) ; seule la provenance des angles change.
- `SPORT_PROFILES` doit rester égal à lui-même.

**Preuve de neutralité** : avant le lot, `JSON.stringify(SPORT_PROFILES)` et `ACTIVITY_PRESETS` sauvés dans le brouillon, comparés après ; tests de chaque brique ; tests de `wind`, `maneuvers`, `gpsTurns`, `liveLegs`, `simplify`, `wayMatch`, `route` inchangés ; `manoeuvres-diagnostic.mjs` identique ; banc `general.mjs`, `planning.mjs`, `surf.mjs`, `balises.mjs` avant/après.

**Rapport attendu** : copies retirées par brique ; toute réexportation laissée (à retirer au lot 71).

### 58 · Voile : au seuil, ne refaire que ce qui en dépend

Opus | high. Neutre au bit près. Seul dans sa session (DECISIONS §1, « Coût du vent » : ce chemin ne se retouche jamais en même temps qu'autre chose). Sources : 01-B9, 02-B6, 03-B3, 04-B7, 04-B10, 05-B1, 05-B2, 05-B5, 05-B7, 05-E3.

**Ce qui existe**
- Depuis le lot 30, un cran du seuil coûte 142 + 2 ms sur 3 h à 5 Hz (16 + 0 ms à 1 Hz) : la détection des virages est préparée une fois (`prepareManeuverDetection`), mais le vent et les statistiques repartent à chaque cran.
- Polaire : `estimateWind` (`sailing/maneuvers.ts:462-520`) appelle `estimateWindPolar` (`sailing/wind.ts:660`), qui appelle `estimateWindFromPolar` puis `polarWindCandidates` (`:345-365`) ; puis `selectWindCandidate` (`maneuvers.ts:390-443`) rappelle `polarWindCandidates` (`:408`) et `describeWindCandidate` (`:412`, `wind.ts:373-380`). Soit 3 passes `buildMaxSpeedsByBearing` sur toute la trace et 2 balayages de 360 × 360 de `scoreWindCandidate`, plus `observeTurns` (`wind.ts:521-599`, environ 3 M d'`angleDiff` à 5 Hz, quand le contraste polaire est faible) et `polarSampling`. Rien de cela ne dépend du seuil (seulement de la trace et de `polarMinSpeedKn`), mais le `useMemo` du hook en dépend (`hooks/useSailingSession.ts:154-167`).
- Statistiques : `buildSailingSessionStats` (`sailing/sailingStats.ts:46-76`) appelle `buildBaseSessionStats` sans `elevationStats` (`core/sessionStats.ts:240-241`), donc `computeElevationStats` → `linearSmoothByTime` (régression non incrémentale sur 20 s, environ 25 ms) alors que la voile n'affiche pas l'altitude (DECISIONS §2, « Rien en voile » ; `SailingModule` ne lit aucun `elevation*`) ; `ratioMask` (seuil 0, `sailingStats.ts:64`) ne dépend pas du seuil ; `sailingFlights` (`:90`) recalcule le masque déjà fait en `:59` (7,5 ms chacun).
- `scanTurnWindow(points, i, 12 s, 30 s)` appelé par `observeTurns` (`wind.ts:531`) et `readWindow` (`maneuvers.ts:1147`) avec les mêmes arguments, même résultat pour un même `i`.
- `classifyManeuvers` (`maneuvers.ts:1461-1493`) construit le tracé `path` de chaque manœuvre à chaque classement (environ 8 par cran), seul le dernier est affiché.
- `PointData.time` et `PointData.speed` recopiés sur chaque point sans jamais être lus (`utils/kinematics.ts:14-18, 30-32`).
- Vitesse des graphes de la voile passée par une chaîne : `parseFloat(formatKnots(v, unit))` (`pages/SailingModule.tsx:215, 525-527`), fragile (le tiret donne `NaN`).
- Une icône Leaflet neuve par flèche de cap, à chaque trace (`SailingModule.tsx:144-153, 436-442`).
- Le curseur du seuil écrit le brouillon à chaque cran (`SailingModule.tsx:1257`).

**À faire, dans cet ordre**
1. Script de coût rebâti dans le brouillon sur le modèle de la fiche 30 (trace synthétique de 3 h, vent du nord, bruit de position indépendant de ±0,1 m, médiane de 5 passes, 1 Hz et 5 Hz) : coût d'un cran du seuil avant (attendu environ 142 + 2 ms à 5 Hz).
2. `prepareWindPolar(points, minSpeedKn): WindPolarStage` (polaire, candidats, `polarSampling`, observations de virages) ; `estimateWind(points, { ...options, polarStage? })`, refusée si l'étage vient d'une autre trace ou d'un autre `minSpeedKn` (comme `detection` au lot 30) ; dans `polarWindCandidates`, `buildMaxSpeedsByBearing` calculé une fois et passé à `describeCandidate` ; le hook mémorise l'étage sur `[trackData, polarMinSpeedKn]`.
3. Statistiques : `elevationStats: EMPTY_ELEVATION` en voile ; `ratioMask` mémorisé sur la trace ; `sailingFlights` reçoit le masque des statistiques.
4. `scanAt(i)` mémorisé dans `ManeuverDetection`, passé à `observeTurns` s'il y est encore sur le chemin du seuil (sinon ne rien faire).
5. `PointData` sans `time` ni `speed` ; vitesse des graphes par conversion numérique (même arrondi que l'affichage, `toFixedNumber` du lot 55) ; icônes de flèche en cache par cap arrondi au degré.
6. Curseur du seuil : `useDeferredValue` sur le seuil dans le hook (Q40, par défaut oui) : le curseur reste fluide, les chiffres suivent juste après ; la valeur finale est identique.
7. Seulement si le reste est livré et `toEqual` passe : `path` paresseux (accesseur) dans `ManeuverLocation`.

**Garde-fous**
- Neutralité exacte : chaque `WindEstimate`, chaque `ManeuverStats`, `VmgStats`, `windStats`, `stats` (hors champs `elevation*`) identiques ; vérifier par recherche qu'aucun lecteur de `stats.elevation*` n'existe en voile, image de partage comprise (`library/shareStats.ts:70` lit la fiche, pas ces statistiques).
- Garder `segmentStart` dans le pas unique et les distances, `localWind` arrondi puis normalisé, `buildWindTimeline` avec repli aux bords (lot D du 26/10) ; pas de polaire glissante ni de corde entrée → sortie (règle 7).
- Le hook ne change que pour mémoriser ; l'écran ne change pas.

**Preuve de neutralité** : comme au lot 30 : 20 sessions × 7 vents, `estimateWind` avec et sans `polarStage` en `toEqual`, JSON identique octet pour octet ; `manoeuvres-diagnostic.mjs` identique sur la trace de `make-gpx.mjs` et (par l'orchestrateur) sur les 12 sessions réelles en lecture seule ; banc `general.mjs` (voile) avant/après.

**Mesure attendue** : coût d'un cran du seuil à 5 Hz sur 3 h, avant (environ 142 + 2 ms) et après ; la part du vent devrait tomber près de zéro (la polaire n'est plus refaite), estimation 20 à 60 ms gagnés plus 25 ms d'altitude et 15 ms de masques.

**Rapport attendu** : mesures ; étapes non livrées et pourquoi ; confirmation qu'aucun chiffre n'a bougé.

### 59 · Graphes 1 : pièces communes et survol de la planification

Sonnet | high. Neutre. Sources : 01-A2, 01-A3, 01-A4, 01-A7, 01-A9, 01-A10, 01-A11, 01-B2, 01-B3, 01-B6, 01-B8, 01-C3, 01-C9, 01-D3, 01-E3, 02-A6, 02-A7, 02-A8, 02-A15, 02-B1, 02-C9, 07-B3, 08-A4, 08-D3.

**Ce qui existe**
- Couleurs de données recopiées : vitesse `#1e88e5` 20 fois dans 8 fichiers (`SPEED_COLOR` déclarée trois fois : `FitnessTestPanel.tsx:22`, `FitnessTestPlanChart.tsx:10`, `IntervalAnalysis.tsx:79` ; en dur : `LandModule.tsx:808, 852-853, 875, 973, 1046`, `SurfModule.tsx:402, 438-439, 447, 468, 782`, `HeartRatePanel.tsx:266, 273`, `MuscuModule.tsx:70` ; et en `rgba(30, 136, 229, …)` dans `ZoomableChart.css:30-32`) ; vitesse de la voile `#1976d2` (`SailingModule.tsx:567, 597, 636`) ; altitude et énergie `#e64a19` 14 fois (`ALTITUDE_COLOR` dans `ElevationProfileMini.tsx:21`, en dur dans `LandModule.tsx:839, 856, 876, 1078, 1088-1094, 1127, 1486`, `SpeedPolarChart.tsx:25`, `PlanningPage.tsx:542`) ; `SHOWN_COLOR = '#7b1fa2'` (`IntervalAnalysis.tsx:77`) au lieu de `HIGHLIGHT_SHOWN_COLOR` (`highlightColors.ts:11`) ; `PHASE_FILL` deux fois, `MARK_COLOR` trois fois (`FitnessTestPanel.tsx:25`, `FitnessTestPlanChart.tsx:12`, `RestingHrChart.tsx:6`) ; `#9aa0a6` (« Autres ») dans `StatisticsPage` et `ProfilePage`.
- Réglages Recharts recopiés : `<CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />` 23 fois ; `tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}` 24 fois ; libellé d'axe vertical 7 fois.
- Gestionnaire de survol recopié 8 fois (`ElevationProfileMini.tsx:55-58`, `FitnessTestPanel.tsx:123-126`, `HeartRateChart.tsx:40-43`, `LandModule.tsx:784-787, 791-794, 796-799`, `SailingModule.tsx:503-506`, `SurfModule.tsx:394-397`).
- Axe du temps et lectures recopiés : minutes depuis le premier point (`SailingModule.tsx:512-515`, `SurfModule.tsx:368`, `LandModule.tsx:522-525`, `MuscuModule.tsx:141`, `HeartRatePanel.tsx:84-85`) ; zoom de 0 à la dernière minute (`SailingModule.tsx:517, 548`, `SurfModule.tsx:369, 410`, `LandModule.tsx:527-530, 649-657`, `MuscuModule.tsx:143-145`) ; axe des heures identique au caractère près (`SailingModule.tsx:538-543` = `SurfModule.tsx:387-392`) ; lectures de vitesse et de FC (`SailingModule.tsx:564-576` ≈ `SurfModule.tsx:399-409` ; FC identique à 5 endroits : `SailingModule.tsx:569-573`, `SurfModule.tsx:405-409`, `HeartRatePanel.tsx:97-101`, `MuscuModule.tsx:156-162`, `LandModule.tsx:814-817`) ; graphe compagnon « cardio » (`SailingModule.tsx:655-659` ≡ `LandModule.tsx:1133-1137` ≡ `SurfModule.tsx:481-485`).
- `CardioCurve` recalcule les minutes de toute la trace à chaque instance (`HeartRatePanel.tsx:84-85`) ; la muscu recopie `CardioCurve` pour ajouter ses bandes (`MuscuModule.tsx:141-162, 230-246` contre `HeartRatePanel.tsx:72-115`).
- Graphes du test guidé : constantes, bandes des phases et noms recopiés entre `FitnessTestPlanChart.tsx:9-13, 44-50, 55-87` et `FitnessTestPanel.tsx:21-25, 105-121, 144-178` ; points du protocole à `+0,6 km/h` en dur (`FitnessTestPlanChart.tsx:65`) alors que le plan suit `params.protocol.stepMs` (`recording/fitnessTest.ts:50, 95, 645`).
- Aide du zoom : constantes dans `LandModule.tsx:122-123`, réécrites dans `SailingModule.tsx:579-581`, `SurfModule.tsx:778`, variante dans `MuscuModule.tsx:219` ; ancre `'map-view'` en dur trois fois en voile (`:559, 686, 1004`) et recopiée en constante (`LandModule.tsx:125`, `SurfModule.tsx:115`).
- Tête d'un graphe (nom repliable et lecture) écrite trois fois, avec trois infobulles « Replier le graphe de … » (`LandModule.tsx:950-955, 1066-1070, 1485-1489`, `SurfModule.tsx:780-794`, `SailingModule.tsx:285-297`).
- Animations Recharts restées actives sur 6 séries (`LandModule.tsx:900, 973, 1043, 1046`, `SailingModule.tsx:597, 616`) : Recharts 3.10.1 anime par défaut (`'auto'`) ; la courbe rejoue 1,5 s d'animation à chaque image d'un pincement.
- Planification : point survolé dans un état de la page (`PlanningPage.tsx:388, 526-546, 927, 1072`) : chaque mouvement sur le profil redessine les 1 323 lignes de la page, carte comprise ; `ElevationProfileMini` a deux façons de lire (`read` à terre, `readout` en planification, `:43, 63`) ; `onHoverIndex`/`onLeave` traversent 5 composants.
- Courbe des sauts : lignes refaites à chaque rendu (`JumpsPanel.tsx:311-319`).

**À faire, dans cet ordre**
1. `components/chartStyle.ts` : `SPEED_COLOR`, `SAILING_SPEED_COLOR` (Q36, par défaut les deux bleus restent), `ALTITUDE_COLOR`, `ENERGY_COLOR`, `TREND_COLOR`, `PHASE_FILL`, `CHART_MARK_COLOR`, `OTHERS_COLOR`, `CHART_GRID_PROPS`, `CHART_TICK`, `chartTick(color)`, `yAxisLabel(value, color)` ; les couleurs restent en dur, à un seul endroit (comme `heartRateColors.ts`) ; `ZoomableChart.css` lit une variable posée depuis cette couleur ; `SHOWN_COLOR` → `HIGHLIGHT_SHOWN_COLOR`.
2. `trackHover(rows, onIndex = setHoveredIndex)` dans `components/chartHover.ts` avec son test ; alias retirés.
3. `zoomHint(narrow, noun?)` exporté de `ZoomableChart.tsx` ; `ANALYSIS_MAP_ANCHOR` exporté d'`AnalysisMap.tsx`.
4. `hooks/useTimeChartAxis.ts` → `{ minutes, fullRange, zoom, cardioZoom, timeAxis(zoom), readable(zoom, i), readAt(i) }` ; `components/chartReadouts.ts` : `heartRateReadout`, `speedReadout`, purs et testés ; `CardioCurve` reçoit `minutes` et accepte des `children` (la muscu l'emploie) ; `CardioCompanion` pour le graphe compagnon.
5. `GraphFoldHead({ label, color, open, onToggle, read? })` dans `components/ChartFold.tsx`, chaque infobulle passée telle qu'aujourd'hui.
6. `components/fitnessTestChartParts.tsx` (constantes, `phaseAreas`, `phaseLabel`) ; points du protocole tirés de la cible du plan à l'instant du bip (aujourd'hui identiques puisque le pas est 0,6 km/h : neutre).
7. `isAnimationActive={false}` sur les 6 séries.
8. Planification : survol par le magasin (`setHoveredIndex`, `HoveredTrackMarker`, `HoverReadout`) ; `ElevationProfileMini` perd `readout` ; les composants de graphe écrivent directement dans le magasin.
9. `JumpsPanel` : lignes de la courbe sous `useMemo`.

**Garde-fous** : couleurs, textes, infobulles et graduations identiques ; règle 11 hors sujet ici ; ne pas changer `syncId` (lot 61).

**Preuve de neutralité** : tests de `trackHover`, `chartReadouts`, `useTimeChartAxis` (fonction pure extraite) ; banc `general.mjs`, `graphes.mjs`, `survol.mjs`, `cardio.mjs`, `test-fcmax.mjs`, `planning.mjs` avant/après, texte identique.

**Mesure attendue** : rendus de `PlanningPage` pendant un balayage du profil, avant (un par mouvement) et après (zéro), par un compteur dans une copie de `survol.mjs` ou le profileur de React.

**Rapport attendu** : copies retirées ; mesure du survol ; toute infobulle qui aurait changé.

### 60 · Graphes 2 : un seul graphe de trace, course et vélo

Opus | high. Neutre. Sources : 01-A1, 01-B7, 01-C1, 02-B5.

**Ce qui existe**
- Le squelette `ZoomableChart > ResponsiveContainer > graphe (marges 5/10/0/0) > ChartZoomProbe > CartesianGrid > XAxis numérique (domaine et graduations de zoom.shown) > YAxis à la couleur de la série (largeur 46, unité verticale) > Tooltip vide > séries (dot false, activeDot, connectNulls false)` est écrit 15 fois : `ElevationProfileMini.tsx:64-81`, `HeartRateChart.tsx:45-67`, `FitnessTestPanel.tsx:144-158, 161-178`, `JumpsPanel.tsx:135-158`, `IntervalAnalysis.tsx:166-187`, `LandModule.tsx:889-904, 964-977, 995-1010, 1031-1060, 1079-1098`, `SailingModule.tsx:584-601, 603-620`, `SurfModule.tsx:429-451`, `StatisticsPage.tsx:658-708`.
- Écarts voulus : clé et format de l'abscisse, type de série, éléments ajoutés, `syncId` (à pied seulement). Dérives : voir lot 61.
- Lignes des graphes calculées même onglets fermés (`LandModule.tsx:684-703`, `gradeStops` `:708-711`), alors que le surf les conditionne (`SurfModule.tsx:372`).
- Calculs de lignes mêlés au rendu, sans test (`LandModule.tsx:680-1145`).

**À faire, dans cet ordre**
1. `components/TrackChart.tsx` :
   `<TrackChart zoom rows x={{ key, format }} yAxes={[{ id, color, unit, domain, reversed, hide }]} series={[{ kind: 'line' | 'area' | 'step', key, yAxisId, color, width, gradientId? }]} onHover={trackHover(rows)} onLeave onShowOnMap showReset syncId style>{bandes, seuils, repères}</TrackChart>` ; à côté : `timeOfDayAxis(t0)`, `minutesAxis()`, `distanceAxis(symbol)` ; animations coupées d'office.
2. `HeartRateChart` et `ElevationProfileMini` deviennent des enveloppes de `TrackChart`.
3. Les 5 graphes de `LandModule` (altitude colorée, vitesse, FC, cadence, superposés, énergie) passent par `TrackChart`.
4. `core/chartRows.ts` : `trackChartRows(...)` pur avec son test ; lignes calculées seulement si « graphiques », « zones de pente » ou le plein écran sont ouverts (la FC de « graphiques » et `gradeStops` en dépendent : les garder justes).

**Garde-fous**
- Recharts ne voit pas un `ReferenceLine` ou un `ReferenceArea` rangé dans un composant à lui (`markReferenceLines.tsx:5-9`, `FitnessTestPlanChart.tsx:43`) : les ajouts restent des tableaux passés directement en `children`.
- Le `syncId` de la course et du vélo reste tel quel.
- `MISE_EN_PAGE.md` (graphes : noms à 10 px, « +carte » sur chaque graphe, repli à sa place) inchangé.

**Preuve de neutralité** : banc `graphes.mjs`, `general.mjs`, `pentes.mjs`, `depense.mjs`, `cadence.mjs` (course et vélo) avant/après : texte des lectures et graduations identique ; captures d'un graphe zoomé avant/après jointes au rapport.

**Rapport attendu** : lignes retirées ; graphes passés ; écarts de rendu vus sur les captures (il ne doit pas y en avoir).

**Tranché par l'orchestrateur (29/10, questions mineures du plan)** : spécifications d'axe nommées `distanceX`, `elapsedX`, `timeOfDayX` (les noms de la fiche sont pris par les fabriques du lot 59) ; le profil passe à `ComposedChart`, une prop `chart="area"` seulement si les captures diffèrent ; repères derrière les axes verticaux si les captures sont identiques, sinon une prop `before` ; `core/chartRows.ts` rend des lignes en unités affichées, accepté (conversion de sortie par `core/units`, règle 1 respectée, comme le veut la fiche).

### 61 · Graphes 3 : voile, surf, test, sauts, fractionné ; pics gardés

Opus | high. Neutre jusqu'à l'étape 4, puis non neutre (Q37, Q38, bogue D3). Sources : 01-A1, 01-B4, 01-B5, 01-C1, 01-C2, 01-C7, 01-D1, 01-D2, 01-D4, 08-D7.

**Ce qui existe**
- Graphes encore hors de `TrackChart` après le lot 60 : `SailingModule.tsx:584-601` (vitesse, marge gauche −25, axe sans unité, animée), `603-620` (vent) ; `SurfModule.tsx:429-451` ; `FitnessTestPanel.tsx:144-158, 161-178` (le graphe de FC n'a pas « +carte », alors que `ZoomableChart.tsx:85` et MISE_EN_PAGE le veulent sur chaque graphe) ; `JumpsPanel.tsx:135-158` (grille `--line-soft` au lieu de `--chart-grid`, graduations sans couleur rattrapées par `ui.css:662`, graduations tirées de `zoom.view` au lieu de `zoom.shown`, `:142-146`) ; `IntervalAnalysis.tsx:166-187` (graduations de `zoom.view`, `:172`).
- Survol gardé dans un état du graphe : `IntervalProfileChart` (`IntervalAnalysis.tsx:156-157`, 21 `Line` redessinées par mouvement pour 20 répétitions) et `JumpCurveChart` (`JumpsPanel.tsx:118-122`).
- `IntervalAnalysis` refait tout à chaque rendu : mini-courbes calculées deux fois (`:346`, `:543`), lignes de l'évolution et du profil (`:470-480`, `:531-540`), `Math.min(...valeurs)` sur des tableaux étalés (`:352`, `:546-547`), lissage, dégradé, tendance, échelle (`:86, 111-117, 210-227, 469, 543-551`) ; courbes de deux sauts fusionnées dans le rendu (`JumpsPanel.tsx:87-91, 311-319`).
- Bogue : le zoom du profil des répétitions survit au changement de session (clé `${seriesIndex}-${reps.length}-${length}`, `IntervalAnalysis.tsx:557` ; pas de `key` de session, `LandModule.tsx:1245`).
- Bogue : les lignes sont choisies pour garder les extrêmes de la vitesse seulement (`LandModule.tsx:687`, `SailingModule.tsx:523`, `SurfModule.tsx:374`) : un pic bref de FC ou de cadence disparaît de « graphiques » (il reste dans « cardio », `HeartRatePanel.tsx:89`).
- À vérifier : un clic sur l'évolution des répétitions lit `activeTooltipIndex` sans `isTooltipActive` (`IntervalAnalysis.tsx:481-486`).
- Voile : noms des graphes en `--text-s` gras (`SailingModule.tsx:288-289`, titre du vent vers `:1207`) au lieu de 10 px à la couleur de leur courbe (MISE_EN_PAGE.md:38) ; disposition propre (sous-panneaux de 500 et 350 px, case réservée à un graphe replié, `:293-297, 1081-1105`).
- `syncId` (curseur commun des graphes empilés) à pied seulement (`LandModule.tsx:892, 966, 997, 1033`).

**À faire, dans cet ordre**
1. Neutre : voile (vitesse, vent), surf, test, sauts, fractionné passent par `TrackChart` ; les dérives non voulues (animation, marge −25, grille et graduations des sauts, graduations de `zoom.view`) disparaissent : seul le rendu des sauts change au pixel (grille et graduations au thème), texte identique.
2. Neutre : `running/intervalCharts.ts` (`intervalChartData(series, stepS)`, mini-courbes, tendance, échelle) et `jumpCurveRows` dans `core/jumps.ts`, purs et testés, appelés une fois sous `useMemo` ; lecture du survol séparée du graphe (un petit magasin local) pour le profil des répétitions et la courbe des sauts.
3. Bogue : clé de remise à zéro du profil des répétitions avec la clé de la session ; clic de l'évolution vérifié au banc et gardé par `isTooltipActive` si le défaut se confirme.
4. Non neutre, Q37 (par défaut : disposition de la voile gardée, seuls les noms des graphes suivent la règle commune) et Q38 (par défaut : curseur commun vitesse/FC en voile et en surf) ; « +carte » sur le graphe de FC du test (règle existante).
5. Non neutre, bogue D3 : `sampledIndices` sur plusieurs séries (garder les extrêmes de chaque série tracée) ; captures avant/après d'une sortie à sprints.

**Garde-fous** : `id` des panneaux que `JumpsPanel` et `IntervalAnalysis` créent eux-mêmes (`panelPrefix`, `panelId`) inchangés ; `MISE_EN_PAGE.md` suivi ; rien d'autre ne bouge en voile.

**Preuve** : étapes 1 à 3 au banc (`general.mjs` voile et surf, `test-fcmax.mjs`, `sauts.mjs`, `fractionne.mjs`), texte identique ; étapes 4 et 5 : captures, et liste des changements visibles dans le rapport.

**Rapport attendu** : par étape, ce qui a changé à l'écran (rien pour 1 à 3) ; captures des étapes 4 et 5.

### 62 · Coquille 1 : session et onglets

Opus | high. Neutre. Sources : 02-A1, 02-A2, 02-A3, 02-C5, 03-A1. Le verdict des rapports : une coquille commune est réaliste en pièces, pas en un seul composant (le cœur des sports diffère trop) ; lignes récupérables par la coquille seule : environ 450 à 550 sur les 4 125 lignes des quatre modules.

**Ce qui existe**
- Lecture de la session et activité de la fiche reprise (`receiveSession`) recopiées 4 fois : `SailingModule.tsx:220-225`, `LandModule.tsx:286-296`, `SurfModule.tsx:175-185`, `MuscuModule.tsx:94-105` (seul le chargeur diffère : `loadGpxContent`, ou `parseGpx` en muscu).
- Garde « fichier affiché = fichier de l'adresse » : 5 fois en ligne dans `LandModule.tsx` (`:299, 304, 335, 392, 429`), `shownFile` dans `SurfModule.tsx:187` et `MuscuModule.tsx:106-108`, `loadedFromMemory` dans `SailingModule.tsx:244`.
- `const [allActivities] = useState(readStoredActivities)` et `useChangeSessionActivity` ×4 (`SailingModule.tsx:233-234`, `LandModule.tsx:318-319`, `SurfModule.tsx:189-190`, `MuscuModule.tsx:180-181`).
- Onglets : `tabChoices`, `setGeneral`, `useAdvancedTabs`, `open = maskAdvancedTabs(maskHiddenTabs(...))`, identiques au nom près (`SailingModule.tsx:275, 279, 299-301`, `LandModule.tsx:321-328`, `SurfModule.tsx:202-209`, `MuscuModule.tsx:122-129`) ; `useResetChartHover(sessionKey)` ×4 (`LandModule.tsx:373`, `SurfModule.tsx:221`, `SailingModule.tsx:367`, `MuscuModule.tsx:112`).
- `*_SECTION_DEFAULTS` (`SailingModule.tsx:110-122`, `LandModule.tsx:152-166`, `SurfModule.tsx:91-101`, `MuscuModule.tsx:63`) : chaque valeur vaut `true` exactement pour les onglets `primary` de `core/analysisTabs.ts` ; le typage force à recopier chaque clé à chaque onglet ajouté.
- `cumulative = buildCumulativeTrack(track)` refait par chaque module (`LandModule.tsx:379-381`, `SurfModule.tsx:225-227`, `hooks/useSailingSession.ts:86`).
- La voile lit `useSearchParams` en direct (`SailingModule.tsx:159-161, 965-966`) alors que `useSessionFromUrl` rend `requested`.

**À faire, dans cet ordre**
1. `core/analysisTabs.ts` : `tabDefaults<K extends string>(tabs: readonly AnalysisTab<K>[]): Record<K, boolean>` (pour la terre, l'union des listes : `cadence` n'est qu'à pied) ; test : égal à chacune des quatre constantes actuelles ; constantes remplacées.
2. `useGpxSession` rend aussi `cumulative` (une seule `buildCumulativeTrack` par trace, voile comprise).
3. `hooks/useAnalysisSession.ts` : `useAnalysisSession({ family, activity, setActivity, load, loadedFile }) => { requested, sessionFile, shownFile, error, draft, allActivities, changeActivity }` (`draft = useSessionDraft(shownFile)`, la règle du lot 54).
4. `hooks/useAnalysisTabs.ts` : `useAnalysisTabs<K>(storageId, tabs, activity, sessionKey) => { open, toggle, toggleOf(key), set, closeAll, tabChoices, advanced, shown(keep), highlight }` (fait aussi `useResetChartHover`), `toggleOf` stable.
5. Adoption module par module : surf d'abord (le plus simple), puis muscu, terre, voile ; un module par étape, banc entre chaque.

**Garde-fous** : clés mémorisées exactement les mêmes (`sailing-onglets`, `running`, `cycling`, `intervals`, `surf`, `muscu`) ; décisions transverses « Général et avancé » et « Onglets des analyses » (CLAUDE.md) inchangées ; la consigne « Où ajouter quoi » sur `*_SECTION_DEFAULTS` est à réécrire par la passe doc (l'orchestrateur la propose à l'utilisateur, c'est `CLAUDE.md`).

**Preuve de neutralité** : test de `tabDefaults` ; banc `general.mjs`, `onglets.mjs`, `activite.mjs`, `session-save.mjs` par sport avant/après, texte identique ; `tailles.mjs` identique.

**Rapport attendu** : lignes retirées par module ; clés vérifiées.

### 63 · Coquille 2 : FC, couches de carte, sauts, pumping

Opus | medium. Neutre sauf Q39. Sources : 02-A4, 02-A5, 02-A14, 02-B3, 02-B4, 02-C6, 02-C11, 03-B7, 05-A7.

**Ce qui existe**
- FC : `useRunnerProfile` + `useSessionHeartRate` + `useMemo(runnerHeartRateZones…)` ×4 (`SailingModule.tsx:270-273`, `LandModule.tsx:268, 276-277`, `SurfModule.tsx:211-213`, `MuscuModule.tsx:88, 114, 119`) ; zone montrée et `hrZonePaths` identiques ×3 (`SailingModule.tsx:343-351`, `LandModule.tsx:358-360, 486-492`, `SurfModule.tsx:230-238`) ; leurs `Polyline` (`SailingModule.tsx:948-950`, `LandModule.tsx:1158-1160`, `SurfModule.tsx:497-499`).
- Couches communes de la carte (`BaseTileLayer`, zone FC en violet, tronçon zoomé avec le même `pathOptions`, `SessionMarksLayer`, `HoveredTrackMarker`) ×3 : `SailingModule.tsx:941-957`, `LandModule.tsx:1152-1174`, `SurfModule.tsx:493-504`.
- Sauts montrés et leur surbrillance ×2 (`SailingModule.tsx:256-264, 319-322, 1127-1145`, `LandModule.tsx:335-343, 366-369, 1502-1523`, seule la conversion du seuil diffère) ; pumping des vols identique ×2 (`SailingModule.tsx:323-331` ≡ `SurfModule.tsx:300-311`, libellés `:335-342` ≈ `:329-346`).
- Surf : capteurs lus dès l'ouverture (`SurfModule.tsx:301`), alors que la voile ne les lit qu'onglet ouvert (`SailingModule.tsx:303-304`, « une capture entière pèse plusieurs Mo ») ; ils ne servent qu'au panneau « vols » (`:730-754`).
- La voile refait le défilement vers la carte (`SailingModule.tsx:683-687`, `block: 'center'`) au lieu de `useZoomOnMap.show` (`hooks/useZoomOnMap.ts:101-112`, marge de la barre du haut).
- Casts non vérifiés de la surbrillance (`LandModule.tsx:353, 361`) ; `useMapHighlight` (`:30-35`) et `useZoomOnMap` (`:76-121`) rendent des objets et fonctions neufs à chaque rendu ; panneaux non mémoïsés, `onToggle={() => toggle('…')}` neuf à chaque rendu.

**À faire, dans cet ordre**
1. `hooks/useAnalysisHeart.ts` → `{ runner, retainHr, heart, hrZones }` ; `useHeartRateZoneHighlight(highlight, open, heart, hrZones, track, gapS) => { selectedZone, select, paths }`.
2. `components/AnalysisBaseLayers.tsx` (`{ family, track, zonePaths, zonePathsKey, zoomPath, marks, shownMark, children }`), couches propres au sport en `children`, dans l'ordre actuel (l'ordre de pose fait le dessus et le dessous).
3. `useShownJumps({ file, track, profile, activity, thresholdMs, highlight })` ; `useFlightPumping(recording, detection, track, cumulative, flights) => { byFlight, summary, podium }` dans `hooks/useSessionPumping.ts`.
4. Surbrillance typée par onglet (`MapHighlight<{ zones: GradeZoneKey; surface: SurfaceCategory; … }>`) ; `useMapHighlight` et `useZoomOnMap` stables (`useCallback`/`useMemo`) ; `scrollToMap()` exposé et repris par la voile (le défilement de la voile prend la marge de la barre : petit changement de position, dit au rapport).
5. Q39 (par défaut oui) : en surf, capteurs lus à l'ouverture de l'onglet « vols » seulement, comme en voile.
6. Mesurer d'abord (profileur, un zoom du graphe de vitesse), puis `memo` sur les panneaux lourds (cardio, fractionné) si le gain se voit.

**Garde-fous** : ordre des couches ; `id` des panneaux ; `useSessionPumping` garde un seul `.imu` décodé en mémoire.

**Preuve de neutralité** : banc `general.mjs`, `cardio.mjs`, `sauts.mjs`, `pumping.mjs`, `surf.mjs`, `zoom-carte.mjs` avant/après (zones FC, sauts et vols montrés sur la carte compris), texte identique.

**Rapport attendu** : lignes retirées ; mesure du profileur avant/après l'étape 6 ; effet visible de l'étape 4 (défilement) et 5 (onglet « vols »).

### 64 · Coquille 3 : panneaux, tableaux et surbrillances communs

Sonnet | high. Neutre. Sources : 01-A5, 01-A6, 01-A12, 02-A9 à A12, 02-A16, 02-A17, 02-A19 à A23, 02-A25, 07-A7, 07-B10, 08-A3, 08-A12.

**Ce qui existe**
- Onglet réglages : champ « Activité » ×4 (`SailingModule.tsx:1236-1245`, `LandModule.tsx:1546-1555`, `SurfModule.tsx:833-842`, `MuscuModule.tsx:298-306`, le muscu filtre les activités sans positions) ; cases Foil et Pumping identiques (`SailingModule.tsx:1261-1275` ≡ `SurfModule.tsx:843-856`) ; bornes de couleur avec le même `onChange` (`SailingModule.tsx:1291-1299`, `LandModule.tsx:1580-1588`, `SurfModule.tsx:881-887`) ; « Réglages de la session » et « Activité : » tapés ×4 (`LandModule.tsx:1536, 1547`, `MuscuModule.tsx:293, 299`, `SailingModule.tsx:1232, 1237`, `SurfModule.tsx:824, 834`) ; aide « Vitesse : fournie par l'appareil… » ×2 (`LandModule.tsx:1539-1541`, `SurfModule.tsx:827-829`).
- Onglets cardio et notes : `HeartRatePanel` avec 9 propriétés recopiées ×4 (`SailingModule.tsx:1111-1120`, `LandModule.tsx:1305-1313`, `SurfModule.tsx:803-812`, `MuscuModule.tsx:270-281`) ; `SessionNotesPanel` ×4 (`:1220-1227`, `:1526-1531`, `:814-819`, `:283-288`) ; `gearFields()` ×3 (`LandModule.tsx:225-228`, `SurfModule.tsx:133-136`, `MuscuModule.tsx:74-77`).
- Tableaux : le même style en ligne 12 fois (`CadencePanel.tsx:30`, `FlightPumpingPanel.tsx:57`, `HeartRatePanel.tsx:193`, `IntervalAnalysis.tsx:199`, `JumpsPanel.tsx:76`, `TopsPanel.tsx:39`, `LandModule.tsx:1397, 1451`, `SailingModule.tsx:718, 758, 883`, `SurfModule.tsx:137`) ; ligne grisée d'une valeur nulle 8 fois ; trait de ligne 9 fois ; `padding: '7px 14px'` ×10 (`SailingModule.tsx:761-779`) ; bascule tableau → cartes au téléphone recopiée en CSS (`IntervalAnalysis.css:19-45` ≡ `JumpsPanel.css:76-109`) ; style de panneau `{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize }` 20 fois plus 13 sous l'alias `cardStyle` ; `heading` identique (`JumpsPanel.tsx:179-183` = `IntervalAnalysis.tsx:300-304`).
- Tableau des tranches avec barre de part et « Voir » : `CadencePanel.tsx:106-142` contre `HeartRatePanel.tsx:193-233` (même expression de libellé, `:119` = `:207`).
- Surbrillance d'un passage : `JumpMapLayer.tsx:27-39` ≈ `TrackSpanLayer.tsx:26-37` ; `{ color, weight: 10, opacity: 0.8 }` 15 fois dans 7 fichiers (`LandModule.tsx:1156-1169`, `SailingModule.tsx:476-493, 949, 953`, `SurfModule.tsx:498, 501`, `TopsPanel.tsx:80`, `SurfaceHighlight.tsx:18-19`), opacité 0,85 ailleurs (`JumpMapLayer.tsx:34`, `TrackSpanLayer.tsx:32`, `SailingModule.tsx:491`) ; la voile redessine les podiums au lieu de `TopsHighlight` (`SailingModule.tsx:470-483` contre `TopsPanel.tsx:76-82`), `renderTop3` (`:666-681`) refait l'en-tête « 1er / 2e / 3e » (`TopsPanel.tsx:44-46`, et `JumpsPanel.tsx:82`) ; styles de surbrillance recréés à chaque rendu (`SurfaceHighlight.tsx:18-23`, `LiveMap.tsx:108-109` à chaque position).
- Pages : renommage d'une session ×2 (`SessionLibrary.tsx:393-409`, `SessionNameEditor.tsx:77-97`) ; onglets de filtre par activité (`SessionLibrary.tsx:579-590` ≈ `RoutesPage.tsx:78-95`) ; légende de pente et bascule pente/revêtement (`LandModule.tsx:907-923, 438-455` ≡ `PlanningPage.tsx:1074-1088, 430-439`) ; pastille 10 × 10 (`LandModule.tsx:912`, `SurfModule.tsx:589`, `MuscuModule.tsx:250`, `StatisticsPage.tsx:802`, `CadencePanel.tsx:123`, `FlightPumpingPanel.tsx:130`, `HeartRatePanel.tsx:211`) et barre de répartition (`SurfModule.tsx:572-594` ≈ `StatisticsPage.tsx:794-806`) ; tables de familles qui redisent `FAMILY_LABEL`/`FAMILY_ACCENT` (`SessionLibrary.tsx:62-68`, `RecordingPage.tsx:136`, `landModules.tsx:295-309`, `MuscuModule.tsx:62`, `SurfModule.tsx:117`, `AppShell.tsx:50-54`) ; petits utilitaires de pages (`useNearViewport`, `SessionLibrary.tsx:154-162` ≡ `232-240` ; `useTransientValue`, `RecordingPage.tsx:319-324`, `SessionNameEditor.tsx:43-48`, `ui/HoldButton.tsx:32-36` ; « dernière activité enregistrée, sinon la première », `TrainingSessionsPage.tsx:56-65`, `FitnessTestPage.tsx`, `RecordingPage.tsx:398-402` ; `recordPath(activityId, test?)` ; `repsDone` recopié, `SessionLibrary.tsx:116`, `library/stats.ts:105` ; regroupement par activité, `StatisticsPage.tsx:376-384` ≡ `440-445`) ; chaînes recopiées (« Aucune activité de … visible », « Aucune ceinture cardio choisie », « Aucune session sur la période. » ×4).

**À faire, dans cet ordre**
1. `components/SessionActivityField.tsx`, `FoilPumpingFields.tsx`, `SessionColorRangeField` (dans `SpeedRangeEditor.tsx`, validation gardée), `SessionSettingsHeader`, `CardioTab`, `NotesTab`, `gearFieldsFor(labels, placeholders?)`.
2. Tableaux : classes `ui-table`, `ui-table__row--empty`, `ui-table--cards` dans `components/ui/ui.css` (les zones de grille données par la page) ; `ANALYSIS_PANEL_STYLE` dans `components/styles.ts` ; `PanelHeading({ label, helpKey, open, onToggle, extra })` ; `BandShareTable` et `bandRangeLabel(bounds, band)` (pur, testé, dans `core/`).
3. Surbrillances : `HighlightPath` et `HighlightSpan` dans `components/`, styles en constantes dans `highlightColors.ts` (0,8 et 0,85 gardées, nommées : tranché) ; `TopsHighlight` accepte les podiums de VMG ; `PODIUM_RANKS`.
4. Pages : `SessionRenameField`, `ActivityFilterTabs`, `GradeLegendRow`, `useExclusiveToggles`, `ui/Swatch.tsx`, `ShareBar`, `useNearViewport`, `useTransientValue`, `recordPath`, `repsDone` partout, `FAMILY_LABEL`/`FAMILY_ACCENT` (+ `FAMILY_OF` si deux pages s'en servent ; `FAMILY_NOUN.voile = 'voile'` et `FAMILY.of.voile = 'de voile'` ne sont pas la même tournure) ; constantes pour les chaînes identiques seulement (les trois tournures de « Poids non renseigné » restent).

**Garde-fous** : `MapToggle` garde son style en ligne (il doit passer devant les règles de boutons des tableaux du téléphone, `ui/MapToggle.tsx:20`) ; spécificité CSS contre les `!important` du panneau Manœuvres au téléphone (`analysisMobile.css:428-447`) ; `id` des `ResizablePanel` passés tels quels (`sailing.cardio`, `${storageId}.cardio`…).

**Preuve de neutralité** : banc `general.mjs`, `reglages.mjs`, `materiel.mjs`, `notes.mjs`, `cardio.mjs`, `cadence.mjs`, `library.mjs`, `planning.mjs` avant/après, texte identique ; `tailles.mjs` ; captures à 390 × 844 et 834 × 375 des tableaux (manœuvres, répétitions, sauts).

**Rapport attendu** : pièces créées, lignes retirées ; captures.

### 65 · Coquille 4 : mise en page commune `AnalysisShell`

Opus | high. Neutre. Source : 02-A13, 02-A25.

**Ce qui existe** : en-tête (`an-sheet`, `PageHeader`, `SessionNameEditor`, partage, erreur), barre du brouillon, alertes, « Aucune session ouverte : choisissez-en une dans … » : `SailingModule.tsx:961-998`, `LandModule.tsx:1178-1202`, `SurfModule.tsx:513-535`, `MuscuModule.tsx:183-204` ; rangée de la carte (`SailingModule.tsx:1001-1027`, `LandModule.tsx:1204-1222`, `SurfModule.tsx:537-553`) avec `onExpandedChange` recopié ; colonne d'onglets (`SailingModule.tsx:1030-1033`, `LandModule.tsx:1225-1228`, `SurfModule.tsx:555-558`, `MuscuModule.tsx:207-210`). Différences : titre, retour, famille de l'image de partage ; la voile n'affiche la barre que `loadedFromMemory` ; la voile ajoute l'alerte « Vent non fiable » (`:982-992`).

**À faire** : `components/AnalysisShell.tsx`, mise en page seule, à emplacements : `{ title, back, family, file, share, error, loadError, emptyHint, draft, map?: { panelId, sessionKey, bounds, layers, legend, overlay?, companion, expanded, onExpandedChange, focus }, tabs: { sections, open, onToggle, advanced, accent }, alerts?, children }` ; le muscu la prend sans carte ; adoption module par module.

**Garde-fous** : structure des `div` dont dépend `analysisMobile.css` (`.an-page`, `.an-sheet`, `.an-map-row`, `.an-carte-col`) ; la barre du brouillon de la voile garde sa condition ; MISE_EN_PAGE (ordinateur, téléphone, téléphone tourné) inchangée.

**Preuve de neutralité** : banc `general.mjs`, `tailles.mjs`, `barre.mjs` par sport, à l'ordinateur, 390 × 844 et 834 × 375 ; texte et tailles identiques.

**Rapport attendu** : lignes retirées (les quatre modules), captures.

### 66 · Réglages : lecture sûre, un seul cache, moins de recalculs

Opus | medium. Neutre (corrige deux bogues latents). Sources : 02-A24, 02-B2, 02-C4, 02-D3, 03-A3, 03-A5, 03-A9, 03-A10, 03-B5, 03-B6, 03-D3, 03-D4.

**Ce qui existe**
- Lecture des réglages par `useState` + abonnement posé dans un effet (`hooks/useSportSettings.ts:1481, 1494-1503` ; `useAllSportSettings` `:1079, 1082-1091`) : une écriture entre le premier rendu et l'effet n'est jamais vue (bogue A4) ; chaque écriture, même d'une autre activité, refait `activity` et `speedRange` (coloration de la trace) ; `useStoredRecord.ts:43`, `useThemeSettings` (`useTheme.ts:84-89`) et `useMapBase.ts:24` font bien, par `useSyncExternalStore`.
- Écritures depuis un état figé au dernier rendu : `setFor` (`:1160-1331`), `resetActivity`, `addActivity`, `updateActivity`, `removeActivity`, `setActivityHidden`, `setFamilyHidden`, `setLongPressMs`, `setStopHoldMs`, `setBeepSound` ; `useSessionDraft.update` et `updateNotes` (`hooks/useSessionDraft.ts:62-74`) : deux appels dans un même geste perdent le premier (aucun appelant fautif aujourd'hui) ; `setActivity` (`:1511`) et `useStoredRecord.update` (`:49`) relisent, eux.
- Trois façons de garder une lecture du magasin JSON : clé `JSON.stringify` (`useSportSettings.ts:644-674, 704-715, 744-756`), référence brute (`useTheme.ts:23-30`, `useStoredRecord.ts:32-40`), sans cache ni abonnement (`useRestingHrResults.ts:16`, `useTileCache.ts:49`) ; tous les abonnés réévalués à chaque écriture de n'importe quelle clé (`platform/storage.ts:42` passe la clé, personne ne la lit).
- Doublons internes : unité de distance résolue trois fois (`useSportSettings.ts:864-867, 1115-1116, 1536-1537`), poids du vélo deux fois (`:892-893, 1546-1547`), chiffres de la notification assainis trois fois (`:794, 1108, 1219`) ; les 27 cas de `setFor` et les champs de `view` (`:1093-1157`) répètent « valider, ranger, comparer au défaut ».
- Ensembles d'abonnés maison alors que `createListeners` existe (`useChartHover.ts:14-30`, `useLiveRecording.ts:93, 184-189`, `useIntervalTimer.ts:55, 216-221`, `useRecorder.ts:193-205`, deux avec `try/catch`, un avec argument).
- Réglages : « · modifié » et « Par défaut » décidés par une expression de 25 termes dans la page (`pages/SettingsPage.tsx:464-468`), qui oublie `gearGroups` (bogue A12 : « Par défaut » grisé quand seule la liste de matériel est réglée, à vérifier contre `resetActivity`) ; toute la carte d'activité dans le `map` de la page (`:441-913`) : une frappe redessine toutes les cartes ouvertes ; cinq écritures de champ numérique à brouillon local (`SettingsPage.tsx:220-275` `NumberField`, `SessionThresholdField.tsx:34-36`, `SessionWeightField.tsx:27-28`, `EffortThresholdEditor.tsx:28-30`, `SpeedRangeEditor.tsx:47-55`).

**À faire, dans cet ordre**
1. `jsonStore.subscribeKey(key, listener)` (`platform/storage.ts`) ; `createJsonSelector<T>(key, select, equal?)` dans `hooks/createStore.ts` ; `createListeners<A extends unknown[]>({ safe? })`.
2. `useSportSettings` et `useAllSportSettings` par `useSyncExternalStore` ; toutes les écritures relisent au moment d'écrire ; `useSessionDraft` aussi (`drafts.get(file) ?? …`) ; `activities` comparées par texte avant d'être refaites.
3. `resolveDistanceUnit`, `resolveBikeKg`, `sanitizeNotificationFields` ; puis la table `SETTING_FIELDS: Record<Field, { key, valid(v, activity), normalize?(v, activity) }>` d'où `view` et `setFor` se déduisent.
4. `isActivityOverridden(view, activity)` pur avec un test qui parcourt tous les champs de `StoredSettings` ; `gearGroups` compté si `resetActivity` l'efface, sinon l'exclusion documentée dans le code.
5. Mesurer (profileur, une frappe), puis `ActivityCard` mémoïsé avec rappels stables par activité ; `useNumberDraft(value, format, parse)` et `NumberField` dans `components/ui/` si le temps le permet (comportement de saisie identique : virgule, valeur hors bornes pendant la frappe).

**Garde-fous** : `useSportSettings.test.ts` vert sans changer ses attendus ; format de `tracker.sportSettings` inchangé ; Réglages identiques à l'écran.

**Preuve de neutralité** : tests nouveaux (écriture entre le rendu et l'abonnement ; deux écritures dans un même geste) ; banc `reglages.mjs`, `prereglages.mjs`, `cacher.mjs`, `familles.mjs` avant/après, texte identique.

**Mesure attendue** : rendus des cartes d'activité par frappe, avant et après.

**Rapport attendu** : bogues A4 et A5 couverts par test ; mesure ; décision sur `gearGroups` et sa raison.

### 67 · Enregistrer : ne redessiner que les chiffres

Opus | high. Neutre. Sources : 02-A18, 03-B1, 03-C5, 03-C6, 04-B11, 06-B8, 06-C8.

**Ce qui existe**
- `receiveFix` fait `setState({ stats: addFixToStats(...) })` à chaque position (`hooks/useRecorder.ts:324`), `receiveHeartSample` de même (`:348`), la ceinture met à jour `heartRate` à chaque FC (`:558-560`) ; `useRecorder()` rend l'état entier (`:905`) : `RecordingPage` (1 058 lignes, avec `LiveMap`, `:364`) se redessine à chaque position ; `useRecordingClock` (`:917-918`) appelle `useRecorder()`, donc `AppShell` (`:105`) aussi, sur toutes les pages, pour la seule durée du bandeau. La page lit `status`, `heartRate`, `pausedReason`, `sourceLabel`, `measuringMotion`, `error`, `pending`, `motionSetup`, `marks`, `activity`, `stats` (`:461`).
- Direct : le segment ouvert refait cumuls, FC, meilleur top, bords, altitude et énergie à chaque calcul (`recording/liveStats.ts:363-382`) ; `bestRecentTop` filtre et recalcule pour chaque durée (`:275-284`) ; `resumeKinematics` recopie une dizaine de tableaux (`core/kinematics.ts:387-400, 518`) : O(n) par mise à jour, sensible après 3 h sans pause.
- Libellés du direct tirés de `LIVE_STATS_DEFAULTS` et non des options passées (`recording/liveFields.ts:159-160, 168-169, 184, 187`, `RecordingPage.tsx:139, 206`).
- Options de capture : 4 blocs identiques (`RecordingPage.tsx:655-669, 671-684, 686-714, 716-731`) et l'état « choix pour cette activité » recopié 4 fois (`:427-429, 432-433, 436-438, 446-448`).
- Calcul pur dans les services : `fixSpeedMs` (`hooks/useFitnessTest.ts:119-125`) avec un seuil en dur `DERIVED_SPEED_MAX_GAP_MS = 5000` (`:69`, règle 3) ; vue du guidage (`useMarkGuide.ts:80-97`, `isCourseFinished` appelé deux fois) ; `stateKeyNow` et contexte de la notification (`hooks/recordingNotification.ts:55-62, 89-103`) ; `journalActivity` (`useRecorder.ts:481-485`), `nothingToKeep` (`:430-431`), fin commune de `receiveFix` et `receiveHeartSample` (`:317-328`, `:341-352`).

**À faire, dans cet ordre**
1. `useRecorderSelector<T>(select)` (comme `useLibrarySelector`, `useSessionLibrary.ts:1951`) ; `RecordingFigures` (les chiffres qui bougent à chaque position, comme `IntervalBanner` l'est déjà, `AppShell.tsx:67`) ; `RecordingBanner` dans `AppShell`, seul abonné de l'horloge.
2. `CaptureOption` et `usePerActivityChoice(activityId, fallback)`.
3. Libellés du direct sur les options effectives (`LiveFieldContext`).
4. Calcul pur sorti : `fixSpeedMs` et son seuil dans le protocole du test (`FITNESS_TESTS`), testé à 1 Hz et 5 Hz ; `markGuideView` dans `recording/markGuide.ts` ; `stateKeyNow` dans `recording/liveNotification.ts` ; `journalActivity` dans `recording/journal.ts` ; `nothingToKeep` dans `recording/session.ts` ; `keepPoint` local.
5. Seulement si mesuré utile : segment ouvert du direct tenu en mémoire (le test d'équivalence existe), `bestRecentTop` sans refiltrer.

**Garde-fous** : écran éteint, notification, pause, journal : comportement identique ; règle 12.

**Preuve de neutralité** : un script du banc qui rejoue un enregistrement (`compteur-course.mjs`, `notification.mjs` ou `chrono.mjs`, voir LISEZMOI) avant/après, texte identique ; tests de `recording/`.

**Mesure attendue** : rendus de `RecordingPage` et d'`AppShell` sur 60 s de rejeu, avant (environ un par position) et après (seuls les chiffres) ; `computeLiveStats` chronométré sur 10 800 points à 1 Hz si l'étape 5 est faite.

**Rapport attendu** : mesures ; étape 5 faite ou non.

### 68 · Bibliothèque : balayage et écritures groupés

Opus | high. Neutre. Sources : 03-A11, 03-B2, 06-B2, 06-B3, 06-B5, 06-B6.

**Ce qui existe**
- Chaque fiche créée ou recalculée publie toute la liste (`runJob` → `replaceSession`, `hooks/useSessionLibrary.ts:1016-1032, 1029, 1046` ; `replaceSession` `:257-261` ; `publish` `:236-239` refait `dedupeSessions`, qui trie deux fois toute la liste, `library/record.ts:723, 736`) ; chaque publication refait `statSessionOf` pour toutes les sessions (`hooks/useVisibleStatSessions.ts:57-60`) : Statistiques, Profil, graphe d'activités et fond se recalculent n fois pendant un balayage de n fiches (O(n² log n) pour le tri seul) ; après une hausse de `SUMMARY_CALC_VERSION`, 2N tris et 2N rendus.
- Pages qui lisent l'état entier et se redessinent au compteur du balayage (toutes les 250 ms, `:1074-1077`) : `Home.tsx:45`, `ProfilePage.tsx:106`, `StatisticsPage.tsx:231`, `FollowTracePicker.tsx:49`, `MemoryStatus.tsx:51`.
- `findSession` (`:241`) et `useLibrarySession` (`:1958-1959`, appelé par environ 7 hooks par rendu d'analyse) linéaires.
- `refreshCache` relit le dossier et récrit toutes les fiches allégées (`:288-301`) après chaque suppression et chaque import (`:1085, 1574, 1755`).
- Navigateur : un `getFile()` après l'autre au listage (`platform/memoryFolder.ts:129-137`).
- Choix retenus (`moduleActivity`, `recordActivity`, `lastIntervalWorkout`, `lastTimerWorkout`) rangés dans `tracker.sportSettings` (`library/settingsFile.ts:197-209`, `useSessionLibrary.ts:1249-1258`) : ouvrir une session d'une autre activité récrit tout l'objet et refait deux `JSON.stringify` des valeurs qui voyagent (photo du Profil comprise).
- Activité d'une session résolue deux fois (`useSessionLibrary.ts:360, 1334`), `all.find` deux fois de suite (`:1359, 1363`).

**À faire, dans cet ordre**
1. Script de mesure : 300 fiches synthétiques sur la base de `useSessionLibrary.memoire.test.ts`, résumé périmé ; nombre de publications et durée du balayage avant.
2. Publications groupées pendant un balayage (au rythme du compteur, 250 ms, puis une fois à la fin) ; une seule publication par fiche recalculée ; `Map` fichier → session et `startMs` → session tenue dans `publish`.
3. `useLibraryFields(...)` dans `Home` (`status`, `error`) et ailleurs (`status`, `sessions`, `scanning`).
4. `refreshCache` différé d'une seconde et limité à l'entrée touchée ; listage du navigateur par lots de 32 en parallèle.
5. `activityOfSession(sport, activityId)` local.
6. Seulement après accord de l'orchestrateur (migration) : choix retenus dans une clé à part `tracker.choix`, propre à l'appareil, migrée au premier lancement.

**Garde-fous** : l'ordre de publication compte pour `keptInMemory` ; les fiches et le cache gardent leur forme ; aucune session ne disparaît ni ne se double pendant un balayage.

**Preuve de neutralité** : tests `useSessionLibrary*.test.ts` verts ; banc `library.mjs`, `library2.mjs`, `library3.mjs`, `statistiques.mjs`, `miseajour.mjs` avant/après.

**Mesure attendue** : publications et durée du balayage de 300 fiches avant/après ; rendus de Statistiques pendant « Mettre à jour » ; durée de `list('sessions')` avec 1 500 fichiers dans l'OPFS.

**Rapport attendu** : mesures ; étape 6 faite ou non.

### 69 · Recherches par session : un seul mécanisme

Opus | medium. Neutre (corrige un bogue mineur). Sources : 03-A2, 03-A12, 03-B4, 03-D8, 07-A10, 08-A10.

**Ce qui existe**
- « Recherche par trace, rangée dans la fiche » écrite trois fois : `hooks/useSessionSurfaces.ts:24-49` (clé, `found`/`searching`, promesse unique), `hooks/useTerrainElevation.ts:24-57` (clé `startMs|stepM`), `hooks/useSessionJumps.ts:19-57` (clé `file|startMs`, plus `nextFrame`) ; `store(file, value)` identique (`useSessionSurfaces.ts:52-55`, `useTerrainElevation.ts:60-63`, en ligne `useSessionJumps.ts:46-50`) ; effet « trouvé avant que la bibliothèque connaisse la session » identique (`:76-78`, `:105-107`) ; compteur factice pour forcer un rendu (`:68`, `:91`, `:69`) ; erreur et `retry` (`:69-91`, `:93-120`, `:68-70`) ; garde `session.partial` (`:67`, `:90`, `:73`).
- Bogue mineur : une trace recalculée pendant la demande relance l'effet, qui ajoute un second `.then` à la même promesse : deux `updateSessionRecord` (`useSessionSurfaces.ts:80-89`, `useTerrainElevation.ts:109-118`).
- Le même `.imu` lu et décodé deux fois en voile (`useSessionJumps.ts:38-41` et `useSessionPumping.ts:30-33`, depuis `SailingModule.tsx:256, 304`) ; une capture décodée pèse des dizaines de Mo ; troisième décodage dans `useRecorder.ts:369-370`.
- Élagage des capteurs : deux enveloppes identiques (`core/imuPrune.ts:12-17`, `surfing/pumping.ts:34-39`) ; `surfing/pumping.ts` élague, il ne mesure pas le pumping (nom trompeur).

**À faire, dans cet ordre**
1. `hooks/sessionAsset.ts` : `createSessionAssetCache<V>(compute)` → `{ get(key), run(key) }` ; `useSessionAsset<V>({ file, key, stored, isCurrent, active, compute, field }) => { value, status, error, retry }`, qui range dans la fiche une seule fois, gère le report, force le rendu par `useSyncExternalStore` (plus de compteur factice).
2. Revêtement, altitude, sauts passent dessus (un par étape).
3. `loadSessionMotion(file): Promise<ImuRecording>` (cache à un seul fichier, déjà écrit dans `useSessionPumping.ts:22-41`), partagé par les sauts et le pumping.
4. `pruneImu(bytes, windowsOf)` dans `core/imuPrune.ts` ; `surfing/pumping.ts` renommé `surfing/imuPrune.ts`.

**Garde-fous** : délais du lot 54 gardés ; champs des fiches et versions de calcul (`matchVersion`, `version`, `stepM`, `startMs`, `measured`) inchangés.

**Preuve de neutralité** : tests synthétiques en injectant `compute` (rangé une fois, erreur puis réessai, trace recalculée pendant la demande) ; banc `surface.mjs`, `altitude.mjs`, `sauts.mjs`, `pumping.mjs` avant/après.

**Rapport attendu** : lignes retirées ; double rangement disparu (test).

### 70 · Domaines : énergie commune, pente au noyau, tronçons

Opus | medium. Neutre. Sources : 02-C2, 02-C3, 05-A1, 05-A3, 05-A4, 05-A9, 05-C1, 05-C9.

**Ce qui existe**
- Énergie : même boucle à pied et à vélo (`running/energy.ts:240-308` `computeEnergy`, `cycling/energy.ts:204-276` `computeCyclingEnergy`) : 5 accumulateurs par zone écrits à la main, repos × dt, cumul, puissance = travail / dt, zone `classifyGrade(...) ?? 'flat'` ; seuls changent le coût d'un pas et l'unité (par kilo à pied, absolu à vélo), que les appelants recollent (`recording/liveStats.ts:254-261`, `pages/landModules.tsx:140-143, 245-246`) ; unités de temps incohérentes (`ZoneStats.timeMs` en ms, `EnergyZone.timeS` en s).
- Mise en forme de l'énergie dans `pages/landModules.tsx:123-288` (calculs, notes, JSX d'avertissement), sans test ; dépense totale retrouvée par son libellé (`LandModule.tsx:761`, `TOTAL_ENERGY_LABEL`) : renommer le libellé casserait « général » sans erreur de compilation.
- Pente rangée dans `running/runningAnalytics.ts` (`computeGrades`, `gradeZones`, `classifyGrade`, `GradeRange`, `gradeGradientStops`, `gradeColorPaths`) alors qu'elle sert au vélo (`cycling/energy.ts:6`, `cyclingConfig.ts:3`), à la planification (`planning/route.ts:6`), au direct (`recording/liveStats.ts:11`) et à 4 composants.
- Tronçons : `spanOf` et `keptRuns` (`surfing/surfAnalysis.ts:114-128`) et `flightSpans` (`core/pumping.ts:93-104`) font la même mesure ; types voisins `FlightSpan` (`core/pumping.ts:77-86`), `SurfSpan` (`surfAnalysis.ts:40-54`), `IntervalPhaseStats` (`running/intervalStats.ts:21-29`), `Effort` (`running/intervalDetection.ts:47`), `ActiveRun` (`core/sessionStats.ts:161`).
- Tracés d'une zone sur la carte, trois copies : `gradeZonePaths` (`runningAnalytics.ts:187-208`), `cadenceBandPaths` (`running/cadence.ts:577-598`), `heartRateZonePaths` (`core/heartRate.ts:408-427`).
- Moyennes glissantes recopiées (`cadence.ts:156-173, 349-368`, `core/imuVertical.ts:206-227`, `core/speedFilter.ts:281-312`, `intervalDetection.ts:186-195`) : sommes cumulées et fenêtre glissante ne donnent pas les mêmes bits.

**À faire, dans cet ordre**
1. `core/grade.ts` (pente, zones, `GradeRange`, couleurs de pente) ; `runningAnalytics.ts` réexporte le temps de la migration.
2. `core/energy.ts` : `integrateEnergy(track, grades, mask, restRate, stepCost, zones): EnergyIntegration` ; `computeEnergy` et `computeCyclingEnergy` ne gardent que leur `stepCost` (Minetti ou Pandolf, Martin ; le vélo ajoute `surfaceDistanceM`).
3. `running/energyView.ts` et `cycling/energyView.ts` purs, avertissements rendus par un code (`'sans-poids' | 'sans-poids-charge' | 'revetement-…'`) que le module met en phrase ; tests ; `EnergyStat.key` et recherche de la dépense totale par clé.
4. `TrackSpan` et `spanOfRun(track, cum, run)` dans `core/sessionStats.ts` ; `FlightSpan = TrackSpan & { n }`, `SurfSpan` par-dessus.
5. `pathsWhere(points, steps, keep)` dans `core/trackPaths.ts` pour les trois tracés de zone.
6. Moyennes glissantes : seulement les copies qui passent un test bit à bit ; les autres gardent leur algorithme (le dire).

**Garde-fous** : unités des sorties inchangées (à pied par kilo, à vélo absolu) ; suffixes d'unité nouveaux seulement dans les fichiers touchés (le renommage général va au fork).

**Preuve de neutralité** : les 48 tests d'énergie verts sans changer leurs attendus, plus copies gelées en `toEqual` sur traces synthétiques avec trous, pauses et pente manquante ; banc `depense.mjs`, `pentes.mjs`, `roulement.mjs`, `surf.mjs`, `planning.mjs` avant/après.

**Rapport attendu** : lignes retirées ; moyennes non fusionnées et pourquoi.

### 71 · Sens des dépendances et test d'architecture

Sonnet | high. Neutre (déplacements). Sources : 01-C5, 04-C1, 04-C5, 05-C1, 05-C7, 06-C3, 06-C4, 07-C2, 07-C6, 08-C3 à C6, 08-C12.

**Ce qui existe**
- `core/` importe des types des domaines : `core/activityPresets.ts:4-12` (huit imports de `cycling/energy`, `planning/duration`, `planning/brouterProfile`, `recording/intervalTimer`, `recording/jumpSettings`, `recording/liveFields`, `recording/markGuide`, `running/energy`, `running/runningAnalytics`) ; son seul appelant est `hooks/useSportSettings.ts` ; `core/sportProfiles.ts:4` (`CadenceDetection` de `running/cadence`) ; `core/heartRateSession.ts:6` (`IntervalSeries` de `recording/intervalTimer`). Imports de type seulement, pas de cycle, mais `INVENTAIRE.md:11` décrit `core/` « sans notion de sport ».
- `platform/` importe le domaine : `platform/permissions.ts:2` (`recording/permissionsPrompt`), `platform/motion.ts:3` (`JumpPlacement`), `platform/screen.ts:2` (`theme/theme`).
- `pages/workoutLists.ts` lu par `components/AppShell.tsx`, `IntervalCard.tsx`, `TrainingHub.tsx` (sens composants → pages).
- `planning/brouter.ts:1, 165, 171` lit et écrit `jsonStore` (identifiant du profil BRouter) alors que `planning/` est décrit comme logique pure.
- `platform/base64.ts` (conversion pure) importé par `library/sessionBundle.ts:2`.
- `isSportType` dans `recording/session.ts:215`, importé par `library/record.ts:13` et `library/naming.ts:2`.
- `utils/kinematics.ts` (vue en nœuds, seul fichier de `utils/`) et `types/sailing.ts` (seul fichier de `types/`) ne servent que la voile.
- `sailing/sessionNotes.ts` sert à toutes les familles (`library/record.ts:15`, `library/stats.ts:13`, `GearPicker`) ; `running/restingHrResults.ts:225-277` relit et réécrit le stockage ; `running/types.ts` n'est qu'un alias pour un seul lecteur ; `running/intervalDetection.ts:4` importe `INTERVAL_LIMITS` de `recording/intervalTimer`.
- Noms trompeurs : `core/patternTiles.ts` dessine les fonds de page, pas des tuiles ; `pages/settingsPage.css` (minuscule) à côté de `SettingsPage.tsx`.

**À faire, dans cet ordre**
1. Nouveau dossier `src/settings/` (entre les domaines et `hooks/`) : `activityPresets.ts` y va ; il pourra importer les domaines.
2. Types de domaine nécessaires au noyau déplacés dans `core/` (`CadenceDetection`, `IntervalSeries`, types de permission et de placement des sauts), réexportés par leur domaine ; `screen.ts` reçoit le thème en paramètre.
3. `pages/workoutLists.ts` → `recording/workoutLists.ts` ; identifiant BRouter passé en paramètre, lu et écrit dans `usePlannedRoute` ; `platform/base64.ts` → `core/base64.ts` ; `isSportType` → `core/sportProfiles.ts` ; `utils/kinematics.ts` → `sailing/pointData.ts` ; `types/sailing.ts` → `sailing/types.ts` ; `sailing/sessionNotes.ts` → `library/notes.ts` ; la persistance de `restingHrResults` → `library/restingHrStore.ts` ; `running/types.ts` retiré ; `core/patternTiles.ts` → `core/backdropPattern.ts` ; `settingsPage.css` → `SettingsPage.css`.
4. Réexportations laissées par les lots 57 et 70 retirées (imports directs).
5. `src/architecture.test.ts` (environnement node) : lit les `import` de `src/` (expression régulière simple) et vérifie le sens permis : `core` → `core` ; `sailing`, `running`, `cycling`, `surfing`, `planning`, `recording`, `library` → `core` et une liste écrite d'arêtes entre domaines ; `settings` → `core` et domaines ; `platform` → `core` ; `hooks` → tout sauf `components` et `pages` ; `components` → tout sauf `pages` ; une liste d'exceptions nommées, qui ne doit que diminuer.

**Garde-fous** : aucun changement de code hors chemins d'import ; les scripts du banc qui importent des sources (`charge-ts.mjs`, diagnostics) mis à jour ; `RATINGS` et ses emoji restent tels quels (n° 41 de BACKLOG).

**Preuve de neutralité** : typecheck, tous les tests, build ; banc `general.mjs` ; `manoeuvres-diagnostic.mjs`, `sauts-diagnostic.mjs`, `pumping-diagnostic.mjs` tournent encore.

**Rapport attendu** : fichiers déplacés ; exceptions restantes du test d'architecture et pourquoi ; lignes d'INVENTAIRE et d'ETAT §3 à reprendre (pour la passe doc).

### 72 · Calcul pur sorti des hooks ; priorités testées

Opus | medium. Neutre. Sources : 01-C5, 03-C2 à C5, 04-A9, 06-A2, 06-C5, 07-A2, 07-C2, 07-D3, 08-A8, 08-C2, 08-F.

**Ce qui existe**
- Environ 1 000 lignes pures dans `hooks/useSportSettings.ts` : `defaultSpeedRangeOf`, `rangeFollowsPace`, `thresholdFollowsPace`, `defaultGradeRange`, `defaultThresholdOf`, `defaultSpeedUnitOf`, `defaultAutoPauseOf`, `defaultLiveFieldsFor`, `defaultNotificationFieldsFor`, `defaultMarkGuideOf`, `defaultHeartRateOf`, `defaultTerrainStepOf`, les `resolve*` (`:254-292, 306-309, 365-368, 410-424, 555-567, 806-836, 901-910`), le matériel (`sanitizeGearLabels`, `cleanGearName`, `sameGearName`, `sanitizeGearGroups`, `withGearItem`, `:299-362`), `PRESET_RESETS` et `resetStoredPresets` (`:474-536`), `resolvePace` (`:926-934`), `effectiveDurationSettings` (`:950-966`), `withoutOverrides`, `resetOverrides` (`:1055-1070`), `moduleActivity` (`:1465-1472`) ; importé par 45 fichiers.
- Règles du Profil dans `hooks/useRunnerProfile.ts` (`runnerName` `:88-93`, `runnerAvatar` `:96-104`, `runnerRootGoalMin` `:122-126`, `missingProfileFields` `:139-146`, `shouldPromptProfile` `:153-158`, `profilePromptGate` `:165-172`, `runnerAge` `:181-182`, `runnerHrSource` `:185-195`, `runnerHeartRateZones` `:202-203`, `BOUNDS` `:106-114`).
- `plannedRouteReducer` (`hooks/usePlannedRoute.ts:75-111`) ; `describeImport` (`hooks/useSessionLibrary.ts:1506-1521`) ; `libraryPath`, `analysisPath`, `sessionFamily` (`hooks/useLibraryNavigation.ts:18-27`) ; `summaryOptions`, `analyzeGpx`, `newRecord`, `withSummary` (`useSessionLibrary.ts:353, 391, 417, 434`), sans test direct, qui lisent `readStoredActivities()`.
- Options de cinématique tirées du profil écrites quatre fois (`library/summary.ts:73-90` `analysisTrack`, `LandModule.tsx:269-274`, `SurfModule.tsx:171-173`, `useSailingSession.ts:73-80`, remises en forme par `useGpxSession.ts:74-87`) : rien ne garantit que la liste et l'analyse donnent les mêmes chiffres.
- Bornes de couleur effectives (décision transverse : trace, sinon support, sinon pré-réglage ou suggestion, sinon traitement) écrites quatre fois : `LandModule.tsx:636`, `SurfModule.tsx:258`, `SailingModule.tsx:358`, `components/sessionTrack.ts:65-77` (`sessionSpeedRange`, vignettes et partage, sans test, qui importe `hooks/useSportSettings`) ; bornes par défaut réparties en 7 endroits (`sailing/sailingConfig.ts:32`, `running/runningAnalytics.ts:211`, `cycling/cyclingConfig.ts:11`, `surfing/surfConfig.ts:7`, `core/sportProfiles.ts:730` bateau seul, `hooks/useSportSettings.ts:62-69` `TREATMENT_SPEED_RANGE_MS`, `speedRangeMs` de huit pré-réglages `core/activityPresets.ts:59, 76, 87, 98, 107, 115, 135, 149`), alors que `SportProfile.speedRange` existe (`:431`) et vaut `null` partout sauf au bateau.
- Seuil effectif de la voile (`fixed ?? session ?? (surchargé ? réglé : suggéré)`, `hooks/useSailingSession.ts:95-99`), seuils de manœuvre et de vol : règle 4 sans aucun test.

**À faire, dans cet ordre**
1. `settings/activitySettings.ts` (purs, sur un `StoredSettings` passé en argument) et `settings/gear.ts` ; le hook ne garde que la lecture du magasin et les trois hooks ; `useSportSettings.test.ts` déplacé.
2. `running/runnerProfile.ts` (validation, âge, zones) et `library/profile.ts` (règles du pop-up) ; `planning/plannedRouteReducer.ts` ; `describeImport` dans `library/` ; chemins dans `core/parentPage.ts`.
3. `library/summaryOptions.ts` (activité passée en paramètre) ; `kinematicsOptionsOf(profile, { scaleToSession, referenceMs })` dans `core/sessionSpeed.ts`, appelée par `analysisTrack` et `useGpxSession` ; test : résumé et analyse donnent les mêmes options pour chaque famille.
4. `effectiveSpeedRange({ sessionRange, activity, suggested, treatment })` dans `core/trackColor.ts`, test par famille (dont la voile avec suggestion et une session à classer sans activité) ; appelée par les trois modules et `sessionTrack` ; `components/sessionTrack.ts` → `library/sessionTrack.ts`, sans import de hook, avec ses tests.
5. Bornes par défaut dans `SportProfile.speedRange` pour chaque profil (tranché : oui), table du hook et constantes de sport retirées ; `rangeFollowsPace` sur un drapeau du profil de voile.
6. `resolveSailingThresholds(profile, settings, session, referenceKn)` dans `sailing/sailingConfig.ts`, avec les quatre priorités testées et le bateau sans seuil.

**Garde-fous** : l'ordre des bornes de couleur (décision transverse de CLAUDE.md) gardé exactement ; règle 4 (mise à l'échelle dans les hooks, jamais par défaut dans les calculs) ; `PRESET_RESETS` inchangé.

**Preuve de neutralité** : tests déplacés verts sans changer leurs attendus ; tests nouveaux ; banc `library.mjs` (vignettes), `partage.mjs`, `general.mjs` par sport, `prereglages.mjs` : texte identique et captures de vignettes identiques.

**Rapport attendu** : fichiers créés ; priorités désormais testées.

### 73 · Carte : trace colorée en une seule couche

Opus | high. Neutre à l'œil (Q46, Q48). Sources : 01-B10, 02-B6, 07-A8, 07-A9, 07-B1, 07-B7.

**Ce qui existe**
- `TrackSegmentsLayer` crée un `L.polyline` par trait (`components/TrackSegmentsLayer.tsx:43-55`) : 54 000 couches pour 3 h à 5 Hz, 11 000 à 1 Hz ; le moteur canevas les reparcourt toutes à chaque déplacement et zoom. Fusionner les traits consécutifs de même couleur ne fait passer que de 54 000 à 42 400 tracés (202 couleurs distinctes) : insuffisant.
- Image de partage : un `beginPath` et un `stroke` par trait (`components/drawShareImage.ts:130-139`), redessinée à chaque case cochée.
- Liseré blanc du fond satellite défini trois fois avec trois épaisseurs : `TrackSegmentsLayer.tsx:21, 48` (trait + 3, soit 8), `LiveMap.tsx:46` (7), `PlanningPage.tsx:130` (9).
- Repères numérotés en `divIcon` mis en cache deux fois (`LiveMap.tsx:60-77`, `PlanningPage.tsx:191-205`).

**À faire, dans cet ordre**
1. Mesure avant : `zoom-carte.mjs` avec `Performance.getMetrics` (ScriptDuration, TaskDuration) autour de dix zooms et déplacements, nombre de `map._layers`.
2. Q46 (par défaut : couche maison, couleurs inchangées) : une couche canevas (`L.Layer`) qui dessine tous les traits en une passe, regroupés par couleur, comme l'image de partage ; elle se redessine quand ses traits changent ; elle garde ce que la couche d'aujourd'hui fait au clic ou au survol, s'il y a quelque chose.
3. Image de partage : un seul chemin par couleur.
4. Q48 (par défaut : une seule épaisseur, celle de l'analyse) : `HALO_STYLE(weight)` commun.
5. `cachedDivIcon(key, build)` pour les repères.

**Garde-fous** : décision transverse « dégradé continu, une seule coloration d'une session, la même dans son analyse et sa vignette » ; aucune teinte arrondie (sauf réponse contraire à Q46).

**Preuve de neutralité** : captures avant/après comparées (analyse, vignette, image de partage) ; texte identique au banc `general.mjs`, `partage.mjs`, `satellite.mjs`.

**Mesure attendue** : couches de la carte 54 000 → 1 ; métriques de `zoom-carte.mjs` avant/après.

**Rapport attendu** : mesures ; captures.

### 74 · Tuiles et vignettes de la bibliothèque

Opus | high. Neutre. Sources : 06-B4, 07-A12, 07-B2, 07-B4, 07-B5, 07-C2, 07-D7, 08-F.

**Ce qui existe**
- Vignettes : l'observateur passe `near` à vrai et ne le remet jamais à faux (`pages/SessionLibrary.tsx:232-241`) ; chaque ligne garde son `MapContainer` (`:290-306`), couche de tuiles, canevas et écouteurs : 150 cartes vivantes après défilement de 150 sessions ; trace réduite à 300 points pris à pas d'indice régulier (`:260`).
- Tuiles : seules les parentes sont dédoublonnées (`components/mapTiles.ts:53-73`), deux demandes de la même tuile partent ensemble (`:98-118`) ; `createTile` n'annule rien quand Leaflet retire une tuile (`components/BaseTileLayer.tsx:45-62`) : un zoom rapide laisse partir des requêtes jusqu'à 8 s ; sous-domaines `{s}` d'OSM, déconseillés depuis 2023 (`core/mapBase.ts:34`, les clés du cache n'en dépendent pas, `:57-62`) ; remontée jusqu'à 6 zooms l'un après l'autre au large (`mapTiles.ts:76-95`, jusqu'à 48 s par case).
- Navigateur : `tileStore.list()` fait un `cache.match` par tuile (`platform/tileCache.ts:153-167`), appelé au plus une fois par minute pendant la navigation (`hooks/useTileCache.ts:29-42`) ; le téléphone tient un index (`tileCache.ts:47-62`).
- `mapTiles.ts` mêle réseau et stockage et importe un hook (`noteTileSaved`) ; aucun test pour `mapTiles.ts`, `platform/tileCache.ts` ; lecture d'un Blob en image écrite deux fois (`mapTiles.ts:39-46`, `drawShareImage.ts:35-43`).

**À faire, dans cet ordre**
1. Mesure avant : `library.mjs` (`Memory.getDOMCounters`, `JSHeapUsedSize` après défilement complet) ; requêtes par adresse pendant `zoom-carte.mjs` et `satellite.mjs`.
2. `mapTiles.ts` → `platform/mapTiles.ts` ; la règle d'éviction dans `core/tiles.ts` ; tests de `resolveTile` (tuile absente → ancêtre découpé ; aucune → `null`, faux `tileStore`) et du plafond.
3. Promesses en cours par clé, `AbortController` par tuile sur `tileunload` ; `tile.openstreetmap.org` sans sous-domaine.
4. Index des tuiles côté navigateur.
5. Vignettes : image fixe dessinée une fois (projection de `core/shareImage.ts`, tuiles par `loadMapTile`, comme l'image de partage), gardée avec la trace ; à défaut, vignettes démontées hors de l'écran ; trace réduite par `simplifyLatLon`.

**Garde-fous** : décision §8 (fond des cartes, tuiles gardées, `BaseTileLayer`) ; couleurs des vignettes identiques à l'analyse (lot 72) ; politique d'usage d'OSM.

**Preuve de neutralité** : tests nouveaux ; captures des vignettes avant/après ; banc `library.mjs`, `satellite.mjs`, `zoom-carte.mjs`.

**Mesure attendue** : cartes vivantes 150 → 0 (ou le nombre visible) ; mémoire après défilement ; requêtes en double avant/après ; durée de `list()` avec 10 000 tuiles.

**Rapport attendu** : mesures.

### 75 · Fixtures de test communes

Sonnet | high. Neutre (outil). Sources : 05-A10, 08-A2, 08-A12, 08-B1, 08-D5, 08-F.

**Ce qui existe**
- « Mètres par degré » recopié dans 26 fichiers de test avec trois valeurs : `(Math.PI/180) * 6371e3` (111 194,9 ; `core/kinematics.test.ts:26, 146, 196, 259, 345`, `core/sessionSpeed.test.ts:8`, `core/sessionStats.test.ts:9`, `core/topSegments.test.ts:22, 322`, `core/trackColor.test.ts:9`, `library/summary.test.ts:10`, `running/intervalDetection.test.ts:13`, `running/intervalStats.test.ts:11`, `running/runningAnalytics.test.ts:33`, `sailing/sailingStats.test.ts:10`, `recording/liveLegs.test.ts:8`, `recording/liveStats.test.ts:9`) ; `111195` (`core/geoPlane.test.ts:12`, `planning/duration.test.ts:30`, `planning/surface.test.ts:134, 181`, `planning/wayMatch.test.ts:9`, `recording/followedTrace.test.ts:50`, `recording/heading.test.ts:5`, `recording/markGuide.test.ts:8`) ; `111320` (`core/terrainElevation.test.ts:14, 84`, `sailing/maneuvers.test.ts:129, 253, 389`), qui place des points 0,11 % plus loin que ce que le code relit.
- 28 générateurs de traces : « vers l'est, vitesses données » (`core/topSegments.test.ts:19`, `sailing/sailingConfig.test.ts:18`, `core/sessionSpeed.test.ts:14`, `running/intervalStats.test.ts:9`, `running/intervalDetection.test.ts:21, 38`, `running/runningAnalytics.test.ts:26`, `core/kinematics.test.ts:18`) ; « phases [durée, vitesse] à `hz` » (`core/trackColor.test.ts:6`, `sailing/sailingStats.test.ts:13`, `library/summary.test.ts:17`, `core/sessionStats.test.ts:25`, `surfing/surfAnalysis.test.ts:27`) ; positions `LocationFix` (`recording/session.test.ts:22`, `heading.test.ts:8`, `liveStats.test.ts:16`, `liveLegs.test.ts:24`, `markGuide.test.ts:12-15`, `followedTrace.test.ts:54-59`) ; repère local est/nord (`core/geoPlane.test.ts:15`, `followedTrace.test.ts:54`, `markGuide.test.ts:12`, `wayMatch.test.ts:14`, `loopReturn.test.ts:15`, `kinematics.test.ts:347`) ; `buildTrack` dans 6 fichiers (maneuvers, sailingConfig, sailingStats, energy, intervalDetection, fitnessTestResults).
- Fiche de session `record(patch)` identique dans `library/record.test.ts:31`, `sessionBundle.test.ts:10`, `sessionEdits.test.ts:8`, `reconcile.test.ts:8` ; `StatSession` dans `stats.test.ts:14`, `profile.test.ts:8` ; faux dossier mémoire dans `hooks/useSessionLibrary.test.ts:9-38` et `useSessionLibrary.memoire.test.ts:16-60`.
- `sailing/maneuvers.test.ts:1526-1558` refait une quinzaine de sessions bruitées pour chaque test ; durées des tests jamais relevées.
- Couverture : `useSessionDraft`, les détenteurs de la ceinture (`platform/heartRate.ts`), `useMarkGuide`, `useIntervalTimer`, `recordingNotification` sans test de leur colle.

**À faire, dans cet ordre**
1. Relever les durées de tous les tests (`npx vitest run --reporter=verbose`, par l'agent `verif`), avant.
2. `src/test/geo.fixture.ts` (`M_PER_DEG_LAT` tiré d'`EARTH_RADIUS_M`, `mPerDegLon(lat)`, `ORIGIN`, `at(eastM, northM, origin?)`, `T0`), `src/test/track.fixture.ts` (`eastwardTrack`, `phasesTrack`, `headingTrack`, `fixesAlong`), `src/test/record.fixture.ts` (`sessionRecord`, `statSession`), `src/test/memoryFolder.fixture.ts` (`createFakeFolder`).
3. Migration fichier par fichier, attendus inchangés, `vitest run` à chaque pas ; un fichier dont un attendu bougerait avec la constante commune garde sa constante locale, commentée (`111320` de `maneuvers.test.ts` et `terrainElevation.test.ts` compris).
4. Sessions bruitées de `maneuvers.test.ts` construites une fois (`beforeAll` ou mémoïsées).
5. Si le temps le permet : tests de colle de `useSessionDraft` (modifier, annuler, enregistrer : fiche écrite une fois) et des détenteurs de la ceinture (deux détenteurs, l'un rend, puis l'autre).

**Garde-fous** : aucun attendu changé ; aucune fixture importée par du code de production.

**Preuve** : même nombre de tests, tous verts ; durées avant/après.

**Rapport attendu** : fichiers migrés, constantes gardées locales et pourquoi, durées.

### 76 · Banc : une seule mise en route DevTools

Sonnet | medium. Neutre (outil). Source : 07-A1.

**Ce qui existe** : 63 scripts de `outils/banc/` réécrivent `send`, `ws.onmessage` et la collecte des erreurs de console ; 62 ouvrent leur onglet par `/json/new` et ont leur `evaluate` ; 41 réécrivent l'import d'un GPX par `DOM.setFileInputFiles` (exemples : `general.mjs:23-39`, `bench.mjs:15-30`, `cdp.mjs:1-24`) ; leurs petites différences (filtre des messages, réponse aux dialogues) sont à l'origine des défauts corrigés au lot 53.

**À faire** : `outils/banc/lib/cdp.mjs` (`connect(port)`, `evaluate`, `wait`, `blockNetwork(urls)` qui fait `Network.enable` d'office, `importGpx`, `dumpText`, `closeTab`, une seule valeur par défaut de `BASE`) ; reprise des scripts un par un ; LISEZMOI à jour (mode d'emploi de la bibliothèque, « Scripts à revoir »).

**Garde-fous** : la sortie de chaque script ne change pas ; les scripts sans navigateur (`manoeuvres-diagnostic.mjs`, `make-gpx.mjs`, `charge-ts.mjs`) ne bougent pas.

**Preuve** : chaque script repris lancé avant et après (par l'agent `banc`), sortie identique.

**Rapport attendu** : scripts repris, lignes retirées (environ 2 000 attendues), scripts laissés et pourquoi.

### 77 · Thème et DA : CSS communes, variables, choix conformes

Sonnet | medium. Non neutre pour les étapes 4 et 5 (Q35, Q49). Sources : 01-C4, 02-A26, 02-C7, 02-C8, 02-C10, 02-D2, 07-C5, 08-A11, 08-C7 à C9, 08-H3.

**Ce qui existe**
- Règles CSS recopiées : masquage accessible (`AppShell.css:98, 244`, `analysisMobile.css:306`) ; fond de fenêtre modale (`ActivitySelect.css:41` et `ui/Dialog.css:4`, 8 déclarations, `z-index: 1300`) ; aide grise (`ProfilePage.css:4`, `StatisticsPage.css:46-50`, `TrainingPages.css:74-78`, `PlanningPage.css:476-480`, `SessionLibrary.css:3-8` en `--text-m`) ; sous-titre en capitales (`ui.css:177`, `TrainingPages.css:48`) ; carte blanche en colonne (`ActivityChart.css:4`, `ProfilePage.css:135`) ; pastille 10 × 10 (`ActivityChart.css:170`, `StatisticsPage.css:83`) ; onglets resserrés (`ui.css:340`, `analysisMobile.css:320`, `PlanningPage.css:30`) ; carte fixe du téléphone tourné (`analysisMobile.css:477-491`, `PlanningPage.css:551-567`, `RecordingPage.css:10-26`, même calcul ; 350 px pour les analyses contre `--land-side-min` 380 px ailleurs, voulu d'après MISE_EN_PAGE.md:33) ; bandeau photo (`Home.css:10-22`, `SessionLibrary.css:159-172`).
- Valeurs hors variables : z-index en dur 900, 1000 (×5), 1001, 1050, 1100 (×3), 1150, 1200, 1300 ; 12 recettes d'ombre ; `font-size: 10px` (`BeepCurveEditor.css:29`) ; ruptures d'écran hors des requêtes partagées (`max-width: 599px` ×4, `359px`, `339.98px`, `699.98px`, `1199.98px`/`1200px`) ; `window.matchMedia` en direct (`AnalysisMap.tsx:139`, `ProfileRoot.tsx:285`) alors que `useMediaQuery` existe (`hooks/useNarrowScreen.ts:21`, non exporté).
- Boutons écrits en classes au lieu de `Button` : `SettingsPage.tsx:1277, 1315`, `RecordingPage.tsx:710`.
- Choix entre quelques options faits à la main, alors que la DA de CLAUDE.md demande le bouton glissant (`SegmentedControl`) : « Séparés / Superposés » (`LandModule.tsx:1287-1292`), « Puissance / Cumulée » (`:1355-1360`), « Détails des manœuvres » (`SailingModule.tsx:855-859`), tri des sauts (`JumpsPanel.tsx:254-261`, dont `buttonStyle` `:175-178` copie `MapToggle`, et « Voir / Masquer » `:293-295` qui devrait être `MapToggle`), tri des vagues par liste déroulante (`SurfModule.tsx:611`), « Itinéraires / Sessions » (`FollowTracePicker.tsx:111-118`).
- Contraire à une décision transverse : le filtre d'activité de « Suivre une trace » ouvre le menu natif d'Android (`components/FollowTracePicker.tsx:151-159`, `<select>`), alors que CLAUDE.md veut les activités « dans une liste dessinée par l'application, jamais le menu natif d'Android ».
- Réussis et ratés des manœuvres en `#388e3c` et `#d32f2f` (`SailingModule.tsx:462, 722-723, 776-777, 872-874`).
- À vérifier : couleur de l'activité préférée du Profil prise brute (`ProfilePage.tsx:193, 236`) alors que l'anneau passe par `useThemedShade` (`:138, 143`) : en thème sombre, deux nuances.

**À faire, dans cet ordre**
1. Classes communes : `.visually-hidden` (`theme/base.css`), `.ui-hint` (+ `--m`), `.ui-photo-banner`, `ui-tabs--compact` posée au lieu de recopiée, `.side-map` avec une variable `--an-side-min` (350 px, valeur gardée) à côté de `--land-side-min` ; `ActivitySelect` reprend `.ui-dialog__backdrop`.
2. Variables : `--z-map-overlay`, `--z-bars`, `--z-menu`, `--z-dial`, `--z-dialog` (valeurs actuelles) ; ombres : une variable par recette identique seulement (fusionner deux recettes différentes changerait l'écran : non) ; `--text-2xs` si elle vaut 10 px.
3. Ruptures d'écran nommées dans `useNarrowScreen.ts` avec extension de `mediaQueries.test.ts` ; `useMediaQuery` exporté, `usePrefersReducedMotion`.
4. Non neutre : `FollowTracePicker` passe à `ActivitySelect` (décision existante, pas une question) ; Q35 (par défaut oui) : les six choix au bouton glissant, « Voir / Masquer » des sauts en `MapToggle` ; boutons en `Button size="s"`.
5. Non neutre : Q49 (par défaut : couleurs de l'interface `--success` / `--danger`) ; couleur de l'activité préférée vérifiée au banc en thème sombre, corrigée si l'écart se voit et n'est pas voulu pour le dessin.

**Garde-fous** : DA de la maquette Canva (CLAUDE.md) ; MISE_EN_PAGE (350 px gardés) ; les valeurs en px des anciens écrans ne migrent qu'au passage (tranché).

**Preuve** : étapes 1 à 3 au banc, texte identique et captures identiques (ordinateur, 390 × 844, 834 × 375) ; étapes 4 et 5 : captures avant/après, liste des changements visibles.

**Rapport attendu** : classes et variables créées ; captures des étapes 4 et 5.

### 78 · Formats d'affichage uniques

Sonnet | medium. Non neutre (Q32). Sources : 08-A12, 08-D1, 08-D2.

**Ce qui existe**
- La même distance s'écrit « 12,4 km » dans le graphe d'activités du Profil (`components/ActivityChart.tsx:41`, avec un `formatDistance` local qui porte le nom de celui de `core/units.ts:167` et une autre signature, `:39`), les Statistiques (`pages/StatisticsPage.tsx:126`), le plan du test FC max (`components/FitnessTestPlanChart.tsx:15`) et l'aide de la charge cardio (`CardioLoadHelp.tsx:12`), mais « 12.40 km » dans la bibliothèque et les analyses (`core/units.ts:167-168`, `formatSpeed` `:105-109`, 102 `toFixed` dans 25 fichiers, `.replace('.', ',')` ×4).
- Durées : « 1h24 » (`core/units.ts:175-180`, bibliothèque, analyses, graphe d'activités) et « 1 h 24 » (`components/ProfileRoot.tsx:51-54`, `pages/ProfilePage.tsx:84-89`), sur la même page Profil.

**À faire** : selon Q32 (par défaut : virgule partout, « 1 h 24 » partout) : un seul formateur de nombres décimaux à l'affichage (dans `core/units.ts`, sur les briques du lot 55), une seule écriture des durées ; `ActivityChart` perd son `formatDistance` local ; tests des formateurs.

**Garde-fous** : la saisie (champs numériques) accepte toujours virgule et point ; noms de fichiers, GPX et fiches inchangés (le format ne touche que l'affichage) ; image de partage alignée sur l'écran.

**Preuve** : tests des formateurs ; banc `general.mjs`, `library.mjs`, `statistiques.mjs`, `profil.mjs`, `partage.mjs` : le diff du texte ne doit montrer que des points devenus virgules et des durées espacées.

**Rapport attendu** : résumé du diff du texte par page.

### 79 · Voile : manœuvres mesurées selon les règles 2 et 6

Fable | high. Non neutre (Q33). Seul dans sa session. Sources : 04-C5, 04-D7, 04-D10, 05-C3 à C6, 05-D1, 05-D2, 05-D5, 05-D8, 01-B9.

**Ce qui existe**
- Règle 6 : `distanceBetween` et `distanceAlongBetween` (`sailing/maneuvers.ts:811-846`) intègrent la vitesse lissée (`smoothedSpeed`, lignes `:818`, `:843`), sans `gapDistanceM` que `PointData` ne porte pas (`utils/kinematics.ts:11-36`, ou `sailing/pointData.ts` après le lot 71) ; le commentaire de `:811` cite pourtant la règle 6. Cette distance sert au rejet `tooShort` (`:1179`), à `distanceM` affichée (`:999`) et au gain au vent (`:1484`). Scénario : un pas unique de 25 s (permis jusqu'à `MANEUVER_MAX_STEP_S` = 30 s) avec une vitesse lissée de 5 nd à la reprise compte 64 m, alors que la corde fait 3 m (le noyau l'aurait bornée à 4,5 m) : le garde-fou des 10 m laisse passer un « virage » sur place.
- Règle 2 : `stableSegment` lit la vitesse de rotation d'un point au suivant (`maneuvers.ts:584-601`, `590-593`) : à 5 Hz, 1° de bruit sur 0,2 s fait 5°/s, au-dessus de `STABLE_MAX_RATE_DEG_S` (3°/s), le segment s'arrête et rend `null` ; le repli `medianStableSegment` (`:761-764`) n'en rattrape qu'une partie : moins de caps stabilisés, moins d'échantillons de vent, confiance plus basse à 5 Hz qu'à 1 Hz sur la même sortie ; `turnCoreStart` lit des pas de 1 s stricts (`:659`, `< 1000`), alors que le reste lit `TURN_STRIDE_MIN_S` = 0,9 s, et `sailingConfig.ts:86-90` explique qu'un pas de 998 ms en avale deux. Les tests 1 Hz / 5 Hz existants (`maneuvers.test.ts:604, 843, 1505`) ne comparent pas `stableHeadings`.
- Diagnostic : le verdict « planche arrêtée » (`still`) est compté avec le motif `incoherent` (`maneuvers.ts:1412-1414`, défini en `:169` comme « chute, hésitation ») ; seul `rejected` change.
- Règle 3 : `MANEUVER_MIN_TURN_DEG` lu en direct (`:1168, 1263`), seul réglage de détection qu'on ne surcharge pas (`resolveDetectionSettings`, `:1028-1037`) ; les autres constantes de la voile (`maneuvers.ts:222, 244-252, 527-553, 613-636, 1167, 1189, 1277`, `wind.ts:57, 207-211, 282, 312-315, 397-417, 652`, `sailingAnalytics.ts:104-106, 480`) sont des constantes d'algorithme.
- Règle 1 : `VmgStats` et les moyennes de manœuvres sont des chaînes `toFixed(1)` en nœuds (`sailingAnalytics.ts:15-20, 296-298`), relues par `formatKnots` (`SailingModule.tsx:730, 778-779, 875` ; `core/units.ts:137-142`) : double arrondi dans une autre unité que le nœud (0,05 nd ≈ 0,09 km/h).
- À vérifier : l'allure de la session (`core/sessionSpeed.ts:69-80`) compte le pas d'une pause et celui d'un trou avec une vitesse presque nulle et un poids de 10 s : une session à nombreuses pauses sous-estime un peu son allure, donc ses seuils accordés.
- Liés, déjà au reste à faire : n° 49 (bornes de `measureManeuver` sous bruit réaliste), n° 44 (creux d'une manœuvre lu sur la vitesse non filtrée), n° 43 (virage vu en un seul pas).

**À faire, dans cet ordre** (chaque étape séparée, chiffres avant/après à chaque fois)
1. Relevé avant : diagnostic de la trace de `make-gpx.mjs` et des 12 sessions réelles en lecture seule (comme au lot 30) ; test nouveau : la session bruitée de `maneuvers.test.ts:847` à 1 et 5 Hz, part de `stableHeadings` et nombre de `windSamplesFrom`.
2. Neutre : `MANEUVER_MIN_TURN_DEG` dans `DetectionSettings` ; motif `still` à part (seul `rejected` change, dit au rapport) ; `VmgStats` et moyennes en nombres (nœuds), formatées par la page.
3. Q33, règle 6 : `PointData` porte la distance du pas (`segmentDistanceM`, trou borné compris) ; `distanceBetween` et `distanceAlongBetween` l'intègrent (au prorata pour la seconde).
4. Q33, règle 2 : `stableSegment` et `turnCoreStart` lisent les caps par pas d'au moins `TURN_STRIDE_MIN_S` (`strideEnd`).
5. Allure de la session : mesurer l'effet des pauses sur les 12 sessions ; corriger seulement si l'écart se voit, et le dire.

**Garde-fous** : garder `segmentStart` dans le pas unique et les distances, `localWind` arrondi puis normalisé, `buildWindTimeline` avec repli aux bords, détection préparée une fois (lot 30) ; règles 5, 7, 10 ; HISTORIQUE point 21 (retoucher `stableSegment` déplace la bissectrice, donc le classement) ; les constantes d'algorithme restent des constantes, exception à la règle 3 à écrire dans DECISIONS §1 par la passe doc (tranché, à confirmer à l'utilisateur au compte rendu).

**Preuve** : étape 2 neutre sur `ManeuverStats` (hors `rejected`) ; étapes 3 à 5 : tableau avant/après des 12 sessions (vent, confiance, nombre de manœuvres, distances et gains moyens) et de la trace synthétique à 1 et 5 Hz ; banc `general.mjs` voile.

**Rapport attendu** : le tableau avant/après ; ce qui a bougé et pourquoi ; ce qui n'a pas été fait.

### 80 · Fiche de session : une table des champs, fichiers compacts

Opus | high. Neutre sauf Q44. Sources : 06-A1, 06-B1, 08-E.

**Ce qui existe**
- Les champs des saisies d'analyse sont écrits six fois : `library/record.ts:187-238` (`SessionAnalysis`) et `:450-466` (`readAnalysis`) ; `library/sessionEdits.ts:13-37` (`SessionEdits`), `:60-73` (`savedEdits`), `:80-95` (`EditedPart`, `EDITED_PART_LABEL`), `:107-121` (`changedParts`), `:124-136` (`SAME`), `:184-197` (`editsPatch`) ; le champ `pumping` (lot 22) a dû être posé à chaque endroit ; `changedParts` regroupe `bikeWeightKg` et `loadKg` sous `charge` ; 4 `as unknown as` (`record.ts:681`, `sessionEdits.ts:78, 152, 159`).
- Fiches JSON indentées (`JSON.stringify(record, null, 2)`, `record.ts:597` ; `settingsFile.ts:84`) : chaque nombre des tableaux (altitude du terrain, histogramme de FC, courbes des sauts, voies) sur sa ligne ; fiche type (2 000 échantillons d'altitude, histogramme de 150 cases) : 55 558 octets contre 25 802 compacts (× 2,15) ; compte à chaque écriture SAF, dans le paquet GPX (`sessionBundle.ts:120`) et à la relecture au lancement.

**À faire, dans cet ordre**
1. `ANALYSIS_FIELDS` dans `library/record.ts` : `{ key, read(raw), same?(a, b), part }[]` ; `readAnalysis`, `savedEdits`, `SAME`, `changedParts`, `editsPatch` s'en déduisent ; `SessionEdits = Pick<SessionAnalysis, …> & { notes; marks }` ; plus de `as unknown as`.
2. Q44 (par défaut oui) : objets indentés, tableaux de nombres sur une ligne (sérialisation maison ou `replacer`), pour les fiches et les fichiers de réglages ; relecture identique.

**Garde-fous** : la conservation du brut des champs illisibles (lot 54) passe par la table ; un paquet GPX ancien se relit et se défait encore ; le regroupement `charge` reste possible.

**Preuve** : `record.test.ts` et `sessionEdits.test.ts` verts sans changer leurs attendus ; aller-retour lecture → écriture → lecture identique sur des fiches de chaque famille ; banc `materiel.mjs`, `notes.mjs`, `session-save.mjs`, `rename.mjs`.

**Mesure attendue** : taille totale de `sessions/*.json` avant/après sur une copie synthétique ; durée de `writeRecordNow`.

**Rapport attendu** : lignes retirées ; mesure.

### 81 · Chiffres hors voile : vitesse max, sauts, surf, trous

Opus | high. Non neutre (Q34, Q41, Q42, Q43 ; bogues C6 à C10, C12 à C14, C19, D9, D26, D27). Sources : 02-D5, 04-A3, 04-C8, 04-D1, 04-D3, 04-D4, 04-D6, 04-D8, 04-D9, 04-D11, 05-A6, 05-C8, 05-D3, 05-D4, 05-D6, 05-D7, 05-F3.

**Ce qui existe**
- « Vitesse max » a trois sens : meilleure moyenne sur 2 s en voile (meilleurs segments), maximum de la vitesse lissée d'un point sur les vagues du surf (`surfing/surfAnalysis.ts:118`), maximum de la vitesse lissée d'un point dans le résumé de la bibliothèque (`library/summary.ts:185-186`).
- Sauts : vitesse au décollage lue brute (`core/jumps.ts:345-358, 395`, `speedMs`) alors que le pumping lit la vitesse lissée (`core/pumping.ts:267`) et que le seuil d'activité est jugé sur la vitesse lissée (`core/sessionStats.ts:101`) ; longueur d'un saut intégrée en trapèzes sur la vitesse interpolée (`jumps.ts:361-370`), sans `gapDistanceM` ni `segmentStart`, au lieu de lire la distance cumulée comme le pumping (`pumping.ts:240`), les repères (`core/sessionMarks.ts:78-83`) et l'altitude du terrain (`core/terrainElevation.ts:91-101`).
- Pente manquante : écartée du tableau « zones de pente » (`running/runningAnalytics.ts:156-157`), comptée en « plat » dans l'énergie (`running/energy.ts:284`, `cycling/energy.ts:251`, voulu d'après le commentaire de `:231`) : deux temps « plat » dans le même onglet.
- Surf : deux planchers d'arrêt (`SurfProfile.stillMs` 0,5 m/s, `core/sportProfiles.ts:685`, lu par `surfAnalysis` ; `stillThreshold` 2 km/h, `:622, 662`, lu par le masque d'activité) ; `maskAt` (`surfing/surfSession.ts:29-39`) recopie le masque d'activité sans remplacer un seuil ≤ 0 (`core/sessionStats.ts:143-151`) ; une pause manuelle de moins de 10 s comptée en rame ou en attente (`surfAnalysis.ts:142-155, 311-319`, seul `stepS > maxGapS` est regardé) ; « point de trace d'un instant » cherché par boucle au premier point `timeMs >= cible` (`pages/SurfModule.tsx:319-327, 350-351`) au lieu du plus proche (`trackIndexAtTime`).
- Énergie sur un trou : distance bornée, mais traînée, coût de Pandolf et force à vélo calculés à la vitesse du point de reprise (`running/energy.ts:274-279`, `cycling/energy.ts:239-243`).
- Cadence : `measuredSegments` (`running/cadence.ts:441-451`) n'écarte pas le pas `segmentStart`, alors que `cadenceFactor` (`:307`) et `sessionCadence` (`:378`) l'écartent et que le commentaire de `:374` dit « comme `measuredSegments` ».
- Intervalle d'échantillonnage : `samplingIntervalS` (`core/sessionSpeed.ts:106-121`) ignore les écarts nuls sans répartir les dates égales : un fichier à 5 Hz aux dates tronquées affiche « un toutes les 1.0 s » (`SailingModule.tsx:792`), range `summary.samplingS` à 1 (`library/summary.ts:203`), et le seuil de trace clairsemée d'`IntervalAnalysis.tsx:330` le lit.
- Allure au kilomètre pour une activité réglée en milles : `toDisplaySpeed` appelé sans unité de distance (`components/SpeedGradientLegend.tsx:25-26`, `FitnessTestPanel.tsx:89`, `HeartRatePanel.tsx:141`) ; le défaut `distanceUnit = 'km'` (`core/units.ts:25, 31, 40`) cache l'oubli.
- À vérifier : deux détections de l'unité du Doppler qui peuvent diverger sur un fichier limite (`kinematics.ts:143-156` contre `:454-475`) ; `Math.min(...tableau)` sur une série entière (`core/heartRateSession.ts:130-131`, `core/heartRate.ts:262-263`) ; `readActivities` qui rend la constante `DEFAULT_ACTIVITIES` elle-même (`core/activities.ts:192`).

**À faire, dans cet ordre** (chiffres avant/après relevés sur des traces synthétiques et, en lecture seule, sur les sessions réelles de course, de vélo et de surf de `D:\memoire Tracker\Tracker\sessions\` s'il y en a)
1. Neutres : `Math.min`/`Math.max` en boucle ; `readActivities` rend une copie ; `distanceUnit` obligatoire quand l'unité est une allure (surcharge de types) et passé aux trois appelants (non neutre seulement pour « allure + milles ») ; deux détections du Doppler comparées sur toutes les traces disponibles (rapport ; ne rien changer si elles ne divergent jamais).
2. Bogues sûrs : cadence sans le pas de reprise ; `samplingIntervalS` sur `spreadEqualTimes` (test : 5 Hz tronqué → 0,2) ; `SUMMARY_CALC_VERSION` augmenté.
3. Énergie sur un trou : `v = d / dt` pour les pas qui portent `gapDistanceM` (tranché : la règle 6 le veut ; ne change que les trous).
4. Q34 (par défaut : la meilleure moyenne sur 2 s partout) : vagues du surf et résumé ; `SUMMARY_CALC_VERSION` augmenté.
5. Q41 (par défaut oui) : vitesse au décollage lissée, longueur par `distanceAtTime(b) − distanceAtTime(a)` (brique `valueAtTime` du lot 57) ; `JUMPS_CALC_VERSION` augmenté (les sauts rangés se recalculent).
6. Q42 (par défaut : garder la différence et le dire sous le tableau des zones) ; Q43 (par défaut : un seul plancher, 2 km/h, si les chiffres des sessions bougent peu ; sinon BLOQUÉ avec l'écart) ; `maskAt` remplacé par `thresholdActivityMask` ; pause manuelle du surf exclue de la rame et de l'attente ; point d'un instant par `trackIndexAtTime` (un point d'écart au plus).

**Garde-fous** : règle 6 ; DECISIONS §3 (sauts) et §4 (surf) ; une version de calcul augmentée par chiffre rangé qui change.

**Preuve** : chaque étape avec son test ; tableau avant/après des chiffres touchés.

**Rapport attendu** : tableau avant/après par étape ; versions augmentées.

### 82 · Planification : doublons internes et revêtement

Sonnet | high. Neutre sauf Q47. Sources : 07-A4, 07-A6, 07-A11, 07-B8, 07-B9, 07-C4, 07-D4, 07-D5.

**Ce qui existe**
- Grille spatiale de segments écrite deux fois (`planning/wayMatch.ts:96-132`, `planning/loopReturn.ts:240-272`).
- Recollage des tronçons deux fois (`planning/route.ts:842-849` `legsPoints`, `loopReturn.ts:116-133` `corridorPaths`) ; prédicat « tronçon calculé » trois fois (`route.ts:87, 178` ; `planning/surface.ts:355` `isComputedLeg` ; `loopReturn.ts:110` `formsCorridor`, différent : il compte les traces importées).
- Deux classements du revêtement OSM qui divergent : `brouterProfile.ts:72-78` (`PAVED_SURFACES`, `UNPAVED_SURFACES`, `ROLLING_PATH_SURFACES`, pour le calcul) et `surface.ts:74-94` (pour l'affichage) : `chipseal`, `cement`, `bricks`, `unhewn_cobblestone` revêtus à l'affichage mais absents du calcul ; `grass_paver` revêtu pour le calcul, « Herbe » à l'affichage ; `soil`, `rocks`, `rocky`, `unpaved_minor` non revêtus à l'affichage, absents du calcul.
- Profil BRouter renvoyé deux ou trois fois quand plusieurs tronçons reçoivent « profil absent » en même temps (`planning/brouter.ts:211-214`).
- Recherche de lieux sans annulation ni contrôle de la dernière demande (`pages/PlanningPage.tsx:602-619`).
- `Home.tsx:23` importe `planning/routeList`, qui tire `route.ts` (964 lignes), `duration`, `cycling/energy`, `runningAnalytics`, `loopReturn`, `surface`, `brouterProfile` dans le paquet du démarrage.

**À faire, dans cet ordre**
1. `core/segmentGrid.ts` (`build(segments, cell, margin)`, `near(point)`) pour les deux grilles ; `isComputedLeg = isWaysMode(leg.mode)` ; `joinLegs(legs, keep?)`.
2. Profil BRouter envoyé une fois (promesse partagée) ; recherche de lieux qui ignore une réponse périmée (`AbortController`).
3. `shownRoutes` et `routeActivity` dans un petit module sans dépendance ; mesure du paquet du démarrage par un build dans un dossier du brouillon (`--outDir`), avant/après.
4. Q47 (par défaut : l'affichage s'aligne sur le calcul, le calcul ne change pas) : une table unique des valeurs `surface` d'où l'on tire l'affichage ; `brouterProfile.ts` intact (coûts fixés avec l'utilisateur, DECISIONS §7).

**Garde-fous** : profil BRouter et ses coûts inchangés ; `route.test.ts`, `loopReturn.test.ts`, `wayMatch.test.ts`, `surface.test.ts` verts sans changer leurs attendus (sauf, à l'étape 4, ceux de l'affichage des valeurs listées).

**Preuve** : tests ; banc `planning.mjs`, `boucle.mjs`, `surface.mjs` avant/après (texte identique jusqu'à l'étape 3).

**Rapport attendu** : lignes retirées ; taille du paquet du démarrage avant/après ; valeurs de revêtement dont l'affichage change.

## Architecture cible

État visé avant le fork (ce que l'assainissement prépare), puis ce qui est plutôt pour le fork lui-même.

**Sens des dépendances, dans un seul sens** :

```
core  →  domaines (sailing, running, cycling, surfing, planning, recording, library)  →  settings  →  stores (fork) / hooks  →  components  →  pages
platform → core seulement ; tout le monde peut lire platform
```

- `core/` : unités SI, géométrie (`geo.ts`, `angles.ts`, `geoPlane.ts`), temps (`search.ts`, `calendar.ts`), statistiques de base, profils, formats (`units.ts`, `basics.ts`, `xml.ts`, `base64.ts`), pente et énergie communes (`grade.ts`, `energy.ts`), tronçons (`TrackSpan`), aucun import d'un autre dossier (lots 55, 57, 70, 71).
- Domaines : calcul pur testé de chaque sport et de la mémoire ; `library/` reçoit la préparation des résumés, les notes de session, les vignettes (`sessionTrack`) (lots 70 à 72).
- `settings/` (nouveau, lot 71) : pré-réglages et réglages purs d'une activité (`activityPresets.ts`, `activitySettings.ts`, `gear.ts`), qui peuvent lire les domaines.
- `hooks/` : des hooks React courts ; les gros services hors React (bibliothèque, enregistreur, direct, notification, guidages, compteur, chrono, trace suivie, thème, avertissement de sortie) sont signalés pour le fork.
- `components/` : une coquille d'analyse en pièces (`useAnalysisSession`, `useAnalysisTabs`, `useAnalysisHeart`, `AnalysisBaseLayers`, panneaux communs, `AnalysisShell` ; lots 62 à 65) ; un seul graphe de trace (`TrackChart`, lots 59 à 61) ; une seule couche de trace colorée (lot 73) ; aucun calcul pur sans test.
- `src/test/` : fixtures communes (lot 75) ; `src/architecture.test.ts` garde le sens des dépendances (lot 71).
- `outils/banc/lib/cdp.mjs` : une seule mise en route du banc (lot 76).

**Ce que chaque lot y apporte**

| Lot | Apport à l'architecture cible |
|---|---|
| 53 | base propre (code mort, configuration stricte écrite, banc fiable) |
| 54 | fiches robustes entre versions : condition pour un fork qui fera coexister deux versions |
| 55, 57 | `core/` complet en briques de base, une seule écriture de chaque formule |
| 56, 58 | noyau rapide et prouvé identique (copies gelées réutilisables par le fork) |
| 59 à 61 | un seul graphe de trace et ses pièces |
| 62 à 65 | une coquille d'analyse : un nouveau sport ne recopie plus 500 lignes |
| 66 à 69 | magasins sûrs (lecture, écriture, cache par session), rendus limités : préfigure `stores/` |
| 70 | pente et énergie au noyau, un type de tronçon |
| 71, 72 | sens des dépendances tenu par un test ; calcul pur hors des hooks ; priorités (couleurs, seuils de la voile) testées |
| 73, 74 | carte légère |
| 75, 76 | outils de preuve communs (tests et banc) |
| 77, 78 | thème et formats tenus à une seule place |
| 79 à 82 | règles 1 (en partie), 2, 3 et 6 tenues par les calculs |

**Plutôt pour le fork** (pas de lot ici ; à reprendre quand le fork sera décidé) :
- Dossier `src/stores/` pour les services hors React, et `useSessionLibrary.ts` découpé en `stores/library/{state,records,settingsSync,scan,import}.ts` (03-C1 ; tranché : oui, en dernier, jamais mélangé à une correction).
- Le noyau rend des nombres seulement (m/s, s, m), formatés à l'affichage par un `formatBaseStats(stats, units)` : `TopSegment.val`, `BaseSessionStats` (`core/types.ts:89-95, 109-144`), `ZoneStats.time` (04-C2, 05-C5) ; suffixe d'unité obligatoire dans les noms (`durationS`, `speedMs`, `speedKn`) et « Flight » à trois sens renommé (05-C9).
- Pièces d'interface sorties du noyau vers un `src/ui/` pur et testé : `patternTiles`/`backdropPattern`, `rootPath`, `shareImage`, `mapBase`, `tiles`, `parentPage`, `analysisTabs`, `activityIcons`, `displayConfig`, `FAMILY_ACCENT` (04-C3).
- Services réseau et appariement dans un `src/geo/` (`brouter`, `overpass`, `ignAltimetry`, `geocoding`, `fetchJson`, `wayMatch`, `surface`) ; `planning/route.ts` découpé (`routeModes`, `routeEdit`, `routeLoop`, `routeImport`, `routeMetrics`) (07-C1, 07-C3).
- Modules par sport découpés : `useLandSession`, `useSurfSession` sur le modèle de `useSailingSession`, panneaux dans `components/<sport>/` (`LandGraphsPanel`, `EnergyPanel`, `GradeZonesPanel`, `ManeuversPanel`, `VmgPanel`, `WindPanel`, `WavesPanel`, `PaddlePanel`…), `PlanningPage`, `SettingsPage` (`pages/settings/ActivityCard`…), `RecordingPage`, `StatisticsPage` sous 800 lignes (02-C1, 03-C8).
- Zoom des graphes tenu dans un petit magasin par clé (comme le survol) au lieu du module : pendant un pincement, seuls les graphes qui partagent le zoom se redessinent (01-B1 ; à mesurer au profileur d'abord).
- `platform/` : un objet natif et un objet navigateur choisis une fois (`heartRate`, `motion`, `permissions`), `platform/privateFiles.ts` (18 `await filesystem()`, 20 `Directory.Data` aujourd'hui), `platform/folderImport.ts`, `platform/lifecycle.ts` (`onAppVisible`, `onAppHidden` à la place de `visibilitychange` et `pagehide` en direct) (06-A4, 06-A13, 06-C2, 03-C7).
- TypeScript plus strict : `noUncheckedIndexedAccess` (touche de très nombreux `points[i]`).

## Bogues

Dédoublonnés, triés par gravité. « Lot » : celui qui le corrige. Confiance : sûr (lu dans le code, scénario certain), probable (mécanisme sûr, cas réel plausible), à vérifier.

**A. Perte ou écrasement de données**

| N | Bogue | Scénario | Fichiers:lignes | Confiance | Sources | Lot |
|---|---|---|---|---|---|---|
| A1 | Une version plus ancienne qui réécrit une fiche perd ou déforme des champs connus | téléphone à jour, PC plus ancien ; on renomme la session sur le PC : un champ de forme nouvelle (revêtement, altitude, sauts, test, résumé) disparaît | `library/record.ts:378-396, 452-465, 558-587` ; `recording/fitnessTest.ts:259` | probable | 06-D1 | 54 |
| A2 | Fichier neuf écrit en place : une fiche tronquée bloque la session en lecture seule pour toujours | l'application est tuée pendant la création d'une fiche ou d'un GPX | `MemoryFolderPlugin.java` (`writeBytes`, création) ; `platform/memoryFolder.ts:579-594` ; `hooks/useSessionLibrary.ts:964-966` | probable (fenêtre étroite) | 06-D4 | 54 |
| A3 | Démarrage du stockage en échec : réglages remis au défaut, fichier de réglages d'un autre appareil adopté, changements perdus | une lecture Preferences échoue au lancement | `platform/storage.ts:159-170` ; `useSessionLibrary.ts:700-708` | à vérifier (rare, conséquence lourde) | 06-D3 | 54 |
| A4 | Écriture des réglages perdue entre le premier rendu et l'abonnement ; le module réécrit ensuite des réglages périmés | réglages repris du dossier pendant le montage d'une page | `hooks/useSportSettings.ts:1079, 1089-1091, 1481, 1501-1503` | à vérifier (fenêtre courte) | 03-D4 | 66 |
| A5 | Mises à jour qui s'écrasent (état figé au dernier rendu) | deux écritures dans un même geste, ou une écriture d'ailleurs entre le rendu et le clic ; aucun appelant fautif aujourd'hui | `useSportSettings.ts:1160-1331` ; `hooks/useSessionDraft.ts:62-74` | sûr (motif), latent | 03-D3 | 66 |
| A6 | Objets du magasin modifiables en production : mémoire et stockage divergent sans écriture | un appelant modifie l'objet lu | `platform/storage.ts:72-82` | à vérifier | 06-D8 | annexe (test qui balaie les appelants, au lot 66 si le temps le permet) |

**B. Usage bloqué**

| N | Bogue | Scénario | Fichiers:lignes | Confiance | Sources | Lot |
|---|---|---|---|---|---|---|
| B1 | Arrêt pendant une pause ou une reprise : enregistreur bloqué jusqu'au redémarrage, ou GPS orphelin et notification qui reste | appui long (pause) puis « Arrêter » aussitôt ; ou reprise puis « Arrêter » | `hooks/useRecorder.ts:693, 708, 712, 728-731, 821-884` | à vérifier | 03-D2 | 54, essai 68 |
| B2 | Analyse vide sans message si la lecture du GPX lève | accès au dossier retiré, carte mémoire retirée | `hooks/useLibraryNavigation.ts:99-109` ; `platform/memoryFolder.ts:140-142, 320` | probable | 03-D1 | 54 |
| B3 | Recherche du revêtement ou de l'altitude bloquée jusqu'à la relance | le réseau tombe au milieu d'une réponse d'Overpass ou de l'IGN | `planning/overpass.ts:112-116` ; `planning/ignAltimetry.ts:88-93` ; `useSessionSurfaces.ts:26-49` ; `useTerrainElevation.ts:24-57` | probable | 07-D1 | 54, essai 69 |
| B4 | Écran blanc au démarrage si une mise à niveau des réglages lève | fichier de réglages d'une forme inattendue | `main.tsx:41-53` | à vérifier | 03-D7 | 54 |
| B5 | Ceinture injoignable jusqu'au redémarrage si une écoute a échoué une fois | greffon pas prêt au premier `addListener` | `platform/heartRate.ts:167-181` | à vérifier (faible) | 08-D6 | 54 |

**C. Chiffre faux ou fragile**

| N | Bogue | Scénario | Fichiers:lignes | Confiance | Sources | Lot |
|---|---|---|---|---|---|---|
| C1 | Voile : le brouillon de la session suivante s'applique un instant à la trace précédente | passer de la session A à la B sans quitter le module (lien, retour d'Android) | `pages/SailingModule.tsx:159-161, 244` | probable | 02-D1, 03-B8 | 54 |
| C2 | Résumés de la liste figés quand le seuil ou le foil d'une activité change dans Réglages | changer le seuil de « Wingfoil » : bibliothèque, accueil, Statistiques gardent l'ancien temps en action | `hooks/useSessionLibrary.ts:353-375` ; `library/record.ts:636, 844-850` | probable | 06-D2 | n° 37 du reste à faire (déjà noté ; l'audit le confirme ; à remonter à la revue) |
| C3 | Voile : distance, gain et garde-fou des 10 m d'une manœuvre faux à travers un trou de trace (règle 6) | enregistreur économique, pas de 25 s, planche qui dérive : un « virage » sur place compté | `sailing/maneuvers.ts:811-846, 999, 1179, 1484` | probable | 04-D10, 05-C3, 05-D2 | 79 (Q33) |
| C4 | Voile : caps stabilisés presque introuvables à 5 Hz sous bruit de cap ; moins de vent fiable qu'à 1 Hz (règle 2) | fichier importé à 5 Hz | `sailing/maneuvers.ts:584-601, 761-764` | probable | 05-C4, 05-D1 | 79 (Q33) |
| C5 | Voile : `turnCoreStart` à 1 s strict, un pas de 998 ms en avale deux | vraie trace à 1 Hz avec gigue d'horloge | `sailing/maneuvers.ts:659` ; `sailing/sailingConfig.ts:86-90` | probable (effet faible) | 05-D5 | 79 (Q33) |
| C6 | Intervalle d'échantillonnage faux sur un fichier à 5 Hz aux dates tronquées | « un toutes les 1.0 s » au lieu de 0,2 ; `summary.samplingS` à 1 | `core/sessionSpeed.ts:106-121` ; `SailingModule.tsx:792` ; `library/summary.ts:203` ; `IntervalAnalysis.tsx:330` | sûr | 04-D1 | 81 |
| C7 | Sauts : vitesse au décollage brute (le seuil la juge lissée) ; longueur hors règle 6 | saut pris dans un pic de vitesse brute ; vol sur un trou de trace | `core/jumps.ts:345-370, 395` | probable | 04-A3, 04-D3, 04-D4 | 81 (Q41) |
| C8 | Énergie sur un trou de trace calculée à la vitesse de reprise | téléphone sous l'eau, perte du GPS | `running/energy.ts:274-279` ; `cycling/energy.ts:239-243` | probable (faible) | 05-D4 | 81 |
| C9 | Cadence comptée à travers une reprise après pause | pause manuelle de moins de 10 s, cadence aux deux bouts : longueur de pas un peu basse | `running/cadence.ts:441-451` | à vérifier | 05-D3 | 81 |
| C10 | Deux détections de l'unité du Doppler qui peuvent diverger | fichier limite : seuils dans une unité, cinématique dans l'autre | `core/kinematics.ts:143-156, 454-475` ; `core/sessionSpeed.ts:62` | à vérifier | 04-D6 | 81 (mesure d'abord) |
| C11 | Allure de la session tirée vers le bas par les pauses, donc seuils de la voile accordés un peu bas | session à nombreuses pauses automatiques | `core/sessionSpeed.ts:69-80` | à vérifier | 04-D7 | 79 |
| C12 | Surf : pause manuelle comptée en rame ou en attente | pause manuelle de moins de 10 s | `surfing/surfAnalysis.ts:142-155, 311-319` | à vérifier | 05-D7 | 81 (Q43) |
| C13 | Surf : un seuil de vague à 0 rend toute la trace « en glisse » | seuil saisi à 0 (à vérifier qu'il soit saisissable) | `surfing/surfSession.ts:29-39` | probable | 05-A6 | 81 |
| C14 | Allure au kilomètre pour une activité réglée en milles | légende, test, cardio d'une activité « allure + milles » | `components/SpeedGradientLegend.tsx:25-26` ; `FitnessTestPanel.tsx:89` ; `HeartRatePanel.tsx:141` ; `core/units.ts:25, 31, 40` | à vérifier | 04-C8, 04-D9 | 81 |
| C15 | Pics de FC et de cadence perdus dans « graphiques » (visuel) | sortie de 3 h, sprint de 15 s entre deux lignes | `LandModule.tsx:687` ; `SailingModule.tsx:523` ; `SurfModule.tsx:374` | probable | 01-D2 | 61 |
| C16 | Fin de plage FC décalée d'une milliseconde | dates fractionnaires de `spreadEqualTimes` | `core/heartRate.ts:440` | sûr (impact très faible) | 04-D5 | 53 |
| C17 | Meilleurs segments classés dans l'unité d'affichage : avec une allure, la « meilleure » serait la plus lente | premier appelant qui passe une allure | `core/topSegments.ts:93, 110` | sûr (latent) | 04-D2, 04-C2 | 56 |
| C18 | Points du protocole du test FC max à +0,6 km/h en dur | le pas du protocole change ou devient réglable | `components/FitnessTestPlanChart.tsx:65` | sûr (latent) | 01-D3 | 59 |
| C19 | Pente manquante : deux temps « plat » différents dans le même onglet | trace à altitude incomplète | `running/runningAnalytics.ts:156-157` ; `running/energy.ts:284` ; `cycling/energy.ts:251` | sûr (peut-être voulu) | 05-D6 | 81 (Q42) |
| C20 | Voile : vitesse des graphes passée par une chaîne (`parseFloat(formatKnots)`), double arrondi de la VMG hors nœuds | une unité d'allure permise en voile ; tiret → `NaN` ; km/h | `SailingModule.tsx:215, 525-527, 730, 778-779, 875` ; `sailing/sailingAnalytics.ts:15-20, 296-298` | sûr (fragilité) | 01-B9, 05-C5 | 58 (graphes), 79 (VMG) |

**D. Affichage, latents, mineurs**

| N | Bogue | Fichiers:lignes | Confiance | Sources | Lot |
|---|---|---|---|---|---|
| D1 | Zoom et survol du profil des répétitions gardés d'une séance à l'autre de même forme | `components/IntervalAnalysis.tsx:557` ; `LandModule.tsx:1245` | probable | 01-D1 | 61 |
| D2 | Clic sur l'évolution des répétitions sans viser une répétition | `IntervalAnalysis.tsx:481-486` | à vérifier | 01-D4 | 61 |
| D3 | Virgule ou point décimal selon la page | `components/ActivityChart.tsx:39-41` ; `StatisticsPage.tsx:126` ; `core/units.ts:167-168` | sûr | 08-D1 | 78 (Q32) |
| D4 | Durées « 1h24 » et « 1 h 24 » sur la même page | `core/units.ts:175-180` ; `ProfileRoot.tsx:51-54` ; `ProfilePage.tsx:84-89` | sûr | 08-D2 | 78 (Q32) |
| D5 | Grille et graduations du graphe des sauts hors thème | `components/JumpsPanel.tsx:142-146` ; `ui.css:662` | probable | 08-D7 | 61 |
| D6 | Couleur de l'activité préférée du Profil non adaptée au thème | `pages/ProfilePage.tsx:193, 236` | à vérifier (peut être voulu) | 02-D2 | 77 |
| D7 | « Par défaut » grisé quand seule la liste de matériel est réglée | `pages/SettingsPage.tsx:464-468, 567` | à vérifier | 02-D3 | 66 |
| D8 | `unitLabel` lu avant sa déclaration (une `ReferenceError` dès qu'un appel remonte) | `pages/SurfModule.tsx:439, 508` | sûr (fragilité) | 02-D4 | 53 |
| D9 | Surf : point de trace d'un instant pris au premier point suivant, pas au plus proche | `SurfModule.tsx:319-327, 350-351` | à vérifier (un point) | 02-D5 | 81 |
| D10 | Onglets « sauts » et « pumping » absents si des capteurs arrivent par un import pendant l'analyse | `useSessionLibrary.ts:1383-1391, 1671` | probable (gêne faible) | 03-D5 | 54 |
| D11 | Repère « Note » daté hors de la trace pendant un rejeu | `hooks/useRecorder.ts:809` | à vérifier (banc seulement) | 03-D6 | 54 |
| D12 | Résultat d'une recherche (revêtement, altitude) rangé deux fois | `useSessionSurfaces.ts:80-89` ; `useTerrainElevation.ts:109-118` | sûr (sans gravité) | 03-D8 | 69 |
| D13 | Journal sans en-tête lisible repris en wingfoil | `hooks/useRecorder.ts:526` | sûr (rare) | 06-D5 | 54 |
| D14 | Fiche `X.JSON` jamais gardée en cache | `useSessionLibrary.ts:296-298` ; `library/reconcile.ts:50, 58` | sûr (mineur) | 06-D6 | 53 |
| D15 | Bips du navigateur après « stop » ; contexte audio fermé puis rouvert | `platform/beeper.ts:152-166` | sûr (banc et navigateur) | 06-D7 | 53 |
| D16 | Rejet non rattrapé dans `watchSatellites` | `platform/location.ts:361-367` | sûr (mineur) | 06-D9 | 53 |
| D17 | Écart de couleur possible entre une vignette et son analyse (aucun test ne garde l'ordre des bornes) | `components/sessionTrack.ts:65-77` ; trois modules | à vérifier | 07-A2, 07-D3, 08-A8 | 72 |
| D18 | Profil BRouter envoyé deux ou trois fois | `planning/brouter.ts:211-214` | probable (sans conséquence) | 07-D4 | 82 |
| D19 | Recherche de lieux : une réponse lente écrase la suivante | `pages/PlanningPage.tsx:602-619` | à vérifier | 07-D5 | 82 |
| D20 | `<span>` vides dans le conteneur de la carte | `JumpMapLayer.tsx:33` ; `TrackSpanLayer.tsx:31` | sûr (faible) | 07-D6 | 53 |
| D21 | Fond satellite au large : jusqu'à 48 s par case | `components/mapTiles.ts:76-95` | à vérifier (en mer) | 07-D7 | 74 |
| D22 | Couleurs de la vitesse et de l'altitude hors de leur constante (piège pour la prochaine retouche) | `LandModule.tsx:808, 852-853, 875` ; `ZoomableChart.css:30-32` | sûr | 08-D3 | 59 |
| D23 | Test chronométré fragile | `planning/loopReturn.test.ts:149-151` | probable | 08-D4 | 53 |
| D24 | Constantes géodésiques des tests divergentes (vitesses recalculées 0,11 % plus basses qu'annoncé) | `sailing/maneuvers.test.ts:129, 253, 389` ; `core/terrainElevation.test.ts:14, 84` | sûr (sans effet aujourd'hui) | 08-D5 | 75 |
| D25 | Texte « plus de 10 cm » figé alors que la borne est réglable | `core/jumps.ts:105` | sûr (nul aujourd'hui) | 04-D12 | 53 |
| D26 | `Math.min(...tableau)` sur une série entière | `core/heartRateSession.ts:130-131` ; `core/heartRate.ts:262-263` | faible | 04-D8 | 81 |
| D27 | `readActivities` rend la constante des défauts elle-même | `core/activities.ts:192` | à vérifier | 04-D11 | 81 |
| D28 | Diagnostic des virages écartés : « planche arrêtée » rangée sous « incohérent » | `sailing/maneuvers.ts:169, 1412-1414` | à vérifier | 05-D8 | 79 |
| D29 | Choix « Suivre une trace » par le menu natif d'Android (contraire à une décision transverse) | `components/FollowTracePicker.tsx:151-159` | sûr | 07-C5 | 77 |

Essais au téléphone : seuls B1 (essai 68) et B3 (essai 69) en demandent un ; A2 se relit (Java), le reste se prouve par test ou au banc.

Écarté : 08-D8 (carte du téléphone tourné à 350 px contre 380 ailleurs) : voulu, écrit dans `MISE_EN_PAGE.md:33`. Vérifiés et écartés par l'agent 08 : `JSON.parse` sans `try` dans `platform/storage.ts:77` et `ShareDialog.tsx:86`, `setTimeout` sans `clearTimeout` (`MoreMenu.tsx:58`, `useSessionJumps.ts:31`, `files.ts:95`, `main.tsx:39`), `addEventListener` sans retrait (`leaveGuard.ts:45, 56`, `useSessionLibrary.ts:1267, 1270`).

## Questions

Pour l'utilisateur, en clair. **Réponse du 29/10 : l'utilisateur a validé la réponse par défaut de Q33 à Q49 ; elles sont tranchées, les lots les appliquent telles quelles.** Seule Q32 reste ouverte, posée dans `docs/BACKLOG.md` ; il a demandé en quoi consistait le mélange (réponse : virgule dans Profil et Statistiques, point et deux décimales dans la bibliothèque et les analyses ; « 1h24 » et « 1 h 24 » sur la même page Profil) ; sans réponse, la valeur par défaut s'applique au lot 78.

| Q | Lot | Question | Par défaut | Ce qui change selon la réponse |
|---|---|---|---|---|
| Q32 | 78 | Écrire partout « 12,4 km » (virgule) et « 1 h 24 » (avec espaces), au lieu du mélange actuel ? | oui aux deux | oui : bibliothèque et analyses passent à la virgule et aux durées espacées ; non : on choisit l'autre écriture partout |
| Q33 | 79 | Voile : mesurer les manœuvres comme le reste de l'application (distance à travers un trou de trace bornée, caps lus seconde par seconde sur un fichier à 5 points par seconde), quitte à voir bouger un peu distances, gains au vent et quelques manœuvres ? | oui, avec les chiffres avant et après de vos 12 sessions de voile | oui : lot 79 (Fable) ; non : les chiffres de la voile restent tels quels, seules les retouches neutres du lot 79 se font |
| Q34 | 81 | « Vitesse max » a trois sens (meilleure moyenne sur 2 s en voile, point le plus rapide d'une vague en surf, point le plus rapide dans la liste des sessions) : le même partout ? | la meilleure moyenne sur 2 s partout | oui : vitesses max du surf et de la liste un peu plus basses, plus stables ; non : on garde les trois sens |
| Q35 | 77 | Les choix à deux ou trois options faits de boutons à la main (« Séparés / Superposés », « Puissance / Cumulée », « Détails des manœuvres », tri des sauts et des vagues, « Itinéraires / Sessions ») passent au bouton glissant, comme le veut la règle de style ? | oui | oui : petit changement visuel sur ces six choix ; non : ils restent tels quels, seul le code est rangé |
| Q36 | 59 | La voile trace sa courbe de vitesse dans un bleu un peu plus foncé que la course, le vélo et le surf : un seul bleu ? | non, garder les deux bleus | oui : la voile prend le bleu des autres |
| Q37 | 61 | L'onglet « graphiques » de la voile garde-t-il sa disposition (cases côte à côte) ou passe-t-il à la pile de la course et du surf ? | garder sa disposition ; seuls les noms des graphes prennent la règle commune (petits, à la couleur de leur courbe) | pile : l'onglet ressemble à celui de la course |
| Q38 | 61 | En voile et en surf, le curseur doit-il se déplacer ensemble sur la vitesse et la FC, comme à pied ? | oui | non : chaque graphe garde son curseur à lui |
| Q39 | 63 | Surf foil : lire les capteurs seulement à l'ouverture de l'onglet « vols », comme en voile (moins de mémoire à l'ouverture d'une session) ? | oui ; l'onglet « vols » met un instant à se remplir | non : ils restent lus dès l'ouverture |
| Q40 | 58 | Voile : en tirant le curseur du seuil, les chiffres suivent-ils avec un très léger retard (curseur fluide) ? | oui | non : le calcul suit chaque cran, le curseur peut accrocher au téléphone |
| Q41 | 81 | Sauts : vitesse au décollage lue sur la vitesse lissée (comme le pumping et le seuil d'activité), et longueur lue sur la distance cumulée ? | oui ; les sauts déjà rangés sont recalculés | non : vitesse brute du GPS gardée |
| Q42 | 81 | Pente manquante : le tableau des zones l'écarte, l'énergie la compte comme du plat ; garder cette différence ? | la garder, et le dire sous le tableau | non : les deux comptent pareil (à choisir) |
| Q43 | 81 | Surf : deux planchers d'arrêt (1,8 km/h pour l'attente, 2 km/h pour le temps en mouvement) ; n'en garder qu'un ? | un seul, 2 km/h, si les chiffres de vos sessions bougent peu | non : les deux restent |
| Q44 | 80 | Les fiches des sessions (fichiers JSON du dossier) écrivent leurs longues listes de nombres sur une seule ligne, deux fois plus petites, toujours lisibles dans un éditeur ? | oui | non : elles restent indentées (deux fois plus grosses) |
| Q45 | aucun (à corriger seul si non) | Supprimer une session supprime aussi ses doubles (même instant de départ), y compris un double qui porte des notes : est-ce voulu ? | oui, c'est voulu | non : on garde le double qui porte des notes, ou on demande |
| Q46 | 73 | Pour alléger la carte d'une longue session : dessiner la trace par une couche faite maison, couleurs inchangées (plus long à faire), ou arrondir le dégradé à une soixantaine de teintes (sans différence à l'œil, plus simple) ? | couche maison, couleurs inchangées | teintes arrondies : le dégradé n'est plus exactement continu (décision transverse à revoir) |
| Q47 | 82 | Le calcul des itinéraires et la barre du revêtement ne rangent pas toutes les surfaces pareil (une piste en « chipseal » est une piste pour le calcul et de l'« Asphalte » à l'affichage) : aligner ? | aligner l'affichage sur le calcul, sans toucher au calcul ni à vos coûts | non : rien ne change ; ou aligner le calcul (vos coûts restent, mais quelques itinéraires changent) |
| Q48 | 73 | Le liseré blanc de la trace sur le fond satellite fait 7, 8 ou 9 px selon l'écran (direct, analyse, planification) : une seule épaisseur ? | oui, celle de l'analyse | non : chaque écran garde la sienne |
| Q49 | 77 | Réussis en vert et ratés en rouge dans le tableau des manœuvres : couleurs de l'interface (qui s'adaptent au thème sombre) ou couleurs fixes ? | couleurs de l'interface | fixes : rien ne change |

Pas une nouvelle question : le recalcul des résumés quand le seuil d'une activité change (06-F2) est le n° 37 du reste à faire ; l'audit le confirme (bogue C2), réponse par défaut proposée : oui, recalcul en fond des sessions de cette activité qui n'ont pas de seuil propre.

**Tranché par la synthèse** (points techniques, pas des questions pour l'utilisateur ; à signaler au compte rendu) :
- Brouillon de la voile sur le fichier affiché, comme les autres sports (03-F3) : oui, lot 54.
- Filtre d'activité de « Suivre une trace » : la liste de l'application (décision transverse existante, 07-F5), lot 77.
- Test chronométré du retour de boucle relâché à 1 s (08-H4), lot 53.
- Lissage d'altitude plus rapide au prix d'écarts au milliardième de mètre (04-F4) : non ; à revoir si l'ouverture des longues sorties reste lente.
- Couleurs de trace par défaut rangées dans le profil de chaque calcul, même ordre des bornes (04-F5) : oui, lot 72.
- Constantes de la voile : exception assumée à la règle 3 (constantes d'algorithme), sauf `MANEUVER_MIN_TURN_DEG` rendu surchargeable (05-F7) : oui, lot 79 ; à écrire dans DECISIONS §1 par la passe doc, avec l'accord de l'utilisateur.
- Cap de l'appareil (Doppler) en voile (05-F5) : non ; plus tard, au banc d'abord (tout le vent changerait).
- Réglages du direct par sport (cap de la flèche, écart de 60 m, découpe des bords, 06-F3) : non, constantes nommées et documentées.
- Réglages de la planification (couloir de retour, accrochage à 500 m, recherche des voies à 25 m, 07-F4) : fixes.
- Code de passage (ancien `reglages.json`, notes d'avant le dossier, ancien cache, champ `analysis.terrain`, 06-F4) : gardé jusqu'à la version 0.4.
- Services rangés à part des hooks, noyau qui rend des nombres, pièces d'interface hors du noyau (03-F1, 04-F2, 04-F3) : oui, pour le fork (section « Architecture cible »).
- Bulles au survol des graphes non reliés à la carte (01-F3) : laissées (MISE_EN_PAGE ne vise que les graphes reliés à la carte).
- Opacités de surbrillance 0,8 et 0,85, `signedPercent` à deux écritures, trois seuils « trop lent pour une allure » : gardés tels quels, nommés (aucun écran ne change sans demande).
- Valeurs en px des anciens écrans (08-H5) : migrées seulement au passage, sauf tableaux et graphes (lots 59, 64).
- Conflits entre rapports tranchés : bouton glissant (01-F4 « oui », 02-F1 « non ») → oui par défaut, c'est la règle écrite (Q35) ; bleu de la vitesse (01-F2 « un seul », 02-F3 « deux ») → deux, aucun écran ne change sans demande (Q36).

## Chiffres

| Rapport | Zone | Lu | Doublons | Optim. | Archi. | Bogues | Code mort | Questions |
|---|---|---|---|---|---|---|---|---|
| 01 | graphes et composants | 31 fichiers en entier (environ 3 300 lignes) et 1 450 lignes d'extraits | 13 | 10 | 9 | 4 | 5 | 5 |
| 02 | pages et modules d'analyse | `pages/` 10 996 lignes TS/TSX et 2 831 CSS, `components/ui/` 1 365 | 26 | 7 | 12 | 5 | 6 | 3 |
| 03 | hooks | 51 fichiers (9 194 lignes) ; tests 1 155 lignes non détaillés | 12 | 8 | 9 | 8 | 4 groupes | 3 |
| 04 | noyau | 41 fichiers (8 459 lignes) et 4 978 lignes de tests | 15 | 12 | 9 | 12 | 5 | 5 |
| 05 | domaines sportifs | 21 fichiers (6 095 lignes), 4 574 lignes de tests, environ 2 000 de contexte | 10 | 9 | 10 | 8 | 6 | 7 |
| 06 | enregistrement, plateforme, mémoire | 48 fichiers (9 967 lignes), 5 862 lignes de tests | 13 | 9 | 9 | 9 | 2 fonctions, 43 exports, 4 restes | 5 |
| 07 | planification, cartes, outils | 47 fichiers en entier, 14 en partie (environ 7 500 lignes) | 12 | 10 | 7 | 7 | 1 fonction, 37 exports | 5 |
| 08 | transverse, thème, tests | 459 fichiers de `src/` par script (84 679 lignes), une soixantaine à la main | 12 | 4 | 13 | 8 | 6 | 5 |
| Total brut | | environ 80 000 lignes lues à la main, recouvrements compris ; tout `src/` parcouru par script | 113 | 69 | 78 | 61 | | 38 |
| Après synthèse | | | environ 70 | environ 45 | environ 40 | 60 bogues (A6, B5, C20, D29) | annexe | 18 questions, 15 points tranchés |

**Mesures** (sur 54 000 points, 3 h à 5 Hz, PC ; compter 3 à 5 fois plus au téléphone)

| Mesure | Avant | Après (prototype ou attendu) | Lot |
|---|---|---|---|
| Ouverture d'une session de voile avec Doppler, noyau seul | environ 600 ms | environ 200 ms | 56 |
| Médiane glissante (3 s / 5 s) | 65 / 138 ms | 7 / 9 ms, 0 écart | 56 |
| Meilleurs segments, 7 cibles de la voile | 129 à 193 ms | 27 ms, 0 écart | 56 |
| Meilleurs segments, 9 cibles du vélo | 161 ms | à relever | 56 |
| Lecture des dates | 32 ms par passage, 4 à 5 passages | 1 passage (environ 100 ms gagnés) | 56 |
| Unité du Doppler | 66 ms, 3 fois | 2 fois | 56 |
| `referenceSpeedMs` / `samplingIntervalS` | 75 / 22 ms | environ 25 / 5 ms (estimé) | 56 |
| Revêtement d'une session (500 morceaux) | 74 ms | à relever | 56 |
| Cran du seuil en voile (après lot 30) | 142 + 2 ms | part du vent près de zéro, 40 à 100 ms gagnés (estimé) | 58 |
| Couches de la trace colorée sur la carte | 54 000 (11 000 à 1 Hz) | 1 | 73 |
| Fusion des traits de même couleur seule | 54 000 | 42 400 (insuffisant) | écarté |
| Taille d'une fiche type | 55 558 octets | 25 802 (× 2,15) | 80 |
| Cartes Leaflet vivantes après défilement de 150 sessions | 150 | le nombre visible ou 0 | 74 |
| Temps estimé à vélo, 100 km | 21 ms | à relever | 56 |

**Lignes récupérables** (estimation de la synthèse, à confirmer lot par lot) : coquille des analyses 450 à 550 ; reste des pages 250 à 300 ; graphes (15 squelettes) environ 250 ; hooks (cache par session, table des réglages, abonnés) 300 à 400 ; noyau et domaines (recherche, angles, médiane, énergie, profils, podiums) 250 à 350 ; fiche de session (table des champs) 100 à 150 ; CSS environ 150 ; fixtures de test 300 à 500 ; banc environ 2 000. Total : environ 2 000 à 2 650 lignes dans `src/` et 2 000 dans `outils/banc/`.

## Annexe

**Petites choses, rattachées au lot qui les croise**
- INVENTAIRE.md:218 cite encore `SurfSpanLayer.tsx` (renommé `TrackSpanLayer.tsx`, que la ligne 233 décrit déjà) : à retirer à la prochaine passe `doc`.
- Écarts de fond de la documentation, pour la passe `doc` après le lot 71 : `INVENTAIRE.md:11` (« `core/` … sans notion de sport »), `INVENTAIRE.md:118` (« `planning/` … logique pure » alors que `brouter.ts` écrit dans le stockage), ETAT §3 (table des dépendances : `platform/` importe le noyau), tests de `geocoding.ts` rangés ailleurs ; puis les fichiers nouveaux (`src/test/*.fixture.ts`, `core/angles.ts`, `core/geo.ts`, `core/calendar.ts`, `core/xml.ts`, `components/chartStyle.ts`, `components/TrackChart.tsx`, `src/settings/`).
- `README` des scripts du banc : ligne « Scripts à revoir » de LISEZMOI (lots 53, 76).
- Exports superflus : environ 450 (surtout des types et des constantes), sans effet sur le paquet ; jamais de lot pour eux, retirer le mot `export` au passage dans un fichier touché. Listes des rapports, à titre d'exemple : `getHoveredIndex`, `hrMaxOriginLabel`, `DurationField`, `readMapBase`, `tileCapMb`, `analysisPath`, `sessionFamily`, `findLibrarySession`, `SAILING_UNITS`…`SURF_UNITS`, `isTerrainStep`, `computeTotalTimeMs`, `detectDeviceSpeedUnit`, les internes de `core/pumping.ts`, `msToPace`, `createMemoryFile`, `MOTION_DIR`, `readGear`, `STATS_METRICS`, `BROUTER_URL`, `PAVED_SURFACES`, `OVERPASS_URL`… Les façades réservées aux tests (`medianFilterByTime`, `clampByAcceleration`, `detourSpikes`, `analyzeManeuvers`, `measureManeuver`) et au banc (`imuCaptureStats`, `IMU_VERSION`, `PHONE_STREAMS`) restent : les marquer d'un commentaire.
- Types exportés jamais importés (26 dans `hooks/`, une trentaine dans `core/`) : signatures publiques, à laisser.
- `RATINGS[].emoji` (`sailing/sessionNotes.ts:85-89`) : déjà le n° 41 du reste à faire.
- Flèches `▲ ▼` (`FlightPumpingPanel.tsx:152`, `SailingModule.tsx:858`) et `↺` (`ResizablePanel.tsx:180`) : caractères typographiques, remplaçables par des icônes de `icons.tsx` au lot 77 si le temps le permet.
- `useOpenSections` et `useStoredRecord` reposent sur « `defaults` est une constante de module chez tous les appelants » (`useOpenSections.ts:23`, `useStoredRecord.ts:55`), invariant non vérifié : un test ou une assertion de développement au lot 66.
- `CARD_STYLE.padding: '15px'` (`components/styles.ts:5`) hors de l'échelle 4/8/12/16 : laissé (changer le rembourrage changerait l'écran).
- `TRACK_COLOR_SMOOTHING_S` (`core/trackColor.ts:19-26`) hors du profil : décision d'affichage, laissée.
- `gpxParser.ts:84` (`speed > 100` avant la détection d'unité) : sans conséquence aujourd'hui, à noter au lot 81 si un fichier en km/h dépasse 100 km/h.
- `LiveStats.climbRateMh` en m/h dans un calcul (`recording/liveStats.ts:96, 480`) : règle 1 au sens large, pour le fork.
- `recording/beepSound.ts` est un réglage d'interface : pour le fork.
- Deux générateurs pseudo-aléatoires (`core/patternTiles.ts:60-63`, `core/rootPath.ts:121-130`) : laissés (dessins différents).
- `intervalStepAt` déroule deux fois les phases (`recording/intervalTimer.ts:452-457`), une lecture Preferences par clé au démarrage (`platform/storage.ts:158-161`) : sans conséquence.
- Cadence par autocorrélation (`running/cadence.ts:236-268`, environ 94 M d'opérations par heure, une fois à l'arrêt) : rien à faire tant qu'aucune attente n'est ressentie.
- `noUncheckedIndexedAccess` : pour le fork.
- 689 `style={{…}}` et 395 longueurs en px dans les `.tsx` (dont `MuscuModule.tsx`, écran récent : 17 longueurs, 3 couleurs, 20 styles en ligne, contraire à « jamais une valeur en dur dans un écran neuf ») : migration au passage ; `MuscuModule` au lot 64.
- 15 sélecteurs `:has()` en CSS : rien à faire sauf mesure contraire au banc.

**Écartés**
- Table de 256 couleurs précalculées pour la trace (04-B9) : arrondirait des composantes, contraire au « dégradé continu » au pixel près.
- Fabrique générique navigateur/téléphone pour `platform/` (06-A13) : gain presque nul selon le rapport lui-même ; un objet par implémentation, au fork.
- Fusion des règles d'`observeTurns` et de la détection des manœuvres : écartée au lot 30 (règles divergentes) ; seul le balayage brut se partage (lot 58).
- Lot pour les exports superflus : non (voir plus haut).

## Sources

Les huit rapports d'audit du 28/10 et les bancs jetables de l'agent 04 sont gardés tels quels dans `docs/backlog/52-audit/` (2 745 lignes) : un lot qui touche une zone relit d'abord le rapport de cette zone, qui porte toutes les lignes de code et les mesures. Le dossier se supprime à la clôture du n° 52.
- `01-graphes-composants.md` (450 lignes), `02-pages-modules.md` (389), `03-hooks.md` (342), `04-core.md` (326), `05-domaines-sportifs.md` (325), `06-enregistrement-plateforme-memoire.md` (342), `07-planification-cartes-outils.md` (322), `08-transverse-theme-tests-qualite.md` (249).
- Bancs jetables de l'agent 04 (médiane, meilleurs segments, comparaison exacte) : `bench.ts`, `bench2.ts`, `bench3.ts`, imports en chemin absolu vers `src/core/`, hors de `tsconfig` et des tests ; à relancer aux lots 56 et 58 (`npx tsx` ou compilation esbuild jetable) pour les relevés « avant » et « après ».

Les identifiants « 04-B1 », « 06-D4 »… renvoient à la section et au numéro de chaque constat dans son rapport (A doublons, B optimisations, C architecture, D bogues, E code mort, F ou H questions).
