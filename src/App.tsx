import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AppShell from './components/AppShell';
import Home from './pages/Home';
import SailingModule from './pages/SailingModule';
import LandModule from './pages/LandModule';
import SessionLibrary from './pages/SessionLibrary';
import SettingsPage from './pages/SettingsPage';
import RecordingPage from './pages/RecordingPage';
import PlanningPage from './pages/PlanningPage';
import RoutesPage from './pages/RoutesPage';

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
          <Route path="/enregistrer" element={<RecordingPage />} />
          <Route path="/itineraires" element={<PlanningPage />} />
          <Route path="/itineraires/liste" element={<RoutesPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
