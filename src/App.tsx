import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

// Initialises the Firebase auth listener at the app root
function AuthInit({ children }: { children: React.ReactNode }) {
  useAuth();
  return <>{children}</>;
}

interface ProtectedRouteProps {
  requireAdmin?: boolean;
  children: React.ReactNode;
}

function ProtectedRoute({ requireAdmin = false, children }: ProtectedRouteProps) {
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

  return <>{children}</>;
}

function CatchAll() {
  const { currentUser, loading } = useAuthStore();
  if (loading) return null;
  return <Navigate to={currentUser ? '/dashboard' : '/login'} replace />;
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
