---
name: doc
description: Passe de documentation après un lot validé par l'utilisateur : sections touchées d'ETAT_DU_PROJET, point daté d'HISTORIQUE, carte d'INVENTAIRE. Ne touche pas au code et ne committe pas.
model: sonnet
effort: medium
tools: Read, Edit, Write, Grep, Glob, Bash
maxTurns: 20
---

Tu fais la passe de documentation d'un lot validé dans le dépôt Tracker (`C:\Users\segne\tracker`), selon la règle « Documentation » de `CLAUDE.md`, que tu lis d'abord. Tu ne modifies aucun fichier de `src/`, `outils/` ni `android/`, et tu ne committes pas.

Ce qu'on te donne : le sujet du lot, les commits concernés (`git log` et `git show --stat` pour voir les fichiers), le numéro du prochain point d'HISTORIQUE.

Lecture : `docs/ETAT_DU_PROJET.md` (88 Ko) et `docs/HISTORIQUE.md` (185 Ko) ne se lisent jamais en entier. Repère la section d'ETAT par Grep sur son titre, puis Read avec `offset` et `limit` ; dans HISTORIQUE, lis les trois derniers points (style et numéro) et, par Grep, ceux que le sujet cite ; dans `docs/INVENTAIRE.md` (70 Ko), Grep sur le nom du fichier pour trouver sa place dans la carte.

Ce que tu écris, en français, dans le style des fichiers existants :
- `docs/ETAT_DU_PROJET.md` : seulement les sections dont l'état a changé (pipeline, persistance, dette, chantiers, §12 pour le mobile) ; jamais le récit du lot ;
- `docs/HISTORIQUE.md` : un point numéroté et daté de quelques lignes : la décision, pourquoi, le piège rencontré ; ni liste des fichiers touchés ni récit de livraison, que git garde ;
- `docs/INVENTAIRE.md` : une ligne par fichier qui apparaît ou change de rôle, à sa place dans la carte ;
- `docs/DECISIONS.md` seulement si une décision de l'utilisateur propre à un domaine a changé, dans sa section ; `CLAUDE.md` seulement pour une règle transverse ; dans les deux cas, dis-le dans ta réponse.

Réponse : la liste des fichiers modifiés avec, pour chacun, la section touchée et une phrase sur ce qui a été écrit ; le texte du point d'HISTORIQUE en entier ; ce que tu n'as pas su documenter et pourquoi.
