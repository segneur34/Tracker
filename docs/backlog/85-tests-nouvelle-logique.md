# 85 · Tests guidés : une autre logique (FC max, puis VMA)

Détail de l'élément 85 de `docs/BACKLOG.md`. Noté le 29/10 pendant une course avec la ceinture (essai 2 du test de FC max). Le test de FC max a donné 160 bpm, alors qu'un test fait « maison » avait donné 190 bpm, valeur beaucoup plus plausible à son âge. À faire après l'assainissement du code (n° 52), décision de l'utilisateur.

## Tel que noté (29/10)

« L'échauffement en mode test FC permet de monter trop : il faut lancer le double bip pour ralentir plutôt à 160 BPM. C'est beaucoup trop pour un échauffement à mon niveau, donc il faut redescendre, je pense 150 max, c'est pas mal. »

« Le problème de prendre que la fréquence cardiaque pour les vitesses d'échauffement, c'est que ça met du temps à ralentir et accélérer. Si on suit tous les bips, les doubles bips, on peut être amené à beaucoup trop ralentir pendant longtemps avant de retomber en dessous de 130, ensuite devoir accélérer mais beaucoup trop, et ainsi de suite. Je pense qu'il faut une double corrélation : fréquence cardiaque et accélération. »

« Le problème est flagrant quand on passe de l'échauffement, qui se base que sur la fréquence cardiaque, au changement d'étape qui se base sur une accélération avec une vitesse de base : c'est compliqué de passer de l'un à l'autre. »

« Plus généralement, sur les tests de FC max, et ce sera pareil pour la VMA, il faut changer de logique. Il y a trop de difficultés à être extrêmement précis avec des données de type GPS ou fréquence cardiaque. Il faut partir du principe que l'athlète a envie de se donner à fond. La VMA doit progressivement accélérer, encourager à accélérer si l'athlète a l'impression que ça ne va pas assez vite. Mais on ne considère l'arrêt que quand ça s'effondre franchement, pas 20 secondes un peu moins vite, parce que ça peut être le terrain ou autre chose. Là, j'ai été bloqué à 160 BPM en FC max alors que la dernière fois que j'ai fait un test plus maison je suis monté à 190. Ce sera un chantier à faire après la grosse refactorisation qui est en cours. »

## Où

`recording/fitnessTest.ts` (protocole, `FITNESS_TESTS`), `hooks/useFitnessTest.ts`, `components/FitnessTestPanel.tsx`, `running/fitnessTestResults.ts` ; décisions actuelles : `docs/DECISIONS.md` §5 (« Test de FC max », 24/10).

## Aujourd'hui (vérifié dans le code)

- Échauffement de 8 min guidé sur la FC seule, dans les zones 2 à 3 du cardio (`warmupZones: { from: 2, to: 3 }`) : le haut de la zone 3 peut dépasser 150 bpm.
- Rampe guidée sur la vitesse GPS lissée (+0,6 km/h par minute) ; fin 20 s à 0,5 km/h sous la cible. C'est la règle qui arrête le test trop tôt : un ralentissement de 20 s (terrain, virage) le termine.
- Deux guidages de natures différentes (FC puis vitesse) : le passage de l'un à l'autre est brutal.

## Voulu

- Échauffement : plafond plus bas (150 bpm environ, à régler), et guidage qui croise la FC et la vitesse (la FC réagit avec retard : ne pas dire « ralentis » ni « accélère » sur la seule FC du moment).
- Test de FC max, puis de VMA : l'athlète est supposé se donner à fond. La vitesse augmente progressivement, avec des encouragements à accélérer ; l'arrêt n'est décidé que sur un effondrement net et durable, jamais sur 20 s de ralentissement.
- Même logique pour la VMA (n° 29), qui vient après.
- Bips des tests : voir le n° 88 (double et triple bip plus brefs), à faire avant.

## À vérifier à l'essai

