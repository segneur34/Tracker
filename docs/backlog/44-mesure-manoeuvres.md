# Lot 44 · Manœuvres : conservation sur la vitesse brute, caps stabilisés par pas de 0,9 s, virage vu en un seul pas « sens incertain »

Un seul lot pour les lignes 44, 49 et 43 du reste à faire : toutes trois touchent la mesure des manœuvres dans `src/sailing/maneuvers.ts` (noyau voile, « seul dans sa session », jamais en parallèle d'un autre lot). Décisions prises par l'utilisateur le 31/10, en séance, points 1 à 3 ; le point 2 est tranché par l'orchestrateur (technique).

Modèle | Réflexion : agent `lot` sur Opus high (choix de l'utilisateur du 31/10 : « agents Opus, décisions sur Fable ») ; plan par l'agent `Plan` ; relecture obligatoire.

À lire avant : `docs/DECISIONS.md` §1 (Voile), `docs/ETAT_DU_PROJET.md` §11 « Manœuvres, suites de l'audit du point 70 » et « Nommer un virage vu en un seul pas », `docs/HISTORIQUE.md` points 27, 70, 165, 185, 193. Règles 2, 3, 4, 7 de `CLAUDE.md`.

## 1. Conservation lue sur la vitesse brute (ligne 44, décision : oui)

- Aujourd'hui `measureManeuver` prend le creux (`vmin`, `apexIndex`) sur `smoothedSpeed` (médiane 3 s), qui comble les creux en V : conservation surestimée de 0,05 à 0,1.
- Voulu : le creux de la **mesure** (`measure.conservation`, celle affichée et résumée) se lit sur la vitesse non filtrée du point (le champ brut de `PointData`, à identifier ; s'il n'existe pas en nœuds, le dériver sans conversion sauvage, règle 5), dans la même fenêtre (de `rotationStart` à la reprise). La vitesse d'entrée reste la médiane des vitesses d'approche (déjà robuste).
- **Ne pas toucher** à `windCriteria.conservation` ni à `anchorSpeed` de la détection : l'orientation du vent en dépend (ETAT §11 « Orientation fragile ») ; le vent du banc doit rester identique (`general.mjs` : 210°, 12 virements, 12 empannages).
- La réussite d'une manœuvre et le vol perdu (`ORIENTATION_MAX_CONSERVATION`, seuils du §1) : regarder lesquels lisent `measure.conservation` ; s'ils en dépendent, le nombre de manœuvres réussies peut baisser sur les vraies sessions, c'est accepté par l'utilisateur.
- `SUMMARY_CALC_VERSION` (`src/library/record.ts`, 13) passe à 14 si le résumé porte une donnée issue de la conservation ou de la réussite (vérifier `summarizeSession`). Sinon ne pas le toucher et le dire dans le rapport.
- Test : une manœuvre synthétique avec un creux en V d'un point donne une conservation strictement plus basse qu'avec le lissage, et identique à 1 Hz et 5 Hz (règle 2).

## 2. Caps stabilisés par pas de 0,9 s (ligne 49, tranché par l'orchestrateur)

- `medianStableSegment` (vers la ligne 788) juge l'écart (`spreadDeg`) de sa fenêtre point à point : à 5 Hz le bruit indépendant fait monter l'écart (21° à 1 Hz, 29° à 5 Hz, seuil 25°) et un virement sur trois perd son cap stabilisé sur la trace bruitée du test, contre un résultat identique à 1 Hz.
- Voulu : l'écart se lit sur des caps rééchantillonnés par pas de 0,9 s (moyenne circulaire des points de chaque pas, ou cap du point le plus proche ; choisir celui qui rend 1 Hz et 5 Hz identiques), jamais point à point. 0,9 s est une constante nommée de `maneuvers.ts`, pas en dur dans le calcul.
- Résultat attendu : sur la session bruitée du test, le même nombre de caps stabilisés à 1 Hz et à 5 Hz ; les bornes du test de `measureManeuver` sous bruit (relevé au lot 30 : ±20° et 15 m sur le virement le plus lent) resserrées autant que le résultat le permet, chiffres relevés dans le rapport.
- Neutre sur une trace à 1 Hz sans bruit : le banc voile doit être identique.

## 3. Virage vu en un seul pas : « sens incertain » (ligne 43, décision : aucune hypothèse)

- Contexte (point 27) : un enregistreur économique (Komoot) se tait quand on ralentit ; toute la rotation tient dans un seul intervalle (pas unique jusqu'à `MANEUVER_MAX_STEP_S`). On connaît le cap avant et le cap après, pas le chemin : `angleDiff` retient l'arc court, et un virement passé par le lit du vent peut ressortir en empannage.
- Décision de l'utilisateur : aucune hypothèse (ni perte de vitesse, ni déport latéral). Ces virages sont **comptés, mais sans nom ni direction**, et **exclus de l'estimation du vent** (`windSamplesFrom`, `calculateWindStats`).
- Précision de l'orchestrateur : seul un virage **vu en un seul pas** dont le changement de cap est ambigu est concerné, c'est-à-dire quand l'arc court et l'arc long sont tous deux plausibles : changement de cap d'au moins 150° (seuil déjà présent dans la classification, à nommer en constante). Un virage en un seul pas de moins de 150° garde l'arc court et son classement actuel (passer par l'autre côté serait un tour de plus de 210°, pas une manœuvre). Rien ne change pour un virage observé sur plusieurs points.
- Forme : une manœuvre d'un nouveau genre (« sens incertain », identifiant anglais à choisir dans le style de `ManeuverLocation`), rendue par `analyzeManeuvers`, présente dans la liste et la carte des manœuvres avec le libellé « sens incertain », comptée dans le total mais ni dans les virements ni dans les empannages ; `MANEUVER_METRICS` et `summarizeManeuvers` (`sailing/sailingAnalytics.ts`) la connaissent ; `summarizeSession` compte-t-elle les manœuvres ? si oui, préciser le comportement et le numéro de calcul (voir point 1). Pas de nouveau réglage utilisateur.
- Souvenir de l'utilisateur pour la validation sur sa trace Komoot de planche du 22/09 (517 points, 2 h) : « surtout des virements ». Il validera lui-même sur ce fichier ; le lot n'a aucun GPX réel.
- Test : trace synthétique à pas de 20 s avec des virages de 180° en un pas → manœuvres « sens incertain », aucune n'alimente le vent, le compte total les inclut ; la même trace à 1 Hz → virements classés comme avant (neutralité par construction, la branche ne s'arme que sur une fenêtre vide).

## Vérification

- `npm run verif` (lint, tous les tests, build).
- Banc : scripts voile (`general.mjs` et ceux qui lisent les manœuvres ; `node outils/banc/passe.mjs`, options en tête) : vent, nombre de virements et d'empannages identiques ; seules les conservations peuvent baisser, de 0,1 au plus. Relever les chiffres avant et après dans le rapport.
- `outils/banc/manoeuvres-diagnostic.mjs` doit encore tourner (il lit un GPX en argument ; vérifier qu'il compile et traite le nouveau genre).

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de l'utilisateur ; ne touche ni à la détection (`scanTurnWindow`, `readWindow`, `observeTurns`) ni au vent au-delà de l'exclusion du point 3 ; ne réintroduit ni polaire glissante ni corde entrée → sortie (règle 7).

## Questions tranchées par l'orchestrateur (31/10)

- La réussite suit le `vmin` brut, au risque de moins de manœuvres réussies : oui, accepté par l'utilisateur avec la décision 44.
- Une manœuvre « sens incertain » affiche réussie ou ratée dans sa ligne, jugée sur sa vitesse minimale, hors du pourcentage des virements et empannages : oui.
- Les incertains entrent dans `maneuverCount` (Statistiques, image de partage) : oui, « comptés dans le total ».
- À 5 Hz, la vitesse brute se lit en moyenne centrée sur 0,9 s (`TURN_STRIDE_MIN_S`), à 1 Hz c'est la vitesse du point : oui, c'est la règle 2.
- Le seuil d'ambiguïté reste 150° ; un virage Komoot de 145° garde l'arc court : oui.
- `SUMMARY_CALC_VERSION` reste à 13 : le résumé ne calcule aucune manœuvre, les comptes d'une fiche suivent à sa réouverture (comme à la version 12). À dire dans le rapport et au compte rendu.

## Plan d'exécution (agent Plan, Opus, 31/10)

Le vent ne doit pas bouger : `windCriteria`, `anchorSpeed`, le temps mort et `previousEndIndex` (= `measure.exitIndex`) restent tels quels.

**(a) Vitesse brute.** `PointData` (`src/sailing/pointData.ts`) n'a que `smoothedSpeed`. La brute est `TrackPoint.speedMs` (`src/core/types.ts`, écrêtée par `detourSpikes`, non filtrée). Ajouter `speedKn?: number` à `PointData`, rempli dans `toPointData` par `msToKnots(point.speedMs)` (adaptateur existant, règle 5). Optionnel : helper `rawSpeedKn(p) = p.speedKn ?? p.smoothedSpeed`, les traces synthétiques des tests (`buildTrack`, `scriptedTack`) restent neutres.

**Point 1 (`measureRotation`, vers 956-1041).** Garder la boucle de `apexIndex` sur la vitesse lissée, la condition d'arrêt (fin de rotation, reprise à 90 %) et `findRelaunch` : `exitIndex` et `relaunchS` ne bougent pas. Dans la même boucle, même fenêtre, prendre le minimum de la vitesse brute lue en moyenne centrée sur ±`TURN_STRIDE_MIN_S`/2 (0,45 s) : à 1 Hz (gigue de 998 ms comprise) le point seul, à 5 Hz environ 5 points. `vmin = Math.min(minimum brut, minimum lissé)` ; `conservation = vmin / entrySpeed`, `entrySpeed` inchangé. Corriger la doc de `apexIndex` (creux de la vitesse lissée, d'où part la relance).

**(b) Qui lit quoi.** `success = measure.vmin >= successThresholdKn` (vers 1497) lit `vmin` : peut baisser ; `windwardGainM` passe à null pour une manœuvre devenue ratée. `maneuverAgreement` (`ORIENTATION_MAX_CONSERVATION`) et `windSamplesFrom` lisent `windCriteria` seulement. `summarizeSession` ne calcule aucune manœuvre : `maneuverCount` et `maneuverResults` sont écrits par `SailingModule.tsx` (vers 263-270) à l'ouverture, puis recopiés (`summaryOptions.ts` vers 92) : `SUMMARY_CALC_VERSION` reste à 13.

**Point 2 (`turnHeadings` / `windowOf`, vers 755-771).** Regrouper les points de la fenêtre par pas avec `strideEnd(points, k, to)` (`wind.ts`, déjà importé), dernier pas plus court gardé. Cap d'un pas : moyenne des caps déroulés `headingAt(m)` pondérée par `stepDistanceM(points, m)` (helper vers 843), soit la corde du pas ; poids tous nuls → moyenne simple. `spreadDeg` = écart maximal de ces caps de pas à `window.heading` (médiane par point, inchangée). Ni `heading` ni `meanSpeed` ne changent. À 1 Hz un pas = un point : neutre exact. Réutiliser `TURN_STRIDE_MIN_S` (`sailingConfig.ts`, 0,9 s). Les bornes ±20° et 15 m du test vers 892 portent sur `headingChange` et le gain, que ce point ne touche pas : relever les chiffres, ne pas forcer ; si le compte n'est pas égal partout (chevauchement de la fenêtre d'approche, commentaire vers 940), le dire plutôt que retoucher `STABLE_*`.

**Point 3.** `export type ManeuverKind = 'tack' | 'jibe' | 'undecided'`, `ManeuverLocation.type: ManeuverKind` ; `DetectedTurn.type`, `RejectedTurn.type` et `windwardGainM(type)` restent `'tack' | 'jibe'`. `undecided: number` dans `ManeuverStats` (objets factices des tests à corriger). `SHORT_ARC_DOUBT_DEG = 150`, constante locale, employée aussi vers 1319 (même valeur, neutre). Dans `readTurn`, au verdict `candidate`, `singleStep: points[i+1].timeMs - points[i].timeMs > windowMs` (la condition qui arme le pas unique ; `scanTurnWindow`, `readWindow`, `observeTurns` intacts). Dans `classifyManeuvers`, après le verdict `fullTurn` et avant `tackChanged`, si `singleStep && turn >= SHORT_ARC_DOUBT_DEG` : mesurer (`rotationOf`), poser `ignoreUntilMs` et `previousEndIndex` comme pour une manœuvre ; entrée sous le seuil de vol → `setAside('noFlight', …, undefined)` ; sinon location `type: 'undecided'`, `stableHeadings: false`, `windwardGainM: null`, `localWind` = bissectrice de l'arc court (commenté « jamais lu »), `success` sur `vmin` ; `stats.undecided++`. Indépendant du vent. **Exclusion du vent en trois endroits** par un helper `isDirected(m)` : `windSamplesFrom` (explicite), `maneuverAgreement` (indispensable : il prend toutes les `locations`, compte compris), `maneuverSamples` de `calculateWindStats` (`sailingAnalytics.ts` vers 91). `sailingAnalytics.ts` : `ManeuverSummary.undecided = summarizeType(locations, 'undecided')`, `ranked` de `MANEUVER_METRICS` inchangés (pas de podium), `MANEUVER_LABELS: Record<ManeuverKind, string>` (« Virement », « Empannage », « Sens incertain »). `SailingModule.tsx` : 3e ligne « Sens incertain » au tableau (vers 708) avec son `MapToggle` et `showUndecidedOnMap` ; marqueur gris en dur (couleur de donnée), popup par `MANEUVER_LABELS` ; `maneuverCount` = tack + jibe + undecided, `maneuverResults` inchangé ; pas de bloc de détails ni de ligne dans « général ». `outils/banc/manoeuvres-diagnostic.mjs` : incertains à part dans le total, pourcentage de réussite sur virements et empannages seuls, type « inc. », bissectrice « — ».

**Ordre** : 1. `speedKn` et vmin brut ; 2. `spreadDeg` par pas ; 3. `ManeuverKind`, branche et exclusions ; 4. résumé, interface, diagnostic. `node outils/verif.mjs --rapide` après chaque étape.

**Tests (`src/sailing/maneuvers.test.ts`)** : « lit le creux en V sur la vitesse brute, sous la médiane, identique à 1 Hz et à 5 Hz » (chaîne réelle `computeKinematics` + `trackToPointData`, Doppler sans bruit, creux plat sur (t−0,5 ; t+0,5] s ; conservation strictement plus basse qu'en ôtant `speedKn`, identique aux deux cadences à 6 décimales) ; test vers 935 : égalité exacte des caps stabilisés et des échantillons de vent (écarts relevés en commentaire) ; test vers 892 : bornes resserrées seulement si les relevés le permettent ; « un virage de 175° vu en un pas de 20 s est sens incertain » (modèle `buildSparseTurnTrack`, trois virages d'environ 175° : `type 'undecided'`, `stats.undecided === 3`, inclus dans `locations`, `windSamplesFrom` vide, `maneuverAgreement(stats).count === 0`, `calculateWindStats` ne les prend pas) ; « la même trace à 1 Hz reste classée » (`buildTrack(70, 1, singleTackThroughNorth)` : 1 virement, 0 incertain) ; `buildSparseTurnTrack(22)` (145°) reste un virement (test vers 536 inchangé) ; `sailingAnalytics.test.ts` : `summarizeManeuvers` donne `undecided` sans podium ; neutralité de la détection préparée (vers 1654) inchangée.

**Identique** : vent du banc 210°, 12 virements, 12 empannages ; `windCriteria`, `anchorSpeed`, `exitIndex`, `relaunchS`, `headingChange` et le gain à 1 Hz. Seules `vmin`, la conservation et la réussite peuvent baisser, la conservation de 0,1 au plus : chiffres avant et après dans le rapport.
