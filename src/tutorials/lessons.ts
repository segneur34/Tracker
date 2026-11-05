import type { SportFamily } from '../core/sportProfiles';

/**
 * Programme des tutoriels (lot 147, idée 142) : une leçon par nouveau jour
 * d'ouverture de l'application, dans cet ordre, pour faire découvrir ses
 * fonctions de l'enregistrement aux balises d'un parcours. Des données seules,
 * sans React : l'icône est un nom (`components/LessonIcon.tsx`), la page à
 * essayer une adresse ou la bibliothèque de la famille préférée.
 */

/** Icône d'une leçon, dessinée par `components/LessonIcon.tsx`. */
export type LessonIcon =
  | 'enregistrer' | 'analyse' | 'carte' | 'activites' | 'memoire' | 'profil' | 'notes'
  | 'statistiques' | 'itineraires' | 'cardio' | 'fractionne' | 'voile' | 'capteurs' | 'partage';

/** Page ouverte par « Essayer » : une adresse, ou la bibliothèque de la famille préférée (`'bibliotheque'`). */
export type LessonTarget = `/${string}` | 'bibliotheque';

export interface Lesson {
  /** Identifiant, dans l'adresse (`/tutoriels/:id`) et la liste des leçons lues : ne pas le changer. */
  id: string;
  title: string;
  /** Une ligne, sous le titre de la carte du jour et dans la liste. */
  hook: string;
  /** Familles concernées : la leçon est sautée quand elles sont toutes cachées ; aucune, elle vaut pour tous. */
  families?: readonly SportFamily[];
  icon: LessonIcon;
  target: LessonTarget;
  /** Quelques courts paragraphes, en français courant. */
  body: readonly string[];
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'enregistrer',
    title: 'Enregistrer une session',
    hook: "Le bouton rond, le choix de l'activité, puis « Analyser » à la fin.",
    icon: 'enregistrer',
    target: '/enregistrer',
    body: [
      'Le bouton rond, au milieu de la barre du bas, ouvre la page Enregistrer.',
      "Choisissez d'abord l'activité : la liste ne propose que les vôtres, celles de Réglages. Elle se change encore pendant la sortie.",
      "« Démarrer » lance le GPS. L'écran peut s'éteindre, l'enregistrement continue ; un appui long de deux secondes sur le bouton rond met en pause, puis relance.",
      "Pour finir, tenez « Arrêter » appuyé deux secondes : l'appui long évite un arrêt par mégarde. Ces deux durées se règlent dans Réglages › Enregistrement.",
      "À l'arrêt, rien n'est encore rangé : « Analyser » range la session dans la mémoire et l'ouvre, « Jeter » l'abandonne.",
    ],
  },
  {
    id: 'analyse',
    title: 'Lire une analyse',
    hook: '« Général » pour l\'essentiel, « avancé » pour le détail, des panneaux à votre taille.',
    icon: 'analyse',
    target: 'bibliotheque',
    body: [
      "Touchez une session dans la bibliothèque de son sport : son analyse s'ouvre sur l'onglet « général », qui porte l'essentiel des chiffres.",
      "La pastille « avancé » déplie les autres onglets : tops, graphiques, cardio et la suite, selon le sport. Chaque session s'ouvre sur « général » seul ; « tout fermer », à droite de la barre, replie tout d'un geste.",
      'Un panneau se redimensionne en tirant sa poignée ; sa taille est gardée.',
      'Les onglets montrés se choisissent par activité, dans Réglages, ligne « Onglets ».',
      'Les petits « ? » ouvrent une explication sur place ; un second toucher la referme.',
    ],
  },
  {
    id: 'carte',
    title: 'La carte',
    hook: 'Zoomer, passer en plein écran, et lire la vitesse dans les couleurs de la trace.',
    icon: 'carte',
    target: 'bibliotheque',
    body: [
      "La trace est colorée par la vitesse : grise quand vous allez lentement, puis un dégradé jusqu'aux plus grandes vitesses. Les bornes se règlent par activité dans Réglages, ou pour une seule session dans son onglet « réglages ».",
      'Deux doigts pour zoomer, un pour se déplacer. Sur le téléphone, un toucher sur la carte l\'ouvre en plein écran ; tourné, il s\'y met de lui-même. Le retour la referme.',
      'Sous un graphe, « +carte » ouvre la carte avec les graphes dessous : le doigt posé sur un graphe montre le point sur la trace.',
      'Le bouton sous le + et le − passe du plan à la photo satellite.',
    ],
  },
  {
    id: 'activites',
    title: 'Vos activités',
    hook: "Créer les vôtres, choisir leur couleur, les cacher d'un œil.",
    icon: 'activites',
    target: '/parametres',
    body: [
      'Dans Réglages › Activités, chaque famille (voile, à pied, vélo, surf, entraînement) range ses activités. Seules celles-là sont proposées partout : à l\'enregistrement, dans les analyses, les bibliothèques et l\'accueil.',
      "Au bas du bloc, créez la vôtre : un nom, une couleur parmi les nuances de sa famille, et le calcul sur lequel elle repose (wingfoil, course, VTT…).",
      "L'œil cache une activité, ou une famille entière : elle disparaît partout, sessions comprises, sans rien effacer.",
      'Chaque activité démarre sur des réglages tout faits ; « Par défaut », dans le menu « … » de sa carte, les lui rend.',
    ],
  },
  {
    id: 'memoire',
    title: 'Le dossier mémoire',
    hook: 'Où sont vos sessions, et comment les garder.',
    icon: 'memoire',
    target: '/parametres',
    body: [
      'Sur le téléphone, vos sessions vivent dans un dossier « Tracker » que vous désignez dans Réglages › Mémoire : pour chacune, son fichier GPX et sa fiche (notes, matériel, réglages de la session).',
      'Ce dossier est votre sauvegarde : copiez-le sur un ordinateur ou un disque pour tout garder, ou pour changer de téléphone.',
      "Deux appareils peuvent partager le même dossier. Chacun y garde son fichier de réglages ; « Reprendre », dans Réglages › Mémoire, prend ceux d'un autre appareil.",
      "Pour ajouter des sessions venues d'ailleurs, « Importer des GPX » est dans le « … » en haut de chaque bibliothèque.",
    ],
  },
  {
    id: 'profil',
    title: 'Le Profil',
    hook: 'La racine qui pousse à chaque semaine tenue, et sa fleur.',
    icon: 'profil',
    target: '/profil',
    body: [
      'Le Profil résume vos activités sur la période choisie : distance, dénivelé, sport préféré et temps par activité.',
      'Autour des cadres pousse une racine : elle gagne une étape à chaque semaine où vous tenez votre objectif, et fait le tour de la page en 26 semaines. Des semaines manquées la font reculer.',
      "Au-dessus du sol, la pousse fleurit avec le temps de la semaine : un bouton, une fleur ouverte à l'objectif, épanouie à 4 fois l'objectif ; au-delà, un papillon vient s'y poser.",
      'Touchez le carré à droite du pseudo : une bulle dit où vous en êtes et ce qu\'il reste à faire.',
      "L'objectif par semaine se règle dans Réglages › Pratiquant (45 min au départ).",
    ],
  },
  {
    id: 'notes',
    title: 'Matériel et notes',
    hook: 'Une appréciation, un commentaire et le matériel de chaque session.',
    icon: 'notes',
    target: 'bibliotheque',
    body: [
      "Dans chaque analyse, l'onglet « matériel et notes » (« matos et conditions » en voile), juste avant « réglages », garde votre appréciation de la séance et un commentaire.",
      'Le matériel se choisit dans la liste de l\'activité, que vous créez dans Réglages (« Créer liste matériel ») ; une session sans matériel donné reste vide, rien n\'est repris d\'une autre.',
      "Rien n'est écrit avant « Enregistrer la session » : « Annuler » rend la session telle qu'elle était, et l'application prévient si vous quittez sans enregistrer.",
      'Le matériel noté se retrouve dans les Statistiques, qui le croisent avec vos chiffres.',
    ],
  },
  {
    id: 'statistiques',
    title: 'Statistiques',
    hook: 'Vos sessions mises ensemble : chiffres, graphique, régularité.',
    icon: 'statistiques',
    target: '/statistiques',
    body: [
      'Statistiques rassemble toutes vos sessions. Choisissez la famille, puis l\'activité, le matériel et la période : tous les chiffres suivent.',
      'Le graphique montre la donnée de votre choix au fil du temps.',
      '« Régularité » compte vos semaines actives, votre plus longue série et celle en cours.',
      'Le retour remonte d\'un cran à chaque fois : de l\'activité à la famille, puis à la vue d\'ensemble.',
    ],
  },
  {
    id: 'itineraires',
    title: 'Planifier un parcours',
    hook: "Tracer un itinéraire, puis le suivre à l'enregistrement.",
    icon: 'itineraires',
    target: '/itineraires',
    body: [
      "Depuis l'accueil, « Créer un parcours » ouvre la planification : posez des points sur la carte, le tracé suit les chemins qui conviennent à l'activité choisie.",
      'Le tracé donne la distance, le dénivelé et le temps estimé ; « Boucle » vous ramène au départ par un autre chemin.',
      "Rangé, l'itinéraire se retrouve dans « Itinéraires planifiés ». À l'enregistrement, « Suivre une trace » le propose, avec son activité.",
      "Un GPX venu d'ailleurs se charge aussi comme itinéraire, et un tracé s'exporte en GPX.",
    ],
  },
  {
    id: 'cardio',
    title: 'Ceinture cardio et zones',
    hook: 'La ceinture, vos fréquences cardiaques et les tests guidés.',
    icon: 'cardio',
    target: '/fractionne/seances',
    body: [
      "Une ceinture cardio Bluetooth se relie dans Réglages › Capteurs ; une fois retenue, l'enregistrement la reprend.",
      'Dans Réglages › Pratiquant, la FC max et la FC de repos fixent vos zones cardiaques, et leurs seuils se règlent au même endroit. Sans FC max, elle est estimée par l\'âge.',
      'Deux tests guidés les mesurent : la FC max, une course de plus en plus rapide annoncée par des bips, et la FC de repos, trois minutes immobile. Ils sont dans Entraînement, sous « Fractionné et tests ».',
      "L'onglet « cardio » des analyses montre le temps passé dans chaque zone.",
    ],
  },
  {
    id: 'fractionne',
    title: 'Le fractionné',
    hook: 'Des séances à répétitions, et un compteur qui vous guide.',
    families: ['fractionne'],
    icon: 'fractionne',
    target: '/fractionne',
    body: [
      "Dans Entraînement, « Fractionné et tests » range vos séances : échauffement, répétitions d'effort et de récupération, retour au calme.",
      'Chaque phase se règle en durée ou en distance, avec la zone à tenir.',
      "À l'enregistrement, choisissez la séance : le compteur annonce chaque phase par des bips, écran éteint compris.",
      "L'onglet « fractionné » de l'analyse détaille chaque répétition.",
      "À côté, le Timer enchaîne des temps d'effort et de repos sans GPS, pour la musculation.",
    ],
  },
  {
    id: 'voile',
    title: 'La voile',
    hook: "Le vent, les virements et empannages, et les balises d'un parcours.",
    families: ['voile'],
    icon: 'voile',
    target: '/voile',
    body: [
      "Une session de voile s'analyse sans rien saisir : le vent est estimé d'après vos manœuvres et vos vitesses selon le cap.",
      'Si vous le connaissez, saisissez-le (« Régler ») : tous les angles suivent.',
      "L'onglet « manœuvres » compte les virements et les empannages, réussis ou ratés, avec la vitesse gardée ; « vmg » montre ce que vous gagnez face au vent ou sous le vent.",
      "Le seuil de vitesse sépare le temps en action du temps à l'arrêt ; il suit l'allure de la session, et se règle dans l'onglet « réglages ».",
      "Pour une régate ou un entraînement, la planification pose des balises numérotées ; à l'enregistrement, des bips annoncent l'approche de chacune.",
    ],
  },
  {
    id: 'capteurs',
    title: 'Sauts et pumping',
    hook: 'Les capteurs du téléphone mesurent vos sauts et votre pumping.',
    families: ['voile', 'velo'],
    icon: 'capteurs',
    target: '/parametres',
    body: [
      'Le téléphone porte des capteurs de mouvement : Tracker s\'en sert pour mesurer la hauteur et la durée de vos sauts, en wing, en kite ou en VTT.',
      "La case « Mesurer les sauts » se coche par activité, dans Réglages ; elle est alors proposée à l'enregistrement, et l'onglet « sauts » de l'analyse les liste.",
      "Sur foil, le pumping (coups, fréquence, décollage de chaque vol) se mesure téléphone fixé sur la poitrine : cochez « Pumping foil » sur l'activité, puis « Mesurer le pumping » dans Enregistrer.",
    ],
  },
  {
    id: 'partage',
    title: 'Partager et exporter',
    hook: 'Une image de votre session, ou son fichier GPX.',
    icon: 'partage',
    target: 'bibliotheque',
    body: [
      'Dans une analyse, le « … » à côté du nom de la session propose « Partager » : une image carrée de la trace et des chiffres que vous choisissez, avec ou sans fond de carte.',
      "Vos choix de chiffres sont retenus par activité ; « Partager » est aussi proposé à la fin d'un enregistrement.",
      "« Télécharger la session » range son fichier GPX dans Téléchargements : il s'ouvre dans les autres applications, et Tracker le relit tout entier, notes comprises.",
    ],
  },
];
