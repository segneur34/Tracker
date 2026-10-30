import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import headerPhoto from '../assets/accueil/entete-accueil.webp';
import vignetteAPied from '../assets/accueil/vignette-a-pied.webp';
import vignetteFractionne from '../assets/accueil/vignette-fractionne.webp';
import vignetteSurf from '../assets/accueil/vignette-surf.webp';
import vignetteVelo from '../assets/accueil/vignette-velo.webp';
import vignetteVoile from '../assets/accueil/vignette-voile.webp';
import MemoryStatus from '../components/MemoryStatus';
import PageBackdrop from '../components/PageBackdrop';
import { PermissionsPrompt } from '../components/PermissionsStatus';
import ProfilePrompt from '../components/ProfilePrompt';
import { FAMILY_ICON } from '../components/familyIcons';
import { IconFlag, IconRoute } from '../components/icons';
import { FAMILY_ACCENT, FAMILY_LABEL } from '../core/activities';
import type { SportFamily } from '../core/sportProfiles';
import { libraryPath } from '../hooks/useLibraryNavigation';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { profilePromptGate, runnerName, useRunnerProfile } from '../hooks/useRunnerProfile';
import { useFavoriteBackdrop } from '../hooks/useFavoriteBackdrop';
import { useLibraryFields } from '../hooks/useSessionLibrary';
import { useVisibility } from '../hooks/useSportSettings';
import { shownRoutes } from '../planning/routeList';
import './Home.css';

/**
 * Accueil, sur la maquette du 22/10 : en-tête photo avec le logo, la version
 * et le salut au pseudo ; une carte par famille visible, ses activités visibles
 * en sous-titre et sa photo fondue dans sa couleur ; puis créer un parcours et
 * la liste des itinéraires planifiés (leur nombre dès que la mémoire est prête),
 * sur un fond de courbes de niveau. Enregistrer est le bouton rond de la barre
 * du bas. Une famille cachée dans Réglages n'y a pas sa carte, une activité
 * cachée ni son nom ni ses itinéraires (§10, point 100).
 */

const FAMILY_PHOTO: Record<SportFamily, string> = {
  voile: vignetteVoile,
  course: vignetteAPied,
  velo: vignetteVelo,
  surf: vignetteSurf,
  fractionne: vignetteFractionne,
};

function Home() {
  const { status, error } = useLibraryFields('status', 'error');
  const backdrop = useFavoriteBackdrop();
  const { routes: allRoutes } = useRouteLibrary();
  const { activities, families, isShown, shownActivities } = useVisibility();
  const { profile } = useRunnerProfile();
  const name = runnerName(profile);
  const routes = useMemo(() => shownRoutes(allRoutes, activities, isShown), [allRoutes, activities, isShown]);
  // Premier lancement sur le téléphone, ou dossier devenu inaccessible : la mémoire d'abord. Une erreur
  // (écriture refusée, réglages du dossier illisibles) se voit aussi dès l'accueil.
  const memoryNeedsAction = status === 'unavailable' || status === 'needs-permission' || error !== null;
  /** La carte des autorisations paraît-elle ? `null` tant qu'elle n'a pas lu les autorisations. */
  const [permissionsShown, setPermissionsShown] = useState<boolean | null>(null);
  const gate = profilePromptGate({ memoryNeedsAction, memoryReady: status === 'ready', permissionsShown });

  return (
    <div className="ui-page ui-page--backdrop home">
      <PageBackdrop variant={backdrop} />
      <header className="home-header" style={{ backgroundImage: `url(${headerPhoto})` }}>
        <h1 className="home-logo">Tracker<span className="home-version">v{__APP_VERSION__}</span></h1>
        <p className="home-welcome">{name ? `Bienvenue ${name}` : 'Bienvenue'}</p>
      </header>

      {memoryNeedsAction && <MemoryStatus />}
      {/* Le dossier de la mémoire d'abord, puis les autorisations (téléphone seulement, s'il en manque). */}
      {!memoryNeedsAction && status === 'ready' && <PermissionsPrompt onDecided={setPermissionsShown} />}
      {/* Puis le profil, s'il manque un champ, une fois par lancement ; jamais par-dessus ces deux cartes. */}
      {gate.mount && <ProfilePrompt otherCardShown={gate.otherCardShown} />}

      <nav className="home-families" aria-label="Sports">
        {families.map((family) => {
          const Icon = FAMILY_ICON[family];
          const names = shownActivities(family).map((a) => a.name).join(', ');
          return (
            <Link key={family} to={libraryPath(family)} className="home-family"
              style={{ '--family-color': FAMILY_ACCENT[family] } as CSSProperties}>
              <Icon size={29} className="home-family__icon" />
              <span className="home-family__text">
                <span className="home-family__name">{FAMILY_LABEL[family]}</span>
                {names && <span className="home-family__activities">{names}</span>}
              </span>
              <img className="home-family__photo" src={FAMILY_PHOTO[family]} alt="" />
            </Link>
          );
        })}
      </nav>

      <div className="home-actions">
        <Link to="/itineraires" className="home-action home-action--edge">
          <IconRoute size={18} /> <span>Créer un parcours</span>
        </Link>
        <Link to="/itineraires/liste" className="home-action">
          <IconFlag size={18} /> <span>Itinéraires planifiés{status === 'ready' ? ` (${routes.length})` : ''}</span>
        </Link>
      </div>
    </div>
  );
}

export default Home;
