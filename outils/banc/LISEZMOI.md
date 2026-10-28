# Banc de test

Scripts Node qui pilotent un Chrome sans fenêtre (ou la WebView du téléphone) par le protocole DevTools, pour éprouver l'application sans la manipuler à la main. Ils complètent les tests unitaires, qui ne couvrent ni les hooks, ni les pages, ni la mémoire (§8 de `docs/ETAT_DU_PROJET.md`). Aucune dépendance : Node 22 ou plus (`fetch` et `WebSocket` natifs).

## Mise en place

1. Un serveur, sur un port à part pour ne pas gêner celui de l'utilisateur : `npx vite --port 4191 --strictPort --host 127.0.0.1` (4190 est refusé par Chrome et Node, « bad port » ; ou le build : `npx vite preview --port 4199 --strictPort --host 127.0.0.1`). Chaque script lit `BASE` (par exemple `BASE=http://127.0.0.1:4191`).
2. Un Chrome sans fenêtre, sur un **profil neuf** (mémoire du navigateur vide) :
   `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=9400 --user-data-dir=<dossier de brouillon>/chrome-profil --window-size=1400,1000 --no-first-run about:blank`, en arrière-plan. On le ferme par `Browser.close` du protocole. Le Chrome de l'utilisateur n'est pas touché.
3. Les chemins de fichiers passés aux scripts sont au format Windows (`DOM.setFileInputFiles`). Sous Git Bash, préfixer par `MSYS_NO_PATHCONV=1`.

## Scripts

- `make-gpx.mjs <sortie> [décalage en heures]` : trace de voile synthétique à 1 Hz, environ 3 750 points. Elle comporte des bords de près et de portant, des virements et des empannages, avec un vent du nord. Le décalage produit une autre session, avec un autre instant de départ.
- `bench.mjs <port> analyse <gpx>` : rejeu du GPX à ×600, Arrêter, Analyser. Les onglets de la colonne de la carte sont forcés ouverts. Le script affiche le titre, le nombre de traits SVG (`segments`), celui des canevas de la trace colorée (`traceCanvas`, 1 par carte depuis le point 93 : la trace n'est plus en SVG), le nombre de graphes, et les erreurs de console. `DUMP=x.txt` relève le texte de la page, `SHOT=x.png` fait une capture.
- `session-save.mjs <port> <gpx>` et, sur le même profil, `session-save-resume.mjs <port>` : brouillon et « Enregistrer la session » (lot 3b). Ils éprouvent le vent, le seuil, les notes, l'avertissement en quittant, la relecture après rechargement et Annuler. Deux étapes sont périmées : l'ouverture par un clic sur `.lib-row__main`, qui n'ouvre plus l'analyse, et le champ du seuil, passé dans l'onglet réglages. Les GPX passent par `DOM.setFileInputFiles`, que le Chrome sans fenêtre peut refuser (voir `survol.mjs`). Le 09/10, une copie qui importe par la page et ouvre l'analyse par son adresse passait le reste.
- `allure-session.mjs <port> <gpx 1> <gpx 2>` : l'allure imposée propre à chaque session. Les deux GPX viennent de `make-gpx.mjs`, sans décalage puis avec 1 h de décalage. Le script vérifie le brouillon, l'écriture dans la fiche, le recalcul du résumé et la relecture. Il vérifie aussi que la seconde session n'est pas touchée et que l'ancienne allure par support est effacée.
- `rename.mjs <port> <gpx>` : renommage d'une session (lot II), depuis la bibliothèque puis depuis l'en-tête de l'analyse. Il vérifie Échap, Entrée, la fiche, la relecture après rechargement et l'effacement par un nom vide.
- `library.mjs <port> <dossier des GPX> <dossier des captures>`, puis `library2.mjs` et `library3.mjs` : la bibliothèque (lot 3a). Il faut dans le dossier `voile.gpx` (produit par `make-gpx.mjs`), `course.gpx` (une trace avec `<type>Trail Running</type>`) et `sans-type.gpx` (une trace sans `<type>`). Ces deux derniers sont à fabriquer à la main. Certaines étapes visent des champs d'avant le brouillon de session et la liste d'activités dessinée (notes du matériel, « Classer la session », seuil de Réglages) : elles ne trouvent plus rien, sans que ce soit un défaut. Le fichier de réglages de l'appareil, lui, est vérifié.
- `planning.mjs <port> <dossier des GPX> [<dossier des captures>]` : la page Itinéraires. Il faut dans le dossier `sans-heure.gpx` (une trace sans horodatage, avec altitude et un `<type>`), `route-rte.gpx` (des `<rtept>` seulement), `boucle.gpx` (une trace qui revient à quelques mètres de son départ) et `pas-un-gpx.gpx` (aucun point de trace ni de route), tous à fabriquer à la main. Le script se met en Course, onglets tous ouverts, pose des points et vérifie « Précédent » et la boucle en ligne droite, puis la ligne droite d'un seul point, allumée et éteinte dans son panneau, qui part avec lui quand on le retire. Il charge ensuite les GPX, insère un point sur la trace importée, déplace l'arrivée, inverse, range l'itinéraire et le rouvre après rechargement. Les confirmations sont acceptées et affichées.
- `activite.mjs <port> <gpx de voile> [<dossier des captures>]` : l'activité d'une session. Le GPX vient de `make-gpx.mjs`. Le script vérifie :
  - que suivre un itinéraire propose son activité (sur un profil où `planning.mjs` a rangé des itinéraires) ;
  - le passage de Voile à Course pendant un rejeu à ×10 ;
  - la carte réduite et ses grands chiffres ;
  - le rangement sous la nouvelle activité ;
  - la bascule course ↔ voile depuis l'analyse, avec confirmation quand un brouillon est ouvert.
- `balises.mjs <port> <dossier de travail> [<dossier des captures>]` : parcours de voile et bips d'approche (point 77), à 390×844, sur un profil neuf. Le script écrit lui-même son GPX dans le dossier de travail. Il vérifie :
  - le parcours sur la page Itinéraires : balises numérotées, bloc « Parcours », bips propres au parcours rangés dans la fiche, puis « Partir » ;
  - un rejeu ×1 d'un parcours de trois balises, avec le relevé des bips : la version navigateur de `platform/beeper.ts` consigne chaque son en `console.debug` (« [bips] ») ;
  - un rejeu ×10 avec les bips du parcours, « Passer » et « Bips » coupés ;
  - l'éditeur de la courbe dans Réglages : glisser, ajouter un point, vibration, « Écouter », « Par défaut ».
  
  Il dure environ 2 min 30.
- `surface.mjs <port> <dossier de travail> [<dossier des captures>]` : revêtement (point 78), sur un profil neuf, avec réseau (brouter.de et overpass-api.de). Le script écrit lui-même ses GPX. Il vérifie :
  - un itinéraire de deux points en Course : bloc « Surface » rempli par le calcul, voies rangées dans la fiche ; une fiche sans voies, rouverte, montre « Inconnu » et « Calculer », qui les rend ;
  - un GPX sans horodatage chargé en itinéraire : tout « Inconnu » ;
  - une course synthétique le long du tracé, importée puis ouverte : l'onglet « surface » fait une requête à Overpass et range les voies ; après rechargement, mêmes chiffres, sans nouvelle requête.

  Overpass peut mettre plus d'une minute : ne pas le relancer en rafale.
- `altitude.mjs <port> <dossier de travail> [<dossier des captures>]` : altitude de l'IGN (point 84), sur un profil neuf, avec réseau (data.geopf.fr). Le script écrit lui-même son GPX : une course au nord de Montpellier, altitude GPS plate et bruitée. Il vérifie :
  - l'ouverture de l'analyse : une requête à l'IGN, l'altitude rangée dans la fiche, la ligne « Source : IGN » et le dénivelé changé ; après rechargement, aucune nouvelle requête ;
  - le passage au GPS puis le retour à l'IGN dans les réglages de la session, suivis par le dénivelé de l'analyse et le D+ de la liste ;
  - un point tous les 20 m réglé dans Réglages : l'altitude est redemandée à la réouverture.
- `pentes.mjs <port> <dossier de travail> [<dossier des captures>]` : pentes sur la carte et onglet énergie (point 85), sur un profil neuf, avec réseau (data.geopf.fr, brouter.de et overpass-api.de). Le script écrit lui-même son GPX, une course au nord de Montpellier. Il vérifie :
  - « Voir sur la carte » sous le graphe d'altitude : la trace prend les couleurs de la pente, la légende de pente se pose sur la carte, puis « Masquer » rend la vitesse ;
  - la colonne Puissance du tableau des zones d'énergie, et son repli « Énergie par zone de pente », gardé après rechargement ;
  - l'exclusion de la pente et du revêtement sur la carte, si Overpass répond dans les 3 min ;
  - la même chose à 390×844 ;
  - en planification, deux points en Course, puis « Voir sur la carte » du bloc Général.
- `boucle.mjs <port> [<dossier des captures>]` : mode « Boucle » de la planification (point 87), sur un profil neuf, avec réseau (brouter.de). En Course, puis à vélo (activité Route), le script pose A, B et C au nord-est de Montpellier, boucle allumée, et attend la fin de chaque calcul. Il vérifie :
  - la boucle fermée toute seule, et la ligne d'état du retour ;
  - A fixe dans la liste des points, la ligne du retour sans boutons ;
  - B déplacé, « Autre retour », un point posé sur le retour, « Précédent » ;
  - A retiré (B devient le départ), puis rendu ;
  - le rangement, puis la réouverture après rechargement : bouton allumé, aucune requête au serveur, rien à enregistrer ;
  - le bouton éteint, qui retire le retour.

  Il dure environ 3 min.
- `roulement.mjs <port> <dossier de travail> [<dossier des captures>]` : roulement selon le revêtement à vélo (point 88), sur un profil neuf, avec réseau (brouter.de, overpass-api.de et data.geopf.fr). Le script demande lui-même à BRouter un tracé mêlant routes et chemins au nord de Montpellier, et en tire une sortie à 6 m/s ; l'activité Route y prend un vélo gravel. Il vérifie :
  - la recherche des voies à l'ouverture de l'analyse, onglet « surface » fermé ;
  - l'onglet « énergie » : roulement moyen et avertissement pendant la recherche, puis roulement selon le revêtement dans la note, puissance moyenne recalculée, voies rangées dans la fiche ;
  - deux rechargements : mêmes chiffres, aucune nouvelle requête (une seule si la première a échoué) ; les réponses d'Overpass sont relevées ;
  - le nom de l'onglet « graphiques » (« vitesse et altitude » jusqu'au 16/10).
