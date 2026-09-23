import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import SailingModule from './pages/SailingModule';
import RunningModule from './pages/RunningModule';
import SettingsPage from './pages/SettingsPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/voile" element={<SailingModule />} />
        <Route path="/course" element={<RunningModule />} />
        <Route path="/parametres" element={<SettingsPage />} />
      </Routes>
    </Router>
  );
}

export default App;