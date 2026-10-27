# Essais au téléphone

Les seuls essais demandés à l'utilisateur sur le téléphone. Règle (CLAUDE.md, Environnement) : seulement les essais vraiment critiques (ce que ni les tests ni le banc ne voient : GPS, capteurs, ceinture, notification, écran éteint, rendu tactile) et ceux où Claude a un vrai doute, plus les questions à trancher. Quelques essais par paquet, jamais une longue liste.

L'utilisateur répond par numéro : « ok », ou ce qui ne va pas. Les numéros se suivent et ne sont jamais réutilisés. Un essai fait descend dans « Faits », sur une ligne. Pour un essai avec la ceinture, rebrancher le téléphone au PC **avant** de relancer quoi que ce soit (le journal Bluetooth, `adb logcat -s TrackerHR`, s'efface avec le temps).

## À faire (paquets en attente de validation)

APK 0.3.78 installée (28/10 : lots 13, boutons orange et « Étape », et 14, dépendances npm dont le greffon GPS 8.5.0). Ces deux essais restent avant de marquer « validés » les lots de la revue du 27/10, les lots A et B du 26/10 et les lots 13 et 14 (file des lots), puis de passer la doc ; ils valent aussi pour le greffon GPS monté au lot 14.

| N° | Essai | Attendu |
|---|---|---|
| 28 + 34 | Un vrai enregistrement d'une heure ou plus, avec la notification, une pause, et si possible une trace suivie. | Chiffres du direct, distance restante, bips et pause automatique justes et sans retard tout du long ; analyse normale ensuite. |
| 37 + 43 | Un fractionné avec la ceinture, écran verrouillé. | Tuile « BPM » au-dessus de Durée et Vitesse, état de la ceinture lisible ; notification « Étape n/N · Vit. ». **Question : après « Étape », vitesse, distance ou FC ?** |

## Quand l'occasion se présente (terrain)

| N° | Essai | Attendu |
|---|---|---|
| 1 | Ceinture, écran éteint : marche de 10 à 15 min, téléphone posé, pause automatique décochée ; trois ou quatre fois 2 min près du téléphone puis 1 à 2 min hors de portée. Remettre la pause automatique après. | Reprise seule à chaque retour ; onglet « cardio » avec un trou par sortie de portée. |
| 2 | Test de FC max : Entraînement › Tests › FC max › Lancer, ceinture portée, sur terrain plat. | Échauffement guidé, rampe avec bips, onglet « test » avec FC max ; « Retenir cette FC max ». Débloque le lot des zones de FC. |
| 3 | FC repos : le matin au réveil, allongé, ceinture portée : Enregistrer › Test › FC repos, 3 min. | Courbe et résultat ; « La retenir » remplit Pratiquant. Débloque le lot des zones de FC. |
| 4 | Cadence : une vraie course, téléphone dans la poche. | Environ 160 à 180 pas/min. |
| 5 | Pumping : une vraie session de wing avec un premier vol. Claude vérifie avant où en est le code (branche `lot6-pumping`). | Pumping et premier vol détectés. |
| 46 | Surf : une vraie session. | Vagues, temps sur la vague et rame crédibles (seuils jamais validés). |
| 47 | Racine du Profil sur quelques vraies semaines. | Recul, fleur et feuilles tombées qui suivent la semaine. |
| 48 | Wingfoil avec des sauts, en notant à part les vrais sauts. | Sert au lot des faux sauts (demandes du 10/10, lot 2). |

## Faits

- 6, 25, 27, 35, 40 : ok le 27/10 (le vide sous la racine en « Semaine » et le redessin de la carte au retour du plein écran sont acceptés).
- 7 à 24, 26, 29 à 33, 36, 38, 39, 41, 42, 44, 45 : retirés le 27/10, couverts par les tests et le banc (règle ci-dessus).

L'ancienne liste détaillée (n° 1 à 45) : `~/.claude/plans/demandes-2410b/A-TESTER.md`, archive.
