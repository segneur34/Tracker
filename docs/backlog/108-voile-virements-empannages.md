# 108 · Voile › général : virements et empannages sur la même ligne

Demande de l'utilisateur (31/10) : dans l'onglet « général » de la voile, les tuiles « Virements réussis » et « Empannages réussis » côte à côte, sur une même ligne, sur téléphone comme sur ordinateur.

Aujourd'hui : `overviewStats` (`src/pages/SailingModule.tsx`, vers la ligne 412) aligne 5 tuiles avant elles avec un seuil d'activité, 3 sans ; la grille `an-sheet__stats--always` (`src/pages/analysisMobile.css`, 2 colonnes sur téléphone, `auto-fill minmax(150px, 1fr)` sur ordinateur) place le virement en colonne 2 et renvoie l'empannage à la ligne suivante.

À faire :
- Garder les deux tuiles ensemble sur une ligne, quel que soit le nombre de tuiles avant elles et la largeur (téléphone, ordinateur, téléphone tourné). Piste : un regroupement des deux tuiles dans `GeneralStats` (par exemple un sous-bloc qui occupe deux colonnes, `grid-column: span 2`, et passe à la ligne s'il ne tient pas), signalé par un champ facultatif de `ShareStat` ou par une liste de paires passée à `GeneralStats` ; ne rien changer à l'image de partage (`ShareDialog`, même liste).
- Ne pas changer l'ordre ni le contenu des chiffres (ne rien déplacer ni dupliquer sans redemander) ; un trou d'une case avant la paire est acceptable.
- Les autres modules (course, vélo, surf, muscu) qui utilisent `GeneralStats` restent identiques.
- Suivre `docs/MISE_EN_PAGE.md` ; variables de `src/theme/tokens.css`.

Vérification : banc `brouillon-voile.mjs` (texte de la page identique avant et après ; la disposition seule change), tests existants.
