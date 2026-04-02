import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Agents } from './pages/Agents';
import { AgentDetail } from './pages/AgentDetail';
import { Tasks } from './pages/Tasks';
import { TaskDetail } from './pages/TaskDetail';
import { Skills } from './pages/Skills';
import { Tools } from './pages/Tools';
import { Generator } from './pages/Generator';
import { Generations } from './pages/Generations';
import { GenerationDetail } from './pages/GenerationDetail';
import { Organization } from './pages/Organization';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="skills" element={<Skills />} />
          <Route path="tools" element={<Tools />} />
          <Route path="generator" element={<Generator />} />
          <Route path="generations" element={<Generations />} />
          <Route path="generations/:id" element={<GenerationDetail />} />
          <Route path="organization" element={<Organization />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
