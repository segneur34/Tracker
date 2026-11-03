# 130 · Voile › manœuvres : exiger un quasi-arrêt tenu 2 s, et compter le virement fait juste après un décollage

## Tel que noté

02/11, 17:12 : « Continuer à améliorer l'algorithme de calcul des manœuvres. 1 2. Peut-être que d'avoir une vitesse minimum inférieure ou égal à au seuil c'est pas la bonne idée il faut peut-être que cette vitesse soit maintenue pendant au moins 2 secondes il y a plusieurs virements de bord au manœuvre ou juste je ralentis mais clairement je reste en vol ou avec un petit rebond sur l'eau et ce manœuvre se compte pas à mon avis valider 2 secondes d'arrêt ou de quasi-arrêt me paraît peut-être un peu plus pertinent ensuite. Numéro 2 le dernier virement de bord de la session d'aujourd'hui n'est pas compté parce que j'ai décollé juste avant de le faire peut-être que là aussi il y a une analyse à avoir d'ailleurs c'est le dernier virement fait à la fin de la session du 2 novembre. »

03/11, 06:10 : « Pour la question de mesure des vdb, 2 sec c mieux mais c'est là qu'intervient la mesure de perte de vitesse : vitesse mini dans la manœuvre. »

## Deux points

1. Aujourd'hui une manœuvre est validée quand la vitesse mini dans le virage passe sous le seuil, même un instant (un rebond sur l'eau, un ralentissement en restant en vol). Voulu : la vitesse doit rester sous le seuil au moins 2 s pour que la manœuvre compte. D'où une réserve : le 03/11, l'utilisateur rappelle que la perte de vitesse (« vitesse mini dans la manœuvre ») reste la mesure à garder ; les 2 s ne changent que la validation, pas ce chiffre.
2. Le dernier virement de la session du 02/11 n'est pas compté : l'utilisateur avait décollé juste avant. Voulu : comprendre pourquoi (décollage vu comme un état « hors manœuvre » ? fenêtre coupée par la fin de la trace ?) et le compter si c'est un vrai virement.

## À faire

- Lire `sailing/maneuvers.ts` (`analyzeManeuvers`, seuil d'entrée, vitesse mini) et DECISIONS §1 ; chercher dans HISTORIQUE (§10) les points sur la vitesse mini et le décollage.
- Besoin d'un GPX réel : celui de la session du 02/11 (fin de session) ; aucun GPX dans le projet. Demander à l'utilisateur de le copier.
- Banc avant/après en voile : dire quels chiffres bougent (manœuvres comptées en moins par la règle des 2 s, en plus par le dernier virement).
- Relier au lot 112 (virages vus deux fois : faire le changement une seule fois, des deux côtés) et à Q53.


## Notes regroupées dans ce lot (lignes d'origine, 03/11)

- 130 · [bogue] Voile › manœuvres : une manœuvre ne devrait compter que si la vitesse reste sous le seuil au moins 2 s (aujourd'hui un ralentissement ou un rebond bref en vol suffit), la perte de vitesse (vitesse mini) restant la mesure ; et le dernier virement de la session du 02/11, fait juste après un décollage, n'est pas compté · noté 02/11 · gros · Fable/high · à briefer · dépend de : le GPX du 02/11 à copier sur le PC, lot 112 (validation) · détail : docs/backlog/130-manoeuvres-arret-deux-secondes.md
- 135 · [idée] Voile › manœuvres : statistiques des virements et des empannages selon l'amure, tribord ou bâbord (réussis, vitesse mini, perte de vitesse par amure) ; voulu pour la prochaine sortie, entre en Ensuite dès qu'une place se libère · noté 02/11 · petit · Opus/high
