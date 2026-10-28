# Essais au téléphone

Les seuls essais demandés à l'utilisateur sur le téléphone. Règle (CLAUDE.md, Environnement) : seulement les essais vraiment critiques (ce que ni les tests ni le banc ne voient : GPS, capteurs, ceinture, notification, écran éteint, rendu tactile) et ceux où Claude a un vrai doute, plus les questions à trancher. Quelques essais par paquet, jamais une longue liste.

L'utilisateur répond par numéro : « ok », ou ce qui ne va pas. Les numéros se suivent et ne sont jamais réutilisés. Un essai fait descend dans « Faits », sur une ligne. Pour un essai avec la ceinture, rebrancher le téléphone au PC **avant** de relancer quoi que ce soit (le journal Bluetooth, `adb logcat -s TrackerHR`, s'efface avec le temps).

## À faire (paquets en attente de validation)

Paquet 9 (lots 23, 32, 24 et 25) : **APK 0.3.95 installée** le 28/10 au soir (versionCode 3095). Lot 23 (petites dettes) sans essai : prouvé par les tests et le banc.

| N° | Essai | Attendu |
|---|---|---|
| 63 | Icône « Enregistrer » (lot 32) : bouton rond de la barre du bas au repos, puis pendant un enregistrement ; Entraînement › Muscu et timer, bouton « Enregistrer » d'une séance ; en clair et en sombre. | Disque blanc avec un rond rouge au repos, bouton rond toujours vert ; carré pendant l'enregistrement, comme avant. Dire si l'icône vous plaît. |

## Quand l'occasion se présente (terrain)

| N° | Essai | Attendu |
|---|---|---|
| 1 | Ceinture, écran éteint : marche de 10 à 15 min, téléphone posé, pause automatique décochée ; trois ou quatre fois 2 min près du téléphone puis 1 à 2 min hors de portée. Remettre la pause automatique après. | Reprise seule à chaque retour ; onglet « cardio » avec un trou par sortie de portée. |
| 2 | Test de FC max : Entraînement › Tests › FC max › Lancer, ceinture portée, sur terrain plat. | Échauffement guidé, rampe avec bips, onglet « test » avec FC max ; « Retenir cette FC max ». Débloque le lot des zones de FC. |
| 4 | Cadence : une vraie course, téléphone dans la poche. **Données en main** (28/10) : courses du 21, 24 et 25/10 avec `.imu` sur le téléphone ; Claude les relit. | Environ 160 à 180 pas/min. |
| 46 | Surf : une vraie session. | Vagues, temps sur la vague et rame crédibles (seuils jamais validés). |
| 47 | Racine du Profil sur quelques vraies semaines. | Recul, fleur et feuilles tombées qui suivent la semaine. |
| 48 | Wingfoil avec des sauts, en notant à part les vrais sauts. | Sert au lot des faux sauts (demandes du 10/10, lot 2). |

## Faits

- 61 (vols et manœuvres en voile, lot 10) et 62 (pumping en wing, lot 22) : ok le 28/10 au soir sur l'APK 0.3.93 ; lots 10 et 22 validés. L'essai 5 (pumping en wing, terrain) est couvert par le 62.
- 28 + 34 (vrai enregistrement d'une heure avec notification, pause et trace suivie) et 37 + 43 (fractionné avec la ceinture, écran verrouillé, notification « Étape · FC ») : ok le 28/10 au soir ; lots 1 à 9 de la file (revue du 27/10, A et B du 26/10), 13 et 14 (greffon GPS 8.5.0 compris) validés.
- 50 (thème sombre et économe, lot 12), 52, 53, 54 (muscu avec ceinture, repères, séance arrêtée avec la session, lot 11), 55 (heures par semaine dans Statistiques, lot 16) : ok le 28/10 au soir ; lots 11, 12, 15 et 16 validés.
- 57 (fond À pied « Relief et sentier », lot 18), 58 (image de partage 1080 × 1920, lot 19), 60 (énergie de la marche et non pavé, lot 21) : ok le 28/10 sur l'APK 0.3.88 ; lots 18, 19, 21 validés.
- 59 (matériel par groupes, lot 20) : ok le 28/10 sur l'APK 0.3.91, après deux correctifs demandés à l'essai (partie « Matériel » à part dans Réglages, liste des groupes en ligne et dépliable, « Créer liste matériel », « Créer groupe matériel ») ; lot 20 validé.
- 56 (thème « Auto » qui suit le téléphone sans redémarrer, lot 17) : ok le 28/10 ; lot 17 validé.
- 49 (thème Auto, lot 12) et 51 (muscu avec ceinture et Timer, lot 11) : ok le 28/10 ; la question du 51 (compteur après « Arrêter ») reste ouverte, Q12 de la file.
- 3 (FC repos) : ok le 28/10, fait avant le protocole v2 (moyenne sur 30 s, 25/10) ; résultat dans la clé de l'appareil, pas dans les sessions.
- 6, 25, 27, 35, 40 : ok le 27/10 (le vide sous la racine en « Semaine » et le redessin de la carte au retour du plein écran sont acceptés).
- 7 à 24, 26, 29 à 33, 36, 38, 39, 41, 42, 44, 45 : retirés le 27/10, couverts par les tests et le banc (règle ci-dessus).

L'ancienne liste détaillée (n° 1 à 45) : `~/.claude/plans/demandes-2410b/A-TESTER.md`, archive.
