# Essais au téléphone

Les seuls essais demandés à l'utilisateur sur le téléphone. Règle (CLAUDE.md, Environnement) : seulement les essais vraiment critiques (ce que ni les tests ni le banc ne voient : GPS, capteurs, ceinture, notification, écran éteint, rendu tactile) et ceux où Claude a un vrai doute, plus les questions à trancher. Quelques essais par paquet, jamais une longue liste.

L'utilisateur répond par numéro : « ok », ou ce qui ne va pas. Les numéros se suivent et ne sont jamais réutilisés. Un essai fait descend dans « Faits », sur une ligne. Pour un essai avec la ceinture, rebrancher le téléphone au PC **avant** de relancer quoi que ce soit (le journal Bluetooth, `adb logcat -s TrackerHR`, s'efface avec le temps).

## À faire (paquets en attente de validation)

APK 0.3.81 construite et **installée** le 28/10 au matin (correctif Q9 et Q12 du lot 11) ; elle porte aussi, comme la 0.3.80 : lots 13, boutons orange et « Étape » ; 14, dépendances npm dont le greffon GPS 8.5.0 ; 12, thème sombre et économe ; 11, muscu avec ceinture. Les essais 28 + 34 et 37 + 43 restent avant de marquer « validés » les lots de la revue du 27/10, les lots A et B du 26/10 et les lots 13 et 14, puis de passer la doc ; ils valent aussi pour le greffon GPS monté au lot 14. Les essais 49 et 50 valident le lot 12 ; 51 à 54 le lot 11 (muscu, 0b93147, correctif Q9 et Q12 en 0.3.81).

| N° | Essai | Attendu |
|---|---|---|
| 28 + 34 | Un vrai enregistrement d'une heure ou plus, avec la notification, une pause, et si possible une trace suivie. | Chiffres du direct, distance restante, bips et pause automatique justes et sans retard tout du long ; analyse normale ensuite. |
| 37 + 43 | Un fractionné avec la ceinture, écran verrouillé. | Tuile « BPM » au-dessus de Durée et Vitesse, état de la ceinture lisible ; notification « Étape n/N · Vit. ». **Question : après « Étape », vitesse, distance ou FC ?** |
| 50 | Lot 12 : « Sombre » puis « Économe » sur Accueil, une analyse, Enregistrer et Réglages. | Tout lisible ; la carte reste claire dans l'interface sombre ; en économe, fond noir, vignettes trace seule sans plan (à juger) ; le texte bleu voile sur fond sombre (« Renommer », onglet choisi) est à juger à l'œil. |
| 52 | Lot 11 : Enregistrer › Type Muscu sans ceinture à portée. | « Démarrer » grisé avec la phrase qui dit pourquoi ; ceinture mise, il devient possible. |
| 53 | Lot 11 : muscu sans séance (lien « Muscu sans séance ») avec deux « Note ». | Repères dans l'analyse, sur le graphe. |
| 54 | APK 0.3.81 (Q9 et Q12) : un fractionné à pied, puis une muscu avec une séance du Timer ; « Arrêter » la session avant la fin de la séance. | Notification « Étape n/N · FC » en fractionné ; le compteur s'arrête avec la session (plus de bips), et l'analyse montre la séance arrêtée à l'heure de l'arrêt. |

## Quand l'occasion se présente (terrain)

| N° | Essai | Attendu |
|---|---|---|
| 1 | Ceinture, écran éteint : marche de 10 à 15 min, téléphone posé, pause automatique décochée ; trois ou quatre fois 2 min près du téléphone puis 1 à 2 min hors de portée. Remettre la pause automatique après. | Reprise seule à chaque retour ; onglet « cardio » avec un trou par sortie de portée. |
| 2 | Test de FC max : Entraînement › Tests › FC max › Lancer, ceinture portée, sur terrain plat. | Échauffement guidé, rampe avec bips, onglet « test » avec FC max ; « Retenir cette FC max ». Débloque le lot des zones de FC. |
| 4 | Cadence : une vraie course, téléphone dans la poche. **Données en main** (28/10) : courses du 21, 24 et 25/10 avec `.imu` sur le téléphone ; Claude les relit. | Environ 160 à 180 pas/min. |
| 5 | Pumping : une vraie session de wing avec un premier vol. **Données en main** (28/10) : wing du 26/10 en vent léger, avec `.imu` ; le pumping n'est codé que pour le surf sur foil, son passage en wing est un lot (Fable, high). | Pumping et premier vol détectés. |
| 46 | Surf : une vraie session. | Vagues, temps sur la vague et rame crédibles (seuils jamais validés). |
| 47 | Racine du Profil sur quelques vraies semaines. | Recul, fleur et feuilles tombées qui suivent la semaine. |
| 48 | Wingfoil avec des sauts, en notant à part les vrais sauts. | Sert au lot des faux sauts (demandes du 10/10, lot 2). |

## Faits

- 49 (thème Auto, lot 12) et 51 (muscu avec ceinture et Timer, lot 11) : ok le 28/10 ; la question du 51 (compteur après « Arrêter ») reste ouverte, Q12 de la file.
- 3 (FC repos) : ok le 28/10, fait avant le protocole v2 (moyenne sur 30 s, 25/10) ; résultat dans la clé de l'appareil, pas dans les sessions.
- 6, 25, 27, 35, 40 : ok le 27/10 (le vide sous la racine en « Semaine » et le redessin de la carte au retour du plein écran sont acceptés).
- 7 à 24, 26, 29 à 33, 36, 38, 39, 41, 42, 44, 45 : retirés le 27/10, couverts par les tests et le banc (règle ci-dessus).

L'ancienne liste détaillée (n° 1 à 45) : `~/.claude/plans/demandes-2410b/A-TESTER.md`, archive.
