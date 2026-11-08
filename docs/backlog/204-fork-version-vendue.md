# 204 · Fork de la version voile et surf vendue (dépôt neuf, identité neutre)

Noté le 08/11, décidé le 07/11 (fiches 153 et 154, HISTORIQUE point 307) et précisé le 08/11 avec l'utilisateur : tout ce qui est commun aux deux versions est fait (lots 187, 188, 189, 195, 202, 203 ; le 190, renvois d'atelier, se fait après, dans la copie seulement). Point de départ : **Tracker 1.0.0** (commit tagué `v1.0.0`), « version de base » voulue par l'utilisateur. Modèle | Réflexion : orchestrateur Fable ou Opus, sans agent `lot` : commandes git et quelques fichiers édités. Acheteur pressenti : GONG (`D:\gong tracker\contact-gong.md`).

## Décisions de l'utilisateur (08/11)

- Copie dans `D:\gong tracker\tracker-voile` (dossier `D:\gong tracker\` existant, qui tient déjà le contact et la DA).
- Identifiant d'application distinct dès la copie, pour installer la version vendue **à côté** de Tracker sur le téléphone : `io.github.segneur.tracker.voile`, nom « Tracker voile » ; l'acheteur mettra le sien au contrat (fiche 153). Créé après la division, dans la copie, comme première modification.
- Identité git neutre dès le premier commit (« Tracker », adresse `noreply`), jamais l'adresse personnelle (elle n'est que dans la config locale du dépôt d'origine ; la globale est vide). Pas de dépôt GitHub tant qu'il ne le demande pas.
- L'atelier (CLAUDE.md, `.claude/`, BACKLOG réduit, MODELES) **reste dans la copie** pendant E2 à E8, parce que Claude en a besoin ; il est retiré à E8, où le dépôt est réécrit en un seul commit pour la livraison (`git checkout --orphan`). Le « dépôt neuf en un commit » du 07/11 est une propriété de la livraison, pas du jour du fork.
- Fork après validation au téléphone des lots communs (faite le 08/11).

## Procédure (orchestrateur, pas un lot)

1. **Dépôt d'origine, avant** : `git status --short` vide, `npm run verif` vert à HEAD, tag `v1.0.0` posé.
2. **Copie** : depuis `C:\Users\segne\tracker`, `mkdir "D:\gong tracker\tracker-voile"` puis `git archive HEAD | tar -x -C "D:/gong tracker/tracker-voile"` (fichiers versionnés seulement : ni `node_modules`, ni `dist`, ni `.claude/settings.local.json`, ni clé de signature, ni `android/local.properties`, ni `android/keystore.properties`, ni `android/app/release/`). Puis `npm ci` dans la copie. Pour signer l'APK de la copie, recopier `android/keystore.properties` à la main (même clé que Tracker : une appli à identifiant distinct peut partager la clé).
3. **Identité** : dans la copie, `git init`, `git config user.name "Tracker"`, `git config user.email "tracker@users.noreply.github.com"` (locaux). Vérifier par `git config user.email` qu'aucune adresse personnelle n'est héritée.
4. **Dans la copie, avant le premier commit** :
   - `android/app/build.gradle` : `applicationId "io.github.segneur.tracker.voile"` (le `namespace` et le paquet Java ne bougent pas) ; `capacitor.config.ts` : `appId` idem, `appName` « Tracker voile » ; `android/app/src/main/res/values/strings.xml` : `app_name`, `title_activity_main`, `package_name`, `custom_url_scheme` en conséquence ; vérifier l'action d'intent d'`IntervalTimerService.java:36` et les tests qui figent l'identifiant (`src/platform/capacitorConfig.test.ts`, `nativeConstants.test.ts`, `androidManifest.test.ts`) : les mettre à jour.
   - `package.json` : `name` « tracker-voile », `version` « 0.6.00 » (série propre ; l'origine est à 1.0.0).
   - `.claude/agents/*.md` et `.claude/skills/*/SKILL.md` : remplacer `C:\Users\segne\tracker` par `D:\gong tracker\tracker-voile` ; dans `clore` et `reprise`, le dossier de mémoire `c--Users-segne-tracker` par celui que Claude Code crée pour le nouveau chemin (à lire dans `~/.claude/projects/` après la première ouverture).
   - `docs/BACKLOG.md` : remplacer par le texte de la section « BACKLOG de la copie » ci-dessous ; `docs/backlog/` : ne garder que 151, 152, 153, 154, 160 ; `node outils/backlog.mjs` sans alerte.
   - `docs/ETAT_DU_PROJET.md` §12 : une ligne « Copie de Tracker 1.0.0 (commit <sha>) du jj/mm, destinée à la vente ; E2 à E8 ici, Tracker complet reste dans `C:\Users\segne\tracker` ».
   - `README.md` : première ligne qui dit que ce dépôt est la version voile et surf.
   - Rien d'autre : aucun retrait de code le jour du fork.
5. **Premier commit** dans la copie : « Version voile et surf : point de départ, copie de Tracker 1.0.0 (commit <sha>) ». Vérifier `git log --format=%an,%ae` : identité neutre.
6. **Vérification de la copie** : `npm run verif` vert ; `node outils/banc/passe.mjs general surf balises` (jamais en même temps que le banc de l'origine : même port 4191, ou `--port 4195 --chrome 9480`) ; APK « Tracker voile » (`npm run build`, `npx cap sync android`, `gradlew.bat assembleRelease` avec `JAVA_HOME` et `ANDROID_HOME`, fichier `android/app/build/outputs/apk/release/tracker-voile-0.6.00.apk` ou nom tiré de `package.json`), installée **à côté** de Tracker, une session voile ouverte.
7. **Dépôt d'origine, après** : BACKLOG : lignes 151, 152, 153, 154, 171, 190 et cette fiche 204 supprimées (« déménagées dans la copie »), fiches correspondantes supprimées ; ETAT §12 : fork fait, chemin, règle « une correction commune se refait à la main des deux côtés et se note dans les deux BACKLOG » ; point HISTORIQUE ; mémoire de Claude (chemin de la copie, règle). Commit « Fork de la version vendue… ».
8. **Ménage sans rapport**, après accord : 57 copies de travail du banc dans `%TEMP%\tracker-banc\` (`git worktree prune`, puis suppression des dossiers `avant-*`) et `stash@{0}` d'octobre.

Pièges connus : la version se pose dans `package.json` **avant** `npm run build` et `cap sync` (le 08/11, une APK disait 0.5.24 à l'écran pour 0.5.25 côté Android) ; `gradlew.bat` par son chemin complet depuis `android/` ; `npm run verif` échoue si `docs/MODELES.md`, `docs/BACKLOG.md` ou `CLAUDE.md` manque (liste `DOCUMENTS` de `outils/docs-cites.mjs`) : l'atelier ne se retire qu'à E8 ; `.claude/agents/*.md` portent le chemin du dépôt en dur.

## BACKLOG de la copie (à poser tel quel dans `D:\gong tracker\tracker-voile\docs\BACKLOG.md`)

```
# Reste à faire

Tenu par Claude ; l'utilisateur n'a jamais à l'ouvrir. `node outils/backlog.mjs` vérifie la forme et imprime le tableau de bord : aucun résumé fait à la main ne le remplace. Prochains numéros : élément 310, essai 201, question Q101 (numéros à part de ceux de Tracker complet : une correction commune se note dans les deux).
- Une ligne par élément : `- N · [type] Titre · noté jj/mm · petit|gros · Modèle/effort · état · dépend de : … · détail : chemin` (champs sans objet omis, ordre gardé). N unique, dans la suite des lots, jamais réutilisé ; type `[bogue]`, `[idée]`, `[dette]` ou `[outil]` ; petit = un lot Sonnet ou Opus, une session ; gros = plusieurs lots, Fable, ou des données réelles ; détail dans `docs/backlog/N-titre.md` quand la ligne ne suffit pas.
- Quatre zones, un élément dans une seule : **Maintenant** (en cours ou à valider ; 3 lots avec essais au téléphone au plus, un lot validé sur lecture ne compte pas ; première ligne : l'APK installée) ; **Ensuite** (prêts, liste numérotée, l'ordre est la priorité, 7 au plus) ; **Ça attend une occasion** (sous une condition écrite en gras, hors de toute limite) ; **Plus tard** (daté, une phrase avec le résultat attendu ; proposé à l'abandon à la revue après 90 jours).
- Rangement à la mise au propre, posé en clair à l'utilisateur : un chiffre faux ou un usage cassé → tête d'Ensuite ; « vous en servirez-vous à votre prochaine sortie ? » oui → Ensuite, non → Plus tard ; petit et utile passe avant gros et utile.
- Essais au téléphone : sous-lignes de leur lot (`  - essai N : quoi → attendu`), numéros qui se suivent, jamais réutilisés ; un essai raté devient un `[bogue]` en tête d'Ensuite ; les essais de terrain vont dans « Ça attend une occasion ».
- Questions, 5 au plus : `- Qn · lot N · question · par défaut : … · posée le jj/mm` ; sans réponse après 4 semaines, Claude propose à la revue de trancher par défaut ; une question répondue disparaît (réponse dans DECISIONS ou dans l'élément).
- Fait = ligne supprimée après la passe `doc` (git et HISTORIQUE gardent la trace) ; pas d'archives ici.
- ETAT §9 et §11 gardent les limites connues (faits sur le code) ; ce fichier garde les intentions, en citant le §.
- **Ce dépôt est la version voile et surf destinée à la vente** (copie de Tracker 1.0.0, `C:\Users\segne\tracker`, commit d'origine au §12 d'ETAT) : la terre (course, vélo, Entraînement) et le planificateur routier en partent (fiche 154, E2 à E8) ; une correction commune aux deux versions se refait à la main des deux côtés et se note dans les deux BACKLOG.

## Maintenant

Aucune APK « Tracker voile » construite encore (identifiant `io.github.segneur.tracker.voile`, installable à côté de Tracker) ; version de départ 0.6.00.

## Ensuite

1. 301 · [dette] E2, fiche et résumé détachés : lecteurs terre (`bikeWeightKg`, `loadKg`, `surfaces`, `terrainElevation`, `intervals`, `test`) retirés de `record.ts`, bruts gardés par `...rest` et `GUARDED_FIELDS` ; `test` et `cadence` retirés du résumé, `SUMMARY_CALC_VERSION` inchangé ; FC repos déplacée sous le Profil (`/profil/fc-repos`), `restingHrResults.ts` hors de `running/` ; pop-up du profil réduit à pseudo et année de naissance ; résultat attendu : gardes du lot 187 toujours vertes (résumés voile et surf identiques à l'octet) · noté 08/11 · petit · Opus/high · détail : docs/backlog/154-vente-extraction-voile-surf.md
2. 302 · [dette] E3, retirer l'Entraînement : pages `/fractionne/*`, `MuscuModule`, compteur, Timer, chrono, tests guidés, hooks ; branches de `useRecorder`, `RecordingPage`, journal, notification, `AppShell`, `main.tsx` ; natif `IntervalTimerService`, `HeartRateService`, `TONE_*` dans `TonePlayer`, manifeste ; résultat attendu : enregistrement voile et surf inchangé (essais au téléphone) · noté 08/11 · gros · Opus/high · dépend de : 301 · détail : docs/backlog/154-vente-extraction-voile-surf.md
3. 303 · [dette] E4, retirer course et vélo : `running/`, `cycling/`, `land/`, `LandModule`, panneaux cadence, pente, énergie, revêtement, poids et charge ; branches du direct, de `gpxWriter`, `summary`, `stats`, `SettingsPage`, `StatisticsPage`, `SessionLibrary`, `HeartRatePanel`, icônes, motifs, images ; `MotionPlugin` (cadence) ; résultat attendu : `LAND_FILES` et `SEAM` d'`architecture.test.ts` vides · noté 08/11 · gros · Opus/high · dépend de : 302 · détail : docs/backlog/154-vente-extraction-voile-surf.md
4. 304 · [dette] E5, planification réduite (option b, Q55 du 04/11) : `RouteMode` à `'straight' | 'imported'`, retrait de `brouter`, `brouterProfile`, `overpass`, `wayMatch`, `surface`, `wayTypes`, `legCalculation`, `loopReturn`, `ignAltimetry`, `importedElevation`, `duration`, composants de revêtement et de profil ; anciens itinéraires encore lisibles ; résultat attendu : parcours de balises et itinéraires importés seulement, plus aucun service public gratuit appelé · noté 08/11 · gros · Opus/high · dépend de : 303 · détail : docs/backlog/154-vente-extraction-voile-surf.md
5. 305 · [dette] E6, réduire les unions et les réglages : `SportType`, `Treatment`, `SportFamily`, `SportProfile`, `activities.ts` (graines, couleurs, `ACTIVITIES_VERSION`), `activityPresets`, `activitySettings` (`StoredSettings`, `PRESET_RESETS`, `PRESETS_VERSION`), `analysisTabs`, `liveFields`, `trackColor`, `tokens.css` ; résultat attendu : le compilateur ne liste plus rien de la terre, gardes du 187 vertes (réglages 0.4.61 et import à famille inconnue) · noté 08/11 · gros · Fable/high · dépend de : 304 · détail : docs/backlog/154-vente-extraction-voile-surf.md
6. 306 · [dette] E7, données d'une application complète : fiches au calcul retiré masquées au lieu de « À classer » ; clés terre plus écrites à `null` dans une fiche de voile ; résultat attendu : un dossier mémoire de Tracker complet s'ouvre sans bruit · noté 08/11 · petit · Sonnet/medium · dépend de : 305 · détail : docs/backlog/154-vente-extraction-voile-surf.md
7. 307 · [dette] Renvois d'atelier dans `src/` (« lot N », « Qnn », « l'utilisateur » → « l'auteur ») : « HISTORIQUE, point N » seule forme, ou la raison en clair ; test léger qui refuse « lot N » et « Qnn » hors tests ; glossaire d'une page, docs/GLOSSAIRE.md (« course », « mark », noms du calcul d'une session, noms de la FC) ; par groupes de dossiers, après E4 pour ne pas nettoyer ce qui part ; résultat attendu : rien de visible, un code lisible par l'acheteur · noté 08/11 · gros · Sonnet/medium · dépend de : 303 · détail : docs/backlog/160-dette-audit-vente.md

## Ça attend une occasion

**La livraison, une fois E2 à E7 et le n° 307 faits**
- 308 · [dette] E8, identité et livrable : identifiant d'application et espace de noms des GPX (ancien lu, nouveau écrit, fiche 153), crédits des images (relevé par l'utilisateur), politique de confidentialité, écran « À propos », brouillons des formulaires Play, manifeste (services et permission batterie, fiches 151 et 171), fonds de carte sous contrat ou tuiles de l'acheteur (Q5, fiche 152) ; docs réécrites (README, CLAUDE.md → ARCHITECTURE et CONTRIBUER, DECISIONS §2 et §5 retirées, ETAT refait, INVENTAIRE régénéré, HISTORIQUE nettoyé des liens claude.ai, des chemins du poste et de « ex. Tom ») ; atelier retiré (`.claude/`, BACKLOG, MODELES, `DOCUMENTS` de `outils/docs-cites.mjs` réduit) ; banc rebranché sur voile et surf ; puis dépôt réécrit en un seul commit (`git checkout --orphan`) ; résultat attendu : un dépôt livrable, sans identité du vendeur ni atelier · noté 08/11 · gros · Opus/high · dépend de : 306, 307 · détail : docs/backlog/153-vente-identite-images.md

## Plus tard

- 309 · [dette] Reste de la dette de l'audit du 03/11, à piocher au fil des lots : styles en ligne des panneaux voile, utilitaires `ui-*` sur l'échelle `--space-*`, `!important`, `PlanningPage` d'une seule fonction, petits ; résultat attendu : rien de visible, un code plus simple à reprendre · noté 08/11 · gros · Sonnet/medium · détail : docs/backlog/160-dette-audit-vente.md

## Questions

```
