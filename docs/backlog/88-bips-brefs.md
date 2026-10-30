# 88 · Bips doubles et triples plus brefs

## Tel que noté (29/10, après le test de FC max)

Les bips doubles et triples (trop vite, trop lent) doivent être plus brefs : un « bip-bip » plus court et plus serré, pour le compteur, les balises et les tests.

## Aujourd'hui

- Tests guidés : `TEST_SIGNAL_TONES` (`src/recording/fitnessTest.ts`) : « trop » (trop vite) = deux bips courts, « accelere » (trop lent) = trois, par `shorts(n)` espacés de `SHORT_SPACING_MS` = 350 ms ; chaque bip court dure `BEEP_SHORT_MS` = 120 ms (vibreur 80 ms), `src/core/beepDurations.ts`, repris en dur dans `TonePlayer.java` (`SHORT_MS`, `SHORT_VIBRATION_MS`).
- Joués par `playPattern` (`src/platform/beeper.ts`) ; sur le téléphone, `BeeperPlugin.pattern` → `IntervalTimerService.toneKind` → `TonePlayer.playShort`.
- Le test de FC repos (`RESTING_SIGNAL_TONES`, `src/recording/restingHrTest.ts`) a peut-être aussi des doubles.

## Voulu (tranché par l'orchestrateur le 30/10)

- Un nouveau son, le **bip bref** (`'bref'` dans `ToneKind`) : environ 60 à 70 ms de son, vibreur environ 40 ms, défini une seule fois dans `beepDurations.ts` et repris à l'identique dans `TonePlayer.java` (avec son fondu, comme les autres).
- Un **espacement serré** des doubles et triples, une constante nommée dans `beepDurations.ts` (environ 150 à 180 ms entre deux débuts), qui remplace `SHORT_SPACING_MS`.
- Tout motif de 2 ou 3 bips rapprochés (moins d'une seconde entre deux) passe au bip bref et à cet espacement : « trop » et « accelere » des tests, et tout autre double ou triple trouvé dans les tests, le compteur ou les balises.
- Ne changent pas : le bip court seul (120 ms), le compteur « court, court, long » à une seconde d'écart (réglé avec l'utilisateur le 07/10), le rythme d'approche des balises, les trois longs de fin de parcours, le « final ».
- Pourquoi : la note vise le « bip-bip » des tests ; les signaux à une seconde d'écart du compteur sont des décomptes, pas des doubles.

## Contraintes

- Son et vibreur seulement par `src/platform/beeper.ts` (règle 12) ; le navigateur joue aussi le bip bref (Web Audio de `beeper.ts`).
- Tests existants mis à jour sans affaiblir ce qu'ils vérifient ; un test qui garde l'égalité des durées entre TS et Java s'il en existe un, sinon la mention dans le commentaire de tête de `beepDurations.ts`.
- « Écouter » de Réglages inchangé.

## Vérification

`npm run verif`. Pas de banc.

## Essai au téléphone

Un seul : Réglages ou un test de FC max d'exemple qui joue « trop vite » et « trop lent » → un bip-bip net, plus court et plus serré qu'avant, vibreur compris.