- `miseajour.mjs <port> <dossier de travail> [<dossier des captures>]` : « Mettre à jour » (point 88), sur un profil neuf, sans réseau. Le script écrit lui-même ses GPX et touche à la mémoire du navigateur pendant que la page est ouverte. Il vérifie :
  - une session retirée du dossier : la liste ne change qu'avec « Mettre à jour » (« 1 session en moins ») ;
  - un GPX et sa fiche posés à la racine, un GPX seul dans `sessions/` : les deux apparaissent, la fiche suit son GPX (nom et activité gardés), celle du GPX seul est créée ;
  - « rien de nouveau » à la relecture suivante, le bouton dans la rangée des imports, et dans Réglages › Mémoire, carte repliée comprise.
- `classer.mjs <port> <dossier de travail> [<dossier des captures>]` : session à classer (point 88), sur un profil neuf, sans réseau. Le script écrit lui-même un GPX dont le `<type>` ne dit rien (`other`) et l'importe depuis la page Course. Il vérifie la carte « À classer », la question « Quelle activité ? » à l'ouverture au lieu de l'analyse, Échap qui la ferme sans rien changer, puis Gravel choisi : activité rangée dans la fiche, analyse vélo ouverte.
- `fractionne.mjs <port> <dossier de travail> [<dossier des captures>]` : groupe Fractionné et compteur d'intervalles (point 89), sur un profil neuf, sans réseau. Le script écrit lui-même son GPX. Il vérifie :
  - l'onglet Fractionné d'Enregistrer, ses deux activités et la carte « Compteur » ;
  - une séance de 2 × 0:05 / 0:05 gardée sous un nom, retrouvée après rechargement ;
  - le compteur seul : les phases à l'écran, et les sons relevés (« [bips] ») comparés à leur heure attendue ;
  - pause, reprise, « Passer », puis un rechargement en pleine séance : séance reprise, bandeau sur /course, arrêt ;
  - le compteur pendant un enregistrement en rejeu ×1 : répétitions rangées dans la fiche, onglet « fractionné » de l'analyse (synthèse, tableau, graphes d'évolution et de profil ; profil lu au-dessus, sans bulle, double-clic qui zoome, « Tout voir » sans « Sur la carte ») et « Voir », « 2 rép. » dans la bibliothèque ;
  - une séance sans compteur importée, 8 efforts d'une minute : répétitions retrouvées dans la vitesse ; seuil d'effort imposé dans l'onglet réglages, trop haut (aucun effort) puis plus bas, enregistré dans la fiche et relu ; retour au seuil tiré de la session. Ce GPX passe par la page, dans un `File` : le Chrome sans fenêtre peut refuser de lire le dossier de travail (`NotReadableError`) ;
  - le groupe dans Réglages, sur l'accueil et dans la barre du haut, son absence en planification, la page à 390 px sans débordement.

  Il dure environ 2 min.
- `compteur-course.mjs <port> <dossier de travail> [<dossier des captures>]` : sortie à pied enregistrée avec le compteur d'intervalles (lot 2 des demandes du 19/10), sur un profil neuf, sans réseau, environ 40 s. Le compteur est lancé depuis l'onglet Fractionné d'Enregistrer, puis une Course est enregistrée en rejeu ×10, deux fois. Le script vérifie :
  - la question posée à « Analyser » : passer la session en « Fractionné à pied » ;
  - oui : fiche en `run-intervals`, séances gardées, analyse ouverte dans le Fractionné avec l'onglet « fractionné » ;
  - non : fiche en `running`, séances gardées quand même, analyse à pied sans l'onglet « fractionné » (il n'existe plus qu'en famille Fractionné, Réglages compris).
- `chrono.mjs <port> [<dossier des captures>]` : chronomètre de la carte du compteur (lot 2 des demandes du 10-14/10), sur un profil neuf, sans réseau, à 390×844 puis à 1400×1000. Il vérifie :
  - la bascule « Compteur | Chrono » ;
  - Départ, deux tours (le dernier en haut), Arrêt (temps figé), Reprendre ;
  - la pastille du chrono sur la vue Compteur ;
  - le chrono repris juste après un rechargement ;
  - la carte gardée en Course tant que le chrono est lancé, puis retirée par « Remise à zéro » ;
  - la page sans débordement.

  Il dure environ 30 s. Sur un serveur neuf, charger une page avant : le premier passage, à 390 px, ne trouve sinon rien.
- `notes.mjs <port> <dossier de travail> [<dossier des captures>]` : bouton « Note » de l'enregistrement (lot 3 des demandes du 10-14/10), sur un profil neuf, sans réseau. Le script écrit lui-même ses GPX. En Course à pied, en Voile puis en Surf, il vérifie :
  - un rejeu ×1 à 390×844, avec deux notes posées : le bouton dit « Note N posée » puis revient, le vibreur est relevé (« [bips] vibreur »), la page ne déborde pas ;
  - l'analyse : deux fanions numérotés sur la carte, la liste de « Général », « Voir » qui passe le fanion au violet, un trait par repère sur les graphes, deux repères dans la fiche ;
  - en Course seulement : la note 1 nommée, la note 2 supprimée, « Enregistrer la session », la fiche relue, puis la liste après rechargement, et à 1400×1000.

  Il dure environ 2 min.
- `charge.mjs <port> [<dossier des captures>]` : charge portée en course et poids du vélo par session (lot 4 des demandes du 10-14/10), sur un profil neuf, sans réseau. Le script écrit lui-même ses GPX, deux côtes à 5 %, et pose un poids de 70 kg. Il vérifie :
  - dans Réglages, partie Onglet analyse : le champ « Charge portée » sur Course et Fractionné à pied, pas sur Route ; 5 kg rangés pour Course ;
  - une course importée : énergie et note avec la charge de l'activité, puis 12 kg dans l'onglet réglages (énergie × 82/75), barre « charge », « Enregistrer la session », fiche relue, rechargement, « Revenir à l'activité » puis Annuler ;
  - une sortie à vélo importée : 20 kg de vélo et de bagages, puissance et masse totale recalculées, fiche relue ;
  - à 390×844, aucun débordement.

  Il dure environ 1 min.
- `depense.mjs <port> [<dossier des captures>]` : énergie de la marche (Pandolf, descentes par Santee) et réglage « Dépense » (lot 21, 28/10), sur un profil neuf, sans réseau, poids de 70 kg posé par le script. La côte à 5 % de `charge.mjs`, à 1,4 m/s, passée en Marche : « Énergie de marche » vers 82 kcal et la note de Pandolf ; « Dépense » de la Marche passée sur Course dans Réglages : « Énergie de course » vers 115 kcal et la note de Minetti (la marche à 0,6 à 0,8 fois) ; remise sur Marche, plus rien de rangé. Il dure environ 40 s et finit par « tout est passé » ou le nombre d'échecs.
- `imports.mjs <port> [<dossier des captures>]` : imports anciens sans artefact (lot 5 des demandes du 10-14/10), sur un profil neuf, sans réseau, poids du pratiquant non renseigné. Le script écrit lui-même ses GPX et leurs fiches, et les importe par la page. Il vérifie :
  - le matériel : une wing importée seule n'emprunte rien à la dernière session notée ; une wing enregistrée sans notes le reçoit ;
  - une fiche de la première version (24/09) : notes gardées, réglages, activité et nom nuls, session modifiable ;
  - une fiche au résumé abîmé, importée puis posée dans `sessions/` avant « Mettre à jour » : nom et notes gardés, résumé refait, pas de lecture seule ;
  - une course importée seule, puis avec sa fiche : nom et voies reçus, « fiche complétée » ;
  - à vélo, sans poids : énergie à « — », avertissement, pas de graphe ;
  - en surf : foil supposé dans « Général » et dans l'onglet réglages ; à 390×844, aucun débordement.

  Il dure environ 1 min 30.
