# Mise en page d'une page d'analyse

Patron commun aux modules d'analyse (voile ; course, vélo et fractionné, qui partagent `LandModule` ; surf) et à tout sport à venir. La page des statistiques (`StatisticsPage`) en reprend les onglets, les panneaux et leurs règles de téléphone (`an-page`, `an-carte-panels`, `an-sheet__stats`), sans carte ni en-tête de session. Ce qui est commun passe par des pièces partagées, pour qu'une règle ne s'écrive qu'une fois ; ce document dit lesquelles et dans quel ordre les poser. Ses règles sont des décisions de l'utilisateur, de même autorité que `CLAUDE.md` : rien ne s'y change sans lui. Les signatures se lisent dans le code.

## Structure, de haut en bas

1. **Feuille** (`.an-sheet`), réduite à l'en-tête (`.an-sheet__head`) : `PageHeader` avec le retour à la liste du sport, le titre « Analyse … », et `SessionNameEditor` en sous-titre (nom de la session, « Renommer » et un « … » qui partage la session en image ou télécharge le GPX).
2. Barre « Non enregistré / Enregistrer la session » (`SessionSaveBar`), pendant un brouillon seulement (la course ne passe pas `kept`, et la voile non plus).
3. **Rangée de la carte** (`.an-map-row`) : le bloc `AnalysisMap`, seul.
4. **Colonne des onglets** (`.an-carte-col`), sous la carte : `CollapsibleSectionTabs`, en deux rangées (HISTORIQUE, point 137). La première porte les onglets `primary` (« général », et « fractionné » en famille Fractionné), la pastille « avancé » et, en fin de rangée, la flèche qui cache la barre d'onglets seule, partout, téléphone compris ; cachée, il reste un bouton fin « onglets » qui la rend et disparaît, panneaux ouverts inchangés ; un seul état pour toutes les analyses, retenu sur l'appareil (HISTORIQUE, point 121). « Avancé » (`useAdvancedTabs`, un état pour toutes les analyses) déplie dessous les autres onglets ; refermé, le module masque leurs panneaux (`maskAdvancedTabs`). Puis leurs **panneaux** (`.an-carte-panels`), chacun dans un `ResizablePanel` d'`id` unique, titré par `PanelTitle`, qui le replie.
   - Le premier onglet, « général », est le seul ouvert au départ (avec « fractionné » quand la session en a, HISTORIQUE, point 89) ; ensuite, les onglets ouverts sont mémorisés par module (`useOpenSections`). Il porte l'essentiel de la session (`GeneralStats`, liste `overviewStats` du module, à part de celle de l'image de partage) : distance, temps, moyennes, et ce qui compte dans le sport (manœuvres et tops en voile, meilleurs segments, D+ et profil d'altitude compact `ElevationProfileMini` à pied et à vélo, zoomable avec son « +carte », zoom à part de « graphiques ») ; en voile, le vent en mini-boussole (`WindCompass`) et « Régler », qui pose `WindAdjustOverlay` sur la carte (prop `overlay` d'`AnalysisMap`). On le replie pour comparer les tableaux à la carte.
   - Un onglet ouvert qui n'a rien à montrer pour la session dit pourquoi (`EmptyTabPanel`), sans être caché.
   - Le dernier onglet, « réglages », porte ceux de la session : activité, seuils, source de vitesse ou d'altitude, bornes de couleur de la trace (`SpeedRangeEditor`). Seuil et couleurs passent par le brouillon ; l'activité et la source d'altitude s'appliquent tout de suite.
   - La même disposition en voile, en course, à vélo, en fractionné et en surf (HISTORIQUE, points 86, 89 et 97).

## Règles communes

- **Deux dispositions, une seule définition du téléphone** : moins de 768 px de large, ou moins de 500 px de haut sur un écran tactile (téléphone tourné) ; une fenêtre d'ordinateur basse reste un ordinateur. Les requêtes sont dans `hooks/useNarrowScreen.ts` (`NARROW_QUERY`, son contraire `WIDE_QUERY`, et `PHONE_LANDSCAPE_QUERY` pour le téléphone tourné), recopiées telles quelles dans chaque `@media` ; `mediaQueries.test.ts` y veille. `analysisMobile.css` porte les dispositions. La taille du texte d'Android est suivie jusqu'à 130 %.
- **Sur ordinateur** :
  - la carte est en haut, centrée, à `--analysis-map-width` (80 %, `theme/tokens.css`) : de chaque côté, la souris fait défiler la page sans zoomer la carte ; sur la carte, la molette zoome toujours. Elle se redimensionne en hauteur ; les onglets viennent dessous ;
  - les panneaux vont deux par ligne (`HALF_PANEL_STYLE`, `components/styles.ts`), un seul quand la moitié n'atteint plus 420 px, alignés en haut ; un panneau qui a besoin de toute la largeur la prend (détails des manœuvres) ;
  - un simple bloc en demi-ligne doit compter sa marge intérieure (`box-sizing: border-box`, porté par `HALF_PANEL_STYLE`), sinon il ne tient plus à côté de son voisin.
