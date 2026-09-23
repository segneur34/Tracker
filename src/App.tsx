import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AppShell from './components/AppShell';
import Home from './pages/Home';
import SailingModule from './pages/SailingModule';
import RunningModule from './pages/RunningModule';
import SettingsPage from './pages/SettingsPage';
import RecordingPage from './pages/RecordingPage';

function App() {
  return (
    <Router>
      <Routes>
        {/* Toutes les pages dans le même cadre : navigation et bandeau d'enregistrement. */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          <Route path="/voile" element={<SailingModule />} />
          <Route path="/course" element={<RunningModule />} />
          <Route path="/enregistrer" element={<RecordingPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
