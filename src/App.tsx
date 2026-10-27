import { lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AppShell from './components/AppShell';
import { DevThrow } from './components/ErrorBoundary';
import Home from './pages/Home';

/**
 * Pages chargées à la demande (27/10) : seul l'accueil est dans le paquet
 * d'entrée ; chaque autre page, et avec elle Recharts (`vendor-charts`) ou
 * Leaflet (`vendor-map`), ne s'analyse qu'à sa première ouverture. `AppShell`
 * pose le `Suspense` ; les chemins, les `key` et `core/parentPage.ts` ne
 * changent pas. Dans l'application Android, les morceaux sont locaux au
 * paquet : c'est du temps d'analyse JS déplacé hors du premier rendu.
 */
const loaders = {
  SessionLibrary: () => import('./pages/SessionLibrary'),
  RecordingPage: () => import('./pages/RecordingPage'),
  LandModule: () => import('./pages/LandModule'),
  SailingModule: () => import('./pages/SailingModule'),
  SurfModule: () => import('./pages/SurfModule'),
  SettingsPage: () => import('./pages/SettingsPage'),
  PlanningPage: () => import('./pages/PlanningPage'),
  RoutesPage: () => import('./pages/RoutesPage'),
  StatisticsPage: () => import('./pages/StatisticsPage'),
  ProfilePage: () => import('./pages/ProfilePage'),
  TrainingSessionsPage: () => import('./pages/TrainingSessionsPage'),
  TrainingSessionEditPage: () => import('./pages/TrainingSessionEditPage'),
  TestsPage: () => import('./pages/TestsPage'),
  FitnessTestPage: () => import('./pages/FitnessTestPage'),
  RestingHrTestPage: () => import('./pages/RestingHrTestPage'),
};

const SessionLibrary = lazy(loaders.SessionLibrary);
const RecordingPage = lazy(loaders.RecordingPage);
const LandModule = lazy(loaders.LandModule);
const SailingModule = lazy(loaders.SailingModule);
const SurfModule = lazy(loaders.SurfModule);
const SettingsPage = lazy(loaders.SettingsPage);
const PlanningPage = lazy(loaders.PlanningPage);
const RoutesPage = lazy(loaders.RoutesPage);
const StatisticsPage = lazy(loaders.StatisticsPage);
const ProfilePage = lazy(loaders.ProfilePage);
const TrainingSessionsPage = lazy(loaders.TrainingSessionsPage);
const TrainingSessionEditPage = lazy(loaders.TrainingSessionEditPage);
const TestsPage = lazy(loaders.TestsPage);
const FitnessTestPage = lazy(loaders.FitnessTestPage);
const RestingHrTestPage = lazy(loaders.RestingHrTestPage);

/** Délai avant le préchargement quand le navigateur n'a pas `requestIdleCallback`. */
const PRELOAD_FALLBACK_MS = 1500;

/**
 * Précharge les pages une fois l'accueil rendu et le fil libre, dans l'ordre
 * où l'utilisateur y va le plus : Enregistrer, une bibliothèque, les
 * analyses, puis le reste ; un morceau à la fois, pour ne pas peser sur le
 * premier rendu. Une page ouverte entre-temps ne l'attend pas : `React.lazy`
 * la charge lui-même.
 */
const preloadPages = (): (() => void) => {
  const order: (keyof typeof loaders)[] = [
    'RecordingPage', 'SessionLibrary', 'LandModule', 'SailingModule', 'SurfModule', 'StatisticsPage', 'ProfilePage',
    'SettingsPage', 'PlanningPage', 'RoutesPage', 'TrainingSessionsPage', 'TrainingSessionEditPage', 'TestsPage',
    'FitnessTestPage', 'RestingHrTestPage',
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

function App() {
  useEffect(preloadPages, []);
  return (
    <Router>
      <Routes>
        {/* Toutes les pages dans le même cadre : navigation et bandeau d'enregistrement. */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          {/* Chaque famille : sa bibliothèque, et son module d'analyse ouvert sur une session (`?session=`). */}
          <Route path="/voile" element={<SessionLibrary key="voile" family="voile" />} />
          <Route path="/voile/analyse" element={<SailingModule />} />
          <Route path="/course" element={<SessionLibrary key="course" family="course" />} />
          <Route path="/course/analyse" element={<LandModule key="course" family="course" />} />
          <Route path="/velo" element={<SessionLibrary key="velo" family="velo" />} />
          <Route path="/velo/analyse" element={<LandModule key="velo" family="velo" />} />
          <Route path="/fractionne" element={<SessionLibrary key="fractionne" family="fractionne" />} />
          <Route path="/fractionne/analyse" element={<LandModule key="fractionne" family="fractionne" />} />
          {/* Entraînement : ses pages à lui, sous sa bibliothèque (24/10). */}
          <Route path="/fractionne/seances" element={<TrainingSessionsPage key="fractionne" kind="fractionne" />} />
          <Route path="/fractionne/seances/editer" element={<TrainingSessionEditPage key="fractionne" kind="fractionne" />} />
          <Route path="/fractionne/timer" element={<TrainingSessionsPage key="timer" kind="timer" />} />
          <Route path="/fractionne/timer/editer" element={<TrainingSessionEditPage key="timer" kind="timer" />} />
          <Route path="/fractionne/tests" element={<TestsPage />} />
          <Route path="/fractionne/tests/fc-max" element={<FitnessTestPage />} />
          <Route path="/fractionne/tests/fc-repos" element={<RestingHrTestPage />} />
          <Route path="/surf" element={<SessionLibrary key="surf" family="surf" />} />
          <Route path="/surf/analyse" element={<SurfModule />} />
          <Route path="/enregistrer" element={<RecordingPage />} />
          <Route path="/itineraires" element={<PlanningPage />} />
          <Route path="/itineraires/liste" element={<RoutesPage />} />
          <Route path="/statistiques" element={<StatisticsPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          {/* Développement seulement : une page qui lève au rendu, pour essayer la limite d'erreur au banc. */}
          {import.meta.env.DEV && <Route path="/essai/erreur" element={<DevThrow />} />}
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
