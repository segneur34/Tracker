# 06 · Enregistrement, plateforme, mémoire

Audit en lecture seule, 28/10/2026. Zone : `src/recording/` (18 fichiers hors tests, 4 044 lignes), `src/platform/` (17, 2 685), `src/library/` (13, 3 238). Tous les fichiers hors tests ont été lus en entier. Les tests ont été parcourus en diagonale. Pour juger les appelants, on a aussi lu des passages de `hooks/useSessionLibrary.ts`, `hooks/useRecorder.ts`, `hooks/useLiveRecording.ts`, `hooks/useGpxSession.ts` et `MemoryFolderPlugin.java`. Les numéros de ligne sont ceux du dépôt au commit 86b3f8d.

## Carte

| Fichier | Lignes | Rôle | Appelants principaux (hors tests) | Testé |
|---|---|---|---|---|
| recording/beepSound.ts | 27 | hauteur des bips (réglage) | useSportSettings, SettingsPage | non |
| recording/fitnessTest.ts | 665 | test guidé FC max : protocole, état, guidage, lecture de la fiche, plan | 14 fichiers (FitnessTest*, useFitnessTest, useRecorder, useSessionLibrary, record, summary…) | oui |
| recording/followedTrace.ts | 329 | trace suivie, avancement, amincissement | useFollowedTrace, useLiveRecording, useGoOnRoute, RecordingPage, FollowTracePicker | oui |
| recording/gpxWriter.ts | 94 | écriture GPX (positions, FC seule) | useRecorder, planning/routeGpx (escapeXml) | oui |
| recording/heading.ts | 56 | cap de la flèche en direct | LiveMap, RecordingPage, recordingNotification | oui |
| recording/heartRate.ts | 13 | FC jointe à une position | useRecorder | oui |
| recording/intervalTimer.ts | 662 | compteur d'intervalles : séances, phases, sons, tours, lecture | 21 fichiers | oui |
| recording/journal.ts | 274 | journal JSONL : lignes, relecture | useRecorder | oui |
| recording/jumpSettings.ts | 65 | réglages des sauts | activityPresets, useSportSettings, RecordingPage, SettingsPage, platform/motion | oui |
| recording/liveFields.ts | 314 | catalogue, libellés et valeurs des chiffres du direct | RecordingPage, SettingsPage, useSportSettings, liveNotification… | oui |
| recording/liveLegs.ts | 203 | bords de voile en direct | liveStats, RecordingPage | oui |
| recording/liveNotification.ts | 85 | texte de la notification | hooks/recordingNotification | oui |
| recording/liveStats.ts | 487 | statistiques du direct, avec mémoire par segment | useLiveRecording, RecordingPage, liveFields | oui |
| recording/markGuide.ts | 252 | guidage vers les balises (pur) | useMarkGuide, LiveMap, BeepCurveEditor… (12) | oui |
| recording/permissionsPrompt.ts | 46 | autorisations requises (pur) | usePermissions, PermissionsStatus, RecordingPage, platform/permissions | oui |
| recording/restingHrTest.ts | 141 | test de FC repos | useRestingHrTest, RestingHrTestPage, RecordingPage, running/restingHrResults | oui |
| recording/session.ts | 235 | arrondi, segments, pause auto, statistiques d'enregistrement, noms | useRecorder, useSessionLibrary, library/record, library/naming… | oui |
| recording/stopwatch.ts | 96 | chronomètre libre | IntervalCard, useStopwatch | oui |
| platform/backButton.ts | 70 | retour Android | AppShell, AnalysisMap, ActivitySelect… (8) | oui |
| platform/base64.ts | 34 | octets vers base64 et retour | memoryFolder, share, tileCache, library/sessionBundle | oui |
| platform/beeper.ts | 247 | bips, vibreur, compteur natif ou navigateur | 11 fichiers | non |
| platform/compass.ts | 27 | boussole | useCompassHeading | non |
| platform/files.ts | 147 | journal privé, téléchargements, fichiers choisis | 10 fichiers | non |
| platform/heartRate.ts | 290 | ceinture BLE, connexion partagée | 13 fichiers | non |
| platform/location.ts | 373 | GPS natif, navigateur, rejeu, position ponctuelle, satellites | 13 fichiers | oui |
| platform/memoryFolder.ts | 610 | dossier mémoire (OPFS, dossier choisi, SAF), import d'un dossier, dossier privé | useSessionLibrary, library/reconcile, platform/motion | oui (partiel) |
| platform/motion.ts | 141 | capteurs IMU | useRecorder, RecordingPage | non |
| platform/notification.ts | 73 | notification de l'enregistrement | recordingNotification, recording/liveNotification (type) | non |
| platform/permissions.ts | 115 | autorisations | usePermissions, PermissionsStatus | non |
| platform/runtime.ts | 8 | `isNativeApp` | 22 fichiers | non |
| platform/screen.ts | 137 | écran allumé, orientation, thème système | AppShell, useTheme, useRestingHrTest, RecordingPage | non |
| platform/share.ts | 44 | partage de fichier | ShareDialog | non |
| platform/storage.ts | 171 | `jsonStore` (localStorage ou Preferences) | 19 fichiers | oui |
| platform/systemBars.ts | 17 | icônes des barres système | useTheme | non |
| platform/tileCache.ts | 181 | tuiles hors ligne | mapTiles, useTileCache | non |
| library/activityChart.ts | 290 | graphe d'activités, semaines ISO | ActivityChart, stats, ProfilePage, useNow | oui |
| library/folderLayout.ts | 71 | disposition du dossier, LISEZMOI | useSessionLibrary, useRouteLibrary, reconcile, PlanningPage | non |
| library/naming.ts | 90 | nom unique, nom de téléchargement, support deviné | useSessionLibrary, SessionNameEditor, shareStats, PlanningPage | oui |
| library/profile.ts | 49 | répartition par activité, sport préféré | ProfilePage, useFavoriteBackdrop | oui |
| library/reconcile.ts | 91 | plan de rapprochement dossier ↔ cache | useSessionLibrary | oui |
| library/record.ts | 851 | fiche : types, lecture défensive, patch, cache allégé, dédoublonnage | 18 fichiers | oui |
| library/rootGrowth.ts | 137 | racine du Profil | ProfileRoot, useProfileRoot, useRunnerProfile, SettingsPage | oui |
| library/sessionBundle.ts | 166 | GPX complet (fiche et .imu en extension) | useSessionLibrary, SessionNameEditor | oui |
| library/sessionEdits.ts | 200 | brouillon des saisies, fusion à trois, patch | useSessionDraft, SessionNotesPanel | oui |
| library/settingsFile.ts | 234 | fichiers de réglages par appareil | useSessionLibrary, SettingsFiles | oui |
| library/shareStats.ts | 96 | chiffres de l'image de partage depuis le résumé | SavedSessionShare, SessionNameEditor | oui |
| library/stats.ts | 713 | statistiques : totaux, graphique, régularité, records, cardio | StatisticsPage, ProfilePage, useVisibleStatSessions, useProfileRoot, profile | oui |
| library/summary.ts | 250 | résumé d'une session (pipeline des modules) | useSessionLibrary, components/sessionTrack | oui |

