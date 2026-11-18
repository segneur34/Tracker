# 221 · Analyses : « tout fermer » au contour rouge, à l'essai

## Tel que noté

13/11/2026, 16:25 : « Le bouton "tout fermer" dans les analyses doit être rouge, ou avec un contour rouge plutôt, et on va faire ça pour essayer, parce qu'actuellement il ne se différencie pas assez des autres. »

## Aujourd'hui (vérifié le 18/11)

`.an-tabs-close-all` dans `src/pages/analysisMobile.css` (vers la ligne 132) : contour `var(--line)` gris, texte `var(--muted)` pâle, fond transparent ; bouton rendu par `src/components/CollapsibleSectionTabs.tsx`, dans toutes les analyses.

## Voulu

Contour rouge : `border-color: var(--danger)` (variable de `src/theme/tokens.css`, définie pour les thèmes clair et sombre), texte en `var(--danger)` aussi pour qu'il se lise ; fond toujours transparent, même taille, même forme. Rien d'autre ne change. Pas de valeur de couleur en dur. Mettre à jour le commentaire CSS (« sobre comme elle » ne vaut plus).

## Fichiers

`src/pages/analysisMobile.css` seulement.

## Banc

Changement de style seulement : le texte des pages ne change pas. Un passage du banc sur un script d'analyse suffit à le montrer, s'il est lancé.
