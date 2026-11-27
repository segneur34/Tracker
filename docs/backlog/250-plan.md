# 250 · Synchroniser sans câble : plan en six lots et un préalable de banc (26/11, audit Gtracker)

## But

Synchroniser le téléphone et le programme Windows par le réseau de la maison (Wi-Fi, ou partage de connexion du PC ou du téléphone), sans câble ni « débogage USB ». On relie une fois le téléphone au PC par un code de 6 chiffres. Ensuite, « Synchroniser » sur le PC trouve tout seul le téléphone où Tracker est ouvert, et le programme règle lui-même le pare-feu de Windows.

Décidé par l'utilisateur le 26/11 : « la connexion sans fil est à faire ». Tranché par défaut (orchestrateur, d'après l'audit) :
- la liaison est celle de Gtracker : application du téléphone à l'écran, aucun service de fond, tout part du bouton du PC ;
- le parcours de « Synchroniser » est celui du lot 242 ;
- le bloc « Connexion » de Réglages est repris.

Audit : `C:\Users\segne\.claude\plans\audit-gtracker-2611\programme-pc.md` (constats P16 à P21) et `docs/backlog/239-audit-gtracker.md`.

## Source

Gtracker, `D:\gong tracker\Gtracker`, **en lecture seule**, commit `f72f238c335a902ac064258ee24c2007cb5f17a9`. Seul `montre/` y porte des modifications non commitées, sans rapport avec ce lot. Lire un fichier par `git -C "D:/gong tracker/Gtracker" show f72f238:<chemin>`, ou directement sur le disque, hors `montre/`.

Fiches de Gtracker qui racontent la conception :
- `docs/backlog/450-plan-sans-fil.md` : protocole, appairage, serveur, greffon ;
- `482-sans-fil-deux-sens.md` : écriture par le Wi-Fi ;
- `488-pare-feu.md`, `490-pare-feu-et-reliaison.md` : pare-feu ;
- `489-synchroniser-remise-a-plat.md`, parties 3B et 5 : départs, journal, relance du téléphone ;
- `505-essais-liaison-telephone.md` : JUnit et Robolectric ;
- `512-reglages-connexion.md` : bloc « Connexion » ;
- `535-banc-programme-duree.md` : banc.

Dans HISTORIQUE de Gtracker, les points 456, 462, 464, 465, 470 et 474.

## Schéma d'ensemble

```
 PC (processus principal d'Electron)                         Téléphone (Tracker à l'écran)
 ─────────────────────────────────────                       ──────────────────────────────
 sans-fil allumé par l'utilisateur (choix gardé)
 écoute UDP 48248 (découverte)            ◄── question « TRKR » diffusée (3 s), ou dernière adresse (1 s)
 répond : port TCP + identifiant de sonde ──►  garde jusqu'à 4 PC candidats
 écoute TLS 48247 (à 48256 si pris),      ◄── connexion TLS (le téléphone vérifie l'empreinte fixée)
   sur ses seules adresses IPv4 privées
 accueil : 16 Kio, 3 s pour se présenter  ◄── `appairer` (code, SPAKE2) ou `bonjour` (jeton)
 reconnu : la liaison S'INVERSE
 le PC commande : lister, lire, ping (15 s), ecrire/valider, deplacer… ──► le téléphone répond
 liaison fermée : départ annoncé à la page  ◄── l'application quitte l'écran (handleOnStop)
```

**Appairage, une fois.**
1. Sur le PC, Réglages › Connexion : « Relier un téléphone » ouvre une fenêtre de 2 minutes avec un code de 6 chiffres.
2. Sur le téléphone, on tape le code. Le téléphone cherche le PC, ouvre la liaison TLS, et envoie `appairer` avec sa part SPAKE2. Le PC répond `defi` avec la sienne.
3. Le téléphone envoie `preuve` (cA). Le PC vérifie, puis rend `appaire` : cB, un jeton de 256 bits, son identifiant et son nom.
4. Le téléphone vérifie cB, puis garde le jeton, l'empreinte du certificat et l'identifiant du PC. Le PC ne garde que le SHA-256 du jeton.

**Synchronisation.**
1. Tracker est à l'écran du téléphone. Il se relie seul à l'ouverture, au retour au premier plan, puis toutes les 20 s : `bonjour` avec le jeton, le PC répond `bienvenue`.
2. Sur le PC, « Synchroniser » ouvre le téléphone comme un dossier distant, par le Wi-Fi s'il est relié, sinon par le câble. Le moteur du lot 217, revu par le lot 242, fait le reste comme par le câble.
3. Le téléphone relit sa mémoire seul, par le marqueur `synchro` du lot 242.

## Table des noms : Gtracker → Tracker (à appliquer partout, tests et vecteurs compris)