## Infractions à la règle 12

**Aucune.** On a cherché dans tout `src/` hors `platform/` : `localStorage`, `sessionStorage`, `Filesystem`, `showDirectoryPicker`, `navigator.geolocation`, `AudioContext`, `navigator.vibrate`, `wakeLock`, `screen.orientation`, `DeviceMotionEvent`, `Capacitor`, `@capacitor`, `@capgo`, `registerPlugin`, `Preferences`, `BleClient`, `indexedDB`, `caches`, `navigator.share`, `clipboard`, `createWritable`, `getCurrentPosition` et `watchPosition`. Rien hors de `platform/`, sauf la déclaration de type `src/env.d.ts:25`, qui n'est pas un accès.

Trois cas limites, hors de la liste de la règle, à trancher seulement si on l'élargit :

| fichier:ligne | API en direct | pièce de platform/ possible |
|---|---|---|
| components/mapTiles.ts:13 | `navigator.onLine` | une fonction `isOnline()` dans `platform/tileCache.ts` ou dans un nouveau `platform/network.ts` |
| hooks/useNow.ts:31, hooks/useSessionLibrary.ts:1267-1270 | `document` `visibilitychange` et `window` `pagehide` (cycle de vie de l'application) | `platform/permissions.ts` a déjà `onAppResume` : un `onAppHidden` à côté, dans un `platform/lifecycle.ts` |
| components/BaseTileLayer.tsx:55, ShareDialog.tsx:92 | `URL.createObjectURL` | rien : c'est du DOM pur, hors règle |

## A. Doublons

Classés par importance décroissante.

### A1. Champs des saisies d'analyse écrits six fois
- Copies : `library/record.ts:187-238` (interface `SessionAnalysis`) et `:450-466` (`readAnalysis`) ; `library/sessionEdits.ts:13-37` (interface `SessionEdits`), `:60-73` (`savedEdits`), `:80-95` (`EditedPart`, `EDITED_PART_LABEL`), `:107-121` (`changedParts`), `:124-136` (`SAME`), `:184-197` (`editsPatch`). Le champ `pumping`, ajouté au lot 22, a dû être posé à chacun de ces endroits.
- Identique ou différent : même liste de champs et même ordre ; seules les règles de validation diffèrent d'un champ à l'autre.
- Pièce unique proposée : une table `ANALYSIS_FIELDS` dans `library/record.ts`, de forme `{ key: keyof SessionAnalysis; read: (raw: unknown) => T | null; same?: (a: T, b: T) => boolean; part: EditedPart }[]`. `readAnalysis`, `savedEdits`, `SAME`, `changedParts` et `editsPatch` se déduiraient de la table, avec un seul `SessionEdits = Pick<SessionAnalysis, …> & { notes; marks }`.
- Risque : moyen. Les tests de `record.test.ts` et `sessionEdits.test.ts` couvrent bien ce code, mais `changedParts` regroupe `bikeWeightKg` et `loadKg` sous une seule partie, `charge`, et ce cas doit rester possible.
- Taille : gros. Confiance : sûr.

### A2. Options de cinématique tirées du profil, écrites quatre fois
- Copies : `library/summary.ts:73-90` (`analysisTrack`) ; `pages/LandModule.tsx:269-274`, `pages/SurfModule.tsx:171-173` et `hooks/useSailingSession.ts:73-80`, qui passent les mêmes champs du profil à `useGpxSession`, lequel les met en forme une seconde fois (`hooks/useGpxSession.ts:74-87`).
- Identique ou différent : identique aujourd'hui (`sessionFilterThresholds` à l'échelle de la session en voile ; ailleurs `maxSpeedMs` du profil, sans `maxAcceleration`).
- Pièce unique proposée : `kinematicsOptionsOf(profile: SportProfile, opts: { scaleToSession: boolean; referenceMs: number }): KinematicsOptions` dans `core/sessionSpeed.ts`, appelée par `analysisTrack` et par `useGpxSession`.
- Risque : la liste et l'analyse ne donnent plus les mêmes chiffres si l'une des copies change sans l'autre. Le résumé « reprend celui du module », mais rien ne le garantit.
- Taille : petit. Confiance : sûr.

