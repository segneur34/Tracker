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
