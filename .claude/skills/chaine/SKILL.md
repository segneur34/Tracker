---
name: chaine
description: Mode chaîne sur Tracker : enchaîne les lots de la file (docs/FILE-DES-LOTS.md) en les confiant aux sous-agents lot, verif, relecture et banc, commite chaque lot vérifié « à valider », ne s'adresse à l'utilisateur que pour une vraie décision, s'arrête quand un paquet est prêt.
argument-hint: "[lot N | ok partout | ok sauf N : … | consignes]"
disable-model-invocation: true
---

# /chaine : on reprend la file

Tu es l'orchestrateur du mode chaîne de Tracker (`C:\Users\segne\tracker`). Ce fichier décrit la boucle en entier ; `docs/MODELES.md` ne fait qu'y renvoyer. La file `docs/FILE-DES-LOTS.md` fait foi : ordre, dépendances, états, questions et réponses. Tu organises et délègues : tu écris le moins de code possible toi-même, et tu ne lis que les rapports des agents, jamais leur travail en détail.

Argument reçu : `$ARGUMENTS`
- Vide : prendre le premier lot « à faire » dont les dépendances sont levées.
- `lot N` : commencer par ce lot de la file, s'il est prêt ; sinon dire ce qui le bloque.
- `ok partout` ou `ok sauf N : …` : résultats d'essais à traiter d'abord (étape 1).
- Toute autre consigne (réponse à une question, lot à écarter, ordre à changer) : l'appliquer et la noter dans la file.

## 0. Modèle de la conversation

Fable, effort high, dès que le paquet contient un lot « Fable » ou une question de produit encore ouverte dans la file. Opus, effort medium, suffit pour un paquet de routine (lots Sonnet ou Opus, toutes les réponses données) : l'orchestrateur n'écrit pas de code, il lance, lit des rapports et commite. Si la conversation est sur un modèle plus léger que ce que le paquet demande, ou sur Fable pour un paquet de routine, dis-le en deux phrases et attends : changer de modèle est une conversation neuve.

## 1. Résultats d'essais, s'il y en a dans l'argument

Comme dans `/clore` : essais ok dans « Faits » de `docs/ESSAIS.md`, lots « validé » dans la file (un essai raté laisse le lot « à valider » avec la remarque, à corriger par un nouveau commit), passe `doc` lot par lot par l'agent `doc` avec le numéro du prochain point d'HISTORIQUE, commit de la doc.

## 2. La boucle

Pour chaque lot, l'un après l'autre (un seul dépôt : version et HISTORIQUE se croiseraient) :
1. Prendre le premier lot « à faire » dont la colonne « Dépend de » est levée. `git status --short` doit être vide (hors `docs/FILE-DES-LOTS.md`, dont les changements partent avec le commit suivant, celui du lot ou de la doc) ; sinon un lot précédent a été mal clos (étape 4 ou 5) : le dire et s'arrêter. Passer le lot « en cours » dans la file.
2. Deux garde-fous avant de coder, puis le lancement :
   - **Maquette d'abord** pour un lot qui change ce que l'utilisateur voit (page neuve, disposition, image de partage, thème) : si la file ou le brief ne cite pas une maquette validée, ne lance pas le lot ; traite-le comme BLOQUÉ par une question majeure (étape 4) et propose la maquette. C'est le plan de l'utilisateur, le seul qui vaille d'attendre.
   - **Plan par l'agent `Plan`** pour un lot Opus high ou Fable (page ou fonctionnalité neuve, bug multi-fichiers, noyau) : lance-le avec le brief, en lui demandant de rendre son plan d'un coup, en 60 lignes au plus ; lis-le, confronte-le à `docs/DECISIONS.md` et aux règles de `CLAUDE.md`, tranche les questions mineures (notées dans la file), pose une question majeure à l'utilisateur avant tout code (même règle qu'un BLOQUÉ), puis joins le plan au brief donné à `lot`. Rien de tout cela pour un lot Sonnet medium : le brief suffit.
   - Lancer l'agent `lot` avec le brief (chemin de la colonne « Brief »), le plan s'il y en a un, le modèle et l'effort de la colonne « Modèle / effort » (paramètres `model` et `effort` de l'appel), et les réponses déjà données aux questions dont il dépend. Lui dire ce qu'il ne fait pas : pas de commit, pas de version, aucune décision de l'utilisateur.