### A3. FC jugée utilisable, écrite cinq fois
- Copies : `recording/heartRate.ts:10-11`, `recording/session.ts:35`, `hooks/useRecorder.ts:557`, `hooks/useBeltLive.ts:6`, `hooks/useRestingHrTest.ts:48`. Chaque copie teste `contact === false || !(bpm > 0)`.
- Identique ou différent : même test ; certaines copies arrondissent, d'autres non.
- Pièce unique proposée : `usableBpm(sample: HeartRateSample | null): number | null` dans `recording/heartRate.ts`.
- Risque : faible. Taille : petit. Confiance : sûr.

### A4. Accès au dossier privé de l'application en trois endroits
- Copies : `platform/files.ts:46-73` (`createPrivateFile`) ; `platform/memoryFolder.ts:516-544` (`readPrivateBytes`, `privateFileSize`, `removePrivateFile`) et `:551-604` (`createPrivateFolder`) ; `platform/tileCache.ts:49-125`. On compte 18 `await filesystem()` et 20 `Directory.Data`. Les blocs `try { deleteFile } catch {}` sont identiques en `files.ts:65-72`, `memoryFolder.ts:537-544` et `:595-602`.
- Pièce unique proposée : `platform/privateFiles.ts`, avec `readText`, `writeText`, `appendText`, `readBytes`, `writeBytes`, `stat`, `remove`, `list`, `mkdir`, tous par chemin relatif à `Directory.Data`. `files.ts`, `memoryFolder.ts` (dossier `en-attente/`), `motion.ts` et `tileCache.ts` s'appuieraient dessus.
- Risque : faible, mais ce code ne tourne que sur le téléphone : l'essai passe par l'APK.
- Taille : petit à moyen. Confiance : sûr.

### A5. Sons du compteur décrits deux fois (types et durées)
- Copies : `recording/intervalTimer.ts:78-81` (`IntervalToneKind`, `INTERVAL_TONE_MS`) et `:460-477` (`IntervalTone`, `IntervalPhaseCue`, `IntervalSchedule`) ; `platform/beeper.ts:37-56` (`ClockTone`, `ClockCue`, `ClockPlan`) et `:170` (`TONE_DURATION_MS`, la même table). Par ailleurs, `RESTING_SIGNAL_TONES` (`recording/restingHrTest.ts:125-128`) recopie `TEST_SIGNAL_TONES.debut` et `.finTest` (`recording/fitnessTest.ts:589-597`), ce que le commentaire annonce (« les mêmes sons »).
- Identique ou différent : identique, champ pour champ.
- Pièce unique proposée : les types et la table dans `core/beepDurations.ts`, qui porte déjà les durées, puis importés de part et d'autre. `RESTING_SIGNAL_TONES` prendrait directement les valeurs de `TEST_SIGNAL_TONES`.
- Risque : nul (types seulement). Taille : petit. Confiance : sûr.

### A6. Deux journaux de commandes datées (chronomètre et compteur)
- Copies : `recording/stopwatch.ts:70-90` (`stopwatchCommand`, `readStopwatch`) et `recording/intervalTimer.ts:404-411` et `:649-662` (`runCommand`, `readIntervalRun`). Le filtrage `commands.filter(kind ∈ kinds && atMs fini)` est recopié tel quel.
- Pièce unique proposée : `readCommands<K>(raw: unknown, kinds: readonly K[]): { kind: K; atMs: number }[]` dans `core/basics.ts`. Les deux déroulés (`walk`, `stopwatchState`) restent séparés, car leurs règles diffèrent.
- Risque : faible. Taille : petit. Confiance : sûr.

### A7. Dates locales et calendrier
- Copies :
  - `pad` et dates `AAAA-MM-JJ` : `recording/session.ts:218-235` (`sessionFileName`, `sessionTitle`), `library/naming.ts:32-45` (`downloadBaseName`), `core/units.ts:193`, `:223` et `:232` (trois `pad` locaux), `components/heartRateOrigin.ts:9`.
  - `shortDate` : `library/activityChart.ts:105-106` et `library/stats.ts:449`, identiques, plus `pages/StatisticsPage.tsx:128`.
  - `DAY_MS` : `activityChart.ts:66`, `stats.ts:590`, `rootGrowth.ts:68`.
  - `startOfMonth` et `addMonths` dans `stats.ts:451-459`, à côté de `startOfDay` et `addDays` d'`activityChart.ts:77-86`.
  - Piles par activité et rang : `activityChart.ts:267-279` et `stats.ts:461-465` et `:479-481`.
- Pièce unique proposée : `formatLocalDate(ms)` (`AAAA-MM-JJ`) et un seul `pad` dans `core/units.ts` ; un `core/calendar.ts` qui regroupe `startOfDay`, `addDays`, `startOfIsoWeek`, `isoWeek`, `startOfMonth`, `addMonths`, `DAY_MS`, `shortDate` et `stacksByActivity(sessions, order)`.
- Risque : faible (tests présents). Taille : petit. Confiance : sûr.

