# 203 · Graphes : au zoom jusqu'au bout, un arrondi peut masquer la lecture de la dernière ligne

Noté le 07/11, déduit du calcul, sans effet observé. Modèle | Réflexion : Sonnet | medium. Petit, commun aux deux versions : à faire avant le fork.

## Le défaut présumé

- `src/core/chartZoom.ts`, `clampRange(range, full, minSpan)` : quand la plage demandée touche la fin, `min = full.max - span` puis `max = min + span`. En virgule flottante, `(full.max - span) + span` n'est pas toujours égal à `full.max` : `max` peut tomber un ulp **sous** `full.max`.
- `src/components/chartHover.ts`, `inChartView(view, value)` : `value >= view.min && value <= view.max`. La dernière ligne d'un graphe a `value = full.max` (dernier point de la trace, dernier kilomètre d'un profil) : avec le `max` arrondi en dessous, elle n'est plus « dans la vue » et sa lecture (infobulle, repère sur la carte) disparaît, alors qu'elle est affichée au bord droit.
- Même mécanique possible au début si `center - span / 2` arrondit au-dessus de `full.min` : à examiner, mais `Math.max(full.min, …)` rend `full.min` exactement dès que la borne est atteinte.
- Lecteurs de `clampRange` : `zoomViewOf` (`hooks/useChartZoom.ts`), les fonctions de glisser et de pincer plus bas dans `chartZoom.ts`. Lecteurs d'`inChartView` : `FitnessTestPanel`, `HeartRatePanel`, `IntervalAnalysis`, `JumpsPanel`, `routeProfileChart` (analyses et itinéraires compris).

## Voulu

1. **Prouver d'abord** : un test dans `src/core/chartZoom.test.ts` qui cherche (boucle sur des valeurs décimales simples, par exemple `full = {min: 0, max: k/10}` et `span = j/10`, ou sur des valeurs aléatoires à graine) un couple où `clampRange` rend `max < full.max` quand la plage demandée touche la fin ; figer le couple trouvé en cas de test. Si aucun couple n'existe en un million d'essais, le dire dans le rapport : le lot se réduit alors au point 3 et le défaut est écarté.
2. **Corriger à la source** : dans `clampRange`, quand `min` a été ramené à `full.max - span` (fin atteinte), rendre `max = full.max` exactement ; symétriquement `min = full.min` exact au début (déjà le cas). `sameRange` et les plages rangées ne changent pas de forme.
3. **Ceinture** : `inChartView` tolère un écart relatif infime (par exemple `1e-9 × (view.max - view.min)`) aux deux bornes, avec un test dans `src/components/chartHover.test.ts` (valeur à un ulp hors de la vue acceptée, valeur franchement hors de la vue refusée).
4. Aucun changement visible ailleurs : les tests existants de `chartZoom.test.ts` (9) et `chartHover.test.ts` (5) passent tels quels ou avec une correction justifiée dans le rapport.

## Banc

Neutre : l'orchestrateur rejoue `graphes` et `zoom-carte` avant et après, relevés identiques attendus.

## Vérification

`node outils/verif.mjs --rapide`. Version à augmenter par l'orchestrateur.
