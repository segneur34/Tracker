# 46 · Planification : altitude de l'IGN pour une trace importée

Brief écrit le 31/10 par l'orchestrateur (`/chaine`), à la demande de l'utilisateur d'ajouter cet élément à la chaîne. Modèle | Réflexion : Sonnet | high. Petit lot ; touche `planning/` et `PlanningPage` seulement, ni l'enregistrement ni les fiches de session. Lire `docs/DECISIONS.md` §7 avant.

## Aujourd'hui

Un GPX chargé dans la planification est gardé tel quel en tronçons `imported` (`planning/route.ts`, `routeFromTrack`, vers la ligne 560) ; son altitude, celle du GPS, est lissée à la lecture sur 100 m le long de la trace (`DEFAULT_IMPORT_SMOOTHING_M`, `smoothElevationAlong` de `core/elevation.ts`), pour que le D+ et le temps estimé ne dépassent pas ceux de l'analyse. Les tronçons calculés par BRouter ont, eux, l'altitude d'un modèle de terrain. Décision du 27/10 (point 166, DECISIONS §7) : « l'altitude IGN d'une trace importée viendra plus tard ». C'est maintenant.

Les analyses de course et de vélo ont déjà ce mécanisme pour une session : `hooks/useTerrainElevation.ts` (échantillonnage par `terrainSamplePoints`, demande à `planning/ignAltimetry.ts` `fetchIgnElevations`, application par `applyTerrainElevation`, tout dans `core/terrainElevation.ts`). Ces pièces sont pures et réutilisables ; ne pas les dupliquer.

## Voulu

- Au chargement d'un GPX dans la planification (`PlanningPage.tsx`, vers la ligne 732, `routeFromTrack(parsed.points)`), demander à l'IGN l'altitude des points de la trace importée (échantillonnés comme pour une session, même pas), et la poser sur les points des tronçons `imported` à la place de l'altitude lissée du GPS. Le D+, le profil et le temps estimé de l'itinéraire suivent (ils lisent `eleM` des points, aucun lissage de plus : `routeTotals`, vers la ligne 808).
- Pendant la demande, en cas d'échec ou hors couverture de l'IGN (étranger, mer : l'IGN rend -99999), la trace garde l'altitude lissée du GPS, comme aujourd'hui ; rien ne bloque « Enregistrer » ni « Exporter le GPX » (DECISIONS §7 : ils ne sont grisés que pendant un calcul de tronçon). Un état lisible et discret (par exemple dans l'onglet « général » de la planification, à côté du D+ : « altitude IGN » ou « altitude du GPS », et « altitude IGN en cours… » pendant la demande), sans nouvelle disposition.
- Un tronçon `imported` coupé ou recollé par un point déplacé (`insertWaypoint`, `removeWaypoint`, vers les lignes 210 et 277 de `route.ts`) garde l'altitude déjà posée sur ses points : l'altitude vit dans les points, pas dans un état à part.
- L'itinéraire enregistré (`planning/routeRecord.ts`) garde l'altitude de ses points comme aujourd'hui : un itinéraire enregistré avec l'altitude IGN la retrouve tel quel à la réouverture ; aucun changement de forme de la fiche d'itinéraire. Si la forme doit changer, le dire dans le rapport et ne pas le faire.
- Réseau : une requête IGN au plus par chargement de GPX (par paquets de 5 000 points espacés d'1,1 s, déjà gérés par `fetchIgnElevations`), rien de répété à chaque rendu ; annulée ou ignorée si l'utilisateur charge un autre GPX ou vide l'itinéraire avant la réponse (vérifier qu'une réponse tardive ne se pose pas sur un autre itinéraire).
- Règle 12 : le réseau passe par `fetchJson` comme déjà fait dans `ignAltimetry.ts` ; rien d'autre de la plateforme.

## Tests et vérification

- Test pur sur la pièce qui pose l'altitude IGN sur les tronçons importés (par exemple `applyImportedElevation(route, samples)` dans `planning/route.ts` ou un fichier voisin, testée dans `route.test.ts`) : altitude posée sur chaque point par interpolation entre les échantillons ; points hors couverture laissés à leur altitude GPS lissée ; un tronçon non `imported` intact ; D+ recalculé par `routeTotals`.
- `npm run verif` à la fin ; `node outils/verif.mjs --rapide` pendant.
- Banc : `node outils/banc/passe.mjs planning` (il demande `--gpx` avec les quatre GPX d'essai, voir `outils/banc/scripts.mjs` ligne 78 et `LISEZMOI.md`) ; l'IGN est joint depuis le banc : la sortie « après » peut changer sur le D+ d'un GPX chargé, à relever et à expliquer dans le rapport (avant : D+ lissé du GPS ; après : D+ IGN). Si le banc n'a pas de réseau vers l'IGN, le dire.

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de produit ; ne touche pas aux coûts des types de voie (profil BRouter) ni à `useTerrainElevation` (analyses). Rien dans `docs/`.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; la pièce ajoutée et où l'altitude IGN est demandée ; ce que le banc `planning` a montré (D+ avant et après sur le GPX d'essai) ; essais au téléphone s'il en juge un nécessaire (sans doute aucun : tout se voit sur le PC).
