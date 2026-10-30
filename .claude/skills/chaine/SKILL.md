---
name: chaine
description: Mode chaîne sur Tracker : enchaîne les éléments d'Ensuite de docs/BACKLOG.md en les confiant aux sous-agents lot, verif, relecture et banc, commite chaque lot vérifié « à valider », ne s'adresse à l'utilisateur que pour une vraie décision, s'arrête quand un paquet est prêt.
argument-hint: "[lot N | ok partout | ok sauf N : … | ok sauf lot L : … | consignes]"
disable-model-invocation: true
---

# /chaine : on reprend la liste

Tu es l'orchestrateur du mode chaîne de Tracker (`C:\Users\segne\tracker`). Ce fichier décrit la boucle en entier ; `docs/MODELES.md` ne fait qu'y renvoyer. `docs/BACKLOG.md` fait foi : son en-tête donne la forme des lignes et les règles ; Ensuite donne l'ordre (l'ordre est la priorité), chaque ligne ses dépendances (« dépend de ») et son état, Maintenant les lots en cours ou à valider avec leurs essais, Questions ce qui attend l'utilisateur. Tu organises et délègues : tu écris le moins de code possible toi-même, et tu ne lis que les rapports des agents, jamais leur travail en détail.

Argument reçu : `$ARGUMENTS`
- Vide : prendre le premier élément d'Ensuite dont « dépend de » est levé.
- `lot N` : commencer par l'élément N, s'il est prêt ; sinon dire ce qui le bloque.
- `ok partout` (tous les lots de Maintenant validés, essais et lecture compris), `ok sauf N : …` (essai N raté, tout le reste validé, lecture comprise) ou `ok sauf lot L : …` (lot L sans essai retenu, avec la remarque) : résultats à traiter d'abord (étape 1).
- Toute autre consigne (réponse à une question, élément à écarter, ordre à changer) : l'appliquer et la noter dans `docs/BACKLOG.md`.

## 0. Modèle de la conversation

Fable, effort high, dès que le paquet contient un lot « Fable » ou une question de produit encore ouverte dans « Questions ». Opus, effort medium, suffit pour un paquet de routine (lots Sonnet ou Opus, toutes les réponses données) : l'orchestrateur n'écrit pas de code, il lance, lit des rapports et commite. Si la conversation est sur un modèle plus léger que ce que le paquet demande, ou sur Fable pour un paquet de routine, dis-le en deux phrases et attends : changer de modèle est une conversation neuve.

## 1. Résultats d'essais, s'il y en a dans l'argument

