# 217 · Tracker en programme Windows (.exe) et synchronisation avec le téléphone par le câble

Étude du 12/11/2026, à la demande de l'utilisateur. Rien n'est codé. Recherches documentaires à côté : `docs/backlog/217-exe-recherche-coquilles-mtp.md` et `docs/backlog/217-exe-recherche-diffusion.md` (agents Sonnet ; plusieurs chiffres viennent de pages résumées, à revérifier avant de s'y fier).

## Ce que veut l'utilisateur

- Un .exe utilisable sur l'ordinateur, sans tout recoder ; le plus simple, pas au détriment de la qualité.
- Un bouton qui va chercher les sessions dans le téléphone branché, sans réseau, l'autorisation donnée au moins une fois ; et tout avoir des deux côtés, téléphone et ordinateur.
- Ce qui sera fait ici servira de base à Gtracker (dit le 12/11) : garder le travail additif (fichiers neufs, peu de retouches de l'existant), facile à reporter.
- Dit le 12/11 : aucune session n'existe seulement dans la mémoire de Firefox du PC. Rien à déménager.
- Rendu attendu de l'étude : des propositions et des angles d'attaque ; le code vient plus tard.

## Mesuré sur le poste le 12/11 (essais jetables hors du dépôt)

- `dist/` (3 Mo, version 1.0.06) s'ouvre tel quel dans Electron 45.3.1 (Chrome 156), servi par un protocole maison `app://tracker` (schéma `standard`, `secure`, `supportFetchAPI`, repli sur `index.html` pour le routeur) : accueil, `/voile`, `/statistiques`, `/parametres` rendus, aucune erreur de console.
- Dans cette coquille : contexte sûr, mémoire privée (OPFS) créée, `navigator.storage.persist()` accordé (Firefox le refuse), `showDirectoryPicker` présent, `localStorage` écrit, une tuile d'OpenStreetMap lue (200).
- Un vrai `Tracker essai.exe` fabriqué par `@electron/packager` en 15 s, sans droits d'administrateur ; il s'ouvre. Dossier non compressé : 360 Mo ; mémoire au repos : environ 390 Mo sur quatre processus (somme brute). Installeur non fabriqué (ordre de grandeur lu : 85 à 106 Mo).
- Téléphone par le canal développeur (adb, déjà autorisé sur ce PC) : 126 fichiers de `Documents/Tracker/sessions` listés avec taille et date en 0,1 s ; depuis le processus de la coquille en 0,7 s ; la mémoire entière (146 fichiers, 69 Mo) copiée en 10,7 s.
- Par le canal « Transfert de fichiers » (MTP) : le téléphone n'apparaît pas dans Windows tant que ce mode n'est pas choisi sur le téléphone ; non essayé plus loin.
- Non conclu : faire ranger par la coquille les sessions copiées, à travers le champ « Ajouter les sessions d'un dossier » piloté par script (le script d'essai n'a rien rangé ; cause non cherchée, sans doute le script). L'import lui-même est du code de navigateur déjà en service sous Chrome.
- Piège du poste : le terminal de l'éditeur pose `ELECTRON_RUN_AS_NODE=1`, qui fait démarrer Electron comme un simple Node ; le retirer avant de lancer.
- Outils : WebView2 157 présent ; ni Rust ni Visual Studio ; .NET sans SDK.

## Ce que le code offre déjà

- Un seul aiguillage, `isNativeApp()` (`src/platform/runtime.ts`), 88 emplois, presque tous dans `src/platform/`. Un troisième cas « ordinateur » y a sa place.
- `MemoryFolder` (`src/platform/memoryFolder.ts`) : l'interface d'un dossier (lister, lire, écrire, taille et date, effacer), trois sortes aujourd'hui (`browser`, `picked`, `device`). Un dossier du disque et un dossier du téléphone lu par le câble en sont deux autres.
- `ImportEntry` et `importEntries` (`src/hooks/sessionLibrary/importer.ts`) : un import de dossier lit chaque fichier au dernier moment, ne duplique jamais (identité = instant du premier point), complète une fiche sans rien écraser. « Récupérer depuis le téléphone » = une liste d'`ImportEntry` dont la lecture passe par le câble.
- Fusion d'une fiche champ par champ (`src/library/recordMerge.ts`), un fichier de réglages par appareil (`reglages/`), FC repos fusionnée : le dossier mémoire a été pensé pour plusieurs appareils (ETAT §6.1, DECISIONS §8).
- Côté téléphone, rien à ajouter : des fichiers posés dans `Documents/Tracker` sont pris au lancement ou à « Mettre à jour ».

## Propositions

### La coquille

| | Electron | Tauri 2 | Recoder |
|---|---|---|---|
| Moteur | son propre Chrome | celui de Windows (WebView2) | autre |
| Installeur | environ 100 Mo | environ 10 Mo | variable |
| Langage ajouté | aucun | Rust | un second code complet |
| À installer sur le poste | rien | Rust et les outils C++ de Microsoft | selon |
| Rendu | celui du banc | selon la version d'Edge | à refaire |

- Le greffon `@capacitor-community/electron` est à l'abandon (Capacitor 5) : coquille écrite à la main.
- Recommandé : Electron. Seule la coquille serait à refaire pour passer à Tauri ; le cas « ordinateur » de `platform/` et la synchronisation restent.

### Le canal vers le téléphone

- Canal développeur (adb) : autorisation une fois, à redonner après 7 jours sans branchement sauf option du téléphone ; rapide, mesuré. Exige les options pour développeurs : pour l'utilisateur seulement. Employer l'adb déjà sur le poste évite d'en redistribuer un (licence du binaire de Google non tranchée).
- Canal « Transfert de fichiers » (MTP) : pour tout téléphone, à choisir sur le téléphone à chaque branchement (Xiaomi y revient toujours). Aucune pièce prête en JavaScript ; en Rust, la crate `mtp-rs` passe par Windows sans pilote ; en .NET, `MediaDevices`. Donc un petit programme auxiliaire, quelle que soit la coquille. À vérifier sur le vrai téléphone : des fichiers écrits par l'application peuvent manquer à la liste tant qu'Android ne les a pas indexés (remède connu : demander l'indexation après chaque écriture).
- Lien direct par le câble (mode accessoire) : pilote Windows probable, écarté. ADB dans le navigateur (WebUSB) : pas dans Firefox, et gêné par un adb déjà lancé.
- Recommandé : la synchronisation écrite sur un `MemoryFolder` du téléphone, canal développeur d'abord, MTP ajouté pour Gtracker.

### Le bouton

- « Récupérer » (téléphone vers PC) : l'import d'un dossier, pointé sur le téléphone.
- « Synchroniser » (deux sens) : sessions, fiches, itinéraires, fichiers de réglages, FC repos. Fiche changée des deux côtés : fusion champ par champ, en gardant sur le PC la copie de la dernière synchronisation comme référence. Réglages : chaque appareil garde les siens (décision en place).
- Suppressions : sans trace, une session supprimée d'un côté revient de l'autre. Question Q70.

### Angles d'attaque

1. Le .exe d'abord (coquille, vrai dossier du disque), puis « Récupérer », puis « Synchroniser » : trois lots, chacun utile seul. Recommandé.
2. Dépannage sans .exe : un outil de `outils/` qui copie le dossier du téléphone, puis l'import dans Firefox. Rapide, mais rien n'en sert à Gtracker.
3. Tout d'un coup : un seul gros lot.

## Diffusion de la version vendue (pour Gtracker)

- .exe non signé : écran « Windows a protégé votre PC ».
- Certificat pour un particulier français : environ 209 € par an (Certum), et l'avertissement ne tombe qu'avec la réputation. La signature d'Azure n'est pas ouverte aux particuliers français.
- Microsoft Store : compte gratuit pour un particulier, paquet signé par Microsoft, aucun avertissement ; à essayer avec le programme auxiliaire du câble à l'intérieur.
- Tuiles d'OpenStreetMap : une application de bureau doit s'annoncer par son nom (User-Agent).

## À trancher par l'utilisateur

- Q70 : une session supprimée d'un côté disparaît-elle de l'autre ? Par défaut oui.
- L'angle d'attaque (1 recommandé) et la coquille (Electron recommandé).

## Premier pas du lot 1, quand il sera lancé

- Coquille dans un dossier neuf (`bureau/`), `isDesktopApp()` à côté de `isNativeApp()`, sorte `disk` de `MemoryFolder` par un pont de la coquille (dossier désigné une fois, sans autorisation à redonner).
- Fabriquer l'installeur et mesurer son poids ; `electron-builder` trébuche sous Windows sans droits d'administrateur (extraction de `winCodeSign`), `@electron/packager` passe.
- Preuve de neutralité au banc : mêmes pages, même texte que dans Chrome.
