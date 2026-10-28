---
name: clore
description: Clôture d'une session de travail sur Tracker : vérification et commit du travail en cours, résultats d'essais et passe doc des lots validés, reste à faire (docs/BACKLOG.md), point de reprise, envoi sur GitHub, compte rendu et prompt de reprise.
argument-hint: "[ok partout | ok sauf N : … | ok sauf lot L : … ] [sans envoi]"
disable-model-invocation: true
---

# /clore : finir la session

Tu clos la session de travail sur Tracker (`C:\Users\segne\tracker`). Tu suis les règles de `CLAUDE.md` (Environnement, Documentation) et de `docs/MODELES.md` (Mode chaîne), et l'en-tête de `docs/BACKLOG.md`. Vérifications et doc passent par les sous-agents `verif` et `doc`, jamais par toi. Tu ne réécris jamais l'historique git (pas d'amend, pas de rebase, pas de force).

Argument reçu : `$ARGUMENTS`
- Vide : pas de résultats d'essais, envoi sur GitHub à la fin.
- `ok partout` : tous les lots de Maintenant sont validés, ceux qui ont des essais au téléphone comme ceux « à valider sur lecture ».
- `ok sauf N : remarque, M : remarque` : les essais N et M (sous-lignes `essai N` de Maintenant) sont ratés ; tout le reste est validé, lots sur lecture compris.
- `ok sauf lot L : remarque` : retient un lot sans essai (sur lecture) ; se combine avec la forme précédente.
- `sans envoi` (seul ou en plus) : tout faire sauf l'envoi sur GitHub.

## 1. État des lieux (lecture seule)

Relève, sans rien modifier :
- `git status --short` : fichiers modifiés non commités ;
- `git log --oneline origin/main..main` : commits locaux non envoyés ;
- `node outils/backlog.mjs` : essais à faire, lots « en cours », « à valider », « bloqué (Q n) », questions sans réponse, alertes ;
- la conversation : questions posées à l'utilisateur restées sans réponse, idées lancées en passant, essais à demander nés pendant la session.

## 2. Travail non commité

Classe les fichiers modifiés :
- **Code** (`src/`, `outils/`, `android/`, `package.json`, configuration) : lance l'agent `verif` en vérification complète (lint, tous les tests, build). Si elle échoue : arrête-toi, donne la sortie à l'utilisateur, ne committe rien. Pour un lot Opus ou Fable, lance ensuite l'agent `relecture` sur le diff ; un défaut confirmé se corrige avant le commit, ou se note dans l'état de la ligne du lot si la session ne peut pas le corriger.
  - Si le travail est un lot entier (sujet fini, vérifié, banc joué si le brief le demandait) : augmente la version dans `package.json` si `src/` a changé et qu'elle n'a pas déjà bougé depuis le dernier commit ; commit « à valider » dans le style des commits récents (`git log -5` : sujet du lot, décisions, tests, verif, banc, version) ; mets à jour la ligne du lot dans Maintenant (état « à valider (commit, version) »).
  - Si ce n'est pas un lot entier : ne committe pas. Note le lot « en cours » dans sa ligne, avec ce qui est fait et ce qui reste, et dis-le dans le compte rendu.
- **Doc et outillage seuls** (`docs/`, `CLAUDE.md`, `.claude/`, mémoire) : commit direct, sans vérification, message court en français.

Un commit se termine par la ligne d'attribution demandée dans la conversation, si elle y est.

## 3. Résultats d'essais (seulement si l'argument en donne)

Sur les lots de Maintenant (règle reprise telle quelle par l'étape 1 de `/chaine`) :
- **Essai ok** : sa sous-ligne est supprimée.
- **Essai raté** (« ok sauf N : remarque ») : sa sous-ligne est retirée ; un `[bogue]` est créé en tête d'Ensuite, numéro pris dans « Prochains numéros » de l'en-tête (qui est mis à jour), avec la remarque de l'utilisateur et « lot L, essai N ». Le lot reste dans Maintenant, état « à revoir : bogue n° M » ; il ne compte plus dans la limite de 3.
- **Lot sans essai retenu** (« ok sauf lot L : remarque ») : il reste « à valider sur lecture », la remarque ajoutée à son état ; si la remarque décrit un défaut, même règle qu'un essai raté (un `[bogue]` en tête d'Ensuite, le lot « à revoir : bogue n° M »).
- **Validé** : tout lot de Maintenant ni retenu ni « à revoir » ni « en cours » ni « bloqué », dont les essais sont tous ok (`ok partout` valide aussi les lots sur lecture).
- Pour chaque lot validé, dans l'ordre de Maintenant : lance l'agent `doc` avec le sujet du lot, ses commits et le numéro du prochain point d'HISTORIQUE (lire le dernier numéro dans `docs/HISTORIQUE.md`). Relis seulement son rapport. Puis **supprime sa ligne** de `docs/BACKLOG.md` : git et HISTORIQUE gardent la trace. Quand un `[bogue]` né d'un essai raté est fait et validé, sa ligne et celle du lot « à revoir : bogue n° M » sont supprimées ensemble, après une seule passe `doc` pour les deux.
- Commit de la doc : « Doc des lots N, M validés le jj/mm (HISTORIQUE points X à Y) ».

Sans résultats dans l'argument : aucune passe doc (règle : doc après validation seulement). Dis-le en une ligne dans le compte rendu.

## 4. Mémoire de travail

Écris, puis committe ce qui est dans le dépôt (`docs/BACKLOG.md` et `docs/backlog/` partent dans le commit de doc de la clôture) :
- Essais nés dans la session : en sous-lignes de leur lot dans Maintenant, seulement les critiques ou douteux (GPS, capteurs, ceinture, notification, écran éteint, rendu tactile, vrai doute, question à trancher) ; numéros donnés par « Prochains numéros » de l'en-tête, jamais réutilisés ; un essai de terrain va sous sa condition dans « Ça attend une occasion ».
- Idées lancées en passant dans la session : une ligne en Plus tard, datée, une phrase avec le résultat attendu ; rien d'autre.
- Questions de la session restées sans réponse : dans « Questions », chacune avec ta réponse par défaut et la date (cinq au plus).
- Pas de journal : le compte rendu, git et HISTORIQUE suffisent. `node outils/backlog.mjs` doit finir sans erreur de forme.
- Mémoire `point-de-reprise-cible-mobile.md` (`~/.claude/projects/c--Users-segne-tracker/memory/`) : rien à écrire, l'état est dans `docs/BACKLOG.md` ; seulement si le rythme de travail a changé dans la session, corriger son paragraphe « Rythme », sans journal.

## 5. APK, si le téléphone est branché

Tu ne construis pas d'APK ici (procédure au §12 d'ETAT, à demander à part), mais tu installes celle qui existe déjà :
- lis la version de `package.json` ; si `android/app/build/outputs/apk/release/Tracker-<version>.apk` existe, vérifie le téléphone : `"C:/Users/segne/AppData/Local/Android/Sdk/platform-tools/adb.exe" devices` doit lister `45LZ6LRSHIDIEUX8` avec l'état `device` ;
- branché : `adb install -r <cette APK>`, puis `adb shell dumpsys package io.github.segneur.tracker | grep -m1 versionName` doit donner la version ; note « APK <version> installée le jj/mm (versionCode …). » dans la première ligne de Maintenant (un commit de doc si `docs/BACKLOG.md` change) ;
- débranché, ou pas d'APK de cette version : ne fais rien, dis-le dans le compte rendu (« APK <version> construite, à installer » ou « à construire »).

