# N° 39 : énergie de Tracker comparée aux méthodes publiées (06/11)

Étude sur documents, sans montre. Chiffres de Tracker calculés avec le vrai code (script du bloc-notes de session : 1 Hz, vitesse et pente constantes par tronçon, 75 kg, repos 1 MET faute de profil complet). Ce qui n'a pas pu être relu à la source est marqué « de mémoire ».

## 1. Ce que calcule Tracker

- **Course** (`src/running/energy.ts`) : énergie métabolique nette, repos déduit. Coût par mètre = 200 ml O2/kg/km x 20,9 J/ml = 4,18 J/kg/m (la règle de 1 kcal/kg/km), multiplié par la forme de la courbe de Minetti 2002 (polynôme d'ordre 5, borné à +/-45 %, 3,6 au plat) ramenée à ce plat, plus l'air 0,0065 x v2 (J/kg/m). Charge portée : coût x (1 + charge/poids). Marche : Pandolf-Santee, à part.
- Travail mécanique = net x 0,25 (affiché en W). Repos = Mifflin-St Jeor si poids, taille, âge, sexe connus, sinon 3,5 ml/kg/min (1,22 W/kg), sur toute la durée, pauses comprises. Deux chiffres en kcal : « énergie de course » (net) et « dépense totale, repos compris ».
- **Vélo** (`src/cycling/energy.ts`) : force = m g (Crr cos + sin) + 1/2 rho CdA v2 (rho 1,225, air calme, pas de vent), par segment, bornée à 0 en descente ; travail = force x distance / 0,97 (transmission) ; énergie nette = travail / 0,25 (rendement musculaire net) ; repos ajouté comme à pied. Énergie cinétique ignorée.
- Route : Crr 0,004 (asphalte), CdA 0,32, vélo 8,5 kg (réglable) ; gravel 0,005 / 0,45 / 12 kg ; VTT 0,008 / 0,5 / 13 kg. Crr par revêtement (route : pavés 0,012, terre 0,016, herbe 0,03, sable 0,06). Cycliste : 75 kg si poids absent.
- Décisions : HISTORIQUE points 71 (Minetti recalé sur 200 ml/kg/km ; k de l'air « ordre de grandeur, non confirmé »), 72 (Martin 1998, 0,97 et 0,25, descente gratuite), 88 (Crr par revêtement, « ordres de grandeur à confirmer »).

## 2. Références trouvées

- **Margaria 1963** : coût net de la course indépendant de la vitesse, environ 1 kcal/kg/km au plat ; 0,97 chez Mayhew 1977 ([Margaria](https://pubmed.ncbi.nlm.nih.gov/13932993/), chiffre de mémoire).
- **Minetti 2002** : tapis, -45 % à +45 %, course 3,40 +/- 0,24 J/kg/m au plat (résumé) ; polynôme à 3,6 ([article](https://iris.unibs.it/retrieve/ddc633e4-3c03-4e2e-e053-3705fe0a4c80/Minetti%20JAP%202002.pdf), illisible : 403). Les coefficients du code sont ceux que je connais ; la recherche n'a pas pu les reconfirmer.
- **ACSM** (course) : VO2 net = 0,2 ml/kg/m + 0,9 ml/kg/m x pente (montée seulement), soit environ 1,0 kcal/kg/km + 4,5 x pente ; valable au-delà de 134 m/min ([source](https://pubmed.ncbi.nlm.nih.gov/24376318/)).
- **Strava** : course = f(vitesse ajustée à la pente, poids, durée en mouvement) x facteur non publié ; vélo = puissance (mesurée, sinon estimée avec poids du cycliste et du vélo) x « coefficient d'efficacité humaine » non publié ; son glossaire donne environ 1 kJ de travail = 1 kcal ([aide](https://support.strava.com/en-us/articles/15402159-how-does-strava-calculate-calories), [glossaire](https://support.strava.com/hc/en-us/articles/216917147-Strava-Training-Glossary-for-Cycling)). 1 kJ = 1 kcal revient à un rendement brut de 23,9 %. Les calories importées d'une montre priment sur son calcul.
- **Garmin** : calories d'activité par Firstbeat, à partir de la FC (et de sa variabilité), moins le métabolisme de base ; « actives » = totales moins repos. Source : forums Garmin et [DC Rainmaker](https://dcrainmaker.com/2010/11/how-calorie-measurement-works-on-garmin.html), pas de document officiel lu.
- **Vélo** : Martin et al. 1998, modèle validé contre un capteur de puissance, erreur type 2,7 W ([notice](https://www.bisp-surf.de/Record/PU199905309685)). Crr route 0,003 - 0,005. CdA : Wilson (Bicycling Science) cité à 0,32 en bas du cintre et 0,40 sur les cocottes, d'autres sources 0,30 - 0,40 sur les cocottes ([synthèse](https://sites.google.com/view/powerbikepro/blog-en/aerodynamic-drag)). Rendement brut du cycliste 18 - 23 %, net 24 - 25 % : de mémoire, non retrouvé par la recherche.
- **Compendium des activités** (de mémoire ; brut, repos inclus, 1 MET = 1 kcal/kg/h) : course à 12 km/h = 11,5 MET ; vélo à 22,5 - 25,6 km/h = 10 MET ([pacompendium.com](https://pacompendium.com/unite-conversions/)).
- **Précision des montres** : Shcherbina 2017 (Stanford, 7 montres, 60 sujets) : erreur médiane d'énergie de 27 % (Fitbit Surge) à 93 %, aucun appareil sous 20 % ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5491979)). Düking 2020 (Apple, Polar, Garmin Fenix 5, Fitbit ; 25 sujets, calorimétrie indirecte) : CV de 8 à 35 %, aucune montre recommandée pour l'énergie ([PubMed](https://www.pubmed.gov/32374274/)).

## 3. Trois cas chiffrés (kcal)

| Cas | Tracker net (« effort ») | Tracker total (net + repos 66 ou 126) | Références |
|---|---|---|---|
| A. 10 km plat, 12 km/h, 75 kg (50 min) | 762 (1,016 kcal/kg/km) | 828 | Margaria / ACSM net 750 (Tracker +1,6 %) ; Minetti pur net 645 (+18 %) ; Compendium total 719 (+15 %) |
| B. 10 km, 300 m D+, boucle +6 % puis -6 %, 12 km/h | 797 (+4,6 % sur le plat) | 862 | Minetti pur net 676 (+18 %) ; ACSM, descente comptée plate, 851 (-6 %) |
| B'. 10 km, 300 m D+, tout en montée à 3 % (arrivée 300 m plus haut) | 892 (1,19 kcal/kg/km) | 958 | ACSM 851 (+4,8 %) ; Minetti pur 758 (+18 %) ; plat + m g h / 0,25 = 750 + 211 = 961 |
| C. 40 km route, 25 km/h, 75 + 9 kg, asphalte (1 h 36) | 503 (91 W mécaniques) | 628 | Strava, 1 kJ = 1 kcal : 526 (« effort » -4,4 %, total +19 %) ; Compendium 10 MET : 1200 (total -48 %) |

Lecture :
- Pour la pente, le rapport au plat est celui de Minetti : +17,4 % à 3 % (ACSM +13,5 %), -40 % à -10 %. Minetti pur est l'étalon de forme, pas de niveau : Tracker le relève de 16 % par sa règle de 200 ml. L'ACSM ne dit rien de la descente.
- Cas C : rendement brut implicite de notre total = 526 kJ / (628 x 4,184 kJ) = 20 %, dans la fourchette brute 18 - 23 % ; l'« effort » seul (25 % net) est l'équivalent du « kJ = kcal » de Strava, à 5 % près.

## 4. Verdict

- **Course : dans l'ordre de grandeur, à +/-15 - 18 %.** Le plat colle à Margaria et à l'ACSM (+2 %) ; il est 15 - 18 % au-dessus de Minetti pur et du Compendium parce que nos 200 ml/kg/km sont la règle des 1 kcal/kg/km, pas la valeur mesurée par Minetti. L'écart est celui des références entre elles : rien à corriger. La pente suit Minetti en relatif.
- **Vélo : dans l'ordre de grandeur (+/-5 % de l'équivalent Strava), avec deux biais côté puissance** : (1) air calme et CdA 0,32 (position basse) : sur les cocottes, CdA 0,40 donne 108 W au lieu de 91 W (+19 %) ; le vent de face coûte plus que le vent arrière ne rend (effet cubique), donc l'énergie réelle est plutôt sous-estimée ; (2) Crr 0,004 est le bas de la fourchette (0,004 - 0,005 en pneus de 28 mm). Les deux vont dans le même sens : notre vélo de route est plutôt un plancher, de 10 à 25 %.
- Le Compendium surestime le vélo (10 MET pour 90 - 110 W) : il n'est pas une référence utile ici.
- Aucun écart n'est une erreur de formule ; rien n'est à corriger d'office.

## 5. Écarts à décider (à ne coder qu'après accord)

1. **Vocabulaire** : « énergie de course/pédalage » (net, repos déduit) n'est pas la « calorie » d'une montre ou de Strava (brute). Seul « dépense totale, repos compris » se compare aux « calories » Garmin ; l'effort se compare aux « calories actives ». Proposition : une phrase dans l'aide du panneau Énergie, sans changer le calcul.
2. **CdA de la route à 0,32** : position basse. Proposition : 0,36 par défaut (décision de l'utilisateur, DECISIONS §2), après un test réel.
3. **Vent** : non modélisé. Proposition : le dire dans l'aide, rien à coder.
4. **k de l'air 0,0065** : non confirmé (point 71). Il pèse 1,7 % à 12 km/h : sans enjeu pour ce contrôle.

## 6. Ce que l'utilisateur relèvera sur sa montre

Une montre n'a elle-même que +/-10 à 35 % : un accord à moins de 25 % veut dire « même ordre de grandeur », pas « juste » ; un écart de 5 % ne signifie rien.
- **Réglages** : mêmes poids, taille, âge, sexe dans la montre et dans le Profil de Tracker (le repos en dépend). Ceinture cardio si possible ; sinon noter que la FC vient du poignet.
- **Course, 2 sorties** : une à plat, allure régulière (12 km/h environ, 8 - 10 km) ; une vallonnée (200 m de D+ au moins). Relever : distance, durée, D+, allure, FC moyenne, calories totales ET actives. Enregistrer la même sortie avec Tracker.
- **Vélo** : sans capteur de puissance, la montre estime par la FC : le test ne validera pas notre modèle physique. Le plus utile : une sortie plate, sans vent, 30 - 60 min à vitesse régulière ; noter vent, type de vélo, position, pneus ; comparer les « calories actives » à notre « effort », et nos watts à la plage 90 - 130 W attendue. La vraie validation demande un capteur de puissance (prêt, location, vélo d'appartement connecté).
- **Lecture** : tableau Tracker effort / Tracker total / montre active / montre totale, rapport par sortie. Un rapport stable d'une sortie à l'autre indique un facteur d'échelle ; un rapport qui varie avec la pente ou la FC vient autant de la montre (Firstbeat suit la FC) que de nous.
