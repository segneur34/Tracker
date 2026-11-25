# 235 · Fluidité : direct et analyses qui ne ralentissent plus

## Tel que noté

25/11/2026 : « vas faire un tour dans Gtracker pour regarder les modif qu'on fait dedans, et qu'on pourrais ajouter a tracker », puis, sur la liste numérotée : « Pendant la sortie » (point 19) et « tout Analyses » (point 17).

Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lu le 25/11 au commit ddc4281 ; voir un lot : `git -C "D:/gong tracker/Gtracker" show <commit>`. Reprise à la main, jamais par copie en bloc : là-bas le code n'a plus ni course, ni vélo, ni entraînement, ses textes passent par la traduction, et l'apparence est la sienne (rien de cela ne vient).

## Ce qui vient

| Étape | Ce qui vient | Lots Gtracker |
|---|---|---|
| 1 | Direct : les chiffres ne reparcourent plus toute la trace, la cinématique ne recopie plus rien | 402 (f8b6324, e83fc66) |
| 1 | Direct : la carte ne retravaille que la fin de la trace (blocs de 300 points) | 399 partie 2 (040b7b1) |
| 2 | Analyse calculée en arrière-plan, l'écran se fige moins | 400 (99b156e, 944f8c0, bf0b304) |

## Aujourd'hui dans Tracker (vérifié le 25/11)

La lecture d'un GPX et les vignettes passent déjà par le calcul de fond (`src/library/trackWorker.ts`) ; l'analyse elle-même est dans la page (`src/hooks/useSailingSession.ts`, `useMemo`). `src/recording/liveStats.ts` reprend déjà sa cinématique et ne calcule un segment fermé qu'une fois : mesurer avant de copier, une partie du gain y est peut-être déjà.

Étape 2 : d'abord voile et surf, puis le module terrestre (`src/pages/LandModule.tsx`), absent de Gtracker. Chiffres identiques, prouvés au banc.

Écarté : la trace en 64 nuances (399 partie 1), contraire à « dégradé continu, ni paliers » (CLAUDE.md) ; l'image du fond de page (399 partie 3), propre à Gtracker.
