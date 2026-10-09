# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Tracker : analyse de sessions sportives à partir de traces GPX

Application 100 % client (React 19, TypeScript, Vite 8, Recharts, Leaflet), sans backend. Modules voile (`/voile` : wingfoil, planche, kite, bateau), course (`/course`), vélo (`/velo`) et fractionné (`/fractionne`), ces trois derniers sur un module d'analyse commun (`LandModule`), pages `/enregistrer`, `/itineraires` et `/parametres`. Interface et commentaires en français. Application Android via Capacitor, avec enregistrement GPS natif et mémoire en dossier portable.

Chaque information a une seule place :
- `docs/ETAT_DU_PROJET.md` : pipeline, persistance, dette, chantiers, et **l'avancement du plan mobile (§12), tenu là seulement**. Le lire avant de toucher au noyau ou aux analyses voile.
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
- `CLAUDE.md` : seulement si une règle ou une décision de l'utilisateur a changé. Ni état d'avancement, ni procédure détaillée.

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
12. Stockage, fichiers, position, son, vibreur et capteurs : uniquement via `src/platform/` (`storage.ts`, `files.ts`, `memoryFolder.ts`, `location.ts`, `beeper.ts`, `motion.ts` ; jamais `localStorage`, `Filesystem`, `showDirectoryPicker`, `navigator.geolocation`, Web Audio, `navigator.vibrate` ni `DeviceMotionEvent` en direct). Chaque module y choisit sa version navigateur ou téléphone par `isNativeApp()`.

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
- Calcul pur : dans `core/`, `sailing/`, `running/`, `cycling/`, `planning/`, `recording/` ou `library/`, avec son `*.test.ts` sur trace synthétique.
- Couleur, police, rayon, espacement : une variable de `src/theme/tokens.css`, jamais une valeur en dur dans un écran neuf. Composants communs dans `components/ui`, icônes dans `components/icons.tsx` (pas d'emoji). Les couleurs de données des graphes et de la carte restent en dur (attributs SVG).

## Décisions de l'utilisateur

- Couleur de trace : dégradé continu sur une échelle absolue (`core/speedGradient.ts`), gris sous la borne basse, bornes réglables par support dans Réglages et par trace dans son analyse ; ni échelle relative ni paliers ; une seule coloration d'une session, la même dans son analyse et sa vignette (`core/trackColor.ts`), lissée sur 15 s à pied et à vélo, pas en voile. Course : 4 à 15 km/h ; vélo : 10 à 40 km/h. Voile : seuil d'activité et bornes suggérés par l'allure de la session, selon des règles fixées par l'utilisateur (`suggestActiveThresholdKn`, `suggestSpeedRangeMs` dans `sailing/sailingConfig.ts`, HISTORIQUE point 29) : ne pas les retoucher sans lui. Bornes effectives : celles de la trace (sa fiche, réglées dans l'onglet réglages de son analyse), sinon celles du support dans Réglages, sinon la suggestion ou le défaut ; la légende, compacte et posée sur la carte à gauche de la mention OSM, ne fait qu'afficher.
- Courbe du vent : toute la session, par toutes les manœuvres sans exception, valeur la plus proche aux bords, coupure au-delà de 30 min sans manœuvre.
- Une seule notion de réussite : le vent est estimé au seuil d'activité effectif, surcharge comprise (bouger le seuil recalcule le vent, c'est accepté).
- Session : vent saisi, seuil d'activité, allure imposée, couleurs de la trace, terrain (course, vélo) et notes restent en brouillon jusqu'à « Enregistrer la session » (Annuler, avertissement en quittant). Le seuil est propre à chaque session, dans sa fiche, et prime sur celui du support ; de même le terrain, dont Réglages donne celui par défaut de l'activité. Le support se change immédiatement.
- Graphes course « superposés » à deux axes, voulus malgré la difficulté de lecture. Courbe d'altitude et aire dessous colorées par la raideur de la pente, montée ou descente confondues, sur la palette de la trace, de 0 à 25 % par défaut (0 à 15 % à vélo), bornes réglables par activité dans Réglages. Graphes de vitesse et d'altitude (analyse et planification), de vitesse et du vent en voile (un zoom commun, axe en heure du jour), zoomables : pincer à deux doigts sur téléphone, tirer une zone à la souris sur ordinateur, « Tout voir » ; un doigt garde le survol, la souris qui quitte un graphe efface le repère.
- Vélo : famille propre, jamais un calcul rangé sous Course. Énergie : en course, Minetti à l'économie du coureur ; à vélo, modèle physique, type (pneus) et poids du vélo par activité, roulement selon le revêtement de chaque segment, Crr moyen du vélo là où il est inconnu ; le temps estimé des itinéraires garde le Crr moyen ; un seul profil « Pratiquant ». La puissance affichée est mécanique dans les deux (rendement 0,25 en course).
- Tout bloc est redimensionnable (`ResizablePanel`), taille mémorisée.
- Analyses sur ordinateur, même disposition en voile, course et vélo : carte en haut, centrée, plus étroite que la page (80 %) pour faire défiler la page à la souris à côté d'elle (la molette zoome toujours la carte) ; onglets dessous ; panneaux deux par ligne.
- Voile : manœuvres en petit tableau, détails dépliables. Une seule barre d'onglets : général, tops, manœuvres, graphiques, VMG, sauts (si la session a ses capteurs), vent, matos et conditions, réglages (dans cet ordre). « Général » porte les chiffres globaux (vitesse moyenne et moyenne active comprises) et le vent ; seul ouvert par défaut, il se replie pour comparer tableaux et carte. La course et le vélo ont aussi leur onglet « général » en tête, seul ouvert au départ avec « fractionné » quand il existe, et leurs graphes sous l'onglet « vitesse et altitude ». Les onglets ouverts sont ensuite mémorisés par module. Sur téléphone, l'en-tête des analyses tient sur une ligne au-dessus de la carte, onglets en petites pastilles. Ne rien déplacer ni dupliquer sans redemander.
- Manœuvres : gain au vent = chemin pendant la rotation, vers le vent au virement, sous le vent à l'empannage, le plus grand en tête ; pas de podium du changement de cap aux empannages ; pas de ligne « distance perdue ».
- Sauts en voile : mesurés par l'accéléromètre et le gyroscope du téléphone fixé au corps (« Mesurer les sauts » sur Enregistrer, Android seulement), réglés par activité dans Réglages (case « Sauts », emplacement, hauteur minimale ; pas en bateau). Toute la séance est enregistrée, puis élaguée à « Analyser » autour de ce qui ressemble à un saut. Hauteur du buste depuis son niveau au décollage, sur foil aussi. Onglet « sauts » entre VMG et vent, visible si la session a ses capteurs.
- Foil : case de toute activité de voile, bateau compris (cochée d'office en wingfoil), et valeur par session dans l'onglet réglages de l'analyse. Sur foil : « Ratio de vol », champs Foil et Mât ; elle ne touche ni au seuil d'activité ni à ses suggestions.
- Fractionné : une famille à part, de deux calculs, à pied (traité comme la course) et à vélo (comme le vélo) ; pause automatique coupée d'office, pas de planification.
  - Compteur d'intervalles dans Enregistrer : répétitions, travail, repos, séances gardées pour être reprises toutes faites ; avec ou sans enregistrement ; il suit l'horloge, et Android joue les sons écran éteint. Signaux : compte à rebours de 3 s, fin de chaque phase par court, court, long (le long finit au changement), fin de séance par court, long, long double, « Passer » par un long.
  - Analyse : onglet « fractionné » (synthèse, tableau avec une mini-courbe par répétition à la même échelle, évolution des répétitions, profil moyen). Sans compteur, en famille Fractionné seulement, les répétitions sont retrouvées dans la vitesse, avec un seuil d'effort tiré de la session et réglable par session.
- Activités : l'utilisateur crée les siennes (nom, couleur prise parmi les nuances de sa famille, calcul de base), au départ « Voile », « Course », à vélo « Route », « Gravel » et « VTT », en fractionné « Fractionné à pied » et « Fractionné vélo » ; elles seules sont proposées partout (Enregistrer, analyses, bibliothèque, accueil). Dans Réglages, rangées par famille. Une activité supprimée garde ses sessions, sous le nom de leur calcul.
- Enregistrement : brut à 1 Hz, sans autre filtre que les redélivrances et la pause (manuelle, par appui long de 2 s réglable sur le bouton rond, ou automatique sur immobilité, réglable par activité) ; un GPX par session, analysé par les modules existants via `loadGpxContent`. À l'arrêt, rien n'est rangé : « Analyser » range la session, « Jeter » l'abandonne ; d'ici là elle attend, journal gardé.
- Activité d'une session : celle de la trace suivie est proposée à l'enregistrement ; elle se change pendant l'enregistrement et dans l'onglet réglages de l'analyse, d'une famille à l'autre comprise (recalcul complet, la session change de module).
- Itinéraire tiré d'un GPX téléchargé : la trace est gardée telle quelle entre départ et arrivée (tronçons `imported`) ; seul un point déplacé en refait les tronçons.
- Altitude, en course et à vélo : celle du terrain (IGN, RGE ALTI) par défaut, rangée dans la fiche de la session, jamais dans le GPX ; un point tous les 5, 10 ou 20 m (10 d'office), réglé par activité ; « Altitude : IGN / GPS » par session, dans l'onglet réglages de l'analyse, appliqué tout de suite. Demandée à l'ouverture de l'analyse, jamais au balayage de la bibliothèque. Rien en voile.
- Surface : barre de revêtement à la Komoot (`planning/surface.ts`), en planification (voies rendues par BRouter) et dans l'onglet « surface » de Course et Vélo (voies d'Overpass, demandées à sa première ouverture, à vélo dès l'ouverture de l'analyse pour l'énergie, puis rangées dans la fiche). Ligne droite et GPX importé donnent « Inconnu » ; un itinéraire rangé sans revêtement propose « Calculer ». « Voir sur la carte », dans l'onglet, colore la trace par revêtement tant qu'il est ouvert. Rien en voile.
- Itinéraires planifiés : l'accueil montre les 3 derniers, sa carte mène à la liste complète (tris, onglets d'activité) ; Voile, Course et Vélo ont « Réalisées / Planifiées ». « Partir » ouvre Enregistrer, trace suivie et activité choisies, sans démarrer.
- Planification :
  - on coche un ou plusieurs types de voie (Sentier, Piste, Route, Grande route), pas le moyen de transport, par un profil BRouter maison ; les règles d'accès suivent l'activité (piéton ou vélo) ;
  - chaque activité coche d'office les siens, réglés dans sa carte de Réglages, sinon tirés du type de vélo ou du terrain ;
  - les cases valent pour tout l'itinéraire : les changer, directement ou en changeant d'activité, recalcule aussitôt chaque tronçon calculé (une trace importée ne bouge pas), « Précédent » rend cases et tracé ;
  - chaque voie est rangée selon ce qu'elle est (revêtement), pas sa seule étiquette OSM. À vélo, un type non coché plus facile reste permis et un plus dur est évité selon l'écart ; à pied, tous se valent ; une grande route non cochée est toujours évitée. Coûts fixés avec l'utilisateur (HISTORIQUE point 80) : ne pas les retoucher sans lui ;
  - l'activité (liste par famille) et les types de voie se choisissent au-dessus de la carte ; dessous, des onglets comme dans les analyses (général, surface, tracé, points, enregistrer, mes itinéraires ; en voile parcours et balises), seul le premier ouvert par défaut ;
  - tracé et points intermédiaires toujours en bleu, quelle que soit l'activité, sauf le temps de « Voir sur la carte » du revêtement ; départ en vert, arrivée en rouge ;
  - temps estimé selon un niveau par activité (débutant à expert, ou vitesse personnalisée) : km-effort en course, modèle physique à vélo, rien en voile ;
  - mode « Boucle », bouton à bascule (course, vélo) : on pose l'aller, l'itinéraire reste bouclé, A reste le départ. Le retour évite les voies de l'aller sans dépasser 1,5 fois sa longueur (réglable par activité), sinon c'est le plus court, qu'on modèle en posant des points dessus ; « Autre retour » en donne une variante ; éteint, le retour est retiré. Jamais de boucle générée depuis une distance.
- Balises en voile : un itinéraire de voile est un parcours de balises numérotées, en ligne droite. En navigation, chaque balise, départ compris, se valide en passant près d'elle, dans l'ordre (« Passer » la saute). Bips de plus en plus rapides à l'approche, et vibration réglable, joués par Android écran éteint. La courbe des bips se règle par activité dans Réglages ; un parcours peut avoir la sienne, dans sa fiche, qui prime.
- Cartes hors ligne : chaque tuile vue en ligne est gardée sur l'appareil, sans bouton ni limite de durée (plafond et « Vider » dans Réglages) ; jamais de téléchargement de zone à l'avance, interdit par OSM.
- Mémoire : un dossier portable `Tracker/` (GPX + fiche JSON par session dans `sessions/`, un fichier de réglages par appareil dans `reglages/`), qu'on copie pour sauvegarder ou changer d'appareil ; pas d'index dans le dossier. Chaque appareil écrit le sien et ne prend jamais de lui-même ceux d'un autre : on choisit le fichier à reprendre (« Reprendre », Réglages › Mémoire) ; un fichier jamais vu est proposé une fois par un bandeau ; seul un appareil neuf reprend tout seul le plus récent. Sur le PC, l'utilisateur reste sur Firefox (mémoire du navigateur, sans dossier) : il y passe les réglages par « Importer un fichier de réglages ». « Mettre à jour » le relit sans relancer, dans la rangée des imports des bibliothèques et dans Réglages › Mémoire, avec « Ajouter les sessions d'un dossier ». Une session dont l'activité est inconnue la demande avant l'analyse. Sur Android, dossier désigné par le sélecteur d'Android (SAF), jamais « accès à tous les fichiers ». Suite de la cible mobile dans l'ordre fixé au §12 de l'état.
- DA de la maquette pour l'instant (Figtree, fond gris chaud, cartes blanches, vert Enregistrer), appelée à changer : tout passe par les variables. Une couleur par famille (bleu voile, rouge course, vert vélo, orange fractionné, gris gardé pour le surf), qui porte du texte blanc ; chaque activité prend une des six nuances de sa famille. Le bouton rond garde son vert et son rouge, le tracé de la planification son bleu. Mode daltonien prévu plus tard.
- Navigation : barre en haut sur ordinateur, avec toutes les destinations. Sur téléphone, une barre en bas de cinq cases, le bouton rond au milieu :
  - Accueil ;
  - le sport favori, choisi dans Réglages (voile par défaut) ;
  - le bouton rond ;
  - le sport secondaire, choisi dans Réglages et retenu ; un appui long (1 s par défaut, réglable) montre un grand cadran puis le menu des autres sports, et le sport choisi devient le secondaire ;
  - Réglages.
- Réglages d'affichage (unités de vitesse et de distance) choisis dans Réglages seulement, par activité (donc par support : bateau et wing peuvent différer), actifs partout ; distance en km par défaut, milles nautiques au choix. Pas de réglage de la taille du texte : retiré le 09/10, jugé inutile. La pause automatique, les chiffres de la carte réduite à l'enregistrement (quatre au plus), le terrain par défaut des sessions, le type et le poids du vélo, le niveau du temps estimé et les types de voie cochés d'office se règlent aussi par activité, dans sa carte de Réglages.
- Choix d'une activité : une liste dessinée par l'application (famille à gauche, activités décalées dessous, un trait entre familles), jamais le menu natif d'Android.
- Surbrillances sur la carte des analyses : une seule à la fois (top, podium de manœuvres, zone de pente, répétition, saut), effacée quand son onglet se ferme et pas ramenée à sa réouverture ; les virements et empannages de la voile restent des cases à part, cumulables. Podiums aux couleurs rouge, orange, vert ; passage seul en violet.
- Analyses de course et de vélo : « Voir » d'une zone de pente la montre sur la carte, en violet. « Voir sur la carte », sous le graphe d'altitude, colore la trace par la pente (couleurs et bornes de la courbe), et de même en planification sous le graphe du dénivelé ; pente et revêtement s'excluent. Énergie : puissance moyenne par zone de pente ; le tableau des zones se replie à sa place. Bibliothèques : vignette carte toujours affichée, à droite des chiffres de chaque session.
- Diffusion : APK signé partagé par lien d'abord, lien web ensuite.
