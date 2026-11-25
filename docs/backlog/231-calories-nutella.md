# 231 · Profil : calories de la période, en pots de pâte à tartiner

## Tel que noté

25/11/2026 : « plus là-dedans aussi avoir les calories consommées cette semaine ou sur la période regarder et le mettre en équivalent pot de Nutella par exemple » (lu : « la période regardée »)

## Aujourd'hui (vérifié le 25/11)

- Profil ne montre aucune calorie. La période de la page (semaine, 30 jours, 6 mois, année, depuis le début) convient telle quelle.
- L'énergie n'est calculée qu'à l'ouverture d'une analyse, jamais rangée dans le résumé de la session :
  - à pied et en marche : `src/running/energy.ts` (Minetti, Pandolf), demande le poids ;
  - à vélo : `src/cycling/energy.ts`, demande le poids ;
  - voile et surf : estimation par la FC (`src/core/hrEnergy.ts`, Keytel), avec la ceinture seulement, à 25 % près.
- Dans le résumé (`src/library/record.ts`) : l'histogramme de FC (`heartRate`) et la puissance moyenne à vélo (`avgPowerW`), mais pas d'énergie à pied.

## Voulu

Dans Profil, les calories dépensées sur la période choisie, et leur équivalent en pots (« 4 350 kcal, soit 2 pots »), pots dessinés si possible.

## À faire

- Ranger l'énergie de chaque session dans `summary` (`SUMMARY_CALC_VERSION` augmenté), puis la sommer ; calcul pur testé.
- Dire combien de sessions n'ont pas pu être comptées (sans ceinture en voile, surf et muscu ; sans poids), plutôt que de les compter zéro en silence.
- Pot pris par défaut : 400 g, 539 kcal pour 100 g (valeur d'étiquette, à vérifier), soit environ 2 150 kcal ; valeur nommée, jamais en dur dans le calcul.

## Contradiction, tranchée le 25/11

`src/core/hrEnergy.ts` dit l'estimation par la FC « jamais additionné[e] à l'énergie mécanique de la course et du vélo » (lot 96) : un total tous sports les additionne. Choisi le 25/11 : additionner, pour ce total seulement, annoncé « environ » et arrondi, avec le nombre de sessions non comptées. Même problème de sens pour le repos : l'énergie de course et de vélo se lit avec ou sans le repos, celle de la FC repos compris ; prendre la même pour toutes (par défaut sans le repos, « dépensées par le sport »).

## Réserve

« Nutella » est une marque : sans souci pour l'usage personnel, mais à écrire « pot de pâte à tartiner » dans Gtracker, qui est vendu, sans logo ni pot imité.
