# 215 · Nom de base d'une session : l'activité et le lieu

## Tel que noté (12/11)

« GENERAL : quand on fait un enregistrement il faut que le nom de base soit l'activitée ( mis a jour si modifier et que nom a jamais etait modifier) mais il faudrait aussi le lieux genre la ville la plus proche, le nom de la plage.... tu propose quoi pour le nommage ? »

## Où

Partout où une session porte un nom : ligne de bibliothèque (`pages/SessionLibrary.tsx`), en-tête des analyses (`components/SessionNameEditor.tsx`), image de partage, GPX téléchargé (`library/sessionBundle.ts`), listes de Statistiques, écran de fin d'enregistrement.

## Aujourd'hui (vérifié dans le code le 12/11)

- Une session n'a pas de nom tant que l'utilisateur ne l'a pas saisi : `record.name` est vide, l'en-tête de l'analyse écrit « Sans nom », la ligne de bibliothèque ne montre que l'activité et la date.
- L'enregistreur écrit dans le GPX un titre figé « Activité, 23/09/2026 14:05 » (`recording/session.ts`, `sessionTitle`), gardé dans la fiche (`title`) mais qui ne suit pas un changement d'activité et n'est pas montré comme nom.
- Seule exception, depuis le lot 213 : une nuit reçoit un nom rangé dans la fiche, « Nuit du 12 au 13/11 » (`library/newRecord.ts`, `defaultName`).
- Aucun lieu n'est cherché ni gardé. La recherche de lieux par leur nom existe en planification (`planning/geocoding.ts`, service Photon), pas la recherche inverse (un nom à partir d'une position).

## Proposé

1. **Un nom calculé, jamais figé** : tant que l'utilisateur n'a rien saisi, le nom se compose à l'affichage à partir de l'activité de la session et de son lieu. Changer l'activité change donc le nom tout seul. Dès qu'un nom est saisi (« Renommer »), c'est lui qui vaut, pour toujours ; l'effacer rend le nom calculé.
2. **Forme** (à choisir par l'utilisateur) : « Activité · Lieu » (« Wing · Carnon-Plage », « Course · Montpellier »), la date restant à côté comme aujourd'hui. Sans lieu connu : l'activité seule.
3. **Le lieu, par famille** :
   - voile et surf : le plan d'eau du départ (plage, port, étang, baie nommés à moins de 1 à 2 km du point de mise à l'eau), sinon la commune ;
   - à pied et à vélo : la commune du départ ; si l'arrivée est dans une autre commune à plus de quelques kilomètres, « Montpellier → Sète » ;
   - sans position (muscu, tests, nuit) : pas de lieu ; la nuit garde « Nuit du 12 au 13/11 », qui devient lui aussi un nom calculé.
4. **Le lieu est gardé dans la fiche** (`place`), cherché une fois, à la fin de l'enregistrement ou à l'import ; sans réseau à ce moment-là, cherché plus tard, à l'ouverture de l'analyse ou de la bibliothèque, comme l'altitude et le revêtement. Il servira aussi à la recherche de la bibliothèque (n° 110).
5. **Lieux appris** (à choisir) : corriger le lieu d'une session le retient pour les suivantes qui partent du même endroit (à moins de 500 m), ce qui donne le vrai nom du spot (« Le Grand Travers ») plutôt que celui de la carte.
6. Le GPX téléchargé d'une session non renommée part sous `AAAA-MM-JJ Activité - Lieu.gpx` ; le titre écrit dans le GPX à l'enregistrement reste tel quel.

## À savoir

- Trouver le lieu envoie la position du départ à un service de cartes public (comme le font déjà l'altitude, le revêtement et les itinéraires). Rien d'autre n'est envoyé.
- Le nom de la carte n'est pas toujours celui que l'on emploie (une plage sans nom, un lieu-dit obscur) : d'où les lieux appris.
- Seuils (rayon de recherche d'un plan d'eau, distance départ-arrivée pour « A → B », rayon d'un lieu appris) : dans un profil, pas en dur (règle 3).
- Fichiers probables : un module pur `library/sessionName.ts` (nom calculé, testé), la recherche inverse dans `planning/geocoding.ts` ou un voisin, le champ `place` de `library/record.ts`, et les endroits qui affichent un nom.

## Réponses de l'utilisateur (12/11)

- Forme du nom : « Activité · Lieu ».
- En voile et en surf : la plage ou le plan d'eau le plus proche de la mise à l'eau, la commune seulement à défaut.
- Lieux appris : oui, un lieu corrigé vaut pour les sessions suivantes parties du même endroit (moins de 500 m).
- Rangement : « à faire dans la prochaine session » ; en tête d'Ensuite.
