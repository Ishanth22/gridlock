import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import HotspotDetail from './pages/HotspotDetail';
import Predict from './pages/Predict';
import Enforce from './pages/Enforce';
import Simulate from './pages/Simulate';
import Analytics from './pages/Analytics';
import FieldPortal from './pages/FieldPortal';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/hotspot/:hexId" element={<HotspotDetail />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/enforce" element={<Enforce />} />
          <Route path="/simulate" element={<Simulate />} />
          <Route path="/analytics" element={<Analytics />} />
        </Route>
        <Route path="/field" element={<FieldPortal />} />
      </Routes>
    </BrowserRouter>
  );
}
