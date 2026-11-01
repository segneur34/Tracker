# 119 · Finir l'audit en lecture seule du 01/11

Brief écrit le 01/11 (paquet de 5 du 01/11 : 119, 120, 112, 114, 121). Modèle | Réflexion : Opus | high. Lecture seule : le lot ne modifie aucun fichier de `src/`, `android/` ni `outils/` ; son seul produit est son rapport, écrit à la fin de ce fichier (section « Rapport »).

## Le fait

L'audit du 01/11 (HISTORIQUE, points 251 à 255 ; lots 115 à 118 qui en sont sortis) n'a pas pu tout lire. Restent des zones non vues et trois soupçons à confirmer. Les numéros de ligne cités datent du 01/11 avant le lot 116 : chercher par nom de fonction, pas par ligne.

## À faire, dans cet ordre

1. **Trois soupçons à confirmer ou lever**, chacun avec un scénario concret (état de départ, action, résultat faux) ou la raison pour laquelle il ne tient pas :
   - `platform/storage.ts` (`jsonStore.read`, vers la ligne 87) rend le JSON stocké sans vérification de forme ; lire ses appelants (`useSessionLibrary.ts`, `useMapBase.ts`, `PlanningPage.tsx`, `memoryFolder.ts`, `ResizablePanel.tsx`, `ShareDialog.tsx`) et dire lesquels planteraient ou afficheraient faux sur une valeur d'une autre forme (ancienne version, clé écrasée) ;
   - `platform/files.ts` (lecture du journal, vers les lignes 47 à 55) rend `null` sur toute erreur de lecture comme si le fichier était absent : un gros journal illisible au lancement ne serait pas proposé à la reprise, puis écrasé par l'enregistrement suivant ; dire si c'est bien le cas, et où le journal est écrasé ;
   - `writeOwnSettings` (`hooks/useSessionLibrary.ts`) écraserait le fichier de réglages illisible d'un autre appareil qui porte le même nom ; lire comment le nom du fichier est formé (identifiant d'appareil, `library/settingsFile.ts`) et dire si deux appareils peuvent porter le même nom.
2. **Calculs purs sans test ou mal couverts**, classés par chiffre affiché à l'utilisateur (quel chiffre, quel fichier, ce qui n'est pas couvert) : parcourir `core/`, `sailing/`, `running/`, `cycling/`, `surfing/`, `recording/`, `library/` et confronter chaque fichier à son `*.test.ts` (absent, ou présent mais qui ne couvre pas la fonction qui produit le chiffre). Dix lignes au plus, les plus graves d'abord.
3. **Les 11 assertions non nulles (`!`), les 11 désactivations du lint et le `@ts-expect-error`** : pour chacun, justifié (en un mot) ou défaut (scénario).
4. **Le natif des capteurs et des sons** (`android/.../MotionPlugin`, `ImuWriter`, `TonePlayer`, `PermissionsPlugin`, `GnssPlugin`) et `platform/beeper.ts` : fuites (écouteurs, fils, fichiers non fermés), appels hors du fil principal, erreurs avalées.
5. **Le compteur d'intervalles, les tests guidés et `RecordingPage.tsx`** : `recording/intervalTimer.ts`, `recording/fitnessTest.ts`, `recording/restingHrTest.ts`, `hooks/useIntervalTimer.ts`, `hooks/useRecorder.ts` : états impossibles, transitions qui perdent une séance, minuteurs non nettoyés.
6. **La lenteur du surf** (`pages/SurfModule.tsx`, `surfing/`) : ce qui est recalculé à chaque rendu sans `useMemo`, ce qui lit les capteurs sans en avoir besoin.

## Forme du rapport

Section « Rapport » ajoutée à la fin de ce fichier, en français courant, sans jargon inutile, chaque défaut sur ce modèle : `- [bogue|dette] Titre court · fichier et fonction · scénario (départ, action, résultat) · gravité : chiffre faux | donnée perdue | usage cassé | rien de visible · petit|gros`. Les soupçons levés sont dits en une ligne chacun (« ne tient pas : … »). Rien d'autre : pas de proposition de correction détaillée, pas de code.

Lire avant : `CLAUDE.md` (règles 1 à 12), `docs/ETAT_DU_PROJET.md` §9 et §11 (limites déjà connues, à ne pas redire), `docs/DECISIONS.md` §5, §6 et §8.

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune modification hors de ce fichier. Ne pas relire ce que les lots 115 à 118 ont déjà corrigé (HISTORIQUE, points 251 à 255). Les tests ne se lancent pas : rien n'a changé.

## Rapport

Lu le 01/11 sur le code commité (b8b2288), sans rien lancer. 9 défauts confirmés (4 bogues, 5 dettes), 7 soupçons levés.

### 1. Les trois soupçons

