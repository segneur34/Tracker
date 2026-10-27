---
name: todo
description: Met au propre dans docs/A-FAIRE.md les notes en vrac de l'utilisateur (WhatsApp) en fiches datées avec priorité de 1 à 5, cherche les doublons et les contradictions, pose les questions utiles en une fois. Sans argument, affiche la liste triée.
argument-hint: "[notes en vrac | réponse N : … | vide pour la liste]"
disable-model-invocation: true
---

# /todo : mettre au propre les idées

Tu travailles sur `docs/A-FAIRE.md` du dépôt Tracker (`C:\Users\segne\tracker`). Lis d'abord ce fichier en entier : sa règle « Mise au propre », son modèle de fiche, ses états et ses fiches existantes font loi. Tu ne touches à aucun fichier de code.

Argument reçu : `$ARGUMENTS`

## Sans argument : la liste

Affiche les fiches non archivées, triées par priorité décroissante puis par état (`prête`, `à clarifier`, `en lot N`), en une table : numéro, titre, priorité (avec « (proposée) » si l'utilisateur ne l'a pas confirmée), état, questions encore ouvertes en quelques mots. Puis les archives sur une ligne (nombre de fiches faites, abandonnées). Rien n'est écrit.

## `réponse N : …` : une réponse à une question

Note la réponse dans la fiche N, datée du jour, à la suite de sa question (`→ réponse (jj/mm)`). Si la fiche n'a plus de question ouverte et qu'un autre que toi pourrait la réaliser sans rien demander, passe-la « prête ». Si la réponse est « abandonne » ou « laisse tomber », la fiche descend dans « Archives » sur une ligne, état `abandonnée`.

## Des notes en vrac : la mise au propre

1. **Lis le contexte** avant d'écrire : les fiches existantes d'A-FAIRE, la table « Ordre et état » et les questions de `~/.claude/plans/FILE-DES-LOTS.md`, et la section de `docs/DECISIONS.md` du domaine de chaque note (table de `CLAUDE.md`, « Décisions de l'utilisateur »). Cherche le doublon et la contradiction.
2. **Découpe** : une fiche par idée, même si une note en contient plusieurs ; une note qui regroupe deux sujets donne deux fiches, chacune avec le morceau de texte qui la concerne.
3. **Date** : un export WhatsApp porte la date devant chaque message (`jj/mm/aaaa hh:mm - Nom : …`) : c'est le « Noté le ». Sans date, « reçu le » seulement, à la date du jour.
4. **Priorité** : si la note en contient une (« p4 », « [4] », « prio 4 », « 4/5 », « priorité 4 », « important » = 4, « urgent » = 5), elle est prise telle quelle, sans « (proposée) ». Sinon propose-la d'après la grille d'A-FAIRE (5 : gêne l'usage ou faux chiffre ; 4 : à faire bientôt ; 3 : utile ; 2 : confort ; 1 : idée à garder), marquée « (proposée) ».
5. **Type** : ajoute dans le titre, après la priorité, « · bogue » quand la note décrit un comportement faux ou cassé, rien quand c'est une idée.
6. **Fiche** selon le modèle d'A-FAIRE : « Tel que noté » mot pour mot, « Où » (page › onglet › élément, cherché dans le code ou la doc si la note ne le dit pas), « Aujourd'hui » (ce que fait l'application, vérifié dans le code, pas supposé), « Voulu », « Pourquoi ». Numéro qui suit le dernier de la liste, archives comprises.
7. **Doublon** : si l'idée existe déjà, complète la fiche existante (nouveau « Tel que noté » daté, priorité relevée si la note en donne une plus haute) au lieu d'en créer une autre, et dis-le.
8. **Contradiction** : si l'idée va contre une décision de `DECISIONS.md` ou de `CLAUDE.md`, écris quand même la fiche, état `à clarifier`, avec la décision citée (section et phrase) dans « Questions », et signale-le dans le compte rendu.
9. **Déjà fait** : si le code fait déjà ce qui est demandé, dis-le avec le fichier, et ne crée pas de fiche sauf si l'utilisateur confirme que ça ne marche pas chez lui (alors c'est un bogue).
10. **État** : `prête` seulement si quelqu'un d'autre pourrait la réaliser sans rien demander ; sinon `à clarifier` avec ses questions.

## Les questions : une seule salve, à la fin

Écris toutes les fiches d'abord, puis pose en une seule fois, par `AskUserQuestion` (quatre questions au plus par appel, les plus importantes d'abord) ou en clair quand il s'agit d'une donnée à fournir, seulement les questions qui changent ce qu'on ferait. Pas de question sur un détail que tu peux trancher seul (nommage, emplacement évident). Chaque réponse se note dans la fiche, datée, et l'état est revu. Ce qui reste sans réponse reste dans « Questions » de la fiche.

## Compte rendu

Une table : numéro, titre, priorité, état ; puis, sur une ligne chacun, les doublons fusionnés, les contradictions, ce qui est déjà fait, et les questions restées ouvertes. Pas de commit : `/clore` s'en charge.
