# 96 · Énergie par la fréquence cardiaque, en voile et en surf

Modèle | Réflexion : Opus | high (calcul pur borné par la recherche) ; plan par l'agent `Plan`, relecture obligatoire. Lire avant : CLAUDE.md (règles 1, 3, « Où ajouter quoi »), `docs/DECISIONS.md` §1 (« général » en voile), §4 (« général » en surf, FC moyenne), §2 (énergie à pied et à vélo, pour ne pas la mélanger), `docs/MISE_EN_PAGE.md`, et **la recherche `docs/backlog/96-energie-fc-recherche.md` en entier** (formules, coefficients, biais, proposition §5).

## Constat

La voile et le surf n'ont aucune énergie : le vent et les vagues portent, la vitesse GPS ne dit rien de l'effort. À pied et à vélo, l'énergie est mécanique (Minetti, Martin) et n'a rien à voir avec la FC. Quand une session de voile ou de surf a sa FC (ceinture), la formule de Keytel 2005 en donne un ordre de grandeur à partir du poids, de l'âge et du sexe du Profil.

## Tranché par l'orchestrateur (06/11, d'après la recherche)

- **Formule** : Keytel 2005 sans VO2max, seule (la réserve de FC reste un contrôle croisé dans le diagnostic, pas dans l'écran). Coefficients dans un bloc de profil (`HR_ENERGY`, `core/sportProfiles.ts`), attaché aux profils de voile et de surf (`hrEnergy`), `null` à pied, à vélo et en Entraînement (règle 3, aucun coefficient en dur dans le calcul).
- **Entrées** : `weightKg`, `runnerAge(birthYear)`, `sex` du Profil (`running/runnerProfile.ts`) ; sexe manquant : moyenne des deux équations ; poids ou âge manquant : pas de chiffre, une phrase « Renseignez votre poids et votre année de naissance dans le Profil » (comme la course sans poids).
- **Calcul** (pur, `core/hrEnergy.ts` + test) : FC lissée sur `heartRate.smoothS`, bornée à [`floorBpm` 90 ; `hrMax` du profil, sinon 220 − âge + 10] ; sous le plancher, repli au repos (1 MET = poids/60 kcal/min), jamais plus bas ; total brut (repos compris) et « dont repos » = 1 kcal/kg/h × durée couverte ; trous de FC jusqu'à `heartRate.gapS` interpolés, au-delà hors total ; couverture ≥ `coverageForTotal` (0,8) du temps de session : extrapolation à la durée entière au débit moyen mesuré, sinon la part mesurée seule avec « sur x min avec FC » ; sous `heartRate.minCoverageS` : rien. Une seule valeur, arrondie à 10 kcal, précédée de « env. ».
- **Affichage** : une tuile « Énergie estimée » dans l'onglet « cardio » (`components/CardioTab.tsx`, pièce commune), montrée seulement quand le profil du sport a `hrEnergy` (voile et surf), avec son aide « ? » : « Calculée à partir de votre rythme cardiaque, de votre poids, de votre âge et de votre sexe. C'est un ordre de grandeur, pas une mesure : comptez 25 % d'écart, davantage par temps froid ou en position de rappel. » Rien dans « général », rien dans l'image de partage, rien dans la fiche ni dans Statistiques (plus tard, si l'utilisateur le demande). À pied et à vélo, l'énergie mécanique reste seule : les deux ne s'additionnent jamais.
- **Diagnostic** : `outils/banc/energie-fc-diagnostic.mjs <fichier .gpx> [--poids=75 --age=40 --sexe=m --fcmax=180 --fcrepos=60]` : Keytel et réserve de FC (Uth + Swain, formules de la recherche §2) côte à côte, couverture, « dont repos », pour comparer sur de vraies sorties quand une ceinture sera portée sur l'eau.

## Tests (`core/hrEnergy.test.ts`, trace synthétique)

- 1 h à FC constante 130, homme 75 kg, 40 ans : 716 kcal ± 1 % (tableau §6 de la recherche) ; femme 65 kg : 466 ;
- même trace à 1 Hz et à 5 Hz : même total (règle 2) ;
- FC à 70 bpm pendant 20 min : ces 20 min comptent au repos (poids/60 kcal/min), pas en négatif ;
- trou de FC de 5 s : interpolé ; de 60 s : hors total, couverture réduite ;
- couverture 90 % : total extrapolé ; couverture 50 % : part mesurée seule, marquée partielle ;
- sans poids : `null` ; sans sexe : moyenne des deux équations ;
- `hrMax` du profil absent : borne 220 − âge + 10.

## Hors lot

Validation sur l'eau (aucune sortie avec ceinture sur l'eau n'existe) : essai 75 (voile avec la ceinture) complété d'une ligne sur l'énergie ; fourchette au lieu d'une valeur, et réserve de FC quand la FC repos est testée : à décider après ces sorties.

## Vérification

`node outils/verif.mjs --rapide` par l'agent ; `npm run verif`, banc (`cardio`, `onglets`, `general` : texte identique à pied et à vélo ; une session voile synthétique avec FC montre la tuile) et `relecture` par l'orchestrateur.

## Plan (agent `Plan`, 06/11) et choix tranchés par l'orchestrateur

Toutes les réponses « mineures » du plan sont retenues : l'invite dit « Renseignez votre poids et votre année de naissance dans Réglages › Pratiquant » avec un lien vers `/parametres` ; l'âge est pris à la date de la session (`runnerAge(runner, track[0].timeMs)`) ; les trous de FC passent par `forEachCounted` (export de `core/heartRate.ts`), pour que « sur x min avec FC » soit le « Temps mesuré » de la tuile ; « dont env. N kcal au repos » et « sur x min avec FC » vont dans le `detail` de la tuile ; pas de rampe au plancher ; l'âge n'est pas borné (Keytel validé de 18 à 45 ans : signalé dans le diagnostic seulement).

Fichiers :
- `core/sportProfiles.ts` : `HrEnergyProfile` (`keytel: { m, f }` avec `{ intercept, hr, weight, age }` en kJ/min, source en commentaire ; `floorBpm: 90` ; `ageHrMax: { baseBpm: 220, marginBpm: 10 }` ; `restWPerKg: J_PER_KCAL / 3600` ; `coverageForTotal: 0.8` ; `displayStepKcal: 10`), constante `HR_ENERGY` à côté de `HEART_RATE`, champ `hrEnergy: HrEnergyProfile | null` après `heartRate` dans `SportProfile` ; `HR_ENERGY` dans `SAILING_DEFAULTS` et `SURF_PROFILE`, `null` dans `RUNNING_PROFILE` et `CYCLING_PROFILE` (les fractionnés, `run-test` et `muscu` en héritent). Test dans `core/sportProfiles.test.ts` : `hrEnergy` non nul pour les seuls `SAILING_SPORTS` et le surf.
- `core/heartRate.ts` : exporter `forEachCounted`.
- Nouveau `core/hrEnergy.ts` (sorties en joules) : `estimateHrEnergy(points, smoothed, athlete: { weightKg, age, sex, hrMax }, heartRate: Pick<HeartRateProfile, 'gapS' | 'minCoverageS'>, energy: HrEnergyProfile)` → `{ kind: 'profil-incomplet' }` | `{ kind: 'estimation', totalJ, restJ, measuredS, sessionS, coverage, extrapolated, sexAveraged }` | `null` sous `minCoverageS` ; durée de session par `activeDurationS` (`core/heartRateSession.ts`) ; FC lissée = `smoothed` de `useSessionHeartRate`, sans relissage ; débit Keytel en W borné à [plancher ; `hrMax`, sinon 220 − âge + 10] ; `Math.max(débit, repos)` partout ; aide `hrEnergyKcal(j, step)`. Tests `core/hrEnergy.test.ts` : ceux du brief (716 kcal ± 1 % à la main 715,6 ; 466 ; 1 Hz = 5 Hz ; 70 bpm au repos ; trous 5 s et 60 s ; couvertures 90 % et 50 % ; sans poids ou âge ; sans sexe ; sans `hrMax` : 200 bpm = 190 pour 40 ans).
- `components/HeartRatePanel.tsx` : prop obligatoire `hrEnergy: HrEnergyProfile | null`, `useMemo` d'`estimateHrEnergy`, `StatTile` « Énergie estimée » (+ `HelpToggle helpKey="analyse:energie-fc"`) après « Temps mesuré », valeur « env. N kcal », `HelpText` sous les tuiles sur le modèle de « charge », phrase grise avec `Link` si le profil est incomplet. `components/CardioTab.tsx` : commentaire seulement (il recopie `...panel`). Les quatre appels de `CardioTab` passent `hrEnergy={profile.hrEnergy}` : `SailingModule.tsx`, `SurfModule.tsx`, `LandModule.tsx` (null), `MuscuModule.tsx` (null).
- Nouveau `outils/banc/energie-fc-diagnostic.mjs` (modèle `sauts-diagnostic.mjs` : `charge-ts.mjs`, `parseGpx(...).timedPoints`, `heartRatePointsFrom`, `activeDurationS`, `smoothHeartRate`, `hrEnergy.ts`, `SPORT_PROFILES`) : options `--poids --age --sexe --fcmax --fcrepos --support=wingfoil` ; Keytel, puis réserve de FC (VO2max = 15,3 × FC max / FC repos d'Uth, puis Swain, 20,9 J/ml et 3,5 ml/kg/min comme `running/energy.ts`), couverture, « dont repos », part du temps sous le plancher, écart en %. Essayé sur un GPX synthétique de `make-gpx.mjs` avec FC.
- Banc : compléter `outils/banc/cardio.mjs` (voile et surf avec FC déjà importés) : profil vide → l'invite en voile et en surf, aucune tuile en course ; puis `weightKg`, `birthYear`, `sex` dans `setRunner` → tuile « Énergie estimée » « env. … kcal » en voile et en surf, absente en course. Scripts neutres attendus : `onglets`, `general`, `graphes`, `muscu`, `zoom-carte`, `cadence`, `test-fcmax`, `timer`.

Étapes : profil et types ; `forEachCounted`, `hrEnergy.ts` et tests ; `HeartRatePanel` et les quatre modules ; diagnostic ; banc `cardio.mjs` ; `node outils/verif.mjs --rapide`. Passe `doc` après validation : INVENTAIRE, DECISIONS §1 et §4 (« ni énergie » du surf → « ni énergie mécanique ; énergie estimée par la FC dans cardio »).
