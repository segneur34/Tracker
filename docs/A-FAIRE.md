# À faire : idées de modification

Les idées que l'utilisateur note au fil de l'eau (WhatsApp) et donne en vrac, mises au propre ici. Une idée qui devient un lot passe dans la file des lots (`~/.claude/plans/FILE-DES-LOTS.md`) ; sa fiche reste ici, avec l'état « en lot » et le numéro du lot.

## Priorité

| Note | Sens |
|---|---|
| 5 | Très important : gêne l'usage, ou faux chiffre |
| 4 | Important, à faire bientôt |
| 3 | Utile |
| 2 | Confort, quand il y a de la place |
| 1 | Très peu important, idée à garder |

C'est l'utilisateur qui donne la priorité. Claude en propose une, marquée « (proposée) », tant que l'utilisateur ne l'a pas confirmée.

## Mise au propre (pour Claude)

Quand l'utilisateur donne des notes en vrac :
1. Une fiche par idée, même si une note en contient plusieurs. Le texte d'origine est recopié mot pour mot, avec la date de la note si elle est connue.
2. La reformuler aussitôt : où dans l'application (page, onglet, bouton), ce qui se passe aujourd'hui, ce qui est voulu, et pourquoi.
3. Poser les questions **dans la même séance**, tant que l'utilisateur s'en souvient : seulement ce qui change ce qu'on ferait. Une réponse se note dans la fiche, datée.
4. Avant de créer une fiche, chercher si l'idée existe déjà ici, dans la file des lots ou dans `docs/DECISIONS.md`. Si elle contredit une décision, le dire.
5. La fiche n'est « prête » que si quelqu'un d'autre pourrait la réaliser sans rien demander.

États : `à clarifier` · `prête` · `en lot N` · `faite` · `abandonnée`. Une fiche faite ou abandonnée descend dans « Archives », sur une ligne.

## Modèle de fiche

```
### N. Titre court · priorité X
- Noté le : jj/mm (WhatsApp) · reçu le : jj/mm · état : à clarifier
- Tel que noté : « … »
- Où : page › onglet › élément
- Aujourd'hui : …
- Voulu : …
- Pourquoi : …
- Questions : … → réponse (jj/mm)
```

## Idées

### 2. Logo à côté de « Tracker » sur l'accueil · priorité 1 (proposée)
- État : à clarifier
- Où : accueil, titre « Tracker ».
- Voulu : un logo à côté du nom.
- Questions : quel logo (dessin, image donnée par l'utilisateur) ? Toujours voulu ?

### 4. Mode daltonien · priorité 1 (proposée)
- État : à clarifier, voulu « plus tard »
- Où : couleurs des traces et des graphes.
- Voulu : des couleurs lisibles par un daltonien.
- Questions : quel type de daltonisme ? Pour qui ?

### 5. Montre connectée Android · priorité 2 (proposée)
- Noté le : 22/10 (WhatsApp) · reçu le : 27/10 · état : à clarifier
- Tel que noté : « Lien avec montre connectée android possible ? »
- Où : enregistrement (capteurs), ou import des sessions.
- Aujourd'hui : seule la ceinture cardio Bluetooth est lue (§12 d'ETAT) ; une montre est citée parmi les capteurs à venir (ETAT §11, point 118) ; les GPX d'une montre s'importent déjà par le dossier mémoire.
- Voulu : un lien avec la montre, à préciser.
- Questions : quoi faire avec la montre ? → réponse (27/10) : les trois, lire sa FC à la place de la ceinture, importer ses sessions sans fichier, piloter l'enregistrement du poignet, et d'abord savoir si c'est possible. Réponse de Claude (27/10) : la FC, oui si la montre diffuse la FC en Bluetooth standard (Garmin « diffusion FC », Polar, Coros, Suunto ; pas une montre Wear OS ni un bracelet Xiaomi sans application tierce) : rien à coder, c'est la ceinture d'aujourd'hui ; l'import sans fichier dépend de la marque et passe par son compte en ligne (gros chantier, à part) ; piloter du poignet demande une application Wear OS à part (très gros chantier). Reste : quelle montre (marque et modèle) ?

