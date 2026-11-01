# 114 · Fluidité au téléphone : mesurer d'abord

Brief écrit le 01/11 (paquet de 5 du 01/11 : 119, 120, 112, 114, 121). Modèle | Réflexion : Fable | high. Ce lot **mesure** et ne change rien dans `src/` : il livre un script du banc, ses relevés, et un diagnostic. Le passage dans un worker, s'il s'impose, sera un lot à part, écrit d'après ces chiffres (décision de l'orchestrateur du 01/11 : un lot qui touche `hooks/useSessionLibrary.ts` attend le découpage n° 113, qui attend lui-même la validation du 116).

## Le fait

Les calculs lourds tournent sur le fil de l'affichage : lecture du GPX (`core/gpxParser.ts`, `DOMParser`), `computeKinematics`, manœuvres et vent, résumés de `queueOutdatedRefresh` (`hooks/useSessionLibrary.ts`). L'audit du 01/11 situe le coût surtout dans la lecture du GPX (1,3 s sur 1,6 s pour 3 h à 5 Hz sur PC, HISTORIQUE n° 197). D'autres coûts relevés : zoom d'un graphe à pied (500 ms de script sur une course de 2 h avec cardio, n° 204), démarrage (`useSessionLibrary` chargé d'emblée par `App.tsx` et `Home.tsx`, puis `preloadPages` qui évalue toutes les pages et leurs graphes pendant les temps morts), seuil d'activité changé en voile (vent, classement et VMG refaits : 0,14 s sur PC pour 54 000 points).

## À faire

1. **Un script `outils/banc/fluidite.mjs`**, inscrit dans `scripts.mjs` (`sansCache`, `solo` si les minuteries l'exigent, `delaiMin` adapté), sur le modèle de `carte-perf.mjs` (métriques `Performance.getMetrics`, tâches longues) et de `vignettes-relance.mjs` (processeur ralenti par `Emulation.setCPUThrottlingRate`, rate 6, comme un Android moyen). Chaque mesure est prise **à vitesse normale puis ralentie ×6**, trois fois, médiane retenue. Mesures :
   - ouverture d'une longue session voile (la trace de `make-gpx.mjs`, 3 h à 5 Hz, ou une plus longue si le script sait la fabriquer) : temps jusqu'au titre, jusqu'à la trace sur la carte, jusqu'aux chiffres de « général » ; durée de la plus longue tâche bloquante et total bloqué (tâches de plus de 50 ms), part de la lecture du GPX ;
   - mise à jour des résumés : une bibliothèque d'une trentaine de sessions dont les résumés sont périmés (`SUMMARY_CALC_VERSION` antérieur dans les fiches, ou le chemin que `queueOutdatedRefresh` emprunte), temps total, plus longue tâche, et si la page répond pendant ce temps (un clic ou un défilement mesuré) ;
   - zoom d'un graphe à pied, course de 2 h avec cardio (`zoom-carte.mjs` fait déjà le geste : le reprendre, pas le recopier) : script par geste, images par seconde ;
   - démarrage : du chargement de `/` à l'accueil interactif, avec ce que `preloadPages` ajoute (le mesurer avec et sans, par exemple en le neutralisant depuis le script si c'est possible sans toucher `src/`, sinon le dire) ;
   - seuil d'activité changé en voile : durée du recalcul et de la plus longue tâche.
2. **Un diagnostic**, dans le rapport et dans la section « Relevés » de ce fichier : tableau des mesures (PC ×1, ×6), où le temps part (profil CPU de `Profiler.start`/`stop` ou tâches longues, par fonction), et une réponse nette à la question : **l'écran fige-t-il nettement au téléphone ?** Règle de décision posée par l'orchestrateur : oui si, à ×6, une tâche bloque plus d'une seconde, ou si le fil est bloqué plus de deux secondes en tout sur l'ouverture d'une session ou sur une mise à jour des résumés. Puis, pour chaque poste, ce qu'un lot suivant gagnerait et à quel prix : worker (lecture et résumés ; `DOMParser` absent d'un worker : un lecteur sans lui, règle 8, à chiffrer en effort et en risque), découpage en tranches (`requestIdleCallback`, `scheduler.yield`), mémoïsation, chargement différé de `useSessionLibrary` et de `preloadPages`. Ordonnés par gain sur effort.

## Vérifications

`npm run lint` (le script est dans `outils/`, hors de `src/`) ; le script tourne de bout en bout par `node outils/banc/passe.mjs fluidite` et par son appel direct ; `LISEZMOI.md` du banc reçoit sa ligne dans la liste des scripts. Rien à comparer avant et après : rien de `src/` ne change.

Lire avant : `outils/banc/LISEZMOI.md` (« Lanceur », « Pièges du poste », les lignes de `carte-perf`, `vignettes-relance`, `zoom-carte`, `bench`), `outils/banc/scripts.mjs`, HISTORIQUE n° 197 et 204 (par recherche), ETAT §2 (pipeline) et §6 (persistance, résumés).

## Ce que le lot ne fait pas

Pas de commit, pas de version, rien dans `src/` ni `android/`, aucune décision de l'utilisateur. Ne pas modifier `vignettes-relance.mjs` (lot 121 en parallèle peut l'étendre) ; `scripts.mjs` et `LISEZMOI.md` reçoivent une ligne chacun, rien de plus. Rien dans `docs/` hors ce fichier.

## Relevés

Relevés du 01/11 par `outils/banc/fluidite.mjs` (appel direct, serveur de développement sur 4291, Chrome sans fenêtre, profil neuf ; trois prises, médiane ; « ×6 » = `Emulation.setCPUThrottlingRate` à 6, un Android moyen). Durées depuis le geste ; « tâche max » = la plus longue tâche de plus de 50 ms (API Long Tasks), « bloqué » = leur somme sur la fenêtre. La voile longue : 54 750 points à 5 Hz, 3 h, 7,1 Mo, le motif de `make-gpx.mjs` ; les 30 sessions : voile d'une heure à 1 Hz ; la course : 2 h à 1 Hz avec FC et altitude.

### Tableau des médianes (PC)

| Mesure | ×1 | ×6 |
|---|---|---|
| Ouverture voile 3 h 5 Hz, depuis la bibliothèque (navigation dans la page), onglets par défaut : titre / trace / chiffres de « général » | 0,020 s / 1,61 s / 1,61 s | 0,21 s / 17,7 s / 17,7 s (prises : 13,2 ; 17,7 ; 22,0) |
| Ouverture : tâche max / bloqué / fil libre à | 0,79 s / 1,54 s (2 tâches) / 1,57 s | 9,4 s / 17,6 s (5) / 18,2 s |
| Ouverture : `DOMParser.parseFromString` seul | 0,60 s | 5,2 s |
| Ouverture, version compilée (`vite preview`, même profil de mesure) : chiffres / tâche max / bloqué / DOMParser | 1,33 s / 0,77 s / 1,29 s / 0,57 s | 10,7 s / 6,6 s / 10,5 s / 4,9 s |
| Seuil d'activité changé (onglets général, tops, manœuvres, graphiques, vent, vmg, réglages ouverts) : chiffres refaits / tâche max / bloqué | 0,23 s / 0,27 s / 0,44 s | 1,2 s / 0,60 s / 1,2 s (pire prise : 1,8 s de tâche) |
| Zoom d'un graphe de la course de 2 h (double-clic, graphiques et cardio ouverts, 5 graphes) : script / images par seconde / image la plus longue / tâche max | 0,30 s / 50 / 0,28 s / 0,28 s | 3,4 s / 6 / 3,4 s / 1,0 s |
| Résumés de 30 sessions refaits au lancement (fiches en version antérieure, cache effacé), sur l'accueil : total / tâche max / bloqué | 3,4 s / 0,13 s / 2,2 s (30 tâches) | 22,9 s / 0,72 s / 17,4 s (43) |
| Résumés : latence d'un mouvement de souris pendant ce temps, médiane / max | 0,022 s / 0,09 s | 0,31 s / 0,51 s |
| Démarrage (serveur de développement, 33 sessions, cache à jour) avec préchargement : accueil rendu / interactif / tâche max / modules | 0,24 s / 0,24 s / 0 / 434 | 0,92 s / 1,9 s / 0,23 s / 434 |
| Démarrage sans préchargement (`requestIdleCallback` neutralisé) | 0,23 s / 0,23 s / 0 / 188 | 1,1 s / 1,1 s / 0,21 s / 188 |
| Démarrage, version compilée, avec préchargement | 0,10 s / 0,10 s / 0 / 70 | 0,28 s / 0,28 s / 0,07 s / 70 |
| Démarrage, version compilée, sans préchargement | 0,09 s / 0,09 s / 0 / 11 | 0,28 s / 0,28 s / 0,07 s / 11 |

### Où le temps part (profil du processeur, `Profiler.start`, prise à part)

- Ouverture de la voile longue, ×1 (1,99 s mesurés) : `parseGpx` 41 % inclus, dont `parseFromString` 30 % (temps propre : 0,60 s) et le parcours du DOM (`pointFieldNodes`, `getAttribute`, `textOf`, `numberOf`) 8 à 10 % ; `estimateWind` 10 % ; `computeKinematics` 7 % ; `(program)` et ramasse-miettes 19 % (7 Mo de texte et 55 000 nœuds DOM à libérer). À ×6 (10,4 s) : `parseGpx` 48 %, `parseFromString` 27 %, `estimateWind` 10 %, `classifyManeuvers`, `referenceOf`, `angleDiff`, `median` 2 à 3 % chacun. L'ouverture tient en deux tâches à ×1 : 0,79 s (lecture et cinématique) puis 0,75 s (manœuvres, vent, rendu) ; à ×6 la première dure 6,6 à 13,5 s.
- Résumés de 30 sessions, ×1 (2,89 s mesurés) : `analyzeGpx` 67 % inclus, dont `parseGpx` 58 % et `parseFromString` 44 % ; `summarizeSession` 9 % ; `computeKinematics` 5 %. Un résumé = une tâche de 0,07 à 0,13 s à ×1, 0,4 à 0,9 s à ×6, trente fois de suite, sans répit : la page répond, mais avec 0,3 s de retard en médiane.
- Zoom d'un graphe : tout est rendu (Recharts, 5 graphes de 7 200 points redessinés) ; à ×6 l'image reste figée 3,4 s pour une tâche de 1,0 s (style, mise en page et peinture suivent la tâche).
- Démarrage : sur le serveur de développement, le préchargement charge 246 modules de plus et retarde l'interactivité de 0,8 s à ×6, en tâches de 0,2 s ; en version compilée (la seule qui compte pour l'APK), accueil en 0,28 s à ×6 et préchargement invisible (une tâche de 65 ms). `useSessionLibrary` chargé d'emblée ne se voit pas non plus.

