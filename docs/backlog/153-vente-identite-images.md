# 153 · Vente : identité du vendeur dans l'appli et les formats, provenance des images

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes A5, A6 ; détail dans `angle-V1.md` (V1-5, V1-6, V1-9, V1-10, V1-11), `angle-X2.md` (X2-7, X2-9), `angle-T3.md` (T3-4), `angle-C6.md` (C6-11)). Modèle | Réflexion : Sonnet | medium (code) ; le relevé des images est à faire par l'utilisateur.

## Tel que noté

- « L'identité du vendeur est partout : `io.github.segneur.tracker` (appId, namespace, 15 fichiers Java, `strings.xml`), l'espace de noms `github.com/segneur34/Tracker/session` écrit dans chaque GPX exporté et comparé au caractère près à la relecture (le changer sans alias rend muets tous les GPX déjà exportés), l'adresse e-mail sur les 347 commits. »
- « Provenance et droits des images (en-tête de l'accueil, bandeaux, logo, écran de démarrage, planche des 16 dessins) écrits nulle part ; les éléments Canva ne se cèdent pas et ne font pas une marque. »

## Où, aujourd'hui

- `capacitor.config.ts:6`, `android/app/build.gradle` (`namespace`, `applicationId`), `res/values/strings.xml`, paquet des 15 fichiers Java, action d'intent de `IntervalTimerService.java`. Changer l'`applicationId` fait une autre appli (Preferences, `tracker.deviceId`, droit SAF sur le dossier mémoire, dossier privé perdus ; les sessions du dossier restent).
- `library/sessionBundle.ts:20-22,159` : `unbundleSessionGpx` cherche la chaîne exacte `<extensions><tracker:session xmlns:tracker="https://github.com/segneur34/Tracker/session" version="1">` ; un GPX exporté avant un changement reviendrait en trace nue, sans fiche ni capteurs.
- « ex. Tom » dans `components/ProfilePrompt.tsx:91` et `pages/SettingsPage.tsx:938` ; `MEMORY_FOLDER_NAME = 'Tracker'` et formats `tracker-*` à ne pas renommer sans migration (V1-11).
- Images : `src/assets/accueil/*.webp` (6), `src/assets/bandeaux/*.webp` (5), `assets/logo.png`, `assets/splash.png`, `res/drawable*/splash.png`, `components/activityArt.tsx` (planche fournie, non versionnée) ; `assets/icone.svg` dessinée par Claude (point 55). Aucun fichier de crédits.

## Voulu

- `unbundleSessionGpx` accepte une liste d'espaces de noms (l'ancien plus le nouveau) et n'écrit que le nouveau ; test : le `OLD_BUNDLE` de `sessionBundle.test.ts` reste lisible après le changement.
- Le nom affiché séparé des identifiants de format et de dossier (une constante) ; placeholder neutre.
- Un `CREDITS` ou `ASSETS.md` : pour chaque image, source, compte, licence, date, droit de céder ; remplacer ce qui n'est pas cessible ; ne pas déposer le logo comme marque sans en avoir établi l'origine.
- Au contrat (hors code) : `applicationId` changé avant toute diffusion par l'acheteur (et `${applicationId}` pour l'action d'intent), clé de signature cédée ou nouvelle appli annoncée, historique git cédé ou dépôt neuf (Q4 ci-dessous).

## Questions

- Q4 de l'audit : céder l'historique git (adresse e-mail sur chaque commit) ou un dépôt neuf en un commit ? `.claude/`, BACKLOG, MODELES, HISTORIQUE livrés ou non ? Par défaut : dépôt neuf, atelier retiré, HISTORIQUE nettoyé et livré (seule source des « point N » du code).

## Réponse du 07/11 (Q4)

- **Dépôt neuf, un seul commit**, sans l'historique ni l'adresse e-mail de l'utilisateur. Conséquence acceptée : après le fork, une correction du code commun ne passe plus d'une version à l'autre par git, elle se refait à la main dans les deux dépôts ; d'où la liste des travaux faits **avant** le fork (n° 187 à 190, le 07/11). Atelier (`.claude/`, BACKLOG, MODELES) retiré ; HISTORIQUE nettoyé et livré, par défaut.
