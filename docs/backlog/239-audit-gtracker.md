# Audit de Gtracker du 26/11 : ce qui reste à rapatrier dans Tracker

Demande de l'utilisateur du 26/11 : la vente de Gtracker a échoué, il veut « fusionner les deux et prendre le meilleur de chaque », par un audit en profondeur, le tri du 25/11 ayant été fait vite. Consigne : « globalement tout ce qui a été fait sur les activités de Gtracker sont des améliorations de Tracker ».

Cette fiche est la synthèse et la carte des lots 239 à 254. Le détail (un bloc par constat, preuves `fichier:ligne` des deux côtés, liste complète des fichiers regardés) est dans dix rapports hors dépôt, `~/.claude/plans/audit-gtracker-2611/` : `voile.md` (V), `surf.md` (S), `noyau.md` (C), `enregistrement.md` (E), `programme-pc.md` (P), `da.md` (D), `analyses-ecran.md` (N), `memoire.md` (B), `pages.md` (G), `atelier.md` (A), `montre.md` (M, I), avec la méthode commune dans `METHODE.md`. Un agent `lot` ou `Plan` lit le rapport de son domaine par son chemin absolu, aux constats cités.

## Méthode et limites

- Dix agents en lecture seule (quatre Opus : voile, noyau, enregistrement, programme Windows ; six Sonnet), chacun sur un domaine, comparaison à trois : ce que Gtracker a changé depuis la séparation (`2eed9e7`), ce que Tracker a changé (`deee974`), l'état actuel des deux.
- Rien n'a été lancé (ni test, ni banc, ni compilation) ni vu à l'écran : tout vient de la lecture du code, des tests et des documents. Les mesures citées sont celles des fiches de Gtracker.
- Vérifié par l'orchestrateur dans le code : `isTrackPosition` absent de Tracker, aucun format `gtracker-*` lu par Tracker, `git clean` et `git stash` dans `/chaine`, envoi par défaut dans `/clore`, position à 6 décimales dans `planning/placeQuery.ts`. Le reste est à revérifier par le plan de chaque lot.
- Non reproduit : « trois points à (0, 0) donnent un virement fantôme et décalent le vent de 4° » (dit par l'agent de la voile d'après un test de Gtracker).

## Ce que l'audit conclut