### L'écran fige-t-il nettement au téléphone ?

**Oui**, par la règle du brief (à ×6 : une tâche de plus d'une seconde, ou plus de deux secondes bloquées en tout sur l'ouverture d'une session ou une mise à jour des résumés) :

- ouverture d'une longue session : une tâche de 6,6 à 13,5 s, 10 à 18 s bloquées en tout ; l'écran est figé du clic jusqu'aux chiffres, et la lecture du GPX par `DOMParser` en est à elle seule la moitié ;
- résumés refaits après une mise à jour : aucune tâche au-dessus d'une seconde (0,7 s), mais 17 s bloquées sur 23, par petites tâches enchaînées ; l'écran saccade (0,3 à 0,5 s de retard au doigt) sans figer franchement ;
- en plus, hors règle : le zoom d'un graphe de 2 h fige l'image 3,4 s à ×6 ; le seuil changé coûte 0,6 à 1,8 s, perceptible ; le démarrage ne pose aucun problème en version compilée.

### Gains possibles, par gain sur effort

1. **Décimer les points des graphes** à la largeur du tracé (un couple min-max par pixel, l'`index` de trace gardé pour `hoveredTrackIndex`) : 7 200 points → environ 800 par graphe. Gain fort sur le zoom (3,4 s d'image figée à ×6, et sans doute le pincement au doigt), effort moyen (pièces communes des graphes, `chartHover`, tests du min-max), risque faible (les pics restent par le min-max).
2. **Lecteur GPX sans `DOMParser`** (balayage du texte, règle 8 : pas de bibliothèque) : `parseFromString` plus le parcours du DOM font 40 à 55 % du temps de toute lecture, et 55 000 nœuds DOM de moins allègent le ramasse-miettes. Gain moyen à fort partout (ouverture, résumés, import), 2 à 3× sur la lecture ; effort moyen (`core/gpxParser.ts` et ses extensions : Doppler, FC, cadence, `timedPoints`, `trk/type`, `metadata`, bloc de `sessionBundle` ; preuve par un test d'égalité résultat à résultat contre l'ancien lecteur sur les traces du banc et les fixtures) ; risque moyen (espaces de noms, CDATA, entités, ordre des balises). C'est aussi le prérequis du worker, qui n'a pas de `DOMParser`.
3. **Worker pour la lecture, la cinématique et les résumés** (après le découpage 113 et la validation du 116, décision de l'orchestrateur) : la seule voie vers « ne fige pas » sur l'ouverture ; les résumés en arrière-plan n'enlèveraient plus rien au fil. Gain décisif (tâche max de 6 à 13 s → le rendu seul, de l'ordre de la seconde à ×6), effort élevé (chaîne `useGpxSession` → `useSailingSession` à couper en deux, manœuvres et vent à y passer aussi sinon la seconde tâche reste, transfert des tableaux typés, réglages à passer, double chemin navigateur et téléphone), risque moyen (deux copies du pipeline à tenir identiques ; se prouve au banc par texte identique). Sans le lecteur du point 2, impossible.
4. **Tranches** (`await scheduler.yield()` ou `setTimeout(0)`) entre lecture, cinématique, statistiques, manœuvres et vent : la première image (titre, carte) arrive plus tôt et la tâche max tombe de 6,6 à environ 5 s à ×6 (l'appel `parseFromString` reste atomique) ; gain faible sur le figement, effort faible, risque faible. Pour les résumés, déjà une trace à la fois : rien de plus à découper sans le point 2.
5. **Mémoïser le GPX lu** (texte et points) pour la dernière session ouverte : `loadSessionGpx` relit et refait tout à chaque ouverture ; gain seulement à la réouverture (retour arrière, changement d'activité), effort faible, risque faible (une seule session gardée).
6. **Seuil changé** : 0,6 s à ×6, tolérable ; suit le worker s'il vient. **Chargement différé de `useSessionLibrary` et de `preloadPages`** : rien à gagner en version compilée, à écarter.

Limites du relevé : ×6 sur ce PC n'est qu'une approximation du téléphone de l'utilisateur ; les prises à ×6 varient de ±30 % (ramasse-miettes) ; les onglets ouverts à l'ouverture sont ceux par défaut (général seul), les manœuvres et le vent se calculent quand même ; le serveur de développement sert 434 modules séparés, d'où la double mesure du démarrage sur la version compilée.
