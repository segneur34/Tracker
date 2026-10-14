# Décisions de l'utilisateur, par domaine

Sorties de `CLAUDE.md` le 14/10/2026 (§10, point 102), mot pour mot, pour alléger ce qui se charge à chaque conversation. Elles ont la même autorité : rien ne s'y change sans l'utilisateur. Les décisions transverses (couleur de la trace, brouillon d'une session, disposition des analyses et leurs onglets, activités, navigation, réglages d'affichage, surbrillances, DA) restent dans `CLAUDE.md`. Une décision nouvelle propre à un domaine s'ajoute à sa section.

## 1. Voile

Les onglets de l'analyse de voile sont dans `CLAUDE.md` (décision « Voile », transverse aux analyses) ; le zoom des graphes de vitesse et du vent, au §2.

- Courbe du vent : toute la session, par toutes les manœuvres sans exception, valeur la plus proche aux bords, coupure au-delà de 30 min sans manœuvre.
- Une seule notion de réussite : le vent est estimé au seuil d'activité effectif, surcharge comprise (bouger le seuil recalcule le vent, c'est accepté).
- Manœuvres : gain au vent = chemin pendant la rotation, vers le vent au virement, sous le vent à l'empannage, le plus grand en tête ; pas de podium du changement de cap aux empannages ; pas de ligne « distance perdue ».
- Foil : case de toute activité de voile, bateau compris (cochée d'office en wingfoil), et valeur par session dans l'onglet réglages de l'analyse. Sur foil : « Ratio de vol », champs Foil et Mât ; elle ne touche ni au seuil d'activité ni à ses suggestions.
- Balises en voile : un itinéraire de voile est un parcours de balises numérotées, en ligne droite. En navigation, chaque balise, départ compris, se valide en passant près d'elle, dans l'ordre (« Passer » la saute). Bips de plus en plus rapides à l'approche, et vibration réglable, joués par Android écran éteint. La courbe des bips se règle par activité dans Réglages ; un parcours peut avoir la sienne, dans sa fiche, qui prime.

## 2. Course et vélo

- Graphes course « superposés » à deux axes, voulus malgré la difficulté de lecture. Courbe d'altitude et aire dessous colorées par la raideur de la pente, montée ou descente confondues, sur la palette de la trace, de 0 à 25 % par défaut (0 à 15 % à vélo), bornes réglables par activité dans Réglages. Graphes de vitesse et d'altitude (analyse et planification), de vitesse et du vent en voile (un zoom commun, axe en heure du jour), zoomables : pincer à deux doigts sur téléphone, tirer une zone à la souris sur ordinateur, « Tout voir » ; un doigt garde le survol, la souris qui quitte un graphe efface le repère.
- Vélo : famille propre, jamais un calcul rangé sous Course. Énergie : en course, Minetti à l'économie du coureur ; à vélo, modèle physique, type (pneus) et poids du vélo par activité, roulement selon le revêtement de chaque segment, Crr moyen du vélo là où il est inconnu ; le temps estimé des itinéraires garde le Crr moyen ; un seul profil « Pratiquant ». La puissance affichée est mécanique dans les deux (rendement 0,25 en course).
- Altitude, en course et à vélo : celle du terrain (IGN, RGE ALTI) par défaut, rangée dans la fiche de la session, jamais dans le GPX ; un point tous les 5, 10 ou 20 m (10 d'office), réglé par activité ; « Altitude : IGN / GPS » par session, dans l'onglet réglages de l'analyse, appliqué tout de suite. Demandée à l'ouverture de l'analyse, jamais au balayage de la bibliothèque. Rien en voile.
- Surface : barre de revêtement à la Komoot (`planning/surface.ts`), en planification (voies rendues par BRouter) et dans l'onglet « surface » de Course et Vélo (voies d'Overpass, demandées à sa première ouverture, à vélo dès l'ouverture de l'analyse pour l'énergie, puis rangées dans la fiche). Ligne droite et GPX importé donnent « Inconnu » ; un itinéraire rangé sans revêtement propose « Calculer ». « Voir sur la carte », dans l'onglet, colore la trace par revêtement tant qu'il est ouvert. Le survol d'un type, dans la barre ou sa légende, dit son nom et sa longueur ; un clic le met en violet sur la carte (un rond au milieu des morceaux trop courts pour se voir), un second l'efface. Rien en voile.
- Analyses de course et de vélo : « Voir » d'une zone de pente la montre sur la carte, en violet. « Voir sur la carte », sous le graphe d'altitude, colore la trace par la pente (couleurs et bornes de la courbe), et de même en planification sous le graphe du dénivelé ; pente et revêtement s'excluent. Énergie : puissance moyenne par zone de pente ; le tableau des zones se replie à sa place.

## 3. Sauts

- Sauts, en voile, en course et à vélo : mesurés par l'accéléromètre et le gyroscope du téléphone fixé au corps (« Mesurer les sauts » sur Enregistrer, Android seulement), réglés par activité dans Réglages (case « Sauts », emplacement, hauteur minimale ; ni en bateau ni en fractionné). Toute la séance est enregistrée, puis élaguée à « Analyser » autour de ce qui ressemble à un saut. Hauteur du buste depuis son niveau au décollage, sur foil aussi. Onglet « sauts » entre VMG et vent en voile, entre « vitesse et altitude » et réglages à terre, visible si la session a ses capteurs.

## 4. Surf

- Surf : une famille et un traitement à part (ni vent, ni dénivelé, ni énergie, pas de planification, pause automatique coupée d'office), un seul calcul « Surf » avec la case Foil par activité et par session ; activités de départ « Surf » et « Surf foil ».
  - Analyse : onglets général, vagues, rame, vols (sur foil), graphiques, réglages. Vague : au-dessus du seuil de vague ; retour au pic : de la fin d'une vague à la première attente ; sur foil, un vol relie les vagues, passages au-dessus du seuil de vague en foil, le reste est pompé. Le seuil par défaut suit le foil (vague ou vol). Seuils réglables par activité et par session.
  - Virages : au GPS, seuls les grands changements de direction, affichés comme expérimentaux ; les vrais virages viendront du gyroscope.

## 5. Fractionné

- Fractionné : une famille à part, de deux calculs, à pied (traité comme la course) et à vélo (comme le vélo) ; pause automatique coupée d'office, pas de planification.
  - Compteur d'intervalles dans Enregistrer : répétitions, travail, repos, séances gardées pour être reprises toutes faites ; avec ou sans enregistrement ; il suit l'horloge, et Android joue les sons écran éteint. Signaux : compte à rebours de 3 s, fin de chaque phase par court, court, long (le long finit au changement), fin de séance par court, long, long double, « Passer » par un long.
  - Analyse : onglet « fractionné » (synthèse, tableau avec une mini-courbe par répétition à la même échelle, évolution des répétitions, profil moyen). Chaque séance se replie par son titre, dans les trois panneaux à la fois ; ses répétitions vont du vert (la première) au rouge (la dernière), par l'orange. Sans compteur, en famille Fractionné seulement, les répétitions sont retrouvées dans la vitesse, avec un seuil d'effort tiré de la session et réglable par session.

## 6. Enregistrement

- Enregistrement : brut à 1 Hz, sans autre filtre que les redélivrances et la pause (manuelle, par appui long de 2 s réglable sur le bouton rond, ou automatique sur immobilité, réglable par activité) ; « Arrêter » se tient aussi, 2 s par défaut, durée propre réglable dans Réglages (0 : simple appui) ; un GPX par session, analysé par les modules existants via `loadGpxContent`. À l'arrêt, rien n'est rangé : « Analyser » range la session, « Jeter » l'abandonne ; d'ici là elle attend, journal gardé.

## 7. Planification et itinéraires

- Itinéraire tiré d'un GPX téléchargé : la trace est gardée telle quelle entre départ et arrivée (tronçons `imported`) ; seul un point déplacé en refait les tronçons.
- Itinéraires planifiés : l'accueil montre les 3 derniers, sa carte mène à la liste complète (tris, onglets d'activité) ; Voile, Course et Vélo ont « Réalisées / Planifiées ». « Partir » ouvre Enregistrer, trace suivie et activité choisies, sans démarrer.
- Planification :
  - on coche un ou plusieurs types de voie (Sentier, Piste, Route, Grande route), pas le moyen de transport, par un profil BRouter maison ; les règles d'accès suivent l'activité (piéton ou vélo) ;
  - chaque activité coche d'office les siens, réglés dans sa carte de Réglages, sinon tirés du type de vélo ou du terrain ;
  - les cases valent pour tout l'itinéraire : les changer, directement ou en changeant d'activité, recalcule aussitôt chaque tronçon calculé (une trace importée ne bouge pas), « Précédent » rend cases et tracé ;
  - chaque voie est rangée selon ce qu'elle est (revêtement), pas sa seule étiquette OSM. À vélo, un type non coché plus facile reste permis et un plus dur est évité selon l'écart ; à pied, tous se valent ; une grande route non cochée est toujours évitée. Coûts fixés avec l'utilisateur (HISTORIQUE point 80) : ne pas les retoucher sans lui ;
  - l'activité (liste par famille) et les types de voie se choisissent au-dessus de la carte ; dessous, des onglets comme dans les analyses (général, surface, tracé, points, enregistrer, mes itinéraires ; en voile parcours et balises), seul le premier ouvert par défaut ;
  - tracé et points intermédiaires toujours en bleu, quelle que soit l'activité, sauf le temps de « Voir sur la carte » du revêtement ; départ en vert, arrivée en rouge ;
  - temps estimé selon un niveau par activité (débutant à expert, ou vitesse personnalisée) : km-effort en course, modèle physique à vélo, rien en voile ;
  - mode « Boucle », bouton à bascule (course, vélo) : on pose l'aller, l'itinéraire reste bouclé, A reste le départ. Le retour évite les voies de l'aller sans dépasser 1,5 fois sa longueur (réglable par activité), sinon c'est le plus court, qu'on modèle en posant des points dessus ; « Autre retour » en donne une variante ; éteint, le retour est retiré. Jamais de boucle générée depuis une distance.

## 8. Mémoire et fichiers

- Mémoire : un dossier portable `Tracker/` (GPX + fiche JSON par session dans `sessions/`, un fichier de réglages par appareil dans `reglages/`), qu'on copie pour sauvegarder ou changer d'appareil ; pas d'index dans le dossier. Chaque appareil écrit le sien et ne prend jamais de lui-même ceux d'un autre : on choisit le fichier à reprendre (« Reprendre », Réglages › Mémoire) ; un fichier jamais vu est proposé une fois par un bandeau ; seul un appareil neuf reprend tout seul le plus récent. Sur le PC, l'utilisateur reste sur Firefox (mémoire du navigateur, sans dossier) : il y passe les réglages par « Importer un fichier de réglages ». « Mettre à jour » le relit sans relancer, dans Réglages › Mémoire, avec « Ajouter les sessions d'un dossier ». Dans les bibliothèques, imports et « Mettre à jour » sont derrière un « … » en haut à droite, et la carte de la mémoire n'apparaît que s'il y a quelque chose à dire ou à faire. Une session dont l'activité est inconnue la demande avant l'analyse. Sur Android, dossier désigné par le sélecteur d'Android (SAF), jamais « accès à tous les fichiers ». Suite de la cible mobile dans l'ordre fixé au §12 de l'état.
- GPX d'une session : « Télécharger la session », depuis son analyse, par le « … » à côté de « Renommer », dans Téléchargements, téléphone compris. Une session nommée part sous `AAAA-MM-JJ Activité - Nom.gpx`, son nom écrit dans le GPX (métadonnées et trace). Un seul GPX complet : points tels que rangés (altitude IGN non comprise), fiche et capteurs dans une extension que les autres applications ignorent (`library/sessionBundle.ts`). « Importer des GPX » le range tout entier ; une session déjà présente voit sa fiche complétée, jamais écrasée.
- Cartes hors ligne : chaque tuile vue en ligne est gardée sur l'appareil, sans bouton ni limite de durée (plafond et « Vider » dans Réglages) ; jamais de téléchargement de zone à l'avance, interdit par OSM.
