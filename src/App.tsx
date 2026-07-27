import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AuthCallback from './pages/AuthCallback';
import ITAssets from './pages/ITAssets';
import MaintenancePage from './pages/maintenance/MaintenancePage';
import AssignedTasks from './pages/AssignedTasks';
import DailyPreview from './pages/DailyPreview';
import Tickets from './pages/Tickets';
import ProjectManagement from './pages/ProjectManagement';
import ProjectList from './pages/ProjectList';
import TaskPublicView from './pages/TaskPublicView';
import TasksOverview from './pages/TasksOverview';
import HRIntakeMonitor from './pages/HRIntakeMonitor';
import Layout from './layout/AppLayout';
import FillSurveyPage from './pages/survey/FillSurveyPage';
import SurveyDonePage from './pages/survey/SurveyDonePage';
import SurveyDashboardPage from './pages/survey/SurveyDashboardPage';
import SurveyListPage from './pages/survey/SurveyListPage';
import SurveyBuilderPage from './pages/survey/SurveyBuilderPage';
import SurveyTrackingPage from './pages/survey/SurveyTrackingPage';
import SurveyReportPage from './pages/survey/SurveyReportPage';
import SurveyActivityPage from './pages/survey/SurveyActivityPage';
import SurveyUsersPage from './pages/survey/SurveyUsersPage';
import TrainingExamsPage from './pages/training/TrainingExamsPage';
import TrainingQuestionBankPage from './pages/training/TrainingQuestionBankPage';
import TrainingResultsPage from './pages/training/TrainingResultsPage';
import ExamPage from './pages/training/ExamPage';
import { FEATURES } from './config/features';

// ─── Protected route wrapper ──────────────────────────────────────────────────
function ProtectedRoute({ children, noLayout }: { children: React.ReactNode; noLayout?: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-neo-bg)]">
        <div className="animate-spin w-10 h-10 border-4 border-[var(--color-neo-accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return noLayout ? <>{children}</> : <Layout>{children}</Layout>;
}

// ─── App content with theme ───────────────────────────────────────────────────
function AppContent() {
  const { user } = useAuth();
  return (
    <ThemeProvider userKey={user?.sub}>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/callback" element={<AuthCallback />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/attendance" element={<Navigate to="/tasks?tab=attendance" replace />} />
          {/* Support Tickets is out of service (Zammad server offline) — send
              anyone with a bookmarked link back to the dashboard instead of
              rendering a broken page. Flip FEATURES.supportTickets to restore. */}
          <Route path="/tickets" element={
            FEATURES.supportTickets
              ? <ProtectedRoute><Tickets /></ProtectedRoute>
              : <Navigate to="/dashboard" replace />
          } />
          <Route path="/assets" element={<ProtectedRoute><ITAssets /></ProtectedRoute>} />
          <Route path="/assets/maintenance" element={<ProtectedRoute><MaintenancePage /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><AssignedTasks /></ProtectedRoute>} />
          <Route path="/tasks/view/:taskId" element={<TaskPublicView />} />
          <Route path="/v/t/:token" element={<TaskPublicView />} />
          <Route path="/tasks/overview" element={<TasksOverview />} />
          <Route path="/pm" element={<ProtectedRoute><ProjectList /></ProtectedRoute>} />
          <Route path="/pm/:projectId" element={<ProtectedRoute><ProjectManagement /></ProtectedRoute>} />
          <Route path="/attendance/daily" element={<DailyPreview />} />
          <Route path="/v/d/:token" element={<DailyPreview />} />
          <Route path="/hr/intake" element={<ProtectedRoute><HRIntakeMonitor /></ProtectedRoute>} />
          {/* Survey — public (no auth) */}
          <Route path="/survey/fill/:token" element={<FillSurveyPage />} />
          <Route path="/survey/fill/:token/done" element={<SurveyDonePage />} />
          {/* Survey — protected */}
          <Route path="/survey" element={<Navigate to="/survey/dashboard" replace />} />
          <Route path="/survey/dashboard" element={<ProtectedRoute><SurveyDashboardPage /></ProtectedRoute>} />
          <Route path="/survey/surveys" element={<ProtectedRoute><SurveyListPage /></ProtectedRoute>} />
          <Route path="/survey/surveys/new" element={<ProtectedRoute><SurveyBuilderPage /></ProtectedRoute>} />
          <Route path="/survey/surveys/:id/edit" element={<ProtectedRoute><SurveyBuilderPage /></ProtectedRoute>} />
          <Route path="/survey/tracking" element={<ProtectedRoute><SurveyTrackingPage /></ProtectedRoute>} />
          <Route path="/survey/report" element={<ProtectedRoute><SurveyReportPage /></ProtectedRoute>} />
          <Route path="/survey/activity" element={<ProtectedRoute><SurveyActivityPage /></ProtectedRoute>} />
          <Route path="/survey/users" element={<ProtectedRoute><SurveyUsersPage /></ProtectedRoute>} />

          {/* Training — admin (SSO) */}
          <Route path="/training" element={<Navigate to="/training/exams" replace />} />
          <Route path="/training/exams" element={<ProtectedRoute><TrainingExamsPage /></ProtectedRoute>} />
          <Route path="/training/exams/:id/results" element={<ProtectedRoute><TrainingResultsPage /></ProtectedRoute>} />
          <Route path="/training/questions" element={<ProtectedRoute><TrainingQuestionBankPage /></ProtectedRoute>} />

          {/* Exam-taker — public, code-gated, NO layout/SSO */}
          <Route path="/exam" element={<ExamPage />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
