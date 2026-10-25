import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AppShell from './components/AppShell';
import Home from './pages/Home';
import SailingModule from './pages/SailingModule';
import LandModule from './pages/LandModule';
import SurfModule from './pages/SurfModule';
import SessionLibrary from './pages/SessionLibrary';
import SettingsPage from './pages/SettingsPage';
import RecordingPage from './pages/RecordingPage';
import PlanningPage from './pages/PlanningPage';
import RoutesPage from './pages/RoutesPage';
import StatisticsPage from './pages/StatisticsPage';
import ProfilePage from './pages/ProfilePage';
import TrainingSessionsPage from './pages/TrainingSessionsPage';
import TrainingSessionEditPage from './pages/TrainingSessionEditPage';
import TestsPage from './pages/TestsPage';
import FitnessTestPage from './pages/FitnessTestPage';
import RestingHrTestPage from './pages/RestingHrTestPage';

function App() {
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
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
