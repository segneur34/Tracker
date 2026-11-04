# 149 · Noyau et voile : entrée de la trace, virage en un seul pas, filet du vent

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes B4, B5, B6, B9, B15 ; détail dans `angle-C2.md` (C2-1, C2-2, C2-3) et `angle-C1.md` (C1-1, C1-2, C1-3, C1-4)). Modèle | Réflexion : Fable | high. Après le 144 (mêmes fichiers de voile).

## Tel que noté

- « Un point daté en arrière (montre qui réécrit un point, fusion de segments) fabrique une fausse vitesse max et de faux tops : top 2 s à 23,3 nd pour 15,5 réels. »
- « Une date illisible sur un seul point met "NaN min" en temps actif, ampute les tops de toute la suite de la trace, et laisse le résumé "en attente" pour toujours. »
- « Un virement ordinaire (60° à 120°) enregistré en un seul pas par un enregistreur économique (Komoot : un point toutes les 6 s, silence de 20 s au virage) n'est ni compté ni écarté : le point de reprise porte le cap de la corde, qui coupe le virage en deux moitiés sous 60°. Les tests existants ne couvrent que 145° et plus. »
- « Sur toute session de wing réaliste, la polaire seule désigne le trou de couverture à 90° du vrai vent ; les manœuvres la sauvent, mais sans filet si le vrai vent n'est pas parmi les trois candidats. Et un vent saisi à 50-130° du calculé fait tomber le tableau des manœuvres à zéro sans un mot. »
- « Un trou parcouru en mouvement compte dans le temps actif mais pas dans les vols : "15 min en vol" et deux vols qui en font 10 sur la même page. »

## Où, aujourd'hui (vérifié au commit 312d13c)

- `core/gpxParser.ts` ne trie ni n'écarte un point daté avant le précédent ou à date non finie ; `core/kinematics.ts` `spreadEqualTimes` ne traite que les dates égales ; `core/sessionStats.ts` `buildCumulativeTrack` cumule un pas négatif ; `core/topSegments.ts` lit un temps cumulé non monotone. `core/heartRateSession.ts` `heartRatePointsFrom` écarte déjà « un point qui n'est pas plus tard que le précédent » : la règle existe pour la FC seule.
- `core/kinematics.ts:357` : le point qui suit un silence reçoit le cap de la corde ; `sailing/wind.ts` `scanTurnWindow` et `sailing/maneuvers.ts` `readWindow` lisent alors deux demi-virages sous `MANEUVER_MIN_TURN_DEG`.
- `sailing/wind.ts` `polarWindCandidates` (score `−4 × noGo`, trois maxima séparés de 45°) ; `sailing/maneuvers.ts` `selectWindCandidate` ne choisit que parmi ces candidats et le jumeau du premier ; `tackChanged` et `classifyTurn` (tolérance 60°).
- `core/sessionStats.ts` : `computeActivityMask` juge le trou par sa vitesse moyenne, `activeRuns(maxGapS)` le coupe par sa durée ; `computeActiveTimeMs` ignore `maxGapS`.

## Voulu

- Dans `parseGpx` (ou au début de `runKinematics`), écarter tout point dont la date n'est pas finie ou pas strictement après le point gardé précédent ; `formatDuration` et voisins rendent « - » pour NaN, l'infini et le négatif.
- Pas unique : lire le virage du cap d'avant le silence au cap du premier pas d'après (ou au cap stabilisé de sortie), pas au cap de la corde ; ou ne pas prêter au point de reprise d'un trou le cap de la corde. Test KOMOOT 90° (trois virements attendus), témoin dense à 1 Hz. **Refaire le relevé du vent du banc** (ETAT §11 : toute retouche de la détection l'exige).
- Vent : ajouter aux candidats polaires la direction votée par les virages eux-mêmes et le jumeau de chaque candidat ; abaisser la confiance quand aucun virage n'est classé alors que des virages existent ; une phrase sous le tableau quand le vent saisi est à plus de 45° du calculé fiable et que les « sens incertain » dépassent les manœuvres comptées.
- Trou en mouvement : une seule règle (Q56), écrite une fois.

## Pourquoi

Chiffres faux montrés (vitesse max, tops, temps actif, nombre de manœuvres, direction du vent) sur des entrées réelles mais rares ; c'est la voile, cœur de ce qui sera vendu.

## Tests

Sondes de l'audit à reprendre comme tests : `C2-degenere.test.ts` (« temps recule », « date illisible », « trou en mouvement »), `C1-trous-degeneres.test.ts` (KOMOOT 90°, 130°, 150°), `C1-vent-saisi.test.ts`, `C1-polaire-seule`, `C1-vent-longue` (dans `~/.claude/plans/audit-vente-0111/sondes/copie-figee/`). Neutralité des tests gelés du lot 112 sur tout le reste.

## Questions

- Q56 : le temps actif et les vols doivent-ils lire la même règle sur un trou parcouru en mouvement ? Par défaut : oui, le trou mobile compte dans les deux (règle 10).

## Réponse du 04/11

- Q56 : **oui, le trou mobile compte partout** (temps actif et vols) ; seul le masque d'activité décide, `activeRuns` ne coupe plus sur la durée. Plan : `~/.claude/plans/2-v-rit-de-steady-starlight.md` (sections E à H).
