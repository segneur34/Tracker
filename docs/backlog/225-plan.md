# 225 · Plan du 25/11 (agent Plan) : notre propre rotation de carte, et choix tranchés

Brief : `docs/backlog/225-carte-orientee-telephone.md`. Décision de l'utilisateur du 25/11 (réponse à Q74) : on écrit notre propre rotation, sans extension ni dépendance neuve. Ce plan remplace celui du 21/11 pour la voie technique ; les choix d'usage du 21/11 restent (boussole du téléphone, nord en haut au départ, choix gardé sur l'appareil, bouton sous Plan · Satellite, carte déplacée à la main qui reste orientée, « Recentrer » qui reprend le suivi, pas de réglage dans Réglages).

Vérifié : la carte du direct dessine en SVG (aucun `preferCanvas`, `Polyline` de `map/paths.tsx`) ; le Canvas ne sert qu'aux analyses (`TrackSegmentsLayer`).

## Voie retenue : un « rotor »

Un `div` à nous est glissé entre le conteneur Leaflet et `mapPane`, puis tourné par CSS autour du centre du cadre. Le conteneur et les contrôles ne bougent pas ; tout ce qui dessine sur la carte tourne d'un bloc (tuiles, tracés, calques `Pane`, repères). Leaflet calcule comme sur une carte droite. Deux corrections, sur cette seule carte, sans toucher à aucun prototype :
1. `map.mouseEventToContainerPoint` surchargée sur l'objet de la carte : le point touché est ramené dans le repère de la carte avant tout calcul (pincer, molette, double tap, clics).
2. Le glisser, par un écouteur `predrag` sur `map.dragging._draggable` : il reprend le déplacement brut, `(_newPos − _startPos) × _parentScale`, et le tourne ; l'élan reste juste.
3. Couverture des coins indépendante de l'angle : en mode orienté, on charge le carré de la diagonale ; la rotation se réduit à changer un `transform` CSS, sans travail de Leaflet, donc sans saccade. `CachedTileLayer` reçoit `_getTiledPixelBounds` et `viewOf` lit `coverSizeOf(map) ?? map.getSize()` : pour les autres cartes la valeur est nulle et le code suivi est celui d'aujourd'hui. La marge (`options.padding`) des moteurs SVG de cette carte s'élargit : celui de la carte et ceux des calques nommés (`eachLayer` puis `layeradd`).
4. La flèche n'a besoin d'aucun code : elle tourne avec la carte, son angle à l'écran vaut cap − rotation. Les chiffres des balises et les fanions des notes sont redressés par une variable CSS `--map-bearing`, autour de leur point d'ancrage.
5. Passage 359° → 0° sans tour complet : l'angle donné au CSS est « déroulé », et une transition de 250 ms adoucit chaque pas.

Écartées : un calque tourné à l'intérieur de `mapPane` comme la branche rotate de Leaflet (toutes les conversions point ↔ coordonnées à refaire, pivot qui suit les déplacements, pose des repères : plus de code et de risques) ; le conteneur entier tourné (Leaflet mesure le conteneur pour situer chaque toucher, les contrôles sortis perdent les styles de Leaflet, le cadre de la mention OSM se calcule sur la largeur de la carte).

## Risques

- Champs internes de Leaflet 1.9.4 : `_draggable`, `_startPos`, `_newPos`, `_parentScale`, `_getTiledPixelBounds` (version fixée par le fichier de verrouillage). Si un champ manque, la rotation refuse de s'activer et la carte reste nord en haut ; le banc le voit.
- En mode orienté, environ deux fois plus de tuiles chargées.
- Pendant les 250 ms de transition, l'angle affiché et l'angle de calcul diffèrent de quelques degrés.
- Le geste au doigt dans l'application Android ne se vérifie qu'au téléphone.
- Licence : aucun code repris de la branche rotate ; si un morceau l'était, en-tête « d'après Leaflet, branche rotate, BSD-2-Clause, © Vladimir Agafonkin ».

## Étape 1 : la sonde, qui décide

Seulement `rotation.ts` et l'option `rotatable` de `MapContainer`, angle fixé à la main depuis la console, sans boussole ni bouton.
- Banc avant/après sur `general`, `onglets`, `trace-suivie`, `denivele-direct`, `planification` : texte identique.
- En écran de téléphone (390×800), à 30°, 45° et 90° : `elementFromPoint` aux quatre coins et aux milieux des bords trouve une tuile (le banc est hors réseau : présence de l'élément, pas de l'image) ; +/−, Plan · Satellite et la mention OSM gardent leur position à l'écran et ne portent aucune rotation ; un glisser de 100 px (CDP) laisse sous le doigt le point de carte qui y était, à 2 px près ; un pincer à deux doigts sur le côté garde fixe le point entre les doigts ; aucune erreur de console.

BLOQUÉ si une autre carte change, si un contrôle bouge ou tourne, s'il manque une tuile dans un coin, si un écart de geste ne se corrige qu'en touchant un prototype, ou s'il y a une erreur de console.

## Fichiers

- Neufs : `src/core/screenRotation.ts` et son test (`rotateAround(p, c, deg)`, `coverSquareSide(w, h)`, `svgPaddingFor(w, h)`, `unwrapDeg(prev, next)`, `zoomDeltaForAnyBearing(bw, bh, w, h)` : zoom pour que l'emprise de la trace suivie tienne quel que soit l'angle) ; `src/components/map/rotation.ts` et le CSS du rotor et de la classe `map-upright` (`attachRotation(map)` rend `{ setEnabled, setBearing, dispose }` ; `coverSizeOf(map)` et `rotationOf(map)` lus dans une `WeakMap`) ; `src/recording/mapBearing.ts` et son test, repris tels quels de `docs/backlog/225-brouillon/` ; `src/hooks/useMapOrientation.ts` (`jsonStore`, clé `tracker.carteOrientee`, `useSyncExternalStore`, patron de `hooks/useMapBase.ts`) ; `outils/banc/carte-orientee.mjs`.
- Modifiés : `map/MapContainer.tsx` (option `rotatable`, fausse par défaut) ; `BaseTileLayer.tsx` (couverture des tuiles ; `useMapControl` extrait du patron de `BaseSwitch` vers `components/map/`, sans effet visible) ; `LiveMap.tsx` (`rotatable` ; enfant `MapOrientation` sans état React : `watchCompassHeading` de `platform/compass.ts` → `stepMapBearing` → `setBearing` ; bouton `OrientationSwitch` sous Plan · Satellite, `aria-pressed`, titres « Carte orientée » / « Nord en haut » ; classe `map-upright` dans `markIcon` ; cadrage de la trace suivie quand il n'y a pas encore de position) ; `SessionMarks.tsx` (classe sur le fanion, ancre `[1, FLAG_H]`) ; `components/icons.tsx` (`IconCompass`).
- Réutilisés tels quels : `core/angles` (`angleDiff`, `normalizeDeg`), `useMapEvents({ dragstart })` de `FollowPosition` (« Recentrer » reste tel quel), `MapAutoResize`.

## Ordre

1. La sonde. 2. `mapBearing` et `screenRotation`, avec leurs tests. 3. Couverture des tuiles et marge SVG, puis banc de neutralité. 4. Bouton, mémorisation du choix, `MapOrientation`, redressement des balises et fanions, cadrage de la trace suivie. 5. Banc, puis vérification.

## Tests

- `mapBearing` : les tests de `stepMapBearing` du brouillon.
- `screenRotation` : aller-retour écran → carte → écran ; 0° donne l'identité ; le carré couvre le cadre à tout angle (0 à 359°) ; la marge SVG couvre le carré pour un cadre étroit ; le déroulé 350 → 10 donne 370 ; l'emprise tient à 45°.

## Banc `carte-orientee.mjs`

Faux événements par `window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha, absolute: true }))`, espacés d'au moins 250 ms (`compass.ts` filtre à 200 ms), répétés environ 3 s pour que le lissage converge. Vérifie : le bouton et `aria-pressed` ; l'angle du rotor lu sur son style en ligne ; contrôles droits et mention OSM visible ; 359° → 0° sans tour complet ; choix gardé après rechargement ; retour à 0 en mode nord ; glisser puis « Recentrer » ; tracé SVG à l'intérieur du rotor ; coins couverts de tuiles. Plus le banc de neutralité de la sonde, et une ligne au journal de `outils/banc/SCRIPTS.md`.

## Tranché par l'orchestrateur le 25/11

- Tuiles du carré de la diagonale en mode orienté (environ deux fois plus) : compatible avec DECISIONS §8 (« jamais de téléchargement de zone à l'avance »). Ce sont les tuiles du cercle que l'écran montre dès que le téléphone tourne, pas une zone téléchargée à l'avance ; ne charger que l'emprise de l'angle du moment relancerait le calcul des tuiles à chaque degré.
- `screenHeading` et ses tests retirés s'ils ne servent plus nulle part (la flèche tourne avec la carte).
- Bulle d'une note : redressée si c'est simple, sinon laissée tournée.
- Bouton montré partout ; sans boussole (ordinateur), la carte reste nord en haut.
- Zoom par rectangle (Maj + glisser) et flèches du clavier coupés en mode orienté.
- Mode orienté aussi sur l'aperçu avant départ.
- Gtracker : à noter dans son propre reste à faire, pas ici.

## Essais au téléphone (peu)

1. Fluidité en tournant sur soi, écran allumé et après réveil.
2. Glisser et pincer sur la carte tournée.
3. La boussole réelle près d'un objet métallique (vélo).
