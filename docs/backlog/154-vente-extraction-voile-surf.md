# 154 · Vente : extraction de la version voile + surf (retrait des familles à pied, vélo et fractionné)

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md` § 3 « Carte d'extraction » ; détail fichier par fichier dans `angle-X1.md` (tables par dossier, script `X1-graphe.mjs`) et `angle-X2.md` (cardio et Profil, Enregistrer, Planifier, Statistiques, natif, outils, docs)). Modèle | Réflexion : Fable | high pour E1 et E6, Opus | high ensuite. Contexte donné le 01/11 : voile et surf seulement, tout le transverse gardé (Enregistrer, Planifier, Statistiques, Profil, Bibliothèque, Réglages, mémoire), acheteur francophone.

## Chiffres

`src/` hors tests : 416 fichiers, 73 644 lignes ; 281 gardés tels quels, 61 à découper (≈ 5 240 lignes à retirer), 74 retirés (13 164 lignes, dont 15 fichiers et 2 213 lignes de planification sur routes) : ≈ 18 400 lignes retirées, 25 %. Hors `src/` : 29 fichiers de test partent, 39 à réécrire ; ≈ 600 lignes de Java ; ≈ 730 lignes de CSS ; 6 images ; banc : 18 scripts retirés, 32 à adapter, 22 gardés.

## Ce qui aide

`sailing/` et `surfing/` n'importent que `core/` ; famille et traitement sont des tables typées (26 `Record<…>`) : réduire une union fait lister par le compilateur chaque endroit ; la fiche relit sans plantage ce qu'elle ne connaît plus ; pages chargées à la demande ; plateforme isolée.

## Les trois couplages coûteux

1. `SportProfile` et les unions `SportType` / `Treatment` / `SportFamily` (chaque profil porte les champs de tous les traitements).
2. L'enregistrement (`useRecorder.ts`, `RecordingPage.tsx`, `liveStats.ts`, journal, notification, natif) : muscu sans position, compteur confié, test guidé et cadence entrelacés dans la machine d'état.
3. La planification : le parcours de balises est un mode (`'straight'`) du planificateur routier (`route.ts`, `usePlannedRoute`, `PlanningPage`).

## Lots, dans l'ordre (chaque lot vérifié, E1 prouvé neutre au banc : general, statistiques, profil, cardio, balises, surf, sauts)

| # | Lot | Taille |
|---|---|---|
| E1 | Préparer la couture sans rien retirer : `running/runnerProfile.ts` → `library/athleteProfile.ts` (clé `tracker.runnerProfile` gardée) ; `windowMean`, `WindowSample`, `TEST_SIGNAL_TONES` sortis de `recording/fitnessTest.ts` ; référence cardio neutre à la place de `SPORT_PROFILES.running.heartRate` ; profil neutre pour une session sans calcul (`summary.ts` `sport ?? 'running'`) ; `grade`, `energy`, `terrainElevation`, `chartRows`, `segmentGrid`, `heartRateSession` sortis de `core/` ; règle d'architecture « transverse ↛ `running/`, `cycling/` » à exceptions nommées ; fixtures de test sur la voile et le surf (`src/test/record.fixture.ts` est « une course d'une heure ») | gros |
| E2 | Fiche et résumé détachés : lecteurs `bikeWeightKg`, `loadKg`, `surfaces`, `terrainElevation`, `intervals`, `test` retirés de `record.ts` (bruts gardés par `...rest` et `GUARDED_FIELDS`) ; `test` et `cadence` retirés du résumé, `SUMMARY_CALC_VERSION` inchangé ; FC repos déplacée sous le Profil (`/profil/fc-repos`), `restingHrResults.ts` hors de `running/` ; pop-up réduit à pseudo et année de naissance | petit |
| E3 | Retirer l'Entraînement : pages `/fractionne/*`, `MuscuModule`, `IntervalCard`, `FitnessTestCard`, `TrainingHub`, `WorkoutBlocksEditor`, `intervalTimer`, `stopwatch`, `workoutLists`, `fitnessTest`, hooks ; branches de `useRecorder` (`heartOnly`, `intervalRuns`, `currentTest`), `RecordingPage` (rangées Type et Test, `TimerScreen`), `journal`, `recordingNotification`, `AppShell`, `main.tsx` ; natif `IntervalTimerService`, `HeartRateService`, `TONE_*` déplacés dans `TonePlayer`, `scheduleIntervals` et `keepAlive` retirés, manifeste | gros |
| E4 | Retirer course et vélo : `running/`, `cycling/`, `LandModule`, `landModules`, panneaux cadence, pente, énergie, revêtement, poids et charge ; branches de `liveStats`, `useLiveRecording`, `gpxWriter`, `summary`, `stats`, `SettingsPage`, `StatisticsPage`, `SessionLibrary`, `HeartRatePanel` (dérive et nuage), icônes, motifs, images ; `MotionPlugin` (cadence) | gros |
| E5 | Planification : (a) cacher et garder en sommeil, ou (b) `RouteMode` réduit à `'straight' | 'imported'`, défaut `'straight'`, retrait de `brouter`, `brouterProfile`, `overpass`, `wayMatch`, `surface`, `wayTypes`, `legCalculation`, `loopReturn`, `ignAltimetry`, `importedElevation`, `duration` et des composants de revêtement et de profil ; `route.ts` gardé en lecture pour les anciens itinéraires | petit (a) ou gros (b) : Q55 |
| E6 | Réduire les unions et les réglages : `SportType`, `Treatment`, `SportFamily`, `SportProfile`, `activities.ts` (graines, couleurs, `ACTIVITIES_VERSION`), `activityPresets`, `activitySettings` (`StoredSettings`, `PRESET_RESETS`, `PRESETS_VERSION`), `analysisTabs`, `liveFields`, `trackColor`, `tokens.css` | gros |
| E7 | Données de l'application complète : fiches au calcul retiré masquées au lieu de « À classer » ; clés terre plus écrites à `null` dans une fiche de voile | petit |
| E8 | Identité et livrable (153), `file_paths`, `allowBackup` (151), docs réécrites (README, CLAUDE.md → ARCHITECTURE et CONTRIBUER, DECISIONS §2 et §5 retirées, ETAT §4.3 et §12 refaits, INVENTAIRE régénéré), `.claude/`, BACKLOG, MODELES, HISTORIQUE non livrés ou nettoyés ; banc rebranché sur voile et surf, scripts terre retirés | petit |

## Les trois risques (un test avant chaque lot)

1. Migrations d'activités (`ACTIVITIES_VERSION = 9`, graines terre) et `PRESET_RESETS` (v2 vise les bases terre, v3 la Marche) : un réglage de voile déjà migré peut être effacé une seconde fois. Garde : partir d'un fichier de réglages de la 0.4.61 réglé à la main en voile et surf, rien ne change.
2. `SUMMARY_CALC_VERSION` : ne pas l'augmenter pour un champ retiré ; l'augmenter si le profil d'une session sans calcul change. Garde : résumés de voile et de surf identiques à l'octet avant et après chaque lot.
3. Lecteurs à type fermé des réglages (`hiddenFamilies`, `moduleActivity`, onglets, chiffres du direct, champs par activité) : ignorer une famille disparue, jamais rejeter tout l'objet. Garde : import d'un fichier de réglages complet de la 0.4.61 dans la version allégée, réglages de voile et de surf retrouvés.

## Questions

- Q55 : planification, option (a) ou (b) ? Par défaut : (b).

## Réponse du 04/11 (Q55)

- **Option (b)** : dans la version vendue, le planificateur routier (BRouter, Overpass, IGN, revêtements, profil, boucle de retour, durée par tronçon) est retiré, la planification se réduit au parcours de balises en ligne droite et aux itinéraires importés ; les anciens itinéraires restent lisibles. **À faire après le fork** : sur la copie destinée à la vente, une fois séparée du dépôt de l'utilisateur, jamais avant ; la version de l'utilisateur garde le routeur complet.
