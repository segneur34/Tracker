# 189 · Remplacer `react-leaflet` par des composants maison sur `leaflet`

Noté le 07/11, sorti du n° 171 (fiche 151) pour se faire **avant le fork** de la version vendue : `react-leaflet` et `@react-leaflet/core` sont sous licence Hippocratic 2.1 (non approuvée OSI, clauses de conduite, arbitrage public) ; `leaflet` lui-même est en BSD-2. Modèle | Réflexion : Opus | high, plan préalable par l'agent `Plan` (60 lignes), relecture avant le commit.

## Voulu

- Plus aucun import de `react-leaflet` ni de `@react-leaflet/core` dans `src/` ; les deux paquets retirés de `package.json` et du verrou ; l'exception nommée dans `core/licenses.ts` retirée (son test échoue tant qu'une exception devenue inutile reste) ; `dist/licences.json` sans eux après le build.
- Rien de visible : toutes les cartes se comportent exactement comme avant (fond, trace, flèches, repère de survol, surbrillances, balises, repères, revêtements, direct, planification, carte en plein écran, redimensionnement, zoom et déplacement au doigt). Preuve au banc : texte de page identique avant et après sur tous les scripts à carte (liste dans `outils/banc/SCRIPTS.md`), plus les scripts qui relèvent des tailles.
- Même interface interne : des composants maison `MapContainer`, `TileLayer` (si encore utilisé), `Polyline`, `CircleMarker`, `Marker`, `Popup`, `useMap` et ce que l'inventaire trouvera, dans `components/map/`, pour que les 16 fichiers changent surtout leur ligne d'import. `BaseTileLayer` et `TrackSegmentsLayer` sont déjà des couches maison sur `leaflet` : s'en inspirer (création dans un `useEffect`, retrait au démontage, mise à jour par `setStyle` / `setLatLngs`).
- La règle d'architecture 11 de CLAUDE.md (« react-leaflet : le style d'un `Polyline` passe toujours par `pathOptions` ») est réécrite **avec l'accord de l'utilisateur**, demandé quand le lot est FAIT, avant son commit. Proposition : « Cartes : composants maison sur `leaflet` (`components/map/`), jamais `react-leaflet` ; le style d'une ligne est réappliqué à chaque rendu (`setStyle`), sinon un changement de couleur ne se voit pas. »

## Où (relevé du 07/11)

`src/components/AnalysisMap.tsx`, `BaseTileLayer.tsx`, `HighlightPath.tsx`, `HighlightSpan.tsx`, `HoverMarker.tsx`, `LiveMap.tsx`, `MapAutoResize.tsx`, `SessionMarks.tsx`, `SurfaceHighlight.tsx`, `SurfaceLayer.tsx`, `TrackArrows.tsx`, `TrackSegmentsLayer.tsx`, `highlightColors.ts`, `mapStyles.ts` ; `src/pages/PlanningPage.tsx`, `SailingModule.tsx` ; `src/core/licenses.ts` et `licenses.test.ts` (exception). ≈ 45 emplois d'après l'audit (`angle-V1.md`).

## Pièges

- Un composant enfant de `MapContainer` doit obtenir la carte par un contexte React (`useMap`), pas par une variable de module : plusieurs cartes vivent en même temps (analyse et vignette, direct et plein écran).
- Ordre d'empilement : `react-leaflet` crée les couches dans l'ordre de rendu ; garder le même ordre (fond, revêtements, trace, surbrillances, flèches, repères, repère de survol) ou poser des `pane` explicites.
- `MapAutoResize` et le plein écran : `invalidateSize` au bon moment.
- Un fichier neuf avec un style en ligne fait échouer le cliquet `inlineStyles.test.ts` : relire le total, puis `node outils/styles-en-ligne.mjs --figer`.
- `Popup` et `Marker` avec contenu React : portail (`createPortal`) vers l'élément du popup, ou contenu HTML simple si c'est tout ce qui est utilisé (l'inventaire le dira).

## Vérification

`npm run verif` ; relecture ; `node outils/banc/passe.mjs` sur tous les scripts à carte ; `grep -rl react-leaflet src package.json` vide ; build sans `react-leaflet` dans `dist/licences.json`. Essai au téléphone : une analyse voile et le direct, pincer, zoomer, toucher la carte, repère de survol depuis un graphe, surbrillance d'un top, carte en plein écran puis retour.
