---
name: reprise
description: Début de session sur Tracker : relit la mémoire, le reste à faire (docs/BACKLOG.md et son tableau de bord) et git, dit en dix lignes où on en est, vérifie que le modèle de la session convient et propose le prochain geste.
argument-hint: "[ce que vous voulez faire aujourd'hui]"
disable-model-invocation: true
---

# /reprise : où en est-on

Tu ouvres une session de travail sur Tracker (`C:\Users\segne\tracker`). Tu lis, tu ne modifies rien, et tu finis par une proposition. Le miroir de `/clore`.

Argument reçu : `$ARGUMENTS` (vide : « on reprend » sans précision ; sinon ce que l'utilisateur veut faire aujourd'hui).

## 1. Lectures, dans cet ordre

- La mémoire `point-de-reprise-cible-mobile.md` (`~/.claude/projects/c--Users-segne-tracker/memory/`) : paragraphes « Rythme » et « Pièges du poste » seulement ; l'état des lots n'y est pas.
- `node outils/backlog.mjs`, lancé depuis la racine du dépôt : le tableau de bord (Vous, Claude, Ça attend une occasion, Plus tard, Alertes) ; puis `docs/BACKLOG.md` lui-même, zones Maintenant, Ensuite et Questions, pour le détail d'une ligne.
- `git status --short`, `git log --oneline -8`, `git log --oneline origin/main..main` : travail non commité, derniers commits, commits non envoyés. Un fichier modifié non commité au début d'une session est un signe qu'une clôture a été manquée : dis-le.
- Le dernier point de `docs/HISTORIQUE.md` (numéro, date), pour connaître le prochain.
- Le §12 de `docs/ETAT_DU_PROJET.md` seulement si la mémoire renvoie à une étape du plan mobile.

`docs/BACKLOG.md` fait foi pour les lots, les essais et les questions ; si un autre fichier le contredit (un commit « à valider » absent de Maintenant, une APK qui n'est pas celle de la première ligne), signale l'écart.

## 2. Le modèle de la session

D'après le tableau de `docs/MODELES.md`, dis si le modèle et l'effort de cette conversation conviennent au prochain geste (ou à ce que l'argument demande). Seulement en cas de gros décalage dans un sens ou l'autre : propose le modèle et l'effort adaptés en deux phrases et attends la réponse avant toute suite. Sinon « modèle ok » en un mot.

## 3. Compte rendu, dix lignes au plus

En français courant, sans jargon, sur les quatre blocs du tableau de bord :
- Où en est `main` : dernier commit, version, envoyé ou non (nombre de commits locaux).
- **Vous** : essais à faire et l'APK qui les porte, lots à relire et valider, questions avec ce que Claude fera sans réponse.
- **Claude** : lot en cours laissé non commité, éléments prêts dans l'ordre d'Ensuite (ou « rien avant validation »), passe doc à faire pour des lots validés.
- **Ça attend une occasion** et **Plus tard** : une ligne chacun, seulement s'il y a une condition à vérifier ou une idée de plus de 90 jours.
- Tout écart ou oubli relevé (alerte du script, fichiers non commités, mémoire périmée, fichier manquant).

## 4. Proposition

Termine par un seul geste proposé, le plus utile d'après le tableau de bord : par exemple « faire l'essai 63 puis `/clore ok …` », « lancer `/chaine` sur le n° 31 », « la revue de la semaine par `/todo` », « mettre au propre les notes par `/todo …` », ou le travail demandé en argument. Si l'argument demande quelque chose qui contredit l'ordre d'Ensuite ou une décision, dis-le avant de commencer. Puis attends la réponse de l'utilisateur ; ne commence aucun travail de toi-même.
