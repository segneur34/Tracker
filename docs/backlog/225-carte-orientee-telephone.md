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
