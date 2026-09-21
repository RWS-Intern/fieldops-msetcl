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

export function SideNav() {
  const { currentUser } = useAuthStore();
  const items =
    currentUser?.role === 'admin'    ? adminItems :
    currentUser?.role === 'viewer'   ? viewerItems :
    currentUser?.role === 'approver' ? approverItems :
    fieldItems;

  return (
    <aside className="fixed left-0 top-14 hidden h-[calc(100vh-3.5rem)] w-52 flex-col border-r border-gray-200 bg-white md:flex">
      <nav className="flex flex-col gap-1 p-2 pt-4">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-l-4 border-brand-blue bg-blue-50 pl-2 text-brand-blue'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
