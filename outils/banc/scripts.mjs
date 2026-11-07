// Registre des scripts du banc qui pilotent un Chrome sans fenêtre, lu par `passe.mjs`.
// Hors registre : `make-gpx.mjs` (fabrique la trace), `charge-ts.mjs` et `*-diagnostic.mjs` (sans navigateur),
// `cdp.mjs` (WebView du téléphone), `shots.mjs` (chemins en arguments).
//
// Champs d'une entrée :
//  - `nom` : le fichier `<nom>.mjs` de `outils/banc/` ;
//  - `args` : gabarits des arguments, dans l'ordre du script : `{port}` port Chrome, `{gpx}` la trace de
//    `make-gpx.mjs` fabriquée une fois par passage, `{gpx2}` la même décalée d'une heure, `{dossierGpx}` le dossier
//    des GPX faits à la main (`--gpx`), `{travail}` dossier de travail propre au script et au côté, `{captures}`
//    dossier des captures ; `{captures?}` (en dernier seulement) n'est passé qu'avec `--captures`, sinon retiré ;
//  - `env` : variables ajoutées ;
//  - `pages` : étiquettes pour `--pages` (voile, course, velo, surf, fractionne, enregistrer, bibliotheque,
//    planification, statistiques, profil, reglages, accueil) ;
//  - `solo` : temps réel (rejeu ×1, minuteries) : lancé seul, à la fin ;
//  - `reseau` : dépend d'un service extérieur (Overpass, IGN, BRouter, tuiles) : écarté par `--sans-reseau` ;
//  - `sansCache` : relevé qui varie d'un jour à l'autre, jamais réutilisé ;
//  - `dev` : importe `/src/...` dans la page (le lanceur sert toujours par le serveur de développement) ;
//  - `masques` : [regex, remplacement] appliqués à la sortie avant comparaison (durées, horodatages) ;
//  - `releve` : fichiers du dossier de travail ajoutés au relevé ;
//  - `delaiMin` : délai maximal en minutes (10 par défaut) ;
//  - `accelerable` : le script lit `TEMPS` (attentes raccourcies, sortie inchangée sous horloge accélérée) :
//    `compteur-course`, `notes`, `test-fcmax` (29/10), `carte-direct` (31/10) ; les autres scripts `solo` restent à temps réel (LISEZMOI) ;
//  - `manuel` : raison pour laquelle le lanceur ne sait pas le lancer seul (lancé seulement si nommé, sauf
//    `{dossierGpx}` : lancé avec `--gpx`).

const ms = [/\d+(?:[.,]\d+)? ?ms\b/g, 'N ms'];
// Heure murale d'un repère (heure de la page au moment de la note : jamais la même d'un passage à l'autre).
const heure = [/\b\d{2}:\d{2}:\d{2}\b/g, 'HEURE'];

