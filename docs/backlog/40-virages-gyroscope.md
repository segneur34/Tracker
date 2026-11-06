# 40 · Surf : virages mesurés par le gyroscope

Modèle | Réflexion : Opus | high ; plan par l'agent `Plan`, relecture obligatoire. Lire avant : CLAUDE.md (règles 2, 3, 10, 12), `docs/DECISIONS.md` §3 (capture des sauts, case « Mesurer les sauts ») et §4 (Surf : virages, pumping foil), `docs/MISE_EN_PAGE.md`, et ce fichier en entier. Esquisse d'origine (10/10) : « Lot 2 » de `~/.claude/plans/on-vas-reprendre-et-snug-stonebraker.md`.

## Constat

Les virages d'une vague sont comptés au GPS (`surfing/gpsTurns.ts`, `turnMinDeg` 60°), donc seuls les grands changements de direction, affichés comme expérimentaux (§4). Un bottom turn ou un top turn dure environ une seconde : à 1 Hz, le GPS ne les voit pas. Le téléphone sur la poitrine capture déjà accéléromètre et gyroscope (`platform/motion.ts`, format `.imu` de `core/imuFile.ts`) pour les sauts (voile, course, vélo) et le pumping sur foil (surf, voile) ; la verticale de l'appareil est déjà estimée (`attitudePass` de `core/jumps.ts` / `core/attitude*`, partagée avec `core/pumping.ts`).

## Voulu

- **Capture** : une case « Mesurer les virages » par activité de surf dans Réglages (même rangée et même mécanique que « Mesurer les sauts », §3 : cochée d'office pour la séance sur Enregistrer, décochable), qui lance la même capture des capteurs que les sauts et le pumping ; une seule capture par séance, quelle que soit la case qui la demande (Pumping et Virages cochés ensemble ne font qu'un `.imu`). Défaut de la case : cochée pour « Surf » et « Surf foil », décochée pour les autres activités de la famille (paddle, kayak, downwind).
- **Élagage** : à « Analyser », un `.imu` de surf est élagué autour des vagues trouvées par le GPS (± une marge en secondes, dans `SurfProfile`), pas autour des sauts ; sauf si Pumping est coché (la capture reste entière, comme en voile sur foil, `keepsWholeCaptureForPumping`). Le fichier élagué garde ses fenêtres dans l'en-tête, comme pour les sauts.
- **Calcul pur** (`surfing/gyroTurns.ts`, SI) : vitesse de rotation autour de la verticale (gyroscope projeté sur le « haut » estimé, pièce commune sortie de `jumps.ts`/`pumping.ts` si elle n'est pas déjà dans un module commun), intégrée en cap relatif dans chaque vague ; un virage compté à chaque retournement du sens de rotation qui dépasse `gyroTurnMinDeg` depuis l'extrême précédent (hystérésis, comme `gpsTurns`), et seulement si la rotation a atteint `gyroTurnMinRateDegS` (le buste qui tourne vite, pas une dérive lente). Seuils dans `SurfProfile`, aucun en dur (règle 3) ; fenêtres en secondes (règle 2) ; une vague que la capture ne couvre pas garde ses virages GPS.
- **Affichage** : dans l'onglet « vagues », la colonne des virages montre les virages du gyroscope quand la vague en a, sinon ceux du GPS ; la mention « expérimental (GPS) » ne reste que pour les vagues sans capture. Pas de nouvel onglet ni de nouvelle tuile : la disposition ne change pas (sinon, maquette d'abord : BLOQUÉ).
- **Fiche** : les virages du gyroscope vont dans le résumé de la session (`summary`) avec `SUMMARY_CALC_VERSION` augmenté, pour la bibliothèque et Statistiques si elles montrent les virages ; sinon, seulement dans l'analyse.

## Hors lot

L'instant exact du take-off et la cadence de rame par l'accéléromètre (esquisse du 10/10) : plus tard. Les seuils réels : réglés à l'essai 46 (aucune session de surf capturée avec des vagues n'existe sur le PC ; la seule capture surf, `2026-10-14_16-08-08_surf.imu`, est un test de sup foil à plat, sans vague, qui sert de témoin : aucun virage ne doit y être trouvé par erreur hors vague, et le calcul ne doit pas planter dessus).

## Tests (`surfing/gyroTurns.test.ts`, capture synthétique par `core/imuSynthetic.fixture.ts`)

