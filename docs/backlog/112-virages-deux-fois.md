# 112 · Virages écrits deux fois : un test qui compare, puis mise en commun sans changer un chiffre

Brief écrit le 01/11 (paquet de 5 du 01/11 : 119, 120, 112, 114, 121). Modèle | Réflexion : Fable | high. Plan par l'agent `Plan` d'abord. Le lot est **neutre** : aucun chiffre de vent, de manœuvre ni de classement ne change, ni dans les tests ni au banc. Un écart qui ne se résorbe pas sans changer un chiffre n'est pas résorbé : il est décrit dans le rapport, et l'orchestrateur le soumet à l'utilisateur.

## Le fait

La détection des manœuvres (`sailing/maneuvers.ts`, `prepareManeuverDetection` › `readWindow`, vers la ligne 1294) et l'orientation du vent (`sailing/wind.ts`, `observeTurns`, vers la ligne 489) ne partagent que le balayage de la fenêtre (`scanTurnWindow`). Le reste est écrit deux fois, avec de petits écarts, dont certains voulus (HISTORIQUE, points 21, 70 et 193 ; ETAT §9 « `observeTurns` non fusionné » et « Orientation fragile »). Écarts relevés le 01/11, à vérifier :

| Règle | `readWindow` (manœuvres) | `observeTurns` (vent) |
|---|---|---|
| Vitesse d'entrée | `points[i].smoothedSpeed > minEntrySpeedKn` (strict), 4 nd par défaut, surchargeable | `>= minEntrySpeedKn`, 5 nd par défaut (`WIND_ESTIMATION_MIN_SPEED_KN`), passé par le hook |
| Point le plus lent de la fenêtre initiale | de `i` à `j - 1` (omet le dernier point, voulu : points 21 et 70) | de `i` à `j` (le dernier point compris) |
| Cohérence minimale | `minCoherence`, 0,5 par défaut, surchargeable | `TURN_MIN_COHERENCE` = 0,6 |
| Fenêtre trop courte | rejet si `t(j) - t(i) < windowMs * 0.5` (seuil en dur) | pas de garde-fou |
| Déplacement minimal | 10 m (`minDistanceM`) | aucun |
| Prolongation du virage | par pas d'au moins `TURN_STRIDE_MIN_S`, jusqu'à `2 * windowMs`, point le plus lent suivi sur tous les points du pas | identique, mot pour mot |
| Stabilité de sortie | aucune ici (le temps mort et le classement viennent après) | `EXIT_STABILITY_S` = 5 s, pas de plus de `EXIT_MAX_STEP_DEG` = 45° |
| Après un virage retenu | cache par `(i, lowest)`, temps mort au classement | `i = j + 1` |
| Seuils en dur hors profil | `windowMs * 0.5` (`maneuvers.ts`, vers la ligne 1329) | `total > 0.5` sur les votes (`wind.ts`, vers la ligne 645) |

## À faire, dans cet ordre

