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
