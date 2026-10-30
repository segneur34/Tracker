# 51 · Profil › racine : les deux ronds blancs au bout de la racine

| Modèle | Réflexion |
|---|---|
| Sonnet | medium |

## Constat

Sur la page Profil, la racine dessinée autour des cadres porte encore deux ronds clairs, un au bout de chaque pointe. La décision du 27/10 (`docs/DECISIONS.md` §9, « Racine ») dit : « Aucun rond blanc au bout des radicelles. »

Cause : `drawBuds` (`src/components/drawRoot.ts`, vers la ligne 198) dessine un bourgeon rempli de `--root-bud` (`#d5ecc2` en clair, `#a8d48c` en sombre, presque blanc à l'écran) cerclé de `--root-edge` au bout de chaque branche principale (`model.mains`, deux pointes), appelé en fin de dessin quand `frame.progress >= 1 && frame.wither === 0` (vers la ligne 379).

## À faire

- Retirer `drawBuds` et son appel.
- Retirer ce qui ne sert plus qu'à lui : le champ `bud` de `RootColors` et sa ligne dans la table des variables, la variable `--root-bud` des deux thèmes de `src/theme/tokens.css` (vérifier par Grep qu'elle n'est lue nulle part ailleurs).
- Rien d'autre dans le dessin de la racine : fleur, feuilles, radicelles, sol inchangés.

## Vérification

- Typecheck, lint, tests (`npm run verif` rapide).
- Banc : script `profil` (`node outils/banc/passe.mjs profil --avant HEAD`) : le texte de la page doit être identique avant et après (le dessin est sur un canvas, seul le texte est comparé).
- Pas d'essai au téléphone : l'utilisateur jugera à l'œil, sur lecture.
