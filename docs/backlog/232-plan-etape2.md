# 232 · Plan de l'étape 2 (agent Plan, 25/11 au soir) et choix tranchés

Brief : `docs/backlog/232-enregistrement-coupures.md`, « Étape 2 ». Étape 1 faite (sous-lots A à D, `docs/backlog/232-plan.md`). Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lots 403 (42eedae, fe0ec2a, 7d9b050, b86a304, c974a5f), 415 (33263c2), 496 pour la garde.

## L'essai préalable est sauté, sans coder à l'aveugle

L'ancien greffon de Tracker est celui de Gtracker avant son lot 403, à la version près (`@capgo/background-geolocation` 8.5.0, Capacitor 8.6.0, `useLegacyBridge`) ; le manifeste ne diffère que d'`IntervalTimerService` et `HeartRateService` ; `RecoveryPlugin`, `MainActivity`, `location.ts`, `recovery.ts` sont presque les mêmes. Sans adresse d'envoi, le greffon arrête son service quand l'application est balayée (`handleOnDestroy`, `onTaskRemoved`, `START_NOT_STICKY`), constaté par l'utilisateur le 15/11 sur ce Xiaomi (« la notification disparaît »). Le service maison de Gtracker a réussi ses essais 277 à 279 le 16/11 et 280 (lot 415). Ce que Gtracker n'a pas établi est ce qui n'existe qu'ici (muscu, compteur, test) : c'est là que portent les essais.

## Ce qui se reporte (à la main, paquet `io.github.segneur.tracker`)

- Java : `RecordingService.java`, `RecordingPlugin.java`, `FixLog.java`, `GpsLostWatch.java`, `ClosedGuard.java` (version du lot 496), `GpsRestart.java` (c974a5f), `GpsResubscribe.java` (lot 415), et leurs tests JUnit `ClosedGuardTest`, `FixLogTest`, `GpsLostWatchTest`, `GpsRestartTest`, `GpsResubscribeTest`. Retouches : `GnssPlugin.java` (« Réessayer » appelle `RecordingService.retryGps()`), `RecordingNotificationPlugin.java` (même numéro 28351, même canal), `MainActivity.java`, `RecoveryPlugin.java` (réduit).
- TypeScript : `src/recording/nativeLog.ts` et son test (version HEAD de Gtracker, calage du lot 417 par `judgeSettle` compris), constantes de la garde dans `RecordingProfile` (`core/sportProfiles.ts`) et `guardMovingSpeedMs`. Tout ce que `nativeLog.ts` appelle existe ici : `parseJournal`, `journalFixLine`, `resumedPhase`, `evaluateAutoPause`, `isNewerFix`, `roundFix`, `rebuildRecordingStats`, `judgeSettle`.
- Pas tel quel : là-bas l'enregistreur est en `src/hooks/recorder/*`, ici tout va dans `useRecorder.ts` (`recoverOnce`, `resumeSilently`, `continuePendingSession`, `stopRecording`, `pauseRecording`, `resumeRecording`, `receiveFix`) ; les textes restent en français dans le TypeScript et sont donnés au service au départ ; pas de `FILE_FORMATS` (une constante locale).

## Propre à Tracker, à garder

- `HeartRateService` (muscu et nuit sans position) garde son type et son canal ; `RecoveryPlugin.state()` dit toujours `belt`, `gps` devient « notre service tourne pour cette session » ; `RecoveryServices {gps, belt}` et `recoveryDecision` restent.
- `IntervalTimerService` est à part : il survit au balayage et continue de biper ; la phase du compteur n'est plus mise à jour dans la notification de l'enregistrement pendant la fermeture.
- Zone cardio visée, test de FC max, « FC perdue », bips des balises : muets pendant la fermeture, de retour à la réouverture.
- Calage du GPS (sous-lot D) appliqué par le rattrapage tant que le journal de la page n'a aucune position ; « Réessayer » (sous-lot C) refait aussi l'inscription au GPS ; `locationOff` part à l'événement `locationEnabled` du service.
- Pause automatique et manuelle décidées par la page seule ; le service ne reçoit que `setPaused`.
- Rejeu de fichier, navigateur et programme Windows gardent leurs sources (`isNativeApp()`).

## Sous-lots, un commit chacun

