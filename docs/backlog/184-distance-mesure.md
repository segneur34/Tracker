# Lot 184 : l'écart de distance Tracker / positions, mesuré (06/11/2026)

Mesure seule, aucun changement de `src/`. Script : `outils/banc/distance-diagnostic.mjs` (`node outils/banc/distance-diagnostic.mjs <dossier des sessions> --nom=_running --fit <fichier .fit>`). Données hors dépôt : 16 courses `*_running.gpx` du 24/09 au 06/11 et le FIT d'une montre Garmin.

## Méthode

- Chaîne de l'application : `parseGpx`, `analysisTrack`, `thresholdActivityMask` (seuil de la fiche, sinon celui du profil), `segmentDistanceM`. Pas en mouvement seulement (pauses, arrêts, segments respectés).
- Contrôle : la distance totale recalculée égale `summary.distanceM` de la fiche à 0,00 m pour les 13 courses de calcul v18 et v13 ; le mouvement égale `movingDistanceM` à 0,00 m pour toutes les v18 (écarts seulement sur v13, v6, v2 : fiches d'un ancien calcul, ex. 17/10 11:07 : fiche 12,47 km, recalcul 5,05 km).
- Positions : Haversine sur les mêmes pas. « 5 s » et « 10 s » : un point gardé toutes les 5 ou 10 s dans chaque suite de pas en mouvement (le reste de fin de suite est gardé). Le brut gonfle (bruit), le 5 s et 10 s tendent vers la corde (ils raccourcissent les virages) : ce sont deux bornes, pas une vérité.
- Tranches de 300 s depuis le départ ; seules celles à 120 s de mouvement ou plus entrent dans les statistiques.
- Toutes les courses : source de vitesse Doppler, intervalle médian 1,00 s.

## Par course (Tracker / positions, en mouvement)

| Date (UTC) | Fiche | Mouv. km | Brut | 5 s | 10 s | Tranches : min / max | > 5 % | Trous (s) | Segments |
|---|---|---|---|---|---|---|---|---|---|
| 24/09 11:50 | v2 | 8,219 | -27,7 % | -26,5 % | -24,1 % | -32,0 / -20,6 % | 4/4 | 4 (278) | 1 |
| 03/10 15:27 | v18 | 6,602 | -2,2 % | -1,4 % | -0,4 % | -4,3 / +0,6 % | 0/9 | 0 | 2 |
| 16/10 05:33 | v18 | 0,914 | -13,3 % | -11,1 % | -9,9 % | -12,8 / -5,2 % | 2/2 | 0 | 1 |
| 17/10 09:07 | v6 | 3,357 | -15,5 % | -13,5 % | -12,7 % | -25,5 / -3,8 % | 7/8 | 2 (542) | 44 |
| 17/10 15:53 | v13 | 1,899 | -10,7 % | -9,7 % | -8,1 % | -11,2 / -2,7 % | 1/2 | 0 | 2 |
| 18/10 09:55 | v18 | 8,240 | -4,1 % | -3,1 % | -1,9 % | -10,1 / 0,0 % | 2/12 | 0 | 3 |
| 21/10 14:26 | v18 | 6,256 | -6,1 % | -3,3 % | -0,2 % | -10,4 / +10,1 % | 5/17 | 0 | 5 |
| 24/10 11:17 | v18 | 1,007 | -6,8 % | -3,8 % | +0,5 % | -4,9 / -3,3 % | 0/2 | 0 | 1 |
| 25/10 11:32 | v18 | 4,944 | -4,8 % | -3,0 % | -1,1 % | -7,1 / +6,1 % | 3/8 | 0 | 1 |
| 31/10 08:12 | v18 | 3,642 | -5,9 % | -4,7 % | -3,7 % | -14,9 / +1,1 % | 3/7 | 0 | 4 |
| 04/11 13:58 | v18 | 3,398 | -4,7 % | -3,6 % | -1,8 % | -9,9 / +0,3 % | 2/5 | 0 | 2 |
| 06/11 15:28 | v18 | 7,363 | -3,9 % | -2,0 % | +0,1 % | -7,4 / +1,2 % | 1/12 | 0 | 4 |

Quatre autres courses (24/09 08:53, 15/10, et deux de moins de 0,4 km le 29/10) sont trop courtes ou immobiles : listées par le script, hors moyennes. Le 06/11, 12 tranches : seule la première (0 à 5 min) dépasse 5 % (-7,4 %), la deuxième moitié reste entre -2,9 et +1,2 %.

## Synthèse (12 courses d'au moins 0,5 km en mouvement, rapport à 5 s)

- Écart moyen -7,1 %, médian -3,7 %, plus grand -26,5 % (24/09 11:50, calcul v2, 8,2 m/s : séance à part, quatre trous, non diagnostiquée). Sans lui, de -1,4 % à -13,5 %.
- Tracker est plus court que les positions dans les 12 cas, jamais l'inverse. Aucune course n'est à plus de -1,4 % de mieux.
- Par version de fiche : v18 (9 courses) -3,1 % pondéré (médian -3,3 %) ; v13, v6, v2 : -9,7 %, -13,5 %, -26,5 % (une course chacune). Les recalculs ici emploient le code actuel : la version est donc la date de la fiche, pas le calcul de ce banc.
- Par mois : septembre -26,5 % (1), octobre -4,6 % (9), novembre -2,5 % (2).
- Par allure moyenne en mouvement : marche (< 2,0 m/s) -6,6 % (5), trot (2,0 à 2,8) -2,5 % (5), course (≥ 2,8 m/s) 2 courses seulement (17/10 15:53 et 24/09, -9,7 et -26,5 %) : pas de conclusion.
- Par temps depuis le départ (tranches de 5 min) : 0-5 min -10,4 % pondéré (médian -4,7 %, 50 % des tranches à plus de 5 %), 5-10 min -11,4 % (médian -5,1 %, 50 %), puis -1,9 à -3,3 % entre 10 et 35 min (13 à 29 % des tranches > 5 %). Les deux premières tranches viennent aussi des courtes courses et des fiches anciennes ; la ventilation par version n'a pas été faite par tranche.

## Montre (FIT du 06/11, 15:57:11Z à 17:24:46Z, 5 256 records, 1 Hz)

Lecture cohérente : 5 256 records, 5 232 avec position, heures et distance croissantes, intervalle médian 1,00 s. Fenêtre commune avec la course : 15:57:11Z à 16:29:30Z (32:19), soit de 29:01 à 61:20 depuis le départ de la course.

| Sur la fenêtre | km |
|---|---|
| Montre, champ distance | 4,695 |
| Montre, positions brutes / un point par 5 s | 4,729 / 4,649 |
| Tracker, vitesse retenue | 4,587 |
| Tracker, positions brutes / un point par 5 s | 4,707 / 4,645 |

On retrouve 4,59 / 4,70 / 4,71. Vitesses moyennes : montre (distance / temps) 2,421 m/s, Tracker 2,365 m/s (écart -0,056 m/s, soit -2,3 %) ; Tracker par ses positions à 5 s 2,396. Tracker (vitesse) / montre (distance) : -2,3 % ; Tracker (vitesse) / Tracker (positions 5 s) : -1,3 % ; positions à 5 s de Tracker et de la montre : -0,1 % (les deux appareils voient le même trajet).

Par tranche de 5 min (m) : Tracker vitesse / montre distance : +0,3, -4,5, -1,4, -2,2, -2,1, -3,4, -2,3 % (hors la première, de -1,4 à -4,5 %). Tracker vitesse / Tracker positions 5 s : -1,2, -4,4, +2,1, -0,4, -1,2, -2,6, +0,6 %.

Couverture de l'écart le plus fort : la montre couvre 29:01 à 61:20 de la course (53 %). Aucune tranche de la course n'est à plus de 9 % d'écart, dans la fenêtre ou hors d'elle ; la plus forte (-7,4 %, de 0 à 5 min depuis le départ) est hors fenêtre, donc non confrontée à la montre. Les tranches de 9 à 24 % citées pour la première moitié du 06/11 ne se retrouvent pas ici (maximum -7,4 %, première tranche) : l'écart de définition (fenêtre, lissage, base de comparaison) n'est pas établi, et la première moitié n'a pas de montre.

## Ce que les données montrent

- Sur 32 minutes, face à une montre : Tracker est environ 2,3 % plus court que la distance de la montre et 1,3 % plus court que ses propres positions rééchantillonnées à 5 s ; ses positions concordent avec celles de la montre à 0,1 %. L'écart est donc dans l'intégrale de la vitesse (Doppler), pas dans les positions.
- Sur les 12 courses, le sens est constant (Tracker plus court). Il va de -1,4 à -4,7 % sur les courses v18 de plus de 3 km, plus fort et plus variable sur les courtes et les anciennes fiches.
- Le résultat dépend de la base : brut, 5 s et 10 s donnent pour le 06/11 -3,9 %, -2,0 % et +0,1 %. Aucune n'est la distance vraie.

## Ce qu'elles ne montrent pas

- Aucune référence indépendante hors cette montre, sur 32 minutes d'une seule sortie, hors des cinq premières minutes et de la moitié la plus écartée. On ne sait pas laquelle de la montre ou de Tracker est la plus juste : la montre n'est pas une mesure de vérité terrain.
- La cause (vitesse Doppler basse, lissage, écrêtage, démarrage) n'est pas isolée : ce lot n'a rien rejoué sur les réglages.
- Peu de courses v18 (9) ; aucune course v18 à plus de 2,8 m/s en moyenne ; allure et date se recoupent (les courses lentes sont d'octobre-novembre).
- Les tranches courtes sont bruitées (quelques dizaines de mètres chacune).
