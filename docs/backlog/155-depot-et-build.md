# 155 · Dépôt et build : CI, tag, `gradlew`, Node, guide de build, docs qui mentent

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes D9, D10, D11 ; détail dans `angle-T3.md` (T3-1 à T3-6), `angle-V2.md` (V2-1, V2-3, V2-4, V2-14), `angle-T6.md` (T6-1 à T6-4)). Modèle | Réflexion : Sonnet | medium.

## Tel que noté

- « Le build n'est éprouvé que sur le poste de l'auteur : `android/gradlew` versionné non exécutable (échec sur Mac, Linux, CI), Android Studio récent (JDK 25) refuse Gradle 8.14.3 et rien ne demande le JDK 21, pas de `engines` (Node 23 et 25 refusés par vitest), format de `keystore.properties` écrit nulle part, pas de CI. »
- « Aucun tag, 130 commits "à valider", 6 commits non envoyés ; le lint ne bloque jamais (129 règles en avertissement) et 14 règles typées annoncées ne tournent pas. »
- « Docs qui mentent là où un inconnu lit en premier : `CLAUDE.md` envoie vers trois emplacements absents (`core/activityPresets.ts`, `utils/kinematics.ts`, `StoredSettings` dans le hook) ; le README dit que seule la planification appelle un serveur (l'appli en appelle six, dont les tuiles à chaque carte) ; ETAT §8 et §9 disent faux sur les tests et les exports (déjà signalé le 27/10) ; la table des constantes d'ETAT cite une dizaine de noms et fichiers absents. »

## Où, aujourd'hui

- `git ls-files -s android/gradlew` → `100644` ; `android/gradle/wrapper/gradle-wrapper.properties` 8.14.3 ; ni `gradle-daemon-jvm.properties` ni `org.gradle.java.home` ; `package.json` sans `engines` (minimum réel Node 22.12 : vitest 5 demande `^22.12 || ^24 || >=26`) ; les quatre clés de `keystore.properties` ne sont lisibles que dans `android/app/build.gradle:43-46`.
- `.oxlintrc.json` : 2 règles en erreur, 129 en avertissement ; `npm run lint` et `outils/verif.mjs` rendent 0 sur un avertissement ; `vite.config.ts:1` lève déjà `triple-slash-reference`.
- `CLAUDE.md` : `core/activityPresets.ts` (vrai fichier `settings/activityPresets.ts`), `utils/kinematics.ts` (`PointData` est dans `sailing/pointData.ts`), `StoredSettings` (défini dans `settings/activitySettings.ts:131`) ; `README.md:3` ; `docs/ETAT_DU_PROJET.md` §4, §7, §8, §9 (`TREATMENT_SPEED_RANGE_MS`, `surfing/surfConfig.ts`, `DEFAULT_SURF_SPEED_RANGE_MS`, `PRESETS_VERSION` dans le mauvais fichier, `BIKE_WAY_TYPES` dans le mauvais fichier, `readVisibility` export mort, hooks dits non testés).

## Voulu

- `git update-index --chmod=+x android/gradlew` ; `toolchainVersion=21` (critère de JVM du démon Gradle) ; `"engines": { "node": "^22.12.0 || ^24.0.0 || >=26.0.0" }` et `.nvmrc` ; `android/keystore.properties.exemple` ; `android.minWebViewVersion: 111` dans `capacitor.config.ts` ; `.gitignore` : `.claude/settings.local.json`, `.env`, `coverage/`, `android/app/release/`.
- `.github/workflows/verif.yml` (Ubuntu : `npm ci`, lint, `vitest run`, `vitest run --sequence.shuffle`, build, `./gradlew --version`) ; `oxlint --deny-warnings` après avoir levé l'avertissement de `vite.config.ts`, et soit `oxlint-tsgolint` avec `--type-aware`, soit les règles typées retirées de la configuration ; un tag annoté par APK diffusée (`v0.4.61`) ; `main` envoyé avant toute remise.
- `docs/DEVELOPPER.md` d'une page : Node, JDK 21 et pourquoi, SDK 36 / min 24, `local.properties`, modèle de `keystore.properties`, `keytool`, `npm run build` → `npx cap sync android` → `assembleRelease` / `bundleRelease`, déploiement web (`_redirects`, hébergeur), ce qu'un changement d'`appId` ou de clé casse.
- Les trois chemins de `CLAUDE.md` corrigés ; le README dit la vérité en une liste de services (tuiles, Photon, BRouter, IGN, Overpass : quoi part, quand) ; ETAT §4, §7, §8, §9 corrigés ; `outils/verif.mjs` lance les scripts `T6/cites.mjs` (chaque chemin cité existe) et `T6/inventaire.mjs` (INVENTAIRE contre le disque), à recopier depuis `~/.claude/plans/audit-vente-0111/T6/`.

## Pourquoi

Le poste de l'auteur est la seule preuve que le projet se construit ; un acheteur juge d'abord sur ce qu'il arrive à builder et sur les docs qu'il lit en premier.
