# Énergie dépensée par la fréquence cardiaque (voile, surf) : recherche

Recherche du 06/11/2026. Ce qui n'a pas pu être lu à la source est dit « non vérifié ».

## 1. Ce que l'application a déjà

- `core/energy.ts` : `integrateEnergy(track, grades, activityMask, restRate, stepCost, zones)` somme un coût par segment en mouvement (distance, pente, vitesse) : inutilisable pour la FC, qui ne dépend ni de la distance ni de la pente. Unités SI, J ou J/kg ; `J_PER_KCAL = 4184` (`core/units.ts`).
- `running/energy.ts` : Minetti (J/kg/m), `joulesPerMlO2` 20,9, repos 3,5 ml/kg/min (1 MET), rendement 0,25 ; marche Pandolf/Santee. `cycling/energy.ts` : Martin et al. (force sur distance, rendement 25 %, repos à part). Les deux séparent « net » et « repos ».
- Profil (`running/runnerProfile.ts`, hook `useRunnerProfile`) : `weightKg` (20-300), `birthYear` (+ `runnerAge`), `sex` ('f' | 'm' | null), `hrMax` (100-250), `hrRest` (25-120), avec `hrMaxSource` / `hrRestSource`, `hrThresholds`, `economyMlKgKm`. Pas de VO2max saisi.
- Trace : `TrackPoint.hr?: number` (`core/types.ts`). `HEART_RATE` dans `core/sportProfiles.ts` : `maxAgeS` 3, `smoothS` 5, `gapS` 10, `minCoverageS` 60, `zoneModel`, `thresholdOffsetBpm` (`heartRateOffset(-5..-10)`, voile/surf compris), `loadWeights`. `core/heartRateSession.ts` : `heartRatePointsFrom`, `activeDurationS`, `analyzeHeartRateSession`.
- Voile et surf ont déjà `heartRate` dans leur profil : rien à ajouter côté seuils.

## 2. Formules

