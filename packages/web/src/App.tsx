import { Routes, Route } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage.js';
import AgentsPage from './pages/AgentsPage.js';
import SessionsPage from './pages/SessionsPage.js';
import RouterPage from './pages/RouterPage.js';
import Layout from './components/Layout.js';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/router" element={<RouterPage />} />
      </Routes>
    </Layout>
  );
}
