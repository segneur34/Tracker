/**
 * Disposition du dossier mémoire (`docs/ETAT_DU_PROJET.md` §6) :
 *
 *     Tracker/
 *       tracker.json     marqueur, pour reconnaître le dossier
 *       reglages/        un fichier de réglages par appareil, `<appareil>.json`
 *                        (`settingsFile.ts`) ; avant le point 90, un seul
 *                        reglages.json à la racine
 *       LISEZMOI.txt     ce qu'est ce dossier, pour qui l'ouvre à la main
 *       sessions/        un GPX et sa fiche JSON par session (`record.ts`)
 *       itineraires/     une fiche JSON et son GPX par itinéraire planifié
 *                        (`planning/routeRecord.ts`)
 */

export const SESSIONS_DIR = 'sessions';
export const ROUTES_DIR = 'itineraires';
export const MARKER_FILE = 'tracker.json';
export const SETTINGS_DIR = 'reglages';
/** Ancien fichier unique des réglages, à la racine : relu une fois, puis retiré. */
export const SETTINGS_FILE = 'reglages.json';
export const README_FILE = 'LISEZMOI.txt';

export const MEMORY_FORMAT = 'tracker-memoire';
export const MEMORY_VERSION = 1;

export const sessionPath = (fileName: string): string => `${SESSIONS_DIR}/${fileName}`;
export const routePath = (fileName: string): string => `${ROUTES_DIR}/${fileName}`;
export const settingsPath = (fileName: string): string => `${SETTINGS_DIR}/${fileName}`;

export const markerText = (): string =>
  `${JSON.stringify({ format: MEMORY_FORMAT, version: MEMORY_VERSION }, null, 2)}\n`;

/** Texte du `LISEZMOI.txt`, en fins de ligne Windows : il sera surtout ouvert sur un PC. */
export const readmeText = (): string =>
  [
    'Dossier mémoire de Tracker',
    '==========================',
    '',
    'Ce dossier contient toutes vos sessions et vos réglages.',
    '',
    '- sessions/ : une trace GPX par session, et à côté une fiche .json du même nom',
    '  (résumé, support, notes). Le GPX fait foi : la fiche se recalcule, sauf les notes.',
    '- itineraires/ : les itinéraires planifiés. La fiche .json fait foi (points de',
    '  passage, tracé) ; le GPX du même nom est à emporter dans une autre application',
    '  ou sur une montre.',
    '- reglages/ : un fichier de réglages par appareil (telephone.json, pc.json…) :',
    '  activités et leurs réglages, séances du compteur, barre du bas, profil du',
    '  pratiquant. Chaque appareil écrit le sien. Pour reprendre ceux d\'un autre',
    '  appareil, ou de quelqu\'un d\'autre : déposez son fichier ici, puis dans',
    '  Réglages > Mémoire, « Mettre à jour » et « Reprendre ».',
    '- tracker.json : permet à l\'application de reconnaître ce dossier.',
    '',
    'Sauvegarder ou changer d\'appareil : copiez le dossier Tracker entier.',
    'Sur le téléphone, il se trouve dans Stockage interne > Documents > Tracker',
    '(par câble USB depuis le PC, ou avec le gestionnaire de fichiers).',
    '',
    'Fusionner deux dossiers : copiez le contenu de l\'un dans l\'autre. Une même',
    'session présente deux fois n\'est comptée qu\'une fois.',
    '',
    'Ajouter une trace d\'une autre application : déposez son GPX dans sessions/.',
    'L\'application lui crée sa fiche au lancement suivant, ou en touchant',
    '« Mettre à jour » en tête d\'une liste de sessions.',
    '',
    'Ne modifiez pas les fichiers à la main, sauf pour les supprimer : supprimez',
    'alors le GPX et sa fiche ensemble.',
    '',
  ].join('\r\n');
