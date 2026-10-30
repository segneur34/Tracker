# 28 · Cardio : FC moyenne dans « Général » en voile et en surf, bips de sortie de zone à l'enregistrement

Opus | high. Non neutre (ajouts visibles et sonores, aucun chiffre existant ne change). Brief écrit le 30/10 par l'orchestrateur d'après la ligne 28 de `docs/BACKLOG.md`, Q28 (zones communes gardées), Q29 (répondue le 30/10 : FC moyenne dans Général et bips ; énergie par la FC → n° 96, splits → n° 97) et les deux réponses de l'utilisateur du 30/10 (ci-dessous).

## Réponses de l'utilisateur (30/10)

- **Où choisir la zone visée** : sur la page Enregistrer, avant de partir, seulement si une ceinture est connectée. Pas dans Réglages.
- **Quand sonner** : une fois sorti de la zone visée, un premier signal après 10 s hors zone, un deuxième 40 s plus tard, puis un toutes les minutes, trois fois ; ensuite silence jusqu'au retour dans la zone. Au retour dans la bonne zone : juste un « ok » (un bip court). Deux bips brefs = trop haut (`TEST_SIGNAL_TONES.trop`), trois bips brefs = trop bas (`TEST_SIGNAL_TONES.accelere`), « ok » = `TEST_SIGNAL_TONES.bien` ; vibreur comme pour les tests guidés.

## Ce qui existe

