# 31 : dépendances (TypeScript 7, @types/node 26, failles uuid)

Modèle | Réflexion : Opus | medium. Pas de question ouverte.

Lire d'abord : `docs/HISTORIQUE.md` point 180 (lot 14 : `npm update` et `npm audit fix` sans `--force`, TypeScript 7 et `@types/node` 26 laissés pour ce lot, trois failles modérées `uuid` via `xcode` via `@capacitor/cli`), `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `CLAUDE.md` « Commandes ».

## Voulu

1. **Mineures** : `npm update` (Capacitor 8.6.0 au 28/10, et ce qui suit dans sa majeure). Plages de `package.json` relevées au niveau installé.
2. **TypeScript 7** (`typescript` ~7.x) : le compilateur réécrit en Go. Vérifier avant tout que `tsc -b` (mode build, références de projet, `.tsbuildinfo`), `noUnusedLocals`, `verbatimModuleSyntax` et les options des trois `tsconfig` sont acceptés ; retirer ou remplacer une option supprimée en 7 (lire le message d'erreur, pas deviner). Corriger les nouvelles erreurs de type dans le code sans changer aucun comportement (pas de `any`, pas de `@ts-ignore` ; un `as` seulement s'il est prouvé sûr). Si un outil du dépôt importe l'API JavaScript de `typescript` (rien trouvé à l'orchestrateur sous `outils/` ni à la racine), le signaler.
3. **`@types/node` 26** : seulement si TypeScript 7 passe ; erreurs de type corrigées de même.
4. **Failles `uuid`** : lancer `npm audit` et lire ce que `npm audit fix --force` ferait (`npm audit fix --force --dry-run`). Ne l'appliquer que s'il ne fait ni descendre ni changer de majeure `@capacitor/cli` ou un autre paquet direct ; sinon, essayer une surcharge `overrides` de `uuid` dans `package.json` à une version corrigée compatible, et la garder seulement si `npx cap sync android` passe. Faute de solution propre, laisser les trois failles (outils de développement seulement) et le dire.
5. `npx cap sync android` à la fin (Capacitor a bougé) ; ne pas construire l'APK (l'orchestrateur le fait).

## Si TypeScript 7 bloque

Si `tsc -b` en 7 ne marche pas avec ce dépôt (mode build absent, option indispensable retirée, plus d'une vingtaine d'erreurs qui demandent de vrais choix) : revenir à `typescript` ~6, garder le reste du lot, et rendre FAIT avec une section « TypeScript 7 laissé » (cause précise, message d'erreur, ce qu'il faudrait). Ce n'est pas un ÉCHEC.

## Vérification

`npx tsc -b --force`, `npm run lint`, `cmd //c "cd /d C:\Users\segne\tracker && npx vitest run"`, `npm run build`. Comparer la taille du bundle produit avant et après (sortie de `vite build`) et la rendre dans le rapport.

## Ce que tu ne fais pas

Pas de commit, pas de version, pas d'APK, aucune décision de l'utilisateur, aucun changement de comportement ni d'aspect, pas de dépendance nouvelle.

## Rapport

FAIT / BLOQUÉ / ÉCHEC ; versions avant et après de chaque paquet changé ; options de `tsconfig` touchées et pourquoi ; fichiers de `src/` touchés (nombre, et la nature des corrections) ; état des failles `npm audit` ; tailles du bundle avant et après.
