# 210 · Muscu : la ceinture cardio devient facultative

## Voulu (09/11, décidé avec l'utilisateur)

Enregistrer › type Muscu : sans la ceinture, « Démarrer » reste ouvert et la session est rangée avec sa durée seule (un chrono, sans FC) ; avec elle, tout reste comme avant. Contredit DECISIONS §5 (« ceinture obligatoire (« Démarrer » grisé sans elle) », 25/10) : remplacé à la passe doc, pas par l'agent `lot`.

## Aujourd'hui (plan de l'agent Plan, 11/11 ; numéros de ligne d'avant les lots 211 et 208)

- Départ : `pages/RecordingPage.tsx:788` force la ceinture en muscu (`heartOnly || heartRatePicked`) ; `:816-818` (`beltMissing`) grise « Démarrer » ; `:1048` empêche de décocher la case ; `:783` pose `EXAMPLE_BELT` dans le navigateur ; `:956-960` (`handleStart`) sort sans ceinture ; textes à `:1051`, `:1056`, `:1069-1070`, `:1200-1205`.
- Enregistreur : `hooks/useRecorder.ts:1151` refuse le départ sans ceinture ; `:1174-1175` puis `:1084-1096` exigent qu'elle réponde (`takeBelt`).
- Durée en direct : elle ne vit que des points reçus (`recordingDurationMs(stats)`, `recording/session.ts:202`, par `keepPoint`) ; sans ceinture, la tuile « Durée » et la notification restent à 0 (`hooks/recordingNotification.ts:127`).
- Fichier : `useRecorder.ts:608-614`, moins de 2 mesures avec FC → `null`, journal effacé, « Moins de deux mesures de la ceinture » (`recording/session.ts:300`). Le format suffit déjà : `buildHeartRateGpx` (`recording/gpxWriter.ts:60-73`) écrit des points d'heure seule, un `<trkseg>` par pause, `<type>muscu</type>` ; la durée vient des heures des points (`activeDurationS`, `core/heartRateSession.ts:38`) ; l'arrêt ajoute un point sans FC (`withStopPoint`, `session.ts:82`).
- Reprise après coupure : `useRecorder.ts:903-906` (`resumeSilently`) lève « ceinture introuvable » ou reprend une ceinture alors qu'on était parti sans ; `:978-982`, la fin de session est la dernière ligne `hr` du journal.
- Résumé, statistiques : rien ne casse (`summarizeHeartRateSession`, `library/summary.ts:312` ; `library/stats.ts:110` et `:775`). `SUMMARY_CALC_VERSION` inchangé.
- Analyse (`pages/MuscuModule.tsx`) : « cardio » disparaît déjà (`:112`), mais FC moyenne et max affichent « — » (`:133-134`), la courbe se trace vide (`:167`), l'invitation sur les zones apparaît (`:192`), l'aide parle de FC (`:155`), alerte « pas assez de mesures de la ceinture » (`:145`).
- Vignette : `pages/SessionLibrary.tsx:182`, « Courbe indisponible » après avoir lu le GPX pour rien. Partage : `library/shareStats.ts:155-160`, « — » pour les deux lignes de FC.

## À faire, dans l'ordre

