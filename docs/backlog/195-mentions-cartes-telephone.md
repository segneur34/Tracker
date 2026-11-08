# 195 · Cadre des mentions des cartes encore trop grand sur téléphone (suite du lot 192)

Noté le 07/11 (essai 142 : « mieux mais ça reste grand »). Modèle | Réflexion : Sonnet | high. Petit, commun aux deux versions : à faire avant le fork. Solution choisie par l'utilisateur le 07/11 : **une ligne, à déplier**.

## Aujourd'hui

- `src/core/mapBase.ts` : `MAP_BASES.osm.attribution` = `&copy; <a …>OpenStreetMap</a>` ; `MAP_BASES.satellite.attribution` = `Imagerie &copy; Esri, Vantor, Earthstar Geographics, GIS User Community &middot; Powered by Esri`, et `credit` (même texte en clair, pour l'image de partage et les vignettes, lot 188 : « d'un même texte tiré de mapBase »).
- `src/components/BaseTileLayer.tsx:81` pose l'attribution sur la couche ; ligne 227, `map.attributionControl?.setPrefix(false)` (le lien « Leaflet » est déjà retiré) : c'est là qu'on a la carte sous la main.
- `src/theme/base.css:57-67` (lot 192) : sur téléphone (`max-width: 767.98px`, ou `max-height: 499.98px` et pointeur grossier), cadre borné à 65 %, texte `--text-2xs` (10 px), retour à la ligne permis. Jugé encore trop grand.
- Leaflet 1.9 n'a pas de contrôle d'attribution repliable : il faut le faire soi-même (une classe sur le conteneur du contrôle, basculée au toucher).

## Voulu (téléphone seulement ; rien ne change sur ordinateur)

1. **Une seule ligne** : `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, largeur bornée (65 % reste bien), **12 px** de texte pour le satellite (recommandation d'Esri ; le lot 192 avait mis 10 px : choisir la variable du thème la plus proche de 12 px, `--text-xs` sans doute, à vérifier dans `src/theme/tokens.css`).
2. **« © OpenStreetMap » reste toujours affiché** en plan (la règle des serveurs d'OSM interdit de cacher la mention derrière un bouton ou hors de l'écran) : en plan, le texte est court et tient sur la ligne ; vérifier qu'il n'est jamais coupé aux plus petites largeurs (320 px), sinon réduire la marge plutôt que le texte.
3. **Satellite : « Powered by Esri » en tête**, puis les noms : réordonner `MAP_BASES.satellite.attribution` et `credit` en `Powered by Esri &middot; Imagerie &copy; Esri, Vantor, Earthstar Geographics, GIS User Community` (un seul texte pour la carte, l'image de partage et les vignettes, comme au lot 188). La ligne coupée montre donc « Powered by Esri · Imagerie © Esri, Van… ».
4. **Dépliable d'un toucher** (Esri demande de pouvoir lire tous les noms sur petit écran) : un toucher sur le cadre bascule une classe (par exemple `is-open`) sur le conteneur `.leaflet-control-attribution` ; ouvert, le cadre repasse en `white-space: normal` et montre tout ; un second toucher le replie. Leaflet coupe déjà la propagation des clics sur ses contrôles : le toucher ne déplace pas la carte. À poser dans `BaseTileLayer.tsx` près de `setPrefix(false)`, avec retrait de l'écouteur au démontage ; une seule fois par carte (plusieurs cartes vivent en même temps : analyse et vignette, direct et plein écran). Un libellé d'accessibilité (`aria-expanded`, `role="button"`) sur le conteneur.
5. À vérifier au lot, et dire le résultat dans le rapport : la liste des noms face au `copyrightText` du service Esri (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=pjson`, lecture par `curl` si le réseau le permet ; sinon le dire), et l'exemple d'attribution d'Esri en citant davantage. Ne pas ajouter de noms sans source lue.

## Banc

- `outils/banc/satellite.mjs` : son filtre `pageText` (ligne 59) et ses verdicts citent le texte exact de la mention : les adapter au nouvel ordre. Ajouter un verdict téléphone (viewport 390×844 et 320×640, pointeur grossier si le script sait le poser, sinon la largeur suffit) : le cadre tient sur une ligne (hauteur du `.leaflet-control-attribution` égale à une ligne de texte), « OpenStreetMap » entier dans le texte visible en plan, un clic l'ouvre (classe posée, hauteur qui grandit), un second le referme.
- `tailles.mjs` : relevé à rejouer par l'orchestrateur ; aucun changement attendu hors de ce cadre.
- Consigner dans `outils/banc/SCRIPTS.md`.

## Vérification

`node outils/verif.mjs --rapide` ; un test qui fige le nouvel ordre du texte Esri si un test existant fige l'ancien (chercher « Powered by Esri » dans `src/**/*.test.ts`). Version à augmenter par l'orchestrateur. Essai au téléphone (par l'orchestrateur, dans le reste à faire) : une analyse voile en satellite, le cadre tient sur une ligne, un toucher l'ouvre.
