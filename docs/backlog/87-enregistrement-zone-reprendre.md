# 87 · Enregistrement : zone cardiaque qui déborde, « Reprendre » sélectionnable

## Tel que noté (29/10)

(a) Pendant l'enregistrement, la zone cardiaque dépasse du cadre quand la carte est réduite (capture d'écran de l'utilisateur, non conservée).
(b) Le texte du bouton « Reprendre » (haut à gauche, à côté d'« Arrêter ») se sélectionne à l'appui long, comme celui d'« Arrêter » avant sa correction.

## Où

`src/pages/RecordingPage.tsx`, `src/pages/RecordingPage.css` (tuile BPM, chiffre « Zone FC » de la carte réduite, rangée Pause / Arrêter / Note) ; pour (b), reprendre exactement la correction d'« Arrêter » (`user-select: none` et `-webkit-user-select: none`, voir `src/components/ui/ui.css` et les boutons tenus), sans en inventer une autre.

## Voulu

- (a) Le chiffre ou la tuile de zone FC tient dans son cadre, carte réduite comme carte ouverte, portrait et paysage, à 320 px de large compris et à 115 / 130 % de taille de texte : texte raccourci, retour à la ligne ou taille adaptée, à choisir selon ce que font déjà les autres tuiles (cohérence d'abord).
- (b) Ni « Reprendre » ni « Pause » ne sélectionnent leur texte, comme « Arrêter » (DECISIONS §6 : « Arrêter » et les boutons tenus ne sélectionnent pas leur texte).
- Rien d'autre ne bouge sur la page (§6 « Page Enregistrer en cours »).

## Vérification

`npm run verif`. Banc : `tailles` sur Enregistrer s'il couvre la carte réduite pendant un enregistrement (d'exemple) ; sinon dire dans le rapport comment le débordement a été constaté puis corrigé (mesure de `scrollWidth` contre `clientWidth` dans un Chrome sans fenêtre, par exemple).

## Essai au téléphone

Un seul : enregistrement avec la ceinture, carte réduite → zone FC dans son cadre ; appui long sur « Reprendre » en pause → rien ne se sélectionne.
