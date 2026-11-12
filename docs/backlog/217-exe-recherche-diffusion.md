# Signature et diffusion d'un .exe Electron / Tauri 2 : état au 12/11/2026

Méthode : pages officielles lues le 12/11/2026 (Microsoft Learn, Certum, Android, Tauri, electron-builder, itch.io), complétées par recherches web. Les blogs tiers sont marqués comme tels. « Non confirmé » = je n'ai pas pu le lire sur une source fiable.

## 1. SmartScreen : ce que voit l'acheteur

Confirmé (Microsoft Learn, page « SmartScreen reputation », màj 17/08/2026 : https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) :

- SmartScreen juge deux signaux : la réputation de l'éditeur (certificat) et celle du hash du fichier.
- Installeur non signé : écran bleu « Windows a protégé votre PC ». L'utilisateur doit cliquer « Informations complémentaires » puis « Exécuter quand même ». Une stratégie d'entreprise peut interdire de continuer.
- Installeur signé (OV ou EV) : avertissement « application non reconnue » aux premiers téléchargements, mais le nom de l'éditeur vérifié s'affiche à la place de « éditeur inconnu ».
- Depuis 2024, un certificat EV ne contourne plus SmartScreen. Microsoft écrit que payer la prime EV « seulement pour éviter SmartScreen » n'est plus justifié (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options, màj 10/11/2026).
- Une signature ne fait donc PAS disparaître l'avertissement tout de suite. La réputation se construit « sur plusieurs semaines et des centaines d'installations propres », sans seuil exact. Aucun moyen de la demander pour le grand public.
- Elle se transmet d'une version à l'autre si on signe avec la même identité. Changer de certificat ou d'éditeur casse ce signal.
- Smart App Control (Windows 11) peut bloquer un exécutable non signé sans réputation positive, même hors téléchargement.
- Seule exception : le Microsoft Store (voir 4), jamais d'avertissement.

Clés matérielles : depuis juin 2023, les clés OV/EV doivent être sur jeton matériel ou HSM cloud (code-signing-options, ci-dessus). Depuis le 01/03/2026, la durée maximale d'un certificat de signature de code publique est de 460 jours (ballot CSC-31), et le stockage logiciel (fichier .pfx) n'est plus permis. Source : Sectigo via blog tiers https://sslinsights.com/sectigo-code-signing-certificate-guide/ ; Certum indique 459 jours depuis le 27/02/2026 (https://shop.certum.eu/standard-code-signing-in-the-cloud.html). Conséquence : le « certificat 3 ans » devient un abonnement avec réémissions.

Non confirmé : le texte exact de l'écran en français sur Windows 11 26H2 (je cite les libellés officiels anglais).

## 2. Certificat de signature pour un particulier français

Confirmé :

| Fournisseur / offre | Prix | Stockage | Remarques | Source |
|---|---|---|---|---|
| Certum « Standard Code Signing in the Cloud » | « à partir de 209 € » TTC, options 1, 2 ou 3 ans (prix par durée non lus) | Cloud SimplySign (appli mobile pour les codes) | Données de certificat possibles pour une personne physique ; limite 5 000 signatures/mois ; 459 jours max par certificat, réémissions gratuites sur 2-3 ans ; « de confiance Microsoft », réduit les écrans SmartScreen sans le promettre | https://shop.certum.eu/standard-code-signing-in-the-cloud.html (12/11/2026) |
| Certum « Open Source Code Signing » cloud | 49 € | Cloud SimplySign | Nom « Open Source Developer » dans le certificat. Pensé pour un projet ouvert : la page lue ne dit pas noir sur blanc que c'est obligatoire, mais une appli vendue et fermée n'est probablement pas dans l'esprit ; à demander à Certum avant achat | https://shop.certum.eu/open-source-code-signing-on-simplysign.html (12/11/2026) |
| SSL.com « Individual Validated (IV) » | Prix annuel non lu | Jeton USB, HSM ou eSigner cloud | « Pour développeurs individuels, aucun document d'entreprise ». eSigner : essai 30 jours, puis paliers (ex. 1 000 signatures/mois pour 250 $ ; 12 000/an pour 2 250 $, ce sont des tarifs d'abonnement eSigner, à confirmer si l'IV les exige) ; API REST pour CI ; GitHub Actions, Azure DevOps, GitLab cités | https://www.ssl.com/code-signing/ ; https://ssl.com/guide/esigner-pricing-for-code-signing/ |
| DigiCert, Sectigo, GlobalSign (OV) | Microsoft donne « 150 à 300 $/an » en ordre de grandeur | Jeton ou HSM cloud | Souvent réservé aux organisations ; éligibilité d'un particulier non vérifiée | code-signing-options (Microsoft) |
| EV | « 400 $ et plus/an » | Jeton/HSM | Plus utile pour SmartScreen. SSL.com propose un EV « entrepreneur individuel » | Microsoft ; https://www.ssl.com/products/software-integrity/code-signing/ev-sole-proprietor/ |

