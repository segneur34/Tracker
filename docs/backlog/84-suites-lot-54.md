# 84 · Suites du lot 54 : fichiers d'enregistrement et fiches

Opus | medium. Touche les fichiers de l'utilisateur (dossier `en-attente/`, GPX complet, dossier du navigateur) : **seul dans sa session**, jamais en parallèle d'un autre lot. Brief écrit le 30/10 par l'orchestrateur d'après la ligne 84 de `docs/BACKLOG.md` et HISTORIQUE point 195 (lot 54). Lire `docs/DECISIONS.md` §6 (Enregistrement) et §8 (Mémoire et fichiers) avant de coder.

## Trois défauts, trois corrections

### A. Un `.tmp` resté dans `en-attente/` n'est ni repris ni nettoyé

- `src/platform/memoryFolder.ts:553-571` : dans le dossier privé du téléphone, `writeAtomically` écrit `<nom>.tmp` puis le renomme ; en cas d'erreur, le `.tmp` est effacé. Un plantage de l'application (pas une erreur rattrapée) entre l'écriture complète du `.tmp` et la fin du renommage laisse un `.tmp` complet sans son `.gpx` : la session est perdue, puisque la reprise des sessions en attente (`src/hooks/useSessionLibrary.ts:1216-1231`) ne liste que les `.gpx` (`isGpxFileName`). Un `.tmp` tronqué (plantage pendant l'écriture) reste là pour toujours.
- À faire : à la reprise des sessions en attente, lister aussi les `*.gpx.tmp` (et `*.imu.tmp`) ; pour chacun : si le `.gpx` du même nom existe, effacer le `.tmp` (reste d'une écriture dont la cible est là) ; sinon, le lire ; s'il est complet (un GPX qui se termine par `</gpx>` et que `addGpx` accepte), le ranger comme une session en attente, puis l'effacer ; s'il est vide ou illisible, l'effacer et le dire dans le journal des erreurs (`reportError`, une ligne). Le `.imu.tmp` suit la même règle (capteurs facultatifs). Tout ce qui est décidable sans fichier (quels noms sont des `.tmp` à reprendre, quel `.tmp` va avec quel `.gpx`, complet ou non) va dans une fonction pure testée.

### B. Le GPX complet perd les champs de fiche illisibles

- Depuis le lot 54, une fiche gardée sur le disque conserve ses champs illisibles (d'une version future ou abîmés) tels quels : `parseRecordWithRaw` rend `parts` et `unreadable`, `serializeRecord(record, unreadable)` les réécrit (`useSessionLibrary.ts:305-323`, `:477`, `:556`). Mais le GPX complet (`src/library/sessionBundle.ts` : `bundleSessionGpx` ligne 115 et `unbundleSessionGpx` ligne 150) sérialise la fiche sans ses champs illisibles à l'export (`SessionNameEditor.tsx:68`) et les ignore à l'import (`parseRecordParts`, `useSessionLibrary.ts:1663-1669`, qui ne passe `unreadable` que depuis une fiche posée à côté).
- À faire : à l'export, écrire la fiche avec ses champs illisibles (`serializeRecord(record, unreadableOf(f, file))`, à faire remonter jusqu'au point d'export) ; à l'import, lire la fiche embarquée par `parseRecordWithRaw` et passer son `unreadable` à `addGpx` comme pour la fiche posée à côté. Test dans `sessionBundle.test.ts` : un GPX complet dont la fiche porte un champ inconnu fait l'aller-retour sans le perdre.

### C. Un GPX de 0 octet du dossier du navigateur est listé « illisible »

- Un fichier `.gpx` vide (0 octet : écriture interrompue, fichier créé puis jamais rempli) dans le dossier de sessions du navigateur est traité comme une session illisible (`useSessionLibrary.ts:1097-1125`, `'unreadable'`, puis `src/core/gpxParser.ts:130-131` qui lève « XML mal formé » ; à vérifier : `DOMParser` sur une chaîne vide) et apparaît dans la liste, en erreur, à chaque ouverture.
- À faire : un GPX de 0 octet (ou blanc) n'est pas une session : il est ignoré de la liste sans message d'erreur, et compté parmi les fichiers ignorés là où Réglages › Mémoire les compte déjà (s'il n'y a pas de tel compte, ne rien ajouter à l'écran : le signaler dans le rapport). Il n'est pas effacé (jamais d'effacement d'un fichier de l'utilisateur sans son geste). Même règle à l'import (`useSessionLibrary.ts:1488`, `importReport.ts:32`) : compté « ignoré », pas « illisible ». La décision « ignoré, pas effacé » est tranchée par l'orchestrateur (question mineure, défaut sans perte) ; si un écran doit changer pour l'afficher, le dire au lieu de l'inventer.

## Garde-fous

- Règle 12 : fichiers par `src/platform/` seulement ; `useSessionLibrary` passe par `MemoryFolder`.
- Aucune donnée de l'utilisateur effacée hors des `.tmp` du dossier privé de l'application (qui sont à elle). Aucune réécriture de fiche existante.
- `SUMMARY_CALC_VERSION` inchangé (rien de recalculable ne change).
- Tests : `src/platform/memoryFolder.pending.test.ts` (séquence `.tmp` puis rename), `src/library/sessionBundle.test.ts`, `src/hooks/useSessionLibrary.memoire.test.ts` (sessions en attente), `src/library/importReport.test.ts` ; en ajouter pour A (fonction pure), B (aller-retour) et C (fichier vide ignoré, compté).
- Pas de `docs/`, pas de commit, pas de version.

## Preuve

- `node outils/verif.mjs --rapide` ; l'orchestrateur lance ensuite `npm run verif`, la relecture et le banc (`library`, `vides`, `imports` : texte identique, sauf le compte des fichiers ignorés si un GPX vide y figure).

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; pour A, B, C : ce qui change pour l'utilisateur, le test qui le prouve ; fichiers touchés ; ce qui n'a pas pu être fait (par exemple B si `unreadable` n'est pas atteignable depuis le point d'export sans élargir le lot).
