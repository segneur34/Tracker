# 113 · Mémoire des sessions : `useSessionLibrary.ts` découpé par sujet, comportement inchangé

Noté le 01/11 (audit, fichier de 2 957 lignes et 42 exports). Modèle | Réflexion : Opus | high. Brief écrit le 04/11 (paquet « Fluidité »). Passe après 159 A, qui remet d'aplomb les tests de la bibliothèque (simulations sans état) ; avant 126 B, qui déplacera la file des résumés vers un worker.

## Tel que noté

- « `hooks/useSessionLibrary.ts` (2 957 lignes, environ 140 déclarations) mêle ouverture de la mémoire et dossier, fichier de réglages, import, fiches et file de mise à jour des résumés ; le découper par sujet sans rien changer au comportement, chaque partie avec ses tests, banc avant/après sur la bibliothèque. »

## Où, aujourd'hui (relevé du 04/11)

- `scan` (≈ 1351), `runJob` (≈ 1493, `analyzeGpx` à 1526), `completeScan` (≈ 1585), `runCompleteScan` (≈ 1602), `queueOutdatedRefresh` (≈ 2863), `addGpx` (≈ 2174), `updateSessionRecord` (≈ 2558), `summarizeGpxText` (≈ 571), `parseGpx` appelé en 2124.
- Tests : `useSessionLibrary.{balayage,deuxappareils,memoire,perte,resumes}.test.ts` et `useSessionLibrary.test.ts` (tous remis d'aplomb par 159 A, à relire avant de couper).

## Voulu

- Un découpage par sujet, chaque fichier sous `hooks/sessionLibrary/` (ou `library/`, au choix du plan, selon que la pièce est pure ou tient un état React) : ouverture de la mémoire et dossier ; fichier de réglages de l'appareil ; import de GPX et de dossiers ; fiches (`updateSessionRecord`, écriture) ; file de mise à jour des résumés (`scan`, `runJob`, `completeScan`, `queueOutdatedRefresh`). `hooks/useSessionLibrary.ts` reste le point d'entrée avec les mêmes exports et les mêmes signatures : aucun appelant ne change.
- Fonctions pures sorties en premier, chacune avec son `*.test.ts` sur données synthétiques ; les tests existants continuent de passer sans réécriture autre que les chemins d'import.
- Règle 12 respectée : la plateforme reste derrière `src/platform/`.
- Rien ne change de visible : mêmes fiches, même ordre de balayage, même file, mêmes messages.

## Ne pas toucher

- `core/gpxParser.ts` et ses tests (lot 126 A, en parallèle), `pages/*Module.tsx`, `hooks/useChartZoom.ts`, `hooks/useTimeChartAxis.ts`, `components/ZoomableChart.tsx` (lot 127, en parallèle), `outils/banc/` (lot 159 B).

## Vérification

- `node outils/verif.mjs --rapide` ; `npx vitest run --sequence.shuffle` vert (graine 3 comprise).
- Banc : scripts `library*` et `vignettes`, textes identiques avant et après ; relevé des fiches (version `SUMMARY_CALC_VERSION` inchangée, 16).
- Rien à essayer au téléphone.

## Pourquoi

Un fichier de 3 000 lignes ne se relit ni ne se teste ; le worker du 126 B a besoin d'une file des résumés isolée pour l'appeler.
