import { Routes, Route } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage.js';
import AgentsPage from './pages/AgentsPage.js';
import SessionsPage from './pages/SessionsPage.js';
import RouterPage from './pages/RouterPage.js';
import DagsListPage from './pages/DagsListPage.js';
import DagEditorPage from './pages/DagEditorPage.js';
import DagRunsPage from './pages/DagRunsPage.js';
import DagRunDetailPage from './pages/DagRunDetailPage.js';
import StatsPage from './pages/StatsPage.js';
import Layout from './components/Layout.js';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/router" element={<RouterPage />} />
        <Route path="/dags" element={<DagsListPage />} />
        <Route path="/dags/:id" element={<DagEditorPage />} />
        <Route path="/dags/:id/runs" element={<DagRunsPage />} />
        <Route path="/dags/:dagId/runs/:runId" element={<DagRunDetailPage />} />
        <Route path="/stats" element={<StatsPage />} />
      </Routes>
    </Layout>
  );
}