### 7. Boutons d'Entraînement dans l'orange de la famille · priorité 2 (proposée)
- Noté le : 25/10 16:55 (WhatsApp) · reçu le : 27/10 · état : prête
- Tel que noté : « la couleur de bouton dans entrainement doit s'aligner avec le orange de l'entrainement »
- Où : page Entraînement (`/fractionne`) et ses pages Séances, Timer, Tests.
- Aujourd'hui : les icônes des tuiles sont déjà en orange (`--fractionne`) ; les boutons d'action (« Lancer », « Créer un compteur », éditeur) prennent la couleur commune.
- Voulu : tous les boutons d'action de la famille Entraînement en orange (`--fractionne`, texte blanc) : « Lancer », « Créer un compteur », « Enregistrer » et boutons de l'éditeur, pages Séances, Timer et Tests ; le bouton rond de l'enregistrement garde son vert et son rouge.
- Questions : quels boutons ? → réponse (27/10) : tous les boutons d'action de la famille.

### 8. Chiffres proposés en Réglages limités à ceux qui ont un sens pour l'activité · priorité 2 (proposée)
- Noté le : 25/10 21:56 (WhatsApp, fin de la note sur « Étape ») · reçu le : 27/10 · état : prête
- Tel que noté : « chantier pour plus tard faire des notif que pour certain sport » ; précisé le 27/10 : « les possibilités de notification et d'affichage qui se règlent dans les paramètres dépendent du sport dans lequel on est en train de les choisir : le D+ en bateau n'a pas de sens, et l'avancement dans la série n'a pas de sens en rando ».
- Où : Réglages › activité › enregistrement › chiffres de la carte réduite et de la notification.
- Aujourd'hui : la liste est déjà filtrée par traitement (`liveFieldsOfTreatment`, `recording/liveFields.ts`) : D+, pente, puissance absents en voile et en surf ; tops récents, cap et balises réservés à la voile. Seul écart : « Étape » est proposé à toute activité à terre, marche comprise, parce que le compteur peut accompagner un enregistrement à pied ou à vélo.
- Voulu : « Étape » proposé seulement aux activités de la famille Entraînement (fractionné, tests, muscu) ; relire la table pour tout autre chiffre sans sens pour un sport.
- Pourquoi : un choix sans sens dans la liste trompe.
- Questions : aucune.

### 9. Dépendances npm à mettre à jour · priorité 3 (proposée)
- Noté le : 27/10 19:47 (WhatsApp, « verifier les dependance ») · reçu le : 27/10 · état : prête
- Où : `package.json`, `npm outdated`, `npm audit`.
- Aujourd'hui (relevé du 27/10 au soir) : aucune vulnérabilité dans les dépendances de production ; 7 dans celles de développement (2 hautes : `vite` 8.3.0 via `launch-editor`, `source-map-js` ; 5 modérées : `@vitest/mocker`, `uuid` via `@capacitor/cli`), toutes réparables par `npm audit fix`, sauf `uuid` qui demanderait `--force`. Quinze paquets ont une version plus récente dans la même majeure (Capacitor 8.5.3, Vite 8.3.5, Vitest 5.0.5, React 19.3.1, oxlint 1.90, `@capgo/background-geolocation` 8.5.0…) ; deux changent de majeure (TypeScript 7, `@types/node` 26), à ne pas prendre sans un lot dédié.
- Voulu : mettre à jour dans la même majeure (`npm update` puis `npm audit fix`), puis verif complète, banc `general`, et un APK pour le greffon GPS.
- Pourquoi : deux failles hautes côté outils de développement ; le greffon GPS et Capacitor ont des correctifs.
- Questions : aucune ; c'est un petit lot Sonnet medium quand vous voulez.