- Zones cardiaques du pratiquant par activité : `readHeartRateZoneBounds(activity)` (`hooks/useRunnerProfile.ts`), bornes des 5 zones (`core/heartRate.ts`, `ZONE_COUNT`, `bandIndex` dans `recording/liveFields.ts` pour le champ du direct `heartRateZone`, qui montre la zone courante). Aucune notion de zone visée nulle part.
- Enregistrer (`pages/RecordingPage.tsx`) : choix au repos en boutons glissants en cascade (`SegmentedControl`, §6 « Choix de l'activité au repos ») ; ceinture : `savedBelt`, `useBeltLive()` (état `connected`), tuile `BpmTile` pendant l'enregistrement, `measureHeartRate`, `heartRatePicked` mémorisé par `usePerActivityChoice(chosenActivityId, défaut)` ; FC en direct : `useRecorderSelector((s) => s.heartRate)` (`{ state, bpm }`, `readableBpm`).
- Sons : `playPattern(tones, vibrate)` de `platform/beeper.ts` (`ClockTone`, tons `bref`, `court`, `long`, `final`), joués écran éteint par Android ; `TEST_SIGNAL_TONES` dans `recording/fitnessTest.ts` ; le test guidé les joue depuis `hooks/useFitnessTest.ts` (`play`, `advance`), avec une FC lissée par `guideReadings` (`windowMean` sur `smoothS`).
- FC moyenne dans « Général » : déjà à pied et à vélo (`LandModule.tsx`, carte `heartRate` « FC moyenne », `heart.stats.avgBpm`, `useAnalysisHeart`) ; absente en voile (`SailingModule.tsx`, `generalStats`) et en surf (`SurfModule.tsx`, `generalStats`), qui ont pourtant l'onglet « cardio » et `useAnalysisHeart` (voile sûr, surf à vérifier).
- Autres sons pendant un enregistrement : compteur d'intervalles (`recording/intervalTimer.ts`, `useIntervalTimer`), balises (`useMarkGuide`), tests guidés (`useFitnessTest`). Un test guidé a son propre guidage sur la FC : pas de bips de zone pendant un test.

## À faire

1. **Calcul pur** `recording/zoneAlert.ts` (+ `zoneAlert.test.ts`) : une machine d'état sans horloge ni son, alimentée par (temps ms, FC lissée ou `null`, bornes des zones, zone visée 1 à 5, enregistrement en cours ou en pause). Elle rend le signal à jouer (`trop`, `accelere`, `bien` ou rien). Règles : hors zone (au-dessus ou en dessous) depuis 10 s d'affilée → premier signal ; puis 40 s plus tard ; puis toutes les 60 s, trois fois ; puis silence tant qu'on reste dehors ; retour dans la zone (après qu'au moins un signal a sonné) → `bien`, une fois ; FC absente (`null`, ceinture sans contact) ou pause : la sortie en cours est oubliée, rien ne sonne, le compte repart à zéro à la reprise. Un changement de côté (trop haut puis trop bas) repart à zéro. Délais en secondes et surchargeables en paramètre (règle 3), valeurs par défaut dans le module : 10 s, 40 s, 60 s, 3 rappels. Tests : scénarios à 1 Hz et à cadence irrégulière (une mesure toutes les 2 à 3 s, règle 2), pause au milieu, perte de contact, aller-retour rapide (moins de 10 s dehors : silence).
2. **FC lissée** : réutiliser le lissage du test guidé (`windowMean`, `smoothS`) ou `smoothHeartRate` de `core/heartRate.ts` ; fenêtre en secondes, pas en points.
3. **Choix de la zone sur Enregistrer**, au repos : un bouton glissant « Zone visée : aucune · Z1 · Z2 · Z3 · Z4 · Z5 » dans la cascade des choix, sous la ceinture, montré seulement quand une ceinture est retenue et connectée (`useBeltLive().state === 'connected'`) et que la FC est mesurée (`measureHeartRate`), jamais pour un test guidé ni pour le test de FC repos ; « aucune » par défaut ; dernier choix gardé par activité comme `heartRatePicked` (`usePerActivityChoice`). Pendant l'enregistrement, la tuile BPM dit la zone visée (« visée Z3 »), sans autre changement de la page ; le champ du direct « Zone » reste la zone courante.
4. **Branchement** : un hook `useZoneAlert` sur le modèle de `useFitnessTest` (armé au départ avec la zone visée et les bornes de l'activité, abonné à l'enregistreur, FC du `heartRate` de l'enregistreur), qui joue `TEST_SIGNAL_TONES[signal]` par `playPattern(…, true)` ; actif en état `recording` seulement, muet en pause, désarmé à l'arrêt ; une ligne de journal au départ (zone visée) si le journal note déjà les options de l'enregistrement (`journalActivityLine`), sinon rien. Les sons des balises et du compteur ne sont pas touchés ; vérifier que deux motifs ne se chevauchent pas (`playPattern` les enchaîne-t-il ?).
5. **FC moyenne dans « Général »** en voile et en surf : une carte « FC moyenne » (`Math.round(avgBpm)` bpm) en fin de liste de `generalStats`, seulement si la session a de la FC (`heart.present && heart.stats`), même libellé qu'à pied ; l'image de partage la reprend d'elle-même (`generalStats`).

## Garde-fous

- Règle 12 : son et vibreur par `platform/beeper.ts` seulement. Règle 3 : délais paramétrés, défauts dans le module. Règle 2 : fenêtres en secondes.
- Aucune donnée dans la fiche de session : la zone visée n'est pas une donnée de la session (pas de champ de fiche, pas de `SUMMARY_CALC_VERSION`).
- Aucun chiffre existant ne change ; les tests existants restent tels quels ; `ManeuverStats`, résumés et Statistiques intacts.
- Pas d'emoji, variables de `tokens.css`, `SegmentedControl` pour le choix, libellés en français sans jargon (« Zone visée »).
- Ne pas toucher aux tests guidés ni à leurs sons ; pas de bips de zone pendant un test.

## Preuve

- Tests de `zoneAlert` sur les scénarios ci-dessus ; `npm run verif`.
- Banc : `general.mjs` (voile, surf : texte identique sauf la ligne « FC moyenne » si la trace du banc a de la FC, sinon identique) ; `enregistrer` ou le script qui relève la page Enregistrer au repos (texte identique sans ceinture : le choix n'apparaît pas).
- Essai au téléphone (essai 86, déjà dans `docs/BACKLOG.md`) : course avec la ceinture, zone visée Z2, sortir par le haut puis par le bas.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; par étape, ce qui a changé et sa preuve ; les fichiers touchés ; ce qui n'a pas été fait ; l'essai au téléphone à ajuster s'il y a lieu.

## Tranché par l'orchestrateur le 30/10, sur le plan de l'agent `Plan`

- La zone visée vaut « aucune » à chaque ouverture de la page Enregistrer, comme les cases de la page (`usePerActivityChoice` ne mémorise rien d'une visite à l'autre) : pas de bip surprise à la sortie suivante, pas de clé d'appareil à ajouter. Pourquoi : l'utilisateur a choisi « sur Enregistrer, avant de partir » ; la mémorisation n'était qu'une suggestion de l'orchestrateur.
- La zone est proposée pour toute activité avec ceinture connectée et bornes de zones connues, fractionné et muscu compris ; seuls les tests guidés et le test de FC repos en sont exclus.
- Source du battement : `subscribeHeartRate` de `platform/heartRate.ts` (environ 1 Hz, écran éteint compris), pas les positions ni l'état de l'enregistreur ; `active` = état `recording` de l'enregistreur.
- Lissage : `windowMean` de `recording/fitnessTest.ts` exporté (fenêtre `smoothS` du profil, 5 s), `smoothHeartRate` étant centré donc inadapté au direct.
- Écart minimal de 3 s entre deux signaux de zone (`minGapS`) ; un chevauchement rare avec un bip de balise ou du compteur est accepté.
- Étape 5 élargie : la carte « FC moyenne » va aussi dans `generalStats` de `LandModule.tsx` (l'image de partage à pied et à vélo ne l'avait pas alors que « Général » l'a), pour que « l'image de partage garde la liste entière » soit vrai partout.
