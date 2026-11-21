# 225 · Enregistrer : carte orientée selon le téléphone

## Tel que noté

21/11/2026, 13:32 : « TRACKER ET GTRACKER dans le mode navigation il faut pouvoir orienter la carte en fonction du téléphone et pas forcément en fonction du Nord Sud »

## Aujourd'hui (vérifié le 21/11)

La carte du direct (`src/components/LiveMap.tsx`) a toujours le nord en haut ; seule la flèche de position tourne, d'après le cap de déplacement, ou la boussole à l'arrêt (`useCompassHeading`, `recording/heading.ts`).

## Voulu

Un bouton sur la carte du direct qui bascule entre « nord en haut » et « orientée » : la carte tourne pour que le haut de l'écran soit la direction du téléphone (boussole), la flèche pointant alors vers le haut. Utile surtout en suivant une trace.

## Pièges

Leaflet ne sait pas tourner une carte : il faut une extension (leaflet-rotate) ou faire tourner le conteneur en compensant tuiles, boutons et mention OSM ; règle 11 de CLAUDE.md (composants maison sur `leaflet`). La boussole bouge sans cesse : lisser et limiter les redessins. Capteurs uniquement par `src/platform/` (règle 12). Gtracker : à noter dans son propre reste à faire.

## Questions

Nord en haut ou orientée au départ ? Par défaut : nord en haut, comme aujourd'hui, et le choix gardé sur l'appareil.

## Plan (agent Plan, 21/11) et choix tranchés

Voie : l'extension leaflet-rotate (Leaflet 1.9.4 du dépôt, build UMD). Elle ne tourne qu'un calque (`rotatePane` : tuiles et tracés) ; contrôles (+/−, Plan · Satellite, mention OSM) et repères restent droits (`norotatePane`) ; glisser, pincer et `fitBounds` sont recalculés. La rotation CSS du conteneur est écartée (boutons et mention tourneraient ou sortiraient du cadre : le bricolage exclu par la consigne).

Risques : l'extension modifie `L` pour toutes les cartes de l'application dès son import et remplace le pincer partout ; la 0.6.2 est une réécriture toute récente (0.3 à 0.6.2 entre le 25/10 et le 14/11/2026), la 0.2.8 date de 2023.

Étape 1, la sonde, décide du blocage : dépendance figée (sans caret) et `Pane.tsx` seulement, puis banc avant/après sur les scripts de carte (analyses, planification, `trace-suivie`, `denivele-direct`) : texte identique. Si une carte change, si +/− ou la mention OSM tournent, ou si les tuiles du cache maison manquent dans les coins une fois la carte tournée : BLOQUÉ, on n'insiste pas.

Fichiers : `package.json` et `package-lock.json` ; `src/components/map/MapContainer.tsx` (import de l'extension, option `rotate`, avec `rotateControl`, `touchRotate`, `shiftKeyRotate`, `compassBearing`, `touchPitch` à faux : l'extension ne doit jamais lire la boussole elle-même, règle 12) ; `src/components/map/Pane.tsx` (nos calques créés dans `rotatePane`) ; `src/components/LiveMap.tsx` (`<MapContainer rotate>`, mode gardé sur l'appareil par `jsonStore`, clé `tracker.carteOrientee`, bouton sur le patron de `BaseSwitch`, sous Plan · Satellite, `aria-pressed`, titres « Carte orientée » / « Nord en haut » ; enfant `MapOrientation` qui s'abonne à `watchCompassHeading` et appelle `map.setBearing` sans état React ; flèche tournée de cap − `map.getBearing()`) ; `src/components/icons.tsx` (icône boussole) ; neufs : `src/types/leaflet-rotate.d.ts` (sans `any`), `src/recording/mapBearing.ts` et son test, `outils/banc/carte-orientee.mjs`.

Calcul pur `stepMapBearing(state, sampleDeg, timeMs, opts)` : lissage exponentiel sur le vecteur unitaire (`1 − exp(−dt/tauS)`, fenêtre en secondes, passage 359°/0° sans demi-tour), hystérésis `minChangeDeg`, cadence `minIntervalMs` ; `MAP_BEARING_DEFAULTS` (tauS 0,8, minChangeDeg 3, minIntervalMs 250) passé en paramètre. Tests : même cap final à 1 et 5 Hz ; 358, 359, 0, 1, 2 reste près de 0 ; bruit de ±2° sans rendu ; saut de 90° ; sans mesure ; long trou.

Banc `carte-orientee.mjs` : faux événements `deviceorientationabsolute`, bouton et état, rotation du calque, contrôles droits, mention OSM visible, 359° → 0°, choix gardé après rechargement, 0 en mode nord.

Tranché par défaut la nuit du 21/11, à confirmer :
- Une dépendance neuve qui modifie Leaflet pour toutes les cartes est acceptée, à condition que la sonde prouve les autres cartes inchangées. Version : la 0.2.8 de 2023 de préférence, si elle fait le travail avec Leaflet 1.9.4 ; la 0.6.2, vieille d'une semaine, seulement si la 0.2.8 ne suffit pas, et alors dit en clair dans le rapport.
- La carte suit la boussole du téléphone (comme demandé), pas la direction du déplacement.

Tranché par l'orchestrateur : nord en haut au départ, choix gardé sur l'appareil ; carte déplacée à la main : elle reste orientée, « Recentrer » reprend le suivi ; pas de réglage dans Réglages.