- **Sur téléphone** :
  - l'en-tête tient sur une ligne, tout en haut (`order: -2`) : la flèche de retour, le nom et « Renommer ». Le titre et le texte du lien de retour restent lus par un lecteur d'écran ;
  - la rangée de la carte s'efface (`display: contents`) : la carte suit l'en-tête (`order: -1`), en pleine largeur, haute de 30 vh ; la colonne d'onglets (`an-carte-col`) vient ensuite ;
  - les onglets sont de petites pastilles serrées, sans trait dessous, qui suivent de près la carte ;
  - les blocs `ResizablePanel` y sont en pleine largeur, sans poignée, à leur hauteur par défaut ; les explications longues se replient derrière `HelpButton` ;
  - un toucher sur la carte l'ouvre en plein écran (× pour fermer) ;
  - rien n'élargit la page : une colonne de panneaux ne dépasse pas l'écran (`min-width: 0`, `max-width: 100%`), un contenu de largeur fixe défile dans son panneau ; un tableau se resserre, ou passe ses lignes en grille (libellé sur sa propre ligne, valeurs dessous), comme le panneau Manœuvres (`an-man-*`).
- **Sur téléphone tourné** (règles du téléphone, plus un bloc `PHONE_LANDSCAPE_QUERY` en fin de fichier) : une vraie mise en page, ni orientation bloquée ni ordinateur étiré ; un téléphone tourné reste un téléphone ; portrait et ordinateur inchangés.
  - la navigation est un rail à gauche (`AppShell.css`) ; `--shell-left` (`tokens.css`) dit où commence la page, `--shell-top` (posé par `AppShell.tsx`) la hauteur des bandeaux d'enregistrement ;
  - tourner le téléphone ouvre la carte en plein écran, le remettre droit la referme (`AnalysisMap`) ; le plein écran commence sous les bandeaux et laisse le rail ; avec des graphes (« +carte »), ils passent à droite de la carte ;
  - fermée (×), la carte est fixe à gauche sur toute la hauteur, 55 % de la largeur à droite du rail (gardé à 350 px pour les panneaux sur un petit téléphone), et l'en-tête, les onglets et les panneaux défilent à sa droite ;
  - même principe de carte fixe sur un côté pour Enregistrer (grands chiffres à gauche, carte à droite, `RecordingPage.css` ; un cadenas fige l'orientation pendant l'enregistrement, rendue libre à l'arrêt) et la planification (carte à gauche), avec `--land-w` et `--land-side-min` (`tokens.css`) ; l'accueil passe sur deux colonnes ; ailleurs, la page est centrée.
- **La légende de couleur de la trace est posée sur la carte**, en une ligne compacte, en bas à droite, juste à gauche de la mention OSM (contrôle Leaflet d'`AnalysisMap`, coin mis en ligne par `.an-map-corner`), dans la carte et dans sa vue plein écran. Ce que dit le gris passe dans son titre. Elle ne fait qu'afficher : les bornes se saisissent dans l'onglet réglages.
- **Une seule surbrillance sur la carte** (`useMapHighlight`) : montrer un top, un podium de manœuvres, une zone de pente, une répétition, un saut, un revêtement ou la partie d'un graphe (« Afficher ») retire la précédente ; fermer son onglet l'efface, et elle n'est pas ramenée à sa réouverture. Les virements et empannages de la voile restent des cases à part, cumulables. Couleurs de `components/highlightColors.ts` : podiums en rouge, orange, vert ; passage seul en violet.
- **Graphes reliés à la carte** : dans `ZoomableChart` (deux doigts, zone tirée à la souris, « Tout voir »), `onMouseMove` et `onTouchMove` vers `hoveredTrackIndex`, `onLeave` qui efface le repère (`HoverMarker`) ; deux graphes du même axe partagent un `useChartZoom`. Double-clic ou double toucher : zoom ×2 autour du point. Pas de bulle : la valeur se lit au-dessus du graphe, à droite de son nom (`ChartReadout`) ; un graphe dont les lignes ne renvoient pas à un point de trace (profil du fractionné) lit sa ligne par `hoveredRow`. Chaque graphe d'un panneau zoomable a son bouton (`onShowOnMap`, `useZoomOnMap`), « Afficher » sur ordinateur et sous la carte en plein écran (`MapOverlayContext`), « +carte » dans la page du téléphone, toujours là, zoomé ou non, sur la ligne de son nom, collé à droite, la lecture lui laissant la place : tronçon en violet par `useMapHighlight`, carte cadrée par `focus` d'`AnalysisMap`, second clic qui retire le violet, et au téléphone, carte hors de vue ou graphe non zoomé, plein écran carte + graphes du panneau (`companion`) ; le retour d'Android referme tout plein écran de la carte (`pushBackLayer`). Pas de bouton sur une courbe qui n'est pas un tronçon de la trace (profil superposé des répétitions, courbe des sauts). « Tout voir » à 24 px, « Afficher » et « +carte » à 20 px, 20 % sous `.ui-btn--s` (`ZoomableChart.css`).
- **Tailles dans les analyses** : titres des panneaux à 13 px et noms des graphes à 10 px, 2 px sous les autres pages (`--panel-title-size`, `--chart-name-size` sur `.an-page`, `analysisMobile.css` ; Statistiques exclue).
- **Explications sous un « ? »**, règle de toute l'application, analyses comprises (HISTORIQUE, point 148) : une phrase qui explique (comment lire, zoomer, ce que veut dire un pointillé, une définition, une méthode) est repliée sous un « ? » à droite de ce qu'elle explique (réglage, titre du panneau ou du bloc), et s'ouvre juste dessous ; restent visibles les clés de données (couleurs, formes, zones), les avertissements, les états vides et les messages d'action. Une seule aide ouverte à la fois, rien de retenu, changer de page les referme (`components/Help.tsx`). Un réglage ou un panneau nouveau vient avec la sienne (`SettingRow` dans Réglages, `PanelTitle helpKey`). Dans une analyse, `PanelTitle helpKey="…"` pose le « ? » à droite du titre, une fois le panneau ouvert ; le texte, `<HelpText helpKey="…" note>`, vient juste sous la ligne du titre, pas en bas du panneau. Clés `analyse:…` pour un panneau commun (cardio, tops, sauts), `voile:…`, `surf:…` sinon.
- **Tout panneau est repliable par son titre** (`PanelTitle`) et par son onglet, et redimensionnable (`ResizablePanel`). L'`id` d'un panneau est la clé de sa taille mémorisée : ne pas le renommer.
- Couleurs, rayons, espacements : les variables de `theme/tokens.css`. Les couleurs de données des graphes et de la carte restent en dur.

## Pièces partagées

| Pièce | Rôle |
|---|---|
| `components/AnalysisMap.tsx` | Carte, légende donnée par le module posée dessus, outil posé dessus (`overlay`), plein écran au toucher ou piloté par le module |
| `components/BaseTileLayer.tsx` | Fond de la carte (plan ou satellite) de la famille, et son choix sous le + et le − |
| `components/GeneralStats.tsx`, `components/ElevationProfileMini.tsx` | Chiffres de « général », profil d'altitude compact relié à la carte, zoomable |
| `components/EmptyTabPanel.tsx` | Onglet ouvert sans rien à montrer : pourquoi, et de quoi y remédier |
| `pages/analysisMobile.css` | Disposition téléphone (classes `an-*`) |
| `components/PanelTitle.tsx` | Titre de panneau qui le replie, et son « ? » (`helpKey`) |
| `components/Help.tsx` | Aides « ? » (`HelpToggle`, `HelpText`), une ouverte à la fois |
| `components/ChartFold.tsx` | Repli d'une partie d'un panneau (un graphe parmi plusieurs, un tableau), état retenu par `useOpenSections` ; pas de bouton quand le panneau n'a qu'une partie |
| `components/SessionNameEditor.tsx` | Nom de la session, « Renommer », et « … » (`ui/MoreMenu.tsx`) pour partager la session en image (`ShareDialog`) ou télécharger le GPX |
| `components/SectionTabs.tsx`, `components/CollapsibleSectionTabs.tsx`, `components/ResizablePanel.tsx` | Onglets, barre d'onglets repliable des analyses, panneaux redimensionnables |
| `components/SpeedGradientLegend.tsx`, `components/GradeGradientLegend.tsx` | Les légendes de la vitesse et de la pente, en lecture seule, passées à `AnalysisMap` |
| `components/styles.ts` | `CARD_STYLE` des panneaux, `HALF_PANEL_STYLE` pour deux panneaux par ligne |
| `components/SpeedRangeEditor.tsx` | Saisie des bornes de couleur de la trace, dans l'onglet réglages |
| `components/SessionSaveBar.tsx` | Barre du brouillon de la session |
| `core/trackColor.ts`, `components/TrackSegmentsLayer.tsx` | Trace colorée par la vitesse, la même dans l'analyse et la vignette |
| `hooks/useMapHighlight.ts`, `components/highlightColors.ts` | La surbrillance unique de la carte et ses couleurs |
| `components/SurfaceHighlight.tsx` | Un revêtement choisi dans `SurfaceBar`, en violet sur la carte (analyse et planification) |
| `components/ZoomableChart.tsx`, `hooks/useChartZoom.ts`, `components/HoverMarker.tsx` | Graphe zoomable, son zoom, le repère du survol sur la carte |
| `components/ChartReadout.tsx`, `hooks/useZoomOnMap.ts` | Valeur lue au-dessus d'un graphe ; « Afficher » et « +carte » d'un graphe |

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
4. La rangée `.an-map-row`, qui contient `AnalysisMap` seul : `panelId` unique, couches de la carte, sa légende ; la largeur est commune. Puis `.an-carte-col` : `CollapsibleSectionTabs` (qui pose `SectionTabs`) et `.an-carte-panels`, chaque panneau en `HALF_PANEL_STYLE`.
5. Au banc (`outils/banc/`), vérifier la page sur ordinateur, à 390×844 et tournée (834×375) ; `tailles.mjs` relève toutes les tailles.
