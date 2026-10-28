# 29 · Tests guidés : VMA, bips de palier, protocole des zones

Détail de l'élément 29 de `docs/BACKLOG.md`. Repris le 28/10 (lot 33) de la fiche 14 d'`A-FAIRE.md` (archivée dans `~/.claude/plans/archives/A-FAIRE-2810.md`), de la ligne 29 de la file des lots et de la ligne « Entraînement » du §11 d'ETAT. Brief du lot à écrire ici, sous ce qui suit.

## Fiche 14 d'A-FAIRE, telle quelle

### 14. VMA dans les tests guidés, protocole des zones · priorité 2 (proposée, en attente de confirmation le 28/10)
- Noté le : 25/10 (« plus tard », LISEZMOI des demandes du 25/10) · état : prête
- Où : Entraînement › Tests.
- Aujourd'hui : deux tests guidés, FC max (`fc-max`) et FC repos (`fc-repos`), ni l'un ni l'autre encore essayé avec la ceinture (essais 2 et 3).
- Voulu : un test de VMA (VAMeval ou demi-Cooper), et une mise en forme du protocole des zones.
- Questions : quel protocole ? → réponse (28/10) : **les deux**, demi-Cooper et VAMeval, et la mécanique des bips de palier est à implémenter. Priorité en attente. Plan : lot 29 du doc « Reste à faire Tracker » (https://claude.ai/artifact/CoFqizqhNZMwm47DxPbLH7).

Depuis : l'essai 3 (FC repos) est fait le 28/10, avant le protocole v2 (moyenne sur 30 s, 25/10) ; le résultat reste dans la clé de l'appareil (`tracker.restingHr`), pas dans les sessions. L'essai 2 (FC max) attend une course avec la ceinture (`docs/BACKLOG.md`, « Ça attend une occasion »).

## Ligne de la file des lots (28/10)

| 29 | Tests guidés : VMA par demi-Cooper et VAMeval (Q30), mécanique des bips de palier, protocole des zones, FC repos rangée dans les sessions sans position (fiche 14) | à écrire (même doc) | Opus / high | Q30 répondue ; maquette si l'écran des tests change ; validation terrain essai 2 | à briefer | |

Q30 (lot 29, fiche 14) : « Protocole de VMA : demi-Cooper ou VAMeval ? » Recommandé : demi-Cooper d'abord. Réponse : **les deux**, avec la mécanique des bips de palier à implémenter (28/10 soir).

## Ligne « Entraînement » du §11 d'ETAT (points 143 à 145), avant le lot 33

- tests de FC max et de FC repos gardés sans essai avec la ceinture (25/10) : à éprouver sur le terrain, la session relue par adb si besoin ;
- les tests de FC repos gardent la clé de l'appareil (`tracker.restingHr`) : ils pourront rejoindre les sessions sans position, que la muscu a ouvertes (point 182, prédicat `hasPositions`) ;
- plus tard : la VMA dans les tests, le protocole des zones et sa mise en forme.

## Tel que noté le 28/10

« ça peut attendre : on va déjà tester le premier ; le problème que je vois avec la VMA c'est qu'il faut que ce soit plat et sur terrain dur et facile à courir, sinon ça n'a pas de sens »

Conséquence : le lot attend l'essai du test de FC max. Au brief, prévoir que le test de VMA dise où le courir (piste ou route plate) et, à la relecture, signale un résultat douteux si la session a du dénivelé ou un revêtement non roulant (D+ et revêtement déjà calculés par l'application) ; à confirmer avec l'utilisateur.
