# 26 · Cadence à pied : seuils réglés sur de vraies sorties

Modèle | Réflexion : Fable | high pour le réglage (lecture des mesures, choix des seuils) ; Opus | high pour l'outil et l'application des seuils. Lire avant : CLAUDE.md (règles 2, 3), `docs/DECISIONS.md` §2 (« Cadence à pied », « Unité de la cadence »), HISTORIQUE point 124 (grep `^124\.`), `src/running/cadence.ts` (en-tête et `CadenceDetection`), `CADENCE` dans `src/core/sportProfiles.ts`.

## Constat

Les seuils de `CADENCE` (corrélation 0,3, demi-période 0,5, énergie 0,5 m/s², foulée au-dessus de 10 m/s², 70 à 240 pas/min) ont été posés le 17/10 sur une seule marche relue par adb, jamais sur une course. La capture est gardée entière (`keepCapture: true`) tant qu'ils ne sont pas réglés. Les courses des 21, 24, 25, 29, 31/10 et 04/11 et la marche du 17/10 ont leur `.imu` sur le PC (`D:\memoire Tracker\Tracker\sessions\`, hors dépôt, jamais copiées dans le dépôt).

## Étape 1 (Opus) : l'outil de relecture

`outils/banc/cadence-diagnostic.mjs <fichier .imu> [<fichier .gpx>] [--support=running]`, sur le modèle de `outils/banc/sauts-diagnostic.mjs` (même chargement par `charge-ts.mjs`, mêmes modules de l'application, `SPORT_PROFILES[support].cadence`) : état de la capture, puis la cadence telle que l'application la calcule (`running/cadence.ts`, la fonction qui rend la série de cadence depuis un `.imu`, à repérer), et :
- couverture : part du temps en mouvement (vitesse GPS lissée au-dessus de 3 km/h, lue dans le GPX comme `sauts-diagnostic`) où une cadence est trouvée, et part du temps à l'arrêt où une cadence est trouvée à tort ;
- distribution des cadences trouvées en mouvement (médiane, quartiles, min, max), part sous 120 et au-dessus de 200 ;
- pour chaque fenêtre, pourquoi elle est rejetée (corrélation, énergie, hors plage, demi-période) : comptes par motif ;
- comparaison avec la cadence écrite dans le GPX (`gpxtpx:cad`, foulées par minute × 2) si elle y est : écart médian ;
- option `--seuil cle=valeur` (répétable) qui surcharge une constante de `CADENCE` pour rejouer sans toucher au code (par exemple `--seuil minCorrelation=0.4`).
Pas de changement dans `src/` à cette étape, sauf un export manquant de `running/cadence.ts` (dire lequel).

## Étape 2 (Fable, l'orchestrateur) : les mesures et les seuils

Rejouer les sept captures, lire les chiffres, choisir les seuils. Règles : une course doit être mesurée sur 90 % au moins de son temps en mouvement, à une cadence crédible (150 à 190) ; la marche du 17/10 doit garder ses 96 % ; rien à l'arrêt (moins de 5 % du temps à l'arrêt mesuré). Un seuil nouveau ou changé revient à l'utilisateur avec ses chiffres (BLOQUÉ, question majeure) : il n'est posé qu'après accord.

## Étape 3 (Opus) : application

Seuils dans `CADENCE`, tests de `running/cadence.test.ts` ajustés, `keepCapture` à `false` seulement sur accord de l'utilisateur (sinon inchangé), `SUMMARY_CALC_VERSION` inchangé (la cadence d'une session se recalcule depuis sa capture si elle est là ; vérifier dans `hooks/sessionLibrary/addSession.ts` ce que change `keepCapture` à faux : la capture est élaguée ou jetée après le calcul, et les sessions déjà rangées ne bougent pas).

## Hors lot

Une vraie marche en pas par minute pour confirmer l'unité devinée d'un GPX importé (essai 4) : reste à l'essai.

## Vérification

`node outils/verif.mjs --rapide` par l'agent ; `npm run verif`, banc `cadence` et `relecture` par l'orchestrateur.

## Étape 2, mesures du 06/11 (outil `cadence-diagnostic.mjs`, seuils d'alors)

Couverture en mouvement (vitesse GPS lissée ≥ 3 km/h) : courses du 21/10 91,5 %, 24/10 97,2 %, 25/10 94,3 %, 29/10 93,3 %, 31/10 96,4 %, 04/11 97,1 % ; marche du 17/10 91,7 % (le « 96 % » du point 124 comptait le mouvement autrement ; à 1,5 km/h, 77,6 % d'une marche bien plus longue). Médianes de course 153,7 à 162 pas/min ; marche 103,8.

Défaut trouvé : sur la poitrine, une foulée de course de 8 m/s² environ reste sous `strideRmsMs2` (10) et passe pour un pas : 76 pas/min sur 30 % de la course du 25/10 (34 % des fenêtres sous 120) et 64 % de celle du 29/10. Les fenêtres de marche qui ont la période d'un pas sont à 2,6 m/s².

| `strideRmsMs2` | 25/10, sous 120 | 29/10, sous 120 | 31/10 | 21/10 | marche 17/10 (médiane) |
|---|---|---|---|---|---|
| 10 (avant) | 34,1 % | 64,0 % | 21,8 % | 13,7 % | 103,8 |
| 7 | 6,5 % | 8,1 % | 19,3 % | 13,2 % | 103,8 |
| 5 (retenu) | 4,1 % | 7,2 % | 19,0 % | 12,8 % | 103,8 |

Retenu : `strideRmsMs2` 5 m/s² (seuil changé, à confirmer par l'utilisateur ; les 24/10 et 04/11 ne bougent pas, la marche non plus). Ce qui reste sous 120 sur les 31/10 et 21/10 vient d'autres fenêtres (marche, exercices à l'arrêt), pas de ce défaut. Les autres seuils (corrélation 0,3, énergie 0,5, demi-période 0,5) ne sont pas touchés : la couverture dépasse 90 % partout. « Cadence trouvée à l'arrêt » (34 à 68 %) : surtout des transitions de 5 s au départ et à l'arrêt et, le 21/10, des exercices sans déplacement ; pas un défaut des capteurs.

Limites : les sessions déjà enregistrées gardent la cadence écrite dans leur GPX au moment de l'arrêt ; le seuil ne vaut que pour les prochaines. `keepCapture` reste vrai tant que l'utilisateur n'a pas confirmé le seuil (Q62). Une marche téléphone en poche (6 à 8 m/s² au point 124, sur les fenêtres de foulée) n'a pas de fenêtre ambiguë mesurée ici : à confirmer à l'essai 4.