1. **Un test qui compare les virages vus des deux côtés** (`sailing/turnsAgreement.test.ts` ou dans `wind.test.ts`), sur les traces synthétiques déjà employées par `maneuvers.test.ts` et `wind.test.ts` (1 Hz et 5 Hz, bruit, pas unique d'un enregistreur économique, reprise de pause) : pour chaque trace, la liste des virages retenus par `observeTurns` (instant du point le plus lent, virage net) et celle des fenêtres `turn` de `prepareManeuverDetection` ; le test **fige** ce que chaque côté voit aujourd'hui (copie gelée, comme les tests de neutralité du point 193) et imprime, en cas d'écart entre les deux côtés, quelle règle du tableau l'explique. Il n'exige pas l'accord : il le mesure, et il garantit que la mise en commun ne change rien.
2. **Mettre en commun ce qui est identique** sans changer un chiffre : la prolongation du virage (boucle `strideEnd` / `isTurningStep` avec suivi du point le plus lent) et, si le plan le juge possible à l'identique, la recherche du point le plus lent avec un paramètre « dernier point compris ou non ». Une seule fonction dans `wind.ts` (où vit déjà `scanTurnWindow`), appelée des deux côtés avec ses options. Les écarts voulus restent des **options nommées**, pas des copies.
3. **Nommer les seuils écrits dans le calcul** (règle 3) : `windowMs * 0.5` et `total > 0.5` deviennent des constantes de `sailing/sailingConfig.ts` (nom, commentaire d'une ligne disant ce qu'elles bornent), même valeur ; pour `windowMs * 0.5`, une entrée de `DetectionSettings` surchargeable comme `minCoherence`, sans case dans Réglages.
4. **Rapport** : le tableau des écarts mis à jour (ceux qui restent, chacun avec « voulu, point N » ou « à soumettre : changer la règle changerait tel chiffre sur telle trace »), et le relevé du vent du banc (ETAT §9 « Orientation fragile » : toute retouche de la détection doit le refaire).

## Vérifications

Tests gelés de neutralité intacts ; `npm run verif` ; puis le banc, lancé par l'orchestrateur, avant et après : `general`, `bench`, `brouillon-voile`, `manoeuvres-diagnostic` (vent, manœuvres, classement : texte identique). Le lot ne lance pas le banc lui-même.

Lire avant : `CLAUDE.md` (règles 2, 3, 4, 7, 10), `docs/DECISIONS.md` §1, `docs/ETAT_DU_PROJET.md` §9 (points 6 et suivants sur `analyzeManeuvers`, et les limites « Manœuvres, suites de l'audit du point 70 »), HISTORIQUE points 21, 70, 185, 193 (par recherche), `docs/backlog/30-noyau-voile.md` (ce que le lot 30 a déjà tenté et pourquoi `observeTurns` n'a pas été fusionné).

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de l'utilisateur : aucun écart voulu n'est résorbé, aucun seuil ne change de valeur. Ne pas fusionner `observeTurns` dans la détection commune (point 193 : les votes d'orientation changeraient). Ne pas toucher à `pages/SailingModule.tsx` (lot 120 en parallèle), à `outils/banc/` (lot 114), ni à la bibliothèque (lot 121). Rien dans `docs/` hors ce fichier.

## Questions tranchées par l'orchestrateur (01/11, au plan)

- m1 : le test de comparaison va dans `maneuvers.test.ts` (les générateurs y vivent), bloc « virages vus des deux côtés, lot 112 » ; `sessions()` sorti de son bloc sans changement.
- m2 : `slowestPoint` ne remplace la boucle d'`observeTurns` que si l'on prouve que `smoothedSpeed` n'est jamais NaN (`computeKinematics`, `trackToPointData`) ; sans preuve, `observeTurns` garde son départ à `points[i]` (la neutralité passe avant la mise en commun), et le rapport le dit.
- m3 : `2 * windowMs` nommé aussi, `TURN_EXTENSION_MAX_WINDOWS = 2`, constante seulement, même valeur.
- m4 : noms retenus : `slowestPoint`, `extendTurn`, `MANEUVER_MIN_WINDOW_SHARE` (option `minWindowShare`), `ORIENTATION_MIN_VOTE_WEIGHT`, `TURN_EXTENSION_MAX_WINDOWS`.
- m5 : l'ordre des rejets de `readWindow` reste tel quel.
- Les écarts que le test fera voir (dont le plancher de la polaire pris par `observeTurns` au lieu du seuil d'entrée des manœuvres) vont au rapport, « à soumettre », avec la trace et le chiffre qui changerait ; rien n'est résorbé dans ce lot.

## Plan (agent Plan, 01/11)

(1) Tableau du brief vérifié : vitesse d'entrée `maneuvers.ts`:1338 (`>` strict, défaut 4) et `wind.ts`:514 (`>=`, défaut 5) ; correction : la valeur d'`observeTurns` est le plancher de la polaire (`polarMinSpeedKn`, `useSailingSession.ts`:158, par `prepareWindPolar` puis `orientPolar`, `wind.ts`:697 et 643), soit min(plancher du profil, 0,2 × allure), alors que la détection prend min(4, 0,16 × allure). Point le plus lent : `maneuvers.ts`:1317-1324 part d'Infinity, de `i` à `j-1` ; `wind.ts`:501-508 part de `points[i]`, de `i+1` à `j` ; équivalents tant que `smoothedSpeed[i]` est fini. Cohérence : `maneuvers.ts`:1336 (`MANEUVER_MIN_COHERENCE`) et `wind.ts`:510 (`TURN_MIN_COHERENCE` vit dans `wind.ts`:374). Fenêtre trop courte : `maneuvers.ts`:1329 ; en fin de trace, `observeTurns` lit encore une fenêtre tronquée. Déplacement minimal : `maneuvers.ts`:1341. Prolongation : mot pour mot, `maneuvers.ts`:1348-1361 et `wind.ts`:520-533 ; seule différence, d'où vient `windowMs` (`settings.windowMs` contre `ORIENTATION_WINDOW_S` = 12). Stabilité de sortie : `wind.ts`:539-548. Après un virage retenu : cache par fenêtre puis par (i, lowest) (`maneuvers.ts`:1298-1302, 1459-1477) ; `i = j + 1` à `wind.ts`:560. Seuils en dur : `maneuvers.ts`:1329, `wind.ts`:645, et un troisième, `2 * windowMs` (1351 et 523). Trois règles identiques des deux côtés : virage minimal 60° en `>` strict, fenêtre de 12 s, pas unique `MANEUVER_MAX_STEP_S` ; seule la détection les rend surchargeables.

(2) Mise en commun, dans `wind.ts`, à côté de `scanTurnWindow` : `slowestPoint(points, from, to, includeLast): { index; speed }` (départ à Infinity et index `from`, boucle de `from` à `includeLast ? to : to - 1`, `<` strict, le premier minimum l'emporte) ; la détection l'appelle avec `includeLast` à faux (points 21 et 70), c'est son code exact, `j === i` compris ; `observeTurns` avec vrai sous la réserve m2. `extendTurn(points, i, from: { j; cumulativeTurn; slowest }, windowMs)` : la boucle `strideEnd` / `isTurningStep` telle quelle, `n - 1` devenant `points.length - 1`. `TurnObservation` inchangé.

(3) Test, dans `maneuvers.test.ts` : `sessions()` (l. 1793) sorti de son bloc, complété de `buildNoisySession` à 1 et 5 Hz sur les graines 1, 2 et 3 pour `GOOD_TACKS` et `GOOD_JIBES`, `SCENARIOS` à 1 et 5 Hz, `buildLegSession`, `buildSparseTurnTrack(22)` (pas unique) et `buildSparseTurnTrack(22, true)` (reprise de pause), `buildSilentUTurns(6)`. Deux copies gelées collées dans le test : `frozenObserveTurns` (rend aussi i, j, `minIndex`) et `frozenReadWindow` (réglages résolus par défaut). Neutralité : `observeTurns(points, v)` égal à la copie pour v = 2 et 5 ; `detection.windowAt(i)` égal à la copie pour tout i. Accord : virages du vent (instant du point le plus lent, virage net) et fenêtres `turn` regroupées par `anchorIndex`, appariés par l'instant du point le plus lent à moins d'une fenêtre ; chaque virage seul d'un côté reçoit la règle qui l'explique (entrée entre les deux seuils, cohérence entre 0,5 et 0,6, fenêtre courte, moins de 10 m, sortie instable, dernier point le plus lent), imprimée en cas d'écart ; comptes par trace figés en littéral au premier passage. Le test n'exige pas l'accord.

(4) `sailingConfig.ts` : `MANEUVER_MIN_WINDOW_SHARE = 0.5` après `MANEUVER_WINDOW_S` (« part de la fenêtre d'observation sous laquelle rien n'est observable (fin de trace, coupure) »), option `minWindowShare` dans `ManeuverOptions`, le `Pick` de `ManeuverDetectionOptions`, `DetectionSettings`, `resolveDetectionSettings` ; la vérification de `detectionFor` (`maneuvers.ts`:390) le couvre. `ORIENTATION_MIN_VOTE_WEIGHT = 0.5` après `ORIENTATION_MAX_CONSERVATION` (« poids total des votes des virages sous lequel ils ne tranchent pas l'orientation »). `TURN_EXTENSION_MAX_WINDOWS = 2`.

(5) Étapes : 1. relevé avant, dans le brouillon : JSON des `ManeuverStats` et d'`estimateWind` de toutes les `sessions()` (script jetable comme au lot 30) ; 2. `sessions()` sorti, copies gelées et test de comparaison, littéraux relevés, le test passe sur le code non retouché ; 3. `slowestPoint` et `extendTurn` branchés des deux côtés, `vitest run --changed` ; 4. constantes et `minWindowShare`, deux tests calqués sur celui du lot 79 (l. 1851 : avec 0,5, JSON identique ; une détection préparée avec 0,4 refusée par `estimateWind`, comme l. 1847) ; 5. JSON après identique à l'octet au relevé avant, `npm run verif` ; le banc avant et après est lancé par l'orchestrateur (`general`, `bench`, `brouillon-voile`, `manoeuvres-diagnostic`) ; 6. rapport avec le tableau mis à jour. Fichiers : `sailing/wind.ts`, `sailing/maneuvers.ts`, `sailing/sailingConfig.ts`, `sailing/maneuvers.test.ts` ; `wind.test.ts` inchangé.

## Rapport du lot (01/11)

Neutralité prouvée : relevé JSON sur 31 traces synthétiques (`ManeuverStats` pour 5 vents, `estimateWind` à 2 jeux d'options, `observeTurns` à 3 seuils, `windowAt` et `turnAt` pour tout point) identique à l'octet avant et après ; tests gelés intacts ; banc `general`, `bench` identiques, `brouillon-voile` à des millisecondes près, `manoeuvres-diagnostic` identique (vent 4°, 24 manœuvres).

Tableau des écarts après le lot :

| Règle | Manœuvres | Vent | État |
|---|---|---|---|
| Vitesse d'entrée | `> minEntrySpeedKn` (4 ; hook min(4, 0,16 × allure)) | `>=` plancher de la polaire (min(profil, 0,2 × allure) ; 5 en wing) | **à soumettre** (Q53) : au seuil des manœuvres, le vent verrait 1 virage de plus sur « clairsemée » (entrée 4,7 nd) et sur « virements bruités 5 Hz graine 3 » ; votes d'orientation changés (point 193) |
| Point le plus lent | `slowestPoint(…, false)` | `slowestPoint(…, true)` | voulu, points 21 et 70 ; une fonction, option nommée |
| Cohérence | 0,5 surchargeable | 0,6 (`TURN_MIN_COHERENCE`) | voulu, point 185 ; **à soumettre** (Q53) côté vent : à 0,5 le vent compterait la chute de « virement raté chute » (1 → 2 virages) |
| Fenêtre trop courte | `MANEUVER_MIN_WINDOW_SHARE`, option `minWindowShare` | aucun garde-fou | aucun écart sur 31 traces (fin de trace tronquée seulement) |
| Déplacement minimal | 10 m | aucun | aucun écart sur 31 traces |
| Prolongation | `extendTurn` | `extendTurn` | mis en commun, `TURN_EXTENSION_MAX_WINDOWS` |
| Stabilité de sortie | aucune | 5 s, pas ≤ 45° | voulu côté vent (chutes) ; jamais déclenchée sur 31 traces |
| Après un virage retenu | cache (i, lowest), temps mort au classement | `i = j + 1` | voulu, point 193 ; écart dominant de la mesure (134 virages « enjambés » sur 31 traces), absorbé par le temps mort du classement |
| Seuils en dur | nommés | nommé | fait, même valeur |

Accord mesuré (test `TURNS_AGREEMENT`) : chaque virage du vent est apparié à une fenêtre de la détection sur les 31 traces ; 15 traces en accord parfait ; les fenêtres sans virage côté vent sont 134 enjambées, 3 doublons, 2 entrées entre les seuils, 2 cohérences entre 0,5 et 0,6.
