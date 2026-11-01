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
