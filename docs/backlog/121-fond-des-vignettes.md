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

## Questions tranchées par l'orchestrateur (01/11, au plan)

- Magasin frère (`platform/previewImages.ts`, `library/previewImageStore.ts`), pas le magasin des tuiles : les comptes de Réglages, le plafond et « Vider » ne le voient pas, et c'est voulu (« Vider » laisse les vignettes intactes).
- Borne 10 Mo par défaut (`PREVIEW_IMAGE_DEFAULTS`), à ajuster d'après le poids moyen relevé par le banc si l'ordre de grandeur est faux ; les moins récemment vues oubliées d'abord.
- Rien n'est gardé en aspect économe (pas de fond, rien à attendre).
- Image incomplète (tuile manquante hors réseau) : pas gardée.
- `Capacitor.convertFileSrc` pour montrer le fichier sans base64 : reporté, hors lot.
- Une session sans calcul montrée dans deux familles réécrit son entrée en passant de l'une à l'autre, comme au lot 118.

## Plan (agent Plan, 01/11)

(1) Magasin : `src/platform/previewImages.ts` (neuf), bas niveau, `PreviewImageBackend` : `readIndex() / writeIndex(text) / read(name) → Blob|null / write(name, blob) / remove(names) / names()`. Téléphone : dossier `vignettes-images/` de `Directory.Data`, avec `index.json` dedans ; même `ensureDir` unique que `tileCache.ts` (piège du `recursive`) ; `blobToBase64` et `base64ToBlob` de `core/base64.ts`, `filesystem()` de `platform/files.ts`. Navigateur : Cache API `tracker-vignettes-images`, adresses fictives `/vignettes-images/<nom>.png` et `/vignettes-images/_index.json`.
`src/library/previewImageStore.ts` (neuf), calqué sur `library/previewStore.ts` : `createPreviewImageStore(backend, options)`, puis `previewImageStore` par défaut avec `onPageHidden` (repris de `platform/previewStore.ts`). Méthodes `stored(sessionKey, imageKey) → Blob|null`, `keep(sessionKey, imageKey, png)`, `prune(folderLabel, files)`, `flush()`. Une seule entrée par session, sous `previewKey(folderLabel, file)` comme au lot 118 ; l'index tient `{ image: imageKey complète, name, bytes, usedAt }`. Ordre d'écriture : le fichier sous un nom neuf, puis l'index en mémoire (réécrit 2 s après, ou aussitôt quand la page se cache), puis l'ancien fichier effacé : un arrêt brutal ne laisse jamais l'index pointer vers une image fausse. Au chargement, un seul `names()` : les fichiers absents de l'index sont effacés (orphelins), une lecture ratée retire l'entrée. Éviction par `previewEntriesToEvict` (`library/previewTracks.ts`) ; une image plus grosse que la borne n'est pas gardée ; `usedAt` rangé à la prochaine écriture.

(2) Clé : `imageKey` vaut déjà `${cacheKey}|${w}x${h}@${dpr}|econome/plan|${minMs}|${maxMs}`. Pour l'appareil, y ajouter `fingerprint` (début, fin, nombre de points, version des traces et `SUMMARY_CALC_VERSION`) et `PREVIEW_IMAGE_VERSION`, à augmenter dès que le dessin change (`TRACK_PREVIEW`, `LEAFLET_BACKGROUND`, dégradé, ordre de peinture, réduction). Fonction pure `previewImageKey({ cacheKey, fingerprint, width, height, pixelRatio, eco, minMs, maxMs })` dans `library/previewImages.ts` (neuf), plus `previewImageName(key)` : hachage court et stable (FNV-1a ou cyrb53, aucun n'existe dans `core/`) qui donne le nom de fichier.

(3) Ordre dans l'effet de `SessionLibrary.tsx` (l. 317-377) : 1. `previewImages.acquire(imageKey)`, inchangé. 2. Sinon, si `!eco` : `await previewImageStore.stored(storeKey, fullKey)` ; vignette coupée entre-temps : sortir sans créer d'URL ; sinon `held = true; setImage(previewImages.put(imageKey, URL.createObjectURL(blob)))` et sortir : pas d'image d'attente, on passe de « Carte… » à l'image finie d'un coup. 3. Sinon le chemin actuel ; `drawTrackPreview` rend `{ png, complete } | null` (un seul appelant), `complete` vrai si chaque tuile est un `Blob` (ni `null`, ni agrandissement d'une tuile de zoom inférieur) ; si `png` et `complete` : `void previewImageStore.keep(storeKey, fullKey, png)`. Les URL d'objet restent toutes tenues par `previewImages`.

(4) Nettoyage : dans l'effet `previewsPruned` (l. 532-536), `void previewImageStore.prune(library.folderLabel, files)` à côté de `previewStore.prune` ; reprend `unknownPreviewKeys` et efface les fichiers. `hooks/useSessionLibrary.ts` non touché.

(6) `outils/banc/vignettes-relance.mjs` : effacer aussi le cache `tracker-vignettes-images` avant le premier lancement ; dans `launch`, garder le temps « trace » et relever en plus le temps jusqu'au fond (heure d'apparition de chaque `img.src` visible ; quand l'ensemble change, hachage SHA-1 comme `HASHES` ; temps retenu = le plus grand des « vu à » des images dont l'empreinte égale la référence `finalHashes`, relevée avant les relances). Sortie : « trace » et « fond » par relance, médianes, nombre et poids moyen des images gardées (Cache API). `scripts.mjs` et `LISEZMOI.md` inchangés.

(7) Tests purs : `library/previewImages.test.ts` (la clé change avec chaque composant ; nom stable et distinct ; index lu, index d'une autre version vide, entrée abîmée oubliée seule) ; `library/previewImageStore.test.ts` avec un faux magasin sur le modèle de `previewStore.test.ts` (garder puis relire ; clé différente donc `null` ; remplacement efface l'ancien fichier ; borne et éviction ; image trop grosse refusée ; nettoyage ; orphelins effacés ; lecture ratée donc entrée retirée ; écriture différée et `flush`) ; `allTilesPresent` pure si sortie de `drawTrackPreview`. Fichiers touchés : `components/drawTrackPreview.ts`, `pages/SessionLibrary.tsx`, `outils/banc/vignettes-relance.mjs` ; neufs : `platform/previewImages.ts`, `library/previewImages.ts` (+ test), `library/previewImageStore.ts` (+ test). Ordre : banc « avant » avec le script étendu sur le code actuel (lancé par l'orchestrateur, pas par le lot) ; fonctions pures et tests ; `platform/previewImages.ts` ; `previewImageStore` et tests ; `complete` dans `drawTrackPreview` ; effet et nettoyage ; `npm run verif`.
