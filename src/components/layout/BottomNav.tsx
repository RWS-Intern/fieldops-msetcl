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
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

const fieldItems = [
  { to: '/dashboard', label: 'Home',    Icon: LayoutDashboard },
  { to: '/tasks',     label: 'Tasks',   Icon: ClipboardList },
  { to: '/surveys',   label: 'Surveys', Icon: ClipboardCheck },
];

const approverItems = [
  { to: '/dashboard',  label: 'Home',       Icon: LayoutDashboard },
  { to: '/approvals',  label: 'Approvals',  Icon: CheckSquare },
];

const adminItems = [
  { to: '/dashboard', label: 'Home',      Icon: LayoutDashboard },
  { to: '/approvals', label: 'Approvals', Icon: CheckSquare },
  { to: '/surveys',   label: 'Surveys',   Icon: ClipboardCheck },
  { to: '/projects',  label: 'Projects',  Icon: FolderKanban },
  { to: '/sites',     label: 'Sites',     Icon: MapPin },
  { to: '/team',      label: 'Engineers', Icon: Users },
  { to: '/reports',   label: 'Reports',   Icon: BarChart2 },
];

export function BottomNav() {
  const { currentUser } = useAuthStore();
  const items =
    currentUser?.role === 'admin'    ? adminItems :
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