1. **Les calculs** : Gtracker n'a changé aucun seuil ni aucune formule, ni en voile, ni en surf, ni dans le noyau ; les valeurs de `SPORT_PROFILES` sont identiques. Le lot 233 a repris tout le surf. Les seuls écarts de chiffres : le point (0, 0) et les positions hors bornes gardés par les lecteurs de Tracker (C1), deux écarts de cap dans le direct de la voile (C6), la trace en 64 nuances (C, question tranchée par défaut plus bas).
2. **Le GPS** : le service de position de Gtracker est déjà dans Tracker, identique, lot 232 repris en entier ; Tracker fait mieux sur trois points (garde ancrée sur une position précise, relance après un arrêt par la garde, seuils dans le profil).
3. **Le programme Windows** : Tracker a le moteur et le câble, plus prudents que ceux de Gtracker (mise de côté, garde d'enregistrement, aperçu à blanc, relecture). Ne pas copier `bureau/` par-dessus : ajouter pièce par pièce le parcours en un geste, la dernière saisie qui gagne, l'installeur, puis le sans-fil.
4. **L'apparence** : celle de Gtracker est celle du site GONG (Inter, rayons 0, aucune couleur de famille) et ne se reprend pas. Deux pièces en sont indépendantes : le fond (quatre images WebP, couche `.shell-field`) et le coup de pinceau à la couleur de l'activité.
5. **Le plus gros manque** : Tracker ne relit pas les sessions écrites par Gtracker (formats rebaptisés), alors que Gtracker relit celles de Tracker.
6. **La montre** : autonome, pas finie, jamais essayée dehors ; la liaison avec le téléphone n'existe nulle part.

## Les lots

| Lot | Titre | Constats | Taille |
|---|---|---|---|
| 239 | Fichiers lus sans piège | C1, C2, C3, E1, E2, B12, A24 (part fichiers) | moyen |
| 240 | Matériel rapproché par son nom | B4, N2, G1 | petit à moyen |
| 241 | Sessions de Gtracker retrouvées | B1, B2, B3 | moyen, données réelles |
| 242 | « Synchroniser » en un geste, la dernière saisie gagne | P1 à P8, P10, B19, A24 (réglages d'une version plus récente) | gros |
| 243 | Fond de voile et de surf, tours de cadre colorés | D1, D2, D3 ; restes D4 à D8 | planche, puis moyen à gros |
| 244 | Atelier plus sûr et plus rapide | A1 à A3, A6, A12, A13, A18, questions A-Q1 et A-Q3 | moyen |
| 245 | Analyses et fluidité, suite | N1, N4, N7a, N7b, N10, C4, C5, B13, B14, tiret long (N-Q2) | moyen |
| 246 | Lieux, vie privée, corbeille, activité disparue | B6, B7, B9, G3 à G6, « Supprimer » (B-Q1, G23) | moyen |
| 247 | Direct de la voile et fichier de la montre | C6, C8, M1, M4, I1, S2 | moyen |
| 248 | Enregistrement : suites du 232, Android au propre | E3, E4, E5, E9, E10 | petit |
| 249 | Programme Windows solide, installeur | P11 à P15, A24 (fenêtre blanche) | moyen |
| 250 | Synchronisation sans câble | P16 à P20 | gros, six sous-lots et une APK |
| 251 | Réglages, Statistiques et Profil | G7, G8, G9, G10, G13, G15, G17 à G20, G22, G24, B16 | moyen |
| 252 | Remise à zéro | B8, G2 | gros |
| 253 | Voile : nettoyage sans effet sur les chiffres | V1 à V6 | moyen |
| 254 | Montre Garmin : déménagement dans Tracker | M2, M3, M5 à M9, M11 | gros |

Lot E du programme (banc, P21) : avec le lot 244 (A6 est le même défaut). Matériel des deux appareils (B5, G21, P9) : après 240 et 242, à ranger quand ils seront faits.

### Pièges relevés, à lire avant le plan du lot

- **239** : `SUMMARY_CALC_VERSION` passe à 26 (Tracker est à 25, Gtracker à 23) ; vaut pour toutes les familles et pour les itinéraires importés ; plafonds de Gtracker : trois pour le GPX, 120 000 points pour un FIT, 30 Mo à l'import ; conversion du FIT encore sur l'écran dans Tracker (`hooks/sessionLibrary/importer.ts`) ; le témoin de lecture des fichiers reçus a une part Java.
- **240** : `SessionNotesPanel` choisit par identifiant seul, `stats.ts` rapproche par nom sans tolérer virgule ni espaces doublés ; la pièce de Gtracker est `library/gearMatch.ts` (lots 477 et 492), mention « (hors liste) ».
- **241** : neuf étapes listées dans `memoire.md` (fiche, lieu converti car `place` n'a pas la même forme, en-tête des capteurs `.imu`, paquet GPX, activités, `editedAt`) ; 21 vraies sessions dans `D:\gong tracker\Gtracker tel\` (dossier à la forme d'une mémoire d'ordinateur) : ne pas y toucher sans l'accord de l'utilisateur, aucun GPX réel dans le dépôt.
- **242** : le moteur de Tracker sait déjà « tout garder » (`keepRefused`), seul le parcours manque ; la question Q70 est dedans ; `editedAt` vient d'une décision de l'utilisateur du 23/11 dans Gtracker ; le téléphone se remet à jour seul par un marqueur `synchro` (P4).
- **243** : refaire les quatre images dans le gris bleuté de Tracker (`outils/champ/rendre.mjs` de Gtracker) ; environ 1 Mo d'APK ; le poser sur `/voile`, `/voile/analyse`, `/surf`, `/surf/analyse` seulement ; cinq formes de cadre déjà refusées par l'utilisateur dans Gtracker (liste dans `da.md`, ne pas les reproposer) ; bordure de Tracker dans `CARD_STYLE` (`styles.ts`, une quarantaine d'emplois), `.ui-card`, `.lib-row` ; point à lever sur capture : dans Gtracker les panneaux d'analyse sont opaques, le fond ne s'y voit que dans les écarts.
- **244** : A13 d'abord (`/chaine` ne doit plus faire ni `git clean` ni `git stash` après un échec : cela défait le travail d'une autre session) ; garde de l'agent `lot` de Gtracker : 420 lignes, 113 tests, à adapter ; `ignorerWorkers` dans `outils/banc/lib/cdp.mjs` ; tests de la bibliothèque sans horloge réelle (gain à mesurer dans Tracker) ; `bureau/package-lock.json` sans empreinte pour 53 paquets ; copies `.claude/worktrees/planche-234` et `planche-236` encore sur le disque.
- **245** : `components/panelPacking.ts` (lot 455 de Gtracker) ; fusion à la main de `trackWorkerClient.ts`, où Tracker a divergé (`traceId`) ; délai de 60 s de la file de fond ; `platform/storage.ts` ne réécrit pas un texte identique.
- **246** : garder le modèle `place` de Tracker (lot 215, compatible course et vélo) et y ajouter `lieux.json`, le renommage propagé, « Départ → Arrivée » ; position arrondie à 100 m et case « Chercher le lieu des sessions ».
- **247** : en reprenant `kinematics.ts` de Gtracker, remettre la cadence, que Gtracker a retirée ; les deux écarts ne touchent que les bords du direct, jamais une session rangée ; les champs `activite`, `vent`, `vagues` de la montre sont des champs développeur du message `session`, que les deux lecteurs sautent.
- **249** : l'installeur contredit le §8 de `DECISIONS.md` (« ni installeur ni signature ») : retenu par défaut, sans signature, à confirmer.
- **250** : la mise de côté hors de la mémoire est impossible par le SAF (corbeille du téléphone dans la mémoire, ou effacement accepté) ; ports 48217 et 48218 et signature « GTRK » à changer pour que les deux programmes cohabitent ; identités SPAKE2 et vecteurs à refaire ; garde d'enregistrement Android à étendre aux trois services de Tracker.
- **252** : demande d'abord une table centrale des clés de l'appareil (une quarantaine, éparses).
- **253** : conflits à fusionner à la main dans `sailingStats.ts` (lot 208), `sailingSession.test.ts` et `sailingAnalytics.test.ts` (lot 235) ; le script du banc `manoeuvres-diagnostic.mjs` suit ; deux défauts latents des deux côtés : `observeTurns` sans les surcharges de la détection, `calculateVmgStats` muet avec une fenêtre de 0 s.
- **254** : condition de départ : arbre de `montre/` commité, un essai dehors fait, voie de liaison choisie ; seule dépendance vers `src/` : `components/logos/logoPaths.ts`, que Tracker n'a pas (`activityArt.tsx`) ; le programme Windows devra lire une montre en MTP, sans lettre de lecteur.

## Tranché par défaut (à dire si l'utilisateur veut l'inverse)

Principe : une décision que l'utilisateur a prise dans Gtracker après la séparation est reprise, sauf si Tracker a décidé autrement depuis.

- Repris : « Supprimer » à la place de « Jeter » ; tiret long « — » partout pour une valeur absente ; pastille « avancé » en trait plein ; la dernière saisie gagne à la synchronisation ; parcours de « Synchroniser » en un geste, avec les protections de Tracker ; installeur sans signature ; `/clore` qui n'envoie que sur « avec envoi » ; trace en 64 nuances (invisible à l'œil, le dégradé reste continu) ; règle 3 réécrite (une constante d'algorithme commune à tous les supports est une constante nommée de son module) ; fenêtre de sélection des Statistiques ; import des sessions de Gtracker gardé dans l'application.
- Gardé de Tracker : la carte « Session terminée » et l'ouverture directe de l'onglet matériel (Q72) ; les cadres serrés au téléphone droit seulement ; la navigation du lot 238 (pas de page « Sessions » unique) ; le modèle des lieux ; le fond sur les seules pages de voile et de surf ; cadres pleins sur ces pages.
- Pas repris : la DA de GONG, la traduction, la livraison et son vocabulaire, la fenêtre « Avant de partir », `boot.tsx`, le retrait du niveau sportif, la planification réduite, le découpage de l'enregistreur en couches (E6), l'analyse du surf en arrière-plan (0,21 s à 2 h, mesuré au lot 235).

## Réponses de l'utilisateur du 26/11

- Profil : la racine reste, pas de banc de poissons (Q76, lot 251).
- Les vraies sessions de `D:\gong tracker\Gtracker tel\` peuvent servir à vérifier l'import du lot 241, copiées hors du dépôt ; l'utilisateur pense avoir les mêmes dans Tracker.
- Paddle et Pumping ne s'ajoutent pas aux activités de surf de départ (lot 247).
- « Pas d'autres modifs comme les zones de pic ? » : relu ligne à ligne par l'orchestrateur le 26/11, les huit fichiers de `src/surfing/` des deux dépôts (`git diff --no-index`, commentaires ôtés). Toute la différence est le rangement des seuils : dans le profil chez Tracker (`SurfProfile`, règle 3), en constantes nommées chez Gtracker. Même logique, mêmes valeurs (zone du pic : 15, 5, 1,5, 40, 30, 45). Vagues, départs, virages, sens des vagues, zone du pic et retour au pic sont donc bien dans Tracker depuis le lot 233. Preuve par les chiffres encore à faire : les deux analyses jouées sur les mêmes vraies sessions, avec le lot 241.

## Passe de documents en retard, à faire avec la passe `doc` des lots 232 à 236

- `DECISIONS.md` §4 (surf) : retour au pic jusqu'à l'entrée dans la zone du pic, départ orange, règle des virages, sens des vagues, zone du pic (texte de Gtracker §4 presque tel quel).
- §1 (voile) : pendant un recalcul les derniers chiffres restent affichés ; tuiles de sauts et de pumping de « général ».
- §6 : « repli sur Capawesome » et calage absent sont faux depuis le 232.
- `MISE_EN_PAGE.md` : tuile qui ouvre son onglet, onglet fermé qui efface la carte, barre « Non enregistré » dans la carte, espaces.