- `materiel.mjs <port> [<dossier des captures>]` : onglet « matériel et notes » hors voile (lot 2 des demandes du 14/10, seconde série), sur un profil neuf, sans réseau. Le script écrit lui-même ses GPX et les importe par la page. Il vérifie :
  - dans Réglages, partie Onglet analyse : la ligne « Matériel » sur Course, Route et Surf, pas sur Voile ; « Chaussures » et « Sac » rangés pour Course ;
  - une course, une sortie à vélo et une session de surf : l'onglet juste avant « réglages », les intitulés de l'activité (ceux par défaut à vélo et en surf), ni vent ni plan d'eau, saisie du matériel, des conditions et de l'appréciation, partie « notes » dans la barre, « Enregistrer la session », fiche relue, rechargement ;
  - à 390×844, aucun débordement.

  Il dure environ 1 min et finit par « Tout passe. » ou le nombre d'échecs. La voile se vérifie à part, par `bench.mjs` et `DUMP` avant et après : texte identique.
- `onglets.mjs <port> [<dossier des captures>]` : onglets choisis par activité et « tops » à pied et en surf (lot 3 des demandes du 14/10, seconde série), sur un profil neuf, sans réseau. Le script écrit lui-même une course, une sortie à vélo et une session de surf, prend celle de voile de `make-gpx.mjs`, et les importe par la page. Il :
  - ouvre tous les onglets de chaque analyse et, avec `DUMP=x`, relève leur texte dans `x-course.txt`, `x-velo.txt`, `x-surf.txt` et `x-voile.txt`. Avec `RELEVE_SEUL=1`, il s'arrête là : c'est le relevé à faire sur la version d'avant (un `git worktree` servi sur un autre port), pour un texte identique sans réglage ;
  - vérifie dans Réglages, partie Onglet analyse, la ligne « Onglets » de Voile, Course, Route, Fractionné à pied, Surf et Surf foil : « tops » enfoncé en voile et à vélo, relâché à pied et en surf, « vols » sur foil seulement, pas de « sauts » en fractionné ;
  - coche « tops » en surf et en course, cache « vagues » en surf et « vmg » en voile, et vérifie ce qui est rangé ;
  - en surf : « tops » entre « rame » et « graphiques », le panneau « Vagues » absent bien que laissé ouvert, le tableau, « Voir » qui trace le podium, la surbrillance effacée à la fermeture de l'onglet et pas ramenée ; en course : « tops » et ses distances (400 m vers 18 km/h) ; en voile : ni onglet ni panneau VMG ;
  - à 390×844 : Réglages et le surf sans débordement ; puis « Par défaut » (menu « … » de la carte) de la carte Surf, qui efface ses choix et garde ceux des autres.

  Il dure environ 2 min et finit par « Tout passe. » ou le nombre d'échecs. Il appelle `Network.enable` : sans lui, le blocage par hôte ne tient pas toujours, Overpass répond (504) et le relevé du vélo change.
- `cardio.mjs <port> [<dossier des captures>]` : onglet « cardio » et FC dans les analyses (lot 7, étape analyse), sur un profil neuf, sans réseau. Le script écrit lui-même une course, une session de surf et une séance de fractionné, et prend celle de voile de `make-gpx.mjs`, toutes avec la FC (`gpxtpx:hr`), plus une course sans FC, et les importe par la page. Il vérifie :
  - l'onglet juste après celui des graphes, FC moyenne et max, pas de zones sans FC max ni âge, « La retenir » qui range la FC max de la sortie ; pas d'onglet sur la course sans FC ;
  - FC max et de repos posées : le tableau des zones (réserve cardiaque), la charge, la dérive et le nuage FC / vitesse en course, « Voir » qui trace les passages d'une zone en violet, effacés à la fermeture de l'onglet et pas ramenés ;
  - la courbe de FC dans l'onglet des graphes des trois modules (trois graphes en course, deux sans FC) ;
  - Réglages : « Zones cardiaques » (Personnaliser, Revenir au calcul), la case « Ceinture cardio » en voile et en surf, « FC moyenne » et « Zone cardiaque » parmi les chiffres de la voile ;
  - une séance de fractionné sans compteur, avec la FC : colonnes « FC » (moyenne / max) et « Récup. » de chaque répétition ;
  - la FC dans le résumé des fiches (`calcVersion` 4), rien pour la course sans FC, et l'onglet « cardio » des statistiques (sessions avec FC, charge, temps par zone, charge par semaine, FC par session) ;
  - à 390×844, l'analyse de course, onglet cardio ouvert, et le fractionné, sans débordement.

  Il dure environ 2 min et finit par « Tout passe. » ou le nombre d'échecs. La neutralité se prouve par `onglets.mjs` en `RELEVE_SEUL=1` : sans FC, le texte des quatre analyses ne change pas.
- `reglages.mjs <port> [<dossier des captures>]` : un fichier de réglages par appareil (point 90), sur un profil neuf, sans réseau, dans la mémoire du navigateur. Il vérifie :
  - `reglages/pc.json` écrit au premier lancement ;
  - le passage depuis un ancien `reglages.json` plus récent : repris une dernière fois, puis retiré ;
  - le fichier d'un autre appareil (« Léa », activités de la version 3) déposé dans `reglages/` : visible après « Mettre à jour », pas repris de lui-même, proposé par le bandeau « Nouveau fichier de réglages » ;
  - « Reprendre » du bandeau : activités recolorées dans les nuances de leur famille, seuil repris, choix retenus de l'appareil gardés ; plus de bandeau ensuite ;
  - le renommage de l'appareil, qui renomme son fichier, et le refus d'un nom déjà pris ;
  - un autre appareil sous le nom de celui-ci : l'appareil prend un nom libre et le dit ; le bandeau le propose, « Fermer » le retire pour de bon ;
  - des activités de la version 3 au lancement : le fichier de l'appareil passe aux nouvelles couleurs sans changer de date ;
  - « Importer un fichier de réglages » : un JSON quelconque et le fichier de l'appareil refusés ; celui d'une tablette rangé sous son nom, reprise refusée puis faite depuis la liste.
- `sauts.mjs <port> [<dossier des captures>]` : sauts en voile et case « Foil » (point 91), sur un profil neuf, sans réseau. Le script fabrique dans la page une session de voile et ses capteurs (`.imu`, par l'encodeur de l'application). Il vérifie :
  - dans Réglages, « Foil » puis « Sauts » (parties de la carte ouvertes), leurs sous-options, relus après rechargement ;
  - l'import d'une session avec ses capteurs : `.imu` rangé à côté du GPX ;
  - le foil de l'activité, puis celui de la session : « Ratio de navigation » ou « Ratio de vol », champs Foil et Mât ;
  - l'onglet « sauts » : chiffres, podium, tableau et son tri, courbe (lue au-dessus, double-clic qui zoome, « Tout voir » sans « Sur la carte »), « Voir », « Détail », comparaison, sauts rangés dans la fiche, sur ordinateur et à 390×844 ;
  - l'absence de « Mesurer les sauts » dans le navigateur, et la suppression de la session avec son `.imu`.

  La partie Réglages reste périmée depuis les pré-réglages du 21/10 : les sauts y sont cochés d'office et la carte retient son état, si bien que les cases s'inversent et la relecture ne retrouve pas la carte. Le foil de la session échoue à sa suite ; l'onglet « sauts » et le reste passent (le 25/10, sur une copie sans la partie Réglages).
