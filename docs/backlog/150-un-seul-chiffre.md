# 150 · Un seul chiffre par nom : vitesse max du surf, moyenne du direct, paires de Réglages, profil contrôlé

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes B7, B8, B10, B11 ; détail dans `angle-C3.md` (C3-2), `angle-C4.md` (C4-3), `angle-C7b.md` (C7b-3), `angle-T2.md` (T2-2)). Modèle | Réflexion : Opus | high.

## Tel que noté

- « "Vitesse max" du surf : la page lit le max des vagues gardées, la bibliothèque, les Statistiques, le tri et l'image de partage lisent le max de toute la trace (14,4 contre 25,2 km/h dans la sonde ; "—" contre 8,6 km/h pour un paddle sans vague). »
- « "Moyenne" du direct : distance sur le temps hors pauses, sans seuil ; ce n'est ni la "Vitesse moyenne" ni la "Moyenne active" de l'analyse (13,1 contre 9,8 nd dans la sonde). »
- « Réglages : vider un champ d'une paire (bornes de couleur, pause automatique) remet toute la paire au défaut ; retaper "35" après avoir effacé "30" perd le "12" de l'autre borne, sans message. »
- « Profil du pratiquant repris d'un autre appareil sans contrôle par champ : une FC de repos écrite en texte donne des zones à 5 098 et 50 119 bpm. »

## Où, aujourd'hui (vérifié au commit 312d13c)

- `pages/SurfModule.tsx:226` (`summary.maxWaveSpeedMs`) contre `library/summary.ts:188` (`bestWindowSpeedMs` sur toute la trace), lu par `library/shareStats.ts`, `pages/StatisticsPage.tsx`, `library/sessionSort.ts`.
- `recording/liveStats.ts` : `averageSpeedMs = distanceM / movingTimeMs`, `movingTimeMs` = dernier − premier point des segments (pauses exclues, aucun seuil) ; libellé « Moyenne » dans `recording/liveFields.ts`.
- `pages/SettingsPage.tsx` `NumberField.handleChange` : texte vide → `onCommit(null)` ; `setRangeBound`, `setGradeBound`, `setAutoPauseField` : `null` → `setFor(id, clé, null)`, les deux bornes sous une seule clé.
- `hooks/useRunnerProfile.ts`, `hooks/useStoredRecord.ts` (`{ ...defaults, ...stored }`) : seuls l'avatar, l'origine des FC et les seuils sont contrôlés ; `hrMax`, `hrRest`, `birthYear`, `weightKg` passent tels quels ; le profil voyage par `reglages/<appareil>.json` (`TRAVELLING_KEYS`).

## Voulu

- Surf : la vitesse max des vagues (ou des glisses) rangée dans le résumé et lue partout, `SUMMARY_CALC_VERSION` augmenté ; sinon deux noms différents pour deux chiffres (Q34 : la vitesse max est celle d'une vague).
- Direct, en voile et en surf : la moyenne calculée comme la « Moyenne active » de l'analyse (seuil de l'activité) et nommée pareil ; ou nommée « Moyenne hors pauses ».
- Réglages : un champ vidé d'une paire n'efface que sa propre borne, ou n'écrit rien tant qu'il est vide et se valide en quittant le champ ; fonction pure `nextSpeedRange(current, bound, value)` testée.
- Profil : `readRunnerProfile(raw: unknown)` contrôlé champ par champ (`RUNNER_BOUNDS`, `validProfileNumber` existent), appelé par la lecture et le hook.

## Pourquoi

Un même nom pour deux chiffres différents, ou un réglage perdu sans message, se voit dès la bibliothèque et le direct ; le profil faux fausse l'onglet cardio, les bips de zone et l'image de partage.

## Tests

Sondes de l'audit : `C3-vagues.test.ts` (cas « vitesse max de la page et du résumé »), `C4-direct-gpx.test.ts` (direct contre analyse), `T2-profil-voyage.test.ts` (inversée).