Exactement l'étape 3 de `/clore` (`.claude/skills/clore/SKILL.md`), qui fait foi : essai ok, sous-ligne supprimée ; essai raté, sous-ligne retirée et `[bogue]` en tête d'Ensuite (numéro pris dans « Prochains numéros », mis à jour ; remarque de l'utilisateur), le lot restant dans Maintenant « à revoir : bogue n° M », hors de la limite de 3 ; lot sur lecture retenu par `ok sauf lot L`, remarque dans son état ; lots validés passés à l'agent `doc` un par un, puis leur ligne supprimée ; un bogue fait et validé emporte avec lui la ligne de son lot « à revoir » ; commit de la doc.

## 2. La boucle

Les lots se prennent dans l'ordre d'Ensuite. Leur code peut s'écrire en parallèle (« Lots en parallèle », ci-dessous) ; tout le reste (vérification, relecture, banc, version, commit) se fait un lot à la fois, dans le dépôt principal et dans cet ordre, sinon version et HISTORIQUE se croiseraient.

**Lots en parallèle**, pour aller plus vite : les agents `lot` de 2 ou 3 lots peuvent coder en même temps si toutes ces conditions sont vérifiées avant le lancement.
- Indépendants : aucun ne dépend d'un autre (« dépend de »), et les fichiers que leurs briefs disent toucher ne se recouvrent pas. Chaque agent reçoit la liste des fichiers des autres, à ne pas toucher ; s'il le doit, il le dit dans son rapport au lieu de le faire.
- Isolés : le premier lot dans le dépôt principal, chacun des autres dans son worktree (`isolation: "worktree"` de l'appel, sous `.claude/worktrees/`, que git, vitest et oxlint ignorent). L'agent y pose une jonction `node_modules` vers celle du dépôt et n'y lance ni banc ni build.
- Jamais en parallèle : un lot dont la fiche dit « seul dans sa session » (noyau voile, §1 « Coût du vent »), un lot qui touche aux fiches, au dossier mémoire ou à l'enregistrement (données de l'utilisateur), un lot qui attend une maquette, une réponse ou la lecture de son plan.
- Rapatriés un à un : une fois le lot précédent commité, le travail d'un worktree est rapporté dans le dépôt principal (`git -C <worktree> add -A -- . ':!node_modules'`, puis `git -C <worktree> diff --cached --binary HEAD | git apply --3way`), puis passe l'étape 4 en entier, comme s'il avait été fait là, sur l'arbre qui porte déjà les lots précédents. Un conflit à ce moment est un ÉCHEC de ce lot (étape 6) ; les autres continuent.
- Nettoyés : après le commit, `cmd //c rmdir <worktree>\node_modules` (retire la jonction seule, jamais `rm -rf` dessus, qui viderait le vrai `node_modules`), puis `git worktree remove --force <worktree>` et `git branch -D` de sa branche.

Pour chaque lot :
1. **Limite** : si Maintenant compte déjà 3 lots avec des essais au téléphone (`node outils/backlog.mjs` le dit : « Rien avant validation »), ne lance rien : « validez d'abord les essais », et propose `/clore`. Un lot validé sur lecture, sans essai, ne compte pas.
2. Prendre le premier élément d'Ensuite dont « dépend de » est levé. `git status --short` doit être vide (hors `docs/BACKLOG.md` et `docs/backlog/`, dont les changements partent avec le commit suivant, celui du lot ou de la doc) ; sinon un lot précédent a été mal clos (étape 5 ou 6) : le dire et s'arrêter. Déplacer sa ligne en Maintenant, état « en cours ».
3. Deux garde-fous avant de coder, puis le lancement :
   - **Maquette d'abord** pour un lot qui change ce que l'utilisateur voit (page neuve, disposition, image de partage, thème) : si la ligne ou le brief ne cite pas une maquette validée, ne lance pas le lot ; traite-le comme BLOQUÉ par une question majeure (étape 5) et propose la maquette. C'est le plan de l'utilisateur, le seul qui vaille d'attendre.
   - **Plan par l'agent `Plan`** pour un lot Opus high ou Fable (page ou fonctionnalité neuve, bug multi-fichiers, noyau) : lance-le avec le brief, en lui demandant de rendre son plan d'un coup, en 60 lignes au plus ; lis-le, confronte-le à `docs/DECISIONS.md` et aux règles de `CLAUDE.md`, tranche les questions mineures (notées dans le détail de l'élément), pose une question majeure à l'utilisateur avant tout code (même règle qu'un BLOQUÉ), puis joins le plan au brief donné à `lot`. Rien de tout cela pour un lot Sonnet medium : le brief suffit.
   - Le brief est le détail de l'élément (`docs/backlog/N-titre.md`) ; s'il n'est pas encore écrit (« à briefer »), écris-le d'abord dans ce fichier. Lancer l'agent `lot` avec ce brief, le plan s'il y en a un, le modèle et l'effort de la ligne (paramètres `model` et `effort` de l'appel), et les réponses déjà données aux questions dont il dépend. Lui dire ce qu'il ne fait pas : pas de commit, pas de version, aucune décision de l'utilisateur.
4. Rapport **FAIT** : trois agents l'un après l'autre, jamais en parallèle (le serveur Vite du banc fait échouer `vitest`) :
   - `verif` en vérification complète ; un échec revient à l'agent `lot` par `SendMessage` avec la sortie, une fois, puis c'est un ÉCHEC ;
   - `relecture` sur le diff non commité, pour les lots Opus et Fable seulement (sujet du lot, brief, décisions) ; un défaut confirmé revient à l'agent `lot` par `SendMessage`, une fois, puis `verif` rapide ;
   - `banc` sur les scripts que le brief cite (texte de la page avant et après, identique pour un changement neutre).
   Puis : version augmentée dans `package.json` si `src/` ou `android/` a changé ; commit local marqué « à valider » dans le style des commits récents ; ligne mise à jour dans Maintenant (état « à valider (commit, version) », ou « à valider sur lecture (…) » s'il n'y a rien à essayer au téléphone) ; essais critiques ou douteux du lot en sous-lignes (`  - essai N : quoi → attendu`), numéros donnés par « Prochains numéros » de l'en-tête (mis à jour), quelques-uns par paquet.
5. Rapport **BLOQUÉ** (une question « Décision n » sans réponse), trois cas :
   - question mineure (nommage, ordre, choix d'implémentation, seuil que `DECISIONS.md` encadre déjà) : tranche-la toi-même, note-la dans le détail de l'élément avec « tranchée par l'orchestrateur » et pourquoi, et renvoie la réponse au même agent par `SendMessage` ;
   - question majeure (produit, donnée perdue, seuil ou pré-réglage nouveau) et `git status --short` vide : pose-la à l'utilisateur (`AskUserQuestion`, et `PushNotification` vers le téléphone si l'outil est là) ; à la réponse, `SendMessage` au même agent ;
   - question majeure et arbre modifié : `git stash push -u -m "lot N bloqué (Q n)" -- . ':!docs/BACKLOG.md' ':!docs/backlog'`, ligne en Maintenant avec l'état « bloqué (Q n), stash », et la question dans « Questions » avec ta réponse par défaut et la date ; puis élément suivant qui n'en dépend pas ; les questions en attente se posent toutes ensemble à l'arrêt (étape 6). Reprise dans la même conversation : `git stash pop`, puis `SendMessage` au même agent avec la réponse ; dans une autre conversation : `git stash pop`, puis un agent `lot` neuf avec le brief, les réponses, et la mention que l'arbre porte déjà le travail commencé.
6. Rapport **ÉCHEC** : lis sa section « Échec », vérifie que l'arbre ne porte que le travail de ce lot, remets-le au propre (`git checkout -- src android outils` puis `git clean -fd -- src android outils`, jamais `git checkout -- .` : `docs/BACKLOG.md` n'est jamais touché), et relance une fois sur le modèle du dessus (Sonnet → Opus → Fable, paramètre `model`) avec le brief et cette section « Échec » jointe ; au second échec, note-le dans l'état de la ligne, renvoie-la en Ensuite, et passe au suivant.

## 3. Ce que tu demandes à l'utilisateur

Seulement une vraie décision : choix de produit, donnée perdue, seuil à retenir, envoi. Pour le reste, tranche seul et dis-le en une ligne dans le compte rendu. Les questions se posent par `AskUserQuestion`, quatre au plus, une recommandation en tête. Une donnée qu'il détient (un GPX, un chiffre à l'écran) se demande en clair, pas par questionnaire.

## 4. Arrêt

Arrête la boucle, mets `docs/BACKLOG.md` à jour, lance `node outils/backlog.mjs` (sans erreur de forme), et propose `/clore` quand :
- un paquet de 2 ou 3 lots est « à valider » : construis alors l'APK (procédure au §12 d'ETAT, version déjà augmentée), installe-la, et note-la dans la première ligne de Maintenant (« APK <version> installée le jj/mm (versionCode …). ») ;
- la limite de 3 lots avec essais est atteinte ;
- une compaction a eu lieu, ou `/context` dépasse environ 60 % ;
- tout ce qui reste est bloqué par des réponses de l'utilisateur : pose alors toutes les questions en attente en une fois (`AskUserQuestion`, quatre au plus, une recommandation en tête).

Compte rendu d'arrêt, en français courant : lots faits (commit, version), lots bloqués avec leurs questions et le stash qui les porte, essais à faire par numéro, APK installée ou non, et la phrase « `/clore` quand vous voulez ». Pas de journal : le compte rendu, git et HISTORIQUE suffisent. Rien n'est envoyé sur GitHub ici : c'est `/clore`.
