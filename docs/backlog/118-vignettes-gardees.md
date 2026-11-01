# 118 · Bibliothèque : vignettes gardées d'un lancement à l'autre

Brief écrit le 01/11 d'après l'audit en lecture seule du même jour. Modèle | Réflexion : Opus | high.

## Le fait

À chaque lancement, chaque vignette qui approche de l'écran relit le GPX entier de sa session et refait sa cinématique, sur le fil de l'affichage (`pages/SessionLibrary.tsx:260-285`, `library/sessionTrack.ts:39-41`). Les caches (`previewMeta`, `previewPoints`, `previewImages`, l. 186-224) vivent en mémoire seulement : la première ouverture de la bibliothèque recalcule 6 à 10 vignettes d'un coup, soit plusieurs secondes figées au téléphone (estimation d'après HISTORIQUE n° 197, à mesurer).

## Décision de l'utilisateur (01/11)

Les traces réduites des vignettes sont gardées sur l'appareil d'un lancement à l'autre. Cela remplace « images en mémoire seulement, ni fiche ni Cache » de DECISIONS §8 (Bibliothèques), à mettre à jour à la passe doc. Les images dessinées restent en mémoire ; seuls les points réduits et leur emprise sont gardés.

## À faire

1. Garder, par vignette, ce que `loadTrack` produit (points réduits au zoom de la vignette, `bounds`, `suggested`), sous la clé qui tient déjà tout ce dont la trace dépend (`cacheKey`), complétée de la taille et de la date du GPX. Au lancement, une entrée trouvée dessine la vignette sans relire le GPX.
2. Stockage par `src/platform/` seulement (règle 12), hors du stockage clé-valeur de quelques Mo s'il y est : fichier privé de l'appli ou équivalent navigateur ; borné en taille (l'ordre de quelques Mo), les moins récentes oubliées d'abord ; entrées des sessions supprimées ou inconnues retirées au lancement.
3. Rien dans la fiche, rien dans le dossier mémoire (ce n'est pas une donnée de session).
4. Mesurer au banc, avant et après, le temps jusqu'à la dernière vignette visible au deuxième lancement, processeur ralenti ; le dire dans le rapport.

Tests purs sur la clé, la borne et le tri ; `npm run verif` ; banc bibliothèque (texte inchangé, vignettes identiques).

## Essai au téléphone à prévoir

- Ouvrir la bibliothèque, quitter l'appli, la relancer et rouvrir la bibliothèque → les vignettes apparaissent tout de suite, identiques.

## Ce que le lot ne fait pas

Pas de commit, pas de version. Ne pas toucher à `hooks/useSessionLibrary.ts` (n° 116 et 113). Pas de calcul en arrière-plan (n° 114). Rien dans `docs/` hors ce fichier.

## Questions tranchées par l'orchestrateur (01/11, au plan)

- Empreinte d'une vignette : sport, allure, famille, `summary.startMs`, `summary.endMs`, `summary.pointCount` et une version propre, au lieu de la taille et de la date du GPX, que la page ne voit pas (entrées du dossier privées à `useSessionLibrary.ts`, lot 116) ; un GPX rangé n'est jamais réécrit, cela suffit.
- Un seul document par appareil (fichier `vignettes.json` dans `Directory.Data` au téléphone, Cache API au navigateur), borné à 3 Mo, les moins récemment vues oubliées d'abord ; une seule entrée par session ; pas de bouton « Vider » ; la courbe de FC des vignettes reste hors du lot.
