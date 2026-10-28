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

## Archives

- 25. Pumping en wing et dans toute voile sur foil (28/10) : faite au lot 22 (9005969, 0.3.93 ; point 186), validée le 28/10 (essai 62).
- 12. Voile à foil : temps en vol, manœuvres comptées seulement en vol, virements et empannages mal classés (26/10, bogue) : faite au lot 10 (4daa54d, 0.3.92 ; point 185), validée le 28/10 (essai 61).
- 20. Séance du Timer : nom ou bouton coupé sur deux lignes (28/10, bogue) : faite au lot 15 (95426d6, 0.3.82 ; point 183), validée le 28/10.
- 21. « Muscu » renommé « Enregistrer » sur les séances du Timer (28/10) : faite au lot 15 (95426d6, 0.3.82 ; point 183), validée le 28/10.
- 24. Statistiques : ligne des heures totales par semaine (28/10) : faite au lot 16 (9f5ed36, 0.3.83 ; point 184), validée le 28/10 (essai 55).
- 10. Muscu avec ceinture cardio, sur la base du Timer (25/10) : faite au lot 11 (0b93147 et 99c533f, 0.3.80 et 0.3.81 ; point 182), validée le 28/10 (essais 51 à 54).
- 11. Mode sombre et/ou économe en énergie (25/10) : faite au lot 12 (32f6ac7, 0.3.79 ; point 181), validée le 28/10 (essais 49 et 50).
- 7. Boutons d'Entraînement dans l'orange de la famille (27/10) : faite au lot 13 (36fddac, 0.3.77 ; point 179), validée le 28/10.
- 8. Chiffres proposés en Réglages limités à ceux qui ont un sens (27/10) : faite au lot 13 (« Étape » réservé à l'Entraînement ; point 179), validée le 28/10.
- 9. Dépendances npm à mettre à jour (27/10) : faite au lot 14 (f1ae515, 0.3.78 ; point 180), validée le 28/10 (essais 28 + 34).
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
