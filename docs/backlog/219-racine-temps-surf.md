# 219 · Racine du Profil : une session de surf compte tout son temps à l'eau

## Tel que noté

17/11/2026, 07:47 : « La session de surf du lundi 16 nov ne compte pas pour la racine, pourquoi ? »

## Aujourd'hui (vérifié le 18/11)

`src/hooks/useProfileRoot.ts` donne à `rootGrowth` (`src/library/rootGrowth.ts`) le temps de chaque session : `movingTimeS ?? (endMs - startMs) / 1000`. En surf, `movingTimeS` du résumé est le temps de glisse (`summary.glisseS` de `runSurfSession`, `src/library/summary.ts`, vers la ligne 155), donc les vagues seules. Fiches lues le 16/11 : paddle foil de 14 h 26 à 15 h 30, `movingTimeS` 0 ; paddle de 15 h 32 à 16 h 11, `movingTimeS` 33 s. La racine a compté 33 s pour 1 h 43 à l'eau.

## Voulu (réponse Q71 de l'utilisateur, 18/11)

Pour la racine, une session de la famille surf compte **tout son temps à l'eau, pauses déduites** : rame, attente et vagues. Les autres familles ne changent pas (temps en mouvement, sinon durée).

## Comment

- Le temps « pauses déduites » : la durée de la session moins les pas qui couvrent une pause (un `<trkseg>` neuf ouvre chaque pause ; DECISIONS §6 : le pas qui la couvre ne compte ni en distance ni en temps). Chercher d'abord s'il existe déjà un calcul de durée hors pauses (piste : `activeDurationS` de `core/heartRateSession.ts`, employé par `summary.ts` vers la ligne 326 pour les sessions sans position). S'il faut le tirer du GPX, c'est un champ du résumé (`SessionSummary`, `library/record.ts`), avec `SUMMARY_CALC_VERSION` augmenté (règle de `CLAUDE.md`), puis porté par `StatSession` (`library/stats.ts`, `statSessionOf`). Ne pas changer le sens de `movingTimeS` en surf : il reste le temps de glisse, montré ailleurs.
- Repli si une vieille fiche n'a pas le champ : `endMs - startMs`.
- `useProfileRoot` choisit ce temps pour `family === 'surf'`. La logique pure de `rootGrowth` ne bouge pas.
- Test sur session synthétique : une session de surf de 1 h avec une pause de 10 min compte 50 min ; une course garde son temps en mouvement. Mettre à jour le commentaire de `useProfileRoot`.

## Fichiers probables

`src/hooks/useProfileRoot.ts`, `src/library/stats.ts`, et seulement si un champ est nécessaire : `src/library/summary.ts`, `src/library/record.ts`, leurs tests.

## Banc

Aucun script obligatoire ; si un script du Profil existe (`outils/banc/SCRIPTS.md`), le passer.