export const SCRIPTS = [
  { nom: 'activite', args: ['{port}', '{gpx}', '{captures?}'], pages: ['enregistrer', 'voile', 'course', 'planification'] },
  { nom: 'aides', args: ['{port}', '{captures?}'], pages: ['course', 'voile', 'statistiques', 'profil', 'accueil'] },
  { nom: 'allure-session', args: ['{port}', '{gpx}', '{gpx2}'], pages: ['voile', 'enregistrer'] },
  { nom: 'altitude', args: ['{port}', '{travail}', '{captures?}'], pages: ['course', 'reglages'], reseau: true },
  // À propos et licences de Réglages (lot 151) : `fetch` remplacé par une liste synthétique, puis le repli sans `licences.json`.
  { nom: 'apropos', args: ['{port}', '{captures?}'], pages: ['reglages'] },
  { nom: 'balises', args: ['{port}', '{travail}', '{captures?}'], pages: ['planification', 'enregistrer', 'reglages', 'voile'], solo: true },
  { nom: 'barre', args: ['{port}', '{captures?}'], pages: ['course', 'voile', 'statistiques'] },
  { nom: 'bench', args: ['{port}', 'analyse', '{gpx}'], pages: ['enregistrer', 'voile'] },
  { nom: 'boucle', args: ['{port}', '{captures?}'], pages: ['planification'], reseau: true },
  { nom: 'brouillon-voile', args: ['{port}', '{travail}'], pages: ['voile'] },
  { nom: 'cacher', args: ['{port}', '{captures?}'], pages: ['reglages', 'accueil', 'bibliotheque', 'enregistrer', 'velo', 'surf'] },
  { nom: 'cadence', args: ['{port}', '{captures?}'], pages: ['course', 'fractionne', 'statistiques', 'reglages'] },
  // Mesure (lot 73) : couches de la carte, histogramme du canevas de la trace, durées des zooms et déplacements (en s, changent à chaque passage) ;
  // requêtes de tuiles pendant les gestes, fausses tuiles servies en 400 ms (lot 74).
  // Carte du direct en pause manuelle, trous de position et page cachée (lot 104) ; relevés détaillés sur la sortie d'erreur.
  { nom: 'carte-direct', args: ['{port}', '{travail}'], pages: ['enregistrer', 'course'], solo: true, accelerable: true },
  { nom: 'carte-perf', args: ['{port}', '{travail}', '{captures?}'], pages: ['course', 'bibliotheque'], sansCache: true, delaiMin: 15 },
  // Le fond de carte revient seul après une veille : tuiles coupées, cases en échec, page cachée puis gelée ; relevés détaillés sur la sortie d'erreur.
  { nom: 'carte-reveil', args: ['{port}', '{travail}'], pages: ['course'], solo: true },
  { nom: 'cardio', args: ['{port}', '{captures?}'], pages: ['course', 'surf', 'fractionne', 'voile', 'reglages', 'statistiques'] },
  // Sans `Network.enable`, rien n'est bloqué : l'altitude de l'IGN remplace la côte (SCRIPTS.md, « Scripts à revoir »).
  { nom: 'charge', args: ['{port}', '{captures?}'], pages: ['course', 'velo', 'reglages'], reseau: true },
  { nom: 'chrono', args: ['{port}', '{captures?}'], pages: ['enregistrer'], solo: true },
  { nom: 'classer', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'course', 'velo'] },
  { nom: 'compteur-course', args: ['{port}', '{travail}', '{captures?}'], pages: ['enregistrer', 'fractionne', 'course'], solo: true, accelerable: true },
  { nom: 'coquille', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'velo', 'surf', 'fractionne'] },
  { nom: 'denivele-direct', args: ['{port}', '{travail}', '{captures?}'], pages: ['enregistrer'], solo: true },
  { nom: 'depense', args: ['{port}', '{captures?}'], pages: ['course', 'reglages'] },
  { nom: 'donnees', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'velo', 'accueil', 'profil'], dev: true },
  { nom: 'entrainement', args: ['{port}', '{captures?}'], pages: ['fractionne', 'enregistrer', 'reglages', 'accueil'] },
  { nom: 'familles', args: ['{port}', '{captures?}'], pages: ['reglages'] },
  // Mesure (lot 114) : fluidité, ouverture d'une longue voile, seuil changé, zoom d'un graphe, résumés refaits, démarrage ; ×1 puis processeur ralenti ×6, en s ; seul (tâches longues et images par seconde), environ 12 min.
  { nom: 'fluidite', args: ['{port}', '{travail}', '{captures?}'], pages: ['voile', 'course', 'accueil', 'bibliotheque'], solo: true, sansCache: true, delaiMin: 45 },
  { nom: 'fractionne', args: ['{port}', '{travail}', '{captures?}'], pages: ['fractionne', 'enregistrer', 'reglages', 'accueil'], solo: true },
  { nom: 'general', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'velo', 'surf'] },
  { nom: 'glisser', args: ['{port}', '{captures?}'], pages: ['profil', 'statistiques'] },
  // GPS perdu (lot 115) : rejeu ×1 avec un trou de 90 s ; alerte, son unique et notification, puis tout effacé au retour.
  { nom: 'gps-perdu', args: ['{port}', '{travail}'], pages: ['enregistrer'], solo: true },
  { nom: 'graphes', args: ['{port}', '{captures?}'], pages: ['course', 'surf', 'voile'] },
  { nom: 'icones', args: ['{port}', '{captures?}'], pages: ['accueil', 'bibliotheque', 'reglages'] },
  // Fichiers FIT de montre (lot 35) : FIT fabriqués, chiffres et FC à l'écran, doublon, refus, question du dossier.
  { nom: 'import-fit', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'course'] },
  // Fichier reçu d'une autre application (lot 35) : bandeau, sur une fausse file privée à la place du greffon ; l'intention d'Android ne se prouve qu'au téléphone.
  { nom: 'fichier-recu', args: ['{port}', '{captures?}'], pages: ['bibliotheque', 'accueil', 'course'], dev: true },
  { nom: 'imports', args: ['{port}', '{captures?}'], pages: ['bibliotheque', 'voile', 'course', 'velo', 'surf'] },
  { nom: 'library', args: ['{port}', '{dossierGpx}', '{captures?}'], pages: ['bibliotheque', 'reglages'],
    manuel: 'il faut voile.gpx, course.gpx et sans-type.gpx dans le dossier de --gpx' },
  { nom: 'library2', args: ['{port}', '{travail}'], pages: ['bibliotheque', 'reglages'],
    manuel: 'à lancer après library.mjs, sur le même profil Chrome' },
  { nom: 'library3', args: ['{port}', '{dossierGpx}'], pages: ['bibliotheque', 'course'],
    manuel: 'il faut course.gpx dans le dossier de --gpx' },
  { nom: 'marche', args: ['{port}', '{captures?}'], pages: ['reglages', 'enregistrer'] },
  { nom: 'materiel', args: ['{port}', '{captures?}'], pages: ['course', 'velo', 'surf', 'reglages'] },
  { nom: 'materiel-fin', args: ['{port}', '{travail}', '{captures?}'], pages: ['enregistrer', 'course'], solo: true, accelerable: true },
  { nom: 'miseajour', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'reglages'] },
  { nom: 'muscu', args: ['{port}', '{captures?}'], pages: ['fractionne'] },
  { nom: 'notes', args: ['{port}', '{travail}', '{captures?}'], pages: ['enregistrer', 'course', 'voile', 'surf'], solo: true, accelerable: true, masques: [heure] },
  { nom: 'notification', args: ['{port}', '{travail}'], pages: ['reglages', 'enregistrer', 'fractionne'], solo: true },
  { nom: 'onglets', args: ['{port}', '{captures?}'], pages: ['course', 'velo', 'surf', 'voile', 'reglages'] },
  // Fond de l'image de partage : les tuiles d'OpenStreetMap.
  { nom: 'partage', args: ['{port}', '{travail}', '{captures?}'], pages: ['course', 'voile', 'enregistrer'], reseau: true },
  { nom: 'pentes', args: ['{port}', '{travail}', '{captures?}'], pages: ['course', 'velo', 'planification'], reseau: true },
  { nom: 'planning', args: ['{port}', '{dossierGpx}', '{captures?}'], pages: ['planification'],
    manuel: 'il faut sans-heure.gpx, route-rte.gpx, boucle.gpx et pas-un-gpx.gpx dans le dossier de --gpx' },
  { nom: 'planification-verrou', args: ['{port}', '{captures?}'], pages: ['planification'] },
  { nom: 'prereglages', args: ['{port}', '{captures?}'], pages: ['reglages', 'voile', 'course'] },
  { nom: 'profil', args: ['{port}', '{captures?}'], pages: ['profil', 'accueil', 'bibliotheque'] },
  { nom: 'pumping', args: ['{port}', '{captures?}'], pages: ['surf', 'reglages'], dev: true },
  { nom: 'racine-periodes', args: ['{port}', '{captures?}'], pages: ['profil'] },
  { nom: 'racine', args: ['{port}', '{captures?}'], pages: ['profil', 'reglages'] },
  { nom: 'recherche-sans-reponse', args: ['{port}', '{travail}'], pages: ['course'], reseau: true },
  { nom: 'reduire', args: ['{port}', '{captures?}'], pages: ['reglages', 'profil'] },
  { nom: 'rendus', args: ['{port}', '{travail}'], pages: ['enregistrer'], solo: true,
    manuel: "une mesure, pas une preuve de neutralité : les comptes de rendus varient de quelques unités d'un passage à l'autre" },
  { nom: 'reglages-aide', args: ['{port}', '{captures?}'], pages: ['reglages', 'planification'] },
  { nom: 'reglages', args: ['{port}', '{captures?}'], pages: ['reglages'] },
  { nom: 'rename', args: ['{port}', '{gpx}'], pages: ['bibliotheque', 'voile'] },
  { nom: 'roulement', args: ['{port}', '{travail}', '{captures?}'], pages: ['velo'], reseau: true },
  { nom: 'satellite', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'velo', 'surf', 'bibliotheque', 'planification'], reseau: true },
  { nom: 'sauts', args: ['{port}', '{captures?}'], pages: ['voile', 'reglages', 'bibliotheque'], dev: true },
  { nom: 'session-save', args: ['{port}', '{gpx}'], pages: ['voile'] },
  { nom: 'session-save-resume', args: ['{port}'], pages: ['voile'],
    manuel: 'à lancer après session-save.mjs, sur le même profil Chrome' },
  { nom: 'statistiques', args: ['{port}', '{captures?}'], pages: ['statistiques', 'voile'] },
  { nom: 'surf', args: ['{port}', '{captures?}'], pages: ['surf', 'accueil', 'reglages', 'bibliotheque'] },
  { nom: 'surface', args: ['{port}', '{travail}', '{captures?}'], pages: ['planification', 'course'], reseau: true },
  { nom: 'survol', args: ['{port}', '{travail}', '{captures?}'], pages: ['course', 'voile'], masques: [ms] },
  { nom: 'tailles', args: ['{port}', '{travail}', '{captures?}'],
    pages: ['voile', 'course', 'velo', 'surf', 'fractionne', 'enregistrer', 'bibliotheque', 'planification', 'statistiques', 'profil', 'reglages', 'accueil'],
    sansCache: true, releve: ['rapport.md'], delaiMin: 20 },
  { nom: 'fc-repos', args: ['{port}', '{captures?}'], pages: ['fractionne'], solo: true },
  { nom: 'test-fcmax', args: ['{port}', '{captures?}'], pages: ['fractionne', 'enregistrer'], solo: true, dev: true, accelerable: true },
  { nom: 'test-fcrepos', args: ['{port}', '{captures?}'], pages: ['fractionne'], solo: true },
  { nom: 'timer', args: ['{port}', '{captures?}'], pages: ['fractionne', 'enregistrer'], solo: true },
  // Carte du direct sur un itinéraire suivi : hors-piste sans saut, attributs SVG des tracés en plan et en satellite.
  { nom: 'trace-suivie', args: ['{port}', '{travail}', '{captures?}'], pages: ['enregistrer', 'course', 'planification'], solo: true },
  // Tutoriels (lot 147) : carte du jour de l'accueil, leçon, liste, bloc de Réglages ; jours changés par l'heure de la page.
  { nom: 'tutoriels', args: ['{port}', '{captures?}'], pages: ['accueil', 'reglages'] },
  // Mesure (lot 74) : 150 vignettes défilées (cartes vivantes, DOM, tas, tuiles), mention d'OSM, captures par thème et largeur, list() à 10 000 tuiles.
  { nom: 'vignettes', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'course'], sansCache: true, dev: true, delaiMin: 20 },
  // Mesure (lot 118) : vignettes gardées d'un lancement à l'autre ; temps jusqu'aux vignettes visibles à la relance, processeur
  // ralenti six fois (en s, change à chaque passage), et images identiques au premier lancement.
  { nom: 'vignettes-relance', args: ['{port}', '{travail}'], pages: ['bibliotheque'], solo: true, sansCache: true },
  // Virages du surf par le gyroscope (lot 40) : case de Réglages, colonne des vagues, vague hors capture.
  { nom: 'virages', args: ['{port}', '{captures?}'], pages: ['surf', 'reglages', 'enregistrer'], dev: true },
  { nom: 'vides', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'surf', 'accueil', 'reglages'] },
  { nom: 'zoom-carte', args: ['{port}', '{captures?}'], pages: ['course', 'voile', 'surf'] },
];

/** Le passage courant, sans nom ni `--pages` ni `--tous` (`library` et `planning` avec `--gpx` seulement ; sans `tailles`, 20 min : par son nom ou `--pages`). */
export const PASSAGE_COURANT = ['general', 'library', 'statistiques', 'profil', 'planning', 'onglets', 'bench', 'familles', 'cardio'];

export const PAGES = ['voile', 'course', 'velo', 'surf', 'fractionne', 'enregistrer', 'bibliotheque', 'planification', 'statistiques', 'profil', 'reglages', 'accueil'];
