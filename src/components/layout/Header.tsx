import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { LogOut, Bell, Search, X, Settings } from 'lucide-react';
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
import { SiteSearch } from '@/components/layout/SiteSearch';

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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    navigate('/login');
  };

  const initial = currentUser?.name?.charAt(0)?.toUpperCase() ?? '?';

  const syncTooltip = isConnected && lastUpdated
    ? `Live — last updated ${formatTime(lastUpdated)}`
    : 'Reconnecting…';

  // Substation search is an oversight tool: admins manage sites, viewers
  // monitor them. A field expert only ever works their own assigned list and
  // has no read access to the full site corpus to search over.
  const canSearchSites = currentUser?.role === 'admin' || currentUser?.role === 'viewer';

  // Settings edits appConfig and is gated with requireAdmin on the route
  // itself (App.tsx). Rendering the item for anyone else would just bounce
  // them to /dashboard, so it is hidden rather than shown-and-denied.
  const isAdmin = currentUser?.role === 'admin';

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        {/* Brand */}
        <div className="flex shrink-0 items-center gap-2">
          <img
            src="/rite-water-logo.png"
            alt="Rite Water Solutions"
            className="h-8 w-auto shrink-0"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-bold text-brand-blue">FieldOps</span>
            {/* "MSETCL Substation · Rite Water Solutions" doesn't fit this
                header's available width at mobile viewports (logo + gap on the
                left, sync dot + bell + avatar cluster on the right leave too
                little room for ~40 characters at text-xs) — the deployment
                name alone does. */}
            <span className="text-xs text-gray-500">MSETCL Substation</span>
          </div>
        </div>

        {/* Global substation search — inline from md up, where there is room
            between the brand and the control cluster. Below that it collapses
            to the icon button on the right, which opens the row underneath. */}
        {canSearchSites && (
          <div className="hidden min-w-0 max-w-md flex-1 md:block">
            <SiteSearch />
          </div>
        )}

        {/* Right: sync dot + bell + avatar */}
        <div className="flex shrink-0 items-center gap-3">
          {/* Mobile affordance for the same search. */}
          {canSearchSites && (
            <button
              type="button"
              onClick={() => setMobileSearchOpen((v) => !v)}
              aria-label={mobileSearchOpen ? 'Close substation search' : 'Search substations'}
              aria-expanded={mobileSearchOpen}
              className="text-gray-400 transition-colors hover:text-gray-600 md:hidden"
            >
              {mobileSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </button>
          )}
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
                  currentUser?.role === 'admin' ? 'bg-brand-blue' :
                  currentUser?.role === 'approver' ? 'bg-violet-500' :
                  currentUser?.role === 'viewer' ? 'bg-slate-500' :
                  'bg-brand-green'
                }`}>
                  {currentUser?.role === 'admin' ? 'Admin' :
                   currentUser?.role === 'approver' ? 'Approver' :
                   currentUser?.role === 'viewer' ? 'Viewer' :
                   'Field Expert'}
                </span>
              </div>
              <DropdownMenuSeparator />
              {isAdmin && (
                <>
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded mobile search row — sits below the bar so the input gets
          full width rather than competing with the brand for it. */}
      {canSearchSites && mobileSearchOpen && (
        <div className="border-t border-gray-100 px-4 py-2 md:hidden">
          <SiteSearch autoFocus onNavigated={() => setMobileSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
