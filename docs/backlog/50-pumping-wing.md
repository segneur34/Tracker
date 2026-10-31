# 50 · Pumping en wing : la série de coups, pas le vol

## Tel que noté (28/10, 20:42, Tom)

« Problème avec l'onglet pumping dans le wing foil : il y a un mélange entre le pumping où il y a une cadence de pumping, va durer peu de temps à mon niveau (– de 30 sec) je perds de la vitesse pendant… Et entre le vol qui est le moment où je suis en vol en foil. Je pense que ça vient du fait que le pumping vient du calcul de surf foil mais c'est une mauvaise compréhension de ce qu'on veut dire par pumping. Lot important. »

## Tel que noté (31/10, Tom, marqué « important »)

« Il faut retravailler l'onglet pumping au moins en wing : actuellement il compte comme vol, mais il doit ne compter que s'il y a vol avec une cadence de pumping ; trouver pumping n'est pas égal à vol, même en surf foil et autre support à foil. »

Portée élargie : pas seulement le wing, **tous les supports à foil** (surf foil, planche à foil, kite foil…). Un vol sans cadence de coups ne compte pas comme du pumping.

## Où

Voile › une session de wing (ou de planche à foil) avec « Pumping » coché › onglet « pumping » ; `core/pumping.ts` (`measureFlightPumping`), `SAILING_PUMP_DETECTION` dans `core/sportProfiles.ts`, `useSessionPumping`.

## Aujourd'hui (lu dans la doc, à revérifier dans le code)

- Le pumping est mesuré **par vol** : coups, fréquence, distance pompée, temps de vol, vitesse de décollage (DECISIONS §1, ligne « Pumping foil ») ; replié, podium des 3 plus longs vols.
- Les seuils sont une copie de ceux du surf (`SAILING_PUMP_DETECTION`, vols de 10 s au moins), où l'on pompe pour se lancer sur la vague : un vol entier y est du pumping.
- Les sauts font de faux coups en série (n° 27).

## Voulu

Réponse du 28/10 : une **série de pumping** (cadence de coups, vitesse perdue pendant) est montrée **à part du vol** (tout le temps passé sur le foil), et **la cadence est ce qui compte le plus**. À ton niveau une série dure moins de 30 s, mais avec du meilleur matériel elle peut être bien plus longue : ne fixer aucune durée maximale. Le vol reste une mesure à part (temps de vol, décollage). À lire sur chaque série : cadence d'abord, puis début, durée, nombre de coups, vitesse avant / après.

## Pourquoi

Un vol entier compté comme du pumping mélange deux choses et rend les chiffres de l'onglet faux pour le wing.

## Questions

- Q31 (répondue le 28/10) : voir « Voulu ».
- Contradiction avec DECISIONS §1 (« par vol, coups, fréquence… ») : la décision du 28/10 suppose un pumping par vol ; à réviser avec la réponse à Q31.
- Lien avec le n° 27 (seuils, faux coups autour des sauts) : à traiter ensemble ; il attend une session wing capturée entière, Pumping coché (essai 48). Le 26/10 est la seule capture en main, élaguée autour des sauts.
