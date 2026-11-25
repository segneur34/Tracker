# 232 · Plan de l'étape 1 (agent Plan, 25/11) et choix tranchés

Brief : `docs/backlog/232-enregistrement-coupures.md`. Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule). Là-bas l'enregistreur est découpé en `src/hooks/recorder/*` ; ici tout tient dans `src/hooks/useRecorder.ts` (1 842 lignes) : on reporte la logique, pas le découpage. Tracker n'a pas de `nativeLog` : rien de ce qui porte sur le rattrapage n'est à reprendre (étape 2).

Ordre : A, puis B, puis C, puis D1 ; D2 après le lot 225. Un commit par sous-lot.

## A · Reprise après coupure : ceinture et capteurs (Gtracker 360, 361)

- `src/recording/journal.ts` : l'en-tête garde `belt` et `motion`, à côté de `withoutBelt` (existe). `journalBeltLine` ('stopped'/'asked') et `beltStopped`. `copyMotion` garde les **quatre** champs de `MotionSetup` de Tracker (placement, foil, jumps, cadence).
- `src/hooks/useRecorder.ts` : `startRecording` écrit l'en-tête complet ; `takeBeltOrWarn` regroupe les blocs des lignes 1398-1405 et 1455-1460 ; `continuePendingSession` lit la ceinture de l'en-tête, sinon `effectiveHeartRate` pour un journal d'avant, et appelle `continueCapture` à la place de `CAPTURE_NOT_RESUMED` ; `resumeSilently` redemande la ceinture quand `adoptBelt` rend `null` et relance la capture si elle ne tourne plus ; `watchResumedBelt` : alerte de FC perdue après 1 min si la ceinture mesurait avant la coupure ; `stopRecordingBeltSearch` écrit 'stopped' au journal. Muscu sans position : son chemin actuel, ceinture obligatoire, est gardé.
- `src/platform/motion.ts` : `continueMotionCapture` (`append`) et `earlierMeasures` ; `motionCaptureWarning` ignore `samples === 0` quand `earlierMeasures` est vrai.
- `android/.../MotionPlugin.java` et `ImuWriter.java` : second constructeur et `readExisting` (paquet tronqué coupé, en-tête jamais réécrit). Test : `ImuFormatTest.java`.
- Lecture morceau par morceau : `core/imuVertical.ts` (`measuredPieces`, et `captureBreakS: 5` dans les réglages communs des capteurs du profil, règle 3) ; `core/jumps.ts` (`pruneWindows`), `core/pumping.ts` (`capturedWindows`), `surfing/imuPrune.ts`, `surfing/gyroTurns.ts` : calcul par morceau ; `running/cadence.ts` : `accelMagnitudeGrid` met déjà `NaN` dans les trous, sans doute déjà bon, à prouver par un test.
- Tests : `journal.test.ts`, `useRecorder.resume.test.ts` (ceinture du départ, ancien journal, abandon puis « Continuer », pause manuelle) ; `imuVertical`, `jumps`, `pumping`, `imuPrune`, `cadence` : une capture avec un trou de plusieurs minutes (`core/imuSynthetic.fixture.ts`), et rien ne change sans trou.
- Banc : avant/après, puis `sauts`, `pumping`, `cadence`, `muscu`, `cardio`.

## B · Filets et fermeture (Gtracker 396, 496)

