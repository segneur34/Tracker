# 30 · Noyau voile : détection une seule fois, confiance du vent, bruit à 5 Hz

Détail de l'élément 30 de `docs/BACKLOG.md`. Cahier du lot : les trois paragraphes du §11 d'ETAT ci-dessous, déplacés tels quels le 28/10 (lot 33) ; le §11 n'en garde qu'une ligne de fait et le renvoi. Fable, xhigh ; seul dans sa session ; relevé du vent du banc avant et après (§11 « Orientation fragile »). Brief du lot à écrire ici, sous ce qui suit.

Ligne de la file des lots (28/10) : « Noyau voile : détection une seule fois puis classement par candidat de vent (`observeTurns` fusionné), confiance du vent rabattue sur couverture polaire maigre, bruit indépendant rééprouvé à 5 Hz (ETAT §11) · Fable / xhigh · rien ; relevé du vent du banc avant et après ; seul dans sa session · à briefer ».

## Paragraphes du §11 d'ETAT, tels quels

- **Coût du vent à 5 Hz** (point 23) : environ 0,5 s à chaque mouvement du seuil sur 3 h à 5 Hz, contre 28 ms à 1 Hz.
  - Cause : `analyzeManeuvers` refait la détection des virages pour chaque candidat de vent, alors que seule la classification en dépend.
  - Piste : détecter une fois, puis classer par candidat. Le coût serait divisé par quatre environ, et la détection écrite une seconde fois dans `observeTurns` (`wind.ts`) serait fusionnée.
  - C'est un vrai refactor, à ne jamais faire seul (points 21, 26, 27).

- **5 Hz bruité** : depuis le point 185, le classement se lit sur des caps médians et les caps stabilisés se replient sur les fenêtres médianes ; un bruit de cap de ±8° qui ne dépend que du temps donne le même résultat à 1 Hz et à 5 Hz (testé). Un bruit indépendant d'un point à l'autre (le bruit « réaliste » des tests, positions et Doppler compris) n'a pas été rééprouvé à 5 Hz : le test des mesures à 1 et 5 Hz reste à bruit faible, et la cohérence (somme des pas, garde-fou à 0,5) dépend encore de la cadence.

- **Vent sur trace lente et peu échantillonnée** : la polaire annonce une confiance élevée sur une direction fausse de 180° (point 27). L'utilisateur corrige par « Inverser ». La confiance mériterait d'être rabattue quand la couverture polaire est maigre.

## À garder (§11 « Manœuvres », Lot D du 26/10)

`maneuvers.ts` et `wind.ts` portent maintenant `segmentStart` dans le pas unique et les distances, `localWind` arrondi puis normalisé, `buildWindTimeline` avec repli aux bords : toute retouche de la détection doit les garder.
