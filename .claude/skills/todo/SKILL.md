---
name: todo
description: Reste à faire de Tracker (docs/BACKLOG.md). Sans argument, la revue de la semaine (tableau de bord de node outils/backlog.mjs, puis une seule salve de questions). Avec des notes en vrac (WhatsApp), les met au propre en lignes rangées par trois questions posées en clair. Avec « réponse N : … » ou « Q n : … », note la réponse.
argument-hint: "[notes en vrac | réponse N : … | Q n : … | vide pour la revue de la semaine]"
disable-model-invocation: true
---

# /todo : le reste à faire

Tu travailles sur `docs/BACKLOG.md` du dépôt Tracker (`C:\Users\segne\tracker`). Lis d'abord son en-tête de règles : forme d'une ligne, quatre zones, limites, rangement, essais, questions ; elles font loi. Tu ne touches à aucun fichier de code. Ce que l'utilisateur lit est en français courant, sans jargon (ni « backlog », ni « WIP », ni « kanban ») : il n'ouvre jamais le fichier.

Argument reçu : `$ARGUMENTS`

## Sans argument : la revue de la semaine

1. Lance `node outils/backlog.mjs` depuis la racine du dépôt et affiche sa sortie telle quelle : c'est le tableau de bord (Vous, Claude, Ça attend une occasion, Plus tard, Alertes). Une erreur de forme se corrige d'abord dans le fichier, puis le script se relance.
2. Pose **une seule** `AskUserQuestion`, quatre questions au plus, les plus utiles d'abord, une recommandation en tête de chacune, choisies parmi :
   - une condition d'occasion remplie (« avez-vous fait une sortie surf ? ») : ses essais et ses lots passent alors en Maintenant ou en tête d'Ensuite ;
   - monter tel élément d'Ensuite en tête ;
   - garder ou lâcher telle idée de Plus tard de plus de 90 jours ;
   - trancher par défaut telle question de plus de 4 semaines.
   Rien à demander : dis-le en une ligne, sans questionnaire.
3. Applique les réponses dans `docs/BACKLOG.md` : élément déplacé, idée lâchée (ligne supprimée, une phrase dans le compte rendu), question tranchée (sa réponse dans l'élément, ou dans `docs/DECISIONS.md` si c'est une décision de domaine ; la ligne de la question disparaît). Relance le script : il doit finir sans erreur de forme.

Pas de commit : `/clore` s'en charge.

## `réponse N : …` ou `Q n : …` : une réponse

- `Q n : …` : la réponse va dans l'élément qu'elle débloque (champ d'état, ou son détail `docs/backlog/N-titre.md`), ou dans `docs/DECISIONS.md` si c'est une décision de domaine ; la ligne de la question disparaît, et le « dépend de : Q n » de l'élément aussi. L'élément débloqué passe en Ensuite, à la place que la règle de rangement lui donne.
- `réponse N : …` : la réponse va dans l'élément N (état, ou son détail), datée du jour. « Abandonne » ou « laisse tomber » : la ligne est supprimée, et dite dans le compte rendu.

## Des notes en vrac : la mise au propre

1. **Lis le contexte** avant d'écrire : `docs/BACKLOG.md` en entier, et la section de `docs/DECISIONS.md` du domaine de chaque note (table de `CLAUDE.md`, « Décisions de l'utilisateur »). Cherche le doublon et la contradiction.
2. **Découpe** : une ligne par idée, même si une note en contient plusieurs.
3. **Date** : un export WhatsApp porte la date devant chaque message (`jj/mm/aaaa hh:mm - Nom : …`) : c'est le « noté ». Sans date, celle du jour.
4. **Type** : `[bogue]` quand la note décrit un comportement faux ou cassé, `[idée]` sinon (`[dette]` et `[outil]` sont pour Claude).
5. **Ligne** selon la forme de l'en-tête, numéro donné par « Prochains numéros » (puis l'en-tête mis à jour). Titre : où dans l'application (page › onglet › élément, cherché dans le code ou la doc si la note ne le dit pas) et ce qui est voulu. Si la ligne ne suffit pas à quelqu'un d'autre pour la réaliser, un détail `docs/backlog/N-titre.md` : « Tel que noté » mot pour mot, où, aujourd'hui (vérifié dans le code, pas supposé), voulu, pourquoi, questions ; la ligne le cite (`détail : …`).
6. **Doublon** : si l'idée existe déjà, complète la ligne ou son détail (nouveau « tel que noté » daté) au lieu d'en créer une autre, et dis-le.
7. **Contradiction** : si l'idée va contre une décision de `DECISIONS.md` ou de `CLAUDE.md`, écris quand même la ligne, avec une question qui cite la décision (section et phrase), et signale-le.
8. **Déjà fait** : si le code fait déjà ce qui est demandé, dis-le avec le fichier, et n'écris pas de ligne sauf si l'utilisateur confirme que ça ne marche pas chez lui (alors c'est un `[bogue]`).

## Le rangement : une seule salve, à la fin

Écris toutes les lignes d'abord, en Plus tard provisoirement, puis pose en une seule `AskUserQuestion` (quatre questions au plus) la règle de rangement, en clair, pour chaque idée qui le demande :
- un bogue qui casse l'usage ou fausse un chiffre ? oui → tête d'Ensuite, sans autre question ;
- « vous en servirez-vous à votre prochaine sortie ? » oui → Ensuite, non → Plus tard ;
- petit ou gros : c'est toi qui le proposes (petit = un lot Sonnet ou Opus, une session ; gros = plusieurs lots, Fable, ou des données réelles), l'utilisateur corrige s'il veut ; petit et utile passe avant gros et utile.
La place proposée dans Ensuite se dit dans la question (« en 2e, après le n° 31 »). Une donnée qu'il détient (un GPX, un chiffre à l'écran) se demande en clair, pas par questionnaire. Les questions de fond restées ouvertes vont dans « Questions » (cinq au plus), chacune avec ta réponse par défaut et la date. Relance `node outils/backlog.mjs` : sans erreur de forme.

## Compte rendu

Dix lignes au plus, en français courant : les lignes écrites (numéro, titre, zone, place), puis, sur une ligne chacun, les doublons fusionnés, les contradictions, ce qui est déjà fait, et les questions restées ouvertes. Pas de commit : `/clore` s'en charge.
