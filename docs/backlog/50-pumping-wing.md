# 50 · Pumping sur foil : la série de coups, pas le vol

Modèle | Réflexion : agent `lot` sur Opus high, plan par l'agent `Plan`, relecture obligatoire ; orchestration et décisions sur Fable high (`/chaine`), le lot touchant au calcul du pumping. Lire avant : CLAUDE.md (règles 2, 3, 10), `docs/DECISIONS.md` §1 (« Pumping en voile », « Pumping foil ») et §4 (« Pumping foil »), `docs/MISE_EN_PAGE.md`, et ce fichier en entier.

## Tel que noté (28/10, 20:42, Tom)

« Problème avec l'onglet pumping dans le wing foil : il y a un mélange entre le pumping où il y a une cadence de pumping, va durer peu de temps à mon niveau (– de 30 sec) je perds de la vitesse pendant… Et entre le vol qui est le moment où je suis en vol en foil. Je pense que ça vient du fait que le pumping vient du calcul de surf foil mais c'est une mauvaise compréhension de ce qu'on veut dire par pumping. Lot important. »

## Tel que noté (31/10, Tom, marqué « important »)

« Il faut retravailler l'onglet pumping au moins en wing : actuellement il compte comme vol, mais il doit ne compter que s'il y a vol avec une cadence de pumping ; trouver pumping n'est pas égal à vol, même en surf foil et autre support à foil. »

Précision du 31/10 : « l'idée c'est que le vol = planing (donc planche qui accélère beaucoup), et pumping se fait que en vol, et il faut une cadence de mouvement pour que ce soit validé et qu'on puisse comme pour les pas avoir des infos du genre distance par pumping, durée etc. »

Portée : **tous les supports à foil** (wing, planche et kite sur foil, surf foil). Pas le bateau.

## Aujourd'hui (vérifié dans le code le 31/10)

- `core/pumping.ts` trouve déjà des séries (`pumpSeries` : coups espacés de `strokeMaxGapS` = 2,5 s au plus, `minSeriesStrokes` = 3 coups au moins), mais `measureFlightPumping` n'en rend que les **sommes par vol** (`FlightPumping` : coups, temps et distance pompés, fréquence, distance par coup, décollage) ; les séries ne sortent jamais du calcul.
- Aucun critère de cadence : un coup est un passage de −`strokeMinG` à +`strokeMinG` (0,12 g) de l'accélération verticale lissée ; ni régularité des écarts, ni plage de cadence. Le clapot et les mouvements du buste en vol peuvent faire une « série » qui couvre presque tout le vol.
- L'écran est construit autour des vols (`components/FlightPumpingPanel.tsx`, pièce commune à l'onglet « pumping » de la voile et à l'onglet « vols » du surf) : titre « Pumping (N vols) », tuiles « Vols » et « Plus long vol », podium des 3 plus longs vols, colonnes de pumping par vol.
- Vols : en voile, une suite au-dessus du seuil d'activité d'au moins 10 s (`flightSpans`, `SAILING_PUMP_DETECTION.minFlightS`) ; en surf, `SurfFlight`. Inchangés : c'est bien le « vol = planche lancée » de l'utilisateur.
- Seuils : `SAILING_PUMP_DETECTION` est une copie de `PUMP_DETECTION` (surf), jamais réglée sur une vraie sortie wing (n° 27).

## Voulu

- **Vol** : la planche lancée, au-dessus du seuil d'activité (voile) ou `SurfFlight` (surf). Inchangé, montré à part.
- **Pumping** : seulement en vol, et seulement là où une **cadence de mouvement régulière** le valide. Un vol sans cadence de coups ne compte pas comme du pumping.
- **Comme pour les pas** à pied : chaque série a sa cadence (coups par minute), sa durée, son nombre de coups, sa distance par coup, sa vitesse avant et après (« je perds de la vitesse pendant »).
- **La cadence d'abord** : première colonne, première tuile.
- **Aucune durée maximale** : moins de 30 s au niveau de l'utilisateur, bien plus avec du meilleur matériel.

## Maquette

https://claude.ai/artifact/6obNsyMC7YGUVTemHt3GWd (ordinateur et téléphone, chiffres d'exemple), **validée le 31/10**, choix par défaut retenus ; retouches possibles après le premier essai :
- en haut, le pumping : titre « Pumping (N séries) », bouton « Les 3 plus longues séries » ; tuiles Cadence, Séries, Temps pompé, Coups, Par coup, Part du vol pompée ; tableau des 3 plus longues séries (cadence, début, durée, coups, m/coup, vitesse avant → après, vol, carte), puis « Toutes les séries (N) » ;
- dessous, à part, les vols : tuiles Vols, Temps de vol, Plus long vol ; les 3 plus longs vols (début, durée, distance, décollage, séries, temps pompé, carte), puis « Tous les vols (N) » ;
- sur téléphone, les tableaux deviennent des cartes (cadence en gras en tête de ligne) ;
- sans capteurs, ou Pumping décoché : le bloc des vols seul, comme aujourd'hui.

