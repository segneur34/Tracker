# 217, lot 1 · Le programme Windows et sa mémoire dans un vrai dossier du disque : plan

Périmètre (décidé le 21/11) : le lot 1 seulement de `docs/backlog/217-exe-ordinateur.md` : coquille Electron écrite à la main, vrai dossier du disque, `isDesktopApp()`, `@electron/packager`. Ni « Récupérer » ni « Synchroniser » (Q70), ni installeur, ni signature, ni corbeille. Téléchargement d'Electron accepté par l'utilisateur le 21/11 (partage de connexion du téléphone).

## Un portage, pas une écriture neuve

Gtracker a déjà fait ce travail (`D:\gong tracker\Gtracker`, lots 445 A et B, 446 A et B, 454, du 18 au 19/11). Lecture seule de ce dépôt par `git -C "D:/gong tracker/Gtracker" show <commit>:<fichier>` ; n'y lancer ni verif ni banc, n'y rien écrire. Plans de référence : `80a96ee:docs/backlog/445-plan-coquille.md` et `d839cf0:docs/backlog/446-plan-memoire-disque.md` (contrat complet du pont). Renommages : `gtracker` → `tracker`, `gtrackerBureau` → `trackerBureau`, `GTRACKER_*` → `TRACKER_*`, adresse `https://tracker.localhost`, profil `%APPDATA%\Tracker`, suffixes `.tracker-tmp` et `.tracker-new` (ceux de `MemoryFolderPlugin.java` de Tracker).

Tracker n'a ni `t()`, ni `legacyFolderCheck`, ni `reset.ts`, ni `boot.tsx`, ni `heritage.test.ts`, ni `mainImports.test.ts` : pas de dictionnaires ni de canal `coquille:textes`, la coquille garde ses textes en français.

## À télécharger

Electron 45.3.4 est déjà dans `%LOCALAPPDATA%\electron\Cache` : épingler exactement cette version. `@electron/packager` 20.3.0 et `@electron/fuses` 2.1.3 sont dans le cache npm : `npm install --prefer-offline` dans `bureau/`. Pas d'electron-builder. La racine ne reçoit aucune dépendance (APK et web intacts).

## Arborescence neuve `bureau/`

`package.json` (celui de Gtracker au commit 05a37c0 : electron 45.3.4, packager, fuses, `"type":"commonjs"`), `tsconfig.json` (CommonJS, sortie `bureau/dist/`), et, repris de 80a96ee : `origine.ts`, `protocole.ts` (sert `dist/` sous `https://tracker.localhost`, repli sur `index.html`, politique de contenu, autres hôtes par `net.fetch` avec `bypassCustomProtocolHandlers`), `main.ts` (une seule instance, navigation verrouillée, liens externes au navigateur de Windows, autorisations refusées par défaut, « Quitter sans enregistrer ? »), `preload.ts` (`sandbox`, `contextIsolation`, pas de `nodeIntegration`), `disque.ts`, `memoire.ts`, `pont.ts`, `sortant.ts` (en-têtes `Tracker/<version>` vers OpenStreetMap), chacun avec son test. `outils/bureau.mjs` et son test, pris à 80a96ee (sans `--installeur`) ; version `1.0.09` → `1.0.9` ; retire `ELECTRON_RUN_AS_NODE`, coupe les fusibles RunAsNode, NodeOptions, NodeCliInspect. Scripts npm `bureau` et `exe` (`bureau/sortie/Tracker-win32-x64/Tracker.exe`).

## Le pont

La page ne voit que `window.trackerBureau`, gelé (`version`, `memoire`), une fonction par canal `memoire:` (ouvrir, proposer, choisir, adopter, oublier, lister, lireTexte, lireOctets, stat, ecrireTexte, ecrireOctets, effacer). Un message n'est servi que s'il vient de la fenêtre principale et de l'adresse de l'application ; types des arguments vérifiés ; réponses `{ok,valeur}` ou `{ok:false,code}` (NOT_FOUND, PERMISSION, NO_SPACE, UNKNOWN). La page ne donne jamais de chemin absolu : `{racine:'memoire'|'candidat', chemin relatif en /}` ; refusés : `..`, `.`, antislash, deux-points, `<>"|?*`, caractères de contrôle, lettres de lecteur, noms réservés de Windows, point ou espace final, suffixes temporaires ; le chemin résolu reste sous la racine. Le dossier « candidat » est en lecture seule jusqu'à « Utiliser ce dossier » ; le dossier retenu est noté dans `%APPDATA%\Tracker\coquille.json`. Écriture sûre : temporaire, forcé sur le disque, renommé, nouveaux essais sur EBUSY et EPERM ; temporaires orphelins réparés au listage.