### 10. Muscu avec ceinture cardio, sur la base du Timer · priorité 4 (proposée)
- Noté le : 25/10 09:22 (WhatsApp) · reçu le : 25/10 · état : en lot 11 (lot I du 25/10), prête (Timer tranché le 28/10)
- Tel que noté : « dans entrainement cree un mode muscu avec ceinture cardiaque qui utlise le compteur d'inervalle pour les timer et qui garde principalement la fc dans un graph »
- Où : Entraînement › nouvelle tuile ou type « Muscu » ; Enregistrer ; analyse sans carte.
- Aujourd'hui : le Timer (point 154) fait tourner une séance à blocs sans GPS ni session ; rien n'est enregistré. Les tests de FC repos vivent dans une clé de l'appareil.
- Voulu : une session sans GPS qui n'enregistre que la FC (1 Hz) et les phases du compteur ; GPX sans trace, analyse sans carte, graphe de FC avec les phases.
- Pourquoi : suivre la FC en muscu et gainage avec les mêmes outils.
- Questions : place ? → réponse (27/10) : fusionner les tuiles Fractionné et Tests de la page Entraînement en une seule (le dire dans son titre) et créer une tuile « Muscu » ; un calcul « Muscu » dans la famille Entraînement, type « Muscu » dans la rangée Type d'Enregistrer. Ceinture ? → réponse (27/10) : obligatoire, pas de session muscu sans ceinture jointe. Fichier ? → tranché par Claude : GPX dont les points n'ont que l'heure et la FC, lu par le lecteur maison. Le Timer reste-t-il tel quel à côté (compteur seul, sans session) ? → réponse (27/10) : « autre » ; précisé le 28/10 : « À la fin, il ne restera que deux boutons. Un bouton fractionné plus test et un bouton muscu plus timer. Il faut toujours qu'on puisse lancer le timer séparément de la muscu. Mais par contre, la muscu doit a priori se lancer avec le timer. Pas forcément obligatoire, mais ce sera très souvent le cas. » Donc : deux tuiles, « Fractionné et tests » et « Muscu et timer » ; dans la seconde, chaque séance du Timer se lance en « Timer » (compteur seul, rien d'enregistré) ou en « Muscu » (session enregistrée avec la ceinture, compteur pendant) ; muscu sans séance possible depuis Enregistrer (FC et repères seuls) ; une seule liste de séances du Timer.

### 11. Mode sombre et/ou économe en énergie · priorité 3 (proposée)
- Noté le : 25/10 12:07 (WhatsApp) · reçu le : 25/10 · état : en lot 12 (lot H du 25/10), prête (maquette tranchée le 28/10)
- Tel que noté : « Crée un mode sombre et/ou économe en énergie »
- Où : Réglages (par appareil) ; toute l'interface par les variables de `theme/tokens.css` ; cartes, graphes, photos, image de partage.
- Aujourd'hui : un seul thème clair ; aucune variable sombre, pas de `prefers-color-scheme`.
- Voulu : un thème sombre, et une option économe.
- Questions : forme ? → réponse (27/10) : trois états Clair · Sombre · Auto (suit le téléphone), par appareil, retenus, plus une option « Économe » d'aspect (noir pur, moins d'effets) ; le GPS et l'écran pendant l'enregistrement ne sont pas touchés. Maquette (28/10, https://claude.ai/artifact/99u9R7hpNdxJmKphtnbqkN) tranchée : familles éclaircies d'un cran en sombre, texte blanc gardé ; carte laissée claire, sans filtre ; réglage de départ Auto ; en économe, vignettes des sessions sur fond noir comme les cartes. Palette proposée dans la maquette (fond #12161b, cartes #1c2229 ; économe : fond #000000, cartes #0d0f12).

### 12. Voile à foil : temps en vol, manœuvres comptées seulement en vol, virements et empannages mal classés · priorité 5 (proposée) · bogue
- Noté le : 26/10 14:43, 14:44 et 17:41 (WhatsApp) · reçu le : 26/10 · état : en lot 10 (lot D du 26/10), GPX du 26/10 dans `D:\memoire Tracker\Tracker\sessions\`, lot débloqué
- Tel que noté : « Vérifier la logique de temps actif en wingfoil […] il n'y a qu'un tiers de la session en vol alors que j'ai quand même pas mal volé » ; « il faut que les jibes et les tacks ne soient comptés que pour ceux où le départ était en vol » ; « il y a des virements qui sont comptés en empannage et l'inverse, et il y a des virements qui ne sont pas comptés »
- Où : analyses voile › général (temps actif), manœuvres, vent.
- Aujourd'hui : pas de calcul de vol à part : « en vol » est le masque d'activité au seuil de 8 nd sans durée minimale ; le plancher d'entrée d'une manœuvre (4 nd ou 0,16 × l'allure) n'est pas lié au seuil de vol ; classement par la bissectrice (règle 7 de CLAUDE.md).
- Voulu : un temps en vol crédible, des manœuvres comptées seulement au départ en vol, un classement juste sur la session du 26/10.
- Pourquoi : chiffres faux sur une vraie session.
- Questions : aucune de plus (réponses 4 à 6 du 26/10 données) ; le fichier GPX est là.

### 14. VMA dans les tests guidés, protocole des zones · priorité 2 (proposée)
- Noté le : 25/10 (« plus tard », LISEZMOI des demandes du 25/10) · état : à clarifier
- Où : Entraînement › Tests.
- Aujourd'hui : deux tests guidés, FC max (`fc-max`) et FC repos (`fc-repos`), ni l'un ni l'autre encore essayé avec la ceinture (essais 2 et 3).
- Voulu : un test de VMA (VAMeval ou demi-Cooper), et une mise en forme du protocole des zones.
- Questions : quel protocole (VAMeval par paliers, demi-Cooper 6 min, autre) ? Après les essais 2 et 3 seulement ?

### 17. Autres capteurs Bluetooth (puissance, cadence et vitesse à vélo) · priorité 1 (proposée)
- Noté le : HISTORIQUE point 118, repris le 25/10 (« capteurs du muscu au-delà de la FC ») · état : à clarifier
- Où : Enregistrer › capteurs ; `platform/heartRate.ts` (seule la ceinture est lue).
- Aujourd'hui : un seul service Bluetooth lu, la FC ; cadence à pied par les capteurs du téléphone.
- Voulu : lire d'autres capteurs, à faire si l'utilisateur en a un.
- Questions : avez-vous un capteur (capteur de cadence ou de puissance vélo) ? Sinon la fiche dort.

### 20. Séance du Timer : nom ou bouton coupé sur deux lignes · priorité 3 (proposée) · bogue
- Noté le : 28/10 06:29 (WhatsApp) · reçu le : 28/10 · état : en lot 15 (95426d6, 0.3.82, à valider)
- Tel que noté : « Dans entraînement muscu et timer la première tuile muscu le lus "muscu " est en 2 ligne et sort très mal »
- Où : Entraînement › Muscu et timer (`/fractionne/timer`, `TrainingSessionsPage`) › ligne repliée d'une séance.
- Aujourd'hui : sur une seule ligne, le nom (`.train-item__name` : `flex: 1`, `min-width: 0`, `overflow-wrap: anywhere`), puis « Timer » et « Muscu » (chacun avec son icône, sans `nowrap`), puis la flèche. Sur téléphone, la place manque : le nom se coupe au milieu d'un mot, ou le texte d'un bouton passe à la ligne. Depuis le lot 11 (0b93147, à valider), qui a ajouté le second bouton.
- Voulu : rien de coupé au milieu d'un mot sur cette ligne. Tranché par Claude : le nom et la flèche sur la première ligne (nom coupé entre les mots seulement), les deux boutons dessous, alignés à droite, texte des boutons jamais coupé ; page du Timer seule, la ligne du Fractionné (un bouton) inchangée. Relevé au banc à largeur de téléphone (360 px), avec un nom long et un nom court. À faire avec la fiche 21, qui allonge le bouton.
- Pourquoi : la première chose qu'on voit de la page, mal rendue.
- Questions : aucune.

### 21. « Muscu » renommé « Enregistrer » sur les séances du Timer · priorité 3 (proposée)
- Noté le : 28/10 06:32 (WhatsApp) · reçu le : 28/10 · état : en lot 15 (95426d6, 0.3.82, à valider)
- Tel que noté : « Dans timer et muscu il y a 2 bouton sur les tuiles "timer " et "muscu" Et faut changer " muscu" en "enregistrer " ce sera plus claire »
- Où : Entraînement › Muscu et timer › ligne d'une séance (`TrainingSessionsPage`), sous-titre de la page (`WORKOUT_LISTS.timer.subtitle`, `pages/workoutLists.ts`), lien « Muscu sans séance ».
- Aujourd'hui : deux boutons, « Timer » (compteur seul, rien d'enregistré) et « Muscu » (Enregistrer ouvert sur la muscu, séance dans la carte du compteur, ceinture obligatoire) ; le sous-titre et le lien sous la liste disent « Muscu ».
- Voulu : le bouton « Muscu » devient « Enregistrer », même action, même icône. Tranché par Claude : le sous-titre dit « « Enregistrer » enregistre la séance avec la ceinture cardio », le lien devient « Enregistrer sans séance » ; la tuile de la page Entraînement garde « Muscu et timer ». Avec la fiche 20.
- Pourquoi : dit ce que fait le bouton (une session enregistrée) au lieu du nom de l'activité.
- Questions : aucune.

### 24. Statistiques : ligne des heures totales par semaine dans le graphique · priorité 3 (proposée)
- Noté le : 28/10 06:39 (deux messages, WhatsApp) · reçu le : 28/10 · état : en lot 16 (9f5ed36, 0.3.83, à valider)
- Tel que noté : « Dans stat le graph qui donne les heures selon tout les sport il faudrait une ligne dedans avec les heures total par semaine » ; « La il n'y a que une ligne pointillés avec la moyenne je crois »
- Où : Statistiques › vue d'ensemble (« Tout ») › onglet graphique, donnée « Durée » (`StatisticsPage`).
- Aujourd'hui : un point par session, à la couleur de son activité, en heures dès qu'une session atteint 2 h ; en pointillé gris, la tendance : la moyenne des 5 dernières sessions (`TREND_SESSIONS`, `library/stats.ts`), pas un total par semaine. Les semaines n'apparaissent qu'en Régularité (barres empilées du nombre de sessions par activité).
- Voulu : une ligne des heures totales de chaque semaine (toutes activités de la sélection), sur le même graphique, en plus du pointillé de la moyenne, avec une légende ; pour toute sélection (vue d'ensemble, famille, activité) dès que la donnée est « Durée ». Tranché par Claude : semaines du lundi au dimanche, comme Régularité ; une semaine sans session compte 0 h ; même axe que les sessions, en heures.
- Pourquoi : voir son volume d'entraînement semaine après semaine, que le point par session ne montre pas.
- Questions : s'ajoute au pointillé ou le remplace, et où ? → réponse (28/10) : s'ajoute, pour toute sélection quand la donnée est « Durée ».

### 25. Pumping en wing (et toute voile sur foil) · priorité 3 (proposée)
- Noté le : 28/10 (essai 5 d'ESSAIS : « Pumping : une vraie session de wing avec un premier vol », données en main : wing du 26/10 avec `.imu`) · reçu le : 28/10 · état : en lot 22 (`demandes-2810/lot22-pumping-wing.md`), après le lot 10
- Tel que noté : essai 5 attendu « Pumping et premier vol détectés » sur une session de wing ; constat du 28/10 : le pumping n'est codé que pour le surf sur foil.
- Où : analyses voile › nouvel onglet « pumping » (après « sauts ») ; Réglages › activité de voile › case Pumping sous Foil ; onglet réglages de l'analyse (par session).
- Aujourd'hui : `surfing/pumping.ts` mesure le pumping par vol de surf foil depuis le `.imu` (coups, fréquence, distance pompée, décollage) ; rien en voile, où le `.imu` ne sert qu'aux sauts.
- Voulu : la même mesure par vol en voile sur foil, calcul commun (`core/`), seuils partagés et surchargeables par calcul, réglés sur la session du 26/10 lue hors dépôt (`D:\memoire Tracker\Tracker\sessions\2026-10-26_13-28-20_wingfoil.*`).
- Pourquoi : c'est en wing que l'utilisateur pompe ; l'essai 5 l'attend.
- Questions : maintenant ou après le lot 10 (vols) ? → réponse (28/10) : un lot maintenant ; il reste après le lot 10 dans la file, dont il dépend.

## Archives

- 3. Pistes et sentiers sans étiquette comptés en « non pavé » (28/10) : faite au lot 21 (f9d75a9, 0.3.88 ; point 178), validée sur le téléphone le 28/10 (essai 60).
- 15. Marche : énergie propre et seuil d'activité (25/10) : faite au lot 21 (Pandolf et Santee, seuil retiré ; point 178), validée le 28/10 (essai 60).
- 18. Matériel enregistré par groupes, statistiques par matériel (27/10) : faite au lot 20 (0.3.87 à 0.3.91 ; point 177), validée le 28/10 (essai 59).
- 19. Fond de page à pied à revoir (27/10) : faite au lot 18 (38c4c2e, 0.3.85 ; point 175), validée le 28/10 (essai 57).
- 22. Image de partage au format de l'écran (28/10) : faite au lot 19 (2ce02cd, 0.3.86 ; point 176), validée le 28/10 (essai 58).
- 13. Surf : seuil de l'activité et case Foil de la session (constat de la revue du 27/10, C-B4, C-B5) : abandonnée le 28/10 (« un seul seuil, tel quel »).
- 23. Thème « Auto » qui ne suivait le téléphone qu'au redémarrage (28/10, bogue) : faite au lot 17 (1b9be77, 0.3.84 : greffon Screen, événement darkModeChange), validée sur le téléphone le 28/10 (essai 56).
- 16. Faux sauts en wingfoil (10/10) : mise de côté le 27/10 (« enlever pour le moment ») ; l'essai 48 d'ESSAIS reste, pour le jour où elle revient.
- 6. Tailles de police de Statistiques alignées (25/10 10:46) : abandonnée le 27/10 (« on abandonne pour le moment »).
- 1. Pauses comptées dans la distance et le temps en mouvement (17/10) : faite au lot 1 de la revue du 27/10 (point 160 : arrêts complets ôtés d'office sous un plancher propre au calcul), validée sur le téléphone le 27/10.
