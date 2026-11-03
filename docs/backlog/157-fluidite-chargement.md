# 157 · Fluidité et chargement des analyses : lecture abandonnée quand on quitte, allure écrite à la validation, état « lecture en cours »

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes C1, C2, C4 ; détail dans `angle-C7a.md` (C7a-1, C7a-2, C7a-5 à C7a-8), `angle-T7.md` (T7-2)). Modèle | Réflexion : Opus | high. Le zoom qui redessine toute la page (C7a-3) est repris par le n° 127, réorienté.

## Tel que noté

- « Quitter une analyse pendant la lecture du GPX ne l'abandonne pas : la page suivante se fige quand même (5 s à ×6), et rouvrir la session relit tout. »
- « Champ "Allure de la session" : toute l'analyse recalculée à chaque chiffre tapé ("1", "12", "12,5" = trois recalculs, ≈ 5 s chacun à ×6). »
- « Analyses voile et surf : aucun état "lecture en cours" pendant les 10 à 18 s de chargement ; on voit une carte vide. »

## Où, aujourd'hui (vérifié au commit 312d13c)

- `hooks/useLibraryNavigation.ts` `useSessionFromUrl` : l'effet de chargement n'a pas de fonction de nettoyage ; `loadedFor` est une référence qui garde sa valeur au démontage ; `onLoad` → `loadGpxContent` → `parseGpx` synchrone sur le fil principal, puis `setSession` sur un composant démonté.
- `pages/SailingModule.tsx` : `SessionThresholdField` « Allure de la session » écrit `draft.update({ referenceSpeedMs })` à chaque frappe valide ; `useGpxSession` a `referenceSpeedMs` dans les dépendances de `computeKinematics` : tout le pipeline (cinématique, cumuls, tops, manœuvres, vent, VMG, polaire, couleurs) est refait, sans `useDeferredValue` (contrairement au seuil d'activité).
- `components/AnalysisShell.tsx:96-100` : `empty` vaut `trackData.length === 0 && requestedFile === null` ; une session demandée mais pas encore lue n'a aucun texte.
- Aussi relevés : « avancé » remis à zéro par un effet après le premier rendu de la nouvelle session (C7a-5) ; bornes de couleur reconstruisant les 54 000 traits à chaque frappe (C7a-6) ; commentaire qui redessine tout le module à chaque caractère (C7a-7).

## Voulu

- Un drapeau d'abandon posé par le nettoyage de l'effet et testé avant `onLoad` (fonction pure qui reçoit « encore monté ? »).
- L'allure écrite dans le brouillon à Entrée ou en quittant le champ (comme l'angle du vent, `WindAdjustOverlay`), ou différée comme le seuil.
- Un état « Lecture de la session… » dans `useLibraryNavigation`, affiché par `AnalysisShell` avant le calcul ; `MemoryStatus compact` en tête de Statistiques et du Profil quand la mémoire est inaccessible (T7-3).
- Au passage : bornes de couleur et commentaire écrits au `blur` ou différés ; « nouvelle session » décidé pendant le rendu (comparaison de clé) plutôt que par un effet.

## Pourquoi

Les relevés du lot 114 (10 à 18 s de gel à ×6) ne sont pas réduits par ces corrections, mais elles évitent le travail inutile et les recalculs par frappe, visibles à chaque sortie.
