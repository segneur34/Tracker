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
//    `compteur-course`, `notes`, `test-fcmax` (29/10) ; les autres scripts `solo` restent à temps réel (LISEZMOI) ;
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
  { nom: 'balises', args: ['{port}', '{travail}', '{captures?}'], pages: ['planification', 'enregistrer', 'reglages', 'voile'], solo: true },
  { nom: 'barre', args: ['{port}', '{captures?}'], pages: ['course', 'voile', 'statistiques'] },
  { nom: 'bench', args: ['{port}', 'analyse', '{gpx}'], pages: ['enregistrer', 'voile'] },
  { nom: 'boucle', args: ['{port}', '{captures?}'], pages: ['planification'], reseau: true },
  { nom: 'brouillon-voile', args: ['{port}', '{travail}'], pages: ['voile'] },
  { nom: 'cacher', args: ['{port}', '{captures?}'], pages: ['reglages', 'accueil', 'bibliotheque', 'enregistrer', 'velo', 'surf'] },
  { nom: 'cadence', args: ['{port}', '{captures?}'], pages: ['course', 'fractionne', 'statistiques', 'reglages'] },
  { nom: 'cardio', args: ['{port}', '{captures?}'], pages: ['course', 'surf', 'fractionne', 'voile', 'reglages', 'statistiques'] },
  // Sans `Network.enable`, rien n'est bloqué : l'altitude de l'IGN remplace la côte (LISEZMOI, « Scripts à revoir »).
  { nom: 'charge', args: ['{port}', '{captures?}'], pages: ['course', 'velo', 'reglages'], reseau: true },
  { nom: 'chrono', args: ['{port}', '{captures?}'], pages: ['enregistrer'], solo: true },
  { nom: 'classer', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'course', 'velo'] },
  { nom: 'compteur-course', args: ['{port}', '{travail}', '{captures?}'], pages: ['enregistrer', 'fractionne', 'course'], solo: true, accelerable: true },
  { nom: 'coquille', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'velo', 'surf', 'fractionne'] },
  { nom: 'depense', args: ['{port}', '{captures?}'], pages: ['course', 'reglages'] },
  { nom: 'donnees', args: ['{port}', '{travail}', '{captures?}'], pages: ['bibliotheque', 'velo', 'accueil', 'profil'], dev: true },
  { nom: 'entrainement', args: ['{port}', '{captures?}'], pages: ['fractionne', 'enregistrer', 'reglages', 'accueil'] },
  { nom: 'familles', args: ['{port}', '{captures?}'], pages: ['reglages'] },
  { nom: 'fractionne', args: ['{port}', '{travail}', '{captures?}'], pages: ['fractionne', 'enregistrer', 'reglages', 'accueil'], solo: true },
  { nom: 'general', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'velo', 'surf'] },
  { nom: 'glisser', args: ['{port}', '{captures?}'], pages: ['profil', 'statistiques'] },
  { nom: 'graphes', args: ['{port}', '{captures?}'], pages: ['course', 'surf', 'voile'] },
  { nom: 'icones', args: ['{port}', '{captures?}'], pages: ['accueil', 'bibliotheque', 'reglages'] },
  { nom: 'imports', args: ['{port}', '{captures?}'], pages: ['bibliotheque', 'voile', 'course', 'velo', 'surf'] },
  { nom: 'library', args: ['{port}', '{dossierGpx}', '{captures}'], pages: ['bibliotheque', 'reglages'],
    manuel: 'il faut voile.gpx, course.gpx et sans-type.gpx dans le dossier de --gpx' },
  { nom: 'library2', args: ['{port}', '{travail}'], pages: ['bibliotheque', 'reglages'],
    manuel: 'à lancer après library.mjs, sur le même profil Chrome' },
  { nom: 'library3', args: ['{port}', '{dossierGpx}'], pages: ['bibliotheque', 'course'],
    manuel: 'à lancer après library.mjs, sur le même profil Chrome' },
  { nom: 'marche', args: ['{port}', '{captures?}'], pages: ['reglages', 'enregistrer'] },
  { nom: 'materiel', args: ['{port}', '{captures?}'], pages: ['course', 'velo', 'surf', 'reglages'] },
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
  { nom: 'prereglages', args: ['{port}', '{captures?}'], pages: ['reglages', 'voile', 'course'] },
  { nom: 'profil', args: ['{port}', '{captures?}'], pages: ['profil', 'accueil', 'bibliotheque'] },
  { nom: 'pumping', args: ['{port}', '{captures?}'], pages: ['surf', 'reglages'], dev: true },
  { nom: 'racine-periodes', args: ['{port}', '{captures?}'], pages: ['profil'] },
  { nom: 'racine', args: ['{port}', '{captures?}'], pages: ['profil', 'reglages'] },
  { nom: 'recherche-sans-reponse', args: ['{port}', '{travail}'], pages: ['course'], reseau: true,
    manuel: 'à finir (n° 90 du reste à faire)' },
  { nom: 'reduire', args: ['{port}', '{captures?}'], pages: ['reglages', 'profil'] },
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
  { nom: 'test-fcmax', args: ['{port}', '{captures?}'], pages: ['fractionne', 'enregistrer'], solo: true, dev: true, accelerable: true },
  { nom: 'test-fcrepos', args: ['{port}', '{captures?}'], pages: ['fractionne'], solo: true },
  { nom: 'timer', args: ['{port}', '{captures?}'], pages: ['fractionne', 'enregistrer'], solo: true },
  { nom: 'vides', args: ['{port}', '{captures?}'], pages: ['voile', 'course', 'surf', 'accueil', 'reglages'] },
  { nom: 'zoom-carte', args: ['{port}', '{captures?}'], pages: ['course', 'voile', 'surf'] },
];

/** Le passage courant, sans nom ni `--pages` ni `--tous` (`library` et `planning` avec `--gpx` seulement). */
export const PASSAGE_COURANT = ['general', 'library', 'statistiques', 'profil', 'planning', 'onglets', 'tailles', 'bench', 'familles', 'cardio'];

export const PAGES = ['voile', 'course', 'velo', 'surf', 'fractionne', 'enregistrer', 'bibliotheque', 'planification', 'statistiques', 'profil', 'reglages', 'accueil'];
