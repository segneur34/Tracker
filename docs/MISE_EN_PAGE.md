# Mise en page d'une page d'analyse

Patron commun aux modules d'analyse (voile ; course et vélo, qui partagent `LandModule`) et à tout sport à venir. Ce qui est commun passe par des pièces partagées, pour qu'une règle ne s'écrive qu'une fois ; ce document dit lesquelles et dans quel ordre les poser. Les signatures se lisent dans le code.

## Structure, de haut en bas

1. **Feuille** (`.an-sheet`), réduite à l'en-tête (`.an-sheet__head`) : `PageHeader` avec le retour à la liste du sport, le titre « Analyse … », et `SessionNameEditor` en sous-titre (nom de la session, « Renommer » et un « … » qui télécharge le GPX).
2. Barre « Non enregistré / Enregistrer la session » (`SessionSaveBar`), pendant un brouillon seulement (la course ne passe pas `kept`, et la voile non plus).
3. **Rangée de la carte** (`.an-map-row`) : le bloc `AnalysisMap`, seul.
4. **Colonne des onglets** (`.an-carte-col`), sous la carte : `SectionTabs`, puis leurs **panneaux** (`.an-carte-panels`), chacun dans un `ResizablePanel` d'`id` unique, titré par `PanelTitle`, qui le replie.
   - Le premier onglet, « général », est le seul ouvert au départ (avec « fractionné » quand la session en a, point 89) ; ensuite, les onglets ouverts sont mémorisés par module (`useOpenSections`). Il porte la synthèse de la session (`.an-sheet__stats an-sheet__stats--always`) : distances, temps, ratio actif, vitesses moyennes, et le dénivelé en course et à vélo ; en voile, le vent suit. On le replie pour comparer les tableaux à la carte.
   - Le dernier onglet, « réglages », porte ceux de la session : activité, seuils, terrain (course, vélo), source de vitesse ou d'altitude, bornes de couleur de la trace (`SpeedRangeEditor`). Seuil, terrain et couleurs passent par le brouillon ; l'activité et la source d'altitude s'appliquent tout de suite.
   - La même disposition en voile, en course et à vélo (point 86).

## Règles communes

- **Deux dispositions, une seule rupture** : 768 px, la même que la barre de navigation (`AppShell.css`). `analysisMobile.css` porte les deux ; ses règles de téléphone valent sous cette largeur.
- **Sur ordinateur** :
  - la carte est en haut, centrée, à `--analysis-map-width` (80 %, `theme/tokens.css`) : de chaque côté, la souris fait défiler la page sans zoomer la carte. Elle se redimensionne en hauteur ;
  - les panneaux vont deux par ligne (`HALF_PANEL_STYLE`, `components/styles.ts`), un seul quand la moitié n'atteint plus 420 px, alignés en haut ; un panneau qui a besoin de toute la largeur la prend (détails des manœuvres) ;
  - un simple bloc en demi-ligne doit compter sa marge intérieure (`box-sizing: border-box`, porté par `HALF_PANEL_STYLE`), sinon il ne tient plus à côté de son voisin.
- **Sur téléphone** :
  - l'en-tête tient sur une ligne, tout en haut (`order: -2`) : la flèche de retour, le nom et « Renommer ». Le titre et le texte du lien de retour restent lus par un lecteur d'écran ;
  - la rangée de la carte s'efface (`display: contents`) : la carte suit l'en-tête (`order: -1`), en pleine largeur, haute de 30 vh ; la colonne d'onglets (`an-carte-col`) vient ensuite ;
  - les onglets sont de petites pastilles serrées, sans trait dessous, qui suivent de près la carte ;
  - les blocs `ResizablePanel` y sont en pleine largeur, sans poignée, à leur hauteur par défaut ; les explications longues se replient derrière `HelpButton` ;
  - un toucher sur la carte l'ouvre en plein écran (× pour fermer) ;
  - rien n'élargit la page : une colonne de panneaux ne dépasse pas l'écran (`min-width: 0`, `max-width: 100%`), un contenu de largeur fixe défile dans son panneau ; un tableau se resserre, ou passe ses lignes en grille (libellé sur sa propre ligne, valeurs dessous), comme le panneau Manœuvres (`an-man-*`).