- une vague de 10 s avec trois virages de 90° à 120°/s : trois virages ;
- la même vague avec une dérive lente de 2°/s sur toute la vague : aucun virage de plus ;
- un virage dans la vague, téléphone penché de 30° : un virage (la projection sur la verticale tient) ;
- mêmes résultats avec une capture à 50 et 200 Hz et une trace à 1 et 5 Hz ;
- une vague hors de la capture : virages GPS gardés ;
- élagage : fenêtres autour des vagues, fichier plus petit, mêmes virages depuis la séance entière et depuis le fichier élagué.

## Vérification

`node outils/verif.mjs --rapide` par l'agent ; `npm run verif`, banc (`outils/banc/surf*.mjs` s'il existe, `onglets`, `prereglages`) et `relecture` par l'orchestrateur. Diagnostic hors navigateur : `outils/banc/virages-diagnostic.mjs <.imu> <.gpx>` qui liste les vagues et leurs virages (GPS et gyroscope), sur le modèle de `sauts-diagnostic.mjs`.

## Plan (agent `Plan`, 06/11) et choix tranchés par l'orchestrateur

Ce qui existe : la famille surf n'a pas de case « Sauts » (`jumps: null`) ; la capture ne se lance en surf que par Pumping (foil) dans `pages/RecordingPage.tsx` (`handleStart`, `motion`, `motionWhat`) ; le réglage Pumping est dans `settings/activitySettings.ts` (`pumping`, `resolvePumping`), `hooks/useSportSettings.ts` (`effectivePumping`), `pages/SettingsPage.tsx`, `settings/activityPresets.ts` (`presetOf`, `ACTIVITY_PRESETS`) ; la verticale commune est `core/imuVertical.ts` (`verticalAcceleration` rend `upF`, `upB` ; ni « haut » moyenné ni gyroscope sur la grille) ; `capturedWindows` et `flightCapture` dans `core/pumping.ts` montrent le patron « ne lire que les mesures d'un intervalle » ; `surfing/imuPrune.ts` (`surfPruneWindows`, `pruneSurfImu`) existe mais est coupé (`PUMP_DETECTION.pruneCapture: false`, piège HISTORIQUE l. 533 : une session sans vol perdait sa capture) ; toute capture de surf est rangée entière (`hooks/sessionLibrary/addSession.ts`) ; les virages GPS : `surfing/gpsTurns.ts` (`countDirectionChanges`), appelés par `surfing/surfAnalysis.ts` (`SurfWave.turns`), colonne « Virages* » et note dans `pages/SurfModule.tsx` ; la capture y est lue par `useSessionPumping`.

