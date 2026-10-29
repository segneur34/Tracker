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
