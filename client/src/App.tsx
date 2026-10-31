import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConsolePage } from './pages/ConsolePage';
import { HomePage } from './pages/HomePage';
import { RemotePage } from './pages/RemotePage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/console" element={<ConsolePage />} />
        <Route path="/remote" element={<RemotePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
