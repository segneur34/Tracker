# 106 · Allure en milles : restes du lot 98

Modèle | Réflexion : Sonnet | medium. Petit lot, dette.

## Problème

Le lot 98 (HISTORIQUE point 236) a rendu l'unité de distance obligatoire pour afficher une allure à pied et à vélo : `formatLandSpeed(ms, unit, distanceUnit)` (`core/units.ts`). En allure (`minkm`) avec une distance en milles nautiques, `formatSpeed(ms, unit)` sans unité de distance affiche une allure par kilomètre, symbole « min/km », alors que tout le reste de l'application montre « min/NM » : chiffre faux en silence. Trois écrans appellent encore `formatSpeed` sans unité de distance :

- `src/pages/RecordingPage.tsx`, chiffres du direct, lignes 218 à 267 (`formatSpeed(..., unit)`) ; `distanceUnit` est déjà calculé à la ligne 206 et sert au libellé « Dernier mille » de la ligne 236. Le bloc des lignes 266-267 (bords du direct) : vérifier que l'unité de distance y est disponible, sinon la calculer de la même façon (`effectiveDistanceUnit(activity)`).
- `src/components/EffortThresholdEditor.tsx`, ligne 52 (« tiré de la session : … »).
- `src/components/FitnessTestPanel.tsx`, lignes 127 et 130 (survol du graphe : vitesse lue et cible) ; la ligne 186 passe par `editSpeedUnit`, donc jamais une allure : la laisser.

## À faire

1. Pour chacun des trois écrans, dire si l'unité de vitesse peut y être une allure (famille à pied ou vélo, `minkm`). Pour tous ceux où c'est possible : remplacer `formatSpeed(ms, unit)` par `formatLandSpeed(ms, unit, distanceUnit)`, en passant l'unité de distance de l'activité (`effectiveDistanceUnit` ou la prop déjà reçue par le parent). Pour `EffortThresholdEditor` et `FitnessTestPanel`, ajouter une prop `distanceUnit: DistanceUnit` et la fournir depuis les appelants (`grep -rn "EffortThresholdEditor\|FitnessTestPanel" src`), avec l'unité de distance de l'activité qu'ils connaissent déjà.
2. Les écrans de voile et de surf gardent `formatSpeed` (jamais d'allure).
3. Aucun nouveau seuil, aucun changement de réglage, aucune décision de l'utilisateur à prendre.

## Vérification

`node outils/verif.mjs --rapide` (typecheck strict, lint, tests touchés). Un `grep -rn "formatSpeed(" src/pages/RecordingPage.tsx src/components/EffortThresholdEditor.tsx src/components/FitnessTestPanel.tsx` ne doit plus rendre que des appels avec une unité de distance (ou le cas `editSpeedUnit` de `FitnessTestPanel`).

## Ne fait pas

Pas de commit, pas de version, pas de banc, pas de build.
