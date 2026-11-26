import { SPORT_FAMILIES, sportFamily, type SportFamily } from './sportProfiles';
import type { SportType } from './types';

const isFamily = (s: string): s is SportFamily => (SPORT_FAMILIES as string[]).includes(s);

/**
 * Profil, la page de base (lot 238, 26/11) : Tracker s'y ouvre, le logo et le retour d'Android y ramènent, première
 * case de la barre du bas. Seul endroit où l'adresse de la racine est dite.
 */
export const PROFILE_PATH = '/';

/** Accueil : les sports, « Planifier » et les itinéraires, deuxième case de la barre du bas (lot 238). */
export const HOME_PATH = '/accueil';

/** Ancienne adresse du Profil, avant le lot 238 : elle s'ouvre toujours, renvoyée à la racine (`legacyRedirect`). */
export const LEGACY_PROFILE_PATH = '/profil';

/** Adresse sans barre oblique finale, `/` pour la racine. */
const trimPath = (pathname: string): string => pathname.replace(/\/+$/, '') || '/';

/** Où renvoyer une ancienne adresse (`/profil`), paramètres de recherche gardés ; `null` pour toute autre. */
export const legacyRedirect = (pathname: string, search: string): string | null =>
  trimPath(pathname) === LEGACY_PROFILE_PATH ? `${PROFILE_PATH}${search}` : null;

/** Réglages. */
const SETTINGS_ROUTE = '/parametres';

/**
 * Réglages ouverts sur le bloc « Capteurs » (`?bloc=capteurs`, lot 232), où se trouve le bouton « Ajouter » d'une
 * ceinture : le lien « Aucune ceinture choisie » de la page Enregistrer.
 */
export const SETTINGS_SENSORS_PATH = `${SETTINGS_ROUTE}?bloc=capteurs`;

/** Bloc de Réglages désigné par l'adresse (`?bloc=`), `null` s'il n'y en a pas : les blocs gardent alors leur état. */
export const settingsBlockFromSearch = (search: string): string | null => new URLSearchParams(search).get('bloc');

/**
 * Page au-dessus d'une adresse, où renvoie la touche retour d'Android (et le
 * geste du bord de l'écran) : l'analyse d'une session renvoie à la
 * bibliothèque de sa famille, comme le lien « ← » de son en-tête, et une page
 * de l'Entraînement (séances du fractionné ou du Timer et leur édition, tests) à la page au-dessus d'elle,
 * un test à « Fractionné et tests » (`/fractionne/seances`, où sont ses tuiles depuis le lot I) ;
 * Enregistrer en mode Timer (`?minuterie`) renvoie à la liste du Timer ; une
 * leçon des tutoriels à leur liste, et celle-ci à Réglages ; les
 * Statistiques remontent d'un cran (activité, famille, vue d'ensemble), la
 * période gardée ; Réglages ouverts par le lien de la ceinture d'Enregistrer
 * (`?bloc=capteurs`) y renvoient. Depuis le lot 238, le Profil est la base : ce
 * qui s'ouvre depuis l'accueil (bibliothèque d'une famille et toute adresse sous
 * elle sans page au-dessus, Planifier, liste des itinéraires) y renvoie,
 * l'accueil lui-même et toute autre page (Statistiques à leur dernier cran,
 * Réglages, Enregistrer) renvoient au Profil. `null` au Profil, ancienne adresse
 * comprise : rien au-dessus.
 */
export const parentPage = (pathname: string, search: string): string | null => {
  const path = trimPath(pathname);
  if (path === PROFILE_PATH || path === LEGACY_PROFILE_PATH) return null;
  if (path === HOME_PATH) return PROFILE_PATH;
  // Réglages ouverts par le lien de la page Enregistrer (`?bloc=capteurs`, lot 232) : retour à Enregistrer.
  if (path === SETTINGS_ROUTE && settingsBlockFromSearch(search) === 'capteurs') return '/enregistrer';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2 && parts[1] === 'analyse' && isFamily(parts[0])) {
    return libraryPath(parts[0], new URLSearchParams(search).get('activite') ?? undefined);
  }
  // Un test : « Fractionné et tests », où sont ses tuiles.
  if (parts[0] === 'fractionne' && parts[1] === 'tests' && parts.length > 2) return '/fractionne/seances';
  // Pages de l'Entraînement (séances du fractionné, Timer) : un cran plus haut, jusqu'à sa bibliothèque.
  if (parts[0] === 'fractionne' && ['seances', 'timer', 'tests'].includes(parts[1])) return `/${parts.slice(0, -1).join('/')}`;
  if (path === '/enregistrer' && new URLSearchParams(search).has('minuterie')) return '/fractionne/timer';
  // Tutoriels (lot 147) : une leçon remonte à la liste, d'où qu'on l'ait ouverte (carte de l'accueil comprise), la liste à Réglages.
  if (parts[0] === 'tutoriels') return parts.length > 1 ? '/tutoriels' : '/parametres';
  if (path === '/statistiques') {
    const params = new URLSearchParams(search);
    const next = new URLSearchParams();
    const famille = params.get('famille');
    const periode = params.get('periode');
    if (famille === null) return PROFILE_PATH;
    if (params.get('activite') !== null) next.set('famille', famille);
    if (periode !== null) next.set('periode', periode);
    const query = next.toString();
    return query === '' ? '/statistiques' : `/statistiques?${query}`;
  }
  // Ouvertes depuis l'accueil : une bibliothèque (et ce qui, sous sa famille, n'a pas de page au-dessus), Planifier, les itinéraires.
  if (isFamily(parts[0]) || parts[0] === 'itineraires') return HOME_PATH;
  return PROFILE_PATH;
};

/** Bibliothèque d'une famille, filtrée sur une activité si `activityId` est donné. */
export const libraryPath = (family: SportFamily, activityId?: string): string =>
  `/${family}${activityId ? `?activite=${encodeURIComponent(activityId)}` : ''}`;

/**
 * Module d'analyse d'une famille, ouvert sur une session de la mémoire si `file`
 * est donné. `fromActivityId` : le filtre d'activité de la bibliothèque d'où l'on
 * vient (`?activite=`), que le retour rend.
 */
export const analysisPath = (family: SportFamily, file?: string | null, fromActivityId?: string | null): string => {
  if (!file) return `/${family}/analyse`;
  const from = fromActivityId ? `&activite=${encodeURIComponent(fromActivityId)}` : '';
  return `/${family}/analyse?session=${encodeURIComponent(file)}${from}`;
};

/** Famille d'une session : celle de son support, sinon `fallback` pour une session à classer. */
export const sessionFamily = (session: { record: { sport: SportType | null } } | undefined, fallback: SportFamily): SportFamily =>
  session?.record.sport ? sportFamily(session.record.sport) : fallback;
