# 102 · Entraînement › Muscu et timer : retirer « Enregistrer sans séance »

Réponse de l'utilisateur à Q50 (31/10) : le retirer. Le lien (`src/pages/TrainingSessionsPage.tsx`, vers la ligne 162, style `ui-hint`) mène à la même adresse qu'Enregistrer › type Muscu : doublon.

À faire :
- Retirer le lien et ce qui ne sert plus qu'à lui (variable `muscuPath`, imports) ; rien d'autre ne change sur la page.
- `docs/DECISIONS.md` §5 : retirer « ; enregistrer est possible aussi sans séance (lien « Enregistrer sans séance ») » et dire à la place qu'enregistrer sans séance passe par Enregistrer › type Muscu (lien retiré le 31/10, lot 102). La mention dans HISTORIQUE reste telle quelle.
- Si un script du banc (`outils/banc/entrainement.mjs`, `timer.mjs`, `muscu.mjs`) attend ce lien, le mettre à jour.

Vérification : banc `entrainement.mjs`, `timer.mjs` ; seule la ligne du lien disparaît du texte de la page.