Tranché (06/11) :
- **Pas d'élagage dans ce lot** : la capture de surf reste rangée entière, comme aujourd'hui (le piège de la l. 533, et une vague qui apparaît après un seuil abaissé dans l'analyse tomberait hors capture). `surfing/imuPrune.ts` et `pruneCapture` restent tels quels ; `addSession.ts` et `library/summary.ts` ne bougent pas. L'élagage se décidera à l'essai 46 si les fichiers sont trop gros.
- Case distincte « Mesurer les virages » (le surf n'a pas de case Sauts, Pumping n'existe que sur foil) ; par activité seulement, pas par session ; cochée pour Surf et Surf foil (`ACTIVITY_PRESETS`), pas dans `BASE_PRESETS` (paddle, kayak, downwind décochés).
- Pas de virages dans le résumé de la fiche ni de changement de `SUMMARY_CALC_VERSION` : l'analyse seule.
- Une vague couverte en partie seulement garde ses virages GPS ; pas de nouveau champ dans l'en-tête du `.imu` (`jumps: true` suffit, rien côté Android) ; `useSessionPumping` réutilisé tel quel.

Fichiers et étapes, dans l'ordre, `node outils/verif.mjs --rapide` après chaque étape :
1. `core/imuSynthetic.fixture.ts` : `yaw?: (t) => number` (ω = (θ', sin θ·ψ', cos θ·ψ')) ; sans `yaw`, sortie identique à l'octet près (même ordre des tirages). `core/imuVertical.ts` : `yawRate: Float64Array` (gyroscope sur la grille · « haut » moyenné, rad/s), calculé dans la boucle finale, sans effet sur sauts et pumping ; test : `yawRate` vaut ψ' quelle que soit l'inclinaison.
2. `surfing/gpsTurns.ts` : sortir l'hystérésis en `directionChanges(headingDeg, minDeg)` qui rend les instants des retournements ; `countDirectionChanges` l'appelle ; tests existants inchangés et verts.
3. `core/sportProfiles.ts` : `SurfProfile.gyroTurns` (`...ATTITUDE`, `minDeg`, `minRateDegS`, `smoothingS`, `leadS`), valeurs provisoires (60°, 30°/s, 0,3 s, 2 s), à régler à l'essai 46. Nouveau `surfing/gyroTurns.ts` (SI) : `gyroWaveTurns(rec, d, waves): (number | null)[]` ; vague couverte si une fenêtre de `capturedWindows` la contient en entier, sinon `null` ; `verticalAcceleration` sur [début − `leadS`, fin + `leadS`] rognée à la fenêtre ; `yawRate` lissé par `centredMean` (demi-largeur en secondes) ; cap intégré ; `directionChanges` ; un virage ne compte que si la rotation lissée a atteint `minRateDegS` depuis l'extrême précédent. Tests `surfing/gyroTurns.test.ts` : les six cas du brief, plus un témoin à plat sans vague (aucun virage, pas de plantage).
4. Réglages : `settings/activitySettings.ts` (`turns?: ByActivity<boolean>`, `resolveTurns` : `null` hors surf, sinon rangé, sinon `presetOf(activity).turns ?? false` ; normaliseur qui ne range que l'écart au défaut, comme `heartRate` ; `turns` et `isTurnsOverridden` dans la vue ; ligne « réglages changés ») ; `settings/activityPresets.ts` (`turns?: boolean`) ; `hooks/useSportSettings.ts` (`effectiveTurns`) ; `pages/SettingsPage.tsx` : ligne « Virages », case « Mesurer les virages », marque « défaut », aide « ? », sous Pumping. Tests des réglages et pré-réglages.
5. `pages/RecordingPage.tsx` : `turnsOffered`, `usePerActivityChoice`, une `CaptureOption` « Mesurer les virages » sur téléphone (« Téléphone fixé sur la poitrine… ») ; dans `handleStart`, une branche `capture && (measurePumping || measureTurns)` : un seul `.imu`, `foil = effectiveFoil(chosen)` ; `motionWhat` : « Virages », « Pumping » ou « Pumping et virages ».
6. `pages/SurfModule.tsx` : `useSessionPumping(shownFile, (pumping && (open.vols || open.pumping)) || open.vagues)` ; `useMemo(gyroWaveTurns)` ; cellule `gyro ?? w.turns`, astérisque seulement sur les valeurs GPS ; note et `title` adaptés. Pas de nouvel onglet ni de tuile.
7. `outils/banc/virages-diagnostic.mjs <.imu> <.gpx> [--support=surf]` (modèle `sauts-diagnostic.mjs`) : vagues avec virages GPS et gyroscope ; l'éprouver sur `D:\memoire Tracker\Tracker\sessions\2026-10-14_16-08-08_surf.imu` + `.gpx` (témoin sans vague : rien, pas de plantage). Nouveau `outils/banc/virages.mjs` (modèle `pumping.mjs`) : session de surf avec un `.imu` synthétique qui tourne, colonne sans « * », une vague hors capture garde le GPS ; inscrit dans `outils/banc/SCRIPTS.md`.

Banc (orchestrateur) : `surf`, `prereglages`, `onglets`, `pumping`, `virages`. Essais au téléphone : la case sur Enregistrer pour Surf (cochée) et absente pour Paddle ; Pumping et Virages cochés ensemble → un seul `.imu` ; puis l'essai 46.

## Fait (06/11, commit « Lot 40 », version 0.4.96)

Écart au plan, retenu : le critère de vitesse n'est pas « pointe lissée ≥ 30°/s » mais « le buste a tourné de `minDeg` (60°) en `minDeg / minRateDegS` (2 s) au plus, entre un extrême et le suivant ». Sur le témoin du 14/10 (sup foil à plat, rame, aucune vague), la pointe laissait passer des dérives lentes secouées par la rame (60° en 5 à 22 s, pointes de 40 à 120°/s) : 76 retournements par tranches de 60 s ; avec la rotation soutenue, il en reste 31, de vrais demi-tours (le cap du gyroscope suit celui du GPS : −387° et −514° au GPS contre −625° et −780° au gyroscope sur les minutes 8 et 9). L'application n'en montre aucun, faute de vague. Seuils provisoires (60°, 30°/s, lissage 0,3 s, marge 2 s), à régler à l'essai 46 avec `virages-diagnostic.mjs`.

Limite connue : une vague couverte par la capture mais traversée par un trou de mesures compte comme couverte (le trou est interpolé). Réserve de forme de la relecture : les virages se calculent dès que la capture est chargée, même « vagues » fermé (coût négligeable). Le script `prereglages` du banc a 3 échecs identiques avant et après (script à revoir, sans rapport).