### A8. Échappement XML et en-tête GPX
- Copies : `recording/gpxWriter.ts:28-29` (échappe aussi `"`) et `library/sessionBundle.ts:23-24` (n'échappe pas `"`). L'en-tête `<?xml…><gpx…><metadata>` est écrit dans `gpxWriter.ts:75-94` et dans `planning/routeGpx.ts:39-45`. Les `<wpt>` sont écrits dans `sessionBundle.ts:55-58` et dans `routeGpx.ts:33-35`.
- Identique ou différent : **différent**. Le paquet doit refaire à l'identique le texte retouché (`undoEdits`, `sessionBundle.ts:146`). Échapper `"` dans le paquet changerait le texte des paquets à venir, et un paquet ancien dont le nom contient un `"` ne se déferait plus : son GPX serait alors gardé tel que reçu.
- Pièce unique proposée : `core/xml.ts` avec `escapeXmlText` (sans guillemets) et `escapeXmlAttr` (avec), et `gpxDocument(meta, body)` partagé par l'enregistreur et les itinéraires. `sessionBundle` garde `escapeXmlText`.
- Risque : moyen pour le paquet ; faible ailleurs. Taille : petit. Confiance : sûr.

### A9. `LatLon` déclaré cinq fois
- Copies : `recording/followedTrace.ts:17`, `recording/markGuide.ts:22` (exporté), `core/geoPlane.ts:11`, `core/simplify.ts:13`, `planning/ignAltimetry.ts:36`.
- Pièce unique proposée : `export interface LatLon` dans `core/types.ts`. Risque : nul. Taille : petit. Confiance : sûr.

### A10. Petites aides de lecture recopiées
- `JSON.parse` protégé par `try` : `library/record.ts:549-554`, `library/settingsFile.ts:55-60`, `planning/routeRecord.ts:143`, `recording/journal.ts:135-141`.
- « Nombre fini, sinon null ou undefined » : `journal.ts:132` (`optionalNumber`), `platform/location.ts:64` (`optional`), `recording/fitnessTest.ts:235` (`numOrNull`), `library/record.ts:144` (`orNull`). `core/basics.isFiniteNumber` existe déjà.
- `inRange` : `intervalTimer.ts:96` (entiers) et `fitnessTest.ts:124` (réels avec tolérance). Les deux diffèrent.
- Pièce unique proposée : `parseJson(text): unknown | undefined` et `finiteOr<T>(v, fallback: T)` dans `core/basics.ts`. Risque : nul. Taille : petit. Confiance : sûr.

### A11. Libellé « 5 min » écrit deux fois
- Copies : `recording/liveFields.ts:159` et `pages/RecordingPage.tsx:139`, identiques (`recentWindowLabel`). Les tops de `RecordingPage.tsx:206` relisent eux aussi `LIVE_STATS_DEFAULTS` au lieu des options réellement passées.
- Pièce unique proposée : exporter `recentWindowLabel` de `liveFields.ts`. Risque : nul. Taille : petit. Confiance : sûr.

### A12. Recopies internes à `memoryFolder.ts`
- `entryNames` (`:244-248`) est réécrit dans `resolveMemoryRoot` (`:263-264`). La construction du chemin `full` est recopiée (`:315` et `:412`), de même que la lecture base64 vers octets (`:324-327` et `:420-423`).
- Pièce unique proposée : réutiliser `entryNames`, et une fonction `deviceFile(uri, base)` qui rend `{ full, readBytes, readText }`. Risque : nul. Taille : petit. Confiance : sûr.

### A13. Bascule navigateur ou téléphone : une fabrique unique ?
- Constat : 53 appels à `isNativeApp()` dans 14 fichiers de `platform/`. Deux motifs coexistent :
  - l'implémentation est choisie une fois : `files.ts:76`, `tileCache.ts:181`, `beeper.ts:205` et `:244`, `location.ts:225` ;
  - la garde est répétée dans chaque fonction : `heartRate.ts` (10), `motion.ts` (8), `memoryFolder.ts` (7), `permissions.ts` (5).
- Avis : une fabrique générique ne gagnerait presque rien, car les replis navigateur diffèrent tous (rien, une valeur, une exception, un `console.debug`). Il vaut mieux étendre le premier motif (un objet natif et un objet navigateur, choisis une fois) à `heartRate.ts`, `motion.ts` et `permissions.ts`. Le seul bénéfice réel est un banc plus simple, qui pourrait injecter l'objet navigateur.
- Risque : faible. Taille : petit. Confiance : probable.

## B. Optimisations

### B1. Fiches JSON indentées : taille multipliée par 2,15
- Lieux : `library/record.ts:597` (`JSON.stringify(record, null, 2)`), `library/settingsFile.ts:84`. L'indentation met chaque nombre des tableaux sur sa ligne : altitude du terrain (`t`, `z`), histogramme de FC, courbes des sauts, voies.
- Mesure faite sur une fiche synthétique (2 000 échantillons d'altitude et un histogramme de 150 cases) : 55 558 octets indentés contre 25 802 compacts, soit ×2,15. Cette taille compte à chaque écriture SAF (texte passé par le pont), dans le paquet GPX (`sessionBundle.ts:120`, échappé puis embarqué) et à la relecture des fiches au lancement.
- Proposition : garder l'indentation des objets mais écrire les tableaux de nombres sur une ligne (un `replacer` ou une sérialisation maison). Les deux formes se relisent pareil.
- Gain attendu : environ deux fois moins d'octets pour les fiches de course et de vélo à altitude IGN.
- Comment le mesurer : taille totale de `sessions/*.json` avant et après sur une copie du dossier ; durée de `writeRecordNow` au téléphone.
- Taille : petit. Confiance : sûr (voir la question F1).

### B2. Une publication de toute la liste par session touchée
- Lieux : `hooks/useSessionLibrary.ts:236-239` (`publish` → `dedupeSessions`, qui trie toute la liste deux fois), `:257-261` (`replaceSession` : filtrage de toute la liste puis `publish`) et `:1016-1032` (`runJob` : `hydrateSession` puis `replaceSession`, soit deux publications par fiche recalculée).
- Effet : après une hausse de `SUMMARY_CALC_VERSION`, toutes les fiches sont recalculées, ce qui fait 2N tris de N sessions et 2N rendus des pages abonnées.
- Proposition : regrouper les publications (une par micro-tâche, ou une toutes les 250 ms pendant un balayage, comme le compteur `SCAN_PROGRESS_INTERVAL_MS`) et tenir une `Map` par `startMs` au lieu de tout retrier.
- Comment le mesurer : banc avec 200 sessions synthétiques et un résumé périmé ; compter les `setState`, puis mesurer la durée du balayage et le temps des images.
- Taille : moyen. Confiance : sûr.

### B3. Listage du dossier dans le navigateur : un `getFile()` après l'autre
- Lieu : `platform/memoryFolder.ts:129-137`. Chaque fichier de `sessions/` (GPX, fiche, `.imu`) est ouvert l'un après l'autre pour lire sa taille et sa date, à chaque ouverture et à chaque `refreshCache`.
- Contexte : c'est ce que voit l'utilisateur sur le PC (Firefox, mémoire du navigateur).
- Proposition : `Promise.all` par lots de 32.
- Comment le mesurer : durée de `list('sessions')` avec 1 500 fichiers dans l'OPFS.
- Taille : petit. Confiance : sûr.

### B4. Liste des tuiles du navigateur : un `cache.match` par tuile
- Lieu : `platform/tileCache.ts:153-167`. Avec un plafond de 500 Mo, il peut y avoir des dizaines de milliers de tuiles, lues une à une.
- Proposition : des lectures en parallèle par lots, ou un index (clé, octets, date) tenu à part comme sur le téléphone (`nativeIndex`).
- Comment le mesurer : durée de `tileStore.list()` avec 10 000 tuiles dans Firefox.
- Taille : petit. Confiance : sûr.

### B5. Cache des fiches relu et récrit en entier après chaque suppression ou import
- Lieux : `hooks/useSessionLibrary.ts:288-301` (`refreshCache` : relistage de `sessions/`, puis `jsonStore.write` de toutes les fiches allégées), appelé en `:1085`, `:1574` (fin d'un import) et `:1755` (chaque suppression).
- Effet : sur le téléphone, chaque suppression relance une liste SAF et une écriture Preferences de plusieurs centaines de Ko.
- Proposition : une écriture différée (une seconde, comme les fiches) et une mise à jour de la seule entrée concernée.
- Comment le mesurer : taille de `tracker.libraryCache` et nombre d'écritures pendant la suppression de cinq sessions.
- Taille : petit. Confiance : sûr.

### B6. Choix retenus rangés dans `tracker.sportSettings`
- Lieux : `library/settingsFile.ts:197-209` (`REMEMBERED_CHOICES` : `moduleActivity`, `recordActivity`, `lastIntervalWorkout`, `lastTimerWorkout`) et `hooks/useSessionLibrary.ts:1249-1258`.
- Effet : ouvrir une session d'une autre activité récrit tout `StoredSettings` (plusieurs dizaines de Ko, recopié dans Preferences). Le magasin recalcule alors deux `JSON.stringify` des valeurs qui voyagent (`settingsSignature`, avec la photo du Profil en data URL), seulement pour constater que rien n'a changé.
- Proposition : une clé à part, `tracker.choix`, propre à l'appareil, avec une migration au premier lancement. `settingsSignature` et `adoptedValues` n'auraient plus rien à filtrer.
- Comment le mesurer : compter les écritures de `tracker.sportSettings` pendant la navigation entre dix sessions.
- Taille : moyen (migration). Confiance : sûr.

### B7. Résumé du surf : cinématique faite deux fois à l'import
- Lieux : `hooks/useSessionLibrary.ts:1330` (`surfRides` → `analysisTrack`, `library/summary.ts:106`) et `:403` (`summarizeSession` → `analysisTrack` de nouveau). `buildCumulativeTrack` est calculé deux fois (`summary.ts:142` et `:181`).
- Proposition : `summarizeSession` rend aussi les glisses (`rides`), ou accepte une trace déjà calculée.
- Comment le mesurer : durée de l'import d'une session de surf de deux heures.
- Taille : petit. Confiance : sûr.

### B8. Direct : segment en cours recalculé en entier
- Lieux : `recording/liveStats.ts:363-382` et `:275-284`. À chaque calcul (limité par `PAGE_REFRESH_MS`), le segment ouvert refait `buildCumulativeTrack`, `heartPart`, `bestTopOf`, `splitLiveLegs`, `computeElevationStats` et l'énergie. `bestRecentTop` refait en plus `filter` puis `buildCumulativeTrack` pour chaque durée de top (deux en voile).
- Coût : O(n) par calcul, borné par la fréquence de rafraîchissement ; il ne pèse qu'après 3 h sans pause.
- Comment le mesurer : chronométrer `computeLiveStats` sur 10 800 points à 1 Hz, avec et sans mémoire (le test d'équivalence existe).
- Taille : moyen. Confiance : probable (gain modeste).

### B9. Petits recalculs
- `recording/intervalTimer.ts:452-457` : `intervalStepAt` déroule deux fois les phases.
- `platform/storage.ts:158-161` : une lecture Preferences par clé au démarrage (une vingtaine), sans conséquence.
- Taille : petit. Confiance : sûr. Priorité : la plus basse.

## C. Architecture

1. **Règle 12 : respectée** (voir plus haut). Le seul accès « hors liste » à prévoir est le cycle de vie (`visibilitychange`, `pagehide`).
2. **Responsabilités mêlées dans `platform/memoryFolder.ts`.** Le fichier tient le dossier mémoire, l'import d'un dossier (`pickFolderToImport`, `:406-426`) et les fichiers privés de l'application (`readPrivateBytes`, `privateFileSize`, `removePrivateFile`, `createPrivateFolder`, `:516-610`). `platform/motion.ts:4` importe ses fichiers privés depuis `memoryFolder.ts`. Proposition : `platform/privateFiles.ts` (A4) et `platform/folderImport.ts`.
3. **`platform/` dépend du domaine** : `platform/permissions.ts:2` importe des types de `recording/permissionsPrompt`, `platform/motion.ts:3` importe `JumpPlacement` de `recording/jumpSettings`, `platform/screen.ts:2` importe `theme/theme`. Proposition : ces types et constantes vont dans `platform/` ou dans `core/`, pour que `platform/` ne dépende que de `core/`.
4. **`isSportType` est mal placé** : `recording/session.ts:215`, importé par `library/record.ts:13` et `library/naming.ts:2`. Sa place est `core/sportProfiles.ts`.
5. **De la logique pure de la bibliothèque vit dans un hook de 1 973 lignes** : `summaryOptions` (`hooks/useSessionLibrary.ts:353`), `analyzeGpx` (`:391`), `newRecord` (`:417`) et `withSummary` (`:434`) sont des fonctions pures de `library/`, sans test direct. Proposition : `library/summaryOptions.ts`, l'activité étant passée en paramètre plutôt que lue par `readStoredActivities()`.
6. **Règle 3 : seuils en dur dans `recording/`.** Ils sont passés en paramètre avec une valeur par défaut, mais ne viennent pas de `SPORT_PROFILES` et ne sont ni réglables ni persistés :
   - `heading.ts:18-21` : 0,8 m/s et 5 m, les mêmes en voile et à pied ;
   - `followedTrace.ts:76` (2 m) et `:102-106` (écart de 60 m, recul de 30 m, avance de 100 m, les mêmes à pied et en voile) ;
   - `liveLegs.ts:41-44` : cohérence 0,97, 10°, 2 s ;
   - `liveStats.ts:57-65` : fenêtres du direct ;
   - `session.ts:40` : facteur 0,75 ;
   - le support par défaut `'wingfoil'` d'un journal sans en-tête, `hooks/useRecorder.ts:526`.

   Voir la question F3.
7. **Règle 1 (au sens large)** : `LiveStats.climbRateMh` est en m/h dans un calcul (`recording/liveStats.ts:96` et `:480`). La conversion devrait se faire à l'affichage, dans `liveFields`. La règle 1 ne vise que `core/` : écart mineur.
8. **Libellés du direct tirés des défauts** : `liveFields.ts:159-160`, `:168-169`, `:184` et `:187`, et `RecordingPage.tsx:139` et `:206`, lisent `LIVE_STATS_DEFAULTS` et non les options passées à `computeLiveStats`. Si on change un jour une option par activité, le libellé ne la suivra pas. Proposition : passer les options effectives dans `LiveFieldContext`.
9. **`recording/beepSound.ts`** est un réglage d'interface (Réglages, `useSportSettings`) et non de l'enregistrement : `core/` ou `hooks/` conviendraient mieux. Mineur.

## D. Bugs probables

### D1. Une version plus ancienne qui récrit une fiche perd ou déforme des champs connus
- Scénario : le téléphone (version récente) écrit une fiche dont un champ connu a changé de forme sans hausse de `RECORD_VERSION`, qui reste à 1. Sur le PC, une version plus ancienne relit la fiche, l'utilisateur renomme la session, la fiche est récrite. Le champ est alors perdu ou normalisé :
  - `readSessionSurfaces`, `readTerrainElevation`, `readSessionJumps`, `readIntervalSeries`, `readSessionMarks` et `readSessionTest` rendent `null` et le champ disparaît (`library/record.ts:558-587`) ;
  - `readSummary` supprime `maneuverResults`, `heartRate`, `cadence` ou `test` mal formés (`:378-396`) ;
  - `readSessionTest` ramène un `zoneMethod` inconnu à `'max'` (`recording/fitnessTest.ts:259`) ;
  - `readAnalysis` ramène à `null` une valeur d'un type nouveau (`record.ts:452-465`).

  La promesse « les champs inconnus sont conservés à la réécriture » ne vaut que pour les clés inconnues, pas pour les clés connues de forme nouvelle.
- Proposition : garder le brut de tout champ connu jugé mal formé et le réécrire tel quel, ou bien poser la règle qu'un changement de forme augmente `RECORD_VERSION`, auquel cas la fiche n'est plus réécrite (`isWritableRecord`).
- Confiance : probable (le mécanisme est sûr ; il faut deux versions en circulation, ce qui est le cas courant téléphone et PC).

### D2. Résumés figés quand le seuil ou le foil d'une activité change dans Réglages
- Scénario : l'utilisateur change le seuil d'activité de « Wingfoil » dans Réglages. Les analyses suivent, mais la bibliothèque, l'accueil et les Statistiques gardent le temps en action, la distance active et le ratio de vol calculés avec l'ancien seuil. En effet, `summaryOptions` lit les réglages de l'activité au moment du calcul (`hooks/useSessionLibrary.ts:353-375`), mais seuls `isSummaryStale` (`calcVersion`, `library/record.ts:636`) et un changement de la fiche (`applyRecordPatch`, `:844-850`) relancent un calcul. `SettingsPage` n'appelle rien de la bibliothèque, et aucune fonction exportée de `useSessionLibrary` ne recalcule sur un changement de réglage.
- Confiance : probable (aucun mécanisme trouvé). Voir F2.

### D3. Échec de `initStorage` : l'application tourne sur `localStorage` sans le dire
- Scénario : au démarrage sur le téléphone, une lecture `Preferences.get` échoue (`platform/storage.ts:159-161` : un seul rejet fait échouer tout le `Promise.all`). On reste alors sur le `localStorage` de la WebView (`:168-170`), vide ou périmé.
  - Les réglages apparaissent remis au défaut.
  - `tracker.settingsSavedAt` est absent, donc l'appareil se croit neuf et reprend tout seul le fichier de réglages le plus récent du dossier, peut-être celui d'un autre appareil (`useSessionLibrary.ts:700-708`).
  - Les changements de cette session vont dans `localStorage`, et sont invisibles au lancement suivant, quand Preferences répond de nouveau.
- Proposition : lire clé par clé avec repli, ne jamais basculer en silence, et le dire dans le bandeau comme `subscribeFailure`.
- Confiance : à vérifier (l'échec est rare ; la conséquence est lourde).

### D4. Création non atomique d'un fichier neuf : fichier partiel laissé, fiche bloquée en lecture seule
- Scénario : l'application est tuée pendant l'écriture d'un GPX ou d'une fiche **neufs**.
  - Le remplacement passe bien par `.tracker-tmp`, mais une création écrit directement : `MemoryFolderPlugin.java`, `writeBytes`, branche `writeTo(create(...))`. Dans `en-attente/`, `Filesystem.writeFile` écrit aussi en place (`platform/memoryFolder.ts:579-594`).
  - Un GPX tronqué est illisible : le journal survit et la session est rangée de nouveau sous `X-2.gpx`, mais `X.gpx` reste à jamais « non rangé, illisible ».
  - Une fiche neuve tronquée est classée « Fiche illisible, laissée telle quelle » (`useSessionLibrary.ts:964-966`, `readOnly: true`) : la session ne s'enregistre plus jusqu'à ce qu'on efface le JSON à la main.
- Proposition : créer sous `nom.tracker-tmp` puis renommer, aussi pour un fichier neuf, et dans `en-attente/` passer par un temporaire puis `Filesystem.rename`.
- Confiance : probable (fenêtre étroite).

### D5. Journal sans en-tête lisible : session reprise en wingfoil
- `hooks/useRecorder.ts:526` : `activityChange?.sport ?? header?.sport ?? 'wingfoil'`. Une course reprise après un arrêt brutal dont la première ligne serait abîmée part en voile (mauvais module, résumé voile).
- Proposition : `null`, la session « à classer » demandant son activité.
- Confiance : sûr dans le code ; cas rare.

### D6. Fiche `X.JSON` jamais gardée en cache
- `hooks/useSessionLibrary.ts:296-298` cherche `recordFileName(file)` (`.json` en minuscules) dans la liste exacte du dossier, alors que `reconcile.ts:50` et `:58` rapprochent bien `X.JSON`. Une fiche en majuscules (copiée d'un autre outil) est relue à chaque lancement.
- Confiance : sûr ; effet mineur.

### D7. Bips du navigateur après « stop »
- `platform/beeper.ts:152-160` : les trois minuteries de `finished` ne sont pas gardées, et `stop()` (`:161-166`) ne les annule pas. `stop()` ferme aussi le contexte audio partagé avec le compteur (`browserAudio`), qui en rouvre un au son suivant.
- Effet : banc et navigateur seulement.
- Confiance : sûr.

### D8. Objets du magasin modifiables en production
- `platform/storage.ts:72-82` : l'objet rendu par `read` n'est gelé qu'en développement. Une modification par un appelant passe inaperçue en production : la mémoire et le stockage divergent sans écriture.
- Proposition : garder le gel en production pour les petites clés, ou un test qui balaie les appelants.
- Confiance : à vérifier (l'état du projet dit que l'appelant copie toujours).

### D9. Promesse non tenue dans `watchSatellites`
- `platform/location.ts:361-367` : un rejet d'`addListener` n'est pas rattrapé, ce qui produit une erreur non gérée dans la console.
- Confiance : sûr ; effet mineur.

## E. Code mort (vérifié par grep sur tout `src/`)

Fonctions appelées seulement par les tests :
- `recording/liveLegs.ts:202` `computeLiveLegs` : le direct passe par `splitLiveLegs` et `combineLiveLegs` (`liveStats.ts:378` et `:484`). À retirer ou à déplacer dans le test.
- `recording/followedTrace.ts:253` `followProgress` : la production utilise `createFollowCursor` (`hooks/useLiveRecording.ts:145`). Il sert d'oracle au test d'équivalence : le garder, en disant qu'il est réservé au test.

Exportés sans usage hors de leur fichier (export superflu, pas du code mort) :
- `platform/files.ts:26` `createMemoryFile`.
- `platform/memoryFolder.ts` : `MEMORY_FOLDER_NAME`, `shouldDescendIntoMemory`, `isMemorySubfolder`, `folderImportPaths` (ces trois-là testés).
- `platform/motion.ts:50` et `:53` : `MOTION_DIR`, `motionCapturePath`.
- `platform/backButton.ts:38` : `dispatchBack` (testé).
- `platform/storage.ts` : `createJsonStore`, `createMirroredBackend` (testés).
- `library/record.ts` : `readGear`, `readSessionName`, `readSessionSurfaces`, `readTerrainElevation`, `readSessionJumps`, `sameManeuverResults`, `RECORD_LIGHT_FIELDS`, `readNotes` (testé).
- `library/stats.ts` : `STATS_METRICS`, `RECORD_VALUE`, `sessionLoad` (testé).
- `library/rootGrowth.ts` : `periodStart`, `ROOT_RULES` (testés).
- `library/folderLayout.ts:25-26` : `MEMORY_FORMAT`, `MEMORY_VERSION`.
- `library/settingsFile.ts:25` : `SETTINGS_VERSION`.
- `recording/intervalTimer.ts` : `INTERVAL_TONE_MS`, `blockLabel`, `blockDurationS`, `newPresetId`, `workoutPhases`, `runLaps`, `lapsWithin`.
- `recording/restingHrTest.ts:89` : `restingEndMs`.
- `recording/jumpSettings.ts` : `isJumpPlacement`, `DEFAULT_JUMP_PLACEMENT`.
- `recording/liveFields.ts` : `DEFAULT_LIVE_FIELDS`, `DEFAULT_NOTIFICATION_FIELDS`.
- `recording/markGuide.ts` : `SIMULATED_APPROACH_MS`, `sanitizeBeepCurve`, `isLoopCourse`.
- `recording/heading.ts:18` : `HEADING_DEFAULTS`.
- `recording/followedTrace.ts:102` : `FOLLOW_DEFAULTS`.

Code de passage encore présent (à retirer une fois tous les appareils passés, voir F4) :
- l'ancien `reglages.json` à la racine (`settingsFile.ts:224-234` et `chooseSettings`, `useSessionLibrary.ts:712-723`) ;
- les notes d'avant le dossier (`tracker.sailingNotes`, `record.ts:652-664` et `useSessionLibrary.ts:429`) ;
- la lecture d'un cache des fiches non allégé (`useSessionLibrary.ts:280-285`) ;
- le champ `analysis.terrain`, plus lu mais gardé dans le JSON par décision (point 130).

## F. Questions à poser à l'utilisateur

1. **Fiches JSON** : elles sont indentées « pour rester lisibles dans un éditeur », ce qui double leur taille. Peut-on écrire les longues listes de nombres sur une seule ligne ? Réponse par défaut : oui, les objets restent indentés et seules les listes de nombres sont resserrées.
2. **Seuil ou foil d'une activité changé dans Réglages** : les chiffres des sessions déjà rangées (liste, Statistiques) doivent-ils suivre ? Réponse par défaut : oui, recalcul en fond des sessions de cette activité qui n'ont pas de seuil propre.
3. **Réglages du direct** (cap de la flèche, écart de 60 m à la trace suivie, découpe des bords) : faut-il les régler par sport, comme les seuils d'analyse ? Réponse par défaut : non, ce sont des constantes du direct, nommées et documentées.
4. **Code de passage** (ancien `reglages.json`, notes d'avant le dossier, ancien cache) : tous vos appareils sont-ils passés ? Peut-on le retirer ? Réponse par défaut : le garder jusqu'à la version 0.4.
5. **Supprimer une session** supprime aussi ses doubles (même instant de départ, fichiers différents), y compris celui qui porte des notes. Est-ce voulu ? Réponse par défaut : oui.

## G. Chiffres

- Fichiers lus en entier : 48 hors tests (recording 18, platform 17, library 13), soit 9 967 lignes. Tests parcourus : 34 fichiers, 5 862 lignes.
- Lus en appui, hors zone : passages de `hooks/useSessionLibrary.ts` (environ 700 lignes sur 1 973), `hooks/useRecorder.ts` (environ 330 sur 933), `hooks/useLiveRecording.ts` (en entier), `hooks/useGpxSession.ts` (extrait), `MemoryFolderPlugin.java` (écriture).
- Infractions à la règle 12 : 0 (3 cas limites hors de la liste de la règle).
- Constats :

| Section | Constats |
|---|---|
| A. Doublons | 13 |
| B. Optimisations | 9 |
| C. Architecture | 9 |
| D. Bugs probables | 9 (D1 à D4 à traiter en premier) |
| E. Code mort | 2 fonctions mortes hors tests, 43 exports superflus, 4 restes de passage |
| F. Questions | 5 |