- [bogue] Journal de l'enregistrement illisible pris pour absent, puis écrasé · `platform/files.ts` (`createPrivateFile.read`), `hooks/useRecorder.ts` (`recoverInterruptedRecording`, `startRecording`, `startHeartRateRecording`) · départ : une session interrompue (application tuée) laisse son journal ; au lancement, sa lecture échoue (fichier très gros pour le pont de Capacitor, erreur passagère du stockage) ; `read` rend `null` comme pour un fichier absent : rien n'est proposé, aucun message. Au « Démarrer » suivant, `startRecording` relit (même échec), puis `recordingJournal.write(en-tête)` remplace le fichier : la session est perdue, et sa capture des capteurs reste orpheline dans `capteurs/`. Même fin quand la reconstruction échoue : `recoverInterruptedRecording` attrape l'erreur, `startRecording` efface aussitôt son message (`error: null`) et réécrit le journal · gravité : donnée perdue (rare) · petit
- [bogue] Fichier de réglages illisible d'un autre appareil écrasé s'il porte le nom de celui-ci · `hooks/useSessionLibrary.ts` (`readSettingsEntries`, `writeOwnSettings`) · `readSettingsEntries` écarte tout fichier de `reglages/` dont le JSON ou le format ne se lit pas, et `freeDeviceName` ne le compte donc pas comme pris. Départ : `telephone.json` d'un premier téléphone abîmé (copie ou synchronisation coupée, retouche à la main, format d'une version future) ; un second téléphone, sous son nom par défaut « Téléphone », ouvre le dossier et écrit `telephone.json` par-dessus. Hors de ce cas, deux appareils ne portent jamais le même nom : identifiant tiré au hasard, nom libre cherché parmi les fichiers lus, renommage refusé sur un nom pris ; et une lecture refusée par le téléphone arrête l'écriture au lieu de l'ignorer · gravité : donnée perdue (un fichier déjà illisible pour l'application, qu'on aurait pu réparer à la main) · petit
- ne tient pas : `jsonStore.read` sans contrôle de forme. Les six clés citées sont propres à l'appareil, jamais recopiées d'un fichier de réglages (seules `tracker.sportSettings` et `tracker.runnerProfile` voyagent), toujours écrites par le même code sous la même forme ; `useMapBase` (`isMapBase`), `memoryFolder` (`readDeviceChoice`), le cache de la bibliothèque (dossier et liste des champs) et `findLegacyNotes` contrôlent ; `ResizablePanel` ignore une taille mal formée sans planter. Seuls `PlanningPage` (`view` passée telle quelle à la carte : une autre forme planterait Planifier) et `ShareDialog` (`stats` non tableau : cocher un chiffre resterait sans effet) n'ont pas de garde, mais rien n'y écrit autre chose.

### 2. Calculs purs sans test ou mal couverts

Les sept dossiers sont bien couverts : chaque chiffre des analyses, de la liste et du direct passe par une fonction testée, au moins de façon indirecte. Restent deux trous :

- [dette] Décompte et lectures du test de FC max sans test · `recording/fitnessTest.ts` (`phaseRemainingS`, `guideReadings`) · temps restant de la phase (échauffement, palier, récupération), vitesse et FC lissées montrés au direct du test ; `stepFitnessTest`, testé, ne les appelle pas · gravité : chiffre faux si l'un dérive, sans qu'aucun test ne le voie · petit
- [dette] Âge du pratiquant et son assemblage sans test · `running/runnerProfile.ts` (`runnerAge`, `runnerHeartRateZones`), `hooks/useFitnessTest.ts` (`fitnessTestRunner`) · l'âge donne la FC max estimée, donc les zones de l'onglet cardio, les bips de zone et le guidage du test ; `heartRateZones` est testé, pas l'âge ni l'assemblage de l'âge et du décalage de l'activité · gravité : chiffre faux · petit

### 3. Assertions non nulles, désactivations du lint, `@ts-expect-error`