L'étape « Retenir cette FC max » puis l'affichage des zones de FC (partie de l'essai 2 non relevée le 29/10).

## Questions

Aucune pour l'instant ; les seuils exacts (plafond d'échauffement, définition d'un « effondrement ») se règlent au brief, avec des données réelles de l'utilisateur.

## Décisions du 31/10 (réponses de l'utilisateur à l'orchestrateur `/chaine`)

- **Échauffement** : plafond à **155 bpm**, réglable dans la page du test comme la durée (limites 120 à 180). La bande d'échauffement reste « zones 2 à 3 », coupée en haut à ce plafond.
- **Effondrement** (fin automatique de la rampe) : vitesse lissée à **20 % sous la cible** (l'utilisateur : « quand le corps n'en peut plus, on perd au moins 50 % »). Durées tranchées par l'orchestrateur : 20 % sous la cible pendant **30 s** (durable), ou 50 % sous la cible pendant **10 s** (arrêt franc) ; « Finir la rampe » reste possible à la main. L'ancienne règle (0,5 km/h pendant 20 s) disparaît : elle terminait le test sur un virage ou un bout de terrain.
- **Rampe** : « trop vite » (2 bips) gardé, mais **moins souvent** : seulement 1 km/h ou plus au-dessus de la cible pendant 20 s. Son sens, précisé par l'utilisateur le 31/10 : « l'idée du trop vite, c'est de ne pas monter trop vite la rampe », c'est-à-dire tenir la progression de +0,6 km/h par minute, pas freiner l'effort ; le libellé du signal et l'aide « ? » le disent ainsi ; « accélère » (3 bips) et « bien » (1 bip) comme aujourd'hui ; un long à chaque palier.
- **Échauffement croisant FC et vitesse** (tranché par l'orchestrateur, mécanisme laissé au plan) : une correction d'échauffement ne se dit que si la vitesse ne va pas déjà dans le bon sens. « Trop vite » seulement si la FC lissée dépasse la bande **et** que la vitesse lissée des 20 dernières secondes n'a pas déjà baissé d'au moins 0,5 km/h par rapport aux 30 s d'avant ; « accélère » symétrique. Ainsi on ne demande pas de ralentir encore à quelqu'un qui ralentit déjà et dont la FC met 30 à 60 s à suivre. Les écarts entre signaux (10 s, 30 s, répétition) restent ceux du protocole.
- **Périmètre** : la FC max seulement ; la VMA (n° 29) reprend cette logique ensuite. La page du protocole (déroulé, règle de fin, bips) et l'aide « ? » disent les nouvelles règles ; pas de changement de disposition, donc pas de maquette.
- Seuils dans `FITNESS_TESTS` (règle 3), aucun en dur dans `stepFitnessTest` ; tests synthétiques sur `stepFitnessTest` : un ralentissement de 20 s à 0,5 km/h sous la cible ne finit plus la rampe, 20 % pendant 30 s la finit, 50 % pendant 10 s aussi, « trop vite » tu sous 1 km/h ou avant 20 s, correction d'échauffement tue quand la vitesse corrige déjà ; `SUMMARY_CALC_VERSION` inchangé (le résultat d'un test rangé ne se recalcule pas) ; banc `test-fcmax.mjs` relancé (sortie attendue différente : à relever et à expliquer dans le rapport).

## Plan (agent Plan, 31/10, retenu par l'orchestrateur)

Paramètres (`FitnessTestProtocol`, `FITNESS_TESTS['fc-max']`, version 2) : `warmupCeilingBpm` 155, `warmupMinBandBpm` 10, `warmupTrendRecentS` 20, `warmupTrendBeforeS` 30, `warmupTrendMs` 0,5 km/h, `rampTooFastMs` 1 km/h, `rampTooFastS` 20, `collapseRules` [{ deficitRatio 0,2, holdS 30 }, { deficitRatio 0,5, holdS 10 }] ; `failDeficitMs` et `failS` disparaissent, `speedToleranceMs` reste. Réglage `warmupCeilingBpm` dans `FitnessTestSettings` (limites 120 à 180, pas de 5), écrit par `useSportSettings.ts` (~l. 357) s'il diffère du protocole. Bande d'échauffement : haut = min(haut de la zone 3, plafond), bas = min(bas de la zone 2, plafond − 10).
Échauffement croisé : `windowMean` prend un `endMs` facultatif ; tendance = moyenne des 20 dernières secondes − moyenne des 30 s d'avant, `null` si une fenêtre est couverte à moins de la moitié ; « trop » se tait si la tendance ≤ −0,5 km/h, « accélère » si ≥ +0,5 km/h ; tendance `null` → la correction se dit ; une correction tue n'appelle pas `emit`.
Rampe : état `tooFastSince` (démarre à cible + 1 km/h hors grâce, continue pendant la grâce, remis à zéro sous le seuil, sans vitesse, trou, reprise) ; verdict : sous cible − 0,3 → « accélère » ; compte tenu 20 s → « trop » ; à ±0,3 → « bien » ; entre +0,3 et +1 km/h → silence (tranché : ne pas dire « bien » à qui monte trop vite).
Fin de rampe : `deficit` devient `collapseSince`, un par règle, mêmes remises à zéro ; `endRamp('auto')` avec `dropMs` = début du manque le plus ancien (celui des 20 %) ; test fait avant celui du palier, sur la cible du palier en cours ; `fitnessTestResults` (« dernier palier tenu ») inchangé ; `testPlan` inchangé hors bande plafonnée.
Écrans : `FitnessTestPage.tsx` (liste des bips ~l. 100, aide `test:bips` ~l. 96, déroulé ~l. 86 avec valeurs tirées du protocole, menu « Plafond d'échauffement » dans la carte Réglages ~l. 114) ; `FitnessTestCard.tsx` ~l. 79 : « en avance sur la rampe » en phase rampe ; `FitnessTestPanel.tsx` ~l. 33 : `END_REASON_LABEL.auto` → « vitesse effondrée sous la cible ». Libellé « Trop vite » gardé.
Compatibilité : `SessionTest` inchangé (`highBpm` porte la bande coupée), tests v1 relus, `SUMMARY_CALC_VERSION` inchangé, anciens réglages `{ warmupS }` complétés par `sanitize`.
Tests (`fitnessTest.test.ts`) : réglages par défaut, `sanitize`, `resolve` (158 → 155, 162 → 155, 154 inchangé), scénario dont le 7e palier s'effondre à 70 % ; nouveaux : 20 s à 0,5 km/h sous et 15 % pendant 60 s ne finissent pas ; 20 % pendant 29 s non, 30 s oui (`dropMs`) ; 50 % pendant 10 s (`dropMs` = début des 20 %) ; manque qui ne commence pas en grâce mais la traverse ; « trop » tu à +0,9 pendant 60 s et à +1,2 pendant 19 s, dit vers 20 s à +1,2 ; « bien » tu entre +0,3 et +1 ; échauffement : FC au-dessus et vitesse en baisse de 1 km/h → pas de « trop », qui revient ensuite ; vitesse constante → « trop » ; « accélère » symétrique ; mêmes signaux à 1 Hz et 5 Hz ; `windowMean` avec `endMs` ; relecture d'un `SessionTest` v1 ; plafond (158 coupé à 155, 170 laisse 158, bas repoussé).
Banc `test-fcmax.mjs` : « 130 à 158 » → « 130 à 155 » (l. 65, 147) ; l. 183 passer `sanitizeFitnessTestSettings({ warmupS: 180 }, …)` sinon bande NaN ; l. 222 nouveau libellé ; trace portée à 780 s ; imprimer la suite des signaux en secondes. Attendu : fin de rampe vers 593 s (marche à 50 % sous la cible) au lieu de ~570, fin du test vers 713 s, toujours 7 paliers, 6 tenus, 10,0 km/h, FC max 185. Relevé : `node outils/banc/passe.mjs test-fcmax --avant HEAD --scripts-par-cote --temps 10`.
Ordre : `fitnessTest.ts` → `useSportSettings.ts` → tests → écrans → banc → `npm run verif` → banc.
Tranché par l'orchestrateur (31/10) : « dernier palier tenu » peut être un peu flatté par la tolérance de 20 % ; gardé tel quel pour la FC max (le résultat est la FC), à revoir avec la VMA (n° 29). Un téléphone sans positions à l'arrêt oblige à « Finir la rampe » à la main : déjà le cas, hors lot. Essai au téléphone : l'essai 71 (un vrai test avec la ceinture).