- **La légende de couleur de la trace est posée sur la carte**, en une ligne compacte, en bas à droite, juste à gauche de la mention OSM (contrôle Leaflet d'`AnalysisMap`, coin mis en ligne par `.an-map-corner`), dans la carte et dans sa vue plein écran. Ce que dit le gris passe dans son titre. Elle ne fait qu'afficher : les bornes se saisissent dans l'onglet réglages.
- **Une seule surbrillance sur la carte** (`useMapHighlight`) : montrer un top, un podium, une zone, une répétition, un saut ou un revêtement retire la précédente ; fermer son onglet l'efface. Couleurs de `components/highlightColors.ts`.
- **Graphes reliés à la carte** : dans `ZoomableChart` (deux doigts, zone tirée à la souris, « Tout voir »), `onMouseMove` et `onTouchMove` vers `hoveredTrackIndex`, `onLeave` qui efface le repère (`HoverMarker`) ; deux graphes du même axe partagent un `useChartZoom`.
- **Tout panneau est repliable par son titre** (`PanelTitle`) et par son onglet, et redimensionnable (`ResizablePanel`). L'`id` d'un panneau est la clé de sa taille mémorisée : ne pas le renommer.
- Couleurs, rayons, espacements : les variables de `theme/tokens.css`. Les couleurs de données des graphes et de la carte restent en dur.

## Pièces partagées

| Pièce | Rôle |
|---|---|
| `components/AnalysisMap.tsx` | Carte, légende donnée par le module posée dessus, plein écran au toucher |
| `pages/analysisMobile.css` | Disposition téléphone (classes `an-*`) |
| `components/PanelTitle.tsx` | Titre de panneau qui le replie |
| `components/SessionNameEditor.tsx` | Nom de la session, « Renommer », et « … » (`ui/MoreMenu.tsx`) pour télécharger le GPX |
| `components/SectionTabs.tsx`, `components/ResizablePanel.tsx` | Onglets, panneaux redimensionnables |
| `components/SpeedGradientLegend.tsx`, `components/GradeGradientLegend.tsx` | Les légendes de la vitesse et de la pente, en lecture seule, passées à `AnalysisMap` |
| `components/styles.ts` | `CARD_STYLE` des panneaux, `HALF_PANEL_STYLE` pour deux panneaux par ligne |
| `components/SpeedRangeEditor.tsx` | Saisie des bornes de couleur de la trace, dans l'onglet réglages |
| `components/SessionSaveBar.tsx` | Barre du brouillon de la session |
| `core/trackColor.ts`, `components/TrackSegmentsLayer.tsx` | Trace colorée par la vitesse, la même dans l'analyse et la vignette |
| `hooks/useMapHighlight.ts`, `components/highlightColors.ts` | La surbrillance unique de la carte et ses couleurs |
| `components/SurfaceHighlight.tsx` | Un revêtement choisi dans `SurfaceBar`, en violet sur la carte (analyse et planification) |
| `components/ZoomableChart.tsx`, `hooks/useChartZoom.ts`, `components/HoverMarker.tsx` | Graphe zoomable, son zoom, le repère du survol sur la carte |

## Propre à chaque sport

Ce que la page choisit, dans le cadre ci-dessus :
- les chiffres de sa synthèse ;
- le contenu de son onglet réglages ;
- ses onglets et ses panneaux ;
- les couches de sa carte (trace colorée, repères, manœuvres) ;
- l'unité et le libellé du gris de la légende ;
- la hauteur par défaut du bloc carte.

## Brancher un nouveau sport

1. La page importe `analysisMobile.css`. Sa racine porte `an-page`, et l'en-tête va dans `an-sheet` > `an-sheet__head`. La synthèse va dans un premier onglet « général », ouvert par défaut.
2. En sous-titre du `PageHeader` : `SessionNameEditor` sur le fichier de la session.
3. Des sections `*_SECTIONS` et `*_SECTION_DEFAULTS`, avec un `useOpenSections` propre au module. Chaque panneau est titré par `PanelTitle`.
4. La rangée `.an-map-row`, qui contient `AnalysisMap` seul : `panelId` unique, couches de la carte, sa légende ; la largeur est commune. Puis `.an-carte-col` : `SectionTabs` et `.an-carte-panels`, chaque panneau en `HALF_PANEL_STYLE`.
5. Au banc (`outils/banc/`), vérifier la page sur ordinateur et à 390×844.