- `pumping.mjs <port> [<dossier des captures>]` : pumping foil en surf (point 104), sur un profil neuf, sans réseau, serveur de développement (le script importe `/src/...` dans la page). Le script fabrique dans la page une session de surf foil de quatre vols et ses capteurs (`core/imuSynthetic.fixture.ts` : chocs de l'eau hors des vols, pumping à 1,5 Hz en vol), et vérifie :
  - dans Réglages, la case « Pumping foil » de Surf foil (pas de Surf), l'aide du seuil de vol, le résumé de la carte repliée ;
  - l'import de la session avec ses capteurs, Foil et Pumping cochés pour la session, l'onglet « vols » : coups, fréquence vers 90 /min, distance par coup, podium des 3 plus longs vols avec décollage, « Tous les vols (4) » replié puis déplié, « Voir » ;
  - Pumping décoché pour la session (colonnes du GPS revenues), puis « Enregistrer la session » (`analysis.pumping` dans la fiche) ;
  - l'absence de « Mesurer le pumping » dans le navigateur, et la page à 390 × 844 sans débordement.

  Il dure environ 1 min et finit par « Tout passe. » ou le nombre d'échecs.
- `sauts-diagnostic.mjs <fichier .imu> [<fichier .gpx>] [--tous] [--support=wingfoil]` : sans navigateur ni serveur (Node 22.18 ou plus, qui lit le TypeScript de l'application tel quel). Relit une capture des capteurs d'une vraie séance, rangée à côté de son GPX dans le dossier mémoire. Il donne :
  - le téléphone, les capteurs, l'emplacement et le foil choisis ;
  - la durée, la cadence et les trous de chaque flux ;
  - l'écart avec le GPX ;
  - les sauts tels que l'application les calcule (`src/core/jumps.ts`), avec la vitesse GPS au décollage, et la part de la séance que garderait l'élagage ;
  - avec `--tous`, les vols écartés et leur raison, pour recaler la détection.
- `donnees.mjs <port> <dossier de travail> [<dossier des captures>]` : données sûres (lot A, point 92), sur un profil neuf, dans la mémoire du navigateur. Il faut le serveur de développement, **redémarré depuis la dernière modification des sources** : le script importe `/src/hooks/useSessionLibrary.ts`, et après un rechargement à chaud, il obtiendrait une seconde copie du module, vide. Aucune demande à l'IGN ni à Overpass n'est attendue : elles sont relevées. Le script écrit lui-même ses GPX. Il vérifie :
  - le cache allégé : une sortie à vélo dont la fiche porte une altitude IGN et des voies. Après deux lancements, `tracker.libraryCache` ne les contient plus, et la session est partielle. Un renommage depuis la liste les laisse dans la fiche. L'analyse s'ouvre sans aucune demande, altitude « IGN » ;
  - le recalcul de fond : 30 fiches au résumé périmé. La dernière, renommée pendant le balayage, garde son nom et passe en `calcVersion` 2 ;
  - « Mettre à jour » : une session renommée pendant la relecture garde son nom, en mémoire et dans la fiche ;
  - l'import de trois GPX : un illisible, et un dont la fiche ne s'écrit pas, à cause d'un dossier piège posé au nom de la fiche. Le troisième est rangé, l'échec est nommé dans le bandeau avec le compte rendu, et le GPX à moitié rangé est retiré. Importé de nouveau avec un `.imu`, le troisième reçoit ses capteurs (« capteurs ajoutés à 1 session déjà présente ») ;
  - le stockage plein : `localStorage` rempli, un pli des totaux de l'accueil reste en mémoire sans être gardé, et le bandeau d'erreur le dit sur l'accueil.

  Il dure environ 1 min 30. Le passer aussi sur la version d'avant le lot, `770fa94` (un `git worktree` servi sur un autre port), montre chaque perte qu'il évite.
- `survol.mjs <port> <dossier de travail> [<dossier des captures>]` : coût de la carte sur une longue trace (lot B de l'audit, point 93), sur un profil neuf. L'IGN, Overpass, BRouter et Photon sont bloqués par hôte. Un motif comme `*brouter*` bloquerait aussi le module `/src/planning/brouter.ts`, et la page resterait vide. Le script :
  - écrit une course de 3 h à 1 Hz (10 800 points) et la session de `make-gpx.mjs`, et les importe par la page, dans un `File` : le Chrome sans fenêtre refuse de lire le dossier de travail ;
  - en course, compte les traits SVG et les canevas de la trace, puis mesure 50 survols du graphe de vitesse ;
  - en voile, mesure 10 clics « Voir (Carte) » d'un top ;
  - avec `DUMP=x`, relève le texte des deux analyses dans `x-course.txt` et `x-voile.txt`, avant tout survol ;
  - avec le dossier des captures, photographie les deux cartes, puis la course à 390×844 et sa carte en plein écran.

  Avant le lot, il relevait 10 799 traits SVG, 325 ms par survol et 235 ms par clic ; après, aucun trait SVG, 60 ms et 55 ms, pour un texte identique.
- `surf.mjs <port> [<dossier des captures>]` : le surf (point 97), sur un profil neuf, sans réseau. Le script écrit lui-même deux sessions synthétiques, cap de l'appareil compris, et les importe par la page, dans un `File`. Il vérifie :
  - la famille Surf sur l'accueil et dans la barre, et ses deux activités dans Réglages (« Seuil de vague », « Seuil de vol » pour Surf foil, ni pente ni terrain) ;
  - une matinée de trois vagues, dont une enchaînée : la ligne de la bibliothèque, puis les onglets général, vagues (tableau, tri, « Voir », podium), rame et graphiques ;
  - un seuil de vague imposé dans l'onglet réglages : une vague en moins, rangé dans la fiche, relu après rechargement, puis « Défaut » et « Annuler » ;
  - une session de surf foil : case Foil de la session, onglet « vols », plus long vol dans la fiche et la bibliothèque ;
  - la page à 390 × 844, sans débordement.

  Les onglets ouverts sont mémorisés : le script n'ouvre un onglet que s'il est fermé (`openTab`). Il dure environ 1 min.
- `cacher.mjs <port> [<dossier des captures>]` : familles et activités cachées (point 100), sur un profil neuf, sans réseau. Le script importe par la page une sortie à vélo (rangée sous Route). Il vérifie :
  - Surf puis Route cachés par leur œil dans Réglages : toujours listés, grisés ; Surf hors de la barre du haut, de l'accueil et d'Enregistrer, la barre du bas inchangée (Accueil, Profil, Statistiques, Réglages) ; la session de Route retirée de la bibliothèque Vélo, une ligne le dit ; Route hors d'Enregistrer ; `/surf` s'ouvre et dit qu'il est caché ;
  - l'œil de la dernière famille visible désactivé ;
  - tout ré-affiché : barres, accueil, bibliothèque Vélo et Enregistrer identiques au relevé de départ.
- `familles.mjs <port> [<dossier des captures>]` : familles repliables dans Réglages (lot 2 des demandes du 15/10), sur un profil neuf, sans réseau, environ 30 s. Avec `DUMP=x.txt`, il ouvre toutes les familles, activités et parties et relève le texte des cartes d'activité ; avec `RELEVE_SEUL=1` en plus, il s'arrête là (relevé de la version d'avant). Il vérifie ensuite :
  - les cinq familles fermées au départ, aucune carte d'activité montée ;
  - Voile ouverte, son œil qui la cache sans la replier, puis la rend ;
  - l'état retenu après rechargement (`settings-families` dans `tracker.sections`) ;
  - une activité ajoutée en surf, qui ouvre la famille Surf et sa carte ;
  - le menu « … » de la carte d'activité (Renommer, Supprimer, Par défaut), « Par défaut » grisé puis actif après un réglage changé ;
  - à 390×844, aucun débordement, familles fermées puis ouvertes.

  Depuis ce lot, les scripts qui passent par les cartes d'activité ouvrent d'abord les familles (clic sur `.settings-activities__family-toggle`, ou `settings-families` dans la mémoire préremplie).
- `notification.mjs <port> <dossier de travail>` : notification de l'enregistrement (point 101), sur un profil neuf, sans réseau, environ 1 min 30. La version navigateur de `platform/notification.ts` consigne chaque envoi en `console.debug` (« [notification] »). Le script vérifie :
  - la partie « Notification » de la carte Voile dans Réglages : deux menus, « défaut », puis une ligne changée et rangée, qui suffit à dégriser « Par défaut » dans le menu « … » de la carte (grisé, non absent, tant que rien n'est changé) et, repliée, « · modifié » ;
  - un rejeu ×10 de voile : titre, chiffres choisis, chronomètre de durée, 5 s au moins entre deux envois ;
  - pause manuelle (envoi immédiat, « en pause », posé seul), reprise, puis effacement à l'arrêt ;
  - le compteur pendant un enregistrement de fractionné : phase au titre et décompte ; « Étape » d'office (0/2 au départ, 1/2 au premier travail, lot A du 26/10).
- `statistiques.mjs <port> [<dossier des captures>]` : la page des statistiques (lot 5 des demandes du 10-13/10), sur un profil neuf, environ 1 min. Le script écrit lui-même douze sessions (course, vélo, wingfoil, kite sans activité créée pour lui, surf, deux fractionnés), datées en jours avant aujourd'hui, et les importe par la page Course. Le réseau n'est pas nécessaire ; l'analyse ouverte à l'étape du graphe demande seulement l'altitude à l'IGN s'il est là. Il vérifie :
  - l'accès par la barre du haut, plus de lien sur l'accueil (lot 1 des demandes du 20/10) ;
  - la vue d'ensemble (12 sessions, une ligne par famille, pas de records, le graphique de la durée seule), la descente vers Course, la période « 30 jours », le retour arrière, puis « Fractionné vélo » ; les pastilles d'activité de chaque famille, celles sans session et « Kite », activité de base, comprises ;
  - un point du graphique, cliqué, puis « Ouvrir » qui mène à l'analyse ; les données proposées en course, en voile (% de vol du wingfoil seul) et en surf, chacune tracée avec l'unité de son axe ; le choix retenu après rechargement, la vitesse max à sa place là où il n'existe pas ; les fiches en version 5 du résumé (point 122) ;
  - une planche à voile de `make-gpx.mjs` importée puis ouverte dans son analyse : la réussite des manœuvres rangée dans sa fiche, « % de manœuvres réussies » tracé en deux séries, la note des sessions à rouvrir ;
  - Surf caché (écrit dans `tracker.sportSettings`) : absent des pastilles et des totaux, sa page ouverte par l'adresse ;
  - à 390×844 : rien ne déborde ; la case « Statistiques » de la barre du bas ouvre la page, allumée.

  Depuis le lot 1 des demandes du 16/10, la page reprend le dernier affichage quand son adresse n'a pas de paramètre : le script efface `tracker.statistiques` avant l'étape de la famille cachée. Depuis le 17/10, les pastilles sont repliées sous « Sélection » : le script vérifie le bouton replié au départ et le choix qu'il affiche, le déplie et vérifie qu'il le reste au rechargement ; `barre.mjs` le déplie avant de cliquer une pastille. Depuis le 17/10 aussi, la famille s'appelle « À pied » (pastille, ligne de la vue d'ensemble, bouton « Sélection ») ; sa clé reste `course` dans l'adresse. `barre.mjs`, `cacher.mjs` et `notes.mjs` suivent le même nom.
- `barre.mjs <port> [<dossier des captures>]` : barre d'onglets repliable, régularité et dernier affichage des statistiques (lot 1 des demandes du 16/10), sur un profil neuf, sans réseau, environ 1 min. Le script importe une course (10 jours avant aujourd'hui) et une session de voile de `make-gpx.mjs` (20 jours avant). Il vérifie :
  - la flèche en fin de barre, qui cache la barre seule (panneaux ouverts gardés) et laisse le bouton fin « onglets » ; l'état gardé après rechargement et d'une analyse à l'autre ; le bouton fin, qui rend la barre et disparaît ; à 390×844, sans débordement ;
  - Course sur « Année » : « Semaines actives » comptées depuis la course, pas sur 52 semaines ;
  - le dernier affichage repris à l'ouverture sans paramètre, une adresse avec paramètres qui l'emporte, « Tout » retenu aussi.

  Il finit par « Tout passe. » ou le nombre d'échecs. Le texte des analyses ne change pas (la flèche n'a pas de texte) : `onglets.mjs` en `RELEVE_SEUL=1` le prouve.
- `graphes.mjs <port> [<dossier des captures>]` : graphes repliables un par un et graphe d'altitude de l'onglet « zones de pente » (demandes du 16/10), sur un profil neuf, sans réseau, environ 1 min 30. Le script écrit lui-même une course avec la FC et une côte, une session de surf avec la FC, et prend la voile de `make-gpx.mjs` avec la FC. Il vérifie :
  - l'ordre des onglets à pied (« graphiques » à la place des zones, « cardio » derrière lui) ;
  - en course, les replis Vitesse, Altitude et FC : un graphe replié disparaît, avec la légende de pente et « Voir sur la carte » pour l'altitude ; le panneau rapetisse ; le repli est retenu après rechargement ;
  - le mode superposé : la même rangée de replis, une série repliée n'est pas tracée, tout replié plus de graphe ;
  - l'onglet « zones de pente » : le tableau puis le graphe d'altitude, le repli de chacun (le tableau seul replié laisse le graphe), le survol qui pose le repère sur la carte, « Voir sur la carte » qui colore la trace par la pente tant qu'un graphe d'altitude est montré ;
  - le surf (Vitesse et FC) et la voile (les trois graphes, titre gardé replié) ; à 390×844, sans débordement.

  Il finit par « Tout passe. » ou le nombre d'échecs.
- `cadence.mjs <port> [<dossier des captures>]` : cadence à pied (demande du 16/10), sur un profil neuf, sans réseau, environ 1 min 30. La mesure sur l'accéléromètre ne se joue pas dans le navigateur (tests de `running/cadence.test.ts`) : le script écrit des GPX qui portent déjà `gpxtpx:cad`, en foulées par minute. Il vérifie :
  - la cadence dans le résumé de la fiche ; l'onglet « cadence » juste après les graphes, la courbe repliable dans « graphiques » ;
  - les chiffres (moyenne, max sur 30 s, pas, longueur de pas, dérive), les tranches de la course et « Voir » qui trace leurs passages, effacés à la fermeture de l'onglet ; selon la vitesse et selon la pente ;
  - la marche (tranches de la marche), le vélo (`cad` en tours de pédale : ni onglet ni courbe), une course sans cadence ;
  - les colonnes « Cadence » et « Pas » du fractionné ; la donnée « Cadence moyenne » des statistiques ;
  - Réglages : « Mesurer la cadence » coché d'office à pied, absent à vélo, rangé seulement décoché ; à 390×844, sans débordement.

  Il finit par « Tout passe. » ou le nombre d'échecs. Sans cadence, le texte des analyses ne change pas : `onglets.mjs` en `RELEVE_SEUL=1` le prouve.
- `partage.mjs <port> <dossier de travail> [<dossier des captures>]` : « Partager » du menu « … », image de la trace et des chiffres choisis (demande du 18/10), sur un profil neuf, environ 1 min 30. Réseau : les tuiles d'OpenStreetMap seulement (fond de l'image) ; IGN, Overpass et BRouter bloqués. Le script importe une boucle de course et la voile de `make-gpx.mjs`. Il vérifie :
  - dans chaque analyse : « Partager » en tête du menu « … », la fenêtre, l'aperçu carré de 1080 px, les pastilles égales à la liste entière des chiffres de l'image (l'onglet « général » n'en montre plus que l'essentiel depuis le 22/10 ; l'essentiel s'y retrouve), les six premières enfoncées ; l'image est gardée dans le dossier des captures (`partage-<page>.png`) ;
  - en course : deux pastilles seulement (image toujours carrée), fond de carte décoché, choix rangés sous l'activité (`tracker.partage`) et retrouvés à la réouverture ; « Partager » par le partage du navigateur (simulé), puis sans lui (téléchargement et message) ; Échap qui ferme ;
  - à 390×844 : la fenêtre tient dans l'écran ; fin d'enregistrement (rejeu de la boucle, Arrêter, « … » › « Partager » de « Session terminée ») : aperçu carré, chiffres du résumé, choix de la course repris.

  Il finit par « Tout passe. » ou le nombre d'échecs. Menu fermé, le texte des analyses ne change pas : `onglets.mjs` en `RELEVE_SEUL=1` le prouve.
- `profil.mjs <port> [<dossier des captures>]` : la page « Profil » (demande du 18/10), sur un profil neuf, sans réseau, environ 40 s. Le script écrit lui-même six sessions de 20 min, datées en jours avant aujourd'hui : quatre dans l'année en cours (deux courses, une sortie à vélo en côte de 200 m, une de wingfoil) et deux l'an passé. Il les importe par la page Course. Il vérifie :
  - l'accueil sans graphe d'activités ni ligne « Profil » (retirée le 20/10) ; le lien « Profil » de la barre du haut ouvre la page, allumé ;
  - l'année en cours : la distance en km (à 5 % de la somme des vitesses × durées), « 1 h 20 », le D+ de la côte, le nombre de sessions ; l'ordre chiffres › répartition › graphe ; l'anneau (une part par activité) et sa légende (la course à 50 %), le total au centre, la part d'une ligne survolée ;
  - les flèches : « suivante » désactivée sur l'année en cours, l'an passé et ses chiffres (D+ à 0 sur le plat), « précédente » désactivée sur la plus vieille année, le graphe toujours là ;
  - une ligne de la légende qui ouvre la bibliothèque filtrée sur son activité ;
  - à 390×844 : rien ne déborde, chiffres empilés ; la barre du bas (Accueil, Profil, Statistiques, Réglages), dont la case « Profil » ouvre la page, allumée.

  Il finit par « Tout est bon. » ou le nombre d'échecs. Le graphe d'activités ayant quitté l'accueil, l'étape 5 de `donnees.mjs` (stockage plein) passe par `/profil`.
- `reglages-aide.mjs <port> [<dossier des captures>]` : les aides de Réglages sous des « ? » (lot 3 des demandes du 19/10), sur un profil neuf, sans réseau, environ 40 s. Tout ouvert (blocs, familles, activités, parties), il vérifie :
  - plus aucun `title` sur une ligne de réglage, plus de grande note sous les activités, aucune aide dépliée au départ, chaque « ? » nommé « Aide : … » ;
  - chaque « ? » de la page, un par un : son texte apparaît seul (le suivant referme le précédent), court ; un second appui referme ;
  - le « ? » du seuil de Voile : libellé inchangé, aide sous sa ligne ; celui du bloc Activités ne replie pas le bloc ;
  - à 390×844 : aucun débordement, une aide ouverte comprise ;
  - hors de Réglages (Itinéraires), le mode d'emploi des bips d'un parcours est sous le « ? » du bloc Parcours (aides partout depuis le point 148).

  Il finit par « Tout est passé. » ou le nombre d'échecs. Seuls des textes d'aide ont quitté la page : le relevé `familles.mjs` en `DUMP=… RELEVE_SEUL=1`, avant et après, le prouve.
- `reduire.mjs <port> [<dossier des captures>]` : « Tout réduire » et nom ou pseudo de Réglages (demandes du 19/10 au soir), sur un profil neuf, sans réseau, environ 20 s. Il vérifie que « Tout réduire » replie tout (blocs, familles, activités, parties, aide ouverte, choix d'icône), mémoire comprise, et que le choix d'icône se rouvre ensuite ; que le pseudo saisi dans Pratiquant devient le titre du Profil, et « Profil » une fois effacé ; l'en-tête sans débordement à 390×844.
- `vides.mjs <port> [<dossier des captures>]` : lot 1 des demandes du 20/10, sur un profil neuf, sans réseau, environ 1 min. Le script écrit lui-même une voile en aller simple (vent impossible à estimer), une course sans altitude et la matinée de surf de `surf.mjs`, et les importe par la page. Il vérifie :
  - voile : « manœuvres », « vmg » et « vent » ouverts disent « Vent inconnu » et ce qui en dépend, avec « Ouvrir l'onglet général » tant que « général » est fermé, qui l'ouvre ;
  - course : « zones de pente » dit pourquoi elle est vide (pas d'altitude dans le fichier, IGN injoignable) et propose « Réessayer » ;
  - surf : « Sur la vague (x %) » dans les chiffres, et la légende de la répartition qui ne redit pas son pourcentage ;
  - à 360×800 : l'accueil sans lien Profil ni Statistiques, la barre du bas Accueil · Profil · Statistiques · Réglages ; dans Réglages, la carte Voile ouverte montre son nom en texte (un toucher replie la carte), le menu « … » (dont « Renommer ») et l'œil sur la même ligne ; Échap n'enregistre rien, Entrée renomme, le nom est relu après rechargement ; rien ne déborde.

  Il finit par « Tout est bon. » ou le nombre d'échecs.
- `marche.mjs <port> [<dossier des captures>]` : activité « Marche » de départ (lot 3 des demandes du 20/10), sur un profil neuf, sans réseau, environ 30 s. Il vérifie :
  - installation neuve : la Marche juste après Course dans À pied, son icône, ses couleurs de 1,5 à 8 km/h et son temps estimé « Personnalisé » à 5 km/h, sans « · modifié » ; Course garde 4 à 15 km/h ;
  - des réglages d'avant écrits dans `localStorage` : une liste de la version 5 reçoit la Marche une fois, une « marché » créée par l'utilisateur empêche le doublon, une liste de la version 6 sans Marche ne la voit pas revenir ;
  - à 390×844, la liste d'activités d'Enregistrer pour À pied (Course, Marche), sans débordement.
- `satellite.mjs <port> [<dossier des captures>]` : vue satellite (lot 4 des demandes du 20/10), sur un profil neuf, avec réseau vers `server.arcgisonline.com` seulement (IGN, Overpass, BRouter et OSM bloqués), environ 1 min 30. Le script écrit lui-même quatre allers-retours le long de la côte à Palavas (voile, course, vélo, surf) et les importe par la page. Il vérifie :
  - dans chaque analyse : un bouton « Vue satellite » sous le + et le −, mention OSM ; un clic passe au satellite (mention Esri, tuiles affichées), le texte de la page ne change pas hors mention ; le fond rangé pour la famille seule (`tracker.fondCarte`), retrouvé après rechargement ; la voile en satellite laisse la course en plan ;
  - vignettes de la bibliothèque : pas de bouton, plan ; planification : le fond de la famille de son activité (la Voile, en satellite), son bouton, qui ne pose pas de point, et deux points posés sur la photo ;
  - l'aperçu de l'image de partage de la voile (capture, à regarder : photo et mention Esri) ;
  - hors ligne : tuiles `sat_…` gardées, réaffichées sans Esri ;
  - à 390×844 : bouton présent, rien ne déborde, un toucher sur le bouton n'ouvre pas le plein écran, la vue agrandie suit le fond avec son bouton.

  Il finit par « Tout passe. » ou le nombre d'échecs.
- `prereglages.mjs <port> [<dossier des captures>]` : pré-réglages du bateau, puis de tous les sports hors surf (demandes du 21/10), sur un profil neuf, sans réseau, environ 1 min. Le script écrit dans `localStorage` des réglages d'avant (bateau, Voile, Course, kite), puis il vérifie :
  - la mise à jour au démarrage : ceux du bateau, de la Voile et de la Course effacés une fois, l'unité du bateau et ceux du kite gardés, `presetsVersion` à 3 ;
  - Réglages : le bateau colore de 1 à 15 nd, avec une pause sous 0,2 km/h pendant 60 s, ses chiffres et aucune ligne « Seuil d'activité » ; la Voile à 8 nd (seuil, couleurs de 8 à 24) ; Course, Marche (depuis le 28/10), Route, Gravel, VTT et les deux fractionnés « aucun seuil » ; leurs couleurs, leur pause et le poids du vélo pré-réglés ; plus de ligne « Terrain » ; « Dépense » sur Marche pour la Marche, sur Course pour la Course et le Fractionné à pied, aucune ligne à vélo ; aucune carte « modifié » ;
  - deux allers-retours lents importés par la page, l'un en bateau, l'autre en Voile : le résumé du bateau compte toute la session en navigation, son « général » n'a ni chiffres actifs ni ratio, et son onglet réglages n'a pas de seuil ; la Voile les garde ;
  - une course de deux `<trkseg>` séparés par 10 min de pause, vitesse Doppler comprise : 1,80 km et 10 min en mouvement sur 20, dans la fiche et dans l'analyse (bug du 17/10) ;
  - un réglage du bateau fait après la mise à jour, qui reste au rechargement ;
  - la mise à jour 2 → 3 (28/10) : le seuil de 0,5 km/h rangé pour la Marche effacé, celui de la Course gardé.

  Sur un profil déjà servi, le fichier de réglages du dossier mémoire reprend la place des valeurs écrites : il faut prendre un profil neuf à chaque passage.
- `entrainement.mjs <port> [<dossier des captures>]` : famille Entraînement, page Fractionné et compteur à blocs (chantier du 24/10, lot A), sur un profil neuf, sans réseau, environ 40 s. Il vérifie :
  - le nom « Entraînement » sur l'accueil, dans la barre et sur la page de la famille, et sa tuile « Fractionné » ;
  - la page Fractionné : une séance à blocs créée d'un geste (ajouts sans « 3 × 3 min / 1 min » ni « 10 × 30/30 », « + Échauffement » en tête, vraies flèches ↑ ↓ : lot A du 26/10), gardée, modifiée, dupliquée, la copie retirée ;
  - « Lancer » : Enregistrer prêt (Entraînement, Fractionné, à pied), la séance dans le compteur, « Série 1 · Travail 1/3 » ; arrêtée, la page quittée puis retrouvée par le retour : séance close oubliée, l'éditeur et jamais « Séance arrêtée » ;
  - Réglages › Enregistrement : « Son des bips » médium par défaut, retenu, « Écouter », un son choisi toujours écrit ;
  - à 390 × 844 : sans débordement.
- `icones.mjs <port> [<dossier des captures>]` : icônes des activités (demande du 17/10), sur un profil neuf, sans réseau, environ 1 min. Il importe six sessions synthétiques par la page Course et vérifie :
  - l'accueil : boutons de famille sans petites icônes d'activité, « À pied » pour la course ;
  - les bibliothèques Voile et Vélo : bandeau qui nomme les activités créées, une icône devant chaque ligne et dans chaque onglet d'activité, l'onglet « Kite » qui ne laisse que sa ligne ;
  - la liste de choix d'activité d'une session à classer : une icône par activité, à sa couleur ;
  - Réglages : seize icônes au choix, celle devinée cochée, choix gardé après rechargement et repris par la bibliothèque, activité « Paddle » ajoutée en surf ;
  - à 390×844 : bibliothèque et accueil sans débordement.
- `timer.mjs <port> [<dossier des captures>]` : le Timer de l'Entraînement (lot D des demandes du 25/10), sur un profil neuf, sans réseau, environ 30 s. Il vérifie :
  - la tuile « Timer » sous Tests ; la liste du Timer, vide au départ, une séance créée, modifiée, dupliquée, la copie retirée, sans toucher aux séances du Fractionné ;
  - « Lancer » (lot A du 26/10) : Enregistrer en mode Timer (ni famille, ni « Démarrer », ni carte), le compteur lancé d'emblée, « Départ » puis le premier travail, le bandeau « Timer » qui y ramène ; un appui court sur « Arrêter » ne fait que rappeler le geste ; « Modifier » à sa droite arrête la séance (confirmation acceptée) et rend l'éditeur sur elle, « Lancer le compteur » la relance ; tenu 1 s, « Arrêter » l'arrête ; la page quittée puis retrouvée par le retour : séance close oubliée, l'éditeur et jamais « Séance arrêtée » ; la position jamais demandée (sonde sur `navigator.geolocation`) ;
  - « Enregistrer une session » rend la page ordinaire ; à 390 × 844 : sans débordement, compteur en marche compris.
- `zoom-carte.mjs <port> [<dossier des captures>]` : graphe zoomé vu sur la carte (lot 2 des demandes du 23/10), sur un profil neuf, sans réseau, environ 2 min 30. Il vérifie :
  - course, voile et surf : la valeur lue au-dessus du graphe sans bulle ni décalage ; le double-clic qui zoome ×2 autour du point ; « Sur la carte » qui allume le tronçon en violet et cadre la carte, mis à jour au zoom suivant, effacé par « Tout voir » ou la fermeture de l'onglet ;
  - les onglets cardio, énergie et zones de pente ;
  - le profil d'altitude de « général » (lot 2 du 24/10) : nom et lecture, double-clic, « Sur la carte », zoom à part de « graphiques » ; boutons du zoom à 24 px ; titres à 13 px et noms des graphes à 10 px ;
  - à 390 × 844, au doigt : double toucher, plein écran carte + graphes quand la carte est hors de vue (depuis « graphiques » et depuis « général »), cadrage sur place sinon.
- `test-fcmax.mjs <port> [<dossier des captures>]` : test de FC max de l'Entraînement (lot B du chantier du 24/10), sur un profil neuf (un second passage sur le même profil échoue : la FC max retenue change les zones), sans réseau. Il vérifie :
  - la tuile « Tests », la liste des tests, la page du protocole (déroulé, bips, graphique annoté à deux graphes, réglages) ; l'échauffement réglé à 3 min, retenu après rechargement ;
  - « Lancer » : Enregistrer ouvert prêt (Entraînement › Tests › FC max), sans compteur, lien vers le protocole ; le type Fractionné rend le compteur ; la case « FC repos » qui mène à sa page ;
  - rejeu ×10 d'une sortie synthétique avec FC : la carte « Test » suit les phases, les signaux sont ceux de `stepFitnessTest` rejoué dans la page, les bips ceux de leurs motifs ; « Analyser » range le test ; titre « Analyse test », onglet « test » et ses deux courbes, « Retenir cette FC max », ligne de la bibliothèque ;
  - à 390 et 320 px : les pages sans débordement.
- `test-fcrepos.mjs <port> [<dossier des captures>]` : test de FC repos de l'Entraînement (24/10), sur un profil neuf, sans réseau, environ 35 s. Pas de ceinture dans le navigateur : la page joue la FC d'exemple de `exampleRestingHr`, à ×1 puis à ×30 (`?vitesse=30`). Il vérifie :
  - la tuile « FC repos » dans Tests, la page (déroulé, et « sans GPS » sous le « ? » du déroulé) ;
  - à ×1 : le décompte de préparation, la mesure (courbe qui se remplit, FC lue, un bip court), « Annuler » qui ne garde rien ;
  - à ×30 : un bip court et un long, la moyenne de 10 s la plus basse et sa fenêtre, **comparées à un calcul refait dans le script** sur la même FC, la courbe de 180 secondes (axe 0:00 à 3:00, fenêtre surlignée), le test gardé (`tracker.restingHr`) ;
  - « La retenir » (FC repos de Pratiquant), « Refaire », « Vos tests » avec sa courbe, « Retirer » ;
  - à 390 et 320 px : les pages sans débordement.

  `innerText` rend les titres et boutons en capitales : les contrôles de texte sont insensibles à la casse. La ceinture elle-même (prise à l'ouverture de la page, bips écran allumé) ne se prouve qu'avec l'APK.
- `general.mjs <port> [<dossier des captures>]` : onglet « général » complet et rangée « avancé » (demande du 22/10), sur un profil neuf, sans réseau, environ 1 min 30. Le script écrit lui-même une wing (la trace de `make-gpx.mjs`), une course et une sortie à vélo en côte, et la matinée de surf de `surf.mjs`, et les importe par la page. Il vérifie :
  - la première rangée « général · avancé », « avancé » fermé au départ, les chiffres du nouveau général dans chaque module (voile : distance en vol, manœuvres réussies, top 2 s et 100 m ; à pied et à vélo : meilleurs segments et profil d'altitude compact ; surf : chiffres réduits) ;
  - « avancé » qui déplie les onglets, puis, refermé, replie rangée et panneaux, rendus à la réouverture ; la flèche qui cache la barre sans toucher aux panneaux ;
  - le réglage du vent sur la carte : flèche tirée à la souris (90°), écrite au lâcher dans le brouillon, « Inverser », « Polaire », « Calculé », « Terminé » ;
  - à 390×844 : aucun débordement, « Régler » qui ouvre la carte en plein écran avec la boussole.

  Les autres scripts ouvrent la rangée « avancé » d'office à chaque page et à chaque session neuve, « général » rouvert avec elle (`Page.addScriptToEvaluateOnNewDocument`, un observateur du bouton « avancé ») : seul celui-ci l'éprouve fermée. Il vérifie aussi qu'ouvrir « avancé » ferme « général » et que le refermer le rouvre, qu'une session neuve s'ouvre sur « général » seul, et que la même session rouverte après une autre page garde son état (23/10).
- `glisser.mjs <port> [<dossier des captures>]` : le bouton glissant qu'on fait glisser (demande du 22/10), sur le Profil (période) et les Statistiques (famille), sur un profil neuf, sans réseau ni session, à 390×844 en écran tactile puis sur ordinateur. Il vérifie :
  - à la souris, la case tenue sur le choix en cours et glissée de deux crans : elle suit le pointeur, le choix sous elle s'allume, rien n'est choisi avant le lâcher, qui prend le choix sous la case ;
  - au doigt, la même chose dans l'autre sens, sans que la page défile de côté ;
  - un toucher sur un autre choix le prend toujours ; un appui qui bouge à peine ne change rien ; un glisser parti d'un autre choix ne déplace pas la case ;
  - Statistiques : l'adresse ne change qu'au lâcher, la vue est retenue au rechargement.
- `racine.mjs <port> [<dossier des captures>]` : la racine du Profil (22/10), sur un profil neuf, sans réseau. Le script écrit lui-même cinq courses de 20 min sur les six derniers jours, un jour manqué, et une sixième aujourd'hui s'il est plus de 0 h 40, importées par la page Course ; il suppose les valeurs d'essai (une période par jour, 15 min, tour en 15, tout perdu en 30). Il vérifie :
  - le carré à droite du pseudo (4,5 étapes) et le canevas dessiné sur toute la page ; la bulle du carré, qu'Échap ferme ;
  - Réglages › Pratiquant : un recul plus fort, la partie sèche, une période de 7 jours (« Cette semaine »), le retour aux valeurs d'essai une fois les champs vidés ;
  - le rejeu à l'ouverture depuis une visite d'hier retenue sur l'appareil, puis rien qui bouge sans changement ;
  - à 390 et 320 px : rien ne déborde, carré et bulle dans l'écran.

  Les valeurs de la racine remises à la semaine, ses chiffres attendus seront à reprendre.
- `racine-periodes.mjs <port> [<dossier des captures>]` : la racine du Profil ne dépend pas de la période (demande du 26/10, lot B), sur un profil neuf, sans réseau, environ 2 min. Treize courses d'un lundi chacune, page à la semaine 13 ; le Profil aux cinq périodes, à 390×844 et 1400×1000 : niveau, longueur visible de la racine mère (`data-longueur` du canevas), hauteurs de la page et des cadres, débordement. Il vérifie que la longueur est la même aux cinq périodes. Avec un dossier, une capture réduite (échelle 0,35) par période et par taille.
- `tailles.mjs <port> <dossier de travail> [<dossier des captures>]` : relevé de toutes les pages à toutes les tailles de téléphone, droit et tourné (point 139 ; mode d'emploi détaillé en tête du fichier), sur un profil neuf, sans réseau, 8 à 12 min. Il importe une session de chaque famille, passe chaque page par douze tailles d'écran (dont 375×834 et 834×375, le téléphone de l'utilisateur) et trois tailles de texte (100, 115, 130 %), et relève : page plus large que l'écran, élément qui en sort, texte coupé, rangée qui défile, cibles qui se recouvrent ; pour information, cibles de moins de 40 px et surface prise par les barres. Une analyse tournée s'ouvre sur sa carte en plein écran : le script la referme avant de mesurer. Il écrit `rapport.md` et `rapport.json`, et la capture de la pire combinaison de chaque page. `SIZES`, `FONTS` et `PAGES` restreignent le relevé.
- `aides.mjs <port> [<dossier des captures>]` : aides « ? » partout et barre du haut (lot 3 des demandes du 24/10, point 148), sur un profil neuf, sans réseau, environ 1 min. Le script écrit lui-même une wing et une course. Il vérifie :
  - course : aucune explication à l'ouverture des graphiques, le « ? » du titre l'ouvre juste sous le titre sans replier le panneau, celui des réglages referme le premier, un second appui referme ;
  - voile : le « ? » des manœuvres, puis celui du vent, qui referme le premier ;
  - Statistiques : la note du graphique sous son « ? » ; passer par Profil et revenir, par la barre, referme l'aide ;
  - barre du haut sans « Accueil », le logo qui y mène, une ligne sans rien de coupé à 1400 et 1000 px (800 px relevé pour information : la barre n'y tient pas) ; « Accueil » dans la barre du bas au téléphone, pas de pop-up du profil dans le navigateur.

  Le pop-up du profil ne paraît que dans l'application : il s'éprouve sur le téléphone.
- `shots.mjs <port> <dossier> <L>x<H>[m] <chemins…>` : captures d'écran ; `m` émule un téléphone (par exemple `390x844m`), toucher compris (pointeur grossier, donc disposition téléphone tournée au-delà de 768 px de large). Variables : `FULL=1` pour la page entière, `SETUP` pour du code à exécuter avant (par exemple remplir `localStorage`), `WAIT` en millisecondes. Le nom de la capture vient du chemin, `?`, `=`, `:` et `&` remplacés.
- `cdp.mjs <ws> <chemins…>` : charge des routes dans la WebView de debug du téléphone et lit la page. On y accède par `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.

« Arrêter » se tient depuis le point 99 (2 s par défaut) : les scripts qui arrêtent un enregistrement le font par `holdStop`, un appui simulé (`pointerdown`, 2,3 s, `pointerup`). L'arrêt du compteur d'intervalles est distinct : tenu 1 s (point 154), simulé à 1,2 s sur `.ivl button.ui-btn--danger` dans `fractionne.mjs`, `compteur-course.mjs` et `timer.mjs`.

## Prouver qu'un changement est neutre

1. Avant le changement : `bench.mjs` avec `DUMP=avant.txt`, sur un profil neuf.
2. Après le changement : la même chose sur un autre profil neuf, avec `DUMP=apres.txt`.
3. Comparer les deux par `diff`. Pour un nettoyage ou une conversion, le texte doit être identique au caractère près (§10, point 44).

## Pièges du poste

Ce que l'agent `banc` et Claude doivent savoir sur ce poste, en plus de la mise en place. Tout est ici et nulle part ailleurs : un sous-agent ne voit pas la mémoire automatique de Claude.

- Brouillon pour les GPX, profils Chrome et relevés : le scratchpad de la session, jamais le dépôt.
- Un serveur lancé en arrière-plan par `npx vite …` survit à l'arrêt de la tâche (seul `npx` s'arrête) : vérifier le port (`netstat -ano`), et tuer le processus node à la fin. Tant qu'il tourne, `npx vitest run` peut échouer sur tous les fichiers (« reading 'config' ») : d'où `verif` et `banc` jamais en même temps.
- Serveur Vite neuf : le premier chargement compile tout et dépasse les 3 s d'attente des scripts (page vide, « Cannot read properties of undefined ») : charger une page une fois avant de lancer un script.
- Deux serveurs Vite sur une même jonction `node_modules` se disputent `node_modules/.vite` (504 « Outdated Optimize Dep ») : donner un `cacheDir` propre au serveur « avant ».
- Le `npm run dev` de l'utilisateur écoute sur `[::1]:5173` (IPv6 seul) : le Chrome du PC l'atteint, pas un `adb reverse` (IPv4). La WebView de l'application refuse le HTTP en clair ; pour un serveur de développement sur le téléphone, passer par Chrome Android (`chrome_devtools_remote`) et un serveur `--host 127.0.0.1` sur un autre port. Ne jamais toucher aux autres onglets de l'utilisateur.
- Sous Git Bash, un argument `/chemin` passé à un script devient un chemin Windows (« Cannot navigate to invalid URL ») : `MSYS_NO_PATHCONV=1`. `DUMP=` et `SHOT=` : chemin relatif au dossier courant ; un chemin `/c/...` sous `MSYS_NO_PATHCONV=1` devient `C:\c\...`.
- `tailles`, `general`, `pentes` prennent le port Chrome en premier argument ; la plupart des scripts n'ont pas d'option `DUMP=` (copies `*-d.mjs` dans le brouillon).
- Le texte de page n'inclut pas un tableau replié : pour les podiums de manœuvres, une copie du script dans le brouillon clique « Détails des manœuvres » avant le relevé.
- `shots.mjs` nomme la capture d'après le chemin : une adresse avec `?session=` donne un nom refusé par Windows ; faire la capture par un petit script du brouillon.
- Grosses captures (images de `partage.mjs`, jusqu'à 1,2 Mo) : lues en taille réelle, elles ont coupé deux sessions (ECONNRESET) ; les réduire d'abord en JPEG de 540 px dans le brouillon (System.Drawing en PowerShell : `Image.FromFile`, `Graphics.DrawImage`, `Save` en JPEG qualité 75), puis lire une copie à la fois.
- Écran du vrai téléphone : `adb exec-out screencap -p > x.png`, puis lecture de l'image (pas de PIL). Prévenir l'utilisateur avant (écran possiblement verrouillé, notifications privées).
- Un heredoc dont le texte compte un nombre impair d'apostrophes échoue sous le Bash de Claude (« unexpected EOF ») : écrire le script dans un fichier du brouillon. Un `\'` à écrire dans un fichier .ts depuis un script Node en heredoc ressort `'` : corriger ces lignes avec l'outil Edit. Un `node -e "…"` en Bash avale les accents graves.
- Rejouer l'analyse hors navigateur, sans Vitest : `node --import <hook>` où le hook (`registerHooks` de `node:module`) ajoute `.ts` aux imports relatifs ; Node lit le TypeScript du projet tel quel. Les sessions réelles du PC se lisent en lecture seule dans la mémoire de l'utilisateur, avec les réglages du hook recopiés.
- Neutralité contre la version commitée sans toucher au dépôt : `git worktree add --detach <brouillon>/avant <commit>`, jonction `node_modules` vers celle du dépôt (`New-Item -ItemType Junction` en PowerShell ; `mklink` sous Git Bash échoue), Vite sur un autre port ; à la fin, retirer la jonction (`rmdir`) **avant** `git worktree remove --force`. Un relevé qui quitte une page à itinéraire non enregistré doit accepter le dialogue `beforeunload`, sinon il se bloque.
- Worktree « avant » à jonction `node_modules` : depuis le 22/10, les polices viennent de `@fontsource` et Vite refuse de les servir (« outside of Vite serving allow list ») ; la version d'avant retombe sur une police de secours et les relevés diffèrent pour rien. Lancer ce serveur avec un `vite.banc.config.ts` posé dans le worktree, qui reprend `./vite.config` et ajoute `server.fs.allow: ['.', 'C:/Users/segne/tracker/node_modules']`. Vérifier par `document.fonts` : tout en `loaded`.
- Overpass (onglet surface) met de quelques secondes à plus d'une minute selon sa charge ; ne pas l'interroger en rafale.
- Un bug non reproduit vient souvent d'un état de l'utilisateur (onglets graphiques ouverts, mémorisés dans `tracker.sections`) : demander tôt l'erreur de console et reproduire son état persistant.

## Scripts à revoir

Notes relevées en mode chaîne (27/10) sur des scripts périmés ou à compléter ; pas des défauts du code.

- `sauts.mjs` échoue des deux côtés sur sa partie Réglages (périmée) ; `reglages.mjs` lit un seuil `undefined` des deux côtés ; `allure-session.mjs` est périmé.
- `cadence.mjs` compare sans la casse depuis le lot 9 (ses deux échecs venaient des capitales de la feuille de style) ; à compléter d'une marche à `cad` 110.
- `pentes.mjs` relève la pente sur le canevas de `TrackSegmentsLayer` (compteurs `traits` et `couleurs` SVG à zéro, légende de pente gardée) ; à compléter d'une sortie vélo à 1 point toutes les 4 s.
- `planning.mjs` attend la fin de « Calcul du tracé… » avant « Enregistrer » (bouton grisé pendant le calcul).
- `fractionne.mjs` en rejeu temps réel donne des vitesses de répétitions qui bougent de 0,1 km/h d'un passage à l'autre (analyse déterministe identique nombre à nombre) : pas un écart.
- Écarts admis depuis le lot 8 (performances) : dernière graduation de cap 242° au lieu de 241° (extrême gardé par la décimation) ; une mention « © OpenStreetMap » de moins quand la carte est agrandie (la carte compacte, cachée dessous, ne dessine plus ses couches).
- `timer.mjs` (10 ok, 36 échecs) et `entrainement.mjs` (1 échec) sont périmés depuis le lot 11 (page Entraînement à deux tuiles « Fractionné et tests » et « Muscu et timer », boutons « Timer » et « Enregistrer » par séance, lien « Enregistrer sans séance ») : mêmes échecs avant et après le lot 15, sans erreur de console ; aucun `DUMP=`. À réécrire sur les pages d'aujourd'hui.
- À ajouter un jour : `trackerBack()` avec un pop-up ouvert et `/essai/erreur` (lot 5).
- `prereglages.mjs` (lot 21) : sur un profil déjà servi (second passage, ou préchauffage du serveur fait sur le même profil), le fichier de réglages du dossier mémoire rend les valeurs du passage d'avant (pause du bateau à 0,5, seuil de Course à 3 de l'étape 6) et 5 à 11 contrôles bateau, kite et Course échouent. Ce n'est pas un défaut : sur un profil neuf, tout passe. Préchauffer le serveur avec un autre profil.
- `charge.mjs` appelle `Network.setBlockedURLs` sans `Network.enable` : rien n'est bloqué, et l'altitude de l'IGN (le vrai relief au nord de Montpellier) remplace la côte à 5 % ; ses chiffres d'énergie restent comparables d'un passage à l'autre, mais pas avec un calcul à la main. `depense.mjs` active le réseau d'abord.