| Objet | Gtracker | Tracker |
|---|---|---|
| Port TCP du serveur (et les 9 suivants) | 48217 (48217-48226) | **48247 (48247-48256)** |
| Port UDP de la sonde | 48218 | **48248** |
| Signature de la sonde (4 octets ASCII) | `GTRK` (47 54 52 4B) | **`TRKR` (54 52 4B 52)** ; octet de version gardé à 2, même format |
| Clé HMAC de l'identifiant de sonde | `gtracker-sonde` | `tracker-sonde` |
| SPAKE2 idA | `gtracker-telephone` | `tracker-telephone` |
| SPAKE2 AAD | `gtracker-appairage-2` | `tracker-appairage-1` |
| Étiquette du scalaire du code | `gtracker-spake2-w` | `tracker-spake2-w` |
| CN du certificat | `Gtracker` | `Tracker` |
| Provisoires | `.gtracker-new`, `.gtracker-tmp` | `.tracker-new`, `.tracker-tmp` (déjà ceux de Tracker : `bureau/disque.ts:29-32`, `MemoryFolderPlugin.java:65-70`) |
| Marqueur de la mémoire | `gtracker.json` | `tracker.json` |
| Dossier mémoire du téléphone | `Documents/Gtracker` | `Documents/Tracker` |
| Profil du PC, secrets du sans-fil | `%APPDATA%\Gtracker\sansfil\` | `%APPDATA%\Tracker\sansfil\` (profil déjà `Tracker` : `app.setName('Tracker')`) |
| Variables d'essai | `GTRACKER_BANC_SANSFIL_*`, `GTRACKER_PAREFEU_EXE` | `TRACKER_BANC_SANSFIL_*`, `TRACKER_PAREFEU_EXE` |
| Règles du pare-feu | `Gtracker-SansFil-TCP`, `-UDP` | `Tracker-SansFil-TCP`, `-UDP` |
| Drapeau de relance élevée | `--gtracker-pare-feu=poser\|retirer` | `--tracker-pare-feu=poser\|retirer` |
| Profil jetable du programme élevé | `%TEMP%\Gtracker-pare-feu` | `%TEMP%\Tracker-pare-feu` |
| Paquet Android | `io.github.segneur.gtracker` | `io.github.segneur.tracker` |
| Étiquette de journal Android | `GtrackerLiaison` | `TrackerLiaison` |
| Nom du greffon Capacitor | `ComputerLink` | `ComputerLink` (deux applications distinctes, rien ne se croise) |

Pourquoi ces ports et cette signature. Les deux programmes doivent cohabiter sur le même PC, et un téléphone Tracker ne doit jamais prendre un PC Gtracker pour le sien. Trois barrières l'assurent :
- des ports différents : rien n'écoute au même endroit ;
- une signature de sonde différente : un PC Gtracker ignore la question d'un téléphone Tracker, et l'inverse ;
- des identités SPAKE2 différentes : même avec une adresse tapée à la main vers un PC Gtracker, l'appairage échoue comme un code faux, et rien n'est gardé.

48247 et 48248 ne sont pas réservés à l'IANA (vérifié le 26/11) et sont éloignés de 30 de la plage de Gtracker.

**À régénérer.** `bureau/sansFil.vecteurs.json` (391 lignes) n'a pas de générateur dans Gtracker : il a été fabriqué à la main par un script jeté. Changent les cas `spake2.cas` (w, parts, K, clés, confirmations), toutes les `sondes`, et les `trames` qui portent `gtracker.json` ou un provisoire (`cheminsLecture`, `cheminsEcriture` : 15 occurrences de « gtracker »). En mieux, au lot 1 : un générateur commité, `bureau/essais/vecteurs.ts`, lancé à la main par `npx tsx`, ou à défaut par un test `it.skip` documenté. Il écrit le fichier à partir des fonctions de `trames.ts`, `sonde.ts`, `spake2.ts` et `appairage.ts`, avec des scalaires et des nonces fixes. La justesse de `spake2.ts` reste prouvée indépendamment par les vecteurs de la RFC 9382, annexe B (`spake2.test.ts`, bloc « vecteurs de la RFC », qui ne dépendent pas des identités), et le Java relit le même fichier : le générateur ne peut pas se valider lui-même.

---

## Ordre, dépendances, parallèle

| Lot | Titre | Taille | Modèle \| Réflexion | APK | Après | En parallèle de |
|---|---|---|---|---|---|---|
| 250-0 (préalable) | Le banc du programme Windows sans attentes inutiles | petit | Opus \| high | non | rien ; **avant la partie banc du 242** | 250-1, 250-3, code du 242 |
| 250-1 | Le protocole et le code, sans réseau | moyen | Opus \| high | non | rien | 242, 250-3 (une fois les vecteurs commités) |
| 250-2 | Le PC écoute et sait lire et écrire le téléphone | gros | Opus \| high | non | 250-1, **242** | 250-3, 250-4 |
| 250-3 | Le téléphone répond (greffon Android) | gros | Opus \| high | oui (avec 250-4) | 250-1 | 242, 250-2, 250-5 |
| 250-4 | Le téléphone se relie seul, et garde ce que l'ordinateur retire | moyen | Opus \| high | oui | 250-3 (API du greffon) | 250-2, 250-5 |
| 250-5 | Le pare-feu de Windows réglé par le programme | moyen | Opus \| high | non | 250-2 | 250-3, 250-4 |
| 250-6 | Sur le PC : relier, attendre, synchroniser, et le banc | moyen | Opus \| high (banc : Sonnet \| high, à part) | non | 250-2, 250-4, 250-5, 242 | rien |

Un commit par lot, « à valider », après `npm run verif` vert et la relecture (agent `relecture`). Pour les lots qui touchent le Java (250-3, 250-4), l'agent lance aussi `android\gradlew.bat testDebugUnitTest`, qui n'est pas dans `npm run verif`.

Pourquoi un préalable de banc : il ne touche que `outils/banc/`, sert au 242 autant qu'au sans-fil, et doit précéder le premier lot qui rejoue le banc du programme (le 242). Il est décrit dans la section 250-0 ci-dessous.

Pourquoi six lots et dans cet ordre :
- le découpage de l'audit tient, avec un seul changement : le pare-feu (250-5) passe **avant** la page du PC (250-6), pour que la carte « Téléphone » se fasse en une fois, message du pare-feu compris ;
- le protocole pur (250-1) ne touche aucun fichier commun : il peut partir tout de suite, à côté du lot 242 ;
- le Java (250-3) est sous `android/` seulement : il peut se coder en même temps que le serveur ;
- les fusions de `bureau/main.ts`, `preload.ts` et `pont.test.ts` se font dans 250-2, après le 242, qui touche les mêmes fichiers.

---

## 250-0 · Le banc du programme Windows sans attentes inutiles (préalable, à part)

Demande de l'utilisateur, ajoutée au plan le 26/11 : « on avait aussi optimisé le banc pour le programme Windows, il faudra s'en inspirer ». Source : lot 535 de Gtracker, commit `1d47b22` (24/11), fiche `D:\gong tracker\Gtracker\docs\backlog\535-banc-programme-duree.md`, HISTORIQUE de Gtracker point 497, `outils/banc/LISEZMOI.md` de Gtracker (paragraphes « Jouer le banc du programme », « Écrire ou retoucher un script du programme », « Piège, `settle` et les workers »).

**Ce que l'utilisateur y gagne** : les vérifications du programme Windows vont plusieurs fois plus vite, à chaque lot qui touche la synchronisation, le 242 comme les six du sans-fil. Rien ne change dans l'application.

**Où et pourquoi à part.** Ce préalable ne touche que `outils/banc/`. Il passe **avant la partie banc du lot 242**, qui est le premier lot à rejouer `exe-synchroniser` et le modifie pour la nouvelle fenêtre. Il ne va pas dans 250-1, qui ne joue aucun banc. Le faire en premier évite deux choses :
- que le 242 et le 250-6 retouchent des scripts encore lents, avec un conflit de fusion à la clé ;
- que `exe-sansfil.mjs` et la part `--sansfil` naissent sous l'ancienne forme.

Il peut se coder en même temps que le code du 242, de 250-1 et de 250-3 (fichiers disjoints).

**La cause exacte de la lenteur, mesurée par Gtracker** (31 minutes pour tout le banc du programme, joué script après script) :
- **le lancement ne coûtait presque rien** : 0,4 s, ou 2,5 à 3 s avec la fermeture. Le nombre de lancements n'a d'ailleurs presque pas baissé (114, puis 101) ; le temps partait dans les attentes ;
- **cause principale, dans la pièce commune `lib/cdp.mjs`.** `new Worker(...)` fait émettre sur la session de la page un `Network.requestWillBeSent` de type `Script` **sans `loaderId`**, dont la fin n'est annoncée qu'à la session du worker, où le banc ne s'attache pas. La requête restait « en vol » et `settle` allait chaque fois à son plafond : 15 s à chaque lancement sur un profil neuf (6 des 14 minutes d'`exe-synchroniser`), 7 s à chaque visite de la liste des sessions ;
- attentes fixes (`b.wait(1500)`, `b.wait(2000)`, `b.settle({ max: 2000 })` après chaque geste) pendant lesquelles rien ne s'écrivait ;
- une attente « d'un texte différent » après un geste dont le résultat est identique : 15 s perdues à chaque passage, jusqu'au plafond ;
- `disparu(pid, ms)` comptait en tours de 200 ms sans compter le `tasklist` de chaque tour : 6 000 ms annoncées, jusqu'à 15 s réelles ;
- les scripts joués l'un après l'autre.

**Les techniques, et le gain mesuré quand la fiche le donne.**
1. `ignorerWorkers` dans `connect` (`outils/banc/lib/cdp.mjs` de Gtracker, `:241-249`, `:300-306`, `:408-414`). Sur une page à laquelle on s'attache (`BANC_WS` posée, c'est-à-dire le programme), la requête `Script` sans `loaderId` n'est plus comptée. À l'attache d'une page déjà chargée, le script de page (`PAGE_SCRIPT`) est posé par `Runtime.evaluate`, sinon tout `settle` irait à son plafond. C'est le plus gros gain : environ 6 min sur 14 pour la synchronisation seule.
2. Attendre un **état**, jamais un délai : `waitFor` sur la page, ou une sonde sur le disque, avec pour plafond l'ancienne attente. Un `calme(b, plafond)` / `AU_REPOS` remplace `settle` après un geste, et un `go` attend le **nouveau** document au repos (Gtracker `exe-synchroniser.mjs`, fonctions `calme` et `aller`).
   - Restent fixes, exprès, avec un commentaire : l'attente qui prouve qu'il ne se passe rien, celle dont le libellé du contrôle dit la durée, et la pause de 500 ms après chaque fermeture (le même profil est rouvert juste après).
3. Attendre un **résultat neuf** : marquer l'ancien résultat avant le clic et attendre qu'il soit remplacé, au lieu d'attendre « un texte différent ».
4. `disparu` compté à l'horloge : `const t0 = Date.now(); while (Date.now() - t0 < ms) …`. Exception voulue : dans `exe-fermeture`, le délai de 8 000 ms est le seuil d'un contrôle.
5. Cas regroupés dans un même lancement, **seulement** si le démarrage n'est pas ce qui est vérifié. Un cas garde son lancement s'il vérifie une première ouverture, une reprise après fermeture, la fermeture, un second lancement ou la première synchronisation d'une paire neuve, ou s'il veut d'autres variables d'essai (la coquille ne les lit qu'au démarrage). Chaque cas regroupé garde son contrôle « console sans erreur » et son journal comptés depuis son début. Gain chez Gtracker : 24 lancements, puis 12, pour `exe-application`.
6. Un lanceur côte à côte, `outils/banc/exe-tous.mjs` (Gtracker, 267 lignes, et `exe-tous.test.mjs`, 92). Chaque script tourne sur son port de débogage et ses ports TCP fixes. Le lanceur :
   - joue cinq scripts à la fois par défaut (`J_DEFAUT`), seulement ceux qu'on nomme ;
   - avec `--liste`, dit quel script rejouer pour quel fichier modifié (`SCRIPTS_EXE` avec `quand`, plus `COMMUNS`) ;
   - garde la sortie entière d'un script en échec ;
   - pose un plafond de 30 min par script ;
   - ne ferme que ce qu'il a lancé, par numéro de processus (`taskkill /T /F /PID`), jamais par nom d'image : un Tracker installé ou ouvert par l'utilisateur, ou un Gtracker, peut tourner.

**Gain mesuré chez Gtracker** (script seul, avant puis après) :

| Script | Avant | Après |
|---|---|---|
| synchronisation par le câble | 14 min 27 | 4 min 50 |
| synchronisation sans câble | 7 min 45 | 3 min 17 |
| sans-fil | 4 min 00 | 2 min 41 |
| application du téléphone | 2 min 13 | 1 min 11 |
| mémoire | 1 min 31 | 1 min 07 |
| fermeture | 1 min 03 | 38 s |
| matériel | 40 s | 33 s |

Tout le banc : 31 min joué en série, puis 5 min au mur par `exe-tous`. Les 2 907 contrôles sont les mêmes avant et après (listes triées de libellés comparées), tous réussis sur deux passages de suite.

**Ce qui se transpose tel quel à Tracker.**
- La cause existe ici : Tracker a son worker d'analyse (`src/library/trackWorkerClient.ts:82`, `new Worker(new URL('./trackWorker.ts', import.meta.url), { type: 'module' })`), créé à la **première demande** de calcul de fond, par exemple à l'ouverture d'une bibliothèque qui refait ses résumés ou d'une analyse.
- `settle` de Tracker (`outils/banc/lib/cdp.mjs:309-333`) compte `requests.size` sans exclure ce script (`:262`) : il va donc à son plafond dès que le worker existe.
- `exe-synchroniser.mjs`, `exe-synchroniser-essai.mjs`, `exe-fermeture.mjs` et `memoire-disque.mjs` se branchent tous par `BANC_WS` (vérifié) : `ignorerWorkers = Boolean(process.env.BANC_WS)` les couvre d'un coup.
- `disparu` de Tracker (`exe-synchroniser.mjs:40`) est exactement l'ancienne forme fautive : le corriger dans les quatre scripts qui l'ont, sauf le seuil de `exe-fermeture`.
- Attentes fixes à remplacer par l'attente d'un état : `exe-synchroniser.mjs` (11 `wait` ou `pause`, dont `:146`, `:160`, `:171` « réécritures », `:223`, `:239`, `:271`, `:321`), `memoire-disque.mjs` (24), `exe-fermeture.mjs` (13), `exe-synchroniser-essai.mjs` (10). Chacune se lit et se classe : état attendu, ou fixe voulue et commentée.

**Ce qui demande une adaptation.**
- `lib/cdp.mjs` de Tracker a divergé (+146 / −58 lignes contre celui de Gtracker : options `lieux`, `horlogeVariable`, horloge accélérée `TEMPS`, `MEMOIRE_DISQUE_SCRIPT`). On n'y porte **que** l'option `ignorerWorkers` et la pose du script de page à l'attache ; pas `miseEnGardeVue` ni `rechargerPage`, propres à Gtracker. Sous l'horloge accélérée (`TEMPS > 1`), les plafonds de `waitFor` sont en vrai temps : le vérifier.
- `ignorerWorkers` reste faux pour le banc du navigateur (`passe.mjs` sans `--exe`), comme dans Gtracker : l'y étendre demande un passage complet du banc (élément 537 de Gtracker, à noter au reste à faire de Tracker). `passe.mjs --exe` (`exe-import`, `exe-tuiles`) pose `BANC_WS` : la règle s'y applique, à prouver par leurs relevés avant et après.
- Ports de débogage : aujourd'hui `exe-synchroniser` et `memoire-disque` prennent tous deux 9498, `exe-fermeture` et `exe-synchroniser-essai` tous deux 9497. Côte à côte, il faut des ports distincts, et distincts aussi de ceux de Gtracker (9530, 9535, 9560, 9570, 9580), pour que les bancs des deux programmes puissent tourner sur le même poste : `synchroniser` 9630, `memoire` 9670, `fermeture` 9680, `synchroniser-essai` 9640, plus tard `sansfil` 9660 et `synchroniser-sansfil` 9635 (tranché par l'orchestrateur le 27/11).
- La table `SCRIPTS_EXE` de `exe-tous.mjs` est réécrite pour Tracker :
  - entrées `synchroniser`, `memoire`, `fermeture` ;
  - `exe-synchroniser-essai` **jamais** dans le lanceur : il vise le vrai téléphone et ne se joue que câble branché, avec l'accord de l'utilisateur ;
  - `exe-import` et `exe-tuiles` restent à `passe.mjs --exe`, qui a son propre registre ;
  - `EXE_DEFAUT` vaut `bureau/sortie/Tracker-win32-x64/Tracker.exe` ; dossiers temporaires `trk-tous-*` ;
  - `quand` pointe les fichiers de Tracker (`bureau/adb.ts`, `telephone.ts`, `copieSecurite.ts`, `disque.ts`, `src/library/sync*.ts`, `trash*.ts`, `src/hooks/sessionLibrary/{phoneSync,sync,syncRouteFiles}.ts`, `src/platform/phoneCable.ts`…) ; `COMMUNS` sans `modeEssai.ts` tant que 250-2 ne l'a pas apporté.
- `exe-application` et `exe-materiel` n'ont pas d'équivalent dans Tracker : rien à porter.

**Règle du lot** (celle de Gtracker) : rien de ce qui est vérifié ne disparaît.
- Avant de toucher un script, relever sa sortie et sa durée sur le programme reconstruit (`npm run exe`) ; après, la liste triée des libellés de contrôle doit être identique, tous réussis, deux passages de suite.
- Mesurer où part le temps (lancement jusqu'à la page prête, travail du cas, fermeture) avant d'agir, et l'écrire dans `outils/banc/SCRIPTS.md` et dans le rapport du lot (l'agent ne touche pas `docs/` ; l'orchestrateur recopie les mesures dans ce plan).
- Un `settle` qui va à son plafond ne se supprime pas sans en chercher la cause : l'attente se reporterait sur le `go` suivant.
- Aucun fichier de `src/`, `bureau/` ni `android/` ne change.

**Sources.**
- À copier puis adapter : `outils/banc/exe-tous.mjs` (267) et `exe-tous.test.mjs` (92).
- À porter par petits morceaux : le diff de `outils/banc/lib/cdp.mjs` du commit `1d47b22` (15 lignes).
- Comme modèles de réécriture : les diffs d'`exe-synchroniser.mjs`, `memoire-disque.mjs` et `exe-fermeture.mjs` du même commit (`git -C "D:/gong tracker/Gtracker" show 1d47b22 -- outils/banc/<fichier>`).
- Documents : `outils/banc/LISEZMOI.md`, section « Programme Windows » (jouer le banc, écrire un script qui n'attend pas pour rien, le piège du worker), et `SCRIPTS.md` (durée et ports de chaque script). L'agent peut toucher ces deux fichiers, qui sont des outils et non `docs/`.

**Preuve.** Relevés avant et après de `exe-synchroniser`, `memoire-disque`, `exe-fermeture`, et de `passe.mjs exe-import exe-tuiles --exe` ; listes de contrôles identiques, durées notées ; `exe-tous.test.mjs` vert ; deux passages complets de `exe-tous` de suite. `exe-synchroniser-essai` n'est pas rejoué ici (vrai téléphone) : sa réécriture est relue à la main, et il est rejoué par l'orchestrateur à son prochain passage câble branché (au plus tard au lot 250-4).

**Risques.** Le poste est partagé : un échec se rejoue seul avant de conclure à une régression, et chaque script garde son port. Un Gtracker ou un Tracker ouvert par l'utilisateur ne doit jamais être fermé (par numéro de processus seulement).

**Règle pour la suite.** Tout script neuf ou retouché du programme suit cette forme dès sa naissance :
- attente d'un état, `disparu` à l'horloge ;
- un port propre, une entrée dans `SCRIPTS_EXE` avec son `quand` ;
- cas regroupés quand le démarrage n'est pas vérifié.

Cela vaut pour la partie banc du 242 et pour `exe-sansfil.mjs` et la part `--sansfil` d'`exe-synchroniser.mjs` (250-6).

**Fait le 27/11** (commit « Lot 250-0 », à valider sur lecture). Mesures sur le programme 1.0.39, script seul :

| Script | Avant | Après | Contrôles |
|---|---|---|---|
| `exe-synchroniser` | 40 s | 28 s | 82, identiques, tous réussis |
| `memoire-disque` | 68 s | 52 s | 128, identiques |
| `exe-fermeture` | 56 s | 43 s | 35, identiques |
| `passe.mjs exe-import exe-tuiles --exe` | 50 s | 50 s | relevés identiques |

Les trois scripts joués l'un après l'autre prenaient 2 min 44 ; `exe-tous` les joue en 1 min au mur, 245 contrôles sur 245 réussis, deux passages de suite. Le gain est bien plus petit que chez Gtracker, parce que les scripts de Tracker étaient déjà courts.
- La cause du worker n'est confirmée que dans `memoire-disque` (trois `settle` au plafond sur `trackWorker-*.js`). Dans `exe-fermeture`, un `settle` de 4 s allait au plafond faute de script de page dans la page déjà chargée. `exe-synchroniser` n'atteignait aucun plafond : il ne gagne que sur ses attentes fixes, 17 s sur 37.
- Aucun regroupement de cas possible : chaque lancement restant vérifie un démarrage ou prend d'autres variables d'essai.
- Ports : `synchroniser` 9630, `memoire` 9670, `fermeture` 9680, `synchroniser-essai` 9640 ; réservés 9660 et 9635 (`PORTS_RESERVES` d'`exe-tous.mjs`).
- `exe-synchroniser-essai` a été réécrit et relu, pas rejoué : il se rejoue câble branché au prochain passage, au plus tard au 250-4.
- Hors lot : `exe-tuiles` a un échec ancien, identique avant et après, côté Chrome comme côté programme (« des tuiles sont rangées dans le Cache API (aucune) ») ; l'extension d'`ignorerWorkers` au banc du navigateur est l'élément 255.

---

## Ce que le sans-fil prend aux autres lots

**Il ne dépend que du lot 242.** Ce qu'il en attend, et ce qu'il doit faire lui-même si le 242 ne l'a pas fait :

1. `src/hooks/sessionLibrary/phoneSync.ts` au parcours de Gtracker, avec l'étape `waiting` (raisons `absent`, `lost`, `busy`), `noPhone` et `firstStart`, et un réveil commun (`wake()`) appelé par le relevé de 3 s du câble. 250-6 y branche les avis d'arrivée et de départ du Wi-Fi. **Indispensable** : 250-6 ne refait pas le parcours.
2. `src/components/PhoneSyncButton.tsx` à la fenêtre unique de Gtracker : 250-6 y ajoute la ligne « <téléphone> relié » et le moyen (« par le Wi-Fi », « par le câble »).
3. Le marqueur `synchro` posé en fin de synchronisation (`markerTextWithSync`, `notifyPhone`) et `src/library/syncWatch.ts` côté téléphone. Indispensable aussi : par le Wi-Fi, Tracker est à l'écran pendant l'échange et doit afficher les changements sans « Mettre à jour ».
4. `bureau/journal.ts`, le canal `coquille:noter` et `noteJournal` (constat P10). `sansFil.ts` importe le type `Journaliser` de `journal.ts`. **Si le 242 ne l'a pas apporté, 250-2 l'apporte**, copié de Gtracker (`bureau/journal.ts`, 202 lignes, et son test, 187), avec les retouches de `main.ts` (fonction `journal`, `journaliseur`, `suivreEtats`).
5. `phoneCanWrite` lu sur l'état prêt (Gtracker, `src/platform/phoneCable.ts:64`) plutôt que sur les méthodes du pont (Tracker, `phoneCable.ts:69`). Si le 242 ne l'a pas changé, c'est 250-2 qui le fait.
6. L'identifiant d'appareil du téléphone dans son marqueur (P6, `markerTextWithDevice`) : utile au sans-fil, pas indispensable.

**Peut se coder avant ou pendant le 242** : 250-1 en entier, 250-3 en entier.

**Pièces rangées ailleurs par l'audit et nécessaires ici** (elles entrent dans les lots du sans-fil) :
- `bureau/modeEssai.ts` (25 lignes, son test 43) : **entre dans 250-2**. Le serveur lit des variables d'essai (`TRACKER_BANC_SANSFIL_PROFIL` déplace les secrets, `_PORT`, `_ACTIF`…) : le programme livré ne doit plus les lire. Il faut le marqueur `trackerEssai` posé par `outils/bureau.mjs --exe` (modèle `paquetDeLaCoquille`, Gtracker `outils/bureau.mjs:89`), lu par `essaiPermis`, puis `ENV = environnementDeLaCoquille(...)` à la place de `process.env` dans `main.ts`. Le reste du constat P11 (archive réduite, contrôle à la construction) reste au lot 249.
- `MemoryTree.java` et `MemoryWriter.java`, sortis de `MemoryFolderPlugin.java` : **entrent dans 250-3**.
- `bureau/rechargement.ts` : **non nécessaire**, reste au lot 249.
- L'installeur et l'APK embarquée (249) : non nécessaires. Sans installeur, la règle du pare-feu vise l'exécutable du dossier `bureau/sortie/Tracker-win32-x64/` ; et sans le retrait à la désinstallation, une règle orpheline sans effet resterait après la suppression du dossier. C'est dit dans 250-5, et le 249 ajoutera le retrait.

---

## 250-1 · Le protocole et le code, sans réseau

**Ce que l'utilisateur y gagne** : rien de visible. C'est le contrat commun au PC et au téléphone, prouvé par ses tests.

**Logique.**
- **Trames** (`trames.ts`) : 4 octets pour la longueur de l'en-tête, 4 octets pour celle du corps (gros-boutiste), un en-tête JSON UTF-8 sans marque d'ordre d'octets, avec un champ `type`, puis un corps brut.
  - Limites tant que le téléphone ne s'est pas présenté (`LIMITES_ACCUEIL`) : en-tête de 16 384 octets, corps vide. Ensuite (`LIMITES`) : 8 Mio et 1 Mio.
  - Hors limites, UTF-8 invalide ou flux tronqué : la liaison se ferme.
- **Messages.**
  - Accueil : `appairer { version, nom, nonceTelephone, partA, capacites? }`, `bonjour { version, nom, jeton, capacites? }`, `defi { noncePc, partB }`, `preuve`, `appaire`, `bienvenue`, `refus { raison }`.
  - Commandes, avec un `id` : `lister`, `lire { chemin, debut, longueur }` (1 Mio au plus), `ping`, et pour un téléphone qui annonce « ecriture » : `ecrire { chemin, debut, taille } + corps`, `valider { chemin, taille }`.
  - Réponses : `liste`, `bloc`, `pong { enregistre? }`, `ecrit`, `fait`, `erreur { code, message }`.
  - `PROTOCOLE_SANS_FIL` = 1 ; ce qui s'ajoute passe par `capacites`.
- **Ajouts propres à Tracker** (Gtracker ne les a pas, ils remplacent `effacer`) :
  - `lister` couvre la racine et `sessions/`, `itineraires/`, `reglages/`, **`journaux/`** (les `DOSSIERS_LISTES` de Tracker, `bureau/telephone.ts:155`) ;
  - `listerTout { id }` → `liste` : tout le dossier, à toute profondeur, provisoires compris, noms réels, chaque entrée avec `ordinaire: bool`, en lecture seule. C'est ce qu'exige la copie de sécurité entière de Tracker (`DossierDistant.listerTout`, `telephone.ts:117`) ;
  - `deplacer { id, chemin, taille, dateMs, vers }` → `fait` : retrait d'un fichier de `sessions/` ou `itineraires/` vers la corbeille du téléphone (voir « Points tranchés », point 1). Refusé si la taille ou la date ne sont plus celles du listage, si `vers` est déjà pris, ou pendant un enregistrement. Sans effet si le fichier n'est plus là ;
  - `listerCorbeille { id }` → `liste` des noms de sous-dossiers de `corbeille/`, pour choisir un nom libre ;
  - **`effacer` n'existe pas** dans le protocole de Tracker : aucune commande n'efface un fichier de l'utilisateur. Seul le provisoire d'une écriture ratée est effacé, par le téléphone lui-même ;
  - une seule capacité, « ecriture », vaut listage complet, `listerTout`, écriture, déplacement et corbeille. Les autres capacités restent extensibles.
- **Appairage** (`appairage.ts`) :
  - fenêtre de 2 minutes (`DUREE_FENETRE`), code tiré uniformément de 000000 à 999999 ;
  - trois codes faux ferment la fenêtre, de même qu'un succès ou une onzième tentative commencée ;
  - le registre (`telephones.json`, version 1, `{ id, nom, hachage, ajouteLe, vuLe }`) ne garde que le SHA-256 du jeton ;
  - à corriger en portant : `vuLe` doit se poser à chaque arrivée (fiche 490 de Gtracker, point 3).
- **SPAKE2** (`spake2.ts`, RFC 9382, suite P256-SHA256-HKDF-HMAC) :
  - identités de la table ; idB est l'empreinte SHA-256 du certificat vu ;
  - le téléphone confirme le premier ; le PC répond `defi` même sur une part fabriquée, pour que rien ne distingue un code faux d'une part fausse ;
  - vérifications à temps constant ;
  - commun au PC et à la page du téléphone : ni `node:`, ni réseau, ni horloge.
- **Certificat** (`certificat.ts`) : ECDSA P-256 auto-signé, encodeur DER maison, « sans échéance », `basicConstraints` critique, empreinte SHA-256 du DER.
- **Sonde** (`sonde.ts`) :
  - question de 22 octets, réponse de 41 octets ;
  - l'identifiant de sonde vaut les 16 premiers octets de HMAC-SHA256(identifiant du PC, étiquette ‖ nonce) ;
  - seules les plages privées RFC 1918 sont admises, et le nom du PC n'est jamais envoyé.

**Sources à copier tels quels puis renommer** (Gtracker → Tracker, mêmes chemins) :
- `bureau/trames.ts` (576) et `trames.test.ts` (420) ;
- `bureau/appairage.ts` (400) et `appairage.test.ts` (355) ;
- `bureau/spake2.ts` (265) et `spake2.test.ts` (381) ;
- `bureau/certificat.ts` (173) et `certificat.test.ts` (80) ;
- `bureau/sonde.ts` (241) et `sonde.test.ts` (138) ;
- `bureau/sansFil.vecteurs.json` (391), régénéré ;
- neuf : `bureau/essais/vecteurs.ts`, le générateur.

**À adapter.**
- `trames.ts` importe `cheminDuCable`, `cheminEcrivable` et `fichiersAdmis` de `telephone.ts`. Tracker a `cheminAdmis` (racine et `DOSSIERS_LISTES`, `telephone.ts:163`), `cheminEcrivable` (`:189`), `cheminRetirable` (`:197`), et `fichiersAdmis(fichiers)` sans second paramètre (`:313`). Utiliser ceux de Tracker et **ne pas importer** `cheminDuCable`.
- Garder dans `telephone.ts` de Tracker la seule liste blanche (la Java la recopie, contrôlée au lot 250-3) :
  - écriture : `tracker.json` et `fc-repos.json` (**pas `lieux.json`**), `sessions/`, `itineraires/`, `reglages/` ;
  - déplacement : depuis `sessions/` et `itineraires/` seulement.
- Messages neufs (`listerTout`, `deplacer`, `listerCorbeille`) : décodage, encodage, et refus d'un chemin hors liste. Pour `deplacer`, `vers` est borné par une fonction pure `destinationCorbeilleAdmise(chemin, vers)` (forme au point 1 des points tranchés).
- Texte : aucun `t()` dans ces fichiers (la coquille est en français). Retirer des commentaires les mentions de la vente (« acheteur », « GONG », « relecture avant vente », numéros de constats B-xx).

**Dépendances, posées par l'orchestrateur avant le lot** (l'agent ne touche pas `package.json`) :
- à la racine, `"dependencies"` : `"@noble/curves": "2.4.0"` et `"@noble/hashes": "2.4.0"` (versions exactes, sans `^`), car la page du téléphone (250-4) importe `bureau/spake2.ts` et Vite les embarque ;
- dans `bureau/package.json`, `"devDependencies"` : `"@noble/hashes": "2.4.0"` (et `"@noble/curves": "2.4.0"`), puis `npm install` dans les deux dossiers. Piège du lot 498 de Gtracker : une autre version de `@noble/hashes` dans `bureau/node_modules` (amenée par electron-builder au lot 249) passerait avant celle de la racine, et le programme calculerait avec une autre bibliothèque que la page.

**Emballage** (`outils/bureau.mjs`, touché par l'agent) :
- porter `regrouperSpake2` (Gtracker `outils/bureau.mjs:516-558`) et son appel dans `compiler` après `tsc -p bureau`. Le regroupeur est rolldown, pris là où Vite le trouve. Le contrôle d'égalité des versions de `@noble/*` entre `bureau/` et la racine vient avec ;
- `bureau/tsconfig.json` est inchangé : il compile `*.ts` de `bureau/` seulement, `essais/` n'est ni compilé ni emballé.

**Preuve.** Tous les tests ci-dessus, verts : RFC 9382 annexe B, vecteurs relus, trames invalides, code faux, nonce rejoué, fenêtre expirée, jeton révoqué, certificat relu par `X509Certificate`, `vuLe` posé. `npm run verif`. Ni banc, ni essai au téléphone.

**Risques.** Écart de version de `@noble/*` (contrôlé par la construction). Vecteurs régénérés faux sans que les tests TypeScript le voient : c'est le Java (250-3) qui fait foi, en plus de la RFC.


**Fait le 27/11** (commit « Lot 250-1 », à valider sur lecture). Tests : trames 33 (et 1 sauté, l'écriture des vecteurs), spake2 20, appairage 21, sonde 9, certificat 9, telephone +3, `outils/bureau.test.mjs` +3. Un PC Gtracker échoue comme sur un code faux, et ses sondes sont refusées. `node outils/bureau.mjs --compiler --sans-vite` regroupe `spake2.js` par rolldown, après le contrôle d'égalité des versions de `@noble`.

Écarts au plan, acceptés par l'orchestrateur :
- `lire` accepte aussi les vrais noms rendus par `listerTout` (`cheminBrutAdmis` : toute profondeur, provisoires compris, 4 096 caractères au plus), puisque la copie de sécurité relit par `lire` ce qu'elle liste ;
- les réponses portent deux types distincts, `listeTout` (champ `ordinaire`, rien d'écarté) et `listeCorbeille { dossiers }`, au lieu de `liste` : avec un seul type, le décodeur ne saurait pas s'il doit filtrer ;
- `partA` reste facultatif dans `appairer`, comme dans Gtracker ; le PC refuse ensuite avec la raison `version`. Le Java (250-3) garde la même règle ;
- le générateur ne tourne pas par `node` seul (`bureau/package.json` est en `commonjs`) : il passe par un test sauté. Le relancer depuis cmd : `set TRACKER_ECRIRE_VECTEURS=1&& npx vitest run bureau/trames.test.ts -t "réécrit"`. Un test non sauté vérifie que le fichier commité est celui que produit le générateur.

Réponse de l'utilisateur à Q77, le 27/11 : oui, la corbeille du téléphone. C'est ce qui est codé, avec le dossier racine du dépôt dans une seule constante, `DEPOT_TELEPHONE = 'corbeille'` (`bureau/telephone.ts`).

**À faire dans les lots suivants** (tranché par l'orchestrateur, conséquence de la réponse à Q77) :
- **250-2** (PC) : `cheminEcrivable` refuse aujourd'hui `corbeille/<dossier>/depose.json`, que le PC doit écrire avant de déplacer (point tranché 1, étape 2). L'admettre, **et ce seul nom**, sous un dossier accepté par `dossierDepotAdmis`, par le câble comme sans câble ; tout autre fichier sous `corbeille/` reste refusé à l'écriture.
- **250-2** (PC) : le serveur appelle `arrivee(jeton, maintenant)` à chaque `bonjour`, pour poser `vuLe`.
- **250-3** (Java) : la même exception dans la liste blanche du greffon, contrôlée contre celle de `telephone.ts`.
- **250-3** (Java), relecture du 250-1 : un fichier `sessions/depose.json` aurait pour destination `corbeille/<dossier>/depose.json`, le nom réservé au dépôt écrit d'abord par le PC. Seul le refus « `vers` déjà pris » du téléphone empêche l'écrasement : un test Java le prouve sur ce cas précis.

---

## 250-2 · Le PC écoute et sait lire et écrire le téléphone

**Ce que l'utilisateur y gagne** : rien de visible encore (aucune carte). Le programme sait relier un téléphone et le synchroniser par le Wi-Fi, prouvé par les tests sur une vraie socket et par le faux téléphone.

**Logique** (`bureau/sansFil.ts`, classe `ServeurSansFil`).
- **Allumage.** Éteint par défaut. Le choix est gardé dans `sansfil/reglages.json` `{ version: 1, actif, identifiantPc }` ; l'identifiant fait 16 octets aléatoires, tirés une fois.
- **Écoute.** TLS sur 48247, ou l'un des 9 suivants si le port est pris (`ESSAIS_PORT`), sur **chaque adresse IPv4 privée** du PC séparément, jamais sur `0.0.0.0`. Adresses relues toutes les 30 s.
- **Découverte.** UDP 48248, sur toutes les adresses, pour recevoir les diffusions. Ne répond qu'aux questions venues d'un réseau privé du PC.
- **Délais** (`DELAIS`, `sansFil.ts:145`) :

  | Délai | Valeur |
  |---|---|
  | poignée TLS | 10 s |
  | premier message (`appairer` ou `bonjour`) | 3 s |
  | chaque message suivant de l'accueil | 10 s |
  | réponse à une commande | 30 s |
  | intervalle entre deux `ping` | 15 s |
  | réponse à un `ping` | 20 s |
  | relevé des adresses | 30 s |

- **Plafonds** (`:157-185`) :

  | Plafond | Valeur |
  |---|---|
  | liaisons inconnues en tout | 16 |
  | liaisons inconnues par adresse | 2 |
  | connexions | 32 |
  | réponses de sonde par seconde | 200 |
  | réponses de sonde par seconde et par adresse | 3 |

- **Accueil.** Un inconnu n'a droit qu'aux petites trames.
  - `appairer` hors fenêtre : `refus fenetre`. Code faux : `refus code`, compté. Sans `partA` : `refus version`.
  - `bonjour` avec un jeton inconnu : `refus jeton`.
  - Reconnu : les limites passent aux larges, la liaison s'inverse, `ping` toutes les 15 s, arrivée annoncée (`surArrivee { id, nom, nouveau }`).
  - Une liaison plus récente du même téléphone remplace l'ancienne, sans annonce de départ.
- **Départ.** `surDepart { id, nom, raison, heure }`, raison parmi `ferme`, `silence`, `retire`, `eteint`, `coupure` (`classerDepart`, `:273`). L'heure est gardée pour la liste.
- **Dossier distant** (`dossierSansFil()`, `:912`) : le dernier téléphone arrivé. Les lectures et écritures ne vont qu'au téléphone du dernier listage. L'état prêt porte `canal: 'sansFil'`, `ecriture`, `itineraires` et `enregistrement`, lus par un `ping` frais.
  - Lecture et écriture par blocs de 1 Mio (`lireParBlocs`, `ecrireParBlocs`). Taille comparée, provisoire local effacé sur une coupure.
  - Fichier de 1 Gio au plus (`TAILLE_FICHIER_MAX`).
- **Wi-Fi d'abord, câble sinon** (`dossierSansFilPuisCable`, `:1625`), avec une écriture refusée si le canal choisi ne sait pas écrire ou si le téléphone enregistre.
- **Secrets**, dans `%APPDATA%\Tracker\sansfil\` (jamais dans la mémoire) :
  - `reglages.json` ;
  - `telephones.json` ;
  - `certificat.pem` ;
  - `cle.bin`, la clé chiffrée par `safeStorage` (DPAPI). Sans chiffrement disponible, le certificat ne dure que le lancement : les téléphones se réappaireront.
- **Canaux** `sansfil:etat|activer|ouvrirAppairage|telephones|retirer` (`CANAUX_SANS_FIL`, `:1670`), plus `autoriser`, branché seulement au lot 250-5. Avis vers la page : `sansfil:arrive` et `sansfil:parti`.

**Sources à copier puis renommer** :
- `bureau/sansFil.ts` (1 790) ;
- `bureau/fauxTelephone.ts` (550) ;
- `bureau/essais/sansFil.ts` (125, aides des tests) ;
- `sansFil.test.ts` (607) et `sansFil.intrus.test.ts` (628) ;
- `bureau/modeEssai.ts` (25) et `modeEssai.test.ts` (43) ;
- `bureau/journal.ts` (202) et son test (187), si le lot 242 ne les a pas apportés.

`sansFil.pareFeu.test.ts` reste pour 250-5.

**Ce que `sansFil.ts` importe de `pareFeu.ts`** : les types `ContexteEcoute`, `IssueAutorisation`, `JugementPareFeu`, `LecturePareFeu`, `PareFeu`, `ResultatAutorisation`, ainsi que `ESSAIS_PORT` et `releveRate`. Créer dans ce lot un `bureau/pareFeu.ts` réduit à ces types et à ces deux exports, recopiés de Gtracker ; 250-5 le complète. Les options `lirePareFeu` et `autoriserPareFeu` restent absentes : le serveur retombe alors sur `essayerAutoConnexion`, dont l'« ouvert » devient « inconnu », comme dans Gtracker sans relevé.

**À adapter à l'interface de Tracker** (le point le plus délicat du lot). `DossierDistant` de Tracker (`bureau/telephone.ts:77-121`) n'a pas `effacer` ; il a :
- `enregistrement()`, branché sur un `ping` dont le `pong.enregistre` couvre les trois services (250-3) ;
- `ecrire()` : `ecrire` puis `valider`, comme dans Gtracker ;
- `mettreDeCote(fichier, vers)` : commande `deplacer` ;
- `listerCorbeille(dossier)` : commande `listerCorbeille` ;
- `listerTout()` et `lireBrut()` : `listerTout`, puis `lire` sur un chemin de ce dernier listage.

Il faut :
- écrire ces cinq méthodes dans `dossierSansFil()` ;
- refaire `dossierSansFilPuisCable` sur ces méthodes (même règle : canal choisi au listage, écriture refusée s'il ne sait pas écrire ou s'il enregistre) ;
- refaire `fauxTelephone.ts` en conséquence : listage des cinq dossiers, `listerTout`, `deplacer` vers `corbeille/`, `listerCorbeille`, refus pendant un enregistrement (option `enregistre`), suffixes `.tracker-*` ;
- le faux téléphone ne joue que le téléphone à jour : retirer les variantes `ancien` et `ancienEchange` de Gtracker, sans objet pour un protocole neuf.

**Fichiers à fusionner à la main.**
- `bureau/main.ts`.
  - Apporter : `creerSansFil(profil)` (Gtracker `main.ts:524-551`), le `chiffreurSysteme` sur `safeStorage` (`:507-511`), `avertirPage` (`:514`), et `creerTelephone` qui rend `dossierSansFilPuisCable(sansFil.dossierSansFil(), cable)`, enveloppé par `suivreEtats` du journal. Ajouter `...gestionnairesSansFil(sansFil)` dans `brancherCanaux` et `app.on('will-quit', () => void serveur.arreter())`. Lire l'environnement par `ENV` (`modeEssai.ts`) et non `process.env` : ce sont les `TRACKER_*`.
  - Garder de Tracker : `telephoneDepuisEnvironnement` et la racine d'essai `Tracker-essai` (`main.ts:377-385`), `dossierAdb({ …, nomRacine })`, la copie de sécurité entière, `copieExiste`, et la garde du port de débogage.
  - Le câble reste branché tel quel.
- `bureau/preload.ts` : l'objet `sansFil` (Gtracker `preload.ts`, `etat`, `activer`, `ouvrirAppairage`, `telephones`, `retirer`, `surArrivee`, `surDepart` ; `autoriser` au lot 250-5). Garder l'objet `telephone` de Tracker (`enregistrement`, `mettreDeCote`, `listerCorbeille`, `copieExiste`).
- `bureau/pont.test.ts` : les noms des canaux du preload égaux à `CANAUX_SANS_FIL`, sur le modèle du test des canaux `telephone:*`.
- `bureau/telephone.ts` : ajouter `canal?` à l'état prêt (`EtatTelephone`), et la fonction `destinationCorbeilleAdmise` du point 1.
- `src/platform/desktopBridge.ts` : les types `DesktopWirelessState`, `DesktopWirelessPairing`, `DesktopWirelessPhone`, `DesktopDepartureReason`, `DesktopWirelessBridge` et `sansFil?` dans `DesktopBridge` (Gtracker `desktopBridge.ts:192-275`) ; `DesktopPhoneChannel` et `canal?` dans `DesktopPhoneState`. Tout reste facultatif, pour une coquille plus ancienne.
- `outils/bureau.mjs` : `paquetDeLaCoquille(version, { essai })` pose `trackerEssai: true` dans le `package.json` compilé pour `--exe` et l'essai, jamais ailleurs. Prépare le lot 249, qui le retirera de l'installeur.

**Preuve.**
- Tests sur une vraie socket en 127.0.0.1 (`sansFil.test.ts`, `sansFil.intrus.test.ts`) :
  - appairage complet, refus hors fenêtre, trois codes faux, jeton révoqué ;
  - gros fichier (2,9 Mo, trois blocs), coupure en pleine lecture et en pleine écriture (rien d'écrit à moitié, aucun provisoire visible) ;
  - `deplacer`, `listerTout`, téléphone qui enregistre (rien d'écrit), Wi-Fi d'abord puis câble ;
  - plafonds d'inconnus et de sonde, liaison remplacée sans départ annoncé.
- `modeEssai.test.ts` : variables ignorées dans un programme emballé sans marqueur.
- `pont.test.ts`.
- Banc : `memoire-disque` (aucun secret dans le dossier mémoire), puis `exe-synchroniser` inchangé (le câble marche toujours), relevés avant et après.
- Aucun essai au téléphone : il n'y a pas encore d'APK.

**Risques.**
- Le plus grand fichier du sans-fil, avec des fusions dans des fichiers que le 242 vient de changer : relecture obligatoire.
- Une méthode de `DossierDistant` mal portée peut faire passer le câble par un mauvais chemin : le banc `exe-synchroniser` le dit.
- `safeStorage.isAsyncEncryptionAvailable` existe dans Electron 45.3.4 (celui de Tracker) : Gtracker tourne sur 45.4.1, même branche.

---

## 250-3 · Le téléphone répond (greffon Android)

**Ce que l'utilisateur y gagne** : rien de visible sans 250-4. Le téléphone sait se faire trouver, s'appairer et répondre au PC, prouvé par JUnit.

**Logique** (`ComputerLinkPlugin.java`).
- **Réseaux.** Tout réseau local du téléphone à adresse IPv4 privée, sans condition sur le réseau actif : le Wi-Fi, y compris le point d'accès du PC, et le partage de connexion du téléphone. Jamais le réseau mobile, un tunnel ou un VPN (`mobileInterfaceName`, `privateIpv4`).
- **Découverte.** L'adresse donnée par la page, sinon la dernière adresse connue (1 s), sinon une question UDP diffusée sur chaque réseau local (3 s). Jusqu'à 4 PC retenus (`Candidates`), essayés à tour de rôle. Sans réponse, la page montre le champ « Adresse ».
- **TLS à empreinte fixée** (`checkServerTrusted`). Aucune chaîne de confiance ; protocoles modernes seulement (`modernProtocols`), suites authentifiées (`authenticatedSuites`).
- **Appairage** en quatre étapes portées par la page, qui seule voit le code et calcule SPAKE2 : `pairSearch`, `pairOffer { generation, endpoint, partA }`, `pairConfirm { generation, cA }`, `pairFinish { generation, keep, folder?, base? }`.
  - Entre deux étapes, la liaison attend 20 s au plus.
  - Rien n'est gardé avant `keep`. Jeton, empreinte, identifiant et dernière adresse vont dans les préférences privées du greffon, exclues des sauvegardes. Un seul PC connu ; un refus `jeton` efface le jumelage.
- **Liaison.** `connect { address?, folder?, base? }` et `forget()`. État publié par `status()` et par l'événement `status` : `{ state, error, paired, computerName, address, lastSentMs, sentFiles, lastExchangeMs, onLocalNetwork }`, au plus une fois par seconde pour les échanges.
  - États : `unpaired`, `idle`, `searching`, `pairing`, `linked`, `notFound`.
  - Erreurs : `noLocalNetwork`, `localNetwork`, `code`, `window`, `nonce`, `token`, `version`, `certificate`, `proof`, `network`, `protocol`.
  - **Aucun service** : la liaison se ferme dans `handleOnStop` et `handleOnDestroy`. Fils : un pour les tentatives, un par liaison, un pour les fermetures.
- **Réponses** (`ComputerLinkCommands.java`, `answer`), une écriture à la fois :
  - `lister` et `listerTout` passent d'abord `MemoryWriter.settle` : un remplacement interrompu est terminé, une création interrompue est effacée ;
  - `lire` par blocs ;
  - `ecrire` : provisoire `.tracker-new` pour une création, `.tracker-tmp` pour un remplacement, flux tenu ouvert, blocs dans l'ordre ;
  - `valider` relit la taille, puis met le fichier en place ;
  - liaison coupée : `abandon()`, provisoire effacé ;
  - `deplacer` : `DocumentsContract.moveDocument` vers `corbeille/<dossier>/` (fournisseur qui sait déplacer). Sinon copie vers la cible, taille relue, puis effacement de l'original. Taille et date relues avant, original intact sur tout échec ;
  - `listerCorbeille` ;
  - refus `PERMISSION` sur `ecrire`, `valider` et `deplacer` pendant un travail de premier plan (garde au point 2 des points tranchés).
- **Sous-dossier de la mémoire.** `base` : `MemoryTree.baseDir`, `ComputerLinkProtocol.inBase` et `baseAllowed`. Un `base` qui sortirait de l'arbre est refusé (`BAD_BASE`).

**Sources à copier puis renommer** (paquet `io.github.segneur.tracker`, chemins sous `android/app/src/`) :
- `main/java/.../ComputerLinkPlugin.java` (1 568) ;
- `ComputerLinkProtocol.java` (1 342) ;
- `ComputerLinkCommands.java` (291) ;
- `MemoryTree.java` (294) ;
- `MemoryWriter.java` (438) ;
- `MemoryFolderPlugin.java` dans sa forme découpée (365), qui **remplace** les 632 lignes de Tracker. Vérifié le 26/11 : le `MemoryFolderPlugin.java` de Tracker est identique, au paquet près, à celui de Gtracker au point de séparation, qui l'a découpé sans changer son comportement (commits `b2f0823`, `bc4537a`, `4c54cd0`) ;
- tests sous `test/java/.../` : `ComputerLinkProtocolTest.java` (804, relit `bureau/sansFil.vecteurs.json` dans le dépôt), `ComputerLinkCommandsTest.java` (552), `FakeDocuments.java` (245), `MemoryTreeTest.java` (94).

**À adapter.**
- Les constantes du protocole sont celles de la table des noms et du lot 250-1 : suffixes, `LISTED_DIRS` avec `journaux`, `WRITABLE_ROOT_FILES` (`tracker.json`, `fc-repos.json`), `WRITABLE_DIRS`. On retire la commande `effacer` (`eraseFile`) et on ajoute `listerTout`, `deplacer` et `listerCorbeille`.
- `MemoryWriter.erase` ne reste que pour le provisoire.
- La garde d'enregistrement : point 2 des points tranchés.

**Fichiers à fusionner.**
- `MainActivity.java` : `registerPlugin(ComputerLinkPlugin.class)` (Gtracker `MainActivity.java:60`). Garder `RecoveryPlugin` et le reste de Tracker.
- `AndroidManifest.xml` : `ACCESS_NETWORK_STATE`, avec le commentaire de Gtracker (`AndroidManifest.xml:135-139`). Ne **pas** déclarer `ACCESS_LOCAL_NETWORK` (point 3).
- `android/variables.gradle` : `robolectricVersion = '4.16'`. `android/app/build.gradle` : `testImplementation "org.robolectric:robolectric:$robolectricVersion"`, sans `includeAndroidResources`. C'est du code : l'agent les touche.
- `src/platform/nativeConstants.test.ts` : contrôler que les listes blanches Java (`WRITABLE_*`, `LISTED_DIRS`, la destination de `deplacer`, le nom de la capacité, les suffixes, les ports, la signature) égalent celles de `bureau/telephone.ts`, `trames.ts` et `sonde.ts`, et la liste des trois services égale `SERVICES_APPLICATION` (`bureau/telephone.ts:140`). Modèle : le même test de Gtracker.
- `src/platform/androidManifest.test.ts` : la permission.

**Preuve.**
- `android\gradlew.bat testDebugUnitTest` (JDK 21, procédure au §12 de l'état), sous Robolectric 4.16, Android simulé 35 (`@Config(sdk = 35)`), image prise dans `~/.m2` :
  - vecteurs relus ;
  - écriture en deux blocs puis valider, remplacement, coupure au milieu (création et remplacement), arrêt brutal remis en ordre par `lister`, refus des chemins hors liste ;
  - `deplacer` (fournisseur avec et sans déplacement), fichier changé depuis le listage (refus), cible prise (refus) ;
  - garde des trois services, `listerTout` sur une arborescence profonde.
- `npm run verif` pour les deux tests TypeScript.
- Pas d'APK seule : elle se fait avec 250-4.

**Risques.**
- Piège noté par Gtracker : sous Windows, un flux resté ouvert empêche d'effacer son fichier dans le test ; l'arrêt brutal se simule par des provisoires posés sur le disque.
- `moveDocument` existe depuis l'API 24 (le `minSdk` de Tracker) mais dépend du fournisseur : la copie de repli est obligatoire et essayée.
- Le découpage de `MemoryFolderPlugin` touche la lecture de toute la mémoire : le banc ne voit pas le Java. C'est un des essais au téléphone (250-6).

---

## 250-4 · Le téléphone se relie seul, et garde ce que l'ordinateur retire

**Ce que l'utilisateur y gagne.**
- Dans Réglages › **Connexion** du téléphone, la carte « Ordinateur » : taper le code, voir le PC relié, « Oublier cet ordinateur ».
- Tracker se relie seul quand il est à l'écran.
- Ce que l'ordinateur retire du téléphone reste 30 jours dans sa corbeille, visible et restaurable (si la question 1 est répondue oui).

**Logique.**
- **Relance automatique** (`useComputerLinkLauncher`, monté une fois dans `src/App.tsx`, comme Gtracker `App.tsx:145`) : à l'ouverture, au retour au premier plan (`onAppResume`), quand le dossier devient accessible, puis toutes les 20 s (`RELINK_INTERVAL_MS`) tant que Tracker est à l'écran.
  - Jamais pendant un enregistrement (`isRecordingActive`, `src/hooks/useRecorder.ts:1138`), ni avec une tentative déjà en cours.
  - Règle pure `shouldAutoConnect` (Gtracker `library/computerLink.ts:173`).
- **Écran allumé** pendant un échange, jusqu'à 30 s après la dernière commande (`EXCHANGE_SCREEN_ON_MS`, d'après `lastExchangeMs`).
  - `src/platform/screen.ts` passe à un **compte par raison** : `ScreenOnReason = 'recording' | 'restingHrTest' | 'computerLink'`, `keepScreenOn(hold, reason)` (Gtracker `screen.ts:30`, `:57`). L'écran ne se relâche que quand plus aucune raison ne le tient.
  - Appelants de Tracker à mettre à jour : `src/pages/RecordingPage.tsx:447-448` (`recording`), `src/hooks/useRestingHrTest.ts:92`, `:148`, `:159`, `:171` (`restingHrTest`).
- **Appairage conduit par la page** (`library/computerPairing.ts`, `pairWithComputer`) : le code ne quitte jamais la page.
  - Pour chaque candidat (4 au plus), un scalaire neuf ; part, confirmation, et vérification de cB avant `pairFinish { keep: true }`.
  - Un échec garde la pire raison (`PAIR_FAILURE_ORDER`). Aléa par `randomBytes` de `@noble/hashes/utils.js`.
- **Phrases** de l'état et des refus (`library/computerLink.ts` : `describeLink`, `linkErrorText`, `refusalText`), sans mot du protocole. La carte dit : « L'ordinateur relié peut copier des sessions et en mettre à la corbeille du téléphone quand vous touchez « Synchroniser » sur l'ordinateur. »
- **Corbeille du téléphone** (point 1 des points tranchés) :
  - le téléphone purge `corbeille/` à 30 jours à l'ouverture de sa mémoire ;
  - il adopte les dépôts de l'ordinateur ;
  - il montre la zone « Corbeille » dans Réglages › Mémoire avec « Restaurer », « Supprimer définitivement », « Vider », comme le PC ;
  - ses propres suppressions restent directes, inchangées.

**Sources à copier puis renommer, sans `t()`** (texte français des sources) :
- `src/platform/computerLink.ts` (264) et son test (230) ;
- `src/library/computerLink.ts` (177) et son test (197) ;
- `src/library/computerPairing.ts` (145) et son test (230) ;
- `src/library/spake2Import.test.ts` (13) ;
- `src/hooks/useComputerLink.ts` (265) et son test (222) ;
- `src/components/ComputerLinkCard.tsx` (138) et `.css` (26). Gtracker l'enveloppe dans `SettingsSection` (lot 519), que Tracker n'a pas : utiliser le titre de partie des cartes de Tracker (`PanelTitle` ou la forme de `MemoryStatus`), variables de `tokens.css`, aucun `style={{`.

**Fichiers à fusionner.**
- `src/platform/screen.ts` (compte par raison) et son test.
- `src/platform/memoryFolder.ts` : ajouter `deviceFolderLocation()` (Gtracker `memoryFolder.ts:512-516`) sur `readDeviceChoice` (Tracker `memoryFolder.ts:439`).
- `src/App.tsx` : monter le lanceur.
- `src/pages/SettingsPage.tsx` : créer le bloc « Connexion » (point 4). Sur le téléphone, il porte la carte « Ordinateur », puis le contenu de l'ancien bloc « Capteurs » (`SettingsPage.tsx:936`). `?bloc=capteurs` ouvre « Connexion » et amène les ceintures à l'écran, retour vers Enregistrer inchangé (`core/parentPage.ts:32`, `:58`). `?bloc=relier` ouvre « Connexion ».
- `src/architecture.test.ts` : une ligne d'`EXCEPTIONS`, `'library/computerPairing → bureau/spake2': 'calcul de l\'appairage partagé avec le programme Windows'` (Gtracker `architecture.test.ts:66`). C'est un ajout à une liste qui « ne doit que diminuer » : voir la question 3.
- Corbeille du téléphone :
  - `src/library/trash.ts`, `trashFolder.ts`, avec leurs tests : adoption d'un dépôt, et la purge qui ne prend jamais pour un reste un dossier qui porte `depose.json` ;
  - `src/hooks/sessionLibrary/trash.ts` : `trashFolderOf` (`:33`) ouvre la corbeille pour la sorte `device` aussi, purge et adoption seulement ;
  - `deletesToTrash` (`library/trash.ts:356`) reste `disk` seul ;
  - `src/components/MemoryStatus.tsx` et `TrashZone.tsx` : la zone sur le téléphone.
- Côté PC, les retraits visent la nouvelle place :
  - `src/library/syncBase.ts`, `phoneTrashDir` et `phoneTrashPaths` (`:203-225`) : la destination devient `corbeille/<instant>-<identité>/<nom>` (nom tiré de `trashDirName`), avec `depose.json` écrit d'abord ;
  - `syncPlan.ts` et `syncRoutes.ts` (`moveTo`) ; `src/hooks/sessionLibrary/sync.ts:767` et `syncRouteFiles.ts:284` (`moveAsideOnPhone`) ;
  - `src/platform/phoneCable.ts` (`moveAside`, `asideTaken`) ;
  - le câble : `bureau/adb.ts` (`texteShell`, cible du `mv`) et `bureau/telephone.ts` (`retraitAdmis`, `nomCorbeille`, `dossierCorbeilleAdmis`).

**Preuve.**
- Tests : appairage (bon code, mauvais code, PC à l'ancien échange, candidat qui ne sait pas confirmer), lanceur (pas de tentative pendant un enregistrement, relance de 20 s, retour au premier plan), écran (deux raisons, l'une relâchée, l'écran reste allumé), adoption et purge du dépôt (coupure entre `depose.json` et le déplacement : rien de perdu, dossier adopté ou relu au passage suivant).
- Banc :
  - `reglages` : ordre des blocs, « Connexion » dans le navigateur avec les seules ceintures ;
  - `exe-synchroniser` (dont le cas « supprimée sur l'ordinateur », qui vise désormais `corbeille/`) ;
  - `exe-synchroniser-essai` à rejouer par l'orchestrateur sur `Tracker-essai`, câble branché, puisque la cible du câble change.
- **APK** : 250-3 et 250-4 ensemble.

**Risques.**
- La relance de 20 s ne doit rien lancer pendant un enregistrement ni pendant un test de FC repos.
- La corbeille du téléphone change ce que voit l'utilisateur sur le téléphone : à n'activer que sur la réponse à la question 1.
- Le changement de cible du câble touche du code éprouvé sur le vrai téléphone le 26/11 : rejouer `exe-synchroniser-essai`.

---

## 250-5 · Le pare-feu de Windows réglé par le programme

**Ce que l'utilisateur y gagne** : rien de visible seul. Le programme sait voir que Windows bloque le téléphone et poser l'autorisation, en une confirmation de Windows au nom de Tracker. La carte vient au lot 250-6.

**Logique** (`bureau/pareFeu.ts`).
- **Relevé sans droits.** Un seul `powershell.exe`, chemin complet sous `%SystemRoot%\System32\WindowsPowerShell\v1.0`, `-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand`, sortie JSON en UTF-8, des nombres seulement. Le chemin de l'exécutable passe par `TRACKER_PAREFEU_EXE` dans l'environnement du processus lancé, jamais par la ligne de commande. Le relevé donne :
  - adresses et interfaces, catégorie du réseau (une interface sans profil, comme le partage de connexion, compte comme publique) ;
  - état par profil (`FirewallEnabled`, `BlockAllInboundTraffic`, `DefaultInboundAction`), et `LocalPolicyModifyState` ;
  - règles entrantes du programme ou sans programme ;
  - blocages posés par l'utilisateur (`blocagesPersonnels`).
- **Jugement** en TypeScript pur (`jugerPareFeu`) : `ouvert`, `bloque` ou `inconnu`, et `reparable`.
  - « ouvert » exige TCP et UDP sur le port réellement pris ;
  - le blocage l'emporte, et une seule interface bloquée suffit ;
  - une stratégie de groupe ou tout entrant bloqué rendent le cas non réparable ;
  - délai 30 s ; un relevé raté est noté au journal avec sa raison, refait une fois 15 s plus tard, puis à chaque relevé des adresses tant qu'il n'a pas réussi ;
  - relu toutes les 30 s tant que le pare-feu n'est pas ouvert.
- **Autorisation.**
  - Un PowerShell ordinaire relance **Tracker lui-même**, élevé, avec `--tracker-pare-feu=poser` : la demande de Windows porte le nom de Tracker.
  - Ce Tracker élevé s'arrête au tout début (`actionElevee`, `executerActionElevee`), sans fenêtre ni verrou d'instance, sur un profil jetable. Il pose `Tracker-SansFil-TCP` (ports 48247-48256) et `-UDP` (48248), entrantes, autorisées, pour l'exécutable, sous-réseau local, profils privé **et public** (indispensable au partage de connexion : réponse oui de l'utilisateur dans Gtracker, Q144 et Q145).
  - Il ne retire que les blocages créés par la fenêtre « Alerte de sécurité Windows » (« TCP Query User{… », « UDP Query User{… »). S'il reste un blocage, la sortie est 7.
  - Refus de l'utilisateur : code 1223 de Windows, rendu en code de sortie 3, issue `refusee`.
- **À l'allumage.** Si le relevé dit bloqué et réparable, l'autorisation est demandée **avant** la mise à l'écoute, pour que Windows ne pose plus sa propre question. Refusée ou ratée, le sans-fil s'allume quand même et la page propose de la redemander.
- **En mode d'essai**, le pare-feu est toujours factice (`TRACKER_BANC_SANSFIL_PAREFEU=ouvert|bloque|irreparable`, `_AUTORISATION=accordee|refusee|echec`) : jamais PowerShell.

**Sources.**
- À copier : `bureau/pareFeu.ts` (568, complète le fichier réduit du lot 250-2), `pareFeu.test.ts` (392), `sansFil.pareFeu.test.ts` (371).
- À fusionner :
  - `bureau/sansFil.ts` : les options `lirePareFeu` et `autoriserPareFeu`, `EtatSansFil.pareFeuReparable`, `autoriserPareFeu()`, `sansfil:autoriser`, `pareFeuFactice` ;
  - `bureau/main.ts` : `ACTION_ELEVEE` avant le verrou d'instance (Gtracker `main.ts:737-747`), et les fonctions de Windows branchées hors essai seulement (`:527-533`) ;
  - `bureau/preload.ts` : `autoriser` ;
  - `bureau/pont.test.ts`.

**Preuve.**
- Tests : partage de connexion sans profil (bloqué, réparable), privé et public autorisés (ouvert), blocage personnel (non réparable), règle désactivée, autre programme, ports qui ne couvrent pas le port pris, UDP manquant, stratégie de groupe, relevé illisible (inconnu, puis refait), apostrophe et accents dans le chemin, objet seul relu comme un tableau ; relevé fait après la mise à l'écoute et relu toutes les 30 s.
- Banc, au lot 250-6. **Aucun PowerShell réel lancé par un agent** : ni relevé, ni autorisation sur le poste.

**Risques.**
- Sans installeur (lot 249), la règle vise `bureau\sortie\Tracker-win32-x64\Tracker.exe`. Un programme reconstruit au même chemin garde sa règle ; déplacé, il la redemande.
- La règle n'est pas retirée en effaçant le dossier : sans effet, puisqu'elle vise un chemin disparu. Le 249 ajoutera le retrait à la désinstallation (`--tracker-pare-feu=retirer`).
- Le programme élevé est rangé dans le dossier de l'utilisateur : limite connue de Gtracker, que seuls une installation par machine et une signature fermeraient.
- Un pare-feu tiers ne se voit pas.

---

## 250-6 · Sur le PC : relier, attendre, synchroniser, et le banc

**Ce que l'utilisateur y gagne.** Dans Réglages › Connexion du programme Windows, la carte « Téléphone » :
- allumer le sans-fil ;
- si Windows bloque, « Autoriser Tracker » ;
- « Relier un téléphone » : code, adresse, décompte ;
- la liste des téléphones reliés, avec « Retirer ».

« Synchroniser » attend le téléphone et part seul à son arrivée, et dit « relié par le Wi-Fi » ou « par le câble ».

**Logique.**
- **Carte « Téléphone »** (`WirelessPhoneCard`), relue toutes les 5 s, chaque seconde pendant une fenêtre de liaison, et à chaque arrivée (`useWirelessPhones`).
  - Phrases de `library/wirelessPhone.ts` : `describeWireless`, `firewallNotice` (`{ text, canAuthorize }`), `authorizationOutcomeText`, `countdownText`, `pairingStatus`, `wrongCodesText`, `describePhoneSeen`.
  - Phrase d'allumage, la même aux trois endroits : « Windows va vous demander d'autoriser Tracker sur le réseau, y compris les réseaux publics comme le partage de connexion : acceptez. »
  - Le mode d'emploi du câble vient en paragraphe replié « Par câble (avancé) ».
- **Synchroniser** (sur le `phoneSync.ts` du 242) :
  - `waiting` se réveille sur `onWirelessArrival` et `onWirelessDeparture` en plus du relevé de 3 s ;
  - `noPhone` quand le registre est vide et le câble absent, avec le bouton « Relier mon téléphone » vers `?bloc=relier` ;
  - le message du pare-feu et « Autoriser Tracker » dans l'écran d'attente ;
  - une liaison perdue en route reprend seule trois fois (`MAX_LOST_RESUMES`), puis « Recommencer » ;
  - le moyen (`phoneChannel`) apparaît dans le sous-titre.
- **Bloc « Connexion » sur ordinateur** : la carte « Téléphone », puis la ligne des ceintures, précédée de « Ceintures et montres » et « Sur l'application Android seulement. ». Dans un navigateur : la ligne des ceintures seule.

**Sources à copier puis renommer, sans `t()`** :
- `src/platform/wirelessPhone.ts` (176) et son test (249) ;
- `src/library/wirelessPhone.ts` (115) et son test (123) ;
- `src/hooks/useWirelessPhones.ts` (165) ;
- `src/components/WirelessPhoneCard.tsx` (177) et `.css` (82), sans `SettingsSection` (comme au lot 250-4) ;
- `src/components/ConnectionSettings.tsx` (25), sans la carte `PhoneAppCard`, qui reste au lot 249.

**Fichiers à fusionner.**
- `src/hooks/sessionLibrary/phoneSync.ts` et `src/components/PhoneSyncButton.tsx` : les branchements ci-dessus. Le parcours reste celui du 242.
- `src/library/syncReport.ts` (`describePhoneState`) : les raisons de départ et le moyen.
- `src/platform/phoneCable.ts` : `phoneChannel(state)` (Gtracker `phoneCable.ts:21`).
- `src/pages/SettingsPage.tsx` : la partie ordinateur du bloc créé au lot 250-4.

**Banc** (partie à part, Sonnet \| high, après le code). Les scripts naissent directement sous la forme rapide du préalable 250-0 : attente d'états, `disparu` à l'horloge, `ignorerWorkers` hérité de `connect`, un port de débogage propre, et une entrée dans `SCRIPTS_EXE` d'`exe-tous.mjs` avec son `quand` (`sansfil` en 9660 ; `synchroniser-sansfil` en 9635, ports réservés au lot 250-0, distincts de ceux de Gtracker ; serveur sans fil sur un port libre `0` lu dans l'état, ou un port fixe déclaré dans `fixes`). On part des versions de Gtracker **après** le commit `1d47b22`, déjà réécrites ainsi.
- `outils/banc/exe-sansfil.mjs` (Gtracker, 1 507 lignes), porté sur le faux téléphone de `bureau/dist` et les variables `TRACKER_BANC_SANSFIL_*` :
  - case et phrases ; secrets dans le profil seulement ;
  - code et adresse lus sur la page, décompte ; trois codes faux ;
  - appairage, première synchronisation par le Wi-Fi (copie de sécurité entière, `id` posé dans `tracker.json` du faux téléphone, aucun provisoire), puis une seconde par le jeton ;
  - itinéraires dans les deux sens, une suppression de chaque côté (corbeille du PC, dépôt dans `corbeille/` du faux téléphone) ;
  - téléphone qui enregistre (rien d'écrit) ; coupure en pleine écriture puis reprise seule ;
  - « Retirer » (jeton refusé) ; fenêtre expirée ;
  - pare-feu `bloque`, `irreparable`, `accordee`, `refusee` (aucun PowerShell : le journal le dit) ;
  - attente puis départ seul à l'arrivée du faux téléphone.
- `outils/banc/exe-synchroniser.mjs` : l'option `--sansfil`, qui rejoue les cas du câble sur le faux téléphone du Wi-Fi, mêmes contrôles (preuve que le même moteur sert).
- `outils/banc/SCRIPTS.md` et la table « quel script rejouer » de `LISEZMOI.md`.
- Mesure : `exe-tous` complet (`synchroniser`, `synchroniser-sansfil`, `sansfil`, `memoire`, `fermeture`) joué deux fois de suite, durée au mur notée.

**Preuve.** Les tests ci-dessus, `exe-sansfil`, `exe-synchroniser` et `exe-synchroniser --sansfil`, `reglages`, `memoire-disque`.

**Essais au téléphone, pour tout le paquet 250** (APK de 250-3 et 250-4, programme Windows reconstruit à la même version) :
1. **Relier et synchroniser par le partage de connexion du PC** (l'utilisateur n'a pas de box).
   - Allumer le sans-fil, accepter la demande de Windows, taper le code.
   - Synchroniser une session créée de chaque côté et un itinéraire.
   - Supprimer une session sur le PC, synchroniser : elle est dans la corbeille du téléphone.
   - Tracker reste à l'écran du téléphone et se met à jour seul.
2. **Reprise et garde.**
   - Écran du téléphone éteint en pleine copie, puis rallumé, Tracker affiché : la liaison revient seule, la fenêtre du PC repart, rien d'écrit à moitié.
   - Pendant un enregistrement (ou le compteur d'intervalles), rien n'est écrit sur le téléphone, et c'est dit.
3. **Partage de connexion du téléphone** (le PC est client) : le téléphone trouve le PC. À ne faire que si le premier essai passe.

Ce que ni les tests ni le banc ne voient : le vrai pare-feu, la diffusion UDP sur un vrai réseau, le SAF réel (`moveDocument`, renommage), la garde des trois services sur le vrai téléphone, le découpage de `MemoryFolderPlugin`.

**Premier passage réel par Claude**, avant de rendre la main à l'utilisateur, sans toucher la vraie mémoire du téléphone : désigner sur le téléphone un dossier d'essai `Documents/Tracker-essai` comme mémoire, synchroniser par le Wi-Fi, puis redésigner `Documents/Tracker`. Seulement avec l'accord de l'utilisateur, qui seul touche le téléphone.

---

## Points tranchés

### 1. Retrait d'une session du téléphone par l'ordinateur

**Ce qui existe.**
- Par le câble, Tracker ne retire jamais rien du téléphone : il déplace par `mv` vers `Documents/Tracker-corbeille/AAAA-MM-JJ/<sessions|itineraires>/<nom>`, hors de la mémoire, jamais purgé (`bureau/telephone.ts:5-14`, `:207-236` ; `src/library/syncBase.ts:203-225`).
- Avant tout retrait, la copie est déjà dans la corbeille du PC, relue octet pour octet (`sync.ts`, `sameBytes`).
- Par le SAF, le téléphone ne peut pas sortir de l'arbre désigné (souvent `Documents/Tracker` lui-même) : cette mise de côté est impossible par le Wi-Fi.
- **L'application du téléphone n'a pas de corbeille aujourd'hui** : `deletesToTrash` ne vaut que pour la sorte `disk` (`src/library/trash.ts:356`), et la corbeille est « programme Windows seulement » (`trash.ts`, en-tête).
- En revanche, tout le code de la corbeille est pur sur un `MemoryFolder` (`trashFolder.ts`). Le dossier `corbeille/` est ignoré par la synchronisation : `syncFileRole` le classe `ignored` (`syncBase.ts`), et le câble ne le liste pas au-delà de la profondeur 2.

**Recommandation.** Une seule corbeille, que l'utilisateur connaît déjà. Ce que l'ordinateur retire du téléphone, **par le câble comme par le Wi-Fi**, va dans la corbeille du téléphone, `Tracker/corbeille/`, au format du PC, et y reste 30 jours, visible et restaurable dans Réglages › Mémoire du téléphone. Mécanique :
1. le PC choisit un dossier libre `corbeille/<instant>-<identité>/` (`trashDirName`, d'après `listerCorbeille`) ;
2. il y écrit d'abord `depose.json` : origine `ordinateur`, raison `synchronisation`, nom montré ;
3. puis il y déplace les fichiers, GPX en dernier : `deplacer` par le Wi-Fi, `mv` par le câble ;
4. le téléphone, à l'ouverture de sa mémoire et à chaque relecture (dont celle de `syncWatch`), adopte les dossiers qui portent `depose.json` : il les inscrit à son index par `rebuiltTrashEntry` (qui existe), puis efface `depose.json` ;
5. la purge ne prend jamais un tel dossier pour un reste.

Pourquoi le téléphone tient seul son index : aucune écriture concurrente de `corbeille.json` entre deux appareils. Une coupure entre `depose.json` et le déplacement laisse un dossier partiel, adopté tel quel ; l'original non déplacé reste sur le téléphone, et la passe suivante le refait.

Les suppressions faites sur le téléphone même restent directes, comme aujourd'hui. L'ancien `Documents/Tracker-corbeille/` n'est plus alimenté et reste tel quel : le dire une fois à l'utilisateur.

**Repli** si l'utilisateur répond non : même mécanique, dans un dossier `Tracker/mis-de-cote/AAAA-MM-JJ/…` jamais purgé et invisible dans l'application, ce qui reproduit la mise de côté actuelle du câble. Pas d'effacement réel dans aucun cas.

### 2. Garde d'enregistrement étendue aux trois services

- Le câble lit `dumpsys` et refuse si `RecordingService`, `HeartRateService` ou `IntervalTimerService` tourne (`SERVICES_APPLICATION`, `bureau/telephone.ts:140` ; `lireServices`, `bureau/adb.ts:439`). Gtracker ne regarde que `RecordingService.snapshot().running` (`ComputerLinkPlugin.java:1011`).
- Recommandation : une petite classe `ForegroundWork.java`, avec `static boolean busy()` = `RecordingService.snapshot().running || IntervalTimerService.isRunning() || HeartRateService.isRunning()`.
  - Ajouter `isRunning()` sur `IntervalTimerService`, à partir de son champ `running` (`:65`).
  - Ajouter un `static volatile` posé dans `onCreate` et retiré dans `onDestroy` de `HeartRateService`, qui n'a pas d'état statique aujourd'hui.
- Elle se branche dans `ComputerLinkPlugin.newCommands()` à la place de la lambda de Gtracker, et donne `pong.enregistre`.
- Le test `nativeConstants.test.ts` garde la liste Java égale à `SERVICES_APPLICATION`.
- Côté page, le lanceur ne relie pas pendant `isRecordingActive()`, qui couvre déjà l'enregistreur de Tracker.

### 3. Permissions Android

- `ACCESS_NETWORK_STATE` (normale, aucune question à l'utilisateur) : à déclarer.
- `INTERNET` : déjà déclarée (`AndroidManifest.xml:114`).
- `ACCESS_LOCAL_NETWORK` : Android 17 (API 37) ne l'impose qu'aux applications qui **ciblent** 37, et sa documentation demande de ne pas la déclarer avant. Tracker cible 36 (`android/variables.gradle:4`). On garde donc le code de Gtracker, qui la demande seulement quand le téléphone **et** la cible atteignent 37 (`ComputerLinkPlugin.java:112-125`), sans la déclarer.
- À noter dans `docs/ETAT_DU_PROJET.md` (orchestrateur) : au passage de la cible à 37, déclarer la permission et faire un essai au téléphone.
- Aucune permission de localisation n'est demandée pour le réseau : le greffon ne lit ni le nom du Wi-Fi ni les réseaux voisins.

### 4. Place du bloc « Connexion »

- Le §11 de `docs/DECISIONS.md` de Tracker ne fixe pas l'ordre des blocs (seulement « À propos » en dernier).
- Ordre actuel de Tracker (`SettingsPage.tsx:869-999`) : Mémoire, Autorisations, Activités, Enregistrement, Capteurs, Affichage, Cartes hors ligne, Pratiquant, Tutoriels, À propos.
- La décision de l'utilisateur dans Gtracker (lot 512) place « Connexion » entre Mémoire et Autorisations et y verse « Capteurs ». Elle s'applique ici telle quelle : **Mémoire, Connexion, Autorisations, Activités, Enregistrement, Affichage, Cartes hors ligne, Pratiquant, Tutoriels, À propos**.
- « Connexion » démarre replié. Aide « ? » : « Ce qui relie Tracker à un autre appareil : l'ordinateur ou le téléphone, les ceintures cardio et les montres. »
- Les phrases « Réglages › Capteurs » deviennent « Réglages › Connexion », et celles de la liaison qui disent « Réglages › Mémoire » aussi.
- Passe de doc (orchestrateur) : DECISIONS §6 (ceinture « dans Réglages › Capteurs », ligne 104), §8 et §11.

### 5. Mieux que Gtracker, sans alourdir

Dans ces lots :
- les protections de Tracker valent pour le Wi-Fi : aucune commande d'effacement, garde des trois services, copie de sécurité entière (`listerTout`), relecture octet pour octet avant tout retrait (moteur inchangé), corbeille du téléphone au lieu d'un effacement ;
- le générateur de vecteurs commité (250-1) ;
- `vuLe` posé à chaque arrivée (250-1) ;
- un seul faux téléphone, à jour, sans les variantes « ancien » d'une APK de la vente (250-2) ;
- la coexistence avec Gtracker (ports, signature, identités).

Pour plus tard, à noter dans `docs/BACKLOG.md` :
- un jeu de scénarios partagé entre `fauxTelephone.ts` et les tests Java (idée du lot 505 de Gtracker) ;
- une case « Synchroniser dès que le téléphone se présente », décochée par défaut ;
- `ignorerWorkers` étendu au banc du navigateur (élément 537 de Gtracker : un passage complet du banc d'abord) ;
- le retrait des règles du pare-feu à la désinstallation (lot 249).

---

## Questions pour l'utilisateur (trois au plus)

Tranché par l'orchestrateur le 26/11 : la question 2 est oui (réponse déjà donnée par l'utilisateur pour Gtracker, Q144 et Q145) ; la question 3 est oui (détail d'implémentation : une seule copie du calcul) ; seule la question 1 est posée à l'utilisateur (Q77 de `docs/BACKLOG.md`), et la corbeille du téléphone du lot 250-4 attend sa réponse. **Réponse du 27/11 : oui, la corbeille du téléphone.**

1. Quand l'ordinateur retire une session du téléphone (parce que tu l'as supprimée sur l'ordinateur), on la garde 30 jours dans une corbeille du téléphone, que tu vois et d'où tu peux la remettre depuis Réglages › Mémoire, comme sur l'ordinateur ? Les sessions que tu supprimes toi-même sur le téléphone ne changent pas. **Par défaut : oui.** Non : elle est mise de côté dans un dossier du téléphone, invisible dans Tracker, comme aujourd'hui par le câble.
2. Le réglage du pare-feu vaut aussi pour les réseaux que Windows dit « publics » (sans cela, le partage de connexion ne marche pas), limité à Tracker, à ses ports et au réseau local. **Par défaut : oui** (déjà ta réponse pour Gtracker).
3. Le calcul du code de liaison est un seul fichier partagé entre le programme Windows et le téléphone. Il faut pour cela une exception de plus dans la règle d'architecture qui « ne doit que diminuer ». **Par défaut : on accepte cette exception**, plutôt que de garder deux copies du même calcul.

---

## Estimation honnête

**Prouvé dans Gtracker sur de vrais appareils** (HISTORIQUE de Gtracker, points 456, 462, 464, 470, 474) :
- liaison et première lecture par le Wi-Fi (essais 330, 332) ;
- synchronisation dans les deux sens par le Wi-Fi (334, 335) ;
- pare-feu vu et autorisé sur le partage de connexion du PC (343, puis 352 au nom du programme) ;
- appairage SPAKE2, nouveau téléphone puis synchronisation, « ça a marché nickel » (358, 359).
- Tests nombreux, dont 21 essais JUnit sous Robolectric du côté téléphone. Banc : 516 contrôles du sans-fil, 849 de « Synchroniser » par le Wi-Fi.

**Fragile ou non prouvé dans Gtracker** :
- un téléphone qui ne se reliait plus seul (491, jamais reproduit, cause inconnue) ;
- une « minute d'attente » avant de pouvoir synchroniser (essai 334, cause non établie) ;
- liaison coupée dès que l'application quitte l'écran : voulu, mais l'utilisateur doit garder Tracker affiché ;
- fournisseur de stockage sans renommage : fichier possiblement absent ou tronqué ;
- pare-feu tiers invisible ;
- un appareil qui falsifie quatre adresses peut empêcher la découverte (l'adresse tapée reste) ;
- `ACCESS_LOCAL_NETWORK` non éprouvé.

**Neuf ici, donc non prouvé par Gtracker** : `listerTout`, `deplacer` et la corbeille du téléphone, la garde des trois services, le découpage de `MemoryFolderPlugin` dans Tracker, les nouveaux ports et la nouvelle signature.

**Ce que cela change à l'ordre.**
- Le protocole et le Java (250-1, 250-3) portent le plus de neuf : ils passent tôt, chacun prouvé par ses tests avant que la page ne s'y branche.
- La corbeille du téléphone (dans 250-4) attend la réponse à la question 1 ; le reste de 250-4 n'en dépend pas.
- Les essais au téléphone se font en un paquet, à la fin de 250-6, avec l'APK de 250-3 et 250-4.
- Le 491 et la « minute d'attente » sont à guetter dans `journal.txt` (lot 242) pendant ces essais.

## Non vérifié par ce plan

- Lu par structure seulement (signatures, en-têtes, passages ciblés) : `bureau/sansFil.ts`, `ComputerLinkPlugin.java`, `ComputerLinkProtocol.java` ; `ComputerLinkCommands.java`, `MemoryTree.java` et `MemoryWriter.java` par leurs méthodes. Les agents `lot` les liront en entier.
- Non relu : le détail de `fauxTelephone.ts`, `exe-sansfil.mjs`, `WirelessPhoneCard.tsx`, `ComputerLinkCard.tsx`, ni la forme exacte de `phoneSync.ts` après le lot 242, qui n'est pas encore fait.
- Non éprouvé : `DocumentsContract.moveDocument` sur le fournisseur du Xiaomi, la diffusion UDP sur le partage de connexion du téléphone, `safeStorage` asynchrone sur Electron 45.3.4.