- ne tient pas : les 11 désactivations du lint (toutes `react-hooks/exhaustive-deps`) sont justifiées : `AnalysisMap` (la rotation seule), `sessionAsset` (la clé dit la recherche), `useAdvancedTabs` (la trace seule), `useOpenSections` et `useStoredRecord` (défauts constants chez tous les appelants, vérifié), `PlanningPage` ×2 (l'itinéraire demandé ; une fois, carte prête), `RestingHrTestPage` (courbe refaite à chaque mesure), `StatisticsPage` ×3 (une fois à l'ouverture ; l'adresse seule ; `toAxis` suit `series`, neuve à chaque changement de chiffre). Un douzième, dans `useDismiss.ts`, appartient à un autre lot en cours, pas commité.
- ne tient pas : le `@ts-expect-error` (`core/units.test.ts`) est justifié : le test prouve que le type exige l'unité de distance.
- ne tient pas : les assertions non nulles sont 72 lignes, pas 11 ; toutes lues, toutes justifiées : contrôle juste avant sur la même valeur (FC lissée, cadence, répétitions, `canRetain`, `hrMaxBpm !== null`, `saved.libraryFile &&`, `s.activity ?`), clé tout juste rangée (`cadence.ts`, `stats.ts`, `activityById` complétée de l'activité de chaque session par `visibleStatSessions`), liste constante ou type fermé (`statsMetric`, `STATS_PERIODS`, `BEEP_SOUNDS`), invariant d'état (test de FC max : `test`, `rampStartActiveMs` en rampe, `rampEndActiveMs` en récupération, zones toujours là grâce à l'âge par défaut ; compteur : toujours au moins la phase « Départ » ; direct : mémoire refaite quand le calcul change ; deux points au moins avant les `find(...)!` de `buildPendingSession`).

### 4. Natif des capteurs et des sons

- [bogue] Échec d'écriture des capteurs jamais dit · `MotionPlugin` (`flush`, `stop`), `platform/motion.ts` (`MotionCapture.error`), `hooks/useRecorder.ts` (`stopRecording`) · départ : enregistrement avec sauts, cadence ou pumping, mémoire du téléphone pleine en cours de route ; chaque paquet échoue, l'erreur est gardée et rendue à l'arrêt dans `error`, que personne ne lit (pas plus que `samples`, `durationS`, `longestGapS`) ; la session est rangée avec un `.imu` tronqué, sauts, cadence ou pumping manquants sans un mot. Une capture qui n'a reçu aucune mesure n'est pas signalée non plus · gravité : donnée perdue sans avertissement · petit
- [dette] Fil des capteurs jamais arrêté · `MotionPlugin.handleOnDestroy` · ferme la capture mais ne quitte pas son `HandlerThread` (`BeeperPlugin`, lui, le quitte) : à chaque recréation de l'activité, un fil de plus garde l'ancien greffon et son contexte · gravité : rien de visible · petit
- [dette] Son impossible à créer non rattrapé · `TonePlayer` (`track`, appelée par `playBrief` et les autres hors du `try` de `play`) · si Android refuse une piste audio (pistes épuisées), l'exception remonte sur le fil des bips ou du service du compteur et arrête l'application, au lieu de laisser la vibration seule · gravité : usage cassé (rare) · petit
- ne tient pas : `GnssPlugin` (rappel retiré à l'arrêt comme à la destruction, sur le fil principal), `PermissionsPlugin` (rien de gardé, échecs rendus en refus), `ImuWriter` (fichier fermé dans `finally`, compteurs remis à zéro même sur échec, débordement des écarts relu à l'identique par `readBlocks`), `beeper.ts` (minuteries du navigateur annulées par `stop`, écouteur natif retiré même s'il arrive après le désabonnement), verrous de veille rendus ou bornés (8 h pour les capteurs, échéance plus 10 s pour la veille du GPS).

### 5. Compteur d'intervalles, tests guidés, `RecordingPage`

- [bogue] Séance confiée à la session qui continue seule après une reprise · `hooks/useIntervalTimer.ts` (`startIntervalTimer`), `hooks/useRecorder.ts` (`recoverInterruptedRecording`) · départ : fractionné GPS lancé pendant un enregistrement ; Android tue la page ou elle se recharge ; à la réouverture, la session revient en attente, « interrompue », mais la séance relue de l'appareil court toujours et ses bips continuent : la règle « le compteur s'arrête avec la session » n'est appliquée qu'au passage par « Arrêter » (état `stopping`) · gravité : usage cassé (rare, la séance s'arrête à la main) · petit
- ne tient pas : minuteurs non nettoyés : l'horloge de l'enregistrement (`useRecordingClock`), la minuterie du test de FC repos et celle d'affichage du compteur (`createTickingStore`) s'arrêtent avec leur page ou leur besoin. États impossibles : le compteur a toujours sa phase « Départ » et refuse les commandes hors de propos ; le test de FC max fermé par « Arrêter » écrit encore son dernier état (`noteFitnessTest` accepté pendant l'arrêt, avant le dernier `flushJournal`), comme l'arrêt d'une séance confiée ; `RecordingPage` rend l'écran allumé à la fermeture de la page.

### 6. Lenteur du surf

- [dette] Graphes redessinés à chaque rendu du module · `pages/SurfModule.tsx` (`speedChart`, `heartChart`) · `TrackChart` n'est pas mémoïsé et reçoit à chaque rendu des axes, un formateur et une `ReferenceArea` par vague et par vol tout neufs ; le moindre changement d'état du module (onglet, « Voir » d'une vague, tri, seuil qu'on fait glisser) refait tout le dessin Recharts, d'autant plus lourd que la session a de vagues · gravité : rien de visible (lenteur) · petit
- ne tient pas : calculs lourds sans `useMemo` : découpage (`runSurfSession`), meilleurs segments, couleur et emprise de la trace, surbrillances, tri des vagues et lignes du graphe sont mémoïsés ; seuls les chiffres de « général » et la liste des remontées se refont à chaque rendu, pour quelques dizaines d'éléments. Capteurs : lus seulement Pumping coché et onglet « vols » ou « pumping » ouvert, leur présence se lit dans la fiche sans ouvrir le `.imu`, et le pumping se refait vol par vol, sur les mesures de chaque vol seulement.