1. `recording/session.ts` : fonction pure `keepClockTick(lastKeptMs, nowMs, minIntervalMs)`, sœur de `keepHeartRateSample` ; `nothingToKeep` devient « Session trop courte : rien à enregistrer. »
2. `recording/journal.ts` : indicateur facultatif « sans ceinture » dans l'en-tête (`JournalHeader`, `journalHeaderLine`) ; son absence veut dire « avec », les anciens journaux restent compris.
3. `hooks/useRecorder.ts` : `startRecording` accepte `heartRate: null` en muscu ; `startHeartRateRecording(activity, belt | null)` : sans ceinture, pas de `takeBelt`, un point d'heure seule tout de suite puis un par seconde par `keepPoint` (journal compris), un point à la reprise après pause, minuteur arrêté à l'arrêt, à l'abandon et à la remise à zéro ; `keepBeltAlive` reste appelé (il tient la notification) ; `sourceLabel` « Chronomètre » ; `buildPendingSession` compte tous les points ; `resumeSilently` relance le minuteur si l'en-tête dit « sans ceinture ». Écran éteint, le minuteur ralentit : sans gravité, la durée vient de l'heure des points et du point d'arrêt (règle 10 : ne jamais supposer plusieurs points par fenêtre).
4. `pages/RecordingPage.tsx` : `measureHeartRate` suit la case, même en muscu ; la case est cochée d'office et se décoche (FC d'exemple du navigateur comprise), « Annuler la recherche » permis ; `handleStart` passe `measureHeartRate ? belt : null` ; textes et commentaire d'en-tête (`:106-109`) réécrits ; `liveStatItems` cache « FC moy. » et « Zone » sans ceinture ; texte de pause et compte de la carte de fin : « durée seule » au lieu de « N mesures de la ceinture ». Bips de zone et guidage : rien, ils dépendent déjà d'une ceinture connectée. Garder la remise à zéro du chronomètre libre posée par le lot 211 (`resetStopwatch` dans `useRecorder`).
5. `hooks/recordingNotification.ts` : pas de champ FC quand `heartRate` est nul.
6. `pages/MuscuModule.tsx` : sans FC, lignes de FC retirées de `generalStats`, courbe, invitation sur les zones et aide cachées ; alerte « pas assez de points horodatés ».
7. `library/shareStats.ts` : mêmes retraits dans la branche muscu (fichier déjà retouché par le lot 208, commité avant).
8. `pages/SessionLibrary.tsx` : `summary.heartRate` absent → « Sans FC », sans lire le GPX.
9. Commentaires : `settings/activityPresets.ts:122`, `platform/heartRate.ts:31`.

Pièces réemployées : `keepPoint`, `splitIntoSegments`, `withStopPoint`, `buildHeartRateGpx`, `heartRatePointsFrom`, `activeDurationS`, `summarizeHeartRateSession`, `heartOnlyLiveStats`, `usePerActivityChoice`.

## Ce que l'utilisateur voit sans ceinture

- Enregistrer : la case « Ceinture cardio » se décoche ; sa note dit « Sans elle, la séance est chronométrée, sans FC. »
- Pendant la séance : « Durée » seule ; notification avec l'étape seule.
- Analyse : onglets « général », « matériel et notes », « réglages » ; « général » montre Durée, Hors pauses, Répétitions et les notes, sans courbe.
- Statistiques : la séance compte en nombre et en durée, pas dans les graphes de FC.

## Tranché par l'orchestrateur (11/11)

- **« Démarrer » n'est jamais grisé en muscu** (le voulu dit « sans elle, Démarrer reste ouvert »). Case cochée et ceinture pas encore connectée : « Démarrer » demande confirmation (« La ceinture n'est pas connectée : partir sans elle ? La séance sera chronométrée, sans FC. »), puis part en chrono ; case décochée : départ direct. La note sous la case dit où en est la ceinture, comme aujourd'hui.
- Les FC sont cachées plutôt qu'affichées « — », partout.
- La case n'est pas retenue d'une fois à l'autre ; pas d'option « sans ceinture par défaut » dans Réglages.
- Avec la ceinture, une séance qui n'a reçu qu'une mesure est gardée, avec sa durée seule.
- Phases du compteur sans courbe : rien de neuf, seul le nombre de répétitions s'affiche.
- Ceinture perdue en cours de séance : comportement actuel (trous dans la FC), pas de bascule en chrono.

## Tests et banc

- Tests : `recording/session.test.ts` (`keepClockTick`), `recording/journal.test.ts` (en-tête « sans ceinture », ancien en-tête = « avec »), `recording/gpxWriter.test.ts` (GPX sans FC, deux segments), `library/summary.test.ts` (résumé sans FC), `library/stats.test.ts` (durée comptée, pas de `heartRatePoints`), `library/shareStats.test.ts` (pas de lignes de FC), `recording/liveStats.test.ts` (`heartOnlyLiveStats` sans FC).
- Banc : `outils/banc/muscu.mjs` (une séance sans FC : « général », pas de « cardio », vignette « Sans FC ») ; `outils/banc/timer.mjs` (le contrôle « cochée et grisée », vers la ligne 221, change : écart attendu ; ajouter un départ case décochée, quelques secondes, « Analyser », durée non nulle) ; rejouer `statistiques`, `partage`, `entrainement`. Le libellé « Tout clore » y est déjà devenu « Clore le timer » (lot 206).

## Essais au téléphone prévus

- Séance de 10 min sans ceinture, écran éteint : durée juste, notification présente.
- Application balayée pendant une séance sans ceinture : session récupérée.
