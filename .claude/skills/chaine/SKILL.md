---
name: chaine
description: Mode chaîne sur Tracker : enchaîne les lots de la file (~/.claude/plans/FILE-DES-LOTS.md) en les confiant aux sous-agents lot, verif et banc, commite chaque lot vérifié « à valider », ne s'adresse à l'utilisateur que pour une vraie décision, s'arrête quand un paquet est prêt.
argument-hint: "[lot N | ok partout | ok sauf N : … | consignes]"
disable-model-invocation: true
---

# /chaine : on reprend la file

Tu es l'orchestrateur du mode chaîne de Tracker (`C:\Users\segne\tracker`), décrit dans `docs/MODELES.md`, section « Mode chaîne », et dans `CLAUDE.md`. La file `~/.claude/plans/FILE-DES-LOTS.md` fait foi : ordre, dépendances, états, questions et réponses. Tu organises et délègues ; tu écris le moins de code possible toi-même.

Argument reçu : `$ARGUMENTS`
- Vide : prendre le premier lot « à faire » dont les dépendances sont levées.
- `lot N` : commencer par ce lot de la file, s'il est prêt ; sinon dire ce qui le bloque.
- `ok partout` ou `ok sauf N : …` : résultats d'essais à traiter d'abord (étape 1).
- Toute autre consigne (réponse à une question, lot à écarter, ordre à changer) : l'appliquer et la noter dans la file.

## 0. Vérification du modèle

Le mode chaîne tourne sur Fable, effort high. Si la conversation est sur un autre modèle, dis-le en deux phrases et attends : changer de modèle est une conversation neuve.

## 1. Résultats d'essais, s'il y en a dans l'argument

Comme dans `/clore` : essais ok dans « Faits » de `docs/ESSAIS.md`, lots « validé » dans la file (un essai raté laisse le lot « à valider » avec la remarque, à corriger par un nouveau commit), passe `doc` lot par lot par l'agent `doc` avec le numéro du prochain point d'HISTORIQUE, commit de la doc.

## 2. La boucle

Pour chaque lot, l'un après l'autre (un seul dépôt : version et HISTORIQUE se croiseraient) :
1. Prendre le premier lot « à faire » dont la colonne « Dépend de » est levée ; le passer « en cours » dans la file.
2. Lancer l'agent `lot` avec le brief (chemin de la colonne « Brief »), le modèle et l'effort de la colonne « Modèle / effort », et les réponses déjà données aux questions dont il dépend. Lui dire ce qu'il ne fait pas : pas de commit, pas de version, aucune décision de l'utilisateur.
3. Rapport **FAIT** : agent `verif` en vérification complète ; agent `banc` sur les scripts que le brief cite (texte de la page avant et après, identique pour un changement neutre) ; version augmentée dans `package.json` si `src/` a changé ; commit local marqué « à valider » dans le style des commits récents ; ligne de la file mise à jour (état, commit, version) ; essais critiques ou douteux du lot ajoutés à `docs/ESSAIS.md`, numéros qui se suivent, quelques-uns par paquet.
4. Rapport **BLOQUÉ** : poser la question à l'utilisateur (`AskUserQuestion`, et `PushNotification` vers le téléphone si l'outil est là), noter le lot « bloqué (Q n) » et la question dans la table « Questions » de la file, continuer avec le premier lot qui n'en dépend pas ; à la réponse, la renvoyer au même agent par `SendMessage`.
5. Rapport **ÉCHEC** : relancer une fois sur le modèle du dessus (Sonnet → Opus → Fable), sinon noter l'échec dans la file et passer au suivant.

Une vérification qui échoue après un rapport FAIT revient à l'agent `lot` avec la sortie, une fois ; ensuite c'est un ÉCHEC.

## 3. Ce que tu demandes à l'utilisateur

Seulement une vraie décision : choix de produit, donnée perdue, seuil à retenir, envoi. Pour le reste, tranche seul et dis-le en une ligne dans le compte rendu. Les questions se posent par `AskUserQuestion`, quatre au plus, une recommandation en tête. Une donnée qu'il détient (un GPX, un chiffre à l'écran) se demande en clair, pas par questionnaire.

## 4. Arrêt

Arrête la boucle, mets la file à jour, et propose `/clore` quand :
- un paquet de 2 ou 3 lots est « à valider » : construis alors l'APK (procédure au §12 d'ETAT, version déjà augmentée), installe-la, note sa version dans la file et en tête de « À faire » de `docs/ESSAIS.md` ;
- une compaction a eu lieu, ou `/context` dépasse environ 60 % ;
- tout ce qui reste est bloqué par des réponses de l'utilisateur.

Compte rendu d'arrêt : lots faits (commit, version), lots bloqués et leurs questions, essais à faire par numéro, APK installée ou non, et la phrase « `/clore` quand vous voulez ». Rien n'est envoyé sur GitHub ici : c'est `/clore`.
