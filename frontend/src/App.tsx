// frontend/src/App.tsx

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Layout from './components/Layout';
import TasksPage from './components/TasksPage';
import ManagersPage from './components/ManagersPage';
import CreativesPage from './components/CreativesPage';
import ProjectsPage from './components/ProjectsPage';
import SubsPage from './components/SubsPage';
import MandatesPage from './components/MandatesPage';
import CompaniesPage from './components/CompaniesPage';
import ExecutivesPage from './components/ExecutivesPage';
import AIRecommendProjectNeedForCreativeReportPage from './components/AI_RecommendProjectNeedForCreativeReportPage';


import { BusyProvider } from './pane/BusyContext';
import { PaneProvider } from './pane/PaneContext';
import SlidingPane from './pane/SlidingPane';
import { ZStackProvider } from './ui/ZStack';
import { GlobalModalsProvider } from './ui/GlobalModals';

import RequireAuth from './auth/RequireAuth';
import AuthPage from './components/AuthPage';
import AuthCallback from './components/AuthCallbackPage';


export default function App() {
  return (
    <BusyProvider>
      <ZStackProvider>
        <PaneProvider>
          <GlobalModalsProvider>
            <BrowserRouter>
              <Layout>
                <Routes>
                  {/* public auth routes */}
                  <Route path="/login" element={<AuthPage />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  {/* default redirect */}
                  <Route path="/" element={<Navigate to="/managers" replace />} />
                  {/* protected app */}
                  <Route element={<RequireAuth />}>
                    <Route path="/tasks" element={<TasksPage />} />
                    <Route path="/managers" element={<ManagersPage />} />
                    <Route path="/creatives" element={<CreativesPage />} />
                    <Route path="/projects" element={<ProjectsPage />} />
                    <Route path="/subs" element={<SubsPage />} />
                    <Route path="/mandates" element={<MandatesPage />} />
                    <Route path="/companies" element={<CompaniesPage />} />
                    <Route path="/executives" element={<ExecutivesPage />} />
                    <Route path="/reports/creatives/:creativeId/project-recs" element={<AIRecommendProjectNeedForCreativeReportPage />} />

                  </Route>
                </Routes>
                <SlidingPane />
              </Layout>
            </BrowserRouter>
          </GlobalModalsProvider>
        </PaneProvider>
      </ZStackProvider>
    </BusyProvider>
  );
}
