# Coquilles de bureau et synchronisation USB d'un téléphone Android : état au 12/11/2026

Méthode : recherche web, lecture de pages officielles, API GitHub, crates.io, registre npm, NuGet. Chaque point est marqué « confirmé (source, date) », « partiel » ou « non confirmé ». Je n'ai rien installé ni mesuré moi-même.

Limite générale : l'outil de lecture résume les pages avec un petit modèle. Les chiffres ci-dessous viennent de ces résumés, pas d'une lecture intégrale.

---

## A. Electron en 2026

**Version stable actuelle**
- Confirmé : Electron 45.3.1, publié le 2026-11-12 (https://api.github.com/repos/electron/electron/releases/latest). Le registre npm donne aussi `latest` = 45.3.1 (https://registry.npmjs.org/electron).
- Confirmé : la page officielle des versions liste 45.2.3 comme stable (https://releases.electronjs.org/), c'est un instantané plus ancien.
- Confirmé : Electron 44.7.0 (Chromium 152, Node 24) sorti le 2026-10-07, 45.0.0-beta.1 le 2026-10-08 (https://tech-insider.org/electron-44-7-0-chromium-152-node-24-2026/). Source secondaire.
- Non confirmé : version de Chromium et de Node de la 45.x (corps de la fiche tronqué).

**Rythme**
- Confirmé : une version majeure tous les 8 semaines environ ; les 3 dernières majeures sont suivies (https://electronjs.org/docs/latest/tutorial/electron-timelines ; https://endoflife.date/electron). Les dates sont des objectifs, elles bougent.
- Conséquence : une version majeure est abandonnée en environ 6 mois. L'application devra suivre ou accepter un Chromium non corrigé.

**Taille réelle d'un installeur**
- Confirmé : l'archive Windows x64 d'Electron 45.3.1 pèse 158 352 921 octets, soit 158 Mo (pièce jointe de https://api.github.com/repos/electron/electron/releases/latest, 2026-11-12). C'est le plancher avant compression.
- Partiel : mesures de tiers pour un « hello world » : environ 85 Mo (blog dev.to, Electron 34), 106 Mo (banc Dawloom, Windows 11, 2026-10-23, d'après un résumé), 45 Mo dans un article Medium ancien. Une installation sur disque tourne autour de 230 Mo dans un fil Stack Overflow.
- Non confirmé : chiffres précis NSIS contre « portable » pour 3 Mo de fichiers web. Ordre de grandeur raisonnable : NSIS environ 80 à 110 Mo, portable (un seul .exe auto-extractible) un peu plus gros et plus lent au premier lancement. À mesurer en construisant un projet vide.

**Mémoire au repos**
- Non confirmé avec méthode. Chiffres épars : 168 Mo (Electron) contre 42 Mo (Tauri) dans un comparatif ; 409 Mo contre 172 Mo dans un autre ; 200 à 300 Mo « au repos » pour Electron ailleurs (https://tech-insider.org/tauri-vs-electron-desktop-app-framework-2026/, https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/). Ces pages sont de qualité inégale. Prévoir 150 à 300 Mo en tout (plusieurs processus), à mesurer.

**Outil d'emballage**
- Confirmé : electron-builder est vivant. Dernière publication relevée : electron-updater 6.8.12 le 2026-10-26 (https://api.github.com/repos/electron-userland/electron-builder/releases/latest). Le registre npm donne `latest` = 26.18.0 pour electron-builder (date non lue).
- Non confirmé : une recommandation officielle « aujourd'hui » entre electron-builder, Forge et @electron/packager. Pas lu la page de choix d'Electron. Mon avis, non sourcé : pour un .exe NSIS ou portable sans écrire de maker, electron-builder est le plus direct ; Forge est l'outil mis en avant par Electron.

**Piège electron-builder sous Windows sans droits d'administrateur**
- Confirmé : l'archive `winCodeSign` contient des liens symboliques macOS. Windows refuse de les créer sans privilège (« A required privilege is not held by the client »). Ticket https://github.com/electron-userland/electron-builder/issues/8149, ouvert le 2024-03-22, fermé le 2026-02-09 mais l'échec réapparaît dans les commentaires.
- Confirmé (même ticket) : electron-builder 26.8.0 (février 2026) apporte un nouvel outillage en option : `toolsets: { winCodeSign: "1.1.0" }`. Défaut inchangé jusqu'à la v27. En 26.8.1, le binaire `app-builder-bin` (étape rcedit, qui pose l'icône) ignorait encore ce réglage sur Windows (commentaire du 2026-02-26). Migration rcedit vers resedit en cours (PR #9717, 2026-05-11) ; fusion non confirmée.
- Contournements confirmés dans le ticket : mode développeur Windows (autorise les liens symboliques sans administrateur ; confirmé par une source tierce, pas par Microsoft), extraire à la main l'archive dans le cache d'electron-builder, lancer en administrateur, ou reculer à 24.6.3.
- Non confirmé : si 26.18.0 règle le problème sans réglage. À tester d'abord : activer le mode développeur, puis construire.

**Servir une application à routeur « history »**
- Confirmé : `protocol.handle(scheme, handler)` reçoit une requête et renvoie une `Response`. `protocol.registerSchemesAsPrivileged` doit être appelé avant `ready`, une seule fois (https://www.electronjs.org/docs/latest/api/protocol). Privilèges : `standard`, `secure`, `supportFetchAPI`, `stream`, `bypassCSP` (et `corsEnabled`, non listé dans mon résumé : non confirmé).
- Confirmé : localStorage, sessionStorage, IndexedDB et cookies sont désactivés par défaut pour un schéma non standard ; l'API de système de fichiers exige un schéma `standard` (même page).
- Bonne pratique (pratique courante, non tirée d'une page unique) : schéma `app://tracker/…`, gestionnaire qui sert `dist/` et renvoie `index.html` pour toute route sans fichier (repli « history »).
- Non confirmé : comportement d'OPFS (`navigator.storage.getDirectory`) et de la Cache API sur un schéma privilégié. Deux conditions probables : schéma `standard` + `secure`. À tester dans un projet vide. Comme ces données sont liées à l'origine, tout changement de schéma ou de nom d'hôte repart d'un stockage vide.
- Piège lié : le gestionnaire s'applique à la session par défaut ; une session à partition demande `ses.protocol.handle`.

**CORS et serveurs tiers**
- Non confirmé pour chaque serveur : tuiles OSM, Esri, brouter.de, Overpass, IGN. Depuis une origine `app://`, un `fetch` vers un autre domaine est soumis aux règles CORS comme dans un navigateur. Les tuiles en `<img>` n'en dépendent pas ; un `fetch` (cache de tuiles, BRouter, Overpass) oui. Solution habituelle : faire passer ces appels par le processus principal (module `net`, pas de CORS, en-têtes libres) ou retirer les en-têtes dans `session.webRequest.onBeforeSendHeaders` / `onHeadersReceived`. Non testé ici.

**Politique d'usage des tuiles OSM**
- Confirmé (https://operations.osmfoundation.org/policies/tiles/, lue le 2026-11-12, date de dernière révision non lue) :
  - Application native : pas de `Referer` exigé, mais un `User-Agent` distinct, stable, qui nomme l'application (contact facultatif). Les valeurs par défaut de bibliothèque sont bloquées ; pas d'imitation d'un navigateur.
  - Pas de section « bureau » : les mêmes règles s'appliquent.
  - Respecter `Cache-Control`, `Expires`, `ETag` ; à défaut garder les tuiles 7 jours au moins.
  - Téléchargement en masse et usage hors ligne interdits sur tile.openstreetmap.org (pré-remplir des zones, fabriquer des .mbtiles). Alternatives : tuiles auto-hébergées, fournisseur qui l'autorise.
- Conséquence pour l'application : la fonction de tuiles en cache hors ligne est en conflit avec cette politique (vaut déjà pour la version Android).

---

## B. Tauri 2 en 2026

**Version**
- Confirmé : crate `tauri` 2.12.5, mise à jour le 2026-11-06 (https://crates.io/api/v1/crates/tauri). Annonce de la 2.12 le 2026-09-26 (https://v2.tauri.app/blog/tauri-2.12/).
- Confirmé : une branche 3 existe en préversion : `tauri-v3.0.0-alpha.6` le 2026-11-06, avec un paquet `tauri-runtime-cef` 3.0.0-alpha.7 (https://api.github.com/repos/tauri-apps/tauri/releases). Une exécution avec Chromium embarqué (CEF) en plus de WebView2 est donc en préparation. Alpha : pas pour une livraison. Non confirmé : ce que cela change pour la taille.
- Confirmé (annonce 2.12) : fin du support officiel de Windows 7 ; version minimale de Rust 1.90 (politique « stable moins 3 »).

**Ce qu'il faut installer sous Windows**
- Confirmé (https://v2.tauri.app/start/prerequisites/) : Microsoft C++ Build Tools, charge « Développement Desktop en C++ » ; Rust par rustup, chaîne MSVC par défaut (`rustup default stable-msvc`) ; WebView2 déjà présent sur Windows 10 à partir de 1803 et sur Windows 11. MSI : fonction facultative VBSCRIPT de Windows.
- Non confirmé : taille des Build Tools et droits d'administrateur. D'après mes connaissances, non sourcées : plusieurs Go (environ 3 à 8 Go avec le SDK Windows) et une installation qui demande l'élévation ; il existe des installations par ligne de commande sans interface, mais elles passent aussi par l'élévation. À vérifier si le poste est restreint.
- Rien ne dit que .NET suffit : Tauri compile du Rust, il faut donc Rust et MSVC.

**Taille d'un installeur**
- Partiel : 1 à 3 Mo pour un projet vide, 12 Mo pour une vraie application (comparatifs de tiers, dont le banc Dawloom du 2026-10-23 : 1,05 Mo contre 106,1 Mo pour Electron ; https://tech-insider.org/tauri-vs-electron-2026/ et pages voisines). Non mesuré par moi. Le moteur est celui de Windows, donc non compté.

**WebView2**
- Confirmé : présent d'office sur Windows 11 et sur Windows 10 1803 et plus (page des prérequis). Sinon : réglage `bundle.windows.webviewInstallMode` pour embarquer l'amorce. Non confirmé : cas des Windows 10 sans mise à jour ou d'images LTSC (la page cite Server et LTSC comme pouvant manquer).

**Différences de rendu avec Chrome**
- Confirmé partiellement : WebView2 est basé sur Chromium et se met à jour seul, donc le rendu est proche de Chrome. Piège : la version de Chromium n'est pas fixée par l'application, elle suit la machine. Non confirmé : écarts précis pour Leaflet, Recharts, OPFS ; aucune source trouvée.

**Fichiers et binaire embarqué**
- Confirmé (https://v2.tauri.app/develop/sidecar/) : `bundle.externalBin` ; chaque binaire doit exister sous le nom `<nom>-<triplet cible>` (avec `.exe` sous Windows) ; autorisation `shell:allow-execute` ou `shell:allow-spawn` dans `capabilities` avec `sidecar: true` ; appel `Command.sidecar(...)` (plugin shell) depuis le JavaScript. Arguments restreints par liste ou par expression régulière.
- Non confirmé : portées du plugin fs en détail (non lu).
- Remarque : on peut embarquer un petit .exe .NET comme « sidecar » ; la partie écrite en Rust se réduit alors à la configuration.

**Origine servie**
- Confirmé : Windows utilise `http://tauri.localhost` depuis la 2.0 (changement cassant des alphas) ; l'option `useHttpsScheme` (Windows et Android) passe à `https://tauri.localhost` (https://v2.tauri.app/reference/config/, mention de l'origine dans un exemple ; option citée dans https://skills.sh/nevaberry/nevaberry-plugins/tauri-knowledge-patch).
- Inférence non confirmée : le stockage étant lié à l'origine, basculer entre http et https repart d'un stockage vide. Choisir une fois et ne plus changer.
- Non confirmé : OPFS et CORS sous cette origine. Un `fetch` vers des serveurs tiers passe par les règles CORS du navigateur ; le plugin « http » de Tauri (appel côté Rust) les contourne (non lu, à confirmer).

**Écrire la partie native sans Rust ?**
- Infirmé pour Tauri lui-même : le cœur est en Rust ; l'API JavaScript et les plugins officiels couvrent beaucoup (fs, shell, http, dialog), ce qui évite d'écrire du Rust pour des cas simples (https://dev.to/huakun/tauri-without-electron-bloat-a-type-safe-js-runtime-bridge-with-tauri-plugin-js-35m8 : retour d'un développeur).
- Sérieux sans Rust, ailleurs, non évalués en profondeur : Ryn (.NET, NativeAOT, webview système ; NuGet Ryn 0.30.0 : préversion), Deno desktop (expérimental depuis Deno 2.9, 2026-06-25 ; 68,5 Mo avec la webview et 308,9 Mo avec CEF selon The Register, sur macOS), Electrobun, Wails (Go), Neutralino.

---

## C. @capacitor-community/electron

- Confirmé : dernière version npm 5.0.1, septembre 2023 ; dépend de `@capacitor/core` et `@capacitor/cli` `>=5.4.0` ; Electron 26 en développement (https://raw.githubusercontent.com/capacitor-community/electron/main/package.json ; https://registry.npmjs.org/@capacitor-community/electron).
- Confirmé : dernier commit utile le 2023-09-21 ; un seul commit depuis (README, 2026-07-13) (https://api.github.com/repos/capacitor-community/electron/commits). Dépôt non archivé, 66 tickets ouverts.
- Confirmé : Capawesome écrit que la plateforme n'est « plus activement maintenue » (https://capawesome.io/docs/blog/capacitor-community-electron-migration/, article du 2026-07-17, page datée du 2026-09-25).
- Capacitor 8 : sorti le 2025-12-08 (https://ionic.io/blog/announcing-capacitor-8). Aucune version du greffon communautaire ne le vise. Le `>=5.4.0` n'empêche pas l'installation mais rien n'est testé contre Capacitor 8 ni contre un Electron récent (le modèle généré embarque Electron 26, dépassé depuis longtemps).
- Remplaçant : `@capawesome/capacitor-electron`. Exigences annoncées : Capacitor 6+ et Electron 28+ (même article). Un autre article de juillet 2026 parle de « Capacitor 8 et Tauri 2 » : contradiction, probablement un autre produit. Non confirmé : licence réelle, prix, version et date du paquet. Il n'est pas obligatoirement gratuit : mon résumé dit « MIT, gratuit », à revérifier sur npm.
- Verdict : ne pas utiliser le greffon communautaire. Une coquille Electron écrite à la main (une trentaine de lignes : `main.ts`, `preload.ts`) est plus sûre, d'autant que l'application n'a besoin ni des greffons Capacitor natifs ni d'un pont. Le code `platform/*` de l'application se rebranche sur Electron par `isNativeApp()`-like, pas par Capacitor.

---

## D. Lire et écrire par MTP depuis Windows (WPD)

Rappel : sous Windows, la voie propre vers un téléphone en MTP est WPD (COM, `PortableDeviceApi`). Un téléphone à l'état « Transfert de fichiers » est déjà pris par le pilote MTP de Windows. Une bibliothèque qui parle USB directement (libmtp, `nusb`) doit remplacer le pilote par WinUSB (Zadig) : à éviter.

### D.1 Node / Electron
- Confirmé : aucun module npm maintenu et à binaires précompilés qui expose WPD (recherche web du 2026-11-12). Les candidats parlent à libmtp ou en WebUSB : `node-mtp` (marqué déprécié ; N-API sur libmtp), `luck-node-mtp` (libmtp), `webmtp` (WebUSB), `@dlenroc/wdp` (non évalué). Non confirmé : leur compatibilité avec Electron 45.
- Voie réaliste : un module natif maison en C++ (node-addon-api) ou, plus simple, un exécutable auxiliaire (voir D.3) lancé par `child_process`.

### D.2 Rust / Tauri
- `winmtp` 0.3.2, publié le 2026-03-23, 9 585 téléchargements, 77 commits, 4 étoiles, MIT (https://crates.io/api/v1/crates?q=winmtp ; https://github.com/daladim/winmtp). Confirmé : « petite fraction » de WPD ; énumération des appareils et des contenus, transfert depuis et vers des appareils de type disque (Provider, `device`, `object`, `io` avec `Read`/`Write`). Suppression : non mentionnée dans la documentation. Écrasement : non mentionné. Immature, auteur unique.
- `mtp-rs` 0.38.1, publié le 2026-11-11, 14 100 téléchargements, 423 commits, 49 étoiles, MIT ou Apache-2.0 (https://github.com/vdavid/mtp-rs). Confirmé (README du crate) :
  - sous Windows, l'API de haut niveau `mtp::` passe par WPD, « sans Zadig ni pilote », même code que sur Linux et macOS ; l'API basse `ptp::` n'atteint que les appareils liés à WinUSB ;
  - liste, lecture (`download_to_vec`, flux, lecture par plage), écriture (`upload`), suppression (`delete`, dossier vidé d'abord), déplacement, copie, renommage ;
  - débits mesurés sur Windows : 1 Go en lecture en 6,5 s, 1 Go en écriture en 4,8 s ; liste de 3 248 photos en 0,40 s sur un Galaxy S23 Ultra (en une requête, contre 5,5 s en une requête par fichier) ;
  - piège cité : le pilote Windows peut se bloquer plusieurs minutes après des changements de fichiers sur le téléphone, d'où la nécessité de délais maximaux ; une écriture échouée peut laisser un objet partiel ;
  - Android n'accepte que `0xFFFFFFFF` comme racine pour créer ; Samsung refuse le listage de la racine avec le handle 0 (contourné) ; le listage récursif par `ObjectHandle::ALL` ne rend que les dossiers.
  - Écrasement : non décrit. Les objets MTP n'ont pas d'écriture en place : le plan sûr est suppression puis création (voir E).
- Crate `windows` avec `Win32_Devices_PortableDevices` : existe (c'est ce que `winmtp` enveloppe) ; non évalué plus avant.
- Pas de crate `wpd` autonome trouvée.

### D.3 .NET
- `MediaDevices` (auteur Ralf Beckers, https://github.com/Bassman2/MediaDevices) : version 2.0.0, mise à jour le 2026-08-20 (https://www.nuget.org/packages/MediaDevices). Confirmé : réécriture complète, sûre pour les fils, compatible AOT et élagage (« COM généré et LibraryImport »), cibles net8.0, net9.0, net10.0 sous Windows ; la série 1.x finit à 1.10.0 en janvier 2023 (net Framework : rester en 1.x).
- Non confirmé : les noms exacts des méthodes (l'ancienne API : `MediaDevice.GetDevices()`, `Connect()`, parcours de dossiers, `DownloadFile`, `UploadFile`, `DeleteFile` ; ces noms viennent de mon souvenir de la 1.x, pas relus), le comportement d'écrasement, les dates de modification.
- AOT et COM : l'auteur annonce la compatibilité AOT (source ci-dessus). Non testé par moi. Taille d'un .exe NativeAOT d'une petite console : de l'ordre de 2 à 5 Mo (ma connaissance, non sourcée). Publication autonome (self-contained, élagué) : de l'ordre de 15 à 70 Mo selon l'élagage. Avec .NET déjà sur le poste, un exécutable dépendant du runtime fait quelques centaines de Ko mais exige .NET 8+ chez l'utilisateur : à éviter pour un grand public.
- Alternative .NET : appeler WPD directement par `ComImport` : plus de code, aucune dépendance.

### D.4 PowerShell / Shell.Application
- Confirmé en partie (fils Stack Overflow et forums, anciens) : `Shell.Application` copie en arrière-plan ; `CopyHere` ne signale pas la fin ; des scripts doivent attendre ; des boîtes de dialogue de confirmation apparaissent même avec des drapeaux de suppression d'interface ; l'espace de noms se prend par `NameSpace(0x11)` puis filtrage sur le nom du téléphone.
- Non confirmé : dates de modification et attributs via `ExtendedProperty` ; aucune source utile trouvée.
- Voie la plus fragile : à n'utiliser que pour un essai.

### Tableau pour un dossier de 1 500 fichiers (taille + date)
| Voie | Lister | Lire | Écrire | Remplacer | Supprimer |
|---|---|---|---|---|---|
| mtp-rs (WPD) | confirmé : 0,4 s pour 3 248 objets (Galaxy S23, une requête) | confirmé | confirmé | non décrit, supprimer puis créer | confirmé |
| winmtp | partiel | partiel | partiel | non confirmé | non documenté |
| MediaDevices 2.0 | non confirmé (chiffre) | non confirmé | non confirmé | non confirmé | non confirmé |
| Shell.Application | non confirmé, lent par éléments | oui, asynchrone | oui, asynchrone | non confirmé | non confirmé |
| module Node | n/a | n/a | n/a | n/a | n/a |

Aucune durée « typique » sourcée pour MediaDevices et Shell ; à mesurer sur le téléphone réel. Ordre d'idée (non sourcé) : WPD avec propriétés demandées en lot, 1 500 fichiers en une à quelques secondes ; une requête par fichier, dix fois plus.

---

## E. Défauts de MTP sur Android 14 à 16

- Confirmé (mécanisme, sources anciennes) : Android sert en MTP ce que MediaStore a indexé, pas le système de fichiers brut (https://forum.getodk.org/t/request-odk-collect-to-call-mediascannerconnection-scanfile/16152 ; https://essential-books.onrender.com/essential/android/solving-invisible-mtp-files-problem.-816c620201c241448fc40d22d1f9f025.html). Un fichier non indexé manque, ou apparaît avec une taille de 0, jusqu'à une analyse ou un redémarrage (https://www.ghisler.ch/board/viewtopic.php?p=361140 ; https://b4x.com/android/forum/threads/exposing-non-media-files-to-a-connected-pc.100544/).
- Partiel : le code MTP d'AOSP (dérivé /e/OS) appelle `MediaStore.scanFile` après ajout d'un objet par MTP lui-même ; cela concerne les écritures venues du PC, pas celles d'une application (https://gitlab.e.foundation/e/os/android_frameworks_base/-/commit/23ed52f9716134e5ea7fe9c90bedab29cf90876c).
- Non confirmé : que ce défaut subsiste sur Android 14, 15 et 16. Aucun rapport daté de 2025-2026 trouvé, ni correctif annoncé par Google. La doc Android limite la collection Files de MediaStore aux fichiers de l'application elle-même (scoped storage) : cela ne dit pas ce que MTP sert.
- Non confirmé : les écritures par SAF (ExternalStorageProvider) déclenchent-elles l'indexation ? Aucune source. ExternalStorageProvider écrit directement dans le système de fichiers ; mon hypothèse, non vérifiée, est que MediaStore le voit au prochain passage de l'analyseur de volume mais pas immédiatement. À tester : écrire un fichier par l'application, puis le chercher dans l'Explorateur sans rien faire d'autre.
- Forcer l'indexation : `MediaScannerConnection.scanFile(context, chemins, types, rappel)` après fermeture du fichier ; confirmé par les sources ci-dessus comme le remède classique. Il faut un chemin de fichier réel : avec SAF, le résoudre depuis l'URI de document (`primary:Documents/Tracker/…` donne `/storage/emulated/0/Documents/Tracker/…`). Non testé sur Android 14+.
- Xiaomi / HyperOS : confirmé (article dev.to https://dev.to/hiyoyok/mtp-on-android-is-a-minefield-what-i-learned-after-building-my-own-mac-client-4jk7) : Xiaomi repasse en « charge seule » à chaque branchement ; changer de mode en cours de session peut tuer la session MTP. Non confirmé : défauts propres à HyperOS 2/3 sur l'indexation.
- Mode USB : confirmé : le défaut Android est la charge seule ; l'utilisateur choisit dans la notification (https://anexplorer.io/solve/android-not-detecting-usb). Samsung : à partir d'One UI 8.0, le défaut est « Charge seule » (https://www.samsung.com/us/support/answer/ANS10013049/, page résumée).
- Réglage « Configuration USB par défaut » (Options pour les développeurs) : confirmé qu'il existe et évite l'invite (https://www.techbone.net/android/default-usb-configuration). Contre-indication : AOSP (variante /e/OS) l'a rendu non persistant, le débranchement remet « charge seule » ; des utilisateurs signalent que « charge seule » revient toujours (https://forums.androidcentral.com/threads/anyone-know-how-to-maintain-a-persistent-mtp-usb-connection-in-marshmallow.599070/latest). Non confirmé : persistance sur Android 14 à 16 selon les marques. Ce n'est pas le seul moyen (la notification marche) mais c'est le seul à ne pas redemander.
- Déverrouillage : non confirmé par une source. Connaissance générale (non sourcée) : MTP n'expose pas le stockage tant que l'écran est verrouillé sur Android récent ; il faut déverrouiller. À tester.
- Autres pièges notés (article dev.to) : hubs USB instables, noms de fichiers avec `\ / : * ? " < > |`, tailles de plus de 4 Go. Débranchement en cours de transfert : cas d'erreur principal.

---

## F. Autres voies par câble

### F.1 Android Open Accessory (AOA)
- Confirmé (mécanisme Microsoft) : WinUSB se charge sans fichier INF si l'appareil présente des descripteurs « Microsoft OS » (WCID / OS 2.0) (https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/automatic-installation-of-winusb). adbd les présente depuis Android 10 (https://gitlab.e.foundation/e/os/android_system_core/-/commit/db64696b7cbe632772d9851ed427f3465e07c7ae), d'où ADB sans pilote Google sur Windows récent.
- Non confirmé : que le mode accessoire (VID 0x18D1, PID 0x2D00/0x2D01) présente ces descripteurs. Les pages officielles Android sur l'AOA n'étaient pas lisibles (404). Je ne connais pas de garantie ; probable qu'il faille Zadig ou un INF. L'AOA exige en outre une application Android qui accepte l'accessoire, et le PC doit parler USB brut (libusb/WinUSB). Difficulté élevée, valeur faible ici.

### F.2 ADB par WebUSB (Tango / ya-webadb)
- Confirmé : dépôt vivant, dernier envoi le 2026-11-06, 3 289 étoiles, 5 tickets ouverts ; versions 3.0.0-beta.5 (2026-11-06), 3.0.0-beta.4 (2026-10-09), 2.6.4 (2026-09-02) (https://api.github.com/repos/yume-chan/ya-webadb/releases). Docs : https://tangoadb.dev/ (ancien domaine redirigé).
- Confirmé (https://tangoadb.dev/tango/daemon/usb) : WebUSB dans les navigateurs Chromium ; en Node, paquet `usb` ; sous Windows une seule application peut réclamer l'interface ADB : si un serveur `adb` de Google tourne déjà, WebUSB ne peut pas la prendre (Tango propose un transport « serveur » pour partager).
- Non confirmé : pilote WinUSB/Zadig à poser ; Electron précisément (non cité) ; stockage de la clé d'authentification.
- Exige : débogage USB activé, acceptation de la clé RSA du PC.

### F.3 Partage de connexion USB
- Non confirmé (aucune source utile). Connaissance générale non sourcée : le téléphone se présente comme une carte réseau RNDIS/NCM ; Windows 10/11 charge un pilote intégré. L'utilisateur doit activer « Partage de connexion USB » à chaque branchement (non persistant), puis l'application sur le téléphone doit servir un petit serveur HTTP local, avec une adresse que le PC doit connaître. Sans Internet : faisable, mais cela demande une application serveur sur le téléphone, et un geste à chaque branchement. Le défaut d'AOSP de remettre « charge seule » s'applique aussi.

### F.4 Débogage USB : autorisation durable ?
- Confirmé : depuis Android 10, l'autorisation adb se révoque après 7 jours sans reconnexion ; option « Désactiver le délai d'expiration des autorisations adb » (« Disable adb authorization timeout ») dans les options pour développeurs (https://gitlab.e.foundation/e/os/android_packages_apps_Settings/-/commit/0a189b3abe1e26274799ed0f9779ddd05f275183 ; https://technastic.com/authorize-adb-on-android-devices/amp). Correction de ta prémisse : c'est Android 10, pas 11 (même source).
- Partiel : cette option ne couvre pas toutes les ré-approbations (un utilisateur Samsung dit que le débogage sans fil se redemande à chaque redémarrage même avec l'option ; https://mirfatif.github.io/adb-guide/android-11).
- Partiel (blogs, à confirmer) : sur HyperOS/MIUI, « Installer via USB » et « Débogage USB (paramètres de sécurité) » existent ; ce dernier peut être remis à zéro par une mise à jour (https://droidwin.com/?p=58295). Non confirmé : exigence de carte SIM ou de compte Xiaomi.

---

## G. Applications de bureau grand public qui synchronisent par câble sans débogage USB

Résultat faible : la recherche n'a pas permis de confirmer la technique de Garmin Express, Smart Switch, HandShaker, Syncios, MusicBee.
- Calibre : confirmé (forums MobileRead et rapports de bogues, anciens, https://bugs.launchpad.net/calibre/+bug/1336868/comments/2) : pilote MTP sous Windows par WPD, y compris pour liseuses et téléphones Android ; échecs courants : mauvais mode USB (PTP), erreurs d'écriture « Unspecified error », appareil non détecté.
- doubleTwist : confirmé (https://www.doubletwist.com/help/question/quick-start-guide-to-doubletwist-sync-usb-syncing/) : si l'Explorateur ne peut pas copier, la synchronisation par USB ne marchera pas ; donc MTP.
- XYplorer : développeur cité sur son forum : MTP « pour le moment » (https://www.xyplorer.com/xyfc2/viewtopic.php?p=229333).
- Non confirmé : toute autre technique. Beaucoup d'outils « Android Toolbox », « ADB File Manager », adb-sync passent par adb et le débogage USB.
- Garmin Express, Smart Switch, Syncios : non confirmé. D'après mes connaissances (non sourcées) : montres Garmin et lecteurs de musique en MTP ou stockage de masse ; Smart Switch parle un protocole propre via un service du téléphone ; Syncios via adb.

---

## Tableau de synthèse des canaux USB

| Canal | À faire une fois | À chaque branchement | Fiabilité | Difficulté d'écriture |
|---|---|---|---|---|
| Débogage USB / adb | Activer les options pour développeurs, débogage USB, « toujours autoriser » ; cocher « désactiver le délai d'expiration » ; embarquer adb.exe (ou Tango) ; sur HyperOS, régler aussi les paramètres de sécurité | Rien si l'autorisation tient (sinon réacceptation après 7 jours ou après un redémarrage chez certains) ; pas de conflit avec un serveur adb déjà lancé | Bonne : lit et écrit sans MediaStore, écrase en place ; remonte les dates | Faible à moyenne (adb.exe en sidecar ou module Node) |
| MTP / WPD | Aucune installation ; idéalement régler « Configuration USB par défaut » sur « Transfert de fichiers » | Choisir « Transfert de fichiers » si le défaut ne tient pas ; déverrouiller (à confirmer) ; la liste vient de MediaStore : fichiers manquants ou de taille 0 si non indexés (défaut non confirmé en 2025-26) ; l'application doit lancer `scanFile` après chaque écriture | Moyenne : blocages du pilote, écrasement par suppression puis création, hubs et débranchements sensibles | Moyenne à élevée (COM ; `mtp-rs` ou MediaDevices 2.0 aident) |
| AOA | Pilote WinUSB (Zadig) probable (non confirmé) ; application Android compagnon | Le PC doit relancer le téléphone en mode accessoire | Moyenne, peu éprouvée ici | Élevée |
| WebUSB (Tango) | Débogage USB (comme adb) ; Chromium ; éviter tout serveur adb | Autorisation de l'appareil à chaque session du navigateur (WebUSB) | Moyenne : conflit avec adb, versions 3.0 en bêta | Moyenne ; dépend de bêtas |
| Partage de connexion USB | Application serveur sur le téléphone ; adresse à connaître | Activer le partage à la main (non persistant) | Moyenne (non évaluée) | Moyenne (serveur HTTP à écrire des deux côtés) |

---

## Ce que je n'ai pas pu confirmer (liste)
1. Taille réelle et mémoire au repos d'une petite application Electron sous Windows (aucune mesure propre).
2. Effet d'electron-builder 26.18.0 sur le piège winCodeSign sans administrateur.
3. OPFS et Cache API sous schéma Electron privilégié, et sous `tauri.localhost`.
4. Taille et droits des Build Tools MSVC.
5. Noms exacts et comportement d'écrasement de MediaDevices 2.0 ; durées de listage de 1 500 fichiers.
6. Persistance de l'indexation MediaStore après écriture SAF sur Android 14 à 16 ; effet de `scanFile`.
7. Besoin de déverrouiller le téléphone en MTP ; persistance de « Configuration USB par défaut » sur Android 14 à 16 et sur HyperOS.
8. Descripteurs WinUSB en mode AOA ; partage de connexion USB.
9. Fonctionnement de Garmin Express, Smart Switch, Syncios, MusicBee.
10. Licence et version de `@capawesome/capacitor-electron`.

## Sources principales
- https://api.github.com/repos/electron/electron/releases/latest
- https://registry.npmjs.org/electron
- https://www.electronjs.org/docs/latest/api/protocol
- https://github.com/electron-userland/electron-builder/issues/8149
- https://operations.osmfoundation.org/policies/tiles/
- https://crates.io/api/v1/crates/tauri ; https://v2.tauri.app/blog/tauri-2.12/ ; https://v2.tauri.app/start/prerequisites/ ; https://v2.tauri.app/develop/sidecar/
- https://api.github.com/repos/tauri-apps/tauri/releases
- https://github.com/capacitor-community/electron ; https://capawesome.io/docs/blog/capacitor-community-electron-migration/
- https://github.com/vdavid/mtp-rs ; https://github.com/daladim/winmtp ; https://www.nuget.org/packages/MediaDevices
- https://tangoadb.dev/tango/daemon/usb ; https://api.github.com/repos/yume-chan/ya-webadb/releases
- https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/automatic-installation-of-winusb