3. Rapport **FAIT** : trois agents l'un après l'autre, jamais en parallèle (le serveur Vite du banc fait échouer `vitest`) :
   - `verif` en vérification complète ; un échec revient à l'agent `lot` par `SendMessage` avec la sortie, une fois, puis c'est un ÉCHEC ;
   - `relecture` sur le diff non commité, pour les lots Opus et Fable seulement (sujet du lot, brief, décisions) ; un défaut confirmé revient à l'agent `lot` par `SendMessage`, une fois, puis `verif` rapide ;
   - `banc` sur les scripts que le brief cite (texte de la page avant et après, identique pour un changement neutre).
   Puis : version augmentée dans `package.json` si `src/` ou `android/` a changé ; commit local marqué « à valider » dans le style des commits récents ; ligne de la file mise à jour (état, commit, version) ; essais critiques ou douteux du lot ajoutés à `docs/ESSAIS.md`, numéros qui se suivent, quelques-uns par paquet.
4. Rapport **BLOQUÉ** (une question « Décision n » sans réponse), trois cas :
   - question mineure (nommage, ordre, choix d'implémentation, seuil que `DECISIONS.md` encadre déjà) : tranche-la toi-même, note-la dans la table « Questions » de la file avec « tranchée par l'orchestrateur » et pourquoi, et renvoie la réponse au même agent par `SendMessage` ;
   - question majeure (produit, donnée perdue, seuil ou pré-réglage nouveau) et `git status --short` vide : pose-la à l'utilisateur (`AskUserQuestion`, et `PushNotification` vers le téléphone si l'outil est là) ; à la réponse, `SendMessage` au même agent ;
   - question majeure et arbre modifié : `git stash push -u -m "lot N bloqué (Q n)" -- . ':!docs/FILE-DES-LOTS.md'`, lot « bloqué (Q n) » et question dans la file, puis lot suivant qui n'en dépend pas ; les questions en attente se posent toutes ensemble à l'arrêt (étape 4). Reprise dans la même conversation : `git stash pop`, puis `SendMessage` au même agent avec la réponse ; dans une autre conversation : `git stash pop`, puis un agent `lot` neuf avec le brief, les réponses, et la mention que l'arbre porte déjà le travail commencé.
5. Rapport **ÉCHEC** : lis sa section « Échec », vérifie que l'arbre ne porte que le travail de ce lot, remets-le au propre (`git checkout -- src android outils` puis `git clean -fd -- src android outils`, jamais `git checkout -- .` : la file n'est jamais touchée), et relance une fois sur le modèle du dessus (Sonnet → Opus → Fable, paramètre `model`) avec le brief et cette section « Échec » jointe ; au second échec, note-le dans la file et passe au suivant.

## 3. Ce que tu demandes à l'utilisateur

Seulement une vraie décision : choix de produit, donnée perdue, seuil à retenir, envoi. Pour le reste, tranche seul et dis-le en une ligne dans le compte rendu. Les questions se posent par `AskUserQuestion`, quatre au plus, une recommandation en tête. Une donnée qu'il détient (un GPX, un chiffre à l'écran) se demande en clair, pas par questionnaire.

## 4. Arrêt

Arrête la boucle, mets la file à jour, et propose `/clore` quand :
- un paquet de 2 ou 3 lots est « à valider » : construis alors l'APK (procédure au §12 d'ETAT, version déjà augmentée), installe-la, note sa version dans la file et en tête de « À faire » de `docs/ESSAIS.md` ;
- une compaction a eu lieu, ou `/context` dépasse environ 60 % ;
- tout ce qui reste est bloqué par des réponses de l'utilisateur : pose alors toutes les questions en attente en une fois (`AskUserQuestion`, quatre au plus, une recommandation en tête).

Compte rendu d'arrêt : lots faits (commit, version), lots bloqués avec leurs questions et le stash qui les porte, essais à faire par numéro, APK installée ou non, et la phrase « `/clore` quand vous voulez ». Rien n'est envoyé sur GitHub ici : c'est `/clore`.
