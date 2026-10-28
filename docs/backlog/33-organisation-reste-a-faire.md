# 33 · Organisation du reste à faire : `docs/BACKLOG.md`

Brief du lot 33, écrit le 28/10/2026 par l'orchestrateur d'après le plan `~/.claude/plans/j-ai-un-probleme-et-encapsulated-lecun.md` (diagnostic, méthode, sources). Modèle | Réflexion : Opus | high. Doc et outillage seulement : **aucun fichier de `src/` ni d'`android/`**, version inchangée. Pas de commit, pas de `package.json` (l'orchestrateur ajoute lui-même le script npm).

## Pourquoi

Le « pas encore fait » vit dans huit endroits (A-FAIRE, file des lots, ESSAIS, §9 et §11 d'ETAT, mémoire, doc web, briefs, HISTORIQUE), plusieurs sont déjà faux, un même sujet existe en quatre exemplaires, la priorité 1 à 5 n'est jamais confirmée, et rien ne montre à l'utilisateur ce qui l'attend. Cible : **un seul fichier `docs/BACKLOG.md`**, tenu par Claude, quatre zones, l'ordre pour priorité, les essais sous leur lot ; l'utilisateur garde trois gestes (noter une idée, dire « ok sauf », une revue de 15 min par semaine) et n'ouvre jamais le fichier. Contrainte de l'utilisateur : **simple pour un néophyte** : vocabulaire courant, pas de jargon (ni WIP, ni appétit, ni kanban, ni backlog dans ce qu'il lit), dix lignes de compte rendu, une seule salve de questions.

## Étape 1 : `docs/BACKLOG.md`

### Forme

En tête, les règles en dix lignes au plus (pour Claude) :
- une ligne par élément, numéro unique (la suite des lots : le prochain est 34), type en étiquette `[bogue]`, `[idée]`, `[dette]` ou `[outil]`, date d'entrée, taille **petit** (un lot Sonnet ou Opus, une session) ou **gros** (plusieurs lots, Fable, ou des données réelles), modèle / effort, « dépend de », et le chemin du détail s'il existe ;
- quatre zones, un élément n'est que dans une : **Maintenant** (en cours ou à valider ; **3 lots avec essais au téléphone au plus** ; un lot sans essai, validé sur lecture, ne compte pas), **Ensuite** (prêts, liste numérotée, **l'ordre est la priorité**, 7 au plus), **Ça attend une occasion** (groupé par condition écrite ; ne compte dans aucune limite), **Plus tard** (daté, une phrase avec le résultat attendu ; proposé à l'abandon à la revue après 90 jours) ;
- une section **Questions** (5 au plus), chaque question avec sa réponse par défaut proposée par Claude et sa date ; sans réponse après 4 semaines, Claude propose à la revue de trancher par défaut ; une question répondue disparaît (réponse dans DECISIONS ou dans l'élément) ;
- règle de rangement à la mise au propre (posée en clair à l'utilisateur) : un chiffre faux ou un usage cassé → tête d'Ensuite ; « je m'en servirais à ma prochaine sortie ? » oui → Ensuite, non → Plus tard ; petit et utile passe avant gros et utile ;
- les essais au téléphone sont des sous-lignes de leur lot dans Maintenant (`  - essai N : quoi → attendu`), numéros qui se suivent (le prochain est 64), jamais réutilisés ; un essai raté devient un `[bogue]` en tête d'Ensuite ; les essais de terrain vont dans « Ça attend une occasion » ;
- fait = ligne supprimée après la passe `doc` (git et HISTORIQUE gardent la trace) ; pas d'archives dans ce fichier ;
- ETAT §9 et §11 gardent les **limites connues** (faits sur le code) ; ce fichier garde les **intentions**, en citant le § ;
- `node outils/backlog.mjs` vérifie la forme et imprime le tableau de bord ; aucun résumé « à la main » ne le remplace.

Titres des zones, exactement : `## Maintenant`, `## Ensuite`, `## Ça attend une occasion`, `## Plus tard`, `## Questions`. Ligne d'élément : `- N · [type] Titre · noté jj/mm · petit|gros · Modèle/effort · état · dépend de : … · détail : chemin` (les champs sans objet sont omis, l'ordre est gardé). Dans Ensuite, liste numérotée `1.` au lieu de `-`. Sous Maintenant, la première ligne dit l'APK : `APK 0.3.95 installée le 28/10 (versionCode 3095).`

### Contenu, élément par élément (classement tranché par l'orchestrateur)

Maintenant (lots « à valider » du paquet 9, états et commits repris de `docs/FILE-DES-LOTS.md` lignes 23, 24, 25, 32) :
- 32 `[idée]` icône « Enregistrer » · à valider · 0602700, 0.3.95 ; sous-ligne essai 63 recopiée de `docs/ESSAIS.md` (texte et attendu).
- 23 `[dette]` petites dettes · à valider sur lecture (facultatif : allure « /NM » d'une activité en NM) · 12e1191, 0.3.94.
- 24 `[outil]` banc remis à jour · à valider sur lecture · e374d64 ; garder la remarque de la file sur `allure-session.mjs`.
- 25 `[outil]` outillage Q13 · à valider sur lecture · b286ecf ; garder « hook à éprouver dans une session neuve ».
- 33 `[outil]` ce lot · en cours · détail : `docs/backlog/33-organisation-reste-a-faire.md`.

Ensuite, dans cet ordre (petit et utile d'abord, puis gros) :
1. 31 `[dette]` dépendances TypeScript 7, `@types/node` 26, `npm audit fix --force` sur `uuid` (point 180) · petit · Opus/medium · APK à reconstruire.
2. 29 `[idée]` tests guidés : VMA par demi-Cooper et VAMeval (Q30 : les deux), bips de palier, protocole des zones, FC repos rangée dans les sessions sans position · gros · Opus/high · dépend de : maquette si l'écran des tests change · détail : `docs/backlog/29-tests-guides-vma.md` (y verser la fiche 14 d'A-FAIRE entière, avec « Tel que noté », réponses datées, et la ligne « plus tard : VMA, protocole des zones » du §11 Entraînement).
3. 30 `[dette]` noyau voile : détection une seule fois puis classement par candidat de vent (`observeTurns` fusionné), confiance du vent rabattue sur couverture polaire maigre, bruit indépendant rééprouvé à 5 Hz · gros · Fable/xhigh · seul dans sa session, relevé du vent du banc avant et après · détail : `docs/backlog/30-noyau-voile.md` (y verser, depuis le §11 d'ETAT, les paragraphes « Coût du vent à 5 Hz », « 5 Hz bruité », « Vent sur trace lente et peu échantillonnée » tels quels : ils sont le cahier du lot).

Ça attend une occasion (une sous-liste par condition) :
- **Une course avec la ceinture cardio** : essai 1 (ceinture, écran éteint, texte d'ESSAIS), essai 2 (test de FC max, débloque les zones), et le lot 26 `[idée]` cadence à pied (relecture des `.imu` des 21, 24 et 25/10, seuils, `keepCapture` à false, unité devinée confirmée · gros · Fable/high · fichiers à copier du téléphone sur le PC, essai 4).
- **Une sortie surf** : essai 46 (texte d'ESSAIS, plus les seuils du §11 « Surf » : vague 9 km/h, attente, vol 10, vague en foil 18, retour au pic ; pumping `PUMP_DETECTION` à régler sur un premier vol réel, `liftoffCalmG` 0,08 g contre 0,03 à 0,05 g de rugosité à l'arrêt).
- **Une sortie wing capturée entière, Pumping coché** : lot 27 `[idée]` pumping en wing (seuils de `SAILING_PUMP_DETECTION`, faux coups autour des sauts, faux sauts en wing · gros · Fable/high), essai 48 (sauts notés à part).
- **Une sortie VTT ou course avec des sauts** : essai 64 (nouveau) : seuils de détection des sauts réglés sur le wingfoil à valider à terre, la foulée ne doit pas passer pour un saut (§11 « Sauts à terre », point 96).
- **Une session de planche, de kite ou de bateau** : essai 65 (nouveau) : valider les seuils par support, et un enregistrement dense sur une planche rapide (§11 « Valider les seuils par support »).
- **Quelques vraies semaines** : essai 47 (racine du Profil : recul, fleur, feuilles tombées ; §11 « Racine du Profil »).
- **Une réponse de vous** : lot 28 `[idée]` cardio (FC moyenne dans Général, bip en sortie de zone, énergie par la FC en voile et surf, splits par kilomètre ; zones communes gardées, Q28 · gros · Opus/high) ; bloqué par Q29.

Plus tard (daté ; renuméroter les fiches dans la suite des lots, en citant l'ancien numéro) :
- 34 `[idée]` mode daltonien (ex-fiche 4 ; noté avant le 25/10 ; voulu « plus tard » ; §11 « Mode daltonien », point 90) · gros.
- 35 `[idée]` montre connectée Android (ex-fiche 5 ; 22/10) · gros · détail : `docs/backlog/35-montre-connectee.md` avec la fiche entière (la réponse de Claude du 27/10 est utile) ; reste : quelle montre.
- 36 `[idée]` autres capteurs Bluetooth, puissance, cadence et vitesse à vélo (ex-fiche 17 ; point 118) · gros · dort tant que l'utilisateur n'a pas de capteur.
- 37 `[dette]` résumés de la liste non recalculés quand le seuil d'une activité ou l'allure imposée change, et rien ne le signale (§9) · petit.
- 38 `[dette]` brouillon de session : retour arrière du navigateur non intercepté (§9) · petit.
- 39 `[idée]` comparer les deux énergies (course k de l'air 0,0065 ; Crr par revêtement) à une montre ou à Strava (§11 « Énergie », points 71, 72, 88) · petit · demande une sortie avec une montre.
- 40 `[idée]` surf : virages par le gyroscope (case « Mesurer les virages », élagage du `.imu` autour des vagues, rotation autour de la verticale ; plan `~/.claude/plans/on-vas-reprendre-et-snug-stonebraker.md`) (§11 « Surf », point 110) · gros.
- 41 `[idée]` appréciations sans emoji (`RATINGS` de `sailing/sessionNotes.ts`, icônes de `components/icons.tsx`), si l'utilisateur le veut (§11, point 114) · petit.
- 42 `[dette]` types de voie : dire la différence entre vélo et pied (types permis à vélo montrés à demi cochés), non tranché (§11, point 80) · petit.
- 43 `[dette]` virage vu en un seul pas : choisir entre perte de vitesse, déplacement latéral, ou afficher que le fichier ne le dit pas ; à valider avec le souvenir de l'utilisateur (§11, point 27) · gros.
- 44 `[dette]` creux d'une manœuvre lu sur la vitesse non filtrée (le filtre médian de 3 s remonte les creux en V, conservation surestimée de 0,05 à 0,1), décision à part (§11) · petit.

Questions :
- Q29 · lot 28 · « FC moyenne dans Général, bip en sortie de zone, énergie par la FC en voile et surf, splits par kilomètre : lesquels ? » · par défaut : FC moyenne dans Général d'abord · posée le 28/10 · tranchée par défaut à la revue du 25/11 sans réponse.

Rien d'autre : tout ce qui n'est pas listé ici est **fait, abandonné ou limite connue** (voir le triage ci-dessous). Si tu trouves dans les huit sources un élément vivant qui n'est pas dans cette liste, ajoute-le en Plus tard avec son origine et signale-le dans ton rapport.

### Triage des sources (ce qui ne passe pas dans BACKLOG)

- `docs/A-FAIRE.md` : fiche 26 faite au lot 32 (déjà dans Maintenant) ; fiche 14 → élément 29 ; « Archives » entières → archive.
- `docs/FILE-DES-LOTS.md` : lots 1 à 22 validés (rien) ; Q1 à Q28 et Q30 répondues (rien, DECISIONS et HISTORIQUE les portent) ; journal des paquets (rien) ; les deux paragraphes finaux (« Lot D du 26/10 : `maneuvers.ts`… », « Piège du poste ») → le premier va au §11 d'ETAT, dans « Manœuvres », comme fait sur le code ; le second est déjà dans `/clore` et la mémoire.
- `docs/ESSAIS.md` : « Faits » → archive ; essais 3 (fait), 5 (couvert par 62) ; règle d'en-tête → règles de BACKLOG.
- `docs/ETAT_DU_PROJET.md` §9 : retirer « Allure de la course en min/km » (lot 23), « Doublon possible » (lot 23), « Deux défauts de gpxParser » (lot 23) ; garder en limites connues : fiche réécrite à l'ouverture, écriture en place de repli, Recharts `any`, « détection écrite deux fois » (renvoie à BACKLOG 30) ; « Résumés » et « Brouillon » → BACKLOG 37, 38, chacun remplacé par une ligne « → reste à faire n° N ».
- §11 : retitrer « Limites connues » ; retirer « Pistes et sentiers … non pavé » (Q14, lot 21) ; cadence → 26 ; cardio et splits → 28 ; capteurs → 36 ; sauts à terre → essai 64 ; pumping en voile → 27 ; surf seuils et pumping → essai 46, virages → 40 ; relecture du 15/10 → 41 ; racine → essai 47 ; Entraînement (FC max → essai 2 ; FC repos et VMA → 29) ; daltonien → 34 ; valider les seuils par support → essai 65 ; coût du vent à 5 Hz, 5 Hz bruité, vent sur trace lente → 30 (leur texte technique part dans `docs/backlog/30-noyau-voile.md`, le § garde une ligne de fait et le renvoi) ; virage en un seul pas → 43 (le § garde le fait, pas les pistes) ; filtre médian → 44 ; énergie → 39 (le § garde « ordres de grandeur, jamais comparés ») ; types de voie : coût 3 « pour voir à l'usage » reste une limite, la différence vélo/pied → 42. Restent dans le § comme faits : changement d'amures exigé (50°), orientation fragile, relance après changement d'allure, le paragraphe « Lot D du 26/10 » déplacé depuis la file. Chaque élément déplacé laisse « → reste à faire n° N » ou « → essai N ».
- Mémoire `point-de-reprise-cible-mobile.md` : supprimer les paragraphes « Bug mis de côté » (fait au lot 1, point 160), « En suspens » (logo abandonné, non pavé fait, daltonien → 34, points 62 à 64 : limite connue à mettre au §11 si elle n'y est pas), « Clos, à ne plus proposer » (garder la phrase dans HISTORIQUE si elle n'y est pas, sinon rien), « Mis de côté le 30/09 » (→ 30 ; le défaut PC non reproduit → une ligne au §11) ; « Terrain reporté » : garder la phrase sur le test de 2 h ; « Rythme » et « How to apply » : la file, ESSAIS et A-FAIRE remplacés par `docs/BACKLOG.md` ; `MEMORY.md` ligne 1 : « l'état des lots est dans docs/BACKLOG.md ».
- Doc web « Reste à faire Tracker » : rien à faire ici, l'orchestrateur y met une ligne « remplacé par docs/BACKLOG.md ».
- `~/.claude/plans/demandes-*` : rien, archives ; les briefs des lots 23, 24, 25, 32 restent cités à leur chemin actuel. `~/.claude/plans/FILE-DES-LOTS.md` (souche) : texte remplacé par « remplacée par `docs/BACKLOG.md` depuis le lot 33 ».

### Archivage

Copier `docs/A-FAIRE.md`, `docs/ESSAIS.md` et `docs/FILE-DES-LOTS.md` tels quels dans `~/.claude/plans/archives/` sous `A-FAIRE-2810.md`, `ESSAIS-2810.md`, `FILE-DES-LOTS-2810.md`, puis `git rm` les trois du dépôt. `docs/backlog/` est le dossier des détails (ce brief y est déjà).

## Étape 2 : commandes, règles, cartes

Réécrire les quatre commandes de `.claude/skills/` en gardant leur ton, leur longueur et tout ce qui ne concerne pas les fichiers remplacés (modèle, git, APK, pièges) :
- `/todo` : trois formes. **Sans argument = la revue de la semaine** : lance `node outils/backlog.mjs`, affiche sa sortie telle quelle (c'est le tableau de bord, en français courant : Vous / Claude / Ça attend une occasion / Plus tard), puis **une seule** `AskUserQuestion` de 4 questions au plus, les plus utiles d'abord, parmi : une condition d'occasion remplie ? monter tel élément d'Ensuite en tête ? garder ou lâcher telle idée de plus de 90 jours ? trancher telle question par défaut ? ; applique les réponses dans BACKLOG.md ; pas de commit (`/clore`). **Des notes en vrac** : mise au propre comme aujourd'hui (une ligne par idée, « tel que noté » gardé dans un détail `docs/backlog/N-titre.md` seulement si la ligne ne suffit pas ; doublon, contradiction avec DECISIONS, déjà fait : règles gardées), puis **la règle de rangement posée en clair** dans une seule `AskUserQuestion` (bogue qui casse ou fausse ? vous en servirez-vous à votre prochaine sortie ? petit ou gros, proposé par Claude) à la place de la priorité 1 à 5 ; la ligne atterrit en Ensuite (à la place proposée) ou en Plus tard. **`réponse N : …` ou `Q n : …`** : comme aujourd'hui, la réponse va dans l'élément ou clôt la question.
- `/reprise` : lit `docs/BACKLOG.md` et lance `node outils/backlog.mjs` à la place de la file, d'ESSAIS et d'A-FAIRE ; le compte rendu de dix lignes reprend les quatre blocs du tableau de bord ; le reste (git, modèle, proposition) inchangé.
- `/chaine` : prend le premier d'**Ensuite** dont « dépend de » est levé ; **refuse de lancer un lot si Maintenant compte déjà 3 lots avec essais au téléphone** (« validez d'abord », propose `/clore`) ; un lot lancé passe en Maintenant avec son état ; FAIT : ligne mise à jour (état, commit, version), essais en sous-lignes ; BLOQUÉ majeur : la question va dans « Questions » avec la réponse par défaut ; les exclusions de `git status` et du stash visent `docs/BACKLOG.md` et `docs/backlog/` au lieu de `docs/FILE-DES-LOTS.md` ; l'arrêt note l'APK dans la première ligne de Maintenant ; plus de journal des paquets.
- `/clore` : « ok sauf N » agit sur les sous-lignes d'essai ; un lot dont tous les essais sont ok passe « validé », passe `doc`, puis **sa ligne est supprimée** ; un essai raté → `[bogue]` en tête d'Ensuite avec la remarque ; les idées lancées en passant → une ligne en Plus tard ; les questions de la session → « Questions » ; plus de journal ; la mémoire n'est touchée que pour « Rythme ».
- `CLAUDE.md` : dans la liste des fichiers, remplacer les lignes A-FAIRE et ESSAIS par une ligne `docs/BACKLOG.md` (« le seul reste à faire : lots, idées, dette, essais, questions ; `docs/backlog/` pour les détails ; `node outils/backlog.mjs` pour le tableau de bord ») ; dans Environnement, la file des lots et la phrase « Ils vont dans docs/ESSAIS.md » repointées ; ajouter dans « Décisions transverses » une puce de six lignes au plus : quatre zones, 3 lots avec essais au plus, l'ordre pour priorité, règle de rangement en trois questions, essais sous leur lot, fait = supprimé, revue hebdomadaire par `/todo` sans argument, et « simple pour un néophyte : ce que l'utilisateur lit ne porte aucun jargon ».
- `docs/MODELES.md` lignes 57 et 62, `docs/INVENTAIRE.md` lignes 260 et 261 (+ `docs/backlog/`, `outils/backlog.mjs`) : repointés.

## Étape 3 : `outils/backlog.mjs`

Node ESM sans dépendance, lancé depuis la racine : lit `docs/BACKLOG.md`, découpe par les cinq titres de zone, reconnaît les lignes d'élément (regex sur `N · [type] …`), les sous-lignes d'essai, les conditions d'occasion (lignes en gras), les questions (`Qn ·`). Imprime, en français courant et en vingt lignes au plus :
- **Vous** : les essais à faire (numéro, lot, APK), les questions ouvertes (avec « sinon Claude fera : … »), les lots à valider sur lecture ;
- **Claude** : les éléments d'Ensuite dans l'ordre, avec taille et modèle ; ou « rien avant validation » si la limite est atteinte ;
- **Ça attend une occasion** : chaque condition avec ses numéros ;
- **Plus tard** : le nombre, et ceux de plus de 90 jours nommés ;
puis les **alertes** : forme d'une ligne invalide (fichier et ligne), Maintenant > 3 lots avec essais, Ensuite > 7, questions > 5 ou > 4 semaines, numéro en double, essai en double. Code de sortie 1 s'il y a une erreur de forme, 0 sinon (une alerte de limite n'est pas une erreur). Dates au format `jj/mm` ou `jj/mm/aaaa` ; sans année, l'année courante, et une date « dans le futur » est prise pour l'année précédente.

Test : regarde comment `vitest.config` ou `vite.config` choisit les fichiers de test ; si `outils/` n'est pas inclus, ajoute `outils/**/*.test.{ts,mjs}` à l'inclusion sans rien changer d'autre. Écris `outils/backlog.test.mjs` (ou `.ts` si la config l'impose) sur un fichier synthétique en chaîne : les quatre blocs, chaque alerte, une ligne invalide, une date sans année. Le script lit le fichier par un chemin donné en argument (défaut `docs/BACKLOG.md`) pour être testable.

## Vérification (par toi, courte) et rapport

- `node outils/backlog.mjs` sur le fichier migré : code 0, aucune erreur de forme ; l'alerte « 4 lots à valider » n'apparaît pas (les lots sur lecture ne comptent pas) ; sortie en vingt lignes, sans jargon.
- `grep -rn "A-FAIRE\|ESSAIS\.md\|FILE-DES-LOTS" CLAUDE.md docs .claude ~/.claude/projects/c--Users-segne-tracker/memory` : seules restent les mentions historiques (HISTORIQUE, archives citées comme telles).
- `npx vitest run outils` et `npm run lint` passent.
- Rapport FAIT en 40 lignes au plus : la table de correspondance (chaque source → élément N, essai N, limite au §, ou fait/abandonné), les fichiers créés, supprimés et réécrits, la sortie du script, et tout élément trouvé hors de la liste du brief.