## Dans `src/` (d'après d839cf0, adapté)

Neufs : `src/platform/desktopBridge.ts` (seul fichier qui lit `window.trackerBureau`), `src/platform/diskMemory.ts` (`createDiskFolder`), `src/platform/memoryFolder.disk.test.ts` (charge le vrai `bureau/memoire.ts` par un `import()` à chemin variable).

Modifiés : `package.json` (deux scripts, PAS la version) ; `.gitignore` (`bureau/sortie/`) ; `outils/verif.mjs` (`tsc -p bureau --noEmit` si `bureau/node_modules/electron` existe) ; `src/platform/runtime.ts` (`isDesktopApp()`, `appShell()`) ; `src/platform/memoryFolder.ts` (`MemoryKind` reçoit `'disk'`, branches `isDesktopApp()` dans `canChooseFolder`, `chooseMemoryFolder`, `reconnectMemoryFolder`, `forgetChosenFolder`, `openMemoryFolder`, fonction `desktopMemoryPlace()`) ; `src/hooks/sessionLibrary/lifecycle.ts` (`chooseFolder` et `reconnectFolder` seulement) ; `src/components/MemoryStatus.tsx` (textes de la sorte `disk` dans la carte existante : « Dossier proposé : … », « Utiliser ce dossier », « Choisir un autre dossier », « introuvable » et « Réessayer », avertissement OneDrive ; « Revenir à la mémoire du navigateur » masqué) ; `src/architecture.test.ts` (`trackerBureau` dans `PLATFORM_ONLY`) ; `docs/INVENTAIRE.md` (la carte doit coller aux fichiers, `verif` le contrôle) ; `vite.config.ts` seulement si vitest descend dans `bureau/sortie`. Banc : `outils/banc/passe.mjs`, `scripts.mjs`, `LISEZMOI.md`, `SCRIPTS.md` (d'après b6e0728), `lib/cdp.mjs` (`records()` lit le disque si `TRACKER_MEMOIRE`), scripts neufs `exe-import.mjs`, `exe-tuiles.mjs`, `exe-fermeture.mjs`, `memoire-disque.mjs` (version d'avant la corbeille du lot 448 de Gtracker).

Gardes : les tests de `bureau/` et d'`outils/` n'importent jamais `electron` (ils passent sans `bureau/node_modules`) ; règle 12 tenue, seule la mémoire dépend de `isDesktopApp()`.

## Ordre

1. `bureau/` (package, tsconfig, origine, protocole, main, preload, sortant), `outils/bureau.mjs`, scripts npm, `.gitignore`, `verif.mjs` ; `npm run exe` produit le .exe.
2. `disque.ts`, `memoire.ts`, `pont.ts`, branchés, avec leurs tests.
3. `src/platform/` et son test.
4. `lifecycle.ts`, `MemoryStatus.tsx`, garde d'architecture, INVENTAIRE.
5. Scripts du banc.

## Vérifier sans écran (fait par l'orchestrateur après rapatriement)

Neutralité sous Chrome (passage courant avant/après, identique) ; le programme : `node outils/banc/passe.mjs --exe bureau/sortie/Tracker-win32-x64/Tracker.exe -j 1` (mode `TRACKER_BANC=1` : fenêtre cachée, profil à part, port de débogage refusé hors de ce mode, réseau extérieur refusé) ; `memoire-disque.mjs` (profil vide, « Utiliser ce dossier », import d'un GPX synthétique, fichiers sur le disque, second lancement, dossier renommé = « introuvable » sans rien recréer, temporaires réparés). Jamais en même temps que le banc de Gtracker.

## Tranché par défaut la nuit du 21/11, à confirmer

- Dossier proposé : `Documents\Tracker`, ou `C:\Users\<nom>\Tracker` si Documents est dans OneDrive ; « Choisir un autre dossier » reste offert.
- Adresse `https://tracker.localhost` et profil `%APPDATA%\Tracker`, figés pour la suite (la mémoire interne du programme y est attachée).
- DECISIONS §8 (« sur le PC, l'utilisateur reste sur Firefox ») : à réécrire à la passe doc après validation.

## Tranché par l'orchestrateur

Mémoire interne du programme ignorée ; dossier introuvable jamais recréé ; ni installeur ni signature (écran SmartScreen au premier lancement) ; icône de Tracker si un `.ico` se tire de `outils/logo/`, sinon celle d'Electron ; modèle Opus/high pour ce lot (portage d'un code déjà éprouvé), la ligne disait Fable pour l'élément entier.
