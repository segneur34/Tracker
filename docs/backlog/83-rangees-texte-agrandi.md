# 83 · Enregistrer et Profil : rangées « Famille » et « Période » qui défilent avec un texte agrandi

Sonnet | medium. Changement de mise en page seul, aucun chiffre ne change. Brief écrit le 30/10 par l'orchestrateur d'après la ligne 83 de `docs/BACKLOG.md`.

## Le défaut

Relevé de `outils/banc/tailles.mjs` (29/10) : à 115 et 130 % de taille de texte (réglage d'Android, simulé par le script en multipliant la taille de chaque élément), sur un téléphone étroit (320 à 390 px), la rangée « Famille » de la page Enregistrer et la rangée « Période » de la page Profil défilent horizontalement au lieu de tenir sur la largeur. Les autres combinaisons passent.

## Ce qui existe

- Les deux rangées sont le même composant `SegmentedControl` avec `fit` : `src/pages/RecordingPage.tsx:813` (« Famille », cinq familles : Voile, À pied, Vélo, Surf, Fractionné), `src/pages/ProfilePage.tsx:196` (`fit className="profile-periods"`, cinq périodes) ; rendu dans `src/components/ui/SegmentedControl.tsx:152`, classes `ui-segmented` et `ui-segmented--fit`.
- CSS dans `src/components/ui/ui.css` : la rangée (`.ui-segmented`, `overflow-x: auto`, vers la ligne 408), les cases (`.ui-segmented button`, `flex: 1 0 auto`, `font-size: clamp(10px, 3.2vw, var(--text-xs))`, `white-space: nowrap`, vers la ligne 453), et la variante `fit` (`.ui-segmented--fit button` : `flex: 1 1 auto`, `white-space: normal`, `hyphens: auto`, vers la ligne 470, avec une règle téléphone juste après).
- `src/pages/ProfilePage.css:266-272` et `:320-324` : retouches propres à la Période sous 600 px et sous 360 px (déjà `flex: 1 1 auto`, `white-space: normal`, padding réduit).

Piste probable : un enfant flex ne rétrécit pas sous sa largeur de contenu minimale (`min-width: auto`), et `hyphens: auto` ne coupe rien sans `lang` connu ou sur un mot court ; avec le texte agrandi, la somme des mots les plus longs (« Fractionné », « 12 derniers mois »…) plus les marges dépasse 320 px, et la rangée défile. À vérifier en mesurant avant de corriger.

## À faire

1. Mesurer d'abord : `node outils/banc/tailles.mjs` restreint aux deux pages et aux deux tailles de texte (variables `PAGES=enregistrer,profil FONTS=1.15,1.3`, et `SIZES` aux largeurs 320 à 390 si le script les nomme ainsi : lire son en-tête), avec un serveur Vite et un Chrome du banc (mode d'emploi dans `outils/banc/LISEZMOI.md`, « Lanceur » et « Pièges du poste » ; le plus simple est `node outils/banc/passe.mjs tailles` avec ces variables d'environnement, qui relève « avant » et « après » sur le même arbre). Noter les combinaisons « rangée qui défile ».
2. Corriger dans `ui.css` sur `.ui-segmented--fit` seulement (les rangées non `fit` doivent continuer à défiler) : `min-width: 0` sur les cases, `overflow-wrap: anywhere` en secours de la césure, et, si cela ne suffit pas, une taille de police ou un padding qui se resserre encore pour `fit` sur un écran étroit (`clamp`), de sorte que cinq cases tiennent à 320 px avec un texte à 130 %. Pas de libellé raccourci sans l'accord de l'utilisateur (ce serait une décision à lui : la signaler dans le rapport si rien d'autre ne suffit). La rangée garde ses deux lignes au plus et ses cibles d'au moins 40 px de haut.
3. Si les règles de `ProfilePage.css` propres à la Période deviennent redondantes avec la règle commune, les retirer (une seule place pour une règle), sans changer le rendu à 100 %.
4. Remesurer : 0 « rangée qui défile » sur les deux pages aux deux tailles de texte, et les autres relevés de `tailles.mjs` (débordement, texte coupé, cibles) inchangés, dans la même séance que l'« avant » (piège : les relevés de `tailles.mjs` changent d'un jour à l'autre selon l'état du poste, LISEZMOI « Scripts à revoir »).

## Garde-fous

- Variables de `src/theme/tokens.css` pour toute valeur neuve (espacement, taille) ; pas de valeur en dur si une variable existe.
- Ne pas toucher aux autres usages du `SegmentedControl` (unités, onglets d'analyse, choix d'Enregistrer en cascade) : seule la variante `fit` change.
- Pas de `docs/`, pas de commit, pas de version.

## Preuve

- `node outils/verif.mjs --rapide` (le CSS passe le lint et le build).
- Relevé de `tailles.mjs` avant et après, restreint aux deux pages : le rapport cite les combinaisons corrigées et confirme que rien d'autre n'a bougé.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; ce qui a changé, le relevé avant/après (nombre de combinaisons « rangée qui défile » sur les deux pages), les fichiers touchés, ce qui reste (un libellé trop long, par exemple).
