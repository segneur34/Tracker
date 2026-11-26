# 230 · Étude de la note de niveau sportif (25/11/2026)

Étude seule, sans code. Elle part de la fiche `230-note-niveau-sportif.md` : une note sur 100, faite de parts visibles, valable pour tous les sports, une part absente étant retirée du calcul et dite.

## 1. Les trois parts et leurs poids

- **Efforts** : ce que tu as fait ces 6 dernières semaines, durée et intensité, comparé aux repères de l'OMS.
- **Régularité** : combien de jours par semaine tu bouges, sur 12 semaines.
- **Forme pour l'âge** : ta place parmi les gens de ton âge et de ton sexe, d'après un 5 km, un 10 km, une sortie vélo ou un test de FC de repos.

| Jeu | Efforts | Régularité | Forme | Ce qu'il dit |
|---|---|---|---|---|
| J1 « ce que tu fais » | 50 % | 30 % | 20 % | la note suit l'entraînement, vite |
| J2 équilibré | 40 % | 25 % | 35 % | moitié activité, moitié forme |
| J3 « ce que tu vaux » | 25 % | 15 % | 60 % | la note suit surtout la forme mesurée |

**Recommandé : J1.** La demande parle des efforts faits. La voile et le surf n'ont pas de table de performance, donc une forme dominante donnerait une note qui ne veut pas dire la même chose pour un coureur et pour un wingfoiler. Enfin la forme se mesure rarement (un 5 km vaut 12 mois) : avec 35 ou 60 %, la note resterait collée à une course ancienne.

Une part absente est retirée et les autres sont remises à l'échelle (par exemple sans forme, J1 devient 62,5 % et 37,5 %). Les trois jeux gardent à peu près le même rapport entre efforts et régularité (5 pour 3), donc sans forme ils donnent la même note. Ils ne diffèrent que quand la forme est connue.

**Plafond sans forme** (`NOTE_CAP_WITHOUT_FORME`, 74) : sans forme mesurée, la note s'arrête au palier « Sportif ». Les deux paliers du haut demandent une mesure. Le test de FC de repos existe pour tous les sports, donc ce plafond ne ferme rien à la voile ni au surf.

## 2. Formules

Toutes les durées en secondes, les vitesses en m/s, les fenêtres en jours. Chaque repère est un paramètre nommé, rangé dans un profil de la note.

### Efforts

