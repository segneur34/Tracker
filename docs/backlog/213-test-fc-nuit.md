# 213 · Test « FC de nuit » (Entraînement › Fractionné et tests)

Demandé le 12/11 : « créer dans entraînement fractionné et test un test d'analyse de FC sur la nuit entière. Ce sera intéressant pour savoir comment c'est enregistré, et en plus c'est une donnée intéressante à avoir. Si tu as des propositions de trucs à mesurer et des particularités à avoir, je te laisse y aller. »

Modèle | Réflexion : Opus | high (plan par l'agent `Plan`, relecture par `relecture`).

Pas de maquette : les écrans reprennent le patron des tests existants (page du protocole du test de FC max, tuile de `TestsPage`, onglet « test » de l'analyse) ; l'utilisateur a laissé la main le 12/11.

## Ce que l'utilisateur fait

1. Entraînement › Fractionné et tests › Tests : une tuile « FC de nuit », à côté de « FC max » et « FC repos ». Elle ouvre une page du protocole (à quoi ça sert, comment s'installer : ceinture humidifiée, téléphone en charge près du lit, Bluetooth allumé ; ce qui sera mesuré), avec « Lancer ».
2. « Lancer » mène à Enregistrer, prêt sur ce test (case de la rangée « Test »). « Démarrer » le soir, « Finir » le matin (bouton tenu, comme partout). Sans ceinture connectée : confirmation, sans bloquer (comme le test de FC max), mais le test n'a alors pas de sens : le dire.
3. Au matin, la session est rangée comme toute session (lot 212 : fin d'enregistrement = analyse) et son analyse montre l'onglet « test » avec les chiffres de la nuit.

## Choix tranchés par l'orchestrateur (12/11)

- **Une vraie session, par l'enregistreur** (pas une page à part comme le test de FC repos) : le but dit par l'utilisateur est aussi de voir « comment c'est enregistré » sur 8 h, écran éteint. Sans GPS : le chemin de la muscu avec ceinture existe déjà (GPX sans position, heure et FC ; service au premier plan `keepBeltAlive` ; analyse sans carte ; vignette en courbe de FC). Le réutiliser, ne pas en écrire un second.
- **Rangée en famille Entraînement, activité « Tests »**, marquée comme test « fc-nuit » dans sa fiche ; ligne de bibliothèque « FC de nuit · 48 bpm » (la plus basse) ; nom par défaut « Nuit du 12 au 13/11 » (la date de la session reste celle du départ).
- **Nuit silencieuse** : aucun son ni vibration pendant ce test (ni bip de départ ou de fin, ni alerte « FC perdue » sonore : elle reste écrite à l'écran et dans la notification). Pas de zone visée, pas de bornes, pas de compteur.
- **Écran** : il n'est pas gardé allumé pendant ce test (exception à la règle du §6), la page en cours passe en présentation sombre et sobre si c'est simple à faire avec les variables du thème, sinon rien de plus.
- **Pas de pause automatique, pas de cadence, pas de capteurs de mouvement** (ni sauts ni accéléromètre : le téléphone est posé, pas porté).
- **Hors des cumuls** : une nuit ne compte ni dans la charge d'entraînement (Edwards), ni dans les volumes et durées de Statistiques, ni dans la progression du Profil (racine), ni comme FC max observée, ni dans « dernière activité de fractionné ». L'agent `Plan` dresse la liste de tous les endroits qui additionnent des sessions et dit comment l'exclure en un seul point si possible.
- **FC de nuit ≠ FC repos** : la FC la plus basse de la nuit est plus basse que la FC repos éveillé qui sert aux zones (Karvonen). On montre l'écart, on ne propose pas « La retenir ».
- **Résultats recalculables depuis le GPX** : les chiffres de la nuit vont dans `summary` (`SUMMARY_CALC_VERSION` augmenté si nécessaire), pour la ligne de bibliothèque et la courbe des nuits sur la page Tests.

## Ce qui est mesuré (calcul pur, `running/nightHrResults.ts` + test synthétique)

Fenêtres en secondes (règle 2 : même résultat à 1 Hz et à 5 Hz, et avec une ceinture qui saute des secondes), seuils dans un objet de protocole versionné passé en paramètre (règle 3), sur le modèle de `recording/restingHrTest.ts` et `running/restingHrResults.ts`. Une mesure vaut au plus `holdS` secondes : un trou reste un trou, jamais une valeur figée.

1. **FC moyenne de la nuit** (pondérée par le temps couvert).
2. **FC la plus basse** : la moyenne sur 5 min la plus basse (fenêtre couverte à 70 % au moins), et son heure.
3. **Place du creux dans la nuit** : en % de la durée, dit en clair (« en début », « au milieu », « en fin de nuit »). Un creux tardif est le signe connu d'une nuit moins récupératrice (repas ou effort tardif) : le dire dans l'aide « ? », sans diagnostic.
4. **Écart avec la FC repos** de Pratiquant, si elle est connue.
5. **Courbe de la nuit**, lissée (5 min), heures d'horloge en abscisse, le creux marqué ; **tableau par heure** (moyenne, plus basse).
6. **Sursauts de FC** (réveils ou mouvements probables) : montée d'au moins X bpm au-dessus de la ligne de base glissante, tenue au moins Y secondes ; leur nombre et leurs heures, marqués sur la courbe. X, Y et la fenêtre de la ligne de base dans le protocole.
7. **Dérive** : moyenne de la première moitié contre la seconde.
8. **Qualité de l'enregistrement** (le « comment c'est enregistré ») : durée du départ à la fin, part de la nuit couverte par des mesures lisibles, nombre de trous de plus de 10 s et le plus long (avec son heure), intervalle médian entre deux mesures et le plus grand, et si la session a été interrompue puis récupérée (si l'information existe).
9. Nuit trop courte (moins de 3 h, dans le protocole) : chiffres montrés, avec la mention « nuit incomplète ».

10. **Heure de stabilisation** : premier instant où la FC lissée reste à moins de 3 bpm au-dessus du creux pendant 30 min ; et **temps près du creux** : durée passée à moins de 5 bpm au-dessus du creux (ajouts de la recherche du 12/11).

Le point 7 s'appelle à l'écran « première moitié contre seconde moitié », pas « dérive ».

### Valeurs du protocole v1 (recherche du 12/11, `docs/backlog/213-fc-nuit-recherche.md` ; hypothèses prudentes, à régler sur de vraies nuits)

| Paramètre | Valeur |
|---|---|
| Fenêtre de la FC la plus basse | 300 s, couverte à 70 % au moins |
| Lissage de la courbe | 300 s |
| Sursaut : ligne de base | médiane glissante sur 300 s |
| Sursaut : hausse minimale | 8 bpm au-dessus de la ligne de base |
| Sursaut : tenue minimale | 10 s |
| Sursaut : retour sous le seuil avant d'en compter un autre | 60 s |
| Trou | plus de 10 s sans mesure lisible |
| Une mesure vaut au plus | 5 s (`holdS`, comme la FC repos) |
| Stabilisation | creux + 3 bpm, tenu 30 min |
| Près du creux | creux + 5 bpm |
| Nuit incomplète | moins de 3 h |
| Mesures ignorées | hors de 25 à 250 bpm (comme la FC repos) |

### Ce que les textes ne disent jamais

Ni phases ni durée ni qualité de sommeil, ni apnée, ni diagnostic : la FC seule ne le permet pas. Un sursaut est « un réveil ou un mouvement probable », jamais « un réveil ». Le creux tardif est « un indice souvent lié à un repas, de l'alcool ou un effort le soir », pas une règle. L'écart avec la FC repos s'affiche en bpm et en %, sans dire ce qui est « normal ». Une nuit seule ne dit rien : c'est la suite des nuits qui parle ; une hausse va d'ordinaire avec la fatigue, la chaleur, l'alcool ou un repas tardif, sans jamais écrire « vous êtes malade ». Les textes d'aide proposés sont dans le rapport de recherche.

La courbe et les calculs doivent tenir 10 h à 1 Hz (36 000 points) sans figer l'analyse : décimer pour l'affichage.

## Page Tests

Sous la tuile ou dans la page du test : les dernières nuits (date, FC la plus basse, FC moyenne) et leur courbe d'une nuit à l'autre, comme `RestingHrChart` pour la FC repos, lues dans les fiches des sessions (pas de nouveau magasin sur l'appareil).

## Suite envisagée (n° 214, à décider après le plan)

Variabilité cardiaque de la nuit (RMSSD) : demande que le greffon natif de la ceinture lise les intervalles RR (caractéristique 0x2A37, bit 4 des drapeaux), que l'échantillon les porte et que le GPX les garde. L'agent `Plan` dit seulement si le greffon est maison, où est le décodage, et l'ampleur ; il ne le planifie pas dans le 213.

## Vérification

- Tests synthétiques : nuit de 8 h à 1 Hz et la même à 5 Hz ou trouée (mêmes chiffres), creux placé, sursauts comptés, trous comptés, nuit courte.
- Banc : un script neuf qui joue une nuit d'exemple (la ceinture d'exemple du navigateur, `EXAMPLE_BELT`, avec une FC de nuit d'exemple déterministe et une horloge accélérée ou une session importée), ouvre l'analyse, lit l'onglet « test » ; les scripts des tests existants (`test-fcmax`, FC repos, `timer`, muscu) restent identiques avant/après.
- Essais au téléphone : une vraie nuit (essai de terrain), et un essai court de 10 min écran éteint pour vérifier le silence et le rangement.

## Plan retenu (agent `Plan`, 12/11) et questions tranchées par l'orchestrateur

Tranché (mineur, imposé par le code) :
- La session porte un **calcul neuf `night-hr`** (libellé « FC de nuit »), famille `fractionne`, traitement `muscu`, `trainingKind` `'tests'`, sans position ; pas l'activité « Tests » (base `run-test`, qui a des positions : `hasPositions(activity.base)` décide du GPS partout). Aucune activité ajoutée à la liste de départ : la session prend `activityId = 'night-hr'`, résolu par `baseActivity('night-hr')`. Le calcul n'est pas proposé à la création d'une activité dans Réglages. Pas de `record.test` : le calcul marque la session.
- Le calcul pur va dans **`core/nightHeartRate.ts`** (pas `running/`) : `library/summary.ts` l'appelle, et la règle 13 interdit d'ajouter un fil vers `running/`.
- L'onglet « cardio » de la nuit reste, sans « La retenir » (FC max observée) ni charge d'Edwards.

### Étape 0, socle (seule, avant A et B)
Déclarer le calcul et tout ce que A et B ne font que consommer :
- `core/types.ts` (union `SportType`), `core/sportProfiles.ts` (`SPORT_PROFILES`, `SPORT_TREATMENT`, `SPORT_FAMILY`, `trainingKind`, `hasPositions` faux), `core/activities.ts` (`BASE_COLOR`, et retrait de `night-hr` des calculs proposés à la création d'une activité), `components/activityIcons.ts` (`BASE_ICON`), `core/trackColor.ts`, `settings/activitySettings.ts`, `liveFields.ts`, `core/activities.test.ts`, et toute autre table `Record<SportType>` que le typecheck réclame.
- Deux champs de profil, lus par des prédicats exportés de `core/sportProfiles.ts` (jamais un test sur le nom du calcul ailleurs) : `recording.silent` (vrai pour `night-hr` seulement ; prédicat `isSilentSport(sport)`) et `inTotals` (faux pour `night-hr` seulement ; prédicat `countsInTotals(sport)`). Pause automatique absente, ni cadence ni capteurs, comme la muscu.
- `core/analysisTabs.ts` : l'onglet `test` dans `MUSCU_TABS`, montré seulement pour `night-hr` (voir le filtre `isTestSport`).
- `recording/nightHrTest.ts` : identifiant `NightHrTestId = 'fc-nuit'`, `NightHrProtocol` et `NIGHT_HR_TEST` (version 1, valeurs du tableau « Valeurs du protocole v1 »), libellé, et `exampleNightHr(tS)` : FC de nuit d'exemple déterministe (descente à l'endormissement, creux, deux ou trois sursauts, remontée au matin), pour les tests et le banc.

### Partie A, calcul et affichage (aucun fichier commun avec B)
- `core/nightHeartRate.ts` + `.test.ts` : `nightHrResults(points: readonly { timeMs: number; bpm?: number }[], protocol: NightHrProtocol, opts?: { restingBpm?: number | null }): NightHrResults` ; résultats : `durationS`, `coveredS`, `coverage`, `avgBpm`, `low { bpm, atMs, fraction, place }`, `restingGapBpm` (et %), `hourly[]`, `surges[]`, moitiés `{ first, second }`, `quality { gapCount, longestGap { s, atMs }, medianStepS, maxStepS }`, `incomplete`, `stabilizedAtMs`, `nearLowS`, `curve` décimée (une valeur par case de 30 s, avec l'`index` du point pour le survol). Deux pointeurs, jamais O(n × fenêtre). Tests : même nuit de 8 h à 1 Hz, à 5 Hz et trouée (mêmes chiffres) ; trou jamais comblé au-delà de `holdS` ; creux en début, milieu, fin ; 2 sursauts comptés, un trop court ignoré ; trous comptés et le plus long ; nuit de 2 h incomplète ; sans FC repos, écart `null` ; 36 000 points en temps borné.
- `library/summary.ts` (`summarizeHeartRateSession` : bloc `night` quand le calcul est `night-hr`), `library/record.ts` (`SummaryNight` et sa lecture sur le modèle de `readSummaryTest` ; `SUMMARY_CALC_VERSION` augmenté, raison en commentaire), nom par défaut « Nuit du 12 au 13/11 » là où le titre d'une session neuve est posé (`library/newRecord.ts`, à vérifier).
- `components/NightHrPanel.tsx` (onglet « test » : chiffres, courbe de la nuit avec creux et sursauts marqués, tableau par heure, bloc « Qualité de l'enregistrement », aides « ? »), `pages/MuscuModule.tsx` (bloc `{open.test && …}` dans un `ResizablePanel` d'`id` unique ; courbes de « général » et du cardio décimées pour une nuit ; « La retenir » et la charge d'Edwards cachées pour `night-hr`, par une option passée aux panneaux).
- `components/NightHrChart.tsx` (les nuits successives, modèle `RestingHrChart`, lues dans les fiches), `pages/NightHrTestPage.tsx` (page du protocole, modèle `FitnessTestPage.tsx`, « Lancer » vers Enregistrer prêt sur ce test), `pages/TestsPage.tsx` (tuile), `App.tsx` (route `/fractionne/tests/fc-nuit`), `components/SessionLibrary.tsx` (ligne « FC de nuit · 48 bpm », vignette décimée).

### Partie B, enregistrement (aucun fichier commun avec A)
- `pages/RecordingPage.tsx` et sa feuille de style : `testId` accepte `'fc-nuit'` ; une option de plus dans la rangée « Test » ; activité effective `baseActivity('night-hr')` quand ce test est choisi (elle alimente `heartOnly`, la ceinture, `handleStart`, `canStart`) ; confirmation sans ceinture (« sans ceinture, ce test ne mesure rien ») ; pas de `armFitnessTest`, pas de zone ni de bornes ni de compteur ; `rememberRecordActivity` non appelé pour une nuit ; écran non gardé allumé (`useScreenOnWhile`) quand le calcul est silencieux ; présentation sombre `rec-page--nuit` par les variables du thème.
- `hooks/useRecorder.ts` : passe `silent` à la veille de la ceinture ; `hooks/useLiveRecording.ts` : les chiffres du direct ne doivent pas coûter O(n) à chaque rafraîchissement sur 36 000 points (calcul incrémental, ou rafraîchissement espacé en mode silencieux) ; surveiller `recordingNotification.ts`.
- `platform/beeper.ts` (`armBeltWatch(delayMs, { silent })` : pas de son ni de vibration, l'événement et les abonnés gardés) et `android/.../BeeperPlugin.java` (`watchBelt` lit `silent`, `beltLost` saute son et vibration mais émet l'événement). Texte de la page et titre de la notification inchangés.
- `hooks/useVisibleStatSessions.ts` : `if (!countsInTotals(sport)) continue` (couvre Statistiques, charge d'Edwards, Profil et racine, `ActivityChart`, fond d'accueil, tutoriels).

### Étape C, après rapatriement
Script neuf du banc : import d'un GPX synthétique de nuit (8 h, sans position, heure et FC, calcul `night-hr` ; vérifier que l'import reconnaît le calcul, `guessSport` / `importer.ts`), lecture de l'onglet « test » ; essai court en direct avec `EXAMPLE_BELT` (rangement, nom, aucune ligne de bip, présentation sombre) ; scripts existants rejoués avant/après : test-fcmax, FC repos, timer, muscu (noms dans `outils/banc/SCRIPTS.md`).

### Suite n° 214 (non planifiée ici)
Greffon maison `android/app/src/main/java/io/github/segneur/tracker/HeartRatePlugin.java`, décodage dans `sendMeasurement` : les intervalles RR sont jetés aujourd'hui. Ampleur moyenne à grosse (décodage Java, échantillon, journal, extension GPX en écriture et en lecture, résumé).
