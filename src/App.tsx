import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { Toaster } from '@/components/ui/toaster';
import { Layout } from '@/components/layout/Layout';
import { LoginPage }    from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { TasksPage }    from '@/pages/TasksPage';
import { TeamPage }     from '@/pages/TeamPage';
import { ReportsPage }  from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { SitesPage }    from '@/pages/SitesPage';
import { SignupPage }   from '@/pages/SignupPage';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { ApproverSurveyReviewPage } from '@/pages/ApproverSurveyReviewPage';
import { SurveysPage } from '@/pages/SurveysPage';
import { SurveyWizardPage } from '@/pages/SurveyWizardPage';
import { AdminSurveyOversightPage } from '@/pages/AdminSurveyOversightPage';
import type { UserRole } from '@/types';

// Initialises the Firebase auth listener at the app root
function AuthInit({ children }: { children: React.ReactNode }) {
  useAuth();
  return <>{children}</>;
}

interface ProtectedRouteProps {
  requireAdmin?: boolean;
  /** When set, only these roles may access the route (requireAdmin still applies if both are set). */
  allowRoles?: UserRole[];
  children: React.ReactNode;
}

function ProtectedRoute({ requireAdmin = false, allowRoles, children }: ProtectedRouteProps) {
  const { currentUser, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-brand-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && currentUser.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (allowRoles && !allowRoles.includes(currentUser.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function CatchAll() {
  const { currentUser, loading } = useAuthStore();
  if (loading) return null;
  return <Navigate to={currentUser ? '/dashboard' : '/login'} replace />;
}

// Admins land on the survey oversight page (AdminSurveyOversightPage) instead
// of the field engineer's personal assigned-surveys list — /surveys itself
// stays the field/admin-allowed route so old links/bookmarks still resolve.
function SurveysRoute() {
  const { currentUser } = useAuthStore();
  if (currentUser?.role === 'admin') {
    return <Navigate to="/surveys/all" replace />;
  }
  return <SurveysPage />;
}

// The survey record viewer used to live only under /approvals — now that
// AdminSurveyOversightPage (reached from Surveys, not Approvals) also opens
// it, that path put admins on a URL that highlighted the wrong nav item. This
// keeps the old links/bookmarks working by handing off to the real route,
// which re-applies the same role check.
function LegacySurveyRecordRedirect() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  return <Navigate to={`/survey-record/${workOrderId}`} replace />;
}

export default function App() {
  useEffect(() => {
    document.body.style.backgroundColor = '#F0F4F8';
  }, []);

  return (
    <BrowserRouter>
      {/* Global toast overlay — survives component unmounts */}
      <Toaster />
      <AuthInit>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup/:inviteId" element={<SignupPage />} />

          {/* Authenticated shell */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/tasks"     element={<TasksPage />} />

            {/* Approver + admin */}
            <Route
              path="/approvals"
              element={
                <ProtectedRoute allowRoles={['approver', 'admin']}>
                  <ApprovalsPage />
                </ProtectedRoute>
              }
            />

            {/* Survey record viewer — shared by ApprovalsPage and
                AdminSurveyOversightPage, so it lives at a neutral path
                rather than nested under /approvals. */}
            <Route
              path="/survey-record/:workOrderId"
              element={
                <ProtectedRoute allowRoles={['approver', 'admin']}>
                  <ApproverSurveyReviewPage />
                </ProtectedRoute>
              }
            />
            {/* Old path — kept so existing links/bookmarks still resolve. */}
            <Route
              path="/approvals/survey/:workOrderId"
              element={<LegacySurveyRecordRedirect />}
            />

            {/* Field + admin — MSETCL Substation Visibility Project survey wizard */}
            <Route
              path="/surveys"
              element={
                <ProtectedRoute allowRoles={['field', 'admin']}>
                  <SurveysRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/survey/:workOrderId"
              element={
                <ProtectedRoute allowRoles={['field', 'admin']}>
                  <SurveyWizardPage />
                </ProtectedRoute>
              }
            />

            {/* Admin-only — survey oversight across every site/status */}
            <Route
              path="/surveys/all"
              element={
                <ProtectedRoute allowRoles={['admin']}>
                  <AdminSurveyOversightPage />
                </ProtectedRoute>
              }
            />

            {/* Admin-only */}
            <Route
              path="/projects"
              element={
                <ProtectedRoute requireAdmin>
                  <ProjectsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sites"
              element={
                <ProtectedRoute requireAdmin>
                  <SitesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/team"
              element={
                <ProtectedRoute requireAdmin>
                  <TeamPage />
                </ProtectedRoute>
              }
            />
            {/* Task Master removed in Phase B — redirect to Projects */}
            <Route path="/task-master" element={<Navigate to="/projects" replace />} />
            <Route path="/master"      element={<Navigate to="/projects" replace />} />
            <Route
              path="/reports"
              element={
                <ProtectedRoute requireAdmin>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute requireAdmin>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<CatchAll />} />
        </Routes>
      </AuthInit>
    </BrowserRouter>
  );
}
