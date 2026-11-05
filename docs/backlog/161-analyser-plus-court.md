# 161 · Enregistrer › « Analyser » plus court

Brief écrit le 05/11 (paquet A « Analyses : défauts et fluidité », plan approuvé : `~/.claude/plans/fait-les-lot-a-abstract-pizza.md`). Modèle | Réflexion : Opus | high. Mesurer d'abord, corriger d'après les chiffres.

## Tel que noté

« Analyser » un peu long à la fin d'un enregistrement (l'utilisateur, 04/11 ; le reste de l'appli lui va). Ce geste n'a pas été mesuré au lot 114. Résultat attendu : l'analyse s'ouvre sans attente sensible.

## Parcours

`handleAnalyze` (`pages/RecordingPage.tsx:837`) → `analyzePendingSession` (`hooks/useRecorder.ts:596`) → `saveRecordedSession` (`hooks/sessionLibrary/importer.ts:33`) → `addGpx` (`hooks/sessionLibrary/addSession.ts:124`), puis `openSession`, et l'analyse relit tout.

Coupables à départager : `analyzeGpx` (`addSession.ts:132`) et l'élagage de la capture (`prunedMotion`) sur le fil de l'affichage, alors que le lot 126 a déjà un worker pour la lecture ; lecture de la capture (`readMotionCapture`) ; session lue deux fois (rangement, puis ouverture).

## À faire

1. Mesure `analyser` dans `outils/banc/fluidite.mjs` (enregistrement rejoué, ×1 et ×6, par étape). Rien sur le téléphone de l'utilisateur, dont la mémoire ne se touche pas.
2. Correction d'après les chiffres, sur les pièces existantes (worker du 126, résultat déjà calculé réutilisé). Si aucune étape ne pèse à ×6, le dire et ne rien coder.

## À garder

Sûreté inchangée : journal effacé après l'écriture seulement, capture illisible toujours signalée (`motionUnreadable`), session gardée en attente si l'écriture échoue, résultat identique dans la fiche et le résumé.

## Vérification

`node outils/verif.mjs --rapide` (tests de `useRecorder`). Relevé avant et après noté ci-dessous. Banc : scripts de l'enregistrement et `donnees`.

Essai au téléphone, un seul : « Analyser » après une vraie sortie.

## Plan (agent Plan, 05/11, lecture seule : à confirmer par la mesure)

**Constats de lecture.** Sans capture, rien ne rend la main au navigateur avant `analyzeGpx` : « Rangement… » n'est sans doute pas peint avant la fin du calcul. L'application enregistre à 1 Hz : 3 h font environ 10 800 points, pas les 54 000 du relevé du 114. `readMotionCapture` rend `null` hors téléphone ; au téléphone, lecture et écriture de la capture passent en base64 sur le fil de l'affichage (3 Mo par heure, plafond 30 Mo). `analyzePendingSession` réutilise `motionBytes` à chaque essai : jamais de transfert qui les détache. En surf, `prunedMotion` relit le GPX une seconde fois. Le job `summarize` du worker existe déjà (`summaryQueue.ts:39`).

**A. Mesure** (`outils/banc/fluidite.mjs`, rien dans `src/`) : `analyser` hors de la liste par défaut. Scénario de `bench.mjs:54-67` (Rejeu, ×600, Démarrer, Arrêter), un GPX par prise avec un `startMs` différent (sinon `duplicate`). Voile 3 h et course 2 h à 1 Hz. Ralenti juste avant le clic ; trois prises à ×1 et ×6. Sondes : `Worker`, `history.pushState`, écritures, rAF après « Rangement… ». Découpage : clic → « Rangement… » peint ; clic → première écriture ; écritures ; journal ; `pushState` → titre, trace, chiffres ; tâche max et total bloqué par phase. Une prise sous le profileur. Avec capture : `.imu` de 3 h fabriqué comme `sauts.mjs:132-159`, posé sur `getRecorderState().pending` (serveur de développement), contrôle que l'élagage a eu lieu. Hors de portée : lecture native, pont, SAF ; minuter `base64ToBytes` et `bytesToBase64` comme borne basse. Sans capture, refaire sur la version compilée.

**Règle de décision.** À ×6 : une tâche de plus d'1 s ou plus de 2 s bloquées pèse ; une étape pèse dès 0,5 s. En dessous partout : le dire, ne rien coder.

