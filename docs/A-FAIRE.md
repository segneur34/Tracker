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

### 1. Pauses comptées dans la distance et le temps en mouvement · priorité 4 (proposée)
- Noté le : 17/10 · état : prête, mise de côté par l'utilisateur (ne pas la traiter sans son feu vert)
- Tel que noté : (relevé dans une analyse) 12,5 km affichés pour 5,4 km réels.
- Où : analyses de toutes les sessions qui ont des pauses (plusieurs segments `trkseg` dans le GPX).
- Aujourd'hui : le trajet fait pendant une pause est compté dans la distance et dans le temps en mouvement.
- Voulu : les pauses ne comptent ni dans la distance ni dans le temps en mouvement.
- Pourquoi : les chiffres sont faux.

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
- Questions : quelle montre (marque, Wear OS ou non) ? Quoi : lire sa FC à la place de la ceinture, importer ses sessions sans passer par un fichier, ou piloter l'enregistrement depuis le poignet ?

### 6. Tailles de police de Statistiques alignées · priorité 2 (proposée)
- Noté le : 25/10 10:46 (WhatsApp) · reçu le : 27/10 · état : à clarifier
- Tel que noté : « aligner les taille de police dans statistique »
- Où : page Statistiques.
- Aujourd'hui : plusieurs tailles (`--text-s`, `--text-xs`, titres de sections, chiffres des tuiles) ; rien n'a été touché depuis la note.
- Voulu : des tailles cohérentes entre les blocs de la page.
- Questions : quels blocs se contredisent (tuiles de chiffres, titres de sections, légende du graphe, liste) ? Sur téléphone, ordinateur ou les deux ?

### 7. Boutons d'Entraînement dans l'orange de la famille · priorité 2 (proposée)
- Noté le : 25/10 16:55 (WhatsApp) · reçu le : 27/10 · état : à clarifier
- Tel que noté : « la couleur de bouton dans entrainement doit s'aligner avec le orange de l'entrainement »
- Où : page Entraînement (`/fractionne`) et ses pages Séances, Timer, Tests.
- Aujourd'hui : les icônes des tuiles sont déjà en orange (`--fractionne`) ; les boutons d'action (« Lancer », « Créer un compteur », éditeur) prennent la couleur commune.
- Voulu : les boutons de la famille en orange.
- Questions : quels boutons exactement (« Lancer » du Timer, « Créer un compteur », ceux de l'éditeur, tous) ? Le bouton rond de l'enregistrement garde son vert et son rouge (décision transverse).

### 8. Notification propre à certains sports · priorité 1 (proposée)
- Noté le : 25/10 21:56 (WhatsApp, fin de la note sur « Étape ») · reçu le : 27/10 · état : à clarifier
- Tel que noté : « chantier pour plus tard faire des notif que pour certain sport »
- Où : Réglages › activité › enregistrement › notification.
- Aujourd'hui : les deux chiffres de la notification se règlent déjà par activité (« Étape » d'office en Entraînement depuis le point 171) ; la notification elle-même est toujours là pendant un enregistrement (Android l'exige pour le GPS en arrière-plan).
- Voulu : à préciser.
- Questions : s'agit-il de choisir les chiffres par sport (déjà fait), de ne pas montrer de notification pour certains sports (impossible pendant un enregistrement GPS), ou d'autre chose (bips, alertes de zone) ?

### 9. Dépendances npm à mettre à jour · priorité 3 (proposée)
- Noté le : 27/10 19:47 (WhatsApp, « verifier les dependance ») · reçu le : 27/10 · état : prête
- Où : `package.json`, `npm outdated`, `npm audit`.
- Aujourd'hui (relevé du 27/10 au soir) : aucune vulnérabilité dans les dépendances de production ; 7 dans celles de développement (2 hautes : `vite` 8.3.0 via `launch-editor`, `source-map-js` ; 5 modérées : `@vitest/mocker`, `uuid` via `@capacitor/cli`), toutes réparables par `npm audit fix`, sauf `uuid` qui demanderait `--force`. Quinze paquets ont une version plus récente dans la même majeure (Capacitor 8.5.3, Vite 8.3.5, Vitest 5.0.5, React 19.3.1, oxlint 1.90, `@capgo/background-geolocation` 8.5.0…) ; deux changent de majeure (TypeScript 7, `@types/node` 26), à ne pas prendre sans un lot dédié.
- Voulu : mettre à jour dans la même majeure (`npm update` puis `npm audit fix`), puis verif complète, banc `general`, et un APK pour le greffon GPS.
- Pourquoi : deux failles hautes côté outils de développement ; le greffon GPS et Capacitor ont des correctifs.
- Questions : aucune ; c'est un petit lot Sonnet medium quand vous voulez.

## Archives

(vide)