### Keytel et al. 2005 (retenue)
J Sports Sci 23(3):289-297, doi 10.1080/02640410470001730089, https://pubmed.ncbi.nlm.nih.gov/15966347/. 115 adultes de 18 à 45 ans, trois paliers stables, calorimétrie indirecte.
Sans VO2max (kJ/min, FC en bpm, poids en kg, âge en ans), coefficients recoupés dans deux sources secondaires (https://tryterra.co/research/why-do-wearables-show-different-calories) :
- homme : -55,0969 + 0,6309·FC + 0,1988·P + 0,2017·A
- femme : -20,4022 + 0,4472·FC - 0,1263·P + 0,074·A
Avec VO2max (ml/kg/min), recoupé avec https://support.hexoskin.com/how-is-the-energy-expenditure-calculated :
- homme : -95,7735 + 0,634·FC + 0,404·VO2max + 0,394·P + 0,271·A
- femme : -59,3954 + 0,450·FC + 0,380·VO2max - 0,103·P + 0,274·A (Hexoskin écrit +0,103 : coquille probable, le signe moins est celui de l'article, non vérifié).
Précision annoncée : r = 0,857 sans VO2max (73,4 % de variance), 0,913 avec. Plage de validité : le texte de l'article n'est pas lisible librement ; une source secondaire dit « 50 à 90 % de la FC max, effort stable ». Les valeurs sont brutes (repos compris) et s'effondrent près du repos (homme 75 kg, 40 ans : nul vers 51 bpm).

### Écartées ou gardées en réserve
- Charlot et al. 2014 (Physiol Meas 35:253, doi 10.1088/0967-3334/35/2/253) : 50 sujets, course à 25/50/70 % de la réserve de FC, R² 0,809 (de base), 0,879 avec VO2max, meilleur avec la vitesse. Coefficients non récupérés ; fait pour la course : écartée.
- Hiilloskorpi et al. 2003 (Int J Sports Med 24:332-336, doi 10.1055/s-2003-40701) : 89 sujets ; la FC de réserve ou la FC nette (FC - FC repos) prédit mieux que la FC brute. Coefficients non récupérés. Soutient l'idée d'une méthode par la réserve.
- Réserve de FC (Swain et Leutholtz 1997, https://data.zhenzhi.com/details/1/895877300) : %FC réserve ≈ %VO2 réserve (non %VO2max ; contestée par des travaux ultérieurs). Régression plus ancienne de Swain : %FCmax = 0,64·%VO2max + 37 (année non vérifiée).
  VO2 = 3,5 + %FCR·(VO2max - 3,5) ; énergie = VO2·kg·20,9 J/ml. VO2max sans test : Uth, VO2max ≈ 15,3·FCmax/FCrepos (Uth 2004, non relu ici).
- ACSM : ses équations métaboliques sont en vitesse, pente ou puissance, pas en FC ; seul le principe FC de réserve → VO2 de réserve vient d'elle. 1 MET = 3,5 ml/kg/min ≈ 1 kcal/kg/h.
- Industrie : Polar OwnCal (poids, taille, âge, sexe, FCmax, VO2max optionnel ; compte à partir de ~100 bpm, ~90 bpm pour OwnCalS, source tierce https://howtobefit.com/polar-owncal-feature.htm) ; Garmin/Firstbeat (FC, respiration estimée par la variabilité de FC, cinétique du VO2, FCmax et VO2max estimés si absents, https://firstbeat.com/en/science-and-physiology/white-papers-and-publications/energy-expenditure). Strava : rien de vérifié.

## 3. Validité sur l'eau

- Planche à voile olympique (De Vito, Vogiatzis) : pomper fait passer la FC de 110 à 165 et le VO2 de 19,2 à 48,4 ml/kg/min. Keytel (homme 75 kg, 40 ans, illustratif) donne 8,9 puis 17,2 kcal/min, contre environ 7,2 puis 18,1 mesurés : +24 % à FC basse, -5 % à FC haute. La formule tient à l'effort soutenu, surestime en bas.
- Kitesurf (https://www.springermedizin.de/assessment-of-physiological-demand-in-kitesurfing/8480974) : 80,6 % FCmax pour 69,8 % VO2max en traversée ; freestyle 85,4 % pour 80,0 %. Le VO2 y est lui-même estimé depuis la FC : l'étude ne valide pas la FC.
- Dériveur, rappel (Laser, https://www.bisp-surf.de/Record/PU199605107757) : 74 % FCmax pour 39 % VO2max. Par la régression de Swain, 74 % FCmax donnerait ~58 % VO2max : surestimation d'environ 50 %. Le rappel isométrique (https://sponet.de/sponet/Record/4004250 et le travail sur le rappel, 1999) élève le débit cardiaque sans coût d'O2 proportionnel (~1 l O2/min). En simulateur dynamique d'un Laser : 58 % du pic d'O2 (https://lida.sport-iat.de/ta/Record/4012960).
- Wing : aucune étude évaluée trouvée ; seulement des témoignages (FC moyenne ~150 en pompage). Le pompage rapproche le wing de la planche à voile, la croisière à plat du bateau.
- Surf, compétition (Farley 2012, J Strength Cond Res ; https://sciencedaily.com/releases/2012/07/120723094818.htm) : FC moyenne 139, pic 190 juste après la vague ; rame 54 %, attente 28 %, vague 8 %, rame vers la vague 4 %. Surf récréatif (Barlow 2014, J Strength Cond Res 28:2946, https://www.pubmed.gov/24736778/) : attente 41,6 %, rame 47,0 %, vague 8,1 % ; 64 à 85 % de la FCmax selon les études ; intensité relative plus basse chez les bons surfeurs, plus haute avec une longue période de houle. Ses kcal viennent d'une équation de FC non relevée.
- Biais à annoncer : (1) rappel et gainage de voile (FC trop haute pour le VO2) ; (2) froid et immersion : effets sur le rapport FC/VO2 mal documentés (aucune étude directe trouvée ; en eau neutre l'effet dépend de l'intensité) ; (3) dérive cardiaque, chaleur, déshydratation, stress, caféine : FC haute à VO2 égal en séance longue ; (4) pic d'adrénaline à la vague ; (5) FC de repos jamais atteinte sur l'eau, et ceinture mouillée qui décroche (trous) ; (6) Keytel n'est pas testé sous 90 bpm environ.

## 4. MET du Compendium 2024 (repli, https://pacompendium.com/water-activities/)
Voile générale 3,0 (18120) ; dériveur 2,0 (18142) ; Sunfish/Laser/catamaran/quillard loisir 3,3 (18140) ; régate 4,5, effort élevé 9,3 ; planche sans pomper 5,0 (18380) ; planche ou kite en traversée 11,0 (18385) ; planche en compétition avec pompage 14,0 (18390) ; surf général 3,0 (18220), en ramant 6,8 (18221), compétition 5,0 ; SUP debout 2,8 à 11 selon la cadence. Pas d'entrée wingfoil ni foil. 1 MET = 1 kcal/kg/h.

## 5. Proposition pour Tracker

- Formule : Keytel sans VO2max, en repli de tout profil. Pas de VO2max demandé (absent du profil). Si `hrMax` et `hrRest` sont saisis (idéalement source `test`), option interne « réserve de FC » : VO2max = 15,3·hrMax/hrRest, formule de Swain ci-dessus, avec 20,9 J/ml (déjà `joulesPerMlO2`). Écart avec Keytel de -11 % pour un homme de 75 kg à FC 130 (section 6) ; choix d'une seule méthode par défaut conseillé : Keytel (connue, citable). La réserve de FC reste un contrôle croisé à tester sur les vraies sorties.
- Champs : `weightKg`, `runnerAge` (de `birthYear`), `sex`, FC par point. Si `sex` manque : moyenne des deux équations ; si poids ou âge manquent : pas de calcul, invitation à les saisir au Profil (comme la course sans poids).
- Calcul : pas de temps entre points, kcal/min Keytel (kJ/min ÷ 4,184) × dt ; FC lissée sur `smoothS` (5 s) ; bornes : FC bornée à [90 ; hrMax] (sans hrMax : 220 - âge + 10) ; sous 90 bpm, repli sur le repos (1 MET = poids × 1/60 kcal/min), jamais plus bas. Total brut (repos compris), détail « dont repos » = 1 kcal/kg/h × durée.
- Trous de FC : ≤ `gapS` (10 s), interpolés ; au-delà, hors total. Couverture ≥ 80 % : extrapolation à la durée entière avec le débit moyen mesuré ; sinon afficher seulement la part mesurée avec la mention « sur x min avec FC ». Sous `minCoverageS` : rien.
- Attente immobile (surf, bateau) : aucune règle spéciale, c'est la FC qui décide ; le plancher à 1 MET évite l'absurde si la FC retombe. Ne pas retirer les immobilités : en voile on est « immobile » et pourtant sous contrainte.
- Précision à annoncer : ordre de grandeur, ± 25 % en effort soutenu (kite, pompage, surf actif), ± 40 % ou plus en croisière avec rappel et au froid ; surestimation probable sous 110 bpm. Estimation non validée par calorimétrie sur ces sports (estimation personnelle, à reformuler si une mesure arrive).
- Libellé : « Énergie estimée (kcal) », aide « ? » : « Calculée à partir de votre rythme cardiaque, de votre poids, de votre âge et de votre sexe. C'est un ordre de grandeur, pas une mesure : comptez 25 % d'écart, davantage par temps froid ou en position de rappel ». Arrondir à 10 kcal, afficher « env. ». Tenir à part dans l'interface le kcal de course (mécanique) et celui-ci (FC), ne pas les additionner.
- Rangement : calcul pur `core/` ou `sailing/` + `*.test.ts` sur trace synthétique ; coefficients dans un profil (règle 3), pas en dur ; lecture de la FC via `TrackPoint.hr`, plus tard en `summary` avec `SUMMARY_CALC_VERSION`.

## 6. Ordres de grandeur (Keytel sans VO2max ; réserve de FC avec FCmax 180, FCrepos 60, Uth ; MET 75 kg)

| Cas | Keytel | Réserve de FC | MET (repli) |
|---|---|---|---|
| Wing 1 h, FC 110, homme 75 kg, 40 ans | 535 | 476 | |
| Wing 1 h, FC 130 (même homme) | 716 | 635 | 375 (planche sans pomper) à 825 |
| Wing 1 h, FC 150 | 897 | 793 | |
| Wing 1 h, FC 130, femme 65 kg | 466 | 550 | |
| Kite 1 h, FC 140 | 806 | 714 | 825 (traversée, 11 MET) |
| Surf 1 h 30, FC 115, homme 75 kg | 870 | 773 | 338 (3,0) à 765 (rame 6,8) |
| Surf 1 h 30, FC 115, femme 60 kg | 568 | 619 | |
| Bateau 2 h, FC 100, homme 75 kg | 888 | 793 | 450 (3,0 ; 225 à 1 h) |

Lecture : Keytel est le plus haut des deux méthodes pour un homme, le plus bas pour une femme (ses coefficients de poids et de FC sont plus faibles). À FC 100-115, Keytel et la réserve de FC dépassent nettement les MET (bateau : environ le double), signe du biais de la FC en voile ; un surf à FC 115 à 870 kcal en 1 h 30 est probablement trop haut (la rame est au-dessus de 6 MET mais l'attente à 1-2 MET).

## 7. Limites et suites
- Aucune formule n'est validée en wing, kite ou surf ; les chiffres de FC et de VO2 de la littérature viennent d'athlètes d'élite, en petit nombre.
- Coefficients de Charlot et Hiilloskorpi non lus, plage de validité de Keytel non confirmée à la source.
- À trancher avec l'utilisateur : plancher à 90 bpm contre MET du repli ; afficher une seule valeur ou une fourchette ; formule unique (Keytel) ou réserve de FC si FC repos testée.
- Pour valider : comparer sur les sessions réelles la valeur Keytel et celle de la réserve de FC ; un écart de plus de 25 % indique un cas à signaler.
