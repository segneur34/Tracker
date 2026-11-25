# 234 · Analyses : ce qui vient de Gtracker

## Tel que noté

25/11/2026 : « vas faire un tour dans Gtracker pour regarder les modif qu'on fait dedans, et qu'on pourrais ajouter a tracker », puis, sur la liste numérotée : « tout Analyses » (points 13 à 18 ; le 17, l'analyse en arrière-plan, est au n° 235).

Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lu le 25/11 au commit ddc4281 ; voir un lot : `git -C "D:/gong tracker/Gtracker" show <commit>`. Reprise à la main, jamais par copie en bloc : là-bas le code n'a plus ni course, ni vélo, ni entraînement, ses textes passent par la traduction, et l'apparence est la sienne (rien de cela ne vient).

## Ce qui vient

| Ce qui vient | Lots Gtracker |
|---|---|
| Toucher une tuile de « général » ouvre son onglet, la retoucher le ferme ; tuile reconnaissable | 470 (bea11d1), 473 (5a654be), 474 (fe1a855) |
| Fermer un onglet efface de la carte ce qu'il y affichait (virements, empannages, indécis compris) | 471 (e6919ae) |
| « Général » : Sauts et Plus haut saut, Cadence de pumping et Part du vol pompée, quand la session les porte ; pumping coché d'office en surf foil | 426 (2322dc8, 8d6fbaa) |
| Le brouillon d'une session survit à la fermeture de l'application | 397 (c223e5f) |
| Téléphone droit : carte d'un bord à l'autre ; cadres plus rapprochés (12 → 6 px, 20 → 10 px) | 368 (f5caadd), 430 (c39cd8c) |

## Aujourd'hui dans Tracker (vérifié le 25/11)

Cases virements et empannages : états `showTacksOnMap` et voisins, hors de `useMapHighlight` (`src/pages/SailingModule.tsx`). Brouillon en mémoire seule (`src/hooks/useSessionDraft.ts`). Aucune tuile n'ouvre d'onglet.

À étendre ici à la course, au vélo et à l'entraînement, que Gtracker n'a pas : table des tuiles (D+, FC, cadence, pente…), brouillons (poids du vélo, charge, altitude), surbrillances. Le code commun ne doit importer ni `running/`, ni `cycling/`, ni `land/` (règle 13).

## Contradictions, réponse par défaut

- CLAUDE.md, pré-réglages repris du téléphone de l'utilisateur : le pumping passe coché d'office sur le calcul surf, sans effet hors foil (demandé ; `PRESET_RESETS` à regarder).
- CLAUDE.md, « ne rien déplacer ni dupliquer sans redemander » : les tuiles de sauts et de pumping ajoutées à « général » sont demandées, dans l'ordre de Gtracker.
- Espaces et carte bord à bord : `docs/MISE_EN_PAGE.md` à accorder, petite planche avant (le fond de page diffère).

## Vérifié en passant (25/11)

Les onglets que le script du banc `surf.mjs` retrouvait ouverts à 390 px venaient du script lui-même (`outils/banc/lib/onglets.mjs` reclique les onglets retenus) : l'application rouvre bien « général » seul.
