# 233 · Surf : les chiffres plus justes de Gtracker

## Tel que noté

25/11/2026 : « vas faire un tour dans Gtracker pour regarder les modif qu'on fait dedans, et qu'on pourrais ajouter a tracker », puis, sur la liste numérotée : « tout Surf : chiffres plus justes » (points 8 à 12).

Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lu le 25/11 au commit ddc4281 ; voir un lot : `git -C "D:/gong tracker/Gtracker" show <commit>`. Reprise à la main, jamais par copie en bloc : là-bas le code n'a plus ni course, ni vélo, ni entraînement, ses textes passent par la traduction, et l'apparence est la sienne (rien de cela ne vient).

## Ce qui vient

| Étape | Ce qui vient | Lots Gtracker |
|---|---|---|
| 1 | Début des vagues compté comme leur fin ; départ de la vague (mise en vitesse) montré en orange, sans foil | 423 (6d1e93f, e3d3d81, 02a758a), 432 (60a0ba2, 4a40843) |
| 1 | Virages : la sortie de vague ne compte plus (3 s de vague au-dessus de 7,2 km/h après la rotation) ; le compte GPS ne dépend plus de la cadence du fichier (règle 2) | 424 (7076761, b5c09b4), 503 (5f1c363) |
| 2 | Sens des vagues estimé, corrigé à la boussole (commune avec le vent), dans la fiche et le brouillon ; dessin sur la carte ; sur foil, une remontée pompée n'est plus comptée comme une vague | 436 A (2cedaa0), 439 (008ad35, 7692843), 440 (9535822 à 6fa0005), 441 (ac46858, bd0b525), 442 (54f2fb4), 444 (00de95f) |
| 2 | Zone du pic (ellipse), retour au pic = temps pour y rentrer, zone dessinée sur la carte, onglet rame | 436 B (008a197), 437 (9128482), 439 |
| 3 | Au téléphone, une vague ou une remontée par cadre | 422, 434, 435 (e03a676), 438 (ba2e52b) : seul le dernier dessin (438) compte |

## Aujourd'hui dans Tracker (vérifié le 25/11)

`src/surfing/gpsTurns.ts` : cap `p.courseDeg ?? p.bearing`, d'un point au suivant, donc le défaut du lot 503. Ni sens des vagues ni zone du pic dans `src/surfing/`. Retour au pic : de la fin d'une glisse à la première attente (`src/surfing/surfAnalysis.ts`).

`SUMMARY_CALC_VERSION` à augmenter ; banc avant/après ; chiffres réels à relire avec l'utilisateur. Là-bas, une seule session réelle à deux vagues a servi pour le sens des vagues : le calcul est peu éprouvé.

## Contradictions, réponse par défaut

- DECISIONS §4 : « retour au pic : de la fin d'une vague à la première attente ». Défaut : la règle de Gtracker (entrée dans la zone), à réécrire.
- DECISIONS §4, virages « retournements d'au moins 60° soutenus en 2 s au plus » : gardé, la règle de sortie s'ajoute.
- « Vitesse maximale […] celle des vagues » : ne change pas.
