# Quel modèle pour quelle tâche

Claude Code propose quatre modèles, du plus lourd au plus léger : Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5. Sur l'abonnement, le quota se consomme au poids du modèle : Fable pèse environ 2,5 × Opus, 5 × Sonnet et 100 × Haiku par token. Le choix se fait **par conversation** : changer de modèle en cours de lot vide le cache et perd le raisonnement en cours. Ce fichier dit quel modèle et quel effort pour quelle tâche, et quels sous-agents s'en chargent.

Vérifié le 27/10/2026 sur `code.claude.com/docs` (model-config, sub-agents, costs), Claude Code 2.1.310.

## Tableau

| Tâche | Modèle | Effort | Où |
|---|---|---|---|
| Lint, typecheck, tests, build : lancer et rapporter les échecs | Haiku | low | sous-agent `verif` |
| Recherche dans le code (où est X, qui appelle Y) | Haiku | medium | sous-agent `Explore` |
| Relire un `adb logcat`, un dump du banc, un journal | Haiku | low | sous-agent (`Explore` ou agent ponctuel) |
| Banc : lancer un script, relever le texte avant/après, les erreurs de console | Sonnet | low | sous-agent `banc` |
| Passe de doc après un lot validé (ETAT, HISTORIQUE, INVENTAIRE) | Sonnet | medium | sous-agent `doc` ou conversation Sonnet |
| Lot « medium » : retouches, libellés, réglages, CSS, petit bug localisé, APK, mémoire, commit | Sonnet | medium | conversation `claude --model sonnet` |
| Lot « medium » où la vérification compte (bug avec repro, banc à compléter) | Sonnet | high | conversation Sonnet |
| Classer des demandes en lots, écrire les briefs | Opus | medium | conversation Opus |
| Mode plan d'un lot « high » (maquette, découpage, fichiers touchés) | Opus | high | `claude --model opusplan` (plan sur Opus, exécution sur Sonnet) ou sous-agent `Plan` |
| Lot « high » : page ou fonctionnalité neuve sur plusieurs fichiers, bug multi-fichiers, relecture (`/code-review`) | Opus | high | conversation `claude --model opus` |
| Algorithmique du noyau (vent, manœuvres, cadence, sauts, pumping, résumé), bug sans cause connue (ex. pauses `trkseg` comptées dans la distance), refonte transverse (famille/traitement), audit général, décision d'architecture | Fable | high, xhigh si la première passe ne tranche pas | conversation `claude --model fable` |

Effort (`/effort`) : `low` pour un échange court qu'on relit à chaque pas (renommage), `medium` pour un travail cadré (défaut d'Opus 5.5 et de Sonnet 5.5), `high` quand la vérification compte (bug), `xhigh` pour un raisonnement plus profond, `max` pour un problème dur, en session seulement. Une session d'Opus ou de Sonnet démarre à `medium` ; Fable à `high`.

## En pratique

- **Au brief** : remplir la colonne « Modèle | Réflexion » du LISEZMOI du lot avec les valeurs du tableau.
- **À la reprise** : ouvrir la conversation avec `claude --model <alias>` (`sonnet`, `opus`, `fable`, `opusplan`), puis `/effort <niveau>` si le brief en demande un autre que le défaut. `/model` en session : `s` change pour la session, `Entrée` écrit le défaut dans les réglages.
- **Un lot, un modèle** : un lot commence et finit sur le même modèle. Si Sonnet cale (« il ne savait pas assez »), relancer le lot sur Opus dans une conversation neuve avec le brief ; ne pas changer de modèle en route.
- **Effort avant modèle** : quand le problème est « il n'a pas assez essayé », remonter l'effort d'un cran avant de changer de modèle.
- **Fable** : décrire le résultat attendu et lui laisser la main ; ne pas lui redire de vérifier, il le fait seul ; un tour peut durer plusieurs minutes.
- **`/clear` entre deux lots** ; `/context` quand une session devient lourde ; `/usage` pour lire la part de chaque sous-agent et les recommandations (touche `w` pour la semaine).
- **Mauvais modèle, à dire tout de suite** : quand la demande arrive sur un modèle nettement inadapté d'après le tableau (une retouche de libellé sur Fable, un bug du noyau ou une page neuve sur Sonnet), Claude le signale dans son premier message, avant tout travail : le modèle recommandé et pourquoi, en deux phrases, puis il attend la réponse. Il faut un gros décalage, dans un sens comme dans l'autre (trop lourd : quota gaspillé ; trop léger : risque de caler), pas un simple cran d'écart. Changer de modèle, c'est une conversation neuve (`/clear`, puis `claude --model <alias>` ou `/model` et `s`, et recoller la demande) : d'où l'intérêt de le dire avant d'avoir commencé, jamais en cours de lot.

## Sous-agents (`.claude/agents/`)

Tous repartent à froid (ils rechargent `CLAUDE.md`), donc ils valent pour une étape autonome à sortie volumineuse, pas pour une retouche de deux lignes. Leur modèle et leur effort sont fixés dans leur en-tête et priment sur celui de la session.

