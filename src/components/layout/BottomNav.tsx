import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  FolderKanban,
  MapPin,
  Users,
  BarChart2,
  CheckSquare,
  ClipboardCheck,
  History,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

const fieldItems = [
  { to: '/dashboard', label: 'Home',    Icon: LayoutDashboard },
  { to: '/tasks',     label: 'Tasks',   Icon: ClipboardList },
  { to: '/surveys',   label: 'Surveys', Icon: ClipboardCheck },
];

const approverItems = [
  { to: '/dashboard',      label: 'Home',       Icon: LayoutDashboard },
  { to: '/approvals',      label: 'Approvals',  Icon: CheckSquare },
  { to: '/review-history', label: 'My Reviews', Icon: History },
];

const adminItems = [
  { to: '/dashboard',   label: 'Home',      Icon: LayoutDashboard },
  { to: '/approvals',   label: 'Approvals', Icon: CheckSquare },
  { to: '/review-history', label: 'My Reviews', Icon: History },
  { to: '/surveys/all', label: 'Surveys',   Icon: ClipboardCheck },
  { to: '/projects',    label: 'Projects',  Icon: FolderKanban },
  { to: '/sites',       label: 'Sites',     Icon: MapPin },
  { to: '/team',        label: 'Engineers', Icon: Users },
  { to: '/reports',     label: 'Reports',   Icon: BarChart2 },
];

// The read-only observer gets the admin screens minus the reviewing ones — a
// viewer never reviews anything, and /review-history is role-gated to
// approver + admin, so offering it here would be a link straight into a
// refused route. Derived from adminItems so the two stay in step.
const REVIEWER_ONLY_ROUTES = new Set(['/approvals', '/review-history']);
const viewerItems = adminItems.filter((item) => !REVIEWER_ONLY_ROUTES.has(item.to));

export function BottomNav() {
  const { currentUser } = useAuthStore();
  const items =
    currentUser?.role === 'admin'    ? adminItems :
    currentUser?.role === 'viewer'   ? viewerItems :
    currentUser?.role === 'approver' ? approverItems :
    fieldItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-stretch border-t border-gray-200 bg-white md:hidden">
      {items.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
              isActive
                ? 'text-brand-blue'
                : 'text-gray-400 hover:text-gray-600'
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('h-5 w-5', isActive && 'text-brand-blue')} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