- `core/xml.ts` : `INVALID_XML_CHARS` retiré dans `escapeXmlText`, repris par `core/gpxParser.ts` (ligne 55). Tests `xml.test.ts`, `gpxWriter.test.ts`.
- `journal.ts` : un bloc relu en double ne donne qu'un repère par instant et qu'une coupure par heure.
- `hooks/sessionLibrary/pending.ts`, ligne 190 : un temporaire complet mais illisible n'est plus effacé (sous son vrai nom, ligne 139, c'est déjà le cas). Test `useSessionLibrary.memoire.test.ts`.
- `AndroidManifest.xml` : `fontScale|fontWeightAdjustment` dans `configChanges`, avec `androidManifest.test.ts`.
- `HeartRatePlugin.java` : garde-fou de la première connexion (`openGuard`) ; aujourd'hui `OPEN_GUARD_MS` ne sert qu'en mode perte (ligne 677).
- Abonnés protégés : `createListeners({ safe: true })` pour la liste principale de l'enregistreur (`useRecorder.ts`, ligne 293), `try/catch` dans `compute` de `useLiveRecording.ts`. Tests : un abonné qui lève.
- Repères comptés depuis le plus tôt entre l'heure du départ et la première position (`recoverOnce`, ligne 1166).
- Journaux mis de côté : `platform/files.ts` (`listAside`, `readAside`, `removeAside`, `setAsideTimeMs`) ; nouveau `hooks/setAsideJournals.ts`, sur une reconstruction pure tirée de `recoverOnce` ; `library/folderLayout.ts` (`JOURNALS_DIR`, sous-dossier `journaux`, une ligne du LISEZMOI) ; appel dans `afterRecovery` de `src/main.tsx` ; « Tout supprimer » vide aussi `journaux/`. Tests `setAsideJournals.test.ts`, `files.test.ts`.
- « Enregistrement interrompu à {heure} » (`formatTimeOfDay` existe) : pour une session rangée d'office, sauf si le journal contient la ligne d'« Arrêter » ; affiché sur la carte de fin et en tête de l'analyse, en mémoire seulement, comme `MotionLeftNotice`.
- Saisies écrites avant de quitter : `platform/backButton.ts` (`exitAfter`, plafond de 3 s) ; `flushBeforeExit` : `flushWrites` (déjà dans `deviceSettings.ts`), puis `settleRecordWrites` à créer dans `recordWrites.ts`, puis les brouillons, puis les écritures du stockage (`createMirroredBackend` écrit sans attendre : suivre ces écritures) ; programme Windows : `bureau/preload.ts` (`surFermeture`), `bureau/main.ts` (attente d'au plus 5 s), `platform/desktopBridge.ts` (`onDesktopClose`). Tests `backButton.test.ts`. Banc : `exe-fermeture` à adapter, `gps-perdu`, `notification`, `library`.

## C · Boutons de secours et autorisations (Gtracker 387, 408, 419, 420, 433, 518, 530)

- Nouveau `recording/recordingRetry.ts` (ce que la page propose pour la ceinture et le GPS), avec son test.
- `platform/heartRate.ts` : `retryBelt` ; `HeartRatePlugin.java` : `retryNow`, une recherche à la fois, 6 s au moins entre deux.
- `useRecorder.ts` : états `beltAside` et `beltRetrying`, `retakeRecordingBelt`, `retryRecordingBelt`, événements de ceinture au journal.
- GPS : `GnssPlugin.java` recharge les données d'aide (heure, puis éphémérides), permission `ACCESS_LOCATION_EXTRA_COMMANDS` au manifeste ; `platform/location.ts` dit lui-même la cause « localisation coupée » (aujourd'hui la page compare le texte du message, `isLocationDisabled`, ligne 79) ; `platform/permissions.ts` et `PermissionsPlugin.java` ouvrent le réglage de la localisation.
- `RecordingPage.tsx` : boutons sous l'alerte rouge et dans « En cours » ; au repos, alerte rouge de batterie restreinte avec « Autoriser » ; « Aucune ceinture choisie » en rouge seulement si la case est cochée, case jamais grisée.
- Lien `/parametres?bloc=capteurs` : `core/parentPage.ts` et `SettingsPage.tsx` ouvrent le bloc Capteurs et y défilent ; le retour ramène à Enregistrer.
- `PermissionsStatus.tsx` : ligne « Démarrage automatique » sur Xiaomi, Redmi et POCO seulement (marque lue côté Java), aucun état lu ; « Tout autoriser » ouvre son écran une fois par appareil, après la batterie.
- Tests : `recordingRetry.test.ts`, `heartRate.test.ts`, `useRecorder.test.ts`, `parentPage.test.ts`, `permissionsPrompt.test.ts`, `nativeConstants.test.ts`. Banc : `gps-perdu`, `cardio`, `reglages`.

## D · Calage du GPS au départ (Gtracker 417)

- D1, sans la carte : nouveau `recording/gpsSettle.ts`, seuils 10 m et 10 s passés en paramètres et tirés du profil d'enregistrement (règle 3), jugés au temps, jamais au nombre de points (règle 10) ; dans `useRecorder.ts` : `stillSettling` dans `receiveFix`, `settlingFix` lu par `getLivePosition`, état `settlingAccuracyM` ; sur la page : « le GPS se cale (± N m) ». Test `gpsSettle.test.ts` sur un départ décalé de 22 m. Banc : `carte-direct`, `trace-suivie`.
- D2, après le lot 225 : le cercle d'incertitude dans `src/components/LiveMap.tsx`, style stable (règle 11).

## Déjà là, à ne pas refaire

« Arrêter de chercher » (`stopRecordingBeltSearch`) ; « Réessayer » et « Annuler la recherche » avant le départ (`useBeltWarmup`) ; `OPEN_GUARD_MS` en mode perte ; `setJournalAside` ; l'option `safe` de `createListeners` (positions et pauses en profitent déjà) ; `flushWrites` sur `pagehide` ; `formatTimeOfDay` ; `MotionLeftNotice` ; `openAutostart` et la lecture de la batterie ; la carte « Session interrompue récupérée et rangée ».

## Tranché par l'orchestrateur le 25/11

L'utilisateur a demandé « tout Enregistrement : défauts corrigés là-bas, pas ici » (points 1 à 7), d'après Gtracker où ces règles ont été réglées avec lui.
- Calage du GPS : fait, avec les valeurs de Gtracker (10 m ou 10 s), dans le profil d'enregistrement ; la phrase de DECISIONS §6 (« brut, sans autre filtre que les redélivrances et la pause ») se réécrit à la passe de doc.
- Démarrage automatique : Xiaomi, Redmi et POCO seulement, aucun état lu (Gtracker a retiré la lecture au lot 419 : elle disait « désactivé » sur le téléphone de l'utilisateur alors que le réglage était activé). Corrige la réponse par défaut de la fiche.
- « Enregistrement interrompu à … » : sur la carte de fin et en tête de l'analyse, en mémoire seulement.
- « Arrêter de chercher » devient réversible (« Reprendre la ceinture »), donc sa confirmation (lot 198) part.
- Rechargement automatique du programme Windows après une chute : hors lot. Sous-dossier : `journaux`, vidé aussi par « Tout supprimer ».

## Non vérifié par le plan

Le détail Java de 3f69121 (`GnssPlugin`), 408, 419 et a508f2e (lot 420) ; 7cb00f8 (diff de `LiveMap.tsx`) ; la cadence à travers un long trou ; l'écriture des brouillons de session (`useSessionDraft`) ; le chemin de fermeture de `bureau/main.ts` ; la façon dont `SettingsPage` ouvre un bloc.

## Essais au téléphone (peu)

1. Sortie avec ceinture et cadence (ou sauts), application fermée de force, puis « Continuer » : la FC revient, la capture continue ; ceinture éteinte : alerte après 1 min.
2. « Réessayer » du GPS et de la ceinture, « Activer la localisation », alerte batterie.
3. Départ à froid : cercle et texte du calage.
4. Taille du texte changée pendant un enregistrement.
