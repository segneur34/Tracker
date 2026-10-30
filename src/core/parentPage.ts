import { SPORT_FAMILIES, sportFamily, type SportFamily } from './sportProfiles';
import type { SportType } from './types';

const isFamily = (s: string): s is SportFamily => (SPORT_FAMILIES as string[]).includes(s);

/**
 * Page au-dessus d'une adresse, où renvoie la touche retour d'Android (et le
 * geste du bord de l'écran) : l'analyse d'une session renvoie à la
 * bibliothèque de sa famille, comme le lien « ← » de son en-tête, et une page
 * de l'Entraînement (séances du fractionné ou du Timer et leur édition, tests) à la page au-dessus d'elle,
 * un test à « Fractionné et tests » (`/fractionne/seances`, où sont ses tuiles depuis le lot I) ;
 * Enregistrer en mode Timer (`?minuterie`) renvoie à la liste du Timer ; les
 * Statistiques remontent d'un cran (activité, famille, vue d'ensemble), la
 * période gardée ; toute autre page renvoie à l'accueil. `null` à l'accueil :
 * rien au-dessus.
 */
export const parentPage = (pathname: string, search: string): string | null => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2 && parts[1] === 'analyse' && isFamily(parts[0])) return `/${parts[0]}`;
  // Un test : « Fractionné et tests », où sont ses tuiles.
  if (parts[0] === 'fractionne' && parts[1] === 'tests' && parts.length > 2) return '/fractionne/seances';
  // Pages de l'Entraînement (séances du fractionné, Timer) : un cran plus haut, jusqu'à sa bibliothèque.
  if (parts[0] === 'fractionne' && ['seances', 'timer', 'tests'].includes(parts[1])) return `/${parts.slice(0, -1).join('/')}`;
  if (path === '/enregistrer' && new URLSearchParams(search).has('minuterie')) return '/fractionne/timer';
  if (path === '/statistiques') {
    const params = new URLSearchParams(search);
    const next = new URLSearchParams();
    const famille = params.get('famille');
    const periode = params.get('periode');
    if (famille === null) return '/';
    if (params.get('activite') !== null) next.set('famille', famille);
    if (periode !== null) next.set('periode', periode);
    const query = next.toString();
    return query === '' ? '/statistiques' : `/statistiques?${query}`;
  }
  return '/';
};

/** Bibliothèque d'une famille, filtrée sur une activité si `activityId` est donné. */
export const libraryPath = (family: SportFamily, activityId?: string): string =>
  `/${family}${activityId ? `?activite=${encodeURIComponent(activityId)}` : ''}`;

/** Module d'analyse d'une famille, ouvert sur une session de la mémoire si `file` est donné. */
export const analysisPath = (family: SportFamily, file?: string | null): string =>
  `/${family}/analyse${file ? `?session=${encodeURIComponent(file)}` : ''}`;

/** Famille d'une session : celle de son support, sinon `fallback` pour une session à classer. */
export const sessionFamily = (session: { record: { sport: SportType | null } } | undefined, fallback: SportFamily): SportFamily =>
  session?.record.sport ? sportFamily(session.record.sport) : fallback;