**B. Corrections, seulement si leur étape pèse, dans l'ordre.**
1. `analyzeGpx` dans le worker (`addSession.ts`, `summarizeGpx.ts` : options qui acceptent `sport` non défini et l'`activityId` imposé) : `runInWorker('summarize', text, options)`, réglages lus avant l'envoi, même erreur refaite (`invalid`), worker mort : calcul en ligne. Vaut aussi pour les imports.
2. Élagage dans le worker (job `prune`) : décision sur le fil de l'affichage, `surfRides` et `pruneImu` dans le worker, requête clonée sans transfert, `catch` qui rend la capture entière.
3. GPX non relu à l'ouverture : mémoire d'une place `{ file, text }` posée après écriture, consommée une fois par `loadSessionGpx` seulement.
4. Base64 de la capture hors du fil : seulement si sa mesure pèse.
Écartés : lecture partagée entre `summarize` et `prepare`, résultat complet réutilisé, manœuvres et dessin à l'ouverture (communs à toute analyse).

**Tests.** `src/hooks/sessionLibrary/addSession.test.ts` à créer : fiche et résumé identiques en ligne et par le worker (`FakeWorker`), sport imposé, deviné et `null`, avec `test` ; GPX illisible ; écriture en échec ; élagage en échec. Banc : `FLUIDITE_MESURES=analyser node outils/banc/passe.mjs fluidite` avant et après ; `bench`, `activite`, `compteur-course`, `materiel-fin`, `donnees`, `sauts`, `pumping`, `library`.

**Tranché par l'orchestrateur.** Un seul chemin pour tous les `addGpx` ; cadence à l'arrêt hors lot ; aucun chrono dans `src/` ; si le banc ne montre aucune étape lourde, rien de plus que B1 s'il pèse, et l'essai au téléphone tranche. Aucune question pour l'utilisateur avant les chiffres.

## Relevés (05/11)

Version compilée (`outils/banc/fluidite-compile.mjs`, `FLUIDITE_MESURES=analyser`, 3 prises, médiane), enregistrement rejoué, sans capture. Du clic sur « Analyser » :

| Mesure | Voile 3 h, ×6, avant → après | Course 2 h, ×6, avant → après |
|---|---|---|
| « Rangement… » peint | 1,02 s → 0,17 s | 0,55 s → 0,19 s |
| Bloqué avant l'écriture | 0,99 s → 0,12 s | 0,53 s → 0,16 s |
| Chiffres de l'analyse à l'écran | 2,76 s → 2,05 s | 1,90 s → 1,29 s |
| Ouverture, tâche max | 0,93 s → 0,84 s | 0,78 s → 0,42 s |

À ×1, voile : chiffres 0,48 s → 0,34 s ; « Rangement… » 0,17 s → 0,01 s.

**Décision (orchestrateur, d'après la règle du plan).** B1 gardée : le blocage d'avant l'écriture dépassait 0,5 s. B2, B3 et B4 non faits : après B1, plus aucune étape du rangement ne pèse au banc ; ce qui reste vient de l'ouverture de l'analyse (une à deux secondes à ×6), commune à toute analyse, hors lot.

**Limites.** `Emulation.setCPUThrottlingRate` semble ne pas ralentir le worker (lecture : 0,07 s à ×6 en voile) : le temps total à ×6 est donc flatté, pas la libération de l'écran. Le cas avec capture de capteurs ne se mesure pas sur la version compilée, et le banc ne voit ni la lecture native, ni le pont, ni l'écriture dans le dossier du téléphone : l'essai au téléphone dira ce qu'il reste. Un worker qui se tairait sans erreur laisserait « Rangement… » affiché, journal gardé, repris au relancement : risque déjà présent pour la file des résumés, non traité.

**Garde (orchestrateur).** La page répondant pendant le calcul, un rangement en cours devient un état du module (`RecorderState.analyzing`) : second « Analyser » = même promesse, « Jeter » ignoré, boutons inactifs même après un aller-retour sur la page. Reste, non traité, faute de place à l'écran pour le dire : un matériel choisi après le clic sur « Analyser » n'est pas écrit (fenêtre d'une fraction de seconde), il se refait dans l'onglet de l'analyse ; et une page quittée pendant le rangement ramène sur l'analyse à la fin, comme avant.
