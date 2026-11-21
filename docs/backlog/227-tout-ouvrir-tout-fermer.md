# 227 · Analyses : « tout ouvrir » vert, puis « tout fermer » rouge dès 2 onglets ouverts

## Tel que noté

19/11/2026, 16:24 : « GTRACKER, TRACKER dans les analyses le bouton tout fermer doit devenir un bouton "tout ouvrir" vert qui ouvre tout et quand il y a au moins 2 onglets ouverts il devient un "tout fermer" rouge »

## Aujourd'hui (vérifié le 21/11)

Un seul bouton « tout fermer » à droite de la barre (`src/components/CollapsibleSectionTabs.tsx`, `onCloseAll` de `useAnalysisTabs`), contour rouge depuis le lot 221 (`.an-tabs-close-all`, `src/pages/analysisMobile.css`).

## Voulu

Moins de 2 onglets ouverts : « tout ouvrir », vert (`var(--success)`), qui ouvre tous les onglets montrés de l'activité et déplie « avancé ». Au moins 2 ouverts : « tout fermer », rouge (le lot 221 gardé). Gtracker : à noter dans son propre reste à faire.

## Contradiction

CLAUDE.md, « Général » et « avancé » : « un bouton « tout fermer » à droite de la barre ferme tous les onglets ouverts ». À réécrire à la passe doc si la note est faite.

## Questions

Q73 : « tout ouvrir » déplie-t-il aussi « avancé » et tous ses onglets ? Par défaut : oui.
