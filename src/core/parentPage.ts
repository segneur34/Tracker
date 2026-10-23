import { SPORT_FAMILIES, type SportFamily } from './sportProfiles';

const isFamily = (s: string): s is SportFamily => (SPORT_FAMILIES as string[]).includes(s);

/**
 * Page au-dessus d'une adresse, où renvoie la touche retour d'Android (et le
 * geste du bord de l'écran) : l'analyse d'une session renvoie à la
 * bibliothèque de sa famille, comme le lien « ← » de son en-tête ; les
 * Statistiques remontent d'un cran (activité, famille, vue d'ensemble), la
 * période gardée ; toute autre page renvoie à l'accueil. `null` à l'accueil :
 * rien au-dessus.
 */
export const parentPage = (pathname: string, search: string): string | null => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2 && parts[1] === 'analyse' && isFamily(parts[0])) return `/${parts[0]}`;
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