1. Fenêtre `EFFORT_WINDOW_DAYS` = 42, comptée depuis la première session de l'application si elle est plus récente, au moins `EFFORT_MIN_DAYS` = 14 (un nouvel utilisateur n'est pas puni pour un passé non importé, comme la régularité des Statistiques, §10).
2. Temps compté d'une session : le même que la racine (temps en mouvement, sinon durée, en surf le temps à l'eau).
3. Intensité, en trois classes de l'OMS : légère (moins de 3 MET), modérée (3 à 6 MET), vigoureuse (6 MET et plus), avec un facteur `INTENSITY_FACTORS` = léger 0,5, modéré 1, vigoureux 2 (l'OMS compte une minute vigoureuse pour deux modérées).
4. Avec ceinture : les secondes couvertes par la FC sont rangées par zone (histogramme du résumé), `INTENSITY_BY_ZONE` = sous Z1 léger, Z1 et Z2 modéré, Z3 à Z5 vigoureux, à caler au plan sur le modèle de zones. Les secondes sans FC prennent l'intensité du sport.
5. Sans ceinture, intensité du sport (`SPORT_INTENSITY`, d'après le Compendium 2024) :

| Sport | Classe | Repère du Compendium |
|---|---|---|
| À pied, sous 4 km/h de moyenne en mouvement | légère | marche 4 km/h : 3,0 MET |
| À pied, de 4 à 7 km/h | modérée | marche 4,8 km/h : 3,8, 6,4 km/h : 5,5 |
| À pied, 7 km/h et plus | vigoureuse | course 8 km/h : 8,5 |
| Vélo sous 19 km/h | modérée | loisir 15 km/h : 5,8 |
| Vélo 19 km/h et plus | vigoureuse | 19 à 22 km/h : 8,0 |
| Wing, planche, kite | modérée | windsurf sans pomper : 5,0 (pas d'entrée kite ni wing) |
| Bateau | légère | dériveur 2,0, voilier de loisir 3,3 |
| Surf, sur le temps à l'eau | modérée | surf 3,0, rame 6,8 |
| Muscu | modérée | renforcement varié 3,5 |
| Fractionné, test de FC max | vigoureuse | fractionné 7,0 à 11,0 |
| Tests de FC de repos et de nuit | non comptés | ce ne sont pas des efforts |

Les bornes de vitesse sont des paramètres (`FOOT_SPEED_BOUNDS_MS` = 1,11 et 1,94, `BIKE_VIGOROUS_MS` = 5,28). Le D+ n'est pas pris en compte (limite connue).

6. `E` = minutes équivalentes modérées par semaine, `V` = la partie vigoureuse de `E`. Au-delà de 300, seules les minutes vigoureuses font monter : `Ec = min(E, 300 + V)`.
7. Points, par segments droits sur `EFFORT_REFS` = 0, 150, 300, 600 min qui valent 0, 50, 75, 100 points. 150 et 300 sont les repères de l'OMS (les mêmes de 18 à plus de 65 ans). 600 (deux fois le haut de l'OMS) est un choix de l'étude, sans source.
8. Moins de 18 ans : repères multipliés par 420/150 (l'OMS demande 60 min par jour de 5 à 17 ans).

### Régularité

Fenêtre `REGULARITY_WINDOW_DAYS` = 84, coupée en tranches de 7 jours finissant aujourd'hui, comptée depuis la première session si elle est plus récente, au moins `REGULARITY_MIN_DAYS` = 42. Un jour est actif à partir de `ACTIVE_DAY_MIN` = 20 min équivalentes. Chaque tranche vaut `min(1, jours actifs / 3)` (`ACTIVE_DAYS_TARGET` = 3), la part est leur moyenne × 100. Le 3 est un choix : l'OMS le demande aux plus de 65 ans (activités d'équilibre) et aux jeunes, pas aux adultes.

### Forme pour l'âge

Moyenne des sources présentes, chacune en points de 0 à 100, égaux au rang dans la population de son âge et de son sexe (interpolé entre les colonnes des tables).

- **Course** : meilleure VO2max estimée d'un 5 km ou 10 km des 365 derniers jours (`FORME_WINDOW_DAYS`, formule de Daniels déjà dans le code), située dans les tables FRIEND 2022 (`vo2maxPercentile`). L'« âge-grade » des Statistiques compare à l'élite mondiale, pas aux gens de ton âge : il reste dans Statistiques.
- **Vélo** : VO2max ≈ 11 × (W/kg au seuil / 0,75) + 7 (équation de l'ACSM pour le pédalage, seuil pris à 75 % de la puissance maximale, `FTP_SHARE_OF_MAX`), puis FRIEND. Approximatif, et dit comme tel.
- **Cœur** : dernier test de FC de repos des 180 derniers jours (`REST_HR_WINDOW_DAYS`), points = 100 moins son rang dans les tables NHANES par âge et sexe (une FC basse est bonne). La FC de nuit n'entre pas : elle se mesure en dormant, plus bas que toute table.

## 3. Fenêtres et arrêt

Fenêtres fixes, indépendantes de la période choisie en haut de Profil : 6 semaines pour les efforts, 12 pour la régularité, 12 mois pour la course et le vélo, 6 mois pour la FC de repos. Une part à zéro parce que rien n'a été fait reste à zéro : seule une part impossible à calculer est retirée.

Coureur du profil 1 (J1) qui s'arrête net :

| Après | Efforts | Régularité | Forme | Note |
|---|---|---|---|---|
| 0 | 70 | 100 | 65 | 78, Très sportif |
| 2 semaines | 55 | 83 | 65 | 66, Sportif |
| 1 mois | 26 | 64 | 65 | 45, Actif |
| 3 mois | 0 | 0 | 65 | 13, Au repos |
| 1 an | 0 | 0 | absente | 0, Au repos |

## 4. Paliers

| Note | Nom |
|---|---|
| 0 à 19 | Au repos |
| 20 à 39 | En route |
| 40 à 59 | Actif |
| 60 à 74 | Sportif |
| 75 à 89 | Très sportif (forme mesurée requise) |
| 90 à 100 | Athlète (forme mesurée requise) |

Pas de « sédentaire » ni de « débutant » : les noms disent où on en est, pas ce qu'on vaut.

## 5. Note, racine et fleur

- La **fleur** dit ta semaine en cours, face à ton propre objectif.
- La **racine** dit ta constance face à ce même objectif, semaine après semaine, sur 6 mois. Elle ne voit que le temps, pas l'intensité.
- La **note** dit où tu te situes face aux repères communs de ton âge (OMS, population), intensité comptée, sur des fenêtres fixes.

Elles ne se recopient pas : la racine juge le temps de la semaine selon ton objectif, la régularité de la note compte les jours actifs (3 par semaine), quel que soit l'objectif.

## 6. Simulation

Hypothèses : (1) homme de 28 ans, 3 courses de 45 min par semaine, 5 km en 20 min (VO2max 49,8, rang 65 entre 20 et 29 ans). (2) homme de 45 ans, 2 sorties de wing par semaine, 1 h 30 en mouvement chacune, sans ceinture. (3) femme de 62 ans, 1 h de marche à 5 km/h chaque jour. (4) homme de 35 ans, une sortie vélo de 4 h à 25 km/h le samedi, 3,0 W/kg estimés (VO2max 51, rang 83). (5) femme de 30 ans, depuis 3 semaines 3 courses-marches de 30 min à 6,5 km/h. (6) le profil 1, arrêté depuis un mois.

| Profil | Efforts | Régularité | Forme | J1 | J2 | J3 |
|---|---|---|---|---|---|---|
| 1. Coureur 28 ans | 70 | 100 | 65 | 78 Très sportif | 76 Très sportif | 72 Sportif |
| 2. Wing 45 ans | 55 | 67 | absente | 59 Actif | 59 Actif | 59 Actif |
| 3. Marcheuse 62 ans | 75 | 100 | absente | 74 Sportif (84 sans plafond) | 74 Sportif | 74 Sportif |
| 4. Vélo du samedi 35 ans | 90 | 33 | 83 | 72 Sportif | 73 Sportif | 77 Très sportif |
| 5. Débutante 3 semaines | 30 | 50 | absente | 38 En route | 38 En route | 38 En route |
| 6. Coureur arrêté 1 mois | 26 | 64 | 65 | 45 Actif | 49 Actif | 55 Actif |

Ce qui paraît juste : l'ordre des profils, la débutante « En route », le cycliste du samedi pénalisé sur la régularité mais pas sur le volume, la chute nette après un mois d'arrêt.

Où ça choque :
- **La marcheuse** passerait devant le coureur (84) sans le plafond et sans la règle « au-delà de 300, seul le vigoureux compte ». Avec les deux, 74. Si elle fait un test de FC de repos à 62 battements (rang 16, forme 84), elle monte à 84, Très sportif : défendable, elle est en meilleure forme que la plupart des femmes de son âge.
- **Le wing sans ceinture** compte en « modéré » : 3 h par semaine ne valent que 55. C'est prudent, sans doute bas pour du foil. Avec une ceinture, ses zones feront foi. Avec un test de FC de repos à 58 (forme 82), il passe à 64.
- **Le rang FRIEND** est sévère : 20 min au 5 km à 28 ans ne donne que 65. Les tables viennent de gens testés en laboratoire, souvent sportifs.
- **J1 avec beaucoup de volume** : 5 courses d'une heure par semaine et la même forme donnent 93, Athlète, avec une forme moyenne (88 en J2, 79 en J3). Acceptable pour une note qui dit « ce que tu fais ».

## 7. Ce qui s'affiche

Un cadre en haut de Profil, hors de la période : « Niveau sportif », le chiffre en grand, le nom du palier, « sur tes 6 dernières semaines ». Dessous, une ligne par part : son nom, sa note sur 100 en barre, son poids effectif (« compte pour 62 % »), et une phrase de preuve (« 270 min d'effort par semaine, dont 270 vigoureuses », « 3 jours actifs par semaine », « 5 km en 20:00, mieux que 65 % des hommes de 20 à 29 ans »). Une part absente est dite en clair, avec ce qui la donnerait : « Forme pour l'âge : pas encore mesurée. Cours un 5 km ou fais un test de FC de repos. » Sous le plafond : « Sans forme mesurée, la note s'arrête à 74. » Il faut l'année de naissance et le sexe, sinon la phrase d'invite des Statistiques.

Aide « ? » :
> Ta note va de 0 à 100 et compare ce que tu fais aux repères des gens de ton âge. Les efforts comptent ton temps de sport des 6 dernières semaines, une minute intense valant deux minutes tranquilles. La régularité regarde si tu bouges au moins 3 jours par semaine, sur 12 semaines. La forme te situe parmi les gens de ton âge et de ton sexe, d'après un 5 km, un 10 km, une sortie vélo ou ta FC de repos. Une part sans mesure n'est pas comptée, elle n'est jamais mise à zéro.

## 8. Sources

| Repère | Adresse | Vérifié |
|---|---|---|
| OMS 2020 : 150 à 300 min modérées ou 75 à 150 vigoureuses, plus de 300 pour davantage de bienfaits, plus de 65 ans idem plus 3 jours d'équilibre, 5 à 17 ans 60 min par jour | https://www.who.int/europe/news-room/fact-sheets/item/physical-activity | oui, à la source |
| Compendium 2024 des activités (MET) | https://pacompendium.com/water-activities/, /running/, /walking/, /bicycling/, /conditioning-exercise/ | oui, à la source |
| FC de repos selon l'âge et le sexe (NHANES 1999-2008, tables 2 et 3, pouls assis mesuré 30 s) | https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf | oui, à la source. Ex. hommes 20-39 ans : rang 25 à 61, médiane 69. Femmes 60-79 : 64 et 70 |
| FRIEND 2022 (Kaminsky, Mayo Clin Proc 97(2):285) | doi 10.1016/j.mayocp.2021.08.020 | non : pages protégées. Seule la cohérence est recoupée (médiane 2015 des hommes de 20-29 ans à 48,0, baisse de 1,5 à 4,6 en 2022, le code dit 45,4) |
| Classes de MET de l'OMS (3 et 6), intensité ACSM par réserve cardiaque, équation de l'ACSM pour le vélo, seuil à 75 % de la puissance maximale | | non vérifiés |
| 3 jours par semaine pour les adultes, plafond 600 min, plafond 74 | | choix de l'étude, sans source |

Limite connue : le test de FC de repos de l'application (couché, 30 s les plus basses) donne moins que le pouls assis de NHANES, donc un rang un peu flatteur. Aucune correction (`REST_HR_TABLE_OFFSET_BPM` = 0).

## 9. Questions pour l'utilisateur

1. Quel jeu de poids ? Par défaut J1 (efforts 50, régularité 30, forme 20).
2. Faut-il une forme mesurée pour les paliers « Très sportif » et « Athlète » ? Par défaut oui, ce qui pousse au test de FC de repos.
3. Les noms des paliers conviennent-ils ? Par défaut ceux du §4.
4. « Les efforts que tu fais exprès » : toutes les sessions comptent-elles, marche et bateau compris ? Par défaut oui, à leur intensité.

## 10. Réponse de l'utilisateur le 26/11, sur la maquette (https://claude.ai/artifact/Hz8zoKZvnXMbLvm9TpBUx8)

« J'aime bien, il faut juste faire gaffe à l'intégration de la racine. » La note est acceptée dans son principe (parts, paliers, poids recommandés J1, plafond à 74 sans forme mesurée, faute de remarque contraire). Point d'attention pour le plan et le code : la place du cadre « Niveau sportif » par rapport à la racine et à la fleur du Profil (le dessin de la racine est en haut à droite de la page) : ni chevauchement, ni deux éléments qui se disputent le haut de la page, ni deux choses qui disent la même. Non précisé : la présentation retenue, A (tout déplié) ou B (une ligne qui se déplie) ; à redemander avant de coder, ou montrer les deux avec la vraie racine dessinée.