Compatibilité poste Windows / GitHub Actions :
- Poste Windows avec jeton USB ou SimplySign Desktop : confirmé (c'est l'usage normal ; Certum cite signtool et outils Linux/macOS).
- GitHub Actions : SSL.com eSigner, confirmé (API REST, GitHub Actions cité sur leur page). Certum SimplySign : non confirmé. La page Certum ne parle pas de CI ; SimplySign exige l'appli mobile pour un code à usage limité dans le temps, donc une signature sans humain est incertaine. Un jeton USB ne se branche pas sur un runner GitHub hébergé.
- Alternative réaliste pour un solo : signer en local sur le poste Windows au moment de publier.

Non confirmé : prix annuel SSL.com IV ; prix par durée chez Certum ; acceptation d'un particulier chez Sectigo/DigiCert.

## 3. Azure Trusted Signing, renommé « Azure Artifact Signing »

Confirmé (Microsoft Learn, quickstart màj 08/10/2026 : https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart ; code-signing-options màj 10/11/2026) :

- Le service s'appelle maintenant Artifact Signing. Prix : environ 9,99 $/mois (niveau Basic, 5 000 signatures/mois ; Premium : 100 000 signatures/mois). Facturation dès la création du compte, sans prorata. La page de tarifs https://azure.microsoft.com/en-gb/pricing/details/artifact-signing/ n'affichait pas les montants à la lecture : le 9,99 $ vient de la doc Microsoft.
- Certificats « Public Trust » : organisations aux États-Unis, Canada, UE, Royaume-Uni, Australie, Nouvelle-Zélande, Japon, Corée du Sud, Singapour, Suisse, Norvège, Israël.
- Particuliers : États-Unis et Canada UNIQUEMENT. Le compte de facturation doit être de type « Individual ».
- Donc un particulier français ne peut pas l'utiliser pour le Public Trust. Un fil Microsoft Q&A de mars 2026 (https://learn.microsoft.com/en-us/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident) rapporte un refus pour un utilisateur français, et un autre (https://learn.microsoft.com/en-us/answers/questions/5915697/can-an-irish-sole-trader-(non-incorporated)-qualif) traite l'entrepreneur individuel irlandais comme un particulier, donc exclu. Ce sont des réponses de communauté.
- Une micro-entreprise : possible que Microsoft la traite comme « organisation » si elle a un identifiant d'entreprise (SIRET) et un domaine/courriel propres, mais l'exemple irlandais (entrepreneur individuel) va dans le sens contraire. Non confirmé ; à tester ou demander au support. Délai de validation d'identité : 1 à 20 jours ouvrés.
- Pas de réputation SmartScreen instantanée non plus (même comportement qu'OV).
- Pas de jeton matériel : signature en CI (GitHub Actions) possible.

Non confirmé : l'éligibilité d'une micro-entreprise française ; toute annonce d'ouverture aux particuliers européens.

## 4. Microsoft Store (MSIX ou EXE/MSI référencé)

Confirmé :
- Compte développeur particulier gratuit : blog Windows Developer du 10/09/2025 (https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/). Pas de carte bancaire. Compte Microsoft personnel, pièce d'identité et selfie. Environ 200 marchés. Compte société : 99 $ une fois (Windows Central, secondaire).
- Qui signe : paquet MSIX, Microsoft le re-signe après certification, gratuit, aucun certificat à acheter. Installeur EXE/MSI : non re-signé, il faut le signer soi-même avec une AC de confiance Microsoft (auto-signé refusé). Installé par le Store, pas d'avertissement SmartScreen (UAC peut apparaître). Source : code-signing-options.
- Commission : le blog de 09/2025 ne donne pas de taux. Pour les applications non-jeux avec son propre système de paiement intégré, le développeur garde 100 % (même blog). Avec le paiement Microsoft, 15 % pour les apps et 12 % pour les jeux selon articles de presse de 2021 (https://blogs.windows.com/windowsdeveloper/2018/05/07/a-new-microsoft-store-revenue-share-is-coming/ pour l'origine, taux 2021 via PC Gamer/TweakTown). Non confirmé : taux en vigueur en 11/2026 sur la page Partner Center (non lue).
- Bac à sable : une application Electron/Tauri en MSIX tourne en « pleine confiance » (`runFullTrust`, niveau d'intégrité moyen, pas d'AppContainer). Microsoft : une telle application « s'exécute déjà comme l'utilisateur » et peut faire ce qu'il peut faire (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations, màj 02/10/2026). `runFullTrust` est une capacité restreinte : approbation Store requise, pas pour le chargement latéral.
- Un exécutable embarqué dans le paquet peut être lancé comme processus enfant (l'écriture du paquet reste lecture seule, adb ne peut pas y écrire sa clé : définir `ADB_VENDOR_KEYS`/`HOME`/`ANDROID_USER_HOME` vers un dossier inscriptible). Cette dernière précaution est un raisonnement, non une source : à tester.
- Lecture d'un dossier quelconque : un processus pleine confiance a l'accès du compte utilisateur ; `broadFileSystemAccess` ne concerne que les API Windows.Storage (même page Microsoft). Un fil Q&A signale une anomalie avec les deux capacités ensemble (https://learn.microsoft.com/en-us/answers/questions/952796/access-denied-when-using-broadfilesystemaccess-and), sans réponse fiable. Un autre fil évoque un paquet Electron refusé à la certification (https://learn.microsoft.com/en-us/answers/questions/5786417/unable-to-get-electron-msix-bundle-certified-for-s), non lu en détail.

Non confirmé (à tester sur un paquet chargé en latéral) : adb.exe embarqué qui accède à l'USB et à un dossier choisi ; acceptation par la certification d'une application qui embarque adb ; virtualisation du registre/AppData par MSIX (écritures redirigées dans un dossier privé du paquet).

## 5. Redistribuer adb.exe

Confirmé :
- Les conditions du SDK Android (version du 27/07/2021, toujours en ligne le 12/11/2026 : https://developer.android.com/studio/terms) : licence « limitée, non cessible, non sous-licenciable », pour développer des applications Android (art. 3.1) ; interdiction de « copier, modifier, redistribuer » le SDK « sauf dans la mesure exigée par des licences tierces » (art. 3.4) ; mais les composants sous licence open source relèvent « uniquement » de cette licence (art. 3.5).
- Les platform-tools sont distribués par Google (version 37.0.3 en 2026, notes : https://developer.android.com/tools/releases/platform-tools). La page de téléchargement lue ne porte pas de licence distincte.
- Lecture juridique courante (Stack Overflow, Debian, sources secondaires) : le client adb du code AOSP (platform/system/core/adb) est sous Apache 2.0, donc redistribuable ; le binaire téléchargé chez Google est présenté sous les conditions du SDK. Non confirmé par texte officiel : que le binaire des platform-tools soit, lui, couvert par l'art. 3.5. Ce n'est pas un avis juridique.
- Solution la plus sûre : compiler adb depuis AOSP (Apache 2.0, mais dépendances : libusb, protobuf, brotli, lz4, zstd, mbedtls/boringssl, etc. avec leurs propres licences) ou utiliser une version packagée par une distribution tierce (ex. paquet winget/Chocolatey/Scoop, non vérifié). Autre piste : ne pas embarquer adb, demander à l'utilisateur de l'installer ou de le télécharger au premier lancement depuis Google (contrat entre lui et Google, pas de redistribution par vous). Cette dernière piste est un raisonnement, non une source.
- scrcpy (Apache 2.0, Genymobile) : sa documentation Windows indique que winget installe adb avec scrcpy ; Chocolatey et Scoop demandent un paquet adb séparé (https://raw.githubusercontent.com/Genymobile/scrcpy/master/doc/windows.md). Je n'ai pas pu confirmer si l'archive officielle Windows embarque adb.exe, ni sous quelle licence. Non confirmé.
- À joindre (bonne pratique, non lu comme exigence officielle) : texte Apache 2.0, fichier NOTICE s'il existe, mentions de copyright d'AOSP, licences des bibliothèques liées. Faire relire par un juriste avant vente.

## 6. Mise à jour automatique hors Store

Electron, electron-updater (https://www.electron.build/docs/features/auto-update, lu le 12/11/2026) :
- Windows : seule la cible NSIS se met à jour. Pas MSI, ni portable, ni Appx (Squirrel non pris en charge).
- Hébergements : GitHub Releases, S3, DigitalOcean Spaces, Cloudflare R2, Keygen, serveur HTTP générique (on y envoie `latest.yml` et l'installeur).
- Mise à jour différentielle (`.blockmap`), déploiement progressif (`stagingPercentage`).
- Signature : electron-updater valide la signature de code aussi sous Windows. La page ne dit pas que c'est exigé ; à tester avec un installeur non signé (non confirmé).
- Dépôt GitHub privé : possible avec `GH_TOKEN` sur la machine de CHAQUE utilisateur et l'option `private`. La doc le déconseille (« cas très particuliers ») et le jeton donnerait des droits trop larges à distribuer. Pour des clients : dépôt public (ou un dépôt de releases public séparé) ou serveur/CDN générique.

Tauri 2, plugin updater (https://v2.tauri.app/plugin/updater/, lu le 12/11/2026) :
- Signature de mise à jour OBLIGATOIRE et non désactivable : paire de clés propre à Tauri (clé publique dans `tauri.conf.json`, clé privée dans `TAURI_SIGNING_PRIVATE_KEY` au build). Ce n'est pas la signature Authenticode de Windows : il faut quand même signer l'installeur pour SmartScreen.
- Hébergement : un fichier JSON statique (`version`, `url`, `signature` par plateforme) sur S3, gist, CDN, ou GitHub Releases (`.../releases/latest/download/latest.json`, généré par Tauri Action). HTTPS obligatoire en production.
- Mode d'installation Windows : `passive` (défaut), `basicUi`, `quiet`.
- Dépôt privé : la page ne le traite pas. Non confirmé (même problème : un jeton dans l'appli).

## 7. Vente à des particuliers (technique de diffusion seulement)

- itch.io : en mode « Payouts », itch.io est marchand officiel et collecte/reverse la TVA ; part par défaut 10 % (réglable 0-100 %) (https://itch.io/docs/creators/payments, 12/11/2026). Pas de restriction pour particuliers lue. Livre un fichier téléchargeable ; pas de clé de licence native lue.
- Gumroad : marchand officiel depuis janvier 2025, 10 % + 0,50 $ environ (blogs tiers, chiffres divergents ; non confirmé sur page officielle).
- Paddle : marchand officiel, 5 % + 0,50 $ (blogs tiers). Acceptation d'un entrepreneur individuel français : non confirmé.
- Lemon Squeezy : racheté par Stripe (2024) ; migration vers « Stripe Managed Payments » (disponibilité générale avril 2026 selon blogs tiers) ; livraison de fichiers et clés de licence risquent de ne pas suivre. Non confirmé sur page officielle.
- Stripe seul (sans marchand officiel) : la TVA reste à votre charge. Non approfondi.
- Point technique : une clé de licence demande un serveur ou le service tiers ; sans cela, le téléchargement peut être copié.

## Tableau de synthèse

| Voie de diffusion | Coût annuel | Ce que voit l'acheteur | Contraintes |
|---|---|---|---|
| EXE non signé, téléchargé chez soi | 0 € | « Windows a protégé votre PC », éditeur inconnu, « Exécuter quand même » ; Smart App Control peut bloquer | Réputation à refaire à chaque version ; mauvais pour la vente |
| EXE signé Certum Standard cloud | environ 209 €/an et plus (non confirmé par durée) | Avertissement « non reconnue » au début, mais éditeur affiché ; s'estompe avec des centaines d'installations | Signature surtout depuis le poste ; limite 5 000 signatures/mois ; 459 jours max par certificat |
| EXE signé Certum « Open Source » | 49 € | Idem | Prévu pour logiciel ouvert ; à vérifier avant achat |
| EXE signé SSL.com IV + eSigner | prix IV non lu ; eSigner dès 250 $ pour 1 000 signatures/mois selon sa page | Idem | CI possible (API REST) ; coût total à confirmer |
| EXE signé Artifact Signing | environ 120 $/an (9,99 $/mois) | Idem | Particulier français : NON éligible ; micro-entreprise : non confirmé |
| Certificat EV | 400 $ et plus | Idem OV depuis 2024 | Plus aucun intérêt SmartScreen |
| Microsoft Store, MSIX | 0 € (compte particulier gratuit) ; commission à confirmer (15 % d'apps avec paiement Microsoft ; 0 % avec son propre paiement hors jeux) | Aucun avertissement SmartScreen | `runFullTrust` (approbation Store) ; certification ; tester adb embarqué et accès disque ; écritures redirigées |
| Microsoft Store, EXE/MSI référencé | 0 € + votre certificat | Pas de SmartScreen via le Store ; UAC possible | Signature Authenticode à votre charge ; pas de MSIX donc pas de re-signature |
| Vente via itch.io / Gumroad / Paddle | 5 à 10 % par vente (+0,50 $) | Idem selon signature de l'EXE | Marchand officiel gère la TVA ; mises à jour à héberger vous-même |

## Incertitudes principales

1. Prix annuel SSL.com IV et éligibilité Sectigo/DigiCert pour un particulier : non lus.
2. Artifact Signing pour une micro-entreprise française : non confirmé.
3. Binaire adb de Google : redistribution commerciale non tranchée par un texte officiel ; AOSP en Apache 2.0 est la voie la plus sûre. Avis juridique conseillé.
4. Commission actuelle du Store (11/2026) : taux 15 % issu d'articles de 2021, page Partner Center non lue.
5. adb embarqué dans un MSIX : à tester en chargement latéral avant de choisir cette voie.
6. Signature Certum SimplySign depuis GitHub Actions : non confirmé.
