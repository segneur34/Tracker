# Consignes de la soirée du 21/11 : la liste traitée en autonomie

Pour l'orchestrateur `/chaine` (Fable, effort high), lancé par l'utilisateur le 21/11 au soir. L'utilisateur est absent jusqu'au matin : il a demandé que « tout soit traité ce soir » par un agent Fable autonome et ses sous-agents. `/chaine` (`.claude/skills/chaine/SKILL.md`) reste la règle ; ce fichier n'en change que ce qui est dit ci-dessous, et pour cette nuit seulement. Le relire après une compaction.

## Ce qui change par rapport à `/chaine`, cette nuit seulement (accord de l'utilisateur du 21/11)

1. **Pas d'arrêt au paquet** : ne pas s'arrêter quand 2 ou 3 lots sont « à valider », ni à la limite de 3 lots avec essais en Maintenant. Continuer jusqu'au bout de la liste ci-dessous, ou jusqu'à ce que tout ce qui reste soit bloqué.
2. **Pas de question à l'utilisateur** (ni `AskUserQuestion`, ni attente). Une question mineure se tranche comme d'habitude. Une question majeure :
   - si un choix par défaut raisonnable existe et se défait sans perte (affichage, nommage, réglage surchargeable) : le prendre, le noter dans le détail de l'élément avec « tranchée par défaut la nuit du 21/11, à confirmer », et continuer ;
   - sinon (donnée perdue, fiche ou fichier réécrit sans retour, envoi de données à un service nouveau, décision contraire à `docs/DECISIONS.md` ou à `CLAUDE.md` que l'utilisateur n'a pas déjà prise) : étape 5 de `/chaine`, cas « arbre modifié » (stash, question dans « Questions » avec la réponse par défaut), puis l'élément suivant.
3. **Maquette** : les détails de 222, 225, 226, 227 et 228 décrivent le changement d'écran en mots, choisis par l'utilisateur le 21/11 (215 le 12/11) : ils tiennent lieu de maquette validée. Ne rien ajouter à l'écran au-delà de ce qu'ils disent.
4. **Compaction ou contexte chargé** : ne pas s'arrêter. `docs/BACKLOG.md` fait foi ; relire ce fichier et `node outils/backlog.mjs`, puis reprendre au lot suivant.
5. **APK** : une seule, à la fin, qui porte tous les lots de la nuit (procédure au §12 d'ETAT ; version posée dans `package.json` avant le build et `cap sync` ; tag annoté). L'installer seulement si `adb devices` voit le téléphone, sinon la laisser construite et le dire.
6. **Jamais cette nuit** : envoi sur GitHub, `/clore`, passe `doc` (aucun lot n'est validé), toucher aux coûts BRouter, au noyau voile.

## L'ordre de la nuit

Celui d'Ensuite, où 225 entre dès qu'une place se libère (voulu en Ensuite le 21/11, faute de place) :

1. **222** Navigation pendant l'enregistrement (trois soucis, un lot ; Opus/high, plan par `Plan`). Un essai au téléphone en sous-ligne : une vraie navigation (rechoisir une trace retirée, l'inverser, graphe ouvert carte normale).
2. **218** FC de la nuit. La vraie nuit sert à vérifier les réglages : chercher le GPX dans `D:\memoire Tracker\essais\`, sinon, si `adb devices` voit le téléphone, le copier là depuis `Documents/Tracker/sessions/2026-11-12_22-26-49_night-hr.gpx` du téléphone. Jamais dans le dépôt (aucun GPX réel dans le projet) : l'agent `lot` le lit par son chemin absolu, les tests restent synthétiques. Sans le fichier : coder avec des traces synthétiques et écrire dans l'état de la ligne « réglages à vérifier sur la nuit du 12/11 ».
3. **215** Nom de session (activité · lieu). Envoi de la position du départ au service de cartes public : accepté le 12/11 (détail).
4. **227** « tout ouvrir » / « tout fermer ». Q73 prise par défaut : « tout ouvrir » déplie « avancé » et ouvre tous les onglets montrés de l'activité ; la noter tranchée par défaut et retirer Q73 de « Questions ». La règle « Général » et « avancé » de `CLAUDE.md` se réécrit à la passe doc, pas cette nuit.
5. **226** Titre « Enregistrement… ».
6. **228** Muscu : replier chiffres et compteur.
7. **225** Carte orientée selon le téléphone (gros, Opus/high, plan par `Plan`). Si l'extension de rotation de Leaflet ne tient pas la règle 11 de `CLAUDE.md`, ou casse les boutons de la carte, BLOQUÉ et question en « Questions », pas de bricolage.
8. **217** Programme Windows : **le lot 1 seulement** (coquille Electron écrite à la main, vrai dossier du disque, `isDesktopApp()`, `@electron/packager` plutôt qu'`electron-builder` ; « Premier pas du lot 1 » du détail). Angle 1 et Electron retenus le 12/11. « Récupérer » et « Synchroniser » restent en Ensuite : ils demandent le téléphone branché et Q70.
9. S'il reste du temps : **216** (banc : ménage des copies « avant »).

## Pièges du poste

- `isolation: "worktree"` est refusée sur ce poste : copie faite à la main, comme dans la mémoire « Pièges de la chaîne en parallèle » (`git worktree add .claude/worktrees/<nom> -b <nom> HEAD`, agent `lot` sans isolation qui travaille par chemins absolus dans la copie, rapatriement par `git apply --3way`).
- Banc : vérifier avant chaque passage que les ports 4195 et 4196 (banc de Gtracker) sont libres ; un seul banc à la fois ; rejouer seul (`-j 1`) un script en échec avant de conclure ; `--scripts-par-cote` quand le lot change des scripts.
- Les agents `Plan` et `relecture` s'arrêtent parfois sans rapport sur un gros lot : `SendMessage` « rends d'un coup ».
- Limite de quota de 5 heures : un agent coupé se reprend par `SendMessage` après l'heure de reprise ; son travail écrit reste.

## Au matin

Compte rendu d'arrêt de `/chaine`, en français courant, sans jargon : lots faits (commit, version), lots bloqués et leur stash, choix tranchés par défaut (un par ligne, à confirmer), essais au téléphone à faire, APK construite ou installée. Supprimer ce fichier dans le dernier commit de la nuit.
