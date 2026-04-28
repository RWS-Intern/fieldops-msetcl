import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { LogOut, Bell } from 'lucide-react';
import { auth } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useTaskStore } from '@/store/taskStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function Header() {
  const navigate = useNavigate();
  const { currentUser, setCurrentUser } = useAuthStore();
  const { lastUpdated, isConnected } = useTaskStore();

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    navigate('/login');
  };

  const initial = currentUser?.name?.charAt(0)?.toUpperCase() ?? '?';

  const syncTooltip = isConnected && lastUpdated
    ? `Live — last updated ${formatTime(lastUpdated)}`
    : 'Reconnecting…';

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 shadow-sm">
      {/* Brand */}
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold text-brand-blue">FieldOps</span>
        <span className="text-xs text-gray-500">Rite Solar</span>
      </div>

      {/* Right: sync dot + bell + avatar */}
      <div className="flex items-center gap-3">
        {/* Sync status dot — tooltip shows full timestamp on hover */}
        <span
          title={syncTooltip}
          aria-label={syncTooltip}
          className={`h-2 w-2 rounded-full shrink-0 ${
            isConnected ? 'bg-green-500' : 'bg-amber-400 animate-pulse'
          }`}
        />

        {/* Notification bell — placeholder for Phase 5 FCM */}
        <Bell className="h-5 w-5 text-gray-400" aria-label="Notifications" />

        {/* Avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue text-white text-sm font-semibold hover:bg-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-2"
              aria-label="User menu"
            >
              {initial}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="font-semibold text-sm">{currentUser?.name}</p>
            </DropdownMenuLabel>
            <div className="px-2 pb-1">
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium text-white ${
                currentUser?.role === 'admin' ? 'bg-brand-blue' : 'bg-brand-green'
              }`}>
                {currentUser?.role === 'admin' ? 'Admin' : 'Field'}
              </span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
