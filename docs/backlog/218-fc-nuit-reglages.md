# 218 · Chiffres de la FC de nuit réglés sur les vraies nuits

Le voulu est dans la ligne 218 de `docs/BACKLOG.md` (points (a) à (e), premières minutes, notification). Cette fiche porte le plan (agent Plan, 21/11) et les choix tranchés.

## Données réelles, hors dépôt

`D:\memoire Tracker\essais\218-nuit-1211\` : la nuit de référence `2026-11-12_22-26-49_night-hr.gpx` (22 h 26 à 7 h 05 ; réveils ressentis vers 0 h 27, 5 h 53, 6 h 32 ; creux attendu 45-46 bpm vers 7 h) et les nuits des 13, 14 et 15/11. À lire par chemin absolu, jamais copiées dans le dépôt ; les tests restent synthétiques. Sonde de mesure du plan : `C:\Users\segne\AppData\Local\Temp\claude\2e5bf20ae2152444\df8077ed-b8ea-4bff-bffd-c3be02664af3\scratchpad\sonde3.mjs`.

## Mesures du plan sur les 4 nuits

- Creux : retirer les secondes de sursaut, sans marge, couverture 0,7 sur les secondes restantes : 45,6 bpm à 7 h 02 la nuit du 12 (avec une marge de 60 s on retombe à 47,0 à 4 h 27 : pas de marge).
- Durée d'un sursaut : mesurée jusqu'au retour à « ligne de base + 4 bpm », ligne de base sur 600 s. Nuit du 12 : 36 mouvements, 11 éveils brefs, 2 réveils (5 h 52 : 215 s ; 6 h 32 : 265 s) ; 0 h 27 sort en éveil bref (142 s), la ligne de base y étant relevée par la montée à 70-74 bpm. Regrouper les sursauts proches gonfle les réveils (6 à 10) : écarté.
- Dispersion par tranche de 5 min hors sursauts : médiane 1,8 bpm le 12, 2,2 le 13 ; seuil calme à 2 bpm : 35 % et 26 % de nuit calme.

## Seuils (dans `NightHrParams`, posés dans `NIGHT_HR_TEST`, version du protocole 1 → 2)

`surge.baselineS` 600 (au lieu de 300), `surge.returnBpm` 4, `surge.startSkipS` 900, `wake: { shortS: 60, longS: 180 }`, `calm: { windowS: 300, sdBpm: 2 }` ; `riseBpm`, `holdS`, `refractoryS` inchangés (8, 10, 60). Notification : champ `RecordingProfile.notificationMinUpdateS` (5 par défaut, 300 pour la nuit) ; un changement d'état (ceinture perdue, pause) part toujours tout de suite.

## Fichiers

1. `src/core/nightHeartRate.ts` : `findSurges` (durée jusqu'au retour, `startSkipS`), `NightHrSurge.kind` (`mouvement`, `bref`, `reveil`), résultats `wakes { movements, brief, long }`, `calmShare`, `regularityBpm`, creux calculé hors des secondes de sursaut (les sursauts se cherchent donc avant le creux). Tranches de 5 min calées sur le départ, valides à la couverture `lowCoverage` hors sursauts ; calme si l'écart-type est au plus `calm.sdBpm` ; indice = médiane des écarts-types des tranches valides.
2. `src/recording/nightHrTest.ts` : seuils, version 2, `EXAMPLE_NIGHT` revu pour couvrir les trois classes.
3. `src/components/NightHrPanel.tsx` : voir « Écran ».
4. `src/library/record.ts` : `SummaryNight` gagne `wakes`, `calmShare`, `regularityBpm` (absents d'une fiche ancienne) ; `SUMMARY_CALC_VERSION` 21 → 22.
5. `src/library/summary.ts` (`summaryNight`) : remplit ces champs ; `surges` reste le total.
6. `src/core/sportProfiles.ts` et `src/hooks/recordingNotification.ts` : intervalle de la notification lu dans le profil.
7. Tests : `nightHeartRate.test.ts`, `record.test.ts`, `summaryFrozen.test.ts` (version seule).
8. Banc : `outils/banc/fc-nuit.mjs` (trois classes, part calme, régularité, mention ; nombre de « [notification] » pendant le direct) et son entrée dans `SCRIPTS.md`.

Tests synthétiques : bosses de 30 s, 2 min, 5 min (un de chaque classe) ; durée jusqu'au retour à la ligne de base + 4 ; descente de 100 à 60 bpm dans les 15 premières minutes sans sursaut ; creux hors sursauts plus bas que le creux brut, entre les pics ; nuit plate (part calme proche de 100 %, indice petit) contre ondulation de ±4 bpm (part calme 0) ; mêmes chiffres à 1 Hz, 5 Hz et avec des secondes sautées ; intervalle de la notification par une petite fonction pure.

Dernière étape avant de rendre : rejouer le calcul sur les 4 GPX réels (script jetable hors dépôt) et donner dans le rapport, par nuit, les trois comptes, le creux et son heure, la part calme et l'indice.

## Écran (les mots de la ligne 218 tiennent lieu de maquette)

- La tuile « Sursauts » devient trois tuiles : « Réveils » (plus de 3 min), « Éveils brefs » (1 à 3 min), « Mouvements » (moins d'1 min).
- Deux tuiles neuves : « Part de nuit calme » (pourcentage) et « Régularité de la nuit » (en bpm, `formatDecimal` ; plus bas = plus régulier), chacune avec son aide « ? ». L'aide de la régularité dit : indice maison, non comparable à la variabilité cardiaque de Polar, Oura ou Garmin. Aucun mot « phase ».
- La note des heures ne cite que les réveils et les éveils brefs ; sur le graphe, pas de trait pour les mouvements.
- Pas d'heure d'endormissement.

## Tranché

- Par défaut la nuit du 21/11, à confirmer : le réveil de 0 h 27 sort en « éveil bref » (2 réveils au lieu de 3 la nuit du 12), `longS` reste à 180 s ; baisser à 140 s ferait aussi passer 1 h 23, 3 h 16 et 4 h 14 en réveils. La limite (une FC déjà haute cache un réveil) se dit dans l'aide.
- Par l'orchestrateur : indice en bpm ; seuil calme à 2 bpm ; la tuile « Stabilisation » reste (non demandée au retrait) ; `SUMMARY_CALC_VERSION` 22 (si un autre lot de la nuit l'augmente aussi, l'orchestrateur fusionne).
