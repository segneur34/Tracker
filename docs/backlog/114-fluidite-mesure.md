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
