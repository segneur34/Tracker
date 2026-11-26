import { lazy, useEffect } from 'react';
import { BrowserRouter as Router, Navigate, Routes, Route, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from './components/AppShell';
import { DevThrow } from './components/ErrorBoundary';
import { HOME_PATH, LEGACY_PROFILE_PATH, PROFILE_PATH, legacyRedirect } from './core/parentPage';
import { hasPositions } from './core/sportProfiles';
import { acknowledgeRecordingLanding, useRecorderSelector } from './hooks/useRecorder';
import { useLibrarySession } from './hooks/useSessionLibrary';
import ProfilePage from './pages/ProfilePage';

/**
 * Pages chargées à la demande (27/10) : seule la page d'ouverture (le Profil
 * depuis le lot 238, l'accueil avant) est dans le paquet d'entrée ; chaque
 * autre page, et avec elle Recharts (`vendor-charts`) ou Leaflet
 * (`vendor-map`), ne s'analyse qu'à sa première ouverture. `AppShell`
 * pose le `Suspense` ; les chemins, les `key` et `core/parentPage.ts` ne
 * changent pas. Dans l'application Android, les morceaux sont locaux au
 * paquet : c'est du temps d'analyse JS déplacé hors du premier rendu.
 */
const loaders = {
  Home: () => import('./pages/Home'),
  SessionLibrary: () => import('./pages/SessionLibrary'),
  RecordingPage: () => import('./pages/RecordingPage'),
  LandModule: () => import('./pages/LandModule'),
  MuscuModule: () => import('./pages/MuscuModule'),
  SailingModule: () => import('./pages/SailingModule'),
  SurfModule: () => import('./pages/SurfModule'),
  SettingsPage: () => import('./pages/SettingsPage'),
  PlanningPage: () => import('./pages/PlanningPage'),
  RoutesPage: () => import('./pages/RoutesPage'),
  StatisticsPage: () => import('./pages/StatisticsPage'),
  TrainingSessionsPage: () => import('./pages/TrainingSessionsPage'),
  TrainingSessionEditPage: () => import('./pages/TrainingSessionEditPage'),
  TestsPage: () => import('./pages/TestsPage'),
  FitnessTestPage: () => import('./pages/FitnessTestPage'),
  RestingHrTestPage: () => import('./pages/RestingHrTestPage'),
  NightHrTestPage: () => import('./pages/NightHrTestPage'),
  TutorialsPage: () => import('./pages/TutorialsPage'),
  TutorialPage: () => import('./pages/TutorialPage'),
};

const Home = lazy(loaders.Home);
const SessionLibrary = lazy(loaders.SessionLibrary);
const RecordingPage = lazy(loaders.RecordingPage);
const LandModule = lazy(loaders.LandModule);
const MuscuModule = lazy(loaders.MuscuModule);
const SailingModule = lazy(loaders.SailingModule);
const SurfModule = lazy(loaders.SurfModule);
const SettingsPage = lazy(loaders.SettingsPage);
const PlanningPage = lazy(loaders.PlanningPage);
const RoutesPage = lazy(loaders.RoutesPage);
const StatisticsPage = lazy(loaders.StatisticsPage);
const TrainingSessionsPage = lazy(loaders.TrainingSessionsPage);
const TrainingSessionEditPage = lazy(loaders.TrainingSessionEditPage);
const TestsPage = lazy(loaders.TestsPage);
const FitnessTestPage = lazy(loaders.FitnessTestPage);
const RestingHrTestPage = lazy(loaders.RestingHrTestPage);
const NightHrTestPage = lazy(loaders.NightHrTestPage);
const TutorialsPage = lazy(loaders.TutorialsPage);
const TutorialPage = lazy(loaders.TutorialPage);

/** Délai avant le préchargement quand le navigateur n'a pas `requestIdleCallback`. */
const PRELOAD_FALLBACK_MS = 1500;

/**
 * Précharge les pages une fois la page d'ouverture rendue et le fil libre, dans l'ordre
 * où l'utilisateur y va le plus : l'accueil, Enregistrer, une bibliothèque, les
 * analyses, puis le reste ; un morceau à la fois, pour ne pas peser sur le
 * premier rendu. Une page ouverte entre-temps ne l'attend pas : `React.lazy`
 * la charge lui-même.
 */
const preloadPages = (): (() => void) => {
  const order: (keyof typeof loaders)[] = [
    'Home', 'RecordingPage', 'SessionLibrary', 'LandModule', 'SailingModule', 'SurfModule', 'MuscuModule', 'StatisticsPage',
    'SettingsPage', 'PlanningPage', 'RoutesPage', 'TrainingSessionsPage', 'TrainingSessionEditPage', 'TestsPage',
    'FitnessTestPage', 'RestingHrTestPage', 'NightHrTestPage', 'TutorialPage', 'TutorialsPage',
  ];
  let cancelled = false;
  let handle: number | null = null;
  const schedule = (fn: () => void) => {
    if (typeof requestIdleCallback === 'function') handle = requestIdleCallback(() => fn());
    else handle = window.setTimeout(fn, PRELOAD_FALLBACK_MS);
  };
  const next = (k: number) => {
    if (cancelled || k >= order.length) return;
    void loaders[order[k]]().catch(() => undefined).then(() => schedule(() => next(k + 1)));
  };
  schedule(() => next(0));
  return () => {
    cancelled = true;
    if (handle !== null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
      window.clearTimeout(handle);
    }
  };
};

/**
 * Analyse de l'Entraînement : `LandModule`, sauf pour une session sans trace
 * (muscu, lot I du 25/10), analysée par `MuscuModule`, sans carte. Le calcul
 * se lit dans la fiche de la session demandée (`?session=`) ; tant que la
 * bibliothèque ne la connaît pas, rien n'est chargé (`useSessionFromUrl`).
 */
function TrainingAnalysis() {
  const [params] = useSearchParams();
  const sport = useLibrarySession(params.get('session'))?.record.sport ?? null;
  return sport !== null && !hasPositions(sport) ? <MuscuModule /> : <LandModule key="fractionne" family="fractionne" />;
}

/** Une recharge mène toujours à la page de base (le Profil) : après une reprise silencieuse (lot 156), retour sur Enregistrer. */
function LandOnRecording() {
  const land = useRecorderSelector((s) => s.landOnRecording);
  const navigate = useNavigate();
  useEffect(() => {
    if (!land) return;
    acknowledgeRecordingLanding();
    navigate('/enregistrer', { replace: true });
  }, [land, navigate]);
  return null;
}

/** Ancienne adresse du Profil (`/profil`, avant le lot 238) : renvoyée à la racine, paramètres gardés, sans entrée d'historique. */
function LegacyProfile() {
  const { pathname, search } = useLocation();
  return <Navigate to={legacyRedirect(pathname, search) ?? PROFILE_PATH} replace />;
}

function App() {
  useEffect(preloadPages, []);
  return (
    <Router>
      <LandOnRecording />
      <Routes>
        {/* Toutes les pages dans le même cadre : navigation et bandeau d'enregistrement. */}
        <Route element={<AppShell />}>
          {/* Le Profil est la page de base (lot 238) : Tracker s'y ouvre ; l'accueil (sports, Planifier) est à côté. */}
          <Route path={PROFILE_PATH} element={<ProfilePage />} />
          <Route path={HOME_PATH} element={<Home />} />
          <Route path={LEGACY_PROFILE_PATH} element={<LegacyProfile />} />
          {/* Chaque famille : sa bibliothèque, et son module d'analyse ouvert sur une session (`?session=`). */}
          <Route path="/voile" element={<SessionLibrary key="voile" family="voile" />} />
          <Route path="/voile/analyse" element={<SailingModule />} />
          <Route path="/course" element={<SessionLibrary key="course" family="course" />} />
          <Route path="/course/analyse" element={<LandModule key="course" family="course" />} />
          <Route path="/velo" element={<SessionLibrary key="velo" family="velo" />} />
          <Route path="/velo/analyse" element={<LandModule key="velo" family="velo" />} />
          <Route path="/fractionne" element={<SessionLibrary key="fractionne" family="fractionne" />} />
          <Route path="/fractionne/analyse" element={<TrainingAnalysis />} />
          {/* Entraînement : ses pages à lui, sous sa bibliothèque (24/10). */}
          <Route path="/fractionne/seances" element={<TrainingSessionsPage key="fractionne" kind="fractionne" />} />
          <Route path="/fractionne/seances/editer" element={<TrainingSessionEditPage key="fractionne" kind="fractionne" />} />
          <Route path="/fractionne/timer" element={<TrainingSessionsPage key="timer" kind="timer" />} />
          <Route path="/fractionne/timer/editer" element={<TrainingSessionEditPage key="timer" kind="timer" />} />
          <Route path="/fractionne/tests" element={<TestsPage />} />
          <Route path="/fractionne/tests/fc-max" element={<FitnessTestPage />} />
          <Route path="/fractionne/tests/fc-repos" element={<RestingHrTestPage />} />
          <Route path="/fractionne/tests/fc-nuit" element={<NightHrTestPage />} />
          <Route path="/surf" element={<SessionLibrary key="surf" family="surf" />} />
          <Route path="/surf/analyse" element={<SurfModule />} />
          <Route path="/enregistrer" element={<RecordingPage />} />
          <Route path="/itineraires" element={<PlanningPage />} />
          <Route path="/itineraires/liste" element={<RoutesPage />} />
          <Route path="/statistiques" element={<StatisticsPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          {/* Tutoriels (lot 147) : la liste, sous Réglages, et chaque leçon. */}
          <Route path="/tutoriels" element={<TutorialsPage />} />
          <Route path="/tutoriels/:id" element={<TutorialPage />} />
          {/* Développement seulement : une page qui lève au rendu, pour essayer la limite d'erreur au banc. */}
          {import.meta.env.DEV && <Route path="/essai/erreur" element={<DevThrow />} />}
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