Choix par défaut, retenus le 31/10 :
- podium : les 3 plus **longues** séries (et non les 3 plus hautes cadences, qu'une série de 3 coups suffirait à gagner) ;
- surf foil sans capteurs : la colonne GPS « Pompage » (temps de vol hors des vagues) devient « Hors vague », pour ne plus appeler du vol « pumping ».

## Étapes

1. **Calcul** (`src/core/pumping.ts`) :
   - une série n'est retenue que si une cadence régulière la valide, comme la cadence à pied : période cherchée par autocorrélation de l'accélération verticale sur une fenêtre glissante en secondes, retenue si elle corrèle assez et tombe dans la plage de cadence du pumping (modèle : `stepPeriod`, `src/running/cadence.ts`, et sa crête interpolée ; la partie commune passe dans `core/` plutôt que d'être copiée) ; les coups restent comptés par `pumpStrokes`, mais seulement dans les plages validées ; une suite irrégulière ne fait pas de série ; aucune durée plafond ;
   - nouvelles constantes dans `PumpDetection` (fenêtre, corrélation minimale, plage de cadence en coups par minute), dans `PUMP_DETECTION` (`core/sportProfiles.ts`), donc au surf comme à la voile ; valeurs provisoires, réglées au n° 27 ;
   - `FlightPumping` rend aussi ses séries : début et fin (heure et index de la trace, pour la carte), durée, coups, cadence, distance (`segmentDistanceM` ou cumul), distance par coup, vitesse lissée avant et après (`smoothedSpeedMs` par `valueAtTime`) ; et la part du vol pompée ;
   - les séries ne sont cherchées qu'en vol (du décollage, sinon du début du vol, à la fin du vol), comme aujourd'hui.
2. **Hook** (`useFlightPumping`, `src/hooks/useSessionPumping.ts`) : la liste des séries de la session, numérotées dans l'ordre, et leur podium, à côté de `byFlight`.
3. **Panneau** (`src/components/FlightPumpingPanel.tsx`, pièce commune) d'après la maquette validée ; tableaux en cartes sur téléphone (`ui-table--cards`).
4. **Modules** : `SailingModule.tsx` (titre, aide « ? », surbrillance d'une série ou du podium des séries, ou d'un vol, par `TrackSpanLayer` et `useMapHighlight`, une seule à la fois) ; `SurfModule.tsx` (onglet « vols », même pièce, colonne « Hors vague »).
5. **Décisions** : réécrire les lignes « Pumping » de DECISIONS §1 et §4 (« par vol » devient « par série de coups validée par sa cadence, en vol seulement, vol montré à part »), dans le commit du lot.
6. **Outils** : `outils/banc/pumping.mjs` (session surf foil synthétique : pompe sur une partie de chaque vol seulement, attentes des tuiles, du podium et des tableaux revues) ; `outils/banc/pumping-diagnostic.mjs` imprime aussi les séries (cadence, durée, coups, vitesse avant et après), pour le réglage du n° 27.

## Tests (`src/core/pumping.test.ts`, capture synthétique par `synthImu`)

- vol de 60 s avec 20 s de pompe à 1,5 Hz puis vol sans pompe : une série d'environ 20 s, le vol garde ses 60 s ;
- clapot à intervalles irréguliers pendant tout le vol : aucune série ;
- oscillation régulière hors de la plage de cadence du pumping (vibration rapide) : aucune série ;
- pompe régulière de 3 min : une seule série, entière ;
- vitesse qui baisse pendant la série : vitesse avant supérieure à après ;
- distance par coup égale à la distance de la série divisée par ses coups ;
- mêmes séries avec une capture à 50 et 200 Hz, une trace à 1 et 5 Hz (règle 2) ;
- les tests existants (saut isolé, chocs de l'eau avant le décollage, capture partielle) passent toujours.

## Vérification

- `npm run verif` ; banc `node outils/banc/passe.mjs` (scripts `pumping`, `onglets`) ; agent `relecture`.
- Sur données réelles : la capture du 26/10 (élaguée autour des sauts, des bouts de vol seulement) dans `pumping-diagnostic.mjs` si l'utilisateur en donne le chemin. Le vrai essai attend une sortie wing capturée entière, Pumping coché (essai 48), qui sert aussi au réglage des seuils (n° 27).

## Questions

- Q31 (répondue le 28/10, précisée le 31/10) : voir « Voulu ».
- Contradiction avec DECISIONS §1 et §4 (« par vol ») : levée par la décision du 31/10, lignes réécrites à l'étape 5.
- Lien avec le n° 27 (seuils, faux coups autour des sauts) : la structure se fait ici sur traces synthétiques ; le réglage des seuils attend la capture entière (essai 48).
