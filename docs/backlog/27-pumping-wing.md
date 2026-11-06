# 27 · Pumping en voile sur foil, réglé sur de vraies sessions

Réglé le 06/11 sur la wing du 02/11 à 13 h 58, capturée entière (`D:\memoire Tracker\Tracker\sessions`, hors dépôt), relue par `outils/banc/pumping-diagnostic.mjs`.

## Précisions de l'utilisateur (06/11)

- Il faut au moins 4 ou 5 coups bien marqués pour parler de pumping.
- Il y a plusieurs façons de pomper : 2 ou 3 coups rapides pour relancer, trop courts pour compter ; de petits coups très rapides, dont il doute qu'ils marchent avec le gros foil.
- 01/11 : vent très léger, aucun saut ni tentative.

## Mesures

Fenêtres de 6 s en vol, 02/11 : de 90 à 130 coups/min, 0,33 à 0,56 g efficaces et réguliers ; de 20 à 70 coups/min, 0,12 g et peu réguliers ; presque rien entre 70 et 80. Rien n'a noté quand l'utilisateur pompait : c'est une lecture du signal, d'où l'essai 130.

Essayé et écarté :
- relever le seuil de coup : à ±0,3 g, environ 170 vrais coups perdus, et les petits coups rapides avec ;
- garder à part le rythme lent aux coups nets : une série de 4 s sur le 02/11, rien ailleurs ;
- monter la plage à 180 ou 240/min : rien ne change sur le 02/11, aucun coup très rapide n'est capté.

| Session (seuil) | Avant | Après |
|---|---|---|
| 02/11 (6 nd) | 68 séries, 1011 coups, 22 %, 89/min | 56 séries, 868 coups, 17 %, 101/min (médiane 102) |
| 01/11 (4,5 nd, 102 s mesurées sur 923) | 5 séries, 61 coups, 49 % | 4 séries, 41 coups, 27 % |
| 08/10 à 15 h 24 (6 nd, 16 sauts) | 14 séries | aucune |
| 08/10 à 15 h 06 (6 nd) | 8 séries | 4 séries |
| 26/10 (6 nd) | 8 séries | 6 séries |
| 21/10 à 13 h 36 (6 nd, 17 sauts) | 13 séries | 1 série |

## Limites connues

- Le 01/11, la capture ne garde que 7 passages qui ressemblaient à des sauts, de faux candidats puisque l'utilisateur n'a pas sauté, sans doute de grands coups de pompe : la part réelle de pumping de cette sortie est inconnaissable.
- La part de vol pompée de la fiche (image de partage, résumé) ne se réécrit qu'à l'ouverture de l'analyse ; l'image de partage ne dit pas qu'une capture est partielle.
- Vitesse de décollage : les vols sans creux net n'ont plus de valeur (« — ») ; le changement vaut aussi au surf, inchangé sur ses tests et au banc.
- Faux sauts en wing : restent à l'essai 48 ; le 01/11 donne un exemple sans aucun saut.

## Faux sauts en wing : les rebonds (06/11, deuxième commit du lot)

Réponse de l'utilisateur (06/11) : une dizaine de sauts le 08/10 à 15 h 24 et le 21/10, pas 16 ni 17 ; aucun le 01/11.

Constat sur les captures : avec la hauteur minimale de l'activité (0,5 m en wing, aucune surcharge dans les réglages de l'utilisateur), l'application montrait déjà 10 sauts sur chacune des deux sorties ; les 16 et 17 étaient les listes brutes du diagnostic (dès 0,2 m). Parmi les petits vols bruts, 7 sont collés à un vrai saut (1 à 3 s avant ou après, 0,20 à 0,37 m contre 0,75 à 1,70 m) : l'appel avant, le rebond après. Ils n'ont aucun sens comme sauts, et auraient été montrés à terre (hauteur minimale 0,3 m, un rebond de 0,37 m).

Règle (`isSatellite`, `core/jumps.ts`) : un vol rangé qui touche, à `satelliteGapS` (3 s) près, un autre vol rangé d'au moins sa hauteur divisée par `satelliteHeightRatio` (0,5) est un rebond, écarté ; deux sauts de hauteurs comparables restent deux sauts (un double à vélo). `JUMPS_CALC_VERSION` 4 : les sauts des sessions qui ont leur `.imu` sont refaits à l'ouverture. À inscrire dans DECISIONS §3 à la passe de doc.

| Capture | Sauts bruts avant | après | rebonds |
|---|---|---|---|
| wing 08/10 15 h 24 | 16 | 13 | 3 (15:42:06 0,22 m ; 15:44:25 0,37 m ; 15:51:21 0,26 m) |
| wing 21/10 | 17 | 13 | 4 (14:40:39 0,24 m ; 14:43:58 0,21 m ; 14:46:34 0,26 m ; 14:46:38 0,20 m) |
| wings 26/10, 18/10, 10/10, 02/11, 01/11, 08/10 15 h 06 | 3, 2, 1, 5, 0, 1 | inchangés | 0 |
| courses 31/10, 21/10 | 1, 10 | inchangés | 0 |

Montrés dans l'application (0,5 m, au-dessus du seuil d'activité) : toujours 10 et 10. Le pumping de la wing du 02/11 ne bouge pas (56 séries, 868 coups, seuil 6 nd).

Restent, hors de cette règle : sur le 08/10, trois petits vols isolés (15:33:33 0,20 m à 6,7 nd ; 15:46:24 0,31 m ; 15:50:42 0,26 m), cachés par la hauteur minimale de 0,5 m ; l'essai 48 dira si ce sont de vrais petits sauts.

## Contrôle du n° 105 (06/11)

Rejoué sur toutes les captures : plus aucun vol de 1,9 s pour 0,9 m ; la course du 31/10 donne 0,51 s pour 0,33 m. La course du 21/10 à 16 h 26 garde 10 vols bruts à l'arrêt ou presque (0 à 3,4 nd : exercices, pas de la foulée), dont trois longs pour leur hauteur (0,84 à 1,15 s pour 0,22 à 0,24 m, v0 de 0,5 à 1,4 m/s : des flexions, pas des sauts) ; tous sont cachés par le seuil d'activité. Rien à corriger ; le n° 105 reste clos. La note 2 du 31/10 était un test d'arrêt de l'enregistrement, pas un saut.