- E1 · Rattrapage en calcul pur, neutre (Opus/high) : `src/recording/nativeLog.ts`, `nativeLog.test.ts`, constantes `guard*` dans `core/sportProfiles.ts` (règle 3) et leur test. Tests à 1 Hz et 5 Hz : journal coupé après chaque ligne puis rattrapé = journal entier ; rattrapage rejoué sans ajout ; pause manuelle ouverte ; pause automatique à cheval ; une position qui couvre 40 s ; dernière ligne tronquée ; doublons ; arrêt par la garde ; calage du départ. Pas de banc.
- E2 · Service Java, pas encore branché, neutre (Opus/high) : les 7 classes et 5 tests ; `AndroidManifest.xml` (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `uses-feature gps`, service `.RecordingService` de type `location` ; ni position en arrière-plan ni `RECEIVE_BOOT_COMPLETED`), `MainActivity.java`, `RecordingNotificationPlugin.java`, `GnssPlugin.java`, `res/values/strings.xml` ; `androidManifest.test.ts`, `nativeConstants.test.ts`. Gradle (`testDebugUnitTest`) par l'orchestrateur, poste libre.
- E3 · Branchement (Opus/high) : `platform/location.ts` (`attachDeviceLocation` remplace `adoptRunningService` ; `readLoggedFixes`, `clearLoggedFixes`, `deviceLocationState`, `setPaused` optionnelle de `LocationSource` ; `nativeHolder` et le refus de la localisation ponctuelle partent), `platform/recovery.ts`, `RecoveryPlugin.java`, `platform/permissions.ts`, `platform/notification.ts` ; `useRecorder.ts` : deux passes de rattrapage dans `resumeSilently`, rattrapage dans `recoverOnce` avant « Continuer », `markCaughtUp` dans `continuePendingSession`, rattrapage de `stopRecording` avant le GPX, pause dite au service, `clearLog` après rangement ou « Jeter ». Tests : `location.test.ts`, `useRecorder.resume.test.ts`, `useRecorder.test.ts`, `resume.test.ts`. Banc avant/après, un script à la fois : `session-save-resume`, `gps-perdu`, `notification`, `carte-direct`, `trace-suivie`, `balises`, `fractionne`, `compteur-course`, `muscu`, `fc-nuit`, `test-fcmax`.
- E4 · Retrait du greffon (Sonnet/medium) : `package.json`, `package-lock.json`, `capacitor.config.ts` (`useLegacyBridge` gardé), `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`, `AndroidManifest.xml`, `public/licences-hors-js.json`, `outils/licences-hors-js.mjs`, `outils/banc/apropos.mjs`, `src/core/licenses.test.ts`, `src/architecture.test.ts` (l. 286). Banc `apropos`.
- Passe doc après validation : DECISIONS §6 l. 93, ETAT §12 l. 462, 476, 480, 481, 483, INVENTAIRE.
- Aucun fichier commun avec le lot 235 ni le lot 217. Lien avec 235 : une mémoire des chiffres du direct doit tenir quand des positions sont rattrapées (aujourd'hui oui, le rattrapage n'ajoute qu'à la fin).

## Tranché par l'orchestrateur le 25/11

- Garde reprise de Gtracker : arrêt seul après 1 h sans s'éloigner de 200 m ni vitesse tenue 5 s, ou après 12 h (réglée avec l'utilisateur les 15/11 et 23/11).
- La notification ne met plus à jour la phase du compteur pendant la fermeture ; le Java ne porte aucun texte ; `RecoveryPlugin` réduit à `belt`.

## À confirmer par l'utilisateur (avancé sur le défaut, celui de Gtracker)

- Pendant la fermeture : ni FC, ni capteurs (sauts, pumping, cadence), ni bips de zone, de test ou de balise ; ceinture et capteurs dans le service seraient un lot à part.
- Un enregistrement jamais repris s'arrête seul (garde ci-dessus) et la session se range à la réouverture.
- Muscu ou FC de nuit balayée et jamais rouverte : `HeartRateService` reste sans garde, comme aujourd'hui (dette).
- DECISIONS §6, « repli sur Capawesome » : la phrase part à la passe doc.

## Limites qui viennent avec le service

Un trou au milieu d'une sortie, page restée ouverte, n'est pas comblé ; une position rattrapée n'a pas de FC ; une localisation coupée pendant la fermeture n'est pas redite au retour ; « ceinture éteinte puis Continuer » jamais joué ; le GPS seul met plus de temps que le greffon à donner sa première position, et rien à l'intérieur.

## Essais au téléphone (3)

1. À pied avec ceinture et compteur d'intervalles, application balayée 5 min puis rouverte, puis « Arrêter » : notification « Application fermée », bips du compteur entendus, trace entière, FC revenue, aucune notification orpheline.
2. Départ localisation coupée, puis rallumée : l'alerte rouge part et la position arrive.
3. Muscu avec ceinture, balayée puis rouverte : reprise comme aujourd'hui, trou de FC accepté.

Par adb, sans l'utilisateur : installation par-dessus, `dumpsys package` (permissions, service déclaré, pas d'`ACCESS_BACKGROUND_LOCATION`). Ne pas simuler un balayage sur une vraie sortie.

## Non vérifié par le plan

Les diffs Java et TS de Gtracker ligne à ligne ; `recorder/recovery.ts` et `live.ts` face à `useRecorder.ts` ; la reprise du compteur à cheval sur une fermeture (`useIntervalTimer`) ; les 213 lignes d'écart entre les deux `journal.ts` ; `fitnessTest` et `useMarkGuide` à la reprise ; HyperOS et `IntervalTimerService` au balayage.
