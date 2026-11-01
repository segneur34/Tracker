# 121 · Bibliothèque : le fond de carte des vignettes, lui aussi, d'un lancement à l'autre

Brief écrit le 01/11 (paquet de 5 du 01/11 : 119, 120, 112, 114, 121). Modèle | Réflexion : Opus | high (relevé de medium par l'orchestrateur : plusieurs fichiers, un magasin de plus sur l'appareil). Plan par l'agent `Plan` d'abord.

## Le fait

Depuis le lot 118, la trace de chaque vignette arrive tout de suite au relancement (points réduits gardés dans `vignettes.json`, `library/previewStore.ts`, `platform/previewStore.ts`). Mais le fond de carte suit avec une légère latence (essai 97 du 01/11) : `drawTrackPreview` (`components/drawTrackPreview.ts`) dessine d'abord la trace seule (`onTrace`), puis charge les tuiles une à une par `loadMapTile` (`platform/mapTiles.ts`, qui relit le cache des tuiles : fichiers de `Directory.Data` au téléphone, Cache API au navigateur), les décode, redessine et encode un second PNG. Au téléphone, chaque tuile est une traversée du pont Capacitor en base64 : six à douze par vignette, pour six à dix vignettes visibles.

## Décision de l'orchestrateur (01/11)

L'image **finie** de chaque vignette (trace sur son fond) est gardée sur l'appareil, sous la clé de l'image (`imageKey` de `pages/SessionLibrary.tsx` : clé de la trace, taille, densité, aspect économe ou plan, bornes de couleur), et montrée d'emblée au relancement ; la trace seule reste l'image d'attente quand l'image finie manque. Cela remplace « images dessinées en mémoire seulement » de `docs/DECISIONS.md` §8 (Bibliothèques), à mettre à jour à la passe doc ; l'idée vient de l'utilisateur après l'essai 97.

## À faire

1. **Un magasin d'images de vignettes** sur l'appareil, par `src/platform/` seulement (règle 12) : un PNG par clé, borné (quelques Mo, les moins récemment vues oubliées d'abord), entrées des sessions supprimées ou inconnues retirées au lancement avec celles de `vignettes.json` (`prune`). Le plan dit s'il réutilise le magasin des tuiles (`platform/tileCache.ts` : fichiers plus index, plafond, éviction) sans fausser les comptes de Réglages (« tuiles gardées », « dont satellite »), ou s'il en fait un frère sur le même modèle. Hors du stockage clé-valeur et hors du dossier mémoire : ce n'est pas une donnée de session.
2. **À l'affichage d'une vignette** : image en mémoire (`previewImages`), sinon image gardée sur l'appareil (montrée sans attendre), sinon dessin comme aujourd'hui, puis l'image finie est gardée. Une image gardée dont la clé ne correspond plus (taille, densité, bornes, aspect) n'est pas montrée ; une tuile absente au premier dessin (hors réseau) donne une image incomplète : la garder quand même ou non, le plan tranche et le dit (par défaut : ne garder que les images dont toutes les tuiles étaient là).
3. **Mesure** : étendre `outils/banc/vignettes-relance.mjs` pour relever aussi le temps jusqu'au fond de carte (images finies identiques au premier lancement, pas seulement la trace), processeur ralenti ×6 comme il le fait déjà ; chiffres avant et après dans le rapport.

## Vérifications

Tests purs sur la clé, la borne, l'éviction et le nettoyage ; `npm run verif` ; puis le banc, lancé par l'orchestrateur : `library`, `vignettes`, `vignettes-relance` (texte inchangé, vignettes identiques).

## Essai au téléphone à prévoir

- Ouvrir la bibliothèque, quitter l'appli, la relancer et rouvrir la bibliothèque → chaque vignette apparaît entière d'un coup, fond de carte compris, identique à avant.

Lire avant : `docs/DECISIONS.md` §8 (Bibliothèques, Fond des cartes, Cartes hors ligne), `docs/backlog/118-vignettes-gardees.md` (ce que le lot 118 a tranché et pourquoi), HISTORIQUE point 252, `CLAUDE.md` règle 12.

## Ce que le lot ne fait pas

Pas de commit, pas de version. Ne pas toucher à `hooks/useSessionLibrary.ts` (n° 113 et 116) ; si `prune` a besoin de la liste des sessions, la prendre par le chemin que `previewStore.prune` emprunte déjà. Ne pas toucher à `sailing/` (lot 112), `pages/SailingModule.tsx`, `components/BaseTileLayer.tsx`, `components/ui/MoreMenu.tsx`, `components/ActivitySelect.tsx`, `components/GearPicker.tsx` (lot 120), ni créer d'autre script du banc que l'extension de `vignettes-relance.mjs` (lot 114 ajoute `fluidite.mjs`) ; `scripts.mjs` et `LISEZMOI.md` ne changent que si l'extension l'exige. Rien dans `docs/` hors ce fichier.
