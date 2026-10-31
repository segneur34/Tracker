# 92 · Banc : passage courant en 2 minutes, `tailles` sur demande

Sonnet | medium. Outil seulement (`outils/banc/`), aucun fichier de `src/`. Brief écrit le 31/10 par l'orchestrateur d'après la ligne 92 de `docs/BACKLOG.md`.

## Le problème

Le passage courant de `node outils/banc/passe.mjs` (sans nom ni `--pages` ni `--tous`) joue `PASSAGE_COURANT` de `outils/banc/scripts.mjs` : `general`, `library`, `statistiques`, `profil`, `planning`, `onglets`, `tailles`, `bench`, `familles`, `cardio`. Il dure 7 à 8 minutes, presque entièrement à cause de `tailles` (toutes les pages à douze tailles d'écran et trois tailles de texte, transitions CSS relevées, délai 20 min, jamais réutilisé). Sans lui, un passage tient en 2 minutes environ. La plupart des lots ne touchent ni la mise en page ni les réglages : le relevé de `tailles` n'y apprend rien.

## À faire

1. Retirer `tailles` de `PASSAGE_COURANT`. Il reste lancé par son nom (`passe.mjs tailles`), par `--pages` (il porte toutes les étiquettes) et par `--tous`. Ne rien changer au script `tailles.mjs` lui-même ni à son entrée du registre.
2. Dans l'en-tête de `passe.mjs` (commentaire d'usage) et dans `outils/banc/LISEZMOI.md`, section « Lanceur », puce « Sélection » : dire que le passage courant ne comprend plus `tailles`, et qu'il se joue par son nom ou `--pages` quand le lot touche la mise en page, le thème ou Réglages. Une phrase, pas plus.
3. Regarder si un autre script du passage courant pèse plus d'une minute à lui seul (le tableau de fin donne la durée de chaque script) ; si oui, le dire dans le rapport sans le retirer : c'est à l'orchestrateur de décider.

## Garde-fous

- Aucun fichier hors `outils/banc/passe.mjs`, `outils/banc/scripts.mjs`, `outils/banc/LISEZMOI.md`.
- Pas de `docs/`, pas de commit, pas de version.
- Ne pas lancer `npm run verif` ni `vitest` pendant qu'un passage du banc tourne (le serveur Vite fait échouer vitest).

## Preuve

- `node outils/banc/passe.mjs` (arbre de travail seul, sans `--avant`) : le tableau ne liste plus `tailles`, tout le reste passe, et la dernière ligne donne le temps du passage : le relever, il doit être de l'ordre de 2 à 3 minutes.
- `node outils/banc/passe.mjs tailles --garder` n'est pas demandé (20 min) ; vérifier seulement que `passe.mjs tailles` et `passe.mjs --pages accueil` le sélectionnent bien, par exemple en lisant les lignes de sélection du code, ou en lançant puis en interrompant après la ligne de mise en route.
- `npm run lint` (oxlint couvre `outils/`).

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; temps du passage avant (7 à 8 min connus) et après ; script le plus long qui reste ; fichiers touchés.
