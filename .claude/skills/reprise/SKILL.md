---
name: reprise
description: Début de session sur Tracker : relit la mémoire, la file des lots, git, les essais et les idées, dit en dix lignes où on en est, vérifie que le modèle de la session convient et propose le prochain geste.
argument-hint: "[ce que vous voulez faire aujourd'hui]"
disable-model-invocation: true
---

# /reprise : où en est-on

Tu ouvres une session de travail sur Tracker (`C:\Users\segne\tracker`). Tu lis, tu ne modifies rien, et tu finis par une proposition. Le miroir de `/clore`.

Argument reçu : `$ARGUMENTS` (vide : « on reprend » sans précision ; sinon ce que l'utilisateur veut faire aujourd'hui).

## 1. Lectures, dans cet ordre

- La mémoire `point-de-reprise-cible-mobile.md` (`~/.claude/projects/c--Users-segne-tracker/memory/`) : paragraphes « Rythme » et « Pièges du poste » seulement ; l'état des lots n'y est pas.
- `~/.claude/plans/FILE-DES-LOTS.md` : table « Ordre et état », questions sans réponse, dernière ligne du journal des paquets.
- `git status --short`, `git log --oneline -8`, `git log --oneline origin/main..main` : travail non commité, derniers commits, commits non envoyés. Un fichier modifié non commité au début d'une session est un signe qu'une clôture a été manquée : dis-le.
- `docs/ESSAIS.md` : table « À faire ».
- `docs/A-FAIRE.md` : fiches de priorité 4 et 5, et fiches « à clarifier ».
- Le dernier point de `docs/HISTORIQUE.md` (numéro, date), pour connaître le prochain.
- Le §12 de `docs/ETAT_DU_PROJET.md` seulement si la mémoire renvoie à une étape du plan mobile.

La file fait foi pour l'état des lots, `docs/ESSAIS.md` pour les essais ; si un autre fichier les contredit, signale l'écart.

## 2. Le modèle de la session

D'après le tableau de `docs/MODELES.md`, dis si le modèle et l'effort de cette conversation conviennent au prochain geste (ou à ce que l'argument demande). Seulement en cas de gros décalage dans un sens ou l'autre : propose le modèle et l'effort adaptés en deux phrases et attends la réponse avant toute suite. Sinon « modèle ok » en un mot.

## 3. Compte rendu, dix lignes au plus

- Où en est `main` : dernier commit, version, envoyé ou non (nombre de commits locaux).
- Ce qui attend l'utilisateur : lots « à valider » et l'APK qui les porte, essais par numéro, questions Q n sans réponse.
- Ce qui attend Claude : lots « à faire » dont les dépendances sont levées, lot « en cours » laissé non commité, passe doc à faire pour des lots validés.
- Les idées de priorité 5 non traitées d'A-FAIRE, s'il y en a.
- Tout écart ou oubli relevé (fichiers non commités, mémoire périmée, fichier manquant).

## 4. Proposition

Termine par un seul geste proposé, le plus utile d'après l'ordre de la file et la priorité des fiches : par exemple « lancer `/chaine` sur le lot 11 », « passer les résultats d'essais par `/clore ok sauf … ` », « mettre au propre les notes par `/todo` », ou le travail demandé en argument. Si l'argument demande quelque chose qui contredit la file ou une décision, dis-le avant de commencer. Puis attends la réponse de l'utilisateur ; ne commence aucun travail de toi-même.
