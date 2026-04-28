import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore }           from '@/store/authStore';
import { useTasks }               from '@/hooks/useTasks';
import { useProjects }            from '@/hooks/useProjects';
import { useUsers }               from '@/hooks/useUsers';
import { useSites }               from '@/hooks/useSites';
import { useAssignedSiteTasks }   from '@/hooks/useAssignedSiteTasks';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { OfflineBanner } from '@/components/offline/OfflineBanner';
import { OfflineQueueProcessor } from '@/components/offline/OfflineQueueProcessor';

// Starts the single shared Firestore tasks listener for the whole session.
function TasksListener() {
  useTasks();
  return null;
}

// Starts the single shared Firestore projects listener for the whole session.
function ProjectsListener() {
  useProjects();
  return null;
}

// Starts the real-time users listener — admin sessions only.
// Field engineers never need the full user list.
function UsersListener() {
  useUsers();
  return null;
}

// Starts the real-time sites listener — admin sessions only.
function SitesListener() {
  useSites();
  return null;
}

// Listens to siteTasks assigned to the current user — field engineer sessions.
// Field engineers cannot see all siteTasks (security rules restrict reads to
// documents where assignedTo == their uid), so we keep this listener separate
// from the admin SitesListener above.
function AssignedSiteTasksListener() {
  useAssignedSiteTasks();
  return null;
}

export function Layout() {
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

  // Diagnostic — remove once confirmed working
  console.log('[Layout] currentUser role:', currentUser?.role, 'uid:', currentUser?.uid);

  return (
    <div className="min-h-screen bg-brand-background">
      {/* One listener wired here; Dashboard + Tasks read from taskStore */}
      <TasksListener />
      {/* One listener wired here; Projects page + Dashboard read from projectStore */}
      <ProjectsListener />
      {/* Users listener — admin only; Team page reads from userStore */}
      {currentUser?.role === 'admin' && <UsersListener />}
      {/* Sites listener — admin only; Sites page reads from siteStore */}
      {currentUser?.role === 'admin' && <SitesListener />}
      {/*
       * Assigned site-tasks listener — ALL authenticated users.
       * Previously gated on role === 'field', but running for all users is safe:
       * the query is where('assignedTo', '==', uid) so admins with no assigned
       * siteTasks simply get an empty result. This ensures the listener always
       * mounts regardless of whatever role string is stored in the user doc.
       */}
      <AssignedSiteTasksListener />
      {/* Drains IndexedDB queue when connection is restored */}
      <OfflineQueueProcessor />
      <Header />
      <SideNav />
      {/* Offline / syncing banner sits below the header */}
      <OfflineBanner />
      <main className="pb-16 md:ml-52 md:pb-0">
        <div className="p-4">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