- `Explore` (Haiku, medium) : surcharge de l'agent intégré ; recherche en lecture seule, rend des `chemin:ligne`.
- `Plan` (Opus, high) : surcharge de l'agent intégré ; plan d'exécution d'un lot, lecture seule.
- `verif` (Haiku, low) : lint, typecheck, tests, build ; ne rend que les échecs.
- `banc` (Sonnet, low) : un script du banc dans un Chrome sans fenêtre ; compteurs, erreurs, diff du texte avant/après.
- `doc` (Sonnet, medium) : la passe de documentation d'un lot validé ; ne touche pas au code, ne committe pas.
- `lot` (Opus, high par défaut ; modèle et effort redonnés à chaque appel d'après la colonne « Modèle | Réflexion » du brief) : exécute un lot d'après son brief, lance les vérifications courtes, rend un rapport FAIT / BLOQUÉ / ÉCHEC ; ne committe pas, ne pose pas la version, ne tranche aucune décision de l'utilisateur.

Tout autre sous-agent sans modèle dans son en-tête (fork, agent général) tourne sur Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL` dans `~/.claude/settings.json`), jamais sur le modèle de la session. Pour appeler un agent : « avec l'agent verif, lance les vérifications complètes », ou `@verif`.

## Commandes (`.claude/skills/`)

Invocation manuelle seulement, tapées au début ou à la fin d'une session.

- `/reprise [ce qu'on veut faire]` : début de session ; relit mémoire, file des lots, git, essais et idées, dit où on en est, vérifie le modèle.
- `/chaine [lot N | ok partout | ok sauf N : … | consignes]` : mode chaîne ; enchaîne les lots de la file jusqu'à un paquet à valider.
- `/todo [notes en vrac | réponse N : … ]` : met au propre les notes en vrac dans `docs/A-FAIRE.md` ; sans argument, affiche la liste triée.
- `/clore [ok partout | ok sauf N : … ] [sans envoi]` : fin de session ; commit, résultats d'essais et passe doc, file, essais, point de reprise, envoi GitHub, compte rendu et prompt de reprise.

## Mode chaîne

Une seule conversation Fable (high) enchaîne les lots et les confie aux sous-agents ; elle ne s'adresse à l'utilisateur que pour une vraie décision. La file ordonnée des lots, leurs dépendances, leur état et les questions en attente avec les réponses sont tenues dans `~/.claude/plans/FILE-DES-LOTS.md`, hors dépôt : c'est elle qui fait foi d'une conversation à l'autre. Démarrage : `claude --model fable`, puis « Mode chaîne : on reprend la file » (prompt complet dans `~/.claude/plans/MODE-CHAINE-PROMPT.md`). Les commandes l'encadrent : `/reprise` puis `/chaine` au démarrage, `/clore` à la clôture.

Boucle de l'orchestrateur :
1. prendre le premier lot « à faire » dont les dépendances sont levées ; les lots passent l'un après l'autre (un seul dépôt : version et HISTORIQUE se croiseraient) ;
2. lancer l'agent `lot` avec le brief, le modèle et l'effort de sa colonne, et les réponses déjà données ;
3. rapport FAIT : `verif` complète, `banc` sur les scripts que le brief cite, version augmentée dans `package.json`, commit local marqué « à valider » dans la file ;
4. rapport BLOQUÉ : poser la question à l'utilisateur (AskUserQuestion, et PushNotification vers le téléphone), noter le lot « bloqué (Q n) » et sa question dans la file, continuer avec le premier lot qui n'en dépend pas ; à la réponse, renvoyer la réponse au même agent ;
5. rapport ÉCHEC : relancer une fois sur le modèle du dessus, sinon noter l'échec dans la file et passer au suivant.

Arrêt et clôture : la conversation s'arrête quand un paquet de 2 ou 3 lots est « à valider » (APK construit, liste de ce que l'utilisateur doit essayer), quand une compaction a eu lieu ou que `/context` dépasse environ 60 %, ou quand tout ce qui reste est bloqué par ses réponses. Avant de proposer la fermeture, la file est mise à jour. La passe `doc` ne se fait qu'après la validation d'un paquet par l'utilisateur, lot par lot ; un lot refusé se corrige par un nouveau commit, jamais par une réécriture de l'historique. Rien n'est envoyé sur GitHub sans son accord.

## Réglages (`~/.claude/settings.json`, hors dépôt)

- `model` : `opus` par défaut ; Fable se demande à l'ouverture (`claude --model fable`).
- `env.CLAUDE_CODE_SUBAGENT_MODEL` : `sonnet`.
- `modelSettings` : `medium` sur Opus 5.5 et Sonnet 5.5, `high` sur Fable 5.1.

## Autres leviers, à décider

Repérés le 24/10, pas appliqués : tests et banc en sortie résumée dans la conversation principale (le sous-agent `verif` le fait déjà de son côté) ; fait le 27/10 : `MEMORY.md` à 1 Ko et point de reprise à 4 Ko (au lieu d'environ 3 400 mots rechargés à chaque session) ; `CLAUDE.md` est sous les 200 lignes recommandées.

## Ajuster le tableau

Après trois ou quatre lots, noter ici les tâches qui ont dû remonter d'un modèle (Sonnet → Opus, Opus → Fable) et celles qui ont tenu un cran plus bas que prévu, et corriger le tableau.

## Phrase à coller dans une demande

En tête ou en fin de message, pour déclencher la vérification du modèle :

> Avant de commencer : d'après docs/MODELES.md, dis-moi si le modèle de cette session (et son effort) convient à cette demande. S'il y a un gros décalage dans un sens ou dans l'autre, propose le modèle et l'effort adaptés en deux phrases et attends ma réponse ; sinon, dis « modèle ok » et enchaîne.

Version courte : « Modèle ok pour ça ? (docs/MODELES.md) Sinon propose avant de commencer. »
