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

### 3. Pistes et sentiers sans étiquette comptés en « non pavé » · priorité 2 (proposée)
- État : à clarifier (non tranché, §11 d'ETAT)
- Où : analyses à pied et à vélo, revêtement ; énergie du vélo.
- Aujourd'hui : une piste ou un sentier sans étiquette de revêtement dans OpenStreetMap reste « Inconnu », calculé avec un frottement moyen.
- Voulu : les compter en « non pavé ».
- Questions : oui ou non ?

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
- Noté le : 26/10 14:43, 14:44 et 17:41 (WhatsApp) · reçu le : 26/10 · état : en lot 10 (lot D du 26/10), bloqué : le GPX du 26/10 doit être copié hors du dépôt (`D:\memoire Tracker\essais\`)
- Tel que noté : « Vérifier la logique de temps actif en wingfoil […] il n'y a qu'un tiers de la session en vol alors que j'ai quand même pas mal volé » ; « il faut que les jibes et les tacks ne soient comptés que pour ceux où le départ était en vol » ; « il y a des virements qui sont comptés en empannage et l'inverse, et il y a des virements qui ne sont pas comptés »
- Où : analyses voile › général (temps actif), manœuvres, vent.
- Aujourd'hui : pas de calcul de vol à part : « en vol » est le masque d'activité au seuil de 8 nd sans durée minimale ; le plancher d'entrée d'une manœuvre (4 nd ou 0,16 × l'allure) n'est pas lié au seuil de vol ; classement par la bissectrice (règle 7 de CLAUDE.md).
- Voulu : un temps en vol crédible, des manœuvres comptées seulement au départ en vol, un classement juste sur la session du 26/10.
- Pourquoi : chiffres faux sur une vraie session.
- Questions : aucune de plus (réponses 4 à 6 du 26/10 données) ; il manque seulement le fichier GPX.

### 13. Surf : le seuil de l'activité ne suit pas la case Foil de la session · priorité 3 (proposée) · bogue
- Noté le : constat de la revue du code du 27/10 (C-B4, C-B5), pas une note de l'utilisateur · état : à clarifier
- Où : analyse surf › réglages (case Foil, seuil) ; Réglages › activité surf.
- Aujourd'hui : le seuil réglé pour l'activité est appliqué tel quel, Foil coché ou non : un seuil de vol de 12 km/h peut servir de seuil de vague ; le seuil de vague en foil n'est réglable que par session, pas par activité (DECISIONS §4 dit les deux).
- Voulu : à trancher.
- Questions : le seuil de l'activité doit-il suivre la case Foil de la session (deux seuils par activité, vague et vol) ? Un seuil de vague par activité en foil ?

### 14. VMA dans les tests guidés, protocole des zones · priorité 2 (proposée)
- Noté le : 25/10 (« plus tard », LISEZMOI des demandes du 25/10) · état : à clarifier
- Où : Entraînement › Tests.
- Aujourd'hui : deux tests guidés, FC max (`fc-max`) et FC repos (`fc-repos`), ni l'un ni l'autre encore essayé avec la ceinture (essais 2 et 3).
- Voulu : un test de VMA (VAMeval ou demi-Cooper), et une mise en forme du protocole des zones.
- Questions : quel protocole (VAMeval par paliers, demi-Cooper 6 min, autre) ? Après les essais 2 et 3 seulement ?

### 15. Marche : énergie propre et seuil d'activité · priorité 2 (proposée)
- Noté le : 25/10 (« plus tard ») et HISTORIQUE point 133 · état : à clarifier
- Où : analyses à pied, activité Marche.
- Aujourd'hui : l'énergie de la marche est celle de la course (Minetti), qui ne vaut pas pour la marche ; seuil d'activité 0,5 km/h (DECISIONS §2), les arrêts complets ôtés d'office depuis le point 160.
- Voulu : une énergie de marche (Pandolf ou ACSM) et un seuil décidé.
- Questions : garder le seuil à 0,5 km/h maintenant que les arrêts sont ôtés d'office ? Formule d'énergie : ACSM (simple) ou Pandolf (charge portée, pente) ?

### 17. Autres capteurs Bluetooth (puissance, cadence et vitesse à vélo) · priorité 1 (proposée)
- Noté le : HISTORIQUE point 118, repris le 25/10 (« capteurs du muscu au-delà de la FC ») · état : à clarifier
- Où : Enregistrer › capteurs ; `platform/heartRate.ts` (seule la ceinture est lue).
- Aujourd'hui : un seul service Bluetooth lu, la FC ; cadence à pied par les capteurs du téléphone.
- Voulu : lire d'autres capteurs, à faire si l'utilisateur en a un.
- Questions : avez-vous un capteur (capteur de cadence ou de puissance vélo) ? Sinon la fiche dort.

### 18. Matériel enregistré à l'avance, choisi en fin de session, statistiques par matériel · priorité 3 (proposée)
- Reçu le : 27/10 · état : prête
- Tel que noté : « créer une option qui permet de faire des pré-enregistrements de son matériel, ce qui permet facilement de les ajouter en fin de session, notamment à la voile, mais c'est pas valable que là, de façon également à avoir des stats en fonction de notre matériel. doit être une option à activer dans les paramètres de l'activité. De façon à ce qu'on puisse le faire si on a envie que pour certains sports. »
- Où : Réglages › activité (nouvelle option, et la liste du matériel) ; analyses › onglet « matos et conditions » (voile) ou « matériel et notes » (ailleurs), `SessionNotesPanel` ; Statistiques.
- Aujourd'hui : le matériel est du texte libre saisi à chaque session (`SessionNotesPanel`, champ `<input type="text">` sans suggestion) : en voile foil, mât, aile ; ailleurs deux champs `gear1`, `gear2` dont seuls les intitulés se règlent par activité (`gearLabels`, `hooks/useSportSettings.ts`). Rien n'est rangé par matériel dans Statistiques. Le matériel n'est jamais repris d'une autre session (DECISIONS §8).
- Voulu : une option par activité, dans Réglages, désactivée par défaut. Activée, un bouton ouvre le menu du matériel de l'activité : on y crée des groupes (en wing : « Voile », « Aile avant », « Mât »… ; en planche, d'autres), puis dans chaque groupe des pièces. En fin de session, l'onglet « matos et conditions » (« matériel et notes » hors voile) montre un choix par groupe parmi les pièces existantes ; on peut y ajouter une pièce sur le moment et l'enregistrer dans la liste ou non. Une session neuve part vide. Statistiques : un filtre par matériel.
- Pourquoi : saisir le matériel en fin de session sans le retaper, et comparer ses performances selon le matériel.
- Questions : choix ? → réponse (27/10) : groupes de matériel créés par l'utilisateur dans un menu de Réglages, pièces dans chaque groupe, choix par groupe en fin de session, ajout sur le moment enregistré ou non (pas d'ensembles tout prêts). Pré-choix ? → réponse (27/10) : vide, on choisit (DECISIONS §8 inchangé). Statistiques ? → réponse (27/10) : un filtre par matériel dans la page Statistiques, à côté de famille et activité. Partage entre activités ? → réponse (27/10) : non, une liste par activité. Tranché par Claude (27/10) : option active, les groupes remplacent les champs fixes de l'onglet (foil, mât, aile en voile ; `gear1`, `gear2` ailleurs), option coupée, retour aux champs fixes ; le texte déjà saisi d'une ancienne session reste montré tel quel ; la pièce choisie s'écrit dans la fiche de la session (`library/record.ts`) par son identifiant, son nom et son groupe, pour que le filtre de Statistiques la retrouve renommée (par l'identifiant) ou retirée de la liste (par le nom).

### 19. Fond de page à pied à revoir · priorité 3 (proposée)
- Noté le : 27/10 23:42 (WhatsApp) · reçu le : 28/10 · état : maquette publiée le 28/10 (https://claude.ai/artifact/GZrWwSSjsQCeSG15spGEp9 : cinq dessins, Sentier, Relief et sentier, Foulées, Balises, Chemins aérés, réglables à l'œil, à côté des autres familles ; le choix s'enregistre dans la maquette), lot à briefer sur la réponse
- Tel que noté : « Il faut revoir le fond de l'application dans les contextes à pied tout , les autres sont vraiment bien celui-là d'étonne un peu et du coup c'est légèrement une punition quand on se retrouve à la voir partout si notre activité favorite c'est la marche ou la course »
- Où : fond dessiné des pages (`PageBackdrop`, motif `course` de `core/patternTiles.ts`, encre `.page-backdrop--course` de `ui.css`) : bibliothèque à pied, et accueil, Profil, Réglages quand le sport préféré est à pied ; Statistiques sur la famille À pied.
- Aujourd'hui : six chemins pointillés qui serpentent par tuile, chacun avec un rond plein et un fanion posés dessus (tuile 390 × 640 agrandie 1,3 fois). Les autres familles : souffles de vent (voile), courbes de dénivelé (vélo), vagues (surf), traits de vitesse (Entraînement), courbes de niveau sans session. Motifs choisis sur maquette le 23/10 (DECISIONS §11).
- Voulu : un autre motif à pied, aussi réussi que les autres ; seul celui-là change.
- Pourquoi : c'est le fond de presque toutes les pages quand le sport préféré est la course ou la marche.
- Questions : quelle piste ? Tranché par Claude : une maquette de trois ou quatre motifs à pied, à côté des autres familles pour comparer, comme le 23/10 ; l'utilisateur choisit sur la maquette.

### 20. Séance du Timer : nom ou bouton coupé sur deux lignes · priorité 3 (proposée) · bogue
- Noté le : 28/10 06:29 (WhatsApp) · reçu le : 28/10 · état : prête
- Tel que noté : « Dans entraînement muscu et timer la première tuile muscu le lus "muscu " est en 2 ligne et sort très mal »
- Où : Entraînement › Muscu et timer (`/fractionne/timer`, `TrainingSessionsPage`) › ligne repliée d'une séance.
- Aujourd'hui : sur une seule ligne, le nom (`.train-item__name` : `flex: 1`, `min-width: 0`, `overflow-wrap: anywhere`), puis « Timer » et « Muscu » (chacun avec son icône, sans `nowrap`), puis la flèche. Sur téléphone, la place manque : le nom se coupe au milieu d'un mot, ou le texte d'un bouton passe à la ligne. Depuis le lot 11 (0b93147, à valider), qui a ajouté le second bouton.
- Voulu : rien de coupé au milieu d'un mot sur cette ligne. Tranché par Claude : le nom et la flèche sur la première ligne (nom coupé entre les mots seulement), les deux boutons dessous, alignés à droite, texte des boutons jamais coupé ; page du Timer seule, la ligne du Fractionné (un bouton) inchangée. Relevé au banc à largeur de téléphone (360 px), avec un nom long et un nom court. À faire avec la fiche 21, qui allonge le bouton.
- Pourquoi : la première chose qu'on voit de la page, mal rendue.
- Questions : aucune.

### 21. « Muscu » renommé « Enregistrer » sur les séances du Timer · priorité 3 (proposée)
- Noté le : 28/10 06:32 (WhatsApp) · reçu le : 28/10 · état : prête
- Tel que noté : « Dans timer et muscu il y a 2 bouton sur les tuiles "timer " et "muscu" Et faut changer " muscu" en "enregistrer " ce sera plus claire »
- Où : Entraînement › Muscu et timer › ligne d'une séance (`TrainingSessionsPage`), sous-titre de la page (`WORKOUT_LISTS.timer.subtitle`, `pages/workoutLists.ts`), lien « Muscu sans séance ».
- Aujourd'hui : deux boutons, « Timer » (compteur seul, rien d'enregistré) et « Muscu » (Enregistrer ouvert sur la muscu, séance dans la carte du compteur, ceinture obligatoire) ; le sous-titre et le lien sous la liste disent « Muscu ».
- Voulu : le bouton « Muscu » devient « Enregistrer », même action, même icône. Tranché par Claude : le sous-titre dit « « Enregistrer » enregistre la séance avec la ceinture cardio », le lien devient « Enregistrer sans séance » ; la tuile de la page Entraînement garde « Muscu et timer ». Avec la fiche 20.
- Pourquoi : dit ce que fait le bouton (une session enregistrée) au lieu du nom de l'activité.
- Questions : aucune.

### 22. Image de partage au format de l'écran, comme Komoot · priorité 3 (proposée)
- Noté le : 28/10 06:34 (WhatsApp) · reçu le : 28/10 · état : prête (maquette d'abord)
- Tel que noté : « Revoir le système d'envois de trace en image : il faut un format type komoot ( taille écran) qui sortira mieux »
- Où : analyses › « … » du nom de la session › Partager en image (`ShareDialog`) ; calculs dans `core/shareImage.ts` (`SHARE_IMAGE`), dessin dans `components/drawShareImage.ts`.
- Aujourd'hui : une image carrée de 1080 × 1080 : bandeau du titre (150 px), carte de la trace, puis jusqu'à six chiffres en deux rangées de trois (130 px chacune), pied de 60 px ; fond de carte de la famille (DECISIONS §8) ; muscu sans carte.
- Voulu : une image en hauteur, de la taille d'un écran de téléphone (1080 × 1920, 9:16), qui s'affiche en grand dans une messagerie ou une story.
- Pourquoi : le carré sort petit à l'écran ; la carte gagne de la hauteur.
- Questions : remplacer le carré ou laisser choisir le format ? → réponse (28/10) : remplace le carré, une seule image en 1080 × 1920. Disposition (carte plein cadre et chiffres posés dessus façon Komoot, ou carte puis chiffres) ? → réponse (28/10) : maquette d'abord, deux ou trois dispositions, l'utilisateur choisit.

### 23. Thème « Auto » : ne suit le téléphone qu'au redémarrage · priorité 4 (proposée) · bogue
- Noté le : 28/10 06:36 (WhatsApp) · reçu le : 28/10 · état : prête
- Tel que noté : « Le mode sombre s'active ps tout seul il faut etaindre l'application et la relancer ce serait bien que non »
- Où : Réglages › Affichage › thème (lot 12, 32f6ac7, à valider, porté par l'APK 0.3.80) ; `hooks/useTheme.ts` (`startTheme`), `android/app/src/main/AndroidManifest.xml`, `MainActivity`.
- Aujourd'hui : le JavaScript suit bien `prefers-color-scheme` (écoute `change` dans `startTheme`) et le réglage de Réglages (`jsonStore.subscribe`). Mais l'activité Android déclare `uiMode` dans `configChanges` : elle n'est pas recréée quand le téléphone change de thème, et la WebView ne réévalue probablement pas `prefers-color-scheme` ; d'où le thème qui ne change qu'au redémarrage (cause supposée, à confirmer).
- Voulu : en « Auto », le thème suit le téléphone tout de suite, application ouverte ou reprise de l'arrière-plan, sans redémarrer ; sans doute par `onConfigurationChanged` côté Android qui prévient la page. Essai au téléphone indispensable (le banc ne voit pas la WebView).
- Pourquoi : le réglage « Auto » ne tient pas sa promesse.
- Questions : dans quel cas (téléphone passé en sombre en « Auto », ou « Sombre » choisi dans Réglages) ? → réponse (28/10) : « il y a pas moyen que ça change sans relancer l'app ? » : le cas reste à préciser. Tranché par Claude : couvrir les deux ; le choix dans Réglages s'éprouve au banc, le changement du téléphone par un essai au téléphone (Auto, thème du téléphone basculé application ouverte, puis en arrière-plan).

### 24. Statistiques : ligne des heures totales par semaine dans le graphique · priorité 3 (proposée)
- Noté le : 28/10 06:39 (deux messages, WhatsApp) · reçu le : 28/10 · état : prête
- Tel que noté : « Dans stat le graph qui donne les heures selon tout les sport il faudrait une ligne dedans avec les heures total par semaine » ; « La il n'y a que une ligne pointillés avec la moyenne je crois »
- Où : Statistiques › vue d'ensemble (« Tout ») › onglet graphique, donnée « Durée » (`StatisticsPage`).
- Aujourd'hui : un point par session, à la couleur de son activité, en heures dès qu'une session atteint 2 h ; en pointillé gris, la tendance : la moyenne des 5 dernières sessions (`TREND_SESSIONS`, `library/stats.ts`), pas un total par semaine. Les semaines n'apparaissent qu'en Régularité (barres empilées du nombre de sessions par activité).
- Voulu : une ligne des heures totales de chaque semaine (toutes activités de la sélection), sur le même graphique, en plus du pointillé de la moyenne, avec une légende ; pour toute sélection (vue d'ensemble, famille, activité) dès que la donnée est « Durée ». Tranché par Claude : semaines du lundi au dimanche, comme Régularité ; une semaine sans session compte 0 h ; même axe que les sessions, en heures.
- Pourquoi : voir son volume d'entraînement semaine après semaine, que le point par session ne montre pas.
- Questions : s'ajoute au pointillé ou le remplace, et où ? → réponse (28/10) : s'ajoute, pour toute sélection quand la donnée est « Durée ».

## Archives

- 16. Faux sauts en wingfoil (10/10) : mise de côté le 27/10 (« enlever pour le moment ») ; l'essai 48 d'ESSAIS reste, pour le jour où elle revient.
- 6. Tailles de police de Statistiques alignées (25/10 10:46) : abandonnée le 27/10 (« on abandonne pour le moment »).
- 1. Pauses comptées dans la distance et le temps en mouvement (17/10) : faite au lot 1 de la revue du 27/10 (point 160 : arrêts complets ôtés d'office sous un plancher propre au calcul), validée sur le téléphone le 27/10.
