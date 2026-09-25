# Mise en page d'une page d'analyse

Patron commun aux modules d'analyse (voile, course) et à tout sport à venir. Ce qui est commun passe par des pièces partagées, pour qu'une règle ne s'écrive qu'une fois ; ce document dit lesquelles et dans quel ordre les poser. Les signatures se lisent dans le code.

## Structure, de haut en bas

1. **Feuille** (`.an-sheet`) :
   - en-tête `PageHeader` : retour à la liste du sport, titre « Analyse … », et `SessionNameEditor` en sous-titre (nom de la session et « Renommer ») ;
   - quatre chiffres clés (`.an-sheet__stats`, visibles sur téléphone seulement) ;
   - réglages de la session : ouvrir un GPX, support, seuils, unités.
2. Barre « Non enregistré / Enregistrer la session », si le module a un brouillon (voile).
3. **Onglets** `SectionTabs` et leurs **panneaux** : chacun dans un `ResizablePanel` d'`id` unique, titré par `PanelTitle`, qui le replie.
4. **Rangée de la carte** (`.an-map-row`) : le bloc `AnalysisMap`, suivi en voile de la colonne d'onglets propre à la carte.

## Règles communes

- **Deux dispositions, une seule rupture** : 768 px, la même que la barre de navigation (`AppShell.css`). Sous cette largeur, `analysisMobile.css` s'applique.
- **Sur ordinateur** : la carte occupe 60 % de la largeur, en bas de la page, et le bloc est redimensionnable.
- **Sur téléphone** :
  - la rangée de la carte remonte en tête de page (`order: -1`), en pleine largeur, avec une carte haute de 30 vh ;
  - la feuille la chevauche un peu ;
  - un toucher sur la carte l'ouvre en plein écran (× pour fermer) ;
  - rien n'élargit la page : une colonne de panneaux ne dépasse pas l'écran (`min-width: 0`, `max-width: 100%`), un contenu de largeur fixe défile dans son panneau ; un tableau se resserre, ou passe ses lignes en grille (libellé sur sa propre ligne, valeurs dessous), comme le panneau Manœuvres (`an-man-*`).
- **La légende de couleur de la trace est collée à la carte**, juste en dessous, dans le même bloc (`AnalysisMap`). Elle ne se pose jamais ailleurs.
- **Tout panneau est repliable par son titre** (`PanelTitle`) et par son onglet, et redimensionnable (`ResizablePanel`). L'`id` d'un panneau est la clé de sa taille mémorisée : ne pas le renommer.
- Couleurs, rayons, espacements : les variables de `theme/tokens.css`. Les couleurs de données des graphes et de la carte restent en dur.

## Pièces partagées

| Pièce | Rôle |
|---|---|
| `components/AnalysisMap.tsx` | Carte + légende + plein écran au toucher |
| `pages/analysisMobile.css` | Disposition téléphone (classes `an-*`) |
| `components/PanelTitle.tsx` | Titre de panneau qui le replie |
| `components/SessionNameEditor.tsx` | Nom de la session et « Renommer » |
| `components/SectionTabs.tsx`, `components/ResizablePanel.tsx` | Onglets, panneaux redimensionnables |
| `components/SpeedGradientLegend.tsx` | La légende, rendue par `AnalysisMap` |

## Propre à chaque sport

Ce que la page choisit, dans le cadre ci-dessus :
- ses quatre chiffres clés ;
- ses réglages ;
- ses onglets et ses panneaux ;
- les couches de sa carte (trace colorée, repères, manœuvres) ;
- l'unité et le libellé du gris de la légende ;
- la hauteur par défaut du bloc carte.

## Brancher un nouveau sport

1. La page importe `analysisMobile.css`. Sa racine porte `an-page`, et l'en-tête, les chiffres clés et les réglages vont dans `an-sheet`.
2. En sous-titre du `PageHeader` : `SessionNameEditor` sur le fichier de la session.
3. Des sections `*_SECTIONS` et `*_SECTION_DEFAULTS`, avec un `useOpenSections` propre au module. Chaque panneau est titré par `PanelTitle`.
4. La rangée `.an-map-row`, qui contient `AnalysisMap` : `panelId` unique, couches de la carte, props de la légende, `style` de largeur (`width: '60%'`, ou `flex: '0 1 60%'` dans une rangée flexible).
5. Au banc (`outils/banc/`), vérifier la page sur ordinateur et à 390×844.