## 6. Envoi sur GitHub

Sauf `sans envoi` : `git push origin main`, puis `git log --oneline origin/main..main` doit être vide ; cite ce résultat. Si le push échoue, donne l'erreur et ne retente pas autrement.

## 7. Compte rendu

Un message qui tient seul, pour quelqu'un qui n'a pas vu la session, en français courant :
- les commits de la session (hash court, sujet, version) et s'ils sont envoyés ;
- ce qui est validé, ce qui attend l'utilisateur : essais par numéro, questions ouvertes (Q n) avec ce que Claude fera sans réponse ;
- ce qui a été laissé de côté et pourquoi (lot en cours non commité, vérification en échec, doc non faite faute de résultats) ;
- la version de `package.json`, et l'APK : installée à l'étape 5, construite mais à installer (téléphone débranché), ou à construire (version plus haute que celle de la première ligne de Maintenant) ;
- le prompt de reprise à coller dans la prochaine conversation, entre guillemets, avec le modèle et l'effort conseillés d'après `docs/MODELES.md`.

## Ce que /clore ne fait pas

Pas de construction d'APK (procédure au §12 d'ETAT, à demander à part) : seulement l'installation d'une APK déjà construite, étape 5. Pas de passe doc sans résultats d'essais. Pas de commit d'un code non vérifié. Pas de question à l'utilisateur sauf vérification en échec ou doute sur ce qu'est un lot entier.

## Pièges du poste

- `npx vitest` depuis Git Bash avec un `cwd` en `c:\…` minuscule échoue : `cmd //c "cd /d C:\Users\segne\tracker && npx vitest run …"` ; l'agent `verif` le sait.
- Ne jamais éditer un fichier source par PowerShell (double encodage UTF-8).
- Fins de ligne par `.gitattributes` : ne pas convertir.
