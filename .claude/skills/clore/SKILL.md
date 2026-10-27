---
name: clore
description: Clôture d'une session de travail sur Tracker : vérification et commit du travail en cours, résultats d'essais et passe doc des lots validés, file des lots, essais, point de reprise, envoi sur GitHub, compte rendu et prompt de reprise.
argument-hint: "[ok partout | ok sauf N : … ] [sans envoi]"
disable-model-invocation: true
---

# /clore : finir la session

Tu clos la session de travail sur Tracker (`C:\Users\segne\tracker`). Tu suis les règles de `CLAUDE.md` (Environnement, Documentation) et de `docs/MODELES.md` (Mode chaîne). Vérifications et doc passent par les sous-agents `verif` et `doc`, jamais par toi. Tu ne réécris jamais l'historique git (pas d'amend, pas de rebase, pas de force).

Argument reçu : `$ARGUMENTS`
- Vide : pas de résultats d'essais, envoi sur GitHub à la fin.
- `ok partout` ou `ok sauf N : remarque, M : remarque` : résultats des essais de `docs/ESSAIS.md`, par numéro.
- `sans envoi` (seul ou en plus) : tout faire sauf l'envoi sur GitHub.

## 1. État des lieux (lecture seule)

Relève, sans rien modifier :
- `git status --short` : fichiers modifiés non commités ;
- `git log --oneline origin/main..main` : commits locaux non envoyés ;
- `~/.claude/plans/FILE-DES-LOTS.md` : lots « en cours », « à valider », « bloqué (Q n) », questions sans réponse ;
- `docs/ESSAIS.md` : essais en attente ;
- la conversation : questions posées à l'utilisateur restées sans réponse, idées lancées en passant, essais à demander nés pendant la session.

## 2. Travail non commité

Classe les fichiers modifiés :
- **Code** (`src/`, `outils/`, `android/`, `package.json`, configuration) : lance l'agent `verif` en vérification complète (lint, tous les tests, build). Si elle échoue : arrête-toi, donne la sortie à l'utilisateur, ne committe rien.
  - Si le travail est un lot entier (sujet fini, vérifié, banc joué si le brief le demandait) : augmente la version dans `package.json` si `src/` a changé et qu'elle n'a pas déjà bougé depuis le dernier commit ; commit « à valider » dans le style des commits récents (`git log -5` : sujet du lot, décisions, tests, verif, banc, version) ; mets à jour la ligne du lot dans la file (état « à valider », commit, version).
  - Si ce n'est pas un lot entier : ne committe pas. Note le lot « en cours » dans la file avec ce qui est fait et ce qui reste, et dis-le dans le compte rendu.
- **Doc et outillage seuls** (`docs/`, `CLAUDE.md`, `.claude/`, mémoire) : commit direct, sans vérification, message court en français.

Un commit se termine par la ligne d'attribution demandée dans la conversation, si elle y est.

## 3. Résultats d'essais (seulement si l'argument en donne)

Pour chaque numéro :
- « ok » : l'essai descend dans « Faits » de `docs/ESSAIS.md`, sur une ligne datée ; un essai raté reste « À faire » avec la remarque de l'utilisateur.
- Un lot dont tous les essais sont ok passe « validé » dans la file ; un lot avec un essai raté reste « à valider », remarque notée, à corriger par un nouveau commit.
- Pour chaque lot validé, dans l'ordre de la file : lance l'agent `doc` avec le sujet du lot, ses commits et le numéro du prochain point d'HISTORIQUE (lire le dernier numéro dans `docs/HISTORIQUE.md`). Relis seulement son rapport.
- Commit de la doc : « Doc des lots N, M validés le jj/mm (HISTORIQUE points X à Y) ».

Sans résultats dans l'argument : aucune passe doc (règle : doc après validation seulement). Dis-le en une ligne dans le compte rendu.

## 4. Mémoire de travail

Écris, puis committe ce qui est dans le dépôt :
- `docs/ESSAIS.md` : les essais nés dans la session qui n'y sont pas encore ; seulement les critiques ou douteux (GPS, capteurs, ceinture, notification, écran éteint, rendu tactile, vrai doute, question à trancher) ; numéros qui se suivent, jamais réutilisés.
- `docs/A-FAIRE.md` : une fiche « à clarifier » pour une idée lancée en passant dans la session et sans fiche ; rien d'autre.
- `~/.claude/plans/FILE-DES-LOTS.md` : état de chaque lot touché, questions et réponses de la session (table « Questions »), une ligne dans « Journal des paquets ».
- Mémoire `point-de-reprise-cible-mobile.md` (`~/.claude/projects/c--Users-segne-tracker/memory/`) : réécris le seul paragraphe « État au … » (main, dernier validé sur le téléphone, APK installée, essais restants, non envoyé ou envoyé) ; ne touche à rien d'autre, pas de journal.
- `~/.claude/plans/MODE-CHAINE-PROMPT.md` : refais la ligne « Reprise courante » si le mode chaîne est en cours.

## 5. Envoi sur GitHub

Sauf `sans envoi` : `git push origin main`, puis `git log --oneline origin/main..main` doit être vide ; cite ce résultat. Si le push échoue, donne l'erreur et ne retente pas autrement.

## 6. Compte rendu

Un message qui tient seul, pour quelqu'un qui n'a pas vu la session :
- les commits de la session (hash court, sujet, version) et s'ils sont envoyés ;
- ce qui est validé, ce qui attend l'utilisateur : essais par numéro, questions ouvertes (Q n de la file) ;
- ce qui a été laissé de côté et pourquoi (lot en cours non commité, vérification en échec, doc non faite faute de résultats) ;
- la version de `package.json` et si une APK est à construire (version plus haute que la dernière APK installée, notée dans la file) ;
- le prompt de reprise à coller dans la prochaine conversation, entre guillemets, avec le modèle et l'effort conseillés d'après `docs/MODELES.md`.

## Ce que /clore ne fait pas

Pas d'APK (procédure au §12 d'ETAT, à demander à part). Pas de passe doc sans résultats d'essais. Pas de commit d'un code non vérifié. Pas de question à l'utilisateur sauf vérification en échec ou doute sur ce qu'est un lot entier.

## Pièges du poste

- `npx vitest` depuis Git Bash avec un `cwd` en `c:\…` minuscule échoue : `cmd //c "cd /d C:\Users\segne\tracker && npx vitest run …"` ; l'agent `verif` le sait.
- Ne jamais éditer un fichier source par PowerShell (double encodage UTF-8).
- Fins de ligne par `.gitattributes` : ne pas convertir.
