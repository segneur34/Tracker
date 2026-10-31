# 91 · Banc : remettre d'aplomb les scripts qui échouent

Sonnet | medium. Outil seulement (`outils/banc/`), aucun fichier de `src/` : ce sont les scripts qui sont périmés, pas l'application. Brief écrit le 31/10 par l'orchestrateur d'après la ligne 91 de `docs/BACKLOG.md` et la section « Scripts à revoir » de `outils/banc/LISEZMOI.md`. Dépend du n° 92 (fait avant : `tailles` n'est plus dans le passage courant).

## Principe

Un script du banc décrit l'application telle qu'elle est aujourd'hui (`docs/DECISIONS.md` et `docs/ETAT_DU_PROJET.md` font foi) ; quand l'application a changé après lui (page renommée, tuile déplacée, version de mémoire montée), c'est le script qu'on met à jour, jamais l'application. Un contrôle qui échoue est d'abord lu : si l'application fait bien ce que DECISIONS demande, le contrôle est faux ; si elle ne le fait pas, c'est un défaut de l'application, à **rapporter sans le corriger** (section « Défauts de l'application » du rapport), le contrôle restant en place.

Lire en tête de chaque script son mode d'emploi, et `outils/banc/LISEZMOI.md` (« Lanceur », « Bibliothèque », « Pièges du poste », « Scripts à revoir ») avant de commencer.

## À faire, dans cet ordre

Chaque script se rejoue seul par `node outils/banc/passe.mjs <nom>` (arbre de travail seul, pas d'`--avant`), `-j 1` si la machine est chargée, `--temps 10` pour les scripts `accelerable`. Un script est d'aplomb quand il rend `ok` sans ligne `ÉCHEC`, deux fois de suite.

1. `test-fcmax` (18 échecs) : tuiles et adresse `/fractionne/seances` périmées ; reprendre les adresses et les libellés de la page Entraînement et des tests tels qu'ils sont aujourd'hui (`src/pages/`, `core/analysisTabs.ts`).
2. `marche` (4) : l'application est passée en version 9 de la mémoire avec « Muscu » ; adapter le script.
3. `glisser` (4), `satellite` (2), `partage`, `reglages-aide` (« textes courts »), `test-fcrepos` (« courbe du test gardé affichée »), `onglets` (« Voile : tous montrés, tops et sauts compris ») : lire chaque échec, mettre le contrôle à jour ou rapporter le défaut.
4. `library3` : expression de page cassée qui rend `undefined` ; la corriger.
5. `library.mjs` s'arrête sans `--captures` : le laisser tourner sans captures (captures facultatives, comme les autres scripts avec `{captures?}`).
6. `prereglages` : l'étape « bateau : pause réglée à 0,5 km/h » échoue côté après sous `passe.mjs` (deux passages le 31/10) et passe à la main contre le même arbre. Comprendre d'où vient la différence du serveur généré par le lanceur (config Vite du brouillon, préchauffage sur un profil, dossier mémoire de travail déjà servi : voir la note sur `prereglages.mjs` dans « Scripts à revoir ») et corriger le lanceur ou le script, pas l'application.
7. `brouillon-voile` : contrôle « B n'affiche jamais le vent de A » intermittent des deux côtés (relevés à 20 ms près). Le rendre fiable (attente d'un état plutôt que d'un délai) sans affaiblir ce qu'il prouve ; si c'est impossible sans affaiblir, le dire.
8. `recherche-sans-reponse.mjs` à finir : étapes manquantes, délais réseau de 30 et 120 s, question ouverte le 29/10 (aucun message ni « Réessayer » relevé après 170 s alors que `fetchWithin` abandonne bien). Y consacrer un temps borné : s'il ne se finit pas proprement, le marquer `manuel` dans le registre avec la raison, et expliquer dans le rapport ce qui manque.
9. Idée à essayer en dernier, seulement si le reste est fait : ouvrir un `AudioContext` dans `connect()` de `lib/cdp.mjs` (ou là où la page se connecte) quand `TEMPS > 1`, le premier coûtant 600 ms réels, soit 6 s de page à ×10. La garder seulement si les sorties des scripts `accelerable` restent identiques (`compteur-course`, `notes`, `test-fcmax`).
10. Mettre à jour la section « Scripts à revoir » de `LISEZMOI.md` : retirer ce qui est réglé, garder ce qui reste avec sa raison.

## Garde-fous

- Aucun fichier hors `outils/banc/` ; `src/` ne bouge pas. Un défaut de l'application se rapporte, ne se corrige pas.
- Pas de `docs/` hors `outils/banc/LISEZMOI.md`, pas de commit, pas de version.
- Ne pas lancer `npm run verif` ni `vitest` pendant qu'un passage du banc tourne.
- Un contrôle n'est jamais supprimé pour faire passer un script : il est mis à jour ou expliqué.

## Preuve

- Chaque script repris : `node outils/banc/passe.mjs <nom>` rend `ok`, deux fois de suite, et le rapport en donne la ligne du tableau.
- Le passage courant entier (`node outils/banc/passe.mjs`) passe encore.
- `npm run lint`.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; par script : ce qui était périmé et ce qui a changé, ou pourquoi il reste à revoir ; section « Défauts de l'application » (ce que le script a trouvé et qui n'est pas de son fait) ; fichiers touchés.
