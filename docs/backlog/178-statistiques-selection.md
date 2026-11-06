# 178 · Statistiques : sélection plus lisible, parties repliables

Détail de l'élément 178 de `docs/BACKLOG.md`.

- Tel que noté (05/11, 18:23) : « Il faut augmenter la taille du bouton pour réduire et augmenter la sélection de paramétrer des statistiques. Crée un bouton matériel qui est sélectionnable que si on a coché la case matériel dans les paramètres de l'activité si on clique sur le bouton matériel le choix des matériels apparaît il faut que ça soit rétractable et augmentable pareil comme il faut que ce soit rétractable et augmentable la partie choix de l'activité comme ça on peut plus facilement avoir des menus réduits le menu total est plus grand mais on peut voir des menus réduits plus clair »
- Où : page Statistiques, bloc « Sélection » (`pages/StatisticsPage.tsx`, repli `ChartFold`).
- Aujourd'hui (vérifié le 06/11) : « Sélection » est un seul bouton repliable, petit (padding 6 px, `--text-s`), qui montre le choix en cours ; dessous, d'un seul bloc, famille, activité, matériel et période. Le filtre par matériel existe déjà : une rangée par groupe, « Tous » puis les pièces, seulement si l'activité a une liste de matériel (case « Créer liste matériel » de Réglages, `gearGroups`) et pour les groupes portés par une session de la période.
- Voulu :
  1. un bouton « Sélection » plus grand ;
  2. un bouton « Matériel », grisé si l'activité n'a pas sa case « Créer liste matériel » cochée, qui déplie et replie le choix des pièces ;
  3. de même, le choix de l'activité repliable.
- Pourquoi : le menu entier est plus long, mais replié il reste clair.
- À respecter : §10 de `DECISIONS.md` dit que « Sélection » est un seul bloc, replié au départ, état retenu ; ce bloc reste, ses parties gagnent chacune un repli. §11 : libellés courts des boutons glissants, pour tenir à 320 px.
- Question laissée au lot : avec « Toutes » les activités, pas de case à lire ; par défaut, « Matériel » est grisé (le filtre porte déjà sur une activité).
